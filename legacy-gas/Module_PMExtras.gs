/**
 * Module_PMExtras.gs
 * ส่วนเสริมของโมดูล PM / บำรุงรักษา:
 *  1) เช็กลิสต์รายข้อ (ผ่าน/ไม่ผ่าน/N/A) — helper แปลง + เทมเพลตเช็กลิสต์ (CRUD)
 *  2) เริ่มงาน / เลื่อนกำหนด (startMaintenance / rescheduleMaintenance)
 *  3) รายงานวิเคราะห์ PM (getPMAnalytics)
 *
 * อ้างอิงค่าคงที่จาก Module_ITAssetExtras.gs (PM_STATUSES, computeNextPmDate_ ฯลฯ)
 */

// ===================================================================
// 1) Checklist helpers
// ===================================================================
function parsePmChecklist_(json) {
  if (!json) return [];
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
}

/** จาก input (array ของ string หรือ {text}) → [{text}] */
function pmChecklistFromInput_(input) {
  if (!Array.isArray(input)) return [];
  return input.map(function (x) {
    const t = sanitizeText((x && x.text !== undefined) ? x.text : x, 200);
    return t ? { text: t } : null;
  }).filter(function (x) { return x; }).slice(0, 50);
}

/** จาก input ผลตรวจ → [{text,result,note}] */
function pmChecklistResultsFromInput_(input) {
  if (!Array.isArray(input)) return [];
  const allowed = ['ผ่าน', 'ไม่ผ่าน', 'N/A'];
  return input.map(function (x) {
    const t = sanitizeText(x && x.text, 200);
    if (!t) return null;
    let r = sanitizeText(x && x.result, 20);
    if (allowed.indexOf(r) === -1) r = 'ผ่าน';
    return { text: t, result: r, note: sanitizeText(x && x.note, 200) };
  }).filter(function (x) { return x; }).slice(0, 50);
}

/** คืน JSON ของเช็กลิสต์โดยล้างผลตรวจ (สำหรับสร้างรอบถัดไป) */
function pmChecklistResetResults_(json) {
  const items = parsePmChecklist_(json);
  if (!items.length) return '';
  return JSON.stringify(items.map(function (i) { return { text: i.text }; }));
}

// ===================================================================
// 2) เริ่มงาน / เลื่อนกำหนด
// ===================================================================
function startMaintenance(planId, technician) {
  try {
    const user = requireModule('maintenance', true);
    const p = findRowEnsured_(SHEETS.MAINTENANCE, 'MaintenanceID', planId);
    if (!p) throw new Error('ไม่พบแผน PM');
    if (p.Status === 'ดำเนินการแล้ว' || p.Status === 'ยกเลิก') throw new Error('แผนนี้ปิดแล้ว');
    const patch = { Status: 'กำลังดำเนินการ' };
    const tech = sanitizeText(technician, 120);
    if (tech) patch.Technician = tech;
    updateRow_(SHEETS.MAINTENANCE, p._row, patch, user.email);
    writeAudit_(user, 'START', 'maintenance', SHEETS.MAINTENANCE, planId, tech || '', 'success');
    return ok('เริ่มงาน PM แล้ว');
  } catch (e) { return fail(e.message); }
}

function rescheduleMaintenance(planId, form) {
  try {
    const user = requireModule('maintenance', true);
    const p = findRowEnsured_(SHEETS.MAINTENANCE, 'MaintenanceID', planId);
    if (!p) throw new Error('ไม่พบแผน PM');
    if (p.Status === 'ดำเนินการแล้ว' || p.Status === 'ยกเลิก') throw new Error('แผนนี้ปิดแล้ว ไม่สามารถเลื่อนได้');
    form = form || {};
    const newDate = parseDate(form.planDate);
    if (!newDate) throw new Error('กรุณาระบุวันแผนใหม่');
    const recurrence = p.Recurrence || 'ครั้งเดียว';
    const reason = sanitizeText(form.reason, 300);
    const patch = {
      PlanDate: newDate,
      NextDueDate: computeNextPmDate_(newDate, recurrence),
      Notes: (p.Notes ? p.Notes + ' | ' : '') + '[เลื่อน ' + fmtDate(new Date()) + '] → ' + fmtDate(newDate) + (reason ? ' (' + reason + ')' : '')
    };
    const tech = sanitizeText(form.technician, 120);
    if (tech) patch.Technician = tech;
    updateRow_(SHEETS.MAINTENANCE, p._row, patch, user.email);
    writeAudit_(user, 'RESCHEDULE', 'maintenance', SHEETS.MAINTENANCE, planId, fmtDate(newDate), 'success');
    return ok('เลื่อนกำหนดแผน PM เป็น ' + fmtDate(newDate) + ' เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 3) รายงานวิเคราะห์ PM
// ===================================================================
function getPMAnalytics() {
  try {
    const user = requireModule('maintenance', false);
    if (user.role === ROLES.USER) throw new Error('บทบาทนี้ไม่มีสิทธิ์ดูรายงานวิเคราะห์');
    const now = new Date();
    const rows = readSheetObjectsEnsured_(SHEETS.MAINTENANCE);

    let total = 0, done = 0, planned = 0, inProgress = 0, cancelled = 0, overdue = 0, due7 = 0, due30 = 0;
    let onTime = 0, onTimeEval = 0;
    const byTech = {}, byAsset = {}, trend = {};
    const bump = function (m, k) { k = String(k || 'ไม่ระบุ'); m[k] = (m[k] || 0) + 1; };
    const monthKey = function (d) { return Utilities.formatDate(new Date(d), 'Asia/Bangkok', 'yyyy-MM'); };

    rows.forEach(function (r) {
      total++;
      const st = String(r.Status || '');
      bump(byAsset, r.AssetName || r.AssetID);
      if (st === 'ดำเนินการแล้ว') {
        done++;
        bump(byTech, r.Technician);
        if (r.ActualDate && r.PlanDate) {
          const ad = new Date(r.ActualDate), pd = new Date(r.PlanDate);
          if (!isNaN(ad) && !isNaN(pd)) { onTimeEval++; if (ad <= pd) onTime++; }
        }
        if (r.ActualDate) { const k = monthKey(r.ActualDate); trend[k] = trend[k] || { done: 0 }; trend[k].done++; }
      } else if (st === 'ยกเลิก') {
        cancelled++;
      } else {
        if (st === 'กำลังดำเนินการ') inProgress++; else planned++;
        const d = daysUntil(r.PlanDate);
        if (d !== null) { if (d < 0) overdue++; else if (d <= 7) due7++; else if (d <= 30) due30++; }
      }
    });

    const trendArr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      trendArr.push({ month: k, done: (trend[k] || {}).done || 0 });
    }
    const toArr = function (m) { return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; }).sort(function (a, b) { return b.value - a.value; }); };
    const base = total - cancelled;

    return ok({
      total: total, done: done, planned: planned, inProgress: inProgress, cancelled: cancelled,
      overdue: overdue, due7: due7, due30: due30,
      completionRate: base ? Math.round(done / base * 100) : null,
      onTimeRate: onTimeEval ? Math.round(onTime / onTimeEval * 100) : null, onTimeEval: onTimeEval,
      byTechnician: toArr(byTech).slice(0, 10), byAsset: toArr(byAsset).slice(0, 10), trend: trendArr
    });
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 4) เทมเพลตเช็กลิสต์ PM
// ===================================================================
function pmTemplateItems_(itemsJson) {
  try { const a = JSON.parse(itemsJson || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; }
}

function getActivePMTemplates_() {
  try {
    ensureSheetBySchema_(SHEETS.PM_TEMPLATE);
    return readSheetObjects_(SHEETS.PM_TEMPLATE)
      .filter(function (r) { return !r.Status || String(r.Status).toLowerCase() === 'active'; })
      .map(function (r) { return { id: r.TemplateID, name: r.Name, category: r.Category, items: pmTemplateItems_(r.ItemsJSON) }; });
  } catch (e) { return []; }
}

function getPMTemplatesAdmin() {
  try {
    requireRole([ROLES.IT_ADMIN]);
    ensureSheetBySchema_(SHEETS.PM_TEMPLATE);
    const rows = readSheetObjects_(SHEETS.PM_TEMPLATE).map(function (r) {
      return { id: r.TemplateID, name: r.Name, category: r.Category, items: pmTemplateItems_(r.ItemsJSON), status: r.Status || 'Active', notes: r.Notes };
    });
    return ok({ templates: rows });
  } catch (e) { return fail(e.message); }
}

function savePMTemplate(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    const name = sanitizeText(form.name, 120);
    requireFields({ 'ชื่อเทมเพลต': name }, ['ชื่อเทมเพลต']);
    const items = (Array.isArray(form.items) ? form.items : [])
      .map(function (x) { return sanitizeText(x, 200); }).filter(String).slice(0, 50);
    if (!items.length) throw new Error('กรุณาระบุหัวข้อตรวจอย่างน้อย 1 ข้อ');
    const status = sanitizeText(form.status, 20) || 'Active';
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    ensureSheetBySchema_(SHEETS.PM_TEMPLATE);
    const payload = {
      Name: name, Category: sanitizeText(form.category, 60),
      ItemsJSON: JSON.stringify(items), Status: status, Notes: sanitizeText(form.notes, 300)
    };
    if (form.id) {
      const row = findRow_(SHEETS.PM_TEMPLATE, 'TemplateID', form.id);
      if (!row) throw new Error('ไม่พบเทมเพลต');
      updateRow_(SHEETS.PM_TEMPLATE, row._row, payload, user.email);
      writeAudit_(user, 'UPDATE', 'maintenance', SHEETS.PM_TEMPLATE, form.id, name, 'success');
      return ok('แก้ไขเทมเพลตเรียบร้อย');
    }
    const id = generateId('PMT');
    payload.TemplateID = id;
    appendRow_(SHEETS.PM_TEMPLATE, payload, user.email);
    writeAudit_(user, 'CREATE', 'maintenance', SHEETS.PM_TEMPLATE, id, name, 'success');
    return ok('เพิ่มเทมเพลตเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setPMTemplateStatus(id, status) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    status = sanitizeText(status, 20);
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    const row = findRow_(SHEETS.PM_TEMPLATE, 'TemplateID', id);
    if (!row) throw new Error('ไม่พบเทมเพลต');
    updateRow_(SHEETS.PM_TEMPLATE, row._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'maintenance', SHEETS.PM_TEMPLATE, id, status, 'success');
    return ok('ปรับสถานะเทมเพลตเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
