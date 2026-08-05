/**
 * Module_Integration.gs
 * Transactional outbox for Service Request -> Access/Ticket/Asset/Change.
 *
 * Design constraints:
 * - The catalog chooses only a named adapter. No function name from JSON is executed.
 * - A deterministic idempotency key plus a reverse source marker prevents duplicates.
 * - RecordLinks is the canonical 1:N relationship. Related*ID remains a primary-link
 *   compatibility field on ServiceRequests.
 * - Functions ending in `_` are internal and must not be added to API_ALLOWED.
 */

const INT_SOURCE_MODULE = 'serviceCatalog';
const INT_OUTBOX_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED'
});
const INT_MAX_ATTEMPTS = 5;
const INT_STALE_PROCESSING_MS = 15 * 60 * 1000;
const INT_RETRY_MINUTES = [1, 5, 15, 60, 240];
const INT_LIFECYCLE_CURSOR_KEY = 'INTEGRATION_LIFECYCLE_CURSOR';
const INT_OUTBOX_QUEUE_TURN_KEY = 'INTEGRATION_OUTBOX_QUEUE_TURN';
const INT_TARGETS = Object.freeze({
  access: Object.freeze({ operation: 'CREATE', sheet: 'AccessRequests', idField: 'ReqID',
    relatedField: 'RelatedAccessRequestID', linkType: 'FULFILLED_BY_ACCESS_REQUEST' }),
  ticket: Object.freeze({ operation: 'CREATE', sheet: 'Tickets', idField: 'TicketID',
    relatedField: 'RelatedTicketID', linkType: 'FULFILLED_BY_TICKET' }),
  asset: Object.freeze({ operation: 'LINK', sheet: 'AssetRegister', idField: 'AssetID',
    relatedField: 'RelatedAssetID', linkType: 'FULFILLED_WITH_ASSET' }),
  change: Object.freeze({ operation: 'CREATE', sheet: 'ChangeRequests', idField: 'ChangeID',
    relatedField: 'RelatedChangeID', linkType: 'FULFILLED_BY_CHANGE' })
});

/** Public API: process due outbox rows now. IT Admin only. */
function processIntegrationOutboxNow(limit) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'integration.execute');
    const result = processIntegrationOutbox_(limit,
      Object.assign({}, user, { _requiredRole: ROLES.IT_ADMIN }));
    return ok(result, 'ประมวลผล Integration Outbox แล้ว');
  } catch (e) {
    return fail(e.message, 'INTEGRATION_PROCESS_FAILED');
  }
}

/** Public API: retry a failed job by IntegrationID, or all failed jobs of a RequestID. */
function retryServiceRequestIntegration(integrationIdOrRequestId) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'integration.retry');
    const key = sanitizeText(integrationIdOrRequestId, 160);
    if (!key) throw new Error('กรุณาระบุ IntegrationID หรือ RequestID');
    intEnsureSheets_();

    const count = intWithScriptLock_(function () {
      const lockedUser = intReauthorizeMutationActorLocked_(user, 'integration.retry', ROLES.IT_ADMIN);
      const rows = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX);
      const matches = rows.filter(function (row) {
        return String(row.IntegrationID) === key ||
          (String(row.SourceModule) === INT_SOURCE_MODULE && String(row.SourceRecordID) === key);
      });
      if (!matches.length) throw new Error('ไม่พบ Integration ที่ต้องการ retry');
      const blockedRequest = matches.map(function (row) {
        return intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', row.SourceRecordID);
      }).filter(function (request) {
        return request && intServiceRequestTerminal_(request.Status);
      })[0];
      if (blockedRequest) {
        throw new Error('ไม่สามารถ retry Integration ของ Service Request ที่จบงานแล้ว');
      }
      const retryable = matches.filter(function (row) {
        return String(row.Status) !== INT_OUTBOX_STATUS.COMPLETED &&
          String(row.Status) !== INT_OUTBOX_STATUS.CANCELLED;
      });
      if (!retryable.length) throw new Error('Integration นี้เสร็จสิ้นหรือถูกยกเลิกแล้ว');
      intWriteAuditLocked_(lockedUser, 'RETRY_INTEGRATION_INTENT', SHEETS.INTEGRATION_OUTBOX, key,
        'jobs=' + retryable.length, 'pending');
      let updated = 0;
      retryable.forEach(function (row) {
        intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, row._row, {
          Status: INT_OUTBOX_STATUS.PENDING,
          AttemptCount: 0,
          NextAttemptAt: new Date(),
          LastAttemptAt: '',
          ErrorMessage: '',
          Notes: intAppendNote_(row.Notes, lockedUser.email, 'manual retry')
        }, lockedUser.email);
        updated++;
      });
      const requestIds = {};
      matches.forEach(function (row) { requestIds[String(row.SourceRecordID || '')] = true; });
      Object.keys(requestIds).filter(String).forEach(function (requestId) {
        const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
        if (request) intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
          IntegrationStatus: INT_OUTBOX_STATUS.PENDING,
          IntegrationError: ''
        }, lockedUser.email);
      });
      intWriteAuditLocked_(lockedUser, 'RETRY_INTEGRATION', SHEETS.INTEGRATION_OUTBOX, key,
        'jobs=' + updated, 'success');
      return updated;
    });
    return ok({ retried: count }, 'นำ Integration กลับเข้าคิวแล้ว ' + count + ' รายการ');
  } catch (e) {
    return fail(e.message, 'INTEGRATION_RETRY_FAILED');
  }
}

/** Public API: row-filtered integration status for one Service Request. */
function getServiceRequestIntegrations(requestId) {
  try {
    const user = requireModule('serviceCatalog', false);
    requestId = sanitizeText(requestId, 120);
    if (!requestId) throw new Error('กรุณาระบุ RequestID');
    intEnsureSheets_();
    const request = findRowEnsured_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
    if (!request) throw new Error('ไม่พบคำขอบริการ ' + requestId);
    if (!intCanViewServiceRequest_(request, user)) {
      intWriteAuditSafe_(user, 'INTEGRATION_VIEW_DENIED', SHEETS.SERVICE_REQUEST, requestId,
        'row-level access denied', 'denied');
      throw new Error('ท่านไม่มีสิทธิ์ดู Integration ของคำขอนี้');
    }

    const isAdmin = user.role === ROLES.IT_ADMIN;
    const links = readSheetObjectsEnsured_(SHEETS.RECORD_LINK).filter(function (row) {
      return String(row.SourceModule) === INT_SOURCE_MODULE &&
        String(row.SourceRecordID) === requestId && String(row.Status || 'Active') !== 'Cancelled';
    }).map(function (row) {
      const canOpen = intCanViewTarget_(String(row.TargetModule || ''),
        String(row.TargetRecordID || ''), user);
      return {
        id: isAdmin ? row.LinkID : '',
        targetModule: row.TargetModule,
        targetRecordId: canOpen ? row.TargetRecordID : '',
        linkType: row.LinkType,
        primary: intIsYes_(row.IsPrimary),
        status: row.Status || 'Active',
        canOpen: canOpen,
        createdAt: safeFmtDateTime_(row.CreatedAt || row.Timestamp)
      };
    });
    const jobs = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX).filter(function (row) {
      return String(row.SourceModule) === INT_SOURCE_MODULE && String(row.SourceRecordID) === requestId;
    }).map(function (row) {
      return {
        id: isAdmin ? row.IntegrationID : '',
        targetModule: row.TargetModule,
        operation: row.Operation,
        status: row.Status,
        attempts: isAdmin ? Number(row.AttemptCount || 0) : null,
        nextAttemptAt: isAdmin ? safeFmtDateTime_(row.NextAttemptAt) : '',
        completedAt: safeFmtDateTime_(row.CompletedAt),
        targetRecordId: links.some(function (link) {
          return link.targetModule === row.TargetModule && link.canOpen &&
            String(link.targetRecordId) === String(row.ResultRecordID);
        }) ? row.ResultRecordID : '',
        error: isAdmin ? String(row.ErrorMessage || '') : (row.ErrorMessage ? 'Integration requires IT review' : '')
      };
    });
    return ok({
      requestId: requestId,
      status: request.IntegrationStatus || '',
      error: isAdmin ? String(request.IntegrationError || '') :
        (request.IntegrationError ? 'Integration requires IT review' : ''),
      integratedAt: safeFmtDateTime_(request.IntegratedAt),
      links: links,
      jobs: jobs
    });
  } catch (e) {
    return fail(e.message, 'INTEGRATION_LOAD_FAILED');
  }
}

// ============================================================================
// Hooks for Module_ServiceCatalog / central Workflow engine
// ============================================================================

/**
 * Use after a source transaction when the caller does not already hold ScriptLock.
 * eventName examples: NO_APPROVAL, APPROVED, WORKFLOW_APPROVED.
 * Optional configSnapshot makes the catalog integration definition immutable.
 */
function queueServiceRequestIntegration_(requestId, eventName, actor, configSnapshot) {
  intEnsureSheets_();
  return intWithScriptLock_(function () {
    return queueServiceRequestIntegrationLocked_(requestId, eventName, actor, configSnapshot);
  });
}

/**
 * Transactional hook. Caller MUST already hold ScriptLock and should ensure the
 * integration sheets before entering its source transaction.
 */
function queueServiceRequestIntegrationLocked_(requestOrId, eventName, actor, configSnapshot) {
  intAssertAuditReadyLocked_();
  if (actor && actor._requiredPermission) {
    actor = wfReauthorizeMutationActorLocked_(actor, actor._requiredPermission);
  }
  const requestId = sanitizeText(requestOrId && requestOrId.RequestID || requestOrId, 120);
  if (!requestId) throw new Error('RequestID สำหรับ Integration ไม่ถูกต้อง');
  const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
  if (!request) throw new Error('ไม่พบคำขอบริการ ' + requestId);
  if (intServiceRequestTerminal_(request.Status)) return null;
  if (!intSourceReadyForIntegration_(request)) return null;

  const config = intResolveIntegrationConfig_(request, configSnapshot);
  if (!config || !config.autoCreate || !config.target) return null;
  const target = intNormalizeTarget_(config.target);
  const adapter = INT_TARGETS[target];
  if (!adapter) throw new Error('FulfillmentTarget ไม่อยู่ใน adapter allowlist');
  const operation = adapter.operation;
  const idempotencyKey = ['SRQ', requestId, target, operation,
    'v' + (parseInt(request.CatalogVersion, 10) || 1)].join(':');
  const actorObj = intActor_(actor, request.RequesterEmail);

  const existing = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX).filter(function (row) {
    return String(row.IdempotencyKey) === idempotencyKey;
  })[0];
  if (existing) {
    intWriteAuditLocked_(actorObj, 'QUEUE_INTEGRATION', SHEETS.SERVICE_REQUEST,
      requestId, target + '/' + operation + ' · ' + existing.IntegrationID + ' duplicate/reconciled', 'success');
    return { id: existing.IntegrationID, duplicate: true, status: existing.Status };
  }

  const integrationId = generateId('INT');
  const payload = intBuildPayload_(request, config.mapping, integrationId);
  intWriteAuditLocked_(actorObj, 'QUEUE_INTEGRATION_INTENT', SHEETS.SERVICE_REQUEST,
    requestId, target + '/' + operation + ' · ' + integrationId, 'pending');
  intAppendLocked_(SHEETS.INTEGRATION_OUTBOX, {
    IntegrationID: integrationId,
    SourceModule: INT_SOURCE_MODULE,
    SourceRecordID: requestId,
    TargetModule: target,
    Operation: operation,
    IdempotencyKey: idempotencyKey,
    PayloadJSON: JSON.stringify(payload),
    Status: INT_OUTBOX_STATUS.PENDING,
    AttemptCount: 0,
    NextAttemptAt: new Date(),
    Notes: 'QueuedByEvent=' + sanitizeText(eventName, 80)
  }, actorObj.email);
  intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
    IntegrationStatus: INT_OUTBOX_STATUS.PENDING,
    IntegrationError: ''
  }, actorObj.email);
  intAddServiceHistoryLocked_(request, actorObj, 'QUEUE_INTEGRATION',
    target + '/' + operation + ' · ' + integrationId, true);
  intWriteAuditLocked_(actorObj, 'QUEUE_INTEGRATION', SHEETS.SERVICE_REQUEST,
    requestId, target + '/' + operation + ' · ' + integrationId, 'success');
  return { id: integrationId, duplicate: false, status: INT_OUTBOX_STATUS.PENDING };
}

/**
 * Preflight used by Service Catalog while it already owns ScriptLock. A request
 * cannot be cancelled automatically once a durable downstream record exists;
 * doing so would leave an active Access/Ticket/Asset/Change without an owner.
 */
function intPreflightServiceRequestCancellationLocked_(requestOrId) {
  const requestId = sanitizeText(requestOrId && requestOrId.RequestID || requestOrId, 120);
  const request = requestOrId && requestOrId.RequestID ? requestOrId :
    intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
  if (!request) throw new Error('ไม่พบคำขอบริการ ' + requestId);

  const activeLink = readSheetObjectsEnsured_(SHEETS.RECORD_LINK, true).filter(function (row) {
    return String(row.SourceModule || '') === INT_SOURCE_MODULE &&
      String(row.SourceRecordID || '') === requestId &&
      String(row.Status || 'Active') !== 'Cancelled';
  })[0];
  if (activeLink) {
    throw new Error('คำขอนี้สร้างรายการปลายทางแล้ว กรุณาปิดหรือยกเลิกรายการปลายทางตามกระบวนการของโมดูลนั้น');
  }

  const jobs = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX, true).filter(function (row) {
    return String(row.SourceModule || '') === INT_SOURCE_MODULE &&
      String(row.SourceRecordID || '') === requestId;
  });
  const durableTarget = jobs.map(function (job) {
    const target = intNormalizeTarget_(job.TargetModule);
    if (!target) return '';
    return sanitizeText(job.ResultRecordID, 160) || intPrimaryTargetId_(request, target) ||
      intFindReverseTarget_(target, requestId);
  }).filter(String)[0];
  if (durableTarget || jobs.some(function (job) {
    return String(job.Status || '') === INT_OUTBOX_STATUS.COMPLETED;
  })) {
    throw new Error('คำขอนี้มี Integration ที่สร้างรายการปลายทางสำเร็จแล้ว จึงยกเลิกจาก Service Catalog โดยตรงไม่ได้');
  }
  return { request: request, jobs: jobs };
}

/** Cancel only jobs that have not produced a downstream record. Caller owns ScriptLock. */
function intCancelServiceRequestIntegrationsLocked_(requestOrId, actor, reason) {
  intAssertAuditReadyLocked_();
  const checked = intPreflightServiceRequestCancellationLocked_(requestOrId);
  const request = checked.request;
  const actorObj = intActor_(actor, request.RequesterEmail || 'system');
  const alreadyCancelled = checked.jobs.every(function (job) {
    return String(job.Status || '') === INT_OUTBOX_STATUS.CANCELLED;
  }) && String(request.IntegrationStatus || '') === INT_OUTBOX_STATUS.CANCELLED;
  if (alreadyCancelled) {
    intWriteAuditLocked_(actorObj, 'INTEGRATION_CANCELLED', SHEETS.SERVICE_REQUEST,
      request.RequestID, 'jobs=0 duplicate/reconciled', 'success');
    return { cancelled: 0, duplicate: true };
  }
  intWriteAuditLocked_(actorObj, 'INTEGRATION_CANCEL_INTENT', SHEETS.SERVICE_REQUEST,
    request.RequestID, 'jobs=' + checked.jobs.length + ' reason=' + sanitizeText(reason, 500), 'pending');
  let cancelled = 0;
  checked.jobs.forEach(function (job) {
    const status = String(job.Status || '');
    if (status === INT_OUTBOX_STATUS.CANCELLED) return;
    intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
      Status: INT_OUTBOX_STATUS.CANCELLED,
      NextAttemptAt: '',
      ErrorMessage: '',
      Notes: intAppendNote_(job.Notes, actorObj.email,
        'cancelled with source request: ' + sanitizeText(reason, 500))
    }, actorObj.email);
    cancelled++;
  });
  if (String(request.IntegrationStatus || '') !== INT_OUTBOX_STATUS.CANCELLED) {
    intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
      IntegrationStatus: INT_OUTBOX_STATUS.CANCELLED,
      IntegrationError: ''
    }, actorObj.email);
  }
  if (cancelled) {
    intAddServiceHistoryLocked_(request, actorObj, 'INTEGRATION_CANCELLED',
      'ยกเลิกงาน Integration ที่ยังไม่สร้างรายการปลายทาง ' + cancelled + ' รายการ', true);
  }
  intWriteAuditLocked_(actorObj, 'INTEGRATION_CANCELLED', SHEETS.SERVICE_REQUEST,
    request.RequestID, 'jobs=' + cancelled, 'success');
  return { cancelled: cancelled };
}

/** Optional target lifecycle hook. It refreshes the source summary without driving target state. */
function serviceRequestIntegrationTargetChanged_(targetModule, targetRecordId, actor) {
  intEnsureSheets_();
  targetModule = intNormalizeTarget_(targetModule);
  targetRecordId = sanitizeText(targetRecordId, 160);
  if (!targetModule || !targetRecordId) return 0;
  return intWithScriptLock_(function () {
    intAssertAuditReadyLocked_();
    const allLinks = readSheetObjectsEnsured_(SHEETS.RECORD_LINK, true).filter(function (row) {
      return String(row.SourceModule || '') === INT_SOURCE_MODULE &&
        String(row.Status || 'Active') !== 'Cancelled' && intNormalizeTarget_(row.TargetModule);
    });
    const changedLinks = allLinks.filter(function (row) {
      return String(row.TargetModule) === targetModule &&
        String(row.TargetRecordID) === targetRecordId && String(row.Status || 'Active') !== 'Cancelled';
    });
    const actorObj = intActor_(actor, 'system');
    const requestIds = {};
    changedLinks.forEach(function (link) { requestIds[String(link.SourceRecordID || '')] = true; });
    const relevantLinks = allLinks.filter(function (link) {
      return requestIds[String(link.SourceRecordID || '')];
    });
    const targetMaps = intBuildTargetMapsForLinksLocked_(relevantLinks);
    let updated = 0;
    Object.keys(requestIds).filter(String).sort().forEach(function (requestId) {
      const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', requestId);
      if (!request) return;
      const outcome = intAggregateRequestLifecycleLocked_(request, relevantLinks.filter(function (link) {
        return String(link.SourceRecordID || '') === requestId;
      }), targetMaps, actorObj);
      if (outcome.updated) updated++;
    });
    return updated;
  });
}

// ============================================================================
// Outbox processor
// ============================================================================

function processIntegrationOutbox_(limit, actor) {
  intEnsureSheets_();
  limit = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const now = new Date();
  const outboxRows = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX);
  const sourceRows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST);
  const links = readSheetObjectsEnsured_(SHEETS.RECORD_LINK);
  const readyCandidates = outboxRows.filter(function (row) {
    const status = String(row.Status || '');
    if (status === INT_OUTBOX_STATUS.PENDING) return intDue_(row.NextAttemptAt, now);
    if (status !== INT_OUTBOX_STATUS.PROCESSING) return false;
    const last = intDateMs_(row.LastAttemptAt);
    return !last || now.getTime() - last >= INT_STALE_PROCESSING_MS;
  }).sort(function (a, b) {
    return intDateMs_(a.NextAttemptAt || a.Timestamp) - intDateMs_(b.NextAttemptAt || b.Timestamp);
  });
  const repairCandidates = outboxRows.filter(function (row) {
    if (String(row.Status || '') !== INT_OUTBOX_STATUS.COMPLETED) return false;
    if (!intDue_(row.NextAttemptAt, now)) return false;
    const request = sourceRows.filter(function (item) {
      return String(item.RequestID || '') === String(row.SourceRecordID || '');
    })[0];
    if (!request) return false;
    const target = intNormalizeTarget_(row.TargetModule);
    const targetId = String(row.ResultRecordID || intPrimaryTargetId_(request, target) || '');
    const hasLink = targetId && links.some(function (link) {
      return String(link.SourceModule || '') === INT_SOURCE_MODULE &&
        String(link.SourceRecordID || '') === String(request.RequestID) &&
        intNormalizeTarget_(link.TargetModule) === target &&
        String(link.TargetRecordID || '') === targetId &&
        String(link.Status || 'Active') !== 'Cancelled';
    });
    return !!String(row.ErrorMessage || '').trim() || !!row.NextAttemptAt || !hasLink ||
      String(request.IntegrationStatus || '').toUpperCase() === INT_OUTBOX_STATUS.ERROR;
  }).sort(function (a, b) {
    return intDateMs_(a.NextAttemptAt || a.LastAttemptAt || a.Timestamp) -
      intDateMs_(b.NextAttemptAt || b.LastAttemptAt || b.Timestamp);
  });

  // Keep both queues progressing: fresh PENDING/PROCESSING work receives the
  // main quota, while completed-repair jobs receive a bounded guaranteed slot.
  // Failed repairs are backed off below, so limit=1 still alternates fairly.
  let candidates = [];
  if (limit === 1 && readyCandidates.length && repairCandidates.length) {
    // With a one-item quota, persistently alternate queues so neither a steady
    // stream of fresh work nor a repeatedly failing repair can starve the other.
    const queueProps = PropertiesService.getScriptProperties();
    const turn = String(queueProps.getProperty(INT_OUTBOX_QUEUE_TURN_KEY) || 'READY').toUpperCase();
    if (turn === 'REPAIR') {
      candidates = repairCandidates.slice(0, 1);
      queueProps.setProperty(INT_OUTBOX_QUEUE_TURN_KEY, 'READY');
    } else {
      candidates = readyCandidates.slice(0, 1);
      queueProps.setProperty(INT_OUTBOX_QUEUE_TURN_KEY, 'REPAIR');
    }
  } else {
    let repairTake = repairCandidates.length ?
      Math.min(repairCandidates.length, Math.max(1, Math.floor(limit / 4))) : 0;
    let readyTake = Math.min(readyCandidates.length, Math.max(0, limit - repairTake));
    if (readyTake < limit - repairTake) {
      repairTake = Math.min(repairCandidates.length, limit - readyTake);
    }
    candidates = readyCandidates.slice(0, readyTake)
      .concat(repairCandidates.slice(0, repairTake));
    if (candidates.length < limit && readyTake < readyCandidates.length) {
      candidates = candidates.concat(readyCandidates.slice(readyTake,
        readyTake + (limit - candidates.length)));
    }
  }

  const result = { selected: candidates.length, completed: 0, retried: 0, failed: 0, items: [] };
  candidates.forEach(function (candidate) {
    try {
      const outcome = intProcessOne_(candidate.IntegrationID, actor);
      if (!outcome) return;
      result.completed++;
      result.items.push({ id: candidate.IntegrationID, status: 'COMPLETED', targetRecordId: outcome.targetRecordId });
    } catch (e) {
      const failure = intMarkFailure_(candidate.IntegrationID, actor, e);
      if (failure && failure.retrying) result.retried++;
      else result.failed++;
      result.items.push({ id: candidate.IntegrationID,
        status: failure && failure.retrying ? 'PENDING' : 'ERROR', error: sanitizeText(e.message, 500) });
    }
  });
  result.lifecycle = intReconcileLinkedTargetStatuses_(Math.max(20, limit * 5), actor);
  return result;
}

/**
 * Scheduled/polling fallback for target modules that do not emit lifecycle
 * hooks. Reads each target sheet once and refreshes the source summary.
 */
function intReconcileLinkedTargetStatuses_(limit, actor) {
  limit = Math.max(1, Math.min(250, parseInt(limit, 10) || 100));
  return intWithScriptLock_(function () {
    const actorObj = intReauthorizeMutationActorLocked_(intActor_(actor, 'system'),
      'integration.execute');
    const allLinks = readSheetObjectsEnsured_(SHEETS.RECORD_LINK, true).filter(function (row) {
      return String(row.SourceModule || '') === INT_SOURCE_MODULE &&
        String(row.Status || 'Active') !== 'Cancelled' && intNormalizeTarget_(row.TargetModule);
    }).sort(function (a, b) {
      return String(a.LinkID || '').localeCompare(String(b.LinkID || '')) ||
        String(a.SourceRecordID || '').localeCompare(String(b.SourceRecordID || ''));
    });
    const props = PropertiesService.getScriptProperties();
    const storedCursor = Math.max(0, parseInt(props.getProperty(INT_LIFECYCLE_CURSOR_KEY), 10) || 0);
    const cursorStart = allLinks.length ? storedCursor % allLinks.length : 0;
    const cursorLinks = [];
    const take = Math.min(limit, allLinks.length);
    for (let cursorOffset = 0; cursorOffset < take; cursorOffset++) {
      cursorLinks.push(allLinks[(cursorStart + cursorOffset) % allLinks.length]);
    }
    const selectedRequestIds = {};
    cursorLinks.forEach(function (link) {
      selectedRequestIds[String(link.SourceRecordID || '')] = true;
    });
    // RecordLinks is canonical 1:N. Once a request is selected by the cursor,
    // evaluate every active link of that request so one healthy link can never
    // hide a missing/provenance-invalid sibling.
    const links = allLinks.filter(function (link) {
      return selectedRequestIds[String(link.SourceRecordID || '')];
    });
    const targetMaps = intBuildTargetMapsForLinksLocked_(links);
    const requests = {};
    readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST, true).forEach(function (row) {
      requests[String(row.RequestID || '')] = row;
    });
    let updated = 0, missing = 0;
    Object.keys(selectedRequestIds).filter(String).sort().forEach(function (requestId) {
      const request = requests[requestId];
      if (!request) return;
      const outcome = intAggregateRequestLifecycleLocked_(request, links.filter(function (link) {
        return String(link.SourceRecordID || '') === requestId;
      }), targetMaps, actorObj);
      if (outcome.updated) updated++;
      if (!outcome.healthy) missing++;
    });
    const nextCursor = allLinks.length ? (cursorStart + cursorLinks.length) % allLinks.length : 0;
    props.setProperty(INT_LIFECYCLE_CURSOR_KEY, String(nextCursor));
    return { selected: cursorLinks.length, selectedRequests: Object.keys(selectedRequestIds).filter(String).length,
      evaluatedLinks: links.length, total: allLinks.length, updated: updated,
      missing: missing, cursorStart: cursorStart, nextCursor: nextCursor };
  });
}

function intBuildTargetMapsForLinksLocked_(links) {
  const targetMaps = {};
  Object.keys(INT_TARGETS).forEach(function (target) {
    if (!(links || []).some(function (link) {
      return intNormalizeTarget_(link.TargetModule) === target;
    })) return;
    const cfg = INT_TARGETS[target];
    targetMaps[target] = {};
    readSheetObjectsEnsured_(cfg.sheet, true).forEach(function (row) {
      targetMaps[target][String(row[cfg.idField] || '')] = row;
    });
  });
  return targetMaps;
}

function intActiveRecordLinksForRequestLocked_(requestId) {
  return readSheetObjectsEnsured_(SHEETS.RECORD_LINK, true).filter(function (link) {
    return String(link.SourceModule || '') === INT_SOURCE_MODULE &&
      String(link.SourceRecordID || '') === String(requestId || '') &&
      String(link.Status || 'Active') !== 'Cancelled' && intNormalizeTarget_(link.TargetModule);
  });
}

function intAggregateRequestLifecycleLocked_(request, links, targetMaps, actor, options) {
  options = options || {};
  const actorObj = intActor_(actor, 'system');
  const states = (links || []).slice().sort(function (a, b) {
    return String(a.LinkID || '').localeCompare(String(b.LinkID || ''));
  }).map(function (link) {
    const target = intNormalizeTarget_(link.TargetModule);
    const targetId = String(link.TargetRecordID || '');
    const targetRow = targetMaps[target] && targetMaps[target][targetId];
    let provenanceError = '', provenanceNeedsRepair = false;
    if (targetRow) {
      try {
        provenanceNeedsRepair = intReverseProvenanceState_(targetRow,
          request.RequestID).needsRepair;
      } catch (e) {
        provenanceError = sanitizeText(e.message, 500) || 'reverse provenance invalid';
      }
    }
    const status = !targetRow ? 'MISSING' :
      (provenanceError ? 'PROVENANCE_ERROR' : sanitizeText(targetRow.Status || 'LINKED', 80));
    return {
      target: target, targetId: targetId, status: status,
      healthy: !!targetRow && !provenanceError,
      error: provenanceError || (!targetRow ?
        ('ไม่พบรายการปลายทาง ' + target + ':' + targetId) : ''),
      provenanceNeedsRepair: provenanceNeedsRepair
    };
  });
  const unhealthy = states.filter(function (state) { return !state.healthy; });
  const requestJobs = readSheetObjectsEnsured_(SHEETS.INTEGRATION_OUTBOX, true).filter(function (job) {
    return String(job.SourceModule || '') === INT_SOURCE_MODULE &&
      String(job.SourceRecordID || '') === String(request.RequestID || '') &&
      String(job.IntegrationID || '') !== String(options.ignoreIntegrationId || '') &&
      String(job.Status || '') !== INT_OUTBOX_STATUS.CANCELLED;
  });
  const jobStates = requestJobs.map(function (job) {
    const status = String(job.Status || '').toUpperCase();
    const target = intNormalizeTarget_(job.TargetModule);
    const targetId = sanitizeText(job.ResultRecordID, 160) || intPrimaryTargetId_(request, target);
    const hasLink = states.some(function (state) {
      return state.target === target && (!targetId || state.targetId === targetId);
    });
    if (status === INT_OUTBOX_STATUS.PENDING || status === INT_OUTBOX_STATUS.PROCESSING) {
      return { state: 'PENDING', id: String(job.IntegrationID || ''),
        error: String(job.ErrorMessage || '').trim() };
    }
    if (status === INT_OUTBOX_STATUS.ERROR) {
      return { state: 'ERROR', id: String(job.IntegrationID || ''),
        error: String(job.ErrorMessage || '').trim() || 'Integration job failed' };
    }
    if (status === INT_OUTBOX_STATUS.COMPLETED) {
      if (!!job.NextAttemptAt || !!String(job.ErrorMessage || '').trim() || !hasLink) {
        return { state: 'ERROR', id: String(job.IntegrationID || ''),
          error: String(job.ErrorMessage || '').trim() || 'Completed integration link requires repair' };
      }
      return { state: 'OK', id: String(job.IntegrationID || ''), error: '' };
    }
    return { state: 'ERROR', id: String(job.IntegrationID || ''),
      error: 'Integration status is invalid: ' + status };
  });
  const jobErrors = jobStates.filter(function (job) { return job.state === 'ERROR'; });
  const pendingJobs = jobStates.filter(function (job) { return job.state === 'PENDING'; });
  const hasErrors = !!unhealthy.length || !!jobErrors.length;
  const pending = !hasErrors && !!pendingJobs.length;
  const healthy = !hasErrors && !pending && states.length > 0;
  const summaries = states.map(function (state) {
    return state.target + ':' + state.targetId + '=' + state.status;
  });
  const linkedSummary = states.length === 1 ? states[0].status :
    ('MULTI[' + states.length + ']:' + summaries.join('|'));
  const nextStatus = healthy ? 'LINKED:' + sanitizeText(linkedSummary, 400) :
    (pending ? INT_OUTBOX_STATUS.PENDING : INT_OUTBOX_STATUS.ERROR);
  const nextError = healthy ? '' : sanitizeText(unhealthy.map(function (state) {
    return state.error || (state.target + ':' + state.targetId + ' provenance invalid');
  }).concat(jobErrors.concat(pendingJobs).filter(function (job) {
    return !!String(job.error || '').trim();
  }).map(function (job) {
    return String(job.id || 'Integration') + ': ' + job.error;
  })).join(' | '), 1000);
  const provenanceNeedsRepair = states.some(function (state) { return state.provenanceNeedsRepair; });
  const summaryChanged = String(request.IntegrationStatus || '') !== nextStatus ||
    String(request.IntegrationError || '') !== nextError;
  if (!summaryChanged && !provenanceNeedsRepair) {
    return { updated: false, healthy: healthy, hasErrors: hasErrors,
      pending: pending, states: states.length };
  }
  // Durable audit/history intent is written once for the aggregate. The source
  // summary is the final commit marker for all active links of this request.
  intWriteAuditLocked_(actorObj, 'INTEGRATION_LIFECYCLE_SYNC_INTENT', SHEETS.SERVICE_REQUEST,
    request.RequestID, summaries.join(' | '), 'pending');
  states.filter(function (state) {
    return state.healthy && state.provenanceNeedsRepair;
  }).forEach(function (state) {
    intPatchReverseLinkLocked_(state.target, state.targetId, request.RequestID, actorObj.email);
  });
  intAddServiceHistoryLocked_(request, actorObj, 'INTEGRATION_LIFECYCLE',
    summaries.join(' | '), false);
  if (summaryChanged) {
    intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
      IntegrationStatus: nextStatus,
      IntegrationError: nextError
    }, actorObj.email);
    request.IntegrationStatus = nextStatus;
    request.IntegrationError = nextError;
  }
  intWriteAuditLocked_(actorObj, 'INTEGRATION_LIFECYCLE_SYNC', SHEETS.SERVICE_REQUEST,
    request.RequestID, summaries.join(' | '), healthy ? 'success' : (hasErrors ? 'error' : 'pending'));
  return { updated: true, healthy: healthy, hasErrors: hasErrors, pending: pending, states: states.length,
    provenanceRepaired: provenanceNeedsRepair };
}

function intProcessOne_(integrationId, actor) {
  return intWithScriptLock_(function () {
    const job = intFindRowLocked_(SHEETS.INTEGRATION_OUTBOX, 'IntegrationID', integrationId);
    if (!job || String(job.Status) === INT_OUTBOX_STATUS.CANCELLED) return null;
    const actorObj = intReauthorizeMutationActorLocked_(intActor_(actor, 'system'),
      'integration.execute');
    if (String(job.Status) === INT_OUTBOX_STATUS.COMPLETED) {
      return intReconcileCompletedLocked_(job, actorObj);
    }
    const now = new Date();
    if (String(job.Status) === INT_OUTBOX_STATUS.PROCESSING) {
      const last = intDateMs_(job.LastAttemptAt);
      if (last && now.getTime() - last < INT_STALE_PROCESSING_MS) return null;
    } else if (String(job.Status) !== INT_OUTBOX_STATUS.PENDING || !intDue_(job.NextAttemptAt, now)) {
      return null;
    }
    const attempt = (parseInt(job.AttemptCount, 10) || 0) + 1;
    intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
      Status: INT_OUTBOX_STATUS.PROCESSING,
      AttemptCount: attempt,
      LastAttemptAt: now,
      ErrorMessage: ''
    }, actorObj.email);

    if (String(job.SourceModule) !== INT_SOURCE_MODULE) throw new Error('SourceModule ไม่รองรับ');
    const target = intNormalizeTarget_(job.TargetModule);
    const adapter = INT_TARGETS[target];
    if (!adapter) throw new Error('TargetModule ไม่อยู่ใน adapter allowlist');
    if (String(job.Operation) !== adapter.operation) throw new Error('Operation ไม่ตรงกับ adapter policy');
    const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', job.SourceRecordID);
    if (!request) throw new Error('ไม่พบ Service Request ต้นทาง');
    if (intServiceRequestTerminal_(request.Status)) throw new Error('Service Request ต้นทางจบงานแล้ว');
    if (!intSourceReadyForIntegration_(request)) throw new Error('Service Request ยังไม่ผ่าน approval gate');

    const payload = intParseJson_(job.PayloadJSON, 'PayloadJSON', {});
    if (String(payload.requestId || '') !== String(request.RequestID)) {
      throw new Error('PayloadJSON ไม่ตรงกับ SourceRecordID');
    }

    let targetRecordId = sanitizeText(job.ResultRecordID, 160) || intPrimaryTargetId_(request, target);
    if (targetRecordId) {
      if (!intTargetExists_(target, targetRecordId)) {
        throw new Error(adapter.relatedField + ' อ้างถึงรายการที่ไม่มีอยู่จริง');
      }
    } else {
      targetRecordId = intFindReverseTarget_(target, request.RequestID);
    }
    if (!targetRecordId) {
      const outcome = intRunAdapter_(target, request, payload, job, actorObj);
      targetRecordId = outcome && outcome.id;
    }
    if (!targetRecordId) throw new Error('Adapter ไม่คืน Target Record ID');
    intWriteAuditLocked_(actorObj, 'INTEGRATION_PROCESS_INTENT', SHEETS.INTEGRATION_OUTBOX,
      job.IntegrationID, target + ':' + targetRecordId, 'pending');
    // Provenance must be validated before any secondary side effect. A stale
    // Related*/ResultRecordID must never cause a worklog on another request's
    // target record.
    intPatchReverseLinkLocked_(target, targetRecordId, request.RequestID, actorObj.email);
    // Repair secondary adapter effects even when a retry discovers an already
    // created target through its reverse provenance marker.
    intEnsureTargetSideEffectsLocked_(target, targetRecordId, request, job, actorObj);
    // Persist the durable adapter result before relationship/source writes.
    // A stale PROCESSING retry can now resume without creating another target.
    if (String(job.ResultRecordID || '') !== String(targetRecordId)) {
      intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
        ResultRecordID: targetRecordId,
        Status: INT_OUTBOX_STATUS.PROCESSING
      }, actorObj.email);
      job.ResultRecordID = targetRecordId;
    }
    intUpsertRecordLinkLocked_(request.RequestID, target, targetRecordId, job, actorObj.email);
    intSetPrimaryLinkLocked_(request, target, targetRecordId, actorObj.email);
    const requestLinks = intActiveRecordLinksForRequestLocked_(request.RequestID);
    const lifecycle = intAggregateRequestLifecycleLocked_(request, requestLinks,
      intBuildTargetMapsForLinksLocked_(requestLinks), actorObj,
      { ignoreIntegrationId: job.IntegrationID });
    if (!request.IntegratedAt) {
      intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, { IntegratedAt: new Date() }, actorObj.email);
      request.IntegratedAt = new Date();
    }
    intAddServiceHistoryLocked_(request, actorObj, 'INTEGRATION_COMPLETED',
      target + ':' + targetRecordId, true);
    intWriteAuditLocked_(actorObj, 'INTEGRATION_COMPLETED', SHEETS.SERVICE_REQUEST,
      request.RequestID, target + ':' + targetRecordId,
      lifecycle.hasErrors ? 'partial' : 'success');
    // COMPLETED is the final commit marker after every repairable side effect.
    intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
      Status: INT_OUTBOX_STATUS.COMPLETED,
      CompletedAt: job.CompletedAt || new Date(),
      NextAttemptAt: '',
      ErrorMessage: '',
      ResultRecordID: targetRecordId
    }, actorObj.email);
    return { target: target, targetRecordId: targetRecordId };
  });
}

function intSourceIntegrationSettled_(status) {
  const value = String(status || '').toUpperCase();
  return value === INT_OUTBOX_STATUS.COMPLETED || value.indexOf('LINKED:') === 0;
}

function intReconcileCompletedLocked_(job, actor) {
  const actorObj = intActor_(actor, 'system');
  if (String(job.SourceModule || '') !== INT_SOURCE_MODULE) return null;
  const target = intNormalizeTarget_(job.TargetModule);
  const adapter = INT_TARGETS[target];
  if (!adapter) throw new Error('TargetModule ไม่อยู่ใน adapter allowlist');
  const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', job.SourceRecordID);
  if (!request) throw new Error('ไม่พบ Service Request ต้นทางสำหรับ reconcile');
  const targetRecordId = sanitizeText(job.ResultRecordID, 160) ||
    intPrimaryTargetId_(request, target) || intFindReverseTarget_(target, request.RequestID);
  if (!targetRecordId || !intTargetExists_(target, targetRecordId)) {
    throw new Error('ไม่พบรายการปลายทางสำหรับ reconcile integration ที่ Completed');
  }
  intWriteAuditLocked_(actorObj, 'INTEGRATION_RECONCILE_INTENT', SHEETS.INTEGRATION_OUTBOX,
    job.IntegrationID, target + ':' + targetRecordId, 'pending');
  intPatchReverseLinkLocked_(target, targetRecordId, request.RequestID, actorObj.email);
  intEnsureTargetSideEffectsLocked_(target, targetRecordId, request, job, actorObj);
  intUpsertRecordLinkLocked_(request.RequestID, target, targetRecordId, job, actorObj.email);
  intSetPrimaryLinkLocked_(request, target, targetRecordId, actorObj.email);
  const requestLinks = intActiveRecordLinksForRequestLocked_(request.RequestID);
  const lifecycle = intAggregateRequestLifecycleLocked_(request, requestLinks,
    intBuildTargetMapsForLinksLocked_(requestLinks), actorObj,
    { ignoreIntegrationId: job.IntegrationID });
  if (!request.IntegratedAt) {
    intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
      IntegratedAt: job.CompletedAt || new Date()
    }, actorObj.email);
    request.IntegratedAt = job.CompletedAt || new Date();
  }
  intAddServiceHistoryLocked_(request, actorObj, 'INTEGRATION_COMPLETED',
    target + ':' + targetRecordId, true);
  if (!job.ResultRecordID || job.NextAttemptAt || job.ErrorMessage) {
    intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
      ResultRecordID: targetRecordId,
      NextAttemptAt: '',
      ErrorMessage: ''
    }, actorObj.email);
  }
  intWriteAuditLocked_(actorObj, 'INTEGRATION_RECONCILED', SHEETS.SERVICE_REQUEST,
    request.RequestID, target + ':' + targetRecordId,
    lifecycle.hasErrors ? 'partial' : 'success');
  return { target: target, targetRecordId: targetRecordId, reconciled: true };
}

function intMarkFailure_(integrationId, actor, error) {
  intEnsureSheets_();
  return intWithScriptLock_(function () {
    const job = intFindRowLocked_(SHEETS.INTEGRATION_OUTBOX, 'IntegrationID', integrationId);
    if (!job) return null;
    if (String(job.Status) === INT_OUTBOX_STATUS.COMPLETED) {
      const completedActor = intReauthorizeMutationActorLocked_(intActor_(actor, 'system'),
        'integration.execute');
      const message = sanitizeText(error && error.message || error, 1000) || 'Completed integration reconcile failed';
      const attempts = (parseInt(job.AttemptCount, 10) || 0) + 1;
      const delayMinutes = INT_RETRY_MINUTES[Math.min(Math.max(0, attempts - 1),
        INT_RETRY_MINUTES.length - 1)];
      intWriteAuditLocked_(completedActor, 'INTEGRATION_RECONCILE_ERROR_INTENT',
        SHEETS.INTEGRATION_OUTBOX, integrationId, message, 'pending');
      intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
        AttemptCount: attempts,
        LastAttemptAt: new Date(),
        NextAttemptAt: new Date(Date.now() + delayMinutes * 60000),
        ErrorMessage: message
      }, completedActor.email);
      const completedRequest = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', job.SourceRecordID);
      if (completedRequest) {
        intUpdateLocked_(SHEETS.SERVICE_REQUEST, completedRequest._row, {
          IntegrationStatus: INT_OUTBOX_STATUS.ERROR,
          IntegrationError: message
        }, completedActor.email);
      }
      intWriteAuditLocked_(completedActor, 'INTEGRATION_RECONCILE_ERROR',
        SHEETS.INTEGRATION_OUTBOX, integrationId, message, 'error');
      return { retrying: false, completed: true, error: message };
    }
    const actorObj = intReauthorizeMutationActorLocked_(intActor_(actor, 'system'),
      'integration.execute');
    const attempts = parseInt(job.AttemptCount, 10) || 1;
    const retrying = attempts < INT_MAX_ATTEMPTS;
    const minutes = INT_RETRY_MINUTES[Math.min(attempts - 1, INT_RETRY_MINUTES.length - 1)];
    const message = sanitizeText(error && error.message || error, 1000) || 'Unknown integration error';
    intWriteAuditLocked_(actorObj, 'INTEGRATION_ERROR_INTENT', SHEETS.INTEGRATION_OUTBOX,
      integrationId, message, 'pending');
    intUpdateLocked_(SHEETS.INTEGRATION_OUTBOX, job._row, {
      Status: retrying ? INT_OUTBOX_STATUS.PENDING : INT_OUTBOX_STATUS.ERROR,
      NextAttemptAt: retrying ? new Date(Date.now() + minutes * 60000) : '',
      ErrorMessage: message
    }, actorObj.email);
    const request = intFindRowLocked_(SHEETS.SERVICE_REQUEST, 'RequestID', job.SourceRecordID);
    if (request) {
      intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, {
        IntegrationStatus: retrying ? INT_OUTBOX_STATUS.PENDING : INT_OUTBOX_STATUS.ERROR,
        IntegrationError: message
      }, actorObj.email);
      intAddServiceHistoryLocked_(request, actorObj, 'INTEGRATION_ERROR',
        String(job.TargetModule || '') + ': ' + message, false);
    }
    intWriteAuditLocked_(actorObj, 'INTEGRATION_ERROR', SHEETS.INTEGRATION_OUTBOX,
      integrationId, message, 'error');
    return { retrying: retrying, attempts: attempts, error: message };
  });
}

// ============================================================================
// Adapter allowlist (never dispatch through globalThis or JSON function names)
// ============================================================================

function intRunAdapter_(target, request, payload, job, actor) {
  switch (target) {
    case 'access': return intCreateAccessRequestLocked_(request, payload, job, actor);
    case 'ticket': return intCreateTicketLocked_(request, payload, job, actor);
    case 'asset': return intLinkAssetLocked_(request, payload, job, actor);
    case 'change': return intCreateChangeLocked_(request, payload, job, actor);
    default: throw new Error('Adapter ไม่ได้รับอนุญาต');
  }
}

function intEnsureTargetSideEffectsLocked_(target, targetRecordId, request, job, actor) {
  if (target !== 'ticket') return;
  ensureSheetBySchema_(SHEETS.TICKET_WORKLOG);
  const sourceMarker = 'SourceServiceRequestID=' + request.RequestID;
  const existing = readSheetObjectsEnsured_(SHEETS.TICKET_WORKLOG, true).filter(function (row) {
    if (String(row.TicketID || '') !== String(targetRecordId)) return false;
    return String(row.Detail || '').split(/\r?\n/).indexOf(sourceMarker) > -1;
  })[0];
  if (existing) return;
  intAppendLocked_(SHEETS.TICKET_WORKLOG, {
    WorklogID: generateId('WL'),
    TicketID: targetRecordId,
    Action: 'เปิด Ticket จาก Service Request',
    Detail: sourceMarker + '\nIntegrationID=' + String(job.IntegrationID || ''),
    StatusFrom: '',
    StatusTo: 'ใหม่',
    IsPublic: 'Yes',
    ActorEmail: actor.email,
    ActorName: actor.name || actor.email,
    ActorIdentityType: 'SYSTEM'
  }, actor.email);
}

function intCreateAccessRequestLocked_(request, payload, job, actor) {
  ensureSheetBySchema_(SHEETS.ACCESS_REQ);
  const prior = intFindReverseTarget_('access', request.RequestID);
  if (prior) {
    intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.ACCESS_REQ, prior,
      request.RequestID + ' duplicate/reconciled', 'success');
    return { id: prior, created: false };
  }
  if (String(request.ApprovalStatus) !== 'อนุมัติ' || !String(request.ApprovedBy || '').trim()) {
    throw new Error('Access adapter ต้องมี approval provenance ก่อนสร้างคำขอสิทธิ์');
  }
  const approvedBy = String(request.ApprovedBy || '').toLowerCase().trim();
  if (approvedBy === String(request.RequesterEmail || '').toLowerCase()) {
    throw new Error('Access adapter ปฏิเสธ self-approval');
  }

  const code = String(request.ServiceCode || '').toUpperCase();
  let system = code === 'VPN_ACCESS' ? 'ระบบเครือข่าย/VPN' :
    (code === 'EMAIL_ACCOUNT' ? 'Google Workspace' :
      intMapped_(payload, 'system', ['system', 'accessSystems'], ''));
  system = sanitizeText(system, 120);
  const systems = typeof getAccessSystems === 'function' ? getAccessSystems() : [];
  if (!system || systems.indexOf(system) === -1) {
    throw new Error('Access adapter ต้อง map ระบบงานให้ตรงกับ ACCESS_SYSTEMS');
  }
  let level = intMapped_(payload, 'accessLevel',
    ['accessLevel', 'level', 'requestedRole', 'requestedAccess'], '');
  if (!level && (code === 'VPN_ACCESS' || code === 'EMAIL_ACCOUNT')) level = 'Standard';
  level = sanitizeText(level, 40);
  if (['Admin', 'Standard'].indexOf(level) === -1) {
    throw new Error('Access adapter ต้อง map ระดับสิทธิ์เป็น Admin หรือ Standard');
  }
  let requestType = intMapped_(payload, 'requestType', ['requestType'], '');
  if (!requestType) requestType = code === 'ACCESS_REVOKE' ? 'เพิกถอนสิทธิ์' : 'ขอเพิ่มสิทธิ์';
  if (['ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์'].indexOf(requestType) === -1) {
    throw new Error('Access adapter มี RequestType ไม่ถูกต้อง');
  }
  const id = generateId('ACR');
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST_INTENT', SHEETS.ACCESS_REQ, id,
    request.RequestID, 'pending');
  intAppendLocked_(SHEETS.ACCESS_REQ, {
    ReqID: id,
    RequesterEmail: request.RequesterEmail,
    RequesterName: request.RequesterName,
    Department: request.Department,
    SystemName: system,
    AccessLevel: level,
    Reason: sanitizeText(request.BusinessJustification || request.Summary, 1000),
    RequestType: requestType,
    RequestDate: request.Timestamp || new Date(),
    Approver: approvedBy,
    ApprovedBy: approvedBy,
    ApproveDate: request.ApprovedAt || new Date(),
    ApproveResult: 'อนุมัติผ่าน Service Request ' + request.RequestID,
    Status: 'รอส่วนงานไอทีดำเนินการ',
    SourceServiceRequestID: request.RequestID,
    WorkflowInstanceID: request.WorkflowInstanceID || '',
    Notes: intSourceMarker_(request.RequestID, job.IntegrationID)
  }, actor.email);
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.ACCESS_REQ, id,
    request.RequestID, 'success');
  return { id: id, created: true };
}

function intCreateTicketLocked_(request, payload, job, actor) {
  ensureSheetBySchema_(SHEETS.TICKET);
  ensureSheetBySchema_(SHEETS.TICKET_CATEGORY);
  ensureSheetBySchema_(SHEETS.TICKET_WORKLOG);
  const prior = intFindReverseTarget_('ticket', request.RequestID);
  if (prior) {
    intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.TICKET, prior,
      request.RequestID + ' duplicate/reconciled', 'success');
    return { id: prior, created: false };
  }
  const code = String(request.ServiceCode || '').toUpperCase();
  const fallbackCategory = code === 'SOFTWARE_INSTALL' ? 'Software' : 'ขอรับบริการ IT';
  const categoryName = sanitizeText(intMapped_(payload, 'category', ['category'], fallbackCategory), 120);
  const category = readSheetObjectsEnsured_(SHEETS.TICKET_CATEGORY).filter(function (row) {
    return String(row.CategoryName) === categoryName &&
      (!row.Status || String(row.Status).toLowerCase() === 'active');
  })[0];
  if (!category) throw new Error('Ticket adapter ไม่พบหมวด Ticket ที่ Active: ' + categoryName);

  const priority = sanitizeText(request.Priority, 40) || category.DefaultPriority || 'ปานกลาง';
  if (['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'].indexOf(priority) === -1) {
    throw new Error('Ticket adapter มีระดับความเร่งด่วนไม่ถูกต้อง');
  }
  const responseHours = parseInt(category.ResponseSLAHours, 10) || 4;
  const resolutionHours = parseInt(category.ResolutionSLAHours || category.SLAHours, 10) || 24;
  const now = new Date();
  let assetId = sanitizeText(intMapped_(payload, 'assetId', ['assetId', 'assetCode'], ''), 80);
  let assetName = '';
  if (assetId) {
    const asset = intFindAsset_(assetId);
    if (!asset || intAssetRetired_(asset.Status)) throw new Error('Ticket adapter อ้างถึง Asset ที่ไม่มีอยู่หรือเลิกใช้แล้ว');
    assetId = asset.AssetID;
    assetName = asset.AssetName;
  }
  const id = generateId('TCK');
  const description = intServiceDescription_(request, payload.details);
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST_INTENT', SHEETS.TICKET, id,
    request.RequestID, 'pending');
  intAppendLocked_(SHEETS.TICKET, {
    TicketID: id,
    Title: sanitizeText(request.Summary || request.ServiceName, 200),
    RequesterEmail: request.RequesterEmail,
    RequesterName: request.RequesterName,
    Department: request.Department,
    Category: categoryName,
    Priority: priority,
    ResponseSLAHours: responseHours,
    ResponseDueAt: addBusinessHours_(now, responseHours),
    ResolutionSLAHours: resolutionHours,
    SLAHours: resolutionHours,
    DueAt: addBusinessHours_(now, resolutionHours),
    AssetID: assetId,
    AssetName: assetName,
    Description: description,
    Assignee: request.Assignee || '',
    IsSecurity: String(category.IsSecurityDefault).toLowerCase() === 'yes' ? 'Yes' : 'No',
    Status: 'ใหม่',
    RequesterIdentityType: 'EMAIL',
    SourceChannel: 'SERVICE_CATALOG',
    SourceServiceRequestID: request.RequestID,
    Notes: intSourceMarker_(request.RequestID, job.IntegrationID)
  }, actor.email);
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.TICKET, id,
    request.RequestID, 'success');
  return { id: id, created: true };
}

function intLinkAssetLocked_(request, payload, job, actor) {
  ensureSheetBySchema_(SHEETS.ASSET);
  let assetRef = sanitizeText(intMapped_(payload, 'assetId', ['assetId', 'assetCode'], ''), 80);
  if (!assetRef) throw new Error('Asset adapter ต้องระบุ assetId/assetCode ก่อน link');
  const asset = intFindAsset_(assetRef);
  if (!asset) throw new Error('ไม่พบ Asset ที่ต้องการ link');
  if (intAssetRetired_(asset.Status)) throw new Error('ไม่สามารถ link Asset ที่จำหน่าย/สูญหายแล้ว');
  intWriteAuditLocked_(actor, 'LINK_FROM_SERVICE_REQUEST_INTENT', SHEETS.ASSET, asset.AssetID,
    request.RequestID, 'pending');
  intPatchReverseRowLocked_(SHEETS.ASSET, asset._row, request.RequestID, actor.email,
    intSourceMarker_(request.RequestID, job.IntegrationID));
  intWriteAuditLocked_(actor, 'LINK_FROM_SERVICE_REQUEST', SHEETS.ASSET, asset.AssetID,
    request.RequestID, 'success');
  return { id: asset.AssetID, created: false };
}

function intCreateChangeLocked_(request, payload, job, actor) {
  ensureSheetBySchema_(SHEETS.CHANGE);
  const prior = intFindReverseTarget_('change', request.RequestID);
  if (prior) {
    intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.CHANGE, prior,
      request.RequestID + ' duplicate/reconciled', 'success');
    return { id: prior, created: false };
  }
  const system = sanitizeText(intMapped_(payload, 'system',
    ['system', 'destination', 'accessSystems'], ''), 150);
  if (!system) throw new Error('Change adapter ต้องระบุระบบ/ปลายทางที่ได้รับผลกระทบ');
  let risk = sanitizeText(intMapped_(payload, 'riskLevel', ['riskLevel'], ''), 20);
  if (!risk) risk = request.Priority === 'วิกฤต' || request.Impact === 'วิกฤต' ? 'สูง' : 'กลาง';
  if (['สูง', 'กลาง', 'ต่ำ'].indexOf(risk) === -1) throw new Error('Change adapter มี RiskLevel ไม่ถูกต้อง');
  const rollback = sanitizeText(intMapped_(payload, 'rollbackPlan', ['rollbackPlan'], ''), 2000);
  const id = generateId('CHG');
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST_INTENT', SHEETS.CHANGE, id,
    request.RequestID, 'pending');
  intAppendLocked_(SHEETS.CHANGE, {
    ChangeID: id,
    Title: sanitizeText(request.Summary || request.ServiceName, 200),
    SystemAffected: system,
    ChangeType: sanitizeText(intMapped_(payload, 'changeType', ['changeType'], 'Standard'), 60),
    Description: intServiceDescription_(request, payload.details),
    Requester: request.RequesterEmail,
    RequestDate: new Date(),
    ImpactAssessment: sanitizeText(request.BusinessJustification || request.Impact, 2000),
    RiskLevel: risk,
    RollbackPlan: rollback,
    Status: 'ยื่นคำขอ',
    SourceServiceRequestID: request.RequestID,
    WorkflowInstanceID: request.WorkflowInstanceID || '',
    Notes: intSourceMarker_(request.RequestID, job.IntegrationID)
  }, actor.email);
  intWriteAuditLocked_(actor, 'CREATE_FROM_SERVICE_REQUEST', SHEETS.CHANGE, id,
    request.RequestID, 'success');
  return { id: id, created: true };
}

// ============================================================================
// Relationship / reverse-link helpers
// ============================================================================

function intPrimaryTargetId_(request, target) {
  const cfg = INT_TARGETS[target];
  return cfg ? sanitizeText(request[cfg.relatedField], 160) : '';
}

function intSetPrimaryLinkLocked_(request, target, targetRecordId, actorEmail) {
  const field = INT_TARGETS[target].relatedField;
  const current = String(request[field] || '').trim();
  if (current && current !== String(targetRecordId)) {
    throw new Error(field + ' มี primary link อื่นอยู่แล้ว');
  }
  const patch = {};
  patch[field] = targetRecordId;
  intUpdateLocked_(SHEETS.SERVICE_REQUEST, request._row, patch, actorEmail);
}

function intUpsertRecordLinkLocked_(requestId, target, targetRecordId, job, actorEmail) {
  const existing = readSheetObjectsEnsured_(SHEETS.RECORD_LINK).filter(function (row) {
    return String(row.SourceModule) === INT_SOURCE_MODULE && String(row.SourceRecordID) === String(requestId) &&
      String(row.TargetModule) === target && String(row.TargetRecordID) === String(targetRecordId) &&
      String(row.Status || 'Active') !== 'Cancelled';
  })[0];
  if (existing) return existing.LinkID;
  const id = generateId('LNK');
  intAppendLocked_(SHEETS.RECORD_LINK, {
    LinkID: id,
    SourceModule: INT_SOURCE_MODULE,
    SourceRecordID: requestId,
    TargetModule: target,
    TargetRecordID: targetRecordId,
    LinkType: INT_TARGETS[target].linkType,
    IsPrimary: 'Yes',
    Status: 'Active',
    CreatedAt: new Date(),
    Notes: 'IntegrationID=' + job.IntegrationID + '\nIdempotencyKey=' + job.IdempotencyKey
  }, actorEmail);
  return id;
}

function intFindReverseTarget_(target, requestId) {
  const cfg = INT_TARGETS[target];
  if (!cfg) return '';
  ensureSheetBySchema_(cfg.sheet);
  const marker = 'SourceServiceRequestID=' + requestId;
  const rows = readSheetObjectsEnsured_(cfg.sheet);
  const exact = rows.filter(function (item) {
    return String(item.SourceServiceRequestID || '') === String(requestId);
  });
  if (exact.length > 1) throw new Error('พบรายการปลายทางมากกว่าหนึ่งรายการสำหรับ SourceServiceRequestID เดียวกัน');
  if (exact.length === 1) return String(exact[0][cfg.idField] || '');

  // Migration-only fallback for rows created before SourceServiceRequestID was
  // added. Require both durable markers and reject ambiguity; a free-form note
  // containing only the request ID is never sufficient provenance.
  const legacy = rows.filter(function (item) {
    if (String(item.SourceServiceRequestID || '').trim()) return false;
    const notes = String(item.Notes || '');
    return notes.split(/\r?\n/).indexOf(marker) > -1 &&
      /(?:^|\n)IntegrationID=[A-Za-z0-9_-]{5,}(?:\n|$)/.test(notes);
  });
  if (legacy.length > 1) throw new Error('พบ legacy integration marker ซ้ำมากกว่าหนึ่งรายการ');
  return legacy.length ? String(legacy[0][cfg.idField] || '') : '';
}

function intPatchReverseLinkLocked_(target, targetRecordId, requestId, actorEmail) {
  const cfg = INT_TARGETS[target];
  const row = intFindRowLocked_(cfg.sheet, cfg.idField, targetRecordId);
  if (!row) throw new Error('ไม่พบรายการปลายทางสำหรับ reverse link');
  intPatchReverseRowLocked_(cfg.sheet, row._row, requestId, actorEmail,
    'SourceServiceRequestID=' + requestId);
}

function intPatchReverseRowLocked_(sheetName, rowNumber, requestId, actorEmail, marker) {
  const row = intRowAtLocked_(sheetName, rowNumber);
  if (!row) throw new Error('ไม่พบแถวสำหรับ reverse link');
  const headers = intHeadersLocked_(sheetName);
  const patch = {};
  const provenance = intReverseProvenanceState_(row, requestId);
  if (headers.indexOf('SourceServiceRequestID') > -1) {
    const current = provenance.currentSource;
    if (!current) patch.SourceServiceRequestID = requestId;
  }
  if (headers.indexOf('Notes') > -1) {
    const notes = String(row.Notes || '');
    const sourceMarker = 'SourceServiceRequestID=' + requestId;
    if (notes.split(/\r?\n/).indexOf(sourceMarker) === -1) {
      patch.Notes = notes ? notes + '\n' + (marker || sourceMarker) : (marker || sourceMarker);
    }
  }
  if (Object.keys(patch).length) intUpdateLocked_(sheetName, rowNumber, patch, actorEmail);
}

function intReverseProvenanceState_(row, requestId) {
  requestId = String(requestId || '').trim();
  if (!requestId) throw new Error('Source Service Request ID ไม่ถูกต้อง');
  const currentSource = String(row && row.SourceServiceRequestID || '').trim();
  const markers = [];
  String(row && row.Notes || '').split(/\r?\n/).forEach(function (line) {
    const match = String(line || '').trim().match(/^SourceServiceRequestID=(.+)$/);
    if (!match) return;
    const value = String(match[1] || '').trim();
    if (value && markers.indexOf(value) === -1) markers.push(value);
  });
  const conflicts = markers.filter(function (value) { return value !== requestId; });
  if ((currentSource && currentSource !== requestId) || conflicts.length) {
    throw new Error('รายการปลายทางมี reverse provenance ของ Service Request อื่น');
  }
  return {
    currentSource: currentSource,
    markers: markers,
    needsRepair: !currentSource || markers.indexOf(requestId) === -1
  };
}

function intTargetExists_(target, targetRecordId) {
  const cfg = INT_TARGETS[target];
  return !!(cfg && intFindRowLocked_(cfg.sheet, cfg.idField, targetRecordId));
}

function intTargetLifecycleStatus_(target, targetRecordId) {
  const cfg = INT_TARGETS[target];
  const row = cfg && findRowEnsured_(cfg.sheet, cfg.idField, targetRecordId);
  return row ? String(row.Status || 'LINKED') : 'MISSING';
}

// ============================================================================
// Config, mapping, visibility, validation
// ============================================================================

function intResolveIntegrationConfig_(request, explicitConfig) {
  let raw = explicitConfig;
  if (!raw) {
    const workflow = intParseJson_(request.WorkflowJSON, 'WorkflowJSON', {});
    raw = workflow.integration || (workflow.definition && workflow.definition.integration) || null;
  }
  if (raw) {
    raw = intSafeCopy_(raw, 'integration config');
    return {
      target: raw.target || raw.fulfillmentTarget || raw.adapter || '',
      autoCreate: intIsYes_(raw.autoCreate !== undefined ? raw.autoCreate : raw.autoCreateTarget),
      mapping: intMappingObject_(raw.mapping !== undefined ? raw.mapping : raw.targetMapping)
    };
  }

  // Transaction routing is immutable. Older requests that have no integration
  // snapshot must never inherit a later live-catalog policy retroactively.
  return null;
}

function intBuildPayload_(request, mapping, integrationId) {
  const details = intParseJson_(request.RequestDetailsJSON, 'RequestDetailsJSON', {});
  return {
    integrationId: integrationId,
    requestId: String(request.RequestID || ''),
    catalogId: String(request.CatalogID || ''),
    catalogVersion: parseInt(request.CatalogVersion, 10) || 1,
    serviceCode: String(request.ServiceCode || ''),
    requesterEmail: String(request.RequesterEmail || '').toLowerCase(),
    requesterName: String(request.RequesterName || ''),
    department: String(request.Department || ''),
    requestedFor: String(request.RequestedFor || ''),
    summary: String(request.Summary || ''),
    priority: String(request.Priority || ''),
    impact: String(request.Impact || ''),
    details: details,
    mapping: intMappingObject_(mapping)
  };
}

function intMapped_(payload, key, detailKeys, fallback) {
  const mapping = payload && payload.mapping && typeof payload.mapping === 'object' ? payload.mapping : {};
  const map = mapping.fields && typeof mapping.fields === 'object' ? mapping.fields :
    (mapping.fieldMap && typeof mapping.fieldMap === 'object' ? mapping.fieldMap : mapping);
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    const value = intResolveMapValue_(map[key], payload);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  const details = payload && payload.details && typeof payload.details === 'object' ? payload.details : {};
  for (let i = 0; i < (detailKeys || []).length; i++) {
    const detailKey = detailKeys[i];
    if (Object.prototype.hasOwnProperty.call(details, detailKey) &&
      details[detailKey] !== null && String(details[detailKey]).trim() !== '') return details[detailKey];
  }
  return fallback;
}

function intResolveMapValue_(spec, payload) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    if (Object.prototype.hasOwnProperty.call(spec, 'value')) return spec.value;
    spec = spec.source || spec.from || '';
  }
  if (typeof spec !== 'string') return spec;
  if (spec.charAt(0) !== '$') return spec;
  const match = /^\$(details|request)\.([A-Za-z][A-Za-z0-9_]{0,79})$/.exec(spec);
  if (!match) throw new Error('TargetMappingJSON source path ไม่ได้รับอนุญาต');
  if (match[1] === 'details') return payload.details && payload.details[match[2]];
  const requestMap = {
    requestId: payload.requestId,
    serviceCode: payload.serviceCode,
    requesterEmail: payload.requesterEmail,
    requesterName: payload.requesterName,
    department: payload.department,
    requestedFor: payload.requestedFor,
    summary: payload.summary,
    priority: payload.priority,
    impact: payload.impact
  };
  if (!Object.prototype.hasOwnProperty.call(requestMap, match[2])) {
    throw new Error('TargetMappingJSON request field ไม่ได้รับอนุญาต');
  }
  return requestMap[match[2]];
}

function intNormalizeTarget_(value) {
  const target = String(value || '').toLowerCase().replace(/[\s_-]/g, '');
  if (['access', 'accessrequest', 'accessrequests'].indexOf(target) > -1) return 'access';
  if (['ticket', 'tickets', 'helpdesk'].indexOf(target) > -1) return 'ticket';
  if (['asset', 'assets', 'assetregister'].indexOf(target) > -1) return 'asset';
  if (['change', 'changes', 'changerequest', 'changerequests'].indexOf(target) > -1) return 'change';
  return '';
}

function intSourceReadyForIntegration_(request) {
  const status = String(request.Status || '');
  const approval = String(request.ApprovalStatus || '');
  if (status === 'รออนุมัติ' || approval === 'รออนุมัติ') return false;
  return approval === 'อนุมัติ' || approval === 'ไม่ต้องอนุมัติ';
}

function intServiceRequestTerminal_(status) {
  return ['ปิดงาน', 'ปฏิเสธ', 'ยกเลิก'].indexOf(String(status || '')) > -1;
}

function intCanViewServiceRequest_(request, user) {
  if (!request || !user) return false;
  if (typeof svcCanViewRequest_ === 'function') return svcCanViewRequest_(request, user);
  const email = String(user.email || '').toLowerCase();
  return user.role === ROLES.IT_ADMIN ||
    String(request.RequesterEmail || '').toLowerCase() === email ||
    String(request.Approver || '').toLowerCase() === email ||
    String(request.Assignee || '').toLowerCase() === email;
}

function intCanViewTarget_(target, targetRecordId, user) {
  target = intNormalizeTarget_(target);
  if (!target || !targetRecordId || !user) return false;
  if (user.role === ROLES.IT_ADMIN) return true;
  if (!canAccessModule(user.role, target)) return false;
  const cfg = INT_TARGETS[target];
  const row = findRowEnsured_(cfg.sheet, cfg.idField, targetRecordId);
  if (!row) return false;
  const email = String(user.email || '').toLowerCase();
  if (target === 'access') {
    return String(row.RequesterEmail || '').toLowerCase() === email ||
      String(row.Approver || '').toLowerCase() === email;
  }
  if (target === 'ticket' && user.role === ROLES.USER) {
    return String(row.RequesterEmail || '').toLowerCase() === email;
  }
  return true;
}

function intFindAsset_(idOrCode) {
  const value = String(idOrCode || '').trim();
  return readSheetObjectsEnsured_(SHEETS.ASSET).filter(function (row) {
    return String(row.AssetID) === value || String(row.AssetCode) === value;
  })[0] || null;
}

function intAssetRetired_(status) {
  if (typeof isAssetRetired_ === 'function') return isAssetRetired_(status);
  return ['จำหน่าย/เลิกใช้', 'สูญหาย', 'retired'].indexOf(String(status || '').toLowerCase()) > -1;
}

function intServiceDescription_(request, details) {
  let text = sanitizeText(request.BusinessJustification || request.Summary, 1800);
  const json = JSON.stringify(details || {});
  if (json && json !== '{}') text += (text ? '\n' : '') + 'รายละเอียดคำขอ: ' + json;
  return sanitizeText(text, 3000);
}

// ============================================================================
// Safe JSON / storage / audit helpers
// ============================================================================

function intEnsureSheets_() {
  [SHEETS.RECORD_LINK, SHEETS.INTEGRATION_OUTBOX, SHEETS.SERVICE_REQUEST,
    SHEETS.SERVICE_REQUEST_HISTORY].forEach(function (name) { ensureSheetBySchema_(name); });
}

function intWithScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function intAppendLocked_(sheetName, data, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = intHeadersLocked_(sheetName);
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

function intUpdateLocked_(sheetName, rowNumber, patch, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = intHeadersLocked_(sheetName);
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  const now = new Date();
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, header)) values[index] = sheetSafeValue_(patch[header]);
    if (header === 'LastUpdatedBy') values[index] = actorEmail || '';
    if (header === 'LastUpdatedAt') values[index] = now;
  });
  range.setValues([values]);
  return true;
}

function intHeadersLocked_(sheetName) {
  const sh = getSheet_(sheetName);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function intFindRowLocked_(sheetName, keyField, keyValue) {
  const rows = readSheetObjectsEnsured_(sheetName, true);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][keyField]) === String(keyValue)) return rows[i];
  }
  return null;
}

function intRowAtLocked_(sheetName, rowNumber) {
  const sh = getSheet_(sheetName);
  if (rowNumber < 2 || rowNumber > sh.getLastRow()) return null;
  const headers = intHeadersLocked_(sheetName);
  const values = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const row = { _row: rowNumber };
  headers.forEach(function (header, index) { row[header] = values[index]; });
  return row;
}

function intAddServiceHistoryLocked_(request, actor, action, comment, isPublic) {
  const cleanAction = sanitizeText(action, 80);
  const cleanComment = sanitizeText(comment, 2000);
  const existing = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST_HISTORY, true).filter(function (row) {
    return String(row.RequestID || '') === String(request.RequestID || '') &&
      String(row.Action || '') === cleanAction && String(row.Comment || '') === cleanComment;
  })[0];
  if (existing) return existing.HistoryID;
  const historyId = generateId('SRH');
  intAppendLocked_(SHEETS.SERVICE_REQUEST_HISTORY, {
    HistoryID: historyId,
    RequestID: request.RequestID,
    Action: cleanAction,
    StatusFrom: request.Status,
    StatusTo: request.Status,
    Comment: cleanComment,
    ActorEmail: actor.email,
    ActorRole: actor.role || '',
    IsPublic: isPublic ? 'Yes' : 'No'
  }, actor.email);
  return historyId;
}

function intWriteAuditLocked_(actor, action, targetSheet, targetId, detail, result) {
  try {
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
      LogID: logId, Timestamp: new Date(), ActorEmail: actor && actor.email || '',
      ActorRole: actor && actor.role || '', Action: action, Module: 'integration',
      TargetSheet: targetSheet || '', TargetID: targetId || '', Detail: detail || '',
      IPHint: '', Result: result || 'success'
    };
    sh.appendRow(headers.map(function (header) {
      return sheetSafeValue_(row[header] === undefined || row[header] === null ? '' : row[header]);
    }));
    const logIdColumn = headers.indexOf('LogID') + 1;
    if (String(sh.getRange(sh.getLastRow(), logIdColumn).getValue() || '') !== logId) {
      throw new Error('Integration audit write could not be verified');
    }
    return logId;
  } catch (e) {
    console.error('intWriteAuditLocked_: ' + e.message);
    throw new Error('Integration audit write failed; transaction will be retried');
  }
}

function intWriteAuditSafe_(actor, action, targetSheet, targetId, detail, result) {
  try { writeAudit_(actor, action, 'integration', targetSheet, targetId, detail, result); }
  catch (e) { console.error('intWriteAuditSafe_: ' + e.message); }
}

function intActor_(actor, fallbackEmail) {
  if (actor && typeof actor === 'object') {
    return {
      email: String(actor.email || fallbackEmail || 'system').toLowerCase(),
      name: String(actor.name || actor.email || fallbackEmail || 'system'),
      role: String(actor.role || 'SYSTEM'),
      _requiredRole: String(actor._requiredRole || '')
    };
  }
  const email = String(actor || fallbackEmail || 'system').toLowerCase();
  return { email: email, name: email, role: 'SYSTEM' };
}

function intAssertAuditReadyLocked_() {
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

function intReauthorizeMutationActorLocked_(actor, permissionKey, requiredRole) {
  const actorObj = intActor_(actor, 'system');
  intAssertAuditReadyLocked_();
  if (actorObj.email === 'system') return actorObj;
  if (typeof apResetRuntimeReadCache_ === 'function') apResetRuntimeReadCache_();
  const row = typeof wfActiveUser_ === 'function' ? wfActiveUser_(actorObj.email) : null;
  if (!row) throw new Error('บัญชีผู้ดำเนินการไม่อยู่ในสถานะ Active');
  const fresh = {
    email: actorObj.email,
    name: row.FullName || actorObj.name || actorObj.email,
    role: row.Role,
    dept: row.Department || ''
  };
  const lockedRequiredRole = String(requiredRole || actorObj._requiredRole || '');
  if (lockedRequiredRole && fresh.role !== lockedRequiredRole) {
    throw new Error('บทบาทผู้ดำเนินการไม่ตรงกับข้อกำหนดของ API');
  }
  wfRequireActionPermission_(fresh, permissionKey);
  fresh._requiredRole = lockedRequiredRole;
  return fresh;
}

function intParseJson_(raw, label, fallback) {
  if (raw === '' || raw === null || raw === undefined) return fallback;
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > 30000) throw new Error(label + ' ยาวเกินไป');
    try { value = JSON.parse(raw); }
    catch (e) { throw new Error(label + ' ต้องเป็น JSON ที่ถูกต้อง'); }
  }
  return intSafeCopy_(value, label);
}

function intSafeCopy_(value, label) {
  const copy = JSON.parse(JSON.stringify(value));
  intAssertSafeObject_(copy, label || 'JSON', 0, { count: 0 });
  return copy;
}

function intAssertSafeObject_(value, label, depth, state) {
  if (depth > 20) throw new Error(label + ' ซ้อนระดับลึกเกินไป');
  if (value === null || typeof value !== 'object') return true;
  state.count++;
  if (state.count > 2000) throw new Error(label + ' มีข้อมูลมากเกินไป');
  Object.keys(value).forEach(function (key) {
    if (['__proto__', 'prototype', 'constructor'].indexOf(key) > -1) {
      throw new Error(label + ' มี key ที่ไม่ปลอดภัย');
    }
    intAssertSafeObject_(value[key], label, depth + 1, state);
  });
  return true;
}

function intMappingObject_(raw) {
  if (!raw) return {};
  const value = typeof raw === 'string' ? intParseJson_(raw, 'TargetMappingJSON', {}) :
    intSafeCopy_(raw, 'TargetMappingJSON');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TargetMappingJSON ต้องเป็น object');
  }
  return value;
}

function intIsYes_(value) {
  if (value === true || value === 1) return true;
  return ['yes', 'true', '1', 'ใช่', 'auto'].indexOf(String(value || '').toLowerCase().trim()) > -1;
}

function intDateMs_(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function intDue_(value, now) {
  const at = intDateMs_(value);
  return !at || at <= (now || new Date()).getTime();
}

function intAppendNote_(oldValue, actor, note) {
  const entry = '[' + fmtDateTime(new Date()) + ' ' + actor + '] ' + sanitizeText(note, 500);
  return oldValue ? String(oldValue) + ' | ' + entry : entry;
}

function intSourceMarker_(requestId, integrationId) {
  return 'SourceServiceRequestID=' + requestId + '\nIntegrationID=' + integrationId;
}
