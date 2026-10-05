import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupKey, decryptBackup, encryptBackup } from './backup-archive.mjs';

test('encrypted backup can be restored with the saved key', () => {
  const key = backupKey(randomBytes(32).toString('base64'));
  const original = Buffer.from('database and storage archive');
  const encrypted = encryptBackup(original, key);
  assert.ok(!encrypted.includes(original));
  assert.deepEqual(decryptBackup(encrypted, key), original);
});

test('backup rejects corruption, wrong keys, and invalid key lengths', () => {
  const key = randomBytes(32);
  const encrypted = encryptBackup(Buffer.from('archive'), key);
  assert.throws(() => decryptBackup(encrypted, randomBytes(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
  assert.throws(() => backupKey('short'));
});
