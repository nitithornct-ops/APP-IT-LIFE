/**
 * Module_Incident.gs
 * การบริหารจัดการเหตุการณ์ (Incident Response Management)
 *
 * Workflow: รับแจ้งเหตุ → จำแนกประเภท/ระดับความรุนแรง → มอบหมาย → ติดตามจนปิดเคส → สรุป+บทเรียน
 * กรณีข้อมูลส่วนบุคคลรั่วไหล: ส่ง DPO คัดกรองตามกรอบเวลาภายใน
 * แล้วประเมินหน้าที่แจ้ง สคส./เจ้าของข้อมูล/สกมช./หน่วยงานกำกับแยกต่างหาก
 * อ้างอิง: การตอบสนองต่อเหตุการณ์ + หมวด 13
 */

const INC_STATUS = { OPEN: 'เปิด', IN_PROGRESS: 'กำลังดำเนินการ', CLOSED: 'ปิดเคส' };
const INC_SEVERITY = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'];
const INC_CATEGORY = ['มัลแวร์/ไวรัส', 'การเข้าถึงโดยไม่ได้รับอนุญาต', 'ข้อมูลรั่วไหล',
  'ฟิชชิง/หลอกลวง', 'ระบบล่ม/ใช้งานไม่ได้', 'การละเมิดนโยบาย', 'อื่นๆ'];
const INC_BREACH_RISK = ['ไม่มีความเสี่ยง', 'ต่ำ', 'ปานกลาง', 'สูง'];
const INC_REGULATORY_STATUS = ['รอแจ้ง', 'แจ้งแล้ว', 'ไม่ต้องแจ้ง', 'ยกเลิก'];

function incidentDpoEscalationHours_() {
  const value = parseInt(getConfig_('INCIDENT_DPO_ESCALATION_HOURS', '4'), 10);
  if (isNaN(value)) return 4;
  return Math.max(1, Math.min(24, value));
}

// ===== เมทริกซ์ความเสี่ยง (Risk Matrix) — โอกาสเกิด × ผลกระทบ (1-5) =====
const INC_LIKELIHOOD = [
  { value: 1, label: 'น้อยมาก' }, { value: 2, label: 'น้อย' }, { value: 3, label: 'ปานกลาง' },
  { value: 4, label: 'สูง' }, { value: 5, label: 'สูงมาก' }
];
const INC_IMPACT = [
  { value: 1, label: 'เล็กน้อย' }, { value: 2, label: 'น้อย' }, { value: 3, label: 'ปานกลาง' },
  { value: 4, label: 'รุนแรง' }, { value: 5, label: 'รุนแรงมาก' }
];

/** คำนวณระดับความเสี่ยงจากคะแนน (โอกาส × ผลกระทบ, 1-25) */
function incRiskLevel_(score) {
  const s = Number(score) || 0;
  if (s <= 0) return { level: '', color: 'gray' };
  if (s <= 4) return { level: 'ต่ำ', color: 'green' };
  if (s <= 9) return { level: 'ปานกลาง', color: 'yellow' };
  if (s <= 14) return { level: 'สูง', color: 'orange' };
  return { level: 'วิกฤต', color: 'red' };
}

function getIncidentModuleData() {
  try {
    const user = requireModule('incident', false);
    ensureSheetBySchema_(SHEETS.INCIDENT); // migration ปลอดภัย: เพิ่มคอลัมน์ความเสี่ยงถ้ายังไม่มี
    ensureSheetBySchema_(SHEETS.REGULATORY_NOTIFICATION);
    const all = readSheetObjects_(SHEETS.INCIDENT);
    let list;

    if (user.role === ROLES.IT_ADMIN) {
      list = all;
    } else if (user.role === ROLES.DPO) {
      list = all.filter(function (r) { return String(r.ContainsPersonalData).toLowerCase() === 'yes'; });
    } else if (user.role === ROLES.APPROVER || user.role === ROLES.EXECUTIVE) {
      list = all; // อ่านได้ (ภาพรวม/หน่วยงาน)
    } else {
      // User: เห็นเฉพาะที่ตนแจ้ง
      list = all.filter(function (r) { return String(r.ReportedBy).toLowerCase() === user.email; });
    }

    const allowedIds = {};
    list.forEach(function (r) { allowedIds[String(r.IncidentID)] = true; });
    const notifications = readSheetObjects_(SHEETS.REGULATORY_NOTIFICATION)
      .filter(function (r) { return allowedIds[String(r.IncidentID)]; })
      .map(serializeRegulatoryNotification_);

    return ok({
      role: user.role,
      canManage: user.role === ROLES.IT_ADMIN,
      canDPO: user.role === ROLES.DPO || user.role === ROLES.IT_ADMIN,
      categories: INC_CATEGORY, severities: INC_SEVERITY,
      likelihoodScale: INC_LIKELIHOOD, impactScale: INC_IMPACT,
      breachRiskLevels: INC_BREACH_RISK, regulatoryStatuses: INC_REGULATORY_STATUS,
      incidents: list.map(serializeIncident), regulatoryNotifications: notifications
    });
  } catch (e) {
    return fail(e.message);
  }
}

function serializeIncident(r) {
  const dl = (String(r.ContainsPersonalData).toLowerCase() === 'yes' &&
    String(r.DPONotified).toLowerCase() !== 'yes') ? hoursUntil(r.DPONotifyDeadline) : null;
  const likelihood = Number(r.Likelihood) || 0;
  const impact = Number(r.Impact) || 0;
  const riskScore = (likelihood && impact) ? likelihood * impact : (Number(r.RiskScore) || 0);
  const rl = incRiskLevel_(riskScore);
  const incidentAttachmentIds = incidentRegisteredAttachmentIds_(r.IncidentID);
  const legacySourceEvidence = incidentHasLegacySourceTicketEvidence_(r.SourceTicketID);
  return {
    row: r._row, id: r.IncidentID, title: r.Title, reportedBy: r.ReportedBy,
    reportDate: fmtDateTime(r.ReportDate), category: r.Category, severity: r.Severity,
    likelihood: likelihood, impact: impact, riskScore: riskScore,
    riskLevel: rl.level, riskColor: rl.color,
    description: r.Description, affectedSystem: r.AffectedSystem,
    personalData: r.ContainsPersonalData, assignee: r.Assignee,
    dpoNotified: r.DPONotified, dpoDeadline: fmtDateTime(r.DPONotifyDeadline),
    dpoHoursLeft: dl, status: r.Status, rootCause: r.RootCause, resolution: r.Resolution,
    lessons: r.LessonsLearned, closeDate: fmtDate(r.CloseDate),
    // Old escalations may still contain a copied raw Ticket locator. Keep it
    // server-side and expose only the source relationship/availability flag.
    evidence: r.SourceTicketID ? '' : r.EvidenceLink,
    hasLegacySourceTicketEvidence: legacySourceEvidence,
    legacyEvidenceMigrationRequired: legacySourceEvidence && !incidentAttachmentIds.length,
    attachmentIds: incidentAttachmentIds,
    regulatoryAssessmentStatus: r.RegulatoryAssessmentStatus || 'รอประเมิน',
    breachRiskLevel: r.BreachRiskLevel,
    pdpcNotifyRequired: r.PDPCNotifyRequired,
    dataSubjectNotifyRequired: r.DataSubjectNotifyRequired,
    ncsaReportRequired: r.NCSAReportRequired,
    otherRegulatorRequired: r.OtherRegulatorRequired,
    regulatoryAssessment: r.RegulatoryAssessment,
    regulatoryAssessmentAt: fmtDateTime(r.RegulatoryAssessmentAt),
    regulatoryAssessedBy: r.RegulatoryAssessedBy,
    notes: r.Notes, sourceTicketId: r.SourceTicketID
  };
}

function incidentHasLegacySourceTicketEvidence_(sourceTicketId) {
  sourceTicketId = String(sourceTicketId || '').trim();
  if (!sourceTicketId) return false;
  try {
    const ticket = findRow_(SHEETS.TICKET, 'TicketID', sourceTicketId);
    if (!ticket || !String(ticket.EvidenceLink || '').trim()) return false;
    const ids = typeof ticketNormalizeAttachmentIds_ === 'function' ?
      ticketNormalizeAttachmentIds_(ticket.AttachmentIDsJSON) : [];
    return !ids.length;
  } catch (e) {
    return false;
  }
}

function incidentRegisteredAttachmentIds_(incidentId) {
  if (!incidentId || !SHEETS.ATTACHMENT_LINK || !SHEETS.ATTACHMENT_REGISTRY) return [];
  try {
    const activeRegistry = {};
    readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true).forEach(function (row) {
      if (String(row.Status || '').toUpperCase() === 'ACTIVE') {
        activeRegistry[String(row.AttachmentID || '')] = true;
      }
    });
    const seen = {};
    return readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true).filter(function (link) {
      const id = String(link.AttachmentID || '');
      return String(link.ModuleKey || '') === 'incident' &&
        String(link.EntityID || link.RecordID || '') === String(incidentId) &&
        String(link.EntitySheet || '') === String(SHEETS.INCIDENT) &&
        String(link.FieldName || '') === 'SourceTicketAttachments' &&
        String(link.AttachmentRole || '') === 'INCIDENT_EVIDENCE' &&
        String(link.Status || '').toUpperCase() === 'ACTIVE' && activeRegistry[id] && !seen[id] &&
        (seen[id] = true);
    }).map(function (link) { return String(link.AttachmentID || ''); });
  } catch (e) {
    return [];
  }
}

function serializeRegulatoryNotification_(r) {
  return {
    id: r.NotificationID, incidentId: r.IncidentID, agency: r.Agency,
    type: r.NotificationType, required: r.Required, legalBasis: r.LegalBasis,
    deadline: fmtDateTime(r.Deadline), deadlineHoursLeft: hoursUntil(r.Deadline),
    status: r.Status, notifiedAt: fmtDateTime(r.NotifiedAt), referenceNo: r.ReferenceNo,
    approvedBy: r.ApprovedBy, evidence: r.EvidenceLink,
    reasonNotRequired: r.ReasonNotRequired, notes: r.Notes
  };
}

/** รับแจ้งเหตุ (ผู้ใช้ทุกบทบาทที่เข้าถึงโมดูลได้) */
function reportIncident(form) {
  try {
    const user = requireModule('incident', true);
    form = form || {};
    const title = sanitizeText(form.title, 200);
    const desc = sanitizeText(form.description, 3000);
    const category = sanitizeText(form.category, 60);
    const affected = sanitizeText(form.affectedSystem, 150);
    const personal = (String(form.personalData).toLowerCase() === 'yes') ? 'Yes' : 'No';

    requireFields({ Title: title, Description: desc, Category: category },
      ['Title', 'Description', 'Category']);
    if (!isInList(category, INC_CATEGORY)) throw new Error('กรุณาเลือกประเภทเหตุการณ์จากรายการ');

    const now = new Date();
    const id = generateId('INC');
    const dpoEscalationHours = incidentDpoEscalationHours_();
    const deadline = personal === 'Yes' ? new Date(now.getTime() + dpoEscalationHours * 3600000) : '';

    appendRow_(SHEETS.INCIDENT, {
      IncidentID: id, Title: title, ReportedBy: user.email, ReportDate: now,
      Category: category, Severity: '', Description: desc, AffectedSystem: affected,
      ContainsPersonalData: personal, Assignee: '', DPONotified: 'No',
      DPONotifyDeadline: deadline, Status: INC_STATUS.OPEN, EvidenceLink: sanitizeText(form.evidence, 500)
    }, user.email);

    writeAudit_(user, 'REPORT_INCIDENT', 'incident', SHEETS.INCIDENT, id,
      title + ' (PII=' + personal + ')', 'success');

    const link = getWebAppUrl();
    notify_(getITAdminEmails_().join(','), 'แจ้งเหตุการณ์ใหม่ ' + id,
      '<p>มีการแจ้งเหตุการณ์ใหม่:</p><ul><li>เรื่อง: ' + escapeHtml(title) +
      '</li><li>ประเภท: ' + escapeHtml(category) + '</li><li>ผู้แจ้ง: ' + escapeHtml(user.name) +
      '</li><li>ข้อมูลส่วนบุคคล: ' + personal + '</li></ul>' +
      '<p><a href="' + link + '">เปิดระบบเพื่อจัดการ</a></p>',
      'เหตุการณ์ใหม่ ' + id + ': ' + title + ' (PII=' + personal + ')', 'incident', id);

    if (personal === 'Yes') notifyDPOForIncident_(id, title, deadline);

    return ok('บันทึกการแจ้งเหตุเรียบร้อย เลขที่ ' + id +
      (personal === 'Yes' ? ' (ส่ง DPO คัดกรองภายใน ' + dpoEscalationHours + ' ชม.)' : ''));
  } catch (e) {
    return fail(e.message);
  }
}

function notifyDPOForIncident_(id, title, deadline) {
  const dpos = readSheetObjects_(SHEETS.USERS)
    .filter(function (u) { return u.Role === ROLES.DPO && String(u.Status).toLowerCase() === 'active'; })
    .map(function (u) { return u.Email; });
  const to = (dpos.join(',') || getITAdminEmails_().join(','));
  notify_(to, '[PDPA] เหตุการณ์ข้อมูลส่วนบุคคล ' + id + ' — DPO ต้องคัดกรองโดยเร็ว',
    '<p style="color:#dc3545"><b>เคสข้อมูลส่วนบุคคล</b></p><p>เรื่อง: ' + escapeHtml(title) +
    '</p><p>กรอบติดตาม DPO ภายในองค์กร: <b>' + fmtDateTime(deadline) + '</b></p>' +
    '<p>กรอบนี้ไม่ใช่หลักฐานการแจ้ง สคส. ให้ประเมินหน้าที่แจ้งภายนอกในโมดูล Incident แยกต่างหาก</p>',
    '[PDPA] ' + id + ': ' + title + ' DPO คัดกรองภายใน ' + fmtDateTime(deadline), 'incident', id);
}

/** จำแนก/มอบหมาย/ปรับปรุงเคส (IT Admin) */
function updateIncident(id, fields) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    ensureSheetBySchema_(SHEETS.INCIDENT); // กันกรณีคอลัมน์ความเสี่ยงยังไม่ถูกสร้าง
    const inc = findRow_(SHEETS.INCIDENT, 'IncidentID', id);
    if (!inc) throw new Error('ไม่พบเหตุการณ์ ' + id);
    fields = fields || {};
    const patch = {};
    if (fields.severity !== undefined) {
      if (!isInList(fields.severity, INC_SEVERITY)) throw new Error('ระดับความรุนแรงไม่ถูกต้อง');
      patch.Severity = fields.severity;
    }
    // ประเมินความเสี่ยง: โอกาสเกิด × ผลกระทบ (1-5) — เว้นว่างได้ถ้ายังไม่ประเมิน
    let curL = Number(inc.Likelihood) || 0, curI = Number(inc.Impact) || 0;
    if (fields.likelihood !== undefined && fields.likelihood !== '') {
      curL = parseInt(fields.likelihood, 10);
      if (!(curL >= 1 && curL <= 5)) throw new Error('โอกาสเกิด (Likelihood) ต้องอยู่ระหว่าง 1-5');
      patch.Likelihood = curL;
    }
    if (fields.impact !== undefined && fields.impact !== '') {
      curI = parseInt(fields.impact, 10);
      if (!(curI >= 1 && curI <= 5)) throw new Error('ผลกระทบ (Impact) ต้องอยู่ระหว่าง 1-5');
      patch.Impact = curI;
    }
    if (patch.Likelihood !== undefined || patch.Impact !== undefined) {
      patch.RiskScore = (curL >= 1 && curI >= 1) ? curL * curI : '';
    }
    if (fields.assignee !== undefined) patch.Assignee = sanitizeText(fields.assignee, 120);
    if (fields.status !== undefined) {
      if (!isInList(fields.status, [INC_STATUS.OPEN, INC_STATUS.IN_PROGRESS, INC_STATUS.CLOSED]))
        throw new Error('สถานะไม่ถูกต้อง');
      if (fields.status === INC_STATUS.CLOSED)
        throw new Error('กรุณาใช้คำสั่งปิดเคส เพื่อบันทึก Root Cause, Resolution และตรวจ Regulatory Gate');
      patch.Status = fields.status;
    }
    if (fields.notes !== undefined) patch.Notes = sanitizeText(fields.notes, 1000);
    if (fields.evidence !== undefined) patch.EvidenceLink = sanitizeText(fields.evidence, 500);

    updateRow_(SHEETS.INCIDENT, inc._row, patch, user.email);
    writeAudit_(user, 'UPDATE_INCIDENT', 'incident', SHEETS.INCIDENT, id, JSON.stringify(patch), 'success');

    if (patch.Assignee && isValidEmail(patch.Assignee)) {
      notify_(patch.Assignee, 'ท่านได้รับมอบหมายเหตุการณ์ ' + id,
        '<p>ท่านได้รับมอบหมายให้ดูแลเหตุการณ์ ' + escapeHtml(id) + ': ' + escapeHtml(inc.Title) + '</p>',
        'มอบหมายเหตุการณ์ ' + id + ' ให้ท่าน', 'incident', id);
    }
    return ok('ปรับปรุงเหตุการณ์เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** บันทึกว่าได้แจ้ง DPO/ดำเนินการตาม PDPA แล้ว */
function markDPONotified(id, note) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.DPO]);
    const inc = findRow_(SHEETS.INCIDENT, 'IncidentID', id);
    if (!inc) throw new Error('ไม่พบเหตุการณ์ ' + id);
    updateRow_(SHEETS.INCIDENT, inc._row, {
      DPONotified: 'Yes', Notes: (inc.Notes ? inc.Notes + ' | ' : '') + 'แจ้ง DPO/PDPA: ' + sanitizeText(note, 300)
    }, user.email);
    writeAudit_(user, 'DPO_NOTIFIED', 'incident', SHEETS.INCIDENT, id, sanitizeText(note, 300), 'success');
    return ok('บันทึกการแจ้ง DPO/ดำเนินการตาม PDPA เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ประเมินหน้าที่แจ้งภายนอก แยกจากการแจ้ง DPO ภายใน
 * ไม่คำนวณผลทางกฎหมายให้อัตโนมัติ ผู้ประเมินต้องบันทึกเหตุผลทุกครั้ง
 */
function assessIncidentRegulatory(id, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.DPO]);
    ensureSheetBySchema_(SHEETS.INCIDENT);
    const inc = findRow_(SHEETS.INCIDENT, 'IncidentID', id);
    if (!inc) throw new Error('ไม่พบเหตุการณ์ ' + id);
    form = form || {};
    const breachRisk = sanitizeText(form.breachRiskLevel, 40);
    if (breachRisk && !isInList(breachRisk, INC_BREACH_RISK))
      throw new Error('ระดับความเสี่ยงของเหตุละเมิดไม่ถูกต้อง');
    const decision = function (value, label) {
      value = sanitizeText(value, 20) || 'Pending';
      if (!isInList(value, ['Yes', 'No', 'Pending'])) throw new Error(label + ' ไม่ถูกต้อง');
      return value;
    };
    const assessment = sanitizeText(form.assessment, 3000);
    requireFields({ 'เหตุผลการประเมิน': assessment }, ['เหตุผลการประเมิน']);
    const pdpcDecision = decision(form.pdpcRequired, 'ผลพิจารณาแจ้ง สคส.');
    const dataSubjectDecision = decision(form.dataSubjectRequired, 'ผลพิจารณาแจ้งเจ้าของข้อมูล');
    const ncsaDecision = decision(form.ncsaRequired, 'ผลพิจารณาแจ้ง สกมช.');
    const otherDecision = decision(form.otherRegulatorRequired, 'ผลพิจารณาแจ้งหน่วยงานกำกับอื่น');
    const pending = [pdpcDecision, dataSubjectDecision, ncsaDecision, otherDecision]
      .indexOf('Pending') > -1;
    const patch = {
      RegulatoryAssessmentStatus: pending ? 'รอตัดสินใจ' : 'ประเมินแล้ว',
      BreachRiskLevel: breachRisk,
      PDPCNotifyRequired: pdpcDecision,
      DataSubjectNotifyRequired: dataSubjectDecision,
      NCSAReportRequired: ncsaDecision,
      OtherRegulatorRequired: otherDecision,
      RegulatoryAssessment: assessment,
      RegulatoryAssessmentAt: new Date(),
      RegulatoryAssessedBy: user.email
    };
    updateRow_(SHEETS.INCIDENT, inc._row, patch, user.email);
    writeAudit_(user, 'ASSESS_REGULATORY_NOTIFICATION', 'incident', SHEETS.INCIDENT, id,
      JSON.stringify({
        pdpc: patch.PDPCNotifyRequired, dataSubject: patch.DataSubjectNotifyRequired,
        ncsa: patch.NCSAReportRequired, other: patch.OtherRegulatorRequired
      }), 'success');
    return ok(pending
      ? 'บันทึกผลประเมินแล้ว แต่ยังมีปลายทางที่รอตัดสินใจ จึงยังปิด Incident ไม่ได้'
      : 'บันทึกผลประเมินหน้าที่แจ้งหน่วยงานกำกับเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** บันทึกหลักฐานการแจ้งหน่วยงานกำกับ/เจ้าของข้อมูลหนึ่งรายการ */
function saveIncidentRegulatoryNotification(incidentId, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.DPO]);
    ensureSheetBySchema_(SHEETS.REGULATORY_NOTIFICATION);
    const inc = findRow_(SHEETS.INCIDENT, 'IncidentID', incidentId);
    if (!inc) throw new Error('ไม่พบเหตุการณ์ ' + incidentId);
    form = form || {};
    const agency = sanitizeText(form.agency, 250);
    const type = sanitizeText(form.type, 250);
    const required = sanitizeText(form.required, 20) || 'Yes';
    const status = sanitizeText(form.status, 40) || 'รอแจ้ง';
    requireFields({ 'หน่วยงาน/ผู้รับแจ้ง': agency, 'ประเภทการแจ้ง': type },
      ['หน่วยงาน/ผู้รับแจ้ง', 'ประเภทการแจ้ง']);
    if (!isInList(required, ['Yes', 'No'])) throw new Error('สถานะว่าต้องแจ้งไม่ถูกต้อง');
    if (!isInList(status, INC_REGULATORY_STATUS)) throw new Error('สถานะการแจ้งไม่ถูกต้อง');
    const reasonNotRequired = sanitizeText(form.reasonNotRequired, 2000);
    if (required === 'No' && !reasonNotRequired)
      throw new Error('กรุณาระบุเหตุผลและฐานการตัดสินใจว่าไม่ต้องแจ้ง');
    if (required === 'No' && status !== 'ไม่ต้องแจ้ง')
      throw new Error('กรณีไม่ต้องแจ้ง กรุณาเลือกสถานะ “ไม่ต้องแจ้ง”');
    if (required === 'Yes' && status === 'ไม่ต้องแจ้ง')
      throw new Error('สถานะ “ไม่ต้องแจ้ง” ขัดกับการเลือกว่ามีหน้าที่ต้องแจ้ง');
    const referenceNo = sanitizeText(form.referenceNo, 250);
    const evidence = sanitizeText(form.evidence, 1000);
    if (status === 'แจ้งแล้ว' && !referenceNo && !evidence)
      throw new Error('เมื่อสถานะเป็น “แจ้งแล้ว” ต้องระบุเลขรับเรื่องหรือลิงก์หลักฐานอย่างน้อยหนึ่งรายการ');
    const id = generateId('RNT');
    appendRow_(SHEETS.REGULATORY_NOTIFICATION, {
      NotificationID: id, IncidentID: incidentId, Agency: agency, NotificationType: type,
      Required: required, LegalBasis: sanitizeText(form.legalBasis, 1000),
      Deadline: parseDate(form.deadline), Status: status,
      NotifiedAt: status === 'แจ้งแล้ว' ? (parseDate(form.notifiedAt) || new Date()) : '',
      ReferenceNo: referenceNo,
      ApprovedBy: sanitizeText(form.approvedBy, 120),
      EvidenceLink: evidence,
      ReasonNotRequired: reasonNotRequired, Notes: sanitizeText(form.notes, 1500)
    }, user.email);
    writeAudit_(user, 'RECORD_REGULATORY_NOTIFICATION', 'incident',
      SHEETS.REGULATORY_NOTIFICATION, id, incidentId + ' → ' + agency + ': ' + status, 'success');
    return ok('บันทึกการแจ้ง/การตัดสินใจเรียบร้อย (' + id + ')');
  } catch (e) {
    return fail(e.message);
  }
}

function incidentRegulatoryClosureGaps_(inc) {
  const gaps = [];
  if (String(inc.RegulatoryAssessmentStatus) !== 'ประเมินแล้ว') {
    gaps.push('ยังประเมินหน้าที่แจ้งภายนอกไม่ครบ');
    return gaps;
  }
  const decisions = [
    { field: 'PDPCNotifyRequired', label: 'สคส.', match: function (agency) {
      return agency.indexOf('คุ้มครองข้อมูลส่วนบุคคล') > -1 || agency.indexOf('สคส.') > -1;
    } },
    { field: 'DataSubjectNotifyRequired', label: 'เจ้าของข้อมูล', match: function (agency) {
      return agency.indexOf('เจ้าของข้อมูล') > -1;
    } },
    { field: 'NCSAReportRequired', label: 'สกมช./ThaiCERT', match: function (agency) {
      return agency.indexOf('รักษาความมั่นคงปลอดภัยไซเบอร์') > -1 ||
        agency.indexOf('สกมช') > -1 || agency.toLowerCase().indexOf('thaicert') > -1;
    } },
    { field: 'OtherRegulatorRequired', label: 'หน่วยงานกำกับอื่น', match: function (agency) {
      return agency.indexOf('คปภ') > -1 || agency.indexOf('หน่วยงานกำกับอื่น') > -1;
    } }
  ];
  let sent = [];
  try {
    sent = readSheetObjects_(SHEETS.REGULATORY_NOTIFICATION).filter(function (r) {
      return String(r.IncidentID) === String(inc.IncidentID) &&
        String(r.Required) === 'Yes' && String(r.Status) === 'แจ้งแล้ว';
    });
  } catch (e) {}
  decisions.forEach(function (item) {
    const value = String(inc[item.field] || 'Pending');
    if (value === 'Pending' || !value) {
      gaps.push('ยังไม่ตัดสินใจเรื่อง ' + item.label);
      return;
    }
    if (value !== 'Yes') return;
    const found = sent.some(function (r) { return item.match(String(r.Agency || '')); });
    if (!found) gaps.push('ยังไม่มีหลักฐานว่าแจ้ง ' + item.label + ' แล้ว');
  });
  if (String(inc.ContainsPersonalData).toLowerCase() === 'yes' &&
      String(inc.DPONotified).toLowerCase() !== 'yes') {
    gaps.push('DPO ภายในยังไม่ได้รับทราบ');
  }
  return gaps;
}

/** ปิดเคสพร้อมสรุปและบทเรียน (IT Admin) */
function closeIncident(id, rootCause, resolution, lessons) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const inc = findRow_(SHEETS.INCIDENT, 'IncidentID', id);
    if (!inc) throw new Error('ไม่พบเหตุการณ์ ' + id);
    requireFields({ RootCause: rootCause, Resolution: resolution }, ['RootCause', 'Resolution']);
    const regulatoryGaps = incidentRegulatoryClosureGaps_(inc);
    if (regulatoryGaps.length) {
      throw new Error('ยังปิด Incident ไม่ได้: ' + regulatoryGaps.join(' · '));
    }

    updateRow_(SHEETS.INCIDENT, inc._row, {
      RootCause: sanitizeText(rootCause, 2000), Resolution: sanitizeText(resolution, 2000),
      LessonsLearned: sanitizeText(lessons, 2000), Status: INC_STATUS.CLOSED, CloseDate: new Date()
    }, user.email);
    writeAudit_(user, 'CLOSE_INCIDENT', 'incident', SHEETS.INCIDENT, id, 'ปิดเคส', 'success');

    notify_(inc.ReportedBy, 'เหตุการณ์ ' + id + ' ปิดเคสแล้ว',
      '<p>เหตุการณ์ ' + escapeHtml(id) + ': ' + escapeHtml(inc.Title) + ' ได้รับการแก้ไขและปิดเคสแล้ว</p>',
      'เหตุการณ์ ' + id + ' ปิดเคสแล้ว', 'incident', id);
    return ok('ปิดเคสเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/** ชั่วโมงที่เหลือถึง deadline (อาจติดลบ) */
function hoursUntil(target) {
  if (!target) return null;
  const t = (target instanceof Date) ? target : new Date(target);
  if (isNaN(t)) return null;
  return Math.round((t - new Date()) / 3600000);
}
