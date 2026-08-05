/**
 * Module_Backup.gs
 * การสำรองข้อมูลและแผนฉุกเฉิน (Backup & BCP/DR)
 *  - บันทึกผลการสำรองข้อมูลแต่ละรอบ (สำเร็จ/ล้มเหลว)
 *  - บันทึกผลทดสอบกู้คืนข้อมูลประจำปี
 *  - ทะเบียนแผนฉุกเฉิน + ประวัติการใช้งานจริง
 * อ้างอิง: การสำรองข้อมูล + หมวด 6-7
 */

const BACKUP_RESULTS = ['สำเร็จ', 'ล้มเหลว', 'สำเร็จบางส่วน'];
const BACKUP_TYPES = ['Full', 'Incremental', 'Differential', 'System Snapshot'];

function getBackupModuleData() {
  try {
    const user = requireModule('backup', false);
    const canEdit = canEditModule(user.role, 'backup');

    const backups = readSheetObjects_(SHEETS.BACKUP).map(function (r) {
      return {
        row: r._row, id: r.BackupID, system: r.SystemName, type: r.BackupType,
        date: fmtDate(r.BackupDate), result: r.Result, size: r.DataSize,
        location: r.StorageLocation, operator: r.Operator,
        nextDue: fmtDate(r.NextBackupDue), nextDays: daysUntil(r.NextBackupDue),
        evidence: r.EvidenceLink, notes: r.Notes,
        snapshotFileId: r.SnapshotFileID, sourceSpreadsheetId: r.SourceSpreadsheetID,
        checksum: r.Checksum, rowCount: Number(r.RowCount) || 0,
        isSnapshot: !!r.SnapshotFileID
      };
    }).reverse();

    const recovery = readSheetObjects_(SHEETS.RECOVERY).map(function (r) {
      return {
        row: r._row, id: r.TestID, system: r.SystemName, date: fmtDate(r.TestDate),
        scenario: r.Scenario, result: r.Result, rto: r.RTO_Actual, rpo: r.RPO_Actual,
        tester: r.Tester, nextDue: fmtDate(r.NextTestDue), nextDays: daysUntil(r.NextTestDue),
        evidence: r.EvidenceLink, findings: r.Findings
      };
    }).reverse();

    const bcp = readSheetObjects_(SHEETS.BCP).map(function (r) {
      return {
        row: r._row, id: r.PlanID, name: r.PlanName, scope: r.Scope, owner: r.Owner,
        lastReview: fmtDate(r.LastReviewDate), nextReview: fmtDate(r.NextReviewDue),
        reviewDays: daysUntil(r.NextReviewDue), lastInvoked: fmtDate(r.LastInvokedDate),
        invokeReason: r.InvokeReason, docLink: r.DocumentLink, status: r.Status
      };
    });

    return ok({
      role: user.role, canEdit: canEdit,
      results: BACKUP_RESULTS, types: BACKUP_TYPES,
      backups: backups, recovery: recovery, bcp: bcp,
      automation: getBackupAutomationStatus_(),
      retention: getRetentionStatusCore_()
    });
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * สร้าง Snapshot จริงของ Spreadsheet ฐานข้อมูลเป็นไฟล์ Google Sheets แยกใน Drive
 * ตรวจ checksum ของต้นทางและสำเนาทันที ก่อนบันทึกผลลง BackupLog
 */
function createSystemSnapshot(label) {
  try {
    const user = requireModule('backup', true);
    return ok(createSystemSnapshotCore_(label, user));
  } catch (e) {
    return fail(e.message);
  }
}

function createSystemSnapshotCore_(label, actor) {
  ensureSheetBySchema_(SHEETS.BACKUP);
  SpreadsheetApp.flush();
  actor = actor || { email: 'system', role: 'system' };

  const source = getDB_();
  const sourceDigest = computeSpreadsheetSnapshotDigest_(source);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  const safeLabel = sanitizeText(label, 80).replace(/[\\\/:*?"<>|]/g, '_');
  const name = 'ISMS_DB_SNAPSHOT_' + stamp + (safeLabel ? '_' + safeLabel : '');
  const folder = getEvidenceFolder_('backup-snapshots');
  const copy = DriveApp.getFileById(source.getId()).makeCopy(name, folder);
  const copiedSpreadsheet = openSpreadsheetWithRetry_(copy.getId());
  const copiedDigest = computeSpreadsheetSnapshotDigest_(copiedSpreadsheet);
  const matched = sourceDigest.checksum === copiedDigest.checksum;
  const id = generateId('BKP');

  appendRow_(SHEETS.BACKUP, {
    BackupID: id,
    SystemName: source.getName(),
    BackupType: 'System Snapshot',
    BackupDate: new Date(),
    Result: matched ? 'สำเร็จ' : 'ล้มเหลว',
    DataSize: sourceDigest.sheetCount + ' sheets / ' + sourceDigest.rowCount + ' data rows',
    StorageLocation: copy.getUrl(),
    Operator: actor.email || 'system',
    NextBackupDue: addDays(new Date(), 1),
    EvidenceLink: copy.getUrl(),
    SnapshotFileID: copy.getId(),
    SourceSpreadsheetID: source.getId(),
    Checksum: sourceDigest.checksum,
    RowCount: sourceDigest.rowCount,
    Notes: 'copyChecksum=' + copiedDigest.checksum
  }, actor.email || 'system');
  writeAudit_(actor, 'CREATE_SNAPSHOT', 'backup', SHEETS.BACKUP, id,
    'file=' + copy.getId() + ' checksum=' + sourceDigest.checksum + ' matched=' + matched,
    matched ? 'success' : 'fail');

  if (!matched) throw new Error('สร้างไฟล์ Snapshot แล้ว แต่ checksum ไม่ตรงกับต้นทาง กรุณาตรวจสอบ ' + id);
  return {
    id: id,
    name: name,
    url: copy.getUrl(),
    checksum: sourceDigest.checksum,
    rowCount: sourceDigest.rowCount,
    sheetCount: sourceDigest.sheetCount
  };
}

/** ตรวจความสมบูรณ์ของ Snapshot เดิมกับ checksum ที่บันทึกไว้ */
function verifySystemSnapshot(backupId) {
  try {
    const user = requireModule('backup', true);
    const backup = findRow_(SHEETS.BACKUP, 'BackupID', backupId);
    if (!backup || !backup.SnapshotFileID) throw new Error('ไม่พบ System Snapshot ที่เลือก');
    const snapshot = openSpreadsheetWithRetry_(String(backup.SnapshotFileID));
    const digest = computeSpreadsheetSnapshotDigest_(snapshot);
    const matched = !!backup.Checksum && String(backup.Checksum) === digest.checksum;
    updateRow_(SHEETS.BACKUP, backup._row, {
      Result: matched ? 'สำเร็จ' : 'ล้มเหลว',
      Notes: appendBackupNote_(backup.Notes,
        'verify ' + fmtDateTime(new Date()) + ' checksum=' + digest.checksum + ' matched=' + matched)
    }, user.email);
    writeAudit_(user, 'VERIFY_SNAPSHOT', 'backup', SHEETS.BACKUP, backupId,
      'checksum=' + digest.checksum + ' matched=' + matched, matched ? 'success' : 'fail');
    return ok({ matched: matched, checksum: digest.checksum, expected: backup.Checksum });
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ทดสอบ Restore แบบปลอดภัย: ทำสำเนา Snapshot เป็น Sandbox ใหม่
 * ไม่เขียนทับฐาน Production และบันทึกผลลง RecoveryTests อัตโนมัติ
 */
function restoreSnapshotToSandbox(backupId) {
  try {
    const user = requireModule('backup', true);
    return ok(restoreSnapshotToSandboxCore_(backupId, user));
  } catch (e) {
    return fail(e.message);
  }
}

function restoreSnapshotToSandboxCore_(backupId, actor) {
  actor = actor || { email: 'system', role: 'system' };
  const backup = findRow_(SHEETS.BACKUP, 'BackupID', backupId);
  if (!backup || !backup.SnapshotFileID) throw new Error('ไม่พบ System Snapshot ที่เลือก');
  const startedAt = new Date();
  const sourceFile = DriveApp.getFileById(String(backup.SnapshotFileID));
  const folder = getEvidenceFolder_('restore-tests');
  const name = 'RESTORE_TEST_' + Utilities.formatDate(startedAt, 'Asia/Bangkok', 'yyyyMMdd_HHmmss') +
    '_' + sourceFile.getName();
  const sandboxFile = sourceFile.makeCopy(name, folder);
  const sandbox = openSpreadsheetWithRetry_(sandboxFile.getId());
  const digest = computeSpreadsheetSnapshotDigest_(sandbox);
  const matched = !!backup.Checksum && String(backup.Checksum) === digest.checksum;
  const elapsedSec = Math.max(1, Math.round((new Date() - startedAt) / 1000));
  const backupDate = backup.BackupDate instanceof Date ? backup.BackupDate : new Date(backup.BackupDate);
  const rpoHours = isNaN(backupDate) ? '' : Math.max(0, Math.round((startedAt - backupDate) / 3600000));
  const testId = generateId('RCV');

  appendRow_(SHEETS.RECOVERY, {
    TestID: testId,
    SystemName: backup.SystemName || 'ISMS Database',
    TestDate: startedAt,
    Scenario: 'กู้คืน Snapshot ' + backupId + ' ไปยัง Sandbox แยกจาก Production',
    Result: matched ? 'ผ่าน' : 'ไม่ผ่าน',
    RTO_Actual: elapsedSec + ' วินาที',
    RPO_Actual: rpoHours === '' ? '' : rpoHours + ' ชั่วโมง',
    Tester: actor.email || 'system',
    NextTestDue: addDays(startedAt, 30),
    EvidenceLink: sandboxFile.getUrl(),
    Findings: 'expected=' + (backup.Checksum || '-') + ' actual=' + digest.checksum,
    Notes: 'Sandbox file ID=' + sandboxFile.getId()
  }, actor.email || 'system');
  writeAudit_(actor, 'RESTORE_TEST', 'backup', SHEETS.RECOVERY, testId,
    'snapshot=' + backupId + ' sandbox=' + sandboxFile.getId() + ' matched=' + matched,
    matched ? 'success' : 'fail');
  return {
    testId: testId,
    matched: matched,
    url: sandboxFile.getUrl(),
    rtoSeconds: elapsedSec,
    rpoHours: rpoHours,
    checksum: digest.checksum
  };
}

function computeSpreadsheetSnapshotDigest_(spreadsheet) {
  const manifest = [];
  let rowCount = 0;
  spreadsheet.getSheets().forEach(function (sh) {
    const range = sh.getDataRange();
    const formulas = range.getFormulas();
    const values = range.getValues().map(function (row, rowIndex) {
      return row.map(function (value, colIndex) {
        if (formulas[rowIndex][colIndex]) return formulas[rowIndex][colIndex];
        if (value instanceof Date) {
          return Utilities.formatDate(value, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        }
        if (value === null || value === undefined) return '';
        return String(value);
      });
    });
    rowCount += Math.max(values.length - 1, 0);
    const sheetChecksum = bytesToHex_(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values), Utilities.Charset.UTF_8));
    manifest.push({
      name: sh.getName(),
      rows: values.length,
      columns: values.length ? values[0].length : 0,
      checksum: sheetChecksum
    });
  });
  manifest.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return {
    checksum: bytesToHex_(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, JSON.stringify(manifest), Utilities.Charset.UTF_8)),
    rowCount: rowCount,
    sheetCount: manifest.length,
    manifest: manifest
  };
}

function openSpreadsheetWithRetry_(fileId) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return SpreadsheetApp.openById(fileId);
    } catch (e) {
      lastError = e;
      Utilities.sleep(250 * (attempt + 1));
    }
  }
  throw lastError || new Error('เปิดไฟล์ Spreadsheet ไม่สำเร็จ');
}

function appendBackupNote_(existing, note) {
  const text = (existing ? String(existing) + ' | ' : '') + String(note || '');
  return sanitizeText(text, 500);
}

function getBackupAutomationStatus_() {
  const handlers = {};
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      handlers[t.getHandlerFunction()] = (handlers[t.getHandlerFunction()] || 0) + 1;
    });
  } catch (e) {}
  return {
    enabled: getConfig_('AUTO_BACKUP_ENABLED', 'true') === 'true',
    retentionDays: parseInt(getConfig_('BACKUP_RETENTION_DAYS', '90'), 10) || 90,
    dailyTrigger: handlers.scheduledSystemBackup_ === 1,
    restoreTrigger: handlers.monthlyRestoreDrill_ === 1,
    queueTrigger: handlers.processNotificationQueue_ === 1,
    retentionTrigger: handlers.dailyRetentionMaintenance_ === 1,
    healthTrigger: handlers.scheduledLiveHealthCheck_ === 1
  };
}

function pruneExpiredSystemSnapshots_() {
  const days = Math.max(7, Math.min(
    parseInt(getConfig_('BACKUP_RETENTION_DAYS', '90'), 10) || 90, 3650));
  const cutoff = new Date(Date.now() - days * 86400000);
  let count = 0;
  readSheetObjectsEnsured_(SHEETS.BACKUP, true).forEach(function (r) {
    if (!r.SnapshotFileID || String(r.Result) === 'Expired') return;
    const date = r.BackupDate instanceof Date ? r.BackupDate : new Date(r.BackupDate);
    if (isNaN(date) || date >= cutoff) return;
    try {
      DriveApp.getFileById(String(r.SnapshotFileID)).setTrashed(true);
      updateRow_(SHEETS.BACKUP, r._row, {
        Result: 'Expired',
        Notes: appendBackupNote_(r.Notes, 'expired by retention ' + days + ' days')
      }, 'system');
      count++;
    } catch (e) {
      updateRow_(SHEETS.BACKUP, r._row, {
        Notes: appendBackupNote_(r.Notes, 'retention error: ' + e.message)
      }, 'system');
    }
  });
  const sandboxDays = Math.max(7, Math.min(
    parseInt(getConfig_('RESTORE_SANDBOX_RETENTION_DAYS', '30'), 10) || 30, 3650));
  const sandboxCutoff = new Date(Date.now() - sandboxDays * 86400000);
  readSheetObjectsEnsured_(SHEETS.RECOVERY, true).forEach(function (r) {
    const date = r.TestDate instanceof Date ? r.TestDate : new Date(r.TestDate);
    if (!r.EvidenceLink || isNaN(date) || date >= sandboxCutoff) return;
    const match = String(r.EvidenceLink).match(/[-\w]{25,}/);
    if (!match) return;
    try {
      DriveApp.getFileById(match[0]).setTrashed(true);
      updateRow_(SHEETS.RECOVERY, r._row, {
        EvidenceLink: '',
        Notes: appendBackupNote_(r.Notes, 'restore sandbox expired after ' + sandboxDays + ' days')
      }, 'system');
      count++;
    } catch (e) {}
  });
  return count;
}

function scheduledSystemBackup_() {
  if (getConfig_('AUTO_BACKUP_ENABLED', 'true') !== 'true') {
    return { skipped: true, reason: 'AUTO_BACKUP_ENABLED=false' };
  }
  try {
    const result = createSystemSnapshotCore_('AUTO_DAILY', { email: 'system', role: 'system' });
    result.pruned = pruneExpiredSystemSnapshots_();
    return result;
  } catch (e) {
    notify_('', 'System Snapshot อัตโนมัติล้มเหลว', '',
      '🚨 System Snapshot อัตโนมัติล้มเหลว\n' + e.message, 'backup', '');
    throw e;
  }
}

function monthlyRestoreDrill_() {
  if (getConfig_('AUTO_RESTORE_DRILL_ENABLED', 'true') !== 'true') {
    return { skipped: true, reason: 'AUTO_RESTORE_DRILL_ENABLED=false' };
  }
  try {
    const latest = readSheetObjectsEnsured_(SHEETS.BACKUP, true)
      .filter(function (r) {
        return r.SnapshotFileID && String(r.Result) === 'สำเร็จ';
      })
      .sort(function (a, b) {
        return new Date(b.BackupDate || 0) - new Date(a.BackupDate || 0);
      })[0];
    if (!latest) throw new Error('ไม่มี System Snapshot ที่สำเร็จสำหรับทดสอบ Restore');
    const result = restoreSnapshotToSandboxCore_(latest.BackupID, { email: 'system', role: 'system' });
    notify_('', 'ผลทดสอบ Restore อัตโนมัติ', '',
      (result.matched ? '✅' : '🚨') + ' Restore drill ' + result.testId +
      '\nChecksum: ' + (result.matched ? 'ตรงกัน' : 'ไม่ตรง') +
      '\nRTO: ' + result.rtoSeconds + ' วินาที\nRPO: ' + result.rpoHours + ' ชั่วโมง',
      'backup', result.testId);
    return result;
  } catch (e) {
    notify_('', 'Restore drill อัตโนมัติล้มเหลว', '',
      '🚨 Restore drill อัตโนมัติล้มเหลว\n' + e.message, 'backup', '');
    throw e;
  }
}

/** บันทึกผลการสำรองข้อมูล */
function addBackupLog(form) {
  try {
    const user = requireModule('backup', true);
    form = form || {};
    const system = sanitizeText(form.system, 120);
    const result = sanitizeText(form.result, 40);
    requireFields({ SystemName: system, BackupDate: form.date, Result: result },
      ['SystemName', 'BackupDate', 'Result']);
    if (!isInList(result, BACKUP_RESULTS)) throw new Error('ผลการสำรองไม่ถูกต้อง');

    const id = generateId('BKP');
    appendRow_(SHEETS.BACKUP, {
      BackupID: id, SystemName: system, BackupType: sanitizeText(form.type, 30),
      BackupDate: parseDate(form.date), Result: result, DataSize: sanitizeText(form.size, 40),
      StorageLocation: sanitizeText(form.location, 150), Operator: user.email,
      NextBackupDue: parseDate(form.nextDue), EvidenceLink: sanitizeText(form.evidence, 500),
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'backup', SHEETS.BACKUP, id, system + ' / ' + result, 'success');

    // แจ้งเตือนทันทีหากสำรองล้มเหลว
    if (result === 'ล้มเหลว' || result === 'สำเร็จบางส่วน') {
      notify_(getITAdminEmails_().join(','), 'การสำรองข้อมูลมีปัญหา: ' + system,
        '<p style="color:#dc3545">การสำรองข้อมูล <b>' + escapeHtml(system) + '</b> มีผลเป็น "' +
        escapeHtml(result) + '" เมื่อ ' + escapeHtml(fmtDate(parseDate(form.date))) + '</p>',
        'สำรองข้อมูล ' + system + ' = ' + result + ' โปรดตรวจสอบ', 'backup', id);
    }
    return ok('บันทึกผลการสำรองข้อมูลเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

/** แก้ไขบันทึกสำรองข้อมูล โดยคงข้อมูล Snapshot/checksum เดิมไว้ */
function updateBackupLog(backupId, form) {
  try {
    const user = requireModule('backup', true);
    const row = findRow_(SHEETS.BACKUP, 'BackupID', backupId);
    if (!row) throw new Error('ไม่พบบันทึกสำรองข้อมูล');
    form = form || {};
    const system = sanitizeText(form.system, 120);
    const result = sanitizeText(form.result, 40);
    requireFields({ SystemName: system, BackupDate: form.date, Result: result }, ['SystemName', 'BackupDate', 'Result']);
    if (!isInList(result, BACKUP_RESULTS)) throw new Error('ผลการสำรองไม่ถูกต้อง');
    updateRow_(SHEETS.BACKUP, row._row, {
      SystemName: system, BackupType: sanitizeText(form.type, 30), BackupDate: parseDate(form.date),
      Result: result, DataSize: sanitizeText(form.size, 40), StorageLocation: sanitizeText(form.location, 150),
      NextBackupDue: parseDate(form.nextDue), EvidenceLink: sanitizeText(form.evidence, 500) || row.EvidenceLink,
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'UPDATE', 'backup', SHEETS.BACKUP, backupId, system + ' / ' + result, 'success');
    return ok('แก้ไขบันทึกสำรองข้อมูลเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** บันทึกผลทดสอบกู้คืนข้อมูล */
function addRecoveryTest(form) {
  try {
    const user = requireModule('backup', true);
    form = form || {};
    const system = sanitizeText(form.system, 120);
    requireFields({ SystemName: system, TestDate: form.date, Result: form.result },
      ['SystemName', 'TestDate', 'Result']);
    const id = generateId('RCV');
    appendRow_(SHEETS.RECOVERY, {
      TestID: id, SystemName: system, TestDate: parseDate(form.date),
      Scenario: sanitizeText(form.scenario, 500), Result: sanitizeText(form.result, 40),
      RTO_Actual: sanitizeText(form.rto, 40), RPO_Actual: sanitizeText(form.rpo, 40),
      Tester: user.email, NextTestDue: parseDate(form.nextDue),
      EvidenceLink: sanitizeText(form.evidence, 500), Findings: sanitizeText(form.findings, 1000),
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'backup', SHEETS.RECOVERY, id, 'ทดสอบกู้คืน ' + system, 'success');
    return ok('บันทึกผลทดสอบกู้คืนเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

/** แก้ไขผลและกำหนดการทดสอบกู้คืน */
function updateRecoveryTest(testId, form) {
  try {
    const user = requireModule('backup', true);
    const row = findRow_(SHEETS.RECOVERY, 'TestID', testId);
    if (!row) throw new Error('ไม่พบผลทดสอบกู้คืน');
    form = form || {};
    const system = sanitizeText(form.system, 120);
    requireFields({ SystemName: system, TestDate: form.date, Result: form.result }, ['SystemName', 'TestDate', 'Result']);
    updateRow_(SHEETS.RECOVERY, row._row, {
      SystemName: system, TestDate: parseDate(form.date), Scenario: sanitizeText(form.scenario, 500),
      Result: sanitizeText(form.result, 40), RTO_Actual: sanitizeText(form.rto, 40),
      RPO_Actual: sanitizeText(form.rpo, 40), NextTestDue: parseDate(form.nextDue),
      EvidenceLink: sanitizeText(form.evidence, 500) || row.EvidenceLink,
      Findings: sanitizeText(form.findings, 1000), Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'UPDATE', 'backup', SHEETS.RECOVERY, testId, 'แก้ไขผลทดสอบกู้คืน ' + system, 'success');
    return ok('แก้ไขผลทดสอบกู้คืนเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** เพิ่ม/ปรับปรุงทะเบียนแผนฉุกเฉิน */
function addBCPPlan(form) {
  try {
    const user = requireModule('backup', true);
    form = form || {};
    const name = sanitizeText(form.name, 200);
    requireFields({ PlanName: name }, ['PlanName']);
    const id = generateId('BCP');
    appendRow_(SHEETS.BCP, {
      PlanID: id, PlanName: name, Scope: sanitizeText(form.scope, 500),
      Owner: sanitizeText(form.owner, 120) || user.email,
      LastReviewDate: parseDate(form.lastReview) || new Date(),
      NextReviewDue: parseDate(form.nextReview),
      DocumentLink: sanitizeText(form.docLink, 500), Status: sanitizeText(form.status, 40) || 'ใช้งาน',
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'backup', SHEETS.BCP, id, 'แผนฉุกเฉิน ' + name, 'success');
    return ok('บันทึกแผนฉุกเฉินเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

/** แก้ไขรายละเอียดและกำหนดทบทวนแผนฉุกเฉิน */
function updateBCPPlan(planId, form) {
  try {
    const user = requireModule('backup', true);
    const row = findRow_(SHEETS.BCP, 'PlanID', planId);
    if (!row) throw new Error('ไม่พบแผนฉุกเฉิน');
    form = form || {};
    const name = sanitizeText(form.name, 200);
    requireFields({ PlanName: name }, ['PlanName']);
    updateRow_(SHEETS.BCP, row._row, {
      PlanName: name, Scope: sanitizeText(form.scope, 500), Owner: sanitizeText(form.owner, 120) || user.email,
      NextReviewDue: parseDate(form.nextReview), DocumentLink: sanitizeText(form.docLink, 500),
      Status: sanitizeText(form.status, 40) || row.Status || 'ใช้งาน', Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'UPDATE', 'backup', SHEETS.BCP, planId, 'แก้ไขแผนฉุกเฉิน ' + name, 'success');
    return ok('แก้ไขแผนฉุกเฉินเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** บันทึกการใช้งานแผนฉุกเฉินจริง */
function recordBCPInvocation(planId, reason) {
  try {
    const user = requireModule('backup', true);
    const p = findRow_(SHEETS.BCP, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนฉุกเฉิน');
    requireFields({ reason: reason }, ['reason']);
    updateRow_(SHEETS.BCP, p._row, {
      LastInvokedDate: new Date(), InvokeReason: sanitizeText(reason, 1000)
    }, user.email);
    writeAudit_(user, 'BCP_INVOKE', 'backup', SHEETS.BCP, planId, sanitizeText(reason, 1000), 'success');
    return ok('บันทึกการใช้งานแผนฉุกเฉินเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** ทบทวนแผนฉุกเฉิน (ต่ออายุรอบทบทวน 1 ปี) */
function reviewBCPPlan(planId) {
  try {
    const user = requireModule('backup', true);
    const p = findRow_(SHEETS.BCP, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนฉุกเฉิน');
    const now = new Date();
    updateRow_(SHEETS.BCP, p._row, {
      LastReviewDate: now, NextReviewDue: addDays(now, 365)
    }, user.email);
    writeAudit_(user, 'REVIEW', 'backup', SHEETS.BCP, planId, 'ทบทวนแผนฉุกเฉิน', 'success');
    return ok('ทบทวนแผนฉุกเฉินเรียบร้อย ตั้งรอบถัดไป 1 ปี');
  } catch (e) {
    return fail(e.message);
  }
}

/** แปลงสตริงวันที่ (yyyy-mm-dd จาก input date) เป็น Date */
function parseDate(s) {
  if (!s) return '';
  if (s instanceof Date) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d;
}
