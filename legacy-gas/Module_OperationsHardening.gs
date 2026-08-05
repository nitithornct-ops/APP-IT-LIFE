/**
 * Module_OperationsHardening.gs
 * Production hardening:
 * - ปฏิทิน SLA ตามเวลาทำการ
 * - Retention / PDPA maintenance แบบ Preview ก่อน Enforce
 * - Joiner / Mover / Leaver orchestration
 * - Live deployment health check
 */

// ===================================================================
// Business-hours SLA
// ===================================================================

function getSlaBusinessCalendar_() {
  const start = String(getConfig_('SLA_BUSINESS_START', '08:30')).split(':');
  const end = String(getConfig_('SLA_BUSINESS_END', '17:30')).split(':');
  const weekdays = String(getConfig_('SLA_BUSINESS_DAYS', '1,2,3,4,5'))
    .split(',').map(function (v) { return parseInt(v, 10); })
    .filter(function (v) { return !isNaN(v) && v >= 0 && v <= 6; });
  const holidays = {};
  String(getConfig_('SLA_HOLIDAYS', '')).split(',').forEach(function (v) {
    const key = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) holidays[key] = true;
  });
  let startMinute = (parseInt(start[0], 10) || 8) * 60 + (parseInt(start[1], 10) || 0);
  let endMinute = (parseInt(end[0], 10) || 17) * 60 + (parseInt(end[1], 10) || 0);
  if (endMinute <= startMinute) {
    startMinute = 8 * 60 + 30;
    endMinute = 17 * 60 + 30;
  }
  return {
    startMinute: startMinute,
    endMinute: endMinute,
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5],
    holidays: holidays
  };
}

function slaDateKey_(date) {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
}

function isSlaBusinessDay_(date, calendar) {
  return calendar.weekdays.indexOf(date.getDay()) > -1 && !calendar.holidays[slaDateKey_(date)];
}

function slaSetMinute_(date, minuteOfDay) {
  const d = new Date(date);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d;
}

function nextSlaBusinessInstant_(value, calendar) {
  let d = value instanceof Date ? new Date(value) : new Date(value);
  if (isNaN(d)) d = new Date();
  for (let guard = 0; guard < 3700; guard++) {
    if (!isSlaBusinessDay_(d, calendar)) {
      d.setDate(d.getDate() + 1);
      d = slaSetMinute_(d, calendar.startMinute);
      continue;
    }
    const minute = d.getHours() * 60 + d.getMinutes();
    if (minute < calendar.startMinute) return slaSetMinute_(d, calendar.startMinute);
    if (minute >= calendar.endMinute) {
      d.setDate(d.getDate() + 1);
      d = slaSetMinute_(d, calendar.startMinute);
      continue;
    }
    return d;
  }
  throw new Error('ไม่สามารถคำนวณวันทำการของ SLA ได้ กรุณาตรวจ SLA_BUSINESS_DAYS/SLA_HOLIDAYS');
}

function addBusinessHours_(startValue, hours) {
  const calendar = getSlaBusinessCalendar_();
  let cursor = nextSlaBusinessInstant_(startValue || new Date(), calendar);
  let remaining = Math.max(0, Number(hours) || 0) * 60;
  for (let guard = 0; remaining > 0 && guard < 10000; guard++) {
    cursor = nextSlaBusinessInstant_(cursor, calendar);
    const end = slaSetMinute_(cursor, calendar.endMinute);
    const available = Math.max(0, (end.getTime() - cursor.getTime()) / 60000);
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60000);
    remaining -= available;
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
    cursor = slaSetMinute_(cursor, calendar.startMinute);
  }
  if (remaining > 0) throw new Error('SLA มีจำนวนชั่วโมงมากเกินช่วงที่ระบบรองรับ');
  return cursor;
}

function businessMinutesBetween_(fromValue, toValue) {
  let from = fromValue instanceof Date ? new Date(fromValue) : new Date(fromValue);
  let to = toValue instanceof Date ? new Date(toValue) : new Date(toValue);
  if (isNaN(from) || isNaN(to) || from.getTime() === to.getTime()) return 0;
  if (from > to) return -businessMinutesBetween_(to, from);
  const calendar = getSlaBusinessCalendar_();
  let total = 0;
  let cursor = new Date(from);
  for (let guard = 0; cursor < to && guard < 3700; guard++) {
    if (isSlaBusinessDay_(cursor, calendar)) {
      const dayStart = slaSetMinute_(cursor, calendar.startMinute);
      const dayEnd = slaSetMinute_(cursor, calendar.endMinute);
      const rangeStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
      const rangeEnd = new Date(Math.min(to.getTime(), dayEnd.getTime()));
      if (rangeEnd > rangeStart) total += (rangeEnd - rangeStart) / 60000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor = slaSetMinute_(cursor, 0);
  }
  return Math.round(total);
}

function businessHoursUntil_(target) {
  if (!target) return null;
  const t = target instanceof Date ? target : new Date(target);
  if (isNaN(t)) return null;
  const now = new Date();
  const minutes = t >= now
    ? businessMinutesBetween_(now, t)
    : -businessMinutesBetween_(t, now);
  return Math.round(minutes / 60);
}

// ===================================================================
// Retention / PDPA
// ===================================================================

function retentionDays_(key, fallback) {
  const n = parseInt(getConfig_(key, String(fallback)), 10);
  return !isNaN(n) && n >= 1 && n <= 36500 ? n : fallback;
}

function retentionHours_(key, fallback) {
  const n = parseInt(getConfig_(key, String(fallback)), 10);
  return !isNaN(n) && n >= 1 && n <= 876000 ? n : fallback;
}

function retentionCutoff_(days) {
  return new Date(Date.now() - Number(days) * 86400000);
}

function retentionDate_(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d) ? null : d;
}

function retentionOlderThan_(value, cutoff) {
  const d = retentionDate_(value);
  return !!d && d.getTime() < cutoff.getTime();
}

function deleteRowsDescending_(sheetName, rows) {
  if (!rows.length) return 0;
  const sh = getSheet_(sheetName);
  const unique = {};
  rows.forEach(function (row) {
    const n = parseInt(row._row, 10);
    if (n > 1) unique[n] = true;
  });
  const numbers = Object.keys(unique).map(Number).sort(function (a, b) { return b - a; });
  numbers.forEach(function (n) { sh.deleteRow(n); });
  return numbers.length;
}

function appendRetentionLog_(runId, mode, policy, sheetName, action, matched, affected, status, detail, actor) {
  appendRowEnsured_(SHEETS.RETENTION_LOG, {
    RunID: runId,
    RunAt: new Date(),
    Mode: mode,
    Policy: policy,
    SheetName: sheetName,
    Action: action,
    MatchedRows: matched,
    AffectedRows: affected,
    Status: status,
    Detail: sanitizeText(detail, 1500),
    RunBy: (actor && actor.email) || actor || 'system'
  }, (actor && actor.email) || actor || 'system');
}

function retentionMaybeTrashEvidence_(value) {
  if (getConfig_('RETENTION_TRASH_EVIDENCE', 'false') !== 'true') return 0;
  const ids = [];
  const seen = {};
  String(value || '').split(/\s+/).forEach(function (token) {
    let id = '';
    if (typeof arStrictDriveFileId_ === 'function') id = arStrictDriveFileId_(token);
    if (!id) {
      const raw = String(token || '').trim();
      if (/^[A-Za-z0-9_-]{25,}$/.test(raw)) id = raw;
    }
    if (id && !seen[id]) { seen[id] = true; ids.push(id); }
  });
  if (!ids.length) return 0;

  // This legacy raw-locator cleanup is never allowed to bypass the Attachment
  // Registry graph. Re-read registry and links under the same lock used for the
  // Drive trash mutation; any registry/link reference (including expired rows
  // or legal holds) is deferred to graph-aware retention below.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let count = 0;
  try {
    let registryRows;
    let linkRows;
    try {
      registryRows = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true);
      linkRows = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true);
    } catch (registryError) {
      // Fail closed: inability to prove absence from the graph forbids trash.
      console.error('retention raw evidence registry recheck: ' + registryError.message);
      return 0;
    }
    ids.forEach(function (fileId) {
      const registered = registryRows.filter(function (row) {
        return String(row.FileID || '').trim() === fileId ||
          String(row.AttachmentID || '').trim() === fileId;
      });
      const attachmentIds = {};
      registered.forEach(function (row) {
        attachmentIds[String(row.AttachmentID || '').trim()] = true;
      });
      const linked = linkRows.some(function (link) {
        const id = String(link.AttachmentID || '').trim();
        return id === fileId || !!attachmentIds[id];
      });
      const held = registered.some(function (row) {
        const id = String(row.AttachmentID || '').trim();
        return retentionAttachmentHasLegalHold_(row,
          retentionAttachmentActiveLinks_(id, linkRows));
      });
      if (registered.length || linked || held) return;
      try {
        const file = DriveApp.getFileById(fileId);
        if (!file.isTrashed()) file.setTrashed(true);
        count++;
      } catch (e) {}
    });
  } finally {
    lock.releaseLock();
  }
  return count;
}

function isServiceRequestRetentionTerminal_(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['ปิดงาน', 'ยกเลิก', 'ปฏิเสธ', 'closed', 'cancelled', 'canceled', 'rejected'].indexOf(normalized) > -1;
}

function isWorkflowRetentionTerminal_(status) {
  if (typeof WF_TERMINAL_INSTANCE_STATUS_ !== 'undefined' &&
    WF_TERMINAL_INSTANCE_STATUS_.indexOf(String(status || '')) > -1) return true;
  const normalized = String(status || '').trim().toUpperCase();
  return ['COMPLETED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'CANCELED', 'ERROR']
    .indexOf(normalized) > -1;
}

function retentionWorkflowEligible_(row, cutoff) {
  const terminalAt = row.CompletedAt || row.CancelledAt || row.LastUpdatedAt;
  return isWorkflowRetentionTerminal_(row.Status) && retentionOlderThan_(terminalAt, cutoff);
}

function retentionHasMarker_(value) {
  return String(value || '').indexOf('[ANONYMIZED_BY_RETENTION]') > -1;
}

function retentionTruthy_(value) {
  return ['1', 'TRUE', 'YES', 'Y', 'ON'].indexOf(String(value || '').trim().toUpperCase()) > -1;
}

function retentionAttachmentId_(row) {
  return String((row && row.AttachmentID) || '').trim();
}

function retentionAttachmentStatus_(row) {
  return String((row && row.Status) || 'STAGED').trim().toUpperCase();
}

function retentionAttachmentLinkActive_(row) {
  const status = String((row && row.Status) || 'ACTIVE').trim().toUpperCase();
  return status === 'ACTIVE' || status === 'LINKED';
}

function retentionAttachmentActiveLinks_(attachmentId, links) {
  return (links || []).filter(function (link) {
    return retentionAttachmentId_(link) === String(attachmentId || '') && retentionAttachmentLinkActive_(link);
  });
}

function retentionAttachmentHasLegalHold_(attachment, links) {
  if (retentionTruthy_(attachment && (attachment.LegalHold || attachment.IsLegalHold))) return true;
  if ((Number(attachment && attachment.LegalHoldCount) || 0) > 0) return true;
  return (links || []).some(function (link) {
    return retentionTruthy_(link.LegalHold || link.IsLegalHold);
  });
}

function retentionAttachmentFileReferenceCount_(attachment, registryRows) {
  const fileId = String((attachment && attachment.FileID) || '').trim();
  if (!fileId) return 1;
  return (registryRows || []).filter(function (row) {
    return String(row.FileID || '').trim() === fileId &&
      ['ACTIVE', 'STAGED'].indexOf(retentionAttachmentStatus_(row)) > -1;
  }).length;
}

function retentionAttachmentIntentIds_(value) {
  let list = value;
  if (typeof list === 'string') {
    const text = list.trim();
    if (!text) list = [];
    else if (text.charAt(0) === '[') {
      try { list = JSON.parse(text); } catch (e) {
        // Fail safe for legacy/corrupt JSON: salvage identifier-shaped tokens
        // instead of treating a referenced attachment as an orphan.
        console.error('attachment intent JSON recovery: ' + e.message);
        list = text.match(/[A-Za-z0-9_-]{3,120}/g) || [];
      }
    } else list = text.split(',');
  }
  if (!Array.isArray(list)) list = list ? [list] : [];
  return list.map(function (id) { return String(id || '').trim(); }).filter(function (id) {
    return /^[A-Za-z0-9_-]{3,120}$/.test(id);
  });
}

function retentionEntityRowActive_(entityType, row) {
  if (!row) return true; // unknown/missing source fails closed
  if (typeof _isDeletedRow_ === 'function' && _isDeletedRow_(row)) return false;
  const type = String(entityType || '');
  try {
    if (type === 'ServiceRequest') {
      return typeof svcIsTerminal_ === 'function' ? !svcIsTerminal_(row.Status) :
        !isServiceRequestRetentionTerminal_(row.Status);
    }
    if (type === 'ServiceRequestTask') {
      const request = retentionFindRowIncludingDeleted_(SHEETS.SERVICE_REQUEST,
        'RequestID', row.RequestID);
      return !request || retentionEntityRowActive_('ServiceRequest', request);
    }
    if (type === 'Ticket') {
      return typeof isTicketTerminal_ === 'function' ? !isTicketTerminal_(row.Status) :
        !/^(closed|cancelled|canceled|resolved|escalated)$/i.test(String(row.Status || '').trim());
    }
    if (type === 'PersonalTask') {
      return typeof taskIsTerminal_ === 'function' ? !taskIsTerminal_(String(row.Status || '')) :
        !/^(completed|closed|cancelled|canceled)$/i.test(String(row.Status || '').trim());
    }
    if (type === 'WorkflowInstance') return !isWorkflowRetentionTerminal_(row.Status);
    if (type === 'WorkflowApproval') {
      const instance = retentionFindRowIncludingDeleted_(SHEETS.WORKFLOW_INSTANCE,
        'InstanceID', row.InstanceID);
      return !instance || retentionEntityRowActive_('WorkflowInstance', instance);
    }
    if (type === 'AccessRequest') {
      if (typeof AC_STATUS !== 'undefined') {
        return [AC_STATUS.DONE, AC_STATUS.REJECTED].indexOf(String(row.Status || '')) === -1;
      }
      return !row.CompletedAt && !row.ClosedAt &&
        !/^(completed|closed|rejected|revoked|cancelled|canceled)$/i.test(String(row.Status || '').trim());
    }
    if (type === 'ChangeRequest') {
      if (typeof CHG_STATUS !== 'undefined') {
        return [CHG_STATUS.DEPLOYED, CHG_STATUS.REJECTED].indexOf(String(row.Status || '')) === -1;
      }
      return !row.ClosedAt && !row.CompletedAt &&
        !/^(implemented|completed|closed|rejected|cancelled|canceled)$/i.test(String(row.Status || '').trim());
    }
    if (type === 'Incident') {
      if (typeof INC_STATUS !== 'undefined') {
        return String(row.Status || '') !== String(INC_STATUS.CLOSED);
      }
      return !row.CloseDate && !row.ClosedAt &&
        !/^(closed|completed|cancelled|canceled)$/i.test(String(row.Status || '').trim());
    }
  } catch (e) {
    return true;
  }
  return true;
}

function retentionFindRowIncludingDeleted_(sheetName, keyColumn, keyValue) {
  const rows = readSheetObjectsEnsured_(sheetName, true);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][keyColumn] || '') === String(keyValue || '')) return rows[i];
  }
  return null;
}

function retentionAttachmentLinkSource_(link) {
  try {
    const entityId = String((link && (link.EntityID || link.RecordID)) || '').trim();
    if (!entityId) return null;
    let type = String((link && (link.EntityType || link.RecordType)) || '').trim();
    const sheetName = String((link && link.EntitySheet) || '').trim();
    if (!type && typeof arRecordTypeFromEntitySheet_ === 'function') {
      type = arRecordTypeFromEntitySheet_(sheetName);
    }
    const map = {};
    map.ServiceRequest = [SHEETS.SERVICE_REQUEST, 'RequestID'];
    map.ServiceRequestTask = [SHEETS.SERVICE_REQUEST_TASK, 'TaskID'];
    map.Ticket = [SHEETS.TICKET, 'TicketID'];
    map.PersonalTask = [SHEETS.PERSONAL_TASK, 'TaskID'];
    map.WorkflowInstance = [SHEETS.WORKFLOW_INSTANCE, 'InstanceID'];
    map.WorkflowApproval = [SHEETS.WORKFLOW_APPROVAL, 'ApprovalID'];
    map.AccessRequest = [SHEETS.ACCESS_REQ, 'ReqID'];
    map.ChangeRequest = [SHEETS.CHANGE, 'ChangeID'];
    map.Incident = [SHEETS.INCIDENT, 'IncidentID'];
    const source = map[type];
    if (!source) return null;
    const row = retentionFindRowIncludingDeleted_(source[0], source[1], entityId);
    if (!row) return null;
    return { type: type, row: row };
  } catch (e) {
    return null;
  }
}

function retentionAttachmentLinkSourceActive_(link) {
  const source = retentionAttachmentLinkSource_(link);
  return !source || retentionEntityRowActive_(source.type, source.row);
}

function retentionAttachmentTerminalAt_(source) {
  if (!source || !source.row || retentionEntityRowActive_(source.type, source.row)) return null;
  let row = source.row;
  let type = source.type;
  if (type === 'ServiceRequestTask') {
    row = retentionFindRowIncludingDeleted_(SHEETS.SERVICE_REQUEST, 'RequestID', row.RequestID);
    type = 'ServiceRequest';
  } else if (type === 'WorkflowApproval') {
    row = retentionFindRowIncludingDeleted_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', row.InstanceID);
    type = 'WorkflowInstance';
  }
  if (!row || retentionEntityRowActive_(type, row)) return null;
  const fields = {
    ServiceRequest: ['DeletedAt', 'ClosedAt', 'CompletedAt', 'CancelledAt', 'LastUpdatedAt'],
    Ticket: ['DeletedAt', 'CloseDate', 'ResolvedAt', 'LastUpdatedAt'],
    PersonalTask: ['DeletedAt', 'CompletedAt', 'LastUpdatedAt'],
    WorkflowInstance: ['DeletedAt', 'CompletedAt', 'CancelledAt', 'LastUpdatedAt'],
    AccessRequest: ['DeletedAt', 'CompletedAt', 'LastUpdatedAt'],
    ChangeRequest: ['DeletedAt', 'DeployDate', 'ApproveDate', 'LastUpdatedAt'],
    Incident: ['DeletedAt', 'CloseDate', 'ClosedAt', 'LastUpdatedAt']
  }[type] || [];
  for (let i = 0; i < fields.length; i++) {
    const parsed = retentionDate_(row[fields[i]]);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * A source receives its full policy window after it actually becomes terminal.
 * Missing source/terminal timestamps fail closed instead of expiring now.
 */
function retentionAttachmentLinkEffectiveDue_(link) {
  const source = retentionAttachmentLinkSource_(link);
  const terminalAt = retentionAttachmentTerminalAt_(source);
  if (!source || !terminalAt) return null;
  const policyKey = String(link.RetentionPolicyKey || '').trim() || 'ATTACHMENT_RETENTION_DAYS';
  let fallback = 730;
  if (source.type === 'PersonalTask') fallback = 365;
  const policyDays = retentionDays_(policyKey, fallback);
  const terminalDue = new Date(terminalAt.getTime() + policyDays * 86400000);
  const explicitDue = retentionDate_(link.RetainUntil || link.RetentionUntil);
  return explicitDue && explicitDue.getTime() > terminalDue.getTime() ? explicitDue : terminalDue;
}

/**
 * IDs named by an ACTIVE source row/index survive STAGED cleanup. Terminal
 * sources are released to their explicit link/registry RetainUntil policy;
 * this prevents a TaskAttachments index from becoming an immortal hold.
 */
function retentionAttachmentIntentSet_() {
  const set = {};
  const collect = function (sheetName, entityType, fields) {
    try {
      readSheetObjectsEnsured_(sheetName, true).forEach(function (row) {
        if (!retentionEntityRowActive_(entityType, row)) return;
        fields.forEach(function (field) {
          retentionAttachmentIntentIds_(row[field]).forEach(function (id) { set[id] = true; });
        });
      });
    } catch (e) {
      throw new Error('Attachment intent scan failed for ' + sheetName + ': ' + e.message);
    }
  };
  collect(SHEETS.SERVICE_REQUEST, 'ServiceRequest', ['AttachmentIDsJSON', 'CompletionAttachmentIDsJSON']);
  collect(SHEETS.SERVICE_REQUEST_TASK, 'ServiceRequestTask', ['EvidenceAttachmentIDsJSON']);
  collect(SHEETS.TICKET, 'Ticket', ['AttachmentIDsJSON']);
  collect(SHEETS.WORKFLOW_APPROVAL, 'WorkflowApproval', ['AttachmentIDsJSON']);
  try {
    readSheetObjectsEnsured_(SHEETS.TASK_ATTACHMENT, true).forEach(function (row) {
      const id = String(row.RegistryAttachmentID || '').trim();
      const task = retentionFindRowIncludingDeleted_(SHEETS.PERSONAL_TASK, 'TaskID', row.TaskID);
      if (retentionEntityRowActive_('PersonalTask', task) &&
          /^[A-Za-z0-9_-]{3,120}$/.test(id)) set[id] = true;
    });
  } catch (e) {
    throw new Error('Attachment task intent scan failed: ' + e.message);
  }
  return set;
}

function retentionAttachmentReferencedByIntent_(attachmentId) {
  return !!retentionAttachmentIntentSet_()[String(attachmentId || '')];
}

function retentionAttachmentDue_(attachment, now, stagedCutoff) {
  const status = retentionAttachmentStatus_(attachment);
  if (status === 'STAGED') {
    return retentionOlderThan_(attachment.UploadedAt || attachment.Timestamp, stagedCutoff);
  }
  if (status !== 'ACTIVE') return false;
  const retainUntil = retentionDate_(attachment.EffectiveRetainUntil || attachment.RetentionUntil);
  return !!retainUntil && retainUntil.getTime() < now.getTime();
}

function retentionAppendMarker_(value, marker) {
  const text = String(value || '').trim();
  if (text.indexOf(marker) > -1) return text;
  return text ? (text + '\n' + marker) : marker;
}

/** Direct row update for callers that already hold the script lock. */
function retentionUpdateRowLocked_(sheetName, rowNumber, patch, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  const now = new Date();
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, header)) {
      values[index] = sheetSafeValue_(patch[header]);
    }
    if (header === 'LastUpdatedBy') values[index] = actorEmail || '';
    if (header === 'LastUpdatedAt') values[index] = now;
  });
  range.setValues([values]);
  return true;
}

/**
 * Expire one due AttachmentLink under the script lock. A legal hold on any
 * active link for the same attachment freezes the whole attachment graph.
 */
function retentionExpireAttachmentLink_(candidate, actor) {
  const actorObj = actor && actor.email ? actor : { email: String(actor || 'system'), role: 'system' };
  const candidateAttachmentId = retentionAttachmentId_(candidate);
  if (!candidateAttachmentId || retentionAttachmentReferencedByIntent_(candidateAttachmentId)) return 0;
  const lock = LockService.getScriptLock();
  let attachment = null;
  let changed = 0;
  lock.waitLock(30000);
  try {
    const links = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true);
    const link = links.filter(function (row) {
      return String(row.LinkID || '') === String(candidate.LinkID || '');
    })[0];
    if (!link || !retentionAttachmentLinkActive_(link)) return 0;
    if (retentionAttachmentLinkSourceActive_(link)) return 0;

    const retainUntil = retentionAttachmentLinkEffectiveDue_(link);
    if (!retainUntil || retainUntil.getTime() >= Date.now()) return 0;
    const attachmentId = retentionAttachmentId_(link);
    if (retentionAttachmentReferencedByIntent_(attachmentId)) return 0;
    attachment = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true).filter(function (row) {
      return retentionAttachmentId_(row) === attachmentId;
    })[0];
    const activeLinks = retentionAttachmentActiveLinks_(attachmentId, links);
    if (!attachment || retentionAttachmentHasLegalHold_(attachment, activeLinks)) return 0;
    const context = typeof arContextFromLink_ === 'function' ? arContextFromLink_(link) : null;
    const linkBefore = typeof arLinkMutableStatePatch_ === 'function' ?
      arLinkMutableStatePatch_(link) : {
        Status: link.Status, RetainUntil: link.RetainUntil, LegalHold: link.LegalHold,
        LegalHoldReason: link.LegalHoldReason, UnlinkedAt: link.UnlinkedAt,
        UnlinkedBy: link.UnlinkedBy, Notes: link.Notes
      };
    const registryBefore = typeof arRegistryMutableStatePatch_ === 'function' ?
      arRegistryMutableStatePatch_(attachment) : {
        Status: attachment.Status, EffectiveRetainUntil: attachment.EffectiveRetainUntil,
        ActiveLinkCount: attachment.ActiveLinkCount, LegalHoldCount: attachment.LegalHoldCount,
        Notes: attachment.Notes
      };
    const intent = arBeginCriticalAuditLocked_(attachment, actorObj,
      'RETENTION_UNLINK', context,
      'Attachment link is past its effective terminal-lifecycle retention date');
    try {
      retentionUpdateRowLocked_(SHEETS.ATTACHMENT_LINK, link._row, {
        Status: 'EXPIRED',
        UnlinkedAt: new Date(),
        UnlinkedBy: actorObj.email,
        Notes: retentionAppendMarker_(link.Notes, '[EXPIRED_BY_RETENTION]')
      }, actorObj.email);
      if (typeof arRefreshAttachmentAggregatesLocked_ === 'function') {
        arRefreshAttachmentAggregatesLocked_(attachment, actorObj);
      }
      const verified = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true).filter(function (row) {
        return String(row.LinkID || '') === String(link.LinkID || '');
      })[0];
      if (!verified || String(verified.Status || '').toUpperCase() !== 'EXPIRED') {
        throw new Error('Retention link expiration could not be verified');
      }
      arCompleteCriticalAuditLocked_(intent, 'success',
        'LINK=' + String(link.LinkID || '') + '; ATTACHMENT=' + attachmentId);
      changed = 1;
    } catch (commitError) {
      try { retentionUpdateRowLocked_(SHEETS.ATTACHMENT_LINK, link._row, linkBefore, actorObj.email); }
      catch (ignoreLinkRollback) {}
      try { retentionUpdateRowLocked_(SHEETS.ATTACHMENT_REGISTRY, attachment._row,
        registryBefore, actorObj.email); }
      catch (ignoreRegistryRollback) {}
      try { arCompleteCriticalAuditLocked_(intent, 'error', commitError.message); }
      catch (auditError) {
        throw new Error(commitError.message + '; audit completion failed: ' + auditError.message);
      }
      throw commitError;
    }
  } finally {
    lock.releaseLock();
  }
  if (!changed) return 0;
  if (typeof arLogAttachmentAction_ === 'function') {
    try {
      arLogAttachmentAction_(attachment, actorObj, 'RETENTION_UNLINK_SUMMARY', 'success',
        'Attachment link expired after effective terminal-lifecycle retention', null);
    } catch (summaryAuditError) {
      console.error('retention unlink summary audit: ' + summaryAuditError.message);
    }
  }
  return 1;
}

/**
 * Recoverable retention deletion only: the registry is marked TRASHED and a
 * Drive file is moved to Drive trash. This function never permanently deletes
 * a Drive file and re-checks legal hold and reference counts while locked.
 */
function retentionSoftDeleteAttachment_(candidate, actor) {
  const actorObj = actor && actor.email ? actor : { email: String(actor || 'system'), role: 'system' };
  const attachmentId = retentionAttachmentId_(candidate);
  const lock = LockService.getScriptLock();
  let attachment = null;
  let changed = 0;
  lock.waitLock(30000);
  try {
    const registryRows = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true);
    attachment = registryRows.filter(function (row) {
      return retentionAttachmentId_(row) === attachmentId;
    })[0];
    if (!attachment || ['ACTIVE', 'STAGED'].indexOf(retentionAttachmentStatus_(attachment)) === -1) return 0;

    if (retentionAttachmentReferencedByIntent_(attachmentId)) return 0;

    const stagedCutoff = new Date(Date.now() -
      retentionHours_('ATTACHMENT_STAGED_RETENTION_HOURS', 72) * 3600000);
    if (!retentionAttachmentDue_(attachment, new Date(), stagedCutoff)) return 0;

    const activeLinks = retentionAttachmentActiveLinks_(attachmentId,
      readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true));
    if (activeLinks.length || retentionAttachmentHasLegalHold_(attachment, activeLinks)) return 0;
    if (retentionAttachmentFileReferenceCount_(attachment, registryRows) > 1) return 0;

    let file = null;
    let fileWasTrashed = false;
    const storageType = String(attachment.StorageType || 'DRIVE_FILE').toUpperCase();
    const fileId = String(attachment.FileID || '').trim();
    if (storageType !== 'EXTERNAL_URL' && fileId) {
      file = DriveApp.getFileById(fileId);
      fileWasTrashed = file.isTrashed();
    }
    const registryBefore = typeof arRegistryMutableStatePatch_ === 'function' ?
      arRegistryMutableStatePatch_(attachment) : {
        Status: attachment.Status, TrashedAt: attachment.TrashedAt,
        TrashedBy: attachment.TrashedBy, TrashReason: attachment.TrashReason,
        ActiveLinkCount: attachment.ActiveLinkCount, Notes: attachment.Notes
      };
    const intent = arBeginCriticalAuditLocked_(attachment, actorObj,
      'RETENTION_SOFT_DELETE', null,
      'Candidate has no active reference, durable intent, legal hold, or physical-file peer');
    try {
      if (file && !fileWasTrashed) file.setTrashed(true);
      retentionUpdateRowLocked_(SHEETS.ATTACHMENT_REGISTRY, attachment._row, {
        Status: 'TRASHED',
        TrashedAt: new Date(),
        TrashedBy: actorObj.email,
        TrashReason: 'Retention period expired; no active references',
        Notes: retentionAppendMarker_(attachment.Notes, '[SOFT_DELETED_BY_RETENTION]')
      }, actorObj.email);
      const verified = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true).filter(function (row) {
        return retentionAttachmentId_(row) === attachmentId;
      })[0];
      if (!verified || retentionAttachmentStatus_(verified) !== 'TRASHED') {
        throw new Error('Retention attachment soft-delete could not be verified');
      }
      arCompleteCriticalAuditLocked_(intent, 'success',
        'ATTACHMENT=' + attachmentId + '; DRIVE_TRASH=' + (file ? 'YES' : 'N/A'));
    } catch (commitError) {
      if (file && !fileWasTrashed) {
        try { if (file.isTrashed()) file.setTrashed(false); } catch (restoreError) {}
      }
      try { retentionUpdateRowLocked_(SHEETS.ATTACHMENT_REGISTRY, attachment._row,
        registryBefore, actorObj.email); }
      catch (ignoreRegistryRollback) {}
      try { arCompleteCriticalAuditLocked_(intent, 'error', commitError.message); }
      catch (auditError) {
        throw new Error(commitError.message + '; audit completion failed: ' + auditError.message);
      }
      throw commitError;
    }
    changed = 1;
  } finally {
    lock.releaseLock();
  }
  if (!changed) return 0;
  attachment = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true).filter(function (row) {
    return retentionAttachmentId_(row) === attachmentId;
  })[0] || attachment;
  if (typeof arLogAttachmentAction_ === 'function') {
    try {
      arLogAttachmentAction_(attachment, actorObj, 'RETENTION_SOFT_DELETE_SUMMARY', 'success',
        'Moved to recoverable Drive trash; no permanent deletion', null);
    } catch (summaryAuditError) {
      console.error('retention soft-delete summary audit: ' + summaryAuditError.message);
    }
  }
  return 1;
}

function runRetentionPolicies_(requestedMode, actor) {
  const mode = String(requestedMode || 'DRY_RUN').toUpperCase() === 'ENFORCE' ? 'ENFORCE' : 'DRY_RUN';
  const enforce = mode === 'ENFORCE';
  const runId = generateId('RET');
  ensureSheetBySchema_(SHEETS.RETENTION_LOG);
  const summary = { runId: runId, mode: mode, matched: 0, affected: 0, policies: [] };

  function record(policy, sheetName, action, candidates, applyFn, detail) {
    const matched = candidates.length;
    let affected = 0;
    let status = 'PREVIEW';
    let message = detail || '';
    try {
      if (enforce && matched) {
        affected = applyFn(candidates) || 0;
        status = affected < matched ? 'PARTIAL' : 'APPLIED';
        if (status === 'PARTIAL') {
          message = (message ? message + ' | ' : '') +
            (matched - affected) + ' row(s) skipped after locked re-validation or an item-level failure';
        }
      }
    } catch (e) {
      status = 'FAIL';
      message = (message ? message + ' | ' : '') + e.message;
    }
    summary.matched += matched;
    summary.affected += affected;
    summary.policies.push({
      policy: policy, sheet: sheetName, action: action,
      matched: matched, affected: affected, status: status
    });
    appendRetentionLog_(runId, mode, policy, sheetName, action, matched, affected, status, message, actor);
  }

  const lineCutoff = retentionCutoff_(retentionDays_('LINE_SESSION_RETENTION_DAYS', 30));
  const lineSessions = readSheetObjectsEnsured_(SHEETS.LINE_SESSIONS, true).filter(function (r) {
    const expired = r.ExpiresAt && retentionOlderThan_(r.ExpiresAt, lineCutoff);
    const revoked = r.RevokedAt && retentionOlderThan_(r.RevokedAt, lineCutoff);
    return expired || revoked;
  });
  record('LINE_SESSION', SHEETS.LINE_SESSIONS, 'PURGE',
    lineSessions, function (rows) { return deleteRowsDescending_(SHEETS.LINE_SESSIONS, rows); },
    'ลบ session hash ที่หมดอายุ/ถูกเพิกถอนแล้ว');

  const logCutoff = retentionCutoff_(retentionDays_('NOTIFICATION_LOG_RETENTION_DAYS', 365));
  const notificationLogs = readSheetObjectsEnsured_(SHEETS.NOTIFY_LOG, true).filter(function (r) {
    return retentionOlderThan_(r.SentAt, logCutoff);
  });
  record('NOTIFICATION_LOG', SHEETS.NOTIFY_LOG, 'PURGE',
    notificationLogs, function (rows) { return deleteRowsDescending_(SHEETS.NOTIFY_LOG, rows); },
    'เก็บประวัติการส่ง LINE ตามจำนวนวันที่กำหนด');

  const queueCutoff = retentionCutoff_(retentionDays_('NOTIFICATION_QUEUE_RETENTION_DAYS', 90));
  const queueRows = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true).filter(function (r) {
    return ['SENT', 'DEAD'].indexOf(String(r.Status)) > -1 &&
      retentionOlderThan_(r.CreatedAt || r.Timestamp, queueCutoff);
  });
  record('NOTIFICATION_QUEUE', SHEETS.NOTIFY_QUEUE, 'PURGE',
    queueRows, function (rows) { return deleteRowsDescending_(SHEETS.NOTIFY_QUEUE, rows); },
    'เก็บเฉพาะคิวที่ยังต้อง retry และประวัติล่าสุด');

  const ticketCutoff = retentionCutoff_(retentionDays_('TICKET_PII_RETENTION_DAYS', 730));
  const tickets = readSheetObjectsEnsured_(SHEETS.TICKET, true).filter(function (r) {
    const closedAt = r.CloseDate || r.ResolvedAt;
    return isTicketTerminal_(r.Status) && retentionOlderThan_(closedAt, ticketCutoff) &&
      String(r.RequesterIdentityType || '') !== 'ANONYMIZED';
  });
  record('TICKET_PII', SHEETS.TICKET, 'ANONYMIZE',
    tickets, function (rows) {
      rows.forEach(function (r) {
        retentionMaybeTrashEvidence_(r.EvidenceLink);
        updateRow_(SHEETS.TICKET, r._row, {
          RequesterEmail: '',
          RequesterName: 'ผู้แจ้ง (ลบข้อมูลตามอายุ)',
          RequesterPhone: '',
          Department: '',
          Location: '',
          Description: '[ลบรายละเอียดตามนโยบายเก็บรักษาข้อมูล]',
          EvidenceLink: '',
          AttachmentIDsJSON: '[]',
          PublicToken: '',
          PublicTokenHash: '',
          RequesterIdentityType: 'ANONYMIZED',
          RequesterLineUserID: '',
          Feedback: '',
          Notes: appendTicketNote_(r.Notes, 'retention', 'Anonymized by retention policy')
        }, (actor && actor.email) || 'system');
      });
      return rows.length;
    }, 'ลบข้อมูลระบุตัวผู้แจ้ง โดยคงเลข Ticket/สถานะ/SLA เพื่อสถิติและ Audit');

  const serviceRequestCutoff = retentionCutoff_(retentionDays_('SERVICE_REQUEST_PII_RETENTION_DAYS', 730));
  const serviceRequests = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST, true).filter(function (r) {
    const closedAt = r.ClosedAt || r.CompletedAt;
    return isServiceRequestRetentionTerminal_(r.Status) && retentionOlderThan_(closedAt, serviceRequestCutoff) &&
      String(r.RequesterName || '') !== 'ผู้ขอบริการ (ANONYMIZED)';
  });
  record('SERVICE_REQUEST_PII', SHEETS.SERVICE_REQUEST, 'ANONYMIZE',
    serviceRequests, function (rows) {
      const requestIds = {};
      rows.forEach(function (r) { requestIds[String(r.RequestID || '')] = true; });
      const requestTasks = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_TASK, true).filter(function (task) {
        return !!requestIds[String(task.RequestID || '')];
      });
      const requestHistory = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY, true).filter(function (history) {
        return !!requestIds[String(history.RequestID || '')];
      });
      let affected = 0;

      // ล้าง child rows ก่อนตั้ง sentinel ที่ parent เพื่อให้รอบถัดไป retry ได้หาก child ใดล้มเหลวกลางทาง
      requestTasks.forEach(function (task) {
        retentionMaybeTrashEvidence_(task.EvidenceLink);
        updateRow_(SHEETS.SERVICE_REQUEST_TASK, task._row, {
          Assignee: '',
          CompletedBy: '',
          EvidenceLink: '',
          EvidenceAttachmentIDsJSON: '[]',
          Notes: '[ANONYMIZED_BY_RETENTION]',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
        affected++;
      });
      requestHistory.forEach(function (history) {
        updateRow_(SHEETS.SERVICE_REQUEST_HISTORY, history._row, {
          Comment: '[ANONYMIZED_BY_RETENTION]',
          ActorEmail: '',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
        affected++;
      });
      rows.forEach(function (r) {
        retentionMaybeTrashEvidence_(r.AttachmentURL);
        retentionMaybeTrashEvidence_(r.CompletionEvidence);
        updateRow_(SHEETS.SERVICE_REQUEST, r._row, {
          RequesterEmail: '',
          RequesterName: 'ผู้ขอบริการ (ANONYMIZED)',
          Department: '',
          RequestedFor: '',
          Summary: '[ลบรายละเอียดตามนโยบายเก็บรักษาข้อมูล]',
          RequestDetailsJSON: '{}',
          BusinessJustification: '',
          AttachmentURL: '',
          Approver: '',
          ApprovedBy: '',
          Assignee: '',
          FulfillmentNotes: '',
          CompletionEvidence: '',
          AttachmentIDsJSON: '[]',
          CompletionAttachmentIDsJSON: '[]',
          RequesterConfirmation: '',
          CancelReason: '',
          IdempotencyKey: '',
          Notes: '[ANONYMIZED_BY_RETENTION]',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
        affected++;
      });
      return affected;
    }, 'ลบข้อมูลระบุตัวและรายละเอียดแบบฟอร์มของ Service Request ที่ปิดแล้ว โดยคงรหัส/สถานะ/SLA เพื่อสถิติและ Audit');

  // Workflow transactions retain their audit topology and timestamps, while
  // direct identifiers, free text, signatures and embedded context are removed.
  const workflowCutoff = retentionCutoff_(retentionDays_('WORKFLOW_PII_RETENTION_DAYS', 730));
  const allWorkflowInstances = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE, true);
  const eligibleWorkflowInstances = allWorkflowInstances.filter(function (row) {
    return retentionWorkflowEligible_(row, workflowCutoff);
  });
  const eligibleWorkflowIds = {};
  eligibleWorkflowInstances.forEach(function (row) {
    eligibleWorkflowIds[String(row.InstanceID || '')] = true;
  });

  const workflowApprovals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true).filter(function (row) {
    return !!eligibleWorkflowIds[String(row.InstanceID || '')] && !retentionHasMarker_(row.Notes);
  });
  record('WORKFLOW_APPROVAL_PII', SHEETS.WORKFLOW_APPROVAL, 'ANONYMIZE',
    workflowApprovals, function (rows) {
      rows.forEach(function (row) {
        updateRow_(SHEETS.WORKFLOW_APPROVAL, row._row, {
          ApproverEmail: '',
          OriginalApproverEmail: '',
          Comment: '[ANONYMIZED_BY_RETENTION]',
          DecisionBy: '',
          SignatureHash: '',
          AttachmentIDsJSON: '[]',
          Notes: '[ANONYMIZED_BY_RETENTION]',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
      });
      return rows.length;
    }, 'Remove approver identity, free text, signature hash and attachment identifiers; retain decision/status/timestamps for audit metrics');

  const workflowHistory = readSheetObjectsEnsured_(SHEETS.WORKFLOW_HISTORY, true).filter(function (row) {
    return !!eligibleWorkflowIds[String(row.InstanceID || '')] && !retentionHasMarker_(row.Comment);
  });
  record('WORKFLOW_HISTORY_PII', SHEETS.WORKFLOW_HISTORY, 'ANONYMIZE',
    workflowHistory, function (rows) {
      rows.forEach(function (row) {
        updateRow_(SHEETS.WORKFLOW_HISTORY, row._row, {
          ActorEmail: '',
          Comment: '[ANONYMIZED_BY_RETENTION]',
          DetailJSON: '{}',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
      });
      return rows.length;
    }, 'Remove workflow actor identity and free-form detail; retain immutable action/status/timestamp topology');

  const workflowInstances = eligibleWorkflowInstances.filter(function (row) {
    return !retentionHasMarker_(row.Notes);
  });
  record('WORKFLOW_INSTANCE_PII', SHEETS.WORKFLOW_INSTANCE, 'ANONYMIZE',
    workflowInstances, function (rows) {
      rows.forEach(function (row) {
        updateRow_(SHEETS.WORKFLOW_INSTANCE, row._row, {
          RecordLabel: '[ANONYMIZED_BY_RETENTION]',
          RequesterEmail: '',
          RequesterDepartment: '',
          ContextJSON: '{}',
          ResultJSON: '{}',
          Notes: '[ANONYMIZED_BY_RETENTION]',
          CreatedBy: ''
        }, (actor && actor.email) || 'system');
      });
      return rows.length;
    }, 'Remove requester identity and workflow payloads; retain instance/definition/record IDs, outcome and timestamps for governance evidence');

  // Attachment retention is graph-aware: expire due links first, then only
  // soft-delete an orphaned registry row. Legal hold freezes the whole graph.
  const attachmentRegistry = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true);
  const attachmentLinks = readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true);
  const durableAttachmentIntents = retentionAttachmentIntentSet_();
  const registryByAttachmentId = {};
  attachmentRegistry.forEach(function (row) {
    registryByAttachmentId[retentionAttachmentId_(row)] = row;
  });
  const expiredAttachmentLinks = attachmentLinks.filter(function (link) {
    if (!retentionAttachmentLinkActive_(link)) return false;
    if (retentionAttachmentLinkSourceActive_(link)) return false;
    const retainUntil = retentionAttachmentLinkEffectiveDue_(link);
    if (!retainUntil || retainUntil.getTime() >= Date.now()) return false;
    const attachmentId = retentionAttachmentId_(link);
    if (durableAttachmentIntents[attachmentId]) return false;
    const attachment = registryByAttachmentId[attachmentId];
    return !!attachment && !retentionAttachmentHasLegalHold_(attachment,
      retentionAttachmentActiveLinks_(attachmentId, attachmentLinks));
  });
  record('ATTACHMENT_LINK_RETENTION', SHEETS.ATTACHMENT_LINK, 'EXPIRE_LINK',
    expiredAttachmentLinks, function (rows) {
      let affected = 0;
      rows.forEach(function (row) {
        try {
          affected += retentionExpireAttachmentLink_(row, actor);
        } catch (e) {
          const attachment = registryByAttachmentId[retentionAttachmentId_(row)] || null;
          if (typeof arBestEffortDeniedLog_ === 'function') {
            arBestEffortDeniedLog_(attachment, actor && actor.email ? actor :
              { email: 'system', role: 'system' }, 'RETENTION_UNLINK_FAILED', e.message, null);
          }
          console.error('retention attachment link ' + String(row.LinkID || '') + ': ' + e.message);
        }
      });
      return affected;
    }, 'Expire only links past RetainUntil; skip the entire attachment graph when any legal hold is active');

  const currentAttachmentRegistry = enforce
    ? readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true) : attachmentRegistry;
  let currentAttachmentLinks = enforce
    ? readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true) : attachmentLinks;
  if (!enforce && expiredAttachmentLinks.length) {
    const previewExpiredLinkIds = {};
    expiredAttachmentLinks.forEach(function (row) {
      previewExpiredLinkIds[String(row.LinkID || '')] = true;
    });
    currentAttachmentLinks = currentAttachmentLinks.filter(function (row) {
      return !previewExpiredLinkIds[String(row.LinkID || '')];
    });
  }
  const attachmentNow = new Date();
  const stagedAttachmentCutoff = new Date(Date.now() -
    retentionHours_('ATTACHMENT_STAGED_RETENTION_HOURS', 72) * 3600000);
  const retentionAttachments = currentAttachmentRegistry.filter(function (attachment) {
    const attachmentId = retentionAttachmentId_(attachment);
    const activeLinks = retentionAttachmentActiveLinks_(attachmentId, currentAttachmentLinks);
    return retentionAttachmentDue_(attachment, attachmentNow, stagedAttachmentCutoff) &&
      !durableAttachmentIntents[attachmentId] &&
      !activeLinks.length && !retentionAttachmentHasLegalHold_(attachment, activeLinks) &&
      retentionAttachmentFileReferenceCount_(attachment, currentAttachmentRegistry) <= 1;
  });
  record('ATTACHMENT_REGISTRY_RETENTION', SHEETS.ATTACHMENT_REGISTRY, 'SOFT_DELETE',
    retentionAttachments, function (rows) {
      let affected = 0;
      rows.forEach(function (row) {
        try {
          affected += retentionSoftDeleteAttachment_(row, actor);
        } catch (e) {
          if (typeof arBestEffortDeniedLog_ === 'function') {
            arBestEffortDeniedLog_(row, actor && actor.email ? actor :
              { email: 'system', role: 'system' }, 'RETENTION_SOFT_DELETE_FAILED', e.message, null);
          }
          console.error('retention attachment ' + retentionAttachmentId_(row) + ': ' + e.message);
        }
      });
      return affected;
    }, 'Move orphaned, expired attachments to recoverable Drive trash only; never permanently delete files');

  const trashCutoff = retentionCutoff_(retentionDays_('SOFT_DELETE_RETENTION_DAYS', 365));
  const entities = appLifeDeletableEntities_();
  const sourceRetentionLinks = enforce ?
    readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true) : attachmentLinks;
  Object.keys(entities).forEach(function (entity) {
    const meta = entities[entity];
    let rows = [];
    try {
      rows = readSheetObjects_(meta.sheet, true).filter(function (r) {
        if (!_isDeletedRow_(r) || !retentionOlderThan_(r.DeletedAt, trashCutoff)) return false;
        const recordId = String(r[meta.idCol] || '');
        // Preserve the deleted source row as the terminal timestamp authority
        // until every attachment link has expired (or its legal hold is
        // released). This prevents source purge from turning retention into a
        // permanent unknown-source hold.
        return !sourceRetentionLinks.some(function (link) {
          return retentionAttachmentLinkActive_(link) &&
            String(link.EntitySheet || '') === String(meta.sheet || '') &&
            String(link.EntityID || link.RecordID || '') === recordId;
        });
      });
    } catch (e) {}
    record('SOFT_DELETE_' + entity.toUpperCase(), meta.sheet, 'PURGE', rows,
      function (matchedRows) { return deleteRowsDescending_(meta.sheet, matchedRows); },
      'ลบถาวรเฉพาะรายการในถังขยะที่พ้นระยะกู้คืน');
  });

  writeAudit_(actor || { email: 'system', role: 'system' }, 'RETENTION_RUN', 'dataClass',
    SHEETS.RETENTION_LOG, runId, JSON.stringify(summary), 'success');
  return summary;
}

function getRetentionStatusCore_() {
  let recent = [];
  try {
    recent = readSheetObjectsEnsured_(SHEETS.RETENTION_LOG, true).slice(-20).reverse().map(function (r) {
      return {
        runId: r.RunID, runAt: safeFmtDateTime_(r.RunAt), mode: r.Mode,
        policy: r.Policy, sheet: r.SheetName, action: r.Action,
        matched: Number(r.MatchedRows) || 0, affected: Number(r.AffectedRows) || 0,
        status: r.Status, detail: r.Detail
      };
    });
  } catch (e) {}
  return {
    mode: String(getConfig_('RETENTION_MODE', 'DRY_RUN')).toUpperCase(),
    ticketDays: retentionDays_('TICKET_PII_RETENTION_DAYS', 730),
    serviceRequestDays: retentionDays_('SERVICE_REQUEST_PII_RETENTION_DAYS', 730),
    workflowDays: retentionDays_('WORKFLOW_PII_RETENTION_DAYS', 730),
    attachmentStagedHours: retentionHours_('ATTACHMENT_STAGED_RETENTION_HOURS', 72),
    softDeleteDays: retentionDays_('SOFT_DELETE_RETENTION_DAYS', 365),
    lineSessionDays: retentionDays_('LINE_SESSION_RETENTION_DAYS', 30),
    notificationLogDays: retentionDays_('NOTIFICATION_LOG_RETENTION_DAYS', 365),
    recent: recent
  };
}

function getRetentionStatus() {
  try {
    requireModule('backup', false);
    return ok(getRetentionStatusCore_());
  } catch (e) { return fail(e.message); }
}

function runRetentionNow(mode) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    return ok(runRetentionPolicies_(mode, user));
  } catch (e) { return fail(e.message); }
}

function dailyRetentionMaintenance_() {
  const mode = String(getConfig_('RETENTION_MODE', 'DRY_RUN')).toUpperCase();
  try {
    return runRetentionPolicies_(mode === 'ENFORCE' ? 'ENFORCE' : 'DRY_RUN',
      { email: 'system', role: 'system' });
  } catch (e) {
    notify_('', 'Retention maintenance ล้มเหลว', '', '⚠️ Retention maintenance ล้มเหลว\n' + e.message,
      'dataClass', '');
    throw e;
  }
}

// ===================================================================
// Joiner / Mover / Leaver
// ===================================================================

function employeeLifecycleRows_() {
  return readSheetObjectsEnsured_(SHEETS.EMPLOYEE_LIFECYCLE, true).map(function (r) {
    let checklist = [];
    try { checklist = JSON.parse(r.ChecklistJSON || '[]'); } catch (e) {}
    return {
      row: r._row,
      id: r.LifecycleID,
      employeeId: r.EmployeeID,
      employeeCode: r.EmployeeCode,
      employeeEmail: r.EmployeeEmail,
      eventType: r.EventType,
      effectiveDate: safeFmtDate_(r.EffectiveDate),
      oldDepartment: r.OldDepartment,
      newDepartment: r.NewDepartment,
      oldPosition: r.OldPosition,
      newPosition: r.NewPosition,
      status: r.Status,
      accountsDisabled: r.AccountsDisabled,
      accessAffected: Number(r.AccessAffected) || 0,
      lineSessionsRevoked: Number(r.LineSessionsRevoked) || 0,
      assetsPending: Number(r.AssetsPending) || 0,
      checklist: checklist,
      reason: r.Reason,
      completedAt: safeFmtDateTime_(r.CompletedAt),
      completedBy: r.CompletedBy,
      notes: r.Notes,
      createdAt: safeFmtDateTime_(r.Timestamp),
      createdAtEpoch: r.Timestamp ? new Date(r.Timestamp).getTime() : 0
    };
  });
}

function lifecycleEmployeeHoldings_(employee) {
  const employeeObj = employee && employee.id ? employee : employeeRowToObj_(employee);
  const map = buildEmployeeHoldings_(
    [employeeObj],
    readSheetObjectsEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS, true),
    readSheetObjectsEnsured_(SHEETS.ASSET, true),
    readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE, true)
  );
  return (map[employeeObj.id] || []).filter(function (item) { return item.current; });
}

function revokeEmployeeLineSessions_(employee, actorEmail) {
  const code = employeeTextKey_(employee.EmployeeCode);
  const linked = readSheetObjectsEnsured_(SHEETS.LINE_USERS, true).filter(function (r) {
    return employeeTextKey_(r.EmployeeCode) === code;
  });
  const lineIds = {};
  linked.forEach(function (r) {
    lineIds[String(r.LineUserID)] = true;
    updateRow_(SHEETS.LINE_USERS, r._row, {
      LinkStatus: 'REVOKED',
      LinkedUserID: '',
      EmployeeCode: '',
      FullName: '',
      Department: ''
    }, actorEmail);
  });
  let count = 0;
  readSheetObjectsEnsured_(SHEETS.LINE_SESSIONS, true).forEach(function (r) {
    if (lineIds[String(r.LineUserID)] && !r.RevokedAt) {
      updateRow_(SHEETS.LINE_SESSIONS, r._row, { RevokedAt: new Date() }, actorEmail);
      count++;
    }
  });
  return count;
}

function startEmployeeLifecycle(employeeId, eventType, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    eventType = sanitizeText(eventType, 20).toUpperCase();
    if (['JOINER', 'MOVER', 'LEAVER'].indexOf(eventType) === -1) {
      throw new Error('ประเภท Lifecycle ต้องเป็น JOINER, MOVER หรือ LEAVER');
    }
    const employee = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', sanitizeText(employeeId, 100));
    if (!employee) throw new Error('ไม่พบพนักงาน');
    const open = employeeLifecycleRows_().some(function (r) {
      return r.employeeId === employee.EmployeeID && r.status === 'IN_PROGRESS';
    });
    if (open) throw new Error('พนักงานนี้มี Lifecycle ที่ยังไม่ปิด กรุณาปิดรายการเดิมก่อน');

    const effectiveDate = parseDate(form.effectiveDate) || new Date();
    const newDepartment = sanitizeText(form.newDepartment, 160);
    const newPosition = sanitizeText(form.newPosition, 160);
    const reason = sanitizeText(form.reason, 1000);
    const checklist = [];
    let accountsDisabled = 'No';
    let accessAffected = 0;
    let lineSessionsRevoked = 0;
    let assetsPending = lifecycleEmployeeHoldings_(employee).length;

    if (eventType === 'JOINER') {
      updateRow_(SHEETS.EMPLOYEES, employee._row, { Status: 'Active' }, user.email);
      const account = readSheetObjectsEnsured_(SHEETS.USERS, true).filter(function (r) {
        return (employee.Email && employeeTextKey_(r.Email) === employeeTextKey_(employee.Email)) ||
          (employee.EmployeeCode && employeeTextKey_(r.EmployeeCode) === employeeTextKey_(employee.EmployeeCode));
      })[0];
      checklist.push({ key: 'profile', label: 'เปิดสถานะทะเบียนพนักงาน', status: 'DONE' });
      checklist.push({
        key: 'account', label: 'สร้าง/เปิดบัญชีระบบ',
        status: account && String(account.Status).toLowerCase() === 'active' ? 'DONE' : 'PENDING'
      });
      checklist.push({
        key: 'assets', label: 'จัดสรรอุปกรณ์และ Software ตามตำแหน่ง',
        status: assetsPending ? 'DONE' : 'PENDING', detail: assetsPending + ' รายการ'
      });
    }

    if (eventType === 'MOVER') {
      if (!newDepartment && !newPosition) throw new Error('กรุณาระบุ Department หรือตำแหน่งใหม่');
      updateRow_(SHEETS.EMPLOYEES, employee._row, {
        Department: newDepartment || employee.Department,
        Position: newPosition || employee.Position
      }, user.email);
      readSheetObjectsEnsured_(SHEETS.ACCESS_REGISTRY, true).forEach(function (r) {
        if (employee.Email && employeeTextKey_(r.UserEmail) === employeeTextKey_(employee.Email) &&
          String(r.Status).toLowerCase() === 'active') {
          updateRow_(SHEETS.ACCESS_REGISTRY, r._row, {
            NextReviewDue: new Date(),
            Notes: String(r.Notes || '') + ' | ต้องทบทวนสิทธิ์หลังย้ายหน่วยงาน ' + fmtDate(new Date())
          }, user.email);
          accessAffected++;
        }
      });
      checklist.push({ key: 'profile', label: 'อัปเดต Department/ตำแหน่ง', status: 'DONE' });
      checklist.push({
        key: 'access', label: 'ทบทวนสิทธิ์เดิมตามหน้าที่ใหม่',
        status: accessAffected ? 'PENDING' : 'DONE', detail: accessAffected + ' สิทธิ์'
      });
      checklist.push({ key: 'assets', label: 'ตรวจสอบทรัพย์สินที่ต้องโอนย้าย', status: 'PENDING', detail: assetsPending + ' รายการ' });
    }

    if (eventType === 'LEAVER') {
      updateRow_(SHEETS.EMPLOYEES, employee._row, { Status: 'Inactive' }, user.email);
      readSheetObjectsEnsured_(SHEETS.USERS, true).forEach(function (r) {
        if ((employee.Email && employeeTextKey_(r.Email) === employeeTextKey_(employee.Email)) ||
          (employee.EmployeeCode && employeeTextKey_(r.EmployeeCode) === employeeTextKey_(employee.EmployeeCode))) {
          updateRow_(SHEETS.USERS, r._row, { Status: 'Inactive' }, user.email);
          accountsDisabled = 'Yes';
        }
      });
      readSheetObjectsEnsured_(SHEETS.ACCESS_REGISTRY, true).forEach(function (r) {
        if (employee.Email && employeeTextKey_(r.UserEmail) === employeeTextKey_(employee.Email) &&
          String(r.Status).toLowerCase() === 'active') {
          updateRow_(SHEETS.ACCESS_REGISTRY, r._row, {
            Status: 'Suspended',
            Notes: 'พ้นสภาพ: ' + reason
          }, user.email);
          accessAffected++;
        }
      });
      lineSessionsRevoked = revokeEmployeeLineSessions_(employee, user.email);
      checklist.push({ key: 'profile', label: 'ปิดสถานะทะเบียนพนักงาน', status: 'DONE' });
      checklist.push({ key: 'account', label: 'ระงับบัญชีระบบ', status: accountsDisabled === 'Yes' ? 'DONE' : 'N/A' });
      checklist.push({ key: 'access', label: 'ระงับสิทธิ์ระบบ', status: 'DONE', detail: accessAffected + ' สิทธิ์' });
      checklist.push({ key: 'line', label: 'ตัด LINE link และ session', status: 'DONE', detail: lineSessionsRevoked + ' session' });
      checklist.push({
        key: 'assets', label: 'คืนทรัพย์สิน/Software ทั้งหมด',
        status: assetsPending ? 'PENDING' : 'DONE', detail: assetsPending + ' รายการคงค้าง'
      });
    }

    const id = generateId('JML');
    appendRowEnsured_(SHEETS.EMPLOYEE_LIFECYCLE, {
      LifecycleID: id,
      EmployeeID: employee.EmployeeID,
      EmployeeCode: employee.EmployeeCode,
      EmployeeEmail: employee.Email,
      EventType: eventType,
      EffectiveDate: effectiveDate,
      OldDepartment: employee.Department,
      NewDepartment: newDepartment || employee.Department,
      OldPosition: employee.Position,
      NewPosition: newPosition || employee.Position,
      Status: 'IN_PROGRESS',
      AccountsDisabled: accountsDisabled,
      AccessAffected: accessAffected,
      LineSessionsRevoked: lineSessionsRevoked,
      AssetsPending: assetsPending,
      ChecklistJSON: JSON.stringify(checklist),
      Reason: reason
    }, user.email);
    writeAudit_(user, 'START_' + eventType, 'employees', SHEETS.EMPLOYEE_LIFECYCLE, id,
      employee.EmployeeCode + ' · access=' + accessAffected + ' · assets=' + assetsPending, 'success');
    notify_('', 'Employee lifecycle ' + eventType + ' ' + employee.EmployeeCode, '',
      '👤 Employee Lifecycle: ' + eventType + '\n' +
      employee.EmployeeCode + ' · ' + employeeFullName_(employee) +
      '\nสิทธิ์ที่ได้รับผล: ' + accessAffected +
      '\nทรัพย์สินคงค้าง: ' + assetsPending +
      '\nเลขที่: ' + id, 'employees', id);
    return ok({
      id: id, eventType: eventType, accessAffected: accessAffected,
      assetsPending: assetsPending, lineSessionsRevoked: lineSessionsRevoked
    });
  } catch (e) { return fail(e.message); }
}

function completeEmployeeLifecycle(lifecycleId, notes) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const row = findRowEnsured_(SHEETS.EMPLOYEE_LIFECYCLE, 'LifecycleID', sanitizeText(lifecycleId, 100));
    if (!row) throw new Error('ไม่พบ Lifecycle');
    if (String(row.Status) === 'COMPLETED') throw new Error('Lifecycle นี้ปิดแล้ว');
    const employee = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', row.EmployeeID);
    if (!employee) throw new Error('ไม่พบพนักงาน');
    const pending = lifecycleEmployeeHoldings_(employee).length;
    if (String(row.EventType) === 'LEAVER' && pending > 0) {
      updateRow_(SHEETS.EMPLOYEE_LIFECYCLE, row._row, { AssetsPending: pending }, user.email);
      throw new Error('ยังปิด Lifecycle ไม่ได้ มีทรัพย์สิน/Software คงค้าง ' + pending + ' รายการ');
    }
    let checklist = [];
    try { checklist = JSON.parse(row.ChecklistJSON || '[]'); } catch (e) {}
    checklist = checklist.map(function (item) {
      if (item.status === 'PENDING') item.status = 'DONE';
      return item;
    });
    updateRow_(SHEETS.EMPLOYEE_LIFECYCLE, row._row, {
      Status: 'COMPLETED',
      AssetsPending: pending,
      ChecklistJSON: JSON.stringify(checklist),
      CompletedAt: new Date(),
      CompletedBy: user.email,
      Notes: sanitizeText(notes, 1500)
    }, user.email);
    writeAudit_(user, 'COMPLETE_' + row.EventType, 'employees', SHEETS.EMPLOYEE_LIFECYCLE,
      lifecycleId, sanitizeText(notes, 500), 'success');
    notify_('', 'ปิด Employee lifecycle ' + row.EventType, '',
      '✅ ปิด Employee Lifecycle ' + row.EventType + '\n' +
      row.EmployeeCode + '\nเลขที่: ' + lifecycleId, 'employees', lifecycleId);
    return ok('ปิด Lifecycle ' + lifecycleId + ' เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// Live health / release monitoring
// ===================================================================

function operationalTriggerNames_() {
  return [
    'dailyNotificationCheck_',
    'processNotificationQueue_',
    'scheduledSystemBackup_',
    'monthlyRestoreDrill_',
    'dailyRetentionMaintenance_',
    'scheduledLiveHealthCheck_',
    'scheduledWorkflowAutomation_'
  ];
}

function latestSuccessfulSystemSnapshot_() {
  return readSheetObjectsEnsured_(SHEETS.BACKUP, true)
    .filter(function (r) { return r.SnapshotFileID && String(r.Result) === 'สำเร็จ'; })
    .sort(function (a, b) { return new Date(b.BackupDate || 0) - new Date(a.BackupDate || 0); })[0] || null;
}

function ensureInitialSystemSnapshotForHealth_() {
  if (getConfig_('AUTO_BACKUP_ENABLED', 'true') !== 'true') return null;
  const latest = latestSuccessfulSystemSnapshot_();
  if (latest) return latest;
  const created = createSystemSnapshotCore_('INITIAL_HEALTH_AUTO', { email: 'system', role: 'system' });
  return findRowEnsured_(SHEETS.BACKUP, 'BackupID', created.id);
}

function normalizeLiveHealthBaseUrl_(url) {
  url = String(url || '').trim();
  if (url.indexOf('https://') !== 0) return '';
  const queryAt = url.indexOf('?');
  if (queryAt > -1) url = url.substring(0, queryAt);
  return url.replace(/\/+$/, '');
}

function liveHealthPublicUrlCandidates_(deploymentUrl) {
  const seen = {};
  const urls = [];
  function add(url) {
    const normalized = normalizeLiveHealthBaseUrl_(url);
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    urls.push(normalized);
  }
  add(getConfig_('LIVE_HEALTH_PUBLIC_URL', ''));
  add(getConfig_('LINE_LOGIN_CALLBACK_URL', ''));
  add(deploymentUrl);
  return urls;
}

function liveHealthEndpointUrl_(baseUrl) {
  return baseUrl + (baseUrl.indexOf('?') > -1 ? '&' : '?') +
    'health=public&health_ts=' + Date.now();
}

function shortLiveHealthUrl_(url) {
  const m = String(url || '').match(/\/macros\/s\/([^\/]+)\/(exec|dev)/);
  return m ? ('.../s/' + m[1].substring(0, 12) + '.../' + m[2]) : String(url || '');
}

function checkPublicWebHealth_(deploymentUrl) {
  const candidates = liveHealthPublicUrlCandidates_(deploymentUrl);
  const hasConfiguredUrl = !!normalizeLiveHealthBaseUrl_(getConfig_('LIVE_HEALTH_PUBLIC_URL', '')) ||
    !!normalizeLiveHealthBaseUrl_(getConfig_('LINE_LOGIN_CALLBACK_URL', ''));
  if (!candidates.length) {
    return { name: 'Public Web App', status: 'FAIL', detail: 'ยังไม่มี Public Web App URL สำหรับตรวจ' };
  }
  const attempts = [];
  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    try {
      const response = UrlFetchApp.fetch(liveHealthEndpointUrl_(base), {
        muteHttpExceptions: true,
        followRedirects: true
      });
      const code = response.getResponseCode();
      const body = String(response.getContentText() || '');
      const marker = body.indexOf('app_life_public_client_id') > -1;
      const label = shortLiveHealthUrl_(base);
      if (code === 200 && marker) {
        return {
          name: 'Public Web App',
          status: 'PASS',
          detail: 'HTTP 200 · public marker=yes · ' + label
        };
      }
      attempts.push(label + ' HTTP ' + code + ' marker=' + (marker ? 'yes' : 'no'));
    } catch (e) {
      attempts.push(shortLiveHealthUrl_(base) + ' ' + (e && e.message ? e.message : String(e)));
    }
  }
  return {
    name: 'Public Web App',
    status: hasConfiguredUrl ? 'FAIL' : 'WARN',
    detail: attempts.slice(0, 3).join(' | ') +
      (hasConfiguredUrl ? '' : ' · ตั้ง LIVE_HEALTH_PUBLIC_URL เป็น URL /exec ที่ใช้งานจริงเพื่อยืนยัน')
  };
}

function closeResolvedLiveHealthQueue_() {
  let closed = 0;
  try {
    readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true).forEach(function (row) {
      if (String(row.RefModule) !== 'tester' || String(row.RefID) !== 'LIVE_HEALTH') return;
      if (['PENDING', 'RETRY', 'DEAD'].indexOf(String(row.Status)) === -1) return;
      updateRow_(SHEETS.NOTIFY_QUEUE, row._row, {
        Status: 'SENT',
        LastAttemptAt: new Date(),
        SentAt: new Date(),
        LastError: 'resolved by latest live health check'
      }, 'system');
      closed++;
    });
  } catch (e) {}
  return closed;
}

function runLiveHealthCheckCore_(forceLog) {
  const checks = [];
  let deploymentUrl = '';
  try { deploymentUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}

  checks.push(checkPublicWebHealth_(deploymentUrl));

  try {
    const build = getAppBuildInfo();
    const data = build && build.ok ? build.data : null;
    checks.push({
      name: 'Schema / Build',
      status: data && data.schemaReady ? 'PASS' : 'FAIL',
      detail: data
        ? data.buildId + ' · schema ' + data.installedSchemaVersion + '/' + data.schemaVersion
        : ((build && build.error) || 'อ่าน Build ไม่สำเร็จ')
    });
  } catch (e) {
    checks.push({ name: 'Schema / Build', status: 'FAIL', detail: e.message });
  }

  try {
    const names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    const missing = operationalTriggerNames_().filter(function (name) {
      return names.filter(function (v) { return v === name; }).length !== 1;
    });
    checks.push({
      name: 'Operational triggers',
      status: missing.length ? 'FAIL' : 'PASS',
      detail: missing.length ? 'ขาด/ซ้ำ: ' + missing.join(', ') : 'ครบ ' + operationalTriggerNames_().length + ' trigger'
    });
  } catch (e) {
    checks.push({ name: 'Operational triggers', status: 'FAIL', detail: e.message });
  }

  const lineReady = getConfig_('NOTIFY_LINE_ENABLED', 'true') === 'true' &&
    !!getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '') && !!getConfig_('LINE_DEFAULT_TO', '');
  checks.push({
    name: 'LINE notification',
    status: lineReady ? 'PASS' : 'FAIL',
    detail: lineReady ? 'token และ default target พร้อม' : 'กรุณาตั้ง LINE token/default target'
  });

  try {
    if (getConfig_('AUTO_BACKUP_ENABLED', 'true') !== 'true') {
      checks.push({
        name: 'Latest snapshot',
        status: 'WARN',
        detail: 'AUTO_BACKUP_ENABLED=false จึงข้ามการตรวจ System Snapshot'
      });
    } else {
      const latest = ensureInitialSystemSnapshotForHealth_();
      const maxHours = parseInt(getConfig_('BACKUP_HEALTH_MAX_HOURS', '30'), 10) || 30;
      const ageHours = latest ? Math.round((Date.now() - new Date(latest.BackupDate).getTime()) / 3600000) : null;
      checks.push({
        name: 'Latest snapshot',
        status: ageHours !== null && ageHours <= maxHours ? 'PASS' : 'FAIL',
        detail: ageHours === null ? 'ยังไม่มี System Snapshot' : ('อายุ ' + ageHours + ' ชม. · เกณฑ์ ' + maxHours + ' ชม.')
      });
    }
  } catch (e) {
    checks.push({ name: 'Latest snapshot', status: 'FAIL', detail: e.message });
  }

  const preQueueFailed = checks.filter(function (c) { return c.status === 'FAIL'; }).length;
  if (!preQueueFailed) closeResolvedLiveHealthQueue_();

  try {
    const dead = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true)
      .filter(function (r) { return String(r.Status) === 'DEAD'; }).length;
    checks.push({
      name: 'LINE dead letter',
      status: dead ? 'FAIL' : 'PASS',
      detail: dead ? ('มีข้อความส่งไม่สำเร็จถาวร ' + dead + ' รายการ') : 'ไม่มีคิว DEAD'
    });
  } catch (e) {
    checks.push({ name: 'LINE dead letter', status: 'FAIL', detail: e.message });
  }

  const failed = checks.filter(function (c) { return c.status === 'FAIL'; });
  const warned = checks.filter(function (c) { return c.status === 'WARN'; });
  const status = failed.length ? 'FAIL' : (warned.length ? 'WARN' : 'PASS');
  const detail = checks.map(function (c) { return c.name + '=' + c.status + ' (' + c.detail + ')'; }).join(' | ');
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const shouldLog = forceLog || props.getProperty('LIVE_HEALTH_LAST_STATUS') !== status ||
    props.getProperty('LIVE_HEALTH_LAST_DATE') !== today;
  if (shouldLog) {
    appendRowEnsured_(SHEETS.QA_TEST, {
      CaseID: generateId('QA'),
      Module: 'system',
      Scenario: 'LIVE_HEALTH',
      Steps: 'ตรวจ public deployment, schema, triggers, LINE, snapshot และ dead letter',
      Expected: 'ทุกหัวข้อ PASS',
      Actual: detail,
      Status: status,
      Priority: 'สูง',
      Tester: 'system',
      TestedAt: new Date(),
      Notes: deploymentUrl
    }, 'system');
    props.setProperty('LIVE_HEALTH_LAST_STATUS', status);
    props.setProperty('LIVE_HEALTH_LAST_DATE', today);
  }
  // Trigger รุ่นเก่าอาจยังรันทุกชั่วโมงจนกว่าผู้ดูแลจะติดตั้ง trigger ใหม่
  // จึงจำกัด LINE alert อัตโนมัติไม่เกินวันละครั้งไว้ที่ชั้นส่งแจ้งเตือนด้วย
  const lastAlertDate = props.getProperty('LIVE_HEALTH_LAST_ALERT_DATE');
  if (failed.length && (forceLog || lastAlertDate !== today)) {
    notify_('', 'Live health check ไม่ผ่าน', '',
      '🚨 Live Health Check ไม่ผ่าน\n' +
      failed.map(function (c) { return '• ' + c.name + ': ' + c.detail; }).join('\n'),
      'tester', 'LIVE_HEALTH');
    if (!forceLog) props.setProperty('LIVE_HEALTH_LAST_ALERT_DATE', today);
  }
  return { status: status, checks: checks, deploymentUrl: deploymentUrl };
}

function runLiveHealthCheckNow() {
  try {
    requireModule('tester', true);
    return ok(runLiveHealthCheckCore_(true));
  } catch (e) { return fail(e.message); }
}

function scheduledLiveHealthCheck_() {
  try { return runLiveHealthCheckCore_(false); }
  catch (e) {
    console.error('scheduledLiveHealthCheck_: ' + e.message);
    return { status: 'FAIL', error: e.message };
  }
}
