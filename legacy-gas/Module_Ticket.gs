/**
 * Module_Ticket.gs
 * Help Desk / Ticket workflow
 *
 * ฝั่งผู้ใช้ (public, ไม่ต้อง login): แจ้งซ่อม -> ติดตามสถานะ -> ให้คะแนนหลังปิดงาน
 * ฝั่งเจ้าหน้าที่/Admin: รับเรื่อง -> คัดแยก/มอบหมาย -> ดำเนินการ/ส่งต่อ Outsource
 *                       -> ปิดงาน/ยกเลิก
 *                       หรือยกระดับเป็น Incident เมื่อเข้าข่ายภัยคุกคาม
 *
 * ประวัติการดำเนินงานบันทึกแยกในชีต Ticket_Worklogs (1 แถวต่อ 1 การกระทำ)
 */

const TICKET_STATUS = {
  NEW: 'ใหม่',
  ACK: 'รับเรื่องแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  WAITING_PARTS: 'รออะไหล่',
  WAITING_USER: 'รอผู้ใช้งาน',
  OUTSOURCE: 'ส่งต่อ Outsource',
  RESOLVED: 'เสร็จสิ้น',
  CLOSED: 'ปิดงาน',
  CANCELLED: 'ยกเลิก',
  ESCALATED: 'ยกระดับเป็น Incident'
};

const TICKET_PRIORITY = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'];
const PUBLIC_TICKET_OTP_TTL_SEC = 600;
const PUBLIC_TICKET_LOOKUP_TTL_SEC = 900;

// สถานะที่ถือว่าจบงานแล้ว (หยุดนับ SLA / ไม่ถือว่าเปิดอยู่) — ใช้ร่วมใน Dashboard/Notification
const TICKET_TERMINAL_STATUSES = [
  TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED, TICKET_STATUS.CANCELLED, TICKET_STATUS.ESCALATED
];

function isTicketTerminal_(status) {
  return TICKET_TERMINAL_STATUSES.indexOf(String(status)) > -1;
}

// สถานะที่ "หยุดนาฬิกา SLA" (รอปัจจัยภายนอก ไม่ใช่ความล่าช้าของทีม IT)
const TICKET_WAITING_STATUSES = [TICKET_STATUS.WAITING_PARTS, TICKET_STATUS.WAITING_USER];

function isTicketWaiting_(status) {
  return TICKET_WAITING_STATUSES.indexOf(String(status)) > -1;
}

function isPublicTicketEmailOtpEnabled_() {
  return getConfig_('PUBLIC_TICKET_EMAIL_OTP_ENABLED', 'false') === 'true';
}

/**
 * ปรับ patch เพื่อหยุด/เดินนาฬิกา SLA เมื่อสถานะเปลี่ยนเข้า/ออกสถานะ "รอ"
 * - เข้าสถานะรอ: จำเวลาเริ่มหยุด (SLAPausedAt)
 * - ออกจากสถานะรอ: บวกเวลาที่หยุดสะสม และเลื่อน DueAt ตาม "เวลาทำการ" ที่หยุดจริง
 */
function applyTicketSlaPause_(t, patch, newStatus) {
  const status = newStatus || t.Status;
  const now = new Date();
  const wasPaused = !!t.SLAPausedAt;
  const willPause = isTicketWaiting_(status);
  if (!wasPaused && willPause) {
    patch.SLAPausedAt = now;
  } else if (wasPaused && !willPause) {
    const pausedFrom = new Date(t.SLAPausedAt);
    const delta = isNaN(pausedFrom) ? 0 : Math.max(0, now.getTime() - pausedFrom.getTime());
    const pausedBusinessMinutes = isNaN(pausedFrom) ? 0 :
      Math.max(0, businessMinutesBetween_(pausedFrom, now));
    patch.SLAPausedMs = (parseInt(t.SLAPausedMs, 10) || 0) + delta;
    patch.SLAPausedBusinessMinutes =
      (parseInt(t.SLAPausedBusinessMinutes, 10) || 0) + pausedBusinessMinutes;
    patch.SLAPausedAt = '';
    if (t.DueAt && delta > 0) {
      const due = new Date(t.DueAt);
      const pausedBusinessHours = pausedBusinessMinutes / 60;
      if (!isNaN(due) && pausedBusinessHours > 0) {
        patch.DueAt = addBusinessHours_(due, pausedBusinessHours);
      }
    }
  }
}

/**
 * ป้องกันการย้อนสถานะ/แก้ Ticket ที่จบงานแล้วจากคำขอ client ที่ล้าสมัย
 * ยังคงอนุญาตเส้นทางใช้งานเดิม เช่น ปิดงานได้จากทุกสถานะที่ยังเปิดอยู่
 */
function assertTicketTransition_(fromStatus, toStatus) {
  const from = String(fromStatus || TICKET_STATUS.NEW);
  const to = String(toStatus || '');
  if (!to || from === to) return true;

  const activeWork = [
    TICKET_STATUS.IN_PROGRESS,
    TICKET_STATUS.WAITING_PARTS,
    TICKET_STATUS.WAITING_USER,
    TICKET_STATUS.OUTSOURCE,
    TICKET_STATUS.RESOLVED,
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.CANCELLED,
    TICKET_STATUS.ESCALATED
  ];
  const transitions = {};
  transitions[TICKET_STATUS.NEW] = [
    TICKET_STATUS.ACK,
    TICKET_STATUS.IN_PROGRESS,
    TICKET_STATUS.OUTSOURCE,
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.CANCELLED,
    TICKET_STATUS.ESCALATED
  ];
  transitions[TICKET_STATUS.ACK] = activeWork;
  transitions[TICKET_STATUS.IN_PROGRESS] = activeWork;
  transitions[TICKET_STATUS.WAITING_PARTS] = activeWork;
  transitions[TICKET_STATUS.WAITING_USER] = activeWork;
  transitions[TICKET_STATUS.OUTSOURCE] = activeWork;
  transitions[TICKET_STATUS.RESOLVED] = [TICKET_STATUS.CLOSED];
  transitions[TICKET_STATUS.CLOSED] = [];
  transitions[TICKET_STATUS.CANCELLED] = [];
  transitions[TICKET_STATUS.ESCALATED] = [];

  if ((transitions[from] || []).indexOf(to) === -1) {
    throw new Error('ไม่สามารถเปลี่ยนสถานะ Ticket จาก "' + from + '" เป็น "' + to + '" ได้');
  }
  return true;
}

// ===================================================================
// ฝั่งเจ้าหน้าที่: โหลดข้อมูลโมดูล
// ===================================================================
/**
 * Entry point รุ่นปัจจุบันสำหรับหน้า Ticket หลังบ้าน
 * ใช้ชื่อเฉพาะเพื่อไม่ชนกับ getTicketModuleData รุ่นเก่าที่อาจค้างอยู่ในโปรเจกต์ Apps Script
 */
function getTicketAdminBootstrapV2() {
  try {
    const user = requireModule('ticket', false);
    const all = readSheetObjectsEnsured_(SHEETS.TICKET);
    const categories = getActiveTicketCategories_();
    let tickets = all;
    if (user.role === ROLES.USER) {
      tickets = all.filter(function (r) { return String(r.RequesterEmail).toLowerCase() === user.email; });
    }

    // โหลด worklog ทั้งหมดครั้งเดียวแล้ว group ตาม TicketID (กัน N+1)
    const wlByTicket = {};
    getTicketWorklogRows_().forEach(function (w) {
      if (user.role === ROLES.USER && String(w.IsPublic || '').toLowerCase() !== 'yes') return;
      const key = String(w.TicketID);
      (wlByTicket[key] = wlByTicket[key] || []).push({
        date: safeFmtDateTime_(w.Timestamp), action: w.Action, detail: w.Detail,
        statusFrom: w.StatusFrom, statusTo: w.StatusTo, minutes: w.MinutesSpent,
        // Raw Drive/external locators from legacy worklogs never leave the
        // authenticated DTO. Public/LINE tracking uses its separate payload.
        attachment: '', hasLegacyAttachment: !!String(w.AttachmentURL || '').trim(),
        actor: w.ActorName || w.ActorEmail
      });
    });

    const payload = {
      role: user.role,
      canCreate: canEditModule(user.role, 'ticket'),
      canTriage: user.role === ROLES.IT_ADMIN || user.role === ROLES.APPROVER,
      canManage: user.role === ROLES.IT_ADMIN,
      canDelete: user.role === ROLES.IT_ADMIN,
      canManageCategories: user.role === ROLES.IT_ADMIN,
      canViewAnalytics: user.role !== ROLES.USER,
      assignees: getAssignableStaff_(),
      categories: categories,
      priorities: TICKET_PRIORITY,
      statuses: Object.keys(TICKET_STATUS).map(function (k) { return TICKET_STATUS[k]; }),
      workStatuses: [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_PARTS, TICKET_STATUS.WAITING_USER,
        TICKET_STATUS.OUTSOURCE, TICKET_STATUS.RESOLVED],
      incidentCategories: (typeof INC_CATEGORY !== 'undefined' && Array.isArray(INC_CATEGORY)) ? INC_CATEGORY : [],
      incidentSeverities: (typeof INC_SEVERITY !== 'undefined' && Array.isArray(INC_SEVERITY)) ? INC_SEVERITY : [],
      assets: getTicketAssetOptions_(),
      outsourceOptions: getTicketOutsourceOptions_(),
      tickets: tickets.map(function (r) { return serializeTicket_(r, wlByTicket[String(r.TicketID)] || []); })
    };
    return ok(ticketClientSafePayload_(payload));
  } catch (e) {
    return fail('โหลดข้อมูลแจ้งซ่อมไม่สำเร็จ: ' + (e && e.message ? e.message : String(e)));
  }
}

/** Compatibility alias สำหรับหน้า/Deployment รุ่นก่อน */
function getTicketModuleData() {
  return getTicketAdminBootstrapV2();
}

/** ตัดค่า undefined/Date หรือชนิดข้อมูลที่ google.script.run ส่งกลับไม่ได้ */
function ticketClientSafePayload_(value) {
  const json = JSON.stringify(value);
  if (!json) throw new Error('ไม่สามารถแปลงข้อมูล Ticket สำหรับส่งไปหน้าเว็บได้');
  return JSON.parse(json);
}

function serializeTicket_(r, worklogs) {
  const dueHours = ticketHoursUntil_(r.DueAt);
  const responseDueHours = r.AcknowledgedAt ? null : ticketHoursUntil_(r.ResponseDueAt);
  const attachmentIds = ticketNormalizeAttachmentIds_(r.AttachmentIDsJSON);
  return {
    row: r._row,
    id: r.TicketID,
    title: r.Title,
    requesterEmail: r.RequesterEmail,
    requesterName: r.RequesterName,
    requesterPhone: r.RequesterPhone,
    requesterIdentityType: r.RequesterIdentityType || (r.RequesterLineUserID ? 'LINE' : 'EMAIL'),
    sourceChannel: r.SourceChannel || '',
    dept: r.Department,
    location: r.Location,
    category: r.Category,
    priority: r.Priority,
    responseSlaHours: r.ResponseSLAHours,
    responseDueAt: fmtDateTime(r.ResponseDueAt),
    responseDueHours: responseDueHours,
    responseBreached: !r.AcknowledgedAt && responseDueHours !== null && responseDueHours < 0,
    resolutionSlaHours: r.ResolutionSLAHours || r.SLAHours,
    slaHours: r.SLAHours,
    dueAt: fmtDateTime(r.DueAt),
    dueHours: dueHours,
    assetId: r.AssetID,
    assetName: r.AssetName,
    description: r.Description,
    assignee: r.Assignee,
    isSecurity: r.IsSecurity,
    incidentId: r.IncidentID,
    status: r.Status,
    acknowledgedAt: fmtDateTime(r.AcknowledgedAt),
    resolvedAt: fmtDateTime(r.ResolvedAt),
    resolution: r.Resolution,
    closeDate: fmtDateTime(r.CloseDate),
    // Legacy contract removed intentionally: evidence: attachmentIds.length ? '' : r.EvidenceLink
    evidence: '',
    hasLegacyEvidence: !attachmentIds.length && !!String(r.EvidenceLink || '').trim(),
    attachmentIds: attachmentIds,
    rating: r.Rating,
    feedback: r.Feedback,
    outsourceVendorId: r.OutsourceVendorID,
    outsourceName: r.OutsourceName,
    outsourceIssueNo: r.OutsourceIssueNo,
    outsourceSentAt: fmtDateTime(r.OutsourceSentAt),
    notes: r.Notes,
    slaPaused: !!r.SLAPausedAt,
    reopenCount: parseInt(r.ReopenCount, 10) || 0,
    createdAt: fmtDateTime(r.Timestamp),
    worklogs: worklogs || []
  };
}

// ===================================================================
// ฝั่ง public (ไม่ต้อง login) — เรียกจากหน้า PublicTicket
// ===================================================================

function getPublicPrivacyNotice_() {
  const ticketRetentionDays = parseInt(getConfig_('TICKET_PII_RETENTION_DAYS', '730'), 10) || 730;
  const lineSessionRetentionDays = parseInt(getConfig_('LINE_SESSION_RETENTION_DAYS', '30'), 10) || 30;
  return {
    required: getConfig_('PUBLIC_TICKET_CONSENT_REQUIRED', 'true') === 'true',
    version: getConfig_('PUBLIC_PRIVACY_NOTICE_VERSION', '2026-07-08'),
    summary: getConfig_('PUBLIC_PRIVACY_NOTICE_TEXT',
      'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม แจ้งสถานะผ่าน LINE และเก็บหลักฐานตามนโยบายความปลอดภัยขององค์กร'),
    noticeUrl: getConfig_('PUBLIC_PRIVACY_NOTICE_URL', ''),
    dpoContact: getConfig_('PUBLIC_PRIVACY_DPO_CONTACT', 'DPO / ส่วนงาน IT'),
    ticketRetentionDays: ticketRetentionDays,
    lineSessionRetentionDays: lineSessionRetentionDays
  };
}

function assertPublicTicketPrivacyConsent_(form) {
  const privacy = getPublicPrivacyNotice_();
  if (!privacy.required) return privacy;
  const consent = form && (
    form.privacyConsent === true ||
    String(form.privacyConsent || '').toLowerCase() === 'true'
  );
  if (!consent) {
    throw new Error('กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket');
  }
  return privacy;
}

/** ข้อมูลตั้งต้นสำหรับฟอร์มแจ้งซ่อมสาธารณะ (หมวดหมู่ + ระดับความเร่งด่วน) */
function getPublicTicketFormData() {
  try {
    ensureSheetBySchema_(SHEETS.TICKET);
    const limits = getPublicTicketLimits_();
    const payload = {
      orgName: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต'),
      categories: getActiveTicketCategories_(),
      priorities: TICKET_PRIORITY,
      limits: {
        enabled: limits.enabled,
        maxFiles: limits.maxFiles,
        maxFileMb: limits.maxFileMb,
        maxTotalMb: limits.maxTotalMb,
        requireCode: !!limits.sharedCode,
        allowedDomains: limits.allowedDomains,
        emailOptional: false
      },
      privacy: getPublicPrivacyNotice_()
    };
    // กัน google.script.run คืน null เมื่อมีค่า (เช่น Date) ที่ serialize ไม่ได้:
    // round-trip ผ่าน JSON ให้เหลือเฉพาะชนิดข้อมูลที่ส่งกลับหน้าเว็บได้แน่นอน
    return ok(JSON.parse(JSON.stringify(payload)));
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * Legacy Email OTP สำหรับดูหลาย Ticket: ปิดโดยค่าเริ่มต้นในโหมด LINE-only
 * หากเปิดใช้ชั่วคราว จะตอบข้อความกลางเสมอเพื่อลดการเดาว่าอีเมลใดมี Ticket อยู่ในระบบ
 */
function requestTicketLookupOtpPublic(email) {
  try {
    if (!isPublicTicketEmailOtpEnabled_()) {
      throw new Error('ระบบปิด Email OTP แล้ว กรุณาใช้ LINE Login หรือเลข Ticket + รหัสติดตาม');
    }
    ensureSheetBySchema_(SHEETS.TICKET);
    email = sanitizeText(email, 160).toLowerCase();
    requireFields({ 'อีเมล': email }, ['อีเมล']);
    if (!isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    checkPublicLookupRate_('otp_request', email, 5, 3600);

    const cache = CacheService.getScriptCache();
    const emailKey = publicRateKey_(email);
    const cooldownKey = 'pub_ticket_otp_cooldown_' + emailKey;
    if (!cache.get(cooldownKey)) {
      const hasTicket = readSheetObjects_(SHEETS.TICKET).some(function (t) {
        return String(t.RequesterEmail).toLowerCase() === email;
      });
      if (hasTicket) {
        const otp = generatePublicTicketOtp_();
        cache.put('pub_ticket_otp_' + emailKey,
          publicTicketSecretHash_('otp:' + email + ':' + otp), PUBLIC_TICKET_OTP_TTL_SEC);
        try {
          sendPublicTicketOtp_(email, otp);
        } catch (sendErr) {
          console.error('sendPublicTicketOtp_: ' + sendErr.message);
        }
      }
      cache.put(cooldownKey, '1', 60);
    }

    return ok({
      message: 'หากอีเมลนี้มีรายการในระบบ ระบบจะส่งรหัส OTP ให้ทางอีเมล',
      expiresMinutes: Math.round(PUBLIC_TICKET_OTP_TTL_SEC / 60)
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** เปิด Ticket จากหน้าสาธารณะ — คืน {id, token} ไว้ติดตามสถานะ */
function submitTicketPublic(form) {
  try {
    form = form || {};
    const privacy = assertPublicTicketPrivacyConsent_(form);
    const name = sanitizeText(form.requesterName, 160);
    const email = sanitizeText(form.requesterEmail, 160).toLowerCase();
    requireFields({ 'ชื่อผู้แจ้ง': name }, ['ชื่อผู้แจ้ง']);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    const clientId = sanitizePublicClientId_(form.clientId);
    const rateIdentity = clientId || [
      name.toLowerCase(),
      sanitizeText(form.requesterPhone, 40),
      sanitizeText(form.department, 120)
    ].join('|');
    assertPublicTicketAllowed_(form, 'device:' + rateIdentity, email);

    const res = createTicketCore_({
      title: form.title, category: form.category, priority: form.priority,
      description: form.description, assetId: form.assetId, assetName: form.assetName,
      isSecurity: form.isSecurity, attachments: form.attachments,
      requesterEmail: email, requesterName: name,
      requesterPhone: sanitizeText(form.requesterPhone, 40),
      department: sanitizeText(form.department, 120),
      location: sanitizeText(form.location, 160),
      requesterIdentityType: email ? 'EMAIL_OPTIONAL' : 'ANONYMOUS',
      sourceChannel: 'WEB_PUBLIC',
      source: 'หน้าแจ้งซ่อม (public)',
      privacyConsentVersion: privacy.version
    }, { email: email || 'public', name: name, role: 'public' });

    return ok({
      id: res.id,
      token: res.token,
      message: 'รับแจ้งเรียบร้อย เลขที่ ' + res.id
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** เปิด Ticket ด้วย LINE session — ไม่รับ LINE userId จาก client */
function submitTicketLine(sessionToken, form) {
  try {
    const lineUser = requireActiveLineSession_(sessionToken);
    form = form || {};
    const privacy = assertPublicTicketPrivacyConsent_(form);
    assertPublicTicketAllowed_(form, 'line:' + lineUser.LineUserID, '');

    const actor = lineActor_(lineUser);
    const requesterName = lineUser.FullName || lineUser.DisplayName || 'LINE User';
    const res = createTicketCore_({
      title: form.title,
      category: form.category,
      priority: form.priority,
      description: form.description,
      assetId: form.assetId,
      assetName: form.assetName,
      isSecurity: form.isSecurity,
      attachments: form.attachments,
      requesterEmail: '',
      requesterName: requesterName,
      requesterPhone: sanitizeText(form.requesterPhone, 40),
      department: lineUser.Department || sanitizeText(form.department, 120),
      location: sanitizeText(form.location, 160),
      requesterIdentityType: 'LINE',
      requesterLineUserId: lineUser.LineUserID,
      sourceChannel: 'LINE_OA',
      source: 'LINE OA',
      privacyConsentVersion: privacy.version
    }, actor);

    const ticket = findRow_(SHEETS.TICKET, 'TicketID', res.id);
    if (ticket) {
      const statusUrl = getTicketStatusUrl_();
      notifyTicketRequester_(ticket,
        'รับแจ้ง Ticket ' + res.id + ' แล้ว',
        '<p>ระบบได้รับ Ticket <b>' + escapeHtml(res.id) + '</b>: ' +
          escapeHtml(ticket.Title) + '</p><p>สถานะ: <b>' + escapeHtml(ticket.Status) + '</b></p>' +
          (statusUrl ? '<p><a href="' + escapeHtml(statusUrl) + '">เปิดหน้าสถานะของฉัน</a></p>' : ''),
        'รับแจ้ง ' + res.id + ' แล้ว\nเรื่อง: ' + ticket.Title +
          '\nสถานะ: ' + ticket.Status +
          (statusUrl ? '\nดูสถานะ: ' + statusUrl : '\nดูสถานะได้จากเมนู "สถานะของฉัน"'));
    }
    return ok({
      id: res.id,
      message: 'รับแจ้งเรียบร้อย เลขที่ ' + res.id,
      lineMode: true
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** เปิด Ticket จากภายในระบบ (ผู้ใช้ที่ login แล้ว) — ดึงข้อมูลผู้แจ้งจากโปรไฟล์ */
function submitTicket(form) {
  let user = null;
  let stagedAttachmentIds = [];
  let durableTicketId = '';
  let candidateTicketId = '';
  let idempotencyKey = '';
  try {
    user = requireModule('ticket', true);
    form = form || {};
    stagedAttachmentIds = ticketNormalizeAttachmentIds_(
      form.attachmentIds !== undefined ? form.attachmentIds : form.attachmentIdsJSON);
    if (stagedAttachmentIds.length && typeof arAssertClaimableAttachmentLocked_ !== 'function') {
      throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
    }
    idempotencyKey = sanitizeText(form.idempotencyKey, 160) || Utilities.getUuid();
    candidateTicketId = generateId('TCK');
    ensureSheetBySchema_(SHEETS.TICKET);

    // UserLock is independent from appendRow_'s ScriptLock and serializes
    // retries from the same authenticated requester without nested locking.
    const userLock = LockService.getUserLock();
    userLock.waitLock(30000);
    let outcome;
    try {
      const existing = readSheetObjectsEnsured_(SHEETS.TICKET).filter(function (row) {
        return String(row.RequesterEmail || '').toLowerCase() === String(user.email || '').toLowerCase() &&
          String(row.IdempotencyKey || '') === idempotencyKey;
      })[0];
      if (existing) {
        outcome = { id: existing.TicketID, duplicate: true,
          existingAttachmentIds: ticketNormalizeAttachmentIds_(existing.AttachmentIDsJSON) };
      } else {
        const created = createTicketCore_(Object.assign({}, form, {
          _ticketId: candidateTicketId,
          registeredAttachmentIds: stagedAttachmentIds,
          idempotencyKey: idempotencyKey,
          evidence: '',
          attachments: [],
          requesterEmail: user.email,
          requesterName: user.name,
          requesterPhone: sanitizeText(form.requesterPhone, 40),
          department: form.department ? sanitizeText(form.department, 120) : user.dept,
          location: sanitizeText(form.location, 160),
          requesterIdentityType: 'EMAIL',
          sourceChannel: 'WEB_INTERNAL',
          source: 'ระบบภายใน'
        }), user);
        outcome = { id: created.id, duplicate: false };
      }
    } finally {
      userLock.releaseLock();
    }

    durableTicketId = String(outcome.id || '');
    if (outcome.duplicate) {
      const durableIds = ticketNormalizeAttachmentIds_(outcome.existingAttachmentIds);
      const unexpectedIds = stagedAttachmentIds.filter(function (id) {
        return durableIds.indexOf(id) === -1;
      });
      if (unexpectedIds.length) {
        ticketDiscardUnclaimedRegisteredAttachments_(unexpectedIds, user,
          'duplicate idempotency key uses only the original ticket attachments');
      }
      stagedAttachmentIds = durableIds;
    }
    const claimedIds = ticketEnsureRegisteredAttachments_(durableTicketId,
      stagedAttachmentIds, user);
    stagedAttachmentIds = [];
    return ok({ id: durableTicketId, duplicate: outcome.duplicate, attachmentIds: claimedIds },
      (outcome.duplicate ? 'พบ Ticket เดิม เลขที่ ' : 'เปิด Ticket เรียบร้อย เลขที่ ') + durableTicketId);
  } catch (e) {
    if (!durableTicketId && candidateTicketId) {
      try {
        const persisted = findRow_(SHEETS.TICKET, 'TicketID', candidateTicketId) ||
          readSheetObjectsEnsured_(SHEETS.TICKET).filter(function (row) {
            return String(row.RequesterEmail || '').toLowerCase() === String(user && user.email || '').toLowerCase() &&
              String(row.IdempotencyKey || '') === idempotencyKey;
          })[0];
        if (persisted) durableTicketId = String(persisted.TicketID || '');
      } catch (ignorePersistedTicket) {}
    }
    if (durableTicketId && user) {
      try {
        const durable = findRowEnsured_(SHEETS.TICKET, 'TicketID', durableTicketId);
        if (durable) {
          ticketEnsureRegisteredAttachments_(durableTicketId,
            ticketNormalizeAttachmentIds_(durable.AttachmentIDsJSON), user);
          stagedAttachmentIds = [];
        }
      } catch (repairError) {
        console.error('submitTicket durable attachment repair: ' + repairError.message);
      }
    }
    if (!durableTicketId && stagedAttachmentIds.length) {
      ticketDiscardUnclaimedRegisteredAttachments_(stagedAttachmentIds, user,
        'authenticated ticket submission failed: ' + sanitizeText(e && e.message, 300));
    }
    return fail(e.message);
  }
}

function ticketNormalizeAttachmentIds_(value) {
  let list = value;
  if (typeof list === 'string') {
    const text = list.trim();
    if (!text) list = [];
    else if (text.charAt(0) === '[') {
      try { list = JSON.parse(text); } catch (e) { throw new Error('รายการไฟล์แนบไม่ถูกต้อง'); }
    } else list = text.split(',');
  }
  if (!Array.isArray(list)) list = list ? [list] : [];
  const seen = {};
  return list.map(function (id) { return sanitizeText(id, 120); }).filter(function (id) {
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(id) || seen[id]) return false;
    seen[id] = true;
    return true;
  }).slice(0, 10);
}

/** Claim intent is persisted on Tickets before this runs, so retries repair safely. */
function ticketEnsureRegisteredAttachments_(ticketId, attachmentIds, actor) {
  const ticket = findRowEnsured_(SHEETS.TICKET, 'TicketID', ticketId);
  if (!ticket) throw new Error('ไม่พบ Ticket สำหรับผูกไฟล์แนบ');
  if (typeof arRepairDurableAttachmentIntent_ !== 'function') {
    throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
  }
  const ids = ticketNormalizeAttachmentIds_(ticket.AttachmentIDsJSON);
  const requested = ticketNormalizeAttachmentIds_(attachmentIds);
  const unexpected = requested.filter(function (id) { return ids.indexOf(id) === -1; });
  if (unexpected.length) {
    throw new Error('Attachment replay contains IDs outside the durable ticket intent');
  }
  const claimed = [];
  ids.forEach(function (attachmentId) {
    // Terminal-safe exact-intent repair supersedes claimRegisteredAttachment_.
    const row = arRepairDurableAttachmentIntent_(attachmentId, 'ticket', ticketId, {
      recordType: 'Ticket', fieldName: 'AttachmentIDsJSON',
      attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true
    }, actor);
    const id = String(row && row.AttachmentID || attachmentId);
    if (claimed.indexOf(id) === -1) claimed.push(id);
  });
  // updateRow_(SHEETS.TICKET) is intentionally unnecessary: the source field
  // was written as durable claim intent before this repair runs.
  return ticketNormalizeAttachmentIds_(claimed);
}

function ticketDiscardUnclaimedRegisteredAttachments_(attachmentIds, actor, reason) {
  ticketNormalizeAttachmentIds_(attachmentIds).forEach(function (attachmentId) {
    try {
      if (typeof arFindAttachment_ !== 'function' ||
          typeof softDeleteRegisteredAttachment !== 'function') return;
      const row = arFindAttachment_(attachmentId);
      if (!row || String(row.Status || '').toUpperCase() !== 'STAGED') return;
      const uploader = String(row.UploaderEmail || row.UploadedBy || row.CreatedBy || '').toLowerCase();
      if (uploader && uploader !== String(actor && actor.email || '').toLowerCase()) return;
      softDeleteRegisteredAttachment(attachmentId, sanitizeText(reason, 500));
    } catch (cleanupError) {
      console.error('ticketDiscardUnclaimedRegisteredAttachments_: ' + cleanupError.message);
    }
  });
}

/** ติดตามสถานะ Ticket แบบ public ด้วยเลขที่ + รหัสติดตาม/Lookup session จาก OTP */
function trackTicketPublic(ticketId, secret) {
  try {
    ticketId = sanitizeText(ticketId, 80);
    secret = sanitizeText(secret, 160);
    requireFields({ 'เลขที่ Ticket': ticketId, 'รหัสติดตาม': secret }, ['เลขที่ Ticket', 'รหัสติดตาม']);
    checkPublicLookupRate_('track', ticketId + ':' + secret, 40, 3600);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    if (!ticketSecretMatches_(t, secret)) throw new Error('รหัสติดตามไม่ตรงกับ Ticket นี้ หรือสิทธิ์จาก OTP หมดอายุแล้ว');

    return ok(ticketPublicStatusPayload_(t));
  } catch (e) {
    return fail(e.message);
  }
}

/** ติดตาม Ticket ของ LINE account ที่ Login อยู่เท่านั้น */
function trackTicketLine(sessionToken, ticketId) {
  try {
    const lineUser = requireActiveLineSession_(sessionToken);
    ticketId = sanitizeText(ticketId, 80);
    requireFields({ 'เลขที่ Ticket': ticketId }, ['เลขที่ Ticket']);
    checkPublicLookupRate_('line_track', lineUser.LineUserID + ':' + ticketId, 60, 3600);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t || String(t.RequesterLineUserID) !== String(lineUser.LineUserID)) {
      throw new Error('ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน');
    }
    return ok(ticketPublicStatusPayload_(t));
  } catch (e) {
    return fail(e.message);
  }
}

function ticketPublicStatusPayload_(t) {
  const worklogs = getTicketWorklogRows_(t.TicketID)
    .filter(function (w) { return String(w.IsPublic).toLowerCase() === 'yes'; })
    .map(function (w) {
      return {
        date: safeFmtDateTime_(w.Timestamp),
        action: w.Action,
        detail: w.Detail,
        statusTo: w.StatusTo
      };
    });
  return {
    id: t.TicketID,
    title: t.Title,
    category: t.Category,
    priority: t.Priority,
    status: t.Status,
    createdAt: fmtDateTime(t.Timestamp),
    dueAt: fmtDateTime(t.DueAt),
    // ไม่เปิดเผยอีเมลเจ้าหน้าที่ — แสดงเฉพาะว่ามอบหมายแล้วหรือยัง
    assignState: t.Assignee ? 'มอบหมายเจ้าหน้าที่แล้ว' : 'รอมอบหมาย',
    resolution: t.Resolution,
    resolvedAt: fmtDateTime(t.ResolvedAt),
    closeDate: fmtDateTime(t.CloseDate),
    canFeedback: canRateTicket_(t),
    rating: t.Rating,
    feedback: t.Feedback,
    worklogs: worklogs
  };
}

/** แสดงรายการล่าสุดหลังยืนยัน OTP — ไม่คืน PublicToken ของ Ticket ออกไปยัง client */
function listMyTicketsPublic(email, otp) {
  try {
    if (!isPublicTicketEmailOtpEnabled_()) {
      throw new Error('ระบบปิด Email OTP แล้ว กรุณาใช้ LINE Login หรือเลข Ticket + รหัสติดตาม');
    }
    ensureSheetBySchema_(SHEETS.TICKET);
    email = sanitizeText(email, 160).toLowerCase();
    requireFields({ 'อีเมล': email }, ['อีเมล']);
    if (!isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    const lookupToken = verifyPublicTicketLookupOtp_(email, otp);

    const rows = readSheetObjects_(SHEETS.TICKET)
      .filter(function (t) { return String(t.RequesterEmail).toLowerCase() === email; })
      .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
      .slice(0, 20)
      .map(function (t) {
        return {
          id: t.TicketID, title: t.Title, category: t.Category, priority: t.Priority,
          status: t.Status, createdAt: fmtDateTime(t.Timestamp),
          canFeedback: canRateTicket_(t)
        };
      });

    return ok({
      email: email,
      tickets: rows,
      lookupToken: lookupToken,
      expiresMinutes: Math.round(PUBLIC_TICKET_LOOKUP_TTL_SEC / 60)
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** แสดง Ticket ล่าสุดของ LINE account ที่ Login อยู่ */
function listMyTicketsLine(sessionToken) {
  try {
    const lineUser = requireActiveLineSession_(sessionToken);
    ensureSheetBySchema_(SHEETS.TICKET);
    const rows = readSheetObjects_(SHEETS.TICKET)
      .filter(function (t) {
        return String(t.RequesterLineUserID) === String(lineUser.LineUserID);
      })
      .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
      .slice(0, 50)
      .map(function (t) {
        return {
          id: t.TicketID,
          title: t.Title,
          category: t.Category,
          priority: t.Priority,
          status: t.Status,
          createdAt: fmtDateTime(t.Timestamp),
          canFeedback: canRateTicket_(t)
        };
      });
    return ok({ tickets: rows });
  } catch (e) {
    return fail(e.message);
  }
}

/** ส่งคะแนนความพึงพอใจหลังงานเสร็จ (public) */
function submitTicketFeedbackPublic(ticketId, secret, rating, comment) {
  try {
    ticketId = sanitizeText(ticketId, 80);
    secret = sanitizeText(secret, 160);
    checkPublicLookupRate_('feedback', ticketId + ':' + secret, 20, 3600);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    if (!ticketSecretMatches_(t, secret)) throw new Error('รหัสติดตามไม่ถูกต้อง หรือสิทธิ์จาก OTP หมดอายุแล้ว');
    if (!canRateTicket_(t)) throw new Error('ให้คะแนนได้เฉพาะงานที่เสร็จสิ้น/ปิดงานแล้ว และยังไม่เคยประเมิน');
    const r = parseInt(rating, 10);
    if (isNaN(r) || r < 1 || r > 5) throw new Error('กรุณาให้คะแนนระหว่าง 1-5');

    updateRow_(SHEETS.TICKET, t._row, {
      Rating: r, Feedback: sanitizeText(comment, 1000), FeedbackAt: new Date()
    }, t.RequesterEmail);
    addTicketWorklog_(t, { email: t.RequesterEmail, name: t.RequesterName }, 'ให้คะแนนความพึงพอใจ',
      { detail: r + '/5 ' + sanitizeText(comment, 500), isPublic: true });
    writeAudit_({ email: t.RequesterEmail, role: 'public' }, 'FEEDBACK', 'ticket', SHEETS.TICKET, ticketId, r + '/5', 'success');
    return ok('ขอบคุณสำหรับการประเมิน');
  } catch (e) {
    return fail(e.message);
  }
}

/** ส่งคะแนนโดยยืนยันเจ้าของ Ticket จาก LINE session */
function submitTicketFeedbackLine(sessionToken, ticketId, rating, comment) {
  try {
    const lineUser = requireActiveLineSession_(sessionToken);
    ticketId = sanitizeText(ticketId, 80);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t || String(t.RequesterLineUserID) !== String(lineUser.LineUserID)) {
      throw new Error('ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน');
    }
    if (!canRateTicket_(t)) {
      throw new Error('ให้คะแนนได้เฉพาะงานที่เสร็จสิ้น/ปิดงานแล้ว และยังไม่เคยประเมิน');
    }
    const r = parseInt(rating, 10);
    if (isNaN(r) || r < 1 || r > 5) throw new Error('กรุณาให้คะแนนระหว่าง 1-5');
    const actor = lineActor_(lineUser);
    updateRow_(SHEETS.TICKET, t._row, {
      Rating: r,
      Feedback: sanitizeText(comment, 1000),
      FeedbackAt: new Date()
    }, actor.email);
    addTicketWorklog_(t, actor, 'ให้คะแนนความพึงพอใจ', {
      detail: r + '/5 ' + sanitizeText(comment, 500),
      isPublic: true
    });
    writeAudit_(actor, 'FEEDBACK', 'ticket', SHEETS.TICKET, ticketId, r + '/5', 'success');
    return ok('ขอบคุณสำหรับการประเมิน');
  } catch (e) {
    return fail(e.message);
  }
}

function ticketSecretMatches_(t, secret) {
  const raw = String(secret || '').trim();
  if (!raw) return false;

  // Lookup session ชั่วคราวที่ออกหลังยืนยัน OTP ผูกกับอีเมลเจ้าของ Ticket
  const lookupEmail = publicTicketLookupEmail_(raw);
  if (lookupEmail && lookupEmail === String(t.RequesterEmail).toLowerCase()) return true;

  // Ticket รุ่นใหม่เก็บเฉพาะ HMAC hash; Ticket รุ่นเก่ายังใช้ token เดิมได้และ migrate เมื่อใช้สำเร็จ
  const hash = publicTicketSecretHash_(raw);
  if (t.PublicTokenHash && String(t.PublicTokenHash) === hash) return true;
  if (t.PublicToken && String(t.PublicToken).toLowerCase() === raw.toLowerCase()) {
    try {
      updateRow_(SHEETS.TICKET, t._row, { PublicToken: '', PublicTokenHash: hash }, 'system');
    } catch (e) {
      console.error('migrate ticket token: ' + e.message);
    }
    return true;
  }
  return false;
}

function canRateTicket_(t) {
  const st = String(t.Status);
  const ratable = (st === TICKET_STATUS.RESOLVED || st === TICKET_STATUS.CLOSED);
  return ratable && !t.Rating;
}

// ===================================================================
// แกนกลางการสร้าง Ticket (ใช้ร่วมทั้ง public และผู้ใช้ภายใน)
// ===================================================================
function createTicketCore_(form, actor) {
  ensureSheetBySchema_(SHEETS.TICKET);
  const title = sanitizeText(form.title, 200);
  const category = sanitizeText(form.category, 120);
  const description = sanitizeText(form.description, 3000);
  requireFields({ 'หัวข้อปัญหา': title, 'หมวดหมู่': category, 'รายละเอียด': description },
    ['หัวข้อปัญหา', 'หมวดหมู่', 'รายละเอียด']);

  const cat = getTicketCategoryByName_(category);
  if (!cat) throw new Error('กรุณาเลือกหมวดหมู่ Ticket จากรายการที่กำหนด');
  const priority = sanitizeText(form.priority, 40) || cat.DefaultPriority || 'ปานกลาง';
  if (!isInList(priority, TICKET_PRIORITY)) throw new Error('ระดับความเร่งด่วนไม่ถูกต้อง');

  const responseSlaHours = parseInt(cat.ResponseSLAHours || '4', 10) || 4;
  const slaHours = parseInt(cat.ResolutionSLAHours || cat.SLAHours || '24', 10) || 24;
  const now = new Date();
  const requestedId = sanitizeText(form._ticketId, 120);
  const id = /^TCK-[A-Za-z0-9_-]{8,}$/.test(requestedId) ? requestedId : generateId('TCK');
  const token = generateTicketToken_();
  const responseDueAt = addBusinessHours_(now, responseSlaHours);
  const dueAt = addBusinessHours_(now, slaHours);
  const isSecurity = (String(cat.IsSecurityDefault).toLowerCase() === 'yes' ||
    String(form.isSecurity).toLowerCase() === 'yes') ? 'Yes' : 'No';

  const registeredAttachmentIds = ticketNormalizeAttachmentIds_(form.registeredAttachmentIds);
  const fileUrls = registeredAttachmentIds.length ? [] : savePublicTicketFiles_(form.attachments);
  const evidence = registeredAttachmentIds.length ? '' :
    (fileUrls.length ? fileUrls.join('\n') : sanitizeText(form.evidence, 1000));

  appendRow_(SHEETS.TICKET, {
    TicketID: id,
    Title: title,
    RequesterEmail: form.requesterEmail || (actor.lineUserId ? '' : actor.email),
    RequesterName: form.requesterName || actor.name,
    RequesterPhone: sanitizeText(form.requesterPhone, 40),
    Department: sanitizeText(form.department, 120),
    Location: sanitizeText(form.location, 160),
    Category: category,
    Priority: priority,
    ResponseSLAHours: responseSlaHours,
    ResponseDueAt: responseDueAt,
    ResolutionSLAHours: slaHours,
    SLAHours: slaHours,
    DueAt: dueAt,
    AssetID: sanitizeText(form.assetId, 80),
    AssetName: sanitizeText(form.assetName, 160),
    Description: description,
    Assignee: '',
    IsSecurity: isSecurity,
    IncidentID: '',
    Status: TICKET_STATUS.NEW,
    EvidenceLink: evidence,
    AttachmentIDsJSON: JSON.stringify(registeredAttachmentIds),
    IdempotencyKey: sanitizeText(form.idempotencyKey, 160),
    PublicToken: '',
    PublicTokenHash: publicTicketSecretHash_(token),
    RequesterIdentityType: form.requesterIdentityType || (actor.lineUserId ? 'LINE' : 'EMAIL'),
    RequesterLineUserID: form.requesterLineUserId || actor.lineUserId || '',
    SourceChannel: form.sourceChannel || (actor.lineUserId ? 'LINE_OA' : 'WEB'),
    Notes: form.privacyConsentVersion
      ? ('PrivacyConsent=' + sanitizeText(form.privacyConsentVersion, 40) +
        ' at ' + Utilities.formatDate(now, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss"))
      : ''
  }, actor.email || form.requesterEmail || 'public', registeredAttachmentIds.length ? function () {
    // Runs under appendRow_'s ScriptLock immediately before the parent row is
    // appended. An ACTIVE/cross-record attachment can never become new intent.
    registeredAttachmentIds.forEach(function (attachmentId) {
      arAssertClaimableAttachmentLocked_(attachmentId, 'ticket', '', {
        recordType: 'Ticket', fieldName: 'AttachmentIDsJSON',
        attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true
      }, actor);
    });
  } : null);

  const openDetail = 'ช่องทาง: ' + (form.source || 'ระบบ') +
    (form.privacyConsentVersion ? ' · privacy=' + sanitizeText(form.privacyConsentVersion, 40) : '');
  addTicketWorklog_({ TicketID: id }, actor, 'เปิด Ticket',
    { statusTo: TICKET_STATUS.NEW, detail: openDetail, isPublic: true });
  writeAudit_(actor, 'CREATE', 'ticket', SHEETS.TICKET, id, title, 'success');
  notifyAdminsNewTicket_(id, title, category, form.requesterName || actor.name, slaHours, isSecurity, priority);

  return { id: id, token: token };
}

function generateTicketToken_() {
  return Utilities.getUuid().replace(/-/g, '').toUpperCase();
}

function getPublicTicketPepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty('PUBLIC_TICKET_TOKEN_PEPPER');
  if (!pepper) {
    pepper = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PUBLIC_TICKET_TOKEN_PEPPER', pepper);
  }
  return pepper;
}

function publicTicketSecretHash_(value) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(
    String(value || ''), getPublicTicketPepper_(), Utilities.Charset.UTF_8));
}

function generatePublicTicketOtp_() {
  const hex = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
  const n = parseInt(hex, 16) % 1000000;
  return String(n).padStart(6, '0');
}

function sendPublicTicketOtp_(email, otp) {
  if (!isPublicTicketEmailOtpEnabled_()) {
    throw new Error('ระบบปิด Email OTP แล้ว');
  }
  let result = 'success', err = '';
  const subject = 'รหัส OTP สำหรับดูรายการ Ticket';
  try {
    MailApp.sendEmail({
      to: email,
      subject: '[' + getConfig_('ORG_NAME', 'ISMS') + '] ' + subject,
      htmlBody: '<p>รหัส OTP ของท่านคือ</p><p style="font-size:28px;font-weight:700;letter-spacing:5px">' +
        escapeHtml(otp) + '</p><p>รหัสนี้มีอายุ ' +
        Math.round(PUBLIC_TICKET_OTP_TTL_SEC / 60) + ' นาที และใช้ได้ครั้งเดียว</p>',
      name: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต') + ' - Help Desk'
    });
  } catch (e) {
    result = 'fail';
    err = e.message;
  }
  logNotification_('Email-OTP', email, subject, 'ticket', '', result, err);
  if (result !== 'success') throw new Error(err || 'ส่ง OTP ไม่สำเร็จ');
}

function verifyPublicTicketLookupOtp_(email, otp) {
  otp = sanitizeText(otp, 12);
  requireFields({ 'OTP': otp }, ['OTP']);
  if (!/^\d{6}$/.test(otp)) throw new Error('รหัส OTP ต้องเป็นตัวเลข 6 หลัก');
  checkPublicLookupRate_('otp_verify', email, 10, PUBLIC_TICKET_OTP_TTL_SEC);

  const cache = CacheService.getScriptCache();
  const emailKey = publicRateKey_(email);
  const otpKey = 'pub_ticket_otp_' + emailKey;
  const stored = cache.get(otpKey);
  const supplied = publicTicketSecretHash_('otp:' + email + ':' + otp);
  if (!stored || stored !== supplied) throw new Error('รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว');
  cache.remove(otpKey);

  const lookupToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('pub_ticket_lookup_' + publicRateKey_(lookupToken), email, PUBLIC_TICKET_LOOKUP_TTL_SEC);
  return lookupToken;
}

function publicTicketLookupEmail_(lookupToken) {
  try {
    return String(CacheService.getScriptCache().get(
      'pub_ticket_lookup_' + publicRateKey_(lookupToken)) || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

/** ย้าย Ticket รุ่นเก่าจาก token plaintext เป็น HMAC hash; เรียกจาก setupSystem() */
function migratePublicTicketTokens_() {
  ensureSheetBySchema_(SHEETS.TICKET);
  let updated = 0;
  readSheetObjects_(SHEETS.TICKET).forEach(function (t) {
    if (t.PublicToken && !t.PublicTokenHash) {
      updateRow_(SHEETS.TICKET, t._row, {
        PublicTokenHash: publicTicketSecretHash_(String(t.PublicToken)),
        PublicToken: ''
      }, 'system');
      updated++;
    }
  });
  return updated;
}

/** อัปโหลดไฟล์แนบ (รันฝั่ง server ในสิทธิ์เจ้าของ จึงรองรับผู้แจ้งแบบ anonymous) */
function savePublicTicketFiles_(attachments) {
  const urls = [];
  if (!attachments || !attachments.length) return urls;
  const limits = getPublicTicketLimits_();
  const allowedExt = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp', 'txt'];
  const folder = getEvidenceFolder_('ticket');
  if (attachments.length > limits.maxFiles) throw new Error('แนบไฟล์ได้สูงสุด ' + limits.maxFiles + ' ไฟล์');
  let totalBytes = 0;
  attachments.slice(0, limits.maxFiles).forEach(function (a) {
    if (!a || !a.base64 || !a.filename) return;
    const ext = String(a.filename).split('.').pop().toLowerCase();
    if (allowedExt.indexOf(ext) === -1) throw new Error('ชนิดไฟล์ไม่อนุญาต: ' + a.filename);
    const bytes = Utilities.base64Decode(a.base64);
    if (bytes.length > limits.maxFileMb * 1024 * 1024) {
      throw new Error('ไฟล์ใหญ่เกิน ' + limits.maxFileMb + ' MB: ' + a.filename);
    }
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalMb * 1024 * 1024) {
      throw new Error('ไฟล์แนบรวมใหญ่เกิน ' + limits.maxTotalMb + ' MB');
    }
    validatePublicTicketFile_(ext, a.mimeType, bytes, a.filename);
    const safe = sanitizeText(a.filename, 120).replace(/[\\\/:*?"<>|]/g, '_');
    const stamped = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss') + '_' + safe;
    const file = folder.createFile(Utilities.newBlob(bytes, safePublicMimeType_(ext), safe)).setName(stamped);
    file.setDescription('Public Ticket attachment · pending IT review');
    urls.push(file.getUrl());
  });
  return urls;
}

function validatePublicTicketFile_(ext, claimedMime, bytes, filename) {
  const b = bytes.map(function (v) { return v & 0xff; });
  const starts = function (sig) {
    if (b.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
    return true;
  };
  const ascii = function (start, len) {
    return b.slice(start, start + len).map(function (v) { return String.fromCharCode(v); }).join('');
  };
  let valid = false;
  if (ext === 'pdf') valid = ascii(0, 5) === '%PDF-';
  else if (ext === 'jpg' || ext === 'jpeg') valid = starts([0xff, 0xd8, 0xff]);
  else if (ext === 'png') valid = starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (ext === 'webp') valid = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  else if (ext === 'heic') valid = b.length >= 12 && ascii(4, 4) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].indexOf(ascii(8, 4)) > -1;
  else if (ext === 'txt') valid = b.slice(0, Math.min(b.length, 4096)).indexOf(0) === -1;
  if (!valid) throw new Error('เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์: ' + filename);

  const mime = String(claimedMime || '').toLowerCase();
  const allowedMime = {
    pdf: ['application/pdf'],
    jpg: ['image/jpeg'], jpeg: ['image/jpeg'],
    png: ['image/png'], webp: ['image/webp'],
    heic: ['image/heic', 'image/heif', 'application/octet-stream'],
    txt: ['text/plain', 'application/octet-stream']
  };
  if (mime && allowedMime[ext] && allowedMime[ext].indexOf(mime) === -1) {
    throw new Error('MIME type ของไฟล์ไม่ตรงกับนามสกุล: ' + filename);
  }
}

function safePublicMimeType_(ext) {
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', txt: 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
}

function getPublicTicketLimits_() {
  const maxFiles = clampNumber_(getConfig_('PUBLIC_TICKET_MAX_FILES', '5'), 1, 5, 5);
  const maxFileMb = clampNumber_(getConfig_('PUBLIC_TICKET_MAX_FILE_MB', '10'), 1, 15, 10);
  const maxTotalMb = clampNumber_(getConfig_('PUBLIC_TICKET_MAX_TOTAL_MB', '20'), 1, 50, 20);
  const maxPerHour = clampNumber_(getConfig_('PUBLIC_TICKET_MAX_PER_HOUR', '3'), 1, 20, 3);
  const maxPerDay = clampNumber_(getConfig_('PUBLIC_TICKET_MAX_PER_DAY', '8'), 1, 50, 8);
  const globalMaxPerHour = clampNumber_(getConfig_('PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR', '60'), 10, 1000, 60);
  const globalMaxPerDay = clampNumber_(getConfig_('PUBLIC_TICKET_GLOBAL_MAX_PER_DAY', '300'), 20, 5000, 300);
  const sharedCode = getConfig_('PUBLIC_TICKET_SHARED_CODE', '');
  const allowedDomains = getConfig_('PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS', '')
    .split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(String);
  return {
    enabled: getConfig_('PUBLIC_TICKET_ENABLED', 'true') !== 'false',
    maxFiles: maxFiles,
    maxFileMb: maxFileMb,
    maxTotalMb: maxTotalMb,
    maxPerHour: maxPerHour,
    maxPerDay: maxPerDay,
    globalMaxPerHour: globalMaxPerHour,
    globalMaxPerDay: globalMaxPerDay,
    sharedCode: sharedCode,
    allowedDomains: allowedDomains
  };
}

function assertPublicTicketAllowed_(form, rateIdentity, emailForDomain) {
  const limits = getPublicTicketLimits_();
  if (!limits.enabled) throw new Error('ขณะนี้ปิดรับ Ticket จากหน้าสาธารณะ กรุณาติดต่อส่วนงาน IT');
  if (getConfig_('PUBLIC_TICKET_REQUIRE_LINE', 'false') === 'true' &&
      String(rateIdentity || '').indexOf('line:') !== 0) {
    throw new Error('ระบบกำหนดให้เข้าสู่ระบบด้วย LINE ก่อนส่ง Ticket');
  }
  if (sanitizeText(form.website, 200)) throw new Error('ไม่สามารถรับรายการนี้ได้');
  if (limits.sharedCode && String(form.accessCode || '').trim() !== limits.sharedCode) {
    throw new Error('รหัสสำหรับแจ้งซ่อมไม่ถูกต้อง');
  }
  if (limits.allowedDomains.length) {
    // LINE Login ผ่านการยืนยันตัวตนแยก ไม่ใช้กฎโดเมนอีเมล
    if (emailForDomain) {
      const domain = String(emailForDomain).split('@').pop().toLowerCase();
      if (limits.allowedDomains.indexOf(domain) === -1) {
        throw new Error('อีเมลนี้ไม่อยู่ในโดเมนที่อนุญาตให้แจ้งซ่อม');
      }
    }
  }
  checkPublicTicketRate_(rateIdentity, limits);
}

function checkPublicTicketRate_(identity, limits) {
  const key = publicRateKey_(identity);
  const now = new Date();
  const today = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd');
  const hourBucket = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMddHH');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const hourKey = 'pub_ticket_hour_' + key;
    const globalHourKey = 'pub_ticket_global_hour_' + hourBucket;
    const hourCount = parseInt(cache.get(hourKey) || '0', 10);
    const globalHourCount = parseInt(cache.get(globalHourKey) || '0', 10);
    if (hourCount >= limits.maxPerHour) {
      throw new Error('อุปกรณ์นี้ส่ง Ticket เกินจำนวนที่กำหนดต่อชั่วโมง กรุณารอสักครู่แล้วลองใหม่');
    }
    if (globalHourCount >= limits.globalMaxPerHour) {
      throw new Error('ระบบรับ Ticket ครบจำนวนสูงสุดของชั่วโมงนี้แล้ว กรุณาลองใหม่ภายหลัง');
    }

    cleanupTicketRateLimitRows_();
    const dayKey = 'device:' + key;
    const globalDayKey = 'global';
    const dayCount = getTicketRateLimitCount_('PUBLIC_TICKET_DAY', today, dayKey);
    const globalDayCount = getTicketRateLimitCount_('PUBLIC_TICKET_GLOBAL_DAY', today, globalDayKey);
    if (dayCount >= limits.maxPerDay) {
      throw new Error('อุปกรณ์นี้ส่ง Ticket เกินจำนวนที่กำหนดต่อวัน กรุณาติดต่อส่วนงาน IT');
    }
    if (globalDayCount >= limits.globalMaxPerDay) {
      throw new Error('ระบบรับ Ticket ครบจำนวนสูงสุดของวันนี้แล้ว กรุณาติดต่อส่วนงาน IT');
    }

    cache.put(hourKey, String(hourCount + 1), 3600);
    cache.put(globalHourKey, String(globalHourCount + 1), 3700);
    setTicketRateLimitCount_('PUBLIC_TICKET_DAY', today, dayKey, dayCount + 1);
    setTicketRateLimitCount_('PUBLIC_TICKET_GLOBAL_DAY', today, globalDayKey, globalDayCount + 1);
  } finally {
    lock.releaseLock();
  }
}

function checkPublicLookupRate_(scope, identity, maxCount, ttlSec) {
  const cache = CacheService.getScriptCache();
  const key = 'pub_' + scope + '_' + publicRateKey_(identity);
  const count = parseInt(cache.get(key) || '0', 10);
  if (count >= maxCount) throw new Error('มีการตรวจสอบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
  cache.put(key, String(count + 1), ttlSec);
}

function publicRateKey_(value) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(value || 'unknown').toLowerCase(), Utilities.Charset.UTF_8)).substring(0, 32);
}

function sanitizePublicClientId_(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,120}$/.test(id) ? id : '';
}

function ticketRateLimitKey_(scope, bucket, identityKey) {
  return [scope || '', bucket || '', identityKey || ''].join('|');
}

function ticketRateLimitExpiresAt_(bucket) {
  const text = String(bucket || '');
  const y = parseInt(text.substring(0, 4), 10);
  const m = parseInt(text.substring(4, 6), 10);
  const d = parseInt(text.substring(6, 8), 10);
  const expires = (!isNaN(y) && !isNaN(m) && !isNaN(d))
    ? new Date(y, m - 1, d + 2, 0, 0, 0)
    : new Date(Date.now() + 2 * 86400000);
  return expires;
}

function getTicketRateLimitCount_(scope, bucket, identityKey) {
  const key = ticketRateLimitKey_(scope, bucket, identityKey);
  const sh = ensureSheetBySchema_(SHEETS.RATE_LIMIT);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  const headers = values[0];
  const keyIdx = headers.indexOf('RateKey');
  const countIdx = headers.indexOf('Count');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx]) === key) return parseInt(values[i][countIdx], 10) || 0;
  }
  return 0;
}

function setTicketRateLimitCount_(scope, bucket, identityKey, count) {
  const key = ticketRateLimitKey_(scope, bucket, identityKey);
  const sh = ensureSheetBySchema_(SHEETS.RATE_LIMIT);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const keyIdx = headers.indexOf('RateKey');
  const scopeIdx = headers.indexOf('Scope');
  const bucketIdx = headers.indexOf('Bucket');
  const countIdx = headers.indexOf('Count');
  const expiresIdx = headers.indexOf('ExpiresAt');
  const updatedByIdx = headers.indexOf('LastUpdatedBy');
  const updatedAtIdx = headers.indexOf('LastUpdatedAt');
  const values = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx]) === key) {
      const row = values[i].slice();
      row[countIdx] = count;
      if (expiresIdx > -1) row[expiresIdx] = ticketRateLimitExpiresAt_(bucket);
      if (updatedByIdx > -1) row[updatedByIdx] = 'system';
      if (updatedAtIdx > -1) row[updatedAtIdx] = now;
      sh.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return;
    }
  }
  const obj = {
    RateKey: key,
    Scope: scope,
    Bucket: bucket,
    Count: count,
    ExpiresAt: ticketRateLimitExpiresAt_(bucket),
    Timestamp: now,
    CreatedBy: 'system',
    LastUpdatedBy: 'system',
    LastUpdatedAt: now
  };
  sh.appendRow(headers.map(function (h) { return sheetSafeValue_(obj[h] || ''); }));
}

function cleanupTicketRateLimitRows_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('ticket_rate_limit_cleanup')) return;
  cache.put('ticket_rate_limit_cleanup', '1', 3600);
  const sh = ensureSheetBySchema_(SHEETS.RATE_LIMIT);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0];
  const expIdx = headers.indexOf('ExpiresAt');
  if (expIdx === -1) return;
  const now = new Date();
  for (let i = values.length - 1; i >= 1; i--) {
    const exp = values[i][expIdx] ? new Date(values[i][expIdx]) : null;
    if (exp && !isNaN(exp) && exp < now) sh.deleteRow(i + 1);
  }
}

function clampNumber_(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** คืนตัวเลข (finite) หรือ null — กันค่าจากชีต (Date/ว่าง/NaN) ที่ serialize ไม่ได้ */
function numOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function notifyAdminsNewTicket_(id, title, category, requesterName, slaHours, isSecurity, priority) {
  const to = getITAdminEmails_().join(',');
  const secTag = isSecurity === 'Yes' ? ' [ต้องสงสัยภัยคุกคาม]' : '';
  const subject = 'Ticket ใหม่ ' + id + secTag;
  const html = '<p>มี Ticket ใหม่:</p><ul>' +
    '<li>เลขที่: ' + escapeHtml(id) + '</li>' +
    '<li>เรื่อง: ' + escapeHtml(title) + '</li>' +
    '<li>หมวด: ' + escapeHtml(category) + '</li>' +
    '<li>ความเร่งด่วน: ' + escapeHtml(priority || '-') + '</li>' +
    '<li>ผู้แจ้ง: ' + escapeHtml(requesterName) + '</li>' +
    '<li>SLA: ' + slaHours + ' ชั่วโมง</li></ul>' +
    '<p><a href="' + getTicketWebAppUrl_() + '">เปิดระบบ</a></p>';
  const plain = subject + ': ' + title + ' (' + category + ') SLA ' + slaHours + ' ชม.';
  notify_(to, subject, html, plain, 'ticket', id);
}

// ===================================================================
// ฝั่งเจ้าหน้าที่: รับเรื่อง / คัดแยก / ดำเนินการ / ปิด / ยกเลิก
// ===================================================================

/** รับเรื่อง (ใหม่ -> รับเรื่องแล้ว) */
function acknowledgeTicket(ticketId, note) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.APPROVER]);
    const t = ticketForUpdate_(ticketId);
    assertTicketTransition_(t.Status, TICKET_STATUS.ACK);
    updateRow_(SHEETS.TICKET, t._row, {
      Status: TICKET_STATUS.ACK,
      AcknowledgedAt: t.AcknowledgedAt || new Date()
    }, user.email);
    addTicketWorklog_(t, user, 'รับเรื่อง',
      { statusFrom: t.Status, statusTo: TICKET_STATUS.ACK, detail: sanitizeText(note, 1000), isPublic: true });
    writeAudit_(user, 'ACK', 'ticket', SHEETS.TICKET, ticketId, '', 'success');
    notifyRequesterStatus_(t, TICKET_STATUS.ACK, note);
    return ok('รับเรื่องเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function triageTicket(ticketId, fields) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.APPROVER]);
    const t = ticketForUpdate_(ticketId);

    fields = fields || {};
    const patch = {};
    if (fields.category !== undefined && fields.category !== '') {
      const cat = getTicketCategoryByName_(fields.category);
      if (!cat) throw new Error('หมวดหมู่ Ticket ไม่ถูกต้อง');
      patch.Category = cat.CategoryName;
      if (!fields.priority && cat.DefaultPriority) patch.Priority = cat.DefaultPriority;
      patch.ResponseSLAHours = parseInt(cat.ResponseSLAHours || t.ResponseSLAHours || '4', 10) || 4;
      patch.ResolutionSLAHours = parseInt(cat.ResolutionSLAHours || cat.SLAHours || t.SLAHours || '24', 10) || 24;
      patch.SLAHours = patch.ResolutionSLAHours;
      patch.ResponseDueAt = addBusinessHours_(new Date(t.Timestamp || new Date()), patch.ResponseSLAHours);
      patch.DueAt = addBusinessHours_(new Date(t.Timestamp || new Date()), patch.ResolutionSLAHours);
      if (String(cat.IsSecurityDefault).toLowerCase() === 'yes') patch.IsSecurity = 'Yes';
    }
    if (fields.priority !== undefined && fields.priority !== '') {
      const p = sanitizeText(fields.priority, 40);
      if (!isInList(p, TICKET_PRIORITY)) throw new Error('ระดับความเร่งด่วนไม่ถูกต้อง');
      patch.Priority = p;
    }
    if (fields.assignee !== undefined) patch.Assignee = sanitizeText(fields.assignee, 120);
    if (fields.isSecurity !== undefined) {
      const requestedSecurity = String(fields.isSecurity).toLowerCase() === 'yes' ? 'Yes' : 'No';
      if (requestedSecurity === 'Yes' || patch.IsSecurity !== 'Yes') patch.IsSecurity = requestedSecurity;
    }
    // คัดแยกแล้วถือว่ารับเรื่อง (ถ้ายังเป็น "ใหม่")
    if (String(t.Status) === TICKET_STATUS.NEW) {
      patch.Status = TICKET_STATUS.ACK;
      patch.AcknowledgedAt = t.AcknowledgedAt || new Date();
    }

    if (patch.Status) assertTicketTransition_(t.Status, patch.Status);
    updateRow_(SHEETS.TICKET, t._row, patch, user.email);
    addTicketWorklog_(t, user, 'คัดแยก/มอบหมาย',
      { statusFrom: t.Status, statusTo: patch.Status || t.Status, detail: sanitizeText(fields.notes, 1000), isPublic: false });
    writeAudit_(user, 'TRIAGE', 'ticket', SHEETS.TICKET, ticketId, JSON.stringify(patch), 'success');

    if (patch.Assignee && isValidEmail(patch.Assignee)) {
      notify_(patch.Assignee, 'ท่านได้รับมอบหมาย Ticket ' + ticketId,
        '<p>ท่านได้รับมอบหมาย Ticket ' + escapeHtml(ticketId) + ': ' + escapeHtml(t.Title) + '</p>',
        'มอบหมาย Ticket ' + ticketId + ': ' + t.Title, 'ticket', ticketId);
    }
    if (patch.Status && patch.Status !== t.Status) notifyRequesterStatus_(t, patch.Status);
    return ok('คัดแยก Ticket เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function updateTicketWork(ticketId, fields) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const t = ticketForUpdate_(ticketId);
    fields = fields || {};
    if (sanitizeText(fields.evidence || fields.evidenceLink || fields.attachment ||
        fields.attachmentUrl, 1000)) {
      throw new Error('หลักฐานใหม่ต้องอัปโหลดผ่าน Attachment Registry เท่านั้น');
    }
    const patch = {};
    const allowed = [TICKET_STATUS.ACK, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_PARTS,
      TICKET_STATUS.WAITING_USER, TICKET_STATUS.OUTSOURCE, TICKET_STATUS.RESOLVED];
    if (fields.status !== undefined && fields.status !== '') {
      const st = sanitizeText(fields.status, 80);
      if (allowed.indexOf(st) === -1) throw new Error('สถานะงานไม่ถูกต้อง');
      patch.Status = st;
    } else {
      patch.Status = TICKET_STATUS.IN_PROGRESS;
    }
    assertTicketTransition_(t.Status, patch.Status);
    if (fields.assignee !== undefined) patch.Assignee = sanitizeText(fields.assignee, 120);
    if (patch.Status === TICKET_STATUS.RESOLVED && fields.resolution) {
      patch.Resolution = sanitizeText(fields.resolution, 2000);
    }
    if (patch.Status === TICKET_STATUS.RESOLVED) patch.ResolvedAt = t.ResolvedAt || new Date();

    // หยุด/เดินนาฬิกา SLA ตามการเข้า/ออกสถานะ "รอ"
    applyTicketSlaPause_(t, patch, patch.Status);

    const minutes = parseInt(fields.minutes, 10);
    updateRow_(SHEETS.TICKET, t._row, patch, user.email);
    addTicketWorklog_(t, user, 'บันทึกการดำเนินงาน', {
      statusFrom: t.Status, statusTo: patch.Status,
      detail: sanitizeText(fields.notes, 2000), minutes: isNaN(minutes) ? '' : minutes,
      attachment: '', isPublic: true
    });
    writeAudit_(user, 'UPDATE', 'ticket', SHEETS.TICKET, ticketId, JSON.stringify(patch), 'success');
    if (patch.Status !== t.Status) {
      notifyRequesterStatus_(t, patch.Status, fields.notes || fields.resolution || '');
    }
    return ok('อัปเดต Ticket เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ส่งต่อ Ticket ให้ผู้ให้บริการภายนอก
 * เลือกจาก VendorRegister หรือระบุชื่อเองได้ และสร้างเลข OUT-* ให้อัตโนมัติเมื่อยังไม่มีเลขอ้างอิง
 */
function forwardTicketToOutsource(ticketId, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    ensureSheetBySchema_(SHEETS.TICKET);
    const t = ticketForUpdate_(ticketId);
    form = form || {};

    const vendorId = sanitizeText(form.vendorId, 80);
    let outsourceName = sanitizeText(form.outsourceName, 200);
    if (vendorId) {
      const vendor = findRow_(SHEETS.VENDOR, 'VendorID', vendorId);
      if (!vendor) throw new Error('ไม่พบ Outsource ที่เลือกในทะเบียนผู้ให้บริการ');
      if (String(vendor.Status || 'Active').toLowerCase() !== 'active') {
        throw new Error('Outsource ที่เลือกถูกปิดใช้งานแล้ว');
      }
      outsourceName = sanitizeText(vendor.VendorName, 200);
    }
    requireFields({ 'ชื่อ Outsource': outsourceName }, ['ชื่อ Outsource']);

    const issueNo = sanitizeText(form.issueNo, 120) ||
      sanitizeText(t.OutsourceIssueNo, 120) || generateId('OUT');
    const notes = sanitizeText(form.notes, 1000);
    const sentAt = t.OutsourceSentAt || new Date();
    const detail = 'Outsource: ' + outsourceName + ' | เลขแจ้งปัญหา: ' + issueNo +
      (notes ? ' | หมายเหตุ: ' + notes : '');

    assertTicketTransition_(t.Status, TICKET_STATUS.OUTSOURCE);
    updateRow_(SHEETS.TICKET, t._row, {
      OutsourceVendorID: vendorId,
      OutsourceName: outsourceName,
      OutsourceIssueNo: issueNo,
      OutsourceSentAt: sentAt,
      Status: TICKET_STATUS.OUTSOURCE,
      Notes: appendTicketNote_(t.Notes, user.email, detail)
    }, user.email);
    addTicketWorklog_(t, user, t.OutsourceIssueNo ? 'อัปเดตข้อมูล Outsource' : 'ส่งต่อ Outsource', {
      statusFrom: t.Status,
      statusTo: TICKET_STATUS.OUTSOURCE,
      detail: detail,
      isPublic: true
    });
    writeAudit_(user, 'FORWARD_OUTSOURCE', 'ticket', SHEETS.TICKET, ticketId, detail, 'success');
    notifyRequesterStatus_(t, TICKET_STATUS.OUTSOURCE,
      'ส่งต่อ ' + outsourceName + ' เลขแจ้งปัญหา ' + issueNo);
    return ok('ส่งต่อ Outsource เรียบร้อย เลขแจ้งปัญหา ' + issueNo);
  } catch (e) {
    return fail(e.message);
  }
}

function closeTicket(ticketId, resolution) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    if (String(t.Status) === TICKET_STATUS.ESCALATED) throw new Error('Ticket นี้ยกระดับเป็น Incident แล้ว');
    if (String(t.Status) === TICKET_STATUS.CLOSED) throw new Error('Ticket นี้ปิดงานแล้ว');
    if (String(t.Status) === TICKET_STATUS.CANCELLED) throw new Error('Ticket นี้ถูกยกเลิกแล้ว');
    assertTicketTransition_(t.Status, TICKET_STATUS.CLOSED);
    requireFields({ 'ผลการแก้ไข': resolution }, ['ผลการแก้ไข']);
    const text = sanitizeText(resolution, 2000);
    const closePatch = {
      Status: TICKET_STATUS.CLOSED,
      ResolvedAt: t.ResolvedAt || new Date(),
      Resolution: text,
      CloseDate: new Date()
    };
    applyTicketSlaPause_(t, closePatch, TICKET_STATUS.CLOSED); // สรุปเวลาที่หยุด SLA หากปิดตรงจากสถานะ "รอ"
    updateRow_(SHEETS.TICKET, t._row, closePatch, user.email);
    addTicketWorklog_(t, user, 'ปิดงาน',
      { statusFrom: t.Status, statusTo: TICKET_STATUS.CLOSED, detail: text, isPublic: true });
    writeAudit_(user, 'CLOSE', 'ticket', SHEETS.TICKET, ticketId, text, 'success');
    const statusUrl = getTicketStatusUrl_();
    notifyTicketRequester_(t, 'Ticket ' + ticketId + ' ปิดงานแล้ว',
      '<p>Ticket ' + escapeHtml(ticketId) + ': ' + escapeHtml(t.Title) + ' ถูกปิดงานแล้ว</p>' +
      '<p><b>ผลการดำเนินการ:</b> ' + escapeHtml(text) + '</p>' +
      '<p>ท่านสามารถให้คะแนนความพึงพอใจได้ที่หน้าติดตามสถานะ</p>' +
      (statusUrl ? '<p><a href="' + escapeHtml(statusUrl) + '">เปิดหน้าสถานะของฉัน</a></p>' : ''),
      '✅ Ticket ' + ticketId + ' ปิดงานแล้ว\nเรื่อง: ' + t.Title +
      '\nสถานะ: ' + t.Status + ' → ' + TICKET_STATUS.CLOSED +
      '\nผลการดำเนินการ: ' + text +
      (statusUrl ? '\nดูสถานะและให้คะแนน: ' + statusUrl : '\nเปิดเมนู "สถานะของฉัน" เพื่อให้คะแนน'));
    return ok('ปิดงาน Ticket เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function cancelTicket(ticketId, reason) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    if (isTicketTerminal_(t.Status)) throw new Error('Ticket นี้จบงานแล้ว ไม่สามารถยกเลิกได้');
    assertTicketTransition_(t.Status, TICKET_STATUS.CANCELLED);
    requireFields({ 'เหตุผลการยกเลิก': reason }, ['เหตุผลการยกเลิก']);
    const text = sanitizeText(reason, 1000);
    updateRow_(SHEETS.TICKET, t._row, {
      Status: TICKET_STATUS.CANCELLED, CloseDate: new Date(),
      Notes: appendTicketNote_(t.Notes, user.email, 'ยกเลิก: ' + text)
    }, user.email);
    addTicketWorklog_(t, user, 'ยกเลิกงาน',
      { statusFrom: t.Status, statusTo: TICKET_STATUS.CANCELLED, detail: text, isPublic: true });
    writeAudit_(user, 'CANCEL', 'ticket', SHEETS.TICKET, ticketId, text, 'success');
    const statusUrl = getTicketStatusUrl_();
    notifyTicketRequester_(t, 'Ticket ' + ticketId + ' ถูกยกเลิก',
      '<p>Ticket ' + escapeHtml(ticketId) + ': ' + escapeHtml(t.Title) + ' ถูกยกเลิก</p>' +
      '<p><b>เหตุผล:</b> ' + escapeHtml(text) + '</p>' +
      (statusUrl ? '<p><a href="' + escapeHtml(statusUrl) + '">เปิดหน้าสถานะของฉัน</a></p>' : ''),
      '⛔ Ticket ' + ticketId + ' ถูกยกเลิก\nเรื่อง: ' + t.Title +
      '\nสถานะ: ' + t.Status + ' → ' + TICKET_STATUS.CANCELLED +
      '\nเหตุผล: ' + text +
      (statusUrl ? '\nดูรายละเอียด: ' + statusUrl : ''));
    return ok('ยกเลิก Ticket เรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function escalateTicketToIncident(ticketId, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN, ROLES.APPROVER]);
    const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
    if (t.IncidentID) {
      const existingIncident = findRow_(SHEETS.INCIDENT, 'IncidentID', t.IncidentID);
      if (!existingIncident || String(existingIncident.SourceTicketID || '') !== String(ticketId)) {
        throw new Error('Ticket/Incident provenance relation is inconsistent');
      }
      const reconciledIds = arEnsureIncidentTicketAttachmentProvenance_(
        ticketId, String(t.IncidentID), user);
      writeAudit_(user, 'ESCALATE_INCIDENT_RECONCILED', 'ticket', SHEETS.TICKET,
        ticketId, 'Incident ' + t.IncidentID + '; attachments=' + reconciledIds.length, 'success');
      return ok({ incidentId: String(t.IncidentID), duplicate: true,
        attachmentIds: reconciledIds }, 'Ticket/Incident evidence provenance reconciled');
    }
    if (String(t.Status) === TICKET_STATUS.CLOSED) throw new Error('Ticket นี้ปิดงานแล้ว');
    if (String(t.Status) === TICKET_STATUS.CANCELLED) throw new Error('Ticket นี้ถูกยกเลิกแล้ว');
    assertTicketTransition_(t.Status, TICKET_STATUS.ESCALATED);

    form = form || {};
    const category = sanitizeText(form.category, 80) || guessIncidentCategory_(t.Category);
    const severity = sanitizeText(form.severity, 40) || (t.Priority === 'วิกฤต' ? 'วิกฤต' : 'ปานกลาง');
    const personal = String(form.personalData).toLowerCase() === 'yes' ? 'Yes' : 'No';
    if (!isInList(category, INC_CATEGORY)) throw new Error('ประเภท Incident ไม่ถูกต้อง');
    if (!isInList(severity, INC_SEVERITY)) throw new Error('ระดับความรุนแรง Incident ไม่ถูกต้อง');

    const now = new Date();
    const incidentId = generateId('INC');
    const deadline = personal === 'Yes'
      ? new Date(now.getTime() + incidentDpoEscalationHours_() * 3600000) : '';
    const detail = 'ยกระดับจาก Ticket ' + ticketId + '\n\n' +
      'หัวข้อ: ' + t.Title + '\n' +
      'ผู้แจ้ง: ' + t.RequesterName + ' (' + t.RequesterEmail + ')\n' +
      'หมวด Ticket: ' + t.Category + '\n\n' +
      (t.Description || '') +
      (form.notes ? '\n\nหมายเหตุการยกระดับ: ' + sanitizeText(form.notes, 1000) : '');

    appendRow_(SHEETS.INCIDENT, {
      IncidentID: incidentId,
      Title: '[Ticket] ' + t.Title,
      ReportedBy: t.RequesterEmail || user.email,
      ReportDate: now,
      Category: category,
      Severity: severity,
      Description: detail,
      AffectedSystem: t.AssetName || t.AssetID || t.Category,
      ContainsPersonalData: personal,
      Assignee: '',
      DPONotified: 'No',
      DPONotifyDeadline: deadline,
      Status: INC_STATUS.OPEN,
      // Evidence remains in the private Ticket Attachment Registry graph. The
      // SourceTicketID/IncidentID relation is the provenance; raw Drive
      // locators are never copied into the Incident row.
      EvidenceLink: '',
      Notes: 'SourceTicketID=' + ticketId + '; TicketAttachmentCount=' +
        ticketNormalizeAttachmentIds_(t.AttachmentIDsJSON).length,
      SourceTicketID: ticketId
    }, user.email);

    updateRow_(SHEETS.TICKET, t._row, {
      IsSecurity: 'Yes',
      IncidentID: incidentId,
      Status: TICKET_STATUS.ESCALATED,
      Notes: appendTicketNote_(t.Notes, user.email, 'ยกระดับเป็น Incident ' + incidentId)
    }, user.email);

    const incidentAttachmentIds = arEnsureIncidentTicketAttachmentProvenance_(
      ticketId, incidentId, user);

    addTicketWorklog_(t, user, 'ยกระดับเป็น Incident',
      { statusFrom: t.Status, statusTo: TICKET_STATUS.ESCALATED, detail: 'Incident ' + incidentId, isPublic: true });
    writeAudit_(user, 'ESCALATE_INCIDENT', 'ticket', SHEETS.TICKET, ticketId, 'สร้าง Incident ' + incidentId, 'success');
    writeAudit_(user, 'CREATE_FROM_TICKET', 'incident', SHEETS.INCIDENT, incidentId, 'จาก Ticket ' + ticketId, 'success');

    if (personal === 'Yes') notifyDPOForIncident_(incidentId, '[Ticket] ' + t.Title, deadline);
    const statusUrl = getTicketStatusUrl_();
    notifyTicketRequester_(t, 'Ticket ' + ticketId + ' ถูกยกระดับเป็น Incident',
      '<p>Ticket ' + escapeHtml(ticketId) + ' ถูกยกระดับเป็น Incident เลขที่ <b>' +
      escapeHtml(incidentId) + '</b></p>' +
      (statusUrl ? '<p><a href="' + escapeHtml(statusUrl) + '">เปิดหน้าสถานะของฉัน</a></p>' : ''),
      '⚠️ Ticket ' + ticketId + ' ถูกยกระดับเป็น Incident\nเรื่อง: ' + t.Title +
      '\nสถานะ: ' + t.Status + ' → ' + TICKET_STATUS.ESCALATED +
      '\nIncident: ' + incidentId +
      (statusUrl ? '\nดูรายละเอียด: ' + statusUrl : ''));

    return ok({ incidentId: incidentId, attachmentIds: incidentAttachmentIds },
      'ยกระดับเป็น Incident เรียบร้อย เลขที่ ' + incidentId);
  } catch (e) {
    return fail(e.message);
  }
}

// ===================================================================
// Worklog helpers
// ===================================================================

/** อ่าน worklog (auto-create ชีตถ้ายังไม่มี) — ส่ง ticketId เพื่อกรองเฉพาะใบนั้น */
function getTicketWorklogRows_(ticketId) {
  const rows = readSheetObjectsEnsured_(SHEETS.TICKET_WORKLOG);
  const filtered = ticketId ? rows.filter(function (r) { return String(r.TicketID) === String(ticketId); }) : rows;
  return filtered.sort(function (a, b) {
    const da = a.Timestamp ? new Date(a.Timestamp).getTime() : 0;
    const db = b.Timestamp ? new Date(b.Timestamp).getTime() : 0;
    return da - db;
  });
}

function addTicketWorklog_(ticket, actor, action, opts) {
  opts = opts || {};
  appendRowEnsured_(SHEETS.TICKET_WORKLOG, {
    WorklogID: generateId('WL'),
    TicketID: (ticket && ticket.TicketID) || ticket,
    Action: sanitizeText(action, 80),
    Detail: sanitizeText(opts.detail, 2000),
    StatusFrom: opts.statusFrom || '',
    StatusTo: opts.statusTo || '',
    MinutesSpent: (opts.minutes === '' || opts.minutes === undefined || opts.minutes === null) ? '' : opts.minutes,
    AttachmentURL: opts.attachment || '',
    IsPublic: opts.isPublic ? 'Yes' : 'No',
    ActorEmail: (actor && actor.email) || actor || '',
    ActorName: (actor && actor.name) || '',
    ActorIdentityType: (actor && actor.identityType) || ((actor && actor.lineUserId) ? 'LINE' : 'EMAIL'),
    ActorLineUserID: (actor && actor.lineUserId) || ''
  }, (actor && actor.email) || 'system');
}

function ticketForUpdate_(ticketId) {
  const t = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
  if (!t) throw new Error('ไม่พบ Ticket ' + ticketId);
  if (isTicketTerminal_(t.Status)) throw new Error('Ticket นี้จบงานแล้ว (' + t.Status + ')');
  return t;
}

function notifyRequesterStatus_(t, newStatus, detail) {
  if (!t || !newStatus || String(newStatus) === String(t.Status)) return false;
  const oldStatus = sanitizeText(t.Status, 80) || '-';
  const safeDetail = sanitizeText(detail, 800);
  const statusUrl = getTicketStatusUrl_();
  const detailHtml = safeDetail ? '<p><b>รายละเอียด:</b> ' + escapeHtml(safeDetail) + '</p>' : '';
  const detailText = safeDetail ? '\nรายละเอียด: ' + safeDetail : '';
  const linkHtml = statusUrl
    ? '<p><a href="' + escapeHtml(statusUrl) + '">เปิดหน้าสถานะของฉัน</a></p>'
    : '';
  const linkText = statusUrl ? '\nดูสถานะล่าสุด: ' + statusUrl : '';
  return notifyTicketRequester_(t, 'Ticket ' + t.TicketID + ' อัปเดตสถานะ: ' + newStatus,
    '<p>Ticket ' + escapeHtml(t.TicketID) + ': ' + escapeHtml(t.Title) + '</p>' +
    '<p>สถานะ: <b>' + escapeHtml(oldStatus) + '</b> → <b>' + escapeHtml(newStatus) + '</b></p>' +
    detailHtml + linkHtml,
    '🔔 อัปเดตสถานะ Ticket\nเลขที่: ' + t.TicketID +
    '\nเรื่อง: ' + t.Title +
    '\nสถานะ: ' + oldStatus + ' → ' + newStatus +
    detailText + linkText);
}

/** แจ้งเจ้าของ Ticket โดยไม่ตกกลับไปยัง LINE_DEFAULT_TO กลาง */
function notifyTicketRequester_(t, subject, htmlBody, plainText) {
  if (!t) return false;
  const lineUserId = sanitizeText(t.RequesterLineUserID, 200);
  if (/^U[0-9a-f]{32}$/i.test(lineUserId) && isLineEnabled()) {
    return sendLineNotify_(plainText || subject, lineUserId, 'ticket', t.TicketID);
  }
  // ผู้แจ้งที่ไม่ได้ผูก LINE ยังคงติดตามได้ด้วย Ticket ID + secret เท่านั้น
  return false;
}

// ===================================================================
// หมวดหมู่ / ตัวช่วย
// ===================================================================
function getActiveTicketCategories_() {
  return readSheetObjectsEnsured_(SHEETS.TICKET_CATEGORY)
    .filter(function (r) { return !r.Status || String(r.Status).toLowerCase() === 'active'; })
    .map(function (r) {
      // แปลงค่าเป็น primitive ล้วน เพื่อกัน Date/undefined จากชีตทำให้
      // google.script.run serialize ไม่สำเร็จ แล้วส่ง null กลับหน้าเว็บ
      return {
        id: String(r.CategoryID == null ? '' : r.CategoryID),
        name: String(r.CategoryName == null ? '' : r.CategoryName),
        priority: String(r.DefaultPriority == null ? '' : r.DefaultPriority),
        responseSlaHours: numOrNull_(r.ResponseSLAHours),
        resolutionSlaHours: numOrNull_(r.ResolutionSLAHours || r.SLAHours),
        slaHours: numOrNull_(r.SLAHours),
        isSecurityDefault: r.IsSecurityDefault === true ||
          String(r.IsSecurityDefault).trim().toLowerCase() === 'true',
        notes: String(r.Notes == null ? '' : r.Notes)
      };
    });
}

function getTicketCategoryByName_(name) {
  const n = String(name || '').trim();
  const rows = readSheetObjectsEnsured_(SHEETS.TICKET_CATEGORY);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].CategoryName) === n &&
      (!rows[i].Status || String(rows[i].Status).toLowerCase() === 'active')) return rows[i];
  }
  return null;
}

/** ตัวเลือก Asset สำหรับผูกกับ Ticket (ใช้ getAssetOptions_ ถ้ามี) */
function getTicketAssetOptions_() {
  try { return getAssetOptions_(); } catch (e) { return []; }
}

/** ตัวเลือก Outsource จากทะเบียนผู้ให้บริการที่เปิดใช้งาน */
function getTicketOutsourceOptions_() {
  try {
    return readSheetObjects_(SHEETS.VENDOR)
      .filter(function (r) {
        return !r.Status || String(r.Status).toLowerCase() === 'active';
      })
      .map(function (r) {
        const service = sanitizeText(r.ServiceType || r.ServiceScope, 120);
        return {
          value: r.VendorID,
          label: r.VendorName + (service ? ' · ' + service : ''),
          name: r.VendorName
        };
      });
  } catch (e) {
    return [];
  }
}

function appendTicketNote_(oldNotes, actor, note) {
  const clean = sanitizeText(note, 1000);
  if (!clean) return oldNotes || '';
  const line = '[' + fmtDateTime(new Date()) + ' ' + actor + '] ' + clean;
  return oldNotes ? String(oldNotes) + ' | ' + line : line;
}

function ticketHoursUntil_(target) {
  return businessHoursUntil_(target);
}

function guessIncidentCategory_(ticketCategory) {
  const s = String(ticketCategory || '');
  if (s.indexOf('บัญชี') > -1 || s.indexOf('สิทธิ์') > -1) return 'การเข้าถึงโดยไม่ได้รับอนุญาต';
  if (s.indexOf('ข้อมูล') > -1) return 'ข้อมูลรั่วไหล';
  if (s.indexOf('ภัย') > -1 || s.indexOf('มัลแวร์') > -1) return 'มัลแวร์/ไวรัส';
  return 'อื่นๆ';
}

function getTicketWebAppUrl_() {
  try {
    const base = ScriptApp.getService().getUrl() || '';
    if (!base) return '';
    return base + (base.indexOf('?') > -1 ? '&' : '?') + 'page=admin';
  } catch (e) { return ''; }
}

/** URL production สำหรับให้ผู้แจ้งเปิดหน้า "สถานะของฉัน" จากข้อความ LINE */
function getTicketStatusUrl_() {
  try {
    const callback = String(getConfig_('LINE_LOGIN_CALLBACK_URL', '') || '').trim();
    let base = callback ? callback.split('?')[0] : '';
    if (!base) {
      base = String(ScriptApp.getService().getUrl() || '').replace(/\/dev(?:\?.*)?$/i, '/exec');
    }
    if (!base) return '';
    return base + (base.indexOf('?') > -1 ? '&' : '?') + 'mode=status';
  } catch (e) {
    return '';
  }
}
