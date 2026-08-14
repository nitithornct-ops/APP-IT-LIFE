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
// หัวหน้างานของ REGULAR_USER_ID (ตั้งผ่าน profiles.supervisor_id) — role 'user' ธรรมดา ไม่มี
// access_request.approve ใดๆ — ใช้ยืนยันว่าการอนุมัติคำขอสิทธิ์มาจาก "เป็นหัวหน้างานที่ถูก route มา"
// ล้วนๆ ไม่ใช่จาก permission
const SUPERVISOR_ID = '00000000-0000-0000-0000-000000000007';
// role 'technician' — ตัวแทน "ช่าง IT" ที่ seed.sql (Phase 6 Module 8) ให้สิทธิ์ asset.*/maintenance.*/
// inventory.*/license.* เต็ม (ต่างจาก auditor ที่มีแค่ฝั่ง .view) ใช้ยืนยัน happy-path ของฝั่งเขียน
const TECHNICIAN_ID = '00000000-0000-0000-0000-000000000008';
// role 'dpo' — seed.sql (Phase 6 Module 9) ให้ cmdb.view เป็นพิเศษเฉพาะโมดูลนี้ (ไม่ได้อยู่ใน convention
// manager/executive/auditor ทั่วไป) เพราะ CI มีฟิลด์ DataClassification/RPO/RTO ที่เกี่ยวข้องกับงาน DPO ตรง ๆ
const DPO_ID = '00000000-0000-0000-0000-000000000009';
const SECOND_TECHNICIAN_ID = '00000000-0000-0000-0000-000000000010';
const CHANGE_APPROVER_ID = '00000000-0000-0000-0000-000000000011';

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
  await createUserWithRole(SUPERVISOR_ID, 'supervisor@test.local', 'user');
  await createUserWithRole(TECHNICIAN_ID, 'technician@test.local', 'technician');
  await createUserWithRole(DPO_ID, 'dpo@test.local', 'dpo');
  await createUserWithRole(SECOND_TECHNICIAN_ID, 'technician-2@test.local', 'technician');
  await createUserWithRole(CHANGE_APPROVER_ID, 'change-approver@test.local', 'approver');

  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [NO_ROLE_USER_ID, 'no-role@test.local']);
    await db.query('update public.profiles set supervisor_id = $1 where id = $2', [SUPERVISOR_ID, REGULAR_USER_ID]);
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
  it('seeds 9 roles and 114 permissions', async () => {
    const roles = await db.query('select count(*)::int as count from public.roles');
    const permissions = await db.query('select count(*)::int as count from public.permissions');
    expect((roles.rows[0] as { count: number }).count).toBe(9);
    expect((permissions.rows[0] as { count: number }).count).toBe(114);
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
  // เปิดให้อ่านได้ทุกคนที่ login แล้ว ตั้งแต่ Phase 6 Module 6 (ดู header comment ของ
  // 20260812100000_access_requests.sql) — แก้บั๊กแฝงที่ embedded join ไปยัง profiles ของอีกฝ่าย
  // (เช่น requester ของ Ticket/Service Request/Access Request) ถูก RLS กรองเป็น null สำหรับผู้ใช้ที่
  // ไม่มี user.manage เขียน (update) ยังคงจำกัดเฉพาะเจ้าของแถวหรือผู้มี user.manage เหมือนเดิม
  it('lets any authenticated user read every profile row (directory-style data)', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.profiles'));
    expect(result.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a plain user updating another profile (write stays self-or-user.manage only)', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(`update public.profiles set full_name = 'สวมรอย' where id = $1 returning id`, [SUPER_ADMIN_ID]),
    );
    // RLS USING กรองแถวออกแบบเงียบๆ (ไม่ error) — ยืนยันว่าไม่มีแถวถูกแก้ไข
    expect(result.rows).toHaveLength(0);
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
  // เดิมตารางนี้เปิดให้ทุกคนที่ login แล้วอ่านได้ (`using (true)`) เพื่อให้โมดูลอื่นทำ dropdown ได้
  // แต่ทะเบียนพนักงานมี PII (email, upn, username_ad, notes) — การทดสอบเจาะระบบจริงพบว่าบัญชีที่ไม่มี
  // สิทธิ์ใดเลยดึงได้ครบทุกฟิลด์ จึงจำกัดไว้ที่ employee.manage ตั้งแต่
  // 20260908100000_tighten_directory_access.sql และให้ dropdown ใช้ GET /api/v1/employees/options แทน
  it('hides the employee register from a user without employee.manage', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.employees (employee_code, first_name_th, last_name_th)
         values ('EMP-001', 'ทดสอบ', 'ระบบ') on conflict do nothing`,
      );
    });

    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.employees'));
    expect(result.rows).toHaveLength(0);
  });

  it('lets a user with employee.manage read the employee register', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () => db.query('select id from public.employees'));
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

describe('access_systems / access_requests / user_access_registry RLS (Phase 6 Module 6)', () => {
  let systemId: string;
  let requestId: string;

  it('lets any authenticated user read access_systems, but rejects a plain user writing to it', async () => {
    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.access_systems (name) values ('Google Workspace') returning id`),
    );
    systemId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const readBack = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.access_systems'));
    expect(readBack.rows.length).toBeGreaterThanOrEqual(1);

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.access_systems (name) values ('ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester (has access_request.create, supervisor_id set) submit a request for themselves', async () => {
    const inserted = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(
        `insert into public.access_requests (requester_id, system_id, access_level, reason, approver_id)
         values ($1, $2, 'Standard', 'ทดสอบยื่นคำขอ', $3) returning id`,
        [REGULAR_USER_ID, systemId, SUPERVISOR_ID],
      ),
    );
    requestId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);
  });

  it('rejects submitting a request on behalf of someone else (requester_id must be self)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(
          `insert into public.access_requests (requester_id, system_id, access_level, reason, approver_id)
           values ($1, $2, 'Standard', 'สวมรอย', $3)`,
          [SUPER_ADMIN_ID, systemId, SUPERVISOR_ID],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lets the requester and the routed supervisor see the request, but hides it from an unrelated no-role user', async () => {
    const ownView = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.access_requests where id = $1', [requestId]),
    );
    expect(ownView.rows).toHaveLength(1);

    const supervisorView = await asUser(db, SUPERVISOR_ID, async () =>
      db.query('select id from public.access_requests where id = $1', [requestId]),
    );
    expect(supervisorView.rows).toHaveLength(1);

    const unrelatedView = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.access_requests where id = $1', [requestId]),
    );
    expect(unrelatedView.rows).toHaveLength(0);
  });

  it('lets the routed supervisor approve (update) the request purely via profiles.supervisor_id, not permission', async () => {
    const updated = await asUser(db, SUPERVISOR_ID, async () =>
      db.query(
        `update public.access_requests set status = 'รอส่วนงานไอทีดำเนินการ', approved = true, approved_by = $1 where id = $2 returning id`,
        [SUPERVISOR_ID, requestId],
      ),
    );
    expect(updated.rows).toHaveLength(1);
  });

  it('silently updates zero rows when an unrelated user targets a request they are not the approver of', async () => {
    const result = await asUser(db, AUDITOR_ID, async () =>
      db.query(`update public.access_requests set status = 'ปฏิเสธ' where id = $1 returning id`, [requestId]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it('rejects an invalid access_requests status value outside the fixed state machine', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`update public.access_requests set status = 'ไม่มีอยู่จริง' where id = $1`, [requestId])),
    ).rejects.toThrow();
  });

  it('rejects a plain user writing to user_access_registry without access_registry.manage', async () => {
    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.user_access_registry (user_id, system_id, access_level, source_request_id)
           values ($1, $2, 'Standard', $3) returning id`,
          [REGULAR_USER_ID, systemId, requestId],
        ),
      ),
    ).resolves.toBeDefined();

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(
          `insert into public.user_access_registry (user_id, system_id, access_level) values ($1, $2, 'Admin')`,
          [REGULAR_USER_ID, systemId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lets the registry owner read their own entry, hidden from an unrelated no-role user', async () => {
    const ownView = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.user_access_registry where user_id = $1', [REGULAR_USER_ID]),
    );
    expect(ownView.rows.length).toBeGreaterThanOrEqual(1);

    const unrelatedView = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.user_access_registry where user_id = $1', [REGULAR_USER_ID]),
    );
    expect(unrelatedView.rows).toHaveLength(0);
  });
});

describe('personal_tasks / task_subtasks / task_progress_logs / task_links RLS (Phase 6 Module 7)', () => {
  let taskId: string;
  let ownSubtaskId: string;

  it('lets the owner create and read their own task', async () => {
    const inserted = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(`insert into public.personal_tasks (owner_id, title) values ($1, 'ทดสอบงานส่วนตัว') returning id`, [REGULAR_USER_ID]),
    );
    taskId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const readBack = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.personal_tasks where id = $1', [taskId]),
    );
    expect(readBack.rows).toHaveLength(1);
  });

  it('rejects creating a task with someone else as owner_id (owner_id must be self)', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.personal_tasks (owner_id, title) values ($1, 'สวมรอย')`, [SUPER_ADMIN_ID]),
      ),
    ).rejects.toThrow();
  });

  // ต่างจากทุกโมดูลก่อนหน้า (Ticket/Service Request/Access Request) — โมดูลนี้ไม่มี staff-bypass ใดๆ
  // เลย ระบบเดิมระบุชัดว่า "ผู้ดูแลระบบก็ไม่เห็นงานของผู้ใช้อื่นผ่านโมดูลนี้" (ดู header comment ของ
  // 20260813100000_tasks.sql) จึงต้องยืนยันว่าแม้ super_admin (มี permission ทุกตัว) ก็ยังมองไม่เห็น
  it('hides the task from every other user, including super_admin (no staff-bypass — fully personal module)', async () => {
    const otherView = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.personal_tasks where id = $1', [taskId]));
    expect(otherView.rows).toHaveLength(0);

    const adminView = await asUser(db, SUPER_ADMIN_ID, async () => db.query('select id from public.personal_tasks where id = $1', [taskId]));
    expect(adminView.rows).toHaveLength(0);
  });

  it('silently updates zero rows when a different user (even super_admin) tries to edit the task', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`update public.personal_tasks set title = 'แก้ไขโดยคนอื่น' where id = $1 returning id`, [taskId]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it('rejects an invalid status value outside the fixed list', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`update public.personal_tasks set status = 'ไม่มีอยู่จริง' where id = $1`, [taskId])),
    ).rejects.toThrow();
  });

  it('lets the owner add a subtask under their own task', async () => {
    const inserted = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(`insert into public.task_subtasks (task_id, owner_id, title) values ($1, $2, 'รายการย่อย') returning id`, [
        taskId,
        REGULAR_USER_ID,
      ]),
    );
    ownSubtaskId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);
  });

  // RLS ของตารางลูกตรวจแค่ owner_id = auth.uid() ระดับแถวของตัวเอง ไม่ join ไปตรวจว่า task_id เป็นของ
  // owner คนเดียวกันจริง (ดู comment ใน migration) — Backend (routes/tasks.ts) เป็นผู้ตรวจ ownership
  // ของ taskId ก่อน insert เสมอ ทดสอบนี้ยืนยันพฤติกรรมของ RLS ตรงๆ ไม่ใช่ช่องโหว่ด้านข้อมูล เพราะแถวที่
  // ได้ยังคงมองเห็นได้เฉพาะเจ้าของแถว (auditor) เท่านั้น ไม่รั่วไปยังเจ้าของ task จริง
  it('permits owner_id=self on a foreign task_id at the RLS layer (backend enforces task ownership, not RLS)', async () => {
    const crossInsert = await asUser(db, AUDITOR_ID, async () =>
      db.query(`insert into public.task_subtasks (task_id, owner_id, title) values ($1, $2, 'แถวของ auditor') returning id`, [
        taskId,
        AUDITOR_ID,
      ]),
    );
    expect(crossInsert.rows).toHaveLength(1);

    const ownerView = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.task_subtasks where task_id = $1', [taskId]),
    );
    expect(ownerView.rows).toEqual([{ id: ownSubtaskId }]);
  });

  it("rejects a plain user writing to task_progress_logs / task_links under someone else's owner_id", async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.task_progress_logs (task_id, owner_id, progress, note) values ($1, $2, 50, 'ทดสอบ')`, [
          taskId,
          AUDITOR_ID,
        ]),
      ),
    ).rejects.toThrow();

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.task_links (task_id, owner_id, label, url) values ($1, $2, 'ลิงก์', 'https://example.test')`, [
          taskId,
          AUDITOR_ID,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('lets the owner delete their own subtask; a different owner deleting it affects zero rows', async () => {
    const otherAttempt = await asUser(db, AUDITOR_ID, async () =>
      db.query('delete from public.task_subtasks where id = $1 returning id', [ownSubtaskId]),
    );
    expect(otherAttempt.rows).toHaveLength(0);

    const ownAttempt = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('delete from public.task_subtasks where id = $1 returning id', [ownSubtaskId]),
    );
    expect(ownAttempt.rows).toHaveLength(1);
  });
});

describe('assets / asset_movements / maintenance_plans / pm_checklist_templates / inventory_items / inventory_transactions / software_licenses / employee_assignments RLS (Phase 6 Module 8)', () => {
  let assetId: string;
  let employeeId: string;
  let pmTemplateId: string;
  let inventoryItemId: string;

  it('lets a view-only role (auditor: asset.view) read assets but not insert one', async () => {
    const readAttempt = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.assets'));
    expect(readAttempt.rows).toEqual([]);

    await expect(
      asUser(db, AUDITOR_ID, async () =>
        db.query(`insert into public.assets (asset_code, name) values ('AST-AUDITOR', 'ทดสอบ')`),
      ),
    ).rejects.toThrow();
  });

  it('lets a full operational role (technician: asset.create) insert an asset', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.assets (asset_code, name) values ('AST-001', 'โน้ตบุ๊กทดสอบ') returning id`),
    );
    assetId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const auditorReadsAfterInsert = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.assets where id = $1', [assetId]));
    expect(auditorReadsAfterInsert.rows).toHaveLength(1);
  });

  it('rejects a plain user (no asset.* at all) from reading or writing assets', async () => {
    const readAttempt = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.assets where id = $1', [assetId]));
    expect(readAttempt.rows).toEqual([]);

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.assets (asset_code, name) values ('AST-REJECT', 'ห้ามเพิ่ม')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate asset_code', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`insert into public.assets (asset_code, name) values ('AST-001', 'รหัสซ้ำ')`)),
    ).rejects.toThrow();
  });

  it('lets asset.view-only auditor read but not update an asset (update needs update/transfer/dispose)', async () => {
    // RLS ไม่โยน error เมื่อไม่มี policy อนุญาต — เงียบๆ กระทบ 0 แถวแทน (เหมือน pattern เดียวกับที่
    // ทดสอบไว้แล้วใน personal_tasks RLS ด้านบน "silently updates zero rows...")
    const auditorAttempt = await asUser(db, AUDITOR_ID, async () =>
      db.query(`update public.assets set location = 'ที่ใหม่' where id = $1 returning id`, [assetId]),
    );
    expect(auditorAttempt.rows).toEqual([]);

    const updated = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`update public.assets set location = 'คลัง IT' where id = $1 returning id`, [assetId]),
    );
    expect(updated.rows).toHaveLength(1);
  });

  it('rejects an invalid status value outside the fixed list', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`update public.assets set status = 'ไม่มีอยู่จริง' where id = $1`, [assetId])),
    ).rejects.toThrow();
  });

  it('asset_movements: insert requires an asset.* write permission; select requires asset.view (append-only — no update policy)', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.asset_movements (asset_id, action_type, status_label) values ($1, 'Create', 'บันทึก') returning id`, [
        assetId,
      ]),
    );
    expect(inserted.rows).toHaveLength(1);

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.asset_movements (asset_id, action_type) values ($1, 'Create')`, [assetId]),
      ),
    ).rejects.toThrow();

    const regularUserRead = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.asset_movements where asset_id = $1', [assetId]));
    expect(regularUserRead.rows).toEqual([]);

    // ไม่มี update policy ให้ authenticated เลยแม้แต่คนที่ insert ได้ (asset_movements เป็น append-only
    // history ตามที่ระบุไว้ใน comment ของ migration) — RLS ไม่โยน error แต่กระทบ 0 แถวเงียบๆ (เหมือน
    // asset.view-only update ด้านบน) service_role ถูกยกเว้นไว้เพราะ bypassrls ตามค่าเริ่มต้นของ Supabase
    // จึงต้องทดสอบที่ระดับ authenticated เท่านั้น
    const updateAttempt = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`update public.asset_movements set notes = 'แก้ไข' where asset_id = $1 returning id`, [assetId]),
    );
    expect(updateAttempt.rows).toEqual([]);
  });

  it('pm_checklist_templates + maintenance_plans: maintenance.manage (technician) can write, maintenance.view-only (auditor) cannot', async () => {
    const template = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.pm_checklist_templates (name, items_json) values ('เช็กลิสต์ทดสอบ', '[{"text":"ตรวจสายไฟ"}]'::jsonb) returning id`),
    );
    pmTemplateId = (template.rows[0] as { id: string }).id;
    expect(template.rows).toHaveLength(1);

    await expect(
      asUser(db, AUDITOR_ID, async () =>
        db.query(`insert into public.pm_checklist_templates (name) values ('ห้ามเพิ่ม')`),
      ),
    ).rejects.toThrow();

    const plan = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.maintenance_plans (asset_id, plan_date, template_id) values ($1, current_date, $2) returning id`,
        [assetId, pmTemplateId],
      ),
    );
    expect(plan.rows).toHaveLength(1);

    const auditorRead = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.maintenance_plans where asset_id = $1', [assetId]));
    expect(auditorRead.rows).toHaveLength(1);

    await expect(
      asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.maintenance_plans')),
    ).resolves.toMatchObject({ rows: [] });
  });

  it('inventory_items: check constraints reject negative stock/min, RLS gates by inventory.view/manage', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`insert into public.inventory_items (item_name, unit, stock_qty) values ('ทดสอบติดลบ', 'ชิ้น', -1)`)),
    ).rejects.toThrow();

    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.inventory_items (item_name, unit, stock_qty, min_qty) values ('หมึกพิมพ์', 'กล่อง', 10, 3) returning id`),
    );
    inventoryItemId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    await expect(
      asUser(db, REGULAR_USER_ID, async () => db.query(`insert into public.inventory_items (item_name, unit) values ('ห้ามเพิ่ม', 'ชิ้น')`)),
    ).rejects.toThrow();
  });

  it('inventory_transactions: technician (inventory.manage) can log a transaction; append-only ledger', async () => {
    const tx = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.inventory_transactions (item_id, transaction_type, qty, balance_after) values ($1, 'OUT', 2, 8) returning id`,
        [inventoryItemId],
      ),
    );
    expect(tx.rows).toHaveLength(1);

    await expect(
      asServiceRole(db, async () => db.query(`insert into public.inventory_transactions (item_id, transaction_type, qty, balance_after) values ($1, 'MOVE', 1, 7)`, [inventoryItemId])),
    ).rejects.toThrow();
  });

  it('software_licenses: check constraint rejects used_qty > total_qty; license.manage gates writes', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.software_licenses (software_name, total_qty, used_qty) values ('เกินจำนวน', 5, 10)`),
      ),
    ).rejects.toThrow();

    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.software_licenses (software_name, total_qty, used_qty) values ('Adobe Acrobat Pro', 10, 4) returning id, license_code, expiry_notice_days`),
    );
    expect(inserted.rows).toHaveLength(1);
    expect((inserted.rows[0] as { license_code: string }).license_code).toMatch(/^LIC-/);
    expect((inserted.rows[0] as { expiry_notice_days: number }).expiry_notice_days).toBe(30);

    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.software_licenses (software_name, start_date, expire_date) values ('วันผิด', '2026-12-31', '2026-01-01')`),
      ),
    ).rejects.toThrow();
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.software_licenses (software_name, expiry_notice_days) values ('แจ้งเตือนผิด', 3651)`),
      ),
    ).rejects.toThrow();

    await expect(
      asUser(db, AUDITOR_ID, async () => db.query(`insert into public.software_licenses (software_name) values ('ห้ามเพิ่ม')`)),
    ).rejects.toThrow();
  });

  it('employee_assignments: select allowed via employee.manage OR asset.view, write requires employee.manage only', async () => {
    await asServiceRole(db, async () => {
      await db.query(`insert into public.employees (employee_code, first_name_th, last_name_th) values ('EMP-M8-001', 'ทดสอบ', 'โมดูลแปด') on conflict do nothing`);
    });
    const employee = await asServiceRole(db, async () => db.query(`select id from public.employees where employee_code = 'EMP-M8-001'`));
    employeeId = (employee.rows[0] as { id: string }).id;

    // technician มี asset.view โดยตรง (seed.sql) แต่ไม่มี employee.manage — insert ต้องถูกปฏิเสธ
    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query(`insert into public.employee_assignments (employee_id, item_name) values ($1, 'โน้ตบุ๊ก')`, [employeeId]),
      ),
    ).rejects.toThrow();

    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.employee_assignments (employee_id, item_name, category) values ($1, 'โน้ตบุ๊ก Dell', 'Notebook') returning id`, [
        employeeId,
      ]),
    );
    const assignmentId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    // technician ไม่มี employee.manage แต่มี asset.view จึง "อ่านได้" แม้เขียนไม่ได้ (ตามที่ RLS select
    // policy อนุญาตด้วย OR — ดู comment ใน migration 20260814100000_assets.sql)
    const technicianRead = await asUser(db, TECHNICIAN_ID, async () => db.query('select id from public.employee_assignments where id = $1', [assignmentId]));
    expect(technicianRead.rows).toHaveLength(1);

    const regularUserRead = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.employee_assignments where id = $1', [assignmentId]));
    expect(regularUserRead.rows).toEqual([]);
  });

  it('rejects an invalid employee_assignments status value outside the fixed list', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`update public.employee_assignments set status = 'ไม่มีอยู่จริง' where employee_id = $1`, [employeeId]),
      ),
    ).rejects.toThrow();
  });
});

describe('configuration_items / ci_relationships RLS (Phase 6 Module 9 CMDB)', () => {
  let ciAId: string;
  let ciBId: string;

  it('lets a view-only role (auditor: cmdb.view) read configuration_items but not insert one', async () => {
    const readAttempt = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.configuration_items'));
    expect(readAttempt.rows).toEqual([]);

    await expect(
      asUser(db, AUDITOR_ID, async () =>
        db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-AUDITOR', 'ทดสอบ', 'Server', 'Production')`),
      ),
    ).rejects.toThrow();
  });

  it('lets a full operational role (technician: cmdb.manage) insert a configuration_item', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-001', 'Web Server 1', 'Server', 'UAT') returning id`),
    );
    ciAId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const auditorReadsAfterInsert = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.configuration_items where id = $1', [ciAId]));
    expect(auditorReadsAfterInsert.rows).toHaveLength(1);
  });

  it('rejects a plain user (no cmdb.* at all) from reading or writing configuration_items', async () => {
    const readAttempt = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.configuration_items where id = $1', [ciAId]));
    expect(readAttempt.rows).toEqual([]);

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-REJECT', 'ห้ามเพิ่ม', 'Server', 'UAT')`),
      ),
    ).rejects.toThrow();
  });

  it('dpo (cmdb.view, added specifically for this module — not the general manager/executive/auditor convention) can read but not write', async () => {
    const dpoRead = await asUser(db, DPO_ID, async () => db.query('select id from public.configuration_items where id = $1', [ciAId]));
    expect(dpoRead.rows).toHaveLength(1);

    await expect(
      asUser(db, DPO_ID, async () =>
        db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-DPO', 'ห้ามเพิ่ม', 'Server', 'UAT')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate ci_code', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-001', 'รหัสซ้ำ', 'Server', 'UAT')`)),
    ).rejects.toThrow();
  });

  it('rejects a duplicate name within the same environment while not Retired, but allows it once Retired', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-002', 'Web Server 1', 'Server', 'UAT')`)),
    ).rejects.toThrow();

    await asServiceRole(db, async () => db.query(`update public.configuration_items set status = 'Retired' where id = $1`, [ciAId]));
    const inserted = await asServiceRole(db, async () =>
      db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-002', 'Web Server 1', 'Server', 'UAT') returning id`),
    );
    ciBId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);
    // หมายเหตุ: ciAId คงสถานะ Retired ต่อไปในเทสต์ถัดไปโดยตั้งใจ — ไม่ revert กลับเป็น Active เพราะจะชน
    // partial unique index ซ้ำ (ciBId ใช้ name/environment เดียวกันและไม่ Retired อยู่แล้ว) เทสต์ถัดไปที่ใช้
    // ciAId ต่อ (invalid-status update, relationship creation) ไม่ต้องพึ่งพาว่า ciAId เป็น Active อยู่
  });

  it('rejects an invalid ci_type value and an invalid status value outside their fixed lists', async () => {
    await expect(
      asServiceRole(db, async () => db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment) values ('CI-BADTYPE', 'ทดสอบ', 'ไม่มีอยู่จริง', 'UAT')`)),
    ).rejects.toThrow();
    await expect(
      asServiceRole(db, async () => db.query(`update public.configuration_items set status = 'ไม่มีอยู่จริง' where id = $1`, [ciAId])),
    ).rejects.toThrow();
  });

  it('rejects backup_required=true without a backup_reference (CHECK constraint)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment, backup_required) values ('CI-BACKUP', 'ทดสอบ', 'Server', 'UAT', true)`),
      ),
    ).rejects.toThrow();

    const ok = await asServiceRole(db, async () =>
      db.query(
        `insert into public.configuration_items (ci_code, name, ci_type, environment, backup_required, backup_reference) values ('CI-BACKUP-OK', 'ทดสอบ', 'Server', 'UAT', true, 'BKP-001') returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });

  it('rejects an Active/Production/High-or-Critical CI without RPO/RTO set (CHECK constraint)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.configuration_items (ci_code, name, ci_type, environment, criticality, status) values ('CI-RPO', 'ทดสอบ', 'Database', 'Production', 'Critical', 'Active')`,
        ),
      ),
    ).rejects.toThrow();

    const ok = await asServiceRole(db, async () =>
      db.query(
        `insert into public.configuration_items (ci_code, name, ci_type, environment, criticality, status, rpo_hours, rto_hours)
         values ('CI-RPO-OK', 'ทดสอบ', 'Database', 'Production', 'Critical', 'Active', 4, 8) returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });

  it('rejects linking the same asset_id to a second CI (partial unique index — DB-level upgrade over legacy app-only check)', async () => {
    const asset = await asServiceRole(db, async () => db.query(`insert into public.assets (asset_code, name) values ('AST-CMDB-001', 'ทดสอบผูก CI') returning id`));
    const assetId = (asset.rows[0] as { id: string }).id;

    const first = await asServiceRole(db, async () =>
      db.query(
        `insert into public.configuration_items (ci_code, name, ci_type, environment, asset_id) values ('CI-ASSET-1', 'ผูก Asset ตัวแรก', 'Server', 'UAT', $1) returning id`,
        [assetId],
      ),
    );
    expect(first.rows).toHaveLength(1);

    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.configuration_items (ci_code, name, ci_type, environment, asset_id) values ('CI-ASSET-2', 'ผูก Asset ซ้ำ', 'Server', 'UAT', $1)`, [assetId]),
      ),
    ).rejects.toThrow();
  });

  it('ci_relationships: technician (cmdb.manage) can create a relationship; auditor (cmdb.view-only) cannot', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type) values ('CI', $1, 'CI', $2, 'DEPENDS_ON') returning id`,
        [ciAId, ciBId],
      ),
    );
    expect(inserted.rows).toHaveLength(1);

    await expect(
      asUser(db, AUDITOR_ID, async () =>
        db.query(`insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type) values ('CI', $1, 'CI', $2, 'USES')`, [ciAId, ciBId]),
      ),
    ).rejects.toThrow();

    const auditorRead = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.ci_relationships where source_id = $1', [ciAId]));
    expect(auditorRead.rows).toHaveLength(1);

    const regularUserRead = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.ci_relationships where source_id = $1', [ciAId]));
    expect(regularUserRead.rows).toEqual([]);
  });

  it('rejects a self-link relationship (CHECK constraint)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type) values ('CI', $1, 'CI', $1, 'LINKED_TO')`, [ciAId]),
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate (source, target, relationship_type) triple (unique index)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type) values ('CI', $1, 'CI', $2, 'DEPENDS_ON')`, [ciAId, ciBId]),
      ),
    ).rejects.toThrow();
  });

  it('lets cmdb.view-only auditor read but not update a relationship (update needs cmdb.manage — silently 0 rows, same pattern as assets above)', async () => {
    const relRow = await asServiceRole(db, async () => db.query('select id from public.ci_relationships where source_id = $1 limit 1', [ciAId]));
    const relId = (relRow.rows[0] as { id: string }).id;

    const auditorAttempt = await asUser(db, AUDITOR_ID, async () =>
      db.query(`update public.ci_relationships set description = 'แก้ไข' where id = $1 returning id`, [relId]),
    );
    expect(auditorAttempt.rows).toEqual([]);

    const updated = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`update public.ci_relationships set description = 'แก้ไขโดย technician' where id = $1 returning id`, [relId]),
    );
    expect(updated.rows).toHaveLength(1);
  });
});

describe('incidents / regulatory_notifications RLS (Phase 6 Module 10 Incident)', () => {
  let personalIncidentId: string;
  let generalIncidentId: string;

  it('lets a regular user report Incident and limits visibility to their own rows', async () => {
    const personal = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(
        `insert into public.incidents
          (incident_number, title, reported_by, category, description, contains_personal_data, dpo_notify_deadline)
         values ('INC-RLS-001', 'ข้อมูลรั่วไหล', $1, 'ข้อมูลรั่วไหล', 'ทดสอบ PII', true, now() + interval '4 hours')
         returning id, risk_score`,
        [REGULAR_USER_ID],
      ),
    );
    personalIncidentId = (personal.rows[0] as { id: string }).id;
    expect((personal.rows[0] as { risk_score: number | null }).risk_score).toBeNull();

    const general = await asUser(db, REGULAR_USER_ID, async () =>
      db.query(
        `insert into public.incidents (incident_number, title, reported_by, category, description)
         values ('INC-RLS-002', 'ระบบล่ม', $1, 'ระบบล่ม/ใช้งานไม่ได้', 'ทดสอบทั่วไป') returning id`,
        [REGULAR_USER_ID],
      ),
    );
    generalIncidentId = (general.rows[0] as { id: string }).id;

    const ownRows = await asUser(db, REGULAR_USER_ID, async () => db.query(`select id from public.incidents where id in ($1, $2)`, [personalIncidentId, generalIncidentId]));
    expect(ownRows.rows).toHaveLength(2);

    const noRoleRows = await asUser(db, NO_ROLE_USER_ID, async () => db.query(`select id from public.incidents where id in ($1, $2)`, [personalIncidentId, generalIncidentId]));
    expect(noRoleRows.rows).toEqual([]);
  });

  it('lets DPO see PII incidents only, while auditor view_all sees both read-only', async () => {
    const dpoRows = await asUser(db, DPO_ID, async () => db.query(`select id from public.incidents where id in ($1, $2) order by id`, [personalIncidentId, generalIncidentId]));
    expect(dpoRows.rows).toHaveLength(1);
    expect((dpoRows.rows[0] as { id: string }).id).toBe(personalIncidentId);

    const auditorRows = await asUser(db, AUDITOR_ID, async () => db.query(`select id from public.incidents where id in ($1, $2)`, [personalIncidentId, generalIncidentId]));
    expect(auditorRows.rows).toHaveLength(2);
    const auditorUpdate = await asUser(db, AUDITOR_ID, async () => db.query(`update public.incidents set notes = 'ห้ามแก้' where id = $1 returning id`, [generalIncidentId]));
    expect(auditorUpdate.rows).toEqual([]);
  });

  it('computes risk_score from likelihood x impact and lets technician manage incidents', async () => {
    const updated = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`update public.incidents set likelihood = 4, impact = 5, severity = 'วิกฤต' where id = $1 returning risk_score`, [generalIncidentId]),
    );
    expect((updated.rows[0] as { risk_score: number }).risk_score).toBe(20);
  });

  it('keeps regulatory notification writes backend-only and enforces evidence constraints', async () => {
    await expect(
      asUser(db, DPO_ID, async () =>
        db.query(
          `insert into public.regulatory_notifications
            (incident_id, destination, agency, notification_type, required, status, reference_no, notified_at)
           values ($1, 'PDPC', 'สคส.', 'เหตุละเมิด', true, 'แจ้งแล้ว', 'PDPC-1', now())`,
          [personalIncidentId],
        ),
      ),
    ).rejects.toThrow();

    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.regulatory_notifications
            (incident_id, destination, agency, notification_type, required, status, notified_at)
           values ($1, 'PDPC', 'สคส.', 'เหตุละเมิด', true, 'แจ้งแล้ว', now())`,
          [personalIncidentId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('blocks closure until assessment, DPO acknowledgement and required external evidence are complete', async () => {
    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query(`update public.incidents set status = 'ปิดเคส', root_cause = 'สาเหตุ', resolution = 'แก้ไข', closed_at = now() where id = $1`, [personalIncidentId]),
      ),
    ).rejects.toThrow(/INCIDENT_REGULATORY_ASSESSMENT_INCOMPLETE/);

    await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `update public.incidents set
           regulatory_assessment_status = 'ประเมินแล้ว', breach_risk_level = 'สูง',
           pdpc_notify_required = 'Yes', data_subject_notify_required = 'No',
           ncsa_report_required = 'No', other_regulator_required = 'No',
           regulatory_assessment = 'ต้องแจ้ง สคส.'
         where id = $1`,
        [personalIncidentId],
      ),
    );

    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query(`update public.incidents set status = 'ปิดเคส', root_cause = 'สาเหตุ', resolution = 'แก้ไข', closed_at = now() where id = $1`, [personalIncidentId]),
      ),
    ).rejects.toThrow(/INCIDENT_DPO_NOT_NOTIFIED/);

    await asUser(db, TECHNICIAN_ID, async () => db.query(`update public.incidents set dpo_notified_at = now(), dpo_notified_by = $1 where id = $2`, [DPO_ID, personalIncidentId]));
    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query(`update public.incidents set status = 'ปิดเคส', root_cause = 'สาเหตุ', resolution = 'แก้ไข', closed_at = now() where id = $1`, [personalIncidentId]),
      ),
    ).rejects.toThrow(/INCIDENT_REGULATORY_EVIDENCE_MISSING:PDPC/);

    await asServiceRole(db, async () =>
      db.query(
        `insert into public.regulatory_notifications
          (incident_id, destination, agency, notification_type, required, status, reference_no, notified_at)
         values ($1, 'PDPC', 'สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล', 'แจ้งเหตุละเมิด', true, 'แจ้งแล้ว', 'PDPC-001', now())`,
        [personalIncidentId],
      ),
    );
    const closed = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(`update public.incidents set status = 'ปิดเคส', root_cause = 'สาเหตุ', resolution = 'แก้ไข', closed_at = now() where id = $1 returning id`, [personalIncidentId]),
    );
    expect(closed.rows).toHaveLength(1);
  });
});

describe('problems / known_errors RLS (Phase 6 Module 11 Problem)', () => {
  let problemId: string;
  let incidentId: string;
  let ticketId: string;

  beforeAll(async () => {
    await asServiceRole(db, async () => {
      const incident = await db.query(
        `insert into public.incidents
          (incident_number, title, reported_by, category, description)
         values ('INC-PRB-RLS', 'Incident สำหรับ Problem', $1, 'อื่นๆ', 'fixture') returning id`,
        [REGULAR_USER_ID],
      );
      incidentId = (incident.rows[0] as { id: string }).id;
      const ticket = await db.query(
        `insert into public.tickets (title, requester_id, description)
         values ('Ticket สำหรับ Problem', $1, 'fixture') returning id`,
        [REGULAR_USER_ID],
      );
      ticketId = (ticket.rows[0] as { id: string }).id;
    });
  });

  it('lets technician create and normalize Incident/Ticket links', async () => {
    const created = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.problems
          (problem_number, title, owner_id, priority, status, root_cause)
         values ('PRB-RLS-001', 'ปัญหาซ้ำ', $1, 'สูง', 'กำลังวิเคราะห์', 'กำลังค้นหา') returning id`,
        [TECHNICIAN_ID],
      ),
    );
    problemId = (created.rows[0] as { id: string }).id;
    await asUser(db, TECHNICIAN_ID, async () => {
      await db.query(`insert into public.problem_incidents (problem_id, incident_id, created_by) values ($1, $2, $3)`, [problemId, incidentId, TECHNICIAN_ID]);
      await db.query(`insert into public.problem_tickets (problem_id, ticket_id, created_by) values ($1, $2, $3)`, [problemId, ticketId, TECHNICIAN_ID]);
    });
    const links = await asUser(db, TECHNICIAN_ID, async () => db.query(`select (select count(*) from public.problem_incidents where problem_id = $1)::int as incidents, (select count(*) from public.problem_tickets where problem_id = $1)::int as tickets`, [problemId]));
    expect(links.rows[0]).toEqual({ incidents: 1, tickets: 1 });
  });

  it('allows view-only auditor to read but not update, and hides rows from regular user', async () => {
    const auditorRows = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.problems where id = $1', [problemId]));
    expect(auditorRows.rows).toHaveLength(1);
    const auditorUpdate = await asUser(db, AUDITOR_ID, async () => db.query(`update public.problems set notes = 'ห้ามแก้' where id = $1 returning id`, [problemId]));
    expect(auditorUpdate.rows).toEqual([]);
    const userRows = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.problems where id = $1', [problemId]));
    expect(userRows.rows).toEqual([]);
  });

  it('requires a valid Problem and non-empty workaround for Known Error', async () => {
    await expect(
      asUser(db, TECHNICIAN_ID, async () => db.query(`insert into public.known_errors (known_error_number, problem_id, title, workaround) values ('KEDB-BAD', $1, 'ไม่มี workaround', '')`, [problemId])),
    ).rejects.toThrow();
    const created = await asUser(db, TECHNICIAN_ID, async () => db.query(`insert into public.known_errors (known_error_number, problem_id, title, symptoms, workaround, status) values ('KEDB-RLS-001', $1, 'Memory leak', 'RAM สูง', 'Restart service', 'เผยแพร่') returning id`, [problemId]));
    expect(created.rows).toHaveLength(1);
    const read = await asUser(db, AUDITOR_ID, async () => db.query(`select workaround from public.known_errors where problem_id = $1`, [problemId]));
    expect(read.rows).toEqual([{ workaround: 'Restart service' }]);
  });

  it('keeps closed_at consistent with Problem status', async () => {
    await expect(
      asUser(db, TECHNICIAN_ID, async () => db.query(`update public.problems set status = 'ปิด' where id = $1`, [problemId])),
    ).rejects.toThrow();
    const closed = await asUser(db, TECHNICIAN_ID, async () => db.query(`update public.problems set status = 'ปิด', closed_at = now(), permanent_fix = 'แก้ถาวรแล้ว' where id = $1 returning closed_at`, [problemId]));
    expect(closed.rows).toHaveLength(1);
  });
});

describe('change_requests RLS and workflow (Phase 6 Module 12 Change)', () => {
  let changeId: string;

  it('lets a technician submit their own request and grants view-only access by role', async () => {
    const created = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.change_requests
          (change_number, title, system_affected, description, requester_id, risk_level, rollback_plan)
         values ('CHG-RLS-001', 'Deploy SSO', 'Customer Portal', 'เปิดใช้งาน SSO รุ่นใหม่', $1, 'กลาง', 'ย้อนกลับ image เดิม')
         returning id`,
        [TECHNICIAN_ID],
      ),
    );
    changeId = (created.rows[0] as { id: string }).id;

    const auditorRead = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.change_requests where id = $1', [changeId]));
    expect(auditorRead.rows).toHaveLength(1);
    const userRead = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.change_requests where id = $1', [changeId]));
    expect(userRead.rows).toEqual([]);
    const auditorUpdate = await asUser(db, AUDITOR_ID, async () => db.query(`update public.change_requests set notes = 'ห้ามแก้' where id = $1 returning id`, [changeId]));
    expect(auditorUpdate.rows).toEqual([]);
  });

  it('prevents submitting on behalf of another user and keeps workflow updates backend-only', async () => {
    await expect(
      asUser(db, TECHNICIAN_ID, async () => db.query(
        `insert into public.change_requests (change_number, title, system_affected, description, requester_id)
         values ('CHG-RLS-BAD', 'สวมรอย', 'ระบบ', 'รายละเอียด', $1)`,
        [SECOND_TECHNICIAN_ID],
      )),
    ).rejects.toThrow();
    const directUpdate = await asUser(db, SECOND_TECHNICIAN_ID, async () => db.query(`update public.change_requests set test_result = 'ผ่าน' where id = $1 returning id`, [changeId]));
    expect(directUpdate.rows).toEqual([]);
  });

  it('enforces independent test, approval and deployment at database level', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `update public.change_requests set test_result = 'self test', test_passed = true, test_signoff_by = $1, test_signoff_at = now(), status = 'ผ่านการทดสอบ' where id = $2`,
      [TECHNICIAN_ID, changeId],
    ))).rejects.toThrow(/CHANGE_REQUESTER_CANNOT_TEST/);

    const tested = await asServiceRole(db, async () => db.query(
      `update public.change_requests set test_result = 'ผ่าน regression test', test_passed = true, test_signoff_by = $1, test_signoff_at = now(), status = 'ผ่านการทดสอบ' where id = $2 returning status`,
      [SECOND_TECHNICIAN_ID, changeId],
    ));
    expect(tested.rows).toEqual([{ status: 'ผ่านการทดสอบ' }]);

    await expect(asServiceRole(db, async () => db.query(
      `update public.change_requests set approver_id = $1, approve_date = now(), approve_result = 'อนุมัติ', status = 'อนุมัติแล้ว' where id = $2`,
      [SECOND_TECHNICIAN_ID, changeId],
    ))).rejects.toThrow(/CHANGE_TESTER_CANNOT_APPROVE/);

    const approved = await asServiceRole(db, async () => db.query(
      `update public.change_requests set approver_id = $1, approve_date = now(), approve_result = 'อนุมัติ', status = 'อนุมัติแล้ว' where id = $2 returning status`,
      [CHANGE_APPROVER_ID, changeId],
    ));
    expect(approved.rows).toEqual([{ status: 'อนุมัติแล้ว' }]);

    await expect(asServiceRole(db, async () => db.query(
      `update public.change_requests set deploy_by = $1, deploy_date = now(), version = '2026.08.1', status = 'ติดตั้งใช้งานแล้ว' where id = $2`,
      [CHANGE_APPROVER_ID, changeId],
    ))).rejects.toThrow(/CHANGE_APPROVER_CANNOT_DEPLOY/);

    const deployed = await asServiceRole(db, async () => db.query(
      `update public.change_requests set deploy_by = $1, deploy_date = now(), version = '2026.08.1', status = 'ติดตั้งใช้งานแล้ว' where id = $2 returning status, version`,
      [SECOND_TECHNICIAN_ID, changeId],
    ));
    expect(deployed.rows).toEqual([{ status: 'ติดตั้งใช้งานแล้ว', version: '2026.08.1' }]);
  });

  it('requires a reason when rejecting and supports Change CMDB relationships', async () => {
    const second = await asUser(db, CHANGE_APPROVER_ID, async () => db.query(
      `insert into public.change_requests (change_number, title, system_affected, description, requester_id)
       values ('CHG-RLS-002', 'Change อ้างอิง', 'Portal', 'fixture', $1) returning id`,
      [CHANGE_APPROVER_ID],
    ));
    const secondId = (second.rows[0] as { id: string }).id;
    await expect(asServiceRole(db, async () => db.query(
      `update public.change_requests set test_result = 'ผ่าน', test_passed = true, test_signoff_by = $1, test_signoff_at = now(), status = 'ผ่านการทดสอบ' where id = $2`,
      [SECOND_TECHNICIAN_ID, secondId],
    ))).resolves.toBeDefined();
    await expect(asServiceRole(db, async () => db.query(
      `update public.change_requests set approver_id = $1, approve_date = now(), approve_result = 'ปฏิเสธ', status = 'ปฏิเสธ' where id = $2`,
      [TECHNICIAN_ID, secondId],
    ))).rejects.toThrow();
    const rejected = await asServiceRole(db, async () => db.query(
      `update public.change_requests set approver_id = $1, approve_date = now(), approve_result = 'ปฏิเสธ', approval_comment = 'ผลกระทบสูงเกินไป', status = 'ปฏิเสธ' where id = $2 returning status`,
      [TECHNICIAN_ID, secondId],
    ));
    expect(rejected.rows).toEqual([{ status: 'ปฏิเสธ' }]);

    const relationship = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type)
       values ('Change', $1, 'Change', $2, 'CHANGED_BY') returning id`,
      [changeId, secondId],
    ));
    expect(relationship.rows).toHaveLength(1);
  });
});

describe('vendors / contracts RLS and normalization (Phase 6 Module 13)', () => {
  let vendorId: string;
  let contractId: string;

  it('lets a technician manage vendors and contracts with normalized ownership', async () => {
    const vendor = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.vendors (vendor_code, name, service_type, owner_id)
       values ('VND-RLS-001', 'ผู้ให้บริการทดสอบ RLS', 'ผู้ให้บริการ MA', $1) returning id`,
      [TECHNICIAN_ID],
    ));
    vendorId = (vendor.rows[0] as { id: string }).id;

    const contract = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.contracts (contract_number, name, vendor_id, contract_type, start_date, end_date, status)
       values ('CT-RLS-001', 'สัญญาทดสอบ RLS', $1, 'Maintenance', '2026-01-01', '2026-12-31', 'Active') returning id`,
      [vendorId],
    ));
    contractId = (contract.rows[0] as { id: string }).id;
    expect(contract.rows).toHaveLength(1);
  });

  it('lets an auditor read but not modify vendor/contract records', async () => {
    const vendors = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.vendors where id = $1', [vendorId]));
    const contracts = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.contracts where id = $1', [contractId]));
    expect(vendors.rows).toHaveLength(1);
    expect(contracts.rows).toHaveLength(1);

    const updated = await asUser(db, AUDITOR_ID, async () => db.query(`update public.vendors set name = 'แก้ไขไม่ได้' where id = $1 returning id`, [vendorId]));
    expect(updated.rows).toHaveLength(0);
  });

  it('hides the registers from a plain user and rejects direct writes', async () => {
    const hidden = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.vendors where id = $1', [vendorId]));
    expect(hidden.rows).toHaveLength(0);
    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      `insert into public.vendors (vendor_code, name) values ('VND-DENIED', 'ต้องถูกปฏิเสธ')`,
    ))).rejects.toThrow();
  });

  it('enforces contract date/number constraints and supports normalized Asset/CMDB links', async () => {
    await expect(asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.contracts (contract_number, name, vendor_id, start_date, end_date)
       values ('CT-RLS-BAD', 'ช่วงวันที่ผิด', $1, '2026-12-31', '2026-01-01')`,
      [vendorId],
    ))).rejects.toThrow();

    const asset = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.assets (asset_code, name, vendor_id, contract_id)
       values ('AST-VND-RLS', 'Asset ที่ผูกสัญญา', $1, $2) returning vendor_id, contract_id`,
      [vendorId, contractId],
    ));
    expect(asset.rows).toEqual([{ vendor_id: vendorId, contract_id: contractId }]);

    const relationship = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.ci_relationships (source_type, source_id, target_type, target_id, relationship_type)
       values ('Vendor', $1, 'Contract', $2, 'COVERED_BY_CONTRACT') returning id`,
      [vendorId, contractId],
    ));
    expect(relationship.rows).toHaveLength(1);
  });
});

describe('vulnerability_findings RLS and verification controls (Phase 6 Module 15)', () => {
  let findingId: string;

  it('lets a technician create and manage a normalized finding', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.vulnerability_findings
       (vulnerability_code, title, cve, cvss, severity, detected_at, due_date, owner_id, remediation_plan, status)
       values ('VUL-RLS-001', 'ช่องโหว่ทดสอบ RLS', 'CVE-2026-12345', 9.8, 'วิกฤต', '2026-08-01', '2026-08-10', $1, 'ติดตั้งแพตช์ผู้ผลิต', 'กำลังแก้ไข')
       returning id, vulnerability_code`,
      [TECHNICIAN_ID],
    ));
    findingId = (inserted.rows[0] as { id: string }).id;
    expect(inserted.rows).toHaveLength(1);

    const updated = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `update public.vulnerability_findings set status = 'รอตรวจยืนยัน', remediated_at = now() where id = $1 returning status`,
      [findingId],
    ));
    expect(updated.rows).toEqual([{ status: 'รอตรวจยืนยัน' }]);
  });

  it('lets auditor and DPO read but not modify findings', async () => {
    const auditorRows = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.vulnerability_findings where id = $1', [findingId]));
    const dpoRows = await asUser(db, DPO_ID, async () => db.query('select id from public.vulnerability_findings where id = $1', [findingId]));
    expect(auditorRows.rows).toHaveLength(1);
    expect(dpoRows.rows).toHaveLength(1);

    const updated = await asUser(db, AUDITOR_ID, async () => db.query(
      `update public.vulnerability_findings set title = 'แก้ไม่ได้' where id = $1 returning id`,
      [findingId],
    ));
    expect(updated.rows).toHaveLength(0);
  });

  it('hides findings from a plain user and denies writes', async () => {
    const hidden = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.vulnerability_findings where id = $1', [findingId]));
    expect(hidden.rows).toHaveLength(0);
    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      `insert into public.vulnerability_findings (vulnerability_code, title, owner_id) values ('VUL-DENIED', 'ต้องถูกปฏิเสธ', $1)`,
      [REGULAR_USER_ID],
    ))).rejects.toThrow();
  });

  it('enforces CVSS, date, HTTPS and completed-verification invariants', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.vulnerability_findings (vulnerability_code, title, cvss, owner_id) values ('VUL-BAD-CVSS', 'CVSS ผิด', 10.1, $1)`,
      [TECHNICIAN_ID],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.vulnerability_findings (vulnerability_code, title, detected_at, due_date, owner_id) values ('VUL-BAD-DATE', 'วันที่ผิด', '2026-08-10', '2026-08-01', $1)`,
      [TECHNICIAN_ID],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `update public.vulnerability_findings set evidence_link = 'http://unsafe.example.test' where id = $1`,
      [findingId],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `update public.vulnerability_findings set status = 'ปิด' where id = $1`,
      [findingId],
    ))).rejects.toThrow();
  });

  it('prevents owner self-verification and permits an independent verifier', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `update public.vulnerability_findings
       set status = 'ปิด', verified_at = now(), verified_by = $1, evidence_link = 'https://evidence.example.test/self'
       where id = $2`,
      [TECHNICIAN_ID, findingId],
    ))).rejects.toThrow();

    const closed = await asServiceRole(db, async () => db.query(
      `update public.vulnerability_findings
       set status = 'ปิด', verified_at = now(), verified_by = $1, evidence_link = 'https://evidence.example.test/independent'
       where id = $2 returning status, verified_by`,
      [SECOND_TECHNICIAN_ID, findingId],
    ));
    expect(closed.rows).toEqual([{ status: 'ปิด', verified_by: SECOND_TECHNICIAN_ID }]);
  });
});

describe('backup, recovery and monitoring RLS (Phase 6 Module 16)', () => {
  let backupId: string;
  let recoveryId: string;
  let bcpId: string;
  let logSystemId: string;
  let logReviewId: string;

  it('lets a technician manage all five normalized registers', async () => {
    const backup = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.backup_logs
       (backup_code, system_name, backup_type, backup_date, result, operator_id, next_backup_due, evidence_link)
       values ('BKP-RLS-001', 'Core ERP', 'Full', '2026-08-10', 'สำเร็จ', $1, '2026-08-11', 'https://evidence.example.test/backup') returning id`,
      [TECHNICIAN_ID],
    ));
    backupId = (backup.rows[0] as { id: string }).id;

    const recovery = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.recovery_tests
       (recovery_code, backup_log_id, system_name, test_date, result, tester_id, next_test_due)
       values ('RCV-RLS-001', $1, 'Core ERP', '2026-08-12', 'ผ่าน', $2, '2026-09-12') returning id`,
      [backupId, TECHNICIAN_ID],
    ));
    recoveryId = (recovery.rows[0] as { id: string }).id;

    const bcp = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.bcp_plans
       (plan_code, plan_name, owner_id, last_review_date, next_review_due, document_link)
       values ('BCP-RLS-001', 'Core ERP DR Plan', $1, '2026-08-10', '2027-08-10', 'https://evidence.example.test/bcp') returning id`,
      [TECHNICIAN_ID],
    ));
    bcpId = (bcp.rows[0] as { id: string }).id;

    const logSystem = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.logging_systems
       (log_system_code, system_name, review_frequency, responsible_id, next_review_due)
       values ('LOGSYS-RLS-001', 'Core ERP SIEM', 'รายวัน', $1, '2026-08-11') returning id`,
      [TECHNICIAN_ID],
    ));
    logSystemId = (logSystem.rows[0] as { id: string }).id;

    const review = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.log_reviews
       (review_code, logging_system_id, review_date, reviewer_id, period, anomaly_found, anomaly_detail, status)
       values ('LGR-RLS-001', $1, '2026-08-10', $2, '10 Aug 2026', true, 'Failed login spike', 'กำลังดำเนินการ') returning id`,
      [logSystemId, TECHNICIAN_ID],
    ));
    logReviewId = (review.rows[0] as { id: string }).id;
    expect([backupId, recoveryId, bcpId, logSystemId, logReviewId].every(Boolean)).toBe(true);
  });

  it('lets an auditor read every register but not modify it', async () => {
    for (const [table, id] of [
      ['backup_logs', backupId], ['recovery_tests', recoveryId], ['bcp_plans', bcpId],
      ['logging_systems', logSystemId], ['log_reviews', logReviewId],
    ]) {
      const read = await asUser(db, AUDITOR_ID, async () => db.query(`select id from public.${table} where id = $1`, [id]));
      expect(read.rows).toHaveLength(1);
      const update = await asUser(db, AUDITOR_ID, async () => db.query(`update public.${table} set notes = 'แก้ไม่ได้' where id = $1 returning id`, [id]));
      expect(update.rows).toHaveLength(0);
    }
  });

  it('hides every register from a plain user and rejects writes', async () => {
    for (const [table, id] of [['backup_logs', backupId], ['recovery_tests', recoveryId], ['bcp_plans', bcpId], ['logging_systems', logSystemId], ['log_reviews', logReviewId]]) {
      const read = await asUser(db, REGULAR_USER_ID, async () => db.query(`select id from public.${table} where id = $1`, [id]));
      expect(read.rows).toHaveLength(0);
    }
    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      `insert into public.backup_logs (backup_code, system_name, backup_type, backup_date, result, operator_id)
       values ('BKP-DENIED', 'Denied', 'Full', '2026-08-10', 'สำเร็จ', $1)`, [REGULAR_USER_ID],
    ))).rejects.toThrow();
  });

  it('enforces date, HTTPS and anomaly invariants', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.backup_logs (backup_code, system_name, backup_type, backup_date, result, operator_id, next_backup_due)
       values ('BKP-BAD-DATE', 'Bad', 'Full', '2026-08-10', 'สำเร็จ', $1, '2026-08-09')`, [TECHNICIAN_ID],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `update public.recovery_tests set evidence_link = 'http://unsafe.example.test' where id = $1`, [recoveryId],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.log_reviews
       (review_code, logging_system_id, review_date, reviewer_id, period, anomaly_found, status)
       values ('LGR-BAD', $1, '2026-08-10', $2, 'bad', true, 'กำลังดำเนินการ')`, [logSystemId, TECHNICIAN_ID],
    ))).rejects.toThrow();
  });

  it('keeps referenced operational records and cascades log reviews with their logging system', async () => {
    await asServiceRole(db, async () => db.query('delete from public.logging_systems where id = $1', [logSystemId]));
    const review = await asServiceRole(db, async () => db.query('select id from public.log_reviews where id = $1', [logReviewId]));
    expect(review.rows).toHaveLength(0);
    const recovery = await asServiceRole(db, async () => db.query('select id from public.recovery_tests where id = $1', [recoveryId]));
    expect(recovery.rows).toHaveLength(1);
  });
});

describe('workflow approval engine RLS and invariants (Phase 6 Module 17)', () => {
  let definitionId: string;
  let stepId: string;
  let instanceId: string;
  let approvalId: string;

  it('creates a versioned definition and workflow transaction as service role', async () => {
    await asServiceRole(db, async () => {
      const definition = await db.query(
        `insert into public.workflow_definitions
         (workflow_code, workflow_name, module_key, version, sla_hours, status)
         values ('RLS_APPROVAL', 'อนุมัติสำหรับทดสอบ RLS', 'change', 1, 48, 'ใช้งาน') returning id`,
      );
      definitionId = (definition.rows[0] as { id: string }).id;
      const step = await db.query(
        `insert into public.workflow_steps
         (definition_id, definition_version, step_order, step_code, step_name, approval_type, approver_value, mode, min_approvals, sla_hours)
         values ($1, 1, 1, 'APPROVER', 'ผู้อนุมัติ', 'USER', $2, 'ANY', 1, 24) returning id`,
        [definitionId, CHANGE_APPROVER_ID],
      );
      stepId = (step.rows[0] as { id: string }).id;
      const instance = await db.query(
        `insert into public.workflow_instances
         (instance_code, definition_id, definition_version, module_key, record_id, record_label, requester_id, current_step_order)
         values ('WF-RLS-001', $1, 1, 'change', 'CHG-RLS-001', 'ทดสอบ Workflow', $2, 1) returning id`,
        [definitionId, REGULAR_USER_ID],
      );
      instanceId = (instance.rows[0] as { id: string }).id;
      const approval = await db.query(
        `insert into public.workflow_approvals
         (instance_id, step_id, step_order, approver_id, original_approver_id, due_at)
         values ($1, $2, 1, $3, $3, now() + interval '24 hours') returning id`,
        [instanceId, stepId, CHANGE_APPROVER_ID],
      );
      approvalId = (approval.rows[0] as { id: string }).id;
      await db.query(
        `insert into public.workflow_history (instance_id, action, actor_id, status_to)
         values ($1, 'START', $2, 'กำลังดำเนินการ')`,
        [instanceId, REGULAR_USER_ID],
      );
    });
    expect([definitionId, stepId, instanceId, approvalId].every(Boolean)).toBe(true);
  });

  it('lets the requester and assigned approver see the same instance and timeline', async () => {
    for (const userId of [REGULAR_USER_ID, CHANGE_APPROVER_ID]) {
      const instance = await asUser(db, userId, async () => db.query('select id from public.workflow_instances where id = $1', [instanceId]));
      const approval = await asUser(db, userId, async () => db.query('select id from public.workflow_approvals where id = $1', [approvalId]));
      const timeline = await asUser(db, userId, async () => db.query('select id from public.workflow_history where instance_id = $1', [instanceId]));
      expect(instance.rows).toHaveLength(1);
      expect(approval.rows).toHaveLength(1);
      expect(timeline.rows).toHaveLength(1);
    }
  });

  it('lets only the assigned actor update a pending decision directly', async () => {
    const denied = await asUser(db, REGULAR_USER_ID, async () => db.query(
      `update public.workflow_approvals set comment = 'สวมสิทธิ์' where id = $1 returning id`, [approvalId],
    ));
    expect(denied.rows).toHaveLength(0);

    const decided = await asUser(db, CHANGE_APPROVER_ID, async () => db.query(
      `update public.workflow_approvals
       set status = 'อนุมัติ', decision = 'APPROVE', decided_at = now(), decision_by = $1
       where id = $2 returning status`, [CHANGE_APPROVER_ID, approvalId],
    ));
    expect(decided.rows).toEqual([{ status: 'อนุมัติ' }]);
  });

  it('lets an auditor view all instances but keeps the register read-only', async () => {
    const read = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.workflow_instances where id = $1', [instanceId]));
    expect(read.rows).toHaveLength(1);
    const update = await asUser(db, AUDITOR_ID, async () => db.query(
      `update public.workflow_instances set notes = 'แก้ไม่ได้' where id = $1 returning id`, [instanceId],
    ));
    expect(update.rows).toHaveLength(0);
  });

  it('hides workflow records from an authenticated user without workflow.view', async () => {
    const instance = await asUser(db, NO_ROLE_USER_ID, async () => db.query('select id from public.workflow_instances where id = $1', [instanceId]));
    const definition = await asUser(db, NO_ROLE_USER_ID, async () => db.query('select id from public.workflow_definitions where id = $1', [definitionId]));
    expect(instance.rows).toHaveLength(0);
    expect(definition.rows).toHaveLength(0);
  });

  it('enforces immutable generation uniqueness and delegation safety', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.workflow_steps
       (definition_id, definition_version, step_order, step_code, step_name, approval_type, approver_value)
       values ($1, 1, 1, 'DUPLICATE', 'ซ้ำ', 'USER', $2)`, [definitionId, CHANGE_APPROVER_ID],
    ))).rejects.toThrow();
    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      `insert into public.workflow_delegations
       (delegator_id, delegate_id, start_at, end_at, reason)
       values ($1, $1, now(), now() + interval '1 day', 'มอบให้ตนเอง')`, [REGULAR_USER_ID],
    ))).rejects.toThrow();
  });
});

describe('knowledge base RLS, counters and lifecycle (Phase 6 Module 18)', () => {
  let categoryId: string;
  let publishedId: string;
  let draftId: string;

  it('creates governed published and draft articles as service role', async () => {
    await asServiceRole(db, async () => {
      const category = await db.query(
        `insert into public.ticket_categories (name)
         values ('ฐานความรู้ RLS')
         on conflict (name) do update set status = 'active'
         returning id`,
      );
      categoryId = (category.rows[0] as { id: string }).id;

      const published = await db.query(
        `insert into public.knowledge_articles
         (article_code, title, category_id, symptom, solution, tags, status, author_id, published_at)
         values ('KB-20260810-1001', 'เชื่อมต่อ Wi-Fi ไม่ได้', $1, 'ไม่พบเครือข่ายสำนักงาน',
                 'ปิดและเปิด Wi-Fi แล้วเลือกเครือข่ายใหม่', array['wifi', 'network'],
                 'เผยแพร่', $2, now()) returning id`,
        [categoryId, TECHNICIAN_ID],
      );
      publishedId = (published.rows[0] as { id: string }).id;

      const draft = await db.query(
        `insert into public.knowledge_articles
         (article_code, title, category_id, solution, status, author_id)
         values ('KB-20260810-1002', 'คู่มือฉบับร่าง', $1, 'อยู่ระหว่างการตรวจทาน', 'ร่าง', $2)
         returning id`,
        [categoryId, TECHNICIAN_ID],
      );
      draftId = (draft.rows[0] as { id: string }).id;
    });
    expect([categoryId, publishedId, draftId].every(Boolean)).toBe(true);
  });

  it('shows only published articles to readers and all articles to managers', async () => {
    const reader = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.knowledge_articles where id in ($1, $2) order by id', [publishedId, draftId]),
    );
    expect(reader.rows).toHaveLength(1);
    expect((reader.rows[0] as { id: string }).id).toBe(publishedId);

    const manager = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query('select id from public.knowledge_articles where id in ($1, $2)', [publishedId, draftId]),
    );
    expect(manager.rows).toHaveLength(2);

    const noRole = await asUser(db, NO_ROLE_USER_ID, async () =>
      db.query('select id from public.knowledge_articles where id = $1', [publishedId]),
    );
    expect(noRole.rows).toHaveLength(0);
  });

  it('allows technicians to manage articles but keeps readers and auditors read-only', async () => {
    const technicianUpdate = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `update public.knowledge_articles set title = 'คู่มือฉบับร่างที่ช่างแก้ไข' where id = $1 returning id`,
      [draftId],
    ));
    expect(technicianUpdate.rows).toEqual([{ id: draftId }]);

    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      `insert into public.knowledge_articles
       (article_code, title, solution, status, author_id)
       values ('KB-20260810-1999', 'บทความที่ไม่ได้รับอนุญาต', 'ห้ามสร้าง', 'ร่าง', $1)`,
      [REGULAR_USER_ID],
    ))).rejects.toThrow();

    const auditorUpdate = await asUser(db, AUDITOR_ID, async () => db.query(
      `update public.knowledge_articles set title = 'แก้ไขไม่ได้' where id = $1 returning id`,
      [publishedId],
    ));
    expect(auditorUpdate.rows).toHaveLength(0);
  });

  it('counts one helpful vote per permitted user and rejects read-only auditors', async () => {
    const first = await asUser(db, REGULAR_USER_ID, async () => db.query(
      'select * from public.mark_knowledge_article_helpful($1)', [publishedId],
    ));
    const duplicate = await asUser(db, REGULAR_USER_ID, async () => db.query(
      'select * from public.mark_knowledge_article_helpful($1)', [publishedId],
    ));
    expect(first.rows).toEqual([{ helpful_count: 1, already_voted: false }]);
    expect(duplicate.rows).toEqual([{ helpful_count: 1, already_voted: true }]);

    await expect(asUser(db, AUDITOR_ID, async () => db.query(
      'select * from public.mark_knowledge_article_helpful($1)', [publishedId],
    ))).rejects.toThrow(/knowledge.feedback permission required/);
  });

  it('deduplicates authenticated and anonymous views independently each day', async () => {
    await asUser(db, REGULAR_USER_ID, async () => {
      await db.query('select public.record_knowledge_article_view($1, null)', [publishedId]);
      await db.query('select public.record_knowledge_article_view($1, null)', [publishedId]);
    });
    const visitorHash = 'a'.repeat(64);
    await asAnon(db, async () => {
      await db.query('select public.record_knowledge_article_view($1, $2)', [publishedId, visitorHash]);
      await db.query('select public.record_knowledge_article_view($1, $2)', [publishedId, visitorHash]);
    });

    const counter = await asServiceRole(db, async () => db.query(
      'select views_count from public.knowledge_articles where id = $1', [publishedId],
    ));
    expect(counter.rows).toEqual([{ views_count: 2 }]);
  });

  it('does not expose article rows directly to anonymous visitors', async () => {
    const direct = await asAnon(db, async () =>
      db.query('select id from public.knowledge_articles where id = $1', [publishedId]),
    );
    expect(direct.rows).toHaveLength(0);
  });

  it('enforces publish consistency, tag limits and published-only metrics', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.knowledge_articles
       (article_code, title, solution, status, author_id)
       values ('KB-20260810-2001', 'เผยแพร่ไม่สมบูรณ์', 'ไม่มีวันเผยแพร่', 'เผยแพร่', $1)`,
      [TECHNICIAN_ID],
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.knowledge_articles
       (article_code, title, solution, tags, status, author_id)
       values ('KB-20260810-2002', 'แท็กเกินจำนวน', 'ต้องถูกปฏิเสธ', $1, 'ร่าง', $2)`,
      [Array.from({ length: 21 }, (_, index) => `tag-${index}`), TECHNICIAN_ID],
    ))).rejects.toThrow();
    await expect(asUser(db, REGULAR_USER_ID, async () => db.query(
      'select public.record_knowledge_article_view($1, null)', [draftId],
    ))).rejects.toThrow(/published knowledge article not found/);
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
