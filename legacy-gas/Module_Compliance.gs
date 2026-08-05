/**
 * Module_Compliance.gs
 * ศูนย์ธรรมาภิบาลกฎหมายและการปฏิบัติตาม
 *
 * หลักการ:
 *  - แยก "ข้อกฎหมาย/ข้อกำหนด" ออกจากตัวชี้วัดสุขภาพมาตรการควบคุมเดิม
 *  - ทุกผลประเมินต้องมีผู้ประเมิน วันประเมิน หลักฐาน/ช่องว่าง และรอบทบทวน
 *  - ข้อที่ยังไม่ยืนยัน applicability ต้องไม่ถูกนับเป็นการรับรองว่าปฏิบัติตามกฎหมายแล้ว
 */

const LEGAL_APPLICABILITY = ['ใช้บังคับ', 'ใช้เป็นกรอบ', 'ต้องยืนยัน', 'ไม่เกี่ยวข้อง'];
const LEGAL_RECORD_STATUSES = ['ใช้งาน', 'รอทบทวน', 'ยกเลิก'];
const OBLIGATION_STATUSES = ['เปิด', 'พักใช้', 'ปิด'];
const COMPLIANCE_RESULTS = ['สอดคล้อง', 'สอดคล้องบางส่วน', 'ไม่สอดคล้อง', 'ไม่เกี่ยวข้อง'];
const CAPA_PRIORITIES = ['วิกฤต', 'สูง', 'ปานกลาง', 'ต่ำ'];
const CAPA_STATUSES = ['เปิด', 'กำลังดำเนินการ', 'รอตรวจสอบ', 'เสร็จสิ้น', 'ยกเลิก'];

function complianceDateValue_(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date) ? 0 : date.getTime();
}

function complianceLatestAssessments_(rows) {
  const latest = {};
  (rows || []).forEach(function (row) {
    const key = String(row.ObligationID || '');
    if (!key) return;
    const current = latest[key];
    const value = complianceDateValue_(row.AssessmentDate || row.Timestamp);
    const currentValue = current ? complianceDateValue_(current.AssessmentDate || current.Timestamp) : -1;
    if (!current || value >= currentValue) latest[key] = row;
  });
  return latest;
}

function complianceLawObj_(row) {
  return {
    id: row.LawID, name: row.LawName, shortName: row.ShortName, authority: row.Authority,
    version: row.Version, effectiveDate: fmtDate(row.EffectiveDate),
    applicability: row.ApplicabilityStatus, applicabilityReason: row.ApplicabilityReason,
    owner: row.Owner, sourceUrl: row.SourceURL, lastReview: fmtDate(row.LastReviewDate),
    nextReview: fmtDate(row.NextReviewDue), nextReviewDays: daysUntil(row.NextReviewDue),
    status: row.Status || 'ใช้งาน', notes: row.Notes
  };
}

function complianceAssessmentObj_(row) {
  if (!row) return null;
  return {
    id: row.AssessmentID, obligationId: row.ObligationID,
    date: fmtDate(row.AssessmentDate), assessor: row.Assessor, result: row.Result,
    controlDescription: row.ControlDescription, evidence: row.EvidenceLink,
    gap: row.GapDescription, nextReview: fmtDate(row.NextReviewDue),
    nextReviewDays: daysUntil(row.NextReviewDue), notes: row.Notes
  };
}

function complianceObligationObj_(row, laws, latest) {
  const law = laws[String(row.LawID)] || {};
  return {
    id: row.ObligationID, lawId: row.LawID, lawName: law.LawName || row.LawID,
    lawShortName: law.ShortName || row.LawID, clause: row.Clause, requirement: row.Requirement,
    domain: row.ControlDomain, owner: row.ControlOwner, frequency: row.Frequency,
    evidenceRequired: row.EvidenceRequired, relatedModule: row.RelatedModule,
    applicability: row.ApplicabilityStatus, due: fmtDate(row.DueDate),
    dueDays: daysUntil(row.DueDate), status: row.Status || 'เปิด', notes: row.Notes,
    latestAssessment: complianceAssessmentObj_(latest[String(row.ObligationID)])
  };
}

function complianceActionObj_(row) {
  return {
    id: row.ActionID, obligationId: row.ObligationID, assessmentId: row.AssessmentID,
    title: row.Title, rootCause: row.RootCause, actionPlan: row.ActionPlan,
    owner: row.Owner, priority: row.Priority, due: fmtDate(row.DueDate),
    dueDays: daysUntil(row.DueDate), status: row.Status || 'เปิด',
    completedDate: fmtDate(row.CompletedDate), verification: row.VerificationResult,
    verifiedBy: row.VerifiedBy, evidence: row.EvidenceLink, notes: row.Notes
  };
}

function getComplianceModuleData() {
  try {
    const user = requireModule('compliance', false);
    const lawRows = readSheetObjectsEnsured_(SHEETS.LEGAL_REGISTER);
    const obligationRows = readSheetObjectsEnsured_(SHEETS.COMPLIANCE_OBLIGATION);
    const assessmentRows = readSheetObjectsEnsured_(SHEETS.COMPLIANCE_ASSESSMENT);
    const actionRows = readSheetObjectsEnsured_(SHEETS.CORRECTIVE_ACTION);
    const lawMap = {};
    lawRows.forEach(function (row) { lawMap[String(row.LawID)] = row; });
    const latest = complianceLatestAssessments_(assessmentRows);
    const obligations = obligationRows.map(function (row) {
      return complianceObligationObj_(row, lawMap, latest);
    });
    let applicable = 0, pendingApplicability = 0, referenceOnly = 0;
    let assessed = 0, compliant = 0, partial = 0, nonCompliant = 0;
    obligations.forEach(function (item) {
      if (item.status !== 'เปิด') return;
      if (item.applicability === 'ต้องยืนยัน') { pendingApplicability++; return; }
      if (item.applicability === 'ใช้เป็นกรอบ') { referenceOnly++; return; }
      if (item.applicability !== 'ใช้บังคับ') return;
      applicable++;
      if (!item.latestAssessment) return;
      assessed++;
      if (item.latestAssessment.result === 'สอดคล้อง') compliant++;
      else if (item.latestAssessment.result === 'สอดคล้องบางส่วน') partial++;
      else if (item.latestAssessment.result === 'ไม่สอดคล้อง') nonCompliant++;
    });
    const openActions = actionRows.filter(function (row) {
      return ['เสร็จสิ้น', 'ยกเลิก'].indexOf(String(row.Status)) === -1;
    }).length;
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'compliance'),
      laws: lawRows.map(complianceLawObj_),
      obligations: obligations,
      assessments: assessmentRows.map(complianceAssessmentObj_),
      actions: actionRows.map(complianceActionObj_),
      summary: {
        applicable: applicable, assessed: assessed, compliant: compliant,
        partial: partial, nonCompliant: nonCompliant, openActions: openActions,
        pendingApplicability: pendingApplicability, referenceOnly: referenceOnly,
        assessmentCoverage: applicable ? Math.round((assessed / applicable) * 100) : null,
        complianceRate: assessed ? Math.round((compliant / assessed) * 100) : null
      },
      options: {
        applicability: LEGAL_APPLICABILITY, lawStatuses: LEGAL_RECORD_STATUSES,
        obligationStatuses: OBLIGATION_STATUSES, results: COMPLIANCE_RESULTS,
        priorities: CAPA_PRIORITIES, actionStatuses: CAPA_STATUSES
      }
    });
  } catch (e) {
    return fail(e.message);
  }
}

function saveLegalRecord(lawId, form) {
  try {
    const user = requireModule('compliance', true);
    form = form || {};
    lawId = sanitizeText(lawId, 80);
    const name = sanitizeText(form.name, 500);
    const applicability = sanitizeText(form.applicability, 40);
    const status = sanitizeText(form.status, 40) || 'ใช้งาน';
    requireFields({ 'ชื่อกฎหมาย/มาตรฐาน': name, 'สถานะการใช้บังคับ': applicability },
      ['ชื่อกฎหมาย/มาตรฐาน', 'สถานะการใช้บังคับ']);
    if (!isInList(applicability, LEGAL_APPLICABILITY)) throw new Error('สถานะการใช้บังคับไม่ถูกต้อง');
    if (!isInList(status, LEGAL_RECORD_STATUSES)) throw new Error('สถานะทะเบียนไม่ถูกต้อง');
    const patch = {
      LawName: name, ShortName: sanitizeText(form.shortName, 120),
      Authority: sanitizeText(form.authority, 250), Version: sanitizeText(form.version, 120),
      EffectiveDate: parseDate(form.effectiveDate), ApplicabilityStatus: applicability,
      ApplicabilityReason: sanitizeText(form.applicabilityReason, 1500),
      Owner: sanitizeText(form.owner, 120), SourceURL: sanitizeText(form.sourceUrl, 1000),
      LastReviewDate: parseDate(form.lastReview), NextReviewDue: parseDate(form.nextReview),
      Status: status, Notes: sanitizeText(form.notes, 1500)
    };
    if (lawId) {
      const existing = findRow_(SHEETS.LEGAL_REGISTER, 'LawID', lawId);
      if (!existing) throw new Error('ไม่พบกฎหมาย/มาตรฐานที่ต้องการแก้ไข');
      updateRow_(SHEETS.LEGAL_REGISTER, existing._row, patch, user.email);
      writeAudit_(user, 'UPDATE_LEGAL_RECORD', 'compliance', SHEETS.LEGAL_REGISTER,
        lawId, name, 'success');
      return ok('อัปเดตทะเบียนกฎหมายเรียบร้อย');
    }
    const id = generateId('LAW');
    patch.LawID = id;
    appendRow_(SHEETS.LEGAL_REGISTER, patch, user.email);
    writeAudit_(user, 'CREATE_LEGAL_RECORD', 'compliance', SHEETS.LEGAL_REGISTER,
      id, name, 'success');
    return ok('เพิ่มกฎหมาย/มาตรฐานเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

function saveComplianceObligation(obligationId, form) {
  try {
    const user = requireModule('compliance', true);
    form = form || {};
    obligationId = sanitizeText(obligationId, 100);
    const lawId = sanitizeText(form.lawId, 100);
    const requirement = sanitizeText(form.requirement, 2000);
    const applicability = sanitizeText(form.applicability, 40);
    const status = sanitizeText(form.status, 40) || 'เปิด';
    requireFields({ 'กฎหมาย/มาตรฐาน': lawId, 'หน้าที่ที่ต้องปฏิบัติ': requirement,
      'สถานะการใช้บังคับ': applicability },
    ['กฎหมาย/มาตรฐาน', 'หน้าที่ที่ต้องปฏิบัติ', 'สถานะการใช้บังคับ']);
    if (!findRow_(SHEETS.LEGAL_REGISTER, 'LawID', lawId)) throw new Error('ไม่พบกฎหมาย/มาตรฐานที่เลือก');
    if (!isInList(applicability, LEGAL_APPLICABILITY)) throw new Error('สถานะการใช้บังคับไม่ถูกต้อง');
    if (!isInList(status, OBLIGATION_STATUSES)) throw new Error('สถานะข้อกำหนดไม่ถูกต้อง');
    const patch = {
      LawID: lawId, Clause: sanitizeText(form.clause, 300), Requirement: requirement,
      ControlDomain: sanitizeText(form.domain, 250), ControlOwner: sanitizeText(form.owner, 120),
      Frequency: sanitizeText(form.frequency, 250),
      EvidenceRequired: sanitizeText(form.evidenceRequired, 1500),
      RelatedModule: sanitizeText(form.relatedModule, 80), ApplicabilityStatus: applicability,
      DueDate: parseDate(form.due), Status: status, Notes: sanitizeText(form.notes, 1500)
    };
    if (obligationId) {
      const existing = findRow_(SHEETS.COMPLIANCE_OBLIGATION, 'ObligationID', obligationId);
      if (!existing) throw new Error('ไม่พบข้อกำหนดที่ต้องการแก้ไข');
      updateRow_(SHEETS.COMPLIANCE_OBLIGATION, existing._row, patch, user.email);
      writeAudit_(user, 'UPDATE_OBLIGATION', 'compliance', SHEETS.COMPLIANCE_OBLIGATION,
        obligationId, requirement, 'success');
      return ok('อัปเดตข้อกำหนดเรียบร้อย');
    }
    const id = generateId('OBL');
    patch.ObligationID = id;
    appendRow_(SHEETS.COMPLIANCE_OBLIGATION, patch, user.email);
    writeAudit_(user, 'CREATE_OBLIGATION', 'compliance', SHEETS.COMPLIANCE_OBLIGATION,
      id, requirement, 'success');
    return ok('เพิ่มข้อกำหนดเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

function recordComplianceAssessment(form) {
  try {
    const user = requireModule('compliance', true);
    form = form || {};
    const obligationId = sanitizeText(form.obligationId, 100);
    const result = sanitizeText(form.result, 60);
    requireFields({ 'ข้อกำหนด': obligationId, 'ผลการประเมิน': result },
      ['ข้อกำหนด', 'ผลการประเมิน']);
    if (!findRow_(SHEETS.COMPLIANCE_OBLIGATION, 'ObligationID', obligationId))
      throw new Error('ไม่พบข้อกำหนดที่เลือก');
    if (!isInList(result, COMPLIANCE_RESULTS)) throw new Error('ผลการประเมินไม่ถูกต้อง');
    const id = generateId('ASM');
    appendRow_(SHEETS.COMPLIANCE_ASSESSMENT, {
      AssessmentID: id, ObligationID: obligationId,
      AssessmentDate: parseDate(form.assessmentDate) || new Date(),
      Assessor: user.email, Result: result,
      ControlDescription: sanitizeText(form.controlDescription, 2000),
      EvidenceLink: sanitizeText(form.evidence, 1000),
      GapDescription: sanitizeText(form.gap, 2000),
      NextReviewDue: parseDate(form.nextReview), Notes: sanitizeText(form.notes, 1500)
    }, user.email);
    writeAudit_(user, 'ASSESS_OBLIGATION', 'compliance', SHEETS.COMPLIANCE_ASSESSMENT,
      id, obligationId + ': ' + result, 'success');
    return ok('บันทึกผลประเมินเรียบร้อย (' + result + ')');
  } catch (e) {
    return fail(e.message);
  }
}

function saveCorrectiveAction(actionId, form) {
  try {
    const user = requireModule('compliance', true);
    form = form || {};
    actionId = sanitizeText(actionId, 100);
    const obligationId = sanitizeText(form.obligationId, 100);
    const title = sanitizeText(form.title, 500);
    const priority = sanitizeText(form.priority, 40) || 'ปานกลาง';
    const status = sanitizeText(form.status, 40) || 'เปิด';
    requireFields({ 'ข้อกำหนด': obligationId, 'หัวข้อการแก้ไข': title },
      ['ข้อกำหนด', 'หัวข้อการแก้ไข']);
    if (!findRow_(SHEETS.COMPLIANCE_OBLIGATION, 'ObligationID', obligationId))
      throw new Error('ไม่พบข้อกำหนดที่เลือก');
    if (!isInList(priority, CAPA_PRIORITIES)) throw new Error('ความสำคัญไม่ถูกต้อง');
    if (!isInList(status, CAPA_STATUSES)) throw new Error('สถานะ CAPA ไม่ถูกต้อง');
    const patch = {
      ObligationID: obligationId, AssessmentID: sanitizeText(form.assessmentId, 100),
      Title: title, RootCause: sanitizeText(form.rootCause, 2000),
      ActionPlan: sanitizeText(form.actionPlan, 3000), Owner: sanitizeText(form.owner, 120),
      Priority: priority, DueDate: parseDate(form.due), Status: status,
      CompletedDate: status === 'เสร็จสิ้น' ? (parseDate(form.completedDate) || new Date()) : '',
      VerificationResult: sanitizeText(form.verification, 2000),
      VerifiedBy: sanitizeText(form.verifiedBy, 120),
      EvidenceLink: sanitizeText(form.evidence, 1000), Notes: sanitizeText(form.notes, 1500)
    };
    if (actionId) {
      const existing = findRow_(SHEETS.CORRECTIVE_ACTION, 'ActionID', actionId);
      if (!existing) throw new Error('ไม่พบ CAPA ที่ต้องการแก้ไข');
      updateRow_(SHEETS.CORRECTIVE_ACTION, existing._row, patch, user.email);
      writeAudit_(user, 'UPDATE_CAPA', 'compliance', SHEETS.CORRECTIVE_ACTION,
        actionId, title + ': ' + status, 'success');
      return ok('อัปเดต CAPA เรียบร้อย');
    }
    const id = generateId('CAPA');
    patch.ActionID = id;
    appendRow_(SHEETS.CORRECTIVE_ACTION, patch, user.email);
    writeAudit_(user, 'CREATE_CAPA', 'compliance', SHEETS.CORRECTIVE_ACTION,
      id, title, 'success');
    return ok('เพิ่มแผนแก้ไข CAPA เรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}
