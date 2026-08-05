/**
 * Module_Logging.gs
 * Logging & Monitoring Register
 *  - ทะเบียนระบบที่ต้องบันทึก Log
 *  - บันทึกผลการตรวจสอบ Log รายสัปดาห์/รายเดือน + Anomaly ที่พบและการดำเนินการ
 * อ้างอิง: หมวด 12
 */

const LOG_FREQ = ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส'];
const FREQ_DAYS = { 'รายวัน': 1, 'รายสัปดาห์': 7, 'รายเดือน': 30, 'รายไตรมาส': 90 };

function getLoggingModuleData() {
  try {
    const user = requireModule('logging', false);
    const canEdit = canEditModule(user.role, 'logging');

    const register = readSheetObjects_(SHEETS.LOG_REGISTER).map(function (r) {
      return {
        row: r._row, id: r.LogSysID, system: r.SystemName, logType: r.LogType,
        location: r.LogLocation, frequency: r.ReviewFrequency, responsible: r.Responsible,
        lastReview: fmtDate(r.LastReviewDate), nextReview: fmtDate(r.NextReviewDue),
        reviewDays: daysUntil(r.NextReviewDue), retention: r.RetentionPeriod, status: r.Status
      };
    });

    const reviews = readSheetObjects_(SHEETS.LOG_REVIEW).map(function (r) {
      return {
        row: r._row, id: r.ReviewID, logSysId: r.LogSysID, system: r.SystemName,
        date: fmtDate(r.ReviewDate), reviewer: r.Reviewer, period: r.Period,
        anomaly: r.AnomalyFound, anomalyDetail: r.AnomalyDetail, action: r.ActionTaken,
        status: r.Status, evidence: r.EvidenceLink
      };
    }).reverse();

    return ok({
      role: user.role, canEdit: canEdit, frequencies: LOG_FREQ,
      register: register, reviews: reviews
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** ลงทะเบียนระบบที่ต้องบันทึก Log */
function addLogSystem(form) {
  try {
    const user = requireModule('logging', true);
    form = form || {};
    const system = sanitizeText(form.system, 120);
    const freq = sanitizeText(form.frequency, 30);
    requireFields({ SystemName: system, ReviewFrequency: freq }, ['SystemName', 'ReviewFrequency']);
    if (!isInList(freq, LOG_FREQ)) throw new Error('ความถี่การตรวจสอบไม่ถูกต้อง');

    const now = new Date();
    const id = generateId('LOGSYS');
    appendRow_(SHEETS.LOG_REGISTER, {
      LogSysID: id, SystemName: system, LogType: sanitizeText(form.logType, 100),
      LogLocation: sanitizeText(form.location, 200), ReviewFrequency: freq,
      Responsible: sanitizeText(form.responsible, 120) || user.email,
      LastReviewDate: '', NextReviewDue: addDays(now, FREQ_DAYS[freq] || 30),
      RetentionPeriod: sanitizeText(form.retention, 60), Status: 'ใช้งาน',
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'logging', SHEETS.LOG_REGISTER, id, system, 'success');
    return ok('ลงทะเบียนระบบ Log เรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

/** บันทึกผลการตรวจสอบ Log + อัปเดตรอบถัดไปในทะเบียน */
function addLogReview(form) {
  try {
    const user = requireModule('logging', true);
    form = form || {};
    const logSysId = sanitizeText(form.logSysId, 40);
    const reg = findRow_(SHEETS.LOG_REGISTER, 'LogSysID', logSysId);
    if (!reg) throw new Error('กรุณาเลือกระบบจากทะเบียน');
    requireFields({ ReviewDate: form.date, Period: form.period }, ['ReviewDate', 'Period']);

    const anomaly = (String(form.anomaly).toLowerCase() === 'yes') ? 'Yes' : 'No';
    const id = generateId('LGR');
    appendRow_(SHEETS.LOG_REVIEW, {
      ReviewID: id, LogSysID: logSysId, SystemName: reg.SystemName,
      ReviewDate: parseDate(form.date), Reviewer: user.email, Period: sanitizeText(form.period, 60),
      AnomalyFound: anomaly, AnomalyDetail: sanitizeText(form.anomalyDetail, 2000),
      ActionTaken: sanitizeText(form.action, 2000),
      Status: anomaly === 'Yes' ? (sanitizeText(form.status, 40) || 'กำลังดำเนินการ') : 'ปกติ',
      EvidenceLink: sanitizeText(form.evidence, 500), Notes: sanitizeText(form.notes, 500)
    }, user.email);

    // อัปเดตรอบทบทวนถัดไปในทะเบียน
    const now = parseDate(form.date) || new Date();
    updateRow_(SHEETS.LOG_REGISTER, reg._row, {
      LastReviewDate: now, NextReviewDue: addDays(now, FREQ_DAYS[reg.ReviewFrequency] || 30)
    }, user.email);

    writeAudit_(user, 'CREATE', 'logging', SHEETS.LOG_REVIEW, id,
      reg.SystemName + ' Anomaly=' + anomaly, 'success');

    // แจ้งเตือนทันทีหากพบ Anomaly
    if (anomaly === 'Yes') {
      notify_(getITAdminEmails_().join(','), 'พบความผิดปกติจาก Log: ' + reg.SystemName,
        '<p style="color:#dc3545">พบ Anomaly จากการตรวจสอบ Log ระบบ <b>' + escapeHtml(reg.SystemName) + '</b></p>' +
        '<p>รายละเอียด: ' + escapeHtml(sanitizeText(form.anomalyDetail, 2000)) + '</p>' +
        '<p>การดำเนินการ: ' + escapeHtml(sanitizeText(form.action, 2000)) + '</p>',
        'พบ Anomaly: ' + reg.SystemName, 'logging', id);
    }
    return ok('บันทึกผลการตรวจสอบ Log เรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}
