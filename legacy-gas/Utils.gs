/**
 * Utils.gs
 * ฟังก์ชันอรรถประโยชน์ร่วม: เข้าถึง Spreadsheet, อ่าน/เขียนข้อมูลแบบ object,
 * LockService, การตรวจสอบ/ทำความสะอาด input, escape XSS, Audit Trail,
 * และการอ่านค่า config จาก Script Properties
 */

// ----- ค่า Config: เก็บ secret/LINE connection ใน Script Properties, ค่าอื่นอ่านจาก Settings sheet -----
const SCRIPT_PROPERTY_CONFIG_KEYS = [
  'SPREADSHEET_ID',
  'APP_SCHEMA_VERSION',
  'ADMIN_INIT_PASSWORD',
  'ADMIN_MFA_PEPPER',
  'PUBLIC_TICKET_TOKEN_PEPPER',
  'NOTIFY_LINE_ENABLED',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_DEFAULT_TO',
  'LINE_CHANNEL_SECRET',
  'LINE_WEBHOOK_GATEWAY_SECRET',
  'LINE_LOGIN_ENABLED',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LOGIN_CHANNEL_SECRET',
  'LINE_LOGIN_CALLBACK_URL',
  'LINE_REQUIRE_EMPLOYEE_LINK',
  'LINE_AUTO_APPROVE_EMPLOYEE_LINK',
  'LINE_SESSION_HOURS',
  'LINE_SESSION_SECRET'
];

const SCRIPT_PROPERTY_RUNTIME_KEEP_KEYS = [
  'LIVE_HEALTH_LAST_STATUS',
  'LIVE_HEALTH_LAST_DATE',
  'LIVE_HEALTH_LAST_ALERT_DATE',
  'INTEGRATION_LIFECYCLE_CURSOR',
  'INTEGRATION_OUTBOX_QUEUE_TURN',
  'WORKFLOW_TRANSITION_REPAIR_CURSOR',
  'WORKFLOW_QUEUE_REPAIR_CURSOR'
];

var __SETTINGS_CONFIG_CACHE = null;

function isScriptPropertyConfigKey_(key) {
  key = String(key || '');
  return SCRIPT_PROPERTY_CONFIG_KEYS.indexOf(key) > -1;
}

function shouldKeepScriptProperty_(key) {
  key = String(key || '');
  return isScriptPropertyConfigKey_(key) || SCRIPT_PROPERTY_RUNTIME_KEEP_KEYS.indexOf(key) > -1;
}

function settingsSheetName_() {
  return (typeof SHEETS !== 'undefined' && SHEETS.SETTINGS) ? SHEETS.SETTINGS : 'Settings';
}

function getConfig_(key, defaultValue) {
  key = String(key || '');
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v !== null && v !== undefined) return v;
  const sheetValue = getConfigFromSettings_(key);
  if (sheetValue !== null && sheetValue !== undefined) return sheetValue;
  return (v === null || v === undefined) ? (defaultValue === undefined ? '' : defaultValue) : v;
}

/**
 * แปลงค่าที่อ่านจากชีต Settings ให้เป็น string เสมอ ทั้งระบบถือว่า config เป็น
 * string (=== 'true', .split(','), parseInt) หากเซลล์ถูกจัดรูปแบบเป็นวันที่/ตัวเลข
 * ค่าที่หลุดออกมาเป็น Date/Number จะทำให้ .split พัง และทำให้ payload ที่ส่งผ่าน
 * google.script.run serialize ไม่สำเร็จ (คืน null กลับหน้าเว็บ)
 */
function coerceConfigValue_(raw) {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, 'Asia/Bangkok', 'yyyy-MM-dd');
  return String(raw);
}

/**
 * Compatibility bridge for old deployed templates/code that still call getConfig().
 * Keep this intentionally narrow because top-level Apps Script functions can be
 * invoked from the client. Secrets must continue to use getConfig_() internally.
 */
function getConfig(key, defaultValue) {
  key = String(key || '');
  if (key !== 'ORG_NAME') throw new Error('getConfig() เปิดให้ใช้เฉพาะค่า public เท่านั้น: ' + key);
  return getConfig_(key, defaultValue);
}

function setConfig_(key, value) {
  key = String(key || '');
  if (isScriptPropertyConfigKey_(key)) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
    return;
  }
  upsertSettingConfig_(key, value, 'system');
}

function getConfigFromSettings_(key) {
  if (!key || key === 'SPREADSHEET_ID') return null;
  const map = getSettingsConfigMap_();
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function getSettingsConfigMap_() {
  if (__SETTINGS_CONFIG_CACHE) return __SETTINGS_CONFIG_CACHE;
  const map = {};
  try {
    const props = PropertiesService.getScriptProperties();
    const ssId = props.getProperty('SPREADSHEET_ID');
    const ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      __SETTINGS_CONFIG_CACHE = map;
      return map;
    }
    const sh = ss.getSheetByName(settingsSheetName_());
    if (!sh) {
      __SETTINGS_CONFIG_CACHE = map;
      return map;
    }
    const values = sh.getDataRange().getValues();
    if (values.length < 2) {
      __SETTINGS_CONFIG_CACHE = map;
      return map;
    }
    const headers = values[0];
    const keyIdx = headers.indexOf('Key');
    const valueIdx = headers.indexOf('Value');
    if (keyIdx === -1 || valueIdx === -1) {
      __SETTINGS_CONFIG_CACHE = map;
      return map;
    }
    for (let i = 1; i < values.length; i++) {
      const k = String(values[i][keyIdx] || '').trim();
      if (k) map[k] = coerceConfigValue_(values[i][valueIdx]);
    }
  } catch (e) {
    // During first install the Settings sheet may not exist yet; defaults still apply.
  }
  __SETTINGS_CONFIG_CACHE = map;
  return map;
}

function upsertSettingConfig_(key, value, actorEmail, description, group) {
  key = sanitizeText(key, 120);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureSheetBySchema_(settingsSheetName_());
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const keyIdx = headers.indexOf('Key');
    const valueIdx = headers.indexOf('Value');
    const descIdx = headers.indexOf('Description');
    const groupIdx = headers.indexOf('Group');
    const updatedAtIdx = headers.indexOf('UpdatedAt');
    const updatedByIdx = headers.indexOf('UpdatedBy');
    if (keyIdx === -1 || valueIdx === -1) throw new Error('Settings sheet schema ไม่ถูกต้อง');
    const now = new Date();
    const values = sh.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][keyIdx]) === key) {
        const row = values[i].slice();
        row[valueIdx] = sheetSafeValue_(String(value));
        if (descIdx > -1 && description && !row[descIdx]) row[descIdx] = sheetSafeValue_(description);
        if (groupIdx > -1 && group && !row[groupIdx]) row[groupIdx] = sheetSafeValue_(group);
        if (updatedAtIdx > -1) row[updatedAtIdx] = now;
        if (updatedByIdx > -1) row[updatedByIdx] = actorEmail || 'system';
        sh.getRange(i + 1, 1, 1, headers.length).setValues([row]);
        __SETTINGS_CONFIG_CACHE = null;
        return;
      }
    }
    const newRow = {};
    newRow.Key = key;
    newRow.Value = String(value);
    newRow.Description = description || 'ย้ายจาก Script Properties';
    newRow.Group = group || 'Migrated';
    newRow.UpdatedAt = now;
    newRow.UpdatedBy = actorEmail || 'system';
    sh.appendRow(headers.map(function (h) { return sheetSafeValue_(newRow[h] || ''); }));
    __SETTINGS_CONFIG_CACHE = null;
  } finally {
    lock.releaseLock();
  }
}

function cleanupScriptPropertiesForLine() {
  assertEditorOwner_();
  const s = cleanupScriptPropertiesForLine_();
  return 'จัดการ Script Properties เรียบร้อย: ก่อน=' + s.before +
    ', หลัง=' + s.after +
    ', ย้ายไป Settings=' + s.migrated.length +
    ', ลบทิ้ง=' + s.deleted.length +
    '\n\nคงไว้ใน Script Properties:\n- ' + s.kept.join('\n- ') +
    (s.migrated.length ? '\n\nย้ายไป Settings:\n- ' + s.migrated.join('\n- ') : '') +
    (s.deleted.length ? '\n\nลบทิ้ง:\n- ' + s.deleted.join('\n- ') : '');
}

function cleanupScriptPropertiesForLine_() {
  const props = PropertiesService.getScriptProperties();
  const keys = props.getKeys().sort();
  const summary = { before: keys.length, after: 0, kept: [], migrated: [], deleted: [] };
  const transientPrefixes = ['PUBLIC_TICKET_DAY_', 'PUBLIC_TICKET_GLOBAL_DAY_'];
  keys.forEach(function (key) {
    if (shouldKeepScriptProperty_(key)) {
      summary.kept.push(key);
      return;
    }
    const transient = transientPrefixes.some(function (prefix) { return key.indexOf(prefix) === 0; });
    if (!transient) {
      upsertSettingConfig_(key, props.getProperty(key), 'cleanup', 'ย้ายจาก Script Properties เพื่อลดจำนวน key', 'Migrated');
      summary.migrated.push(key);
    }
    props.deleteProperty(key);
    summary.deleted.push(key);
  });
  summary.after = props.getKeys().length;
  __SETTINGS_CONFIG_CACHE = null;
  return summary;
}

/** เปิดไฟล์ Spreadsheet ฐานข้อมูล (ผูกผ่าน Script Property: SPREADSHEET_ID) */
function getDB_() {
  const id = getConfig_('SPREADSHEET_ID', '');
  if (id) return SpreadsheetApp.openById(id);
  // fallback: หากเป็น container-bound script
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID ใน Script Properties (โปรดรัน setupSystem ก่อน)');
}

function getSheet_(name) {
  const sh = getDB_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบ Sheet ชื่อ "' + name + '" (โปรดรัน setupSystem เพื่อสร้างโครงสร้าง)');
  return sh;
}

// ----- ตรวจว่าแถวถูก soft-delete (ย้ายไปถังขยะ) หรือไม่ -----
function _isDeletedRow_(obj) {
  if (!obj) return false;
  let v = obj.IsDeleted;
  if (v === null || v === undefined || v === '') return false;
  v = String(v).toLowerCase().trim();
  return v === 'yes' || v === 'true' || v === '1' || v === 'ลบแล้ว';
}

// ----- อ่านทั้ง Sheet เป็น array ของ object (header เป็น key) -----
// includeDeleted = true เพื่ออ่านแถวที่ถูกลบด้วย (ใช้ในถังขยะ/กู้คืน) ค่าปริยายซ่อนแถวที่ลบ
function readSheetObjects_(name, includeDeleted) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = { _row: i + 1 };
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    if (!includeDeleted && _isDeletedRow_(obj)) continue;
    rows.push(obj);
  }
  return rows;
}

function getHeaders_(name) {
  return getSheet_(name).getRange(1, 1, 1, getSheet_(name).getLastColumn()).getValues()[0];
}

function ensureSheetBySchema_(sheetName) {
  const schema = DB_SCHEMA[sheetName];
  if (!schema) throw new Error('ไม่พบ schema สำหรับ Sheet: ' + sheetName);
  const ss = getDB_();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  ensureSheetColumns_(sh, schema);
  return sh;
}

function readSheetObjectsEnsured_(sheetName, includeDeleted) {
  const sh = ensureSheetBySchema_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = { _row: i + 1 };
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    if (!includeDeleted && _isDeletedRow_(obj)) continue;
    rows.push(obj);
  }
  return rows;
}

function appendRowEnsured_(sheetName, dataObj, actorEmail) {
  ensureSheetBySchema_(sheetName);
  return appendRow_(sheetName, dataObj, actorEmail);
}

function findRowEnsured_(sheetName, keyCol, keyVal) {
  const rows = readSheetObjectsEnsured_(sheetName);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][keyCol]) === String(keyVal)) return rows[i];
  }
  return null;
}

function numberOrZero_(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function safeFmtDate_(v) {
  return v ? fmtDate(v) : '';
}

function safeFmtDateTime_(v) {
  return v ? fmtDateTime(v) : '';
}

function latestByDate_(rows, field, limit) {
  return rows.slice().sort(function (a, b) {
    const da = a[field] ? new Date(a[field]).getTime() : 0;
    const db = b[field] ? new Date(b[field]).getTime() : 0;
    return db - da;
  }).slice(0, limit || 50);
}

/**
 * เพิ่มแถวใหม่จาก object โดยจับคู่ตามชื่อ header — ครอบด้วย LockService กัน concurrency
 * เติมคอลัมน์มาตรฐาน (Timestamp/CreatedBy/LastUpdatedBy/LastUpdatedAt) อัตโนมัติ
 */
function appendRow_(sheetName, dataObj, actorEmail, beforeAppendLocked) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (typeof beforeAppendLocked === 'function') beforeAppendLocked();
    const sh = getSheet_(sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const now = new Date();
    const merged = Object.assign({}, dataObj);
    if (headers.indexOf('Timestamp') > -1 && !merged.Timestamp) merged.Timestamp = now;
    if (headers.indexOf('CreatedBy') > -1 && !merged.CreatedBy) merged.CreatedBy = actorEmail || '';
    if (headers.indexOf('LastUpdatedBy') > -1) merged.LastUpdatedBy = actorEmail || '';
    if (headers.indexOf('LastUpdatedAt') > -1) merged.LastUpdatedAt = now;
    const row = headers.map(function (h) {
      return sheetSafeValue_(merged.hasOwnProperty(h) ? merged[h] : '');
    });
    sh.appendRow(row);
    return sh.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

/** ปรับปรุงแถวตามเลขแถว (1-based รวม header) ด้วย object บางส่วน */
function updateRow_(sheetName, rowNumber, partialObj, actorEmail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_(sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const range = sh.getRange(rowNumber, 1, 1, headers.length);
    // เก็บค่าคอลัมน์เดิมไว้ตามจริง เพื่อไม่ทำลายสูตร/ชนิดข้อมูลที่มีอยู่แล้ว
    // ป้องกัน Formula Injection เฉพาะค่าที่กำลังเขียนใหม่ด้านล่าง
    const current = range.getValues()[0];
    const now = new Date();
    headers.forEach(function (h, idx) {
      if (partialObj.hasOwnProperty(h)) current[idx] = sheetSafeValue_(partialObj[h]);
      if (h === 'LastUpdatedBy') current[idx] = actorEmail || '';
      if (h === 'LastUpdatedAt') current[idx] = now;
    });
    range.setValues([current]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** หาแถวแรกที่คอลัมน์ keyCol == keyVal คืน object (หรือ null) */
function findRow_(sheetName, keyCol, keyVal) {
  const rows = readSheetObjects_(sheetName);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][keyCol]) === String(keyVal)) return rows[i];
  }
  return null;
}

// ----- สร้าง ID ที่อ่านง่ายและไม่ชนกันง่าย เช่น INC-20260622-A1B2C3D4E5F60708 -----
function generateId(prefix) {
  const tz = 'Asia/Bangkok';
  const datePart = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const uniquePart = Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  return prefix + '-' + datePart + '-' + uniquePart;
}

// ----- ความปลอดภัย: escape เพื่อกัน XSS เมื่อแสดงค่าใน HTML -----
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----- Input validation helpers -----
function requireFields(obj, fields) {
  const missing = [];
  fields.forEach(function (f) {
    if (obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '') missing.push(f);
  });
  if (missing.length) throw new Error('กรุณากรอกข้อมูลให้ครบถ้วน: ' + missing.join(', '));
}

function sanitizeText(v, maxLen) {
  let s = (v === null || v === undefined) ? '' : String(v).trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

/**
 * ป้องกัน Formula Injection เมื่อเขียนข้อความจากผู้ใช้ลง Google Sheets
 * ค่า String ที่ขึ้นต้นด้วย = + - @ จะถูกบังคับเป็นข้อความ ไม่ถูกประมวลผลเป็นสูตร
 */
function sheetSafeValue_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isInList(value, list) {
  return list.indexOf(value) > -1;
}

// ----- รูปแบบวันที่สำหรับแสดงผล -----
function fmtDate(d) {
  if (!d) return '';
  if (!(d instanceof Date)) { const t = new Date(d); if (isNaN(t)) return String(d); d = t; }
  return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy');
}

function fmtDateTime(d) {
  if (!d) return '';
  if (!(d instanceof Date)) { const t = new Date(d); if (isNaN(t)) return String(d); d = t; }
  return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
}

/** จำนวนวันจากวันนี้ถึง target (บวก = อนาคต, ลบ = เลยกำหนด) */
function daysUntil(target) {
  if (!target) return null;
  const t = (target instanceof Date) ? target : new Date(target);
  if (isNaN(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tt = new Date(t); tt.setHours(0, 0, 0, 0);
  return Math.round((tt - today) / 86400000);
}

/** จำนวนวันนับจากอดีตถึงปัจจุบัน (null ถ้าไม่มีค่า) — ตรงข้ามกับ daysUntil */
function daysSince_(pastDate) {
  const d = daysUntil(pastDate);
  return d === null ? null : -d;
}

// ----- Audit Trail: บันทึกทุกการกระทำสำคัญ -----
function writeAudit_(actor, action, module, targetSheet, targetId, detail, result) {
  try {
    const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
    if (!sh) return; // ระบบยังไม่ setup
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sh.appendRow([
        generateId('LOG'),
        new Date(),
        (actor && actor.email) || actor || '',
        (actor && actor.role) || '',
        action || '',
        module || '',
        targetSheet || '',
        targetId || '',
        sheetSafeValue_(detail || ''),
        '',                       // IPHint — Apps Script ไม่ได้ IP โดยตรง
        result || 'success'
      ]);
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    console.error('writeAudit_ error: ' + e.message);
  }
}

/** ใช้ใน HTML template: include_('Styles') เพื่อใช้ CSS/JS ร่วมกัน */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * โหลด HTML ของแต่ละโมดูลโดยไม่ทำให้ Admin shell ทั้งหน้าล้ม
 * หาก deploy อัปโหลด partial ไม่ครบ จะบันทึกชื่อไฟล์ที่ขาดไว้ฝั่ง client
 * แล้ว loadModule() จะแสดงสถานะ "ไม่พบ renderer" เฉพาะโมดูลนั้น
 */
function includeOptional_(filename) {
  filename = String(filename || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(filename)) {
    throw new Error('ชื่อไฟล์ HTML ไม่ถูกต้อง: ' + filename);
  }

  try {
    return include_(filename);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('Optional HTML partial missing: ' + filename + ' — ' + message);
    return '<!-- Missing optional HTML partial: ' + filename + ' -->' +
      '<script>' +
      'window.__MISSING_HTML_PARTIALS__=window.__MISSING_HTML_PARTIALS__||[];' +
      'window.__MISSING_HTML_PARTIALS__.push("' + filename + '");' +
      '</script>';
  }
}

/**
 * Compatibility bridge for old templates that still call include('Styles').
 * Whitelist only UI partials; do not allow arbitrary file reads from client calls.
 */
function include(filename) {
  filename = String(filename || '').trim();
  const allowed = {
    Styles: true,
    JavaScript: true,
    Dashboard: true,
    Task: true,
    Ticket: true,
    KB: true,
    AccessControl: true,
    Incident: true,
    Compliance: true,
    Backup: true,
    Logging: true,
    Asset: true,
    DataClass: true,
    Change: true,
    Vendor: true,
    AICloud: true,
    Awareness: true,
    Evidence: true,
    AuditTrail: true,
    NotificationSettings: true,
    ITAssetExtras: true
  };
  if (!allowed[filename]) throw new Error('include() ไม่อนุญาตไฟล์นี้: ' + filename);
  return include_(filename);
}

/**
 * สัญญา response กลางสำหรับ Web App
 *
 * คง `ok`/`error` ไว้เพื่อให้หน้าเดิมทุกหน้ายังทำงาน และเพิ่มฟิลด์มาตรฐาน
 * `success`/`message`/`errorCode`/`timestamp` สำหรับ client และ integration ใหม่
 * โดยไม่ต้อง migration ข้อมูลเดิม
 */
function ok(data, message) {
  return {
    success: true,
    message: String(message || 'ดำเนินการสำเร็จ'),
    data: data === undefined ? null : data,
    errorCode: null,
    timestamp: new Date().toISOString(),
    ok: true,
    error: null
  };
}

function fail(message, errorCode) {
  const safeMessage = String(message || 'ไม่สามารถดำเนินการได้');
  const inferredCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(safeMessage) ? safeMessage : 'OPERATION_FAILED';
  return {
    success: false,
    message: safeMessage,
    data: null,
    errorCode: String(errorCode || inferredCode),
    timestamp: new Date().toISOString(),
    ok: false,
    error: safeMessage
  };
}
