/**
 * DeleteService.gs
 * ระบบลบแบบ "ย้ายไปถังขยะ" (soft-delete) ที่กู้คืนได้ ใช้ร่วมทุกโมดูล
 *
 * แนวคิด: ทำเครื่องหมายแถวด้วยคอลัมน์ IsDeleted/DeletedAt/DeletedBy แทนการลบจริง
 * แถวที่ถูกลบจะถูกซ่อนอัตโนมัติจากทุกตาราง (ดู Utils.gs > readSheetObjects_)
 * แต่ยังเก็บไว้ในชีตเพื่อให้กู้คืนและตรวจสอบย้อนหลัง (AuditTrail) ได้
 */

// คอลัมน์เมทาดาทาสำหรับ soft-delete (เติมท้ายตารางอัตโนมัติเมื่อใช้งานครั้งแรก)
function appLifeDeleteColumns_() {
  return ['IsDeleted', 'DeletedAt', 'DeletedBy'];
}

/**
 * ทะเบียนรายการที่อนุญาตให้ลบได้ (entity -> ข้อมูลตาราง/สิทธิ์)
 * perm = moduleKey ที่ใช้ตรวจสิทธิ์ (requireModule) · nameCol = คอลัมน์ชื่อสำหรับแสดงในถังขยะ
 */
function appLifeDeletableEntities_() {
  return {
    asset:       { sheet: SHEETS.ASSET,            idCol: 'AssetID',       perm: 'asset',       label: 'ทรัพย์สิน IT',    nameCol: 'AssetName' },
    vendor:      { sheet: SHEETS.VENDOR,           idCol: 'VendorID',      perm: 'vendor',      label: 'ผู้ให้บริการ',     nameCol: 'VendorName' },
    license:     { sheet: SHEETS.SOFTWARE_LICENSE, idCol: 'LicenseID',     perm: 'license',     label: 'Software License', nameCol: 'SoftwareName' },
    inventory:   { sheet: SHEETS.INVENTORY,        idCol: 'ItemID',        perm: 'inventory',   label: 'รายการคลัง',       nameCol: 'ItemName' },
    maintenance: { sheet: SHEETS.MAINTENANCE,      idCol: 'MaintenanceID', perm: 'maintenance', label: 'แผนบำรุงรักษา',    nameCol: 'AssetName' },
    kb:          { sheet: SHEETS.KB,               idCol: 'ArticleID',     perm: 'kb',          label: 'บทความ KB',        nameCol: 'Title' },
    ai:          { sheet: SHEETS.AI,               idCol: 'AIID',          perm: 'ai',          label: 'เครื่องมือ AI',     nameCol: 'ToolName' },
    cloud:       { sheet: SHEETS.CLOUD,            idCol: 'CloudID',       perm: 'cloud',       label: 'บริการ Cloud',     nameCol: 'ServiceName' },
    ticket:      { sheet: SHEETS.TICKET,           idCol: 'TicketID',      perm: 'ticket',      label: 'Ticket',           nameCol: 'Title', roles: [ROLES.IT_ADMIN] },
    incident:    { sheet: SHEETS.INCIDENT,         idCol: 'IncidentID',    perm: 'incident',    label: 'เหตุการณ์',         nameCol: 'Title' },
    risk:        { sheet: SHEETS.RISK,             idCol: 'RiskID',        perm: 'risk',        label: 'ความเสี่ยง',        nameCol: 'Title' },
    dataset:     { sheet: SHEETS.DATA_CLASS,       idCol: 'DataID',        perm: 'dataClass',   label: 'ชุดข้อมูล',         nameCol: 'DataName' },
    change:      { sheet: SHEETS.CHANGE,           idCol: 'ChangeID',      perm: 'change',      label: 'คำขอเปลี่ยนแปลง',   nameCol: 'Title' },
    backup:      { sheet: SHEETS.BACKUP,           idCol: 'BackupID',      perm: 'backup',      label: 'บันทึกสำรองข้อมูล', nameCol: 'SystemName' },
    recovery:    { sheet: SHEETS.RECOVERY,         idCol: 'TestID',        perm: 'backup',      label: 'ผลทดสอบกู้คืน', nameCol: 'SystemName' },
    bcp:         { sheet: SHEETS.BCP,              idCol: 'PlanID',        perm: 'backup',      label: 'แผนฉุกเฉิน BCP/DR', nameCol: 'PlanName' },
    qa:          { sheet: SHEETS.QA_TEST,          idCol: 'CaseID',        perm: 'tester',      label: 'เคสทดสอบ QA',      nameCol: 'Scenario' }
  };
}

/** เติมคอลัมน์ IsDeleted/DeletedAt/DeletedBy ให้ชีต (ถ้ายังไม่มี) แล้วคืน sheet */
function ensureDeleteColumns_(sheetName) {
  const sh = getSheet_(sheetName);
  ensureSheetColumns_(sh, getHeaders_(sheetName).concat(appLifeDeleteColumns_()));
  return sh;
}

function _findRowIncludingDeleted_(sheetName, idCol, id) {
  const rows = readSheetObjects_(sheetName, true);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(id)) return rows[i];
  }
  return null;
}

/** ลบรายการแบบ soft-delete (ย้ายไปถังขยะ) — client เรียกผ่าน api() */
function softDeleteRecord(entity, id) {
  try {
    const meta = appLifeDeletableEntities_()[entity];
    if (!meta) throw new Error('ไม่รองรับการลบรายการประเภทนี้');
    const user = requireModule(meta.perm, true);
    if (meta.roles && meta.roles.indexOf(user.role) === -1) {
      throw new Error('เฉพาะผู้ดูแลระบบ IT เท่านั้นที่ลบรายการประเภทนี้ได้');
    }
    id = sanitizeText(id, 120);
    if (!id) throw new Error('ไม่พบรหัสรายการที่ต้องการลบ');
    ensureDeleteColumns_(meta.sheet);
    const row = _findRowIncludingDeleted_(meta.sheet, meta.idCol, id);
    if (!row) throw new Error('ไม่พบรายการที่ต้องการลบ');
    if (_isDeletedRow_(row)) throw new Error('รายการนี้ถูกลบไปแล้ว');
    updateRow_(meta.sheet, row._row, {
      IsDeleted: 'yes', DeletedAt: new Date(), DeletedBy: user.email
    }, user.email);
    writeAudit_(user, 'DELETE', meta.perm, meta.sheet, id,
      'soft-delete: ' + (row[meta.nameCol] || ''), 'success');
    return ok('ลบเรียบร้อย — ย้ายไปถังขยะแล้ว (กู้คืนได้จากหน้า Settings)');
  } catch (e) {
    return fail(e.message);
  }
}

/** กู้คืนรายการจากถังขยะ */
function restoreRecord(entity, id) {
  try {
    const meta = appLifeDeletableEntities_()[entity];
    if (!meta) throw new Error('ไม่รองรับการกู้คืนรายการประเภทนี้');
    const user = requireModule(meta.perm, true);
    if (meta.roles && meta.roles.indexOf(user.role) === -1) {
      throw new Error('เฉพาะผู้ดูแลระบบ IT เท่านั้นที่กู้คืนรายการประเภทนี้ได้');
    }
    id = sanitizeText(id, 120);
    ensureDeleteColumns_(meta.sheet);
    const row = _findRowIncludingDeleted_(meta.sheet, meta.idCol, id);
    if (!row) throw new Error('ไม่พบรายการที่ต้องการกู้คืน');
    if (!_isDeletedRow_(row)) throw new Error('รายการนี้ไม่ได้อยู่ในถังขยะ');
    updateRow_(meta.sheet, row._row, { IsDeleted: '', DeletedAt: '', DeletedBy: '' }, user.email);
    writeAudit_(user, 'RESTORE', meta.perm, meta.sheet, id,
      'restore: ' + (row[meta.nameCol] || ''), 'success');
    return ok('กู้คืนรายการเรียบร้อยแล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

/** รายการในถังขยะทุกประเภท (เฉพาะผู้มีสิทธิ์ Settings) */
function listDeletedRecords() {
  try {
    const user = requireModule('settings', false);
    const items = [];
    const entities = appLifeDeletableEntities_();
    Object.keys(entities).forEach(function (entity) {
      const meta = entities[entity];
      let rows;
      try { rows = readSheetObjects_(meta.sheet, true); } catch (e) { return; }
      rows.forEach(function (r) {
        if (!_isDeletedRow_(r)) return;
        items.push({
          entity: entity,
          entityLabel: meta.label,
          id: r[meta.idCol],
          name: r[meta.nameCol] || r[meta.idCol],
          deletedAt: safeFmtDateTime_(r.DeletedAt),
          deletedBy: r.DeletedBy || '-'
        });
      });
    });
    items.sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
    return ok({ canRestore: canEditModule(user.role, 'settings'), count: items.length, items: items });
  } catch (e) {
    return fail(e.message);
  }
}
