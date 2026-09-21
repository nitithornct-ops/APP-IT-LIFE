import { randomUUID } from 'node:crypto';
import { createClient, type Session } from '@supabase/supabase-js';
import { liveSupabaseConfig, totpCode } from './liveAuth';

const ROLE_KEYS = {
  UAT_REQUESTER: 'user',
  UAT_TECHNICIAN: 'technician',
  UAT_APPROVER: 'approver',
  UAT_MANAGER: 'manager',
  UAT_ADMIN: 'super_admin',
} as const;

export interface ExternalUatFixture {
  roleEmails: Record<keyof typeof ROLE_KEYS, string>;
  vendor: {
    code: string;
    username: string;
    totpSecret: string;
    session: Session;
  };
  cleanup: () => Promise<void>;
}

export async function provisionExternalUatFixture(): Promise<ExternalUatFixture> {
  const { supabaseUrl, anonKey, serviceRoleKey } = liveSupabaseConfig();
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now().toString(36)}${randomUUID().replaceAll('-', '').slice(0, 6)}`.toLowerCase();
  const roleEmails = {} as Record<keyof typeof ROLE_KEYS, string>;
  const internalUserIds: string[] = [];
  let vendorId: string | null = null;
  let vendorAccountId: string | null = null;
  let vendorUserId: string | null = null;

  const cleanup = async () => {
    if (vendorAccountId) await service.from('vendor_portal_accounts').delete().eq('id', vendorAccountId);
    if (vendorUserId) await service.auth.admin.deleteUser(vendorUserId);
    if (vendorId) await service.from('vendors').delete().eq('id', vendorId);
    if (internalUserIds.length) {
      await service.from('profiles').update({ status: 'inactive' }).in('id', internalUserIds);
      await service.from('user_roles').delete().in('user_id', internalUserIds);
      for (const userId of internalUserIds.reverse()) await service.auth.admin.deleteUser(userId);
    }
  };

  try {
    for (const [prefix, roleKey] of Object.entries(ROLE_KEYS) as Array<[keyof typeof ROLE_KEYS, string]>) {
      const email = `e2e-uat-${roleKey}-${suffix}@example.invalid`;
      const { data: role, error: roleError } = await service.from('roles').select('id').eq('key', roleKey).maybeSingle();
      if (roleError || !role) throw roleError ?? new Error(`Role ${roleKey} is missing`);
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: `E2E UAT ${roleKey}` },
      });
      if (createError || !created.user) throw createError ?? new Error(`Could not create ${roleKey} UAT user`);
      internalUserIds.push(created.user.id);
      const { error: roleAssignmentError } = await service.from('user_roles').insert({ user_id: created.user.id, role_id: role.id });
      if (roleAssignmentError) throw roleAssignmentError;
      const { error: profileError } = await service.from('profiles').update({
        status: 'active',
        onboarding_completed_at: new Date().toISOString(),
      }).eq('id', created.user.id);
      if (profileError) throw profileError;
      roleEmails[prefix] = email;
    }

    const vendorCode = `UAT-${suffix.toUpperCase()}`;
    const username = `uat_${suffix.slice(0, 16)}`;
    const password = `Uat!${randomUUID()}Aa9`;
    const vendorEmail = `e2e-uat-vendor-${suffix}@example.invalid`;
    const now = new Date().toISOString();
    const { data: vendor, error: vendorError } = await service.from('vendors').insert({
      vendor_code: vendorCode,
      name: `E2E UAT Vendor ${suffix}`,
      service_type: 'อื่นๆ',
      status: 'Active',
    }).select('id').single();
    if (vendorError || !vendor) throw vendorError ?? new Error('Could not create UAT vendor');
    vendorId = vendor.id;

    const { data: vendorUser, error: vendorUserError } = await service.auth.admin.createUser({
      email: vendorEmail,
      password,
      email_confirm: true,
      user_metadata: {
        account_type: 'vendor_portal',
        full_name: 'E2E UAT Vendor User',
        vendor_id: vendorId,
        username,
      },
    });
    if (vendorUserError || !vendorUser.user) throw vendorUserError ?? new Error('Could not create UAT vendor identity');
    vendorUserId = vendorUser.user.id;

    const { data: vendorAccount, error: vendorAccountError } = await service.from('vendor_portal_accounts').insert({
      vendor_id: vendorId,
      username,
      email: vendorEmail,
      full_name: 'E2E UAT Vendor User',
      position: 'E2E Tester',
      status: 'Active',
      auth_user_id: vendorUserId,
      invite_status: 'Accepted',
      invited_at: now,
      accepted_at: now,
    }).select('id').single();
    if (vendorAccountError || !vendorAccount) throw vendorAccountError ?? new Error('Could not create UAT vendor portal account');
    vendorAccountId = vendorAccount.id;

    const vendorClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Password sign-in is protected by Turnstile in staging. Create the
    // disposable setup session through an admin-issued magic link so fixture
    // provisioning never weakens or bypasses the browser login policy.
    const { data: setupLink, error: setupLinkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email: vendorEmail,
    });
    if (setupLinkError || !setupLink.properties.hashed_token) {
      throw setupLinkError ?? new Error('Could not create the vendor MFA setup session');
    }
    const { error: setupSessionError } = await vendorClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: setupLink.properties.hashed_token,
    });
    if (setupSessionError) throw setupSessionError;
    const { data: enrollment, error: enrollmentError } = await vendorClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Staging E2E vendor factor',
    });
    if (enrollmentError || !enrollment) throw enrollmentError ?? new Error('Could not enroll vendor MFA');
    let vendorSession: Session | null = null;
    let verifyError: unknown;
    for (const offset of [0, -1, 1]) {
      const { error } = await vendorClient.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: totpCode(enrollment.totp.secret, offset) });
      if (!error) {
        const { data: current, error: sessionError } = await vendorClient.auth.getSession();
        if (sessionError) throw sessionError;
        vendorSession = current.session;
        break;
      }
      verifyError = error;
    }
    if (!vendorSession) throw verifyError ?? new Error('Could not verify vendor MFA enrollment');
    const { error: mfaStateError } = await service.from('vendor_portal_accounts').update({ mfa_enrolled_at: now }).eq('id', vendorAccountId);
    if (mfaStateError) throw mfaStateError;

    return {
      roleEmails,
      vendor: { code: vendorCode, username, totpSecret: enrollment.totp.secret, session: vendorSession },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
