/**
 * Module_TicketExtras.gs
 * ส่วนเสริมของโมดูลแจ้งซ่อม (Help Desk):
 *  1) รายงานวิเคราะห์ผล/SLA (getTicketAnalytics) — FRT, เวลาปิดงาน, %SLA, CSAT, ปริมาณงาน, แนวโน้ม
 *  2) จัดการหมวดหมู่ Ticket (CRUD) — getTicketCategoriesAdmin / saveTicketCategory / setTicketCategoryStatus
 *  3) เปิดงานซ้ำ (reopenTicket)
 *  4) รายชื่อผู้รับผิดชอบสำหรับมอบหมาย (getAssignableStaff_)
 *
 * อ้างอิงค่าคงที่จาก Module_Ticket.gs (TICKET_STATUS, TICKET_PRIORITY, isTicketTerminal_ ฯลฯ)
 */

// ===================================================================
// 4) รายชื่อผู้รับผิดชอบ (ทีม IT / หัวหน้างาน ที่ยัง Active)
// ===================================================================
function getAssignableStaff_() {
  try {
    return readSheetObjects_(SHEETS.USERS)
      .filter(function (u) {
        return String(u.Status).toLowerCase() === 'active' &&
          (u.Role === ROLES.IT_ADMIN || u.Role === ROLES.APPROVER);
      })
      .map(function (u) {
        const roleLabel = ROLE_LABELS[u.Role] || u.Role;
        return {
          value: String(u.Email).toLowerCase(),
          label: (u.FullName || u.Email) + ' · ' + roleLabel,
          name: u.FullName || '',
          role: u.Role
        };
      });
  } catch (e) {
    return [];
  }
}

// ===================================================================
// 1) รายงานวิเคราะห์ผล / SLA
// ===================================================================
function getTicketAnalytics(rangeDays) {
  try {
    const user = requireModule('ticket', false);
    if (user.role === ROLES.USER) throw new Error('บทบาทนี้ไม่มีสิทธิ์ดูรายงานวิเคราะห์');
    const days = parseInt(rangeDays, 10);
    const now = new Date();
    const since = (days && days > 0) ? new Date(now.getTime() - days * 86400000) : null;

    const rows = readSheetObjectsEnsured_(SHEETS.TICKET).filter(function (r) {
      if (!since) return true;
      const ts = new Date(r.Timestamp);
      return !isNaN(ts) && ts >= since;
    });

    let open = 0, overdue = 0, resolvedCount = 0;
    let frtSum = 0, frtN = 0, resSum = 0, resN = 0;
    let slaMet = 0, slaEval = 0, ratingSum = 0, ratingN = 0;
    const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byCategory = {}, byPriority = {}, byStatus = {}, byAssignee = {}, trend = {};

    const bump = function (map, key) { key = String(key || 'ไม่ระบุ'); map[key] = (map[key] || 0) + 1; };
    const monthKey = function (d) { return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM'); };

    rows.forEach(function (r) {
      const status = String(r.Status || '');
      const terminal = isTicketTerminal_(status);
      bump(byStatus, status);
      bump(byCategory, r.Category);
      bump(byPriority, r.Priority);

      if (!terminal) {
        open++;
        if (r.DueAt && !r.SLAPausedAt) {
          const due = new Date(r.DueAt);
          if (!isNaN(due) && due < now) overdue++;
        }
      }

      const asg = String(r.Assignee || '').trim();
      if (asg) {
        byAssignee[asg] = byAssignee[asg] || { total: 0, open: 0 };
        byAssignee[asg].total++;
        if (!terminal) byAssignee[asg].open++;
      }

      const created = new Date(r.Timestamp);
      if (r.AcknowledgedAt && !isNaN(created)) {
        const ack = new Date(r.AcknowledgedAt);
        if (!isNaN(ack) && ack >= created) {
          frtSum += businessMinutesBetween_(created, ack) / 60;
          frtN++;
        }
      }

      if (status === TICKET_STATUS.RESOLVED || status === TICKET_STATUS.CLOSED) {
        resolvedCount++;
        const done = new Date(r.ResolvedAt || r.CloseDate);
        if (!isNaN(created) && !isNaN(done) && done >= created) {
          let hrs = businessMinutesBetween_(created, done) / 60;
          const pausedBusinessMinutes = parseInt(r.SLAPausedBusinessMinutes, 10) || 0;
          if (pausedBusinessMinutes > 0) hrs -= pausedBusinessMinutes / 60;
          if (hrs < 0) hrs = 0;
          resSum += hrs; resN++;
          if (r.DueAt) {
            const due = new Date(r.DueAt);
            if (!isNaN(due)) { slaEval++; if (done <= due) slaMet++; }
          }
        }
      }

      const rt = parseInt(r.Rating, 10);
      if (rt >= 1 && rt <= 5) { ratingSum += rt; ratingN++; ratingDist[rt]++; }

      if (!isNaN(created)) { const k = monthKey(created); trend[k] = trend[k] || { created: 0, closed: 0 }; trend[k].created++; }
      if (r.CloseDate) { const cd = new Date(r.CloseDate); if (!isNaN(cd)) { const k = monthKey(cd); trend[k] = trend[k] || { created: 0, closed: 0 }; trend[k].closed++; } }
    });

    const trendArr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      const v = trend[k] || { created: 0, closed: 0 };
      trendArr.push({ month: k, created: v.created, closed: v.closed });
    }

    const toArr = function (map) {
      return Object.keys(map).map(function (k) { return { label: k, value: map[k] }; })
        .sort(function (a, b) { return b.value - a.value; });
    };
    const assigneeArr = Object.keys(byAssignee).map(function (k) {
      return { label: k, total: byAssignee[k].total, open: byAssignee[k].open };
    }).sort(function (a, b) { return b.open - a.open || b.total - a.total; });

    return ok({
      rangeDays: days || 0,
      total: rows.length, open: open, overdue: overdue, resolved: resolvedCount,
      avgFirstResponseHours: frtN ? +(frtSum / frtN).toFixed(1) : null,
      avgResolutionHours: resN ? +(resSum / resN).toFixed(1) : null,
      slaCompliance: slaEval ? Math.round(slaMet / slaEval * 100) : null, slaEvaluated: slaEval,
      csatAvg: ratingN ? +(ratingSum / ratingN).toFixed(2) : null, csatCount: ratingN, csatDist: ratingDist,
      byCategory: toArr(byCategory), byPriority: toArr(byPriority), byStatus: toArr(byStatus),
      byAssignee: assigneeArr, trend: trendArr
    });
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 2) จัดการหมวดหมู่ Ticket (เฉพาะ ITAdmin)
// ===================================================================
function getTicketCategoriesAdmin() {
  try {
    requireRole([ROLES.IT_ADMIN]);
    const rows = readSheetObjectsEnsured_(SHEETS.TICKET_CATEGORY).map(function (r) {
      return {
        id: r.CategoryID, name: r.CategoryName, priority: r.DefaultPriority,
        responseSlaHours: r.ResponseSLAHours,
        resolutionSlaHours: r.ResolutionSLAHours || r.SLAHours,
        slaHours: r.SLAHours,
        isSecurityDefault: String(r.IsSecurityDefault).toLowerCase() === 'yes' ? 'Yes' : 'No',
        status: r.Status || 'Active', notes: r.Notes
      };
    });
    return ok({ priorities: TICKET_PRIORITY, categories: rows });
  } catch (e) { return fail(e.message); }
}

function saveTicketCategory(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    const name = sanitizeText(form.name, 120);
    requireFields({ 'ชื่อหมวดหมู่': name }, ['ชื่อหมวดหมู่']);
    const priority = sanitizeText(form.priority, 40) || 'ปานกลาง';
    if (!isInList(priority, TICKET_PRIORITY)) throw new Error('ระดับความเร่งด่วนไม่ถูกต้อง');
    const responseSlaHours = clampNumber_(form.responseSlaHours, 1, 168, 4);
    const slaHours = clampNumber_(form.resolutionSlaHours || form.slaHours, 1, 720, 24);
    const isSec = (String(form.isSecurityDefault).toLowerCase() === 'yes' || form.isSecurityDefault === true) ? 'Yes' : 'No';
    const status = sanitizeText(form.status, 20) || 'Active';
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    ensureSheetBySchema_(SHEETS.TICKET_CATEGORY);

    const existing = readSheetObjects_(SHEETS.TICKET_CATEGORY);
    const dup = existing.filter(function (r) {
      return String(r.CategoryName).trim() === name && String(r.CategoryID) !== String(form.id || '');
    });
    if (dup.length) throw new Error('มีหมวดหมู่ชื่อนี้อยู่แล้ว');

    const payload = {
      CategoryName: name, DefaultPriority: priority,
      ResponseSLAHours: responseSlaHours, ResolutionSLAHours: slaHours, SLAHours: slaHours,
      IsSecurityDefault: isSec, Status: status, Notes: sanitizeText(form.notes, 500)
    };
    if (form.id) {
      const row = findRow_(SHEETS.TICKET_CATEGORY, 'CategoryID', form.id);
      if (!row) throw new Error('ไม่พบหมวดหมู่ที่ต้องการแก้ไข');
      updateRow_(SHEETS.TICKET_CATEGORY, row._row, payload, user.email);
      writeAudit_(user, 'UPDATE', 'ticket', SHEETS.TICKET_CATEGORY, form.id, name, 'success');
      return ok('แก้ไขหมวดหมู่เรียบร้อย');
    }
    const id = generateId('TCAT');
    payload.CategoryID = id;
    appendRow_(SHEETS.TICKET_CATEGORY, payload, user.email);
    writeAudit_(user, 'CREATE', 'ticket', SHEETS.TICKET_CATEGORY, id, name, 'success');
    return ok('เพิ่มหมวดหมู่เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setTicketCategoryStatus(id, status) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    status = sanitizeText(status, 20);
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    const row = findRow_(SHEETS.TICKET_CATEGORY, 'CategoryID', id);
    if (!row) throw new Error('ไม่พบหมวดหมู่');
    updateRow_(SHEETS.TICKET_CATEGORY, row._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'ticket', SHEETS.TICKET_CATEGORY, id, status, 'success');
    return ok('ปรับสถานะหมวดหมู่เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 3) เปิดงานซ้ำ (Reopen) — เฉพาะงานที่เสร็จสิ้น/ปิดงานแล้ว
// ===================================================================
function reopenTicket(ticketId, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    const st = String(t.Status);
    if (st !== TICKET_STATUS.RESOLVED && st !== TICKET_STATUS.CLOSED) {
      throw new Error('เปิดงานซ้ำได้เฉพาะงานที่เสร็จสิ้น/ปิดงานแล้วเท่านั้น');
    }
    form = form || {};
    const reason = sanitizeText(form.reason, 1000);
    requireFields({ 'เหตุผลการเปิดงานซ้ำ': reason }, ['เหตุผลการเปิดงานซ้ำ']);

    const slaHours = parseInt(t.ResolutionSLAHours || t.SLAHours, 10) || 24;
    const responseSlaHours = parseInt(t.ResponseSLAHours, 10) || 4;
    const now = new Date();
    updateRow_(SHEETS.TICKET, t._row, {
      Status: TICKET_STATUS.IN_PROGRESS,
      ResolvedAt: '', CloseDate: '', SLAPausedAt: '',
      ResponseSLAHours: responseSlaHours,
      ResponseDueAt: addBusinessHours_(now, responseSlaHours),
      ResolutionSLAHours: slaHours,
      DueAt: addBusinessHours_(now, slaHours),
      ReopenCount: (parseInt(t.ReopenCount, 10) || 0) + 1,
      Notes: appendTicketNote_(t.Notes, user.email, 'เปิดงานซ้ำ: ' + reason)
    }, user.email);
    addTicketWorklog_(t, user, 'เปิดงานซ้ำ',
      { statusFrom: st, statusTo: TICKET_STATUS.IN_PROGRESS, detail: reason, isPublic: true });
    writeAudit_(user, 'REOPEN', 'ticket', SHEETS.TICKET, ticketId, reason, 'success');
    notifyRequesterStatus_(t, TICKET_STATUS.IN_PROGRESS, 'เปิดงานซ้ำ: ' + reason);
    if (t.Assignee && isValidEmail(t.Assignee)) {
      notify_(t.Assignee, 'Ticket ' + ticketId + ' ถูกเปิดงานซ้ำ',
        '<p>Ticket ' + escapeHtml(ticketId) + ': ' + escapeHtml(t.Title) + ' ถูกเปิดงานซ้ำ</p>' +
        '<p><b>เหตุผล:</b> ' + escapeHtml(reason) + '</p>',
        'เปิดงานซ้ำ Ticket ' + ticketId + ': ' + reason, 'ticket', ticketId);
    }
    return ok('เปิดงานซ้ำเรียบร้อย เลขที่ ' + ticketId);
  } catch (e) { return fail(e.message); }
}
