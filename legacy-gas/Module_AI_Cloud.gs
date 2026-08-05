/**
 * Module_AI_Cloud.gs
 * ทะเบียนเครื่องมือ AI (AI Usage Register) + ทะเบียนระบบ Cloud (Cloud Service Register)
 * อ้างอิง: หมวด 9 (AI), หมวด 10 (Cloud)
 */

// ===== AI Register =====
function getAIModuleData() {
  try {
    const user = requireModule('ai', false);
    const items = readSheetObjects_(SHEETS.AI).map(function (r) {
      return {
        row: r._row, id: r.AIID, name: r.ToolName, vendor: r.Vendor, purpose: r.Purpose,
        allowed: r.AllowedDataTypes, prohibited: r.ProhibitedDataTypes, owner: r.Owner,
        approvalRef: r.ApprovalRef, status: r.Status, notes: r.Notes
      };
    });
    return ok({ role: user.role, canEdit: canEditModule(user.role, 'ai'), items: items });
  } catch (e) { return fail(e.message); }
}

function addAITool(form) {
  try {
    const user = requireModule('ai', true);
    form = form || {};
    const name = sanitizeText(form.name, 150);
    requireFields({ ToolName: name, Purpose: form.purpose }, ['ToolName', 'Purpose']);
    const id = generateId('AI');
    appendRow_(SHEETS.AI, {
      AIID: id, ToolName: name, Vendor: sanitizeText(form.vendor, 120),
      Purpose: sanitizeText(form.purpose, 500), AllowedDataTypes: sanitizeText(form.allowed, 500),
      ProhibitedDataTypes: sanitizeText(form.prohibited, 500), Owner: sanitizeText(form.owner, 120) || user.email,
      ApprovalRef: sanitizeText(form.approvalRef, 200), Status: 'อนุญาต', Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'ai', SHEETS.AI, id, name, 'success');
    return ok('บันทึกเครื่องมือ AI เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function setAIStatus(aiId, status) {
  try {
    const user = requireModule('ai', true);
    const a = findRow_(SHEETS.AI, 'AIID', aiId);
    if (!a) throw new Error('ไม่พบเครื่องมือ AI');
    if (!isInList(status, ['อนุญาต', 'ระงับ'])) throw new Error('สถานะไม่ถูกต้อง');
    updateRow_(SHEETS.AI, a._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE', 'ai', SHEETS.AI, aiId, 'status: ' + status, 'success');
    return ok('ปรับปรุงสถานะเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===== Cloud Register =====
function getCloudModuleData() {
  try {
    const user = requireModule('cloud', false);
    const items = readSheetObjects_(SHEETS.CLOUD).map(function (r) {
      return {
        row: r._row, id: r.CloudID, name: r.ServiceName, provider: r.Provider, purpose: r.Purpose,
        allowedClass: r.AllowedDataClass, owner: r.Owner, approvalRef: r.ApprovalRef,
        backup: r.BackupArrangement, exitPlan: r.ExitPlan, expiry: fmtDate(r.ContractExpiry),
        expiryDays: daysUntil(r.ContractExpiry), status: r.Status, notes: r.Notes
      };
    });
    return ok({
      role: user.role, canEdit: canEditModule(user.role, 'cloud'),
      classifications: CLASSIFICATIONS, items: items
    });
  } catch (e) { return fail(e.message); }
}

function addCloudService(form) {
  try {
    const user = requireModule('cloud', true);
    form = form || {};
    const name = sanitizeText(form.name, 150);
    requireFields({ ServiceName: name, Provider: form.provider }, ['ServiceName', 'Provider']);
    const id = generateId('CLD');
    appendRow_(SHEETS.CLOUD, {
      CloudID: id, ServiceName: name, Provider: sanitizeText(form.provider, 120),
      Purpose: sanitizeText(form.purpose, 500), AllowedDataClass: sanitizeText(form.allowedClass, 60),
      Owner: sanitizeText(form.owner, 120) || user.email, ApprovalRef: sanitizeText(form.approvalRef, 200),
      BackupArrangement: sanitizeText(form.backup, 500), ExitPlan: sanitizeText(form.exitPlan, 500),
      ContractExpiry: parseDate(form.expiry), Status: 'อนุญาต', Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'cloud', SHEETS.CLOUD, id, name, 'success');
    return ok('บันทึกระบบ Cloud เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function setCloudStatus(cloudId, status) {
  try {
    const user = requireModule('cloud', true);
    const c = findRow_(SHEETS.CLOUD, 'CloudID', cloudId);
    if (!c) throw new Error('ไม่พบระบบ Cloud');
    if (!isInList(status, ['อนุญาต', 'ระงับ', 'ยกเลิกใช้งาน'])) throw new Error('สถานะไม่ถูกต้อง');
    updateRow_(SHEETS.CLOUD, c._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE', 'cloud', SHEETS.CLOUD, cloudId, 'status: ' + status, 'success');
    return ok('ปรับปรุงสถานะเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
