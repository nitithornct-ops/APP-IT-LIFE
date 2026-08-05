/**
 * Module_CMDB.gs
 * Configuration Management Database (CMDB) and typed relationship registry.
 *
 * The module keeps technical CIs in ConfigurationItems and stores links to both
 * CIs and existing operational records in CIRelationships.  All public functions
 * enforce the `cmdb` module permission on the server and use the shared response,
 * audit, sanitisation and spreadsheet helpers.
 */

const CMDB_CI_TYPES = [
  'Server', 'VM', 'Database', 'Application', 'Website', 'Network Device',
  'Firewall', 'Switch', 'Access Point', 'Domain', 'SSL Certificate', 'API',
  'Cloud Service', 'Backup Job', 'Business Service', 'Other'
];
const CMDB_ENVIRONMENTS = ['Production', 'UAT', 'Development', 'DR', 'Shared', 'N/A'];
const CMDB_CRITICALITIES = ['Low', 'Medium', 'High', 'Critical'];
const CMDB_CI_STATUSES = ['Draft', 'Active', 'Maintenance', 'Degraded', 'Retired'];
const CMDB_DATA_CLASSIFICATIONS = ['ไม่ลับ', 'ลับ', 'ลับมาก'];
const CMDB_BACKUP_REQUIRED = ['Yes', 'No'];

const CMDB_NODE_TYPES = ['CI', 'Asset', 'Vendor', 'Contract', 'Cloud', 'Backup', 'Incident', 'Change'];
const CMDB_RELATIONSHIP_TYPES = [
  'DEPENDS_ON', 'RUNS_ON', 'HOSTS', 'CONNECTS_TO', 'USES', 'BACKED_UP_BY',
  'SUPPLIED_BY', 'COVERED_BY_CONTRACT', 'IMPACTED_BY', 'CHANGED_BY', 'LINKED_TO'
];
const CMDB_RELATIONSHIP_DIRECTIONS = ['Forward', 'Bidirectional'];
const CMDB_RELATIONSHIP_STATUSES = ['Active', 'Inactive'];
const CMDB_IMPACT_LEVELS = ['Low', 'Medium', 'High', 'Critical'];

/** Load the complete CMDB workspace in batch for list, relationship and map views. */
function getCmdbModuleData() {
  try {
    const user = requireModule('cmdb', false);
    ensureSheetBySchema_(SHEETS.CONFIG_ITEM);
    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);

    const canEdit = canEditModule(user.role, 'cmdb');
    const catalog = cmdbBuildNodeCatalog_();
    const ciRows = readSheetObjects_(SHEETS.CONFIG_ITEM);
    const relationshipRows = readSheetObjects_(SHEETS.CI_RELATIONSHIP);
    const items = ciRows.map(cmdbCiDto_);
    const relationships = relationshipRows.map(function (row) {
      return cmdbRelationshipDto_(row, catalog);
    });

    // Read-only users receive only nodes already present in the graph plus all CIs.
    // The full external-record selector is returned only to an editor.
    const visibleNodeKeys = {};
    items.forEach(function (item) { visibleNodeKeys[cmdbNodeKey_('CI', item.id)] = true; });
    relationships.forEach(function (rel) {
      visibleNodeKeys[cmdbNodeKey_(rel.sourceType, rel.sourceId)] = true;
      visibleNodeKeys[cmdbNodeKey_(rel.targetType, rel.targetId)] = true;
    });
    const nodes = catalog.nodes.filter(function (node) {
      return visibleNodeKeys[cmdbNodeKey_(node.type, node.id)];
    });

    const stats = {
      total: items.length,
      active: items.filter(function (item) { return item.status === 'Active'; }).length,
      critical: items.filter(function (item) {
        return item.status !== 'Retired' && item.criticality === 'Critical';
      }).length,
      degraded: items.filter(function (item) {
        return item.status === 'Degraded' || item.status === 'Maintenance';
      }).length,
      unverified: items.filter(function (item) {
        return item.status !== 'Retired' && !item.lastVerifiedAt;
      }).length,
      activeRelationships: relationships.filter(function (rel) {
        return rel.status === 'Active' && !rel.expired && !rel.notStarted;
      }).length,
      expiredRelationships: relationships.filter(function (rel) {
        return rel.status === 'Active' && rel.expired;
      }).length,
      orphanRelationships: relationships.filter(function (rel) {
        return rel.sourceMissing || rel.targetMissing;
      }).length
    };

    return ok({
      role: user.role,
      canEdit: canEdit,
      items: items,
      relationships: relationships,
      nodes: nodes,
      nodeOptions: canEdit ? catalog.nodes : [],
      stats: stats,
      ciTypes: CMDB_CI_TYPES,
      environments: CMDB_ENVIRONMENTS,
      criticalities: CMDB_CRITICALITIES,
      ciStatuses: CMDB_CI_STATUSES,
      dataClassifications: CMDB_DATA_CLASSIFICATIONS,
      backupRequiredOptions: CMDB_BACKUP_REQUIRED,
      nodeTypes: CMDB_NODE_TYPES,
      relationshipTypes: CMDB_RELATIONSHIP_TYPES,
      relationshipDirections: CMDB_RELATIONSHIP_DIRECTIONS,
      relationshipStatuses: CMDB_RELATIONSHIP_STATUSES,
      impactLevels: CMDB_IMPACT_LEVELS
    });
  } catch (e) {
    return fail(e.message, 'CMDB_LOAD_FAILED');
  }
}

/** Create or update a Configuration Item. */
function saveConfigurationItem(form) {
  try {
    const user = requireModule('cmdb', true);
    form = form || {};
    ensureSheetBySchema_(SHEETS.CONFIG_ITEM);
    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);

    const existingId = sanitizeText(form.id || form.ciId, 100);
    const payload = cmdbValidateCiForm_(form);
    const catalog = cmdbBuildNodeCatalog_();
    cmdbValidateCiReferences_(payload, catalog);
    if (existingId) {
      // Any material edit invalidates the previous currency attestation.
      payload.LastVerifiedAt = '';
      payload.LastVerifiedBy = '';
    }

    const ciId = existingId || generateId('CI');
    payload.CIID = ciId;
    cmdbUpsertLocked_(SHEETS.CONFIG_ITEM, 'CIID', existingId, payload, user.email,
      function (rows, existing) {
        cmdbValidateCiUniqueness_(rows, payload, existing ? existing.CIID : '');
        if (payload.Status === 'Retired') cmdbAssertNoActiveCiRelationships_(ciId);
      });

    writeAudit_(user, existingId ? 'UPDATE_CI' : 'CREATE_CI', 'cmdb',
      SHEETS.CONFIG_ITEM, ciId,
      payload.CIName + ' · ' + payload.CIType + ' · ' + payload.Environment, 'success');
    return ok({ id: ciId }, existingId ? 'อัปเดต Configuration Item แล้ว' : 'สร้าง Configuration Item แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_CI_SAVE_FAILED');
  }
}

/** Change CI lifecycle status with a retirement relationship guard. */
function updateConfigurationItemStatus(ciId, status, reason) {
  try {
    const user = requireModule('cmdb', true);
    ciId = sanitizeText(ciId, 100);
    status = sanitizeText(status, 40);
    reason = sanitizeText(reason, 1000);
    if (!ciId) throw new Error('กรุณาระบุ Configuration Item ที่ต้องการเปลี่ยนสถานะ');
    if (!isInList(status, CMDB_CI_STATUSES)) throw new Error('สถานะ Configuration Item ไม่ถูกต้อง');
    if ((status === 'Degraded' || status === 'Retired') && !reason) {
      throw new Error('กรุณาระบุเหตุผลสำหรับสถานะ ' + status);
    }

    ensureSheetBySchema_(SHEETS.CONFIG_ITEM);
    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);
    cmdbUpsertLocked_(SHEETS.CONFIG_ITEM, 'CIID', ciId, { Status: status }, user.email,
      function () {
        if (status === 'Retired') cmdbAssertNoActiveCiRelationships_(ciId);
      });
    writeAudit_(user, 'UPDATE_CI_STATUS', 'cmdb', SHEETS.CONFIG_ITEM, ciId,
      status + (reason ? ' · ' + reason : ''), 'success');
    return ok({ id: ciId, status: status }, 'อัปเดตสถานะ Configuration Item แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_CI_STATUS_FAILED');
  }
}

/** Record an independent currency/accuracy check of a CI. */
function verifyConfigurationItem(ciId, note) {
  try {
    const user = requireModule('cmdb', true);
    ciId = sanitizeText(ciId, 100);
    note = sanitizeText(note, 1000);
    ensureSheetBySchema_(SHEETS.CONFIG_ITEM);
    const row = findRowEnsured_(SHEETS.CONFIG_ITEM, 'CIID', ciId);
    if (!row) throw new Error('ไม่พบ Configuration Item');
    updateRow_(SHEETS.CONFIG_ITEM, row._row, {
      LastVerifiedAt: new Date(),
      LastVerifiedBy: user.email
    }, user.email);
    writeAudit_(user, 'VERIFY_CI', 'cmdb', SHEETS.CONFIG_ITEM, ciId,
      note || 'ตรวจยืนยันข้อมูล Configuration Item', 'success');
    return ok({ id: ciId, verifiedBy: user.email }, 'ตรวจยืนยัน Configuration Item แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_CI_VERIFY_FAILED');
  }
}

/** Create or update a typed relationship between CMDB/operational nodes. */
function saveCIRelationship(form) {
  try {
    const user = requireModule('cmdb', true);
    form = form || {};
    ensureSheetBySchema_(SHEETS.CONFIG_ITEM);
    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);

    const existingId = sanitizeText(form.id || form.relationshipId, 100);
    const catalog = cmdbBuildNodeCatalog_();
    const payload = cmdbValidateRelationshipForm_(form, catalog);
    if (existingId) {
      // Endpoint/type/date changes must be verified again after saving.
      payload.LastVerifiedAt = '';
      payload.LastVerifiedBy = '';
    }
    const relationshipId = existingId || generateId('REL');
    payload.RelationshipID = relationshipId;

    cmdbUpsertLocked_(SHEETS.CI_RELATIONSHIP, 'RelationshipID', existingId,
      payload, user.email, function (rows, existing) {
        // Re-read endpoints while holding the same script lock used by CI retirement.
        // This closes the race where a CI could retire after the initial form check.
        if (payload.Status === 'Active') {
          const lockedCatalog = cmdbBuildNodeCatalog_();
          const source = cmdbAssertEndpointExists_(payload.SourceType, payload.SourceID,
            lockedCatalog, 'ต้นทาง');
          const target = cmdbAssertEndpointExists_(payload.TargetType, payload.TargetID,
            lockedCatalog, 'ปลายทาง');
          cmdbAssertActiveRelationshipEndpoints_(source, target);
        }
        cmdbValidateRelationshipUniqueness_(rows, payload,
          existing ? existing.RelationshipID : '');
        cmdbAssertNoDependencyCycle_(rows, payload,
          existing ? existing.RelationshipID : '');
      });

    writeAudit_(user, existingId ? 'UPDATE_CI_RELATIONSHIP' : 'CREATE_CI_RELATIONSHIP',
      'cmdb', SHEETS.CI_RELATIONSHIP, relationshipId,
      payload.SourceType + ':' + payload.SourceID + ' ' + payload.RelationshipType + ' ' +
      payload.TargetType + ':' + payload.TargetID, 'success');
    return ok({ id: relationshipId }, existingId ? 'อัปเดตความสัมพันธ์แล้ว' : 'สร้างความสัมพันธ์แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_RELATIONSHIP_SAVE_FAILED');
  }
}

/** Activate/deactivate a relationship, revalidating references and graph integrity on activation. */
function updateCIRelationshipStatus(relationshipId, status, reason) {
  try {
    const user = requireModule('cmdb', true);
    relationshipId = sanitizeText(relationshipId, 100);
    status = sanitizeText(status, 40);
    reason = sanitizeText(reason, 1000);
    if (!isInList(status, CMDB_RELATIONSHIP_STATUSES)) throw new Error('สถานะความสัมพันธ์ไม่ถูกต้อง');
    if (status === 'Inactive' && !reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิกความสัมพันธ์');

    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);
    cmdbUpsertLocked_(SHEETS.CI_RELATIONSHIP, 'RelationshipID', relationshipId,
      { Status: status }, user.email, function (rows, existing) {
        if (!existing) throw new Error('ไม่พบความสัมพันธ์');
        if (status !== 'Active') return;
        const candidate = Object.assign({}, existing, { Status: status });
        const lockedCatalog = cmdbBuildNodeCatalog_();
        const source = cmdbAssertEndpointExists_(candidate.SourceType, candidate.SourceID,
          lockedCatalog, 'ต้นทาง');
        const target = cmdbAssertEndpointExists_(candidate.TargetType, candidate.TargetID,
          lockedCatalog, 'ปลายทาง');
        cmdbAssertActiveRelationshipEndpoints_(source, target);
        cmdbValidateRelationshipUniqueness_(rows, candidate, relationshipId);
        cmdbAssertNoDependencyCycle_(rows, candidate, relationshipId);
      });

    writeAudit_(user, 'UPDATE_CI_RELATIONSHIP_STATUS', 'cmdb',
      SHEETS.CI_RELATIONSHIP, relationshipId,
      status + (reason ? ' · ' + reason : ''), 'success');
    return ok({ id: relationshipId, status: status }, 'อัปเดตสถานะความสัมพันธ์แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_RELATIONSHIP_STATUS_FAILED');
  }
}

/** Record a relationship verification without changing the relationship itself. */
function verifyCIRelationship(relationshipId, note) {
  try {
    const user = requireModule('cmdb', true);
    relationshipId = sanitizeText(relationshipId, 100);
    note = sanitizeText(note, 1000);
    ensureSheetBySchema_(SHEETS.CI_RELATIONSHIP);
    const row = findRowEnsured_(SHEETS.CI_RELATIONSHIP, 'RelationshipID', relationshipId);
    if (!row) throw new Error('ไม่พบความสัมพันธ์');
    updateRow_(SHEETS.CI_RELATIONSHIP, row._row, {
      LastVerifiedAt: new Date(),
      LastVerifiedBy: user.email
    }, user.email);
    writeAudit_(user, 'VERIFY_CI_RELATIONSHIP', 'cmdb',
      SHEETS.CI_RELATIONSHIP, relationshipId,
      note || 'ตรวจยืนยันความสัมพันธ์', 'success');
    return ok({ id: relationshipId, verifiedBy: user.email }, 'ตรวจยืนยันความสัมพันธ์แล้ว');
  } catch (e) {
    return fail(e.message, 'CMDB_RELATIONSHIP_VERIFY_FAILED');
  }
}

// ============================================================================
// Validation and persistence helpers
// ============================================================================

function cmdbValidateCiForm_(form) {
  const payload = {
    CIName: sanitizeText(form.name || form.ciName, 200),
    CIType: sanitizeText(form.type || form.ciType, 80),
    Environment: sanitizeText(form.environment, 50),
    BusinessService: sanitizeText(form.businessService, 200),
    Owner: sanitizeText(form.owner, 160),
    Administrator: sanitizeText(form.administrator, 160),
    Criticality: sanitizeText(form.criticality, 30),
    IPAddress: sanitizeText(form.ipAddress, 500),
    URL: sanitizeText(form.url, 500),
    Version: sanitizeText(form.version, 100),
    VendorID: sanitizeText(form.vendorId, 100),
    ContractRef: sanitizeText(form.contractRef, 150),
    AssetID: sanitizeText(form.assetId, 100),
    CloudID: sanitizeText(form.cloudId, 100),
    DataClassification: sanitizeText(form.dataClassification, 50),
    RPOHours: cmdbOptionalNumber_(form.rpoHours, 'RPO', 0, 87600),
    RTOHours: cmdbOptionalNumber_(form.rtoHours, 'RTO', 0, 87600),
    BackupRequired: sanitizeText(form.backupRequired, 10),
    BackupReference: sanitizeText(form.backupReference, 150),
    Location: sanitizeText(form.location, 300),
    Status: sanitizeText(form.status, 40) || 'Draft',
    Notes: sanitizeText(form.notes, 2000)
  };

  requireFields({
    'ชื่อ CI': payload.CIName,
    'ประเภท CI': payload.CIType,
    Environment: payload.Environment,
    Owner: payload.Owner,
    Administrator: payload.Administrator,
    Criticality: payload.Criticality,
    'Data Classification': payload.DataClassification,
    'Backup Required': payload.BackupRequired,
    Status: payload.Status
  }, ['ชื่อ CI', 'ประเภท CI', 'Environment', 'Owner', 'Administrator', 'Criticality',
    'Data Classification', 'Backup Required', 'Status']);

  if (!isInList(payload.CIType, CMDB_CI_TYPES)) throw new Error('ประเภท Configuration Item ไม่ถูกต้อง');
  if (!isInList(payload.Environment, CMDB_ENVIRONMENTS)) throw new Error('Environment ไม่ถูกต้อง');
  if (!isInList(payload.Criticality, CMDB_CRITICALITIES)) throw new Error('Criticality ไม่ถูกต้อง');
  if (!isInList(payload.Status, CMDB_CI_STATUSES)) throw new Error('สถานะ Configuration Item ไม่ถูกต้อง');
  if (!isInList(payload.DataClassification, CMDB_DATA_CLASSIFICATIONS)) {
    throw new Error('Data Classification ไม่ถูกต้อง');
  }
  if (!isInList(payload.BackupRequired, CMDB_BACKUP_REQUIRED)) throw new Error('ค่า Backup Required ไม่ถูกต้อง');
  if (payload.IPAddress && !cmdbIsValidIpList_(payload.IPAddress)) {
    throw new Error('IP Address ไม่ถูกต้อง (รองรับ IPv4, IPv6 และ CIDR คั่นด้วย comma)');
  }
  if (payload.URL && !/^https?:\/\/[^\s]+$/i.test(payload.URL)) {
    throw new Error('URL ต้องขึ้นต้นด้วย http:// หรือ https://');
  }
  if (payload.BackupRequired === 'Yes' && !payload.BackupReference) {
    throw new Error('CI ที่กำหนดให้สำรองข้อมูลต้องระบุ Backup Reference');
  }
  if (payload.Status === 'Active' && payload.Environment === 'Production' &&
      (payload.Criticality === 'High' || payload.Criticality === 'Critical')) {
    if (payload.RPOHours === '' || payload.RTOHours === '') {
      throw new Error('Production CI ระดับ High/Critical ต้องกำหนด RPO และ RTO');
    }
  }
  return payload;
}

function cmdbValidateCiReferences_(payload, catalog) {
  if (payload.AssetID) cmdbAssertEndpointExists_('Asset', payload.AssetID, catalog, 'Asset');
  if (payload.CloudID) cmdbAssertEndpointExists_('Cloud', payload.CloudID, catalog, 'Cloud');
  if (payload.VendorID) cmdbAssertEndpointExists_('Vendor', payload.VendorID, catalog, 'Vendor');
  if (payload.ContractRef) {
    const contract = cmdbAssertEndpointExists_('Contract', payload.ContractRef, catalog, 'Contract');
    if (payload.VendorID && contract.vendorId && String(contract.vendorId) !== String(payload.VendorID)) {
      throw new Error('Contract ไม่ได้อยู่ภายใต้ Vendor ที่เลือก');
    }
  }
  if (payload.BackupReference) {
    const backup = catalog.byKey[cmdbNodeKey_('Backup', payload.BackupReference)];
    const backupCi = catalog.byKey[cmdbNodeKey_('CI', payload.BackupReference)];
    if (!backup && !(backupCi && backupCi.ciType === 'Backup Job')) {
      throw new Error('Backup Reference ต้องอ้างอิง Backup record หรือ CI ประเภท Backup Job ที่มีอยู่');
    }
  }
}

function cmdbValidateCiUniqueness_(rows, payload, excludeId) {
  const nameKey = String(payload.CIName || '').toLowerCase();
  rows.forEach(function (row) {
    if (String(row.CIID) === String(excludeId)) return;
    if (String(row.Status) === 'Retired' && payload.Status !== 'Retired') return;
    if (String(row.CIName || '').toLowerCase() === nameKey &&
        String(row.Environment) === String(payload.Environment)) {
      throw new Error('มี CI ชื่อนี้ใน Environment เดียวกันอยู่แล้ว (' + row.CIID + ')');
    }
    if (payload.AssetID && String(row.AssetID) === String(payload.AssetID)) {
      throw new Error('Asset นี้เชื่อมกับ CI อื่นอยู่แล้ว (' + row.CIID + ')');
    }
    if (payload.CloudID && String(row.CloudID) === String(payload.CloudID)) {
      throw new Error('Cloud Service นี้เชื่อมกับ CI อื่นอยู่แล้ว (' + row.CIID + ')');
    }
  });
}

function cmdbValidateRelationshipForm_(form, catalog) {
  const payload = {
    SourceType: sanitizeText(form.sourceType, 40),
    SourceID: sanitizeText(form.sourceId, 150),
    TargetType: sanitizeText(form.targetType, 40),
    TargetID: sanitizeText(form.targetId, 150),
    RelationshipType: sanitizeText(form.relationshipType || form.type, 60),
    Direction: sanitizeText(form.direction, 30) || 'Forward',
    ImpactLevel: sanitizeText(form.impactLevel, 30) || 'Medium',
    Description: sanitizeText(form.description, 1500),
    Status: sanitizeText(form.status, 30) || 'Active',
    ValidFrom: cmdbParseOptionalDate_(form.validFrom, 'Valid From'),
    ValidUntil: cmdbParseOptionalDate_(form.validUntil, 'Valid Until'),
    Notes: sanitizeText(form.notes, 2000)
  };
  requireFields({
    SourceType: payload.SourceType, SourceID: payload.SourceID,
    TargetType: payload.TargetType, TargetID: payload.TargetID,
    RelationshipType: payload.RelationshipType, Direction: payload.Direction,
    ImpactLevel: payload.ImpactLevel, Status: payload.Status
  }, ['SourceType', 'SourceID', 'TargetType', 'TargetID', 'RelationshipType',
    'Direction', 'ImpactLevel', 'Status']);

  if (!isInList(payload.SourceType, CMDB_NODE_TYPES) || !isInList(payload.TargetType, CMDB_NODE_TYPES)) {
    throw new Error('ประเภท node ของความสัมพันธ์ไม่ถูกต้อง');
  }
  if (!isInList(payload.RelationshipType, CMDB_RELATIONSHIP_TYPES)) {
    throw new Error('ประเภทความสัมพันธ์ไม่ถูกต้อง');
  }
  if (!isInList(payload.Direction, CMDB_RELATIONSHIP_DIRECTIONS)) throw new Error('ทิศทางความสัมพันธ์ไม่ถูกต้อง');
  if (!isInList(payload.ImpactLevel, CMDB_IMPACT_LEVELS)) throw new Error('ระดับผลกระทบไม่ถูกต้อง');
  if (!isInList(payload.Status, CMDB_RELATIONSHIP_STATUSES)) throw new Error('สถานะความสัมพันธ์ไม่ถูกต้อง');
  if (payload.SourceType === payload.TargetType && payload.SourceID === payload.TargetID) {
    throw new Error('ไม่สามารถสร้างความสัมพันธ์ที่ต้นทางและปลายทางเป็นรายการเดียวกัน');
  }
  if (payload.ValidFrom && payload.ValidUntil && payload.ValidUntil < payload.ValidFrom) {
    throw new Error('Valid Until ต้องไม่ก่อน Valid From');
  }

  const source = cmdbAssertEndpointExists_(payload.SourceType, payload.SourceID, catalog, 'ต้นทาง');
  const target = cmdbAssertEndpointExists_(payload.TargetType, payload.TargetID, catalog, 'ปลายทาง');
  if (payload.Status === 'Active') cmdbAssertActiveRelationshipEndpoints_(source, target);
  cmdbValidateRelationshipSemantics_(payload, target);
  payload.SourceName = source.name;
  payload.TargetName = target.name;
  return payload;
}

function cmdbValidateRelationshipSemantics_(payload, targetNode) {
  const requiredTarget = {
    SUPPLIED_BY: ['Vendor'],
    COVERED_BY_CONTRACT: ['Contract'],
    BACKED_UP_BY: ['Backup', 'CI'],
    IMPACTED_BY: ['Incident'],
    CHANGED_BY: ['Change']
  };
  const allowed = requiredTarget[payload.RelationshipType];
  if (allowed && allowed.indexOf(payload.TargetType) === -1) {
    throw new Error(payload.RelationshipType + ' ต้องเชื่อมไปยัง ' + allowed.join(' หรือ '));
  }
  if (payload.RelationshipType === 'BACKED_UP_BY' && payload.TargetType === 'CI' &&
      targetNode && targetNode.ciType !== 'Backup Job') {
    throw new Error('BACKED_UP_BY ที่เชื่อมไปยัง CI ต้องเลือก CI ประเภท Backup Job');
  }
  if (payload.Direction === 'Bidirectional' &&
      ['CONNECTS_TO', 'LINKED_TO'].indexOf(payload.RelationshipType) === -1) {
    throw new Error('ความสัมพันธ์แบบสองทิศทางใช้ได้เฉพาะ CONNECTS_TO หรือ LINKED_TO');
  }
}

function cmdbValidateRelationshipUniqueness_(rows, payload, excludeId) {
  rows.forEach(function (row) {
    if (String(row.RelationshipID) === String(excludeId)) return;
    const same = row.SourceType === payload.SourceType && String(row.SourceID) === String(payload.SourceID) &&
      row.TargetType === payload.TargetType && String(row.TargetID) === String(payload.TargetID) &&
      row.RelationshipType === payload.RelationshipType;
    const symmetric = payload.Direction === 'Bidirectional' || row.Direction === 'Bidirectional' ||
      payload.RelationshipType === 'CONNECTS_TO' || payload.RelationshipType === 'LINKED_TO';
    const reverse = symmetric && row.SourceType === payload.TargetType &&
      String(row.SourceID) === String(payload.TargetID) && row.TargetType === payload.SourceType &&
      String(row.TargetID) === String(payload.SourceID) && row.RelationshipType === payload.RelationshipType;
    if (same || reverse) throw new Error('มีความสัมพันธ์รายการนี้อยู่แล้ว (' + row.RelationshipID + ')');
  });
}

function cmdbAssertNoDependencyCycle_(rows, payload, excludeId) {
  if (payload.Status !== 'Active' || ['DEPENDS_ON', 'RUNS_ON'].indexOf(payload.RelationshipType) === -1) return;
  const graph = {};
  rows.forEach(function (row) {
    if (String(row.RelationshipID) === String(excludeId) || row.Status !== 'Active') return;
    if (['DEPENDS_ON', 'RUNS_ON'].indexOf(row.RelationshipType) === -1) return;
    const from = cmdbNodeKey_(row.SourceType, row.SourceID);
    const to = cmdbNodeKey_(row.TargetType, row.TargetID);
    if (!graph[from]) graph[from] = [];
    graph[from].push(to);
  });
  const source = cmdbNodeKey_(payload.SourceType, payload.SourceID);
  const target = cmdbNodeKey_(payload.TargetType, payload.TargetID);
  if (!graph[source]) graph[source] = [];
  graph[source].push(target);

  const visited = {};
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    if (current === source) throw new Error('ความสัมพันธ์นี้ทำให้เกิด dependency cycle');
    if (visited[current]) continue;
    visited[current] = true;
    (graph[current] || []).forEach(function (next) { stack.push(next); });
  }
}

function cmdbAssertNoActiveCiRelationships_(ciId) {
  const active = readSheetObjects_(SHEETS.CI_RELATIONSHIP).filter(function (row) {
    if (row.Status !== 'Active') return false;
    return (row.SourceType === 'CI' && String(row.SourceID) === String(ciId)) ||
      (row.TargetType === 'CI' && String(row.TargetID) === String(ciId));
  });
  if (active.length) {
    throw new Error('ยกเลิกใช้งาน CI ไม่ได้ เนื่องจากยังมีความสัมพันธ์ Active ' + active.length + ' รายการ');
  }
}

/** Header-aware, atomic upsert used for uniqueness checks and writes in one script lock. */
function cmdbUpsertLocked_(sheetName, keyColumn, existingId, payload, actorEmail, validator) {
  const sh = ensureSheetBySchema_(sheetName);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const values = sh.getDataRange().getValues();
    const headers = values[0] || DB_SCHEMA[sheetName];
    const rows = cmdbObjectsFromValues_(values);
    let existing = null;
    if (existingId) {
      rows.some(function (row) {
        if (String(row[keyColumn]) === String(existingId)) { existing = row; return true; }
        return false;
      });
      if (!existing) throw new Error('ไม่พบรายการที่ต้องการแก้ไข');
    }
    if (typeof validator === 'function') validator(rows, existing);

    const now = new Date();
    if (existing) {
      const range = sh.getRange(existing._row, 1, 1, headers.length);
      const current = range.getValues()[0];
      headers.forEach(function (header, index) {
        if (Object.prototype.hasOwnProperty.call(payload, header)) current[index] = sheetSafeValue_(payload[header]);
        if (header === 'LastUpdatedBy') current[index] = actorEmail || '';
        if (header === 'LastUpdatedAt') current[index] = now;
      });
      range.setValues([current]);
      return existing._row;
    }

    const merged = Object.assign({}, payload);
    if (headers.indexOf('Timestamp') > -1 && !merged.Timestamp) merged.Timestamp = now;
    if (headers.indexOf('CreatedBy') > -1 && !merged.CreatedBy) merged.CreatedBy = actorEmail || '';
    if (headers.indexOf('LastUpdatedBy') > -1) merged.LastUpdatedBy = actorEmail || '';
    if (headers.indexOf('LastUpdatedAt') > -1) merged.LastUpdatedAt = now;
    sh.appendRow(headers.map(function (header) {
      return sheetSafeValue_(Object.prototype.hasOwnProperty.call(merged, header) ? merged[header] : '');
    }));
    return sh.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

function cmdbObjectsFromValues_(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const item = { _row: r + 1 };
    for (let c = 0; c < headers.length; c++) item[headers[c]] = values[r][c];
    if (!_isDeletedRow_(item)) rows.push(item);
  }
  return rows;
}

function cmdbOptionalNumber_(value, label, min, max) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!isFinite(n) || n < min || n > max) {
    throw new Error(label + ' ต้องเป็นตัวเลขระหว่าง ' + min + ' ถึง ' + max);
  }
  return n;
}

/** Parse an optional HTML date without allowing JavaScript Date normalization. */
function cmdbParseOptionalDate_(value, label) {
  if (value === '' || value === null || value === undefined) return '';
  label = sanitizeText(label, 60) || 'วันที่';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error(label + ' ไม่ใช่วันที่ที่ถูกต้อง');
    return new Date(value.getTime());
  }

  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(label + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    throw new Error(label + ' ไม่ใช่วันที่ที่มีอยู่จริง');
  }
  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(year, month - 1, day);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day) {
    throw new Error(label + ' ไม่ใช่วันที่ที่มีอยู่จริง');
  }

  const result = new Date(0);
  result.setHours(0, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  return result;
}

function cmdbIsValidIpList_(value) {
  const parts = String(value || '').split(/[,;\s]+/).filter(String);
  if (!parts.length) return true;
  return parts.every(function (part) {
    const cidrParts = part.split('/');
    if (cidrParts.length > 2) return false;
    const address = cidrParts[0];
    const cidr = cidrParts.length === 2 ? Number(cidrParts[1]) : null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
      if (!address.split('.').every(function (n) { return Number(n) >= 0 && Number(n) <= 255; })) return false;
      return cidr === null || (Number.isInteger(cidr) && cidr >= 0 && cidr <= 32);
    }
    if (/^[0-9a-f:]+$/i.test(address) && address.indexOf(':') > -1) {
      return cidr === null || (Number.isInteger(cidr) && cidr >= 0 && cidr <= 128);
    }
    return false;
  });
}

// ============================================================================
// Node catalog and DTO helpers
// ============================================================================

function cmdbBuildNodeCatalog_() {
  const nodes = [];
  const byKey = {};
  const add = function (node) {
    if (!node || !node.type || !node.id) return;
    node.type = sanitizeText(node.type, 40);
    node.id = sanitizeText(node.id, 150);
    node.name = sanitizeText(node.name || node.id, 250);
    node.status = sanitizeText(node.status, 80);
    node.subtitle = sanitizeText(node.subtitle, 300);
    const key = cmdbNodeKey_(node.type, node.id);
    if (byKey[key]) return;
    byKey[key] = node;
    nodes.push(node);
  };

  cmdbReadSafe_(SHEETS.CONFIG_ITEM).forEach(function (r) {
    add({ type: 'CI', id: r.CIID, name: r.CIName, status: r.Status,
      subtitle: [r.CIType, r.Environment].filter(String).join(' · '),
      ciType: r.CIType, moduleKey: 'cmdb' });
  });
  cmdbReadSafe_(SHEETS.ASSET).forEach(function (r) {
    add({ type: 'Asset', id: r.AssetID, name: r.AssetName, status: r.Status,
      subtitle: [r.AssetCode, r.AssetType || r.Category].filter(String).join(' · '), moduleKey: 'asset' });
  });
  cmdbReadSafe_(SHEETS.VENDOR).forEach(function (r) {
    add({ type: 'Vendor', id: r.VendorID, name: r.VendorName, status: r.Status,
      subtitle: r.ServiceType, moduleKey: 'vendor' });
    if (r.ContractNo) {
      add({ type: 'Contract', id: r.ContractNo,
        name: r.ContractNo + ' · ' + (r.VendorName || r.VendorID), status: r.Status,
        subtitle: r.ContractExpiry ? 'หมดอายุ ' + fmtDate(r.ContractExpiry) : '',
        vendorId: String(r.VendorID || ''), moduleKey: 'vendor' });
    }
  });
  cmdbReadSafe_(SHEETS.CLOUD).forEach(function (r) {
    add({ type: 'Cloud', id: r.CloudID, name: r.ServiceName, status: r.Status,
      subtitle: r.Provider, moduleKey: 'cloud' });
  });
  cmdbReadSafe_(SHEETS.BACKUP).forEach(function (r) {
    add({ type: 'Backup', id: r.BackupID, name: r.SystemName || r.BackupID, status: r.Result,
      subtitle: [r.BackupType, r.BackupDate ? fmtDate(r.BackupDate) : ''].filter(String).join(' · '),
      moduleKey: 'backup' });
  });
  cmdbReadSafe_(SHEETS.INCIDENT).forEach(function (r) {
    add({ type: 'Incident', id: r.IncidentID, name: r.Title || r.IncidentID, status: r.Status,
      subtitle: r.Severity, moduleKey: 'incident' });
  });
  cmdbReadSafe_(SHEETS.CHANGE).forEach(function (r) {
    add({ type: 'Change', id: r.ChangeID, name: r.Title || r.ChangeID, status: r.Status,
      subtitle: r.RiskLevel, moduleKey: 'change' });
  });
  return { nodes: nodes, byKey: byKey };
}

function cmdbReadSafe_(sheetName) {
  try { return readSheetObjects_(sheetName); } catch (e) { return []; }
}

function cmdbAssertEndpointExists_(type, id, catalog, label) {
  type = sanitizeText(type, 40);
  id = sanitizeText(id, 150);
  const node = catalog.byKey[cmdbNodeKey_(type, id)];
  if (!node) throw new Error('ไม่พบ ' + (label || 'node') + ': ' + type + ' / ' + id);
  return node;
}

/** Active graph edges cannot point to lifecycle-disabled endpoints. */
function cmdbAssertActiveRelationshipEndpoints_(source, target) {
  cmdbAssertActiveRelationshipEndpoint_(source, 'ต้นทาง');
  cmdbAssertActiveRelationshipEndpoint_(target, 'ปลายทาง');
}

function cmdbAssertActiveRelationshipEndpoint_(node, label) {
  if (!node) throw new Error('ไม่พบ ' + (label || 'node'));
  const rawStatus = String(node.status || '').trim();
  const status = rawStatus.toLowerCase();
  const disabledStatuses = [
    'retired', 'inactive', 'decommissioned', 'disposed', 'disabled',
    'ยกเลิกใช้งาน', 'จำหน่าย/เลิกใช้', 'สูญหาย', 'ระงับ'
  ];
  const assetRetired = node.type === 'Asset' && typeof isAssetRetired_ === 'function' &&
    isAssetRetired_(rawStatus);
  if (assetRetired || disabledStatuses.indexOf(status) > -1) {
    throw new Error('สร้างความสัมพันธ์ Active ไม่ได้ เนื่องจาก ' + (label || 'node') +
      ' ' + node.type + ' / ' + node.id + ' มีสถานะ ' + (rawStatus || 'ไม่พร้อมใช้งาน'));
  }
}

function cmdbNodeKey_(type, id) {
  return String(type || '') + '::' + String(id || '');
}

function cmdbCiDto_(r) {
  return {
    id: String(r.CIID || ''), name: r.CIName, type: r.CIType, environment: r.Environment,
    businessService: r.BusinessService, owner: r.Owner, administrator: r.Administrator,
    criticality: r.Criticality, ipAddress: r.IPAddress, url: r.URL, version: r.Version,
    vendorId: r.VendorID, contractRef: r.ContractRef, assetId: r.AssetID, cloudId: r.CloudID,
    dataClassification: r.DataClassification,
    rpoHours: r.RPOHours === '' ? '' : Number(r.RPOHours),
    rtoHours: r.RTOHours === '' ? '' : Number(r.RTOHours),
    backupRequired: r.BackupRequired, backupReference: r.BackupReference,
    location: r.Location, status: r.Status, lastVerifiedAt: safeFmtDateTime_(r.LastVerifiedAt),
    lastVerifiedBy: r.LastVerifiedBy, notes: r.Notes,
    updatedAt: safeFmtDateTime_(r.LastUpdatedAt)
  };
}

function cmdbRelationshipDto_(r, catalog) {
  const source = catalog.byKey[cmdbNodeKey_(r.SourceType, r.SourceID)];
  const target = catalog.byKey[cmdbNodeKey_(r.TargetType, r.TargetID)];
  const validFromDays = daysUntil(r.ValidFrom);
  const validUntilDays = daysUntil(r.ValidUntil);
  return {
    id: String(r.RelationshipID || ''),
    sourceType: r.SourceType, sourceId: String(r.SourceID || ''),
    sourceName: source ? source.name : (r.SourceName || r.SourceID),
    targetType: r.TargetType, targetId: String(r.TargetID || ''),
    targetName: target ? target.name : (r.TargetName || r.TargetID),
    relationshipType: r.RelationshipType, direction: r.Direction,
    impactLevel: r.ImpactLevel, description: r.Description, status: r.Status,
    validFrom: safeFmtDate_(r.ValidFrom), validUntil: safeFmtDate_(r.ValidUntil),
    notStarted: validFromDays !== null && validFromDays > 0,
    expired: validUntilDays !== null && validUntilDays < 0,
    lastVerifiedAt: safeFmtDateTime_(r.LastVerifiedAt), lastVerifiedBy: r.LastVerifiedBy,
    notes: r.Notes, sourceMissing: !source, targetMissing: !target,
    updatedAt: safeFmtDateTime_(r.LastUpdatedAt)
  };
}
