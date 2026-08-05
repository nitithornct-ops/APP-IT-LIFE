/**
 * Module_Task.gs
 * Task / งานของฉัน — รายการงานส่วนตัวที่ผูกกับบัญชีผู้ใช้ใน session
 *
 * ขอบเขตความเป็นส่วนตัว:
 * - ทุกการอ่าน/แก้ไขกรองด้วย OwnerEmail ฝั่ง Server
 * - ผู้ดูแลระบบก็ไม่เห็นงานของผู้ใช้อื่นผ่านโมดูลนี้
 * - ใช้สถานะ "ยกเลิก" แทนการลบถาวร เพื่อเก็บประวัติการทำงาน
 */

const TASK_STATUSES = ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'];
const TASK_PRIORITIES = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'];
const TASK_CATEGORIES = ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'];
const TASK_RECURRENCES = ['ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี'];

function taskOwnerEmail_(value) {
  return String(value || '').toLowerCase().trim();
}

function taskWithScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/** Call only while taskWithScriptLock_ owns ScriptLock. */
function taskAppendRowLocked_(sheetName, values, actorEmail) {
  const sh = ensureSheetBySchema_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const now = new Date();
  const obj = Object.assign({}, values || {});
  if (headers.indexOf('Timestamp') > -1 && !obj.Timestamp) obj.Timestamp = now;
  if (headers.indexOf('CreatedBy') > -1 && !obj.CreatedBy) obj.CreatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedBy') > -1) obj.LastUpdatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedAt') > -1) obj.LastUpdatedAt = now;
  sh.getRange(Math.max(2, sh.getLastRow() + 1), 1, 1, headers.length).setValues([
    headers.map(function (header) {
      return sheetSafeValue_(Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : '');
    })
  ]);
}

/** แปลง yyyy-MM-dd จาก input date เป็น Date เวลาเที่ยง เพื่อลดปัญหาวันเลื่อนจาก timezone */
function taskDateValue_(value) {
  if (!value) return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const dateOnly = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    if (dateOnly.getFullYear() !== Number(match[1]) ||
        dateOnly.getMonth() !== Number(match[2]) - 1 ||
        dateOnly.getDate() !== Number(match[3])) return '';
    return dateOnly;
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : parsed;
}

function taskProgressValue_(value, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === '') return Number(defaultValue) || 0;
  const progress = Number(value);
  if (!isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error('ความคืบหน้าต้องเป็นตัวเลข 0-100');
  }
  return Math.round(progress);
}

function taskIsTerminal_(status) {
  return status === 'เสร็จแล้ว' || status === 'ยกเลิก';
}

function taskRowToObj_(row) {
  const dueDays = daysUntil(row.DueDate);
  return {
    id: row.TaskID,
    title: row.Title || '',
    description: row.Description || '',
    category: row.Category || 'งานทั่วไป',
    priority: row.Priority || 'ปกติ',
    status: row.Status || 'ต้องทำ',
    startDate: safeFmtDate_(row.StartDate),
    dueDate: safeFmtDate_(row.DueDate),
    dueDays: dueDays,
    completedAt: safeFmtDateTime_(row.CompletedAt),
    progress: Math.max(0, Math.min(100, Number(row.Progress) || 0)),
    tags: row.Tags || '',
    notes: row.Notes || '',
    sortOrder: Number(row.SortOrder) || 0,
    recurrence: row.Recurrence || 'ไม่ทำซ้ำ',
    recurrenceEndDate: safeFmtDate_(row.RecurrenceEndDate),
    recurringParentId: row.RecurringParentID || '',
    subtasks: [],
    createdAt: safeFmtDateTime_(row.Timestamp),
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt),
    updatedSort: row.LastUpdatedAt ? new Date(row.LastUpdatedAt).getTime() :
      (row.Timestamp ? new Date(row.Timestamp).getTime() : 0)
  };
}

function taskRowsForOwner_(ownerEmail) {
  ownerEmail = taskOwnerEmail_(ownerEmail);
  if (!ownerEmail) return [];
  return readSheetObjectsEnsured_(SHEETS.PERSONAL_TASK).filter(function (row) {
    return taskOwnerEmail_(row.OwnerEmail) === ownerEmail;
  });
}

function taskForOwner_(taskId, user) {
  taskId = sanitizeText(taskId, 120);
  const rows = taskRowsForOwner_(user && user.email);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].TaskID) === taskId) return rows[i];
  }
  throw new Error('ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง');
}

function taskSort_(a, b) {
  const terminalA = taskIsTerminal_(a.status) ? 1 : 0;
  const terminalB = taskIsTerminal_(b.status) ? 1 : 0;
  if (terminalA !== terminalB) return terminalA - terminalB;

  const dueA = a.dueDays === null ? 999999 : a.dueDays;
  const dueB = b.dueDays === null ? 999999 : b.dueDays;
  if (dueA !== dueB) return dueA - dueB;

  const priorityRank = { 'เร่งด่วน': 0, 'สูง': 1, 'ปกติ': 2, 'ต่ำ': 3 };
  const priorityA = priorityRank.hasOwnProperty(a.priority) ? priorityRank[a.priority] : 9;
  const priorityB = priorityRank.hasOwnProperty(b.priority) ? priorityRank[b.priority] : 9;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return (Number(b.updatedSort) || 0) - (Number(a.updatedSort) || 0);
}

function getTaskModuleData() {
  try {
    const user = requireModule('task', false);
    const canViewAttachments = typeof wfHasActionPermission_ === 'function' &&
      wfHasActionPermission_(user, 'attachment.view', { moduleKey: 'task' });
    const tasks = taskRowsForOwner_(user.email).map(taskRowToObj_).sort(taskSort_);
    const byTask = {};
    tasks.forEach(function (task) { byTask[task.id] = task; });
    readSheetObjectsEnsured_(SHEETS.TASK_SUBTASK).forEach(function (row) {
      if (taskOwnerEmail_(row.OwnerEmail) !== taskOwnerEmail_(user.email) || !byTask[row.TaskID]) return;
      byTask[row.TaskID].subtasks.push({
        id: row.SubtaskID, title: row.Title || '', status: row.Status || 'ต้องทำ',
        dueDate: safeFmtDate_(row.DueDate), sortOrder: Number(row.SortOrder) || 0,
        notes: row.Notes || ''
      });
    });
    const taskCollections = [
      [SHEETS.TASK_PROGRESS, 'progressLogs', function (row) {
        return { id: row.ProgressLogID, progress: Number(row.Progress) || 0, note: row.Note || '', loggedAt: safeFmtDateTime_(row.LoggedAt || row.Timestamp) };
      }],
      [SHEETS.TASK_LINK, 'links', function (row) {
        const rawUrl = String(row.URL || '');
        const legacyDrive = taskIsGoogleDriveLocator_(rawUrl);
        return { id: row.LinkID, label: row.Label || '',
          url: legacyDrive ? '' : rawUrl,
          legacyDriveUnavailable: legacyDrive };
      }],
      [SHEETS.TASK_REMINDER, 'reminders', function (row) {
        return { id: row.ReminderID, remindAt: safeFmtDateTime_(row.RemindAt), channel: row.Channel || 'LINE', status: row.Status || 'PENDING', calendarEventId: row.CalendarEventID || '' };
      }]
    ];
    if (canViewAttachments) taskCollections.push(
      [SHEETS.TASK_ATTACHMENT, 'attachments', function (row) {
        const registryId = sanitizeText(row.RegistryAttachmentID ||
          (/^ATT[-_]/.test(String(row.AttachmentID || '')) ? row.AttachmentID : ''), 120);
        // Registry-backed rows are durable intent/index only. AttachmentLinks
        // below is the sole authority for exposing a downloadable attachment.
        if (registryId) return null;
        return { id: row.AttachmentID, attachmentId: '',
          fileName: row.FileName || '', mimeType: row.MimeType || '',
          sizeBytes: 0, canDownload: false, legacyUnavailable: true };
      }]
    );
    tasks.forEach(function (task) {
      task.progressLogs = []; task.links = []; task.attachments = []; task.reminders = [];
    });
    taskCollections.forEach(function (cfg) {
      readSheetObjectsEnsured_(cfg[0]).forEach(function (row) {
        if (taskOwnerEmail_(row.OwnerEmail) !== taskOwnerEmail_(user.email) || !byTask[row.TaskID]) return;
        const item = cfg[2](row);
        if (item) byTask[row.TaskID][cfg[1]].push(item);
      });
    });
    // AttachmentLinks is the authority. Join once for all visible personal
    // tasks and expose registry metadata only (never Drive FileID/FileURL).
    if (canViewAttachments && typeof arAttachmentDto_ === 'function') {
      const registryById = {};
      readSheetObjectsEnsured_(SHEETS.ATTACHMENT_REGISTRY, true).forEach(function (row) {
        registryById[String(row.AttachmentID || '')] = row;
      });
      readSheetObjectsEnsured_(SHEETS.ATTACHMENT_LINK, true).forEach(function (link) {
        if (String(link.ModuleKey || '') !== 'task' ||
            String(link.Status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return;
        const task = byTask[String(link.EntityID || link.RecordID || '')];
        if (!task) return;
        const attachmentId = String(link.AttachmentID || '');
        const registry = registryById[attachmentId];
        if (!registry || String(registry.Status || '').toUpperCase() !== 'ACTIVE') return;
        const dto = arAttachmentDto_(registry, null, link);
        if (!dto || !dto.canDownload) return;
        const item = {
          id: dto.attachmentId, attachmentId: dto.attachmentId,
          fileName: dto.filename, mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes, canDownload: dto.canDownload,
          uploadedAt: dto.uploadedAt, legacyUnavailable: false
        };
        const existingIndex = task.attachments.findIndex(function (current) {
          return String(current.attachmentId || '') === attachmentId;
        });
        if (existingIndex > -1) task.attachments[existingIndex] = item;
        else task.attachments.push(item);
      });
    }
    tasks.forEach(function (task) {
      task.subtasks.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      task.subtaskDone = task.subtasks.filter(function (s) { return s.status === 'เสร็จแล้ว'; }).length;
    });
    return ok({
      owner: user.email,
      canEdit: canEditModule(user.role, 'task'),
      statuses: TASK_STATUSES,
      priorities: TASK_PRIORITIES,
      categories: TASK_CATEGORIES,
      recurrences: TASK_RECURRENCES,
      tasks: tasks
    });
  } catch (e) {
    return fail(e.message);
  }
}

/** กู้คืนงานที่ยกเลิกแล้วกลับสู่รายการต้องทำ */
function restoreTask(taskId) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    if (String(task.Status) !== 'ยกเลิก') throw new Error('กู้คืนได้เฉพาะงานที่ยกเลิกแล้ว');
    updateRow_(SHEETS.PERSONAL_TASK, task._row, { Status: 'ต้องทำ', CompletedAt: '', Progress: Math.min(Number(task.Progress) || 0, 99) }, user.email);
    writeAudit_(user, 'RESTORE', 'task', SHEETS.PERSONAL_TASK, task.TaskID, task.Title, 'success');
    return ok('กู้คืนงานเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function addTaskProgressLog(taskId, form) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    form = form || {};
    const progress = taskProgressValue_(form.progress, task.Progress);
    const note = sanitizeText(form.note, 1500);
    if (!note) throw new Error('กรุณาระบุบันทึกความคืบหน้า');
    const now = new Date();
    appendRowEnsured_(SHEETS.TASK_PROGRESS, { ProgressLogID: generateId('TPL'), TaskID: task.TaskID, OwnerEmail: taskOwnerEmail_(user.email), Progress: progress, Note: note, LoggedAt: now }, user.email);
    const patch = { Progress: progress };
    if (progress === 100) { patch.Status = 'เสร็จแล้ว'; patch.CompletedAt = task.CompletedAt || now; }
    else if (String(task.Status) === 'ต้องทำ' && progress > 0) patch.Status = 'กำลังทำ';
    updateRow_(SHEETS.PERSONAL_TASK, task._row, patch, user.email);
    return ok('บันทึกความคืบหน้าแล้ว');
  } catch (e) { return fail(e.message); }
}

function addTaskLink(taskId, form) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    form = form || {};
    const url = String(form.url || '').trim();
    if (!/^https:\/\//i.test(url)) throw new Error('ลิงก์ต้องขึ้นต้นด้วย https://');
    if (taskIsGoogleDriveLocator_(url)) {
      throw new Error('Google Drive/Docs files must be uploaded through Attachment Registry');
    }
    appendRowEnsured_(SHEETS.TASK_LINK, { LinkID: generateId('TLK'), TaskID: task.TaskID, OwnerEmail: taskOwnerEmail_(user.email), Label: sanitizeText(form.label, 200) || url, URL: url.substring(0, 2000) }, user.email);
    return ok('เพิ่มลิงก์แล้ว');
  } catch (e) { return fail(e.message); }
}

function taskIsGoogleDriveLocator_(value) {
  const text = String(value || '').trim();
  return /^https:\/\/(?:drive\.google\.com|docs\.google\.com)(?:\/|$)/i.test(text);
}

function addTaskAttachment(taskId, file) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    file = file || {};
    const attachmentId = sanitizeText(file.attachmentId || file.id, 120);
    if (!attachmentId || !/^[A-Za-z0-9_-]{3,120}$/.test(attachmentId)) {
      throw new Error('กรุณาอัปโหลดไฟล์ผ่าน Attachment Registry ก่อนผูกกับงาน');
    }
    if (typeof arAssertClaimableAttachment_ !== 'function' ||
        typeof arRepairDurableAttachmentIntentLocked_ !== 'function' ||
        typeof arFinalizeDurableAttachmentRepair_ !== 'function') {
      throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
    }
    // Resolve the exact durable index first. ACTIVE is accepted only as an
    // idempotent repair of this same task/index contract.
    const preExistingIntent = readSheetObjectsEnsured_(SHEETS.TASK_ATTACHMENT, true).some(function (row) {
      return String(row.TaskID || '') === String(task.TaskID) &&
        String(row.RegistryAttachmentID || '') === attachmentId;
    });
    const preflight = preExistingIntent ? arFindAttachment_(attachmentId) :
      arAssertClaimableAttachment_(attachmentId, 'task', '', {
        recordType: 'PersonalTask', fieldName: 'Attachments',
        attachmentRole: 'TASK_ATTACHMENT', classification: 'Internal', isEvidence: false
      }, user);
    if (!preflight) throw new Error('Attachment not found');
    const registryId = String(preflight && preflight.AttachmentID || attachmentId);
    if (typeof arEnsureRegistryStorage_ === 'function') arEnsureRegistryStorage_(true);

    // A terminal task may replay only an ID already present in its durable
    // TaskAttachments index. This repairs an interrupted exact intent without
    // opening a path for adding new files after completion/cancellation.
    if (taskIsTerminal_(String(task.Status || '')) && !preExistingIntent) {
      throw new Error('งานที่เสร็จหรือยกเลิกแล้วไม่สามารถแนบไฟล์เพิ่มได้');
    }

    const indexOutcome = taskWithScriptLock_(function () {
      const lockedTask = taskForOwner_(task.TaskID, user);
      const existing = readSheetObjectsEnsured_(SHEETS.TASK_ATTACHMENT, true).filter(function (row) {
        return String(row.TaskID || '') === String(lockedTask.TaskID) &&
          String(row.RegistryAttachmentID || '') === registryId;
      })[0] || null;
      if (taskIsTerminal_(String(lockedTask.Status || '')) && !existing) {
        throw new Error('งานที่เสร็จหรือยกเลิกแล้วไม่สามารถแนบไฟล์เพิ่มได้');
      }
      if (!existing) {
        const lockedClaim = arAssertClaimableAttachmentLocked_(registryId, 'task', '', {
          recordType: 'PersonalTask', fieldName: 'Attachments',
          attachmentRole: 'TASK_ATTACHMENT', classification: 'Internal', isEvidence: false
        }, user);
        taskAppendRowLocked_(SHEETS.TASK_ATTACHMENT, {
          AttachmentID: generateId('TAT'), TaskID: lockedTask.TaskID,
          OwnerEmail: taskOwnerEmail_(user.email),
          FileName: String(lockedClaim.attachment.OriginalName || lockedClaim.attachment.FileName || file.name || 'attachment'),
          MimeType: String(lockedClaim.attachment.DetectedMimeType || lockedClaim.attachment.MimeType || file.mimeType || ''),
          FileID: '', FileURL: '', RegistryAttachmentID: registryId
        }, user.email);
      }
      // The index becomes durable intent immediately before the exact link is
      // upserted under this same ScriptLock. A mid-write error remains safely
      // replayable because the index is never rolled back or broadened.
      const repair = arRepairDurableAttachmentIntentLocked_(registryId, 'task', lockedTask.TaskID, {
        recordType: 'PersonalTask', fieldName: 'Attachments',
        attachmentRole: 'TASK_ATTACHMENT', classification: 'Internal', isEvidence: false
      }, user);
      return { duplicate: !!existing, repair: repair };
    });

    // claimRegisteredAttachment_ is intentionally replaced by the atomic
    // TaskAttachments intent/link upsert above; audit is emitted after unlock.
    const claimed = arFinalizeDurableAttachmentRepair_(indexOutcome.repair, user);
    const claimedId = String(claimed && claimed.AttachmentID || registryId);
    return ok({ attachmentId: claimedId, duplicate: indexOutcome.duplicate },
      indexOutcome.duplicate ? 'ไฟล์แนบนี้ผูกกับงานแล้ว' : 'แนบไฟล์เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function addTaskReminder(taskId, form) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    form = form || {};
    const remindAt = new Date(String(form.remindAt || ''));
    if (isNaN(remindAt.getTime()) || remindAt.getTime() <= Date.now()) throw new Error('วันเวลาแจ้งเตือนต้องเป็นเวลาในอนาคต');
    const channel = sanitizeText(form.channel, 20) || 'LINE';
    if (['LINE', 'EMAIL', 'CALENDAR'].indexOf(channel) === -1) throw new Error('ช่องทางแจ้งเตือนไม่ถูกต้อง');
    let eventId = '';
    if (channel === 'CALENDAR') {
      const end = new Date(remindAt.getTime() + 30 * 60000);
      eventId = CalendarApp.getDefaultCalendar().createEvent('[My Task] ' + task.Title, remindAt, end, { description: task.Description || '' }).getId();
    }
    appendRowEnsured_(SHEETS.TASK_REMINDER, { ReminderID: generateId('TRM'), TaskID: task.TaskID, OwnerEmail: taskOwnerEmail_(user.email), RemindAt: remindAt, Channel: channel, Status: channel === 'CALENDAR' ? 'SCHEDULED' : 'PENDING', CalendarEventID: eventId, LastSentAt: '', ErrorMessage: '' }, user.email);
    return ok(channel === 'CALENDAR' ? 'สร้างกิจกรรมใน Google Calendar แล้ว' : 'ตั้งการแจ้งเตือนแล้ว');
  } catch (e) { return fail(e.message); }
}

function addTask(form) {
  try {
    const user = requireModule('task', true);
    form = form || {};

    const title = sanitizeText(form.title, 300);
    requireFields({ 'ชื่องาน': title }, ['ชื่องาน']);

    let category = sanitizeText(form.category, 80) || 'งานทั่วไป';
    let priority = sanitizeText(form.priority, 30) || 'ปกติ';
    let status = sanitizeText(form.status, 30) || 'ต้องทำ';
    if (!isInList(category, TASK_CATEGORIES)) throw new Error('ประเภทงานไม่ถูกต้อง');
    if (!isInList(priority, TASK_PRIORITIES)) throw new Error('ความสำคัญไม่ถูกต้อง');
    if (!isInList(status, TASK_STATUSES)) throw new Error('สถานะงานไม่ถูกต้อง');

    const startDate = taskDateValue_(form.startDate);
    const dueDate = taskDateValue_(form.dueDate);
    if (form.startDate && !startDate) throw new Error('วันที่เริ่มไม่ถูกต้อง');
    if (form.dueDate && !dueDate) throw new Error('วันครบกำหนดไม่ถูกต้อง');
    if (startDate && dueDate && dueDate.getTime() < startDate.getTime()) {
      throw new Error('วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม');
    }

    let progress = taskProgressValue_(form.progress, 0);
    let completedAt = '';
    if (status === 'ยกเลิก') {
      completedAt = '';
    } else if (status === 'เสร็จแล้ว' || progress === 100) {
      status = 'เสร็จแล้ว';
      progress = 100;
      completedAt = new Date();
    }

    const taskId = generateId('TSK');
    appendRowEnsured_(SHEETS.PERSONAL_TASK, {
      TaskID: taskId,
      OwnerEmail: taskOwnerEmail_(user.email),
      Title: title,
      Description: sanitizeText(form.description, 2000),
      Category: category,
      Priority: priority,
      Status: status,
      StartDate: startDate,
      DueDate: dueDate,
      CompletedAt: completedAt,
      Progress: progress,
      Tags: sanitizeText(form.tags, 300),
      Notes: sanitizeText(form.notes, 1500)
      ,SortOrder: Date.now()
      ,Recurrence: isInList(sanitizeText(form.recurrence, 30) || 'ไม่ทำซ้ำ', TASK_RECURRENCES) ? sanitizeText(form.recurrence, 30) || 'ไม่ทำซ้ำ' : 'ไม่ทำซ้ำ'
      ,RecurrenceEndDate: taskDateValue_(form.recurrenceEndDate)
      ,RecurringParentID: ''
    }, user.email);

    writeAudit_(user, 'CREATE', 'task', SHEETS.PERSONAL_TASK, taskId,
      category + ' · ' + priority + ' · ' + status, 'success');
    return ok('เพิ่มงานเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function updateTask(taskId, form) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    form = form || {};

    const title = sanitizeText(form.title, 300);
    requireFields({ 'ชื่องาน': title }, ['ชื่องาน']);

    const category = sanitizeText(form.category, 80) || 'งานทั่วไป';
    const priority = sanitizeText(form.priority, 30) || 'ปกติ';
    let status = sanitizeText(form.status, 30) || String(task.Status || 'ต้องทำ');
    if (!isInList(category, TASK_CATEGORIES)) throw new Error('ประเภทงานไม่ถูกต้อง');
    if (!isInList(priority, TASK_PRIORITIES)) throw new Error('ความสำคัญไม่ถูกต้อง');
    if (!isInList(status, TASK_STATUSES)) throw new Error('สถานะงานไม่ถูกต้อง');

    const startDate = taskDateValue_(form.startDate);
    const dueDate = taskDateValue_(form.dueDate);
    if (form.startDate && !startDate) throw new Error('วันที่เริ่มไม่ถูกต้อง');
    if (form.dueDate && !dueDate) throw new Error('วันครบกำหนดไม่ถูกต้อง');
    if (startDate && dueDate && dueDate.getTime() < startDate.getTime()) {
      throw new Error('วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม');
    }

    let progress = taskProgressValue_(form.progress, task.Progress);
    let completedAt = '';
    if (status === 'ยกเลิก') {
      completedAt = '';
    } else if (status === 'เสร็จแล้ว' || progress === 100) {
      status = 'เสร็จแล้ว';
      progress = 100;
      completedAt = task.CompletedAt || new Date();
    }

    updateRow_(SHEETS.PERSONAL_TASK, task._row, {
      Title: title,
      Description: sanitizeText(form.description, 2000),
      Category: category,
      Priority: priority,
      Status: status,
      StartDate: startDate,
      DueDate: dueDate,
      CompletedAt: completedAt,
      Progress: progress,
      Tags: sanitizeText(form.tags, 300),
      Notes: sanitizeText(form.notes, 1500)
      ,Recurrence: isInList(sanitizeText(form.recurrence, 30) || 'ไม่ทำซ้ำ', TASK_RECURRENCES) ? sanitizeText(form.recurrence, 30) || 'ไม่ทำซ้ำ' : 'ไม่ทำซ้ำ'
      ,RecurrenceEndDate: taskDateValue_(form.recurrenceEndDate)
    }, user.email);
    if (status === 'เสร็จแล้ว') {
      const recurringTask = Object.assign({}, task, {
        Recurrence: sanitizeText(form.recurrence, 30) || task.Recurrence,
        RecurrenceEndDate: taskDateValue_(form.recurrenceEndDate) || task.RecurrenceEndDate,
        DueDate: dueDate, StartDate: startDate
      });
      createNextRecurringTask_(recurringTask, user);
    }

    writeAudit_(user, 'UPDATE', 'task', SHEETS.PERSONAL_TASK, task.TaskID,
      category + ' · ' + priority + ' · ' + status + ' · ' + progress + '%', 'success');
    return ok('อัปเดตงานเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function setTaskStatus(taskId, status) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    status = sanitizeText(status, 30);
    if (!isInList(status, TASK_STATUSES)) throw new Error('สถานะงานไม่ถูกต้อง');

    const patch = { Status: status };
    if (status === 'เสร็จแล้ว') {
      patch.Progress = 100;
      patch.CompletedAt = task.CompletedAt || new Date();
    } else if (status === 'กำลังทำ') {
      const currentProgress = Number(task.Progress) || 0;
      patch.Progress = currentProgress > 0 && currentProgress < 100 ? currentProgress : 10;
      patch.CompletedAt = '';
    } else if (status === 'ต้องทำ') {
      patch.Progress = taskIsTerminal_(String(task.Status)) ? 0 : Math.min(Number(task.Progress) || 0, 99);
      patch.CompletedAt = '';
    } else {
      patch.Progress = Math.min(Number(task.Progress) || 0, 99);
      patch.CompletedAt = '';
    }

    updateRow_(SHEETS.PERSONAL_TASK, task._row, patch, user.email);
    if (status === 'เสร็จแล้ว') createNextRecurringTask_(task, user);
    writeAudit_(user, 'UPDATE_STATUS', 'task', SHEETS.PERSONAL_TASK, task.TaskID,
      String(task.Status || '') + ' -> ' + status, 'success');
    return ok('ปรับสถานะเป็น "' + status + '" แล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

function nextTaskRecurrenceDate_(date, recurrence) {
  if (!date || recurrence === 'ไม่ทำซ้ำ') return '';
  const next = new Date(date); next.setHours(12, 0, 0, 0);
  if (recurrence === 'รายวัน') next.setDate(next.getDate() + 1);
  else if (recurrence === 'รายสัปดาห์') next.setDate(next.getDate() + 7);
  else if (recurrence === 'รายเดือน') next.setMonth(next.getMonth() + 1);
  else if (recurrence === 'รายไตรมาส') next.setMonth(next.getMonth() + 3);
  else if (recurrence === 'รายปี') next.setFullYear(next.getFullYear() + 1);
  else return '';
  return next;
}

function createNextRecurringTask_(task, user) {
  const recurrence = String(task.Recurrence || 'ไม่ทำซ้ำ');
  const nextDue = nextTaskRecurrenceDate_(task.DueDate, recurrence);
  if (!nextDue) return false;
  const end = taskDateValue_(task.RecurrenceEndDate);
  if (end && nextDue.getTime() > end.getTime()) return false;
  const parentId = String(task.RecurringParentID || task.TaskID);
  const exists = taskRowsForOwner_(user.email).some(function (r) {
    const due = taskDateValue_(r.DueDate);
    return String(r.RecurringParentID || '') === parentId && due && due.getTime() === nextDue.getTime();
  });
  if (exists) return false;
  const nextStart = task.StartDate ? nextTaskRecurrenceDate_(task.StartDate, recurrence) : '';
  appendRowEnsured_(SHEETS.PERSONAL_TASK, {
    TaskID: generateId('TSK'), OwnerEmail: taskOwnerEmail_(user.email), Title: task.Title,
    Description: task.Description, Category: task.Category, Priority: task.Priority,
    Status: 'ต้องทำ', StartDate: nextStart, DueDate: nextDue, CompletedAt: '', Progress: 0,
    Tags: task.Tags, Notes: task.Notes, SortOrder: Date.now(), Recurrence: recurrence,
    RecurrenceEndDate: end, RecurringParentID: parentId, LastReminderDate: ''
  }, user.email);
  return true;
}

function setTaskBoardState(taskId, status, sortOrder) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);
    status = sanitizeText(status, 30);
    if (!isInList(status, TASK_STATUSES)) throw new Error('สถานะงานไม่ถูกต้อง');
    const order = Number(sortOrder);
    updateRow_(SHEETS.PERSONAL_TASK, task._row, {
      Status: status, SortOrder: isFinite(order) ? order : Date.now(),
      Progress: status === 'เสร็จแล้ว' ? 100 : Math.min(Number(task.Progress) || (status === 'กำลังทำ' ? 10 : 0), 99),
      CompletedAt: status === 'เสร็จแล้ว' ? (task.CompletedAt || new Date()) : ''
    }, user.email);
    if (status === 'เสร็จแล้ว') createNextRecurringTask_(task, user);
    return ok('ย้ายงานเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function addTaskSubtask(taskId, form) {
  try {
    const user = requireModule('task', true);
    taskForOwner_(taskId, user);
    form = form || {};
    const title = sanitizeText(form.title, 300);
    if (!title) throw new Error('กรุณาระบุชื่อรายการย่อย');
    appendRowEnsured_(SHEETS.TASK_SUBTASK, {
      SubtaskID: generateId('SUB'), TaskID: taskId, OwnerEmail: taskOwnerEmail_(user.email),
      Title: title, Status: 'ต้องทำ', DueDate: taskDateValue_(form.dueDate),
      SortOrder: Date.now(), CompletedAt: '', Notes: sanitizeText(form.notes, 800)
    }, user.email);
    return ok('เพิ่มรายการย่อยแล้ว');
  } catch (e) { return fail(e.message); }
}

function taskSubtaskForOwner_(subtaskId, user) {
  const row = findRow_(SHEETS.TASK_SUBTASK, 'SubtaskID', sanitizeText(subtaskId, 120));
  if (!row || taskOwnerEmail_(row.OwnerEmail) !== taskOwnerEmail_(user.email)) throw new Error('ไม่พบรายการย่อยหรือไม่มีสิทธิ์');
  return row;
}

function setTaskSubtaskStatus(subtaskId, status) {
  try {
    const user = requireModule('task', true);
    const row = taskSubtaskForOwner_(subtaskId, user);
    status = status === 'เสร็จแล้ว' ? 'เสร็จแล้ว' : 'ต้องทำ';
    updateRow_(SHEETS.TASK_SUBTASK, row._row, { Status: status, CompletedAt: status === 'เสร็จแล้ว' ? new Date() : '' }, user.email);
    return ok('อัปเดตรายการย่อยแล้ว');
  } catch (e) { return fail(e.message); }
}

function cancelTaskSubtask(subtaskId) {
  try {
    const user = requireModule('task', true);
    const row = taskSubtaskForOwner_(subtaskId, user);
    updateRow_(SHEETS.TASK_SUBTASK, row._row, { Status: 'ยกเลิก', CompletedAt: '' }, user.email);
    return ok('ยกเลิกรายการย่อยแล้ว');
  } catch (e) { return fail(e.message); }
}

/** เรียกจาก dailyNotificationCheck_: แจ้ง LINE งานส่วนตัวที่ครบกำหนดภายใน 1 วัน โดยไม่ส่งซ้ำในวันเดียวกัน */
function runTaskAutomation_() {
  let queued = 0;
  const todayKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  readSheetObjectsEnsured_(SHEETS.PERSONAL_TASK).forEach(function (row) {
    if (taskIsTerminal_(String(row.Status || '')) || !row.DueDate) return;
    const remaining = daysUntil(row.DueDate);
    if (remaining === null || remaining > 1 || String(row.LastReminderDate || '') === todayKey) return;
    const when = remaining < 0 ? 'เลยกำหนด ' + Math.abs(remaining) + ' วัน' : (remaining === 0 ? 'ครบกำหนดวันนี้' : 'ครบกำหนดพรุ่งนี้');
    notify_(row.OwnerEmail, '[Task] ' + when + ': ' + row.Title, '',
      'Task: ' + row.Title + '\n' + when + (row.DueDate ? '\nกำหนด: ' + fmtDate(row.DueDate) : ''), 'task', row.TaskID);
    updateRow_(SHEETS.PERSONAL_TASK, row._row, { LastReminderDate: todayKey }, row.OwnerEmail || 'SYSTEM');
    queued++;
  });
  const now = new Date();
  const tasksById = {};
  readSheetObjectsEnsured_(SHEETS.PERSONAL_TASK).forEach(function (row) { tasksById[String(row.TaskID)] = row; });
  readSheetObjectsEnsured_(SHEETS.TASK_REMINDER).forEach(function (reminder) {
    if (String(reminder.Status) !== 'PENDING') return;
    const remindAt = reminder.RemindAt instanceof Date ? reminder.RemindAt : new Date(reminder.RemindAt);
    if (isNaN(remindAt.getTime()) || remindAt.getTime() > now.getTime()) return;
    const task = tasksById[String(reminder.TaskID)];
    if (!task || taskIsTerminal_(String(task.Status || ''))) {
      updateRow_(SHEETS.TASK_REMINDER, reminder._row, { Status: 'CANCELLED', ErrorMessage: 'Task is closed' }, 'SYSTEM');
      return;
    }
    try {
      const channel = String(reminder.Channel || 'LINE');
      const subject = '[My Task] ' + task.Title;
      const text = 'ถึงเวลาทำงาน: ' + task.Title + (task.DueDate ? '\nกำหนด: ' + fmtDate(task.DueDate) : '');
      if (channel === 'EMAIL') sendEmailNotify_(reminder.OwnerEmail, subject, '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>', 'task', task.TaskID);
      else notify_(reminder.OwnerEmail, subject, '', text, 'task', task.TaskID);
      updateRow_(SHEETS.TASK_REMINDER, reminder._row, { Status: 'SENT', LastSentAt: now, ErrorMessage: '' }, 'SYSTEM');
      queued++;
    } catch (e) {
      updateRow_(SHEETS.TASK_REMINDER, reminder._row, { Status: 'ERROR', ErrorMessage: String(e.message || e).substring(0, 500) }, 'SYSTEM');
    }
  });
  return queued;
}

/**
 * เลื่อนเฉพาะวันครบกำหนด — ใช้เมื่อผู้ใช้ลากงานบนปฏิทิน (FullCalendar eventDrop)
 * ส่ง dateStr = '' เพื่อล้างวันครบกำหนด
 */
function setTaskDueDate(taskId, dateStr) {
  try {
    const user = requireModule('task', true);
    const task = taskForOwner_(taskId, user);

    const dueDate = taskDateValue_(dateStr);
    if (dateStr && !dueDate) throw new Error('วันครบกำหนดไม่ถูกต้อง');

    const startDate = task.StartDate ? taskDateValue_(task.StartDate) : '';
    if (startDate && dueDate && dueDate.getTime() < startDate.getTime()) {
      throw new Error('วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม');
    }

    updateRow_(SHEETS.PERSONAL_TASK, task._row, { DueDate: dueDate }, user.email);
    writeAudit_(user, 'UPDATE_DUE', 'task', SHEETS.PERSONAL_TASK, task.TaskID,
      String(task.Title || '') + ' → ' + (dueDate ? fmtDate(dueDate) : '(ล้างกำหนด)'), 'success');
    return ok('เลื่อนกำหนดเป็น ' + (dueDate ? fmtDate(dueDate) : 'ไม่กำหนด') + ' แล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * ใช้โดยกระดิ่งแจ้งเตือนบน topbar เท่านั้น
 * คืนงานของเจ้าของที่เลยกำหนด/ครบวันนี้/ใกล้ครบภายใน 3 วัน สูงสุด 5 รายการ
 */
function getTaskNotificationSummary_(ownerEmail) {
  const relevant = taskRowsForOwner_(ownerEmail)
    .map(taskRowToObj_)
    .filter(function (task) {
      return !taskIsTerminal_(task.status) && task.dueDays !== null && task.dueDays <= 3;
    })
    .sort(taskSort_);

  const items = relevant
    .slice(0, 5)
    .map(function (task) {
      let when;
      if (task.dueDays < 0) when = 'เลยกำหนด ' + Math.abs(task.dueDays) + ' วัน';
      else if (task.dueDays === 0) when = 'ครบกำหนดวันนี้';
      else when = 'ครบกำหนดในอีก ' + task.dueDays + ' วัน';
      return {
        title: task.title,
        sub: when + (task.dueDate ? ' · ' + task.dueDate : ''),
        overdue: task.dueDays < 0
      };
    });

  const urgent = relevant.filter(function (task) { return task.dueDays <= 0; }).length;

  return { urgent: urgent, items: items };
}
