/**
 * Module_Evidence.gs
 * Audit Evidence Center
 *  - คำนวณสุขภาพมาตรการควบคุมจากข้อมูลปฏิบัติการรายโมดูล (ไม่ใช่ Legal Compliance)
 *  - รวมจำนวนหลักฐานจากทุกโมดูล
 *  - Export รายงานสรุปเป็น PDF (Google Docs) และ Export ทะเบียนเป็น CSV
 * อ้างอิง: ทุกหมวด
 */

/** สรุปข้อมูลศูนย์หลักฐาน + สุขภาพมาตรการควบคุม */
function getEvidenceData() {
  try {
    requireModule('evidence', false);
    const compliance = computeCompliance_();
    let totalControls = 0, compliantControls = 0;
    compliance.forEach(function (c) {
      totalControls += c.total;
      compliantControls += c.compliant;
    });
    const hasData = totalControls > 0;
    const overall = hasData ? Math.round((compliantControls / totalControls) * 100) : 0;

    const evidenceCounts = countEvidence_();
    return ok({
      generatedAt: fmtDateTime(new Date()),
      overall: overall, hasData: hasData,
      totalControls: totalControls, compliantControls: compliantControls,
      compliance: compliance, evidence: evidenceCounts,
      sheets: getExportableSheets_()
    });
  } catch (e) { return fail(e.message); }
}

/** คำนวณสุขภาพมาตรการควบคุมรายโมดูล โดยอ้าง PolicyMapping */
function computeCompliance_() {
  const map = {};
  try {
    readSheetObjects_(SHEETS.POLICY_MAP).forEach(function (r) {
      map[r.Module] = { clause: r.PolicyClause, doc: r.PolicyDocument, feature: r.Feature };
    });
  } catch (e) {}

  const rows = [];
  function add(moduleKey, label, total, compliant, detail) {
    const hasData = total > 0;
    const pct = hasData ? Math.round((compliant / total) * 100) : 0;
    const status = total === 0 ? 'gray' : (pct >= 90 ? 'green' : (pct >= 70 ? 'yellow' : 'red'));
    const m = map[moduleKey] || {};
    rows.push({
      module: moduleKey, label: label, total: total, compliant: compliant, pct: pct,
      hasData: hasData, status: status, detail: detail,
      policyClause: m.clause || '', policyDoc: m.doc || ''
    });
  }

  // Ticket: งานที่ปิด/ยกระดับแล้ว หรือยังไม่เกิน SLA
  countControl_(SHEETS.TICKET, function (r) {
    if (isTicketTerminal_(r.Status)) return true;
    return r.DueAt ? ticketEvidenceHoursUntil_(r.DueAt) >= 0 : false;
  }, function (t, c) { add('ticket', 'Help Desk/Ticket', t, c, 'จัดการ Ticket ตาม SLA และยกระดับเหตุภัยคุกคาม'); });

  // Asset: License ที่ยังไม่หมดอายุ (ของที่มี License และยังใช้งาน)
  countControl_(SHEETS.ASSET, function (r) {
    if (isAssetRetired_(r.Status) || !r.LicenseExpiry) return null;
    return daysUntil(r.LicenseExpiry) >= 0;
  }, function (t, c) { add('asset', 'ทรัพย์สิน/License', t, c, 'License ที่ยังไม่หมดอายุ'); });

  // Data Classification: ชุดข้อมูลที่ยังไม่เลยกำหนดทำลาย
  countControl_(SHEETS.DATA_CLASS, function (r) {
    if (String(r.Status) === 'ทำลายแล้ว' || !r.DestructionDue) return null;
    return daysUntil(r.DestructionDue) >= 0;
  }, function (t, c) { add('dataClass', 'การคุ้มครอง/ทำลายข้อมูล', t, c, 'ยังไม่เลยกำหนดทำลาย'); });

  // Access: สิทธิ์ active ที่ทบทวนตามรอบ (ยังไม่เลยกำหนด)
  countControl_(SHEETS.ACCESS_REGISTRY, function (r) {
    if (String(r.Status).toLowerCase() !== 'active') return null;
    return r.NextReviewDue ? daysUntil(r.NextReviewDue) >= 0 : false;
  }, function (t, c) { add('access', 'การทบทวนสิทธิ์', t, c, 'สิทธิ์ที่ทบทวนตามรอบ'); });

  // Backup: รอบสำรองที่ผลสำเร็จ
  countControl_(SHEETS.BACKUP, function (r) {
    return String(r.Result) === 'สำเร็จ';
  }, function (t, c) { add('backup', 'การสำรองข้อมูล', t, c, 'รอบที่สำรองสำเร็จ'); });

  // Logging: ระบบที่ตรวจสอบ Log ตามรอบ
  countControl_(SHEETS.LOG_REGISTER, function (r) {
    if (String(r.Status).indexOf('ยกเลิก') > -1) return null;
    return r.NextReviewDue ? daysUntil(r.NextReviewDue) >= 0 : false;
  }, function (t, c) { add('logging', 'การตรวจสอบ Log', t, c, 'ระบบที่ตรวจตามรอบ'); });

  // Incident: ต้องประเมินหน้าที่แจ้งภายนอก และกรณีที่ตัดสินใจว่าต้องแจ้งต้องมีหลักฐานว่าแจ้งแล้ว
  const sentNotificationsByIncident = {};
  safeEach_(SHEETS.REGULATORY_NOTIFICATION, function (r) {
    if (String(r.Required) !== 'Yes' || String(r.Status) !== 'แจ้งแล้ว') return;
    const key = String(r.IncidentID || '');
    sentNotificationsByIncident[key] = (sentNotificationsByIncident[key] || 0) + 1;
  });
  countControl_(SHEETS.INCIDENT, function (r) {
    const assessed = String(r.RegulatoryAssessmentStatus) === 'ประเมินแล้ว';
    if (!assessed) return false;
    const requiredCount = ['PDPCNotifyRequired', 'DataSubjectNotifyRequired',
      'NCSAReportRequired', 'OtherRegulatorRequired'].filter(function (field) {
        return String(r[field]) === 'Yes';
      }).length;
    const sentCount = sentNotificationsByIncident[String(r.IncidentID || '')] || 0;
    const dpoOk = String(r.ContainsPersonalData).toLowerCase() !== 'yes' ||
      String(r.DPONotified).toLowerCase() === 'yes';
    return dpoOk && sentCount >= requiredCount && String(r.Status) === 'ปิดเคส';
  }, function (t, c) {
    add('incident', 'การจัดการเหตุการณ์', t, c,
      'เคสที่ปิด ประเมินหน้าที่แจ้ง และมีหลักฐานการแจ้งครบ');
  });

  // Vendor: สัญญาที่ยังไม่หมดอายุ
  countControl_(SHEETS.VENDOR, function (r) {
    if (String(r.Status).toLowerCase() === 'inactive') return null;
    return r.ContractExpiry ? daysUntil(r.ContractExpiry) >= 0 : false;
  }, function (t, c) { add('vendor', 'ผู้ให้บริการภายนอก', t, c, 'สัญญาที่ยังไม่หมดอายุ'); });

  // BCP: แผนที่ทบทวนตามรอบ
  countControl_(SHEETS.BCP, function (r) {
    return r.NextReviewDue ? daysUntil(r.NextReviewDue) >= 0 : false;
  }, function (t, c) { add('backup', 'แผนฉุกเฉิน (BCP/DR)', t, c, 'แผนที่ทบทวนตามรอบ'); });

  // Awareness: แผนอบรมที่เสร็จสิ้น
  countControl_(SHEETS.TRAIN_PLAN, function (r) {
    return String(r.Status).indexOf('เสร็จ') > -1;
  }, function (t, c) { add('awareness', 'แผนอบรมประจำปี', t, c, 'แผนที่ดำเนินการเสร็จ'); });

  // Change: นับว่าผ่านเมื่อจบกระบวนการแล้ว (Deploy สำเร็จ หรือถูกปฏิเสธอย่างเป็นทางการ)
  countControl_(SHEETS.CHANGE, function (r) {
    return String(r.Status) === 'ติดตั้งใช้งานแล้ว' || String(r.Status) === 'ปฏิเสธ';
  }, function (t, c) { add('change', 'การควบคุมการเปลี่ยนแปลง', t, c, 'คำขอที่จบกระบวนการอนุมัติ/ติดตั้ง'); });

  return rows;
}

/** นับ total/compliant ตามฟังก์ชันเงื่อนไข (คืน true=compliant, false=not, null=ไม่นับ) */
function countControl_(sheetName, fn, done) {
  let total = 0, compliant = 0;
  safeEach_(sheetName, function (r) {
    const v = fn(r);
    if (v === null) return;
    total++;
    if (v) compliant++;
  });
  done(total, compliant);
}

/** นับจำนวนหลักฐาน (แถวที่มีลิงก์) ในแต่ละทะเบียน */
function countEvidence_() {
  const sources = [
    { sheet: SHEETS.INCIDENT, col: 'EvidenceLink', label: 'เหตุการณ์' },
    { sheet: SHEETS.TICKET, col: 'EvidenceLink', label: 'Ticket/Help Desk' },
    { sheet: SHEETS.BACKUP, col: 'EvidenceLink', label: 'สำรองข้อมูล' },
    { sheet: SHEETS.RECOVERY, col: 'EvidenceLink', label: 'ทดสอบกู้คืน' },
    { sheet: SHEETS.LOG_REVIEW, col: 'EvidenceLink', label: 'ตรวจสอบ Log' },
    { sheet: SHEETS.TRAIN_REC, col: 'EvidenceLink', label: 'การอบรม' },
    { sheet: SHEETS.DATA_DESTROY, col: 'EvidenceLink', label: 'ทำลายข้อมูล' },
    { sheet: SHEETS.POLICY_ACK, col: 'AckID', label: 'รับทราบนโยบาย' },
    { sheet: SHEETS.COMPLIANCE_ASSESSMENT, col: 'EvidenceLink', label: 'ผลประเมินกฎหมาย' },
    { sheet: SHEETS.CORRECTIVE_ACTION, col: 'EvidenceLink', label: 'CAPA' },
    { sheet: SHEETS.REGULATORY_NOTIFICATION, col: 'EvidenceLink', label: 'แจ้งหน่วยงานกำกับ' }
  ];
  return sources.map(function (s) {
    let n = 0;
    safeEach_(s.sheet, function (r) { if (r[s.col] && String(r[s.col]).trim()) n++; });
    return { label: s.label, count: n };
  });
}

function getExportableSheets_() {
  return [
    { key: SHEETS.TICKET, label: 'Ticket / Help Desk' },
    { key: SHEETS.ACCESS_REQ, label: 'คำขอสิทธิ์' },
    { key: SHEETS.ACCESS_REGISTRY, label: 'ทะเบียนสิทธิ์ (RBAC)' },
    { key: SHEETS.INCIDENT, label: 'เหตุการณ์ (Incident)' },
    { key: SHEETS.REGULATORY_NOTIFICATION, label: 'การแจ้งหน่วยงานกำกับ' },
    { key: SHEETS.LEGAL_REGISTER, label: 'ทะเบียนกฎหมาย' },
    { key: SHEETS.COMPLIANCE_OBLIGATION, label: 'ข้อกำหนดกฎหมาย' },
    { key: SHEETS.COMPLIANCE_ASSESSMENT, label: 'ผลประเมินข้อกำหนด' },
    { key: SHEETS.CORRECTIVE_ACTION, label: 'CAPA / แผนแก้ไข' },
    { key: SHEETS.ASSET, label: 'ทรัพย์สิน' },
    { key: SHEETS.DATA_CLASS, label: 'ชุดข้อมูล' },
    { key: SHEETS.DATA_DESTROY, label: 'คำขอทำลายข้อมูล' },
    { key: SHEETS.CHANGE, label: 'การเปลี่ยนแปลงระบบ' },
    { key: SHEETS.BACKUP, label: 'บันทึกสำรองข้อมูล' },
    { key: SHEETS.RECOVERY, label: 'ทดสอบกู้คืน' },
    { key: SHEETS.BCP, label: 'แผนฉุกเฉิน' },
    { key: SHEETS.LOG_REGISTER, label: 'ทะเบียน Log' },
    { key: SHEETS.LOG_REVIEW, label: 'ผลตรวจสอบ Log' },
    { key: SHEETS.VENDOR, label: 'ผู้ให้บริการ' },
    { key: SHEETS.AI, label: 'เครื่องมือ AI' },
    { key: SHEETS.CLOUD, label: 'ระบบ Cloud' },
    { key: SHEETS.TRAIN_PLAN, label: 'แผนอบรม' },
    { key: SHEETS.TRAIN_REC, label: 'บันทึกการอบรม' },
    { key: SHEETS.POLICY_ACK, label: 'รับทราบนโยบาย' }
  ];
}

function ticketEvidenceHoursUntil_(target) {
  if (!target) return null;
  const t = (target instanceof Date) ? target : new Date(target);
  if (isNaN(t)) return null;
  return Math.round((t - new Date()) / 3600000);
}

/** Export ทะเบียนเป็น CSV (เพิ่ม BOM ให้ Excel อ่านภาษาไทยถูก) */
function exportSheetCsv(sheetName) {
  try {
    requireModule('evidence', false);
    const allowed = getExportableSheets_().map(function (s) { return s.key; });
    if (allowed.indexOf(sheetName) === -1) throw new Error('ไม่อนุญาตให้ส่งออกทะเบียนนี้');
    const values = getSheet_(sheetName).getDataRange().getValues();
    const csv = values.map(function (row) {
      return row.map(function (cell) {
        let s = (cell instanceof Date) ? fmtDateTime(cell) : String(cell === null ? '' : cell);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',');
    }).join('\r\n');
    writeAudit_(getCurrentUser(), 'EXPORT_CSV', 'evidence', sheetName, '', '', 'success');
    return ok({ filename: sheetName + '_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd') + '.csv', content: '﻿' + csv });
  } catch (e) { return fail(e.message); }
}

/** สร้างรายงานสรุปสุขภาพมาตรการควบคุมเป็น Google Docs แล้วแปลงเป็น PDF เก็บใน Drive */
function exportComplianceReportPdf() {
  try {
    const user = requireModule('evidence', false);
    const compliance = computeCompliance_();
    let totalControls = 0, compliantControls = 0;
    compliance.forEach(function (c) {
      totalControls += c.total;
      compliantControls += c.compliant;
    });
    const hasData = totalControls > 0;
    const overall = hasData ? Math.round((compliantControls / totalControls) * 100) : 0;
    const orgName = getConfig_('ORG_NAME', 'กองทุนประกันชีวิต');

    const doc = DocumentApp.create('รายงานสุขภาพมาตรการควบคุม_' +
      Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss'));
    const body = doc.getBody();
    body.appendParagraph(orgName).setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('รายงานสรุปสุขภาพมาตรการควบคุมความมั่นคงปลอดภัยสารสนเทศและไซเบอร์')
      .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
    body.appendParagraph('วันที่ออกรายงาน: ' + fmtDateTime(new Date()));
    body.appendParagraph('ผู้ออกรายงาน: ' + user.name + ' (' + user.email + ')');
    body.appendParagraph('สุขภาพมาตรการควบคุมโดยรวม: ' + (hasData ? overall + '%' : 'N/A (ยังไม่มีข้อมูลควบคุม)'))
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('หมายเหตุ: ตัวเลขนี้สะท้อนข้อมูลการปฏิบัติงานของมาตรการควบคุม ไม่ใช่คำรับรองการปฏิบัติตามกฎหมาย โปรดดูผลประเมินในโมดูลกฎหมายและการปฏิบัติตาม');

    const table = [['โมดูล/ข้อกำหนด', 'ข้อกำหนดนโยบาย', 'ทั้งหมด', 'ผ่านเกณฑ์', '%']];
    compliance.forEach(function (c) {
      table.push([c.label, c.policyClause || '-', String(c.total), String(c.compliant), c.hasData ? c.pct + '%' : 'N/A']);
    });
    body.appendTable(table);
    body.appendParagraph('\nหมายเหตุ: รายงานนี้สร้างอัตโนมัติจากระบบ ISMS Governance เพื่อใช้ประกอบการตรวจสอบ (IT Audit)')
      .setItalic(true);

    doc.saveAndClose();
    const docFile = DriveApp.getFileById(doc.getId());
    const pdfBlob = docFile.getAs('application/pdf');
    const folder = getEvidenceFolder_('รายงาน');
    const pdf = folder.createFile(pdfBlob).setName(doc.getName() + '.pdf');
    docFile.setTrashed(true); // ลบไฟล์ Docs ชั่วคราว เก็บเฉพาะ PDF

    writeAudit_(user, 'EXPORT_PDF', 'evidence', '', pdf.getId(), 'รายงานสุขภาพมาตรการควบคุม', 'success');
    return ok({ url: pdf.getUrl(), name: pdf.getName(), overall: overall, hasData: hasData });
  } catch (e) { return fail(e.message); }
}
