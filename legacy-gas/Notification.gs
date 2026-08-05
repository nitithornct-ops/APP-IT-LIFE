/**
 * Notification.gs
 * เครื่องมือแจ้งเตือนกลาง: LINE Messaging API เป็นช่องทางเดียวสำหรับงานระบบ
 * Email ไม่ใช้ในงานแจ้งเตือน; OTP สาธารณะปิดไว้โดยค่าเริ่มต้น
 * พร้อมตัวตรวจวันครบกำหนดรายวัน (dailyNotificationCheck_ เรียกโดย Time-driven Trigger)
 *
 * หมายเหตุ: LINE Notify ถูกปิดบริการแล้ว (มี.ค. 2568) จึงใช้ LINE Messaging API แทน
 * ตั้งค่า LINE token/target ใน Script Properties; ค่า lead days อยู่ใน Settings:
 *   NOTIFY_LINE_ENABLED = true/false
 *   LINE_CHANNEL_ACCESS_TOKEN = <token จาก LINE Developers>
 *   LINE_DEFAULT_TO = <userId หรือ groupId ปลายทางเริ่มต้น>
 *   NOTIFY_LEAD_DAYS = จำนวนวันแจ้งเตือนล่วงหน้า (ค่าเริ่มต้น 30)
 *
 * รอบที่ 1: วางโครงช่องทางส่ง + ตัวตรวจวันหมดอายุ License/สัญญา/ทบทวนสิทธิ์เบื้องต้น
 * (รายละเอียดต่อโมดูลจะเพิ่มในรอบที่ 3)
 */

// ช่องทางแจ้งเตือนงานระบบใช้ LINE เท่านั้น
// Email เหลือเป็น legacy path ที่ปิดไว้; admin MFA อยู่ใน Auth.gs แยกจาก notification
function isEmailEnabled() { return false; }
function isLineEnabled() { return getConfig_('NOTIFY_LINE_ENABLED', 'true') === 'true'; }
function isTeamsEnabled() { return false; }

/** Legacy Email path: ปิดใช้งานเสมอในโหมด LINE-only */
function sendEmailNotify_(to, subject, htmlBody, refModule, refId) {
  if (!isEmailEnabled()) return false;
  let result = 'success', err = '';
  try {
    MailApp.sendEmail({
      to: to,
      subject: '[ISMS] ' + subject,
      htmlBody: htmlBody,
      name: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต') + ' - ระบบ ISMS'
    });
  } catch (e) {
    result = 'fail'; err = e.message;
  }
  logNotification_('Email', to, subject, refModule, refId, result, err);
  return result === 'success';
}

/** ส่งข้อความผ่าน LINE Messaging API (push) */
function sendLineNotify_(message, toOverride, refModule, refId, skipQueue) {
  if (!isLineEnabled()) return false;
  const result = sendLinePushDetailed_(message, toOverride);
  logNotification_('LINE', result.to, String(message || '').substring(0, 60), refModule, refId,
    result.success ? 'success' : 'fail', result.error || '');
  if (!result.success && !skipQueue) {
    enqueueLineNotification_(message, result.to || toOverride || '', refModule, refId,
      String(message || '').substring(0, 120));
  }
  return result.success;
}

/** ส่ง LINE แบบคืนรายละเอียด เพื่อให้หน้า Settings แสดงสาเหตุทดสอบไม่ผ่านได้ตรงจุด */
function sendLinePushDetailed_(message, toOverride) {
  const token = getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '');
  const to = sanitizeText(toOverride || getConfig_('LINE_DEFAULT_TO', ''), 200);
  const text = String(message || '').substring(0, 4900);
  if (!token || !to) {
    return { success: false, to: to, code: 0, error: 'ยังไม่ได้ตั้งค่า Channel access token หรือ LINE target ID' };
  }
  try {
    const resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code === 200) return { success: true, to: to, code: code, error: '' };
    return {
      success: false,
      to: to,
      code: code,
      error: 'LINE API HTTP ' + code + ': ' + String(resp.getContentText() || '').substring(0, 500)
    };
  } catch (e) {
    return { success: false, to: to, code: 0, error: e.message };
  }
}

/** ส่งข้อความเข้า Microsoft Teams ผ่าน Incoming Webhook (MessageCard) */
function sendTeamsNotify_(title, text, refModule, refId) {
  if (!isTeamsEnabled()) return false;
  const url = getConfig_('TEAMS_WEBHOOK_URL', '');
  let result = 'success', err = '';
  try {
    const card = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '1e40af',
      summary: title,
      title: title,
      text: String(text || '').replace(/\n/g, '  \n')
    };
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(card),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) { result = 'fail'; err = resp.getContentText(); }
  } catch (e) {
    result = 'fail'; err = e.message;
  }
  logNotification_('Teams', 'webhook', String(title).substring(0, 60), refModule, refId, result, err);
  return result === 'success';
}

/** แจ้งเตือนเข้า Teams (ถ้าเปิดใช้งาน) — ใช้สำหรับช่องทางทีมงาน */
function notifyTeams_(title, text, refModule, refId) {
  return false;
}

function getLineTargetsForEmails_(toEmail) {
  const targets = {};
  const emails = String(toEmail || '').split(/[;,]/)
    .map(function (v) { return String(v || '').toLowerCase().trim(); })
    .filter(function (v) { return isValidEmail(v); });
  if (!emails.length) return [];
  try {
    const users = readSheetObjectsEnsured_(SHEETS.USERS, true);
    const lineUsers = readSheetObjectsEnsured_(SHEETS.LINE_USERS, true);
    emails.forEach(function (email) {
      const user = users.filter(function (u) {
        return String(u.Email || '').toLowerCase() === email;
      })[0];
      if (!user) return;
      lineUsers.forEach(function (line) {
        if (String(line.LinkStatus) !== 'Active') return;
        if (user.EmployeeCode &&
          String(line.EmployeeCode || '').toLowerCase() === String(user.EmployeeCode).toLowerCase() &&
          /^U[0-9a-f]{32}$/i.test(String(line.LineUserID || ''))) {
          targets[String(line.LineUserID)] = true;
        }
      });
    });
  } catch (e) {}
  return Object.keys(targets);
}

/** ส่งแจ้งเตือนงานระบบผ่าน LINE เท่านั้น; ถ้าระบุอีเมลจะพยายาม map ไป LINE รายบุคคลก่อน */
function notify_(toEmail, subject, htmlBody, plainForLine, refModule, refId) {
  if (!isLineEnabled()) return false;
  const message = plainForLine || subject;
  const targets = getLineTargetsForEmails_(toEmail);
  if (!targets.length) return sendLineNotify_(message, null, refModule, refId);
  let sent = false;
  targets.forEach(function (target) {
    sent = sendLineNotify_(message, target, refModule, refId) || sent;
  });
  return sent;
}

function logNotification_(channel, recipient, subject, refModule, refId, result, errorMsg) {
  try {
    appendRow_(SHEETS.NOTIFY_LOG, {
      NotifyID: generateId('NTF'),
      SentAt: new Date(),
      Channel: channel,
      Recipient: recipient,
      Subject: subject,
      RefModule: refModule || '',
      RefID: refId || '',
      Result: result,
      ErrorMsg: errorMsg || ''
    }, 'system');
  } catch (e) {
    console.error('logNotification_ error: ' + e.message);
  }
}

function notificationDedupKey_(recipient, message, refModule, refId) {
  const payload = (String(refModule) === 'tester' && String(refId) === 'LIVE_HEALTH')
    ? [recipient || '', refModule, refId].join('|')
    : [recipient || '', message || '', refModule || '', refId || ''].join('|');
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    payload,
    Utilities.Charset.UTF_8)).substring(0, 40);
}

function enqueueLineNotification_(message, recipient, refModule, refId, subject) {
  try {
    ensureSheetBySchema_(SHEETS.NOTIFY_QUEUE);
    const target = sanitizeText(recipient || getConfig_('LINE_DEFAULT_TO', ''), 200);
    const text = String(message || '').substring(0, 4900);
    if (!text) return '';
    const key = notificationDedupKey_(target, text, refModule, refId);
    const duplicate = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true).some(function (r) {
      return String(r.DedupKey) === key && ['PENDING', 'RETRY', 'DEAD'].indexOf(String(r.Status)) > -1;
    });
    if (duplicate) return '';
    const id = generateId('NQ');
    appendRowEnsured_(SHEETS.NOTIFY_QUEUE, {
      QueueID: id,
      CreatedAt: new Date(),
      Channel: 'LINE',
      Recipient: target,
      Subject: sanitizeText(subject, 200),
      Message: text,
      RefModule: refModule || '',
      RefID: refId || '',
      DedupKey: key,
      Status: 'PENDING',
      AttemptCount: 0,
      NextAttemptAt: new Date()
    }, 'system');
    return id;
  } catch (e) {
    console.error('enqueueLineNotification_: ' + e.message);
    return '';
  }
}

function processNotificationQueue_(limit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { processed: 0, sent: 0, retry: 0, dead: 0, locked: true };
  const cache = CacheService.getScriptCache();
  try {
    if (cache.get('notification_queue_processing')) {
      return { processed: 0, sent: 0, retry: 0, dead: 0, locked: true };
    }
    cache.put('notification_queue_processing', '1', 300);
  } finally {
    lock.releaseLock();
  }
  try {
    const now = new Date();
    const max = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const maxAttempts = Math.max(1, Math.min(
      parseInt(getConfig_('LINE_QUEUE_MAX_ATTEMPTS', '5'), 10) || 5, 10));
    const rows = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true)
      .filter(function (r) {
        if (['PENDING', 'RETRY'].indexOf(String(r.Status)) === -1) return false;
        const due = r.NextAttemptAt ? new Date(r.NextAttemptAt) : now;
        return isNaN(due) || due <= now;
      })
      .sort(function (a, b) {
        return new Date(a.NextAttemptAt || a.CreatedAt || 0) -
          new Date(b.NextAttemptAt || b.CreatedAt || 0);
      }).slice(0, max);
    const summary = { processed: 0, sent: 0, retry: 0, dead: 0, locked: false };
    rows.forEach(function (row) {
      const attempts = (parseInt(row.AttemptCount, 10) || 0) + 1;
      const result = sendLinePushDetailed_(row.Message, row.Recipient);
      summary.processed++;
      logNotification_('LINE-RETRY', result.to, row.Subject || String(row.Message).substring(0, 60),
        row.RefModule, row.RefID, result.success ? 'success' : 'fail', result.error || '');
      if (result.success) {
        summary.sent++;
        updateRow_(SHEETS.NOTIFY_QUEUE, row._row, {
          Status: 'SENT',
          AttemptCount: attempts,
          LastAttemptAt: now,
          LastError: '',
          SentAt: now
        }, 'system');
        return;
      }
      const dead = attempts >= maxAttempts;
      const waitMinutes = Math.min(Math.pow(2, attempts - 1) * 5, 360);
      if (dead) summary.dead++; else summary.retry++;
      updateRow_(SHEETS.NOTIFY_QUEUE, row._row, {
        Status: dead ? 'DEAD' : 'RETRY',
        AttemptCount: attempts,
        LastAttemptAt: now,
        LastError: sanitizeText(result.error, 1000),
        NextAttemptAt: dead ? '' : new Date(now.getTime() + waitMinutes * 60000)
      }, 'system');
    });
    return summary;
  } finally {
    cache.remove('notification_queue_processing');
  }
}

function processNotificationQueueNow() {
  try {
    requireModule('notification', true);
    let requeued = 0;
    readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true).forEach(function (row) {
      if (String(row.Status) !== 'DEAD') return;
      updateRow_(SHEETS.NOTIFY_QUEUE, row._row, {
        Status: 'RETRY',
        AttemptCount: 0,
        NextAttemptAt: new Date(),
        LastError: sanitizeText((row.LastError ? row.LastError + ' | ' : '') + 'manual requeue', 1000)
      }, 'system');
      requeued++;
    });
    const summary = processNotificationQueue_(50);
    summary.requeued = requeued;
    return ok(summary);
  } catch (e) { return fail(e.message); }
}

/**
 * ตัวตรวจวันครบกำหนดรายวัน — เรียกโดย Time-driven Trigger (ตั้งใน Setup.gs)
 * รอบที่ 1: ตรวจ License ทรัพย์สิน, สัญญาผู้ให้บริการ, และการทบทวนสิทธิ์ที่ใกล้ครบกำหนด
 */
function dailyNotificationCheck() {
  assertEditorOwner_();
  return dailyNotificationCheck_();
}

function dailyNotificationCheck_() {
  const lead = parseInt(getConfig_('NOTIFY_LEAD_DAYS', '30'), 10);
  const adminEmail = getITAdminEmails_().join(',');
  const alerts = [];
  let taskAutomationCount = 0;
  try { taskAutomationCount = runTaskAutomation_(); } catch (e) { console.error('runTaskAutomation_: ' + e.message); }

  // ปรับสถานะ License ที่หมดอายุแล้วเป็น Expired ก่อนตรวจ
  try { checkExpireLicenses_(); } catch (e) { console.error('checkExpireLicenses_: ' + e.message); }

  // Software License ใกล้/หมดอายุ
  safeEach_(SHEETS.SOFTWARE_LICENSE, function (r) {
    if (String(r.Status) === 'Inactive') return;
    const d = daysUntil(r.ExpireDate);
    if (d !== null && d <= lead) {
      alerts.push('• License "' + r.SoftwareName + '" ' +
        (d < 0 ? 'หมดอายุแล้ว ' + Math.abs(d) + ' วัน' : 'จะหมดอายุใน ' + d + ' วัน'));
    }
  });

  // Ticket ที่ใกล้/เลย SLA (ข้ามงานที่จบแล้ว: เสร็จสิ้น/ปิดงาน/ยกเลิก/ยกระดับ)
  safeEach_(SHEETS.TICKET, function (r) {
    if (isTicketTerminal_(r.Status)) return;
    if (r.SLAPausedAt) return; // หยุดนาฬิกา SLA อยู่ (รอผู้ใช้งาน/รออะไหล่) — ไม่เตือน
    if (!r.AcknowledgedAt && r.ResponseDueAt) {
      const responseHours = businessHoursUntil_(r.ResponseDueAt);
      if (responseHours !== null && responseHours <= 4) {
        alerts.push('• Ticket "' + r.Title + '" ยังไม่รับเรื่อง ' +
          (responseHours < 0
            ? 'เลย Response SLA ' + Math.abs(responseHours) + ' ชม.'
            : 'เหลือ Response SLA ' + responseHours + ' ชม.'));
      }
    }
    if (!r.DueAt) return;
    const due = (r.DueAt instanceof Date) ? r.DueAt : new Date(r.DueAt);
    if (isNaN(due)) return;
    const hrs = businessHoursUntil_(due);
    if (hrs <= 24) {
      alerts.push('• Ticket "' + r.Title + '" ' +
        (hrs < 0 ? 'เลย SLA ' + Math.abs(hrs) + ' ชม.' : 'เหลือ SLA ' + hrs + ' ชม.'));
    }
  });

  // Service Request ที่ใกล้/เลย SLA — ส่งเฉพาะรหัสอ้างอิงให้กลุ่ม IT โดยไม่นำ form data/PII ออกไปแจ้งเตือน
  safeEach_(SHEETS.SERVICE_REQUEST, function (r) {
    if (isServiceRequestTerminalForNotification_(r.Status) || !r.DueAt) return;
    const hrs = businessHoursUntil_(r.DueAt);
    if (hrs === null || hrs > 24) return;
    const ref = sanitizeText(r.RequestID || '-', 80);
    const service = sanitizeText(r.ServiceCode || r.CatalogID || '-', 80);
    alerts.push('• Service Request ' + ref + ' / ' + service + ' ' +
      (hrs < 0 ? 'เลย SLA ' + Math.abs(hrs) + ' ชม.' : 'เหลือ SLA ' + hrs + ' ชม.'));
  });

  // License ทรัพย์สินใกล้หมดอายุ
  safeEach_(SHEETS.ASSET, function (r) {
    if (isAssetRetired_(r.Status)) return;
    const d = daysUntil(r.LicenseExpiry);
    if (d !== null && d <= lead && d >= 0) {
      alerts.push('• License "' + r.AssetName + '" จะหมดอายุใน ' + d + ' วัน (' + fmtDate(r.LicenseExpiry) + ')');
    }
    // ประกันทรัพย์สินใกล้หมด (ตรวจก่อนหมดประกัน)
    const w = daysUntil(r.WarrantyExpire);
    if (w !== null && w <= lead && w >= 0) {
      alerts.push('• ประกัน "' + (r.AssetCode || r.AssetName) + '" จะหมดใน ' + w + ' วัน (' + fmtDate(r.WarrantyExpire) + ')');
    }
  });

  // ทรัพย์สินที่ยืมไป — ใกล้/เกินกำหนดคืน
  safeEach_(SHEETS.ASSET, function (r) {
    if (String(r.Status) !== ASSET_STATUS.IN_USE || !r.LoanDueDate) return;
    const d = daysUntil(r.LoanDueDate);
    if (d === null) return;
    const who = r.OwnerName || r.Owner || '-';
    if (d < 0) alerts.push('• ' + (r.AssetCode || r.AssetName) + ' ค้างคืน ' + Math.abs(d) + ' วัน (ผู้ยืม: ' + who + ')');
    else if (d <= lead) alerts.push('• ' + (r.AssetCode || r.AssetName) + ' ครบกำหนดคืนใน ' + d + ' วัน (ผู้ยืม: ' + who + ')');
  });

  // วัสดุ/อะไหล่ Inventory ที่ต่ำกว่าหรือเท่าขั้นต่ำ
  safeEach_(SHEETS.INVENTORY, function (r) {
    if (String(r.Status).toLowerCase() === 'inactive') return;
    const stock = Number(r.StockQty); const min = Number(r.MinQty);
    if (!isNaN(stock) && !isNaN(min) && min > 0 && stock <= min) {
      alerts.push('• อะไหล่ "' + r.ItemName + '" คงเหลือ ' + stock + ' ' + (r.Unit || '') + ' (ขั้นต่ำ ' + min + ')');
    }
  });

  // แผน PM ที่ใกล้/เลยกำหนด แต่ยังไม่ดำเนินการ
  safeEach_(SHEETS.MAINTENANCE, function (r) {
    const st = String(r.Status);
    if (st === 'ดำเนินการแล้ว' || st === 'ยกเลิก') return;
    const d = daysUntil(r.PlanDate);
    if (d !== null && d <= Math.min(lead, 7)) {
      alerts.push('• PM "' + (r.AssetName || r.AssetID) + '" ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // สัญญาผู้ให้บริการใกล้หมด
  safeEach_(SHEETS.VENDOR, function (r) {
    const d = daysUntil(r.ContractExpiry);
    if (d !== null && d <= lead && d >= 0) {
      alerts.push('• สัญญาผู้ให้บริการ "' + r.VendorName + '" จะหมดอายุใน ' + d + ' วัน (' + fmtDate(r.ContractExpiry) + ')');
    }
  });

  // การทบทวนสิทธิ์ใกล้ครบกำหนด
  safeEach_(SHEETS.ACCESS_REGISTRY, function (r) {
    const d = daysUntil(r.NextReviewDue);
    if (d !== null && d <= lead && String(r.Status).toLowerCase() === 'active') {
      alerts.push('• ทบทวนสิทธิ์ "' + r.UserName + ' / ' + r.SystemName + '" ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // รอบสำรองข้อมูลถัดไปใกล้ครบกำหนด
  safeEach_(SHEETS.BACKUP, function (r) {
    const d = daysUntil(r.NextBackupDue);
    if (d !== null && d <= lead) {
      alerts.push('• สำรองข้อมูล "' + r.SystemName + '" ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // กำหนดทดสอบกู้คืนข้อมูลครั้งถัดไป
  safeEach_(SHEETS.RECOVERY, function (r) {
    const d = daysUntil(r.NextTestDue);
    if (d !== null && d <= lead) {
      alerts.push('• ทดสอบกู้คืน "' + r.SystemName + '" ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // รอบทบทวน Log ใกล้ครบกำหนด
  safeEach_(SHEETS.LOG_REGISTER, function (r) {
    if (String(r.Status) && String(r.Status).toLowerCase().indexOf('ยกเลิก') > -1) return;
    const d = daysUntil(r.NextReviewDue);
    if (d !== null && d <= Math.min(lead, 7)) {
      alerts.push('• ตรวจสอบ Log "' + r.SystemName + '" (' + r.ReviewFrequency + ') ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // ทบทวนแผนฉุกเฉิน (BCP) ใกล้ครบกำหนด
  safeEach_(SHEETS.BCP, function (r) {
    const d = daysUntil(r.NextReviewDue);
    if (d !== null && d <= lead) {
      alerts.push('• ทบทวนแผนฉุกเฉิน "' + r.PlanName + '" ' +
        (d < 0 ? 'เลยกำหนด ' + Math.abs(d) + ' วัน' : 'ภายใน ' + d + ' วัน'));
    }
  });

  // สัญญา Cloud ใกล้หมดอายุ
  safeEach_(SHEETS.CLOUD, function (r) {
    const d = daysUntil(r.ContractExpiry);
    if (d !== null && d <= lead && d >= 0 && String(r.Status) !== 'ยกเลิกใช้งาน') {
      alerts.push('• สัญญา Cloud "' + r.ServiceName + '" จะหมดอายุใน ' + d + ' วัน');
    }
  });

  // กำหนดทำลายข้อมูลใกล้ถึง
  safeEach_(SHEETS.DATA_CLASS, function (r) {
    if (String(r.Status) === 'ทำลายแล้ว') return;
    const d = daysUntil(r.DestructionDue);
    if (d !== null && d <= lead && d >= 0) {
      alerts.push('• ครบกำหนดทำลายข้อมูล "' + r.DataName + '" (ชั้น ' + r.Classification + ') ใน ' + d + ' วัน');
    }
  });

  // แผนอบรมที่ใกล้ถึงกำหนดแต่ยังไม่เสร็จสิ้น
  safeEach_(SHEETS.TRAIN_PLAN, function (r) {
    if (String(r.Status).indexOf('เสร็จ') > -1) return;
    const d = daysUntil(r.PlannedDate);
    if (d !== null && d <= lead && d >= 0) {
      alerts.push('• แผนอบรม "' + r.Topic + '" (' + r.Quarter + '/' + r.Year + ') กำหนดใน ' + d + ' วัน');
    }
  });

  // เหตุการณ์ข้อมูลส่วนบุคคลที่ยังไม่ส่ง DPO คัดกรองตามกรอบเวลาภายใน
  const pdpaAlerts = [];
  safeEach_(SHEETS.INCIDENT, function (r) {
    if (String(r.ContainsPersonalData).toLowerCase() !== 'yes') return;
    if (String(r.DPONotified).toLowerCase() === 'yes') return;
    if (String(r.Status) === 'ปิดเคส') return;
    if (!r.DPONotifyDeadline) return;
    const t = (r.DPONotifyDeadline instanceof Date) ? r.DPONotifyDeadline : new Date(r.DPONotifyDeadline);
    if (isNaN(t)) return;
    const hrs = Math.round((t - new Date()) / 3600000);
    if (hrs <= incidentDpoEscalationHours_()) {
      pdpaAlerts.push('• [DPO] เหตุการณ์ ' + r.IncidentID + ': ' + r.Title +
        (hrs < 0 ? ' เลยกำหนด ' + Math.abs(hrs) + ' ชม.' : ' เหลือ ' + hrs + ' ชม.'));
    }
  });

  // ส่งแจ้งเตือนกรอบคัดกรองภายในถึง DPO + IT (แยกต่างหากเพราะเร่งด่วน)
  if (pdpaAlerts.length) {
    const dpoEmails = readSheetObjects_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.DPO && String(u.Status).toLowerCase() === 'active'; })
      .map(function (u) { return u.Email; });
    const pdpaTo = [].concat(dpoEmails, getITAdminEmails_()).join(',');
    notify_(pdpaTo, '[ด่วน][DPO] เหตุการณ์ข้อมูลส่วนบุคคลรอคัดกรอง ' + pdpaAlerts.length + ' รายการ',
      '<p style="color:#dc3545"><b>เหตุการณ์ข้อมูลส่วนบุคคลที่รอ DPO คัดกรองภายใน:</b></p><ul>' +
      pdpaAlerts.map(function (a) { return '<li>' + escapeHtml(a.replace('• ', '')) + '</li>'; }).join('') + '</ul>',
      'แจ้งเตือน DPO คัดกรองเหตุ:\n' + pdpaAlerts.join('\n'), 'incident', '');
  }

  if (alerts.length) {
    const body = '<p>เรียน ส่วนงานเทคโนโลยีและสารสนเทศ</p>' +
      '<p>รายการที่ใกล้/เลยกำหนด ณ วันที่ ' + fmtDate(new Date()) + ':</p>' +
      '<ul>' + alerts.map(function (a) { return '<li>' + escapeHtml(a.replace('• ', '')) + '</li>'; }).join('') + '</ul>' +
      '<p>โปรดเข้าระบบเพื่อดำเนินการ</p>';
    notify_(adminEmail, 'แจ้งเตือนรายการใกล้ครบกำหนด (' + alerts.length + ' รายการ)',
      body, 'แจ้งเตือน ISMS: ' + alerts.length + ' รายการใกล้ครบกำหนด\n' + alerts.join('\n'),
      'notification', '');
  }
  return alerts.length + pdpaAlerts.length + taskAutomationCount;
}

function getITAdminEmails_() {
  try {
    return readSheetObjects_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.IT_ADMIN && String(u.Status).toLowerCase() === 'active'; })
      .map(function (u) { return u.Email; });
  } catch (e) { return []; }
}

/** อีเมลผู้บริหาร (Executive) ที่ Active — สำหรับรายงานสรุปรายเดือน */
function getExecutiveEmails_() {
  try {
    return readSheetObjects_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.EXECUTIVE && String(u.Status).toLowerCase() === 'active'; })
      .map(function (u) { return u.Email; });
  } catch (e) { return []; }
}

// ===================================================================
// รายงานสรุปสุขภาพมาตรการควบคุมรายเดือน → LINE ผู้บริหาร/กลุ่มกลางอัตโนมัติ
// เรียกโดย Time-driven Trigger (ตั้งใน Setup.gs > ensureMonthlyReportTrigger)
// ไม่ต้องมี session — ใช้ข้อมูลจาก computeCompliance_() โดยตรง
// ===================================================================
function monthlyExecutiveReport_() {
  let rows = [];
  try { rows = computeCompliance_(); } catch (e) { console.error('computeCompliance_: ' + e.message); }

  let sumTotal = 0, sumOk = 0;
  rows.forEach(function (r) { if (r.total > 0) { sumTotal += r.total; sumOk += r.compliant; } });
  const hasComplianceData = sumTotal > 0;
  const overall = hasComplianceData ? Math.round((sumOk / sumTotal) * 100) : 0;

  // ตัวเลขเร่งด่วนสำหรับผู้บริหาร (สแกนตรง ไม่ผ่าน auth)
  let openIncidents = 0, openTickets = 0, ticketOverdue = 0, pdpaPending = 0;
  let openServiceRequests = 0, serviceRequestOverdue = 0, pendingServiceApprovals = 0;
  safeEach_(SHEETS.INCIDENT, function (r) {
    const st = String(r.Status).toLowerCase();
    if (st !== 'closed' && st.indexOf('ปิด') === -1 && st !== '') openIncidents++;
    if (String(r.ContainsPersonalData).toLowerCase() === 'yes' && String(r.DPONotified).toLowerCase() !== 'yes' && String(r.Status) !== 'ปิดเคส') {
      const dl = daysUntil(r.DPONotifyDeadline);
      if (dl !== null && dl <= 1) pdpaPending++;
    }
  });
  safeEach_(SHEETS.TICKET, function (r) {
    if (isTicketTerminal_(r.Status)) return;
    openTickets++;
    if (r.DueAt && !r.SLAPausedAt) { const due = (r.DueAt instanceof Date) ? r.DueAt : new Date(r.DueAt); if (!isNaN(due) && due < new Date()) ticketOverdue++; }
  });
  safeEach_(SHEETS.SERVICE_REQUEST, function (r) {
    if (isServiceRequestTerminalForNotification_(r.Status)) return;
    openServiceRequests++;
    if (String(r.ApprovalStatus) === 'รออนุมัติ') pendingServiceApprovals++;
    if (r.DueAt) {
      const due = r.DueAt instanceof Date ? r.DueAt : new Date(r.DueAt);
      if (!isNaN(due) && due < new Date()) serviceRequestOverdue++;
    }
  });

  const tone = { green: '#16a34a', yellow: '#d97706', red: '#dc2626', gray: '#94a3b8' };
  const toneLabel = { green: 'ดี', yellow: 'เฝ้าระวัง', red: 'ต้องปรับปรุง', gray: 'ยังไม่มีข้อมูล' };
  const orgName = getConfig_('ORG_NAME', 'กองทุนประกันชีวิต');
  const monthTh = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'MMMM yyyy');

  const rowsHtml = rows.map(function (r) {
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' + escapeHtml(r.label) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">' + r.compliant + '/' + r.total + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:700;color:' + (tone[r.status] || '#333') + '">' + (r.hasData ? r.pct + '%' : 'N/A') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">' +
      '<span style="background:' + (tone[r.status] || '#999') + ';color:#fff;border-radius:6px;padding:2px 8px;font-size:12px">' + (toneLabel[r.status] || '-') + '</span></td></tr>';
  }).join('');

  const overallColor = !hasComplianceData ? tone.gray : (overall >= 90 ? tone.green : (overall >= 70 ? tone.yellow : tone.red));
  const overallDisplay = hasComplianceData ? overall + '%' : 'N/A';
  const html =
    '<div style="font-family:Arial,Tahoma,sans-serif;max-width:680px">' +
    '<h2 style="color:#15327a;margin:0 0 4px">' + escapeHtml(orgName) + '</h2>' +
    '<p style="color:#555;margin:0 0 16px">รายงานสรุปสถานะความมั่นคงปลอดภัยสารสนเทศ (ISMS) ประจำเดือน ' + monthTh + '</p>' +
    '<div style="background:' + overallColor + ';color:#fff;border-radius:12px;padding:16px 20px;margin-bottom:16px">' +
    '<div style="font-size:13px;opacity:.9">สุขภาพมาตรการควบคุมโดยรวม</div>' +
    '<div style="font-size:34px;font-weight:800;line-height:1">' + overallDisplay + '</div></div>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:8px">' +
    '<tr style="text-align:center;color:#fff;background:#15327a">' +
    '<th style="padding:8px 10px;text-align:left">ด้าน/โมดูล</th><th style="padding:8px 10px">ผ่าน/ทั้งหมด</th><th style="padding:8px 10px">%</th><th style="padding:8px 10px">สถานะ</th></tr>' +
    rowsHtml + '</table>' +
    '<h3 style="color:#15327a;margin:18px 0 6px">ประเด็นที่ต้องติดตาม</h3>' +
    '<ul style="color:#333;line-height:1.7">' +
    '<li>เหตุการณ์ที่ยังเปิดอยู่: <b>' + openIncidents + '</b> รายการ' + (pdpaPending ? ' (รอ DPO คัดกรอง ' + pdpaPending + ')' : '') + '</li>' +
    '<li>Ticket ที่ยังเปิด: <b>' + openTickets + '</b> รายการ' + (ticketOverdue ? ' · เกิน SLA <b style="color:#dc2626">' + ticketOverdue + '</b>' : '') + '</li>' +
    '<li>Service Request ที่ยังเปิด: <b>' + openServiceRequests + '</b> รายการ' +
    (pendingServiceApprovals ? ' · รออนุมัติ <b>' + pendingServiceApprovals + '</b>' : '') +
    (serviceRequestOverdue ? ' · เกิน SLA <b style="color:#dc2626">' + serviceRequestOverdue + '</b>' : '') + '</li>' +
    '</ul>' +
    '<p style="color:#888;font-size:12px;margin-top:18px">รายงานนี้สร้างและส่งโดยระบบ ISMS Governance อัตโนมัติ · ' + fmtDateTime(new Date()) + '</p></div>';

  let to = getExecutiveEmails_();
  if (!to.length) to = getITAdminEmails_(); // สำรอง: ถ้ายังไม่มีผู้บริหารในระบบ
  const toStr = to.join(',');
  const sent = notify_(toStr,
    'รายงานสรุปสถานะ ISMS ประจำเดือน ' + monthTh + ' (ภาพรวม ' + overallDisplay + ')',
    html,
    '📊 รายงาน ISMS ประจำเดือน ' + monthTh +
      '\nภาพรวม: ' + overallDisplay +
      '\nIncident เปิด: ' + openIncidents +
      (pdpaPending ? '\nPDPA เร่งด่วน: ' + pdpaPending : '') +
      '\nTicket เปิด: ' + openTickets +
      (ticketOverdue ? '\nTicket เกิน SLA: ' + ticketOverdue : '') +
      '\nService Request เปิด: ' + openServiceRequests +
      (pendingServiceApprovals ? '\nService Request รออนุมัติ: ' + pendingServiceApprovals : '') +
      (serviceRequestOverdue ? '\nService Request เกิน SLA: ' + serviceRequestOverdue : ''),
    'evidence', '');
  return { overall: overall, sent: !!sent, recipients: to.length || 1 };
}

function isServiceRequestTerminalForNotification_(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ปฏิเสธ', 'completed', 'closed', 'cancelled', 'canceled', 'rejected'].indexOf(normalized) > -1;
}

/** IT/ผู้บริหาร: สั่งส่งรายงานสรุปรายเดือนทันที (ทดสอบ/ส่งนอกรอบ) */
function sendExecutiveReportNow() {
  try {
    requireRole([ROLES.IT_ADMIN, ROLES.EXECUTIVE]);
    const r = monthlyExecutiveReport_();
    if (!r.sent) return fail('ส่งรายงานผ่าน LINE ไม่สำเร็จ กรุณาตรวจ Notification Queue');
    return ok('ส่งรายงานสรุปรายเดือนผ่าน LINE แล้ว (ภาพรวม ' + r.overall + '%)');
  } catch (e) { return fail(e.message); }
}

/** วน Sheet โดยไม่ให้ error รายตัวล้มทั้งงาน */
function safeEach_(sheetName, fn) {
  try { readSheetObjects_(sheetName).forEach(fn); }
  catch (e) { console.error('safeEach_ ' + sheetName + ': ' + e.message); }
}

/** อ่านค่าตั้งค่าการแจ้งเตือน + log ล่าสุด (สำหรับหน้าตั้งค่า) */
function getNotificationSettings() {
  try {
    requireModule('notification', false);
    const logs = readSheetObjects_(SHEETS.NOTIFY_LOG).slice(-30).reverse().map(function (r) {
      return {
        sentAt: fmtDateTime(r.SentAt), channel: r.Channel, recipient: r.Recipient,
        subject: r.Subject, result: r.Result, error: r.ErrorMsg
      };
    });
    const queueRows = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true);
    return ok({
      emailEnabled: false,
      primaryChannel: getConfig_('NOTIFY_PRIMARY_CHANNEL', 'LINE'),
      lineEnabled: getConfig_('NOTIFY_LINE_ENABLED', 'true') === 'true',
      lineConfigured: !!getConfig_('LINE_CHANNEL_ACCESS_TOKEN', ''),
      lineTarget: getConfig_('LINE_DEFAULT_TO', ''),
      lineTargetConfigured: !!getConfig_('LINE_DEFAULT_TO', ''),
      teamsEnabled: false,
      teamsConfigured: false,
      leadDays: getConfig_('NOTIFY_LEAD_DAYS', '30'),
      reviewCycle: getConfig_('REVIEW_CYCLE_DAYS', '180'),
      queuePending: queueRows.filter(function (r) {
        return ['PENDING', 'RETRY'].indexOf(String(r.Status)) > -1;
      }).length,
      queueDead: queueRows.filter(function (r) { return String(r.Status) === 'DEAD'; }).length,
      logs: logs
    });
  } catch (e) { return fail(e.message); }
}

/**
 * บันทึกค่าตั้งค่าการแจ้งเตือน
 * Token รับจากหน้า Admin แล้วเก็บลง Script Properties เท่านั้น และไม่ส่งค่ากลับไป client
 */
function saveNotificationSettings(settings) {
  try {
    const user = requireModule('notification', true);
    settings = settings || {};
    const lineTarget = sanitizeText(settings.lineTarget, 200);
    if (lineTarget && /\s/.test(lineTarget)) throw new Error('LINE target ID ต้องไม่มีช่องว่าง');
    const token = String(settings.lineToken || '').trim();
    if (token && token.length < 20) throw new Error('Channel access token สั้นผิดปกติ กรุณาตรวจสอบค่าจาก LINE Developers');
    if (token && /\s/.test(token)) throw new Error('Channel access token ต้องไม่มีช่องว่าง');
    const lead = parseInt(settings.leadDays, 10);
    if (isNaN(lead) || lead < 1 || lead > 365) throw new Error('จำนวนวันแจ้งเตือนล่วงหน้าต้องอยู่ระหว่าง 1-365');
    const cyc = parseInt(settings.reviewCycle, 10);
    if (isNaN(cyc) || cyc < 1 || cyc > 1095) throw new Error('รอบทบทวนสิทธิ์ต้องอยู่ระหว่าง 1-1095 วัน');
    const props = PropertiesService.getScriptProperties();
    const willHaveToken = settings.clearLineToken === true
      ? false
      : !!(token || props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'));
    if (settings.lineEnabled && (!lineTarget || !willHaveToken)) {
      throw new Error('การเปิด LINE ต้องระบุ target ID และ Channel access token ให้ครบ');
    }

    // ผ่าน validation ทั้งหมดแล้วจึงเขียนค่า เพื่อลดโอกาสบันทึกสำเร็จเพียงบางส่วน
    setConfig_('NOTIFY_EMAIL_ENABLED', 'false');
    setConfig_('NOTIFY_LINE_ENABLED', settings.lineEnabled ? 'true' : 'false');
    setConfig_('NOTIFY_PRIMARY_CHANNEL', 'LINE');
    setConfig_('NOTIFY_TEAMS_ENABLED', 'false');
    setConfig_('LINE_DEFAULT_TO', lineTarget);
    setConfig_('NOTIFY_LEAD_DAYS', String(lead));
    setConfig_('REVIEW_CYCLE_DAYS', String(cyc));
    if (settings.clearLineToken === true) props.deleteProperty('LINE_CHANNEL_ACCESS_TOKEN');
    else if (token) props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', token);
    const safeAudit = {
      emailEnabled: false,
      lineEnabled: !!settings.lineEnabled,
      lineTargetConfigured: !!lineTarget,
      lineTokenChanged: !!String(settings.lineToken || '').trim(),
      lineTokenCleared: settings.clearLineToken === true,
      teamsEnabled: false,
      leadDays: lead,
      reviewCycle: cyc
    };
    writeAudit_(user, 'UPDATE_SETTINGS', 'notification', '', '', JSON.stringify(safeAudit), 'success');
    return ok('บันทึกการตั้งค่าเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** เรียก dailyNotificationCheck_ แบบ manual (ทดสอบ/รันทันที) */
function runNotificationCheckNow() {
  try {
    requireModule('notification', true);
    const n = dailyNotificationCheck_();
    return ok('ตรวจสอบแล้ว พบรายการแจ้งเตือน ' + n + ' รายการ');
  } catch (e) { return fail(e.message); }
}

/** ทดสอบส่งแจ้งเตือน (เรียกจากหน้าตั้งค่า / เมนูดีบัก) */
function testNotification() {
  const user = requireModule('notification', true);
  const emails = getITAdminEmails_().join(',') || user.email;
  notify_(emails, 'ทดสอบระบบแจ้งเตือน',
    '<p>ข้อความทดสอบจากระบบ ISMS เวลา ' + fmtDateTime(new Date()) + '</p>',
    'ทดสอบ LINE จากระบบ ISMS เวลา ' + fmtDateTime(new Date()),
    'notification', '');
  return ok('ส่งข้อความทดสอบเรียบร้อย (ตรวจสอบ NotificationLog)');
}

/** ทดสอบ LINE เพียงช่องทางเดียว พร้อมคืน HTTP error ที่อ่านได้ โดยไม่เปิดเผย token */
function testLineNotification() {
  try {
    const user = requireModule('notification', true);
    const message = 'ทดสอบ LINE Messaging API จากระบบ ISMS เวลา ' + fmtDateTime(new Date());
    const result = sendLinePushDetailed_(message, null);
    logNotification_('LINE', result.to, message.substring(0, 60), 'notification', '',
      result.success ? 'success' : 'fail', result.error || '');
    writeAudit_(user, 'TEST_LINE_NOTIFICATION', 'notification', '', result.to,
      JSON.stringify({ success: result.success, httpCode: result.code, error: result.error || '' }),
      result.success ? 'success' : 'fail');
    if (!result.success) throw new Error(result.error || 'ส่ง LINE ไม่สำเร็จ');
    return ok('LINE API ส่งสำเร็จ (HTTP ' + result.code + ')');
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ตรวจความพร้อมของการแจ้งสถานะไปยังเจ้าของ Ticket ผ่าน LINE
 * รันจาก Apps Script Editor เท่านั้น และไม่แสดง Channel access token
 */
function diagnoseLatestLineTicketNotification() {
  assertEditorOwner_();
  const lineTickets = readSheetObjectsEnsured_(SHEETS.TICKET)
    .filter(function (t) {
      return /^U[0-9a-f]{32}$/i.test(String(t.RequesterLineUserID || '').trim());
    })
    .sort(function (a, b) {
      return new Date(b.Timestamp || 0).getTime() - new Date(a.Timestamp || 0).getTime();
    });
  const ticket = lineTickets[0] || null;
  const lineUser = ticket
    ? findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', ticket.RequesterLineUserID)
    : null;
  const recentLogs = ticket
    ? readSheetObjectsEnsured_(SHEETS.NOTIFY_LOG).filter(function (r) {
        return String(r.Channel) === 'LINE' &&
          String(r.RefModule) === 'ticket' &&
          String(r.RefID) === String(ticket.TicketID);
      }).slice(-3)
    : [];
  const maskedId = ticket
    ? String(ticket.RequesterLineUserID).substring(0, 5) + '…' +
      String(ticket.RequesterLineUserID).slice(-5)
    : '-';
  const report = [
    'NOTIFY_LINE_ENABLED = ' + (isLineEnabled() ? 'true' : 'false'),
    'LINE_CHANNEL_ACCESS_TOKEN = ' +
      (getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '') ? 'CONFIGURED' : 'MISSING'),
    'LINE ticket found = ' + (ticket ? 'YES' : 'NO'),
    'Ticket ID = ' + (ticket ? ticket.TicketID : '-'),
    'Ticket status = ' + (ticket ? ticket.Status : '-'),
    'RequesterLineUserID = ' + maskedId,
    'Line user link status = ' + (lineUser ? lineUser.LinkStatus : 'NOT_FOUND'),
    'OA friend status = ' + (lineUser ? lineUser.FriendStatus : 'NOT_FOUND'),
    'Recent LINE logs = ' + recentLogs.length
  ];
  recentLogs.forEach(function (r, index) {
    report.push(
      'Log ' + (index + 1) + ' = ' + String(r.Result || '-') +
      (r.ErrorMsg ? ' | ' + String(r.ErrorMsg).substring(0, 300) : '')
    );
  });
  const text = report.join('\n');
  console.log(text);
  return text;
}

/**
 * ส่งข้อความทดสอบไปยังเจ้าของ Ticket LINE ล่าสุด
 * รันจาก Apps Script Editor เท่านั้น และบันทึกผลลง NotificationLog
 */
function testLatestLineTicketNotification() {
  assertEditorOwner_();
  if (!isLineEnabled()) throw new Error('NOTIFY_LINE_ENABLED ยังไม่เป็น true');
  if (!getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '')) {
    throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  }
  const ticket = readSheetObjectsEnsured_(SHEETS.TICKET)
    .filter(function (t) {
      return /^U[0-9a-f]{32}$/i.test(String(t.RequesterLineUserID || '').trim());
    })
    .sort(function (a, b) {
      return new Date(b.Timestamp || 0).getTime() - new Date(a.Timestamp || 0).getTime();
    })[0];
  if (!ticket) {
    throw new Error('ไม่พบ Ticket ที่มี RequesterLineUserID กรุณาสร้าง Ticket หลัง LINE Login ก่อน');
  }
  const message = '🔔 ทดสอบแจ้งสถานะ Ticket\nเลขที่: ' + ticket.TicketID +
    '\nเรื่อง: ' + ticket.Title +
    '\nสถานะปัจจุบัน: ' + ticket.Status +
    '\nเวลา: ' + fmtDateTime(new Date()) +
    (typeof getTicketStatusUrl_ === 'function' && getTicketStatusUrl_()
      ? '\nดูสถานะ: ' + getTicketStatusUrl_()
      : '');
  const result = sendLinePushDetailed_(message, ticket.RequesterLineUserID);
  logNotification_('LINE', result.to, 'ทดสอบแจ้งสถานะ ' + ticket.TicketID,
    'ticket', ticket.TicketID, result.success ? 'success' : 'fail', result.error || '');
  const text = [
    'Ticket ID = ' + ticket.TicketID,
    'LINE API result = ' + (result.success ? 'SUCCESS' : 'FAILED'),
    'HTTP code = ' + result.code,
    'Error = ' + (result.error || '-')
  ].join('\n');
  console.log(text);
  if (!result.success) throw new Error(result.error || 'ส่ง LINE ไม่สำเร็จ');
  return text;
}
