/**
 * Module_FieldDesigner.gs
 * ตัวออกแบบโครงสร้างตารางจากหน้า Settings
 *
 * หลักความปลอดภัย:
 * - ฟิลด์ระบบ (อยู่ใน DB_SCHEMA) เปลี่ยนชื่อที่แสดง/ชนิดข้อมูลได้ แต่ห้ามเปลี่ยน Field key หรือลบ
 * - ฟิลด์ที่ผู้ดูแลเพิ่มเองเปลี่ยนชื่อ Field key และลบได้
 * - ก่อนลบคอลัมน์ที่มีข้อมูล ต้องยืนยันซ้ำจากหน้า UI
 * - AuditTrail แสดงโครงสร้างได้อย่างเดียว เพราะเป็นหลักฐานตรวจสอบที่ถูกป้องกันไว้
 */

const FIELD_DATA_TYPES_ = [
  { key: 'text', label: 'ข้อความสั้น' },
  { key: 'textarea', label: 'ข้อความหลายบรรทัด' },
  { key: 'number', label: 'จำนวนเต็ม' },
  { key: 'decimal', label: 'เลขทศนิยม' },
  { key: 'currency', label: 'จำนวนเงิน' },
  { key: 'date', label: 'วันที่' },
  { key: 'datetime', label: 'วันที่และเวลา' },
  { key: 'checkbox', label: 'ใช่/ไม่ใช่ (Checkbox)' },
  { key: 'select', label: 'รายการตัวเลือก' },
  { key: 'email', label: 'อีเมล' },
  { key: 'url', label: 'ลิงก์ URL' }
];

// 1 โมดูลอาจมีมากกว่า 1 ตาราง โดยคงชื่อ Sheet จริงเพื่อให้ตรวจสอบ/ดูแลต่อได้ง่าย
const MODULE_TABLE_MAP_ = {
  dashboard: [],
  task: ['PersonalTasks'],
  ticket: ['Tickets', 'TicketCategories', 'Ticket_Worklogs'],
  serviceCatalog: ['ServiceCatalog', 'ServiceRequests', 'ServiceRequestTasks', 'ServiceRequestHistory'],
  kb: ['KnowledgeBase'],
  asset: ['AssetRegister'],
  employees: ['Employees', 'EmployeeAssignments'],
  borrow: ['Asset_History'],
  maintenance: ['MaintenancePlans'],
  inventory: ['Inventory', 'InventoryTransactions'],
  license: ['SoftwareLicenses'],
  vendor: ['VendorRegister'],
  cmdb: ['ConfigurationItems', 'CIRelationships'],
  reports: [],
  users: ['Users'],
  settings: ['Settings'],
  auditTrail: ['AuditTrail'],
  tester: ['QATestCases'],
  notification: ['NotificationLog'],
  dataClass: ['DataClassification', 'DataDestructionRequests'],
  privacy: ['PrivacyROPA', 'PrivacyConsents', 'PrivacyDSR'],
  problem: ['Problems', 'KnownErrors'],
  vulnerability: ['VulnerabilityFindings'],
  audit: ['AuditEngagements', 'AuditFindings'],
  access: ['AccessRequests', 'UserAccessRegistry'],
  change: ['ChangeRequests'],
  backup: ['BackupLog', 'RecoveryTests', 'BCPPlans'],
  logging: ['LoggingRegister', 'LogReviews'],
  incident: ['Incidents', 'RegulatoryNotifications'],
  risk: ['RiskRegister'],
  compliance: ['LegalRegister', 'ComplianceObligations', 'ComplianceAssessments', 'CorrectiveActions'],
  ai: ['AIRegister'],
  cloud: ['CloudRegister'],
  awareness: ['TrainingPlans', 'TrainingRecords', 'PolicyAcknowledgements'],
  evidence: ['PolicyMapping', 'GovernanceDocuments']
};

function getFieldSchemaDesignerData_() {
  ensureSheetBySchema_(SHEETS.FIELD_DEFINITIONS);
  const metadata = getActiveFieldDefinitions_();
  const ss = getDB_();
  const catalog = {};
  getModuleCatalog_().forEach(function (m) { catalog[m.key] = m; });

  const modules = Object.keys(MODULE_ACCESS).map(function (moduleKey) {
    const access = MODULE_ACCESS[moduleKey] || {};
    const info = catalog[moduleKey] || {};
    const tableNames = MODULE_TABLE_MAP_[moduleKey] || [];
    return {
      key: moduleKey,
      label: access.label || info.label || moduleKey,
      group: access.group || info.category || 'อื่นๆ',
      description: info.description || '',
      tables: tableNames.map(function (sheetName) {
        return buildFieldTableInfo_(moduleKey, sheetName, metadata, ss);
      })
    };
  });

  return {
    types: FIELD_DATA_TYPES_,
    modules: modules,
    guidance: [
      'ฟิลด์ระบบแก้ชื่อที่แสดงและชนิดข้อมูลได้ แต่ห้ามลบหรือเปลี่ยน Field key',
      'ฟิลด์ที่เพิ่มเองเปลี่ยนชื่อและลบได้ โดยระบบจะตรวจข้อมูลในคอลัมน์ก่อนลบ',
      'การเปลี่ยนชนิดข้อมูลจะตั้งรูปแบบและ Data validation ใน Google Sheet โดยไม่แปลงหรือล้างข้อมูลเดิม'
    ]
  };
}

function getActiveFieldDefinitions_() {
  const map = {};
  readSheetObjectsEnsured_(SHEETS.FIELD_DEFINITIONS, true).forEach(function (r) {
    if (String(r.Status || 'Active') !== 'Active') return;
    const key = fieldDefinitionMapKey_(r.ModuleKey, r.SheetName, r.FieldKey);
    map[key] = r;
  });
  return map;
}

function buildFieldTableInfo_(moduleKey, sheetName, metadata, ss) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    ensureSheetColumns_(sh, DB_SCHEMA[sheetName]);
  }
  const lastCol = sh.getLastColumn();
  const headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const base = DB_SCHEMA[sheetName] || [];
  const locked = isFieldTableLocked_(sheetName);

  return {
    sheet: sheetName,
    label: sheetName,
    locked: locked,
    lockedReason: locked ? 'AuditTrail เป็นหลักฐานตรวจสอบ จึงอนุญาตให้ดูโครงสร้างเท่านั้น' : '',
    fields: headers.filter(function (h) { return String(h || '').trim() !== ''; }).map(function (fieldKey, index) {
      fieldKey = String(fieldKey);
      const meta = metadata[fieldDefinitionMapKey_(moduleKey, sheetName, fieldKey)] || null;
      const isSystem = base.indexOf(fieldKey) > -1;
      const type = normalizeFieldType_(meta ? meta.DataType : inferFieldType_(fieldKey));
      return {
        key: fieldKey,
        displayName: meta && meta.DisplayName ? String(meta.DisplayName) : fieldKey,
        dataType: type,
        dataTypeLabel: getFieldTypeLabel_(type),
        required: meta ? String(meta.IsRequired).toLowerCase() === 'yes' : false,
        options: meta && meta.Options ? String(meta.Options) : '',
        isSystem: isSystem,
        position: index + 1,
        canRenameKey: !isSystem && !locked,
        canDelete: !isSystem && !locked,
        canEdit: !locked
      };
    })
  };
}

/**
 * เพิ่มหรือแก้ไขฟิลด์
 * form = { moduleKey, sheetName, originalKey?, fieldKey, displayName, dataType, required, options }
 */
function saveModuleFieldDefinition(form) {
  try {
    const user = requireModule('settings', true);
    form = form || {};
    const moduleKey = sanitizeText(form.moduleKey, 80);
    const sheetName = sanitizeText(form.sheetName, 120);
    assertFieldTableAllowed_(moduleKey, sheetName);
    if (isFieldTableLocked_(sheetName)) throw new Error('ตารางนี้ถูกล็อกเพื่อรักษาความถูกต้องของหลักฐานตรวจสอบ');

    const originalKey = normalizeFieldKey_(form.originalKey || '');
    const fieldKey = normalizeFieldKey_(form.fieldKey || originalKey);
    const displayName = sanitizeText(form.displayName, 120);
    const dataType = normalizeFieldType_(form.dataType);
    const required = form.required === true || String(form.required).toLowerCase() === 'true';
    const options = normalizeFieldOptions_(form.options);

    if (!fieldKey) throw new Error('กรุณาระบุ Field key');
    if (!displayName) throw new Error('กรุณาระบุชื่อที่แสดง');
    if (dataType === 'select' && !options) throw new Error('ชนิดรายการตัวเลือกต้องระบุตัวเลือกอย่างน้อย 1 ค่า');

    const sh = ensureSheetBySchema_(sheetName);
    let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const isCreate = !originalKey;
    let targetKey = fieldKey;
    let col;
    let isSystem = false;

    if (isCreate) {
      if (findHeaderIndex_(headers, fieldKey) > -1) throw new Error('มี Field key "' + fieldKey + '" ในตารางนี้แล้ว');
      col = headers.length + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(1, col).setValue(fieldKey)
        .setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
      headers.push(fieldKey);
    } else {
      const oldIndex = findHeaderIndex_(headers, originalKey);
      if (oldIndex < 0) throw new Error('ไม่พบฟิลด์เดิม "' + originalKey + '"');
      col = oldIndex + 1;
      isSystem = (DB_SCHEMA[sheetName] || []).indexOf(originalKey) > -1;
      if (isSystem && fieldKey !== originalKey) {
        throw new Error('ฟิลด์ระบบเปลี่ยนได้เฉพาะชื่อที่แสดง ห้ามเปลี่ยน Field key');
      }
      const duplicateIndex = findHeaderIndex_(headers, fieldKey);
      if (!isSystem && fieldKey !== originalKey && duplicateIndex > -1) {
        throw new Error('มี Field key "' + fieldKey + '" ในตารางนี้แล้ว');
      }
      if (!isSystem && fieldKey !== originalKey) {
        sh.getRange(1, col).setValue(fieldKey);
        targetKey = fieldKey;
      } else {
        targetKey = originalKey;
      }
    }

    applyFieldTypeToColumn_(sh, col, dataType, options, required);
    sh.getRange(1, col).setNote(
      'ชื่อที่แสดง: ' + displayName + '\nชนิดข้อมูล: ' + getFieldTypeLabel_(dataType) +
      '\nแก้ไขจากหน้า Settings'
    );

    const existing = originalKey ? findFieldDefinition_(moduleKey, sheetName, originalKey) : null;
    const meta = {
      ModuleKey: moduleKey,
      SheetName: sheetName,
      FieldKey: targetKey,
      DisplayName: displayName,
      DataType: dataType,
      IsRequired: required ? 'Yes' : 'No',
      Options: options,
      IsSystem: (isSystem || (DB_SCHEMA[sheetName] || []).indexOf(targetKey) > -1) ? 'Yes' : 'No',
      Status: 'Active',
      UpdatedAt: new Date(),
      UpdatedBy: user.email
    };
    if (existing) {
      updateRow_(SHEETS.FIELD_DEFINITIONS, existing._row, meta, user.email);
    } else {
      meta.FieldID = generateId('FLD');
      appendRowEnsured_(SHEETS.FIELD_DEFINITIONS, meta, user.email);
    }

    writeAudit_(user, isCreate ? 'ADD_FIELD' : 'UPDATE_FIELD', 'settings', sheetName, targetKey,
      JSON.stringify({ displayName: displayName, dataType: dataType, required: required }), 'success');
    return ok((isCreate ? 'เพิ่ม' : 'ปรับปรุง') + 'ฟิลด์ "' + displayName + '" เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ลบได้เฉพาะฟิลด์ที่ผู้ดูแลเพิ่มเอง
 * ถ้ามีข้อมูลและ force !== true จะคืน requiresConfirm ให้ UI ขอคำยืนยันรอบที่สอง
 */
function deleteModuleField(moduleKey, sheetName, fieldKey, force) {
  try {
    const user = requireModule('settings', true);
    moduleKey = sanitizeText(moduleKey, 80);
    sheetName = sanitizeText(sheetName, 120);
    fieldKey = normalizeFieldKey_(fieldKey);
    assertFieldTableAllowed_(moduleKey, sheetName);
    if (isFieldTableLocked_(sheetName)) throw new Error('ตารางนี้ถูกล็อกและไม่อนุญาตให้ลบฟิลด์');
    if ((DB_SCHEMA[sheetName] || []).indexOf(fieldKey) > -1) {
      throw new Error('ไม่อนุญาตให้ลบฟิลด์ระบบ เพราะโมดูลยังอ้างอิง Field key นี้อยู่');
    }

    const sh = ensureSheetBySchema_(sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const index = findHeaderIndex_(headers, fieldKey);
    if (index < 0) throw new Error('ไม่พบฟิลด์ "' + fieldKey + '"');
    const col = index + 1;
    let valueCount = 0;
    if (sh.getLastRow() > 1) {
      valueCount = sh.getRange(2, col, sh.getLastRow() - 1, 1).getDisplayValues()
        .filter(function (r) { return String(r[0] || '').trim() !== ''; }).length;
    }
    if (valueCount > 0 && force !== true) {
      return ok({
        requiresConfirm: true,
        valueCount: valueCount,
        message: 'คอลัมน์นี้มีข้อมูล ' + valueCount + ' แถว การลบจะลบข้อมูลในคอลัมน์นี้ทั้งหมด'
      });
    }

    sh.deleteColumn(col);
    const meta = findFieldDefinition_(moduleKey, sheetName, fieldKey);
    if (meta) {
      updateRow_(SHEETS.FIELD_DEFINITIONS, meta._row, {
        Status: 'Deleted',
        UpdatedAt: new Date(),
        UpdatedBy: user.email
      }, user.email);
    }
    writeAudit_(user, 'DELETE_CUSTOM_FIELD', 'settings', sheetName, fieldKey,
      'ลบคอลัมน์พร้อมข้อมูล ' + valueCount + ' แถว', 'success');
    return ok({ requiresConfirm: false, message: 'ลบฟิลด์ "' + fieldKey + '" เรียบร้อย' });
  } catch (e) {
    return fail(e.message);
  }
}

function assertFieldTableAllowed_(moduleKey, sheetName) {
  if (!MODULE_ACCESS[moduleKey]) throw new Error('ไม่พบโมดูลที่เลือก');
  if ((MODULE_TABLE_MAP_[moduleKey] || []).indexOf(sheetName) === -1) {
    throw new Error('ตารางนี้ไม่อยู่ในโมดูลที่เลือก');
  }
  if (!DB_SCHEMA[sheetName]) throw new Error('ไม่พบ schema ของตาราง ' + sheetName);
}

function isFieldTableLocked_(sheetName) {
  return sheetName === SHEETS.AUDIT_TRAIL;
}

function normalizeFieldKey_(value) {
  const key = sanitizeText(value, 80);
  if (!key) return '';
  if (/[\r\n\t]/.test(key)) throw new Error('Field key ต้องอยู่ในบรรทัดเดียว');
  if (['_row', '__proto__', 'prototype', 'constructor'].indexOf(key) > -1) {
    throw new Error('Field key นี้เป็นคำสงวนของระบบ');
  }
  return key;
}

function normalizeFieldType_(value) {
  value = String(value || 'text').toLowerCase();
  const valid = FIELD_DATA_TYPES_.map(function (x) { return x.key; });
  return valid.indexOf(value) > -1 ? value : 'text';
}

function normalizeFieldOptions_(value) {
  const seen = {};
  return String(value || '').split(/[\n,]+/).map(function (x) {
    return sanitizeText(x, 100);
  }).filter(function (x) {
    if (!x || seen[x]) return false;
    seen[x] = true;
    return true;
  }).slice(0, 50).join('\n');
}

function inferFieldType_(fieldKey) {
  const key = String(fieldKey || '').toLowerCase();
  if (/email/.test(key)) return 'email';
  if (/(url|link)$/.test(key)) return 'url';
  if (/(date|due|expiry|expire)$/.test(key)) return 'date';
  if (/(at|timestamp)$/.test(key)) return 'datetime';
  if (/(qty|score|hours|minutes|views|helpful|count|year)$/.test(key)) return 'number';
  if (/(price|amount|cost)$/.test(key)) return 'currency';
  if (/(description|detail|notes|solution|findings|plan|scope)$/.test(key)) return 'textarea';
  if (/^(is|has|confirmed|passed)/.test(key)) return 'checkbox';
  return 'text';
}

function getFieldTypeLabel_(type) {
  for (let i = 0; i < FIELD_DATA_TYPES_.length; i++) {
    if (FIELD_DATA_TYPES_[i].key === type) return FIELD_DATA_TYPES_[i].label;
  }
  return type;
}

function applyFieldTypeToColumn_(sh, col, dataType, options, required) {
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  const range = sh.getRange(2, col, rows, 1);
  range.clearDataValidations();

  if (dataType === 'number') range.setNumberFormat('0');
  else if (dataType === 'decimal') range.setNumberFormat('0.00');
  else if (dataType === 'currency') range.setNumberFormat('#,##0.00');
  else if (dataType === 'date') range.setNumberFormat('dd/mm/yyyy');
  else if (dataType === 'datetime') range.setNumberFormat('dd/mm/yyyy hh:mm');
  else if (dataType === 'checkbox') range.setNumberFormat('General');
  else range.setNumberFormat('@');

  let rule = null;
  let builder = SpreadsheetApp.newDataValidation()
    .setHelpText('ชนิดข้อมูล: ' + getFieldTypeLabel_(dataType) + (required ? ' · ฟิลด์บังคับตาม metadata' : ''));
  if (dataType === 'checkbox') {
    rule = builder.requireCheckbox().setAllowInvalid(false).build();
  } else if (dataType === 'select') {
    rule = builder.requireValueInList(options.split('\n'), true).setAllowInvalid(false).build();
  } else if (dataType === 'email') {
    rule = builder.requireTextIsEmail().setAllowInvalid(false).build();
  } else if (dataType === 'url') {
    rule = builder.requireTextIsUrl().setAllowInvalid(false).build();
  } else if (dataType === 'date' || dataType === 'datetime') {
    rule = builder.requireDate().setAllowInvalid(false).build();
  } else if (dataType === 'number' || dataType === 'decimal' || dataType === 'currency') {
    rule = builder.requireNumberBetween(-1000000000000, 1000000000000).setAllowInvalid(false).build();
  }
  if (rule) range.setDataValidation(rule);
}

function findFieldDefinition_(moduleKey, sheetName, fieldKey) {
  const rows = readSheetObjectsEnsured_(SHEETS.FIELD_DEFINITIONS, true);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r.Status || 'Active') === 'Active' &&
        String(r.ModuleKey) === String(moduleKey) &&
        String(r.SheetName) === String(sheetName) &&
        String(r.FieldKey) === String(fieldKey)) return r;
  }
  return null;
}

function fieldDefinitionMapKey_(moduleKey, sheetName, fieldKey) {
  return [moduleKey, sheetName, fieldKey].map(String).join('::');
}

function findHeaderIndex_(headers, fieldKey) {
  const exact = headers.indexOf(fieldKey);
  if (exact > -1) return exact;
  const target = String(fieldKey).toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase() === target) return i;
  }
  return -1;
}
