import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');
const seedPath = join(__dirname, '..', 'seed.sql');
const authStubPath = join(__dirname, 'fixtures', 'auth-stub.sql');

/**
 * สร้างฐานข้อมูลทดสอบด้วย pglite (Postgres จริงที่คอมไพล์เป็น WASM รันในเครื่อง ไม่ต้องใช้ Docker)
 * แล้วรัน migration + seed ชุดเดียวกับที่จะ apply กับ Supabase โปรเจกต์จริงทุกไฟล์
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();

  // เฉพาะการทดสอบ: จำลอง auth schema/role ของ Supabase (ไม่ใช่ส่วนหนึ่งของ migration จริง)
  await db.exec(readFileSync(authStubPath, 'utf-8'));

  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf-8'));
  }

  await db.exec(readFileSync(seedPath, 'utf-8'));

  // Supabase โปรเจกต์จริงให้สิทธิ์ระดับตารางนี้กับ anon/authenticated โดยอัตโนมัติอยู่แล้ว
  // (Row Level Security เป็นตัวกรองซ้อนอยู่บนสิทธิ์นี้อีกชั้นหนึ่ง)
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
    grant all on all tables in schema public to service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
  `);

  return db;
}

async function setCurrentUser(db: PGlite, userId: string | null): Promise<void> {
  await db.query('select set_config($1, $2, false)', ['app.current_user_id', userId ?? '']);
}

/** รัน callback ในฐานะผู้ใช้ authenticated ที่ auth.uid() = userId (จำลอง JWT ของผู้ใช้จริง) */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated;');
  await setCurrentUser(db, userId);
  try {
    return await fn();
  } finally {
    await setCurrentUser(db, null);
    await db.exec('reset role;');
  }
}

/** รัน callback ในฐานะผู้เยี่ยมชมที่ไม่ได้ login (เหมือน Supabase anon key) */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role anon;');
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

/** รัน callback ในฐานะ Cloudflare Workers backend ที่ใช้ Service Role Key (bypass RLS) */
export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role;');
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}
