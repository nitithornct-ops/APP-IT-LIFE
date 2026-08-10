import { createClient } from '@supabase/supabase-js';
import type { AuthAdmin } from './executor.js';

/**
 * Real Supabase Auth invite path. auth.users is not a plain table an importer may INSERT
 * into directly — Supabase's Admin API owns invite-token generation and delivery, so the
 * rehearsal must go through it rather than raw SQL (see executor.ts's AuthAdmin interface).
 */
export function createSupabaseAuthAdmin(supabaseUrl: string, serviceRoleKey: string): AuthAdmin {
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async inviteUser({ email, fullName }) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
      });
      if (error || !data.user) {
        throw new Error(`Supabase invite failed for ${email}: ${error?.message ?? 'no user returned'}`);
      }
      return { id: data.user.id };
    },
  };
}
