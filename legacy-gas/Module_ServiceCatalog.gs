/**
 * Module_ServiceCatalog.gs
 * Service Catalog + Request Fulfilment
 *
 * แยก "คำขอบริการ" ออกจาก Incident/Ticket โดยใช้ Catalog definition, dynamic form,
 * approval routing, checklist และ timeline ที่ถูก snapshot ต่อคำขอ เพื่อให้การแก้ Catalog
 * ภายหลังไม่เปลี่ยนหลักฐานของคำขอเดิม
 */

const SVC_CATALOG_STATUS = ['ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก'];
const SVC_APPROVAL_MODE = ['ไม่ต้องอนุมัติ', 'หัวหน้างาน', 'ผู้อนุมัติที่กำหนด'];
const SVC_CLOSE_MODE = ['ผู้ขอยืนยัน', 'IT ปิดงาน'];
const SVC_REQUEST_PRIORITY = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'];
const SVC_REQUEST_STATUS = {
  PENDING_APPROVAL: 'รออนุมัติ',
  PENDING_ASSIGNMENT: 'รอมอบหมาย',
  IN_PROGRESS: 'กำลังดำเนินการ',
  WAITING_USER: 'รอผู้ใช้งาน',
  WAITING_VENDOR: 'รอผู้ให้บริการ',
  PENDING_CONFIRMATION: 'รอยืนยันผล',
  CLOSED: 'ปิดงาน',
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก'
};
const SVC_TASK_STATUS = ['รอดำเนินการ', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ข้าม'];
const SVC_TERMINAL_STATUS = [SVC_REQUEST_STATUS.CLOSED, SVC_REQUEST_STATUS.REJECTED,
  SVC_REQUEST_STATUS.CANCELLED];
const SVC_APPROVER_ROLES = [ROLES.APPROVER, ROLES.IT_ADMIN, ROLES.EXECUTIVE, ROLES.DPO];

function getServiceCatalogModuleData() {
  try {
    const user = requireModule('serviceCatalog', false);
    svcEnsureSheets_();

    const canAdmin = user.role === ROLES.IT_ADMIN;
    const canFulfill = user.role === ROLES.IT_ADMIN;
    const catalogRows = readSheetObjectsEnsured_(SHEETS.SERVICE_CATALOG);
    const requestRows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST)
      .sort(function (a, b) { return svcTime_(b.Timestamp) - svcTime_(a.Timestamp); });
    const taskRows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_TASK);
    const historyRows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY);
    const workflowDefinitions = canAdmin && SHEETS.WORKFLOW_DEFINITION ?
      readSheetObjectsEnsured_(SHEETS.WORKFLOW_DEFINITION, true).filter(function (r) {
        return String(r.ModuleKey || '') === 'serviceCatalog' && String(r.Status || '') === 'ใช้งาน';
      }).map(function (r) {
        return {
          id: String(r.DefinitionID || ''),
          code: String(r.WorkflowCode || ''),
          name: String(r.Name || r.WorkflowName || r.WorkflowCode || ''),
          version: Number(r.Version || 1),
          isDefault: svcIsYes_(r.IsDefault)
        };
      }) : [];

    const tasksByRequest = {}, historyByRequest = {};
    taskRows.forEach(function (r) {
      const key = String(r.RequestID || '');
      (tasksByRequest[key] = tasksByRequest[key] || []).push(r);
    });
    historyRows.forEach(function (r) {
      const key = String(r.RequestID || '');
      (historyByRequest[key] = historyByRequest[key] || []).push(r);
    });

    const catalog = catalogRows
      .filter(function (r) {
        return canAdmin || (String(r.Status) === 'ใช้งาน' && svcIsEligible_(r, user));
      })
      .sort(function (a, b) {
        return (parseInt(a.DisplayOrder, 10) || 9999) - (parseInt(b.DisplayOrder, 10) || 9999) ||
          String(a.ServiceName || '').localeCompare(String(b.ServiceName || ''));
      })
      .map(function (r) { return svcCatalogDto_(r, canAdmin); });

    const visibleRows = requestRows.filter(function (r) { return svcCanViewRequest_(r, user); });
    const visibleRequests = visibleRows.map(function (r) {
      const internal = canAdmin || svcCanApproveRequest_(r, user);
      return svcRequestDto_(r, tasksByRequest[String(r.RequestID)] || [],
        historyByRequest[String(r.RequestID)] || [], internal, canAdmin);
    });
    const myRequests = visibleRequests.filter(function (r) {
      return String(r.requesterEmail).toLowerCase() === user.email;
    });
    const pendingApprovals = visibleRequests.filter(function (r) {
      const source = visibleRows.filter(function (row) { return String(row.RequestID) === String(r.id); })[0];
      return r.status === SVC_REQUEST_STATUS.PENDING_APPROVAL && source &&
        svcCanApproveRequest_(source, user);
    });
    const fulfillmentQueue = canFulfill ? visibleRequests.filter(function (r) {
      return [SVC_REQUEST_STATUS.PENDING_ASSIGNMENT, SVC_REQUEST_STATUS.IN_PROGRESS,
        SVC_REQUEST_STATUS.WAITING_USER, SVC_REQUEST_STATUS.WAITING_VENDOR,
        SVC_REQUEST_STATUS.PENDING_CONFIRMATION].indexOf(r.status) > -1;
    }) : [];

    return ok(svcClientSafe_({
      role: user.role,
      userEmail: user.email,
      canAdmin: canAdmin,
      canFulfill: canFulfill,
      canSubmit: true,
      catalogStatuses: SVC_CATALOG_STATUS,
      approvalModes: SVC_APPROVAL_MODE,
      closeModes: SVC_CLOSE_MODE,
      requestStatuses: Object.keys(SVC_REQUEST_STATUS).map(function (k) { return SVC_REQUEST_STATUS[k]; }),
      workStatuses: [SVC_REQUEST_STATUS.IN_PROGRESS, SVC_REQUEST_STATUS.WAITING_USER,
        SVC_REQUEST_STATUS.WAITING_VENDOR, SVC_REQUEST_STATUS.PENDING_CONFIRMATION,
        SVC_REQUEST_STATUS.CLOSED],
      taskStatuses: SVC_TASK_STATUS,
      priorities: SVC_REQUEST_PRIORITY,
      assignees: canFulfill ? svcItAssignees_() : [],
      workflowDefinitions: workflowDefinitions,
      catalog: catalog,
      myRequests: myRequests,
      pendingApprovals: pendingApprovals,
      fulfillmentQueue: fulfillmentQueue,
      allRequests: canAdmin ? visibleRequests : []
    }));
  } catch (e) {
    return fail(e.message, 'SERVICE_CATALOG_LOAD_FAILED');
  }
}

function saveServiceCatalogItem(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    ensureSheetBySchema_(SHEETS.SERVICE_CATALOG);

    const name = sanitizeText(form.serviceName || form.name, 200);
    let code = sanitizeText(form.serviceCode || form.code, 60).toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    requireFields({ ServiceName: name, ServiceCode: code }, ['ServiceName', 'ServiceCode']);
    if (code.length < 2) throw new Error('รหัสบริการต้องมีอย่างน้อย 2 ตัวอักษร');

    const approvalMode = sanitizeText(form.approvalMode, 80) || SVC_APPROVAL_MODE[0];
    const closeMode = sanitizeText(form.closeMode, 80) || SVC_CLOSE_MODE[0];
    const status = sanitizeText(form.status, 40) || 'ร่าง';
    if (!isInList(approvalMode, SVC_APPROVAL_MODE)) throw new Error('รูปแบบการอนุมัติไม่ถูกต้อง');
    if (!isInList(closeMode, SVC_CLOSE_MODE)) throw new Error('รูปแบบการปิดงานไม่ถูกต้อง');
    if (!isInList(status, SVC_CATALOG_STATUS)) throw new Error('สถานะ Catalog ไม่ถูกต้อง');

    const approver = sanitizeText(form.approver, 160).toLowerCase();
    if (approvalMode === 'ผู้อนุมัติที่กำหนด' && !isValidEmail(approver)) {
      throw new Error('กรุณาระบุอีเมลผู้อนุมัติที่กำหนดให้ถูกต้อง');
    }
    const formSchema = svcNormalizeFormSchema_(form.formSchema !== undefined ? form.formSchema : form.formSchemaJSON);
    const checklist = svcNormalizeChecklist_(form.checklist !== undefined ? form.checklist : form.checklistJSON);
    const workflow = svcNormalizeWorkflowDefinition_(
      form.workflow !== undefined ? form.workflow : form.workflowJSON);
    const slaHours = svcClamp_(form.slaHours, 1, 720, 24);
    const attachmentRequired = svcYesNo_(form.attachmentRequired);
    const catalogId = sanitizeText(form.catalogId || form.id, 80);
    const currentCatalog = catalogId ? findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', catalogId) : null;
    const hasOwn = function (key) { return Object.prototype.hasOwnProperty.call(form, key); };
    const workflowDefinitionId = sanitizeText(
      hasOwn('workflowDefinitionId') ? form.workflowDefinitionId :
        (currentCatalog && currentCatalog.WorkflowDefinitionID), 120);
    if (workflowDefinitionId) {
      const workflowDefinition = findRowEnsured_(SHEETS.WORKFLOW_DEFINITION,
        'DefinitionID', workflowDefinitionId);
      if (!workflowDefinition || String(workflowDefinition.ModuleKey || '') !== 'serviceCatalog' ||
        String(workflowDefinition.Status || '') !== 'ใช้งาน') {
        throw new Error('Workflow Definition ต้องเป็นรายการของ Service Catalog ที่กำลังใช้งาน');
      }
      const workflowNow = Date.now();
      if ((workflowDefinition.ActiveFrom && svcTime_(workflowDefinition.ActiveFrom) > workflowNow) ||
          (workflowDefinition.ActiveTo && svcTime_(workflowDefinition.ActiveTo) < workflowNow)) {
        throw new Error('Workflow Definition อยู่นอกช่วงเวลาที่เปิดใช้งาน');
      }
      if (String(workflowDefinition.Mode || 'SEQUENTIAL').toUpperCase() !== 'SEQUENTIAL') {
        throw new Error('Service Catalog รองรับ Workflow Definition แบบ SEQUENTIAL เท่านั้น');
      }
    }
    const targetRaw = sanitizeText(hasOwn('fulfillmentTarget') ? form.fulfillmentTarget :
      (currentCatalog && currentCatalog.FulfillmentTarget), 80);
    const fulfillmentTarget = targetRaw && typeof intNormalizeTarget_ === 'function' ?
      intNormalizeTarget_(targetRaw) : '';
    if (targetRaw && !fulfillmentTarget) {
      throw new Error('Fulfillment Target ต้องเป็น access, ticket, asset หรือ change');
    }
    const autoCreateTarget = svcYesNo_(hasOwn('autoCreateTarget') ? form.autoCreateTarget :
      (currentCatalog && currentCatalog.AutoCreateTarget));
    if (svcIsYes_(autoCreateTarget) && !fulfillmentTarget) {
      throw new Error('กรุณาเลือก Fulfillment Target ก่อนเปิด Auto Create');
    }
    const mappingRaw = hasOwn('targetMapping') ? form.targetMapping :
      (hasOwn('targetMappingJSON') ? form.targetMappingJSON :
        (currentCatalog && currentCatalog.TargetMappingJSON));
    const targetMapping = svcNormalizeTargetMapping_(mappingRaw);

    const payload = {
      ServiceCode: code,
      ServiceName: name,
      Category: sanitizeText(form.category, 120),
      Description: sanitizeText(form.description, 3000),
      Eligibility: svcNormalizeEligibility_(form.eligibility),
      FormSchemaJSON: JSON.stringify(formSchema),
      AttachmentRequired: attachmentRequired,
      SLAHours: slaHours,
      ApprovalMode: approvalMode,
      Approver: approvalMode === 'ผู้อนุมัติที่กำหนด' ? approver : '',
      FulfillmentGroup: sanitizeText(form.fulfillmentGroup, 160) || 'IT Service Desk',
      ChecklistJSON: JSON.stringify(checklist),
      WorkflowJSON: JSON.stringify(workflow),
      WorkflowDefinitionID: workflowDefinitionId,
      FulfillmentTarget: fulfillmentTarget,
      AutoCreateTarget: autoCreateTarget,
      TargetMappingJSON: JSON.stringify(targetMapping),
      CloseMode: closeMode,
      CloseCondition: sanitizeText(form.closeCondition, 1000),
      Status: status,
      Owner: sanitizeText(form.owner, 160) || user.email,
      Notes: sanitizeText(form.notes, 1000)
    };

    const outcome = svcWithScriptLock_(function () {
      const duplicate = readSheetObjectsEnsured_(SHEETS.SERVICE_CATALOG).some(function (r) {
        return String(r.ServiceCode || '').toUpperCase() === code && String(r.CatalogID) !== catalogId;
      });
      if (duplicate) throw new Error('มีรหัสบริการ ' + code + ' อยู่แล้ว');

      if (catalogId) {
        const existing = findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', catalogId);
        if (!existing) throw new Error('ไม่พบรายการบริการที่ต้องการแก้ไข');
        if (String(existing.Status) === 'ยกเลิก') throw new Error('รายการที่ยกเลิกแล้วไม่สามารถแก้ไขได้');
        if (status === 'ยกเลิก') {
          const active = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).some(function (r) {
            return String(r.CatalogID) === catalogId && !svcIsTerminal_(r.Status);
          });
          if (active) throw new Error('ยังมีคำขอของบริการนี้ที่ไม่จบงาน กรุณาใช้สถานะระงับแทน');
        }
        payload.Version = (parseInt(existing.Version, 10) || 0) + 1;
        if (status === 'ใช้งาน' && !existing.PublishedAt) payload.PublishedAt = new Date();
        svcUpdateRowLocked_(SHEETS.SERVICE_CATALOG, existing._row, payload, user.email);
        svcWriteAuditLocked_(user, 'UPDATE_CATALOG', 'serviceCatalog', SHEETS.SERVICE_CATALOG,
          catalogId, code + ' v' + payload.Version, 'success');
        return { id: catalogId, version: payload.Version, created: false };
      }

      payload.CatalogID = generateId('CAT');
      payload.Version = 1;
      if (status === 'ใช้งาน') payload.PublishedAt = new Date();
      svcAppendRowLocked_(SHEETS.SERVICE_CATALOG, payload, user.email);
      svcWriteAuditLocked_(user, 'CREATE_CATALOG', 'serviceCatalog', SHEETS.SERVICE_CATALOG,
        payload.CatalogID, code, 'success');
      return { id: payload.CatalogID, version: 1, created: true };
    });
    return ok({ id: outcome.id, version: outcome.version },
      outcome.created ? 'สร้างรายการบริการแล้ว' : 'อัปเดตรายการบริการแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_CATALOG_SAVE_FAILED');
  }
}

function setServiceCatalogStatus(catalogId, status) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    catalogId = sanitizeText(catalogId, 80);
    status = sanitizeText(status, 40);
    if (!isInList(status, SVC_CATALOG_STATUS)) throw new Error('สถานะ Catalog ไม่ถูกต้อง');
    svcWithScriptLock_(function () {
      const row = findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', catalogId);
      if (!row) throw new Error('ไม่พบรายการบริการ');
      if (String(row.Status) === 'ยกเลิก' && status !== 'ยกเลิก') {
        throw new Error('รายการบริการที่ยกเลิกแล้วไม่สามารถเปิดกลับได้');
      }
      if (status === 'ยกเลิก') {
        const active = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).some(function (r) {
          return String(r.CatalogID) === catalogId && !svcIsTerminal_(r.Status);
        });
        if (active) throw new Error('ยังมีคำขอของบริการนี้ที่ไม่จบงาน กรุณาใช้สถานะระงับแทน');
      }
      const patch = { Status: status };
      if (status === 'ใช้งาน' && !row.PublishedAt) patch.PublishedAt = new Date();
      svcUpdateRowLocked_(SHEETS.SERVICE_CATALOG, row._row, patch, user.email);
      svcWriteAuditLocked_(user, 'UPDATE_CATALOG_STATUS', 'serviceCatalog', SHEETS.SERVICE_CATALOG,
        catalogId, status, 'success');
    });
    return ok({ id: catalogId, status: status }, 'ปรับสถานะรายการบริการแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_CATALOG_STATUS_FAILED');
  }
}

function submitServiceRequest(catalogOrForm, requestForm, idempotencyKey) {
  let unclaimedAttachmentUrl = '';
  let unclaimedAttachmentIds = [];
  let attachmentActor = null;
  let durableRequestId = '';
  let requestIdempotencyKey = '';
  try {
    const user = requireModule('serviceCatalog', true);
    attachmentActor = user;
    let form;
    if (catalogOrForm && typeof catalogOrForm === 'object') {
      form = catalogOrForm;
    } else {
      form = Object.assign({}, requestForm || {}, { catalogId: catalogOrForm, idempotencyKey: idempotencyKey });
    }
    form = form || {};
    svcEnsureSheets_();

    const catalogId = sanitizeText(form.catalogId || form.serviceId, 80);
    const catalog = findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', catalogId);
    if (!catalog || String(catalog.Status) !== 'ใช้งาน') throw new Error('บริการนี้ไม่เปิดรับคำขอ');
    if (!svcIsEligible_(catalog, user)) {
      writeAudit_(user, 'REQUEST_DENIED', 'serviceCatalog', SHEETS.SERVICE_CATALOG,
        catalogId, 'ไม่ผ่าน eligibility', 'denied');
      throw new Error('ท่านไม่มีสิทธิ์ขอบริการรายการนี้');
    }

    const answers = svcValidateAnswers_(catalog.FormSchemaJSON,
      form.answers || form.requestDetails || form.details || {});
    const stagedAttachmentIds = svcNormalizeAttachmentIds_(
      form.attachmentIds !== undefined ? form.attachmentIds : form.attachmentIdsJSON);
    unclaimedAttachmentIds = stagedAttachmentIds.slice();
    const key = sanitizeText(form.idempotencyKey, 160) || Utilities.getUuid();
    requestIdempotencyKey = key;
    const preExistingRequest = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).filter(function (row) {
      return String(row.RequesterEmail || '').toLowerCase() === user.email &&
        String(row.IdempotencyKey || '') === key;
    })[0] || null;
    if (!preExistingRequest) stagedAttachmentIds.forEach(function (attachmentId) {
      if (typeof arAssertClaimableAttachment_ !== 'function') {
        throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
      }
      arAssertClaimableAttachment_(attachmentId, 'serviceCatalog', '', {
        recordType: 'ServiceRequest', fieldName: 'AttachmentIDsJSON',
        attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true
      }, user);
    });
    if (sanitizeText(form.attachmentUrl || form.attachment, 1000)) {
      throw new Error('New authenticated requests accept Attachment Registry IDs only');
    }
    const attachmentUrl = '';
    unclaimedAttachmentUrl = attachmentUrl;
    if (svcIsYes_(catalog.AttachmentRequired) && !attachmentUrl && !stagedAttachmentIds.length) {
      throw new Error('บริการนี้กำหนดให้แนบเอกสารประกอบ');
    }
    const summary = sanitizeText(form.summary, 300) || String(catalog.ServiceName || '');
    const justification = sanitizeText(form.businessJustification || form.justification, 2000);
    const priority = sanitizeText(form.priority, 40) || 'ปานกลาง';
    const impact = sanitizeText(form.impact, 40) || 'ปานกลาง';
    if (!isInList(priority, SVC_REQUEST_PRIORITY)) throw new Error('ระดับความเร่งด่วนไม่ถูกต้อง');
    if (!isInList(impact, SVC_REQUEST_PRIORITY)) throw new Error('ระดับผลกระทบไม่ถูกต้อง');

    const outcome = svcWithScriptLock_(function () {
      const existing = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).filter(function (r) {
        return String(r.RequesterEmail || '').toLowerCase() === user.email &&
          String(r.IdempotencyKey || '') === key;
      })[0];
      if (existing) {
        if (String(existing.CatalogID || '') !== catalogId) {
          throw new Error('Idempotency key นี้ถูกใช้กับบริการรายการอื่นแล้ว');
        }
        // A prior execution can fail after the parent row is written but before
        // every child row is appended. Repair from immutable snapshots before
        // acknowledging the retry as a duplicate.
        svcRepairRequestChildrenLocked_(existing, user);
        return {
          id: existing.RequestID,
          status: existing.Status,
          duplicate: true,
          existingAttachmentUrl: String(existing.AttachmentURL || ''),
          existingAttachmentIds: svcNormalizeAttachmentIds_(existing.AttachmentIDsJSON)
        };
      }

      const lockedCatalog = findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', catalogId);
      if (!lockedCatalog || String(lockedCatalog.Status) !== 'ใช้งาน') {
        throw new Error('บริการนี้ไม่เปิดรับคำขอ');
      }
      if (String(lockedCatalog.Version || '1') !== String(catalog.Version || '1')) {
        throw new Error('รายละเอียดบริการมีการปรับปรุง กรุณาโหลดหน้าใหม่แล้วตรวจสอบข้อมูลอีกครั้ง');
      }
      if (!svcIsEligible_(lockedCatalog, user)) throw new Error('ท่านไม่มีสิทธิ์ขอบริการรายการนี้');

      // Duplicate lookup above runs first. Only a genuinely new source intent
      // reaches this STAGED/zero-link check under the parent commit lock.
      stagedAttachmentIds.forEach(function (attachmentId) {
        arAssertClaimableAttachmentLocked_(attachmentId, 'serviceCatalog', '', {
          recordType: 'ServiceRequest', fieldName: 'AttachmentIDsJSON',
          attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true
        }, user);
      });
      const approval = svcResolveApproval_(catalog, user);
      const now = new Date();
      const slaHours = svcClamp_(catalog.SLAHours, 1, 720, 24);
      const requestId = generateId('SRQ');
      const checklist = svcNormalizeChecklist_(catalog.ChecklistJSON);
      const workflowSnapshot = {
        approvalMode: catalog.ApprovalMode || SVC_APPROVAL_MODE[0],
        closeMode: catalog.CloseMode || SVC_CLOSE_MODE[0],
        closeCondition: catalog.CloseCondition || '',
        definition: svcNormalizeWorkflowDefinition_(catalog.WorkflowJSON),
        integration: {
          target: catalog.FulfillmentTarget || '',
          autoCreate: svcIsYes_(catalog.AutoCreateTarget),
          mapping: svcNormalizeTargetMapping_(catalog.TargetMappingJSON)
        }
      };
      const initialStatus = approval.required ? SVC_REQUEST_STATUS.PENDING_APPROVAL :
        SVC_REQUEST_STATUS.PENDING_ASSIGNMENT;
      svcAssertWorkflowStatusAllowed_(workflowSnapshot.definition, initialStatus);

      svcAppendRowLocked_(SHEETS.SERVICE_REQUEST, {
        RequestID: requestId,
        CatalogID: catalog.CatalogID,
        CatalogVersion: parseInt(catalog.Version, 10) || 1,
        ServiceCode: catalog.ServiceCode,
        ServiceName: catalog.ServiceName,
        RequesterEmail: user.email,
        RequesterName: user.name,
        Department: user.dept,
        RequestedFor: sanitizeText(form.requestedFor, 200) || user.name,
        Summary: summary,
        RequestDetailsJSON: JSON.stringify(answers),
        BusinessJustification: justification,
        Priority: priority,
        Impact: impact,
        AttachmentURL: attachmentUrl,
        // Persist the claim intent with the parent row. If execution stops
        // before registry linking, an idempotent retry can finish the claim.
        AttachmentIDsJSON: JSON.stringify(stagedAttachmentIds),
        SLAHours: slaHours,
        DueAt: addBusinessHours_(now, slaHours),
        Approver: approval.email,
        ApprovalStatus: approval.required ? 'รออนุมัติ' : 'ไม่ต้องอนุมัติ',
        AssignedGroup: sanitizeText(catalog.FulfillmentGroup, 160) || 'IT Service Desk',
        Status: initialStatus,
        WorkflowJSON: JSON.stringify(workflowSnapshot),
        ChecklistSnapshotJSON: JSON.stringify(checklist),
        IdempotencyKey: key,
        SourceChannel: 'WEB_INTERNAL'
      }, user.email);

      svcCreateRequestTasks_(requestId, checklist, catalog, now, user.email);
      svcAddHistory_(requestId, user, 'CREATE_REQUEST', '', initialStatus,
        'ยื่นคำขอบริการ ' + String(catalog.ServiceCode || ''), true);
      svcWriteAuditLocked_(user, 'CREATE_REQUEST', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
        requestId, String(catalog.ServiceCode || ''), 'success');
      return {
        id: requestId,
        status: initialStatus,
        duplicate: false,
        approverEmail: approval.required ? approval.email : '',
        serviceName: String(catalog.ServiceName || ''),
        attachmentUrl: attachmentUrl,
        attachmentIds: stagedAttachmentIds
      };
    });
    durableRequestId = outcome.id;
    if (outcome.duplicate) {
      if (unclaimedAttachmentUrl && unclaimedAttachmentUrl !== outcome.existingAttachmentUrl) {
        svcDiscardUnclaimedServiceCatalogAttachment_(unclaimedAttachmentUrl, user,
          'duplicate idempotency key ใช้คำขอเดิม');
      }
      unclaimedAttachmentUrl = '';
      // Idempotency replay is immutable: IDs supplied by a later call are not
      // allowed to mutate the original request. Dispose only newly staged IDs
      // and repair links solely from the durable source-row intent.
      const durableIds = svcNormalizeAttachmentIds_(outcome.existingAttachmentIds);
      const unexpectedIds = unclaimedAttachmentIds.filter(function (id) {
        return durableIds.indexOf(id) === -1;
      });
      if (unexpectedIds.length) {
        svcDiscardUnclaimedRegisteredAttachments_(unexpectedIds, user,
          'duplicate idempotency key ใช้เฉพาะไฟล์จากคำขอเดิม');
      }
      const duplicateAttachments = svcEnsureRequestAttachments_(outcome.id,
        outcome.existingAttachmentUrl, durableIds, user);
      unclaimedAttachmentIds = [];
      const duplicateWorkflow = workflowEnsureServiceRequest_(outcome.id, user);
      return ok({ id: outcome.id, status: outcome.status, duplicate: true,
        attachmentIds: duplicateAttachments.ids },
        'คำขอนี้ถูกบันทึกไว้แล้ว เลขที่ ' + outcome.id +
          (duplicateWorkflow && duplicateWorkflow.instanceId ? ' และตรวจสอบ Workflow แล้ว' : ''));
    }
    // Parent request now owns the upload. Any later notification failure must
    // not remove evidence already referenced by the durable request row.
    unclaimedAttachmentUrl = '';
    const attachmentOutcome = svcEnsureRequestAttachments_(outcome.id,
      outcome.attachmentUrl, outcome.attachmentIds, user);
    unclaimedAttachmentIds = [];
    const workflowOutcome = workflowEnsureServiceRequest_(outcome.id, user);
    if (workflowOutcome && workflowOutcome.noApproval) {
      svcNotifyItQueue_(outcome.id, outcome.serviceName);
    }
    return ok({
      id: outcome.id,
      status: outcome.status,
      duplicate: false,
      workflowInstanceId: workflowOutcome && workflowOutcome.instanceId || '',
      attachmentIds: attachmentOutcome.ids
    },
      'ส่งคำขอบริการแล้ว เลขที่ ' + outcome.id);
  } catch (e) {
    if (!durableRequestId && requestIdempotencyKey && attachmentActor) {
      try {
        const persisted = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).filter(function (row) {
          return String(row.RequesterEmail || '').toLowerCase() === String(attachmentActor.email || '').toLowerCase() &&
            String(row.IdempotencyKey || '') === requestIdempotencyKey;
        })[0];
        if (persisted) durableRequestId = String(persisted.RequestID || '');
      } catch (ignorePersistedRequest) {}
    }
    if (durableRequestId && attachmentActor) {
      try {
        const durable = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', durableRequestId);
        if (durable) {
          svcEnsureRequestAttachments_(durableRequestId, durable.AttachmentURL,
            svcNormalizeAttachmentIds_(durable.AttachmentIDsJSON), attachmentActor);
          unclaimedAttachmentIds = [];
          unclaimedAttachmentUrl = '';
        }
      } catch (repairError) {
        console.error('submitServiceRequest durable attachment repair: ' + repairError.message);
      }
    }
    if (!durableRequestId && unclaimedAttachmentIds.length) {
      svcDiscardUnclaimedRegisteredAttachments_(unclaimedAttachmentIds, attachmentActor,
        'การยื่นคำขอไม่สำเร็จ: ' + sanitizeText(e && e.message, 300));
    }
    if (unclaimedAttachmentUrl) {
      svcDiscardUnclaimedServiceCatalogAttachment_(unclaimedAttachmentUrl, attachmentActor,
        'การยื่นคำขอไม่สำเร็จ: ' + sanitizeText(e && e.message, 300));
    }
    return fail(e.message, 'SERVICE_REQUEST_SUBMIT_FAILED');
  }
}

function approveServiceRequest(requestId, approve, comment) {
  try {
    const user = requireRole(SVC_APPROVER_ROLES);
    requestId = sanitizeText(requestId, 80);
    const approved = approve === true || String(approve).toLowerCase() === 'true' ||
      String(approve) === 'อนุมัติ';
    const note = sanitizeText(comment, 1000);
    if (!approved && !note) throw new Error('กรุณาระบุเหตุผลการปฏิเสธ');

    const workflowRequest = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
    if (!workflowRequest) throw new Error('ไม่พบคำขอบริการ ' + requestId);
    if (String(workflowRequest.WorkflowInstanceID || '').trim()) {
      return decideWorkflowApprovalByRecord_('serviceCatalog', requestId,
        approved ? 'APPROVE' : 'REJECT', note);
    }
    if (typeof intEnsureSheets_ === 'function') intEnsureSheets_();

    const outcome = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      if (req.Status !== SVC_REQUEST_STATUS.PENDING_APPROVAL || req.ApprovalStatus !== 'รออนุมัติ') {
        throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
      }
      if (String(req.RequesterEmail || '').toLowerCase() === user.email) {
        svcWriteAuditLocked_(user, 'APPROVE_DENIED', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
          requestId, 'ห้ามอนุมัติคำขอของตนเอง', 'denied');
        throw new Error('ผู้ยื่นคำขอไม่สามารถอนุมัติคำขอของตนเองได้');
      }
      if (String(req.Approver || '').toLowerCase() !== user.email) {
        svcWriteAuditLocked_(user, 'APPROVE_DENIED', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
          requestId, 'ไม่ใช่ผู้อนุมัติที่กำหนด', 'denied');
        throw new Error('ท่านไม่ใช่ผู้อนุมัติที่กำหนดสำหรับคำขอนี้');
      }

      const newStatus = approved ? SVC_REQUEST_STATUS.PENDING_ASSIGNMENT : SVC_REQUEST_STATUS.REJECTED;
      svcAssertRequestTransition_(req.Status, newStatus, req);
      const approvalPatch = {
        ApprovalStatus: approved ? 'อนุมัติ' : 'ปฏิเสธ',
        ApprovedBy: user.email,
        ApprovedAt: new Date(),
        Status: newStatus,
        Notes: svcAppendNote_(req.Notes, user.email, note)
      };
      if (!approved) approvalPatch.ClosedAt = new Date();
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, req._row, approvalPatch, user.email);
      svcAddHistory_(requestId, user, approved ? 'APPROVE' : 'REJECT', req.Status,
        newStatus, note, true);
      svcWriteAuditLocked_(user, approved ? 'APPROVE' : 'REJECT', 'serviceCatalog',
        SHEETS.SERVICE_REQUEST, requestId, note, 'success');
      if (approved && typeof queueServiceRequestIntegrationLocked_ === 'function') {
        const requestFlow = svcRequestWorkflow_(req);
        queueServiceRequestIntegrationLocked_(requestId, 'LEGACY_APPROVED', user,
          requestFlow.integration || null);
      }
      return {
        id: requestId,
        status: newStatus,
        requesterEmail: String(req.RequesterEmail || ''),
        serviceName: String(req.ServiceName || '')
      };
    });
    if (approved) svcNotifyItQueue_(requestId, outcome.serviceName);
    svcNotify_(outcome.requesterEmail, 'ผลพิจารณาคำขอบริการ ' + requestId,
      '<p>คำขอ <b>' + escapeHtml(requestId) + '</b> ได้รับการ' +
      (approved ? 'อนุมัติ' : 'ปฏิเสธ') + (note ? '<br>หมายเหตุ: ' + escapeHtml(note) : '') + '</p>',
      'คำขอ ' + requestId + ' ' + (approved ? 'อนุมัติแล้ว' : 'ถูกปฏิเสธ'),
      'serviceCatalog', requestId);
    return ok({ id: requestId, status: outcome.status }, approved ? 'อนุมัติคำขอแล้ว' : 'ปฏิเสธคำขอแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_APPROVAL_FAILED');
  }
}

function assignServiceRequest(requestId, assignment, group, comment) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    requestId = sanitizeText(requestId, 80);
    let form = assignment && typeof assignment === 'object' ? assignment : {
      assignee: assignment, group: group, comment: comment
    };
    form = form || {};
    const assignee = sanitizeText(form.assignee, 160).toLowerCase();
    const assignedGroup = sanitizeText(form.group || form.assignedGroup, 160);
    if (!assignee && !assignedGroup) throw new Error('กรุณาระบุกลุ่มหรือผู้รับผิดชอบ');
    if (assignee) svcAssertItAssignee_(assignee);

    const outcome = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      if (req.Status === SVC_REQUEST_STATUS.PENDING_APPROVAL) throw new Error('คำขอยังไม่ผ่านการอนุมัติ');
      if (svcIsTerminal_(req.Status) || req.Status === SVC_REQUEST_STATUS.PENDING_CONFIRMATION) {
        throw new Error('คำขอนี้ไม่อยู่ในสถานะที่มอบหมายได้');
      }
      const newStatus = SVC_REQUEST_STATUS.IN_PROGRESS;
      svcAssertRequestTransition_(req.Status, newStatus, req);
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, req._row, {
        AssignedGroup: assignedGroup || req.AssignedGroup,
        Assignee: assignee || req.Assignee,
        Status: newStatus,
        Notes: svcAppendNote_(req.Notes, user.email, sanitizeText(form.comment, 1000))
      }, user.email);

      readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_TASK).forEach(function (task) {
        if (String(task.RequestID) === requestId && !task.Assignee && assignee) {
          svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST_TASK, task._row, {
            Assignee: assignee,
            OwnerGroup: assignedGroup || task.OwnerGroup || req.AssignedGroup
          }, user.email);
        }
      });
      svcAddHistory_(requestId, user, 'ASSIGN', req.Status, newStatus,
        (assignedGroup || req.AssignedGroup || '-') + ' / ' + (assignee || req.Assignee || '-'), true);
      svcWriteAuditLocked_(user, 'ASSIGN', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
        requestId, assignee || assignedGroup, 'success');
      return { id: requestId, status: newStatus, serviceName: String(req.ServiceName || '') };
    });
    if (assignee) {
      svcNotify_(assignee, 'ได้รับมอบหมายคำขอบริการ ' + requestId,
        '<p>ท่านได้รับมอบหมายคำขอบริการ <b>' + escapeHtml(requestId) + '</b>: ' +
        escapeHtml(outcome.serviceName) + '</p>', 'ได้รับมอบหมาย ' + requestId,
        'serviceCatalog', requestId);
    }
    return ok({ id: requestId, status: outcome.status }, 'มอบหมายคำขอบริการแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_ASSIGN_FAILED');
  }
}

function updateServiceRequestStatus(requestId, statusOrForm, comment) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    requestId = sanitizeText(requestId, 80);
    let form = statusOrForm && typeof statusOrForm === 'object' ? statusOrForm : {
      status: statusOrForm, comment: comment
    };
    form = form || {};
    const newStatus = sanitizeText(form.status, 80);
    const note = sanitizeText(form.comment || form.notes || form.fulfillmentNotes, 2000);
    if (sanitizeText(form.evidence || form.completionEvidence || form.evidenceLink ||
        form.completionEvidenceLink || form.attachmentUrl, 1000)) {
      throw new Error('หลักฐานใหม่ต้องอัปโหลดผ่าน Attachment Registry เท่านั้น');
    }
    const completionAttachmentIds = svcNormalizeAttachmentIds_(
      form.evidenceAttachmentIds !== undefined ? form.evidenceAttachmentIds :
        (form.completionAttachmentIds !== undefined ? form.completionAttachmentIds : form.attachmentIds));
    if ([SVC_REQUEST_STATUS.IN_PROGRESS, SVC_REQUEST_STATUS.WAITING_USER,
      SVC_REQUEST_STATUS.WAITING_VENDOR, SVC_REQUEST_STATUS.PENDING_CONFIRMATION,
      SVC_REQUEST_STATUS.CLOSED].indexOf(newStatus) === -1) throw new Error('สถานะคำขอไม่ถูกต้อง');

    // svcClaimRegisteredAttachments_ is intentionally superseded by durable
    // intent + terminal-safe repair below.
    const preflightRequest = findRow_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
    if (!preflightRequest) throw new Error('Service request not found');
    const newCompletionAttachmentIds = completionAttachmentIds.filter(function (id) {
      return svcNormalizeAttachmentIds_(preflightRequest.CompletionAttachmentIDsJSON).indexOf(id) === -1;
    });
    svcAssertClaimableAttachments_(newCompletionAttachmentIds, 'ServiceRequest',
      'CompletionAttachmentIDsJSON', 'FULFILLMENT_EVIDENCE', user);

    // Phase 1: validate the current lifecycle and publish a durable claim
    // intent before any link is created. A crash can no longer produce an
    // unreferenced ACTIVE link or allow staged retention to delete the file.
    const durableCompletionAttachmentIds = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      svcValidateRequestStatusActionLocked_(req, newStatus, note, user);
      let durableIds = svcNormalizeAttachmentIds_(req.CompletionAttachmentIDsJSON);
      completionAttachmentIds.filter(function (id) {
        return durableIds.indexOf(id) === -1;
      }).forEach(function (attachmentId) {
        arAssertClaimableAttachmentLocked_(attachmentId, 'serviceCatalog', '', {
          recordType: 'ServiceRequest', fieldName: 'CompletionAttachmentIDsJSON',
          attachmentRole: 'FULFILLMENT_EVIDENCE', classification: 'Confidential', isEvidence: true
        }, user);
      });
      if (completionAttachmentIds.length) {
        durableIds = svcNormalizeAttachmentIds_(durableIds.concat(completionAttachmentIds));
        svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, req._row, {
          CompletionAttachmentIDsJSON: JSON.stringify(durableIds)
        }, user.email);
      }
      return durableIds;
    });

    // Replay every ID already present in durable intent, not only IDs supplied
    // by this browser call. This repairs a prior crash even after page reload.
    durableCompletionAttachmentIds.forEach(function (attachmentId) {
      arRepairDurableAttachmentIntent_(attachmentId, 'serviceCatalog', requestId, {
        recordType: 'ServiceRequest', fieldName: 'CompletionAttachmentIDsJSON',
        attachmentRole: 'FULFILLMENT_EVIDENCE', classification: 'Confidential', isEvidence: true
      }, user);
    });

    const outcome = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      const validation = svcValidateRequestStatusActionLocked_(req, newStatus, note, user);
      const finalizing = validation.finalizing;
      const patch = {
        Status: newStatus,
        Notes: svcAppendNote_(req.Notes, user.email, note)
      };
      if (note) patch.FulfillmentNotes = note;
      if (finalizing) patch.CompletedAt = req.CompletedAt || new Date();
      if (newStatus === SVC_REQUEST_STATUS.CLOSED) patch.ClosedAt = new Date();
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, req._row, patch, user.email);
      svcAddHistory_(requestId, user, finalizing ? 'FULFILL' : 'UPDATE_STATUS',
        req.Status, newStatus, note, true);
      svcWriteAuditLocked_(user, finalizing ? 'FULFILL' : 'UPDATE_STATUS', 'serviceCatalog',
        SHEETS.SERVICE_REQUEST, requestId, newStatus, 'success');
      return { id: requestId, status: newStatus, requesterEmail: String(req.RequesterEmail || ''),
        attachmentIds: svcNormalizeAttachmentIds_(req.CompletionAttachmentIDsJSON) };
    });
    svcNotify_(outcome.requesterEmail, 'อัปเดตคำขอบริการ ' + requestId,
      '<p>คำขอ <b>' + escapeHtml(requestId) + '</b> เปลี่ยนสถานะเป็น <b>' +
      escapeHtml(newStatus) + '</b></p>' + (note ? '<p>' + escapeHtml(note) + '</p>' : ''),
      'คำขอ ' + requestId + ': ' + newStatus, 'serviceCatalog', requestId);
    return ok({ id: requestId, status: outcome.status, attachmentIds: outcome.attachmentIds },
      'อัปเดตสถานะคำขอแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_STATUS_FAILED');
  }
}

function updateServiceRequestTask(taskId, form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    taskId = sanitizeText(taskId, 80);
    if (typeof form === 'string') form = { status: form };
    form = form || {};
    const status = sanitizeText(form.status, 80);
    if (!isInList(status, SVC_TASK_STATUS)) throw new Error('สถานะ Checklist ไม่ถูกต้อง');
    if (sanitizeText(form.evidence || form.evidenceLink || form.attachment ||
        form.attachmentUrl, 1000)) {
      throw new Error('หลักฐานใหม่ต้องอัปโหลดผ่าน Attachment Registry เท่านั้น');
    }
    const evidenceAttachmentIds = svcNormalizeAttachmentIds_(
      form.evidenceAttachmentIds !== undefined ? form.evidenceAttachmentIds : form.attachmentIds);
    const note = sanitizeText(form.notes || form.comment, 1000);
    let requestedAssignee = null;
    if (form.assignee !== undefined) {
      requestedAssignee = sanitizeText(form.assignee, 160).toLowerCase();
      if (requestedAssignee) svcAssertItAssignee_(requestedAssignee);
    }

    const preflightTask = findRow_(SHEETS.SERVICE_REQUEST_TASK, 'TaskID', taskId);
    if (!preflightTask) throw new Error('ไม่พบงาน Checklist');
    // svcClaimRegisteredAttachments_ is intentionally superseded by durable
    // intent + terminal-safe repair below.
    const newEvidenceAttachmentIds = evidenceAttachmentIds.filter(function (id) {
      return svcNormalizeAttachmentIds_(preflightTask.EvidenceAttachmentIDsJSON).indexOf(id) === -1;
    });
    svcAssertClaimableAttachments_(newEvidenceAttachmentIds, 'ServiceRequestTask',
      'EvidenceAttachmentIDsJSON', 'TASK_EVIDENCE', user);

    // Phase 1 mirrors request fulfilment: lifecycle validation and durable ID
    // intent are committed before the registry link is repaired.
    const durableEvidenceAttachmentIds = svcWithScriptLock_(function () {
      const task = findRow_(SHEETS.SERVICE_REQUEST_TASK, 'TaskID', taskId);
      if (!task) throw new Error('ไม่พบงาน Checklist');
      const req = svcRequestForAction_(task.RequestID);
      // svcValidateTaskActionLocked_ explicitly rejects
      // SVC_REQUEST_STATUS.PENDING_CONFIRMATION before claim intent is written.
      const combined = svcNormalizeAttachmentIds_(
        svcNormalizeAttachmentIds_(task.EvidenceAttachmentIDsJSON).concat(evidenceAttachmentIds));
      evidenceAttachmentIds.filter(function (id) {
        return svcNormalizeAttachmentIds_(task.EvidenceAttachmentIDsJSON).indexOf(id) === -1;
      }).forEach(function (attachmentId) {
        arAssertClaimableAttachmentLocked_(attachmentId, 'serviceCatalog', '', {
          recordType: 'ServiceRequestTask', fieldName: 'EvidenceAttachmentIDsJSON',
          attachmentRole: 'TASK_EVIDENCE', classification: 'Confidential', isEvidence: true
        }, user);
      });
      svcValidateTaskActionLocked_(task, req, status, combined);
      if (evidenceAttachmentIds.length) {
        svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST_TASK, task._row, {
          EvidenceAttachmentIDsJSON: JSON.stringify(combined)
        }, user.email);
      }
      return combined;
    });

    // Durable task intent is the sole replay authority. Existing IDs are
    // repaired after reload without accepting arbitrary replacement IDs.
    durableEvidenceAttachmentIds.forEach(function (attachmentId) {
      arRepairDurableAttachmentIntent_(attachmentId, 'serviceCatalog', taskId, {
        recordType: 'ServiceRequestTask', fieldName: 'EvidenceAttachmentIDsJSON',
        attachmentRole: 'TASK_EVIDENCE', classification: 'Confidential', isEvidence: true
      }, user);
    });

    const outcome = svcWithScriptLock_(function () {
      const task = findRow_(SHEETS.SERVICE_REQUEST_TASK, 'TaskID', taskId);
      if (!task) throw new Error('ไม่พบงาน Checklist');
      const req = svcRequestForAction_(task.RequestID);
      const evidenceRequired = svcTaskEvidenceRequired_(task);
      const allEvidenceIds = svcNormalizeAttachmentIds_(task.EvidenceAttachmentIDsJSON);
      svcValidateTaskActionLocked_(task, req, status, allEvidenceIds);
      if (status === 'เสร็จสิ้น' && evidenceRequired && allEvidenceIds.length) {
        arAssertActiveEvidenceForRecordLocked_(allEvidenceIds, 'serviceCatalog', taskId, {
          recordType: 'ServiceRequestTask', fieldName: 'EvidenceAttachmentIDsJSON',
          attachmentRole: 'TASK_EVIDENCE'
        }, user);
      }
      const priorNote = String(task.Notes || '').replace(/^EvidenceRequired=(?:Yes|No)\n?/, '');
      const noteBody = note || priorNote;
      const patch = {
        Status: status,
        Notes: 'EvidenceRequired=' + (evidenceRequired ? 'Yes' : 'No') +
          (noteBody ? '\n' + noteBody : '')
      };
      if (requestedAssignee !== null) patch.Assignee = requestedAssignee;
      if (status === 'เสร็จสิ้น') {
        patch.CompletedAt = new Date();
        patch.CompletedBy = user.email;
      } else {
        patch.CompletedAt = '';
        patch.CompletedBy = '';
      }
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST_TASK, task._row, patch, user.email);
      svcAddHistory_(task.RequestID, user, 'UPDATE_TASK', req.Status, req.Status,
        task.TaskName + ': ' + status + (note ? ' - ' + note : ''), false);
      svcWriteAuditLocked_(user, 'UPDATE_TASK', 'serviceCatalog', SHEETS.SERVICE_REQUEST_TASK,
        taskId, status, 'success');
      return { id: taskId, status: status,
        attachmentIds: allEvidenceIds };
    });
    return ok(outcome, 'อัปเดต Checklist แล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_TASK_FAILED');
  }
}

function confirmServiceRequest(requestId, accepted, comment) {
  try {
    const user = requireModule('serviceCatalog', true);
    requestId = sanitizeText(requestId, 80);
    const okResult = accepted === true || String(accepted).toLowerCase() === 'true' ||
      String(accepted) === 'ยืนยัน';
    const note = sanitizeText(comment, 1000);
    if (!okResult && !note) throw new Error('กรุณาระบุสิ่งที่ต้องแก้ไขเพิ่มเติม');

    const outcome = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      if (String(req.RequesterEmail || '').toLowerCase() !== user.email) {
        svcWriteAuditLocked_(user, 'CONFIRM_DENIED', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
          requestId, 'ไม่ใช่ผู้ยื่นคำขอ', 'denied');
        throw new Error('เฉพาะผู้ยื่นคำขอเท่านั้นที่ยืนยันผลได้');
      }
      if (req.Status !== SVC_REQUEST_STATUS.PENDING_CONFIRMATION) {
        throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรอยืนยันผล');
      }
      // Recheck under the same ScriptLock used to close the request. This prevents
      // a stale confirmation from closing work after a required task was reopened.
      if (okResult) {
        svcAssertIntegrationComplete_(req);
        svcAssertRequiredTasksComplete_(requestId, user);
      }
      const newStatus = okResult ? SVC_REQUEST_STATUS.CLOSED : SVC_REQUEST_STATUS.IN_PROGRESS;
      svcAssertRequestTransition_(req.Status, newStatus, req);
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, req._row, {
        RequesterConfirmedAt: new Date(),
        RequesterConfirmation: (okResult ? 'ยืนยันผล' : 'ขอแก้ไขเพิ่มเติม') + (note ? ' - ' + note : ''),
        Status: newStatus,
        ClosedAt: okResult ? new Date() : '',
        CompletedAt: okResult ? req.CompletedAt : '',
        Notes: svcAppendNote_(req.Notes, user.email, note)
      }, user.email);
      svcAddHistory_(requestId, user, okResult ? 'CONFIRM' : 'RETURN_FOR_REWORK',
        req.Status, newStatus, note, true);
      svcWriteAuditLocked_(user, okResult ? 'CONFIRM' : 'RETURN_FOR_REWORK', 'serviceCatalog',
        SHEETS.SERVICE_REQUEST, requestId, note, 'success');
      return { id: requestId, status: newStatus, assignee: String(req.Assignee || '') };
    });
    if (!okResult && outcome.assignee) {
      svcNotify_(outcome.assignee, 'คำขอบริการ ' + requestId + ' ถูกส่งกลับแก้ไข',
        '<p>ผู้ขอส่งกลับคำขอ <b>' + escapeHtml(requestId) + '</b> เพื่อแก้ไขเพิ่มเติม</p><p>' +
        escapeHtml(note) + '</p>', 'ส่งกลับแก้ไข ' + requestId + ': ' + note,
        'serviceCatalog', requestId);
    }
    return ok({ id: requestId, status: outcome.status }, okResult ? 'ยืนยันและปิดคำขอแล้ว' : 'ส่งกลับให้ IT แก้ไขแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_CONFIRM_FAILED');
  }
}

function cancelServiceRequest(requestId, reason) {
  try {
    const user = requireModule('serviceCatalog', true);
    requestId = sanitizeText(requestId, 80);
    reason = sanitizeText(reason, 1000);
    requireFields({ 'เหตุผลการยกเลิก': reason }, ['เหตุผลการยกเลิก']);
    if (typeof wfEnsureSheets_ === 'function') wfEnsureSheets_();
    if (typeof intEnsureSheets_ === 'function') intEnsureSheets_();

    const outcome = svcWithScriptLock_(function () {
      const req = svcRequestForAction_(requestId);
      const lockedUser = svcReauthorizeMutationActorLocked_(user);
      const isOwner = String(req.RequesterEmail || '').toLowerCase() === lockedUser.email;
      const alreadyCancelled = String(req.Status || '') === SVC_REQUEST_STATUS.CANCELLED;
      const hadCompletionAudit = alreadyCancelled && svcHasSuccessfulCancelAuditLocked_(requestId);
      if (!isOwner && lockedUser.role !== ROLES.IT_ADMIN) {
        svcWriteAuditLocked_(lockedUser, 'CANCEL_DENIED', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
          requestId, 'ไม่ใช่เจ้าของคำขอ', 'denied');
        throw new Error('ท่านไม่มีสิทธิ์ยกเลิกคำขอนี้');
      }
      if ((svcIsTerminal_(req.Status) && !alreadyCancelled) ||
          req.Status === SVC_REQUEST_STATUS.PENDING_CONFIRMATION) {
        throw new Error('คำขอนี้ไม่สามารถยกเลิกได้ในสถานะปัจจุบัน');
      }
      if (!alreadyCancelled) svcAssertRequestTransition_(req.Status, SVC_REQUEST_STATUS.CANCELLED, req);
      // Preflight every irreversible boundary before mutating the source. If a
      // downstream record already exists, cancellation must occur in that module.
      if (typeof intPreflightServiceRequestCancellationLocked_ === 'function') {
        intPreflightServiceRequestCancellationLocked_(req);
      }
      svcWriteCriticalAuditLocked_(lockedUser, 'CANCEL_INTENT', 'serviceCatalog',
        SHEETS.SERVICE_REQUEST, requestId,
        (alreadyCancelled ? 'reconcile; ' : '') + 'reason=' + reason, 'pending');
      if (typeof wfCancelServiceRequestWorkflowLocked_ === 'function') {
        wfCancelServiceRequestWorkflowLocked_(req, lockedUser, reason);
      }
      if (typeof intCancelServiceRequestIntegrationsLocked_ === 'function') {
        intCancelServiceRequestIntegrationsLocked_(req, lockedUser, reason);
      }
      const fresh = svcRequestForAction_(requestId);
      if (alreadyCancelled) {
        const hasCancelHistory = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY, true)
          .some(function (row) {
            return String(row.RequestID || '') === requestId && String(row.Action || '') === 'CANCEL';
          });
        if (!hasCancelHistory) {
          svcAddHistory_(requestId, lockedUser, 'CANCEL', req.Status,
            SVC_REQUEST_STATUS.CANCELLED, reason, true);
        }
        svcWriteCriticalAuditLocked_(lockedUser, 'CANCEL_RECONCILED', 'serviceCatalog',
          SHEETS.SERVICE_REQUEST, requestId, reason, 'success');
        return {
          id: requestId,
          status: SVC_REQUEST_STATUS.CANCELLED,
          requesterEmail: String(req.RequesterEmail || ''),
          notifyRequester: !isOwner && !hadCompletionAudit,
          duplicate: true
        };
      }
      const patch = {
        Status: SVC_REQUEST_STATUS.CANCELLED,
        CancelReason: reason,
        ClosedAt: fresh.ClosedAt || new Date(),
        Notes: svcAppendNote_(fresh.Notes, lockedUser.email, reason)
      };
      if (req.Status === SVC_REQUEST_STATUS.PENDING_APPROVAL) {
        patch.ApprovalStatus = 'ยกเลิก';
        patch.Approver = '';
      }
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, fresh._row, patch, lockedUser.email);
      svcAddHistory_(requestId, lockedUser, 'CANCEL', req.Status, SVC_REQUEST_STATUS.CANCELLED,
        reason, true);
      svcWriteCriticalAuditLocked_(lockedUser, 'CANCEL', 'serviceCatalog', SHEETS.SERVICE_REQUEST,
        requestId, reason, 'success');
      return {
        id: requestId,
        status: SVC_REQUEST_STATUS.CANCELLED,
        requesterEmail: String(req.RequesterEmail || ''),
        notifyRequester: !isOwner,
        duplicate: false
      };
    });
    if (outcome.notifyRequester) {
      svcNotify_(outcome.requesterEmail, 'คำขอบริการ ' + requestId + ' ถูกยกเลิก',
        '<p>คำขอ <b>' + escapeHtml(requestId) + '</b> ถูกยกเลิก</p><p>เหตุผล: ' +
        escapeHtml(reason) + '</p>', 'คำขอ ' + requestId + ' ถูกยกเลิก: ' + reason,
        'serviceCatalog', requestId);
    }
    return ok({ id: requestId, status: outcome.status, duplicate: !!outcome.duplicate },
      outcome.duplicate ? 'ตรวจสอบและซ่อมการยกเลิกแล้ว' : 'ยกเลิกคำขอแล้ว');
  } catch (e) {
    return fail(e.message, 'SERVICE_REQUEST_CANCEL_FAILED');
  }
}

// ===================================================================
// Internal helpers
// ===================================================================

function svcEnsureSheets_() {
  [SHEETS.SERVICE_CATALOG, SHEETS.SERVICE_REQUEST, SHEETS.SERVICE_REQUEST_TASK,
    SHEETS.SERVICE_REQUEST_HISTORY].forEach(function (name) { ensureSheetBySchema_(name); });
}

function svcClientSafe_(value) {
  const json = JSON.stringify(value);
  if (!json) throw new Error('ไม่สามารถแปลงข้อมูล Service Catalog สำหรับส่งไปหน้าเว็บได้');
  return JSON.parse(json);
}

function svcTime_(value) {
  const d = value instanceof Date ? value : new Date(value || 0);
  return isNaN(d) ? 0 : d.getTime();
}

function svcIsTerminal_(status) {
  return SVC_TERMINAL_STATUS.indexOf(String(status || '')) > -1;
}

function svcYesNo_(value) {
  return svcIsYes_(value) ? 'Yes' : 'No';
}

function svcIsYes_(value) {
  return value === true || ['yes', 'true', '1', 'ใช่', 'required'].indexOf(
    String(value || '').toLowerCase().trim()) > -1;
}

function svcClamp_(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function svcWithScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/**
 * Lock-free write helpers. Call only while svcWithScriptLock_ owns the ScriptLock;
 * using the shared appendRow_/updateRow_/writeAudit_ here would attempt to acquire
 * the same non-reentrant lock again and can deadlock the transaction.
 */
function svcAppendRowLocked_(sheetName, dataObj, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const now = new Date();
  const merged = Object.assign({}, dataObj || {});
  if (headers.indexOf('Timestamp') > -1 && !merged.Timestamp) merged.Timestamp = now;
  if (headers.indexOf('CreatedBy') > -1 && !merged.CreatedBy) merged.CreatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedBy') > -1) merged.LastUpdatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedAt') > -1) merged.LastUpdatedAt = now;
  const row = headers.map(function (header) {
    return sheetSafeValue_(Object.prototype.hasOwnProperty.call(merged, header) ? merged[header] : '');
  });
  const rowNumber = Math.max(2, sh.getLastRow() + 1);
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  return rowNumber;
}

function svcUpdateRowLocked_(sheetName, rowNumber, partialObj, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const current = range.getValues()[0];
  const patch = partialObj || {};
  const now = new Date();
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch, header)) {
      current[index] = sheetSafeValue_(patch[header]);
    }
    if (header === 'LastUpdatedBy') current[index] = actorEmail || '';
    if (header === 'LastUpdatedAt') current[index] = now;
  });
  range.setValues([current]);
  return true;
}

/** Re-authorize from current sheet state while the caller owns ScriptLock. */
function svcReauthorizeMutationActorLocked_(actor) {
  const email = String(actor && actor.email || '').toLowerCase().trim();
  if (!email) throw new Error('ไม่พบผู้ดำเนินการ');
  if (typeof apResetRuntimeReadCache_ === 'function') apResetRuntimeReadCache_();
  const row = readSheetObjectsEnsured_(SHEETS.USERS, true).filter(function (item) {
    return String(item.Email || '').toLowerCase().trim() === email &&
      String(item.Status || '').toLowerCase().trim() === 'active';
  })[0];
  if (!row) throw new Error('บัญชีผู้ดำเนินการไม่ได้อยู่ในสถานะ Active');
  const fresh = {
    email: email,
    name: row.FullName || actor.name || email,
    role: String(row.Role || ''),
    dept: String(row.Department || '')
  };
  if (!canEditModule(fresh.role, 'serviceCatalog')) {
    throw new Error('ท่านไม่มีสิทธิ์แก้ไขโมดูล Service Catalog');
  }
  return fresh;
}

/** Caller owns ScriptLock. Used to suppress duplicate cancellation notices. */
function svcHasSuccessfulCancelAuditLocked_(requestId) {
  return readSheetObjectsEnsured_(SHEETS.AUDIT_TRAIL, true).some(function (row) {
    return String(row.Module || '') === 'serviceCatalog' &&
      String(row.TargetSheet || '') === SHEETS.SERVICE_REQUEST &&
      String(row.TargetID || '') === String(requestId || '') &&
      ['CANCEL', 'CANCEL_RECONCILED'].indexOf(String(row.Action || '')) > -1 &&
      String(row.Result || '').toLowerCase() === 'success';
  });
}

/** Header-aware, fail-closed and read-after-write verified critical audit. */
function svcWriteCriticalAuditLocked_(actor, action, module, targetSheet, targetId, detail, result) {
  const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
  if (!sh || sh.getLastColumn() < 1) throw new Error('AuditTrail sheet is missing');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  ['LogID', 'Timestamp', 'ActorEmail', 'ActorRole', 'Action', 'Module',
    'TargetSheet', 'TargetID', 'Detail', 'Result'].forEach(function (required) {
    if (headers.indexOf(required) === -1) throw new Error('AuditTrail header is missing: ' + required);
  });
  const row = {
    LogID: generateId('LOG'), Timestamp: new Date(),
    ActorEmail: actor && actor.email || actor || '', ActorRole: actor && actor.role || '',
    Action: action || '', Module: module || 'serviceCatalog',
    TargetSheet: targetSheet || '', TargetID: targetId || '',
    Detail: detail || '', IPHint: '', Result: result || 'success'
  };
  const rowNumber = Math.max(2, sh.getLastRow() + 1);
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (header) {
    return sheetSafeValue_(Object.prototype.hasOwnProperty.call(row, header) ? row[header] : '');
  })]);
  SpreadsheetApp.flush();
  const values = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const persisted = {};
  headers.forEach(function (header, index) { persisted[header] = values[index]; });
  if (String(persisted.LogID || '') !== String(row.LogID) ||
      String(persisted.ActorEmail || '').toLowerCase().trim() !==
        String(row.ActorEmail || '').toLowerCase().trim() ||
      String(persisted.Action || '') !== String(row.Action || '') ||
      String(persisted.Module || '') !== String(row.Module || '') ||
      String(persisted.TargetSheet || '') !== String(row.TargetSheet || '') ||
      String(persisted.TargetID || '') !== String(row.TargetID || '') ||
      String(persisted.Result || '').toLowerCase() !== String(row.Result || '').toLowerCase()) {
    throw new Error('Service Catalog critical audit write could not be verified');
  }
  return row.LogID;
}

function svcWriteAuditLocked_(actor, action, module, targetSheet, targetId, detail, result) {
  try {
    const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
    if (!sh) return;
    const values = [
      generateId('LOG'),
      new Date(),
      (actor && actor.email) || actor || '',
      (actor && actor.role) || '',
      action || '',
      module || '',
      targetSheet || '',
      targetId || '',
      detail || '',
      '',
      result || 'success'
    ].map(sheetSafeValue_);
    sh.getRange(Math.max(2, sh.getLastRow() + 1), 1, 1, values.length).setValues([values]);
  } catch (e) {
    console.error('svcWriteAuditLocked_ error: ' + e.message);
  }
}

function svcNormalizeJsonValue_(raw, label, fallback) {
  if (raw === '' || raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') {
    const copied = JSON.parse(JSON.stringify(raw));
    svcAssertSafeJsonObject_(copied, label || 'JSON');
    return copied;
  }
  const text = String(raw).trim();
  if (text.length > 30000) throw new Error(label + ' ยาวเกินไป');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(label + ' ต้องเป็น JSON ที่ถูกต้อง'); }
  svcAssertSafeJsonObject_(parsed, label || 'JSON');
  return parsed;
}

function svcNormalizeTargetMapping_(raw) {
  const mapping = typeof intMappingObject_ === 'function' ? intMappingObject_(raw) :
    svcNormalizeJsonValue_(raw, 'TargetMappingJSON', {});
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error('TargetMappingJSON ต้องเป็น object');
  }
  const probe = {
    details: {}, requestId: '', serviceCode: '', requesterEmail: '', requesterName: '',
    department: '', requestedFor: '', summary: '', priority: '', impact: ''
  };
  const validateNode = function (node) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (node.charAt(0) === '$' && typeof intResolveMapValue_ === 'function') {
        intResolveMapValue_(node, probe);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(validateNode);
      return;
    }
    if (typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'value')) return;
    if (Object.prototype.hasOwnProperty.call(node, 'source')) {
      validateNode(node.source);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'from')) {
      validateNode(node.from);
      return;
    }
    Object.keys(node).forEach(function (key) { validateNode(node[key]); });
  };
  validateNode(mapping);
  return mapping;
}

function svcAssertSafeJsonObject_(value, label, depth, state) {
  depth = depth || 0;
  state = state || { count: 0 };
  if (depth > 20) throw new Error(label + ' ซ้อนระดับลึกเกินไป');
  if (value === null || value === undefined || typeof value !== 'object') return true;
  state.count++;
  if (state.count > 5000) throw new Error(label + ' มีสมาชิกมากเกินไป');
  if (Array.isArray(value)) {
    value.forEach(function (item) { svcAssertSafeJsonObject_(item, label, depth + 1, state); });
    return true;
  }
  Object.keys(value).forEach(function (key) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(label + ' มี key ที่ไม่อนุญาต: ' + key);
    }
    svcAssertSafeJsonObject_(value[key], label, depth + 1, state);
  });
  return true;
}

function svcNormalizeFormSchema_(raw) {
  const source = svcNormalizeJsonValue_(raw, 'FormSchemaJSON', []);
  if (!Array.isArray(source)) throw new Error('FormSchemaJSON ต้องเป็น array');
  if (source.length > 40) throw new Error('ฟอร์มบริการกำหนดได้ไม่เกิน 40 ช่อง');
  const used = {};
  const allowedTypes = ['text', 'textarea', 'number', 'date', 'datetime-local', 'select',
    'checkbox', 'email', 'url'];
  return source.map(function (item, index) {
    item = item && typeof item === 'object' ? item : {};
    const rawKey = sanitizeText(item.key || item.id, 60);
    if (rawKey === '__proto__' || rawKey === 'prototype' || rawKey === 'constructor') {
      throw new Error('Form schema ใช้ key ที่ไม่อนุญาต: ' + rawKey);
    }
    const key = rawKey.replace(/[^A-Za-z0-9_]/g, '_');
    const label = sanitizeText(item.label || item.name, 160);
    if (!key || !label) throw new Error('Form schema ลำดับ ' + (index + 1) + ' ต้องมี key และ label');
    if (used[key]) throw new Error('Form schema มี key ซ้ำ: ' + key);
    used[key] = true;
    let type = sanitizeText(item.type, 40).toLowerCase() || 'text';
    if (allowedTypes.indexOf(type) === -1) throw new Error('ชนิดช่องข้อมูลไม่รองรับ: ' + type);
    let options = [];
    if (Array.isArray(item.options)) {
      options = item.options.slice(0, 100).map(function (o) {
        if (o && typeof o === 'object') {
          return { value: sanitizeText(o.value, 200), label: sanitizeText(o.label || o.value, 200) };
        }
        return sanitizeText(o, 200);
      });
    }
    if (type === 'select' && !options.length) throw new Error('ช่อง ' + label + ' ต้องมี options');
    return {
      key: key,
      label: label,
      type: type,
      required: svcIsYes_(item.required),
      options: options,
      help: sanitizeText(item.help, 500),
      placeholder: sanitizeText(item.placeholder, 200),
      maxLength: svcClamp_(item.maxLength, 1, 5000, type === 'textarea' ? 3000 : 500)
    };
  });
}

function svcNormalizeChecklist_(raw) {
  const source = svcNormalizeJsonValue_(raw, 'ChecklistJSON', []);
  if (!Array.isArray(source)) throw new Error('ChecklistJSON ต้องเป็น array');
  if (source.length > 50) throw new Error('Checklist กำหนดได้ไม่เกิน 50 รายการ');
  return source.map(function (item, index) {
    if (typeof item === 'string') item = { name: item };
    item = item && typeof item === 'object' ? item : {};
    const name = sanitizeText(item.name || item.taskName || item.title, 200);
    if (!name) throw new Error('Checklist ลำดับ ' + (index + 1) + ' ไม่มีชื่อรายการ');
    return {
      name: name,
      type: sanitizeText(item.type || item.taskType, 80) || 'งานดำเนินการ',
      ownerGroup: sanitizeText(item.ownerGroup, 160),
      assignee: sanitizeText(item.assignee, 160).toLowerCase(),
      required: item.required === undefined ? true : svcIsYes_(item.required),
      evidenceRequired: svcIsYes_(item.evidenceRequired),
      slaHours: item.slaHours === undefined || item.slaHours === '' ? null :
        svcClamp_(item.slaHours, 1, 720, 24),
      notes: sanitizeText(item.notes, 500)
    };
  });
}

function svcNormalizeWorkflowDefinition_(raw) {
  const definition = svcNormalizeJsonValue_(raw, 'WorkflowJSON', {});
  if (!definition || typeof definition !== 'object') {
    throw new Error('WorkflowJSON ต้องเป็น array หรือ object');
  }
  // Parse once during catalog save/request creation so malformed policy never
  // becomes an unusable snapshot. Extra metadata remains permitted.
  svcWorkflowPolicy_(definition);
  return definition;
}

function svcWorkflowStatus_(entry, label) {
  let value = entry;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    value = entry.status !== undefined ? entry.status :
      (entry.value !== undefined ? entry.value :
        (entry.id !== undefined ? entry.id : entry.name));
  }
  const status = sanitizeText(value, 80);
  const known = Object.keys(SVC_REQUEST_STATUS).map(function (key) { return SVC_REQUEST_STATUS[key]; });
  if (!status || known.indexOf(status) === -1) {
    throw new Error((label || 'WorkflowJSON') + ' มีสถานะที่ไม่รองรับ: ' + status);
  }
  return status;
}

function svcWorkflowPolicy_(definition) {
  const policy = { stateLists: [], hasTransitions: false, edges: {} };
  if (Array.isArray(definition)) {
    policy.stateLists.push(definition.map(function (entry, index) {
      return svcWorkflowStatus_(entry, 'WorkflowJSON ลำดับ ' + (index + 1));
    }));
    return policy;
  }
  if (!definition || typeof definition !== 'object') {
    throw new Error('WorkflowJSON ต้องเป็น array หรือ object');
  }

  ['states', 'allowedStatuses'].forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(definition, key)) return;
    if (!Array.isArray(definition[key])) throw new Error('WorkflowJSON.' + key + ' ต้องเป็น array');
    policy.stateLists.push(definition[key].map(function (entry, index) {
      return svcWorkflowStatus_(entry, 'WorkflowJSON.' + key + ' ลำดับ ' + (index + 1));
    }));
  });

  if (!Object.prototype.hasOwnProperty.call(definition, 'transitions')) return policy;
  policy.hasTransitions = true;
  const addEdge = function (from, to, label) {
    from = svcWorkflowStatus_(from, label + '.from');
    to = svcWorkflowStatus_(to, label + '.to');
    (policy.edges[from] = policy.edges[from] || {})[to] = true;
  };
  const transitions = definition.transitions;
  if (Array.isArray(transitions)) {
    transitions.forEach(function (edge, index) {
      const label = 'WorkflowJSON.transitions ลำดับ ' + (index + 1);
      if (Array.isArray(edge) && edge.length === 2) {
        addEdge(edge[0], edge[1], label);
        return;
      }
      if (!edge || typeof edge !== 'object' || Array.isArray(edge) ||
        !Object.prototype.hasOwnProperty.call(edge, 'from') ||
        !Object.prototype.hasOwnProperty.call(edge, 'to')) {
        throw new Error(label + ' ต้องระบุ from และ to');
      }
      const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
      if (!targets.length) throw new Error(label + '.to ห้ามเป็น array ว่าง');
      targets.forEach(function (to) { addEdge(edge.from, to, label); });
    });
  } else if (transitions && typeof transitions === 'object') {
    Object.keys(transitions).forEach(function (from) {
      if (!Array.isArray(transitions[from]) || !transitions[from].length) {
        throw new Error('WorkflowJSON.transitions.' + from + ' ต้องเป็น array ที่ไม่ว่าง');
      }
      transitions[from].forEach(function (to) {
        addEdge(from, to, 'WorkflowJSON.transitions.' + from);
      });
    });
  } else {
    throw new Error('WorkflowJSON.transitions ต้องเป็น array หรือ object');
  }
  return policy;
}

function svcAssertWorkflowStatusAllowed_(definition, status) {
  const policy = svcWorkflowPolicy_(definition);
  if (policy.stateLists.some(function (states) { return states.indexOf(status) === -1; })) {
    throw new Error('Workflow ของบริการไม่อนุญาตสถานะ "' + status + '"');
  }
  return policy;
}

function svcNormalizeEligibility_(value) {
  if (value === null || value === undefined || value === '') return 'ทั้งหมด';
  let normalized = value;
  if (typeof value !== 'object') {
    const text = sanitizeText(value, 3000) || 'ทั้งหมด';
    if (!/^[\[{]/.test(text)) return text;
    normalized = svcNormalizeJsonValue_(text, 'Eligibility', {});
  } else {
    normalized = svcNormalizeJsonValue_(value, 'Eligibility', {});
  }

  if (Array.isArray(normalized)) {
    if (!normalized.length) throw new Error('Eligibility แบบ array ต้องมีอย่างน้อย 1 ค่า');
    if (normalized.length > 200) throw new Error('Eligibility กำหนดได้ไม่เกิน 200 ค่า');
    normalized = normalized.map(function (entry, index) {
      if (entry === null || ['string', 'number', 'boolean'].indexOf(typeof entry) === -1) {
        throw new Error('Eligibility array ลำดับ ' + (index + 1) + ' ต้องเป็นข้อความ');
      }
      const token = sanitizeText(entry, 200);
      if (!token) throw new Error('Eligibility array ห้ามมีค่าว่าง');
      return token;
    });
  } else if (normalized && typeof normalized === 'object') {
    const allowedKeys = ['emails', 'roles', 'departments'];
    const keys = Object.keys(normalized);
    const unknownKeys = keys.filter(function (key) { return allowedKeys.indexOf(key) === -1; });
    if (unknownKeys.length) {
      throw new Error('Eligibility มี key ที่ไม่รองรับ: ' + unknownKeys.join(', '));
    }
    const clean = {};
    let total = 0;
    allowedKeys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) return;
      if (!Array.isArray(normalized[key])) throw new Error('Eligibility.' + key + ' ต้องเป็น array');
      if (normalized[key].length > 200) throw new Error('Eligibility.' + key + ' กำหนดได้ไม่เกิน 200 ค่า');
      clean[key] = normalized[key].map(function (entry, index) {
        if (entry === null || ['string', 'number'].indexOf(typeof entry) === -1) {
          throw new Error('Eligibility.' + key + ' ลำดับ ' + (index + 1) + ' ต้องเป็นข้อความ');
        }
        const token = sanitizeText(entry, 200);
        if (!token) throw new Error('Eligibility.' + key + ' ห้ามมีค่าว่าง');
        if (key === 'emails' && !isValidEmail(token)) {
          throw new Error('Eligibility.emails มีอีเมลไม่ถูกต้อง: ' + token);
        }
        return key === 'emails' ? token.toLowerCase() : token;
      });
      total += clean[key].length;
    });
    if (!total) {
      throw new Error('Eligibility แบบ object ต้องมี emails, roles หรือ departments อย่างน้อย 1 ค่า');
    }
    normalized = clean;
  } else {
    throw new Error('Eligibility JSON ต้องเป็น array หรือ object');
  }

  const json = JSON.stringify(normalized);
  if (json.length > 3000) throw new Error('Eligibility ยาวเกินไป');
  return json;
}

function svcIsEligible_(catalog, user) {
  if (!user || !user.email) return false;
  if (user.role === ROLES.IT_ADMIN) return true;
  const raw = String(catalog.Eligibility || '').trim();
  const universalRule = raw.toLowerCase();
  if (!raw || raw === 'ทั้งหมด' || universalRule === 'all' || raw === '*' ||
    universalRule === 'พนักงานสถานะ active') return true;
  let rule = null;
  if (/^[\[{]/.test(raw)) {
    try { rule = JSON.parse(raw); } catch (e) { rule = null; }
  }
  const email = String(user.email || '').toLowerCase();
  const role = String(user.role || '').toLowerCase();
  const dept = String(user.dept || '').toLowerCase();
  if (Array.isArray(rule)) {
    if (!rule.length || rule.some(function (v) {
      return v === null || ['string', 'number', 'boolean'].indexOf(typeof v) === -1;
    })) return false;
    return rule.some(function (v) {
      v = String(v || '').toLowerCase();
      return v === email || v === role || v === dept || v === '*';
    });
  }
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    const allowedKeys = ['emails', 'roles', 'departments'];
    const keys = Object.keys(rule);
    if (!keys.length || keys.some(function (key) { return allowedKeys.indexOf(key) === -1; })) return false;
    if (keys.some(function (key) { return !Array.isArray(rule[key]); })) return false;
    const emails = rule.emails || [];
    const roles = rule.roles || [];
    const departments = rule.departments || [];
    if (!emails.length && !roles.length && !departments.length) return false;
    if ([emails, roles, departments].some(function (values) {
      return values.some(function (v) {
        return v === null || ['string', 'number'].indexOf(typeof v) === -1;
      });
    })) return false;
    return emails.map(String).map(function (v) { return v.toLowerCase(); }).indexOf(email) > -1 ||
      roles.map(String).map(function (v) { return v.toLowerCase(); }).indexOf(role) > -1 ||
      departments.map(String).map(function (v) { return v.toLowerCase(); }).indexOf(dept) > -1;
  }
  const tokens = raw.split(/[,;|]/).map(function (v) { return v.trim().toLowerCase(); }).filter(String);
  return tokens.indexOf(email) > -1 || tokens.indexOf(role) > -1 || tokens.indexOf(dept) > -1;
}

function svcValidateAnswers_(schemaRaw, answers) {
  const schema = svcNormalizeFormSchema_(schemaRaw);
  answers = answers && typeof answers === 'object' ? answers : {};
  const clean = {};
  schema.forEach(function (field) {
    let value = answers[field.key];
    if (field.type === 'checkbox') value = value === true || String(value).toLowerCase() === 'true';
    const missing = field.type === 'checkbox' ? value !== true :
      (value === undefined || value === null || String(value).trim() === '');
    if (field.required && missing) throw new Error('กรุณากรอก: ' + field.label);
    if (missing) { clean[field.key] = field.type === 'checkbox' ? false : ''; return; }
    if (field.type === 'number') {
      const n = Number(value);
      if (!isFinite(n)) throw new Error(field.label + ' ต้องเป็นตัวเลข');
      clean[field.key] = n;
      return;
    }
    if (field.type === 'email' && !isValidEmail(value)) throw new Error('รูปแบบ ' + field.label + ' ไม่ถูกต้อง');
    if (field.type === 'url' && !/^https:\/\//i.test(String(value))) {
      throw new Error(field.label + ' ต้องเป็น HTTPS URL');
    }
    if (field.type === 'date' || field.type === 'datetime-local') {
      if (!svcIsStrictDateInput_(value, field.type === 'datetime-local')) {
        throw new Error('รูปแบบวันที่ของ ' + field.label + ' ไม่ถูกต้อง');
      }
    }
    if (field.type === 'select') {
      const allowed = field.options.map(function (o) {
        return String(o && typeof o === 'object' ? o.value : o);
      });
      if (allowed.indexOf(String(value)) === -1) throw new Error('ตัวเลือก ' + field.label + ' ไม่ถูกต้อง');
    }
    clean[field.key] = sanitizeText(value, field.maxLength || 500);
  });
  return clean;
}

function svcIsStrictDateInput_(value, withTime) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  const pattern = withTime ?
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/ :
    /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = pattern.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return false;
  if (!withTime) return true;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59;
}

function svcResolveApproval_(catalog, user) {
  const mode = String(catalog.ApprovalMode || SVC_APPROVAL_MODE[0]);
  // A central Workflow Definition can route by role, department or group and
  // therefore does not require the legacy single-approver mode. The engine
  // will populate ServiceRequests.Approver with the active step assignees.
  if (mode === 'ไม่ต้องอนุมัติ') {
    return String(catalog.WorkflowDefinitionID || '').trim() ?
      { required: true, email: '' } : { required: false, email: '' };
  }
  let email = '';
  if (mode === 'หัวหน้างาน') {
    const account = findRow_(SHEETS.USERS, 'Email', user.email);
    email = account ? String(account.Supervisor || '').toLowerCase().trim() : '';
    if (!email || !isValidEmail(email)) {
      throw new Error('บัญชีของท่านยังไม่ได้กำหนดหัวหน้างาน (Supervisor)');
    }
  } else if (mode === 'ผู้อนุมัติที่กำหนด') {
    email = String(catalog.Approver || '').toLowerCase().trim();
    if (!isValidEmail(email)) throw new Error('Catalog ยังไม่ได้กำหนดผู้อนุมัติที่ถูกต้อง');
  } else {
    throw new Error('รูปแบบการอนุมัติของ Catalog ไม่ถูกต้อง');
  }
  if (email === user.email) throw new Error('ผู้ยื่นคำขอไม่สามารถเป็นผู้อนุมัติคำขอของตนเองได้');
  const approver = findRow_(SHEETS.USERS, 'Email', email);
  if (!approver || String(approver.Status).toLowerCase() !== 'active') {
    throw new Error('ผู้อนุมัติที่กำหนดไม่ใช่บัญชี Active ในระบบ');
  }
  if (SVC_APPROVER_ROLES.indexOf(approver.Role) === -1) {
    throw new Error('ผู้อนุมัติที่กำหนดต้องมีบทบาท Approver, ITAdmin, Executive หรือ DPO');
  }
  return { required: true, email: email };
}

function svcCreateRequestTasks_(requestId, checklist, catalog, startAt, actorEmail) {
  checklist.forEach(function (item, index) {
    svcAppendRequestTaskLocked_(requestId, item, index + 1, catalog, startAt, actorEmail);
  });
}

function svcAppendRequestTaskLocked_(requestId, item, sequence, catalog, startAt, actorEmail) {
  const evidenceMarker = item.evidenceRequired ? 'EvidenceRequired=Yes' : 'EvidenceRequired=No';
  svcAppendRowLocked_(SHEETS.SERVICE_REQUEST_TASK, {
    TaskID: generateId('SRT'),
    RequestID: requestId,
    Sequence: sequence,
    TaskName: item.name,
    TaskType: item.type,
    OwnerGroup: item.ownerGroup || catalog.FulfillmentGroup || 'IT Service Desk',
    Assignee: item.assignee || '',
    IsRequired: item.required ? 'Yes' : 'No',
    Status: 'รอดำเนินการ',
    DueAt: item.slaHours ? addBusinessHours_(startAt, item.slaHours) :
      addBusinessHours_(startAt, svcClamp_(catalog.SLAHours, 1, 720, 24)),
    Notes: evidenceMarker + (item.notes ? '\n' + item.notes : '')
  }, actorEmail);
}

/** Call only while svcWithScriptLock_ owns the ScriptLock. */
function svcRepairRequestChildrenLocked_(request, actor) {
  const requestId = String(request.RequestID || '');
  if (!requestId) throw new Error('ไม่พบ RequestID สำหรับซ่อมข้อมูลคำขอ');
  const checklist = svcNormalizeChecklist_(request.ChecklistSnapshotJSON);
  const existingTasks = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_TASK).filter(function (task) {
    return String(task.RequestID || '') === requestId;
  });
  const sequences = {};
  existingTasks.forEach(function (task) {
    const sequence = parseInt(task.Sequence, 10);
    if (sequence > 0) sequences[sequence] = true;
  });
  let startAt = request.Timestamp instanceof Date ? request.Timestamp : new Date(request.Timestamp || 0);
  if (isNaN(startAt)) startAt = new Date();
  let repairedTasks = 0;
  const catalogSnapshot = {
    FulfillmentGroup: request.AssignedGroup || 'IT Service Desk',
    SLAHours: svcClamp_(request.SLAHours, 1, 720, 24)
  };
  checklist.forEach(function (item, index) {
    const sequence = index + 1;
    if (sequences[sequence]) return;
    svcAppendRequestTaskLocked_(requestId, item, sequence, catalogSnapshot, startAt,
      actor && actor.email || 'system');
    repairedTasks++;
  });

  const hasCreateHistory = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY).some(function (row) {
    return String(row.RequestID || '') === requestId && String(row.Action || '') === 'CREATE_REQUEST';
  });
  if (!hasCreateHistory) {
    svcAddHistory_(requestId, actor, 'CREATE_REQUEST', '', request.Status,
      'ยื่นคำขอบริการ ' + String(request.ServiceCode || '') + ' (ซ่อมรายการจาก idempotent retry)', true);
  }
  if (repairedTasks || !hasCreateHistory) {
    svcWriteAuditLocked_(actor, 'REPAIR_IDEMPOTENT_REQUEST', 'serviceCatalog',
      SHEETS.SERVICE_REQUEST, requestId,
      'tasks=' + repairedTasks + ', history=' + (hasCreateHistory ? 'existing' : 'repaired'), 'success');
  }
  return { tasks: repairedTasks, history: !hasCreateHistory };
}

function svcTaskEvidenceRequired_(task) {
  return /^EvidenceRequired=Yes(?:\n|$)/.test(String(task.Notes || '')) ||
    String(task.TaskType || '') === 'หลักฐาน';
}

function svcRequestForAction_(requestId) {
  const req = findRow_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
  if (!req) throw new Error('ไม่พบคำขอบริการ ' + requestId);
  return req;
}

function svcCanApproveRequest_(req, user) {
  if (!req || !user || String(req.Status || '') !== SVC_REQUEST_STATUS.PENDING_APPROVAL) return false;
  const email = String(user.email || '').toLowerCase();
  const instanceId = String(req.WorkflowInstanceID || '').trim();
  if (instanceId && typeof wfCanActApproval_ === 'function') {
    const instance = findRowEnsured_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instanceId);
    if (!instance) return false;
    return readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).some(function (approval) {
      return String(approval.InstanceID || '') === instanceId &&
        wfCanActApproval_(approval, instance, user, false);
    });
  }
  return String(req.Approver || '').split(',').map(function (value) {
    return value.trim().toLowerCase();
  }).indexOf(email) > -1 && String(req.RequesterEmail || '').toLowerCase() !== email;
}

function svcIsWorkflowParticipant_(req, user) {
  const instanceId = String(req && req.WorkflowInstanceID || '').trim();
  const email = String(user && user.email || '').toLowerCase();
  if (!instanceId || !email || !SHEETS.WORKFLOW_APPROVAL) return false;
  return readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).some(function (approval) {
    return String(approval.InstanceID || '') === instanceId &&
      (String(approval.ApproverEmail || '').toLowerCase() === email ||
       String(approval.OriginalApproverEmail || '').toLowerCase() === email ||
       String(approval.DecisionBy || '').toLowerCase() === email);
  });
}

function svcCanViewRequest_(req, user) {
  const email = String(user.email || '').toLowerCase();
  return user.role === ROLES.IT_ADMIN ||
    String(req.RequesterEmail || '').toLowerCase() === email ||
    svcCanApproveRequest_(req, user) ||
    svcIsWorkflowParticipant_(req, user) ||
    String(req.Assignee || '').toLowerCase() === email;
}

function svcRequestWorkflow_(req) {
  const raw = svcNormalizeJsonValue_(req.WorkflowJSON, 'WorkflowJSON', {});
  return {
    closeMode: raw.closeMode || 'ผู้ขอยืนยัน',
    closeCondition: raw.closeCondition || '',
    approvalMode: raw.approvalMode || '',
    definition: svcNormalizeWorkflowDefinition_(raw.definition === undefined ? {} : raw.definition),
    integration: raw.integration && typeof raw.integration === 'object' &&
      !Array.isArray(raw.integration) ? raw.integration : null
  };
}

function svcAssertRequestTransition_(fromStatus, toStatus, req) {
  const transitions = {};
  transitions[SVC_REQUEST_STATUS.PENDING_APPROVAL] = [SVC_REQUEST_STATUS.PENDING_ASSIGNMENT,
    SVC_REQUEST_STATUS.REJECTED, SVC_REQUEST_STATUS.CANCELLED];
  transitions[SVC_REQUEST_STATUS.PENDING_ASSIGNMENT] = [SVC_REQUEST_STATUS.IN_PROGRESS,
    SVC_REQUEST_STATUS.CANCELLED];
  transitions[SVC_REQUEST_STATUS.IN_PROGRESS] = [SVC_REQUEST_STATUS.WAITING_USER,
    SVC_REQUEST_STATUS.WAITING_VENDOR, SVC_REQUEST_STATUS.PENDING_CONFIRMATION,
    SVC_REQUEST_STATUS.CLOSED, SVC_REQUEST_STATUS.CANCELLED];
  transitions[SVC_REQUEST_STATUS.WAITING_USER] = [SVC_REQUEST_STATUS.IN_PROGRESS,
    SVC_REQUEST_STATUS.WAITING_VENDOR, SVC_REQUEST_STATUS.PENDING_CONFIRMATION,
    SVC_REQUEST_STATUS.CLOSED, SVC_REQUEST_STATUS.CANCELLED];
  transitions[SVC_REQUEST_STATUS.WAITING_VENDOR] = [SVC_REQUEST_STATUS.IN_PROGRESS,
    SVC_REQUEST_STATUS.WAITING_USER, SVC_REQUEST_STATUS.PENDING_CONFIRMATION,
    SVC_REQUEST_STATUS.CLOSED, SVC_REQUEST_STATUS.CANCELLED];
  transitions[SVC_REQUEST_STATUS.PENDING_CONFIRMATION] = [SVC_REQUEST_STATUS.IN_PROGRESS,
    SVC_REQUEST_STATUS.CLOSED];
  const from = String(fromStatus || '');
  const to = String(toStatus || '');
  if (from !== to && (transitions[from] || []).indexOf(to) === -1) {
    throw new Error('ไม่สามารถเปลี่ยนสถานะจาก "' + fromStatus + '" เป็น "' + toStatus + '" ได้');
  }
  if (req) {
    const definition = svcRequestWorkflow_(req).definition;
    const policy = svcAssertWorkflowStatusAllowed_(definition, from);
    svcAssertWorkflowStatusAllowed_(definition, to);
    // Explicit catalog transitions can only narrow the server table above.
    // A same-state assignment update is not a lifecycle expansion.
    if (from !== to && policy.hasTransitions &&
      !(policy.edges[from] && policy.edges[from][to])) {
      throw new Error('Workflow ของบริการไม่อนุญาต transition จาก "' + from + '" เป็น "' + to + '"');
    }
  }
  return true;
}

function svcValidateRequestStatusActionLocked_(req, newStatus, note, actor) {
  svcAssertRequestTransition_(req.Status, newStatus, req);
  const flow = svcRequestWorkflow_(req);
  const finalizing = newStatus === SVC_REQUEST_STATUS.PENDING_CONFIRMATION ||
    newStatus === SVC_REQUEST_STATUS.CLOSED;
  if (finalizing) {
    svcAssertIntegrationComplete_(req);
    svcAssertRequiredTasksComplete_(req.RequestID, actor);
    if (!note) throw new Error('กรุณาระบุผลการดำเนินการก่อนส่งมอบ/ปิดงาน');
    if (flow.closeMode === 'ผู้ขอยืนยัน' && newStatus !== SVC_REQUEST_STATUS.PENDING_CONFIRMATION) {
      throw new Error('บริการนี้กำหนดให้ผู้ขอยืนยันผลก่อนปิดงาน');
    }
    if (flow.closeMode === 'IT ปิดงาน' && newStatus !== SVC_REQUEST_STATUS.CLOSED) {
      throw new Error('บริการนี้กำหนดให้ IT ปิดงานโดยตรง');
    }
  }
  return { finalizing: finalizing, flow: flow };
}

function svcValidateTaskActionLocked_(task, req, status, attachmentIds) {
  if (svcIsTerminal_(req.Status) || req.Status === SVC_REQUEST_STATUS.PENDING_APPROVAL ||
      req.Status === SVC_REQUEST_STATUS.PENDING_CONFIRMATION) {
    throw new Error('คำขอนี้ไม่อยู่ในสถานะที่แก้ไข Checklist ได้');
  }
  if (status === 'ข้าม' && svcIsYes_(task.IsRequired)) {
    throw new Error('Checklist ที่บังคับไม่สามารถข้ามได้');
  }
  const ids = svcNormalizeAttachmentIds_(attachmentIds);
  if (status === 'เสร็จสิ้น' && svcTaskEvidenceRequired_(task) &&
      !ids.length && !String(task.EvidenceLink || '').trim()) {
    throw new Error('Checklist นี้กำหนดให้แนบหลักฐานก่อนทำเครื่องหมายเสร็จสิ้น');
  }
  return true;
}

function svcAssertRequiredTasksComplete_(requestId, actor) {
  const required = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_TASK).filter(function (task) {
    return String(task.RequestID) === String(requestId) && svcIsYes_(task.IsRequired);
  });
  const pending = required.filter(function (task) {
    return String(task.Status) !== 'เสร็จสิ้น';
  });
  if (pending.length) {
    throw new Error('ยังมี Checklist บังคับที่ไม่เสร็จ: ' + pending.slice(0, 5)
      .map(function (t) { return t.TaskName; }).join(', '));
  }
  required.filter(svcTaskEvidenceRequired_).forEach(function (task) {
    const ids = svcNormalizeAttachmentIds_(task.EvidenceAttachmentIDsJSON);
    if (ids.length) {
      if (typeof arAssertActiveEvidenceForRecordLocked_ !== 'function') {
        throw new Error('Attachment Registry ยังไม่พร้อมตรวจหลักฐานบังคับ');
      }
      arAssertActiveEvidenceForRecordLocked_(ids, 'serviceCatalog', task.TaskID, {
        recordType: 'ServiceRequestTask', fieldName: 'EvidenceAttachmentIDsJSON',
        attachmentRole: 'TASK_EVIDENCE'
      }, actor);
    } else if (!String(task.EvidenceLink || '').trim()) {
      throw new Error('Checklist บังคับไม่มีหลักฐานที่ใช้งานได้: ' + String(task.TaskName || task.TaskID));
    }
  });
}

function svcAssertIntegrationComplete_(request) {
  let integration = svcRequestWorkflow_(request).integration;
  if (!integration) {
    const catalog = findRow_(SHEETS.SERVICE_CATALOG, 'CatalogID', request.CatalogID);
    if (catalog) integration = {
      target: catalog.FulfillmentTarget,
      autoCreate: catalog.AutoCreateTarget
    };
  }
  if (!integration || !svcIsYes_(integration.autoCreate !== undefined ?
    integration.autoCreate : integration.autoCreateTarget) || !integration.target) return true;
  const status = String(request.IntegrationStatus || '').toUpperCase();
  if (status !== 'COMPLETED' && status.indexOf('LINKED:') !== 0) {
    throw new Error(status === 'ERROR' ?
      'Integration สร้างรายการปลายทางไม่สำเร็จ กรุณาให้ IT ตรวจสอบและ Retry ก่อนปิดงาน' :
      'Integration ยังสร้างรายการปลายทางไม่เสร็จ กรุณาประมวลผล Outbox ก่อนปิดงาน');
  }
  return true;
}

function svcAssertItAssignee_(email) {
  const row = findRow_(SHEETS.USERS, 'Email', email);
  if (!row || String(row.Status).toLowerCase() !== 'active' || row.Role !== ROLES.IT_ADMIN) {
    throw new Error('ผู้รับผิดชอบต้องเป็นบัญชี ITAdmin ที่ Active');
  }
  return row;
}

function svcItAssignees_() {
  return readSheetObjects_(SHEETS.USERS).filter(function (u) {
    return String(u.Status).toLowerCase() === 'active' && u.Role === ROLES.IT_ADMIN;
  }).map(function (u) {
    return { value: String(u.Email).toLowerCase(), label: (u.FullName || u.Email) + ' · ITAdmin' };
  });
}

function svcAddHistory_(requestId, actor, action, fromStatus, toStatus, comment, isPublic) {
  svcAppendRowLocked_(SHEETS.SERVICE_REQUEST_HISTORY, {
    HistoryID: generateId('SRH'),
    RequestID: requestId,
    Action: sanitizeText(action, 80),
    StatusFrom: sanitizeText(fromStatus, 80),
    StatusTo: sanitizeText(toStatus, 80),
    Comment: sanitizeText(comment, 2000),
    ActorEmail: actor && actor.email ? actor.email : String(actor || ''),
    ActorRole: actor && actor.role ? actor.role : '',
    IsPublic: isPublic ? 'Yes' : 'No'
  }, actor && actor.email ? actor.email : String(actor || 'system'));
}

function svcAppendNote_(oldValue, actor, note) {
  note = sanitizeText(note, 1000);
  if (!note) return oldValue || '';
  const entry = '[' + fmtDateTime(new Date()) + ' ' + actor + '] ' + note;
  return oldValue ? String(oldValue) + ' | ' + entry : entry;
}

function svcHttpsUrl_(value, label) {
  const url = sanitizeText(value, 1000);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) throw new Error((label || 'URL') + ' ต้องเป็น HTTPS');
  return url;
}

/**
 * Accept only a URL returned by uploadEvidence for this module and user.
 * AuditTrail is the trust anchor, avoiding a second DriveApp read/OAuth scope.
 */
function svcServiceCatalogDriveFileId_(value) {
  const url = sanitizeText(value, 1000);
  if (!url) return '';
  const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})(?:\/(?:view|edit))?\/?(?:[?#].*)?$/i.exec(url);
  return match ? match[1] : '';
}

function svcTrustedServiceCatalogAttachment_(value, user) {
  const url = sanitizeText(value, 1000);
  if (!url) return '';
  const fileId = svcServiceCatalogDriveFileId_(url);
  if (!fileId) {
    throw new Error('เอกสารแนบต้องเป็นไฟล์ที่อัปโหลดผ่านระบบ Service Catalog เท่านั้น');
  }
  const email = String(user && user.email || '').toLowerCase();
  const trusted = readSheetObjects_(SHEETS.AUDIT_TRAIL).some(function (row) {
    return String(row.Action || '') === 'UPLOAD_EVIDENCE' &&
      String(row.Module || '') === 'serviceCatalog' &&
      String(row.TargetID || '') === fileId &&
      String(row.ActorEmail || '').toLowerCase() === email &&
      String(row.Result || '').toLowerCase() === 'success';
  });
  if (!trusted) {
    throw new Error('ไม่พบหลักฐานการอัปโหลดไฟล์นี้ผ่านระบบ Service Catalog ของท่าน');
  }
  try {
    const file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) throw new Error('trashed');
  } catch (e) {
    throw new Error('ไฟล์แนบไม่อยู่ใน Drive หรือถูกนำออกแล้ว กรุณาอัปโหลดใหม่');
  }
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}

/** ล้างไฟล์ที่ upload สำเร็จแต่ไม่เคยถูกผูกกับ Request (best effort). */
function svcDiscardUnclaimedServiceCatalogAttachment_(value, user, reason) {
  try {
    const fileId = svcServiceCatalogDriveFileId_(value);
    if (!fileId) return false;
    const referenced = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).some(function (request) {
      return svcServiceCatalogDriveFileId_(request.AttachmentURL) === fileId;
    });
    if (referenced) return false;
    const file = DriveApp.getFileById(fileId);
    if (!file.isTrashed()) file.setTrashed(true);
    writeAudit_(user || { email:'system', role:'system' }, 'DISCARD_UNCLAIMED_EVIDENCE',
      'serviceCatalog', '', fileId, sanitizeText(reason, 500), 'success');
    return true;
  } catch (e) {
    console.error('svcDiscardUnclaimedServiceCatalogAttachment_ error: ' + e.message);
    return false;
  }
}

/** Best-effort cleanup only for uploads that never obtained a durable parent row. */
function svcDiscardUnclaimedRegisteredAttachments_(attachmentIds, actor, reason) {
  svcNormalizeAttachmentIds_(attachmentIds).forEach(function (attachmentId) {
    try {
      if (typeof arFindAttachment_ !== 'function' ||
          typeof softDeleteRegisteredAttachment !== 'function') return;
      const row = arFindAttachment_(attachmentId);
      if (!row || String(row.Status || '').toUpperCase() !== 'STAGED') return;
      const uploader = String(row.UploaderEmail || row.UploadedBy || row.CreatedBy || '').toLowerCase();
      if (uploader && uploader !== String(actor && actor.email || '').toLowerCase()) return;
      softDeleteRegisteredAttachment(attachmentId,
        sanitizeText(reason || 'unclaimed service request attachment', 500));
    } catch (cleanupError) {
      console.error('svcDiscardUnclaimedRegisteredAttachments_: ' + cleanupError.message);
    }
  });
}

function svcNormalizeAttachmentIds_(value) {
  let list = value;
  if (typeof list === 'string') {
    const text = list.trim();
    if (!text) list = [];
    else if (text.charAt(0) === '[') {
      list = svcNormalizeJsonValue_(text, 'AttachmentIDsJSON', []);
    } else list = text.split(',');
  }
  if (!Array.isArray(list)) list = list ? [list] : [];
  const seen = {};
  return list.map(function (id) { return sanitizeText(id, 120); }).filter(function (id) {
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(id) || seen[id]) return false;
    seen[id] = true;
    return true;
  }).slice(0, 20);
}

/**
 * Claim/link IDs before the business update. Linking is idempotent; if the
 * later status update fails the file remains safely attached to that record.
 */
function svcClaimRegisteredAttachments_(attachmentIds, moduleKey, recordId, options, actor) {
  const ids = svcNormalizeAttachmentIds_(attachmentIds);
  if (!ids.length) return [];
  if (typeof claimRegisteredAttachment_ !== 'function') {
    throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
  }
  return ids.map(function (attachmentId) {
    const claimed = claimRegisteredAttachment_(attachmentId, moduleKey, recordId, options || {}, actor);
    return String(claimed && claimed.AttachmentID || attachmentId);
  });
}

function svcAssertClaimableAttachments_(attachmentIds, recordType, fieldName, attachmentRole, actor) {
  const ids = svcNormalizeAttachmentIds_(attachmentIds);
  if (!ids.length) return [];
  if (typeof arAssertClaimableAttachment_ !== 'function') {
    throw new Error('Attachment Registry ยังไม่พร้อมใช้งาน');
  }
  ids.forEach(function (attachmentId) {
    arAssertClaimableAttachment_(attachmentId, 'serviceCatalog', '', {
      recordType: recordType, fieldName: fieldName, attachmentRole: attachmentRole,
      classification: 'Confidential', isEvidence: true
    }, actor);
  });
  return ids;
}

/**
 * Claim staged/legacy attachments only after the Service Request row exists,
 * then atomically publish their registry IDs on the source record. Re-running
 * is safe because AttachmentLinks and the ID array are both idempotent.
 */
function svcEnsureRequestAttachments_(requestId, legacyUrl, attachmentIds, actor) {
  const request = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
  if (!request) throw new Error('ไม่พบคำขอบริการสำหรับผูกไฟล์แนบ');
  let ids = svcNormalizeAttachmentIds_(request.AttachmentIDsJSON);
  const requestedIds = svcNormalizeAttachmentIds_(attachmentIds);
  const unexpected = requestedIds.filter(function (id) { return ids.indexOf(id) === -1; });
  if (unexpected.length) {
    throw new Error('Attachment replay contains IDs outside the durable request intent');
  }
  // The source row is the sole replay authority. This replaces the former
  // claimRegisteredAttachment_ replay with terminal-safe exact-intent repair.
  // The repair helper permits a
  // terminal record only because the exact immutable field already names the
  // attachment and therefore cannot be used as an arbitrary linking bypass.
  ids.forEach(function (attachmentId) {
    arRepairDurableAttachmentIntent_(attachmentId, 'serviceCatalog', requestId, {
      recordType: 'ServiceRequest', fieldName: 'AttachmentIDsJSON',
      attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true
    }, actor);
  });
  if (legacyUrl && !ids.length && !svcIsTerminal_(request.Status)) {
    const claimedLegacy = claimLegacyRegisteredAttachment_(legacyUrl, 'serviceCatalog', requestId, {
      recordType: 'ServiceRequest', fieldName: 'AttachmentIDsJSON',
      attachmentRole: 'REQUEST_EVIDENCE', classification: 'Confidential', isEvidence: true,
      trustedOwnUpload: true
    }, actor);
    const legacyId = String(claimedLegacy && claimedLegacy.AttachmentID || '');
    if (legacyId && ids.indexOf(legacyId) === -1) ids.push(legacyId);
  }
  ids = svcNormalizeAttachmentIds_(ids);
  const nextJson = JSON.stringify(ids);
  if (String(request.AttachmentIDsJSON || '') !== nextJson) {
    svcWithScriptLock_(function () {
      const locked = svcRequestForAction_(requestId);
      const merged = svcNormalizeAttachmentIds_(locked.AttachmentIDsJSON).concat(ids);
      svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST, locked._row, {
        AttachmentIDsJSON: JSON.stringify(svcNormalizeAttachmentIds_(merged))
      }, actor && actor.email || 'system');
    });
  }
  return { ids: ids };
}

function svcCatalogDto_(r, internal) {
  const base = {
    id: r.CatalogID,
    code: r.ServiceCode,
    name: r.ServiceName,
    category: r.Category,
    description: r.Description,
    formSchema: svcNormalizeFormSchema_(r.FormSchemaJSON),
    attachmentRequired: svcIsYes_(r.AttachmentRequired),
    slaHours: Number(r.SLAHours) || 24,
    approvalMode: r.ApprovalMode || SVC_APPROVAL_MODE[0],
    status: r.Status || 'ร่าง'
  };
  if (!internal) {
    // The request UI only counts required checklist items. Do not disclose task
    // names, owners, assignees, workflow routing or administrative metadata.
    base.checklist = svcNormalizeChecklist_(r.ChecklistJSON).map(function (item) {
      return { required: !!item.required };
    });
    return base;
  }
  return Object.assign(base, {
    eligibility: r.Eligibility,
    approver: r.Approver,
    fulfillmentGroup: r.FulfillmentGroup,
    checklist: svcNormalizeChecklist_(r.ChecklistJSON),
    workflow: svcNormalizeJsonValue_(r.WorkflowJSON, 'WorkflowJSON', {}),
    workflowDefinitionId: r.WorkflowDefinitionID || '',
    fulfillmentTarget: r.FulfillmentTarget || '',
    autoCreateTarget: svcIsYes_(r.AutoCreateTarget),
    targetMapping: svcNormalizeTargetMapping_(r.TargetMappingJSON),
    closeMode: r.CloseMode || SVC_CLOSE_MODE[0],
    closeCondition: r.CloseCondition,
    version: parseInt(r.Version, 10) || 1,
    owner: r.Owner,
    notes: r.Notes
  });
}

function svcRequestDto_(r, tasks, history, internal, canAdmin) {
  const dueHours = r.DueAt ? businessHoursUntil_(r.DueAt) : null;
  const attachmentIds = svcNormalizeAttachmentIds_(r.AttachmentIDsJSON);
  const completionAttachmentIds = svcNormalizeAttachmentIds_(r.CompletionAttachmentIDsJSON);
  const publicHistory = history.filter(function (h) {
    return internal || svcIsYes_(h.IsPublic);
  }).sort(function (a, b) { return svcTime_(a.Timestamp) - svcTime_(b.Timestamp); });
  return {
    id: r.RequestID,
    catalogId: r.CatalogID,
    catalogVersion: r.CatalogVersion,
    serviceCode: r.ServiceCode,
    serviceName: r.ServiceName,
    requesterEmail: r.RequesterEmail,
    requesterName: r.RequesterName,
    department: r.Department,
    requestedFor: r.RequestedFor,
    summary: r.Summary,
    requestDetails: svcNormalizeJsonValue_(r.RequestDetailsJSON, 'RequestDetailsJSON', {}),
    justification: r.BusinessJustification,
    priority: r.Priority,
    impact: r.Impact,
    // Never expose legacy Drive locators to authenticated clients. Existing
    // values remain server-side until an administrator migrates them.
    attachment: '',
    hasLegacyAttachment: !attachmentIds.length && !!String(r.AttachmentURL || '').trim(),
    attachmentIds: attachmentIds,
    slaHours: r.SLAHours,
    dueAt: safeFmtDateTime_(r.DueAt),
    dueHours: dueHours,
    overdue: !svcIsTerminal_(r.Status) && dueHours !== null && dueHours < 0,
    approver: r.Approver,
    approvalStatus: r.ApprovalStatus,
    workflowInstanceId: r.WorkflowInstanceID || '',
    approvedBy: r.ApprovedBy,
    approvedAt: safeFmtDateTime_(r.ApprovedAt),
    assignedGroup: r.AssignedGroup,
    assignee: r.Assignee,
    status: r.Status,
    closeMode: svcRequestWorkflow_(r).closeMode,
    closeCondition: svcRequestWorkflow_(r).closeCondition,
    fulfillmentNotes: r.FulfillmentNotes,
    completionEvidence: '',
    hasLegacyCompletionEvidence: !completionAttachmentIds.length &&
      !!String(r.CompletionEvidence || '').trim(),
    completionAttachmentIds: completionAttachmentIds,
    requesterConfirmation: r.RequesterConfirmation,
    completedAt: safeFmtDateTime_(r.CompletedAt),
    closedAt: safeFmtDateTime_(r.ClosedAt),
    cancelReason: r.CancelReason,
    integrationStatus: r.IntegrationStatus || '',
    integrationError: internal ? String(r.IntegrationError || '') :
      (r.IntegrationError ? 'Integration requires IT review' : ''),
    integratedAt: safeFmtDateTime_(r.IntegratedAt),
    relatedRecords: {
      access: canAdmin ? (r.RelatedAccessRequestID || '') : (r.RelatedAccessRequestID ? 'เชื่อมแล้ว' : ''),
      ticket: canAdmin ? (r.RelatedTicketID || '') : (r.RelatedTicketID ? 'เชื่อมแล้ว' : ''),
      asset: canAdmin ? (r.RelatedAssetID || '') : (r.RelatedAssetID ? 'เชื่อมแล้ว' : ''),
      change: canAdmin ? (r.RelatedChangeID || '') : (r.RelatedChangeID ? 'เชื่อมแล้ว' : '')
    },
    createdAt: safeFmtDateTime_(r.Timestamp),
    tasks: tasks.sort(function (a, b) { return Number(a.Sequence || 0) - Number(b.Sequence || 0); })
      .map(function (t) {
        return {
          id: t.TaskID,
          sequence: t.Sequence,
          name: t.TaskName,
          type: t.TaskType,
          ownerGroup: t.OwnerGroup,
          assignee: t.Assignee,
          required: svcIsYes_(t.IsRequired),
          evidenceRequired: svcTaskEvidenceRequired_(t),
          status: t.Status,
          dueAt: safeFmtDateTime_(t.DueAt),
          completedAt: safeFmtDateTime_(t.CompletedAt),
          completedBy: t.CompletedBy,
          evidence: '',
          hasLegacyEvidence: internal && !svcNormalizeAttachmentIds_(t.EvidenceAttachmentIDsJSON).length &&
            !!String(t.EvidenceLink || '').trim(),
          evidenceAttachmentIds: internal ? svcNormalizeAttachmentIds_(t.EvidenceAttachmentIDsJSON) : [],
          notes: internal ? String(t.Notes || '').replace(/^EvidenceRequired=(?:Yes|No)\n?/, '') : ''
        };
      }),
    history: publicHistory.map(function (h) {
      return {
        id: h.HistoryID,
        action: h.Action,
        statusFrom: h.StatusFrom,
        statusTo: h.StatusTo,
        comment: h.Comment,
        actor: h.ActorEmail,
        actorRole: h.ActorRole,
        date: safeFmtDateTime_(h.Timestamp)
      };
    })
  };
}

function svcNotify_(to, subject, html, plain, moduleKey, refId) {
  if (!String(to || '').trim()) return;
  try {
    const targets = getLineTargetsForEmails_(to);
    const message = plain || subject;
    targets.forEach(function (target) {
      sendLineNotify_(message, target, moduleKey, refId);
    });
  }
  catch (e) { console.error('Service Catalog notification: ' + e.message); }
}

function svcNotifyItQueue_(requestId, serviceName) {
  let emails = [];
  try { emails = getITAdminEmails_(); } catch (e) { emails = []; }
  try {
    notify_(emails.join(','), 'คำขอบริการรอดำเนินการ ' + requestId,
      '<p>คำขอบริการ <b>' + escapeHtml(requestId) + '</b>: ' + escapeHtml(serviceName || '') +
      ' พร้อมให้มอบหมายและดำเนินการแล้ว</p>', 'คำขอ ' + requestId + ' รอ IT ดำเนินการ',
      'serviceCatalog', requestId);
  } catch (e) { console.error('Service Catalog IT queue notification: ' + e.message); }
}
