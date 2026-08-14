import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

/**
 * ดาวน์โหลดไฟล์ทั้งหมดจาก Supabase Storage ลงโฟลเดอร์เดียว เพื่อนำไปเก็บเป็นสำเนาสำรอง
 *
 * pg_dump สำรองได้แต่ "แถวในฐานข้อมูล" — ไฟล์ที่ผู้ใช้อัปโหลด (เอกสารแนบใน Ticket, โลโก้หน่วยงาน)
 * ไม่ได้อยู่ใน Postgres แต่อยู่ใน Object Storage คนละที่กัน การสำรองเฉพาะฐานข้อมูลจึงได้ระบบที่
 * "มีรายการไฟล์แนบครบ แต่กดเปิดแล้วไม่มีไฟล์" ซึ่งแย่กว่าไม่มีสำเนาเลยเพราะดูเหมือนกู้คืนสำเร็จ
 *
 * สคริปต์นี้จึงเป็นคู่ของ pg_dump ใน .github/workflows/backup.yml และเขียน manifest พร้อม
 * SHA-256 ของทุกไฟล์ไว้ด้วย เพื่อให้ตอนกู้คืนพิสูจน์ได้ว่าไฟล์ที่ได้กลับมาเหมือนต้นฉบับจริง
 *
 * ล้มเหลวแล้วต้องดังเสมอ — สำเนาที่ขาดไปบางไฟล์โดยไม่มีใครรู้ อันตรายกว่าการที่งาน backup fail
 */

/** bucket ที่ระบบใช้จริง — ตรงกับ ATTACHMENTS_BUCKET และ BRANDING_BUCKET ในฝั่ง API */
const BUCKETS = ['attachments', 'branding'];
const PAGE_SIZE = 100;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`backup-storage: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

/** ไล่ทุกโฟลเดอร์ย่อย — Storage list() คืนเฉพาะชั้นเดียว และรายการที่ id เป็น null คือโฟลเดอร์ */
async function listAll(client, bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) found.push(...await listAll(client, bucket, path));
      else found.push(path);
    }
    if (data.length < PAGE_SIZE) break;
  }
  return found;
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const outputDir = resolve(process.env.BACKUP_DIR ?? 'backup-storage');

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const manifest = { generatedAt: new Date().toISOString(), buckets: {} };
  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of BUCKETS) {
    const paths = await listAll(client, bucket);
    const files = [];

    for (const path of paths) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) throw new Error(`download ${bucket}/${path}: ${error?.message ?? 'no data returned'}`);

      const bytes = Buffer.from(await data.arrayBuffer());
      const destination = join(outputDir, bucket, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);

      files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      totalBytes += bytes.length;
    }

    manifest.buckets[bucket] = { fileCount: files.length, files };
    totalFiles += files.length;
    console.log(`backup-storage: ${bucket} — ${files.length} file(s)`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`backup-storage: ${totalFiles} file(s), ${(totalBytes / 1_048_576).toFixed(2)} MB written to ${outputDir}`);
}

await main();
