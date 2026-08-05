/**
 * Module_AttachmentRegistry.gs
 *
 * Central, private attachment registry. Drive IDs never leave this module.
 * Public entry points are intentionally small; all record authorization is
 * server-side and defaults to deny for an unknown module or record type.
 *
 * Required schema constants (installed by Config/Setup):
 *   SHEETS.ATTACHMENT_REGISTRY
 *   SHEETS.ATTACHMENT_LINK
 *   SHEETS.ATTACHMENT_ACCESS_LOG
 */

var AR_MAX_UPLOAD_BYTES_ = 15 * 1024 * 1024;
var AR_DEFAULT_DOWNLOAD_MB_ = 10;
var AR_MAX_DOWNLOAD_MB_ = 15;
var AR_ACTIVE_STATUS_ = ['ACTIVE', 'STAGED'];

var AR_MIME_POLICY_ = {
  pdf:  { mime: 'application/pdf', claimed: ['application/pdf'] },
  jpg:  { mime: 'image/jpeg', claimed: ['image/jpeg'] },
  jpeg: { mime: 'image/jpeg', claimed: ['image/jpeg'] },
  png:  { mime: 'image/png', claimed: ['image/png'] },
  gif:  { mime: 'image/gif', claimed: ['image/gif'] },
  webp: { mime: 'image/webp', claimed: ['image/webp'] },
  heic: { mime: 'image/heic', claimed: ['image/heic', 'image/heif', 'application/octet-stream'] },
  txt:  { mime: 'text/plain', claimed: ['text/plain', 'application/octet-stream'] },
  csv:  { mime: 'text/csv', claimed: ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'] },
  doc:  { mime: 'application/msword', claimed: ['application/msword', 'application/octet-stream'] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    claimed: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'] },
  xls:  { mime: 'application/vnd.ms-excel', claimed: ['application/vnd.ms-excel', 'application/octet-stream'] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    claimed: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'] }
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Upload a private Drive file and create a durable registry entry.
 * payload: {
 *   base64, filename|name, mimeType,
 *   moduleKey|module, recordId?, recordType|entityType?,
 *   fieldName?, attachmentRole?, classification?, isEvidence?
 * }
 */
function uploadRegisteredAttachment(payload) {
  let actor = null;
  let context = null;
  let createdFile = null;
  let createdAttachment = null;
  try {
    actor = getCurrentUser();
    payload = payload || {};
    context = arNormalizeContext_(payload.moduleKey || payload.module,
      payload.recordId || payload.entityId, payload);
    if (context.recordId && ['ServiceRequest', 'ServiceRequestTask', 'Ticket', 'PersonalTask']
      .indexOf(context.recordType) > -1) {
      throw new Error('This module requires a STAGED upload followed by its authenticated business API');
    }
    arAuthorizeUploadContext_(actor, context);
    arEnsureRegistryStorage_(!!context.recordId);

    const decoded = arDecodeAndValidateUpload_(payload);
    const checksum = arSha256Hex_(decoded.bytes);
    const safeName = arSafeFileName_(payload.filename || payload.name);
    const classification = arClassification_(payload.classification, context);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    let criticalIntent = null;
    let criticalCompleted = false;
    try {
      actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', context,
        { recordAction: context.recordId ? 'write' : '' });
      // A record-bound upload owns its own physical/registry row. Reusing a
      // merely-STAGED row across operations creates a race where one request's
      // compensation can destroy another request's newly committed link.
      const duplicate = context.recordId ? null :
        arFindReusableDuplicate_(checksum, decoded.bytes.length, actor, context);
      if (duplicate) {
        createdAttachment = duplicate;
      } else {
        const attachmentId = generateId('ATT');
        criticalIntent = arBeginCriticalAuditLocked_({
          AttachmentID: attachmentId, ModuleKey: context.moduleKey,
          RecordID: context.recordId, SizeBytes: decoded.bytes.length
        }, actor, 'UPLOAD', context, safeName);
        const storedName = attachmentId + '_' + safeName;
        const folder = getEvidenceFolder_(context.moduleKey);
        createdFile = folder.createFile(Utilities.newBlob(decoded.bytes, decoded.mimeType, storedName));
        createdFile.setName(storedName);
        createdFile.setDescription('App LIFE attachment ' + attachmentId + ' uploaded by ' + actor.email);
        const sharingScope = arDriveSharingScope_(createdFile);
        if (arUnsafeSharingScope_(sharingScope)) {
          throw new Error('Attachment storage is configured with public or domain-wide Drive sharing');
        }

        const retentionUntil = arDefaultRetentionUntil_(context);
        const row = arRegistryWriteObject_({
          attachmentId: attachmentId,
          moduleKey: context.moduleKey,
          recordId: context.recordId,
          fileId: createdFile.getId(),
          fileName: safeName,
          storedName: storedName,
          extension: decoded.extension,
          claimedMimeType: decoded.claimedMimeType,
          detectedMimeType: decoded.mimeType,
          sizeBytes: decoded.bytes.length,
          checksum: checksum,
          parentFolderId: folder.getId(),
          sharingScope: sharingScope,
          source: 'REGISTERED_UPLOAD',
          classification: classification,
          uploadedBy: actor.email,
          uploadedAt: new Date(),
          status: 'STAGED',
          retentionUntil: retentionUntil,
          isEvidence: arTruthy_(payload.isEvidence) ? 'Yes' : 'No',
          notes: decoded.validationNote
        });
        arAppendDirect_(arRegistrySheetName_(), row, actor.email);
        createdAttachment = arFindAttachment_(attachmentId);
        if (!createdAttachment) throw new Error('Attachment registry write could not be verified');
        arCompleteCriticalAuditLocked_(criticalIntent, 'success',
          'REGISTERED checksum=' + checksum + ' bytes=' + decoded.bytes.length);
        criticalCompleted = true;
      }
    } catch (lockedError) {
      if (createdFile) {
        try { createdFile.setTrashed(true); } catch (ignoreTrash) {}
      }
      if (criticalIntent && !criticalCompleted) {
        try { arCompleteCriticalAuditLocked_(criticalIntent, 'error', lockedError.message); }
        catch (auditError) {
          throw new Error(lockedError.message + '; audit completion failed: ' + auditError.message);
        }
      }
      throw lockedError;
    } finally {
      lock.releaseLock();
    }

    const wasDuplicate = !createdFile;
    try {
      arLogAttachmentAction_(createdAttachment, actor, wasDuplicate ? 'DEDUP_REUSE' : 'UPLOAD',
        'success', decoded.validationNote || '', context);
    } catch (auditError) {
      // A newly-created file must never survive without a durable access-log
      // event. Reused content is not mutated when logging is unavailable.
      if (createdFile) arCompensateFailedUpload_(createdAttachment, createdFile, actor, auditError.message);
      throw auditError;
    }

    if (context.recordId) {
      try {
        const exactRetry = wasDuplicate && arHasExactActiveLink_(createdAttachment, context);
        if (!exactRetry) {
          createdAttachment = claimRegisteredAttachment_(arAttachmentId_(createdAttachment),
            context.moduleKey, context.recordId, {
              recordType: context.recordType,
              fieldName: context.fieldName,
              attachmentRole: context.attachmentRole,
              classification: classification,
              isEvidence: arTruthy_(payload.isEvidence)
            }, actor);
        }
      } catch (claimError) {
        // A new upload that cannot be linked is not allowed to become an
        // unregistered orphan. A reused file is left untouched.
        if (createdFile) arCompensateFailedUpload_(createdAttachment, createdFile, actor, claimError.message);
        throw claimError;
      }
    }

    return ok(Object.assign(arAttachmentDto_(createdAttachment, context), {
      deduplicated: wasDuplicate
    }), wasDuplicate ? 'Reused an identical registered attachment' : 'Attachment uploaded');
  } catch (e) {
    arBestEffortDeniedLog_(createdAttachment, actor, 'UPLOAD_DENIED', e.message, context);
    return fail(e.message, 'ATTACHMENT_UPLOAD_FAILED');
  }
}

/** Flexible signature: listRecordAttachments(moduleKey, recordId, recordType) or ({...}). */
function listRecordAttachments(moduleKey, recordId, recordType) {
  try {
    const actor = getCurrentUser();
    let opts = {};
    if (moduleKey && typeof moduleKey === 'object') {
      opts = moduleKey;
      moduleKey = opts.moduleKey || opts.module;
      recordId = opts.recordId || opts.entityId;
      recordType = opts.recordType || opts.entityType;
    }
    const context = arNormalizeContext_(moduleKey, recordId, { recordType: recordType });
    if (!context.recordId) throw new Error('recordId is required');
    arRequireAttachmentPermission_(actor, 'attachment.view', context);
    arAuthorizeRecord_(actor, context, 'read');
    arEnsureRegistryStorage_(true);

    const links = arLinksForRecord_(context).filter(arIsActiveLink_);
    const ids = {};
    links.forEach(function (link) { ids[arLinkAttachmentId_(link)] = link; });

    // Compatibility while existing rows are migrated to AttachmentLinks.
    const allRealLinks = arReadRows_(arLinkSheetName_());
    arReadRows_(arRegistrySheetName_()).forEach(function (row) {
      if (arAttachmentStatus_(row) === 'ACTIVE' &&
          arSame_(arRowModule_(row), context.moduleKey) &&
          arSame_(arRowRecordId_(row), context.recordId) && !ids[arAttachmentId_(row)] &&
          !allRealLinks.some(function (link) {
            return arSame_(arLinkAttachmentId_(link), arAttachmentId_(row));
          })) {
        ids[arAttachmentId_(row)] = arPseudoLink_(row, context);
      }
    });

    const rows = Object.keys(ids).map(function (id) {
      const row = arFindAttachment_(id);
      if (!row || !arIsVisibleAttachment_(row)) return null;
      return arAttachmentDto_(row, context, ids[id]);
    }).filter(Boolean).sort(function (a, b) {
      return String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
    });
    return ok({ moduleKey: context.moduleKey, recordId: context.recordId, attachments: rows });
  } catch (e) {
    return fail(e.message, 'ATTACHMENT_LIST_FAILED');
  }
}

/**
 * Download through the application after row-level authorization.
 * Returns base64 only up to ATTACHMENT_DOWNLOAD_MAX_MB (1..15, default 10).
 */
function downloadRegisteredAttachment(attachmentId) {
  let actor = null;
  let attachment = null;
  try {
    actor = getCurrentUser();
    attachmentId = sanitizeText(attachmentId, 120);
    arRequireAttachmentPermission_(actor, 'attachment.download', { attachmentId: attachmentId });
    attachment = authorizeRegisteredAttachment_(attachmentId, 'read', actor);
    const status = arAttachmentStatus_(attachment);
    if (AR_ACTIVE_STATUS_.indexOf(status) === -1) throw new Error('Attachment is not available for download');
    if (arStorageType_(attachment) === 'EXTERNAL_URL') {
      throw new Error('External references cannot be downloaded through this API');
    }

    const maxBytes = arDownloadLimitBytes_();
    const declaredSize = arAttachmentSize_(attachment);
    if (declaredSize > maxBytes) {
      throw new Error('Attachment exceeds the server download limit of ' + Math.round(maxBytes / 1048576) + ' MB');
    }
    const file = arLiveDriveFile_(attachment);
    if (file.getSize() > maxBytes) {
      throw new Error('Attachment exceeds the server download limit of ' + Math.round(maxBytes / 1048576) + ' MB');
    }
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    if (bytes.length > maxBytes) throw new Error('Attachment is too large to download through the application');

    const actualHash = arSha256Hex_(bytes);
    const expectedHash = arAttachmentHash_(attachment);
    if (expectedHash && expectedHash !== actualHash) {
      arMarkIntegrityFailure_(attachment, actor, actualHash);
      throw new Error('Attachment integrity verification failed');
    }

    arLogAttachmentAction_(attachment, actor, 'DOWNLOAD', 'success',
      'bytes=' + bytes.length, arPrimaryAuthorizedContext_(attachment, actor, 'read'));
    arUpdateAccessCounters_(attachment, actor);
    return ok({
      attachmentId: arAttachmentId_(attachment),
      filename: arAttachmentFileName_(attachment),
      mimeType: arAttachmentMime_(attachment),
      sizeBytes: bytes.length,
      checksumSHA256: actualHash,
      base64: Utilities.base64Encode(bytes)
    }, 'Attachment download prepared');
  } catch (e) {
    arBestEffortDeniedLog_(attachment, actor, 'DOWNLOAD_DENIED', e.message, null);
    return fail(e.message, 'ATTACHMENT_DOWNLOAD_FAILED');
  }
}

/** Soft-delete is denied when another active reference or any legal hold exists. */
function softDeleteRegisteredAttachment(attachmentId, reason) {
  let actor = null;
  let attachment = null;
  try {
    actor = getCurrentUser();
    attachmentId = sanitizeText(attachmentId, 120);
    reason = sanitizeText(reason, 500);
    if (!reason) throw new Error('A deletion reason is required');
    attachment = arFindAttachment_(attachmentId);
    if (!attachment) throw new Error('Attachment not found');
    const initialDeletePermission = arAttachmentUploader_(attachment) === arEmail_(actor.email) ?
      'attachment.delete_own' : 'attachment.delete_any';
    arRequireAttachmentPermission_(actor, initialDeletePermission, { attachmentId: attachmentId });
    if (arAttachmentStatus_(attachment) === 'TRASHED') {
      const sameOwner = arAttachmentUploader_(attachment) === arEmail_(actor.email) ||
        arEmail_(arValue_(attachment, ['SoftDeletedBy', 'TrashedBy'])) === arEmail_(actor.email);
      if (!sameOwner && actor.role !== ROLES.IT_ADMIN) throw new Error('Not authorized to access this deleted attachment');
      return ok(arAttachmentDto_(attachment), 'Attachment is already deleted');
    }
    if (arAttachmentReferencedByDurableIntent_(attachmentId)) {
      throw new Error('Attachment is protected by a durable business-record reference');
    }
    attachment = authorizeRegisteredAttachment_(attachmentId, 'delete', actor);
    let auditContext = null;
    arLogAttachmentAction_(attachment, actor, 'DELETE_INTENT', 'success', reason, null);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      attachment = arFindAttachment_(attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      if (arAttachmentStatus_(attachment) === 'TRASHED') return ok(arAttachmentDto_(attachment), 'Attachment is already deleted');
      if (arAttachmentReferencedByDurableIntent_(attachmentId)) {
        throw new Error('Attachment is protected by a durable business-record reference');
      }
      const links = arActiveLinksForAttachment_(attachment);
      auditContext = links.length ? arContextFromLink_(links[0]) : null;
      const deletePermission = arAttachmentUploader_(attachment) === arEmail_(actor.email) ?
        'attachment.delete_own' : 'attachment.delete_any';
      actor = arAuthorizeMutationLocked_(actor, deletePermission,
        auditContext || arNormalizeContext_(arRowModule_(attachment), '', {}),
        { recordAction: 'write' });
      authorizeRegisteredAttachment_(attachmentId, 'delete', actor);
      if (arAttachmentHasLegalHold_(attachment, links)) throw new Error('Attachment is protected by a legal hold');
      if (links.length > 1) {
        throw new Error('Attachment has ' + links.length + ' active references and cannot be deleted as one record');
      }
      if (arPhysicalFileReferenceCount_(attachment) > 1) {
        throw new Error('The same Drive file is registered by another active attachment and cannot be deleted');
      }
      const file = arStorageType_(attachment) === 'EXTERNAL_URL' ? null : arLiveDriveFile_(attachment);
      const cancelledLink = links.length && links[0]._row ? links[0] : null;
      const criticalIntent = arBeginCriticalAuditLocked_(attachment, actor, 'DELETE', auditContext, reason);
      try {
        if (file) file.setTrashed(true);
        if (cancelledLink) {
          arUpdateLinkDirect_(cancelledLink, {
            Status: 'CANCELLED', UnlinkedAt: new Date(), UnlinkedBy: actor.email,
            Notes: arAppendNote_(arValue_(cancelledLink, ['Notes']),
              'SOFT_DELETE_ATTACHMENT=' + attachmentId + ' · ' + reason)
          }, actor.email);
        }
        arUpdateRegistryDirect_(attachment, {
          Status: 'TRASHED', SoftDeletedAt: new Date(), TrashedAt: new Date(),
          SoftDeletedBy: actor.email, TrashedBy: actor.email,
          TrashReason: reason, ActiveLinkCount: 0
        }, actor.email);
        const deleted = arFindAttachment_(attachmentId);
        if (!deleted || arAttachmentStatus_(deleted) !== 'TRASHED') {
          throw new Error('Attachment deletion could not be verified');
        }
        arCompleteCriticalAuditLocked_(criticalIntent, 'success', reason);
      } catch (commitError) {
        if (file) { try { file.setTrashed(false); } catch (ignoreRestore) {} }
        if (cancelledLink) {
          try {
            arUpdateLinkDirect_(cancelledLink, {
              Status: 'ACTIVE', UnlinkedAt: '', UnlinkedBy: '',
              Notes: arAppendNote_(arValue_(cancelledLink, ['Notes']), 'soft-delete rollback')
            }, actor.email);
          } catch (ignoreLinkRollback) {}
        }
        try {
          arUpdateRegistryDirect_(attachment, {
            Status: links.length ? 'ACTIVE' : 'STAGED', SoftDeletedAt: '', SoftDeletedBy: '',
            TrashedAt: '', TrashedBy: '', TrashReason: '', ActiveLinkCount: links.length
          }, actor.email);
        } catch (ignoreRollback) {}
        try { arCompleteCriticalAuditLocked_(criticalIntent, 'error', commitError.message); }
        catch (auditError) {
          throw new Error(commitError.message + '; audit completion failed: ' + auditError.message);
        }
        throw commitError;
      }
    } finally {
      lock.releaseLock();
    }
    attachment = arFindAttachment_(attachmentId);
    arLogAttachmentAction_(attachment, actor, 'DELETE', 'success', reason, auditContext);
    return ok(arAttachmentDto_(attachment), 'Attachment moved to Drive trash');
  } catch (e) {
    arBestEffortDeniedLog_(attachment, actor, 'DELETE_DENIED', e.message, null);
    return fail(e.message, 'ATTACHMENT_DELETE_FAILED');
  }
}

function restoreRegisteredAttachment(attachmentId, reason) {
  let actor = null;
  let attachment = null;
  try {
    actor = getCurrentUser();
    attachmentId = sanitizeText(attachmentId, 120);
    reason = sanitizeText(reason, 500);
    attachment = arFindAttachment_(attachmentId);
    if (!attachment) throw new Error('Attachment not found');
    const restoreAdmin = actor.role === ROLES.IT_ADMIN ||
      (typeof wfHasActionPermission_ === 'function' &&
        wfHasActionPermission_(actor, 'attachment.admin', { attachmentId: attachmentId }));
    arRequireAttachmentPermission_(actor,
      restoreAdmin ? 'attachment.admin' :
        (arAttachmentUploader_(attachment) === arEmail_(actor.email) ? 'attachment.delete_own' : 'attachment.delete_any'),
      { attachmentId: attachmentId, restore: true });
    if (!arCanRestoreAttachment_(attachment, actor)) throw new Error('Not authorized to restore this attachment');
    if (arAttachmentStatus_(attachment) !== 'TRASHED') return ok(arAttachmentDto_(attachment), 'Attachment is not deleted');
    if (arRestoreRequiresAdmin_(attachment) && !reason) {
      throw new Error('An administrative retention-restore reason is required');
    }

    let restoreContext = null;
    arLogAttachmentAction_(attachment, actor, 'RESTORE_INTENT', 'success', '', null);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      attachment = arFindAttachment_(attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      if (arAttachmentStatus_(attachment) !== 'TRASHED') return ok(arAttachmentDto_(attachment), 'Attachment is not deleted');
      const restrictedRestore = arRestoreRequiresAdmin_(attachment);
      const restoreLinks = arSoftDeleteCancelledLinks_(attachment);
      const retentionLinks = restrictedRestore ? arRetentionExpiredLinks_(attachment) : [];
      const linksToReactivate = restoreLinks.concat(retentionLinks);
      restoreContext = linksToReactivate.length ? arContextFromLink_(linksToReactivate[0]) :
        (arRowRecordId_(attachment) ? arNormalizeContext_(arRowModule_(attachment),
          arRowRecordId_(attachment), { recordType: arValue_(attachment, ['RecordType', 'EntityType']) }) : null);
      const restorePermission = restrictedRestore ? 'attachment.admin' :
        (arAttachmentUploader_(attachment) === arEmail_(actor.email) ?
          'attachment.delete_own' : 'attachment.delete_any');
      actor = arAuthorizeMutationLocked_(actor, restorePermission, restoreContext,
        { recordAction: 'write', skipModuleCheck: restrictedRestore || !restoreContext });
      if (restrictedRestore && !(actor.role === ROLES.IT_ADMIN ||
          wfHasActionPermission_(actor, 'attachment.admin', { attachmentId: attachmentId }))) {
        throw new Error('Only an attachment administrator may override retention deletion');
      }
      if (!arCanRestoreAttachment_(attachment, actor)) throw new Error('Not authorized to restore this attachment');
      const restoreAction = restrictedRestore ? 'RESTORE_RETENTION_OVERRIDE' : 'RESTORE';
      const criticalIntent = arBeginCriticalAuditLocked_(attachment, actor, restoreAction,
        restoreContext, reason || 'restore');
      let file = null;
      const reactivatedLinks = [];
      try {
        if (arStorageType_(attachment) !== 'EXTERNAL_URL') {
          file = DriveApp.getFileById(arAttachmentFileId_(attachment));
          if (arUnsafeSharingScope_(arDriveSharingScope_(file))) throw new Error('Attachment sharing state is not private');
          if (file.isTrashed()) file.setTrashed(false);
        }
        const recoveryUntil = new Date(Date.now() + Math.max(1, Math.min(365,
          parseInt(getConfig_('ATTACHMENT_ADMIN_RESTORE_DAYS', '30'), 10) || 30)) * 86400000);
        linksToReactivate.forEach(function (link) {
          const previousStatus = String(arValue_(link, ['Status']) || 'CANCELLED').toUpperCase();
          arUpdateLinkDirect_(link, {
            Status: 'ACTIVE', UnlinkedAt: '', UnlinkedBy: '',
            RetainUntil: restrictedRestore ? recoveryUntil : arValue_(link, ['RetainUntil']),
            Notes: arAppendNote_(arValue_(link, ['Notes']),
              (restrictedRestore ? '[ADMIN_RETENTION_RESTORE] ' + reason :
                'restored attachment ' + attachmentId))
          }, actor.email);
          reactivatedLinks.push({ link: link, previousStatus: previousStatus });
        });
        // A restricted no-link recovery is an explicit admin-only ACTIVE
        // recovery state, not an unusable STAGED success.
        const status = linksToReactivate.length || restrictedRestore ? 'ACTIVE' : 'STAGED';
        arUpdateRegistryDirect_(attachment, {
          Status: status, SoftDeletedAt: '', SoftDeletedBy: '', TrashedAt: '',
          TrashedBy: '', TrashReason: '', ActiveLinkCount: linksToReactivate.length,
          EffectiveRetainUntil: restrictedRestore ? recoveryUntil :
            arValue_(attachment, ['EffectiveRetainUntil']),
          Notes: restrictedRestore ? arAppendNote_(arValue_(attachment, ['Notes']),
            '[ADMIN_RETENTION_RESTORE] ' + reason) : arValue_(attachment, ['Notes'])
        }, actor.email);
        const verifiedReactivated = arReadRows_(arLinkSheetName_()).filter(function (row) {
          return reactivatedLinks.some(function (entry) {
            return arSame_(arValue_(row, ['LinkID']), arValue_(entry.link, ['LinkID']));
          }) && arIsActiveLink_(row);
        });
        if (verifiedReactivated.length !== reactivatedLinks.length) {
          throw new Error('Restored attachment links could not be verified');
        }
        const restored = arFindAttachment_(attachmentId);
        if (!restored || arAttachmentStatus_(restored) !== status) {
          throw new Error('Attachment restore could not be verified');
        }
        arCompleteCriticalAuditLocked_(criticalIntent, 'success',
          (reason || 'restore') + ' status=' + status);
      } catch (commitError) {
        if (file) { try { file.setTrashed(true); } catch (ignoreTrash) {} }
        reactivatedLinks.forEach(function (entry) {
          try {
            arUpdateLinkDirect_(entry.link, {
              Status: entry.previousStatus, UnlinkedAt: new Date(), UnlinkedBy: actor.email,
              Notes: arAppendNote_(arValue_(entry.link, ['Notes']), 'restore rollback')
            }, actor.email);
          } catch (ignoreLinkRollback) {}
        });
        try {
          arUpdateRegistryDirect_(attachment, {
            Status: 'TRASHED', TrashedAt: new Date(), ActiveLinkCount: 0,
            TrashedBy: arValue_(attachment, ['TrashedBy', 'SoftDeletedBy']) || actor.email
          }, actor.email);
        } catch (ignoreRollback) {}
        try { arCompleteCriticalAuditLocked_(criticalIntent, 'error', commitError.message); }
        catch (auditError) {
          throw new Error(commitError.message + '; audit completion failed: ' + auditError.message);
        }
        throw commitError;
      }
    } finally {
      lock.releaseLock();
    }
    attachment = arFindAttachment_(attachmentId);
    arLogAttachmentAction_(attachment, actor,
      arRestoreRequiresAdmin_(attachment) ? 'RESTORE_RETENTION_OVERRIDE' : 'RESTORE',
      'success', reason || '', restoreContext);
    return ok(arAttachmentDto_(attachment), 'Attachment restored');
  } catch (e) {
    arBestEffortDeniedLog_(attachment, actor, 'RESTORE_DENIED', e.message, null);
    return fail(e.message, 'ATTACHMENT_RESTORE_FAILED');
  }
}

/** Privileged legal-hold APIs. Holds are stored on active AttachmentLinks. */
function setAttachmentLegalHold(attachmentId, reason) {
  return arSetAttachmentLegalHold_(attachmentId, true, reason);
}

function releaseAttachmentLegalHold(attachmentId, reason) {
  return arSetAttachmentLegalHold_(attachmentId, false, reason);
}

/**
 * Authorized proxy for legacy public Ticket evidence inherited by an
 * Incident. Raw Drive IDs/URLs never leave the server. New uploads must use
 * Attachment Registry; this endpoint exists only for controlled migration.
 */
function downloadIncidentLegacyTicketEvidence(incidentId) {
  let actor = null;
  let intent = null;
  let context = null;
  try {
    actor = getCurrentUser();
    incidentId = sanitizeText(incidentId, 120);
    context = arNormalizeContext_('incident', incidentId, { recordType: 'Incident' });
    let fileIds = [];
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      actor = arAuthorizeMutationLocked_(actor, 'attachment.legacy_incident_proxy', null,
        { skipModuleCheck: true });
      const incident = findRow_(SHEETS.INCIDENT, 'IncidentID', incidentId);
      if (!incident) throw new Error('Incident not found');
      if (actor.role !== ROLES.IT_ADMIN && !(actor.role === ROLES.DPO &&
          String(incident.ContainsPersonalData || '').toLowerCase() === 'yes')) {
        throw new Error('Legacy Incident evidence proxy is limited to ITAdmin or the DPO for a personal-data incident');
      }
      const ticketId = sanitizeText(incident.SourceTicketID, 120);
      const ticket = ticketId ? findRow_(SHEETS.TICKET, 'TicketID', ticketId) : null;
      if (!ticket || String(ticket.IncidentID || '') !== incidentId) {
        throw new Error('Mutual Ticket/Incident provenance is not verified');
      }
      if (arIntentIdList_(ticket.AttachmentIDsJSON).length) {
        throw new Error('Registered Incident evidence must use downloadRegisteredAttachment');
      }
      const seen = {};
      String(ticket.EvidenceLink || '').split(/\s+/).forEach(function (token) {
        const fileId = arStrictDriveFileId_(token);
        if (fileId && !seen[fileId]) { seen[fileId] = true; fileIds.push(fileId); }
      });
      if (!fileIds.length) throw new Error('No supported legacy Ticket evidence is available');
      intent = arBeginCriticalAuditLocked_(null, actor, 'LEGACY_INCIDENT_PROXY', context,
        'SourceTicketID=' + ticketId + '; files=' + fileIds.length);
    } finally {
      lock.releaseLock();
    }

    const maxBytes = arDownloadLimitBytes_();
    let totalBytes = 0;
    const files = fileIds.map(function (fileId) {
      const file = DriveApp.getFileById(fileId);
      if (file.isTrashed() || arUnsafeSharingScope_(arDriveSharingScope_(file))) {
        throw new Error('Legacy evidence file is not private and live');
      }
      const blob = file.getBlob();
      const bytes = blob.getBytes();
      totalBytes += bytes.length;
      if (bytes.length > maxBytes || totalBytes > maxBytes) {
        throw new Error('Legacy evidence exceeds the authorized proxy download limit');
      }
      return {
        filename: arSafeFileName_(file.getName()),
        mimeType: file.getMimeType() || 'application/octet-stream',
        sizeBytes: bytes.length, checksumSHA256: arSha256Hex_(bytes),
        base64: Utilities.base64Encode(bytes)
      };
    });

    const completeLock = LockService.getScriptLock();
    completeLock.waitLock(30000);
    try {
      actor = arAuthorizeMutationLocked_(actor, 'attachment.legacy_incident_proxy', null,
        { skipModuleCheck: true });
      arCompleteCriticalAuditLocked_(intent, 'success',
        'INCIDENT=' + incidentId + '; files=' + files.length + '; bytes=' + totalBytes);
    } finally {
      completeLock.releaseLock();
    }
    return ok({ incidentId: incidentId, files: files }, 'Legacy Incident evidence prepared');
  } catch (e) {
    if (intent) {
      try {
        const errorLock = LockService.getScriptLock();
        errorLock.waitLock(30000);
        try { arCompleteCriticalAuditLocked_(intent, 'error', e.message); }
        finally { errorLock.releaseLock(); }
      } catch (auditError) {
        console.error('legacy incident proxy audit completion: ' + auditError.message);
      }
    }
    arBestEffortDeniedLog_(null, actor, 'LEGACY_INCIDENT_PROXY_DENIED', e.message, context);
    return fail(e.message, 'ATTACHMENT_LEGACY_INCIDENT_PROXY_FAILED');
  }
}

function arSetAttachmentLegalHold_(attachmentId, legalHold, reason) {
  let actor = null;
  let attachment = null;
  try {
    actor = getCurrentUser();
    attachmentId = sanitizeText(attachmentId, 120);
    reason = sanitizeText(reason, 500);
    if (!attachmentId) throw new Error('attachmentId is required');
    if (!reason) throw new Error('A legal-hold reason is required');
    arEnsureRegistryStorage_(true);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      actor = arAuthorizeMutationLocked_(actor, 'attachment.legal_hold', null,
        { skipModuleCheck: true });
      if ([ROLES.IT_ADMIN, ROLES.DPO].indexOf(actor.role) === -1) {
        throw new Error('Only an active ITAdmin or DPO may manage legal holds');
      }
      attachment = arFindAttachment_(attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      const allLinks = arReadRows_(arLinkSheetName_()).filter(function (row) {
        return arSame_(arLinkAttachmentId_(row), attachmentId);
      });
      const targets = legalHold ? allLinks.filter(arIsActiveLink_) : allLinks.filter(function (row) {
        return arTruthy_(arValue_(row, ['LegalHold', 'IsLegalHold']));
      });
      if (legalHold && !targets.length) {
        throw new Error('A legal hold requires at least one active attachment link');
      }
      const context = targets.length ? arContextFromLink_(targets[0]) : null;
      const action = legalHold ? 'LEGAL_HOLD_SET' : 'LEGAL_HOLD_RELEASE';
      const registryBefore = arRegistryMutableStatePatch_(attachment);
      const linksBefore = targets.map(function (link) {
        return { link: link, patch: arLinkMutableStatePatch_(link) };
      });
      const intent = arBeginCriticalAuditLocked_(attachment, actor, action, context, reason);
      try {
        targets.forEach(function (link) {
          arUpdateLinkDirect_(link, {
            LegalHold: legalHold ? 'Yes' : 'No',
            LegalHoldReason: legalHold ? reason : '',
            Notes: arAppendNote_(arValue_(link, ['Notes']),
              '[' + action + '] ' + reason)
          }, actor.email);
        });
        const verifiedLinks = arReadRows_(arLinkSheetName_()).filter(function (row) {
          return targets.some(function (target) {
            return arSame_(arValue_(row, ['LinkID']), arValue_(target, ['LinkID']));
          });
        });
        if (verifiedLinks.length !== targets.length || verifiedLinks.some(function (row) {
          return arTruthy_(arValue_(row, ['LegalHold', 'IsLegalHold'])) !== legalHold;
        })) throw new Error('Legal-hold link update could not be verified');
        attachment = arRefreshAttachmentAggregatesLocked_(attachment, actor);
        const expectedCount = arReadRows_(arLinkSheetName_()).filter(function (row) {
          return arSame_(arLinkAttachmentId_(row), attachmentId) && arIsActiveLink_(row) &&
            arTruthy_(arValue_(row, ['LegalHold', 'IsLegalHold']));
        }).length;
        if ((Number(arValue_(attachment, ['LegalHoldCount'])) || 0) !== expectedCount) {
          throw new Error('Legal-hold aggregate update could not be verified');
        }
        arCompleteCriticalAuditLocked_(intent, 'success',
          action + ' links=' + targets.length + ' reason=' + reason);
      } catch (mutationError) {
        linksBefore.forEach(function (entry) {
          try { arUpdateLinkDirect_(entry.link, entry.patch, actor.email); }
          catch (ignoreLinkRollback) {}
        });
        try { arUpdateRegistryDirect_(attachment, registryBefore, actor.email); }
        catch (ignoreRegistryRollback) {}
        try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
        catch (auditError) {
          throw new Error(mutationError.message + '; audit completion failed: ' + auditError.message);
        }
        throw mutationError;
      }
    } finally {
      lock.releaseLock();
    }
    attachment = arFindAttachment_(attachmentId);
    return ok({ attachmentId: attachmentId,
      legalHoldCount: Number(arValue_(attachment, ['LegalHoldCount'])) || 0,
      legalHold: !!legalHold }, legalHold ? 'Legal hold set' : 'Legal hold released');
  } catch (e) {
    arBestEffortDeniedLog_(attachment, actor,
      legalHold ? 'LEGAL_HOLD_SET_DENIED' : 'LEGAL_HOLD_RELEASE_DENIED', e.message, null);
    return fail(e.message, 'ATTACHMENT_LEGAL_HOLD_FAILED');
  }
}

// -----------------------------------------------------------------------------
// Internal claim, legacy migration and link operations
// -----------------------------------------------------------------------------

function claimRegisteredAttachment_(attachmentId, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  if (!context.recordId) throw new Error('recordId is required when claiming an attachment');
  arAuthorizeRecord_(actor, context, 'write');
  arEnsureRegistryStorage_(true);

  let attachment = arFindAttachment_(sanitizeText(attachmentId, 120));
  if (!attachment) throw new Error('Attachment not found');
  if (arAttachmentStatus_(attachment) !== 'STAGED' || arActiveLinksForAttachment_(attachment).length) {
    throw new Error('A new claim requires an unlinked STAGED attachment');
  }
  if (arAttachmentReferencedByDurableIntent_(arAttachmentId_(attachment))) {
    throw new Error('Attachment already belongs to a durable business-record intent; use exact repair');
  }
  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    throw new Error('Only the uploader or IT administrator may claim this attachment');
  }
  arLiveDriveFile_(attachment);
  linkRegisteredAttachment_(arAttachmentId_(attachment), context.moduleKey, context.recordId,
    options, actor);
  return arFindAttachment_(arAttachmentId_(attachment));
}

/**
 * Read-only preflight used before a business row persists an attachment claim
 * intent. It deliberately mirrors the ownership/status/file checks in claim
 * without creating a link or changing registry state.
 */
function arAssertClaimableAttachment_(attachmentId, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  arAuthorizeUploadContext_(actor, context);
  const attachment = arFindAttachment_(sanitizeText(attachmentId, 120));
  if (!attachment) throw new Error('Attachment not found');
  if (arAttachmentStatus_(attachment) !== 'STAGED') {
    throw new Error('A new attachment claim must reference a STAGED upload');
  }
  if (arActiveLinksForAttachment_(attachment).length) {
    throw new Error('A new attachment claim must not reuse an already-linked attachment');
  }
  if (arAttachmentReferencedByDurableIntent_(arAttachmentId_(attachment))) {
    throw new Error('Attachment already belongs to a durable business-record intent');
  }
  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    throw new Error('Only the uploader or IT administrator may claim this attachment');
  }
  arLiveDriveFile_(attachment);
  return attachment;
}

/** Same claim preflight, re-authorized and re-read under the caller's ScriptLock. */
function arAssertClaimableAttachmentLocked_(attachmentId, moduleKey, recordId, options, actor) {
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', context,
    { recordAction: context.recordId ? 'write' : '', skipModuleCheck: false });
  const attachment = arFindAttachment_(sanitizeText(attachmentId, 120));
  if (!attachment || arAttachmentStatus_(attachment) !== 'STAGED') {
    throw new Error('A new attachment claim must still be STAGED at commit time');
  }
  if (arActiveLinksForAttachment_(attachment).length) {
    throw new Error('Attachment became linked before the source intent commit');
  }
  if (arAttachmentReferencedByDurableIntent_(arAttachmentId_(attachment))) {
    throw new Error('Attachment became owned by a durable business-record intent before commit');
  }
  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    throw new Error('Only the uploader or IT administrator may claim this attachment');
  }
  arLiveDriveFile_(attachment);
  return { attachment: attachment, actor: actor, context: context };
}

/** Parse a durable attachment-ID field without depending on a business module. */
function arIntentIdList_(value) {
  let list = value;
  if (typeof list === 'string') {
    const text = list.trim();
    if (!text) list = [];
    else if (text.charAt(0) === '[') {
      try { list = JSON.parse(text); } catch (e) { throw new Error('Attachment claim intent is invalid JSON'); }
    } else list = text.split(',');
  }
  if (!Array.isArray(list)) list = list ? [list] : [];
  const seen = {};
  return list.map(function (id) { return sanitizeText(id, 120); }).filter(function (id) {
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(id) || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

/**
 * Verify that an attachment ID is already recorded as immutable/durable claim
 * intent by the exact business record and field. This is the trust boundary
 * that permits repair after the record has become terminal.
 */
function arAssertDurableIntentReference_(attachmentId, context, actor) {
  if (!context || !context.recordId || !context.fieldName) {
    throw new Error('Durable attachment intent requires recordId and fieldName');
  }
  const allowed = {
    ServiceRequest: ['AttachmentIDsJSON', 'CompletionAttachmentIDsJSON'],
    ServiceRequestTask: ['EvidenceAttachmentIDsJSON'],
    Ticket: ['AttachmentIDsJSON'],
    PersonalTask: ['Attachments'],
    WorkflowApproval: ['AttachmentIDsJSON']
  };
  if (!allowed[context.recordType] || allowed[context.recordType].indexOf(context.fieldName) === -1) {
    throw new Error('Unsupported durable attachment intent field');
  }
  if (!arCanAuthorizeRecord_(actor, context, 'read')) {
    throw new Error('Not authorized to repair this attachment record');
  }

  let referenced = false;
  if (context.recordType === 'PersonalTask') {
    const task = findRow_(SHEETS.PERSONAL_TASK, 'TaskID', context.recordId);
    if (!task) throw new Error('Personal task attachment intent record not found');
    referenced = readSheetObjectsEnsured_(SHEETS.TASK_ATTACHMENT, true).some(function (row) {
      return arSame_(row.TaskID, context.recordId) &&
        arSame_(row.RegistryAttachmentID, attachmentId);
    });
  } else {
    const sourceMap = {
      ServiceRequest: [SHEETS.SERVICE_REQUEST, 'RequestID'],
      ServiceRequestTask: [SHEETS.SERVICE_REQUEST_TASK, 'TaskID'],
      Ticket: [SHEETS.TICKET, 'TicketID'],
      WorkflowApproval: [SHEETS.WORKFLOW_APPROVAL, 'ApprovalID']
    };
    const source = sourceMap[context.recordType];
    if (!source) throw new Error('Unsupported durable attachment intent record');
    const row = findRow_(source[0], source[1], context.recordId);
    if (!row) throw new Error('Durable attachment intent record not found');
    referenced = arIntentIdList_(row[context.fieldName]).indexOf(attachmentId) > -1;
  }
  if (!referenced) throw new Error('Attachment is not present in the durable claim intent');
  return true;
}

/**
 * Fail-safe graph check used by deletion/cleanup paths. A STAGED upload may
 * already be owned by a business row even though its AttachmentLink has not
 * been committed yet, so the absence of an active link does not make it an
 * orphan.
 */
function arAttachmentReferencedByDurableIntent_(attachmentId) {
  attachmentId = sanitizeText(attachmentId, 120);
  if (!attachmentId) return false;
  const sources = [
    [SHEETS.SERVICE_REQUEST, ['AttachmentIDsJSON', 'CompletionAttachmentIDsJSON']],
    [SHEETS.SERVICE_REQUEST_TASK, ['EvidenceAttachmentIDsJSON']],
    [SHEETS.TICKET, ['AttachmentIDsJSON']],
    [SHEETS.WORKFLOW_APPROVAL, ['AttachmentIDsJSON']]
  ];
  for (let i = 0; i < sources.length; i++) {
    const rows = readSheetObjectsEnsured_(sources[i][0], true);
    for (let r = 0; r < rows.length; r++) {
      for (let f = 0; f < sources[i][1].length; f++) {
        if (arIntentIdList_(rows[r][sources[i][1][f]]).indexOf(attachmentId) > -1) return true;
      }
    }
  }
  return readSheetObjectsEnsured_(SHEETS.TASK_ATTACHMENT, true).some(function (row) {
    return arSame_(row.RegistryAttachmentID, attachmentId);
  });
}

function arHigherClassification_(left, right) {
  const rank = { Public: 0, Internal: 1, Confidential: 2, Restricted: 3 };
  const names = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
  const leftText = String(left || '').trim();
  const rightText = String(right || '').trim();
  // Unknown existing metadata is treated as the most restrictive class. This
  // avoids silently lowering a legacy/custom classification during migration.
  const a = names[leftText.toLowerCase()] || (leftText ? 'Restricted' : 'Internal');
  const b = names[rightText.toLowerCase()] || (rightText ? 'Restricted' : 'Internal');
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Terminal-safe, idempotent repair. It can create only the exact link already
 * named by a durable source-field intent; arbitrary terminal-record linking is
 * therefore impossible through this path.
 */
function arRepairDurableAttachmentIntent_(attachmentId, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  attachmentId = sanitizeText(attachmentId, 120);
  arRequireAttachmentPermission_(actor, 'attachment.upload', context);
  arAssertDurableIntentReference_(attachmentId, context, actor);
  let attachment = arFindAttachment_(attachmentId);
  if (!attachment) throw new Error('Attachment not found');
  if (AR_ACTIVE_STATUS_.indexOf(arAttachmentStatus_(attachment)) === -1) {
    throw new Error('Attachment cannot be repaired in its current state');
  }
  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    throw new Error('Only the uploader or IT administrator may repair this attachment intent');
  }
  arLiveDriveFile_(attachment);
  arEnsureRegistryStorage_(true);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let repair = null;
  try {
    repair = arRepairDurableAttachmentIntentLocked_(attachmentId, moduleKey, recordId, options, actor);
  } finally {
    lock.releaseLock();
  }
  return arFinalizeDurableAttachmentRepair_(repair, actor);
}

/**
 * Exact durable-intent upsert for a caller that already owns ScriptLock. This
 * form lets Personal Task commit its TaskAttachments index and AttachmentLink
 * in one serialized critical section without attempting a nested lock.
 */
function arRepairDurableAttachmentIntentLocked_(attachmentId, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  attachmentId = sanitizeText(attachmentId, 120);
  actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', context,
    { recordAction: 'read' });
  // Recheck every trust input while serialized. The source field, attachment
  // ownership/status and Drive file must all still be valid at commit time.
  arAssertDurableIntentReference_(attachmentId, context, actor);
  const attachment = arFindAttachment_(attachmentId);
  if (!attachment || AR_ACTIVE_STATUS_.indexOf(arAttachmentStatus_(attachment)) === -1) {
    throw new Error('Attachment cannot be repaired in its current state');
  }
  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    throw new Error('Only the uploader or IT administrator may repair this attachment intent');
  }
  arLiveDriveFile_(attachment);
  const registryBefore = arRegistryMutableStatePatch_(attachment);
  const expectedSheet = arEntitySheet_(context);
  const attachmentLinks = arReadRows_(arLinkSheetName_()).filter(function (row) {
    return arSame_(arLinkAttachmentId_(row), attachmentId);
  });
  const exactLink = function (row) {
    return arSame_(arLinkAttachmentId_(row), attachmentId) &&
      arSame_(arValue_(row, ['ModuleKey']), context.moduleKey) &&
      arSame_(arValue_(row, ['EntitySheet']), expectedSheet) &&
      arSame_(arValue_(row, ['EntityID', 'RecordID']), context.recordId) &&
      arSame_(arValue_(row, ['FieldName']), context.fieldName) &&
      arSame_(arValue_(row, ['AttachmentRole']), context.attachmentRole || 'GENERAL');
  };
  const exactActiveLinks = attachmentLinks.filter(function (row) {
    return arIsActiveLink_(row) && exactLink(row);
  });
  if (exactActiveLinks.length > 1) throw new Error('Duplicate exact attachment links require administrative repair');
  let link = exactActiveLinks[0] || null;
  if (!link) {
    // Generic durable repair can never add a second-record link. The only
    // supported cross-record provenance is the dedicated Ticket->Incident
    // routine. A cancelled exact link is replayable only when it is a prior
    // atomic-repair rollback; retention-expired links require admin restore.
    if (attachmentLinks.some(arIsActiveLink_)) {
      throw new Error('Attachment already has an unrelated active link');
    }
    const historical = attachmentLinks.filter(exactLink);
    if (attachmentLinks.length !== historical.length || historical.some(function (row) {
      const status = String(arValue_(row, ['Status']) || '').toUpperCase();
      const notes = String(arValue_(row, ['Notes']) || '');
      return status === 'EXPIRED' || (status !== 'CANCELLED' && status !== '') ||
        !/(?:repair|link) rollback/i.test(notes);
    })) {
      throw new Error('Historical attachment links do not permit exact durable repair');
    }
  }
  const intent = arBeginCriticalAuditLocked_(attachment, actor, 'DURABLE_LINK_REPAIR', context,
    context.recordType + '/' + context.recordId);
  let created = false;
  let createdLink = null;
  try {
    if (!link) {
      const retainUntil = options.retentionUntil || options.retainUntil || arDefaultRetentionUntil_(context);
      const linkObj = {
        LinkID: generateId('ATL'), AttachmentID: attachmentId,
        ModuleKey: context.moduleKey, EntityType: context.recordType,
        RecordType: context.recordType, EntitySheet: expectedSheet,
        EntityID: context.recordId, RecordID: context.recordId,
        FieldName: context.fieldName, AttachmentRole: context.attachmentRole || 'GENERAL',
        AccessPolicy: 'INHERIT_ENTITY', Status: 'ACTIVE',
        RetentionPolicyKey: arRetentionPolicyKey_(context),
        RetentionUntil: retainUntil, RetainUntil: retainUntil,
        LegalHold: 'No', LinkedAt: new Date(), LinkedBy: actor.email,
        Notes: 'Durable claim-intent repair'
      };
      arAppendDirect_(arLinkSheetName_(), linkObj, actor.email);
      link = arFindLinkById_(linkObj.LinkID);
      if (!link) throw new Error('Attachment intent link write could not be verified');
      createdLink = link;
      created = true;
    }
    const currentClassification = arHigherClassification_(
      arValue_(attachment, ['HighestClassification']),
      arValue_(attachment, ['Classification']));
    const requestedClassification = arClassification_(options.classification, context);
    const highestClassification = arHigherClassification_(currentClassification, requestedClassification);
    arUpdateRegistryDirect_(attachment, {
      Status: 'ACTIVE', Classification: highestClassification,
      HighestClassification: highestClassification,
      IsEvidence: arTruthy_(options.isEvidence) ||
        arTruthy_(arValue_(attachment, ['IsEvidence'])) ? 'Yes' : 'No'
    }, actor.email);
    const refreshed = arRefreshAttachmentAggregatesLocked_(attachment, actor);
    const exact = arLinksForRecord_(context).filter(function (row) {
      return arIsActiveLink_(row) && arSame_(arLinkAttachmentId_(row), attachmentId) &&
        arSame_(arValue_(row, ['EntitySheet']), expectedSheet) &&
        arSame_(arValue_(row, ['FieldName']), context.fieldName) &&
        arSame_(arValue_(row, ['AttachmentRole']), context.attachmentRole || 'GENERAL');
    });
    if (!refreshed || arAttachmentStatus_(refreshed) !== 'ACTIVE' || exact.length !== 1) {
      throw new Error('Durable attachment repair could not be verified');
    }
    arCompleteCriticalAuditLocked_(intent, 'success', created ? 'LINK_CREATED' : 'LINK_REUSED');
  } catch (mutationError) {
    if (createdLink) {
      try {
        arUpdateLinkDirect_(createdLink, { Status: 'CANCELLED', UnlinkedAt: new Date(),
          UnlinkedBy: actor.email,
          Notes: arAppendNote_(arValue_(createdLink, ['Notes']), 'repair rollback') }, actor.email);
      } catch (ignoreRollback) {}
    }
    try { arUpdateRegistryDirect_(attachment, registryBefore, actor.email); }
    catch (ignoreRegistryRollback) {}
    try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
    catch (auditError) {
      throw new Error(mutationError.message + '; audit completion failed: ' + auditError.message);
    }
    throw mutationError;
  }
  return { attachmentId: attachmentId, context: context, created: created, actor: actor };
}

/** Complete the durable repair audit after ScriptLock has been released. */
function arFinalizeDurableAttachmentRepair_(repair, actor) {
  if (!repair || !repair.attachmentId || !repair.context) {
    throw new Error('Attachment repair result is incomplete');
  }
  const attachment = arFindAttachment_(repair.attachmentId);
  if (!attachment) throw new Error('Attachment repair could not be verified');
  actor = repair.actor || actor;
  arLogAttachmentAction_(attachment, actor,
    repair.created ? 'LINK_INTENT_REPAIR' : 'LINK_INTENT_REUSE', 'success',
    repair.context.recordType + '/' + repair.context.recordId, repair.context);
  return attachment;
}

/**
 * Controlled cross-record provenance used only by Ticket -> Incident
 * escalation. Raw Drive locators are not copied; each exact ACTIVE Ticket
 * evidence link receives an opaque Incident link under one ScriptLock.
 */
function arEnsureIncidentTicketAttachmentProvenance_(ticketId, incidentId, actor) {
  ticketId = sanitizeText(ticketId, 120);
  incidentId = sanitizeText(incidentId, 120);
  const incidentContext = arNormalizeContext_('incident', incidentId, {
    recordType: 'Incident', fieldName: 'SourceTicketAttachments',
    attachmentRole: 'INCIDENT_EVIDENCE'
  });
  const ticketContext = arNormalizeContext_('ticket', ticketId, {
    recordType: 'Ticket', fieldName: 'AttachmentIDsJSON',
    attachmentRole: 'REQUEST_EVIDENCE'
  });
  arEnsureRegistryStorage_(true);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const linkedIds = [];
  try {
    actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', incidentContext,
      // Exact, mutually-verified provenance repair is terminal-safe. Generic
      // terminal linking remains denied by linkRegisteredAttachment_.
      { recordAction: 'read' });
    if (!arCanAuthorizeRecord_(actor, ticketContext, 'read')) {
      throw new Error('Not authorized to read source Ticket attachment provenance');
    }
    const ticket = findRow_(SHEETS.TICKET, 'TicketID', ticketId);
    const incident = findRow_(SHEETS.INCIDENT, 'IncidentID', incidentId);
    if (!ticket || !incident || String(ticket.IncidentID || '') !== incidentId ||
        String(incident.SourceTicketID || '') !== ticketId) {
      throw new Error('Ticket/Incident provenance relation is not mutually verified');
    }
    const ids = arIntentIdList_(ticket.AttachmentIDsJSON);
    const allLinks = arReadRows_(arLinkSheetName_());
    ids.forEach(function (attachmentId) {
      let attachment = arFindAttachment_(attachmentId);
      if (!attachment || arAttachmentStatus_(attachment) !== 'ACTIVE' ||
          !arTruthy_(arValue_(attachment, ['IsEvidence']))) {
        throw new Error('Source Ticket evidence is not ACTIVE: ' + attachmentId);
      }
      const exactSource = allLinks.some(function (link) {
        return arIsActiveLink_(link) && arSame_(arLinkAttachmentId_(link), attachmentId) &&
          arSame_(arValue_(link, ['ModuleKey']), 'ticket') &&
          arSame_(arValue_(link, ['EntitySheet']), SHEETS.TICKET) &&
          arSame_(arValue_(link, ['EntityID', 'RecordID']), ticketId) &&
          arSame_(arValue_(link, ['FieldName']), 'AttachmentIDsJSON') &&
          arSame_(arValue_(link, ['AttachmentRole']), 'REQUEST_EVIDENCE');
      });
      if (!exactSource) throw new Error('Exact source Ticket evidence link is missing: ' + attachmentId);
      arLiveDriveFile_(attachment);
      const existingTarget = arLinksForRecord_(incidentContext).filter(function (link) {
        return arIsActiveLink_(link) && arSame_(arLinkAttachmentId_(link), attachmentId) &&
          arSame_(arValue_(link, ['EntitySheet']), SHEETS.INCIDENT) &&
          arSame_(arValue_(link, ['FieldName']), 'SourceTicketAttachments') &&
          arSame_(arValue_(link, ['AttachmentRole']), 'INCIDENT_EVIDENCE');
      })[0] || null;
      if (existingTarget) { linkedIds.push(attachmentId); return; }

      const intent = arBeginCriticalAuditLocked_(attachment, actor,
        'INCIDENT_PROVENANCE_LINK', incidentContext, 'SourceTicketID=' + ticketId);
      const registryTarget = attachment;
      const registryBefore = arRegistryMutableStatePatch_(attachment);
      let createdLink = null;
      try {
        const retainUntil = arDefaultRetentionUntil_(incidentContext);
        const linkId = generateId('ATL');
        arAppendDirect_(arLinkSheetName_(), {
          LinkID: linkId, AttachmentID: attachmentId, ModuleKey: 'incident',
          EntityType: 'Incident', RecordType: 'Incident', EntitySheet: SHEETS.INCIDENT,
          EntityID: incidentId, RecordID: incidentId,
          FieldName: 'SourceTicketAttachments', AttachmentRole: 'INCIDENT_EVIDENCE',
          AccessPolicy: 'INHERIT_ENTITY', Status: 'ACTIVE',
          RetentionPolicyKey: 'ATTACHMENT_RETENTION_DAYS',
          RetainUntil: retainUntil, LegalHold: 'No', LinkedAt: new Date(),
          LinkedBy: actor.email, Notes: 'SourceTicketID=' + ticketId
        }, actor.email);
        createdLink = arFindLinkById_(linkId);
        if (!createdLink) throw new Error('Incident provenance link could not be verified');
        attachment = arRefreshAttachmentAggregatesLocked_(attachment, actor);
        arCompleteCriticalAuditLocked_(intent, 'success', 'INCIDENT=' + incidentId);
        linkedIds.push(attachmentId);
      } catch (mutationError) {
        if (createdLink) {
          try {
            arUpdateLinkDirect_(createdLink, { Status: 'CANCELLED', UnlinkedAt: new Date(),
              UnlinkedBy: actor.email,
              Notes: arAppendNote_(arValue_(createdLink, ['Notes']), 'provenance rollback') }, actor.email);
          } catch (ignoreRollback) {}
        }
        try { arUpdateRegistryDirect_(registryTarget, registryBefore, actor.email); }
        catch (ignoreRegistryRollback) {}
        try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
        catch (auditError) {
          throw new Error(mutationError.message + '; audit completion failed: ' + auditError.message);
        }
        throw mutationError;
      }
    });
  } finally {
    lock.releaseLock();
  }
  return linkedIds;
}

/**
 * Call only while the business transaction owns ScriptLock. Required evidence
 * is valid only when the registry and the exact field/role link are ACTIVE and
 * the private Drive file is still available.
 */
function arAssertActiveEvidenceForRecordLocked_(attachmentIds, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  const ids = arIntentIdList_(attachmentIds);
  if (!ids.length) throw new Error('Required evidence attachment is missing');
  arRequireAttachmentPermission_(actor, 'attachment.view', context);
  if (!arCanAuthorizeRecord_(actor, context, 'read')) {
    throw new Error('Not authorized to verify required evidence');
  }
  const registries = arReadRows_(arRegistrySheetName_());
  const links = arReadRows_(arLinkSheetName_());
  ids.forEach(function (attachmentId) {
    const attachment = registries.filter(function (row) {
      return arSame_(arAttachmentId_(row), attachmentId);
    })[0];
    if (!attachment || arAttachmentStatus_(attachment) !== 'ACTIVE' ||
        !arTruthy_(arValue_(attachment, ['IsEvidence']))) {
      throw new Error('Required evidence is not ACTIVE: ' + attachmentId);
    }
    const exactLink = links.some(function (row) {
      return String(arValue_(row, ['Status']) || '').toUpperCase() === 'ACTIVE' &&
        arSame_(arLinkAttachmentId_(row), attachmentId) &&
        arSame_(arValue_(row, ['ModuleKey']), context.moduleKey) &&
        arSame_(arValue_(row, ['EntityID', 'RecordID']), context.recordId) &&
        arSame_(arValue_(row, ['FieldName']), context.fieldName) &&
        arSame_(arValue_(row, ['AttachmentRole']), context.attachmentRole || 'GENERAL') &&
        arSame_(arValue_(row, ['EntitySheet']), arEntitySheet_(context));
    });
    if (!exactLink) throw new Error('Required evidence is not linked to the exact record field: ' + attachmentId);
    arLiveDriveFile_(attachment);
  });
  return true;
}

function linkRegisteredAttachment_(attachmentId, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  arRequireAttachmentPermission_(actor, 'attachment.upload', context);
  arAuthorizeRecord_(actor, context, 'write');
  arEnsureRegistryStorage_(true);
  let attachment = arFindAttachment_(sanitizeText(attachmentId, 120));
  if (!attachment) throw new Error('Attachment not found');
  if (arAttachmentStatus_(attachment) !== 'STAGED' || arActiveLinksForAttachment_(attachment).length) {
    throw new Error('Direct linking requires an unlinked STAGED attachment');
  }
  if (arAttachmentReferencedByDurableIntent_(arAttachmentId_(attachment))) {
    throw new Error('Attachment already belongs to a durable business-record intent; use exact repair');
  }

  const uploader = arAttachmentUploader_(attachment);
  if ((!uploader || uploader !== arEmail_(actor.email)) && actor.role !== ROLES.IT_ADMIN) {
    const readable = arPrimaryAuthorizedContext_(attachment, actor, 'read');
    if (!readable) throw new Error('Not authorized to reuse this attachment');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let link = null;
  try {
    actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', context,
      { recordAction: 'write' });
    attachment = arFindAttachment_(sanitizeText(attachmentId, 120));
    if (!attachment || arAttachmentStatus_(attachment) !== 'STAGED' ||
        arActiveLinksForAttachment_(attachment).length) {
      throw new Error('Attachment is no longer an unlinked STAGED upload');
    }
    if (arAttachmentReferencedByDurableIntent_(arAttachmentId_(attachment))) {
      throw new Error('Attachment became owned by a durable business-record intent before link commit');
    }
    const lockedUploader = arAttachmentUploader_(attachment);
    if ((!lockedUploader || lockedUploader !== arEmail_(actor.email)) &&
        actor.role !== ROLES.IT_ADMIN) {
      throw new Error('Only the uploader or IT administrator may link this attachment');
    }
    arLiveDriveFile_(attachment);
    if (arTruthy_(options.legalHold)) {
      throw new Error('Use the controlled legal-hold API after the attachment is linked');
    }
    const registryTarget = attachment;
    const registryBefore = arRegistryMutableStatePatch_(attachment);
    const intent = arBeginCriticalAuditLocked_(attachment, actor, 'LINK', context,
      context.recordType + '/' + context.recordId);
    let createdLink = null;
    try {
      const retentionUntil = options.retentionUntil || options.retainUntil || arDefaultRetentionUntil_(context);
      const linkObj = {
        LinkID: generateId('ATL'), AttachmentID: arAttachmentId_(attachment),
        ModuleKey: context.moduleKey, EntityType: context.recordType,
        RecordType: context.recordType, EntitySheet: arEntitySheet_(context),
        EntityID: context.recordId, RecordID: context.recordId,
        FieldName: context.fieldName, AttachmentRole: context.attachmentRole || 'GENERAL',
        AccessPolicy: 'INHERIT_ENTITY', Status: 'ACTIVE',
        RetentionPolicyKey: arRetentionPolicyKey_(context),
        RetentionUntil: retentionUntil, RetainUntil: retentionUntil,
        LegalHold: 'No', LegalHoldReason: '', LinkedAt: new Date(),
        LinkedBy: actor.email, Notes: sanitizeText(options.notes, 500)
      };
      arAppendDirect_(arLinkSheetName_(), linkObj, actor.email);
      createdLink = arFindLinkById_(linkObj.LinkID);
      if (!createdLink) throw new Error('Attachment link write could not be verified');
      const currentClassification = arHigherClassification_(
        arValue_(attachment, ['HighestClassification']),
        arValue_(attachment, ['Classification']));
      const highestClassification = arHigherClassification_(currentClassification,
        arClassification_(options.classification, context));
      arUpdateRegistryDirect_(attachment, {
        Status: 'ACTIVE', ModuleKey: context.moduleKey, HomeModule: context.moduleKey,
        RecordID: context.recordId, Classification: highestClassification,
        HighestClassification: highestClassification,
        IsEvidence: arTruthy_(options.isEvidence) ||
          arTruthy_(arValue_(attachment, ['IsEvidence'])) ? 'Yes' : 'No',
        ActiveLinkCount: 1, RetentionUntil: retentionUntil,
        EffectiveRetainUntil: retentionUntil
      }, actor.email);
      attachment = arFindAttachment_(arAttachmentId_(attachment));
      if (!attachment || arAttachmentStatus_(attachment) !== 'ACTIVE' ||
          arActiveLinksForAttachment_(attachment).filter(function (row) {
            return arSame_(arValue_(row, ['LinkID']), linkObj.LinkID);
          }).length !== 1) {
        throw new Error('Atomic attachment link commit could not be verified');
      }
      arCompleteCriticalAuditLocked_(intent, 'success', 'LINKED');
      link = createdLink;
    } catch (mutationError) {
      if (createdLink) {
        try {
          arUpdateLinkDirect_(createdLink, { Status: 'CANCELLED', UnlinkedAt: new Date(),
            UnlinkedBy: actor.email,
            Notes: arAppendNote_(arValue_(createdLink, ['Notes']), 'link rollback') }, actor.email);
        } catch (ignoreRollback) {}
      }
      try { arUpdateRegistryDirect_(registryTarget, registryBefore, actor.email); }
      catch (ignoreRegistryRollback) {}
      try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
      catch (auditError) {
        throw new Error(mutationError.message + '; audit completion failed: ' + auditError.message);
      }
      throw mutationError;
    }
  } finally {
    lock.releaseLock();
  }
  // The verified critical audit above is the commit record. A secondary
  // summary-log outage must not turn a successful link into a client-visible
  // failure that triggers destructive upload compensation.
  try {
    arLogAttachmentAction_(attachment, actor, 'LINK', 'success',
      context.recordType + '/' + context.recordId, context);
  } catch (summaryAuditError) {
    console.error('attachment link summary audit: ' + summaryAuditError.message);
  }
  return link;
}

/**
 * Adopt a pre-existing Drive file without moving or sharing it. This function
 * is internal (trailing underscore) and accepts only raw IDs or known Drive/
 * Docs URL shapes; arbitrary token extraction is deliberately prohibited.
 */
function claimLegacyRegisteredAttachment_(legacyValue, moduleKey, recordId, options, actor) {
  actor = actor || getCurrentUser();
  options = options || {};
  const context = arNormalizeContext_(moduleKey, recordId, options);
  const fileId = arStrictDriveFileId_(legacyValue);
  if (!fileId) throw new Error('Legacy value is not a supported Drive file ID or URL');
  const canManage = typeof wfHasActionPermission_ === 'function' &&
    wfHasActionPermission_(actor, 'attachment.manage', context);
  const trustedOwnUpload = options.trustedOwnUpload === true &&
    arTrustedLegacyUpload_(fileId, context, actor);
  if (!canManage && !trustedOwnUpload) {
    throw new Error('Attachment action permission denied: attachment.manage');
  }
  if (trustedOwnUpload) arRequireAttachmentPermission_(actor, 'attachment.upload', context);
  arAuthorizeRecord_(actor, context, 'write');
  arEnsureRegistryStorage_(true);

  let attachment = arReadRows_(arRegistrySheetName_()).filter(function (row) {
    return arAttachmentFileId_(row) === fileId && arAttachmentStatus_(row) !== 'TRASHED';
  })[0] || null;
  if (!attachment) {
    const file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) throw new Error('Legacy Drive file is trashed');
    const sharingScope = arDriveSharingScope_(file);
    if (arUnsafeSharingScope_(sharingScope)) {
      throw new Error('Legacy Drive file has public or domain-wide sharing and cannot be claimed');
    }
    const size = Number(file.getSize()) || 0;
    let checksum = '';
    let note = '[LEGACY_UNVERIFIED] File was not moved and Drive sharing was not changed.';
    if (size > 0 && size <= AR_MAX_UPLOAD_BYTES_) {
      try { checksum = arSha256Hex_(file.getBlob().getBytes()); } catch (ignoreHash) {}
    }
    const attachmentId = generateId('ATT');
    const legacyRow = arRegistryWriteObject_({
      attachmentId: attachmentId,
      moduleKey: context.moduleKey,
      recordId: context.recordId,
      fileId: fileId,
      fileName: arSafeFileName_(file.getName()),
      storedName: file.getName(),
      detectedMimeType: file.getMimeType() || 'application/octet-stream',
      sizeBytes: size,
      checksum: checksum,
      sharingScope: sharingScope,
      source: 'LEGACY_DRIVE',
      classification: arClassification_(options.classification, context),
      uploadedBy: actor.email,
      uploadedAt: file.getDateCreated ? file.getDateCreated() : new Date(),
      status: 'STAGED',
      retentionUntil: arDefaultRetentionUntil_(context),
      isEvidence: arTruthy_(options.isEvidence) ? 'Yes' : 'No',
      notes: note
    });
    const legacyLock = LockService.getScriptLock();
    legacyLock.waitLock(30000);
    try {
      actor = arAuthorizeMutationLocked_(actor,
        trustedOwnUpload ? 'attachment.upload' : 'attachment.manage', context,
        { recordAction: 'write' });
      // Re-check under lock so two migration workers cannot register the same
      // physical Drive file as separate active attachments.
      attachment = arReadRows_(arRegistrySheetName_()).filter(function (row) {
        return arAttachmentFileId_(row) === fileId && arAttachmentStatus_(row) !== 'TRASHED';
      })[0] || null;
      if (!attachment) {
        const lockedFile = DriveApp.getFileById(fileId);
        if (lockedFile.isTrashed() || arUnsafeSharingScope_(arDriveSharingScope_(lockedFile))) {
          throw new Error('Legacy Drive file is no longer private and live');
        }
        const intent = arBeginCriticalAuditLocked_(legacyRow, actor,
          'CLAIM_LEGACY_REGISTER', context, fileId);
        try {
          arAppendDirect_(arRegistrySheetName_(), legacyRow, actor.email);
          attachment = arFindAttachment_(attachmentId);
          if (!attachment || arAttachmentFileId_(attachment) !== fileId) {
            throw new Error('Legacy attachment registry write could not be verified');
          }
          arCompleteCriticalAuditLocked_(intent, 'success', 'REGISTERED_LEGACY');
        } catch (mutationError) {
          try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
          catch (auditError) {
            throw new Error(mutationError.message + '; audit completion failed: ' + auditError.message);
          }
          throw mutationError;
        }
      }
      if (!attachment) throw new Error('Legacy attachment registry write could not be verified');
    } finally {
      legacyLock.releaseLock();
    }
  }
  attachment = claimRegisteredAttachment_(arAttachmentId_(attachment), context.moduleKey,
    context.recordId, options, actor);
  arLogAttachmentAction_(attachment, actor, 'CLAIM_LEGACY', 'success', '', context);
  return attachment;
}

function arTrustedLegacyUpload_(fileId, context, actor) {
  const email = arEmail_(actor && actor.email);
  if (!email || !fileId || !context || !context.moduleKey) return false;
  try {
    return readSheetObjectsEnsured_(SHEETS.AUDIT_TRAIL, true).some(function (row) {
      return String(row.Action || '') === 'UPLOAD_EVIDENCE' &&
        String(row.Module || '') === String(context.moduleKey) &&
        String(row.TargetID || '') === String(fileId) &&
        arEmail_(row.ActorEmail) === email &&
        String(row.Result || '').toLowerCase() === 'success';
    });
  } catch (e) {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Attachment and record authorization (default deny)
// -----------------------------------------------------------------------------

function authorizeRegisteredAttachment_(attachmentId, action, actor) {
  actor = actor || getCurrentUser();
  attachmentId = sanitizeText(attachmentId, 120);
  const attachment = arFindAttachment_(attachmentId);
  if (!attachment) throw new Error('Attachment not found');
  const status = arAttachmentStatus_(attachment);

  if (status === 'STAGED') {
    if (arAttachmentUploader_(attachment) === arEmail_(actor.email)) return attachment;
    if (action === 'delete' && actor.role === ROLES.IT_ADMIN) return attachment;
    throw new Error('Not authorized to access this staged attachment');
  }
  if (status === 'TRASHED' && action !== 'restore') throw new Error('Attachment is deleted');

  const links = arActiveLinksForAttachment_(attachment);
  if (!links.length && action === 'delete' && actor.role === ROLES.IT_ADMIN) return attachment;
  if (!links.length && action === 'read' &&
      String(arValue_(attachment, ['Notes']) || '').indexOf('[ADMIN_RETENTION_RESTORE]') > -1 &&
      typeof wfHasActionPermission_ === 'function' &&
      wfHasActionPermission_(actor, 'attachment.admin', { attachmentId: attachmentId })) {
    return attachment;
  }
  for (let i = 0; i < links.length; i++) {
    const context = arContextFromLink_(links[i]);
    if (arCanAuthorizeRecord_(actor, context, action === 'read' ? 'read' : 'write')) return attachment;
  }

  // Compatibility for a registry row that has not yet received a link.
  const legacyRecordId = arRowRecordId_(attachment);
  if (legacyRecordId && !arHasAnyRealLinkForAttachment_(attachment)) {
    const context = arNormalizeContext_(arRowModule_(attachment), legacyRecordId, {
      recordType: arValue_(attachment, ['RecordType', 'EntityType'])
    });
    if (arCanAuthorizeRecord_(actor, context, action === 'read' ? 'read' : 'write')) return attachment;
  }
  throw new Error('Not authorized to access this attachment');
}

/**
 * Read-only assertion for callers that already own ScriptLock (for example a
 * Workflow decision). It never opens a nested lock and accepts only ACTIVE
 * attachments with an ACTIVE link to the exact source record.
 */
function arAssertAttachmentsLinkedToRecordLocked_(attachmentIds, moduleKey, recordId, actor) {
  const context = arNormalizeContext_(moduleKey, recordId, {});
  const ids = Array.isArray(attachmentIds) ? attachmentIds : [];
  actor = arAuthorizeMutationLocked_(actor, 'attachment.view', context,
    { recordAction: 'read' });
  const registries = arReadRows_(arRegistrySheetName_());
  const links = arReadRows_(arLinkSheetName_());
  ids.forEach(function (rawId) {
    const attachmentId = sanitizeText(rawId, 120);
    const attachment = registries.filter(function (row) {
      return arAttachmentId_(row) === attachmentId;
    })[0];
    if (!attachment || arAttachmentStatus_(attachment) !== 'ACTIVE' ||
        !arTruthy_(arValue_(attachment, ['IsEvidence']))) {
      throw new Error('Attachment ไม่อยู่ในสถานะที่ใช้งานได้: ' + attachmentId);
    }
    const linked = links.some(function (row) {
      return arIsActiveLink_(row) && arLinkAttachmentId_(row) === attachmentId &&
        arSame_(arValue_(row, ['ModuleKey']), context.moduleKey) &&
        arSame_(arValue_(row, ['EntitySheet']), arEntitySheet_(context)) &&
        arSame_(arValue_(row, ['EntityID', 'RecordID']), context.recordId) &&
        arSame_(arValue_(row, ['FieldName']), 'WorkflowAttachments') &&
        arSame_(arValue_(row, ['AttachmentRole']), 'APPROVAL_EVIDENCE');
    });
    if (!linked) throw new Error('Attachment ไม่ได้ผูกกับ Workflow นี้: ' + attachmentId);
    if (!arCanAuthorizeRecord_(actor, context, 'read')) {
      throw new Error('ไม่มีสิทธิ์ใช้ Attachment ใน Workflow นี้');
    }
    arLiveDriveFile_(attachment);
  });
  return true;
}

function arAuthorizeUploadContext_(actor, context) {
  if (!context.moduleKey || !arSupportedModule_(context.moduleKey)) throw new Error('Unsupported attachment module');
  arRequireAttachmentPermission_(actor, 'attachment.upload', context);
  if (context.recordId) return arAuthorizeRecord_(actor, context, 'write');
  if (!canEditModule(actor.role, context.moduleKey)) throw new Error('No permission to upload to this module');
  return true;
}

function arRequireAttachmentPermission_(actor, permissionKey, context) {
  if (typeof wfHasActionPermission_ !== 'function' ||
      !wfHasActionPermission_(actor, permissionKey, context || {})) {
    throw new Error('Attachment action permission denied: ' + permissionKey);
  }
  return true;
}

/**
 * Re-resolve the mutation actor and permission matrix while ScriptLock is
 * owned. A session role and an action-permission cache loaded before the lock
 * are never authority for an attachment commit.
 */
function arAuthorizeMutationLocked_(actor, permissionKey, context, options) {
  options = options || {};
  if (typeof apResetRuntimeReadCache_ !== 'function' ||
      typeof apResolveActor_ !== 'function') {
    throw new Error('Fresh attachment authorization is unavailable');
  }
  apResetRuntimeReadCache_();
  const email = arEmail_(actor && (actor.email || actor.Email));
  if (!email || !isValidEmail(email)) throw new Error('Active attachment actor is required');
  const freshActor = apResolveActor_({ email: email });
  if (!freshActor || !freshActor.email || !freshActor.role) {
    throw new Error('Attachment actor is no longer active');
  }
  arRequireAttachmentPermission_(freshActor, permissionKey, context || {});
  if (!options.skipModuleCheck && context && context.moduleKey) {
    if (context.recordId) {
      const recordAction = options.recordAction === 'read' ? 'read' : 'write';
      if (!arCanAuthorizeRecord_(freshActor, context, recordAction)) {
        throw new Error('Fresh record authorization failed for attachment mutation');
      }
    } else if (!canEditModule(freshActor.role, context.moduleKey)) {
      throw new Error('Fresh module authorization failed for attachment mutation');
    }
  }
  return freshActor;
}

function arCriticalOperationKey_(action, attachmentId, context) {
  context = context || {};
  return [
    'AR', String(action || '').toUpperCase(), sanitizeText(attachmentId, 120),
    sanitizeText(context.moduleKey, 80), sanitizeText(context.recordType, 80),
    sanitizeText(context.recordId, 120), sanitizeText(context.fieldName, 100),
    sanitizeText(context.attachmentRole, 80)
  ].join(':');
}

/** Direct row reader for a caller that already owns ScriptLock. */
function arReadRowDirect_(sheetName, rowNumber) {
  const sh = getSheet_(sheetName);
  if (!sh || rowNumber < 2 || rowNumber > sh.getLastRow()) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const row = { _row: rowNumber };
  headers.forEach(function (header, index) { row[header] = values[index]; });
  return row;
}

/**
 * Durable, verified audit intent. Call only while ScriptLock is owned and
 * before the governed mutation. Both audit stores carry one stable op key.
 */
function arBeginCriticalAuditLocked_(attachment, actor, action, context, reason) {
  const attachmentId = attachment ? arAttachmentId_(attachment) : '';
  const opKey = arCriticalOperationKey_(action, attachmentId, context);
  const accessId = generateId('AAL');
  const logId = generateId('LOG');
  const detail = '[INTENT][OP_KEY=' + opKey + '] ' + sanitizeText(reason, 1000);
  const accessRow = arAppendDirect_(arAccessLogSheetName_(), {
    AccessLogID: accessId, AttachmentID: attachmentId,
    ModuleKey: context && context.moduleKey || (attachment ? arRowModule_(attachment) : ''),
    RecordID: context && context.recordId || (attachment ? arRowRecordId_(attachment) : ''),
    Action: String(action || '').toUpperCase() + '_INTENT',
    ActorEmail: actor.email, ActorRole: actor.role, Result: 'pending',
    Reason: detail, FileSizeBytes: attachment ? arAttachmentSize_(attachment) : 0,
    ActionAt: new Date()
  }, actor.email);
  const auditRow = arAppendDirect_(SHEETS.AUDIT_TRAIL, {
    LogID: logId, Timestamp: new Date(), ActorEmail: actor.email,
    ActorRole: actor.role,
    Action: 'ATTACHMENT_' + String(action || '').toUpperCase() + '_INTENT',
    Module: 'attachment', TargetSheet: arRegistrySheetName_(), TargetID: opKey,
    Detail: detail, IPHint: '', Result: 'pending'
  }, actor.email);
  const access = arReadRowDirect_(arAccessLogSheetName_(), accessRow);
  const audit = arReadRowDirect_(SHEETS.AUDIT_TRAIL, auditRow);
  if (!access || String(access.AccessLogID || '') !== accessId ||
      String(access.Result || '').toLowerCase() !== 'pending' ||
      !audit || String(audit.LogID || '') !== logId ||
      String(audit.TargetID || '') !== opKey ||
      String(audit.Result || '').toLowerCase() !== 'pending') {
    throw new Error('Attachment durable audit intent could not be verified');
  }
  return { accessRow: accessRow, accessId: accessId, auditRow: auditRow,
    logId: logId, opKey: opKey, detail: detail, actor: actor };
}

/** Complete and re-read the same critical audit rows while ScriptLock is held. */
function arCompleteCriticalAuditLocked_(intent, result, suffix) {
  const normalized = String(result || '').toLowerCase();
  if (['success', 'error'].indexOf(normalized) === -1) {
    throw new Error('Invalid attachment audit completion state');
  }
  const marker = normalized === 'success' ? '[COMPLETED]' : '[FAILED]';
  const detail = marker + '[OP_KEY=' + intent.opKey + '] ' + sanitizeText(suffix, 1000);
  arUpdateRowDirect_(arAccessLogSheetName_(), intent.accessRow, {
    Result: normalized, Reason: detail
  }, intent.actor.email);
  arUpdateRowDirect_(SHEETS.AUDIT_TRAIL, intent.auditRow, {
    Result: normalized, Detail: detail
  }, intent.actor.email);
  const access = arReadRowDirect_(arAccessLogSheetName_(), intent.accessRow);
  const audit = arReadRowDirect_(SHEETS.AUDIT_TRAIL, intent.auditRow);
  if (!access || String(access.AccessLogID || '') !== intent.accessId ||
      String(access.Result || '').toLowerCase() !== normalized ||
      !audit || String(audit.LogID || '') !== intent.logId ||
      String(audit.TargetID || '') !== intent.opKey ||
      String(audit.Result || '').toLowerCase() !== normalized) {
    throw new Error('Attachment audit completion could not be verified: ' + intent.opKey);
  }
  return true;
}

function arAuthorizeRecord_(actor, context, action) {
  if (!arCanAuthorizeRecord_(actor, context, action)) {
    arBestEffortDeniedLog_(null, actor, 'RECORD_ACCESS_DENIED',
      context.moduleKey + '/' + context.recordType + '/' + context.recordId + '/' + action, context);
    throw new Error('Not authorized for this attachment record');
  }
  return true;
}

function arCanAuthorizeRecord_(actor, context, action) {
  try { return arCanAuthorizeRecordCore_(actor, context, action, 0); } catch (e) { return false; }
}

function arCanAuthorizeRecordCore_(actor, context, action, depth) {
  if (!actor || !actor.email || !context || !context.recordId || depth > 2) return false;
  const email = arEmail_(actor.email);
  const write = action !== 'read';
  if (!arSupportedModule_(context.moduleKey)) return false;
  if (!(write ? canEditModule(actor.role, context.moduleKey) : canAccessModule(actor.role, context.moduleKey))) return false;

  switch (context.recordType) {
    case 'ServiceRequest': {
      const row = findRow_(SHEETS.SERVICE_REQUEST, 'RequestID', context.recordId);
      if (!row) return false;
      const participant = actor.role === ROLES.IT_ADMIN ||
        arEmail_(row.RequesterEmail) === email || arEmailListHas_(row.Approver, email) ||
        arEmail_(row.Assignee) === email ||
        arEmail_(row.ApprovedBy) === email;
      if (!participant) return false;
      return !write || !arTerminalStatus_(row.Status,
        ['ปิดงาน', 'ปฏิเสธ', 'ยกเลิก']);
    }
    case 'ServiceRequestTask': {
      const task = findRow_(SHEETS.SERVICE_REQUEST_TASK, 'TaskID', context.recordId);
      if (!task) return false;
      if (write && actor.role !== ROLES.IT_ADMIN) return false;
      return arCanAuthorizeRecordCore_(actor,
        arNormalizeContext_('serviceCatalog', task.RequestID, { recordType: 'ServiceRequest' }), action, depth + 1);
    }
    case 'PersonalTask': {
      const row = findRow_(SHEETS.PERSONAL_TASK, 'TaskID', context.recordId);
      if (!row || arEmail_(row.OwnerEmail) !== email) return false;
      return !write || !arTerminalStatus_(row.Status, ['เสร็จแล้ว', 'เสร็จสิ้น', 'ยกเลิก', 'ปิดงาน']);
    }
    case 'Ticket': {
      const row = findRow_(SHEETS.TICKET, 'TicketID', context.recordId);
      if (!row) return false;
      const participant = actor.role === ROLES.IT_ADMIN ||
        arEmail_(row.RequesterEmail) === email || arEmail_(row.Assignee) === email;
      const resolvedActor = typeof apResolveActor_ === 'function' ? apResolveActor_(actor) : actor;
      const approverTriageReader = !write && resolvedActor &&
        resolvedActor.role === ROLES.APPROVER && canAccessModule(resolvedActor.role, 'ticket') &&
        wfHasActionPermission_(resolvedActor, 'attachment.view', context);
      if (!write) return participant || actor.role === ROLES.EXECUTIVE || approverTriageReader;
      return participant && !arTerminalStatus_(row.Status,
        ['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);
    }
    case 'AccessRequest': {
      const row = findRow_(SHEETS.ACCESS_REQ, 'ReqID', context.recordId);
      if (!row) return false;
      const participant = actor.role === ROLES.IT_ADMIN ||
        arEmail_(row.RequesterEmail) === email || arEmailListHas_(row.Approver, email) ||
        arEmail_(row.ITHandler) === email || arEmail_(row.ApprovedBy) === email;
      return participant && (!write || !arTerminalStatus_(row.Status, ['เสร็จสิ้น', 'ปฏิเสธ']));
    }
    case 'ChangeRequest': {
      const row = findRow_(SHEETS.CHANGE, 'ChangeID', context.recordId);
      if (!row) return false;
      const participant = actor.role === ROLES.IT_ADMIN || arEmail_(row.Requester) === email ||
        arEmailListHas_(row.Approver, email) ||
        arEmail_(row.TestSignOffBy) === email || arEmail_(row.DeployBy) === email;
      if (!write) return participant || canAccessModule(actor.role, 'change');
      return participant && !arTerminalStatus_(row.Status, ['ติดตั้งใช้งานแล้ว', 'ปฏิเสธ']);
    }
    case 'Incident': {
      const row = findRow_(SHEETS.INCIDENT, 'IncidentID', context.recordId);
      if (!row) return false;
      const isAdmin = actor.role === ROLES.IT_ADMIN;
      const isApprover = actor.role === ROLES.APPROVER;
      const isDpoCase = actor.role === ROLES.DPO &&
        String(row.ContainsPersonalData || '').toLowerCase() === 'yes';
      const isReporter = arEmail_(row.ReportedBy) === email;
      if (!write) return isAdmin || isApprover || isDpoCase ||
        actor.role === ROLES.EXECUTIVE || isReporter;
      return (isAdmin || isApprover) &&
        !arTerminalStatus_(row.Status, ['ปิดเคส', 'CLOSED', 'CANCELLED']);
    }
    case 'WorkflowApproval': {
      const approval = findRow_(SHEETS.WORKFLOW_APPROVAL, 'ApprovalID', context.recordId);
      if (!approval) return false;
      if (actor.role === ROLES.IT_ADMIN) {
        return !write || String(approval.Status || '') === 'รอพิจารณา';
      }
      const assigned = arEmail_(approval.ApproverEmail) === email ||
        arEmail_(approval.OriginalApproverEmail) === email || arEmail_(approval.DecisionBy) === email;
      if (write) return assigned && String(approval.Status || '') === 'รอพิจารณา';
      if (assigned) return true;
      return arCanAuthorizeRecordCore_(actor,
        arNormalizeContext_('workflow', approval.InstanceID, { recordType: 'WorkflowInstance' }), 'read', depth + 1);
    }
    case 'WorkflowInstance': {
      const instance = findRow_(SHEETS.WORKFLOW_INSTANCE, 'InstanceID', context.recordId);
      if (!instance) return false;
      const active = String(instance.Status || '') === 'กำลังดำเนินการ';
      if (actor.role === ROLES.IT_ADMIN || arEmail_(instance.RequesterEmail) === email) {
        return !write || active;
      }
      const assigned = readSheetObjectsEnsured_(SHEETS.WORKFLOW_APPROVAL).some(function (approval) {
        return arSame_(approval.InstanceID, context.recordId) &&
          (arEmail_(approval.ApproverEmail) === email || arEmail_(approval.OriginalApproverEmail) === email ||
            arEmail_(approval.DecisionBy) === email);
      });
      if (assigned) return !write || active;
      if (write) return false;
      const sourceModule = arNormalizeModule_(instance.ModuleKey);
      if (!sourceModule || sourceModule === 'workflow') return false;
      const sourceType = arDefaultRecordType_(sourceModule);
      return arCanAuthorizeRecordCore_(actor,
        arNormalizeContext_(sourceModule, instance.RecordID, { recordType: sourceType }), 'read', depth + 1);
    }
    default:
      return false;
  }
}

function arEmailListHas_(value, email) {
  const target = arEmail_(email);
  return String(value || '').split(/[;,]/).some(function (item) {
    return arEmail_(item) === target;
  });
}

function arTerminalStatus_(value, terminalStatuses) {
  return (terminalStatuses || []).indexOf(String(value || '').trim()) > -1;
}

// -----------------------------------------------------------------------------
// Validation, hashing and Drive helpers
// -----------------------------------------------------------------------------

function arDecodeAndValidateUpload_(payload) {
  const rawName = String(payload.filename || payload.name || '').trim();
  if (!rawName) throw new Error('filename is required');
  const ext = rawName.indexOf('.') > -1 ? rawName.split('.').pop().toLowerCase() : '';
  const policy = AR_MIME_POLICY_[ext];
  if (!policy) throw new Error('File extension is not allowed');
  let encoded = String(payload.base64 || '').trim().replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!encoded) throw new Error('base64 file content is required');
  if (encoded.length > Math.ceil(AR_MAX_UPLOAD_BYTES_ * 4 / 3) + 16) throw new Error('File exceeds 15 MB');

  let bytes;
  try { bytes = Utilities.base64Decode(encoded); } catch (e) { throw new Error('Invalid base64 file content'); }
  if (!bytes.length) throw new Error('Empty files are not allowed');
  if (bytes.length > AR_MAX_UPLOAD_BYTES_) throw new Error('File exceeds 15 MB');

  const claimed = String(payload.mimeType || '').toLowerCase().split(';')[0].trim();
  if (claimed && policy.claimed.indexOf(claimed) === -1) {
    throw new Error('Claimed MIME type does not match the file extension');
  }
  arValidateMagic_(ext, bytes);
  return {
    bytes: bytes, extension: ext, claimedMimeType: claimed,
    mimeType: policy.mime,
    validationNote: 'extension=' + ext + '; signature=pass; mime=' + (claimed || 'unspecified')
  };
}

function arValidateMagic_(ext, bytes) {
  const ascii = function (start, len) { return arBytesAscii_(bytes, start, len); };
  const starts = function (signature) { return arBytesStart_(bytes, signature); };
  let valid = false;
  if (ext === 'pdf') valid = ascii(0, 5) === '%PDF-';
  else if (ext === 'jpg' || ext === 'jpeg') valid = starts([0xff, 0xd8, 0xff]);
  else if (ext === 'png') valid = starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (ext === 'gif') valid = ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
  else if (ext === 'webp') valid = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  else if (ext === 'heic') valid = bytes.length >= 12 && ascii(4, 4) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].indexOf(ascii(8, 4)) > -1;
  else if (ext === 'txt' || ext === 'csv') valid = !arHasNul_(bytes, 8192);
  else if (ext === 'doc' || ext === 'xls') {
    valid = starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  } else if (ext === 'docx' || ext === 'xlsx') {
    const zip = starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08]);
    const contentTypes = arByteContainsAscii_(bytes, '[Content_Types].xml');
    const family = ext === 'docx' ? arByteContainsAscii_(bytes, 'word/') : arByteContainsAscii_(bytes, 'xl/');
    const macro = arByteContainsAsciiCaseInsensitive_(bytes, 'vbaProject.bin') ||
      arByteContainsAsciiCaseInsensitive_(bytes, 'vbaProjectSignature.bin');
    valid = zip && contentTypes && family && !macro;
  }
  if (!valid) throw new Error('File content does not match its extension or contains a blocked macro payload');
}

function arBytesStart_(bytes, sig) {
  if (!bytes || bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if ((bytes[i] & 0xff) !== sig[i]) return false;
  return true;
}

function arBytesAscii_(bytes, start, len) {
  let out = '';
  for (let i = start; i < start + len && i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 0xff);
  return out;
}

function arByteContainsAscii_(bytes, needle) {
  const target = [];
  for (let i = 0; i < needle.length; i++) target.push(needle.charCodeAt(i));
  outer: for (let p = 0; p <= bytes.length - target.length; p++) {
    for (let j = 0; j < target.length; j++) if ((bytes[p + j] & 0xff) !== target[j]) continue outer;
    return true;
  }
  return false;
}

function arByteContainsAsciiCaseInsensitive_(bytes, needle) {
  const target = String(needle || '').toLowerCase();
  outer: for (let p = 0; p <= bytes.length - target.length; p++) {
    for (let j = 0; j < target.length; j++) {
      const code = bytes[p + j] & 0xff;
      const lower = code >= 65 && code <= 90 ? code + 32 : code;
      if (lower !== target.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

function arHasNul_(bytes, limit) {
  const n = Math.min(bytes.length, limit || bytes.length);
  for (let i = 0; i < n; i++) if ((bytes[i] & 0xff) === 0) return true;
  return false;
}

function arSha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function arSafeFileName_(value) {
  let name = String(value || '').trim();
  if (name.normalize) name = name.normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  if (!name || name === '.' || name === '..') throw new Error('Invalid filename');
  if (name.length > 180) {
    const ext = name.indexOf('.') > -1 ? '.' + name.split('.').pop() : '';
    name = name.substring(0, Math.max(1, 180 - ext.length)) + ext;
  }
  return name;
}

function arLiveDriveFile_(attachment) {
  const id = arAttachmentFileId_(attachment);
  if (!id) throw new Error('Attachment has no Drive file');
  try {
    const file = DriveApp.getFileById(id);
    if (file.isTrashed()) throw new Error('trashed');
    if (arUnsafeSharingScope_(arDriveSharingScope_(file))) throw new Error('unsafe-sharing');
    return file;
  } catch (e) {
    throw new Error('Attachment file is missing or unavailable in Drive');
  }
}

function arDriveSharingScope_(file) {
  try {
    const access = file.getSharingAccess();
    const scope = access ? String(access).toUpperCase() : 'UNKNOWN';
    if (scope !== 'PRIVATE') return scope;
    // A PRIVATE link can still be reachable by explicitly granted users or by
    // inherited folder collaborators. Evidence storage is owner-only; access
    // is mediated by the application proxy after row-level authorization.
    const editors = file.getEditors ? file.getEditors() : [];
    const viewers = file.getViewers ? file.getViewers() : [];
    if ((editors && editors.length) || (viewers && viewers.length)) {
      return 'PRIVATE_WITH_COLLABORATORS';
    }
    return 'PRIVATE';
  } catch (e) {
    return 'UNKNOWN';
  }
}

function arUnsafeSharingScope_(scope) {
  const value = String(scope || '').toUpperCase();
  // Fail closed: an unreadable/unknown sharing state is not evidence that the
  // file is private. Only a verified owner-only PRIVATE state is accepted.
  return value !== 'PRIVATE';
}

function arStrictDriveFileId_(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
  const patterns = [
    /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})(?:\/[^?#]*)?(?:[?#].*)?$/i,
    /^https:\/\/drive\.google\.com\/open\?(?:[^#]*&)?id=([A-Za-z0-9_-]{20,})(?:&[^#]*)?$/i,
    /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/([A-Za-z0-9_-]{20,})(?:\/[^?#]*)?(?:[?#].*)?$/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = patterns[i].exec(text);
    if (m) return m[1];
  }
  return '';
}

// -----------------------------------------------------------------------------
// Registry/link/access-log storage helpers (column-alias tolerant)
// -----------------------------------------------------------------------------

function arRegistrySheetName_() {
  return SHEETS.ATTACHMENT_REGISTRY || 'AttachmentRegistry';
}

function arLinkSheetName_() {
  return SHEETS.ATTACHMENT_LINK || 'AttachmentLinks';
}

function arAccessLogSheetName_() {
  return SHEETS.ATTACHMENT_ACCESS_LOG || 'AttachmentAccessLog';
}

function arEnsureRegistryStorage_(needLinks) {
  ensureSheetBySchema_(arRegistrySheetName_());
  ensureSheetBySchema_(arAccessLogSheetName_());
  if (needLinks) {
    const name = arLinkSheetName_();
    if (!DB_SCHEMA[name]) throw new Error('AttachmentLinks schema is not installed');
    ensureSheetBySchema_(name);
  }
}

function arReadRows_(sheetName) {
  return readSheetObjectsEnsured_(sheetName, true);
}

function arAppendDirect_(sheetName, values, actorEmail) {
  const sh = ensureSheetBySchema_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const now = new Date();
  const obj = Object.assign({}, values || {});
  if (headers.indexOf('Timestamp') > -1 && !obj.Timestamp) obj.Timestamp = now;
  if (headers.indexOf('CreatedBy') > -1 && !obj.CreatedBy) obj.CreatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedBy') > -1) obj.LastUpdatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedAt') > -1) obj.LastUpdatedAt = now;
  sh.getRange(Math.max(2, sh.getLastRow() + 1), 1, 1, headers.length).setValues([
    headers.map(function (h) { return sheetSafeValue_(Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''); })
  ]);
  return sh.getLastRow();
}

function arRegistryWriteObject_(m) {
  return {
    AttachmentID: m.attachmentId,
    StorageType: m.storageType || 'DRIVE_FILE',
    FileID: m.fileId || '',
    ExternalURL: m.externalUrl || '',
    ParentFolderID: m.parentFolderId || '',
    FileName: m.fileName || '', OriginalName: m.fileName || '', StoredName: m.storedName || '',
    Extension: m.extension || '', ClaimedMimeType: m.claimedMimeType || '',
    MimeType: m.detectedMimeType || '', DetectedMimeType: m.detectedMimeType || '',
    SizeBytes: m.sizeBytes || 0,
    ChecksumSHA256: m.checksum || '', SHA256: m.checksum || '',
    ModuleKey: m.moduleKey || '', HomeModule: m.moduleKey || '', RecordID: m.recordId || '',
    Source: m.source || 'REGISTERED_UPLOAD', SourceChannel: m.source || 'REGISTERED_UPLOAD',
    Classification: m.classification || 'Internal', HighestClassification: m.classification || 'Internal',
    ContainsPersonalData: m.containsPersonalData || 'Unknown', SharingScope: m.sharingScope || 'UNKNOWN',
    UploadedBy: m.uploadedBy || '', UploaderEmail: m.uploadedBy || '', UploadedAt: m.uploadedAt || new Date(),
    Status: m.status || 'STAGED', ValidationStatus: 'PASS', ScanStatus: 'NOT_CONFIGURED',
    StoragePath: m.parentFolderId ? 'drive:' + m.parentFolderId : '',
    VersionNo: 1, ParentAttachmentID: '', RetentionUntil: m.retentionUntil || '',
    EffectiveRetainUntil: m.retentionUntil || '', ActiveLinkCount: 0,
    LegalHoldCount: 0, IsEvidence: m.isEvidence || 'No', Notes: m.notes || ''
  };
}

function arFindAttachment_(attachmentId) {
  const rows = arReadRows_(arRegistrySheetName_());
  for (let i = 0; i < rows.length; i++) if (arSame_(arAttachmentId_(rows[i]), attachmentId)) return rows[i];
  return null;
}

function arFindLinkById_(linkId) {
  const rows = arReadRows_(arLinkSheetName_());
  for (let i = 0; i < rows.length; i++) if (arSame_(arValue_(rows[i], ['LinkID']), linkId)) return rows[i];
  return null;
}

function arUpdateLink_(link, patch, actorEmail) {
  if (!link || !link._row) throw new Error('Attachment link row is unavailable');
  updateRow_(arLinkSheetName_(), link._row, patch, actorEmail);
}

/** Direct row update for callers that already hold ScriptLock. */
function arUpdateRowDirect_(sheetName, rowNumber, patch, actorEmail) {
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

function arUpdateRegistryDirect_(attachment, patch, actorEmail) {
  if (!attachment || !attachment._row) throw new Error('Attachment registry row is unavailable');
  return arUpdateRowDirect_(arRegistrySheetName_(), attachment._row, patch, actorEmail);
}

function arUpdateLinkDirect_(link, patch, actorEmail) {
  if (!link || !link._row) throw new Error('Attachment link row is unavailable');
  return arUpdateRowDirect_(arLinkSheetName_(), link._row, patch, actorEmail);
}

/** Exact mutable-state snapshots used to make critical rollback deterministic. */
function arRegistryMutableStatePatch_(attachment) {
  return {
    HomeModule: arValue_(attachment, ['HomeModule', 'ModuleKey']),
    IsEvidence: arValue_(attachment, ['IsEvidence']),
    Status: arValue_(attachment, ['Status']),
    ValidationStatus: arValue_(attachment, ['ValidationStatus']),
    ScanStatus: arValue_(attachment, ['ScanStatus']),
    HighestClassification: arValue_(attachment, ['HighestClassification', 'Classification']),
    ContainsPersonalData: arValue_(attachment, ['ContainsPersonalData']),
    EffectiveRetainUntil: arValue_(attachment, ['EffectiveRetainUntil', 'RetentionUntil']),
    ActiveLinkCount: arValue_(attachment, ['ActiveLinkCount']),
    LegalHoldCount: arValue_(attachment, ['LegalHoldCount']),
    SharingScope: arValue_(attachment, ['SharingScope']),
    LastVerifiedAt: arValue_(attachment, ['LastVerifiedAt']),
    LastAccessedAt: arValue_(attachment, ['LastAccessedAt']),
    AccessCount: arValue_(attachment, ['AccessCount']),
    TrashedAt: arValue_(attachment, ['TrashedAt', 'SoftDeletedAt']),
    TrashedBy: arValue_(attachment, ['TrashedBy', 'SoftDeletedBy']),
    TrashReason: arValue_(attachment, ['TrashReason']),
    Notes: arValue_(attachment, ['Notes'])
  };
}

function arLinkMutableStatePatch_(link) {
  return {
    Status: arValue_(link, ['Status']),
    RetainUntil: arValue_(link, ['RetainUntil', 'RetentionUntil']),
    LegalHold: arValue_(link, ['LegalHold', 'IsLegalHold']),
    LegalHoldReason: arValue_(link, ['LegalHoldReason']),
    UnlinkedAt: arValue_(link, ['UnlinkedAt']),
    UnlinkedBy: arValue_(link, ['UnlinkedBy']),
    Notes: arValue_(link, ['Notes'])
  };
}

function arUpdateRegistry_(attachment, patch, actorEmail) {
  if (!attachment || !attachment._row) throw new Error('Attachment registry row is unavailable');
  updateRow_(arRegistrySheetName_(), attachment._row, patch, actorEmail);
}

function arLinksForRecord_(context) {
  if (!DB_SCHEMA[arLinkSheetName_()]) return [];
  const expectedSheet = arEntitySheet_(context);
  return arReadRows_(arLinkSheetName_()).filter(function (row) {
    const actualSheet = String(arValue_(row, ['EntitySheet']) || '');
    return arSame_(arValue_(row, ['ModuleKey']), context.moduleKey) &&
      arSame_(arValue_(row, ['EntityID', 'RecordID']), context.recordId) &&
      (!actualSheet || !expectedSheet || actualSheet === String(expectedSheet)) &&
      (!arValue_(row, ['EntityType', 'RecordType']) ||
        arSame_(arValue_(row, ['EntityType', 'RecordType']), context.recordType));
  });
}

function arActiveLinksForAttachment_(attachment) {
  const id = arAttachmentId_(attachment);
  let links = [];
  let hasRealLinks = false;
  if (DB_SCHEMA[arLinkSheetName_()]) {
    const matching = arReadRows_(arLinkSheetName_()).filter(function (row) {
      return arSame_(arLinkAttachmentId_(row), id);
    });
    hasRealLinks = matching.length > 0;
    links = matching.filter(arIsActiveLink_);
  }
  if (!hasRealLinks && !links.length && arAttachmentStatus_(attachment) === 'ACTIVE' &&
      arRowRecordId_(attachment)) {
    links.push(arPseudoLink_(attachment, arNormalizeContext_(arRowModule_(attachment), arRowRecordId_(attachment), {
      recordType: arValue_(attachment, ['RecordType', 'EntityType'])
    })));
  }
  return links;
}

/** Historical links disable every legacy registry-only authorization fallback. */
function arHasAnyRealLinkForAttachment_(attachment) {
  if (!attachment || !DB_SCHEMA[arLinkSheetName_()]) return false;
  const attachmentId = arAttachmentId_(attachment);
  return arReadRows_(arLinkSheetName_()).some(function (row) {
    return arSame_(arLinkAttachmentId_(row), attachmentId);
  });
}

function arSoftDeleteCancelledLinks_(attachment) {
  if (!DB_SCHEMA[arLinkSheetName_()]) return [];
  const attachmentId = arAttachmentId_(attachment);
  const marker = 'SOFT_DELETE_ATTACHMENT=' + attachmentId;
  return arReadRows_(arLinkSheetName_()).filter(function (row) {
    return arSame_(arLinkAttachmentId_(row), attachmentId) && !arIsActiveLink_(row) &&
      String(arValue_(row, ['Notes']) || '').indexOf(marker) > -1;
  });
}

function arRetentionExpiredLinks_(attachment) {
  if (!DB_SCHEMA[arLinkSheetName_()]) return [];
  const attachmentId = arAttachmentId_(attachment);
  return arReadRows_(arLinkSheetName_()).filter(function (row) {
    return arSame_(arLinkAttachmentId_(row), attachmentId) &&
      String(arValue_(row, ['Status']) || '').toUpperCase() === 'EXPIRED' &&
      String(arValue_(row, ['Notes']) || '').indexOf('[EXPIRED_BY_RETENTION]') > -1;
  });
}

function arPseudoLink_(attachment, context) {
  return {
    AttachmentID: arAttachmentId_(attachment), ModuleKey: context.moduleKey,
    EntityType: context.recordType, EntityID: context.recordId, RecordID: context.recordId,
    FieldName: '', AttachmentRole: 'LEGACY', Status: 'ACTIVE',
    RetentionUntil: arValue_(attachment, ['RetentionUntil', 'EffectiveRetainUntil']), LegalHold: 'No'
  };
}

function arRefreshAttachmentAggregates_(attachment, actor) {
  attachment = arFindAttachment_(arAttachmentId_(attachment));
  return arRefreshAttachmentAggregatesCore_(attachment, actor, false);
}

/** Aggregate refresh for callers that already own ScriptLock. */
function arRefreshAttachmentAggregatesLocked_(attachment, actor) {
  attachment = arFindAttachment_(arAttachmentId_(attachment));
  return arRefreshAttachmentAggregatesCore_(attachment, actor, true);
}

function arRefreshAttachmentAggregatesCore_(attachment, actor, direct) {
  if (!attachment) throw new Error('Attachment aggregate target was not found');
  const links = arActiveLinksForAttachment_(attachment).filter(arIsActiveLink_);
  let holdCount = 0;
  let latest = null;
  links.forEach(function (link) {
    if (arTruthy_(arValue_(link, ['LegalHold', 'IsLegalHold']))) holdCount++;
    const d = arDate_(arValue_(link, ['RetentionUntil', 'RetainUntil']));
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  });
  const patch = {
    ActiveLinkCount: links.length,
    LegalHoldCount: holdCount,
    RetentionUntil: latest || arValue_(attachment, ['RetentionUntil']),
    EffectiveRetainUntil: latest || arValue_(attachment, ['EffectiveRetainUntil', 'RetentionUntil'])
  };
  if (direct) arUpdateRegistryDirect_(attachment, patch, actor.email);
  else arUpdateRegistry_(attachment, patch, actor.email);
  return arFindAttachment_(arAttachmentId_(attachment));
}

// -----------------------------------------------------------------------------
// Audit/access logging and lifecycle helpers
// -----------------------------------------------------------------------------

function arLogAttachmentAction_(attachment, actor, action, result, reason, context) {
  if (!actor) throw new Error('Attachment audit actor is required');
  const attachmentId = attachment ? arAttachmentId_(attachment) : '';
  const moduleKey = context && context.moduleKey ? context.moduleKey : (attachment ? arRowModule_(attachment) : '');
  const recordId = context && context.recordId ? context.recordId : (attachment ? arRowRecordId_(attachment) : '');
  appendRowEnsured_(arAccessLogSheetName_(), {
    AccessLogID: generateId('AAL'), AttachmentID: attachmentId,
    ModuleKey: moduleKey, RecordID: recordId, Action: action,
    ActorEmail: actor.email || '', ActorRole: actor.role || '', Result: result || 'success',
    Reason: sanitizeText(reason, 1000), FileSizeBytes: attachment ? arAttachmentSize_(attachment) : 0,
    ActionAt: new Date()
  }, actor.email || 'system');
  writeAudit_(actor, 'ATTACHMENT_' + action, moduleKey || 'attachment',
    arRegistrySheetName_(), attachmentId, sanitizeText(reason, 1000), result || 'success');
}

function arBestEffortDeniedLog_(attachment, actor, action, reason, context) {
  try {
    if (!actor) return;
    arLogAttachmentAction_(attachment, actor, action, 'denied', reason, context);
  } catch (e) { console.error('attachment denied audit: ' + e.message); }
}

function arCompensateFailedUpload_(attachment, file, actor, reason) {
  if (!attachment || !actor || !actor.email) return false;
  const attachmentId = arAttachmentId_(attachment);
  const lock = LockService.getScriptLock();
  let compensated = false;
  try {
    lock.waitLock(30000);
    actor = arAuthorizeMutationLocked_(actor, 'attachment.upload', null,
      { skipModuleCheck: true });
    const current = arFindAttachment_(attachmentId);
    if (!current || arAttachmentStatus_(current) !== 'STAGED' ||
        arAttachmentUploader_(current) !== arEmail_(actor.email)) return false;
    // Never compensate a row that another business transaction has made
    // durable or linked, even when the caller observed a post-commit error.
    if (arActiveLinksForAttachment_(current).length ||
        arAttachmentReferencedByDurableIntent_(attachmentId)) return false;
    if (file && arAttachmentFileId_(current) !== String(file.getId() || '')) return false;

    const registryBefore = arRegistryMutableStatePatch_(current);
    const intent = arBeginCriticalAuditLocked_(current, actor, 'UPLOAD_COMPENSATION', null,
      sanitizeText(reason, 300));
    let fileWasTrashed = false;
    try {
      if (file) {
        fileWasTrashed = file.isTrashed();
        if (!fileWasTrashed) file.setTrashed(true);
      }
      arUpdateRegistryDirect_(current, {
        Status: 'TRASHED', TrashedAt: new Date(), TrashedBy: actor.email,
        TrashReason: 'claim failed: ' + sanitizeText(reason, 300), ActiveLinkCount: 0
      }, actor.email);
      const verified = arFindAttachment_(attachmentId);
      if (!verified || arAttachmentStatus_(verified) !== 'TRASHED') {
        throw new Error('Upload compensation could not be verified');
      }
      arCompleteCriticalAuditLocked_(intent, 'success', 'UNLINKED_STAGED_UPLOAD_TRASHED');
      compensated = true;
    } catch (mutationError) {
      if (file && !fileWasTrashed) {
        try { if (file.isTrashed()) file.setTrashed(false); } catch (ignoreFileRollback) {}
      }
      try { arUpdateRegistryDirect_(current, registryBefore, actor.email); }
      catch (ignoreRegistryRollback) {}
      try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
      catch (auditError) {
        console.error('upload compensation audit completion: ' + auditError.message);
      }
      throw mutationError;
    }
  } catch (e) {
    console.error('attachment upload compensation: ' + e.message);
  } finally {
    try { lock.releaseLock(); } catch (ignoreRelease) {}
  }
  arBestEffortDeniedLog_(attachment, actor,
    compensated ? 'UPLOAD_COMPENSATED' : 'UPLOAD_COMPENSATION_SKIPPED', reason, null);
  return compensated;
}

function arUpdateAccessCounters_(attachment, actor) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
    actor = arAuthorizeMutationLocked_(actor, 'attachment.download', null,
      { skipModuleCheck: true });
    const current = authorizeRegisteredAttachment_(arAttachmentId_(attachment), 'read', actor);
    const count = Number(arValue_(current, ['AccessCount'])) || 0;
    arUpdateRegistryDirect_(current, {
      LastAccessedAt: new Date(), AccessCount: count + 1
    }, actor.email);
  } catch (e) {
    console.error('attachment access counter: ' + e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function arMarkIntegrityFailure_(attachment, actor, actualHash) {
  const lock = LockService.getScriptLock();
  let locked = false;
  let context = null;
  try {
    lock.waitLock(30000);
    locked = true;
    actor = arAuthorizeMutationLocked_(actor, 'attachment.download', null,
      { skipModuleCheck: true });
    attachment = authorizeRegisteredAttachment_(arAttachmentId_(attachment), 'read', actor);
    context = arPrimaryAuthorizedContext_(attachment, actor, 'read');
    const intent = arBeginCriticalAuditLocked_(attachment, actor,
      'INTEGRITY_QUARANTINE', context, 'checksum mismatch');
    try {
      arUpdateRegistryDirect_(attachment, {
      Status: 'QUARANTINED', ValidationStatus: 'FAIL',
      Notes: arAppendNote_(arValue_(attachment, ['Notes']), 'checksum mismatch actual=' + actualHash)
      }, actor.email);
      const verified = arFindAttachment_(arAttachmentId_(attachment));
      if (!verified || arAttachmentStatus_(verified) !== 'QUARANTINED') {
        throw new Error('Attachment integrity quarantine could not be verified');
      }
      arCompleteCriticalAuditLocked_(intent, 'success', 'QUARANTINED');
      attachment = verified;
    } catch (mutationError) {
      try { arCompleteCriticalAuditLocked_(intent, 'error', mutationError.message); }
      catch (auditError) {
        console.error('attachment integrity audit completion: ' + auditError.message);
      }
      throw mutationError;
    }
  } catch (e) {
    console.error('attachment integrity quarantine: ' + e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
  arBestEffortDeniedLog_(attachment, actor, 'INTEGRITY_FAILED', 'checksum mismatch', context);
}

function arCanRestoreAttachment_(attachment, actor) {
  if (!actor || !actor.email) return false;
  const isAdmin = actor.role === ROLES.IT_ADMIN || (typeof wfHasActionPermission_ === 'function' &&
      wfHasActionPermission_(actor, 'attachment.admin', { attachmentId: arAttachmentId_(attachment) }));
  if (isAdmin) {
    return true;
  }
  // Retention-deleted attachments and any attachment that has ever had an
  // EXPIRED link can only be restored through the audited admin exception.
  if (arRestoreRequiresAdmin_(attachment)) return false;
  const links = arSoftDeleteCancelledLinks_(attachment);
  for (let i = 0; i < links.length; i++) {
    if (arCanAuthorizeRecord_(actor, arContextFromLink_(links[i]), 'write')) return true;
  }
  const recordId = arRowRecordId_(attachment);
  if (recordId) {
    const context = arNormalizeContext_(arRowModule_(attachment), recordId, {
      recordType: arValue_(attachment, ['RecordType', 'EntityType'])
    });
    return arCanAuthorizeRecord_(actor, context, 'write');
  }
  // A never-claimed staged upload has no record lifecycle to violate.
  return !links.length && arAttachmentUploader_(attachment) === arEmail_(actor.email);
}

function arRestoreRequiresAdmin_(attachment) {
  if (!attachment) return true;
  const notes = String(arValue_(attachment, ['Notes']) || '');
  const reason = String(arValue_(attachment, ['TrashReason']) || '');
  if (/\[(?:SOFT_DELETED_BY_RETENTION|EXPIRED_BY_RETENTION)\]/i.test(notes) ||
      /retention/i.test(reason)) return true;
  if (!DB_SCHEMA[arLinkSheetName_()]) return false;
  const attachmentId = arAttachmentId_(attachment);
  return arReadRows_(arLinkSheetName_()).some(function (link) {
    return arSame_(arLinkAttachmentId_(link), attachmentId) &&
      String(arValue_(link, ['Status']) || '').toUpperCase() === 'EXPIRED';
  });
}

function arAttachmentHasLegalHold_(attachment, links) {
  if (arTruthy_(arValue_(attachment, ['LegalHold', 'IsLegalHold']))) return true;
  if ((Number(arValue_(attachment, ['LegalHoldCount'])) || 0) > 0) return true;
  return (links || []).some(function (link) { return arTruthy_(arValue_(link, ['LegalHold', 'IsLegalHold'])); });
}

// -----------------------------------------------------------------------------
// Deduplication and DTO helpers
// -----------------------------------------------------------------------------

function arFindReusableDuplicate_(checksum, size, actor, context) {
  const rows = arReadRows_(arRegistrySheetName_());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (arAttachmentHash_(row) !== checksum || arAttachmentSize_(row) !== size) continue;
    if (arAttachmentUploader_(row) !== arEmail_(actor.email) || !arSame_(arRowModule_(row), context.moduleKey)) continue;
    // The upload caller performs dedup only before a record is bound. Reuse
    // therefore accepts only an unowned STAGED row; ACTIVE no-link recovery
    // states are never returned as a claimable upload.
    if (arAttachmentStatus_(row) !== 'STAGED') continue;
    const links = arActiveLinksForAttachment_(row);
    if (!context.recordId && links.length) continue;
    if (!links.length && arAttachmentReferencedByDurableIntent_(arAttachmentId_(row))) continue;
    // If a future bound caller is introduced, only the same exact link may be
    // reused. Current bound uploads intentionally bypass this dedup function.
    let allowed = !links.length;
    if (context.recordId && links.length) allowed = arHasExactActiveLink_(row, context);
    if (!allowed) continue;
    try { arLiveDriveFile_(row); return row; } catch (e) {}
  }
  return null;
}

function arHasExactActiveLink_(attachment, context) {
  const attachmentId = arAttachmentId_(attachment);
  const expectedSheet = arEntitySheet_(context);
  return arActiveLinksForAttachment_(attachment).some(function (link) {
    return arIsActiveLink_(link) && arSame_(arLinkAttachmentId_(link), attachmentId) &&
      arSame_(arValue_(link, ['ModuleKey']), context.moduleKey) &&
      arSame_(arValue_(link, ['EntitySheet']), expectedSheet) &&
      arSame_(arValue_(link, ['EntityID', 'RecordID']), context.recordId) &&
      arSame_(arValue_(link, ['FieldName']), context.fieldName || '') &&
      arSame_(arValue_(link, ['AttachmentRole']), context.attachmentRole || 'GENERAL');
  });
}

function arPhysicalFileReferenceCount_(attachment) {
  const fileId = arAttachmentFileId_(attachment);
  if (!fileId) return 1;
  return arReadRows_(arRegistrySheetName_()).filter(function (row) {
    return arAttachmentFileId_(row) === fileId &&
      AR_ACTIVE_STATUS_.indexOf(arAttachmentStatus_(row)) > -1;
  }).length;
}

function arAttachmentDto_(row, context, link) {
  if (!row) return null;
  return {
    attachmentId: arAttachmentId_(row),
    filename: arAttachmentFileName_(row),
    mimeType: arAttachmentMime_(row),
    sizeBytes: arAttachmentSize_(row),
    checksumSHA256: arAttachmentHash_(row),
    status: arAttachmentStatus_(row),
    classification: arValue_(row, ['HighestClassification', 'Classification']) || 'Internal',
    isEvidence: arTruthy_(arValue_(row, ['IsEvidence'])),
    uploadedBy: arAttachmentUploader_(row),
    uploadedAt: safeFmtDateTime_(arValue_(row, ['UploadedAt', 'Timestamp'])),
    attachmentRole: link ? arValue_(link, ['AttachmentRole']) : (context && context.attachmentRole) || '',
    fieldName: link ? arValue_(link, ['FieldName']) : (context && context.fieldName) || '',
    canDownload: AR_ACTIVE_STATUS_.indexOf(arAttachmentStatus_(row)) > -1
  };
}

function arIsVisibleAttachment_(row) {
  return AR_ACTIVE_STATUS_.indexOf(arAttachmentStatus_(row)) > -1;
}

function arPrimaryAuthorizedContext_(attachment, actor, action) {
  const links = arActiveLinksForAttachment_(attachment);
  for (let i = 0; i < links.length; i++) {
    const context = arContextFromLink_(links[i]);
    if (arCanAuthorizeRecord_(actor, context, action)) return context;
  }
  if (arAttachmentStatus_(attachment) === 'ACTIVE' && arRowRecordId_(attachment) &&
      !arHasAnyRealLinkForAttachment_(attachment)) {
    const context = arNormalizeContext_(arRowModule_(attachment), arRowRecordId_(attachment), {
      recordType: arValue_(attachment, ['RecordType', 'EntityType'])
    });
    if (arCanAuthorizeRecord_(actor, context, action)) return context;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Context, retention and generic value helpers
// -----------------------------------------------------------------------------

function arNormalizeContext_(moduleKey, recordId, options) {
  options = options || {};
  let normalizedModule = arNormalizeModule_(moduleKey);
  let recordType = sanitizeText(options.recordType || options.entityType, 80);
  if (!recordType) recordType = arDefaultRecordType_(normalizedModule);
  const aliases = {
    servicerequest: 'ServiceRequest', servicerequesttask: 'ServiceRequestTask',
    task: 'PersonalTask', personaltask: 'PersonalTask', ticket: 'Ticket',
    access: 'AccessRequest', accessrequest: 'AccessRequest',
    change: 'ChangeRequest', changerequest: 'ChangeRequest',
    incident: 'Incident',
    workflow: 'WorkflowInstance', workflowinstance: 'WorkflowInstance',
    workflowapproval: 'WorkflowApproval'
  };
  recordType = aliases[String(recordType || '').replace(/[^a-z]/gi, '').toLowerCase()] || recordType;
  const canonicalModules = {
    ServiceRequest: 'serviceCatalog', ServiceRequestTask: 'serviceCatalog',
    PersonalTask: 'task', Ticket: 'ticket', AccessRequest: 'access',
    ChangeRequest: 'change', Incident: 'incident',
    WorkflowInstance: 'workflow', WorkflowApproval: 'workflow'
  };
  const canonicalModule = canonicalModules[recordType] || '';
  if (recordType && !canonicalModule) throw new Error('Unsupported attachment record type');
  if (canonicalModule && normalizedModule && canonicalModule !== normalizedModule) {
    throw new Error('Attachment module and record type do not match');
  }
  if (canonicalModule) normalizedModule = canonicalModule;
  const context = {
    moduleKey: normalizedModule,
    recordId: sanitizeText(recordId, 120),
    recordType: recordType,
    fieldName: sanitizeText(options.fieldName, 100),
    attachmentRole: sanitizeText(options.attachmentRole || options.role, 80) || 'GENERAL'
  };
  return context;
}

function arNormalizeModule_(value) {
  const key = String(value || '').trim();
  const compact = key.replace(/[^a-z]/gi, '').toLowerCase();
  const aliases = {
    servicecatalog: 'serviceCatalog', servicerequest: 'serviceCatalog', servicerequesttask: 'serviceCatalog',
    task: 'task', personaltask: 'task', ticket: 'ticket',
    access: 'access', accessrequest: 'access', change: 'change', changerequest: 'change',
    incident: 'incident',
    workflow: 'workflow', workflowinstance: 'workflow', workflowapproval: 'workflow'
  };
  return aliases[compact] || key;
}

function arDefaultRecordType_(moduleKey) {
  return {
    serviceCatalog: 'ServiceRequest', task: 'PersonalTask', ticket: 'Ticket',
    access: 'AccessRequest', change: 'ChangeRequest', incident: 'Incident', workflow: 'WorkflowInstance'
  }[moduleKey] || '';
}

function arSupportedModule_(moduleKey) {
  return ['serviceCatalog', 'task', 'ticket', 'access', 'change', 'incident', 'workflow'].indexOf(moduleKey) > -1;
}

function arContextFromLink_(link) {
  const linkedType = arValue_(link, ['EntityType', 'RecordType']) ||
    arRecordTypeFromEntitySheet_(arValue_(link, ['EntitySheet']));
  return arNormalizeContext_(arValue_(link, ['ModuleKey']), arValue_(link, ['EntityID', 'RecordID']), {
    recordType: linkedType,
    fieldName: arValue_(link, ['FieldName']),
    attachmentRole: arValue_(link, ['AttachmentRole'])
  });
}

function arRecordTypeFromEntitySheet_(sheetName) {
  const name = String(sheetName || '');
  if (name === String(SHEETS.SERVICE_REQUEST)) return 'ServiceRequest';
  if (name === String(SHEETS.SERVICE_REQUEST_TASK)) return 'ServiceRequestTask';
  if (name === String(SHEETS.PERSONAL_TASK)) return 'PersonalTask';
  if (name === String(SHEETS.TICKET)) return 'Ticket';
  if (name === String(SHEETS.ACCESS_REQ)) return 'AccessRequest';
  if (name === String(SHEETS.CHANGE)) return 'ChangeRequest';
  if (name === String(SHEETS.INCIDENT)) return 'Incident';
  if (name === String(SHEETS.WORKFLOW_INSTANCE)) return 'WorkflowInstance';
  if (name === String(SHEETS.WORKFLOW_APPROVAL)) return 'WorkflowApproval';
  return '';
}

function arEntitySheet_(context) {
  const map = {};
  map.ServiceRequest = SHEETS.SERVICE_REQUEST;
  map.ServiceRequestTask = SHEETS.SERVICE_REQUEST_TASK;
  map.PersonalTask = SHEETS.PERSONAL_TASK;
  map.Ticket = SHEETS.TICKET;
  map.AccessRequest = SHEETS.ACCESS_REQ;
  map.ChangeRequest = SHEETS.CHANGE;
  map.Incident = SHEETS.INCIDENT;
  map.WorkflowInstance = SHEETS.WORKFLOW_INSTANCE;
  map.WorkflowApproval = SHEETS.WORKFLOW_APPROVAL;
  return map[context.recordType] || '';
}

function arDefaultRetentionUntil_(context) {
  let key = 'ATTACHMENT_RETENTION_DAYS';
  let fallback = 730;
  if (context.moduleKey === 'serviceCatalog') key = 'SERVICE_REQUEST_PII_RETENTION_DAYS';
  else if (context.moduleKey === 'ticket') key = 'TICKET_PII_RETENTION_DAYS';
  else if (context.moduleKey === 'task') { key = 'SOFT_DELETE_RETENTION_DAYS'; fallback = 365; }
  let days = parseInt(getConfig_(key, String(fallback)), 10);
  if (isNaN(days) || days < 30 || days > 36500) days = fallback;
  return new Date(Date.now() + days * 86400000);
}

function arRetentionPolicyKey_(context) {
  if (context.moduleKey === 'serviceCatalog') return 'SERVICE_REQUEST_PII_RETENTION_DAYS';
  if (context.moduleKey === 'ticket') return 'TICKET_PII_RETENTION_DAYS';
  if (context.moduleKey === 'task') return 'SOFT_DELETE_RETENTION_DAYS';
  return 'ATTACHMENT_RETENTION_DAYS';
}

function arClassification_(value, context) {
  const ranks = { Public: 0, Internal: 1, Confidential: 2, Restricted: 3 };
  const requested = Object.prototype.hasOwnProperty.call(ranks, value) ? value : 'Internal';
  const floor = ['serviceCatalog', 'access', 'incident', 'workflow'].indexOf(context.moduleKey) > -1 ?
    'Confidential' : 'Internal';
  return ranks[requested] > ranks[floor] ? requested : floor;
}

function arDownloadLimitBytes_() {
  let mb = parseInt(getConfig_('ATTACHMENT_DOWNLOAD_MAX_MB', String(AR_DEFAULT_DOWNLOAD_MB_)), 10);
  if (isNaN(mb) || mb < 1) mb = AR_DEFAULT_DOWNLOAD_MB_;
  mb = Math.min(mb, AR_MAX_DOWNLOAD_MB_);
  return mb * 1024 * 1024;
}

function arValue_(row, names) {
  row = row || {};
  for (let i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(row, names[i]) && row[names[i]] !== '' && row[names[i]] !== null && row[names[i]] !== undefined) return row[names[i]];
  }
  return '';
}

function arAttachmentId_(row) { return String(arValue_(row, ['AttachmentID']) || ''); }
function arAttachmentFileId_(row) { return String(arValue_(row, ['FileID']) || ''); }
function arAttachmentFileName_(row) { return String(arValue_(row, ['OriginalName', 'FileName', 'StoredName']) || 'attachment'); }
function arAttachmentMime_(row) { return String(arValue_(row, ['DetectedMimeType', 'MimeType']) || 'application/octet-stream'); }
function arAttachmentSize_(row) { return Number(arValue_(row, ['SizeBytes'])) || 0; }
function arAttachmentHash_(row) { return String(arValue_(row, ['SHA256', 'ChecksumSHA256']) || '').toLowerCase(); }
function arAttachmentUploader_(row) { return arEmail_(arValue_(row, ['UploaderEmail', 'UploadedBy', 'CreatedBy'])); }
function arAttachmentStatus_(row) { return String(arValue_(row, ['Status']) || 'STAGED').toUpperCase(); }
function arRowModule_(row) { return arNormalizeModule_(arValue_(row, ['HomeModule', 'ModuleKey'])); }
function arRowRecordId_(row) { return String(arValue_(row, ['RecordID', 'EntityID']) || ''); }
function arLinkAttachmentId_(row) { return String(arValue_(row, ['AttachmentID']) || ''); }
function arStorageType_(row) { return String(arValue_(row, ['StorageType']) || (arAttachmentFileId_(row) ? 'DRIVE_FILE' : 'EXTERNAL_URL')).toUpperCase(); }
function arEmail_(v) { return String(v || '').trim().toLowerCase(); }
function arSame_(a, b) { return String(a || '') === String(b || ''); }
function arTruthy_(v) { return v === true || ['true', 'yes', 'y', '1', 'on'].indexOf(String(v || '').trim().toLowerCase()) > -1; }
function arIsActiveLink_(row) { const s = String(arValue_(row, ['Status']) || 'ACTIVE').toUpperCase(); return s === 'ACTIVE' || s === 'LINKED'; }

function arDate_(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function arAppendNote_(oldValue, note) {
  const line = '[' + fmtDateTime(new Date()) + '] ' + sanitizeText(note, 500);
  return oldValue ? String(oldValue) + ' | ' + line : line;
}
