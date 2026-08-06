import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const REGULAR_USER_ID = '00000000-0000-0000-0000-000000000002';
const AUDITOR_ID = '00000000-0000-0000-0000-000000000003';
const SECOND_SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000004';
// ไม่มี role ใดๆ เลย จึงไม่มี permission ใดๆ เลยจาก has_permission() — ใช้ยืนยันกรณี
// "ไม่เกี่ยวข้องกับ record นี้เลย" ที่ต้องแยกจาก auditor/user ซึ่ง seed เริ่มต้นให้ ticket.view มาด้วย
const NO_ROLE_USER_ID = '00000000-0000-0000-0000-000000000005';
// role 'user' ธรรมดา ไม่มี service_request.view/approve ใดๆ — ใช้ยืนยันว่าการมองเห็น/อนุมัติคำขอ
// รออนุมัติมาจาก "เป็นสมาชิกกลุ่มอนุมัติ" ล้วนๆ ไม่ใช่จาก permission
const APPROVAL_GROUP_MEMBER_ID = '00000000-0000-0000-0000-000000000006';

let db: PGlite;

async function createUserWithRole(userId: string, email: string, roleKey: string) {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = $2`,
      [userId, roleKey],
    );
  });
}

beforeAll(async () => {
  db = await createTestDb();

  await createUserWithRole(SUPER_ADMIN_ID, 'super-admin@test.local', 'super_admin');
  await createUserWithRole(REGULAR_USER_ID, 'user@test.local', 'user');
  await createUserWithRole(AUDITOR_ID, 'auditor@test.local', 'auditor');
  await createUserWithRole(SECOND_SUPER_ADMIN_ID, 'super-admin-2@test.local', 'super_admin');
  await createUserWithRole(APPROVAL_GROUP_MEMBER_ID, 'approver-member@test.local', 'user');

  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [NO_ROLE_USER_ID, 'no-role@test.local']);
  });

  await asServiceRole(db, async () => {
    await db.query(
      `insert into public.audit_logs (actor_email, action, module, result)
       values ('someone@test.local', 'CREATE', 'ticket', 'success')`,
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('seed data', () => {
  it('seeds 9 roles and 31 permissions', async () => {
    const roles = await db.query('select count(*)::int as count from public.roles');
    const permissions = await db.query('select count(*)::int as count from public.permissions');
    expect((roles.rows[0] as { count: number }).count).toBe(9);
    expect((permissions.rows[0] as { count: number }).count).toBe(31);
  });
});

describe('has_permission()', () => {
  it('denies an unknown permission key (fail-closed)', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('does.not.exist') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('grants super_admin every seeded permission', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(true);
  });

  it('denies a plain user the role.manage permission', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('a user-level DENY override wins over an ALLOW from the role', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
         select $1, id, 'deny', 'ทดสอบ deny override', 'active'
         from public.permissions where key = 'ticket.view'`,
        [REGULAR_USER_ID],
      );
    });

    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query("select public.has_permission('ticket.view') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('returns false once the profile is disabled, even for super_admin', async () => {
    await asServiceRole(db, async () => {
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
    });

    const result = await asUser(db, SECOND_SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });
});

describe('profiles RLS', () => {
  it('lets a user see only their own profile row', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.profiles'));
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { id: string }).id).toBe(REGULAR_USER_ID);
  });

  it('lets super_admin (user.manage) see every profile', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () => db.query('select id from public.profiles'));
    expect(result.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('returns no rows for an unauthenticated (anon) request', async () => {
    const result = await asAnon(db, async () => db.query('select id from public.profiles'));
    expect(result.rows).toHaveLength(0);
  });
});

describe('audit_logs RLS (immutable, restricted read)', () => {
  it('hides audit_logs from a plain user without audit.view', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.audit_logs'));
    expect(result.rows).toHaveLength(0);
  });

  it('lets an auditor read audit_logs', async () => {
    const result = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.audit_logs'));
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a direct insert into audit_logs from an authenticated user (backend-only via service_role)', async () => {
    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.audit_logs (actor_email, action, module, result) values ($1, 'CREATE', 'ticket', 'success')`,
          ['super-admin@test.local'],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('ticket_categories / asset_categories RLS (Master Data, Phase 6)', () => {
  it('lets any authenticated user read ticket_categories and asset_categories', async () => {
    await asServiceRole(db, async () => {
      await db.query(`insert into public.ticket_categories (name) values ('เครือข่าย') on conflict do nothing`);
      await db.query(
        `insert into public.asset_categories (name, code_prefix) values ('โน้ตบุ๊ก', 'NB') on conflict do nothing`,
      );
    });

    const categories = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select name from public.ticket_categories'),
    );
    expect(categories.rows.length).toBeGreaterThanOrEqual(1);

    const assetCategories = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select name from public.asset_categories'),
    );
    expect(assetCategories.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a plain user writing to ticket_categories/asset_categories without the manage permission', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.ticket_categories (name) values ('ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.asset_categories (name, code_prefix) values ('ทดสอบ-rejected', 'RJ')`),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has ticket_category.manage/asset_category.manage) write to both tables', async () => {
    const insertedTicketCategory = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.ticket_categories (name) values ('ฮาร์ดแวร์') returning id`),
    );
    expect(insertedTicketCategory.rows).toHaveLength(1);

    const insertedAssetCategory = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.asset_categories (name, code_prefix) values ('เดสก์ท็อป', 'PC') returning id`),
    );
    expect(insertedAssetCategory.rows).toHaveLength(1);
  });

  it('rejects an invalid default_priority value outside the 4-level scale (ต่ำ/ปานกลาง/สูง/วิกฤต)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.ticket_categories (name, default_priority) values ('ทดสอบ-invalid', 'ด่วนสุด')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('user_permission_overrides uniqueness (Phase 6 Module 2)', () => {
  it('rejects a second override row for the same user + permission (one governed row per key)', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
         select $1, id, 'allow', 'ทดสอบ unique ครั้งที่ 1', 'active'
         from public.permissions where key = 'asset.view'`,
        [AUDITOR_ID],
      );
    });

    await expect(
      asServiceRole(db, async () => {
        await db.query(
          `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
           select $1, id, 'deny', 'ทดสอบ unique ครั้งที่ 2', 'active'
           from public.permissions where key = 'asset.view'`,
          [AUDITOR_ID],
        );
      }),
    ).rejects.toThrow();
  });
});

describe('approval_groups / approval_group_members RLS (Phase 6 Module 2)', () => {
  let groupId: string;

  it('lets any authenticated user read approval_groups', async () => {
    await asServiceRole(db, async () => {
      const inserted = await db.query(
        `insert into public.approval_groups (code, name) values ('IT-CHANGE', 'กลุ่มอนุมัติ Change ฝ่ายไอที') returning id`,
      );
      groupId = (inserted.rows[0] as { id: string }).id;
    });

    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.approval_groups'));
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a plain user writing to approval_groups without approval_group.manage', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.approval_groups (code, name) values ('REJECT-1', 'ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid approval_groups.code format', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.approval_groups (code, name) values ('bad code!', 'รูปแบบรหัสไม่ถูกต้อง')`),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has approval_group.manage) add a member and read it back', async () => {
    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(
        `insert into public.approval_group_members (group_id, user_id, member_role, priority)
         values ($1, $2, 'primary', 10) returning id`,
        [groupId, REGULAR_USER_ID],
      ),
    );
    expect(inserted.rows).toHaveLength(1);

    const readBack = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.approval_group_members where group_id = $1', [groupId]),
    );
    expect(readBack.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a duplicate member (same user twice in the same group)', async () => {
    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.approval_group_members (group_id, user_id) values ($1, $2)`,
          [groupId, REGULAR_USER_ID],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('employees RLS (Phase 6 Module 3)', () => {
  it('lets any authenticated user read employees', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.employees (employee_code, first_name_th, last_name_th)
         values ('EMP-001', 'ทดสอบ', 'ระบบ') on conflict do nothing`,
      );
    });

    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.employees'));
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a plain user writing to employees without employee.manage', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-REJECT', 'ก', 'ข')`),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has employee.manage) write to employees', async () => {
    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(
        `insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-002', 'สมชาย', 'ใจดี') returning id`,
      ),
    );
    expect(inserted.rows).toHaveLength(1);
  });

  it('rejects a duplicate employee_code', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-001', 'ซ้ำ', 'รหัส')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate email but allows multiple employees with no email', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.employees (employee_code, first_name_th, last_name_th, email)
         values ('EMP-003', 'มีอีเมล', 'หนึ่ง', 'dup@test.local')`,
      );
      await db.query(`insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-004', 'ไม่มี', 'อีเมล')`);
      await db.query(`insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-005', 'ไม่มี', 'อีเมลเช่นกัน')`);
    });

    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.employees (employee_code, first_name_th, last_name_th, email)
           values ('EMP-006', 'ซ้ำ', 'อีเมล', 'dup@test.local')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('tickets / ticket_worklogs RLS (Phase 6 Module 4)', () => {
  let ticketId: string;

  it('lets the requester (user role, has ticket.create) open a ticket for themselves', async () => {
    const inserted = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(
        `insert into public.tickets (title, requester_id, description) values ('ทดสอบเปิดเรื่อง', $1, 'รายละเอียดทดสอบ') returning id`,
        [REGULAR_USER_ID],
      ),
    );
    expect(inserted.rows).toHaveLength(1);
    ticketId = (inserted.rows[0] as { id: string }).id;
  });

  it('rejects opening a ticket on behalf of someone else (requester_id must be self)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.tickets (title, requester_id, description) values ('สวมรอย', $1, 'x')`, [SUPER_ADMIN_ID]),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester see their own ticket, but hides it from an unrelated plain user', async () => {
    const ownView = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.tickets where id = $1', [ticketId]),
    );
    expect(ownView.rows).toHaveLength(1);

    const otherView = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.tickets where id = $1', [ticketId]),
    );
    // ผู้ใช้ที่ไม่มี role เลยจึงไม่มี ticket.view และไม่ใช่ requester/assignee ของ ticket นี้
    expect(otherView.rows).toHaveLength(0);
  });

  it('lets super_admin (has ticket.update) update the ticket, and writes a worklog entry', async () => {
    const updated = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`update public.tickets set status = 'รับเรื่องแล้ว', assignee_id = $1 where id = $2 returning id`, [
        SUPER_ADMIN_ID,
        ticketId,
      ]),
    );
    expect(updated.rows).toHaveLength(1);

    const worklog = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(
        `insert into public.ticket_worklogs (ticket_id, action, status_from, status_to, actor_id, is_public)
         values ($1, 'รับเรื่อง', 'ใหม่', 'รับเรื่องแล้ว', $2, true) returning id`,
        [ticketId, SUPER_ADMIN_ID],
      ),
    );
    expect(worklog.rows).toHaveLength(1);
  });

  it('rejects a plain requester writing a worklog directly (staff-only action)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(
          `insert into public.ticket_worklogs (ticket_id, action, actor_id) values ($1, 'แอบเขียน', $2)`,
          [ticketId, REGULAR_USER_ID],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester read a public worklog entry on their own ticket', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.ticket_worklogs where ticket_id = $1', [ticketId]),
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('silently updates zero rows when an unrelated plain user targets a ticket they cannot see (RLS USING filters it out, not an error)', async () => {
    const result = await asUser(db, AUDITOR_ID, async () =>
      db.query(`update public.tickets set status = 'ยกเลิก' where id = $1 returning id`, [ticketId]),
    );
    expect(result.rows).toHaveLength(0);

    const stillOpen = await asServiceRole(db, async () => db.query('select status from public.tickets where id = $1', [ticketId]));
    expect((stillOpen.rows[0] as { status: string }).status).not.toBe('ยกเลิก');
  });

  it('rejects an invalid ticket status value outside the fixed state machine', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`update public.tickets set status = 'ไม่มีอยู่จริง' where id = $1`, [ticketId])),
    ).rejects.toThrow();
  });

  it('lets a ticket participant (requester) see file_attachments uploaded by the assignee for that ticket', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.file_attachments (storage_path, original_filename, mime_type, size_bytes, module, target_table, target_id, uploaded_by)
         values ($1, 'evidence.png', 'image/png', 1024, 'ticket', 'tickets', $2, $3)`,
        [`${SUPER_ADMIN_ID}/evidence.png`, ticketId, SUPER_ADMIN_ID],
      );
    });

    const asRequester = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.file_attachments where target_id = $1', [ticketId]),
    );
    expect(asRequester.rows.length).toBeGreaterThanOrEqual(1);

    const asUnrelated = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.file_attachments where target_id = $1', [ticketId]),
    );
    expect(asUnrelated.rows).toHaveLength(0);
  });
});

describe('service_catalog / service_requests RLS (Phase 6 Module 5)', () => {
  let groupId: string;
  let catalogId: string;
  let requestId: string;

  it('lets any authenticated user read service_catalog, but rejects a plain user writing to it', async () => {
    await asServiceRole(db, async () => {
      const group = await db.query(
        `insert into public.approval_groups (code, name) values ('SVC-APPROVE', 'กลุ่มอนุมัติคำขอบริการ') returning id`,
      );
      groupId = (group.rows[0] as { id: string }).id;
      await db.query(
        `insert into public.approval_group_members (group_id, user_id, member_role) values ($1, $2, 'primary')`,
        [groupId, APPROVAL_GROUP_MEMBER_ID],
      );
    });

    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(
        `insert into public.service_catalog (service_code, service_name, status, approval_mode, approval_group_id)
         values ('SVC-001', 'ขอเปลี่ยนรหัสผ่าน', 'active', 'group', $1) returning id`,
        [groupId],
      ),
    );
    catalogId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const readBack = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.service_catalog'));
    expect(readBack.rows.length).toBeGreaterThanOrEqual(1);

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.service_catalog (service_code, service_name) values ('SVC-REJECT', 'ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects approval_mode = group without an approval_group_id (check constraint)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.service_catalog (service_code, service_name, approval_mode) values ('SVC-BAD', 'ไม่มีกลุ่มอนุมัติ', 'group')`),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester (user role, has service_request.create) submit a request for themselves', async () => {
    const inserted = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(
        `insert into public.service_requests
           (catalog_id, service_code, service_name, requester_id, summary, approval_mode, approval_group_id, status, approval_status)
         values ($1, 'SVC-001', 'ขอเปลี่ยนรหัสผ่าน', $2, 'ทดสอบยื่นคำขอ', 'group', $3, 'รออนุมัติ', 'pending')
         returning id`,
        [catalogId, REGULAR_USER_ID, groupId],
      ),
    );
    requestId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);
  });

  it('rejects submitting a request on behalf of someone else (requester_id must be self)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(
          `insert into public.service_requests (catalog_id, service_code, service_name, requester_id, summary)
           values ($1, 'SVC-001', 'ขอเปลี่ยนรหัสผ่าน', $2, 'สวมรอย')`,
          [catalogId, SUPER_ADMIN_ID],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester see their own request, hides it from an unrelated no-role user, but shows it to the approval group member', async () => {
    const ownView = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.service_requests where id = $1', [requestId]),
    );
    expect(ownView.rows).toHaveLength(1);

    const unrelatedView = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.service_requests where id = $1', [requestId]),
    );
    expect(unrelatedView.rows).toHaveLength(0);

    // ไม่มี service_request.view/approve ใดๆ — มองเห็นได้เพราะเป็นสมาชิกกลุ่มอนุมัติที่ผูกกับคำขอนี้เท่านั้น
    const approverView = await asUser(db, APPROVAL_GROUP_MEMBER_ID, async () =>
      db.query('select id from public.service_requests where id = $1', [requestId]),
    );
    expect(approverView.rows).toHaveLength(1);
  });

  it('lets the approval group member approve (update) the request purely via group membership, not permission', async () => {
    const updated = await asUser(db, APPROVAL_GROUP_MEMBER_ID, async () =>
      db.query(
        `update public.service_requests set status = 'รอมอบหมาย', approval_status = 'approved', approved_by = $1 where id = $2 returning id`,
        [APPROVAL_GROUP_MEMBER_ID, requestId],
      ),
    );
    expect(updated.rows).toHaveLength(1);

    const historyInsert = await asUser(db, APPROVAL_GROUP_MEMBER_ID, async () =>
      db.query(
        `insert into public.service_request_history (request_id, action, status_from, status_to, actor_id)
         values ($1, 'อนุมัติคำขอ', 'รออนุมัติ', 'รอมอบหมาย', $2) returning id`,
        [requestId, APPROVAL_GROUP_MEMBER_ID],
      ),
    );
    expect(historyInsert.rows).toHaveLength(1);
  });

  it('rejects a plain requester writing a service_request_tasks row directly (staff-only action)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.service_request_tasks (request_id, task_name) values ($1, 'แอบเขียน Checklist')`, [requestId]),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has service_request.update) create a task, and the requester can read it back', async () => {
    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.service_request_tasks (request_id, task_name, sequence) values ($1, 'ตรวจสอบสิทธิ์', 1) returning id`, [
        requestId,
      ]),
    );
    expect(inserted.rows).toHaveLength(1);

    const asRequester = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.service_request_tasks where request_id = $1', [requestId]),
    );
    expect(asRequester.rows.length).toBeGreaterThanOrEqual(1);

    const asUnrelated = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.service_request_tasks where request_id = $1', [requestId]),
    );
    expect(asUnrelated.rows).toHaveLength(0);
  });

  it('rejects an invalid service_requests status value outside the fixed state machine', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`update public.service_requests set status = 'ไม่มีอยู่จริง' where id = $1`, [requestId])),
    ).rejects.toThrow();
  });

  it('lets a request participant (requester) see file_attachments uploaded by staff for that request', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.file_attachments (storage_path, original_filename, mime_type, size_bytes, module, target_table, target_id, uploaded_by)
         values ($1, 'evidence-svc.png', 'image/png', 1024, 'service_request', 'service_requests', $2, $3)`,
        [`${SUPER_ADMIN_ID}/evidence-svc.png`, requestId, SUPER_ADMIN_ID],
      );
    });

    const asRequester = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.file_attachments where target_id = $1', [requestId]),
    );
    expect(asRequester.rows.length).toBeGreaterThanOrEqual(1);

    const asUnrelated = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.file_attachments where target_id = $1', [requestId]),
    );
    expect(asUnrelated.rows).toHaveLength(0);
  });
});

describe('role management RLS', () => {
  it('rejects a plain user trying to grant themselves a role', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () => {
        const superAdminRole = await db.query("select id from public.roles where key = 'super_admin'");
        await db.query('insert into public.user_roles (user_id, role_id) values ($1, $2)', [
          REGULAR_USER_ID,
          (superAdminRole.rows[0] as { id: string }).id,
        ]);
      }),
    ).rejects.toThrow();
  });

  it('blocks removing the last active super_admin (last-admin guard)', async () => {
    // ปิดใช้งาน super_admin คนที่ 2 ก่อน เพื่อให้ SUPER_ADMIN_ID เหลือเป็นคนสุดท้ายที่ Active
    await asServiceRole(db, async () => {
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'active' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'active' where id = $1`, [SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
    });

    await expect(
      asServiceRole(db, async () => {
        await db.query(
          `delete from public.user_roles
           where user_id = $1 and role_id = (select id from public.roles where key = 'super_admin')`,
          [SUPER_ADMIN_ID],
        );
      }),
    ).rejects.toThrow(/last-admin guard/);
  });
});
