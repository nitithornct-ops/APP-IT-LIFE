/**
 * Module_Dashboard.gs
 * รวบรวมสถานะ compliance ของแต่ละโมดูล (เขียว/เหลือง/แดง),
 * รายการใกล้ครบกำหนด, และจำนวน Incident ที่ยังเปิดอยู่
 *
 * รอบที่ 1: คำนวณจาก Sheet ที่มีอยู่ — โมดูลที่ยังไม่มีข้อมูลจะแสดงสถานะ "ยังไม่มีข้อมูล"
 */

function getDashboardData() {
  try {
    const user = requireModule('dashboard', false);
    const lead = parseInt(getConfig_('NOTIFY_LEAD_DAYS', '30'), 10);
    const cards = [];
    const upcoming = [];

    // ---- การ์ดสถานะแต่ละโมดูล ----
    cards.push(buildTicketCard(lead, upcoming));
    const serviceRequestDashboard = buildServiceRequestDashboardCard_(user, lead, upcoming);
    cards.push(serviceRequestDashboard.card);
    cards.push(buildExpiryCard('asset', 'IT Asset', SHEETS.ASSET, 'LicenseExpiry', 'AssetName', lead, upcoming, 'Status'));
    cards.push(buildSoftwareLicenseCard(lead, upcoming));
    cards.push(buildMaintenanceDashboardCard(lead, upcoming));
    cards.push(buildInventoryDashboardCard());
    cards.push(buildExpiryCard('vendor', 'สัญญาผู้ให้บริการ', SHEETS.VENDOR, 'ContractExpiry', 'VendorName', lead, upcoming, ''));
    cards.push(buildReviewCard('access', 'ทบทวนสิทธิ์', SHEETS.ACCESS_REGISTRY, 'NextReviewDue', 'UserName', 'SystemName', lead, upcoming));
    cards.push(buildReviewCard('logging', 'ทบทวน Log', SHEETS.LOG_REGISTER, 'NextReviewDue', 'SystemName', 'LogType', lead, upcoming));
    cards.push(buildBackupCard(lead, upcoming));
    cards.push(buildTrainingCard());
    cards.push(buildIncidentCard());

    // จำนวน Ticket ที่ยังเปิด (+ การกระจายตามระดับความเร่งด่วน สำหรับกราฟผู้บริหาร)
    let openTickets = 0, ticketOverdue = 0;
    const ticketByPriority = {};
    safeEach_(SHEETS.TICKET, function (r) {
      if (!isTicketTerminal_(r.Status)) {
        openTickets++;
        const p = String(r.Priority || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
        ticketByPriority[p] = (ticketByPriority[p] || 0) + 1;
        const hrs = ticketDashboardHoursUntil_(r.DueAt);
        if (hrs !== null && hrs < 0) ticketOverdue++;
      }
    });

    // จำนวน Incident ที่ยังเปิด (+ การกระจายตามความรุนแรง)
    let openIncidents = 0, pdpaPending = 0;
    const incidentBySeverity = {};
    safeEach_(SHEETS.INCIDENT, function (r) {
      const st = String(r.Status).toLowerCase();
      if (st !== 'closed' && st !== 'ปิดเคส' && st !== '') {
        openIncidents++;
        const sev = String(r.Severity || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
        incidentBySeverity[sev] = (incidentBySeverity[sev] || 0) + 1;
      }
      if (String(r.ContainsPersonalData).toLowerCase() === 'yes' && String(r.DPONotified).toLowerCase() !== 'yes' && st !== 'closed') {
        const dl = daysUntil(r.DPONotifyDeadline);
        if (dl !== null && dl <= 1) pdpaPending++;
      }
    });

    // คำขอสิทธิ์ที่รออนุมัติ
    let pendingAccess = 0;
    safeEach_(SHEETS.ACCESS_REQ, function (r) {
      const st = String(r.Status).toLowerCase();
      if (st.indexOf('รออนุมัติ') > -1 || st === 'pending') pendingAccess++;
    });

    // เรียงรายการใกล้ครบกำหนด: เลยกำหนดก่อน แล้วใกล้สุด
    upcoming.sort(function (a, b) { return a.days - b.days; });

    // ---- ภาพรวมการปฏิบัติตามนโยบาย (Compliance) รายด้าน สำหรับผู้บริหาร/IT Audit ----
    // ใช้ตัวคำนวณเดียวกับรายงาน LINE ผู้บริหารและศูนย์รวมหลักฐาน เพื่อให้ตัวเลขตรงกัน
    let compliance = [];
    try { compliance = computeCompliance_(); } catch (e) { console.error('computeCompliance_ (dashboard): ' + e.message); }
    let cTotal = 0, cOk = 0;
    compliance.forEach(function (r) { if (r.total > 0) { cTotal += r.total; cOk += r.compliant; } });
    const overallCompliance = cTotal > 0 ? Math.round((cOk / cTotal) * 100) : null;
    const complianceRed = compliance.filter(function (r) { return r.status === 'red'; }).length;

    return ok({
      generatedAt: fmtDateTime(new Date()),
      role: user.role,
      roleLabel: user.roleLabel,
      summary: {
        openTickets: openTickets,
        ticketOverdue: ticketOverdue,
        openIncidents: openIncidents,
        pdpaPending: pdpaPending,
        pendingAccess: pendingAccess,
        pendingServiceApprovals: serviceRequestDashboard.pendingApprovals,
        openServiceRequests: serviceRequestDashboard.open,
        serviceRequestOverdue: serviceRequestDashboard.overdue,
        upcomingCount: upcoming.length,
        overallCompliance: overallCompliance,
        complianceRed: complianceRed
      },
      cards: cards,
      upcoming: upcoming.slice(0, 30),
      overallCompliance: overallCompliance,
      compliance: compliance,
      analytics: {
        ticketByPriority: ticketByPriority,
        incidentBySeverity: incidentBySeverity
      }
    });
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * getMyNotifications — สรุปงานค้าง/รายการใกล้ครบกำหนดสำหรับกระดิ่งแจ้งเตือนบน topbar
 * นำข้อมูลจาก getDashboardData มาเรียบเรียงเป็นรายการสั้น ๆ (ใช้สิทธิ์โมดูล dashboard)
 */
function getMyNotifications() {
  try {
    const res = getDashboardData();
    if (!res || !res.ok) return res || fail('ไม่สามารถดึงข้อมูลการแจ้งเตือนได้');
    const d = res.data;
    const s = d.summary || {};
    const items = [];

    if (s.ticketOverdue > 0) items.push(notif_('Ticket เกิน SLA', s.ticketOverdue + ' รายการต้องเร่งดำเนินการ', 'bi-alarm', 'red', 'ticket'));
    if (s.openIncidents > 0) items.push(notif_('เหตุการณ์ที่ยังเปิดอยู่', s.openIncidents + ' เคสรอจัดการ', 'bi-exclamation-octagon', 'red', 'incident'));
    if (s.pdpaPending > 0) items.push(notif_('เหตุข้อมูลส่วนบุคคลรอ DPO', s.pdpaPending + ' เคสต้องคัดกรอง', 'bi-stopwatch', 'amber', 'incident'));
    if (s.pendingAccess > 0) items.push(notif_('คำขอสิทธิ์รออนุมัติ', s.pendingAccess + ' คำขอ', 'bi-hourglass-split', 'amber', 'access'));
    if (s.pendingServiceApprovals > 0) items.push(notif_('คำขอบริการรออนุมัติ', s.pendingServiceApprovals + ' คำขอ', 'bi-person-check', 'amber', 'serviceCatalog'));
    if (s.serviceRequestOverdue > 0) items.push(notif_('คำขอบริการเกิน SLA', s.serviceRequestOverdue + ' คำขอ', 'bi-clock-history', 'red', 'serviceCatalog'));
    if (s.openTickets > 0) items.push(notif_('Ticket เปิดอยู่', s.openTickets + ' รายการ', 'bi-ticket-detailed', 'blue', 'ticket'));

    // งานส่วนตัวของผู้ใช้ปัจจุบันเท่านั้น (กรอง OwnerEmail ฝั่ง Server)
    let taskUrgent = 0;
    try {
      const taskSummary = getTaskNotificationSummary_(getCurrentUser().email);
      taskUrgent = Number(taskSummary.urgent) || 0;
      (taskSummary.items || []).forEach(function (task) {
        items.push(notif_('Task: ' + task.title, task.sub,
          task.overdue ? 'bi-calendar-x' : 'bi-check2-square',
          task.overdue ? 'red' : 'amber', 'task'));
      });
    } catch (taskErr) {
      console.error('getTaskNotificationSummary_: ' + taskErr.message);
    }

    // รายการใกล้ครบ/เลยกำหนด (สูงสุด 8 รายการแรก เลยกำหนดก่อน)
    (d.upcoming || []).slice(0, 8).forEach(function (u) {
      const overdue = u.days < 0;
      const when = overdue ? ('เลยกำหนด ' + Math.abs(u.days) + ' วัน') : ('อีก ' + u.days + ' วัน');
      items.push(notif_(u.category + ': ' + u.name, when + ' · ครบกำหนด ' + u.due, overdue ? 'bi-calendar-x' : 'bi-calendar-event', overdue ? 'red' : 'amber', _notifModuleOf(u.category)));
    });

    // จำนวนที่ใช้ขึ้น badge = งานเร่งด่วน (เลยกำหนด/เกิน SLA/incident/pdpa) เพื่อไม่ให้ตัวเลขเฟ้อ
    const urgent = (s.ticketOverdue || 0) + (s.openIncidents || 0) + (s.pdpaPending || 0) +
      (s.pendingAccess || 0) + (s.pendingServiceApprovals || 0) + (s.serviceRequestOverdue || 0) + taskUrgent +
      (d.upcoming || []).filter(function (u) { return u.days < 0; }).length;

    return ok({ count: urgent, items: items });
  } catch (e) {
    return fail(e.message);
  }
}
function notif_(title, sub, icon, tone, module) {
  return { title: title, sub: sub, icon: icon, tone: tone, module: module || '' };
}
// เดาคีย์โมดูลปลายทางจากชื่อหมวดของรายการใกล้ครบกำหนด
function _notifModuleOf(category) {
  const c = String(category || '');
  if (c.indexOf('Ticket') > -1) return 'ticket';
  if (c.indexOf('Service Request') > -1 || c.indexOf('คำขอบริการ') > -1) return 'serviceCatalog';
  if (c.indexOf('Asset') > -1) return 'asset';
  if (c.indexOf('License') > -1) return 'license';
  if (c.indexOf('บำรุงรักษา') > -1 || c.indexOf('PM') > -1) return 'maintenance';
  if (c.indexOf('ผู้ให้บริการ') > -1) return 'vendor';
  if (c.indexOf('สิทธิ์') > -1) return 'access';
  if (c.indexOf('Log') > -1) return 'logging';
  if (c.indexOf('สำรอง') > -1) return 'backup';
  return 'dashboard';
}

function buildTicketCard(lead, upcoming) {
  let total = 0, open = 0, over = 0, warn = 0;
  safeEach_(SHEETS.TICKET, function (r) {
    total++;
    if (isTicketTerminal_(r.Status)) return;
    open++;
    const hrs = ticketDashboardHoursUntil_(r.DueAt);
    if (hrs === null) return;
    const days = Math.ceil(hrs / 24);
    if (hrs < 0) {
      over++;
      upcoming.push(item('Ticket/SLA', r.Title || r.TicketID, days, r.DueAt));
    } else if (hrs <= Math.min(lead * 24, 24)) {
      warn++;
      upcoming.push(item('Ticket/SLA', r.Title || r.TicketID, days, r.DueAt));
    }
  });
  return card('ticket', 'Help Desk / Ticket', total, warn || open, over,
    total === 0 ? 'ยังไม่มี Ticket' : (open + ' เปิดอยู่' + (over ? ' · เกิน SLA ' + over : '')));
}

/** การ์ด Service Request กรองเฉพาะรายการที่ role นี้มีสิทธิ์เห็นก่อนนับ/แสดงชื่อ */
function buildServiceRequestDashboardCard_(user, lead, upcoming) {
  let total = 0, open = 0, warn = 0, over = 0, pendingApprovals = 0;
  const email = String(user.email || '').toLowerCase();
  safeEach_(SHEETS.SERVICE_REQUEST, function (r) {
    const visible = user.role === ROLES.IT_ADMIN ||
      String(r.RequesterEmail || '').toLowerCase() === email ||
      String(r.Approver || '').toLowerCase() === email;
    if (!visible) return;
    total++;
    const status = String(r.Status || '');
    if (status === 'รออนุมัติ' && (user.role === ROLES.IT_ADMIN || String(r.Approver || '').toLowerCase() === email)) {
      pendingApprovals++;
    }
    if (['ปิดงาน','ปฏิเสธ','ยกเลิก'].indexOf(status) > -1) return;
    open++;
    const hrs = ticketDashboardHoursUntil_(r.DueAt);
    if (hrs === null) return;
    const days = Math.ceil(hrs / 24);
    if (hrs < 0) {
      over++;
      upcoming.push(item('Service Request/SLA', r.ServiceName || r.Summary || r.RequestID, days, r.DueAt));
    } else if (hrs <= Math.min(lead * 24, 24)) {
      warn++;
      upcoming.push(item('Service Request/SLA', r.ServiceName || r.Summary || r.RequestID, days, r.DueAt));
    }
  });
  return {
    card: card('serviceCatalog', 'Service Request', total, warn || open, over,
      total === 0 ? 'ยังไม่มีคำขอบริการ' : (open + ' เปิดอยู่' + (over ? ' · เกิน SLA ' + over : ''))),
    pendingApprovals: pendingApprovals,
    open: open,
    overdue: over
  };
}

// สถานะตามวันหมดอายุ: เขียว=ไม่มีใกล้/เลย, เหลือง=ใกล้ครบ, แดง=เลยกำหนด
function buildExpiryCard(key, label, sheet, dateCol, nameCol, lead, upcoming, statusCol) {
  let total = 0, warn = 0, over = 0;
  safeEach_(sheet, function (r) {
    if (statusCol === 'Status' && sheet === SHEETS.ASSET && isAssetRetired_(r[statusCol])) return;
    else if (statusCol && String(r[statusCol]).toLowerCase() === 'retired') return;
    total++;
    const d = daysUntil(r[dateCol]);
    if (d === null) return;
    if (d < 0) { over++; upcoming.push(item(label, r[nameCol], d, r[dateCol])); }
    else if (d <= lead) { warn++; upcoming.push(item(label, r[nameCol], d, r[dateCol])); }
  });
  return card(key, label, total, warn, over);
}

function buildSoftwareLicenseCard(lead, upcoming) {
  let total = 0, warn = 0, over = 0;
  safeEach_(SHEETS.SOFTWARE_LICENSE, function (r) {
    if (String(r.Status).toLowerCase() === 'inactive') return;
    total++;
    const d = daysUntil(r.ExpireDate);
    if (d === null) return;
    if (d < 0) {
      over++;
      upcoming.push(item('Software License', r.SoftwareName || r.LicenseID, d, r.ExpireDate));
    } else if (d <= lead) {
      warn++;
      upcoming.push(item('Software License', r.SoftwareName || r.LicenseID, d, r.ExpireDate));
    }
  });
  return card('license', 'Software License', total, warn, over);
}

function buildMaintenanceDashboardCard(lead, upcoming) {
  let total = 0, warn = 0, over = 0;
  safeEach_(SHEETS.MAINTENANCE, function (r) {
    const st = String(r.Status);
    if (st === 'ยกเลิก') return;
    total++;
    if (st === 'ดำเนินการแล้ว') return;
    const due = r.PlanDate || r.NextDueDate;
    const d = daysUntil(due);
    if (d === null) return;
    if (d < 0) {
      over++;
      upcoming.push(item('PM / บำรุงรักษา', r.AssetName || r.AssetID || r.MaintenanceID, d, due));
    } else if (d <= lead) {
      warn++;
      upcoming.push(item('PM / บำรุงรักษา', r.AssetName || r.AssetID || r.MaintenanceID, d, due));
    }
  });
  return card('maintenance', 'PM / บำรุงรักษา', total, warn, over);
}

function buildInventoryDashboardCard() {
  let total = 0, low = 0;
  safeEach_(SHEETS.INVENTORY, function (r) {
    if (String(r.Status).toLowerCase() === 'inactive') return;
    total++;
    const stock = Number(r.StockQty || 0);
    const min = Number(r.MinQty || 0);
    if (!isNaN(stock) && !isNaN(min) && stock <= min) low++;
  });
  return card('inventory', 'Inventory', total, low, 0,
    total === 0 ? 'ยังไม่มีรายการ Inventory' : (low ? 'ต่ำกว่าขั้นต่ำ ' + low + ' รายการ' : 'Stock ปกติ'));
}

function buildReviewCard(key, label, sheet, dateCol, nameCol, sysCol, lead, upcoming) {
  let total = 0, warn = 0, over = 0;
  safeEach_(sheet, function (r) {
    if (r.Status && String(r.Status).toLowerCase() !== 'active') return;
    total++;
    const d = daysUntil(r[dateCol]);
    if (d === null) return;
    const nm = (r[nameCol] || '') + (sysCol && r[sysCol] ? ' / ' + r[sysCol] : '');
    if (d < 0) { over++; upcoming.push(item(label, nm, d, r[dateCol])); }
    else if (d <= lead) { warn++; upcoming.push(item(label, nm, d, r[dateCol])); }
  });
  return card(key, label, total, warn, over);
}

function buildBackupCard(lead, upcoming) {
  let total = 0, fail = 0, dueWarn = 0;
  safeEach_(SHEETS.BACKUP, function (r) {
    total++;
    if (String(r.Result).toLowerCase().indexOf('fail') > -1 || String(r.Result).indexOf('ล้มเหลว') > -1) fail++;
    const d = daysUntil(r.NextBackupDue);
    if (d !== null && d <= lead) { dueWarn++; if (d <= lead) upcoming.push(item('สำรองข้อมูล', r.SystemName, d, r.NextBackupDue)); }
  });
  return card('backup', 'สำรองข้อมูล', total, dueWarn, fail);
}

function buildTrainingCard() {
  let planned = 0, done = 0;
  const year = new Date().getFullYear();
  safeEach_(SHEETS.TRAIN_PLAN, function (r) {
    if (String(r.Year) === String(year) || String(r.Year) === String(year + 543)) {
      planned++;
      if (String(r.Status).toLowerCase() === 'done' || String(r.Status).indexOf('เสร็จ') > -1) done++;
    }
  });
  const over = (planned > 0 && done < planned) ? (planned - done) : 0;
  return card('awareness', 'อบรมประจำปี', planned, over, 0, planned === 0 ? 'ยังไม่มีแผน' : (done + '/' + planned + ' เสร็จสิ้น'));
}

function buildIncidentCard() {
  let open = 0, total = 0;
  safeEach_(SHEETS.INCIDENT, function (r) {
    total++;
    const st = String(r.Status).toLowerCase();
    if (st !== 'closed' && st.indexOf('ปิด') === -1 && st !== '') open++;
  });
  return card('incident', 'เหตุการณ์ (Incident)', total, open, 0, total === 0 ? 'ไม่มีเหตุการณ์' : (open + ' เปิดอยู่'));
}

function ticketDashboardHoursUntil_(target) {
  if (!target) return null;
  const t = (target instanceof Date) ? target : new Date(target);
  if (isNaN(t)) return null;
  return Math.round((t - new Date()) / 3600000);
}

function item(category, name, days, dueDate) {
  return { category: category, name: String(name || '-'), days: days, due: fmtDate(dueDate) };
}

/**
 * สร้างการ์ดสถานะ: กำหนดสี
 *  red ถ้ามีรายการเลยกำหนด/ล้มเหลว (over>0)
 *  yellow ถ้ามีใกล้ครบ (warn>0)
 *  green ถ้าปกติและมีข้อมูล
 *  gray ถ้ายังไม่มีข้อมูล
 */
function card(key, label, total, warn, over, note) {
  let status = 'gray';
  if (total > 0) {
    if (over > 0) status = 'red';
    else if (warn > 0) status = 'yellow';
    else status = 'green';
  }
  return {
    key: key, label: label, total: total, warn: warn, over: over,
    status: status, note: note || (total === 0 ? 'ยังไม่มีข้อมูล' : '')
  };
}
