/**
 * Module_Workflow.gs
 *
 * Workflow / Approval Engine กลางสำหรับทุกโมดูล
 * - definition + ordered/parallel/quorum steps
 * - immutable snapshot ต่อ instance
 * - exact actor / action-level permission / SoD checks
 * - delegation, reminder, escalation และ timeline
 * - compatibility adapter สำหรับ Service Request v1.10
 *
 * Public functions คืน response contract กลางเสมอ ส่วน helper ภายในลงท้าย `_`
 * เพื่อไม่ให้ Auth.api() dispatch ได้โดยตรง
 */

const WF_DEFINITION_STATUS_ = ['ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก'];
const WF_INSTANCE_STATUS_ = Object.freeze({
  ACTIVE: 'กำลังดำเนินการ',
  COMPLETED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธ',
  RETURNED: 'ส่งกลับแก้ไข',
  CANCELLED: 'ยกเลิก',
  ERROR: 'ผิดพลาด'
});
const WF_APPROVAL_STATUS_ = Object.freeze({
  PENDING: 'รอพิจารณา',
  APPROVED: 'อนุมัติ',
  REJECTED: 'ปฏิเสธ',
  RETURNED: 'ส่งกลับแก้ไข',
  DELEGATED: 'มอบหมายแทน',
  SUPERSEDED: 'ข้าม',
  CANCELLED: 'ยกเลิก'
});
const WF_DECISIONS_ = ['APPROVE', 'REJECT', 'RETURN'];
const WF_APPROVAL_TYPES_ = ['USER', 'SUPERVISOR', 'REQUESTER_SUPERVISOR', 'ROLE',
  'DEPARTMENT_APPROVER', 'GROUP', 'CONTEXT'];
const WF_STEP_MODES_ = ['ANY', 'ALL', 'QUORUM'];
const WF_TERMINAL_INSTANCE_STATUS_ = [WF_INSTANCE_STATUS_.COMPLETED, WF_INSTANCE_STATUS_.REJECTED,
  WF_INSTANCE_STATUS_.RETURNED, WF_INSTANCE_STATUS_.CANCELLED, WF_INSTANCE_STATUS_.ERROR];
const WF_TRANSITION_REPAIR_CURSOR_KEY_ = 'WORKFLOW_TRANSITION_REPAIR_CURSOR';
const WF_QUEUE_REPAIR_CURSOR_KEY_ = 'WORKFLOW_QUEUE_REPAIR_CURSOR';

// ============================================================================
// Public query APIs
// ============================================================================

function getWorkflowModuleData(filters) {
  try {
    const user = requireModule('workflow', false);
    wfEnsureSheets_();
    filters = filters && typeof filters === 'object' ? filters : {};

    const allInstances = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE)
      .sort(function (a, b) { return wfTime_(b.StartedAt || b.Timestamp) - wfTime_(a.StartedAt || a.Timestamp); });
    const approvals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL);
    const definitions = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DEFINITION, true);
    const delegations = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DELEGATION, true);
    const instanceById = {}, approvalsByInstance = {}, assignedInstanceIds = {};
    allInstances.forEach(function (row) { instanceById[String(row.InstanceID || '')] = row; });
    approvals.forEach(function (row) {
      const instanceId = String(row.InstanceID || '');
      if (!approvalsByInstance[instanceId]) approvalsByInstance[instanceId] = [];
      approvalsByInstance[instanceId].push(row);
      if (String(row.ApproverEmail || '').toLowerCase() === user.email ||
          String(row.OriginalApproverEmail || '').toLowerCase() === user.email) {
        assignedInstanceIds[instanceId] = true;
      }
    });

    const statusFilter = sanitizeText(filters.status, 80);
    const moduleFilter = sanitizeText(filters.moduleKey || filters.module, 80);
    const search = String(sanitizeText(filters.search || filters.query, 200)).toLowerCase();
    const filteredInstances = allInstances.filter(function (instance) {
      if (statusFilter && String(instance.Status || '') !== statusFilter) return false;
      if (moduleFilter && String(instance.ModuleKey || '') !== moduleFilter) return false;
      if (search) {
        const haystack = [instance.InstanceID, instance.RecordID, instance.RecordLabel,
          instance.RequesterEmail, instance.RequesterDepartment].join(' ').toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });
    const canViewAll = wfHasActionPermission_(user, 'workflow.view_all');
    const canViewOwn = wfHasActionPermission_(user, 'workflow.view_own');
    const canViewAssigned = wfHasActionPermission_(user, 'workflow.view_assigned');

    const myApprovals = approvals.filter(function (approval) {
      if (!canViewAssigned) return false;
      if (String(approval.Status || '') !== WF_APPROVAL_STATUS_.PENDING) return false;
      const instance = instanceById[String(approval.InstanceID || '')];
      return instance && wfCanActApproval_(approval, instance, user, false);
    }).sort(function (a, b) { return wfTime_(a.DueAt) - wfTime_(b.DueAt); });

    const visibleAll = filteredInstances.filter(function (instance) {
      if (canViewAll) return true;
      const instanceId = String(instance.InstanceID || '');
      if (canViewOwn && String(instance.RequesterEmail || '').toLowerCase() === user.email) return true;
      if (canViewAssigned && assignedInstanceIds[instanceId]) return true;
      return false;
    });
    const limit = Math.max(1, Math.min(400, parseInt(filters.limit, 10) || 200));
    const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
    const visibleInstances = visibleAll.slice(offset, offset + limit);
    const mineAll = visibleAll.filter(function (instance) {
      return String(instance.RequesterEmail || '').toLowerCase() === user.email;
    });
    const mine = mineAll.slice(0, limit);
    const now = Date.now();
    const overdue = myApprovals.filter(function (approval) {
      const due = wfTime_(approval.DueAt);
      return due && due < now;
    });
    const canManage = wfHasActionPermission_(user, 'workflow.manage');
    const stepsByDefinition = {};
    if (canManage) {
      readSheetObjectsEnsured_(SHEETS.WORKFLOW_STEP, true).forEach(function (step) {
        if (String(step.Status || '') !== 'ใช้งาน') return;
        const definitionId = String(step.DefinitionID || '');
        if (!stepsByDefinition[definitionId]) stepsByDefinition[definitionId] = [];
        stepsByDefinition[definitionId].push(step);
      });
    }

    return ok(wfClientSafe_({
      role: user.role,
      canManage: canManage,
      canRunAutomation: wfHasActionPermission_(user, 'workflow.run_automation'),
      summary: {
        pendingMine: myApprovals.length,
        overdueMine: overdue.length,
        activeMine: mineAll.filter(function (row) { return row.Status === WF_INSTANCE_STATUS_.ACTIVE; }).length,
        activeVisible: visibleAll.filter(function (row) { return row.Status === WF_INSTANCE_STATUS_.ACTIVE; }).length
      },
      paging: { offset: offset, limit: limit, total: visibleAll.length },
      myApprovals: myApprovals.slice(0, 200).map(function (row) {
        return wfApprovalDto_(row, instanceById[String(row.InstanceID || '')], user);
      }),
      myRequests: mine.map(function (row) {
        return wfInstanceDto_(row, approvalsByInstance[String(row.InstanceID || '')] || [], user);
      }),
      instances: visibleInstances.map(function (row) {
        return wfInstanceDto_(row, approvalsByInstance[String(row.InstanceID || '')] || [], user);
      }),
      definitions: definitions.filter(function (row) {
        return canManage || String(row.Status || '') === 'ใช้งาน';
      }).map(function (row) { return wfDefinitionDto_(row, canManage, stepsByDefinition); }),
      delegations: delegations.filter(function (row) {
        return canManage || String(row.DelegatorEmail || '').toLowerCase() === user.email ||
          String(row.DelegateEmail || '').toLowerCase() === user.email;
      }).map(wfDelegationDto_),
      decisionOptions: WF_DECISIONS_.slice(),
      definitionStatuses: WF_DEFINITION_STATUS_.slice(),
      approvalTypes: WF_APPROVAL_TYPES_.slice(),
      stepModes: WF_STEP_MODES_.slice()
    }));
  } catch (e) {
    return fail(e.message, 'WORKFLOW_LOAD_FAILED');
  }
}

function getWorkflowInstanceDetail(instanceId) {
  try {
    const user = requireModule('workflow', false);
    wfEnsureSheets_();
    instanceId = sanitizeText(instanceId, 120);
    const instance = findRowEnsured_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instanceId);
    if (!instance) throw new Error('ไม่พบ Workflow Instance');
    const approvals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
      return String(row.InstanceID || '') === instanceId;
    });
    if (!wfCanViewInstance_(instance, approvals, user)) {
      wfAuditSafe_(user, 'VIEW_DENIED', SHEETS.WORKFLOW_INSTANCE, instanceId,
        'row-level workflow access denied', 'denied');
      throw new Error('ท่านไม่มีสิทธิ์ดู Workflow นี้');
    }
    const history = readSheetObjectsEnsured_(SHEETS.WORKFLOW_HISTORY).filter(function (row) {
      return String(row.InstanceID || '') === instanceId;
    }).sort(function (a, b) { return wfTime_(a.ActionAt || a.Timestamp) - wfTime_(b.ActionAt || b.Timestamp); });
    const definition = findRowEnsured_(SHEETS.WORKFLOW_DEFINITION, 'DefinitionID', instance.DefinitionID);
    return ok(wfClientSafe_({
      instance: wfInstanceDto_(instance, approvals, user, true),
      definition: definition ? wfDefinitionDto_(definition, wfHasActionPermission_(user, 'workflow.manage')) : null,
      approvals: approvals.sort(function (a, b) {
        return Number(a.StepOrder || 0) - Number(b.StepOrder || 0) || wfTime_(a.Timestamp) - wfTime_(b.Timestamp);
      }).map(function (row) { return wfApprovalDto_(row, instance, user, true); }),
      history: history.map(function (row) { return wfHistoryDto_(row, user); }),
      allowedActions: wfInstanceActions_(instance, approvals, user)
    }));
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DETAIL_FAILED');
  }
}

// ============================================================================
// Definition administration
// ============================================================================

function saveWorkflowDefinition(form) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.manage');
    wfEnsureSheets_();
    form = form || {};
    const definitionId = sanitizeText(form.definitionId || form.id, 120);
    const code = String(sanitizeText(form.workflowCode || form.code, 80)).toUpperCase();
    const name = sanitizeText(form.workflowName || form.name, 200);
    const moduleKey = sanitizeText(form.moduleKey, 80);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(code)) {
      throw new Error('WorkflowCode ต้องมี 3-80 ตัว และใช้เฉพาะ A-Z, 0-9, _ หรือ -');
    }
    if (!name) throw new Error('กรุณาระบุชื่อ Workflow');
    if (!MODULE_ACCESS[moduleKey]) throw new Error('ModuleKey ของ Workflow ไม่ถูกต้อง');
    const status = sanitizeText(form.status, 40) || 'ร่าง';
    if (WF_DEFINITION_STATUS_.indexOf(status) === -1) throw new Error('สถานะ Workflow ไม่ถูกต้อง');
    const mode = String(sanitizeText(form.mode, 30) || 'SEQUENTIAL').toUpperCase();
    if (mode !== 'SEQUENTIAL') {
      throw new Error('รุ่นนี้รองรับ Workflow ระดับ Definition แบบ SEQUENTIAL เท่านั้น');
    }
    const steps = wfNormalizeSteps_(form.steps !== undefined ? form.steps : form.stepsJSON);
    if (!steps.length) throw new Error('Workflow ต้องมีอย่างน้อยหนึ่งขั้นตอน');
    if (moduleKey === 'serviceCatalog' && steps.some(function (step) {
      return wfIsYes_(step.AllowReturn);
    })) {
      throw new Error('Service Catalog ยังไม่รองรับ Return/Resubmit กรุณาปิด AllowReturn');
    }
    const conditions = wfNormalizeJsonObject_(form.conditions !== undefined ? form.conditions : form.conditionsJSON,
      'ConditionsJSON', {});
    wfAssertCondition_(conditions, 'ConditionsJSON');
    const isDefault = wfYesNo_(form.isDefault);
    const activeFrom = wfParseOptionalDate_(form.activeFrom, 'ActiveFrom', false);
    const activeTo = wfParseOptionalDate_(form.activeTo, 'ActiveTo', true);
    if (activeFrom && activeTo && activeTo.getTime() < activeFrom.getTime()) {
      throw new Error('ActiveTo ต้องไม่น้อยกว่า ActiveFrom');
    }

    const result = wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.manage');
      const rows = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DEFINITION, true);
      let existing = null;
      if (definitionId) {
        existing = rows.filter(function (row) { return String(row.DefinitionID) === definitionId; })[0] || null;
        if (!existing) throw new Error('ไม่พบ Workflow Definition ที่ต้องการแก้ไข');
      }
      const catalogReferences = existing ? wfActiveCatalogReferencesLocked_(existing.DefinitionID) : [];
      if (catalogReferences.length && String(existing.ModuleKey || '') !== moduleKey) {
        throw new Error('เปลี่ยน ModuleKey ไม่ได้ เพราะมี Service Catalog ที่ใช้งานอ้าง Workflow นี้อยู่');
      }
      if (catalogReferences.length && status !== 'ใช้งาน') {
        throw new Error('ปิดใช้งาน Workflow ไม่ได้ เพราะมี Service Catalog ที่ใช้งานอ้างอยู่');
      }
      const nowMs = Date.now();
      if (catalogReferences.length && ((activeFrom && activeFrom.getTime() > nowMs) ||
          (activeTo && activeTo.getTime() < nowMs))) {
        throw new Error('ช่วงเวลาใช้งานต้องครอบคลุมเวลาปัจจุบันขณะที่ Service Catalog ยังอ้าง Workflow นี้');
      }
      const duplicate = rows.filter(function (row) {
        return String(row.WorkflowCode || '').toUpperCase() === code &&
          (!existing || String(row.DefinitionID) !== String(existing.DefinitionID));
      })[0];
      if (duplicate) throw new Error('WorkflowCode นี้ถูกใช้งานแล้ว');
      const id = existing ? String(existing.DefinitionID) : generateId('WFD');
      const version = existing ? (parseInt(existing.Version, 10) || 1) + 1 : Math.max(1, parseInt(form.version, 10) || 1);
      const payload = {
        DefinitionID: id,
        WorkflowCode: code,
        WorkflowName: name,
        ModuleKey: moduleKey,
        Description: sanitizeText(form.description, 2000),
        Version: version,
        TriggerEvent: String(sanitizeText(form.triggerEvent, 80) || 'MANUAL').toUpperCase(),
        Mode: mode,
        ConditionsJSON: JSON.stringify(conditions),
        SLAHours: wfNumber_(form.slaHours, 1, 2160, 24),
        ReminderHours: wfNumber_(form.reminderHours, 0, 2160, 4),
        EscalationHours: wfNumber_(form.escalationHours, 0, 2160, 8),
        EscalationRole: sanitizeText(form.escalationRole, 80),
        IsDefault: isDefault,
        Status: status,
        ActiveFrom: activeFrom || '',
        ActiveTo: activeTo || '',
        Revision: existing ? (parseInt(existing.Revision, 10) || 0) + 1 : 1,
        Notes: sanitizeText(form.notes, 1500)
      };
      const priorSteps = readSheetObjectsEnsured_(SHEETS.WORKFLOW_STEP, true).filter(function (row) {
        return String(row.DefinitionID || '') === id;
      });
      const priorStatuses = {};
      priorSteps.forEach(function (row) {
        priorStatuses[String(row.StepID || '')] = String(row.Status || '');
      });
      const newStepIds = steps.map(function () { return generateId('WFS'); });
      const batchId = generateId('WFGEN');
      let definitionWritten = false;
      try {
        wfAuditLocked_(lockedUser, 'SAVE_DEFINITION_INTENT', SHEETS.WORKFLOW_DEFINITION,
          id, code + ' v' + version + ' batch=' + batchId, 'pending');
        // Append the entire immutable generation first. Runtime readers only
        // select the generation matching WorkflowDefinitions.Version, so these
        // rows remain invisible until the definition row is committed below.
        steps.forEach(function (step, index) {
          wfAppendRowLocked_(SHEETS.WORKFLOW_STEP, Object.assign({}, step, {
            StepID: newStepIds[index], DefinitionID: id, DefinitionVersion: version,
            Status: 'ใช้งาน',
            Notes: wfAppendNote_(step.Notes, lockedUser.email,
              'definition generation ' + batchId + ' v' + version)
          }), lockedUser.email);
        });
        wfSwitchDefinitionStepGenerationLocked_(id, newStepIds, priorStatuses, true, version);

        if (existing) wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, existing._row, payload, lockedUser.email);
        else wfAppendRowLocked_(SHEETS.WORKFLOW_DEFINITION, payload, lockedUser.email);
        definitionWritten = true;

        if (isDefault === 'Yes') {
          rows.forEach(function (row) {
            if (String(row.ModuleKey) === moduleKey && String(row.IsDefault) === 'Yes' &&
              (!existing || String(row.DefinitionID) !== String(existing.DefinitionID))) {
              wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, row._row,
                { IsDefault: 'No' }, lockedUser.email);
            }
          });
        }
        wfAuditLocked_(lockedUser, existing ? 'UPDATE_DEFINITION' : 'CREATE_DEFINITION',
          SHEETS.WORKFLOW_DEFINITION, id, code + ' v' + version + ' batch=' + batchId, 'success');
        try {
          wfRetirePriorStepGenerationsLocked_(id, version, newStepIds);
        } catch (retireError) {
          console.error('wfRetirePriorStepGenerationsLocked_: ' + retireError.message);
        }
        return { id: id, version: version, created: !existing };
      } catch (saveError) {
        let rollbackError = '';
        try {
          if (definitionWritten) {
            if (existing) {
              const restore = {};
              Object.keys(payload).forEach(function (key) {
                restore[key] = existing[key] === undefined ? '' : existing[key];
              });
              wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, existing._row, restore, lockedUser.email);
            } else {
              const createdDefinition = wfFindRowLocked_(SHEETS.WORKFLOW_DEFINITION,
                'DefinitionID', id, true);
              if (createdDefinition) {
                wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, createdDefinition._row, {
                  Status: 'ยกเลิก', IsDefault: 'No',
                  Notes: wfAppendNote_(createdDefinition.Notes, lockedUser.email,
                    'rolled back failed definition generation ' + batchId)
                }, lockedUser.email);
              }
            }
          }
          // Restore/deactivate the definition commit marker before touching its
          // step rows. Read APIs do not hold ScriptLock, so this ordering never
          // exposes a committed version whose complete generation was cancelled.
          wfSwitchDefinitionStepGenerationLocked_(id, newStepIds, priorStatuses, false, version);
          rows.forEach(function (row) {
            const fresh = wfFindRowLocked_(SHEETS.WORKFLOW_DEFINITION,
              'DefinitionID', row.DefinitionID, true);
            if (fresh && String(fresh.IsDefault || '') !== String(row.IsDefault || '')) {
              wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, fresh._row,
                { IsDefault: row.IsDefault || 'No' }, lockedUser.email);
            }
          });
          wfAuditLocked_(lockedUser, 'ROLLBACK_DEFINITION_SAVE', SHEETS.WORKFLOW_DEFINITION,
            id, 'batch=' + batchId + ' error=' + sanitizeText(saveError.message, 800), 'error');
        } catch (rollbackFailure) {
          rollbackError = '; rollback failed: ' + sanitizeText(rollbackFailure.message, 800);
        }
        throw new Error(String(saveError.message || saveError) + rollbackError);
      }
    });
    return ok(result, result.created ? 'สร้าง Workflow Definition แล้ว' : 'บันทึก Workflow เวอร์ชันใหม่แล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DEFINITION_SAVE_FAILED');
  }
}

function setWorkflowDefinitionStatus(definitionId, status) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.manage');
    definitionId = sanitizeText(definitionId, 120);
    status = sanitizeText(status, 40);
    if (WF_DEFINITION_STATUS_.indexOf(status) === -1) throw new Error('สถานะ Workflow ไม่ถูกต้อง');
    wfEnsureSheets_();
    wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.manage');
      const row = wfFindRowLocked_(SHEETS.WORKFLOW_DEFINITION, 'DefinitionID', definitionId, true);
      if (!row) throw new Error('ไม่พบ Workflow Definition');
      if (status !== 'ใช้งาน' && wfActiveCatalogReferencesLocked_(definitionId).length) {
        throw new Error('ปิดใช้งาน Workflow ไม่ได้ เพราะมี Service Catalog ที่ใช้งานอ้างอยู่');
      }
      if (status === 'ใช้งาน') {
        const activeSteps = wfSelectCommittedDefinitionSteps_(
          readSheetObjectsEnsured_(SHEETS.WORKFLOW_STEP, true), row);
        if (!activeSteps.length) throw new Error('Workflow ไม่มีขั้นตอนที่ใช้งาน');
      }
      wfAuditLocked_(lockedUser, 'UPDATE_DEFINITION_STATUS_INTENT', SHEETS.WORKFLOW_DEFINITION,
        definitionId, status, 'pending');
      wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION, row._row, { Status: status }, lockedUser.email);
      wfAuditLocked_(lockedUser, 'UPDATE_DEFINITION_STATUS', SHEETS.WORKFLOW_DEFINITION,
        definitionId, status, 'success');
    });
    return ok({ id: definitionId, status: status }, 'อัปเดตสถานะ Workflow แล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DEFINITION_STATUS_FAILED');
  }
}

function wfActiveCatalogReferencesLocked_(definitionId) {
  return readSheetObjectsEnsured_(SHEETS.SERVICE_CATALOG, true).filter(function (catalog) {
    return String(catalog.WorkflowDefinitionID || '') === String(definitionId || '') &&
      String(catalog.Status || '') === 'ใช้งาน';
  });
}

/**
 * Commit or roll back one immutable step generation with one status-column
 * write. Callers must already own ScriptLock.
 */
function wfSwitchDefinitionStepGenerationLocked_(definitionId, newStepIds, priorStatuses, commit, expectedVersion) {
  const sh = getDB_().getSheetByName(SHEETS.WORKFLOW_STEP);
  if (!sh || sh.getLastColumn() < 1) throw new Error('WorkflowSteps sheet is missing');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  const idIndex = headers.indexOf('StepID');
  const definitionIndex = headers.indexOf('DefinitionID');
  const versionIndex = headers.indexOf('DefinitionVersion');
  const statusIndex = headers.indexOf('Status');
  if (idIndex < 0 || definitionIndex < 0 || versionIndex < 0 || statusIndex < 0) {
    throw new Error('WorkflowSteps headers are incomplete');
  }
  const count = Math.max(0, sh.getLastRow() - 1);
  if (!count) {
    if (commit) throw new Error('WorkflowSteps has no staged rows to commit');
    return true;
  }
  const values = sh.getRange(2, 1, count, sh.getLastColumn()).getValues();
  const newSet = {};
  (newStepIds || []).forEach(function (id) { newSet[String(id || '')] = true; });
  const found = {};
  const retiredOrphans = {};
  const statuses = values.map(function (row) {
    const stepId = String(row[idIndex] || '');
    const sameDefinition = String(row[definitionIndex] || '') === String(definitionId || '');
    let next = String(row[statusIndex] || '');
    if (newSet[stepId]) {
      found[stepId] = true;
      if (!sameDefinition) {
        throw new Error('Workflow step generation definition mismatch: ' + stepId);
      }
      if (commit && Number(row[versionIndex] || 0) !== Number(expectedVersion || 0)) {
        throw new Error('Workflow step generation version mismatch: ' + stepId);
      }
      next = commit ? 'ใช้งาน' : 'ยกเลิก';
    } else if (commit && sameDefinition &&
        Number(row[versionIndex] || 0) === Number(expectedVersion || 0)) {
      // A previous execution may have stopped after appending only part of this
      // vNext generation. Retire every same-version row that is not a member of
      // the complete generation being committed now.
      next = 'ยกเลิก';
      retiredOrphans[stepId] = true;
    } else if (!commit && Object.prototype.hasOwnProperty.call(priorStatuses || {}, stepId)) {
      next = String(priorStatuses[stepId] || '');
    }
    return [sheetSafeValue_(next)];
  });
  if (commit) {
    const missing = Object.keys(newSet).filter(function (id) { return !found[id]; });
    if (missing.length) throw new Error('Workflow step generation is incomplete: ' + missing.join(','));
  }
  sh.getRange(2, statusIndex + 1, count, 1).setValues(statuses);
  const verified = sh.getRange(2, 1, count, sh.getLastColumn()).getValues();
  verified.forEach(function (row) {
    const stepId = String(row[idIndex] || '');
    const status = String(row[statusIndex] || '');
    if (newSet[stepId] && status !== (commit ? 'ใช้งาน' : 'ยกเลิก')) {
      throw new Error('Workflow step generation status could not be verified: ' + stepId);
    }
    if (commit && retiredOrphans[stepId] && status !== 'ยกเลิก') {
      throw new Error('Workflow orphan step generation could not be retired: ' + stepId);
    }
    if (!commit && Object.prototype.hasOwnProperty.call(priorStatuses || {}, stepId) &&
        status !== String(priorStatuses[stepId] || '')) {
      throw new Error('Workflow prior step status could not be restored: ' + stepId);
    }
  });
  return true;
}

function wfRetirePriorStepGenerationsLocked_(definitionId, committedVersion, committedStepIds) {
  const sh = getDB_().getSheetByName(SHEETS.WORKFLOW_STEP);
  if (!sh || sh.getLastColumn() < 1 || sh.getLastRow() < 2) return true;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  const idIndex = headers.indexOf('StepID');
  const definitionIndex = headers.indexOf('DefinitionID');
  const versionIndex = headers.indexOf('DefinitionVersion');
  const statusIndex = headers.indexOf('Status');
  if (idIndex < 0 || definitionIndex < 0 || versionIndex < 0 || statusIndex < 0) {
    throw new Error('WorkflowSteps headers are incomplete');
  }
  const count = sh.getLastRow() - 1;
  const values = sh.getRange(2, 1, count, sh.getLastColumn()).getValues();
  const committed = {};
  (committedStepIds || []).forEach(function (id) { committed[String(id || '')] = true; });
  const statuses = values.map(function (row) {
    const sameDefinition = String(row[definitionIndex] || '') === String(definitionId || '');
    const stepId = String(row[idIndex] || '');
    let status = String(row[statusIndex] || '');
    if (sameDefinition && !committed[stepId]) {
      status = 'ยกเลิก';
    }
    return [sheetSafeValue_(status)];
  });
  sh.getRange(2, statusIndex + 1, count, 1).setValues(statuses);
  return true;
}

// ============================================================================
// Approval actions and delegation
// ============================================================================

function decideWorkflowApproval(approvalId, decision, comment, attachmentIds) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.approve');
    approvalId = sanitizeText(approvalId, 120);
    decision = String(sanitizeText(decision, 30)).toUpperCase();
    comment = sanitizeText(comment, 2000);
    if (WF_DECISIONS_.indexOf(decision) === -1) throw new Error('คำสั่งพิจารณาไม่ถูกต้อง');
    if ((decision === 'REJECT' || decision === 'RETURN') && !comment) {
      throw new Error('กรุณาระบุเหตุผลประกอบการปฏิเสธ/ส่งกลับ');
    }
    wfEnsureSheets_();
    const normalizedAttachmentIds = wfNormalizeIdList_(attachmentIds, 20);

    const outcome = wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.approve');
      const approval = wfFindRowLocked_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', approvalId, true);
      if (!approval) throw new Error('ไม่พบรายการอนุมัติ');
      const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', approval.InstanceID, true);
      if (!instance) throw new Error('ไม่พบ Workflow Instance');
      const approvalStatus = decision === 'APPROVE' ? WF_APPROVAL_STATUS_.APPROVED :
        (decision === 'REJECT' ? WF_APPROVAL_STATUS_.REJECTED : WF_APPROVAL_STATUS_.RETURNED);
      const resuming = String(approval.Status) === approvalStatus &&
        String(approval.Decision || '').toUpperCase() === decision &&
        String(approval.DecisionBy || '').toLowerCase() === lockedUser.email;
      if (!resuming && String(instance.Status) !== WF_INSTANCE_STATUS_.ACTIVE) {
        throw new Error('Workflow นี้สิ้นสุดแล้ว');
      }
      if (!resuming && String(approval.Status) !== WF_APPROVAL_STATUS_.PENDING) {
        throw new Error('รายการนี้ถูกพิจารณาแล้ว');
      }
      if (!resuming && !wfCanActApproval_(approval, instance, lockedUser, true)) {
        wfAuditLocked_(lockedUser, 'DECISION_DENIED', SHEETS.WORKFLOW_APPROVAL, approvalId,
          'not assigned actor or SoD violation', 'denied');
        throw new Error('ท่านไม่ใช่ผู้พิจารณาที่ได้รับมอบหมาย');
      }
      if (resuming && String(instance.RequesterEmail || '').toLowerCase() === lockedUser.email) {
        throw new Error('Separation of Duties: ผู้ร้องขอเป็นผู้อนุมัติไม่ได้');
      }
      const step = wfSnapshotStep_(instance, approval.StepID, approval.StepOrder);
      if (decision === 'RETURN' && !wfIsYes_(step.AllowReturn)) {
        throw new Error('ขั้นตอนนี้ไม่อนุญาตให้ส่งกลับแก้ไข');
      }
      if (decision === 'RETURN' && String(instance.ModuleKey) === 'serviceCatalog') {
        throw new Error('Service Catalog ยังไม่รองรับการแก้ไขและยื่นซ้ำ กรุณาอนุมัติหรือปฏิเสธคำขอ');
      }
      const decisionComment = resuming ? String(approval.Comment || comment || '') : comment;
      if (!resuming) {
        wfPreflightDecisionTransitionLocked_(instance, approval, decision);
        if (normalizedAttachmentIds.length && typeof arAssertAttachmentsLinkedToRecordLocked_ === 'function') {
          arAssertAttachmentsLinkedToRecordLocked_(normalizedAttachmentIds, 'workflow', instance.InstanceID, lockedUser);
        }
        const fromApproval = String(approval.Status);
        const signatureHash = wfDecisionSignature_(approval, instance, lockedUser, decision, decisionComment);
        wfAuditLocked_(lockedUser, 'DECISION_INTENT', SHEETS.WORKFLOW_APPROVAL, approvalId,
          decision + ' ' + instance.ModuleKey + '/' + instance.RecordID, 'pending');
        wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, approval._row, {
          Status: approvalStatus,
          Decision: decision,
          Comment: decisionComment,
          DecidedAt: new Date(),
          DecisionBy: lockedUser.email,
          SignatureHash: signatureHash,
          AttachmentIDsJSON: JSON.stringify(normalizedAttachmentIds),
          Revision: (parseInt(approval.Revision, 10) || 0) + 1
        }, lockedUser.email);
        wfWriteHistoryLocked_(instance, approval, decision, fromApproval, approvalStatus,
          lockedUser, decisionComment, { signatureHash: signatureHash, attachments: normalizedAttachmentIds }, false);
      }
      if (resuming) {
        wfWriteHistoryLocked_(instance, approval, decision, WF_APPROVAL_STATUS_.PENDING,
          approvalStatus, lockedUser, decisionComment, {
            signatureHash: approval.SignatureHash || '',
            attachments: wfNormalizeIdList_(approval.AttachmentIDsJSON, 20),
            resumed: true
          }, false);
      }
      const transition = wfResumeDecisionTransitionLocked_(instance, approval, decision,
        lockedUser, decisionComment);
      wfAuditLocked_(lockedUser, decision, SHEETS.WORKFLOW_APPROVAL, approvalId,
        instance.ModuleKey + '/' + instance.RecordID + (resuming ? ' resume' : ''), 'success');
      return Object.assign({
        approvalId: approvalId,
        instanceId: instance.InstanceID,
        moduleKey: instance.ModuleKey,
        recordId: instance.RecordID,
        decision: decision,
        duplicate: resuming
      }, transition || {});
    });

    wfAfterTransition_(outcome, user);
    return ok(outcome, decision === 'APPROVE' ? 'อนุมัติแล้ว' :
      (decision === 'REJECT' ? 'ปฏิเสธแล้ว' : 'ส่งกลับแก้ไขแล้ว'));
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DECISION_FAILED');
  }
}

function decideWorkflowApprovalByRecord_(moduleKey, recordId, decision, comment) {
  try {
    const user = getCurrentUser();
    moduleKey = sanitizeText(moduleKey, 80);
    recordId = sanitizeText(recordId, 120);
    decision = String(sanitizeText(decision, 30)).toUpperCase();
    const expectedInstanceStatus = decision === 'APPROVE' ? WF_INSTANCE_STATUS_.COMPLETED :
      (decision === 'REJECT' ? WF_INSTANCE_STATUS_.REJECTED : WF_INSTANCE_STATUS_.RETURNED);
    const expectedApprovalStatus = decision === 'APPROVE' ? WF_APPROVAL_STATUS_.APPROVED :
      (decision === 'REJECT' ? WF_APPROVAL_STATUS_.REJECTED : WF_APPROVAL_STATUS_.RETURNED);
    const instance = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE).filter(function (row) {
      return String(row.ModuleKey) === moduleKey && String(row.RecordID) === recordId &&
        (String(row.Status) === WF_INSTANCE_STATUS_.ACTIVE ||
         String(row.Status) === expectedInstanceStatus);
    }).sort(function (a, b) { return wfTime_(b.StartedAt) - wfTime_(a.StartedAt); })[0];
    if (!instance) throw new Error('ไม่พบ Workflow ที่กำลังดำเนินการสำหรับรายการนี้');
    const approval = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
      if (String(row.InstanceID) !== String(instance.InstanceID)) return false;
      if (String(row.Status) === WF_APPROVAL_STATUS_.PENDING) {
        return wfCanActApproval_(row, instance, user, false);
      }
      return String(row.Status) === expectedApprovalStatus &&
        String(row.Decision || '').toUpperCase() === decision &&
        String(row.DecisionBy || '').toLowerCase() === user.email;
    })[0];
    if (!approval) throw new Error('ไม่พบงานอนุมัติที่มอบหมายให้ท่าน');
    return decideWorkflowApproval(approval.ApprovalID, decision, comment, []);
  } catch (e) {
    return fail(e.message, 'WORKFLOW_RECORD_DECISION_FAILED');
  }
}

function delegateWorkflowApproval(approvalId, delegateEmail, reason) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.delegate');
    approvalId = sanitizeText(approvalId, 120);
    delegateEmail = String(sanitizeText(delegateEmail, 200)).toLowerCase();
    reason = sanitizeText(reason, 1000);
    if (!isValidEmail(delegateEmail)) throw new Error('อีเมลผู้รับมอบหมายไม่ถูกต้อง');
    if (!reason) throw new Error('กรุณาระบุเหตุผลการมอบหมายแทน');
    if (delegateEmail === user.email) throw new Error('ไม่สามารถมอบหมายให้ตนเอง');
    wfAssertActiveUserEmail_(delegateEmail, 'ผู้รับมอบหมาย');
    wfEnsureSheets_();

    const result = wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.delegate');
      const approval = wfFindRowLocked_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', approvalId, true);
      if (!approval) throw new Error('ไม่พบรายการอนุมัติ');
      const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', approval.InstanceID, true);
      if (!instance || String(instance.Status) !== WF_INSTANCE_STATUS_.ACTIVE) throw new Error('Workflow นี้สิ้นสุดแล้ว');
      if (String(approval.Status) !== WF_APPROVAL_STATUS_.PENDING) throw new Error('รายการนี้ถูกพิจารณาแล้ว');
      if (String(approval.ApproverEmail || '').toLowerCase() !== lockedUser.email) {
        throw new Error('เฉพาะผู้รับมอบหมายปัจจุบันเท่านั้นที่มอบหมายต่อได้');
      }
      const step = wfSnapshotStep_(instance, approval.StepID, approval.StepOrder);
      if (!wfIsYes_(step.AllowDelegation)) throw new Error('ขั้นตอนนี้ไม่อนุญาตให้มอบหมายแทน');
      if (delegateEmail === String(instance.RequesterEmail || '').toLowerCase()) {
        throw new Error('ห้ามมอบหมายให้ผู้ร้องขอรายการเดียวกัน');
      }
      const delegateUser = wfActiveUser_(delegateEmail);
      if (!delegateUser || !wfHasActionPermission_({
        email: delegateEmail,
        role: delegateUser.Role,
        name: delegateUser.FullName || delegateEmail,
        department: delegateUser.Department || ''
      }, 'workflow.approve')) {
        throw new Error('ผู้รับมอบหมายไม่มี action permission workflow.approve');
      }
      const delegateCollision = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true).filter(function (row) {
        if (String(row.InstanceID) !== String(approval.InstanceID) ||
            String(row.StepID) !== String(approval.StepID) ||
            String(row.ApprovalID) === String(approval.ApprovalID)) return false;
        if ([WF_APPROVAL_STATUS_.CANCELLED, WF_APPROVAL_STATUS_.SUPERSEDED]
            .indexOf(String(row.Status || '')) > -1) return false;
        return String(row.ApproverEmail || '').toLowerCase() === delegateEmail;
      })[0];
      if (delegateCollision) {
        throw new Error('ผู้รับมอบหมายถือสิทธิ์โหวตอื่นในขั้นตอนนี้อยู่แล้ว');
      }
      if (wfDelegationWouldCycle_(approval, delegateEmail)) throw new Error('การมอบหมายนี้ทำให้เกิด delegation cycle');
      wfAuditLocked_(lockedUser, 'DELEGATE_INTENT', SHEETS.WORKFLOW_APPROVAL, approvalId,
        delegateEmail + ' / ' + reason, 'pending');
      wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, approval._row, {
        OriginalApproverEmail: approval.OriginalApproverEmail || approval.ApproverEmail,
        ApproverEmail: delegateEmail,
        Status: WF_APPROVAL_STATUS_.PENDING,
        DelegatedAt: new Date(),
        Notes: wfAppendNote_(approval.Notes, lockedUser.email, 'delegate to ' + delegateEmail + ': ' + reason),
        Revision: (parseInt(approval.Revision, 10) || 0) + 1
      }, lockedUser.email);
      wfWriteHistoryLocked_(instance, approval, 'DELEGATE', WF_APPROVAL_STATUS_.PENDING,
        WF_APPROVAL_STATUS_.PENDING, lockedUser, reason, { from: lockedUser.email, to: delegateEmail }, false);
      wfUpdateSourceApproversLocked_(instance);
      wfAuditLocked_(lockedUser, 'DELEGATE', SHEETS.WORKFLOW_APPROVAL, approvalId,
        delegateEmail + ' / ' + reason, 'success');
      return { approvalId: approvalId, instanceId: instance.InstanceID, delegateEmail: delegateEmail,
        moduleKey: instance.ModuleKey, recordId: instance.RecordID };
    });
    wfNotifyPrivate_(delegateEmail, 'มีงานอนุมัติที่ได้รับมอบหมาย',
      'Workflow ' + result.instanceId + ' รอการพิจารณา', 'workflow', result.instanceId);
    return ok(result, 'มอบหมายงานอนุมัติแล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DELEGATE_FAILED');
  }
}

function createWorkflowDelegation(form) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.delegate');
    form = form || {};
    wfEnsureSheets_();
    const isAdmin = wfHasActionPermission_(user, 'workflow.manage');
    const delegator = String(sanitizeText(form.delegatorEmail, 200) || user.email).toLowerCase();
    if (delegator !== user.email && !isAdmin) throw new Error('ท่านตั้ง delegation ให้ผู้อื่นไม่ได้');
    const delegate = String(sanitizeText(form.delegateEmail, 200)).toLowerCase();
    if (!isValidEmail(delegate)) throw new Error('อีเมลผู้รับมอบหมายไม่ถูกต้อง');
    if (delegate === delegator) throw new Error('ผู้มอบหมายและผู้รับมอบหมายต้องเป็นคนละคน');
    wfAssertActiveUserEmail_(delegator, 'ผู้มอบหมาย');
    wfAssertActiveUserEmail_(delegate, 'ผู้รับมอบหมาย');
    [delegator, delegate].forEach(function (email) {
      const row = wfActiveUser_(email);
      if (!row || !wfHasActionPermission_({
        email: email, role: row.Role, name: row.FullName || email,
        department: row.Department || ''
      }, 'workflow.approve')) {
        throw new Error((email === delegator ? 'ผู้มอบหมาย' : 'ผู้รับมอบหมาย') +
          ' ต้องมี action permission workflow.approve');
      }
    });
    const startAt = wfParseRequiredDateTime_(form.startAt, 'StartAt');
    const endAt = wfParseRequiredDateTime_(form.endAt, 'EndAt');
    if (endAt.getTime() <= startAt.getTime()) throw new Error('EndAt ต้องมากกว่า StartAt');
    if (endAt.getTime() - startAt.getTime() > 366 * 86400000) throw new Error('ช่วง delegation ต้องไม่เกิน 366 วัน');
    const moduleKey = sanitizeText(form.moduleKey, 80) || '*';
    if (moduleKey !== '*' && !MODULE_ACCESS[moduleKey]) throw new Error('ModuleKey ไม่ถูกต้อง');
    const definitionId = sanitizeText(form.definitionId, 120);
    if (definitionId && !findRowEnsured_(SHEETS.WORKFLOW_DEFINITION, 'DefinitionID', definitionId)) {
      throw new Error('ไม่พบ Workflow Definition ที่กำหนด');
    }
    const reason = sanitizeText(form.reason, 1000);
    if (!reason) throw new Error('กรุณาระบุเหตุผล delegation');

    const result = wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.delegate');
      if (delegator !== lockedUser.email) {
        wfRequireActionPermission_(lockedUser, 'workflow.manage');
      }
      [delegator, delegate].forEach(function (email) {
        const freshTarget = wfActiveUser_(email);
        if (!freshTarget || !wfHasActionPermission_({
          email: email, role: freshTarget.Role, name: freshTarget.FullName || email,
          department: freshTarget.Department || ''
        }, 'workflow.approve')) {
          throw new Error((email === delegator ? 'ผู้มอบหมาย' : 'ผู้รับมอบหมาย') +
            ' ไม่อยู่ในสถานะ Active หรือไม่มี workflow.approve');
        }
      });
      if (definitionId && !wfFindRowLocked_(SHEETS.WORKFLOW_DEFINITION,
          'DefinitionID', definitionId, true)) {
        throw new Error('ไม่พบ Workflow Definition ที่กำหนด');
      }
      const overlap = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DELEGATION, true).some(function (row) {
        if (String(row.Status || '') !== 'Active') return false;
        if (String(row.DelegatorEmail || '').toLowerCase() !== delegator) return false;
        if (String(row.ModuleKey || '*') !== moduleKey || String(row.DefinitionID || '') !== definitionId) return false;
        return wfRangesOverlap_(startAt, endAt, new Date(row.StartAt), new Date(row.EndAt));
      });
      if (overlap) throw new Error('มี delegation ที่ช่วงเวลาทับซ้อนใน scope เดียวกัน');
      const id = generateId('WFDLG');
      wfAuditLocked_(lockedUser, 'CREATE_DELEGATION_INTENT', SHEETS.WORKFLOW_DELEGATION, id,
        delegator + ' -> ' + delegate, 'pending');
      wfAppendRowLocked_(SHEETS.WORKFLOW_DELEGATION, {
        DelegationID: id,
        DelegatorEmail: delegator,
        DelegateEmail: delegate,
        ModuleKey: moduleKey,
        DefinitionID: definitionId,
        StartAt: startAt,
        EndAt: endAt,
        Reason: reason,
        Status: 'Active'
      }, lockedUser.email);
      wfAuditLocked_(lockedUser, 'CREATE_DELEGATION', SHEETS.WORKFLOW_DELEGATION, id,
        delegator + ' -> ' + delegate, 'success');
      return { id: id, delegatorEmail: delegator, delegateEmail: delegate };
    });
    return ok(result, 'สร้างช่วงมอบหมายแทนแล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DELEGATION_CREATE_FAILED');
  }
}

function revokeWorkflowDelegation(delegationId, reason) {
  try {
    const user = requireModule('workflow', true);
    delegationId = sanitizeText(delegationId, 120);
    reason = sanitizeText(reason, 1000);
    wfEnsureSheets_();
    wfWithScriptLock_(function () {
      const lockedUser = wfReauthorizeMutationActorLocked_(user, 'workflow.delegate');
      const row = wfFindRowLocked_(SHEETS.WORKFLOW_DELEGATION, 'DelegationID', delegationId, true);
      if (!row) throw new Error('ไม่พบ delegation');
      const isOwner = String(row.DelegatorEmail || '').toLowerCase() === lockedUser.email;
      if (!isOwner) wfRequireActionPermission_(lockedUser, 'workflow.manage');
      if (String(row.Status || '') !== 'Active') throw new Error('delegation นี้ไม่อยู่ในสถานะใช้งาน');
      wfAuditLocked_(lockedUser, 'REVOKE_DELEGATION_INTENT', SHEETS.WORKFLOW_DELEGATION,
        delegationId, reason, 'pending');
      wfUpdateRowLocked_(SHEETS.WORKFLOW_DELEGATION, row._row, {
        Status: 'Revoked', RevokedAt: new Date(), RevokedBy: lockedUser.email,
        Reason: wfAppendNote_(row.Reason, lockedUser.email, reason || 'revoked')
      }, lockedUser.email);
      wfAuditLocked_(lockedUser, 'REVOKE_DELEGATION', SHEETS.WORKFLOW_DELEGATION,
        delegationId, reason, 'success');
    });
    return ok({ id: delegationId }, 'ยกเลิก delegation แล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_DELEGATION_REVOKE_FAILED');
  }
}

function cancelWorkflowInstance(instanceId, reason) {
  try {
    const user = requireModule('workflow', true);
    instanceId = sanitizeText(instanceId, 120);
    reason = sanitizeText(reason, 1000);
    if (!reason) throw new Error('กรุณาระบุเหตุผลการยกเลิก');
    wfEnsureSheets_();
    const outcome = wfWithScriptLock_(function () {
      const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instanceId, true);
      if (!instance) throw new Error('ไม่พบ Workflow Instance');
      if (String(instance.Status) !== WF_INSTANCE_STATUS_.ACTIVE) throw new Error('Workflow นี้สิ้นสุดแล้ว');
      const own = String(instance.RequesterEmail || '').toLowerCase() === user.email;
      const lockedUser = wfReauthorizeMutationActorLocked_(user,
        own ? 'workflow.cancel_own' : 'workflow.manage');
      wfAuditLocked_(lockedUser, 'CANCEL_INTENT', SHEETS.WORKFLOW_INSTANCE,
        instanceId, reason, 'pending');
      const result = Object.assign({ instanceId: instanceId, moduleKey: instance.ModuleKey, recordId: instance.RecordID },
        wfFinishInstanceLocked_(instance, WF_INSTANCE_STATUS_.CANCELLED, lockedUser, reason, ''));
      wfAuditLocked_(lockedUser, 'CANCEL', SHEETS.WORKFLOW_INSTANCE,
        instanceId, reason, 'success');
      return result;
    });
    wfAfterTransition_(outcome, user);
    return ok(outcome, 'ยกเลิก Workflow แล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_CANCEL_FAILED');
  }
}

/**
 * Transactional bridge for Service Catalog cancellation. The caller already
 * owns ScriptLock. Only ACTIVE instances are cancelled; a completed approval
 * remains immutable evidence even when fulfilment is later cancelled.
 */
function wfCancelServiceRequestWorkflowLocked_(requestOrId, actor, reason) {
  const requestId = sanitizeText(requestOrId && requestOrId.RequestID || requestOrId, 120);
  if (!requestId) throw new Error('RequestID สำหรับยกเลิก Workflow ไม่ถูกต้อง');
  const actorObj = wfActor_(actor, 'system');
  wfAssertAuditReadyLocked_();
  const request = requestOrId && requestOrId.RequestID ? requestOrId :
    wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId, true);
  if (!request) throw new Error('ไม่พบคำขอบริการ ' + requestId);

  const candidates = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE, true).filter(function (instance) {
    return String(instance.ModuleKey || '') === 'serviceCatalog' &&
      String(instance.RecordID || '') === requestId &&
      [WF_INSTANCE_STATUS_.ACTIVE, WF_INSTANCE_STATUS_.CANCELLED]
        .indexOf(String(instance.Status || '')) > -1;
  }).sort(function (a, b) {
    const preferredA = String(a.InstanceID || '') === String(request.WorkflowInstanceID || '') ? 1 : 0;
    const preferredB = String(b.InstanceID || '') === String(request.WorkflowInstanceID || '') ? 1 : 0;
    return preferredB - preferredA || wfTime_(b.StartedAt || b.Timestamp) - wfTime_(a.StartedAt || a.Timestamp);
  });
  let cancelled = 0;
  let reconciled = 0;
  candidates.forEach(function (instance) {
    const isActive = String(instance.Status || '') === WF_INSTANCE_STATUS_.ACTIVE;
    wfAuditLocked_(actorObj, isActive ? 'CANCEL_INTENT' : 'CANCEL_RECONCILE_INTENT',
      SHEETS.WORKFLOW_INSTANCE, instance.InstanceID,
      'serviceCatalog/' + requestId + ': ' + sanitizeText(reason, 800), 'pending');
    // Service Catalog owns the source transaction. Do not make the source
    // terminal until the Integration outbox has also been cancelled.
    wfFinishInstanceLocked_(instance, WF_INSTANCE_STATUS_.CANCELLED, actorObj,
      sanitizeText(reason, 1000), '', { skipSourceOutcome: true });
    wfAuditLocked_(actorObj, isActive ? 'CANCEL' : 'CANCEL_RECONCILED',
      SHEETS.WORKFLOW_INSTANCE, instance.InstanceID,
      'serviceCatalog/' + requestId, 'success');
    if (isActive) cancelled++;
    else reconciled++;
  });
  return { cancelled: cancelled, reconciled: reconciled };
}

// ============================================================================
// Automation and migration APIs
// ============================================================================

function runWorkflowAutomationNow(limit) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.run_automation');
    if (typeof processIntegrationOutbox_ === 'function') {
      wfRequireActionPermission_(user, 'integration.execute');
    }
    const executionActor = Object.assign({}, user, { _requiredRole: ROLES.IT_ADMIN });
    const result = processWorkflowAutomation_(limit, executionActor);
    if (typeof processIntegrationOutbox_ === 'function') {
      result.integration = processIntegrationOutbox_(Math.min(20, parseInt(limit, 10) || 20), executionActor);
    }
    return ok(result, 'ประมวลผล reminder, escalation และ integration แล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_AUTOMATION_FAILED');
  }
}

/** Hourly time-driven trigger installed by setupSystem(). */
function scheduledWorkflowAutomation_() {
  const actor = { email: 'system', name: 'Workflow Automation', role: ROLES.IT_ADMIN, dept: 'System' };
  const workflow = processWorkflowAutomation_(100, actor);
  const integration = typeof processIntegrationOutbox_ === 'function' ? processIntegrationOutbox_(30, actor) : null;
  writeAudit_(actor, 'SCHEDULED_AUTOMATION', 'workflow', SHEETS.WORKFLOW_INSTANCE, '',
    'workflow=' + JSON.stringify(workflow) + ', integration=' + JSON.stringify(integration),
    workflow.errors && workflow.errors.length ? 'partial' : 'success');
  return { workflow: workflow, integration: integration };
}

function backfillWorkflowTransactions(limit) {
  try {
    const user = requireModule('workflow', true);
    wfRequireActionPermission_(user, 'workflow.manage');
    wfEnsureSheets_();
    limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
    const rows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).filter(function (row) {
      return String(row.Status || '') === 'รออนุมัติ' && !String(row.WorkflowInstanceID || '').trim();
    }).slice(0, limit);
    const result = { selected: rows.length, created: 0, existing: 0, errors: [] };
    rows.forEach(function (row) {
      try {
        const outcome = workflowEnsureServiceRequest_(row.RequestID, user);
        if (outcome && outcome.duplicate) result.existing++;
        else if (outcome && outcome.instanceId) result.created++;
      } catch (e) {
        result.errors.push({ requestId: row.RequestID, error: sanitizeText(e.message, 500) });
      }
    });
    writeAudit_(user, 'BACKFILL_WORKFLOW', 'workflow', SHEETS.WORKFLOW_INSTANCE, '',
      'selected=' + result.selected + ', created=' + result.created + ', errors=' + result.errors.length,
      result.errors.length ? 'partial' : 'success');
    return ok(result, 'Backfill Workflow สำหรับคำขอที่ยังเปิดแล้ว');
  } catch (e) {
    return fail(e.message, 'WORKFLOW_BACKFILL_FAILED');
  }
}

/** Trigger-safe internal processor. */
function processWorkflowAutomation_(limit, actor) {
  wfEnsureSheets_();
  limit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  const now = new Date();
  const actorObj = wfActor_(actor, 'system');
  const transitionRepair = wfReconcileDurableTransitions_(Math.min(limit, 50), actorObj);
  const queueRepair = wfReconcileServiceRequestIntegrationQueues_(Math.min(limit, 50), actorObj);
  const approvals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
    return String(row.Status || '') === WF_APPROVAL_STATUS_.PENDING;
  }).sort(function (a, b) { return wfTime_(a.DueAt) - wfTime_(b.DueAt); }).slice(0, limit);
  const result = { selected: approvals.length, reminded: 0, escalated: 0, skipped: 0,
    transitionRepair: transitionRepair, queueRepair: queueRepair, errors: [] };
  const notifications = [];

  approvals.forEach(function (candidate) {
    try {
      const item = wfWithScriptLock_(function () {
        const executionActor = wfReauthorizeMutationActorLocked_(actorObj,
          'workflow.run_automation');
        const approval = wfFindRowLocked_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', candidate.ApprovalID, true);
        if (!approval || String(approval.Status) !== WF_APPROVAL_STATUS_.PENDING) return { skipped: true };
        const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', approval.InstanceID, true);
        if (!instance || String(instance.Status) !== WF_INSTANCE_STATUS_.ACTIVE) return { skipped: true };
        const step = wfSnapshotStep_(instance, approval.StepID, approval.StepOrder);
        const dueMs = wfTime_(approval.DueAt);
        const reminderHours = wfNumber_(step.ReminderHours, 0, 2160, 4);
        const escalationHours = wfNumber_(step.EscalationHours, 0, 2160, 8);
        const reminderAt = dueMs ? dueMs - reminderHours * 3600000 : 0;
        const escalationAt = dueMs ? dueMs + escalationHours * 3600000 : 0;
        if (!approval.RemindedAt && reminderAt && now.getTime() >= reminderAt) {
          wfAuditLocked_(executionActor, 'REMINDER_INTENT', SHEETS.WORKFLOW_APPROVAL,
            approval.ApprovalID, instance.InstanceID, 'pending');
          wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, approval._row, { RemindedAt: now }, executionActor.email);
          wfWriteHistoryLocked_(instance, approval, 'REMINDER', approval.Status, approval.Status,
            executionActor, 'แจ้งเตือนงานอนุมัติใกล้/เกินกำหนด', {}, false);
          wfAuditLocked_(executionActor, 'REMINDER', SHEETS.WORKFLOW_APPROVAL,
            approval.ApprovalID, instance.InstanceID, 'success');
          return { reminded: true, to: approval.ApproverEmail, instanceId: instance.InstanceID };
        }
        if (!approval.EscalatedAt && escalationAt && now.getTime() >= escalationAt) {
          const escalatedTo = wfResolveEscalationActor_(step, instance, approval);
          if (!escalatedTo) {
            throw new Error('ไม่พบผู้รับ escalation ที่ Active และมี workflow.approve');
          }
          const patch = { EscalatedAt: now };
          if (escalatedTo && escalatedTo !== String(instance.RequesterEmail || '').toLowerCase()) {
            patch.OriginalApproverEmail = approval.OriginalApproverEmail || approval.ApproverEmail;
            patch.ApproverEmail = escalatedTo;
          }
          wfAuditLocked_(executionActor, 'ESCALATE_INTENT', SHEETS.WORKFLOW_APPROVAL,
            approval.ApprovalID, escalatedTo || 'IT Admin queue', 'pending');
          wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, approval._row, patch, executionActor.email);
          wfWriteHistoryLocked_(instance, approval, 'ESCALATE', approval.Status, approval.Status,
            executionActor, escalatedTo ? ('Escalate to ' + escalatedTo) : 'Escalate to IT Admin queue',
            { from: approval.ApproverEmail, to: escalatedTo || '' }, false);
          wfUpdateSourceApproversLocked_(instance);
          wfAuditLocked_(executionActor, 'ESCALATE', SHEETS.WORKFLOW_APPROVAL,
            approval.ApprovalID, escalatedTo || 'IT Admin queue', 'success');
          return {
            escalated: true,
            to: escalatedTo,
            instanceId: instance.InstanceID
          };
        }
        return { skipped: true };
      });
      if (item.reminded) result.reminded++;
      else if (item.escalated) result.escalated++;
      else result.skipped++;
      if ((item.reminded || item.escalated) && item.to) notifications.push(item);
    } catch (e) {
      result.errors.push({ approvalId: candidate.ApprovalID, error: sanitizeText(e.message, 500) });
    }
  });
  notifications.forEach(function (item) {
    wfNotifyPrivate_(item.to, item.escalated ? 'Workflow เกินกำหนดและถูก Escalate' : 'เตือนงานอนุมัติ',
      'Workflow ' + item.instanceId + ' รอการพิจารณา', 'workflow', item.instanceId);
  });
  return result;
}

function wfReconcileDurableTransitions_(limit, actor) {
  const allApprovals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true);
  const instances = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE, true);
  const histories = readSheetObjectsEnsured_(SHEETS.WORKFLOW_HISTORY, true);
  const requests = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST, true);
  const instanceById = {}, requestById = {};
  instances.forEach(function (row) { instanceById[String(row.InstanceID || '')] = row; });
  requests.forEach(function (row) { requestById[String(row.RequestID || '')] = row; });
  const eligible = allApprovals.filter(function (row) {
    const decision = String(row.Decision || '').toUpperCase();
    if (['APPROVE', 'REJECT', 'RETURN'].indexOf(decision) === -1 ||
      !String(row.DecisionBy || '').trim()) return false;
    const instance = instanceById[String(row.InstanceID || '')];
    if (!instance) return false;
    const expected = decision === 'APPROVE' ? WF_INSTANCE_STATUS_.COMPLETED :
      (decision === 'REJECT' ? WF_INSTANCE_STATUS_.REJECTED : WF_INSTANCE_STATUS_.RETURNED);
    if (String(instance.Status) === WF_INSTANCE_STATUS_.ACTIVE) {
      if (decision !== 'APPROVE') return true;
      if (Number(instance.CurrentStepOrder || 0) > Number(row.StepOrder || 0)) {
        return !histories.some(function (history) {
          return String(history.InstanceID || '') === String(instance.InstanceID) &&
            String(history.ApprovalID || '') === String(row.ApprovalID) &&
            String(history.Action || '') === 'ADVANCE';
        });
      }
      const peers = allApprovals.filter(function (item) {
        return String(item.InstanceID || '') === String(instance.InstanceID) &&
          Number(item.StepOrder || 0) === Number(row.StepOrder || 0);
      });
      const step = wfSnapshotStep_(instance, row.StepID, row.StepOrder);
      const approved = peers.filter(function (item) {
        return String(item.Status || '') === WF_APPROVAL_STATUS_.APPROVED;
      }).length;
      const mode = String(step.Mode || 'ANY').toUpperCase();
      const required = mode === 'ALL' ? peers.length : (mode === 'QUORUM' ?
        Math.max(1, Math.min(peers.length, parseInt(step.MinApprovals, 10) || 1)) : 1);
      return approved >= required;
    }
    if (String(instance.Status) !== expected) return false;
    const terminalAction = decision === 'APPROVE' ? 'COMPLETE' : decision;
    const hasTerminalHistory = histories.some(function (history) {
      return String(history.InstanceID || '') === String(instance.InstanceID) &&
        String(history.Action || '') === terminalAction && String(history.StatusTo || '') === expected;
    });
    if (!hasTerminalHistory) return true;
    if (String(instance.ModuleKey) !== 'serviceCatalog') return false;
    const request = requestById[String(instance.RecordID || '')];
    if (!request) return true;
    if (decision === 'APPROVE') {
      return String(request.ApprovalStatus || '') !== 'อนุมัติ' ||
        String(request.Status || '') === 'รออนุมัติ';
    }
    return String(request.Status || '') !== 'ปฏิเสธ';
  }).sort(function (a, b) {
    return wfTime_(a.DecidedAt || a.Timestamp) - wfTime_(b.DecidedAt || b.Timestamp) ||
      String(a.ApprovalID || '').localeCompare(String(b.ApprovalID || ''));
  });
  const selection = wfRoundRobinRepairRows_(eligible,
    Math.max(1, Math.min(100, parseInt(limit, 10) || 30)), WF_TRANSITION_REPAIR_CURSOR_KEY_);
  const candidates = selection.rows;
  const result = { selected: candidates.length, total: selection.total,
    cursorStart: selection.cursorStart, nextCursor: selection.nextCursor,
    repaired: 0, skipped: 0, errors: [] };
  candidates.forEach(function (candidate) {
    try {
      const changed = wfWithScriptLock_(function () {
        const executionActor = wfReauthorizeMutationActorLocked_(wfActor_(actor, 'system'),
          'workflow.run_automation');
        const approval = wfFindRowLocked_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', candidate.ApprovalID, true);
        if (!approval) return false;
        const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', approval.InstanceID, true);
        if (!instance) return false;
        const decision = String(approval.Decision || '').toUpperCase();
        const decisionActor = wfActor_({
          email: approval.DecisionBy,
          role: approval.ApproverRole || actor.role,
          name: approval.DecisionBy
        }, approval.DecisionBy);
        wfAuditLocked_(executionActor, 'RECONCILE_DECISION_INTENT', SHEETS.WORKFLOW_APPROVAL,
          approval.ApprovalID, decision + ' / ' + instance.InstanceID, 'pending');
        wfWriteHistoryLocked_(instance, approval, decision, WF_APPROVAL_STATUS_.PENDING,
          String(approval.Status || ''), decisionActor, approval.Comment || '', {
            signatureHash: approval.SignatureHash || '',
            attachments: wfNormalizeIdList_(approval.AttachmentIDsJSON, 20),
            reconciled: true
          }, false);
        wfResumeDecisionTransitionLocked_(instance, approval, decision,
          decisionActor, approval.Comment || '');
        wfAuditLocked_(executionActor, 'RECONCILE_DECISION', SHEETS.WORKFLOW_APPROVAL,
          approval.ApprovalID, decision + ' / ' + instance.InstanceID, 'success');
        return true;
      });
      if (changed) result.repaired++;
      else result.skipped++;
    } catch (e) {
      result.errors.push({ approvalId: candidate.ApprovalID, error: sanitizeText(e.message, 500) });
    }
  });
  return result;
}

function wfReconcileServiceRequestIntegrationQueues_(limit, actor) {
  if (typeof queueServiceRequestIntegration_ !== 'function') return { selected: 0, queued: 0, errors: [] };
  const outbox = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX, true);
  const eligible = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST, true).filter(function (request) {
    if (['อนุมัติ', 'ไม่ต้องอนุมัติ'].indexOf(String(request.ApprovalStatus || '')) === -1) return false;
    if (['ปิดงาน', 'ปฏิเสธ', 'ยกเลิก'].indexOf(String(request.Status || '')) > -1) return false;
    let integration = null;
    try {
      integration = wfNormalizeJsonObject_(request.WorkflowJSON,
        'ServiceRequest.WorkflowJSON', {}).integration;
    } catch (ignoreInvalidSnapshot) { return false; }
    if (!integration || !wfIsYes_(integration.autoCreate !== undefined ?
      integration.autoCreate : integration.autoCreateTarget) || !integration.target) return false;
    return !outbox.some(function (job) {
      return String(job.SourceModule || '') === 'serviceCatalog' &&
        String(job.SourceRecordID || '') === String(request.RequestID || '') &&
        String(job.Status || '') !== 'CANCELLED';
    });
  }).sort(function (a, b) {
    return String(a.RequestID || '').localeCompare(String(b.RequestID || ''));
  });
  const selection = wfRoundRobinRepairRows_(eligible,
    Math.max(1, Math.min(100, parseInt(limit, 10) || 30)), WF_QUEUE_REPAIR_CURSOR_KEY_);
  const rows = selection.rows;
  const result = { selected: rows.length, total: selection.total,
    cursorStart: selection.cursorStart, nextCursor: selection.nextCursor,
    queued: 0, errors: [] };
  rows.forEach(function (request) {
    try {
      const config = wfNormalizeJsonObject_(request.WorkflowJSON,
        'ServiceRequest.WorkflowJSON', {}).integration;
      const queued = queueServiceRequestIntegration_(request.RequestID,
        'AUTOMATION_RECONCILE', Object.assign({}, wfActor_(actor, 'system'), {
          _requiredPermission: 'workflow.run_automation'
        }), config);
      if (queued) result.queued++;
    } catch (e) {
      result.errors.push({ requestId: request.RequestID, error: sanitizeText(e.message, 500) });
    }
  });
  return result;
}

function wfRoundRobinRepairRows_(rows, limit, propertyKey) {
  rows = Array.isArray(rows) ? rows : [];
  limit = Math.max(1, parseInt(limit, 10) || 1);
  const props = PropertiesService.getScriptProperties();
  const stored = Math.max(0, parseInt(props.getProperty(propertyKey), 10) || 0);
  const cursorStart = rows.length ? stored % rows.length : 0;
  const take = Math.min(limit, rows.length);
  const selected = [];
  for (let offset = 0; offset < take; offset++) {
    selected.push(rows[(cursorStart + offset) % rows.length]);
  }
  const nextCursor = rows.length ? (cursorStart + take) % rows.length : 0;
  props.setProperty(propertyKey, String(nextCursor));
  return { rows: selected, total: rows.length, cursorStart: cursorStart, nextCursor: nextCursor };
}

// ============================================================================
// Internal start / advance engine
// ============================================================================

/**
 * Internal-only entry point.
 * options = {definitionId|workflowCode,moduleKey,recordId,recordLabel,requesterEmail,
 *   requesterDepartment,context,idempotencyKey,actor}
 */
function workflowStart_(options) {
  options = options || {};
  const actor = wfActor_(options.actor, options.requesterEmail || 'system');
  if (actor.email !== 'system') wfRequireActionPermission_(actor, 'workflow.start');
  wfEnsureSheets_();
  const moduleKey = sanitizeText(options.moduleKey, 80);
  const recordId = sanitizeText(options.recordId, 160);
  if (!MODULE_ACCESS[moduleKey]) throw new Error('ModuleKey สำหรับ Workflow ไม่ถูกต้อง');
  if (!recordId) throw new Error('RecordID สำหรับ Workflow ไม่ถูกต้อง');
  const requesterEmail = String(sanitizeText(options.requesterEmail, 200)).toLowerCase();
  if (!isValidEmail(requesterEmail)) throw new Error('RequesterEmail สำหรับ Workflow ไม่ถูกต้อง');
  const context = wfNormalizeJsonObject_(options.context, 'Workflow Context', {});
  const idempotencyKey = sanitizeText(options.idempotencyKey, 200) ||
    [moduleKey, recordId, options.definitionId || options.workflowCode || 'default'].join(':');

  const outcome = wfWithScriptLock_(function () {
    const mutationActor = wfReauthorizeMutationActorLocked_(actor, 'workflow.start');
    const duplicate = readSheetObjectsEnsured_(SHEETS.WORKFLOW_INSTANCE, true).filter(function (row) {
      return String(row.IdempotencyKey || '') === idempotencyKey;
    })[0];
    if (duplicate) {
      const repaired = wfRepairInstanceActivationLocked_(duplicate, mutationActor);
      wfAuditLocked_(mutationActor, 'START_RECONCILED', SHEETS.WORKFLOW_INSTANCE,
        duplicate.InstanceID, moduleKey + '/' + recordId, 'success');
      return {
        instanceId: duplicate.InstanceID,
        status: repaired.status,
        duplicate: true,
        repaired: repaired.repaired,
        approvers: repaired.approvers || [],
        moduleKey: duplicate.ModuleKey,
        recordId: duplicate.RecordID
      };
    }

    const definition = wfResolveDefinitionLocked_(options.definitionId, options.workflowCode, moduleKey);
    if (!definition) throw new Error('ไม่พบ Workflow Definition ที่ใช้งานสำหรับโมดูล ' + moduleKey);
    const definitionCondition = wfNormalizeJsonObject_(definition.ConditionsJSON,
      'WorkflowDefinitions.ConditionsJSON', {});
    if (!wfConditionMatches_(definitionCondition, context)) {
      throw new Error('ข้อมูลรายการไม่ผ่านเงื่อนไขของ Workflow Definition');
    }
    const steps = wfSelectCommittedDefinitionSteps_(
      readSheetObjectsEnsured_(SHEETS.WORKFLOW_STEP, true), definition)
      .sort(function (a, b) { return Number(a.StepOrder || 0) - Number(b.StepOrder || 0); });
    if (!steps.length) throw new Error('Workflow Definition ไม่มีขั้นตอนที่ใช้งาน');
    const snapshot = {
      definition: wfDefinitionSnapshot_(definition),
      steps: steps.map(wfStepSnapshot_)
    };
    context.__workflowSnapshot = snapshot;
    const now = new Date();
    const instanceId = generateId('WFI');
    const firstStep = wfNextEligibleStep_(snapshot.steps, 0, context);
    if (!firstStep) throw new Error('Workflow ไม่มีขั้นตอนที่ตรงกับเงื่อนไขรายการ');
    const instanceDraft = {
      InstanceID: instanceId,
      DefinitionID: definition.DefinitionID,
      DefinitionVersion: definition.Version,
      ModuleKey: moduleKey,
      RecordID: recordId,
      RecordLabel: sanitizeText(options.recordLabel, 300) || recordId,
      RequesterEmail: requesterEmail,
      RequesterDepartment: sanitizeText(options.requesterDepartment, 200),
      CurrentStepOrder: firstStep.StepOrder,
      Status: WF_INSTANCE_STATUS_.ACTIVE,
      StartedAt: now,
      DueAt: addBusinessHours_(now, wfNumber_(definition.SLAHours, 1, 2160, 24)),
      ContextJSON: JSON.stringify(context),
      IdempotencyKey: idempotencyKey,
      Revision: 1
    };
    // Resolve actors, SoD, action permission and quorum before persisting the
    // instance. This keeps invalid definitions from creating orphan ACTIVE rows.
    const firstPreflight = wfPreflightStepActors_(instanceDraft, firstStep);
    wfAuditLocked_(mutationActor, 'START_INTENT', SHEETS.WORKFLOW_INSTANCE, instanceId,
      moduleKey + '/' + recordId, 'pending');
    wfAppendRowLocked_(SHEETS.WORKFLOW_INSTANCE, instanceDraft, mutationActor.email);
    const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instanceId, true);
    let activated;
    try {
      activated = wfActivateStepLocked_(instance, firstStep, mutationActor, firstPreflight);
    } catch (activationError) {
      wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, instance._row, {
        Status: WF_INSTANCE_STATUS_.ERROR,
        ResultJSON: JSON.stringify({ phase: 'START_ACTIVATION', error: sanitizeText(activationError.message, 1000) }),
        Notes: wfAppendNote_(instance.Notes, mutationActor.email, 'start activation failed: ' + activationError.message)
      }, mutationActor.email);
      wfWriteHistoryLocked_(instance, null, 'ERROR', WF_INSTANCE_STATUS_.ACTIVE,
        WF_INSTANCE_STATUS_.ERROR, mutationActor, activationError.message, { phase: 'START_ACTIVATION' }, false);
      wfAuditLocked_(mutationActor, 'START', SHEETS.WORKFLOW_INSTANCE, instanceId,
        sanitizeText(activationError.message, 800), 'error');
      throw activationError;
    }
    wfWriteHistoryLocked_(instance, null, 'START', '', WF_INSTANCE_STATUS_.ACTIVE, mutationActor,
      'เริ่ม Workflow ' + definition.WorkflowCode, { definitionVersion: definition.Version }, true);
    wfAuditLocked_(mutationActor, 'START', SHEETS.WORKFLOW_INSTANCE, instanceId,
      moduleKey + '/' + recordId, 'success');
    return {
      instanceId: instanceId,
      status: WF_INSTANCE_STATUS_.ACTIVE,
      duplicate: false,
      approvers: activated.approvers,
      moduleKey: moduleKey,
      recordId: recordId
    };
  });
  if (!outcome.duplicate) {
    (outcome.approvers || []).forEach(function (email) {
      wfNotifyPrivate_(email, 'มี Workflow รอพิจารณา', 'Workflow ' + outcome.instanceId +
        ' รอการพิจารณา', 'workflow', outcome.instanceId);
    });
  }
  return outcome;
}

/** Compatibility bridge invoked after a Service Request parent row is durable. */
function workflowEnsureServiceRequest_(requestId, actor) {
  wfEnsureSheets_();
  requestId = sanitizeText(requestId, 120);
  const request = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
  if (!request) throw new Error('ไม่พบคำขอบริการ ' + requestId);
  if (String(request.WorkflowInstanceID || '').trim()) {
    const existingId = String(request.WorkflowInstanceID);
    const repaired = wfWithScriptLock_(function () {
      const lockedActor = wfReauthorizeMutationActorLocked_(
        wfActor_(actor, request.RequesterEmail), 'workflow.start');
      const instance = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', existingId, true);
      if (!instance) throw new Error('WorkflowInstanceID ของคำขออ้างถึงรายการที่ไม่มีอยู่');
      return wfRepairInstanceActivationLocked_(instance, lockedActor);
    });
    return { instanceId: existingId, status: repaired.status,
      duplicate: true, repaired: repaired.repaired };
  }
  if (String(request.Status || '') !== 'รออนุมัติ' || String(request.ApprovalStatus || '') !== 'รออนุมัติ') {
    if (typeof queueServiceRequestIntegration_ === 'function') {
      const catalog = findRowEnsured_(SHEETS.SERVICE_CATALOG, 'CatalogID', request.CatalogID);
      queueServiceRequestIntegration_(requestId, 'NO_APPROVAL', actor || request.RequesterEmail,
        wfServiceRequestIntegrationConfig_(request, catalog));
    }
    return { instanceId: '', duplicate: false, noApproval: true };
  }
  const catalog = findRowEnsured_(SHEETS.SERVICE_CATALOG, 'CatalogID', request.CatalogID);
  const definitionId = catalog && String(catalog.WorkflowDefinitionID || '').trim();
  const outcome = workflowStart_({
    definitionId: definitionId,
    workflowCode: definitionId ? '' : 'WF-SERVICE-APPROVAL',
    moduleKey: 'serviceCatalog',
    recordId: requestId,
    recordLabel: request.ServiceName + ' · ' + request.Summary,
    requesterEmail: request.RequesterEmail,
    requesterDepartment: request.Department,
    context: {
      approverEmail: String(request.Approver || '').toLowerCase(),
      catalogId: request.CatalogID,
      catalogVersion: request.CatalogVersion,
      serviceCode: request.ServiceCode,
      priority: request.Priority,
      impact: request.Impact,
      requestedFor: request.RequestedFor
    },
    idempotencyKey: 'serviceCatalog:' + requestId + ':approval',
    actor: actor || { email: request.RequesterEmail, role: request.CreatedBy === 'system' ? ROLES.IT_ADMIN : ROLES.USER }
  });
  wfWithScriptLock_(function () {
    const lockedActor = wfReauthorizeMutationActorLocked_(
      wfActor_(actor, request.RequesterEmail), 'workflow.start');
    const locked = wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId, true);
    if (!locked) throw new Error('คำขอบริการหายไประหว่างสร้าง Workflow');
    if (!String(locked.WorkflowInstanceID || '').trim()) {
      wfUpdateRowLocked_(SHEETS.SERVICE_REQUEST, locked._row, {
        WorkflowInstanceID: outcome.instanceId
      }, lockedActor.email);
    }
  });
  return outcome;
}

function wfPreflightDecisionTransitionLocked_(instance, approval, decision) {
  let sourceRequest = null;
  let sourceCatalog = null;
  if (String(instance.ModuleKey) === 'serviceCatalog') {
    sourceRequest = wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', instance.RecordID, true);
    if (!sourceRequest) throw new Error('ไม่พบ Service Request ต้นทางของ Workflow');
    sourceCatalog = wfFindRowLocked_(SHEETS.SERVICE_CATALOG, 'CatalogID', sourceRequest.CatalogID, true);
  }
  if (decision !== 'APPROVE') return true;
  const stepApprovals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      Number(row.StepOrder || 0) === Number(approval.StepOrder || 0);
  });
  const step = wfSnapshotStep_(instance, approval.StepID, approval.StepOrder);
  const approvedCount = stepApprovals.filter(function (row) {
    return String(row.ApprovalID) === String(approval.ApprovalID) ||
      String(row.Status) === WF_APPROVAL_STATUS_.APPROVED;
  }).length;
  const mode = String(step.Mode || 'ANY').toUpperCase();
  const required = mode === 'ALL' ? stepApprovals.length : (mode === 'QUORUM' ?
    Math.max(1, Math.min(stepApprovals.length, parseInt(step.MinApprovals, 10) || 1)) : 1);
  if (approvedCount < required) return true;
  const snapshot = wfInstanceSnapshot_(instance);
  const context = wfInstanceContext_(instance);
  const next = wfNextEligibleStep_(snapshot.steps, Number(approval.StepOrder || 0), context);
  if (next) {
    wfPreflightStepActors_(instance, next);
    return true;
  }
  if (sourceRequest) {
    const integration = wfServiceRequestIntegrationConfig_(sourceRequest, sourceCatalog);
    if (integration && wfIsYes_(integration.autoCreate !== undefined ?
      integration.autoCreate : integration.autoCreateTarget)) {
      if (typeof intNormalizeTarget_ !== 'function' || !intNormalizeTarget_(integration.target)) {
        throw new Error('Integration target ใน snapshot ไม่ถูกต้อง');
      }
      if (typeof intMappingObject_ === 'function') intMappingObject_(integration.mapping);
    }
  }
  return true;
}

function wfResumeDecisionTransitionLocked_(instance, approval, decision, actor, comment) {
  const fresh = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instance.InstanceID, true) || instance;
  const terminal = decision === 'REJECT' ? WF_INSTANCE_STATUS_.REJECTED :
    (decision === 'RETURN' ? WF_INSTANCE_STATUS_.RETURNED : WF_INSTANCE_STATUS_.COMPLETED);
  if (String(fresh.Status) !== WF_INSTANCE_STATUS_.ACTIVE) {
    if (String(fresh.Status) !== terminal) {
      throw new Error('Workflow สิ้นสุดด้วยผลลัพธ์อื่นแล้ว');
    }
    wfEnsureTerminalHistoryLocked_(fresh, approval, terminal, actor, comment);
    wfApplySourceOutcomeLocked_(fresh, terminal, actor, comment);
    return { instanceStatus: terminal, completed: terminal === WF_INSTANCE_STATUS_.COMPLETED,
      resumed: true };
  }
  if (decision === 'REJECT' || decision === 'RETURN') {
    return wfFinishInstanceLocked_(fresh, terminal, actor, comment, approval.ApprovalID);
  }
  return wfAdvanceAfterApprovalLocked_(fresh, approval, actor, comment);
}

function wfAdvanceAfterApprovalLocked_(instance, approval, actor, comment) {
  const fresh = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instance.InstanceID, true) || instance;
  if (String(fresh.Status) === WF_INSTANCE_STATUS_.COMPLETED) {
    wfEnsureTerminalHistoryLocked_(fresh, approval, WF_INSTANCE_STATUS_.COMPLETED, actor, comment);
    wfApplySourceOutcomeLocked_(fresh, WF_INSTANCE_STATUS_.COMPLETED, actor, comment);
    return { instanceStatus: WF_INSTANCE_STATUS_.COMPLETED, completed: true, resumed: true };
  }
  if (String(fresh.Status) !== WF_INSTANCE_STATUS_.ACTIVE) {
    throw new Error('Workflow ไม่อยู่ในสถานะที่เลื่อนขั้นตอนได้');
  }
  if (Number(fresh.CurrentStepOrder || 0) > Number(approval.StepOrder || 0)) {
    const pendingApprovers = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
      return String(row.InstanceID) === String(fresh.InstanceID) &&
        Number(row.StepOrder || 0) === Number(fresh.CurrentStepOrder || 0) &&
        String(row.Status) === WF_APPROVAL_STATUS_.PENDING;
    }).map(function (row) { return String(row.ApproverEmail || '').toLowerCase(); });
    wfWriteHistoryLocked_(fresh, approval, 'ADVANCE', String(approval.StepOrder),
      String(fresh.CurrentStepOrder), actor, 'ซ่อม timeline การเลื่อนขั้นตอน',
      { approvers: wfUnique_(pendingApprovers), resumed: true }, true);
    wfUpdateSourceApproversLocked_(fresh);
    return { instanceStatus: WF_INSTANCE_STATUS_.ACTIVE, stepCompleted: true,
      nextStepOrder: Number(fresh.CurrentStepOrder || 0), approvers: wfUnique_(pendingApprovers), resumed: true };
  }
  const approvals = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      Number(row.StepOrder || 0) === Number(approval.StepOrder || 0);
  });
  const step = wfSnapshotStep_(instance, approval.StepID, approval.StepOrder);
  const approvedCount = approvals.filter(function (row) {
    return String(row.Status) === WF_APPROVAL_STATUS_.APPROVED;
  }).length;
  const total = approvals.length;
  const mode = String(step.Mode || 'ANY').toUpperCase();
  const required = mode === 'ALL' ? total : (mode === 'QUORUM' ?
    Math.max(1, Math.min(total, parseInt(step.MinApprovals, 10) || 1)) : 1);
  if (approvedCount < required) {
    return { instanceStatus: WF_INSTANCE_STATUS_.ACTIVE, stepCompleted: false,
      approvedCount: approvedCount, requiredApprovals: required };
  }
  approvals.forEach(function (row) {
    if (String(row.Status) === WF_APPROVAL_STATUS_.PENDING) {
      wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, row._row, {
        Status: WF_APPROVAL_STATUS_.SUPERSEDED,
        Decision: 'SUPERSEDED',
        DecidedAt: new Date(),
        DecisionBy: 'system',
        Notes: wfAppendNote_(row.Notes, 'system', 'approval threshold reached')
      }, actor.email);
    }
  });
  const snapshot = wfInstanceSnapshot_(instance);
  const context = wfInstanceContext_(instance);
  const next = wfNextEligibleStep_(snapshot.steps, Number(approval.StepOrder || 0), context);
  if (!next) {
    return wfFinishInstanceLocked_(instance, WF_INSTANCE_STATUS_.COMPLETED, actor, comment, approval.ApprovalID);
  }
  const activated = wfActivateStepLocked_(instance, next, actor);
  wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, instance._row, {
    CurrentStepOrder: next.StepOrder,
    Revision: (parseInt(instance.Revision, 10) || 0) + 1
  }, actor.email);
  wfWriteHistoryLocked_(instance, approval, 'ADVANCE', String(approval.StepOrder),
    String(next.StepOrder), actor, 'เลื่อนไปขั้นตอน ' + next.StepName,
    { approvers: activated.approvers }, true);
  wfUpdateSourceApproversLocked_(instance);
  return { instanceStatus: WF_INSTANCE_STATUS_.ACTIVE, stepCompleted: true,
    nextStepOrder: next.StepOrder, approvers: activated.approvers };
}

function wfFinishInstanceLocked_(instance, status, actor, comment, approvalId, options) {
  options = options || {};
  if (WF_TERMINAL_INSTANCE_STATUS_.indexOf(status) === -1) throw new Error('สถานะปลายทาง Workflow ไม่ถูกต้อง');
  const fresh = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instance.InstanceID, true) || instance;
  if (String(fresh.Status) !== WF_INSTANCE_STATUS_.ACTIVE) {
    if (String(fresh.Status) !== String(status)) throw new Error('Workflow สิ้นสุดด้วยผลลัพธ์อื่นแล้ว');
    const priorApproval = approvalId ?
      wfFindRowLocked_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', approvalId, true) : null;
    wfEnsureTerminalHistoryLocked_(fresh, priorApproval, status, actor, comment);
    if (!options.skipSourceOutcome) wfApplySourceOutcomeLocked_(fresh, status, actor, comment);
    return { instanceStatus: status, completed: status === WF_INSTANCE_STATUS_.COMPLETED,
      resumed: true };
  }
  instance = fresh;
  readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).forEach(function (row) {
    if (String(row.InstanceID) === String(instance.InstanceID) &&
      String(row.Status) === WF_APPROVAL_STATUS_.PENDING) {
      wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL, row._row, {
        Status: status === WF_INSTANCE_STATUS_.CANCELLED ? WF_APPROVAL_STATUS_.CANCELLED : WF_APPROVAL_STATUS_.SUPERSEDED,
        Decision: status === WF_INSTANCE_STATUS_.CANCELLED ? 'CANCELLED' : 'SUPERSEDED',
        DecidedAt: new Date(),
        DecisionBy: actor.email
      }, actor.email);
    }
  });
  const patch = {
    Status: status,
    ResultJSON: JSON.stringify({ status: status, comment: comment || '', actor: actor.email }),
    Revision: (parseInt(instance.Revision, 10) || 0) + 1
  };
  if (status === WF_INSTANCE_STATUS_.CANCELLED) patch.CancelledAt = new Date();
  else patch.CompletedAt = new Date();
  wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, instance._row, patch, actor.email);
  wfEnsureTerminalHistoryLocked_(instance,
    approvalId ? { ApprovalID: approvalId, StepOrder: instance.CurrentStepOrder } : null,
    status, actor, comment);
  if (!options.skipSourceOutcome) wfApplySourceOutcomeLocked_(instance, status, actor, comment);
  return {
    instanceStatus: status,
    completed: status === WF_INSTANCE_STATUS_.COMPLETED,
    queueIntegration: status === WF_INSTANCE_STATUS_.COMPLETED && String(instance.ModuleKey) === 'serviceCatalog'
  };
}

function wfEnsureTerminalHistoryLocked_(instance, approval, status, actor, comment) {
  const action = status === WF_INSTANCE_STATUS_.COMPLETED ? 'COMPLETE' :
    (status === WF_INSTANCE_STATUS_.REJECTED ? 'REJECT' :
      (status === WF_INSTANCE_STATUS_.RETURNED ? 'RETURN' :
        (status === WF_INSTANCE_STATUS_.CANCELLED ? 'CANCEL' : 'ERROR')));
  wfWriteHistoryLocked_(instance, approval, action, WF_INSTANCE_STATUS_.ACTIVE,
    status, actor, comment, {}, true);
}

function wfPreflightStepActors_(instance, step) {
  const context = wfInstanceContext_(instance);
  const snapshots = context.__workflowActorSnapshots || {};
  const frozen = Array.isArray(snapshots[String(step.StepID)]) ?
    snapshots[String(step.StepID)] : [];
  const resolved = frozen.length ? wfUnique_(frozen.map(function (item) {
    return String(item.originalEmail || '').toLowerCase();
  })) : wfUnique_(wfResolveStepActors_(step, instance, context));
  if (!resolved.length) throw new Error('ไม่พบผู้อนุมัติที่ Active สำหรับขั้นตอน ' + step.StepName);
  const assignments = resolved.map(function (originalEmail) {
    const frozenAssignment = frozen.filter(function (item) {
      return String(item.originalEmail || '').toLowerCase() === originalEmail;
    })[0];
    const delegated = frozenAssignment ?
      (String(frozenAssignment.currentEmail || '').toLowerCase() !== originalEmail) :
      wfEffectiveDelegate_(originalEmail, instance, step);
    const currentEmail = frozenAssignment ?
      String(frozenAssignment.currentEmail || '').toLowerCase() : (delegated || originalEmail);
    if (!isValidEmail(currentEmail)) throw new Error('อีเมลผู้อนุมัติไม่ถูกต้อง: ' + currentEmail);
    if (currentEmail === String(instance.RequesterEmail || '').toLowerCase()) {
      throw new Error('Separation of Duties: ผู้ร้องขอเป็นผู้อนุมัติไม่ได้');
    }
    const userRow = wfActiveUser_(currentEmail);
    if (!userRow) throw new Error('ผู้อนุมัติไม่ใช่บัญชี Active: ' + currentEmail);
    const approverActor = {
      email: currentEmail,
      role: userRow.Role,
      name: userRow.FullName || currentEmail,
      department: userRow.Department || ''
    };
    if (!wfHasActionPermission_(approverActor, 'workflow.approve')) {
      throw new Error('ผู้อนุมัติไม่มี action permission workflow.approve: ' + currentEmail);
    }
    return { originalEmail: originalEmail, currentEmail: currentEmail,
      delegated: !!delegated, userRow: userRow };
  });
  const voteOwners = {};
  assignments.forEach(function (assignment) {
    if (voteOwners[assignment.currentEmail]) {
      throw new Error('delegation ทำให้ผู้อนุมัติคนเดียวถือหลายสิทธิ์โหวต: ' +
        assignment.currentEmail);
    }
    voteOwners[assignment.currentEmail] = assignment.originalEmail;
  });
  const mode = String(step.Mode || 'ANY').toUpperCase();
  const required = mode === 'ALL' ? assignments.length : (mode === 'QUORUM' ?
    Math.max(1, parseInt(step.MinApprovals, 10) || 1) : 1);
  if (required > assignments.length) {
    throw new Error('จำนวนผู้อนุมัติไม่เพียงพอสำหรับ quorum ของขั้นตอน ' + step.StepName);
  }
  return { resolved: resolved, assignments: assignments, required: required };
}

function wfActivateStepLocked_(instance, step, actor, preflight) {
  preflight = preflight || wfPreflightStepActors_(instance, step);
  const assignments = preflight.assignments || [];
  const context = wfInstanceContext_(instance);
  const snapshots = context.__workflowActorSnapshots || {};
  if (!Array.isArray(snapshots[String(step.StepID)]) || !snapshots[String(step.StepID)].length) {
    snapshots[String(step.StepID)] = assignments.map(function (assignment) {
      return {
        originalEmail: assignment.originalEmail,
        currentEmail: assignment.currentEmail
      };
    });
    context.__workflowActorSnapshots = snapshots;
    const contextJson = JSON.stringify(context);
    wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, instance._row, { ContextJSON: contextJson }, actor.email);
    instance.ContextJSON = contextJson;
  }
  const dueAt = addBusinessHours_(new Date(), wfNumber_(step.SLAHours, 1, 2160, 24));
  const approvers = [];
  const existingRows = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      String(row.StepID) === String(step.StepID);
  });
  const claimedVotes = {};
  existingRows.forEach(function (row) {
    if ([WF_APPROVAL_STATUS_.CANCELLED, WF_APPROVAL_STATUS_.SUPERSEDED]
        .indexOf(String(row.Status || '')) > -1) return;
    const current = String(row.ApproverEmail || '').toLowerCase();
    if (!current) return;
    if (claimedVotes[current] && claimedVotes[current] !== String(row.ApprovalID)) {
      throw new Error('พบผู้อนุมัติคนเดียวถือหลายสิทธิ์โหวตในขั้นตอนเดียวกัน: ' + current);
    }
    claimedVotes[current] = String(row.ApprovalID);
  });
  assignments.forEach(function (assignment) {
    const originalEmail = assignment.originalEmail;
    const currentEmail = assignment.currentEmail;
    const delegated = assignment.delegated;
    const userRow = assignment.userRow;
    const existing = existingRows.filter(function (row) {
      return String(row.OriginalApproverEmail || row.ApproverEmail || '').toLowerCase() ===
        String(originalEmail).toLowerCase();
    })[0];
    if (existing) {
      approvers.push(String(existing.ApproverEmail || currentEmail).toLowerCase());
      return;
    }
    if (claimedVotes[currentEmail]) {
      throw new Error('ผู้อนุมัติคนเดียวถือหลายสิทธิ์โหวตในขั้นตอนเดียวกัน: ' + currentEmail);
    }
    const id = generateId('WFA');
    wfAppendRowLocked_(SHEETS.WORKFLOW_APPROVAL, {
      ApprovalID: id,
      InstanceID: instance.InstanceID,
      StepID: step.StepID,
      StepOrder: step.StepOrder,
      ApproverEmail: currentEmail,
      OriginalApproverEmail: originalEmail,
      ApproverRole: userRow.Role,
      ApprovalGroup: String(step.ApprovalType || '').toUpperCase() === 'GROUP' ? step.ApproverValue : '',
      Status: WF_APPROVAL_STATUS_.PENDING,
      DueAt: dueAt,
      DelegatedAt: delegated ? new Date() : '',
      Revision: 1,
      Notes: delegated ? ('auto delegation from ' + originalEmail) : ''
    }, actor.email);
    claimedVotes[currentEmail] = id;
    approvers.push(currentEmail);
  });
  wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, instance._row, {
    CurrentStepOrder: step.StepOrder,
    Revision: (parseInt(instance.Revision, 10) || 0) + 1
  }, actor.email);
  wfUpdateSourceApproversLocked_(instance);
  return { approvers: wfUnique_(approvers), dueAt: dueAt };
}

function wfRepairInstanceActivationLocked_(instance, actor) {
  const status = String(instance.Status || '');
  if (WF_TERMINAL_INSTANCE_STATUS_.indexOf(status) > -1 && status !== WF_INSTANCE_STATUS_.ERROR) {
    return { status: status, repaired: false, approvers: [] };
  }
  if (status === WF_INSTANCE_STATUS_.ERROR) {
    let result = {};
    try { result = wfNormalizeJsonObject_(instance.ResultJSON, 'Workflow ResultJSON', {}); }
    catch (ignoreResult) {}
    if (String(result.phase || '') !== 'START_ACTIVATION') {
      return { status: status, repaired: false, approvers: [] };
    }
  }
  const snapshot = wfInstanceSnapshot_(instance);
  const step = snapshot.steps.filter(function (item) {
    return Number(item.StepOrder || 0) === Number(instance.CurrentStepOrder || 0);
  })[0];
  if (!step) throw new Error('ไม่พบ snapshot ของขั้นตอนที่ต้องซ่อม');
  const existingStepRows = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      String(row.StepID) === String(step.StepID);
  });
  const preflight = wfPreflightStepActors_(instance, step);
  const existingOriginals = {};
  existingStepRows.forEach(function (row) {
    existingOriginals[String(row.OriginalApproverEmail || row.ApproverEmail || '').toLowerCase()] = true;
  });
  const missingAssignments = preflight.assignments.filter(function (assignment) {
    return !existingOriginals[assignment.originalEmail];
  });
  if (status === WF_INSTANCE_STATUS_.ACTIVE && !missingAssignments.length) {
    wfUpdateSourceApproversLocked_(instance);
    return {
      status: status,
      repaired: false,
      approvers: wfUnique_(existingStepRows.filter(function (row) {
        return String(row.Status) === WF_APPROVAL_STATUS_.PENDING;
      }).map(function (row) { return String(row.ApproverEmail || '').toLowerCase(); }))
    };
  }
  const activated = wfActivateStepLocked_(instance, step, actor, preflight);
  const fresh = wfFindRowLocked_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', instance.InstanceID, true);
  if (status === WF_INSTANCE_STATUS_.ERROR && fresh) {
    wfUpdateRowLocked_(SHEETS.WORKFLOW_INSTANCE, fresh._row, {
      Status: WF_INSTANCE_STATUS_.ACTIVE,
      ResultJSON: '',
      Notes: wfAppendNote_(fresh.Notes, actor.email, 'repaired start activation')
    }, actor.email);
    wfWriteHistoryLocked_(fresh, null, 'REPAIR', WF_INSTANCE_STATUS_.ERROR,
      WF_INSTANCE_STATUS_.ACTIVE, actor, 'ซ่อมการสร้าง approval ที่ค้าง', { phase: 'START_ACTIVATION' }, false);
  } else if (status === WF_INSTANCE_STATUS_.ACTIVE && missingAssignments.length) {
    wfWriteHistoryLocked_(fresh || instance, null, 'REPAIR', WF_INSTANCE_STATUS_.ACTIVE,
      WF_INSTANCE_STATUS_.ACTIVE, actor, 'ซ่อม approval ที่สร้างไม่ครบ',
      { phase: 'ACTIVE_PARTIAL_ACTIVATION', repairedCount: missingAssignments.length }, false);
  }
  return { status: WF_INSTANCE_STATUS_.ACTIVE, repaired: true, approvers: activated.approvers };
}

function wfApplySourceOutcomeLocked_(instance, status, actor, comment) {
  if (String(instance.ModuleKey) !== 'serviceCatalog') return;
  const request = wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', instance.RecordID, true);
  if (!request) throw new Error('ไม่พบ Service Request ต้นทางของ Workflow');
  const from = String(request.Status || '');
  const patch = { WorkflowInstanceID: instance.InstanceID };
  let target = from;
  let action = 'WORKFLOW_UPDATE';
  if (status === WF_INSTANCE_STATUS_.COMPLETED) {
    const alreadyApproved = String(request.ApprovalStatus || '') === 'อนุมัติ' && from !== 'รออนุมัติ';
    target = alreadyApproved ? from : 'รอมอบหมาย';
    action = 'WORKFLOW_APPROVE';
    patch.ApprovalStatus = 'อนุมัติ';
    patch.ApprovedBy = request.ApprovedBy || actor.email;
    patch.ApprovedAt = request.ApprovedAt || new Date();
    if (!alreadyApproved) patch.Status = target;
    patch.Approver = '';
  } else if (status === WF_INSTANCE_STATUS_.REJECTED || status === WF_INSTANCE_STATUS_.RETURNED) {
    const rejectionLabel = status === WF_INSTANCE_STATUS_.REJECTED ? 'ปฏิเสธ' : 'ส่งกลับแก้ไข';
    const alreadyRejected = String(request.ApprovalStatus || '') === rejectionLabel && from === 'ปฏิเสธ';
    target = alreadyRejected ? from : 'ปฏิเสธ';
    action = status === WF_INSTANCE_STATUS_.REJECTED ? 'WORKFLOW_REJECT' : 'WORKFLOW_RETURN';
    patch.ApprovalStatus = rejectionLabel;
    patch.ApprovedBy = request.ApprovedBy || actor.email;
    patch.ApprovedAt = request.ApprovedAt || new Date();
    if (!alreadyRejected) patch.Status = target;
    patch.ClosedAt = request.ClosedAt || new Date();
  } else if (status === WF_INSTANCE_STATUS_.CANCELLED) {
    const alreadyCancelled = from === 'ยกเลิก';
    target = alreadyCancelled ? from : 'ยกเลิก';
    action = 'WORKFLOW_CANCEL';
    patch.ApprovalStatus = 'ยกเลิก';
    if (!alreadyCancelled) patch.Status = target;
    patch.CancelReason = comment;
    patch.ClosedAt = request.ClosedAt || new Date();
  }
  const existingHistory = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY, true).filter(function (row) {
    return String(row.RequestID || '') === String(request.RequestID) &&
      String(row.Action || '') === action;
  })[0];
  if (comment && !existingHistory) patch.Notes = wfAppendNote_(request.Notes, actor.email, comment);
  wfUpdateRowLocked_(SHEETS.SERVICE_REQUEST, request._row, patch, actor.email);
  if (!existingHistory) {
    wfAppendRowLocked_(SHEETS.SERVICE_REQUEST_HISTORY, {
      HistoryID: generateId('SRH'),
      RequestID: request.RequestID,
      Action: action,
      StatusFrom: from,
      StatusTo: target,
      Comment: comment || '',
      ActorEmail: actor.email,
      ActorRole: actor.role,
      IsPublic: 'Yes'
    }, actor.email);
  }
  if (status === WF_INSTANCE_STATUS_.COMPLETED && typeof queueServiceRequestIntegrationLocked_ === 'function') {
    const catalog = wfFindRowLocked_(SHEETS.SERVICE_CATALOG, 'CatalogID', request.CatalogID, true);
    try {
      queueServiceRequestIntegrationLocked_(request, 'WORKFLOW_APPROVED', actor,
        wfServiceRequestIntegrationConfig_(request, catalog));
    } catch (integrationError) {
      const latestRequest = wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', request.RequestID, true);
      wfUpdateRowLocked_(SHEETS.SERVICE_REQUEST, latestRequest._row, {
        IntegrationStatus: 'ERROR',
        IntegrationError: sanitizeText(integrationError.message, 1000)
      }, actor.email);
      const queueErrorExists = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY, true).some(function (row) {
        return String(row.RequestID || '') === String(request.RequestID) &&
          String(row.Action || '') === 'INTEGRATION_QUEUE_ERROR';
      });
      if (!queueErrorExists) {
        wfAppendRowLocked_(SHEETS.SERVICE_REQUEST_HISTORY, {
          HistoryID: generateId('SRH'), RequestID: request.RequestID,
          Action: 'INTEGRATION_QUEUE_ERROR', StatusFrom: target, StatusTo: target,
          Comment: sanitizeText(integrationError.message, 1000), ActorEmail: actor.email,
          ActorRole: actor.role, IsPublic: 'No'
        }, actor.email);
      }
      wfAuditLocked_(actor, 'INTEGRATION_QUEUE_ERROR', SHEETS.SERVICE_REQUEST,
        request.RequestID, integrationError.message, 'error');
    }
  }
}

function wfServiceRequestIntegrationConfig_(request, catalog) {
  try {
    const snapshot = wfNormalizeJsonObject_(request && request.WorkflowJSON,
      'ServiceRequest.WorkflowJSON', {});
    if (snapshot.integration && typeof snapshot.integration === 'object' &&
      !Array.isArray(snapshot.integration)) return snapshot.integration;
  } catch (ignoreSnapshot) {}
  return null;
}

function wfUpdateSourceApproversLocked_(instance) {
  if (String(instance.ModuleKey) !== 'serviceCatalog') return;
  const request = wfFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', instance.RecordID, true);
  if (!request || String(request.Status) !== 'รออนุมัติ') return;
  const pending = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      String(row.Status) === WF_APPROVAL_STATUS_.PENDING;
  }).map(function (row) { return String(row.ApproverEmail || '').toLowerCase(); });
  wfUpdateRowLocked_(SHEETS.SERVICE_REQUEST, request._row, {
    WorkflowInstanceID: instance.InstanceID,
    Approver: wfUnique_(pending).join(',')
  }, 'workflow');
}

function wfAfterTransition_(outcome, actor) {
  if (!outcome) return;
  try {
    if (outcome.approvers && outcome.approvers.length) {
      outcome.approvers.forEach(function (email) {
        wfNotifyPrivate_(email, 'มี Workflow รอพิจารณาขั้นถัดไป',
          'Workflow ' + outcome.instanceId + ' รอการพิจารณา', 'workflow', outcome.instanceId);
      });
    }
    if (outcome.moduleKey === 'serviceCatalog') {
      const request = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', outcome.recordId);
      if (request && request.RequesterEmail && outcome.instanceStatus !== WF_INSTANCE_STATUS_.ACTIVE) {
        wfNotifyPrivate_(request.RequesterEmail, 'ผล Workflow คำขอบริการ ' + request.RequestID,
          'คำขอ ' + request.RequestID + ' สถานะ ' + outcome.instanceStatus,
          'serviceCatalog', request.RequestID);
      }
    }
  } catch (e) {
    console.error('wfAfterTransition_ notification error: ' + e.message);
  }
}

// ============================================================================
// Actor resolution, definition snapshot and conditions
// ============================================================================

function wfResolveDefinitionLocked_(definitionId, workflowCode, moduleKey) {
  const rows = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DEFINITION, true);
  const now = new Date();
  const active = rows.filter(function (row) {
    if (String(row.Status) !== 'ใช้งาน' || String(row.ModuleKey) !== String(moduleKey)) return false;
    if (row.ActiveFrom && wfTime_(row.ActiveFrom) > now.getTime()) return false;
    if (row.ActiveTo && wfTime_(row.ActiveTo) < now.getTime()) return false;
    return true;
  });
  if (definitionId) return active.filter(function (row) {
    return String(row.DefinitionID) === String(definitionId);
  })[0] || null;
  if (workflowCode) return active.filter(function (row) {
    return String(row.WorkflowCode || '').toUpperCase() === String(workflowCode).toUpperCase();
  }).sort(function (a, b) { return Number(b.Version || 0) - Number(a.Version || 0); })[0] || null;
  return active.filter(function (row) { return String(row.IsDefault) === 'Yes'; })
    .sort(function (a, b) {
      // If execution stops after the new definition row commits but before the
      // prior default flag is retired, the most recently committed definition
      // must win deterministically instead of comparing unrelated versions.
      return wfTime_(b.LastUpdatedAt || b.Timestamp) - wfTime_(a.LastUpdatedAt || a.Timestamp) ||
        Number(b.Version || 0) - Number(a.Version || 0) ||
        String(b.DefinitionID || '').localeCompare(String(a.DefinitionID || ''));
    })[0] || null;
}

function wfResolveStepActors_(step, instance, context) {
  const type = String(step.ApprovalType || '').toUpperCase();
  const value = String(step.ApproverValue || '').trim();
  let emails = [];
  if (type === 'USER') {
    emails = wfSplitEmails_(value);
  } else if (type === 'SUPERVISOR' || type === 'REQUESTER_SUPERVISOR') {
    const requester = wfActiveUser_(instance.RequesterEmail);
    if (requester && requester.Supervisor) emails = wfSplitEmails_(requester.Supervisor);
  } else if (type === 'ROLE') {
    const roles = value.split(/[,;|]/).map(function (v) { return v.trim(); }).filter(String);
    emails = wfActiveUsers_().filter(function (row) { return roles.indexOf(String(row.Role)) > -1; })
      .map(function (row) { return String(row.Email || '').toLowerCase(); });
  } else if (type === 'DEPARTMENT_APPROVER') {
    const department = value || String(instance.RequesterDepartment || '');
    emails = wfActiveUsers_().filter(function (row) {
      return String(row.Department || '') === department &&
        [ROLES.APPROVER, ROLES.IT_ADMIN].indexOf(String(row.Role)) > -1;
    }).map(function (row) { return String(row.Email || '').toLowerCase(); });
  } else if (type === 'GROUP') {
    emails = wfResolveApprovalGroupEmails_(value, new Date(), { includeBackups: false });
  } else if (type === 'CONTEXT') {
    const raw = context[value];
    emails = Array.isArray(raw) ? raw : wfSplitEmails_(raw);
  } else {
    throw new Error('ApprovalType ไม่ได้รับอนุญาต: ' + type);
  }
  const requester = String(instance.RequesterEmail || '').toLowerCase();
  const broadDynamicRoute = ['ROLE', 'DEPARTMENT_APPROVER', 'GROUP'].indexOf(type) > -1;
  const normalized = wfUnique_(emails.map(function (email) {
    return String(email || '').toLowerCase().trim();
  }).filter(String));
  // Explicit routes are validated fail-loud by wfPreflightStepActors_. Broad
  // dynamic routes can safely skip one revoked member and select a backup.
  if (!broadDynamicRoute) return normalized;
  return normalized.filter(function (email) {
      if (!isValidEmail(email) || email === requester) return false;
      const row = wfActiveUser_(email);
      if (!row) return false;
      return wfHasActionPermission_({
        email: email, role: row.Role, name: row.FullName || email,
        department: row.Department || ''
      }, 'workflow.approve');
    });
}

function wfResolveEscalationActor_(step, instance, approval) {
  const spec = String(step.EscalationApprover || '').trim();
  let emails = [];
  if (/^ROLE:/i.test(spec)) {
    const role = spec.replace(/^ROLE:/i, '').trim();
    emails = wfActiveUsers_().filter(function (row) { return String(row.Role) === role; })
      .map(function (row) { return String(row.Email || '').toLowerCase(); });
  } else if (/^GROUP:/i.test(spec)) {
    emails = wfResolveApprovalGroupEmails_(spec.replace(/^GROUP:/i, '').trim(), new Date(), { includeBackups: true });
  } else if (isValidEmail(spec)) {
    emails = [spec.toLowerCase()];
  } else {
    emails = wfActiveUsers_().filter(function (row) { return String(row.Role) === ROLES.IT_ADMIN; })
      .map(function (row) { return String(row.Email || '').toLowerCase(); });
  }
  const requester = String(instance.RequesterEmail || '').toLowerCase();
  const current = String(approval.ApproverEmail || '').toLowerCase();
  const peerApprovers = {};
  readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL, true).forEach(function (row) {
    if (String(row.InstanceID) !== String(approval.InstanceID) ||
        String(row.StepID) !== String(approval.StepID) ||
        String(row.ApprovalID) === String(approval.ApprovalID)) return;
    if ([WF_APPROVAL_STATUS_.CANCELLED, WF_APPROVAL_STATUS_.SUPERSEDED]
        .indexOf(String(row.Status || '')) > -1) return;
    peerApprovers[String(row.ApproverEmail || '').toLowerCase()] = true;
  });
  return wfUnique_(emails).filter(function (email) {
    if (email === requester || email === current || peerApprovers[email]) return false;
    const row = wfActiveUser_(email);
    return !!row && wfHasActionPermission_({
      email: email, role: row.Role, name: row.FullName || email,
      department: row.Department || ''
    }, 'workflow.approve');
  })[0] || '';
}

function wfEffectiveDelegate_(email, instance, step) {
  const now = Date.now();
  const rows = readSheetObjectsEnsured_(SHEETS.WORKFLOW_DELEGATION, true).filter(function (row) {
    if (String(row.Status || '') !== 'Active') return false;
    if (String(row.DelegatorEmail || '').toLowerCase() !== String(email).toLowerCase()) return false;
    if (String(row.ModuleKey || '*') !== '*' && String(row.ModuleKey) !== String(instance.ModuleKey)) return false;
    if (row.DefinitionID && String(row.DefinitionID) !== String(instance.DefinitionID)) return false;
    const start = wfTime_(row.StartAt), end = wfTime_(row.EndAt);
    return start && end && start <= now && end >= now;
  }).sort(function (a, b) { return wfTime_(b.Timestamp) - wfTime_(a.Timestamp); });
  if (!rows.length) return '';
  const delegate = String(rows[0].DelegateEmail || '').toLowerCase();
  if (!wfActiveUser_(delegate) || delegate === String(instance.RequesterEmail || '').toLowerCase()) return '';
  return delegate;
}

function wfDelegationWouldCycle_(approval, delegateEmail) {
  const original = String(approval.OriginalApproverEmail || approval.ApproverEmail || '').toLowerCase();
  if (delegateEmail === original) return true;
  const notes = String(approval.Notes || '').toLowerCase();
  return notes.indexOf('delegate to ' + delegateEmail.toLowerCase() + ':') > -1;
}

function wfDefinitionSnapshot_(row) {
  return {
    DefinitionID: String(row.DefinitionID || ''),
    WorkflowCode: String(row.WorkflowCode || ''),
    WorkflowName: String(row.WorkflowName || ''),
    ModuleKey: String(row.ModuleKey || ''),
    Version: Number(row.Version || 1),
    Mode: String(row.Mode || 'SEQUENTIAL'),
    SLAHours: Number(row.SLAHours || 24),
    ReminderHours: Number(row.ReminderHours || 4),
    EscalationHours: Number(row.EscalationHours || 8),
    EscalationRole: String(row.EscalationRole || '')
  };
}

function wfStepSnapshot_(row) {
  return {
    StepID: String(row.StepID || ''),
    DefinitionVersion: Number(row.DefinitionVersion || 1),
    StepOrder: Number(row.StepOrder || 0),
    StepCode: String(row.StepCode || ''),
    StepName: String(row.StepName || ''),
    ApprovalType: String(row.ApprovalType || ''),
    ApproverValue: String(row.ApproverValue || ''),
    Mode: String(row.Mode || 'ANY'),
    MinApprovals: Number(row.MinApprovals || 1),
    ConditionJSON: String(row.ConditionJSON || '{}'),
    SLAHours: Number(row.SLAHours || 24),
    ReminderHours: Number(row.ReminderHours || 4),
    EscalationHours: Number(row.EscalationHours || 8),
    EscalationApprover: String(row.EscalationApprover || ''),
    AllowDelegation: String(row.AllowDelegation || 'Yes'),
    AllowReturn: String(row.AllowReturn || 'No'),
    Notes: String(row.Notes || '')
  };
}

function wfInstanceSnapshot_(instance) {
  const context = wfInstanceContext_(instance);
  const snapshot = context.__workflowSnapshot;
  if (!snapshot || !snapshot.definition || !Array.isArray(snapshot.steps)) {
    throw new Error('Workflow instance snapshot ไม่สมบูรณ์');
  }
  return snapshot;
}

function wfInstanceContext_(instance) {
  return wfNormalizeJsonObject_(instance.ContextJSON, 'WorkflowInstances.ContextJSON', {});
}

function wfSnapshotStep_(instance, stepId, stepOrder) {
  const steps = wfInstanceSnapshot_(instance).steps;
  const found = steps.filter(function (step) {
    return (stepId && String(step.StepID) === String(stepId)) ||
      (!stepId && Number(step.StepOrder) === Number(stepOrder));
  })[0];
  if (!found) throw new Error('ไม่พบ step snapshot ของรายการอนุมัติ');
  return found;
}

function wfNextEligibleStep_(steps, afterOrder, context) {
  return (steps || []).filter(function (step) {
    if (Number(step.StepOrder || 0) <= Number(afterOrder || 0)) return false;
    const condition = wfNormalizeJsonObject_(step.ConditionJSON, 'WorkflowStep.ConditionJSON', {});
    return wfConditionMatches_(condition, context);
  }).sort(function (a, b) { return Number(a.StepOrder) - Number(b.StepOrder); })[0] || null;
}

function wfConditionMatches_(condition, context) {
  condition = condition || {};
  context = context || {};
  if (!Object.keys(condition).length) return true;
  if (Array.isArray(condition.all)) return condition.all.every(function (item) {
    return wfConditionMatches_(item, context);
  });
  if (Array.isArray(condition.any)) return condition.any.some(function (item) {
    return wfConditionMatches_(item, context);
  });
  if (condition.not) return !wfConditionMatches_(condition.not, context);
  const field = String(condition.field || '');
  const op = String(condition.operator || condition.op || 'eq').toLowerCase();
  const actual = wfContextValue_(context, field);
  const expected = condition.value;
  if (op === 'exists') return actual !== undefined && actual !== null && actual !== '';
  if (op === 'eq') return String(actual) === String(expected);
  if (op === 'neq') return String(actual) !== String(expected);
  if (op === 'in') return (Array.isArray(expected) ? expected : [expected]).map(String).indexOf(String(actual)) > -1;
  if (op === 'notin') return (Array.isArray(expected) ? expected : [expected]).map(String).indexOf(String(actual)) === -1;
  if (op === 'contains') return String(actual || '').toLowerCase().indexOf(String(expected || '').toLowerCase()) > -1;
  if (op === 'gte') return Number(actual) >= Number(expected);
  if (op === 'lte') return Number(actual) <= Number(expected);
  throw new Error('Condition operator ไม่ได้รับอนุญาต: ' + op);
}

function wfAssertCondition_(condition, label, depth) {
  depth = depth || 0;
  if (depth > 8) throw new Error(label + ' ซ้อนลึกเกินไป');
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new Error(label + ' ต้องเป็น object');
  }
  if (!Object.keys(condition).length) return;
  if (condition.all !== undefined || condition.any !== undefined) {
    ['all', 'any'].forEach(function (key) {
      if (condition[key] === undefined) return;
      if (!Array.isArray(condition[key]) || !condition[key].length || condition[key].length > 20) {
        throw new Error(label + '.' + key + ' ต้องเป็น array 1-20 รายการ');
      }
      condition[key].forEach(function (item, index) { wfAssertCondition_(item, label + '.' + key + '[' + index + ']', depth + 1); });
    });
    return;
  }
  if (condition.not !== undefined) {
    wfAssertCondition_(condition.not, label + '.not', depth + 1);
    return;
  }
  if (!/^[A-Za-z][A-Za-z0-9_.]{0,119}$/.test(String(condition.field || ''))) {
    throw new Error(label + '.field ไม่ถูกต้อง');
  }
  const op = String(condition.operator || condition.op || 'eq').toLowerCase();
  if (['exists', 'eq', 'neq', 'in', 'notin', 'contains', 'gte', 'lte'].indexOf(op) === -1) {
    throw new Error(label + '.operator ไม่ได้รับอนุญาต');
  }
}

function wfContextValue_(context, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let value = context;
  for (let i = 0; i < parts.length; i++) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, parts[i])) return undefined;
    value = value[parts[i]];
  }
  return value;
}

// ============================================================================
// Validation and serialization helpers
// ============================================================================

function wfNormalizeSteps_(raw) {
  let rows = raw;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows || '[]'); } catch (e) { throw new Error('Steps JSON ไม่ถูกต้อง'); }
  }
  if (!Array.isArray(rows) || rows.length > 50) throw new Error('Steps ต้องเป็น array ไม่เกิน 50 รายการ');
  const orders = {};
  return rows.map(function (item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Step ลำดับ ' + (index + 1) + ' ไม่ถูกต้อง');
    wfAssertSafeJson_(item, 'Step ลำดับ ' + (index + 1), 0, { count: 0 });
    const order = parseInt(item.stepOrder !== undefined ? item.stepOrder :
      (item.order !== undefined ? item.order : item.sequence), 10) || index + 1;
    if (order < 1 || order > 999 || orders[order]) throw new Error('StepOrder ต้องไม่ซ้ำและอยู่ระหว่าง 1-999');
    orders[order] = true;
    const code = String(sanitizeText(item.stepCode || item.code || ('STEP_' + order), 80)).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(code)) throw new Error('StepCode ลำดับ ' + order + ' ไม่ถูกต้อง');
    const name = sanitizeText(item.stepName || item.name, 200);
    if (!name) throw new Error('กรุณาระบุ StepName ลำดับ ' + order);
    const type = String(sanitizeText(item.approvalType || item.assigneeType, 40)).toUpperCase();
    if (WF_APPROVAL_TYPES_.indexOf(type) === -1) throw new Error('ApprovalType ลำดับ ' + order + ' ไม่ถูกต้อง');
    const value = sanitizeText(item.approverValue !== undefined ? item.approverValue : item.assigneeValue, 1000);
    if (type !== 'SUPERVISOR' && type !== 'REQUESTER_SUPERVISOR' && type !== 'DEPARTMENT_APPROVER' && !value) {
      throw new Error('กรุณาระบุ ApproverValue ลำดับ ' + order);
    }
    const mode = String(sanitizeText(item.mode || item.decisionMode, 30) || 'ANY').toUpperCase();
    if (WF_STEP_MODES_.indexOf(mode) === -1) throw new Error('Mode ลำดับ ' + order + ' ไม่ถูกต้อง');
    const condition = wfNormalizeJsonObject_(item.condition !== undefined ? item.condition : item.conditionJSON,
      'Step Condition ลำดับ ' + order, {});
    wfAssertCondition_(condition, 'Step Condition ลำดับ ' + order);
    return {
      StepOrder: order,
      StepCode: code,
      StepName: name,
      ApprovalType: type,
      ApproverValue: value,
      Mode: mode,
      MinApprovals: wfNumber_(item.minApprovals || item.quorumCount, 1, 100, 1),
      ConditionJSON: JSON.stringify(condition),
      SLAHours: wfNumber_(item.slaHours || item.dueHours, 1, 2160, 24),
      ReminderHours: wfNumber_(item.reminderHours || item.reminderAfterHours, 0, 2160, 4),
      EscalationHours: wfNumber_(item.escalationHours || item.escalationAfterHours, 0, 2160, 8),
      EscalationApprover: sanitizeText(item.escalationApprover || item.escalateTo, 300),
      AllowDelegation: wfYesNo_(item.allowDelegation === undefined ? true : item.allowDelegation),
      AllowReturn: wfYesNo_(item.allowReturn),
      Notes: sanitizeText(item.notes, 1500)
    };
  }).sort(function (a, b) { return a.StepOrder - b.StepOrder; });
}

function wfNormalizeJsonObject_(raw, label, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback || {};
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (e) { throw new Error(label + ' เป็น JSON ไม่ถูกต้อง'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' ต้องเป็น object');
  wfAssertSafeJson_(value, label, 0, { count: 0 });
  return value;
}

function wfAssertSafeJson_(value, label, depth, state) {
  depth = depth || 0;
  state = state || { count: 0 };
  if (depth > 12) throw new Error(label + ' ซ้อนลึกเกินไป');
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length > 10000) throw new Error(label + ' มีข้อความยาวเกินไป');
    return;
  }
  if (typeof value !== 'object') return;
  const keys = Object.keys(value);
  state.count += keys.length;
  if (state.count > 1000) throw new Error(label + ' มีโครงสร้างใหญ่เกินไป');
  keys.forEach(function (key) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(label + ' มี key ที่ไม่อนุญาต: ' + key);
    }
    wfAssertSafeJson_(value[key], label + '.' + key, depth + 1, state);
  });
}

function wfParseOptionalDate_(value, label, endOfDay) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = value instanceof Date ? '' : String(value).trim();
  let date;
  if (value instanceof Date) date = new Date(value.getTime());
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!m) throw new Error(label + ' ต้องเป็น yyyy-MM-dd หรือ yyyy-MM-ddTHH:mm:ss');
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const h = m[4] === undefined ? (endOfDay ? 23 : 0) : Number(m[4]);
    const mi = m[5] === undefined ? (endOfDay ? 59 : 0) : Number(m[5]);
    const s = m[6] === undefined ? (endOfDay ? 59 : 0) : Number(m[6]);
    date = new Date(y, mo - 1, d, h, mi, s, 0);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d ||
      date.getHours() !== h || date.getMinutes() !== mi || date.getSeconds() !== s) {
      throw new Error(label + ' ไม่ใช่วันที่จริง');
    }
  }
  if (isNaN(date.getTime())) throw new Error(label + ' ไม่ถูกต้อง');
  return date;
}

function wfParseRequiredDateTime_(value, label) {
  const date = wfParseOptionalDate_(value, label, false);
  if (!date) throw new Error('กรุณาระบุ ' + label);
  return date;
}

function wfNumber_(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function wfIsYes_(value) {
  return value === true || ['yes', 'true', '1', 'ใช่', 'active'].indexOf(String(value || '').toLowerCase().trim()) > -1;
}

function wfYesNo_(value) { return wfIsYes_(value) ? 'Yes' : 'No'; }

function wfNormalizeIdList_(raw, max) {
  let rows = raw;
  if (rows === undefined || rows === null || rows === '') return [];
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch (e) { rows = rows.split(/[,;\s]+/); }
  }
  if (!Array.isArray(rows) || rows.length > (max || 20)) throw new Error('รายการ AttachmentID ไม่ถูกต้อง');
  return wfUnique_(rows.map(function (id) { return sanitizeText(id, 120); }).filter(function (id) {
    return /^[A-Za-z0-9_-]{5,120}$/.test(id);
  }));
}

function wfSplitEmails_(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[,;|\s]+/).map(function (v) { return v.trim().toLowerCase(); }).filter(String);
}

function wfUnique_(values) {
  const seen = {};
  return (values || []).filter(function (value) {
    value = String(value || '');
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function wfRangesOverlap_(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function wfDecisionSignature_(approval, instance, user, decision, comment) {
  const payload = [approval.ApprovalID, instance.InstanceID, instance.RecordID, user.email,
    decision, comment, new Date().toISOString(), Utilities.getUuid()].join('|');
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    payload, Utilities.Charset.UTF_8));
}

function wfAppendNote_(existing, actorEmail, note) {
  note = sanitizeText(note, 2000);
  if (!note) return String(existing || '');
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  return (String(existing || '') ? String(existing) + '\n' : '') + '[' + stamp + ' ' +
    String(actorEmail || 'system') + '] ' + note;
}

// ============================================================================
// Authorization and DTOs
// ============================================================================

function wfCanActApproval_(approval, instance, user, requirePermission) {
  if (!approval || !instance || !user) return false;
  if (String(approval.Status) !== WF_APPROVAL_STATUS_.PENDING ||
    String(instance.Status) !== WF_INSTANCE_STATUS_.ACTIVE) return false;
  if (String(approval.ApproverEmail || '').toLowerCase() !== String(user.email || '').toLowerCase()) return false;
  if (String(instance.RequesterEmail || '').toLowerCase() === String(user.email || '').toLowerCase()) return false;
  return requirePermission === false ? wfHasActionPermission_(user, 'workflow.approve') :
    wfHasActionPermission_(user, 'workflow.approve');
}

function wfCanViewInstance_(instance, approvals, user) {
  if (!instance || !user) return false;
  if (wfHasActionPermission_(user, 'workflow.view_all')) return true;
  const email = String(user.email || '').toLowerCase();
  if (String(instance.RequesterEmail || '').toLowerCase() === email &&
    wfHasActionPermission_(user, 'workflow.view_own')) return true;
  const assigned = (approvals || []).some(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) &&
      (String(row.ApproverEmail || '').toLowerCase() === email ||
       String(row.OriginalApproverEmail || '').toLowerCase() === email);
  });
  if (assigned && wfHasActionPermission_(user, 'workflow.view_assigned')) return true;
  return false;
}

function wfCanViewSourceRecord_(instance, user) {
  try {
    const moduleKey = String(instance.ModuleKey || '');
    const id = String(instance.RecordID || '');
    if (!canAccessModule(user.role, moduleKey)) return false;
    if (moduleKey === 'serviceCatalog') {
      const row = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', id);
      if (!row) return false;
      const approvers = String(row.Approver || '').split(/[;,]/).map(function (value) {
        return value.trim().toLowerCase();
      });
      return user.role === ROLES.IT_ADMIN ||
        String(row.RequesterEmail || '').toLowerCase() === user.email ||
        String(row.Assignee || '').toLowerCase() === user.email ||
        approvers.indexOf(user.email) > -1;
    }
    if (moduleKey === 'access') {
      const row = findRowEnsured_(SHEETS.ACCESS_REQ, 'ReqID', id);
      return !!(row && (user.role === ROLES.IT_ADMIN ||
        String(row.RequesterEmail || '').toLowerCase() === user.email ||
        String(row.Approver || '').toLowerCase() === user.email));
    }
    if (moduleKey === 'change') {
      const row = findRowEnsured_(SHEETS.CHANGE, 'ChangeID', id);
      return !!(row && (user.role === ROLES.IT_ADMIN || user.role === ROLES.APPROVER ||
        String(row.Requester || '').toLowerCase() === user.email));
    }
    if (moduleKey === 'ticket') {
      const row = findRowEnsured_(SHEETS.TICKET, 'TicketID', id);
      return !!(row && (user.role === ROLES.IT_ADMIN ||
        String(row.RequesterEmail || '').toLowerCase() === user.email ||
        String(row.Assignee || '').toLowerCase() === user.email));
    }
    if (moduleKey === 'privacy') return user.role === ROLES.DPO || user.role === ROLES.IT_ADMIN;
  } catch (e) {}
  return false;
}

/** Build source-record visibility with at most one sheet read per module. */
function wfBuildSourceVisibilityIndex_(instances, user) {
  const wanted = {};
  (instances || []).forEach(function (instance) {
    const moduleKey = String(instance.ModuleKey || '');
    const recordId = String(instance.RecordID || '');
    if (moduleKey && recordId && canAccessModule(user.role, moduleKey)) {
      if (!wanted[moduleKey]) wanted[moduleKey] = {};
      wanted[moduleKey][recordId] = true;
    }
  });
  const visible = {};
  const mark = function (moduleKey, recordId) {
    if (wanted[moduleKey] && wanted[moduleKey][String(recordId || '')]) {
      visible[moduleKey + '|' + String(recordId || '')] = true;
    }
  };
  if (wanted.serviceCatalog) {
    readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST, true).forEach(function (row) {
      const approvers = String(row.Approver || '').split(/[;,]/).map(function (value) {
        return value.trim().toLowerCase();
      });
      if (user.role === ROLES.IT_ADMIN ||
          String(row.RequesterEmail || '').toLowerCase() === user.email ||
          String(row.Assignee || '').toLowerCase() === user.email || approvers.indexOf(user.email) > -1) {
        mark('serviceCatalog', row.RequestID);
      }
    });
  }
  if (wanted.access) {
    readSheetObjectsEnsured_(SHEETS.ACCESS_REQ, true).forEach(function (row) {
      if (user.role === ROLES.IT_ADMIN ||
          String(row.RequesterEmail || '').toLowerCase() === user.email ||
          String(row.Approver || '').toLowerCase() === user.email) mark('access', row.ReqID);
    });
  }
  if (wanted.change) {
    readSheetObjectsEnsured_(SHEETS.CHANGE, true).forEach(function (row) {
      if (user.role === ROLES.IT_ADMIN || user.role === ROLES.APPROVER ||
          String(row.Requester || '').toLowerCase() === user.email) mark('change', row.ChangeID);
    });
  }
  if (wanted.ticket) {
    readSheetObjectsEnsured_(SHEETS.TICKET, true).forEach(function (row) {
      if (user.role === ROLES.IT_ADMIN ||
          String(row.RequesterEmail || '').toLowerCase() === user.email ||
          String(row.Assignee || '').toLowerCase() === user.email) mark('ticket', row.TicketID);
    });
  }
  if (wanted.privacy && (user.role === ROLES.DPO || user.role === ROLES.IT_ADMIN)) {
    Object.keys(wanted.privacy).forEach(function (id) { mark('privacy', id); });
  }
  return visible;
}

function wfInstanceActions_(instance, approvals, user) {
  const pending = (approvals || []).filter(function (row) {
    return String(row.InstanceID) === String(instance.InstanceID) && wfCanActApproval_(row, instance, user, false);
  });
  const own = String(instance.RequesterEmail || '').toLowerCase() === user.email;
  return {
    approvalIds: pending.map(function (row) { return row.ApprovalID; }),
    canApprove: pending.length > 0,
    canDelegate: pending.length > 0 && wfHasActionPermission_(user, 'workflow.delegate'),
    canCancel: String(instance.Status) === WF_INSTANCE_STATUS_.ACTIVE &&
      ((own && wfHasActionPermission_(user, 'workflow.cancel_own')) || wfHasActionPermission_(user, 'workflow.manage')),
    canUpload: String(instance.Status) === WF_INSTANCE_STATUS_.ACTIVE && wfHasActionPermission_(user, 'attachment.upload')
  };
}

function wfDefinitionDto_(row, internal, stepsByDefinition) {
  const dto = {
    id: row.DefinitionID,
    code: row.WorkflowCode,
    name: row.WorkflowName,
    moduleKey: row.ModuleKey,
    description: row.Description,
    version: Number(row.Version || 1),
    mode: row.Mode,
    slaHours: Number(row.SLAHours || 0),
    isDefault: wfIsYes_(row.IsDefault),
    status: row.Status,
    activeFrom: row.ActiveFrom ? safeFmtDateTime_(row.ActiveFrom) : '',
    activeTo: row.ActiveTo ? safeFmtDateTime_(row.ActiveTo) : ''
  };
  if (internal) {
    dto.triggerEvent = row.TriggerEvent;
    dto.conditions = wfNormalizeJsonObject_(row.ConditionsJSON, 'ConditionsJSON', {});
    dto.reminderHours = Number(row.ReminderHours || 0);
    dto.escalationHours = Number(row.EscalationHours || 0);
    dto.escalationRole = row.EscalationRole;
    dto.revision = Number(row.Revision || 0);
    dto.notes = row.Notes;
    const stepRows = wfSelectCommittedDefinitionSteps_(
      (stepsByDefinition && stepsByDefinition[String(row.DefinitionID)] ?
      stepsByDefinition[String(row.DefinitionID)].slice() :
      readSheetObjectsEnsured_(SHEETS.WORKFLOW_STEP, true).filter(function (step) {
        return String(step.DefinitionID) === String(row.DefinitionID) && String(step.Status) === 'ใช้งาน';
      })), row);
    dto.steps = stepRows.sort(function (a, b) {
      return Number(a.StepOrder) - Number(b.StepOrder);
    }).map(wfStepSnapshot_);
  }
  return dto;
}

/**
 * Return true only for an explicitly versioned row in the committed generation.
 */
function wfStepMatchesDefinitionVersion_(step, definition) {
  const committedVersion = Math.max(1, parseInt(definition && definition.Version, 10) || 1);
  const raw = String(step && step.DefinitionVersion || '').trim();
  return !!raw && Number(raw) === committedVersion;
}

/**
 * Prefer the exact immutable generation. A blank-version fallback is used only
 * when no active exact generation exists, preserving early/legacy P3 data while
 * ensuring staged vNext rows can never union with the prior generation.
 */
function wfSelectCommittedDefinitionSteps_(rows, definition) {
  const definitionId = String(definition && definition.DefinitionID || '');
  const active = (rows || []).filter(function (step) {
    return String(step.DefinitionID || '') === definitionId && String(step.Status || '') === 'ใช้งาน';
  });
  const exact = active.filter(function (step) {
    return wfStepMatchesDefinitionVersion_(step, definition);
  });
  if (exact.length) return exact;
  return active.filter(function (step) {
    return !String(step.DefinitionVersion || '').trim();
  });
}

function wfInstanceDto_(row, approvals, user, detailed) {
  const instanceApprovals = (approvals || []).filter(function (approval) {
    return String(approval.InstanceID) === String(row.InstanceID);
  });
  const dto = {
    id: row.InstanceID,
    definitionId: row.DefinitionID,
    definitionVersion: Number(row.DefinitionVersion || 1),
    moduleKey: row.ModuleKey,
    recordId: row.RecordID,
    recordLabel: row.RecordLabel,
    requesterEmail: row.RequesterEmail,
    requesterDepartment: row.RequesterDepartment,
    currentStepOrder: Number(row.CurrentStepOrder || 0),
    status: row.Status,
    startedAt: safeFmtDateTime_(row.StartedAt || row.Timestamp),
    dueAt: safeFmtDateTime_(row.DueAt),
    completedAt: safeFmtDateTime_(row.CompletedAt),
    overdue: String(row.Status) === WF_INSTANCE_STATUS_.ACTIVE && !!wfTime_(row.DueAt) && wfTime_(row.DueAt) < Date.now(),
    pendingCount: instanceApprovals.filter(function (a) { return String(a.Status) === WF_APPROVAL_STATUS_.PENDING; }).length,
    allowedActions: wfInstanceActions_(row, instanceApprovals, user)
  };
  if (detailed) {
    dto.context = wfRedactContext_(wfInstanceContext_(row), user, row);
    dto.result = wfNormalizeJsonObject_(row.ResultJSON, 'ResultJSON', {});
    dto.notes = wfHasActionPermission_(user, 'workflow.view_all') ? row.Notes : '';
  }
  return dto;
}

function wfApprovalDto_(row, instance, user, detailed) {
  const canAct = wfCanActApproval_(row, instance, user, false);
  const dto = {
    id: row.ApprovalID,
    instanceId: row.InstanceID,
    recordId: instance && instance.RecordID || '',
    recordLabel: instance && instance.RecordLabel || '',
    moduleKey: instance && instance.ModuleKey || '',
    stepOrder: Number(row.StepOrder || 0),
    approverEmail: row.ApproverEmail,
    status: row.Status,
    decision: row.Decision,
    dueAt: safeFmtDateTime_(row.DueAt),
    overdue: String(row.Status) === WF_APPROVAL_STATUS_.PENDING && !!wfTime_(row.DueAt) && wfTime_(row.DueAt) < Date.now(),
    canApprove: canAct,
    canDelegate: canAct && wfHasActionPermission_(user, 'workflow.delegate')
  };
  if (detailed || canAct || wfHasActionPermission_(user, 'workflow.view_all')) {
    dto.originalApproverEmail = row.OriginalApproverEmail;
    dto.approverRole = row.ApproverRole;
    dto.approvalGroup = row.ApprovalGroup;
    dto.comment = row.Comment;
    dto.decidedAt = safeFmtDateTime_(row.DecidedAt);
    dto.decisionBy = row.DecisionBy;
    dto.delegatedAt = safeFmtDateTime_(row.DelegatedAt);
    dto.escalatedAt = safeFmtDateTime_(row.EscalatedAt);
    dto.attachmentIds = wfNormalizeIdList_(row.AttachmentIDsJSON, 20);
  }
  return dto;
}

function wfHistoryDto_(row, user) {
  const internal = String(row.IsPublic || '').toLowerCase() !== 'yes';
  const canInternal = wfHasActionPermission_(user, 'workflow.view_all') ||
    String(row.ActorEmail || '').toLowerCase() === user.email;
  return {
    id: row.HistoryID,
    approvalId: row.ApprovalID,
    action: row.Action,
    stepOrder: Number(row.StepOrder || 0),
    statusFrom: row.StatusFrom,
    statusTo: row.StatusTo,
    actorEmail: internal && !canInternal ? '' : row.ActorEmail,
    actorRole: internal && !canInternal ? '' : row.ActorRole,
    comment: internal && !canInternal ? 'รายละเอียดภายใน' : row.Comment,
    detail: internal && !canInternal ? {} : wfNormalizeJsonObject_(row.DetailJSON, 'DetailJSON', {}),
    isPublic: !internal,
    actionAt: safeFmtDateTime_(row.ActionAt || row.Timestamp)
  };
}

function wfDelegationDto_(row) {
  return {
    id: row.DelegationID,
    delegatorEmail: row.DelegatorEmail,
    delegateEmail: row.DelegateEmail,
    moduleKey: row.ModuleKey,
    definitionId: row.DefinitionID,
    startAt: safeFmtDateTime_(row.StartAt),
    endAt: safeFmtDateTime_(row.EndAt),
    reason: row.Reason,
    status: row.Status,
    revokedAt: safeFmtDateTime_(row.RevokedAt),
    revokedBy: row.RevokedBy
  };
}

function wfRedactContext_(context, user, instance) {
  const copy = JSON.parse(JSON.stringify(context || {}));
  delete copy.__workflowSnapshot;
  if (!wfHasActionPermission_(user, 'workflow.view_all') &&
      String(instance.RequesterEmail || '').toLowerCase() !== user.email) {
    ['businessJustification', 'personalData', 'contact', 'phone'].forEach(function (key) { delete copy[key]; });
  }
  return copy;
}

// ============================================================================
// Storage, users, audit and notification helpers
// ============================================================================

function wfEnsureSheets_() {
  [SHEETS.WORKFLOW_DEFINITION, SHEETS.WORKFLOW_STEP, SHEETS.WORKFLOW_INSTANCE,
    SHEETS.WORKFLOW_APPROVAL, SHEETS.WORKFLOW_HISTORY, SHEETS.WORKFLOW_DELEGATION,
    SHEETS.ACTION_PERMISSION, SHEETS.ROLE_ACTION_PERMISSION, SHEETS.USER_PERMISSION_OVERRIDE,
    SHEETS.APPROVAL_GROUP, SHEETS.APPROVAL_GROUP_MEMBER,
    SHEETS.RECORD_LINK, SHEETS.INTEGRATION_OUTBOX].forEach(function (name) {
      ensureSheetBySchema_(name);
    });
}

function wfWithScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function wfHeadersLocked_(sheetName) {
  const sh = getSheet_(sheetName);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function wfAppendRowLocked_(sheetName, data, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = wfHeadersLocked_(sheetName);
  const now = new Date();
  const merged = Object.assign({}, data || {});
  if (headers.indexOf('Timestamp') > -1 && !merged.Timestamp) merged.Timestamp = now;
  if (headers.indexOf('CreatedBy') > -1 && !merged.CreatedBy) merged.CreatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedBy') > -1) merged.LastUpdatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedAt') > -1) merged.LastUpdatedAt = now;
  sh.appendRow(headers.map(function (header) {
    return sheetSafeValue_(Object.prototype.hasOwnProperty.call(merged, header) ? merged[header] : '');
  }));
  return sh.getLastRow();
}

function wfUpdateRowLocked_(sheetName, rowNumber, patch, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = wfHeadersLocked_(sheetName);
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const current = range.getValues()[0];
  const now = new Date();
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, header)) current[index] = sheetSafeValue_(patch[header]);
    if (header === 'LastUpdatedBy') current[index] = actorEmail || '';
    if (header === 'LastUpdatedAt') current[index] = now;
  });
  range.setValues([current]);
  return true;
}

function wfFindRowLocked_(sheetName, keyColumn, keyValue, includeDeleted) {
  const rows = readSheetObjectsEnsured_(sheetName, includeDeleted === true);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][keyColumn]) === String(keyValue)) return rows[i];
  }
  return null;
}

function wfWriteHistoryLocked_(instance, approval, action, from, to, actor, comment, detail, isPublic) {
  const approvalId = approval && approval.ApprovalID || '';
  const idempotentActions = ['START', 'APPROVE', 'REJECT', 'RETURN', 'ADVANCE',
    'COMPLETE', 'CANCEL', 'ERROR', 'REPAIR'];
  if (idempotentActions.indexOf(String(action || '')) > -1) {
    const existing = readSheetObjectsEnsured_(SHEETS.WORKFLOW_HISTORY, true).filter(function (row) {
      return String(row.InstanceID || '') === String(instance.InstanceID || '') &&
        String(row.ApprovalID || '') === String(approvalId) &&
        String(row.Action || '') === String(action || '') &&
        String(row.StatusFrom || '') === String(from || '') &&
        String(row.StatusTo || '') === String(to || '');
    })[0];
    if (existing) return existing.HistoryID;
  }
  const historyId = generateId('WFH');
  wfAppendRowLocked_(SHEETS.WORKFLOW_HISTORY, {
    HistoryID: historyId,
    InstanceID: instance.InstanceID,
    ApprovalID: approvalId,
    Action: action,
    StepOrder: approval && approval.StepOrder || instance.CurrentStepOrder || '',
    StatusFrom: from || '',
    StatusTo: to || '',
    ActorEmail: actor && actor.email || 'system',
    ActorRole: actor && actor.role || '',
    Comment: sanitizeText(comment, 2000),
    DetailJSON: JSON.stringify(detail || {}),
    IsPublic: isPublic ? 'Yes' : 'No',
    ActionAt: new Date()
  }, actor && actor.email || 'system');
  return historyId;
}

function wfAuditLocked_(actor, action, targetSheet, targetId, detail, result) {
  const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
  if (!sh || sh.getLastColumn() < 1) throw new Error('AuditTrail sheet is missing');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  ['LogID', 'Timestamp', 'ActorEmail', 'Action', 'Module', 'TargetSheet', 'TargetID', 'Result']
    .forEach(function (required) {
      if (headers.indexOf(required) === -1) throw new Error('AuditTrail header is missing: ' + required);
    });
  const logId = generateId('LOG');
  const row = {
    LogID: logId,
    Timestamp: new Date(),
    ActorEmail: actor && actor.email || actor || '',
    ActorRole: actor && actor.role || '',
    Action: action || '',
    Module: 'workflow',
    TargetSheet: targetSheet || '',
    TargetID: targetId || '',
    Detail: detail || '',
    IPHint: '',
    Result: result || 'success'
  };
  sh.appendRow(headers.map(function (header) {
    return sheetSafeValue_(row[header] === undefined || row[header] === null ? '' : row[header]);
  }));
  const logIdColumn = headers.indexOf('LogID') + 1;
  if (String(sh.getRange(sh.getLastRow(), logIdColumn).getValue() || '') !== logId) {
    throw new Error('Workflow audit write could not be verified');
  }
  return logId;
}

function wfAssertAuditReadyLocked_() {
  const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
  if (!sh || sh.getLastColumn() < 1) throw new Error('AuditTrail sheet is missing');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  ['LogID', 'Timestamp', 'ActorEmail', 'Action', 'Module', 'TargetSheet', 'TargetID', 'Result']
    .forEach(function (required) {
      if (headers.indexOf(required) === -1) throw new Error('AuditTrail header is missing: ' + required);
    });
  return true;
}

function wfReauthorizeMutationActorLocked_(actor, permissionKey, requiredRole) {
  const actorObj = wfActor_(actor, 'system');
  wfAssertAuditReadyLocked_();
  if (actorObj.email === 'system') return actorObj;
  if (typeof apResetRuntimeReadCache_ === 'function') apResetRuntimeReadCache_();
  const row = wfActiveUser_(actorObj.email);
  if (!row) throw new Error('บัญชีผู้ดำเนินการไม่อยู่ในสถานะ Active');
  const fresh = {
    email: actorObj.email,
    name: row.FullName || actorObj.name || actorObj.email,
    role: row.Role,
    dept: row.Department || '',
    _requiredRole: String(requiredRole || actorObj._requiredRole || '')
  };
  if (fresh._requiredRole && fresh.role !== fresh._requiredRole) {
    throw new Error('เธเธ—เธเธฒเธ—เธเธนเนเธ”เธณเน€เธเธดเธเธเธฒเธฃเนเธกเนเธ•เธฃเธเธเธฑเธเธเนเธญเธเธณเธซเธเธ”เธเธญเธ API');
  }
  wfRequireActionPermission_(fresh, permissionKey);
  return fresh;
}

function wfAuditSafe_(actor, action, targetSheet, targetId, detail, result) {
  try { writeAudit_(actor, action, 'workflow', targetSheet, targetId, detail, result); }
  catch (e) { console.error('wfAuditSafe_: ' + e.message); }
}

function wfActor_(actor, fallbackEmail) {
  if (!actor && typeof getCurrentUser === 'function') {
    try { actor = getCurrentUser(); } catch (e) {}
  }
  if (actor && typeof actor === 'object') {
    const email = String(actor.email || actor.Email || fallbackEmail || '').toLowerCase().trim();
    const row = email && email !== 'system' ? wfActiveUser_(email) : null;
    return {
      email: email || 'system',
      name: actor.name || actor.FullName || row && row.FullName || email || 'system',
      role: actor.role || actor.Role || row && row.Role || (email === 'system' ? ROLES.IT_ADMIN : ''),
      dept: actor.dept || actor.Department || row && row.Department || '',
      _requiredRole: String(actor._requiredRole || '')
    };
  }
  const email = String(actor || fallbackEmail || 'system').toLowerCase().trim();
  const row = email !== 'system' ? wfActiveUser_(email) : null;
  return {
    email: email || 'system',
    name: row && row.FullName || email || 'system',
    role: row && row.Role || (email === 'system' ? ROLES.IT_ADMIN : ''),
    dept: row && row.Department || ''
  };
}

function wfActiveUsers_() {
  return readSheetObjectsEnsured_(SHEETS.USERS, true).filter(function (row) {
    return String(row.Status || '').toLowerCase() === 'active' &&
      isValidEmail(String(row.Email || '').toLowerCase());
  });
}

function wfActiveUser_(email) {
  email = String(email || '').toLowerCase().trim();
  return wfActiveUsers_().filter(function (row) {
    return String(row.Email || '').toLowerCase().trim() === email;
  })[0] || null;
}

function wfAssertActiveUserEmail_(email, label) {
  if (!wfActiveUser_(email)) throw new Error((label || 'ผู้ใช้') + ' ต้องเป็นบัญชี Active ในระบบ');
}

/**
 * แจ้งเตือนข้อมูลส่วนบุคคลแบบ fail-closed: ถ้า map email -> LINE user ไม่ได้
 * จะไม่ fallback ไป LINE_DEFAULT_TO/กลุ่มกลาง และคงงานไว้ใน Workflow inbox.
 */
function wfNotifyPrivate_(toEmail, subject, message, refModule, refId) {
  try {
    if (!isLineEnabled()) return false;
    const targets = getLineTargetsForEmails_(toEmail);
    if (!targets.length) {
      logNotification_('LINE_PRIVATE', sanitizeText(toEmail, 250), sanitizeText(subject, 200),
        refModule || 'workflow', refId || '', 'skipped', 'ไม่พบ LINE mapping รายบุคคล; ไม่ fallback กลุ่มกลาง');
      return false;
    }
    let sent = false;
    targets.forEach(function (target) {
      sent = sendLineNotify_(String(message || subject).substring(0, 4900), target,
        refModule || 'workflow', refId || '', false) || sent;
    });
    return sent;
  } catch (e) {
    console.error('wfNotifyPrivate_: ' + e.message);
    return false;
  }
}

function wfTime_(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function wfClientSafe_(value) {
  const json = JSON.stringify(value);
  if (!json) throw new Error('ไม่สามารถแปลงข้อมูล Workflow สำหรับ client');
  return JSON.parse(json);
}
