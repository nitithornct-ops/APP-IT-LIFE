/**
 * Module_Privacy.gs
 * PDPA operations: RoPA, consent evidence และ Data Subject Request (DSR)
 * ทุก write ตรวจสิทธิ์ฝั่ง Server และบันทึก Audit Trail
 */

const PRIVACY_LAWFUL_BASES = ['ความยินยอม', 'สัญญา', 'หน้าที่ตามกฎหมาย', 'ประโยชน์สำคัญต่อชีวิต', 'ภารกิจเพื่อประโยชน์สาธารณะ', 'ประโยชน์โดยชอบด้วยกฎหมาย'];
const PRIVACY_DSR_TYPES = ['ขอเข้าถึงข้อมูล', 'ขอสำเนาข้อมูล', 'ขอแก้ไขข้อมูล', 'ขอลบข้อมูล', 'ขอระงับการใช้', 'ขอคัดค้าน', 'ขอโอนย้ายข้อมูล', 'ถอนความยินยอม'];
const PRIVACY_DSR_STATUSES = ['รับคำขอ', 'รอยืนยันตัวตน', 'กำลังดำเนินการ', 'รอข้อมูลเพิ่มเติม', 'เสร็จสิ้น', 'ปฏิเสธ'];

function getPrivacyModuleData() {
  try {
    const user = requireModule('privacy', false);
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'privacy'),
      lawfulBases: PRIVACY_LAWFUL_BASES,
      requestTypes: PRIVACY_DSR_TYPES,
      requestStatuses: PRIVACY_DSR_STATUSES,
      ropa: readSheetObjectsEnsured_(SHEETS.PRIVACY_ROPA).map(privacyRopaDto_),
      consents: readSheetObjectsEnsured_(SHEETS.PRIVACY_CONSENT).map(privacyConsentDto_),
      requests: readSheetObjectsEnsured_(SHEETS.PRIVACY_DSR).map(privacyDsrDto_)
    });
  } catch (e) { return fail(e.message, 'PRIVACY_LOAD_FAILED'); }
}

function saveRopaRecord(form) {
  try {
    const user = requireModule('privacy', true);
    form = form || {};
    const processName = sanitizeText(form.processName, 200);
    const lawfulBasis = sanitizeText(form.lawfulBasis, 100);
    requireFields({ processName: processName, purpose: form.purpose, lawfulBasis: lawfulBasis }, ['processName', 'purpose', 'lawfulBasis']);
    if (!isInList(lawfulBasis, PRIVACY_LAWFUL_BASES)) throw new Error('ฐานการประมวลผลไม่ถูกต้อง');
    const payload = {
      ProcessName: processName, Department: sanitizeText(form.department, 150),
      DataOwner: sanitizeText(form.dataOwner, 150) || user.email,
      Purpose: sanitizeText(form.purpose, 1000), LawfulBasis: lawfulBasis,
      DataSubjects: sanitizeText(form.dataSubjects, 500), PersonalData: sanitizeText(form.personalData, 1000),
      SensitiveData: sanitizeText(form.sensitiveData, 1000), Recipients: sanitizeText(form.recipients, 500),
      CrossBorderTransfer: sanitizeText(form.crossBorderTransfer, 500),
      RetentionPeriod: sanitizeText(form.retentionPeriod, 200), SecurityMeasures: sanitizeText(form.securityMeasures, 1500),
      DPIARequired: String(form.dpiaRequired).toLowerCase() === 'yes' ? 'Yes' : 'No',
      DPIAStatus: sanitizeText(form.dpiaStatus, 100), ReviewDate: parseDate(form.reviewDate),
      Status: sanitizeText(form.status, 50) || 'ใช้งาน', Notes: sanitizeText(form.notes, 1000)
    };
    const id = sanitizeText(form.id, 80);
    if (id) {
      const row = findRow_(SHEETS.PRIVACY_ROPA, 'RopaID', id);
      if (!row) throw new Error('ไม่พบ RoPA ที่ต้องการแก้ไข');
      updateRow_(SHEETS.PRIVACY_ROPA, row._row, payload, user.email);
      writeAudit_(user, 'UPDATE_ROPA', 'privacy', SHEETS.PRIVACY_ROPA, id, processName, 'success');
      return ok({ id: id }, 'แก้ไข RoPA เรียบร้อย');
    }
    const newId = generateId('ROPA');
    payload.RopaID = newId;
    appendRow_(SHEETS.PRIVACY_ROPA, payload, user.email);
    writeAudit_(user, 'CREATE_ROPA', 'privacy', SHEETS.PRIVACY_ROPA, newId, processName, 'success');
    return ok({ id: newId }, 'บันทึก RoPA เรียบร้อย');
  } catch (e) { return fail(e.message, 'ROPA_SAVE_FAILED'); }
}

function recordPrivacyConsent(form) {
  try {
    const user = requireModule('privacy', true);
    form = form || {};
    const subjectRef = sanitizeText(form.dataSubjectRef, 200);
    const purpose = sanitizeText(form.purpose, 1000);
    requireFields({ dataSubjectRef: subjectRef, purpose: purpose }, ['dataSubjectRef', 'purpose']);
    const id = generateId('CNS');
    const status = sanitizeText(form.status, 30) === 'ถอนแล้ว' ? 'ถอนแล้ว' : 'ให้ความยินยอม';
    appendRow_(SHEETS.PRIVACY_CONSENT, {
      ConsentID: id, DataSubjectRef: subjectRef, Purpose: purpose,
      NoticeVersion: sanitizeText(form.noticeVersion, 80), Channel: sanitizeText(form.channel, 80),
      GrantedAt: parseDate(form.grantedAt) || new Date(),
      WithdrawnAt: status === 'ถอนแล้ว' ? (parseDate(form.withdrawnAt) || new Date()) : '',
      Status: status, EvidenceLink: privacyHttpUrl_(form.evidenceLink), Notes: sanitizeText(form.notes, 1000)
    }, user.email);
    writeAudit_(user, status === 'ถอนแล้ว' ? 'RECORD_CONSENT_WITHDRAWAL' : 'RECORD_CONSENT',
      'privacy', SHEETS.PRIVACY_CONSENT, id, subjectRef, 'success');
    return ok({ id: id }, 'บันทึกหลักฐานความยินยอมเรียบร้อย');
  } catch (e) { return fail(e.message, 'CONSENT_SAVE_FAILED'); }
}

function submitDataSubjectRequest(form) {
  try {
    const user = requireModule('privacy', true);
    form = form || {};
    const requestType = sanitizeText(form.requestType, 100);
    const subjectRef = sanitizeText(form.dataSubjectRef, 200);
    requireFields({ requestType: requestType, dataSubjectRef: subjectRef }, ['requestType', 'dataSubjectRef']);
    if (!isInList(requestType, PRIVACY_DSR_TYPES)) throw new Error('ประเภทคำขอไม่ถูกต้อง');
    const receivedAt = parseDate(form.receivedAt) || new Date();
    const dueDate = parseDate(form.dueDate) || privacyAddDays_(receivedAt, parseInt(getConfig_('PRIVACY_DSR_SLA_DAYS', '30'), 10) || 30);
    const id = generateId('DSR');
    appendRow_(SHEETS.PRIVACY_DSR, {
      RequestID: id, RequestType: requestType, DataSubjectRef: subjectRef,
      Contact: sanitizeText(form.contact, 250), ReceivedAt: receivedAt, DueDate: dueDate,
      Owner: sanitizeText(form.owner, 150) || user.email, Status: 'รอยืนยันตัวตน',
      Notes: sanitizeText(form.notes, 1000)
    }, user.email);
    writeAudit_(user, 'CREATE_DSR', 'privacy', SHEETS.PRIVACY_DSR, id, requestType, 'success');
    return ok({ id: id, dueDate: fmtDate(dueDate) }, 'รับคำขอใช้สิทธิเรียบร้อย');
  } catch (e) { return fail(e.message, 'DSR_CREATE_FAILED'); }
}

function updateDataSubjectRequest(requestId, form) {
  try {
    const user = requireModule('privacy', true);
    form = form || {};
    const row = findRow_(SHEETS.PRIVACY_DSR, 'RequestID', sanitizeText(requestId, 80));
    if (!row) throw new Error('ไม่พบคำขอใช้สิทธิ');
    const status = sanitizeText(form.status, 80);
    if (!isInList(status, PRIVACY_DSR_STATUSES)) throw new Error('สถานะคำขอไม่ถูกต้อง');
    const payload = {
      Status: status, Owner: sanitizeText(form.owner, 150) || row.Owner || user.email,
      Decision: sanitizeText(form.decision, 1500), EvidenceLink: privacyHttpUrl_(form.evidenceLink),
      Notes: sanitizeText(form.notes, 1000)
    };
    if (String(form.identityVerified).toLowerCase() === 'yes' && !row.IdentityVerifiedAt) payload.IdentityVerifiedAt = new Date();
    if (status === 'เสร็จสิ้น' || status === 'ปฏิเสธ') payload.CompletedAt = new Date();
    updateRow_(SHEETS.PRIVACY_DSR, row._row, payload, user.email);
    writeAudit_(user, 'UPDATE_DSR', 'privacy', SHEETS.PRIVACY_DSR, requestId, status, 'success');
    return ok({ id: requestId }, 'อัปเดตคำขอใช้สิทธิเรียบร้อย');
  } catch (e) { return fail(e.message, 'DSR_UPDATE_FAILED'); }
}

function privacyRopaDto_(r) {
  return { id:r.RopaID, processName:r.ProcessName, department:r.Department, dataOwner:r.DataOwner,
    purpose:r.Purpose, lawfulBasis:r.LawfulBasis, dataSubjects:r.DataSubjects, personalData:r.PersonalData,
    sensitiveData:r.SensitiveData, recipients:r.Recipients, crossBorderTransfer:r.CrossBorderTransfer,
    retentionPeriod:r.RetentionPeriod, securityMeasures:r.SecurityMeasures, dpiaRequired:r.DPIARequired,
    dpiaStatus:r.DPIAStatus, reviewDate:fmtDate(r.ReviewDate), reviewDateInput:privacyIsoDate_(r.ReviewDate),
    reviewDays:daysUntil(r.ReviewDate), status:r.Status, notes:r.Notes };
}
function privacyConsentDto_(r) { return { id:r.ConsentID, dataSubjectRef:r.DataSubjectRef, purpose:r.Purpose,
  noticeVersion:r.NoticeVersion, channel:r.Channel, grantedAt:fmtDate(r.GrantedAt), withdrawnAt:fmtDate(r.WithdrawnAt),
  status:r.Status, evidenceLink:r.EvidenceLink, notes:r.Notes }; }
function privacyDsrDto_(r) { return { id:r.RequestID, requestType:r.RequestType, dataSubjectRef:r.DataSubjectRef,
  contact:r.Contact, identityVerifiedAt:fmtDateTime(r.IdentityVerifiedAt), receivedAt:fmtDate(r.ReceivedAt),
  dueDate:fmtDate(r.DueDate), dueDays:daysUntil(r.DueDate), owner:r.Owner, status:r.Status, decision:r.Decision,
  completedAt:fmtDateTime(r.CompletedAt), evidenceLink:r.EvidenceLink, notes:r.Notes }; }
function privacyAddDays_(date, days) { const d = new Date(date.getTime()); d.setDate(d.getDate() + days); return d; }
function privacyIsoDate_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d) ? '' : Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
}
function privacyHttpUrl_(value) {
  const url = sanitizeText(value, 500);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) throw new Error('ลิงก์หลักฐานต้องเป็น HTTPS');
  return url;
}
