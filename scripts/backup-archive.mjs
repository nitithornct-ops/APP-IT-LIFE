import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('LIFEBK1');

export function backupKey(value) {
  const key = Buffer.from(value ?? '', 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

export function encryptBackup(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(data, key) {
  if (data.length < 35 || !data.subarray(0, 7).equals(MAGIC)) throw new Error('Invalid backup archive');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(7, 19));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(data.subarray(19, 35));
  return Buffer.concat([decipher.update(data.subarray(35)), decipher.final()]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, input, output] = process.argv.slice(2);
    if (!['encrypt', 'decrypt'].includes(mode) || !input || !output || input === output) {
      throw new Error('Usage: node scripts/backup-archive.mjs encrypt|decrypt INPUT OUTPUT');
    }
    const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY);
    const data = await readFile(input);
    const result = mode === 'encrypt' ? encryptBackup(data, key) : decryptBackup(data, key);
    await writeFile(output, result, { mode: 0o600, flag: 'wx' });
    console.log(`Backup archive ${mode} completed`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
