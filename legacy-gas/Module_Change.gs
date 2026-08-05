/**
 * Module_Change.gs
 * การควบคุมการเปลี่ยนแปลงระบบงาน (Change Management)
 * Workflow: Request → Impact Assessment → Test sign-off → Approve → Deploy (+ version/rollback plan)
 * อ้างอิง: การควบคุมการพัฒนา/แก้ไขระบบ
 */

const CHG_STATUS = {
  REQUESTED: 'ยื่นคำขอ', TESTED: 'ผ่านการทดสอบ', APPROVED: 'อนุมัติแล้ว',
  DEPLOYED: 'ติดตั้งใช้งานแล้ว', REJECTED: 'ปฏิเสธ'
};
const CHG_RISK = ['สูง', 'กลาง', 'ต่ำ'];

function getChangeModuleData() {
  try {
    const user = requireModule('change', false);
    const canEdit = canEditModule(user.role, 'change');
    const changes = readSheetObjects_(SHEETS.CHANGE).map(function (r) {
      return {
        row: r._row, id: r.ChangeID, title: r.Title, system: r.SystemAffected, type: r.ChangeType,
        description: r.Description, requester: r.Requester, requestDate: fmtDate(r.RequestDate),
        impact: r.ImpactAssessment, risk: r.RiskLevel, testResult: r.TestResult,
        testBy: r.TestSignOffBy, approver: r.Approver, approveDate: fmtDate(r.ApproveDate),
        approveResult: r.ApproveResult, deployDate: fmtDate(r.DeployDate), deployBy: r.DeployBy, version: r.Version,
        rollback: r.RollbackPlan, status: r.Status
      };
    }).reverse();
    return ok({
      role: user.role, canEdit: canEdit,
      isApprover: user.role === ROLES.APPROVER || user.role === ROLES.IT_ADMIN,
      isIT: user.role === ROLES.IT_ADMIN, risks: CHG_RISK, changes: changes
    });
  } catch (e) { return fail(e.message); }
}

function submitChange(form) {
  try {
    const user = requireModule('change', true);
    form = form || {};
    const title = sanitizeText(form.title, 200);
    requireFields({ Title: title, SystemAffected: form.system, Description: form.description },
      ['Title', 'SystemAffected', 'Description']);
    if (form.risk && !isInList(form.risk, CHG_RISK)) throw new Error('ระดับความเสี่ยงไม่ถูกต้อง');
    const id = generateId('CHG');
    appendRow_(SHEETS.CHANGE, {
      ChangeID: id, Title: title, SystemAffected: sanitizeText(form.system, 150),
      ChangeType: sanitizeText(form.type, 60), Description: sanitizeText(form.description, 3000),
      Requester: user.email, RequestDate: new Date(), ImpactAssessment: sanitizeText(form.impact, 2000),
      RiskLevel: sanitizeText(form.risk, 20), Status: CHG_STATUS.REQUESTED,
      RollbackPlan: sanitizeText(form.rollback, 2000)
    }, user.email);
    writeAudit_(user, 'CREATE', 'change', SHEETS.CHANGE, id, title, 'success');
    notify_(getITAdminEmails_().join(','), 'คำขอเปลี่ยนแปลงระบบใหม่ ' + id,
      '<p>มีคำขอเปลี่ยนแปลง: ' + escapeHtml(title) + ' (ระบบ ' + escapeHtml(form.system) + ')</p>',
      'Change ใหม่ ' + id + ': ' + title, 'change', id);
    return ok('บันทึกคำขอเปลี่ยนแปลงเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function signOffTest(changeId, result, passed) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const c = findRow_(SHEETS.CHANGE, 'ChangeID', changeId);
    if (!c) throw new Error('ไม่พบคำขอเปลี่ยนแปลง');
    if (c.Status !== CHG_STATUS.REQUESTED) throw new Error('บันทึกผลทดสอบได้เฉพาะคำขอที่อยู่ในสถานะยื่นคำขอ');
    if (String(c.Requester).toLowerCase() === user.email) {
      writeAudit_(user, 'TEST_SIGNOFF_DENIED', 'change', SHEETS.CHANGE, changeId,
        'ผู้ยื่นคำขอห้ามรับรองผลทดสอบของตนเอง', 'denied');
      throw new Error('ผู้ยื่นคำขอไม่สามารถเป็นผู้รับรองผลทดสอบรายการเดียวกันได้');
    }
    requireFields({ result: result }, ['result']);
    updateRow_(SHEETS.CHANGE, c._row, {
      TestResult: sanitizeText(result, 1000), TestSignOffBy: user.email,
      Status: passed ? CHG_STATUS.TESTED : CHG_STATUS.REQUESTED
    }, user.email);
    writeAudit_(user, 'TEST_SIGNOFF', 'change', SHEETS.CHANGE, changeId, result, 'success');
    return ok('บันทึกผลการทดสอบเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function approveChange(changeId, approve, comment) {
  try {
    const user = requireRole([ROLES.APPROVER, ROLES.IT_ADMIN]);
    const c = findRow_(SHEETS.CHANGE, 'ChangeID', changeId);
    if (!c) throw new Error('ไม่พบคำขอเปลี่ยนแปลง');
    if (c.Status !== CHG_STATUS.TESTED) throw new Error('คำขอต้องผ่านการทดสอบก่อนอนุมัติ');
    if (String(c.Requester).toLowerCase() === user.email) {
      writeAudit_(user, 'APPROVE_DENIED', 'change', SHEETS.CHANGE, changeId,
        'ผู้ยื่นคำขอห้ามอนุมัติคำขอของตนเอง', 'denied');
      throw new Error('ผู้ยื่นคำขอไม่สามารถอนุมัติ Change ของตนเองได้');
    }
    if (String(c.TestSignOffBy).toLowerCase() === user.email) {
      writeAudit_(user, 'APPROVE_DENIED', 'change', SHEETS.CHANGE, changeId,
        'ผู้รับรองผลทดสอบห้ามเป็นผู้อนุมัติ', 'denied');
      throw new Error('ผู้รับรองผลทดสอบไม่สามารถเป็นผู้อนุมัติ Change รายการเดียวกันได้');
    }
    updateRow_(SHEETS.CHANGE, c._row, {
      Approver: user.email, ApproveDate: new Date(),
      ApproveResult: (approve ? 'อนุมัติ' : 'ปฏิเสธ') + (comment ? ' - ' + sanitizeText(comment, 500) : ''),
      Status: approve ? CHG_STATUS.APPROVED : CHG_STATUS.REJECTED
    }, user.email);
    writeAudit_(user, approve ? 'APPROVE' : 'REJECT', 'change', SHEETS.CHANGE, changeId, sanitizeText(comment, 500), 'success');
    notify_(c.Requester, 'ผลพิจารณาคำขอเปลี่ยนแปลง ' + changeId,
      '<p>คำขอ ' + escapeHtml(changeId) + ' ' + (approve ? 'ได้รับการอนุมัติ' : 'ถูกปฏิเสธ') + '</p>',
      'Change ' + changeId + ' ' + (approve ? 'อนุมัติ' : 'ปฏิเสธ'), 'change', changeId);
    return ok(approve ? 'อนุมัติเรียบร้อย' : 'ปฏิเสธเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function deployChange(changeId, version, rollback) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const c = findRow_(SHEETS.CHANGE, 'ChangeID', changeId);
    if (!c) throw new Error('ไม่พบคำขอเปลี่ยนแปลง');
    if (c.Status !== CHG_STATUS.APPROVED) throw new Error('คำขอต้องได้รับอนุมัติก่อนติดตั้ง');
    if (String(c.Approver).toLowerCase() === user.email) {
      writeAudit_(user, 'DEPLOY_DENIED', 'change', SHEETS.CHANGE, changeId,
        'ผู้อนุมัติห้ามเป็นผู้ติดตั้ง', 'denied');
      throw new Error('ผู้อนุมัติไม่สามารถเป็นผู้ติดตั้ง Change รายการเดียวกันได้');
    }
    requireFields({ version: version }, ['version']);
    updateRow_(SHEETS.CHANGE, c._row, {
      DeployDate: new Date(), DeployBy: user.email, Version: sanitizeText(version, 60),
      RollbackPlan: sanitizeText(rollback, 2000) || c.RollbackPlan, Status: CHG_STATUS.DEPLOYED
    }, user.email);
    writeAudit_(user, 'DEPLOY', 'change', SHEETS.CHANGE, changeId, 'version ' + version, 'success');
    return ok('บันทึกการติดตั้งใช้งานเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
