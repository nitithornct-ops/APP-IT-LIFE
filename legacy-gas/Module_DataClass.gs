/**
 * Module_DataClass.gs
 * การจัดประเภทและคุ้มครองข้อมูล (Data Classification) + workflow ขออนุมัติทำลายข้อมูล
 *  - ระดับชั้นความลับ: ลับมาก / ลับ / ไม่ลับ
 *  - ข้อมูล "ลับมาก" ต้องได้รับอนุมัติทำลายจากผู้จัดการกองทุนฯ (Executive)
 * อ้างอิง: หมวด 4
 */

const CLASSIFICATIONS = ['ลับมาก', 'ลับ', 'ไม่ลับ'];
const DD_STATUS = { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว รอดำเนินการ', REJECTED: 'ปฏิเสธ', DONE: 'ทำลายแล้ว' };

function getDataClassModuleData() {
  try {
    const user = requireModule('dataClass', false);
    const canEdit = canEditModule(user.role, 'dataClass');
    const datasets = readSheetObjects_(SHEETS.DATA_CLASS).map(function (r) {
      return {
        row: r._row, id: r.DataID, name: r.DataName, system: r.SystemName,
        classification: r.Classification, owner: r.DataOwner, custodian: r.Custodian,
        storage: r.StorageMethod, retention: r.RetentionPeriod,
        destructionDue: fmtDate(r.DestructionDue), destructionDays: daysUntil(r.DestructionDue),
        pii: r.ContainsPersonalData, status: r.Status
      };
    });
    const destructions = readSheetObjects_(SHEETS.DATA_DESTROY).map(function (r) {
      return {
        row: r._row, reqId: r.ReqID, dataId: r.DataID, dataName: r.DataName,
        classification: r.Classification, reason: r.Reason, requester: r.Requester,
        requestDate: fmtDate(r.RequestDate), approverRequired: r.ApproverRequired,
        approver: r.Approver, approveDate: fmtDate(r.ApproveDate), status: r.Status,
        method: r.DestroyMethod, destroyDate: fmtDate(r.DestroyDate),
        destroyedBy: r.DestroyedBy, evidence: r.EvidenceLink
      };
    });
    return ok({
      role: user.role, canEdit: canEdit,
      isExecutive: user.role === ROLES.EXECUTIVE, isIT: user.role === ROLES.IT_ADMIN,
      classifications: CLASSIFICATIONS, datasets: datasets, destructions: destructions
    });
  } catch (e) { return fail(e.message); }
}

function addDataset(form) {
  try {
    const user = requireModule('dataClass', true);
    form = form || {};
    const name = sanitizeText(form.name, 150);
    requireFields({ DataName: name, Classification: form.classification }, ['DataName', 'Classification']);
    if (!isInList(form.classification, CLASSIFICATIONS)) throw new Error('ระดับชั้นความลับไม่ถูกต้อง');
    const id = generateId('DAT');
    appendRow_(SHEETS.DATA_CLASS, {
      DataID: id, DataName: name, SystemName: sanitizeText(form.system, 120),
      Classification: form.classification, DataOwner: sanitizeText(form.owner, 120) || user.email,
      Custodian: sanitizeText(form.custodian, 120), StorageMethod: sanitizeText(form.storage, 200),
      RetentionPeriod: sanitizeText(form.retention, 60), DestructionDue: parseDate(form.destructionDue),
      ContainsPersonalData: (String(form.pii).toLowerCase() === 'yes') ? 'Yes' : 'No',
      Status: 'ใช้งาน', Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'dataClass', SHEETS.DATA_CLASS, id, name + ' (' + form.classification + ')', 'success');
    return ok('บันทึกชุดข้อมูลเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

/** ยื่นคำขอทำลายข้อมูล */
function requestDestruction(dataId, reason) {
  try {
    const user = requireModule('dataClass', true);
    const data = findRow_(SHEETS.DATA_CLASS, 'DataID', dataId);
    if (!data) throw new Error('ไม่พบชุดข้อมูล');
    requireFields({ reason: reason }, ['reason']);
    const needExec = data.Classification === 'ลับมาก';
    const reqId = generateId('DDR');
    appendRow_(SHEETS.DATA_DESTROY, {
      ReqID: reqId, DataID: dataId, DataName: data.DataName, Classification: data.Classification,
      Reason: sanitizeText(reason, 1000), Requester: user.email, RequestDate: new Date(),
      ApproverRequired: needExec ? 'ผู้จัดการกองทุนฯ (Executive)' : 'ส่วนงานไอที (IT Admin)',
      Status: DD_STATUS.PENDING
    }, user.email);
    writeAudit_(user, 'REQUEST_DESTROY', 'dataClass', SHEETS.DATA_DESTROY, reqId,
      data.DataName + ' (' + data.Classification + ')', 'success');

    const to = needExec ? getDataClassExecutiveEmails_().join(',') : getITAdminEmails_().join(',');
    notify_(to, 'คำขออนุมัติทำลายข้อมูล (' + reqId + ')',
      '<p>มีคำขอทำลายข้อมูล <b>' + escapeHtml(data.DataName) + '</b> (ชั้น ' + escapeHtml(data.Classification) +
      ')<br>เหตุผล: ' + escapeHtml(sanitizeText(reason, 1000)) + '</p>',
      'คำขอทำลายข้อมูล ' + reqId + ': ' + data.DataName, 'dataClass', reqId);
    return ok('ส่งคำขอทำลายข้อมูลเรียบร้อย (' + reqId + ')' + (needExec ? ' — รออนุมัติจากผู้จัดการกองทุนฯ' : ''));
  } catch (e) { return fail(e.message); }
}

/** อนุมัติ/ปฏิเสธคำขอทำลายข้อมูล (Executive สำหรับลับมาก, IT สำหรับอื่น) */
function approveDestruction(reqId, approve, comment) {
  try {
    const user = getCurrentUser();
    const req = findRow_(SHEETS.DATA_DESTROY, 'ReqID', reqId);
    if (!req) throw new Error('ไม่พบคำขอ');
    if (req.Status !== DD_STATUS.PENDING) throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    const needExec = req.Classification === 'ลับมาก';
    const allowed = needExec ? (user.role === ROLES.EXECUTIVE) : (user.role === ROLES.IT_ADMIN);
    if (!allowed) {
      writeAudit_(user, 'APPROVE_DENIED', 'dataClass', SHEETS.DATA_DESTROY, reqId, 'ผู้อนุมัติไม่ถูกต้อง', 'denied');
      throw new Error('การอนุมัติทำลายข้อมูลชั้น "' + req.Classification + '" สงวนสำหรับ ' +
        (needExec ? 'ผู้จัดการกองทุนฯ' : 'ส่วนงานไอที'));
    }
    if (String(req.Requester).toLowerCase() === user.email) {
      writeAudit_(user, 'APPROVE_DENIED', 'dataClass', SHEETS.DATA_DESTROY, reqId,
        'ผู้ยื่นคำขอห้ามอนุมัติการทำลายข้อมูลของตนเอง', 'denied');
      throw new Error('ผู้ยื่นคำขอไม่สามารถอนุมัติการทำลายข้อมูลรายการเดียวกันได้');
    }
    updateRow_(SHEETS.DATA_DESTROY, req._row, {
      Approver: user.email, ApproveDate: new Date(),
      Status: approve ? DD_STATUS.APPROVED : DD_STATUS.REJECTED,
      Notes: sanitizeText(comment, 500)
    }, user.email);
    writeAudit_(user, approve ? 'APPROVE_DESTROY' : 'REJECT_DESTROY', 'dataClass', SHEETS.DATA_DESTROY, reqId,
      sanitizeText(comment, 500), 'success');
    notify_(req.Requester, 'ผลพิจารณาคำขอทำลายข้อมูล ' + reqId,
      '<p>คำขอ ' + escapeHtml(reqId) + ' ได้รับการ' + (approve ? 'อนุมัติ (รอดำเนินการทำลาย)' : 'ปฏิเสธ') + '</p>',
      'คำขอทำลายข้อมูล ' + reqId + ' ' + (approve ? 'อนุมัติ' : 'ปฏิเสธ'), 'dataClass', reqId);
    return ok(approve ? 'อนุมัติเรียบร้อย' : 'ปฏิเสธเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** บันทึกการทำลายข้อมูลจริง (IT) */
function confirmDestroyed(reqId, method, evidence) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const req = findRow_(SHEETS.DATA_DESTROY, 'ReqID', reqId);
    if (!req) throw new Error('ไม่พบคำขอ');
    if (req.Status !== DD_STATUS.APPROVED) throw new Error('คำขอยังไม่ได้รับอนุมัติ');
    if (String(req.Approver).toLowerCase() === user.email) {
      writeAudit_(user, 'DESTROY_DENIED', 'dataClass', SHEETS.DATA_DESTROY, reqId,
        'ผู้อนุมัติห้ามเป็นผู้ดำเนินการทำลาย', 'denied');
      throw new Error('ผู้อนุมัติไม่สามารถเป็นผู้ดำเนินการทำลายข้อมูลรายการเดียวกันได้');
    }
    requireFields({ method: method }, ['method']);
    updateRow_(SHEETS.DATA_DESTROY, req._row, {
      Status: DD_STATUS.DONE, DestroyMethod: sanitizeText(method, 300),
      DestroyDate: new Date(), DestroyedBy: user.email, EvidenceLink: sanitizeText(evidence, 500)
    }, user.email);
    // อัปเดตสถานะชุดข้อมูล
    const data = findRow_(SHEETS.DATA_CLASS, 'DataID', req.DataID);
    if (data) updateRow_(SHEETS.DATA_CLASS, data._row, { Status: 'ทำลายแล้ว' }, user.email);
    writeAudit_(user, 'CONFIRM_DESTROY', 'dataClass', SHEETS.DATA_DESTROY, reqId, method, 'success');
    return ok('บันทึกการทำลายข้อมูลเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function getDataClassExecutiveEmails_() {
  try {
    return readSheetObjects_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.EXECUTIVE && String(u.Status).toLowerCase() === 'active'; })
      .map(function (u) { return u.Email; });
  } catch (e) { return []; }
}
