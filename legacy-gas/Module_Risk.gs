/**
 * Module_Risk.gs
 * ทะเบียนความเสี่ยงสารสนเทศ (Risk Register)
 * อ้างอิง ISO/IEC 27001 ข้อ 6.1.2 (การประเมินความเสี่ยง), 6.1.3 / 8.3 (การจัดการความเสี่ยง), 8.2 (การประเมินซ้ำ)
 *
 * แนวคิด: บันทึกความเสี่ยง → ประเมิน Likelihood × Impact (1-5) ได้คะแนน 1-25 →
 * เลือกวิธีจัดการ (ยอมรับ/ลด/โอน/หลีกเลี่ยง) + มาตรการ → ประเมินความเสี่ยงคงเหลือ (Residual)
 * → กำหนดวันทบทวน (NextReviewDue) เพื่อประเมินซ้ำเป็นรอบ
 */

const RISK_CATEGORIES = ['บุคลากร', 'กระบวนการ', 'เทคโนโลยี/ระบบ', 'ข้อมูล/สารสนเทศ',
  'กายภาพ/สิ่งแวดล้อม', 'ผู้ให้บริการภายนอก', 'กฎหมาย/ระเบียบ', 'อื่นๆ'];
const RISK_TREATMENTS = ['ลดความเสี่ยง (Mitigate)', 'ยอมรับความเสี่ยง (Accept)',
  'โอนความเสี่ยง (Transfer)', 'หลีกเลี่ยง (Avoid)'];
const RISK_STATUSES = ['เปิด', 'กำลังจัดการ', 'เฝ้าระวัง', 'ปิด'];

/** แปลงคะแนน 1-25 เป็นระดับความเสี่ยง + โทนสีป้าย (สอดคล้องเมทริกซ์ 5×5) */
function riskLevelFromScore_(score) {
  score = Number(score) || 0;
  if (score >= 15) return { level: 'วิกฤต', tone: 'danger' };
  if (score >= 10) return { level: 'สูง', tone: 'warning' };
  if (score >= 5) return { level: 'ปานกลาง', tone: 'info' };
  if (score >= 1) return { level: 'ต่ำ', tone: 'success' };
  return { level: '-', tone: 'secondary' };
}

/** อ่านค่า L/I ให้เป็นจำนวนเต็ม 1-5 (คืน 0 ถ้าว่าง) */
function riskScale_(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function riskRowToObj_(r) {
  const inherent = riskLevelFromScore_(r.RiskScore);
  const residual = riskLevelFromScore_(r.ResidualScore);
  return {
    row: r._row, id: r.RiskID, title: r.Title, category: r.Category,
    relatedAsset: r.RelatedAsset, relatedSystem: r.RelatedSystem,
    threat: r.Threat, vulnerability: r.Vulnerability, owner: r.Owner,
    likelihood: r.Likelihood, impact: r.Impact,
    score: Number(r.RiskScore) || 0, level: r.RiskLevel || inherent.level, tone: inherent.tone,
    treatment: r.Treatment, existingControls: r.ExistingControls,
    treatmentPlan: r.TreatmentPlan, treatmentOwner: r.TreatmentOwner, due: fmtDate(r.DueDate),
    dueDays: daysUntil(r.DueDate),
    residualLikelihood: r.ResidualLikelihood, residualImpact: r.ResidualImpact,
    residualScore: Number(r.ResidualScore) || 0, residualLevel: r.ResidualLevel || '', residualTone: residual.tone,
    status: r.Status || 'เปิด', identified: fmtDate(r.IdentifiedDate),
    lastReview: fmtDate(r.LastReviewDate), nextReview: fmtDate(r.NextReviewDue),
    nextReviewDays: daysUntil(r.NextReviewDue),
    relatedIncident: r.RelatedIncidentID, notes: r.Notes
  };
}

function getRiskModuleData() {
  try {
    const user = requireModule('risk', false);
    const risks = readSheetObjectsEnsured_(SHEETS.RISK).map(riskRowToObj_);
    return ok({
      role: user.role, canEdit: canEditModule(user.role, 'risk'),
      categories: RISK_CATEGORIES, treatments: RISK_TREATMENTS, statuses: RISK_STATUSES,
      risks: risks
    });
  } catch (e) { return fail(e.message); }
}

/** ประกอบ patch ของค่าประเมิน (L/I → Score/Level) จากฟอร์ม ใส่ลง patch object */
function applyRiskScoring_(patch, form) {
  if (form.likelihood !== undefined || form.impact !== undefined) {
    const l = riskScale_(form.likelihood);
    const i = riskScale_(form.impact);
    patch.Likelihood = l || '';
    patch.Impact = i || '';
    if (l && i) { patch.RiskScore = l * i; patch.RiskLevel = riskLevelFromScore_(l * i).level; }
    else { patch.RiskScore = ''; patch.RiskLevel = ''; }
  }
  if (form.residualLikelihood !== undefined || form.residualImpact !== undefined) {
    const rl = riskScale_(form.residualLikelihood);
    const ri = riskScale_(form.residualImpact);
    patch.ResidualLikelihood = rl || '';
    patch.ResidualImpact = ri || '';
    if (rl && ri) { patch.ResidualScore = rl * ri; patch.ResidualLevel = riskLevelFromScore_(rl * ri).level; }
    else { patch.ResidualScore = ''; patch.ResidualLevel = ''; }
  }
}

function addRisk(form) {
  try {
    const user = requireModule('risk', true);
    form = form || {};
    const title = sanitizeText(form.title, 300);
    requireFields({ 'ชื่อความเสี่ยง': title }, ['ชื่อความเสี่ยง']);
    const l = riskScale_(form.likelihood), i = riskScale_(form.impact);
    if (!l || !i) throw new Error('กรุณาระบุโอกาสเกิด (Likelihood) และผลกระทบ (Impact) เป็นระดับ 1-5');
    const treatment = sanitizeText(form.treatment, 60);
    if (treatment && !isInList(treatment, RISK_TREATMENTS)) throw new Error('วิธีจัดการความเสี่ยงไม่ถูกต้อง');
    const status = sanitizeText(form.status, 40) || 'เปิด';
    if (!isInList(status, RISK_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
    const id = generateId('RSK');
    const row = {
      RiskID: id, Title: title, Category: sanitizeText(form.category, 60),
      RelatedAsset: sanitizeText(form.relatedAsset, 200), RelatedSystem: sanitizeText(form.relatedSystem, 200),
      Threat: sanitizeText(form.threat, 500), Vulnerability: sanitizeText(form.vulnerability, 500),
      Owner: sanitizeText(form.owner, 120) || user.email,
      Treatment: treatment, ExistingControls: sanitizeText(form.existingControls, 1000),
      TreatmentPlan: sanitizeText(form.treatmentPlan, 1000), TreatmentOwner: sanitizeText(form.treatmentOwner, 120),
      DueDate: parseDate(form.due),
      Status: status, IdentifiedDate: parseDate(form.identified) || new Date(),
      NextReviewDue: parseDate(form.nextReview),
      RelatedIncidentID: sanitizeText(form.relatedIncident, 120), Notes: sanitizeText(form.notes, 1000)
    };
    applyRiskScoring_(row, form);
    appendRow_(SHEETS.RISK, row, user.email);
    writeAudit_(user, 'CREATE', 'risk', SHEETS.RISK, id,
      title + ' (score ' + (l * i) + ')', 'success');
    return ok('บันทึกความเสี่ยงเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateRisk(riskId, form) {
  try {
    const user = requireModule('risk', true);
    const r = findRow_(SHEETS.RISK, 'RiskID', riskId);
    if (!r) throw new Error('ไม่พบความเสี่ยง');
    form = form || {};
    const patch = {};
    const setText = function (key, fk, len) { if (form[fk] !== undefined) patch[key] = sanitizeText(form[fk], len); };
    setText('Title', 'title', 300);
    setText('Category', 'category', 60);
    setText('RelatedAsset', 'relatedAsset', 200);
    setText('RelatedSystem', 'relatedSystem', 200);
    setText('Threat', 'threat', 500);
    setText('Vulnerability', 'vulnerability', 500);
    setText('Owner', 'owner', 120);
    setText('ExistingControls', 'existingControls', 1000);
    setText('TreatmentPlan', 'treatmentPlan', 1000);
    setText('TreatmentOwner', 'treatmentOwner', 120);
    setText('RelatedIncidentID', 'relatedIncident', 120);
    setText('Notes', 'notes', 1000);
    if (form.treatment !== undefined && form.treatment !== '') {
      const t = sanitizeText(form.treatment, 60);
      if (!isInList(t, RISK_TREATMENTS)) throw new Error('วิธีจัดการความเสี่ยงไม่ถูกต้อง');
      patch.Treatment = t;
    }
    if (form.status !== undefined && form.status !== '') {
      const st = sanitizeText(form.status, 40);
      if (!isInList(st, RISK_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
      patch.Status = st;
    }
    if (form.due !== undefined) patch.DueDate = parseDate(form.due);
    if (form.identified !== undefined) patch.IdentifiedDate = parseDate(form.identified);
    if (form.nextReview !== undefined) patch.NextReviewDue = parseDate(form.nextReview);
    applyRiskScoring_(patch, form);
    updateRow_(SHEETS.RISK, r._row, patch, user.email);
    writeAudit_(user, 'UPDATE', 'risk', SHEETS.RISK, riskId, JSON.stringify(patch), 'success');
    return ok('แก้ไขความเสี่ยงเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** บันทึกการทบทวนความเสี่ยงตามรอบ: อัปเดตความเสี่ยงคงเหลือ + วันทบทวนถัดไป */
function reviewRisk(riskId, form) {
  try {
    const user = requireModule('risk', true);
    const r = findRow_(SHEETS.RISK, 'RiskID', riskId);
    if (!r) throw new Error('ไม่พบความเสี่ยง');
    form = form || {};
    const patch = { LastReviewDate: new Date() };
    applyRiskScoring_(patch, form);
    if (form.nextReview !== undefined) patch.NextReviewDue = parseDate(form.nextReview);
    if (form.status !== undefined && form.status !== '') {
      const st = sanitizeText(form.status, 40);
      if (!isInList(st, RISK_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
      patch.Status = st;
    }
    if (form.notes !== undefined && form.notes !== '') {
      const prev = r.Notes ? (r.Notes + '\n') : '';
      patch.Notes = sanitizeText(prev + '[ทบทวน ' + fmtDate(new Date()) + '] ' + form.notes, 2000);
    }
    updateRow_(SHEETS.RISK, r._row, patch, user.email);
    writeAudit_(user, 'REVIEW', 'risk', SHEETS.RISK, riskId,
      'residual score ' + (patch.ResidualScore || '-'), 'success');
    return ok('บันทึกผลการทบทวนความเสี่ยงเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setRiskStatus(riskId, status) {
  try {
    const user = requireModule('risk', true);
    const r = findRow_(SHEETS.RISK, 'RiskID', riskId);
    if (!r) throw new Error('ไม่พบความเสี่ยง');
    status = sanitizeText(status, 40);
    if (!isInList(status, RISK_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
    updateRow_(SHEETS.RISK, r._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'risk', SHEETS.RISK, riskId, status, 'success');
    return ok('ปรับสถานะความเสี่ยงเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
