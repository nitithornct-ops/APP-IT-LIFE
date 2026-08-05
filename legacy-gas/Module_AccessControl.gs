/**
 * Module_AccessControl.gs
 * การบริหารสิทธิ์การเข้าถึงระบบ (Access Request Workflow + RBAC Registry)
 *
 * Workflow: ผู้ใช้ยื่นคำขอ → หัวหน้างานอนุมัติ → IT ดำเนินการ → บันทึกสิทธิ์ + ตั้งรอบทบทวน
 * รองรับ: ทบทวนสิทธิ์ตามรอบ, เพิกถอนสิทธิ์, ระงับสิทธิ์เมื่อพ้นสภาพพนักงาน
 * อ้างอิง: การกำหนดอำนาจหน้าที่ + หมวด 3, 5
 */

const AC_STATUS = {
  PENDING_APPROVE: 'รออนุมัติจากหัวหน้างาน',
  PENDING_IT: 'รอส่วนงานไอทีดำเนินการ',
  DONE: 'เสร็จสิ้น',
  REJECTED: 'ปฏิเสธ'
};

function getReviewCycleDays() {
  return parseInt(getConfig_('REVIEW_CYCLE_DAYS', '180'), 10);
}

function getAccessSystems() {
  const raw = getConfig_('ACCESS_SYSTEMS',
    'ระบบสารบรรณอิเล็กทรอนิกส์,ระบบบัญชีและการเงิน,ระบบฐานข้อมูลผู้เอาประกัน,Google Workspace,ระบบเครือข่าย/VPN');
  return raw.split(',').map(function (s) { return s.trim(); }).filter(String);
}

/** ข้อมูลสำหรับหน้าจอ (ตามบทบาท) */
function getAccessModuleData() {
  try {
    const user = requireModule('access', false);
    const canEdit = canEditModule(user.role, 'access');
    const all = readSheetObjects_(SHEETS.ACCESS_REQ);

    const myRequests = all.filter(function (r) {
      return String(r.RequesterEmail).toLowerCase() === user.email;
    }).map(serializeReq);

    let pendingApprovals = [];
    if (user.role === ROLES.APPROVER || user.role === ROLES.IT_ADMIN) {
      pendingApprovals = all.filter(function (r) {
        return r.Status === AC_STATUS.PENDING_APPROVE &&
          (user.role === ROLES.IT_ADMIN || String(r.Approver).toLowerCase() === user.email);
      }).map(serializeReq);
    }

    let pendingIT = [], registry = [], allRequests = [];
    if (user.role === ROLES.IT_ADMIN) {
      pendingIT = all.filter(function (r) { return r.Status === AC_STATUS.PENDING_IT; }).map(serializeReq);
      allRequests = all.map(serializeReq);
      registry = readSheetObjects_(SHEETS.ACCESS_REGISTRY).map(function (r) {
        const d = daysUntil(r.NextReviewDue);
        return {
          row: r._row, accessId: r.AccessID, userEmail: r.UserEmail, userName: r.UserName,
          system: r.SystemName, level: r.AccessLevel, status: r.Status,
          grantDate: fmtDate(r.GrantDate), lastReview: fmtDate(r.LastReviewDate),
          nextReview: fmtDate(r.NextReviewDue), reviewDays: d
        };
      });
    }

    return ok({
      role: user.role, canEdit: canEdit, systems: getAccessSystems(),
      myRequests: myRequests, pendingApprovals: pendingApprovals,
      pendingIT: pendingIT, allRequests: allRequests, registry: registry
    });
  } catch (e) {
    return fail(e.message);
  }
}

function serializeReq(r) {
  return {
    row: r._row, reqId: r.ReqID, requester: r.RequesterName, requesterEmail: r.RequesterEmail,
    dept: r.Department, system: r.SystemName, level: r.AccessLevel, type: r.RequestType,
    reason: r.Reason, status: r.Status, approver: r.Approver,
    approvedBy: r.ApprovedBy,
    requestDate: fmtDate(r.RequestDate), approveDate: fmtDate(r.ApproveDate),
    approveResult: r.ApproveResult, itResult: r.ITResult, notes: r.Notes
  };
}

/** ยื่นคำขอสิทธิ์ */
function submitAccessRequest(form) {
  try {
    const user = requireModule('access', true);
    form = form || {};
    const system = sanitizeText(form.system, 120);
    const level = sanitizeText(form.level, 40);
    const reason = sanitizeText(form.reason, 1000);
    const type = sanitizeText(form.type, 40) || 'ขอเพิ่มสิทธิ์';

    requireFields({ SystemName: system, AccessLevel: level, Reason: reason },
      ['SystemName', 'AccessLevel', 'Reason']);
    if (!isInList(level, ['Admin', 'Standard'])) throw new Error('ระดับสิทธิ์ต้องเป็น Admin หรือ Standard');
    if (!isInList(system, getAccessSystems())) throw new Error('กรุณาเลือกระบบงานจากรายการที่กำหนด');

    // หาผู้อนุมัติจากหัวหน้างาน (Supervisor) ของผู้ยื่น
    const me = findRow_(SHEETS.USERS, 'Email', user.email);
    const approver = (me && me.Supervisor) ? String(me.Supervisor).toLowerCase() : '';
    if (!approver || !isValidEmail(approver)) {
      throw new Error('ยังไม่ได้กำหนดหัวหน้างาน (Supervisor) ของท่านในทะเบียนผู้ใช้ กรุณาติดต่อส่วนงานไอที');
    }

    const reqId = generateId('ACR');
    appendRow_(SHEETS.ACCESS_REQ, {
      ReqID: reqId, RequesterEmail: user.email, RequesterName: user.name, Department: user.dept,
      SystemName: system, AccessLevel: level, Reason: reason, RequestType: type,
      RequestDate: new Date(), Approver: approver, Status: AC_STATUS.PENDING_APPROVE
    }, user.email);

    writeAudit_(user, 'CREATE', 'access', SHEETS.ACCESS_REQ, reqId, 'ยื่นคำขอสิทธิ์ ' + system + '/' + level, 'success');

    const link = getWebAppUrl();
    notify_(approver, 'มีคำขอสิทธิ์รออนุมัติ (' + reqId + ')',
      '<p>เรียน หัวหน้างาน</p><p>' + escapeHtml(user.name) + ' ยื่นคำขอสิทธิ์:</p>' +
      '<ul><li>ระบบ: ' + escapeHtml(system) + '</li><li>ระดับ: ' + escapeHtml(level) +
      '</li><li>เหตุผล: ' + escapeHtml(reason) + '</li></ul>' +
      '<p>โปรดเข้าระบบเพื่อพิจารณา: <a href="' + link + '">' + link + '</a></p>',
      'คำขอสิทธิ์ใหม่ ' + reqId + ' จาก ' + user.name + ' (' + system + '/' + level + ') รออนุมัติ',
      'access', reqId);

    return ok('ส่งคำขอเรียบร้อย เลขที่ ' + reqId);
  } catch (e) {
    return fail(e.message);
  }
}

/** หัวหน้างานอนุมัติ/ปฏิเสธ */
function approveAccessRequest(reqId, approve, comment) {
  try {
    const user = requireModule('access', true);
    const req = findRow_(SHEETS.ACCESS_REQ, 'ReqID', reqId);
    if (!req) throw new Error('ไม่พบคำขอเลขที่ ' + reqId);
    if (req.Status !== AC_STATUS.PENDING_APPROVE) throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    if (String(req.RequesterEmail).toLowerCase() === user.email) {
      writeAudit_(user, 'APPROVE_DENIED', 'access', SHEETS.ACCESS_REQ, reqId,
        'ผู้ยื่นคำขอห้ามอนุมัติคำขอของตนเอง', 'denied');
      throw new Error('ไม่สามารถอนุมัติคำขอสิทธิ์ของตนเองได้');
    }

    // ตรวจสิทธิ์: ต้องเป็นผู้อนุมัติที่ถูก route หรือ IT Admin เท่านั้น
    if (user.role !== ROLES.IT_ADMIN && String(req.Approver).toLowerCase() !== user.email) {
      writeAudit_(user, 'APPROVE_DENIED', 'access', SHEETS.ACCESS_REQ, reqId, 'ไม่ใช่ผู้อนุมัติที่กำหนด', 'denied');
      throw new Error('ท่านไม่ใช่ผู้อนุมัติที่ได้รับมอบหมายสำหรับคำขอนี้');
    }

    const note = sanitizeText(comment, 500);
    const newStatus = approve ? AC_STATUS.PENDING_IT : AC_STATUS.REJECTED;
    updateRow_(SHEETS.ACCESS_REQ, req._row, {
      ApprovedBy: user.email,
      ApproveDate: new Date(), ApproveResult: (approve ? 'อนุมัติ' : 'ปฏิเสธ') + (note ? ' - ' + note : ''),
      Status: newStatus
    }, user.email);

    writeAudit_(user, approve ? 'APPROVE' : 'REJECT', 'access', SHEETS.ACCESS_REQ, reqId, note, 'success');

    const link = getWebAppUrl();
    if (approve) {
      notify_(getITAdminEmails_().join(','), 'คำขอสิทธิ์ผ่านการอนุมัติ รอดำเนินการ (' + reqId + ')',
        '<p>คำขอ ' + escapeHtml(reqId) + ' (' + escapeHtml(req.SystemName) + '/' + escapeHtml(req.AccessLevel) +
        ') ผ่านการอนุมัติแล้ว โปรดดำเนินการ: <a href="' + link + '">' + link + '</a></p>',
        'คำขอ ' + reqId + ' อนุมัติแล้ว รอไอทีดำเนินการ', 'access', reqId);
    }
    notify_(req.RequesterEmail, 'ผลการพิจารณาคำขอสิทธิ์ ' + reqId,
      '<p>คำขอ ' + escapeHtml(reqId) + ' ได้รับการ' + (approve ? 'อนุมัติ' : 'ปฏิเสธ') +
      (note ? '<br>หมายเหตุ: ' + escapeHtml(note) : '') + '</p>',
      'คำขอ ' + reqId + ' ' + (approve ? 'อนุมัติแล้ว' : 'ถูกปฏิเสธ'), 'access', reqId);

    return ok(approve ? 'อนุมัติเรียบร้อย ส่งต่อให้ไอที' : 'บันทึกการปฏิเสธเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** IT ดำเนินการให้สิทธิ์จริง → บันทึกลงทะเบียน RBAC */
function itProcessAccessRequest(reqId, success, notes) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const req = findRow_(SHEETS.ACCESS_REQ, 'ReqID', reqId);
    if (!req) throw new Error('ไม่พบคำขอเลขที่ ' + reqId);
    if (req.Status !== AC_STATUS.PENDING_IT) throw new Error('คำขอนี้ยังไม่ผ่านการอนุมัติ');
    const approvedBy = String(req.ApprovedBy || req.Approver || '').toLowerCase();
    if (!approvedBy) throw new Error('คำขอนี้ไม่มีข้อมูลผู้อนุมัติ กรุณาส่งกลับเข้าสู่ขั้นตอนอนุมัติ');
    if (approvedBy === user.email) {
      writeAudit_(user, 'IT_PROCESS_DENIED', 'access', SHEETS.ACCESS_REQ, reqId,
        'ผู้อนุมัติห้ามเป็นผู้ดำเนินการให้สิทธิ์', 'denied');
      throw new Error('ผู้อนุมัติไม่สามารถเป็นผู้ดำเนินการให้สิทธิ์รายการเดียวกันได้');
    }
    if (success && req.RequestType !== 'เพิกถอนสิทธิ์') {
      const duplicate = readSheetObjects_(SHEETS.ACCESS_REGISTRY).some(function (r) {
        return String(r.UserEmail).toLowerCase() === String(req.RequesterEmail).toLowerCase() &&
          String(r.SystemName) === String(req.SystemName) &&
          String(r.AccessLevel) === String(req.AccessLevel) &&
          String(r.Status).toLowerCase() === 'active';
      });
      if (duplicate) throw new Error('ผู้ใช้นี้มีสิทธิ์ระดับเดียวกันในระบบงานนี้อยู่แล้ว');
    }

    const note = sanitizeText(notes, 500);
    const now = new Date();
    updateRow_(SHEETS.ACCESS_REQ, req._row, {
      ITHandler: user.email, ITActionDate: now,
      ITResult: success ? 'ดำเนินการแล้ว' + (note ? ' - ' + note : '') : 'ไม่สำเร็จ' + (note ? ' - ' + note : ''),
      Status: success ? AC_STATUS.DONE : AC_STATUS.PENDING_IT,
      ReviewDue: success ? addDays(now, getReviewCycleDays()) : ''
    }, user.email);

    if (success) {
      const cycle = getReviewCycleDays();
      if (req.RequestType === 'เพิกถอนสิทธิ์') {
        // ปิดสิทธิ์ที่มีอยู่
        revokeRegistryByMatch_(req.RequesterEmail, req.SystemName, user, 'เพิกถอนตามคำขอ ' + reqId);
      } else {
        appendRow_(SHEETS.ACCESS_REGISTRY, {
          AccessID: generateId('REG'), UserEmail: req.RequesterEmail, UserName: req.RequesterName,
          SystemName: req.SystemName, AccessLevel: req.AccessLevel, GrantedBy: user.email,
          GrantDate: now, LastReviewDate: now, NextReviewDue: addDays(now, cycle),
          Status: 'Active', SourceReqID: reqId
        }, user.email);
      }
    }

    writeAudit_(user, 'IT_PROCESS', 'access', SHEETS.ACCESS_REQ, reqId,
      (success ? 'ดำเนินการสำเร็จ' : 'ไม่สำเร็จ') + ' ' + note, 'success');
    notify_(req.RequesterEmail, 'คำขอสิทธิ์ ' + reqId + ' ดำเนินการเสร็จสิ้น',
      '<p>คำขอ ' + escapeHtml(reqId) + ' ' + (success ? 'ได้รับการดำเนินการเรียบร้อย' : 'ไม่สามารถดำเนินการได้') +
      (note ? '<br>หมายเหตุ: ' + escapeHtml(note) : '') + '</p>',
      'คำขอ ' + reqId + ' ' + (success ? 'เสร็จสิ้น' : 'ไม่สำเร็จ'), 'access', reqId);

    return ok(success ? 'บันทึกสิทธิ์ลงทะเบียนเรียบร้อย' : 'บันทึกผลไม่สำเร็จเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** ทบทวนสิทธิ์ (ต่ออายุรอบทบทวน) */
function reviewAccessEntry(accessId) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const entry = findRow_(SHEETS.ACCESS_REGISTRY, 'AccessID', accessId);
    if (!entry) throw new Error('ไม่พบรายการสิทธิ์');
    const now = new Date();
    updateRow_(SHEETS.ACCESS_REGISTRY, entry._row, {
      LastReviewDate: now, NextReviewDue: addDays(now, getReviewCycleDays())
    }, user.email);
    writeAudit_(user, 'REVIEW', 'access', SHEETS.ACCESS_REGISTRY, accessId, 'ทบทวนสิทธิ์', 'success');
    return ok('ทบทวนสิทธิ์เรียบร้อย ตั้งรอบถัดไปแล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

/** เพิกถอนสิทธิ์รายการเดียว */
function revokeAccessEntry(accessId, reason) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const entry = findRow_(SHEETS.ACCESS_REGISTRY, 'AccessID', accessId);
    if (!entry) throw new Error('ไม่พบรายการสิทธิ์');
    updateRow_(SHEETS.ACCESS_REGISTRY, entry._row, {
      Status: 'Revoked', Notes: sanitizeText(reason, 300)
    }, user.email);
    writeAudit_(user, 'REVOKE', 'access', SHEETS.ACCESS_REGISTRY, accessId, sanitizeText(reason, 300), 'success');
    return ok('เพิกถอนสิทธิ์เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function revokeRegistryByMatch_(email, system, user, reason) {
  readSheetObjects_(SHEETS.ACCESS_REGISTRY).forEach(function (r) {
    if (String(r.UserEmail).toLowerCase() === String(email).toLowerCase() &&
      r.SystemName === system && String(r.Status).toLowerCase() === 'active') {
      updateRow_(SHEETS.ACCESS_REGISTRY, r._row, { Status: 'Revoked', Notes: reason }, user.email);
    }
  });
}

/**
 * ระงับสิทธิ์ทั้งหมดเมื่อพนักงานพ้นสภาพ (HR แจ้ง)
 * ตั้ง Users.Status = Inactive และ Suspend ทุกสิทธิ์ใน registry
 */
function deactivateEmployee(email, reason) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    email = String(email || '').toLowerCase().trim();
    if (!isValidEmail(email)) throw new Error('อีเมลไม่ถูกต้อง');
    const u = findRow_(SHEETS.USERS, 'Email', email);
    if (u) updateRow_(SHEETS.USERS, u._row, { Status: 'Inactive' }, user.email);

    let count = 0;
    readSheetObjects_(SHEETS.ACCESS_REGISTRY).forEach(function (r) {
      if (String(r.UserEmail).toLowerCase() === email && String(r.Status).toLowerCase() === 'active') {
        updateRow_(SHEETS.ACCESS_REGISTRY, r._row, {
          Status: 'Suspended', Notes: 'พ้นสภาพ: ' + sanitizeText(reason, 200)
        }, user.email);
        count++;
      }
    });
    writeAudit_(user, 'DEACTIVATE_USER', 'access', SHEETS.USERS, email,
      'ระงับบัญชี + ' + count + ' สิทธิ์ (' + sanitizeText(reason, 200) + ')', 'success');
    notify_(getITAdminEmails_().join(','), 'ระงับสิทธิ์ผู้พ้นสภาพ: ' + email,
      '<p>ระงับบัญชีและสิทธิ์ ' + count + ' รายการของ ' + escapeHtml(email) + ' เรียบร้อย</p>',
      'ระงับสิทธิ์ ' + email + ' (' + count + ' รายการ)', 'access', email);
    return ok('ระงับบัญชีและสิทธิ์ ' + count + ' รายการเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function addDays(date, days) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d;
}

function getWebAppUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
