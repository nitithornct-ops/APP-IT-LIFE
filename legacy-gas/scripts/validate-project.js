'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root, { withFileTypes: true });
const gsFiles = files.filter((f) => f.isFile() && f.name.endsWith('.gs')).map((f) => f.name).sort();
const htmlFiles = files.filter((f) => f.isFile() && f.name.endsWith('.html')).map((f) => f.name).sort();
const errors = [];
const warnings = [];

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '');
}

function parseJavaScript(source, label) {
  try {
    new vm.Script(source, { filename: label });
  } catch (err) {
    errors.push(`${label}: ${err.message}`);
  }
}

/**
 * Return one top-level Apps Script function without attempting to fully parse
 * Apps Script. Project functions start at column zero, so the next top-level
 * function is a stable boundary and keeps security assertions scoped to the
 * code path they are intended to protect.
 */
function functionSource(source, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^[ \\t]*function\\s+${escaped}\\s*\\(`, 'm');
  const match = startRe.exec(source);
  if (!match) return '';
  const tail = source.slice(match.index);
  const next = tail.slice(match[0].length).search(/^[ \t]*function\s+[A-Za-z_$][\w$]*\s*\(/m);
  return next < 0 ? tail : tail.slice(0, match[0].length + next);
}

function hasAll(source, markers) {
  return markers.every((marker) => source.includes(marker));
}

// ตรวจ syntax ของ Apps Script แยกไฟล์และรวมไฟล์ เพื่อจับ lexical declaration ชนกันข้ามไฟล์
gsFiles.forEach((name) => parseJavaScript(read(name), name));
parseJavaScript(gsFiles.map((name) => `\n// FILE: ${name}\n${read(name)}`).join('\n'), 'AppsScript.bundle.gs');

// ตรวจ inline JavaScript ใน HTML โดยลบ template scriptlet ก่อน parse
htmlFiles.forEach((name) => {
  const html = read(name);
  const scriptRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = scriptRe.exec(html))) {
    index += 1;
    const js = match[1].replace(/<\?[\s\S]*?\?>/g, '');
    if (js.trim()) parseJavaScript(js, `${name}#script-${index}`);
  }
});

// Apps Script ยอมให้ function ชื่อซ้ำแล้วตัวหลังทับตัวแรก จึงต้องตรวจเอง
const topLevel = new Map();
gsFiles.forEach((name) => {
  const lines = read(name).split(/\r?\n/);
  lines.forEach((line, idx) => {
    const fn = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
    const lexical = line.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\b/);
    const found = fn || lexical;
    if (!found) return;
    const key = found[1];
    const here = `${name}:${idx + 1}`;
    if (topLevel.has(key)) errors.push(`ชื่อ top-level ซ้ำ "${key}": ${topLevel.get(key)} และ ${here}`);
    else topLevel.set(key, here);
  });
});

// ตรวจ version drift ระหว่าง release metadata กับข้อความเวอร์ชันใน Apps Script
try {
  const packageVersion = JSON.parse(read('package.json')).version || '';
  const packageMinor = (packageVersion.match(/^(\d+\.\d+)/) || [null, ''])[1];
  const codeMinor = (read('Code.gs').match(/ISMS Governance System v(\d+\.\d+)/) || [null, ''])[1];
  if (!packageMinor || !codeMinor || packageMinor !== codeMinor) {
    errors.push(`เวอร์ชันไม่ตรงกัน: package.json=${packageVersion || '-'} Code.gs=${codeMinor || '-'}`);
  }
} catch (err) {
  errors.push(`ตรวจ release version ไม่สำเร็จ: ${err.message}`);
}

const serverFunctions = new Set();
gsFiles.forEach((name) => {
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const source = read(name);
  let match;
  while ((match = re.exec(source))) serverFunctions.add(match[1]);
});

[
  'processNotificationQueue_',
  'scheduledSystemBackup_',
  'monthlyRestoreDrill_',
  'dailyRetentionMaintenance_',
  'scheduledLiveHealthCheck_',
  'scheduledWorkflowAutomation_'
].forEach((fn) => {
  if (!serverFunctions.has(fn)) errors.push(`ไม่พบ production handler "${fn}"`);
});

const auth = read('Auth.gs');
const allowBlock = (auth.match(/const\s+API_ALLOWED\s*=\s*\{([\s\S]*?)\n\};/) || [null, ''])[1];
const allowed = new Set();
let allowMatch;
const allowRe = /\b([A-Za-z_$][\w$]*)\s*:\s*1\b/g;
while ((allowMatch = allowRe.exec(allowBlock))) allowed.add(allowMatch[1]);

// Response helper ต้องคง compatibility เดิมและมีสัญญามาตรฐานครบถ้วน
const utilsSource = read('Utils.gs');
['success', 'message', 'data', 'errorCode', 'timestamp', 'ok', 'error'].forEach((field) => {
  const helperBlock = (utilsSource.match(/function\s+ok\s*\([\s\S]*?\n\}/) || [''])[0] +
    (utilsSource.match(/function\s+fail\s*\([\s\S]*?\n\}/) || [''])[0];
  if (!new RegExp('\\b' + field + '\\s*:').test(helperBlock)) {
    errors.push(`Response contract ไม่มี field "${field}" ใน ok()/fail()`);
  }
});

const sharedClientSource = read('JavaScript.html');
['success', 'ok', 'message', 'error'].forEach((field) => {
  if (!sharedClientSource.includes(`'${field}'`) && !new RegExp(`\\.${field}\\b`).test(sharedClientSource)) {
    errors.push(`Client response adapter ไม่รองรับ field "${field}"`);
  }
});

// Privacy/PDPA v1.8 ต้องมาครบทั้ง schema, API, permission, backend และ renderer
try {
  const configSource = read('Config.gs');
  const authSource = read('Auth.gs');
  const indexSource = read('Index.html');
  const privacyServer = read('Module_Privacy.gs');
  const privacyClient = read('Privacy.html');
  ['PrivacyROPA', 'PrivacyConsents', 'PrivacyDSR'].forEach((sheet) => {
    if (!configSource.includes(`${sheet}: [`)) errors.push(`Privacy schema ไม่พบ ${sheet}`);
  });
  if (!/privacy\s*:\s*\{[\s\S]*roles:\s*\['ITAdmin','DPO'\]/.test(configSource)) {
    errors.push('Privacy permission matrix ไม่อนุญาต ITAdmin/DPO ตามที่กำหนด');
  }
  ['getPrivacyModuleData', 'saveRopaRecord', 'recordPrivacyConsent', 'submitDataSubjectRequest', 'updateDataSubjectRequest'].forEach((fn) => {
    if (!new RegExp(`\\b${fn}\\s*:\\s*1\\b`).test(authSource)) errors.push(`Privacy API allowlist ไม่พบ ${fn}`);
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(privacyServer)) errors.push(`Privacy backend ไม่พบ ${fn}`);
  });
  if (!indexSource.includes("includeOptional_('Privacy')") || !indexSource.includes("privacy: 'renderPrivacy'")) {
    errors.push('Privacy renderer/include wiring ไม่ครบ');
  }
  if (!/function\s+renderPrivacy\s*\(/.test(privacyClient)) errors.push('Privacy.html ไม่พบ renderPrivacy()');
  if (!privacyServer.includes("requireModule('privacy', true)")) errors.push('Privacy write functions ไม่มี server-side edit guard');
} catch (err) {
  errors.push(`ตรวจ Privacy/PDPA module ไม่สำเร็จ: ${err.message}`);
}

// Assurance Operations v1.9 ต้องมี schema/API/renderer และ server-side guards ครบ
try {
  const cfg = read('Config.gs');
  const authz = read('Auth.gs');
  const index = read('Index.html');
  const server = read('Module_Assurance.gs');
  const client = read('Assurance.html');
  ['Problems', 'KnownErrors', 'VulnerabilityFindings', 'AuditEngagements', 'AuditFindings'].forEach((sheet) => {
    if (!cfg.includes(`${sheet}: [`)) errors.push(`Assurance schema ไม่พบ ${sheet}`);
  });
  const assuranceApis = ['getProblemModuleData','saveProblemRecord','saveKnownErrorRecord',
    'getVulnerabilityModuleData','saveVulnerabilityFinding','updateVulnerabilityStatus',
    'getAuditModuleData','saveAuditEngagement','saveAuditFinding','updateAuditFindingStatus'];
  assuranceApis.forEach((fn) => {
    if (!new RegExp(`\\b${fn}\\s*:\\s*1\\b`).test(authz)) errors.push(`Assurance API allowlist ไม่พบ ${fn}`);
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(server)) errors.push(`Assurance backend ไม่พบ ${fn}`);
  });
  ['renderProblem','renderVulnerability','renderAudit'].forEach((fn) => {
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(client)) errors.push(`Assurance UI ไม่พบ ${fn}`);
  });
  if (!index.includes("includeOptional_('Assurance')")) errors.push('Assurance partial ไม่ถูก include');
  ['problem','vulnerability','audit'].forEach((moduleKey) => {
    if (!server.includes(`requireModule('${moduleKey}',true)`)) errors.push(`${moduleKey} write ไม่มี server edit guard`);
  });
  if (!server.includes('ห้ามเป็นผู้ตรวจยืนยัน')) errors.push('Assurance workflow ไม่มี independent verification guard');
} catch (err) {
  errors.push(`ตรวจ Assurance Operations ไม่สำเร็จ: ${err.message}`);
}

// CMDB + Service Catalog v1.10: schema, wiring, RBAC, integrity and release-marker regression guards
try {
  const cfg = read('Config.gs');
  const authz = read('Auth.gs');
  const code = read('Code.gs');
  const index = read('Index.html');
  const setup = read('Setup.gs');
  const cmdbServer = read('Module_CMDB.gs');
  const cmdbClient = read('CMDB.html');
  const svcServer = read('Module_ServiceCatalog.gs');
  const svcClient = read('ServiceCatalog.html');
  const fieldDesigner = read('Module_FieldDesigner.gs');
  const catalogSource = read('Module_ITAssetExtras.gs');
  const pdfServer = read('Module_PDFDesigner.gs');
  const retentionServer = read('Module_OperationsHardening.gs');
  const driveServer = read('Drive.gs');
  const liveCheck = read('scripts/live-browser-check.mjs');

  const p2Sheets = ['ConfigurationItems', 'CIRelationships', 'ServiceCatalog',
    'ServiceRequests', 'ServiceRequestTasks', 'ServiceRequestHistory'];
  p2Sheets.forEach((sheet) => {
    if (!cfg.includes(`${sheet}: [`)) errors.push(`P2 schema ไม่พบ ${sheet}`);
  });
  ['CONFIG_ITEM', 'CI_RELATIONSHIP', 'SERVICE_CATALOG', 'SERVICE_REQUEST',
    'SERVICE_REQUEST_TASK', 'SERVICE_REQUEST_HISTORY'].forEach((key) => {
    if (!new RegExp(`\\b${key}\\s*:`).test(cfg)) errors.push(`P2 SHEETS ไม่พบ ${key}`);
    if (!code.includes(`SHEETS.${key}`)) errors.push(`getAppBuildInfo.requiredSheets ไม่พบ SHEETS.${key}`);
  });
  if (!/serviceCatalog\s*:\s*\{/.test(cfg) || !/cmdb\s*:\s*\{/.test(cfg)) {
    errors.push('P2 permission matrix ไม่ครบ serviceCatalog/cmdb');
  }
  const p2SchemaVersion = Number((code.match(/function\s+getCurrentSchemaVersion_\s*\(\)\s*\{\s*return\s+(\d+)\s*;/) || [null, 0])[1]);
  if (p2SchemaVersion < 12) errors.push('P2 schema version ต้องไม่น้อยกว่า 12');

  const cmdbApis = ['getCmdbModuleData', 'saveConfigurationItem', 'updateConfigurationItemStatus',
    'verifyConfigurationItem', 'saveCIRelationship', 'updateCIRelationshipStatus',
    'verifyCIRelationship'];
  const svcApis = ['getServiceCatalogModuleData', 'saveServiceCatalogItem', 'setServiceCatalogStatus',
    'submitServiceRequest', 'approveServiceRequest', 'assignServiceRequest',
    'updateServiceRequestStatus', 'updateServiceRequestTask', 'confirmServiceRequest',
    'cancelServiceRequest'];
  cmdbApis.forEach((fn) => {
    if (!new RegExp(`\\b${fn}\\s*:\\s*1\\b`).test(authz)) errors.push(`CMDB API allowlist ไม่พบ ${fn}`);
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(cmdbServer)) errors.push(`CMDB backend ไม่พบ ${fn}`);
  });
  svcApis.forEach((fn) => {
    if (!new RegExp(`\\b${fn}\\s*:\\s*1\\b`).test(authz)) errors.push(`Service Catalog API allowlist ไม่พบ ${fn}`);
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(svcServer)) errors.push(`Service Catalog backend ไม่พบ ${fn}`);
  });
  if (!index.includes("includeOptional_('CMDB')") || !index.includes("cmdb: 'renderCmdb'") ||
      !/function\s+renderCmdb\s*\(/.test(cmdbClient)) {
    errors.push('CMDB include/renderer wiring ไม่ครบ');
  }
  if (!index.includes("includeOptional_('ServiceCatalog')") ||
      !index.includes("serviceCatalog: 'renderServiceCatalog'") ||
      !/function\s+renderServiceCatalog\s*\(/.test(svcClient)) {
    errors.push('Service Catalog include/renderer wiring ไม่ครบ');
  }

  ['cmdbValidateCiReferences_', 'cmdbAssertEndpointExists_', 'cmdbValidateRelationshipUniqueness_',
    'cmdbAssertNoDependencyCycle_', 'cmdbAssertNoActiveCiRelationships_', 'LockService.getScriptLock'].forEach((marker) => {
    if (!cmdbServer.includes(marker)) errors.push(`CMDB integrity guard ไม่พบ ${marker}`);
  });
  if (!cmdbServer.includes("requireModule('cmdb', true)")) errors.push('CMDB write ไม่มี server edit guard');
  if (!cmdbServer.includes('payload.SourceType === payload.TargetType') ||
      !cmdbServer.includes('payload.SourceID === payload.TargetID')) {
    errors.push('CMDB self-relationship guard ไม่ครบ');
  }
  if (!cmdbServer.includes("if (!ciId) throw new Error") ||
      !cmdbServer.includes('cmdbAssertActiveRelationshipEndpoints_') ||
      !cmdbServer.includes('cmdbParseOptionalDate_')) {
    errors.push('CMDB lifecycle/endpoint/strict-date hardening ไม่ครบ');
  }

  ['RequesterEmail: user.email', 'IdempotencyKey: key', 'svcAssertRequestTransition_',
    'svcAssertRequiredTasksComplete_', 'svcAssertSafeJsonObject_', 'SVC_APPROVER_ROLES',
    'LockService.getScriptLock'].forEach((marker) => {
    if (!svcServer.includes(marker)) errors.push(`Service Request security/workflow guard ไม่พบ ${marker}`);
  });
  ['__proto__', 'prototype', 'constructor'].forEach((key) => {
    if (!svcServer.includes(`key === '${key}'`)) errors.push(`Service JSON guard ไม่ปฏิเสธ ${key}`);
  });
  const taskSection = (svcServer.match(/function\s+updateServiceRequestTask\s*\([\s\S]*?\n}\n\nfunction\s+confirmServiceRequest/) || [''])[0];
  const confirmSection = (svcServer.match(/function\s+confirmServiceRequest\s*\([\s\S]*?\n}\n\nfunction\s+cancelServiceRequest/) || [''])[0];
  if (!taskSection.includes('SVC_REQUEST_STATUS.PENDING_CONFIRMATION') ||
      !confirmSection.includes('svcAssertRequiredTasksComplete_')) {
    errors.push('Service Request ป้องกัน checklist/confirmation race ไม่ครบ');
  }
  ['svcTrustedServiceCatalogAttachment_', 'UPLOAD_EVIDENCE', 'DriveApp.getFileById',
    'svcDiscardUnclaimedServiceCatalogAttachment_', 'svcRepairRequestChildrenLocked_',
    'svcNormalizeWorkflowDefinition_', 'svcAssertWorkflowStatusAllowed_'].forEach((marker) => {
    if (!svcServer.includes(marker)) errors.push(`Service Request hardening ไม่พบ ${marker}`);
  });
  if (!driveServer.includes("moduleKey === 'serviceCatalog'") ||
      !driveServer.includes('ไม่สามารถยืนยันหลักฐานการอัปโหลด')) {
    errors.push('Drive upload ไม่มี durable Service Catalog attachment claim');
  }
  if (!setup.includes('function seedServiceCatalog_') || !setup.includes("CatalogID:'SVC-CAT-012'")) {
    errors.push('Service Catalog seed 12 รายการไม่ครบ');
  }
  if (!setup.includes("name:'ทดสอบผลและแนบหลักฐาน'") || !setup.includes('evidenceRequired:true')) {
    errors.push('Service Catalog seed ไม่บังคับหลักฐานใน checklist ทดสอบผล');
  }
  if (!fieldDesigner.includes("serviceCatalog: ['ServiceCatalog'") ||
      !fieldDesigner.includes("cmdb: ['ConfigurationItems'")) {
    errors.push('MODULE_TABLE_MAP_ ไม่ครบ CMDB/Service Catalog');
  }
  if (!catalogSource.includes("{ key: 'serviceCatalog'") || !catalogSource.includes("{ key: 'cmdb'") ||
      !catalogSource.includes("entry.key === 'serviceCatalog'") ||
      !catalogSource.includes('RequesterEmail')) {
    errors.push('Reports/catalog registry หรือ Service Request row-level filter ไม่ครบ');
  }
  if (!catalogSource.includes("'SERVICE_REQUEST_PII_RETENTION_DAYS'") ||
      !catalogSource.includes('SERVICE_REQUEST_PII_RETENTION_DAYS: [30, 36500]')) {
    errors.push('Settings ไม่เปิดให้กำหนด Service Request PII retention');
  }
  if (!pdfServer.includes("moduleKey === 'serviceCatalog'") ||
      !pdfServer.includes('svcCanViewRequest_') || !pdfServer.includes('IdempotencyKey:')) {
    errors.push('Universal PDF sample ไม่มี Service Request row/field scope');
  }
  const retentionChild = retentionServer.indexOf('requestTasks.forEach');
  const retentionParent = retentionServer.indexOf('rows.forEach(function (r)', retentionChild);
  if (retentionChild < 0 || retentionParent < 0 || retentionChild > retentionParent) {
    errors.push('Service Request retention ต้อง anonymize child ก่อน parent sentinel');
  }

  const serverBuild = (code.match(/function\s+getAppBuildId_\s*\(\)[\s\S]*?return\s+['"]([^'"]+)['"]/) || [null, ''])[1];
  const clientBuild = (index.match(/CLIENT_BUILD_ID\s*=\s*['"]([^'"]+)['"]/) || [null, ''])[1];
  const browserBuild = (liveCheck.match(/hasBuildMarker[\s\S]*?includes\(['"]([^'"]+)['"]\)/) || [null, ''])[1];
  if (!serverBuild || serverBuild !== clientBuild || serverBuild !== browserBuild) {
    errors.push(`P2 build marker drift: server=${serverBuild || '-'} client=${clientBuild || '-'} browser=${browserBuild || '-'}`);
  }

  // Pure helper smoke tests do not touch Google services.
  const svcSandbox = {
    ROLES: { USER: 'User', APPROVER: 'Approver', IT_ADMIN: 'ITAdmin', EXECUTIVE: 'Executive', DPO: 'DPO' },
    sanitizeText: (value, max) => String(value === null || value === undefined ? '' : value).slice(0, max || 10000),
    console
  };
  vm.createContext(svcSandbox);
  vm.runInContext(svcServer, svcSandbox, { filename: 'Module_ServiceCatalog.semantic.gs' });
  let rejectedUnsafeJson = false;
  try { svcSandbox.svcNormalizeJsonValue_('{"constructor":{}}', 'WorkflowJSON', {}); }
  catch (err) { rejectedUnsafeJson = true; }
  if (!rejectedUnsafeJson) errors.push('Service Catalog semantic test: unsafe JSON key ผ่าน validation');
  let rejectedTransition = false;
  try { svcSandbox.svcAssertRequestTransition_('รออนุมัติ', 'ปิดงาน'); }
  catch (err) { rejectedTransition = true; }
  if (!rejectedTransition) errors.push('Service Catalog semantic test: invalid transition ผ่าน validation');
  try { svcSandbox.svcAssertRequestTransition_('กำลังดำเนินการ', 'รอยืนยันผล'); }
  catch (err) { errors.push(`Service Catalog semantic test: valid transition ถูกปฏิเสธ (${err.message})`); }
  if (svcSandbox.svcIsEligible_({ Eligibility: '{"department":"Finance"}' },
      { email: 'user@example.com', role: 'User', dept: 'Finance' })) {
    errors.push('Service Catalog semantic test: malformed eligibility JSON เปิดสิทธิ์แบบ fail-open');
  }
  if (svcSandbox.svcIsStrictDateInput_('2026-02-30', false) ||
      !svcSandbox.svcIsStrictDateInput_('2028-02-29', false)) {
    errors.push('Service Catalog semantic test: strict calendar-date validation ไม่ถูกต้อง');
  }
  let workflowNarrowingRejected = false;
  try {
    svcSandbox.svcAssertRequestTransition_('กำลังดำเนินการ', 'รอผู้ใช้งาน', {
      WorkflowJSON: JSON.stringify({ definition: {
        transitions: [['กำลังดำเนินการ', 'รอผู้ให้บริการ']]
      } })
    });
  } catch (err) { workflowNarrowingRejected = true; }
  if (!workflowNarrowingRejected) {
    errors.push('Service Catalog semantic test: Catalog workflow ไม่จำกัด transition ตาม snapshot');
  }
  if (svcSandbox.svcServiceCatalogDriveFileId_('https://example.com/file.pdf') ||
      svcSandbox.svcServiceCatalogDriveFileId_('https://drive.google.com/file/d/abcdefghij/view') !== 'abcdefghij') {
    errors.push('Service Catalog semantic test: trusted Drive URL parser ไม่ถูกต้อง');
  }

  const cmdbSandbox = {
    sanitizeText: (value, max) => String(value === null || value === undefined ? '' : value).slice(0, max || 10000),
    console
  };
  vm.createContext(cmdbSandbox);
  vm.runInContext(cmdbServer, cmdbSandbox, { filename: 'Module_CMDB.semantic.gs' });
  let rejectedCycle = false;
  try {
    cmdbSandbox.cmdbAssertNoDependencyCycle_([
      { RelationshipID: 'R-1', Status: 'Active', RelationshipType: 'DEPENDS_ON',
        SourceType: 'CI', SourceID: 'B', TargetType: 'CI', TargetID: 'A' }
    ], { Status: 'Active', RelationshipType: 'DEPENDS_ON',
      SourceType: 'CI', SourceID: 'A', TargetType: 'CI', TargetID: 'B' }, '');
  } catch (err) { rejectedCycle = true; }
  if (!rejectedCycle) errors.push('CMDB semantic test: dependency cycle ผ่าน validation');
  let rejectedInvalidCmdbDate = false;
  try { cmdbSandbox.cmdbParseOptionalDate_('2026-02-30', 'ValidFrom'); }
  catch (err) { rejectedInvalidCmdbDate = true; }
  if (!rejectedInvalidCmdbDate) errors.push('CMDB semantic test: invalid calendar date ผ่าน validation');
  let rejectedRetiredEndpoint = false;
  try { cmdbSandbox.cmdbAssertActiveRelationshipEndpoint_(
    { type: 'CI', id: 'CI-1', status: 'Retired' }, 'ปลายทาง'); }
  catch (err) { rejectedRetiredEndpoint = true; }
  if (!rejectedRetiredEndpoint) errors.push('CMDB semantic test: Active edge ไป Retired endpoint ผ่าน validation');
} catch (err) {
  errors.push(`ตรวจ CMDB/Service Catalog v1.10 ไม่สำเร็จ: ${err.message}`);
}

// Workflow / Attachment Registry / Integration v1.11 release guards
try {
  const cfg = read('Config.gs');
  const authz = read('Auth.gs');
  const code = read('Code.gs');
  const index = read('Index.html');
  const setup = read('Setup.gs');
  const workflow = read('Module_Workflow.gs');
  const actionPermission = read('Module_ActionPermission.gs');
  const attachment = read('Module_AttachmentRegistry.gs');
  const integration = read('Module_Integration.gs');
  const serviceCatalog = read('Module_ServiceCatalog.gs');
  const retention = read('Module_OperationsHardening.gs');
  const settings = read('Module_ITAssetExtras.gs');
  const client = read('Workflow.html');
  const drive = read('Drive.gs');
  const sharedClient = read('JavaScript.html');
  const serviceClient = read('ServiceCatalog.html');
  const ticketServer = read('Module_Ticket.gs');
  const ticketClient = read('Ticket.html');
  const taskServer = read('Module_Task.gs');
  const taskClient = read('Task.html');
  const incidentServer = read('Module_Incident.gs');
  const operationalTriggerBlock = functionSource(retention, 'operationalTriggerNames_');
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  if (!utilsSource.includes("'LIVE_HEALTH_LAST_ALERT_DATE'") ||
      !operationalTriggerBlock.includes("'scheduledWorkflowAutomation_'")) {
    errors.push('Runtime property/trigger inventory ไม่ครอบคลุม live-health dedup และ Workflow automation');
  }

  const p3Sheets = ['WorkflowDefinitions','WorkflowSteps','WorkflowInstances','WorkflowApprovals',
    'WorkflowHistory','WorkflowDelegations','AttachmentRegistry','AttachmentLinks',
    'AttachmentAccessLog','RecordLinks','IntegrationOutbox','ActionPermissions',
    'RoleActionPermissions','UserPermissionOverrides','ApprovalGroups','ApprovalGroupMembers'];
  p3Sheets.forEach((sheet) => {
    if (!cfg.includes(`${sheet}: [`)) errors.push(`P3 schema ไม่พบ ${sheet}`);
  });
  ['WORKFLOW_DEFINITION','WORKFLOW_STEP','WORKFLOW_INSTANCE','WORKFLOW_APPROVAL',
    'WORKFLOW_HISTORY','WORKFLOW_DELEGATION','ATTACHMENT_REGISTRY','ATTACHMENT_LINK',
    'ATTACHMENT_ACCESS_LOG','RECORD_LINK','INTEGRATION_OUTBOX','ACTION_PERMISSION',
    'ROLE_ACTION_PERMISSION','USER_PERMISSION_OVERRIDE','APPROVAL_GROUP','APPROVAL_GROUP_MEMBER']
    .forEach((key) => {
      if (!new RegExp(`\\b${key}\\s*:`).test(cfg)) errors.push(`P3 SHEETS ไม่พบ ${key}`);
      if (!code.includes(`SHEETS.${key}`)) errors.push(`getAppBuildInfo.requiredSheets ไม่พบ SHEETS.${key}`);
    });
  if (!/function\s+getCurrentSchemaVersion_\s*\(\)\s*\{\s*return\s+13\s*;/.test(code)) {
    errors.push('P3 schema version ต้องเป็น 13');
  }
  if (packageJson.version !== '1.11.0' || packageLock.version !== '1.11.0' ||
      !packageLock.packages || !packageLock.packages[''] || packageLock.packages[''].version !== '1.11.0') {
    errors.push('package/package-lock version ของ P3 ต้องเป็น 1.11.0');
  }

  // Authentication: sessions and MFA challenges are bound to the current
  // password fingerprint, and attacker-controlled hash work factors are
  // clamped before the digest loop runs.
  const passwordMin = Number((authz.match(/PASSWORD_HASH_ITERATIONS_MIN_\s*=\s*(\d+)/) || [null, 0])[1]);
  const passwordMax = Number((authz.match(/PASSWORD_HASH_ITERATIONS_MAX_\s*=\s*(\d+)/) || [null, 0])[1]);
  if (passwordMin < 10000 || passwordMax < passwordMin || passwordMax > 100000) {
    errors.push(`Auth password hash iteration bounds ไม่ปลอดภัย: min=${passwordMin || '-'} max=${passwordMax || '-'}`);
  }
  const adminLoginBlock = functionSource(authz, 'adminLogin');
  const adminMfaBlock = functionSource(authz, 'adminVerifyMfa');
  const createSessionBlock = functionSource(authz, 'createAdminSession_');
  const validateSessionBlock = functionSource(authz, 'validateSession_');
  const verifyPasswordBlock = functionSource(authz, 'verifyPassword_');
  const iterationBlock = functionSource(authz, 'getPasswordHashIterations_');
  if (!hasAll(createSessionBlock, ['credentialVersion:', 'authCredentialVersion_(u)']) ||
      !hasAll(validateSessionBlock, ['session.credentialVersion', 'authCredentialVersion_(u)',
        "cache.remove('sess_' + token)"])) {
    errors.push('Auth session ไม่ผูก credentialVersion หรือไม่ revoke token เมื่อรหัสผ่านเปลี่ยน');
  }
  if (!hasAll(adminLoginBlock, ['credentialVersion:', 'authCredentialVersion_(u)']) ||
      !hasAll(adminMfaBlock, ['pending.credentialVersion', 'authCredentialVersion_(u)',
        "cache.remove('admin_mfa_' + challenge)"])) {
    errors.push('Auth MFA challenge ไม่ผูก credentialVersion แบบ fail-closed');
  }
  if (!hasAll(verifyPasswordBlock, ['iterations < PASSWORD_HASH_ITERATIONS_MIN_',
        'iterations > PASSWORD_HASH_ITERATIONS_MAX_', '!/^[a-f0-9]{64}$/i.test(parts[3])']) ||
      !hasAll(iterationBlock, ['n >= PASSWORD_HASH_ITERATIONS_MIN_',
        'n <= PASSWORD_HASH_ITERATIONS_MAX_'])) {
    errors.push('Auth password verifier/config ไม่มี iteration bounds และ strict digest validation');
  }

  // Setup must be upgrade-safe: never delete a non-empty default sheet, never
  // seed by stale DB_SCHEMA order, and remove the one-time bootstrap secret
  // only after the password row has been durably verified.
  const setupSystemBlock = functionSource(setup, 'setupSystem');
  const setupBlankBlock = functionSource(setup, 'setupSheetIsBlank_');
  const setupAppendBlock = functionSource(setup, 'setupAppendObject_');
  const bootstrapBlock = functionSource(setup, 'bootstrapFirstAdmin');
  if (!hasAll(setupSystemBlock, ["['Sheet1', 'ชีต1']", 'ss.getSheets().length > 1',
        'setupSheetIsBlank_(s)', 'ss.deleteSheet(s)']) ||
      !hasAll(setupBlankBlock, ['getValues()', 'getFormulas()', "values[r][c] !== ''",
        "formulas[r][c] !== ''"])) {
    errors.push('Setup default-sheet cleanup ไม่ตรวจทั้ง value/formula ก่อนลบแบบ fail-safe');
  }
  if (!hasAll(setupAppendBlock, ['setupActualHeaders_(sh)', 'headers.map(function (header)',
        'Object.prototype.hasOwnProperty.call', 'sheetSafeValue_', 'setValues([']) ||
      /\.appendRow\s*\(/.test(setup)) {
    errors.push('Setup seed ต้อง append ตาม actual header เท่านั้นและห้ามใช้ raw appendRow()');
  }
  const verifiedPasswordAt = bootstrapBlock.indexOf('if (!check || !check.PasswordHash)');
  const deleteBootstrapSecretAt = bootstrapBlock.indexOf("deleteProperty('ADMIN_INIT_PASSWORD')");
  if (!hasAll(bootstrapBlock, ['Role: ROLES.IT_ADMIN', "Status: 'Active'"]) ||
      verifiedPasswordAt < 0 || deleteBootstrapSecretAt <= verifiedPasswordAt) {
    errors.push('Setup bootstrap admin ไม่ยืนยัน durable hash/role/status ก่อนลบ ADMIN_INIT_PASSWORD');
  }

  const workflowApis = ['getWorkflowModuleData','getWorkflowInstanceDetail','saveWorkflowDefinition',
    'setWorkflowDefinitionStatus','decideWorkflowApproval','delegateWorkflowApproval',
    'createWorkflowDelegation','revokeWorkflowDelegation','cancelWorkflowInstance',
    'runWorkflowAutomationNow','backfillWorkflowTransactions'];
  const permissionApis = ['getActionPermissionAdminData','saveRoleActionPermission',
    'saveUserPermissionOverride','saveApprovalGroup','saveApprovalGroupMember',
    'setApprovalGroupMemberStatus'];
  const attachmentApis = ['uploadRegisteredAttachment','listRecordAttachments',
    'downloadRegisteredAttachment','softDeleteRegisteredAttachment','restoreRegisteredAttachment',
    'setAttachmentLegalHold','releaseAttachmentLegalHold',
    'downloadIncidentLegacyTicketEvidence'];
  const integrationApis = ['processIntegrationOutboxNow','retryServiceRequestIntegration',
    'getServiceRequestIntegrations'];
  [...workflowApis, ...permissionApis, ...attachmentApis, ...integrationApis].forEach((fn) => {
    if (!new RegExp(`\\b${fn}\\s*:\\s*1\\b`).test(authz)) errors.push(`P3 API allowlist ไม่พบ ${fn}`);
    if (!serverFunctions.has(fn)) errors.push(`P3 backend ไม่พบ ${fn}`);
  });
  if (/\bdecideWorkflowApprovalByRecord\s*:\s*1\b/.test(authz) ||
      /function\s+decideWorkflowApprovalByRecord\s*\(/.test(workflow)) {
    errors.push('Workflow record-decision bridge ต้องเป็น internal function ลงท้าย _');
  }
  if (!index.includes("includeOptional_('Workflow')") ||
      !index.includes("workflow: 'renderWorkflow'") || !/function\s+renderWorkflow\s*\(/.test(client)) {
    errors.push('Workflow include/renderer wiring ไม่ครบ');
  }

  ['wfPreflightStepActors_','wfRepairInstanceActivationLocked_','wfResumeDecisionTransitionLocked_',
    'wfReconcileDurableTransitions_','wfReconcileServiceRequestIntegrationQueues_',
    'wfServiceRequestIntegrationConfig_'].forEach((marker) => {
    if (!workflow.includes(marker)) errors.push(`Workflow resilience guard ไม่พบ ${marker}`);
  });
  const resolveActorsBlock = functionSource(workflow, 'wfResolveStepActors_');
  const saveDefinitionBlock = functionSource(workflow, 'saveWorkflowDefinition');
  const setDefinitionStatusBlock = functionSource(workflow, 'setWorkflowDefinitionStatus');
  const workflowStartBlock = functionSource(workflow, 'workflowStart_');
  const definitionDtoBlock = functionSource(workflow, 'wfDefinitionDto_');
  const definitionStepSwitchBlock = functionSource(workflow, 'wfSwitchDefinitionStepGenerationLocked_');
  const definitionStepMatchBlock = functionSource(workflow, 'wfStepMatchesDefinitionVersion_');
  const definitionStepSelectBlock = functionSource(workflow, 'wfSelectCommittedDefinitionSteps_');
  const resolveDefinitionBlock = functionSource(workflow, 'wfResolveDefinitionLocked_');
  const canViewInstanceBlock = functionSource(workflow, 'wfCanViewInstance_');
  const workflowModuleDataBlock = functionSource(workflow, 'getWorkflowModuleData');
  const cancelWorkflowBlock = functionSource(workflow, 'cancelWorkflowInstance');
  const serviceWorkflowCancelBridgeBlock = functionSource(workflow,
    'wfCancelServiceRequestWorkflowLocked_');
  const workflowFinishBlock = functionSource(workflow, 'wfFinishInstanceLocked_');
  const runWorkflowAutomationBlock = functionSource(workflow, 'runWorkflowAutomationNow');
  const workflowReauthBlock = functionSource(workflow, 'wfReauthorizeMutationActorLocked_');
  const preflightActorsBlock = functionSource(workflow, 'wfPreflightStepActors_');
  const activateStepBlock = functionSource(workflow, 'wfActivateStepLocked_');
  const delegateApprovalBlock = functionSource(workflow, 'delegateWorkflowApproval');
  const createDelegationBlock = functionSource(workflow, 'createWorkflowDelegation');
  const revokeDelegationBlock = functionSource(workflow, 'revokeWorkflowDelegation');
  const workflowAutomationBlock = functionSource(workflow, 'processWorkflowAutomation_');
  const workflowTransitionRepairBlock = functionSource(workflow, 'wfReconcileDurableTransitions_');
  const workflowQueueRepairBlock = functionSource(workflow, 'wfReconcileServiceRequestIntegrationQueues_');
  const workflowRoundRobinBlock = functionSource(workflow, 'wfRoundRobinRepairRows_');
  const repairActivationBlock = functionSource(workflow, 'wfRepairInstanceActivationLocked_');
  const escalationActorBlock = functionSource(workflow, 'wfResolveEscalationActor_');
  const broadTypesMatch = resolveActorsBlock.match(/broadDynamicRoute\s*=\s*\[([^\]]+)\]/);
  const broadTypes = broadTypesMatch ? Array.from(broadTypesMatch[1].matchAll(/['"]([^'"]+)['"]/g),
    (match) => match[1]) : [];
  const explicitReturnAt = resolveActorsBlock.indexOf('if (!broadDynamicRoute) return normalized');
  const broadFilterAt = resolveActorsBlock.indexOf('return normalized.filter');
  if (!['ROLE', 'DEPARTMENT_APPROVER', 'GROUP'].every((type) => broadTypes.includes(type)) ||
      ['USER', 'CONTEXT', 'SUPERVISOR', 'REQUESTER_SUPERVISOR'].some((type) => broadTypes.includes(type)) ||
      explicitReturnAt < 0 || broadFilterAt <= explicitReturnAt) {
    errors.push('Workflow explicit actor routes ต้องผ่าน preflight แบบ fail-loud; filter ได้เฉพาะ broad dynamic routes');
  }
  if (!hasAll(preflightActorsBlock, ['__workflowActorSnapshots', 'frozen.length ?',
        'frozenAssignment.currentEmail', 'isValidEmail(currentEmail)',
        "currentEmail === String(instance.RequesterEmail || '').toLowerCase()",
        'wfActiveUser_(currentEmail)', "'workflow.approve'", 'voteOwners[assignment.currentEmail]']) ||
      !hasAll(activateStepBlock, ['__workflowActorSnapshots', 'ContextJSON: contextJson',
        'claimedVotes[current]', 'claimedVotes[currentEmail]'])) {
    errors.push('Workflow actor snapshot/SoD/action-permission/duplicate-vote guards ไม่ครบ');
  }
  const freezeSnapshotAt = activateStepBlock.indexOf('ContextJSON: contextJson');
  const appendApprovalAt = activateStepBlock.indexOf('wfAppendRowLocked_(SHEETS.WORKFLOW_APPROVAL');
  if (freezeSnapshotAt < 0 || appendApprovalAt < 0 || freezeSnapshotAt > appendApprovalAt) {
    errors.push('Workflow ต้อง freeze actor snapshot ก่อน append approval rows');
  }
  if (!hasAll(delegateApprovalBlock, ['delegateCollision', 'row.InstanceID', 'row.StepID',
        'row.ApprovalID', 'WF_APPROVAL_STATUS_.CANCELLED', 'WF_APPROVAL_STATUS_.SUPERSEDED',
        "String(row.ApproverEmail || '').toLowerCase() === delegateEmail", 'if (delegateCollision)'])) {
    errors.push('Workflow manual delegation ไม่มี same-step vote-collision guard');
  }
  if (!hasAll(repairActivationBlock, ['existingOriginals', 'missingAssignments',
        'status === WF_INSTANCE_STATUS_.ACTIVE && !missingAssignments.length',
        'wfActivateStepLocked_(instance, step, actor, preflight)', 'ACTIVE_PARTIAL_ACTIVATION',
        'repairedCount: missingAssignments.length'])) {
    errors.push('Workflow reconciliation ไม่ซ่อม approval rows ที่ append ค้างบางส่วน');
  }
  if (!hasAll(escalationActorBlock, ['peerApprovers', 'row.InstanceID', 'row.StepID',
        'row.ApprovalID', 'WF_APPROVAL_STATUS_.CANCELLED', 'WF_APPROVAL_STATUS_.SUPERSEDED',
        'peerApprovers[email]'])) {
    errors.push('Workflow escalation ไม่กันผู้ถือสิทธิ์โหวตอื่นในขั้นตอนเดียวกัน');
  }
  if (!/WorkflowSteps:\s*\[[^\]]*'DefinitionVersion'/.test(cfg) ||
      !hasAll(saveDefinitionBlock, ['DefinitionVersion: version', 'SAVE_DEFINITION_INTENT',
        'definitionWritten = true', 'wfSwitchDefinitionStepGenerationLocked_',
        'wfRetirePriorStepGenerationsLocked_', 'ROLLBACK_DEFINITION_SAVE']) ||
      !hasAll(definitionStepSwitchBlock, ["headers.indexOf('DefinitionVersion')",
        'Workflow step generation definition mismatch', 'Workflow step generation version mismatch',
        'retiredOrphans', 'Workflow orphan step generation could not be retired']) ||
      !hasAll(definitionStepMatchBlock, ['!!raw', 'Number(raw) === committedVersion']) ||
      !hasAll(definitionStepSelectBlock, ['const exact', 'if (exact.length) return exact',
        "!String(step.DefinitionVersion || '').trim()"] ) ||
      !setDefinitionStatusBlock.includes('wfSelectCommittedDefinitionSteps_') ||
      !workflowStartBlock.includes('wfSelectCommittedDefinitionSteps_') ||
      !definitionDtoBlock.includes('wfSelectCommittedDefinitionSteps_')) {
    errors.push('Workflow definition generation ไม่มี version-commit/runtime-selection/rollback guard ครบ');
  }
  const definitionIntentAt = saveDefinitionBlock.indexOf("'SAVE_DEFINITION_INTENT'");
  const definitionCommitAt = saveDefinitionBlock.indexOf('if (existing) wfUpdateRowLocked_(SHEETS.WORKFLOW_DEFINITION');
  if (definitionIntentAt < 0 || definitionCommitAt < 0 || definitionIntentAt > definitionCommitAt) {
    errors.push('Workflow definition ต้องเขียน durable intent ก่อน definition version commit');
  }
  const definitionRollbackMarkerAt = saveDefinitionBlock.indexOf('if (definitionWritten)');
  const definitionRollbackStepsAt = saveDefinitionBlock.lastIndexOf(
    'wfSwitchDefinitionStepGenerationLocked_(id, newStepIds, priorStatuses, false, version)');
  if (definitionRollbackMarkerAt < 0 || definitionRollbackStepsAt < 0 ||
      definitionRollbackMarkerAt > definitionRollbackStepsAt) {
    errors.push('Workflow rollback ต้อง restore/deactivate definition marker ก่อนยกเลิก step generation');
  }
  if (!hasAll(resolveDefinitionBlock, ['LastUpdatedAt || b.Timestamp', 'localeCompare']) ||
      canViewInstanceBlock.includes('wfCanViewSourceRecord_') ||
      !workflowModuleDataBlock.includes('if (!canViewAssigned) return false;')) {
    errors.push('Workflow default recovery หรือ action-level view isolation ไม่ครบ');
  }
  if (!hasAll(cancelWorkflowBlock, ["'CANCEL_INTENT'", "'CANCEL'", 'wfFinishInstanceLocked_'])) {
    errors.push('Workflow cancellation ไม่มี durable pending/success audit evidence');
  }
  const migrateWorkflowStepsBlock = functionSource(setup, 'migrateWorkflowStepVersionsP3_');
  const migrateCatalogP3Block = functionSource(setup, 'migrateServiceCatalogP3_');
  if (!hasAll(setupSystemBlock, ['migrateWorkflowStepVersionsP3_(ss)', 'migratedWorkflowSteps']) ||
      !hasAll(migrateWorkflowStepsBlock, ['LockService.getScriptLock()',
        "'MIGRATE_WORKFLOW_STEP_VERSION_INTENT'", "'MIGRATE_WORKFLOW_STEP_VERSION'",
        'getRangeList', 'SpreadsheetApp.flush()', 'planned[index]']) ||
      !hasAll(migrateCatalogP3Block, ['LockService.getScriptLock()',
        "'MIGRATE_CATALOG_P3_INTENT'", "'MIGRATE_CATALOG_P3'",
        'setupAppendCriticalAuditLocked_', 'setupCaptureRowImageLocked_',
        'setupWriteRowPatchLocked_', 'setupVerifyRowFieldsLocked_']) ||
      migrateCatalogP3Block.includes('updateRow_(') ||
      /catch\s*\(\s*ignoreAudit\s*\)/.test(migrateCatalogP3Block)) {
    errors.push('Setup P3 migration ไม่มี lock + verified intent/result + Workflow step version backfill ครบ');
  }
  const startIntentAt = workflowStartBlock.indexOf("'START_INTENT'");
  const startAppendAt = workflowStartBlock.indexOf('wfAppendRowLocked_(SHEETS.WORKFLOW_INSTANCE');
  const delegateIntentAt = delegateApprovalBlock.indexOf("'DELEGATE_INTENT'");
  const delegateWriteAt = delegateApprovalBlock.indexOf('wfUpdateRowLocked_(SHEETS.WORKFLOW_APPROVAL');
  if (startIntentAt < 0 || startAppendAt < 0 || startIntentAt > startAppendAt ||
      !workflowStartBlock.includes("'START_RECONCILED'") ||
      delegateIntentAt < 0 || delegateWriteAt < 0 || delegateIntentAt > delegateWriteAt ||
      !hasAll(createDelegationBlock, ["'CREATE_DELEGATION_INTENT'", 'freshTarget',
        'wfFindRowLocked_(SHEETS.WORKFLOW_DEFINITION']) ||
      !revokeDelegationBlock.includes("'REVOKE_DELEGATION_INTENT'") ||
      !hasAll(workflowAutomationBlock, ["'REMINDER_INTENT'", "'REMINDER'",
        "'ESCALATE_INTENT'", "'ESCALATE'"]) ||
      !hasAll(workflowTransitionRepairBlock, ["'RECONCILE_DECISION_INTENT'",
        "'RECONCILE_DECISION'"])) {
    errors.push('Workflow one-way mutations ไม่มี locked validation และ durable intent/result audit ครบ');
  }
  if (!hasAll(setDefinitionStatusBlock, ["'UPDATE_DEFINITION_STATUS_INTENT'",
        "'UPDATE_DEFINITION_STATUS'"]) ||
      !hasAll(workflowTransitionRepairBlock, ['WF_TRANSITION_REPAIR_CURSOR_KEY_',
        'wfRoundRobinRepairRows_']) ||
      !hasAll(workflowQueueRepairBlock, ['WF_QUEUE_REPAIR_CURSOR_KEY_',
        'wfRoundRobinRepairRows_']) ||
      !hasAll(workflowRoundRobinBlock, ['cursorStart', 'nextCursor', 'props.setProperty']) ||
      !utilsSource.includes("'WORKFLOW_TRANSITION_REPAIR_CURSOR'") ||
      !utilsSource.includes("'WORKFLOW_QUEUE_REPAIR_CURSOR'")) {
    errors.push('Workflow status audit หรือ repair round-robin fairness guard ไม่ครบ');
  }
  if (!workflow.includes("wfRequireActionPermission_(user, 'integration.execute')") ||
      !integration.includes("wfRequireActionPermission_(user, 'integration.retry')")) {
    errors.push('Workflow/Integration action-level execute/retry guard ไม่ครบ');
  }
  if (!hasAll(runWorkflowAutomationBlock, ['requireRole([ROLES.IT_ADMIN])',
        '_requiredRole: ROLES.IT_ADMIN', 'processWorkflowAutomation_(limit, executionActor)',
        'processIntegrationOutbox_', 'executionActor']) ||
      !hasAll(workflowReauthBlock, ['actorObj._requiredRole', 'fresh._requiredRole',
        'fresh.role !== fresh._requiredRole'])) {
    errors.push('Workflow automation alternate endpoint ไม่มี locked ITAdmin role contract');
  }
  if (!actionPermission.includes("wfRequireActionPermission_(user, 'workflow.admin')") ||
      !actionPermission.includes('ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้')) {
    errors.push('Action Permission admin governance/self-escalation guard ไม่ครบ');
  }
  if (!attachment.includes('arAssertAttachmentsLinkedToRecordLocked_') ||
      !attachment.includes('arTrustedLegacyUpload_') ||
      !attachment.includes('arTerminalStatus_') || !cfg.includes("'HomeModule', 'IsEvidence'")) {
    errors.push('Attachment registry link/trust/lifecycle/evidence guards ไม่ครบ');
  }
  if (!integration.includes('Persist the durable adapter result') ||
      !integration.includes('COMPLETED is the final commit marker') ||
      !integration.includes('intReconcileCompletedLocked_') ||
      !integration.includes('Transaction routing is immutable')) {
    errors.push('Integration outbox durability/immutable-snapshot guards ไม่ครบ');
  }
  const processOneBlock = functionSource(integration, 'intProcessOne_');
  const processOutboxBlock = functionSource(integration, 'processIntegrationOutbox_');
  const markIntegrationFailureBlock = functionSource(integration, 'intMarkFailure_');
  const integrationAuditBlock = functionSource(integration, 'intWriteAuditLocked_');
  const queueIntegrationBlock = functionSource(integration, 'queueServiceRequestIntegrationLocked_');
  const integrationReauthBlock = functionSource(integration, 'intReauthorizeMutationActorLocked_');
  const accessAdapterBlock = functionSource(integration, 'intCreateAccessRequestLocked_');
  const ticketAdapterBlock = functionSource(integration, 'intCreateTicketLocked_');
  const assetAdapterBlock = functionSource(integration, 'intLinkAssetLocked_');
  const changeAdapterBlock = functionSource(integration, 'intCreateChangeLocked_');
  const reverseProvenanceStateBlock = functionSource(integration, 'intReverseProvenanceState_');
  const ticketSideEffectsBlock = functionSource(integration, 'intEnsureTargetSideEffectsLocked_');
  const lifecycleSyncBlock = functionSource(integration, 'intReconcileLinkedTargetStatuses_');
  const lifecycleAggregateBlock = functionSource(integration, 'intAggregateRequestLifecycleLocked_');
  const completedReconcileBlock = functionSource(integration, 'intReconcileCompletedLocked_');
  const integrationCancelPreflight = functionSource(integration, 'intPreflightServiceRequestCancellationLocked_');
  const integrationCancelBlock = functionSource(integration, 'intCancelServiceRequestIntegrationsLocked_');
  const integrationRetryBlock = functionSource(integration, 'retryServiceRequestIntegration');
  const serviceCancelBlock = functionSource(serviceCatalog, 'cancelServiceRequest');
  if (!hasAll(ticketSideEffectsBlock, ["target !== 'ticket'", 'SHEETS.TICKET_WORKLOG',
        "'SourceServiceRequestID=' + request.RequestID", 'row.TicketID', 'if (existing) return',
        'WorklogID:', 'IntegrationID=']) ||
      !processOneBlock.includes('intEnsureTargetSideEffectsLocked_(target, targetRecordId, request, job, actorObj)')) {
    errors.push('Integration Ticket adapter ไม่มี idempotent repair สำหรับ opening worklog side effect');
  }
  const sideEffectRepairAt = processOneBlock.indexOf('intEnsureTargetSideEffectsLocked_(');
  const reverseProvenanceAt = processOneBlock.indexOf('intPatchReverseLinkLocked_(');
  const persistAdapterResultAt = processOneBlock.indexOf('ResultRecordID: targetRecordId');
  if (reverseProvenanceAt < 0 || sideEffectRepairAt < 0 || persistAdapterResultAt < 0 ||
      reverseProvenanceAt > sideEffectRepairAt || sideEffectRepairAt > persistAdapterResultAt) {
    errors.push('Integration ต้อง verify reverse provenance แล้ว repair Ticket side effects ก่อน durable result commit');
  }
  if (!hasAll(lifecycleSyncBlock, ['selectedRequestIds', 'cursorLinks',
        'intAggregateRequestLifecycleLocked_', 'evaluatedLinks']) ||
      !hasAll(lifecycleAggregateBlock, ['intPatchReverseLinkLocked_', 'provenanceError',
        "'PROVENANCE_ERROR'", 'INT_OUTBOX_STATUS.ERROR', "'INTEGRATION_LIFECYCLE_SYNC'",
        "'INTEGRATION_LIFECYCLE'", 'IntegrationError: nextError', 'unhealthy',
        'requestJobs', 'pendingJobs', 'jobErrors', 'hasLink']) ||
      !completedReconcileBlock.includes('intPatchReverseLinkLocked_')) {
    errors.push('Integration lifecycle/completed reconciliation ไม่ verify หรือ repair reverse provenance');
  }
  const lifecycleAuditAt = lifecycleAggregateBlock.indexOf("'INTEGRATION_LIFECYCLE_SYNC_INTENT'");
  const lifecycleProvenancePatchAt = lifecycleAggregateBlock.indexOf('intPatchReverseLinkLocked_(');
  const lifecycleSourceCommitAt = lifecycleAggregateBlock.indexOf('IntegrationStatus: nextStatus');
  if (lifecycleAuditAt < 0 || lifecycleProvenancePatchAt < 0 || lifecycleSourceCommitAt < 0 ||
      lifecycleAuditAt > lifecycleProvenancePatchAt || lifecycleAuditAt > lifecycleSourceCommitAt) {
    errors.push('Integration lifecycle ต้องเขียน durable audit intent ก่อน provenance/source mutation');
  }
  if (!hasAll(processOutboxBlock, ['readyCandidates', 'repairCandidates', 'limit === 1',
        'INT_OUTBOX_QUEUE_TURN_KEY', "setProperty(INT_OUTBOX_QUEUE_TURN_KEY, 'READY')",
        "setProperty(INT_OUTBOX_QUEUE_TURN_KEY, 'REPAIR')"]) ||
      !integration.includes("const INT_OUTBOX_QUEUE_TURN_KEY = 'INTEGRATION_OUTBOX_QUEUE_TURN'") ||
      !utilsSource.includes("'INTEGRATION_OUTBOX_QUEUE_TURN'")) {
    errors.push('Integration outbox quota=1 ไม่มี persistent fair alternation ระหว่าง fresh/repair queues');
  }
  if (!hasAll(lifecycleSyncBlock, ['INT_LIFECYCLE_CURSOR_KEY', 'storedCursor', 'cursorStart',
        'nextCursor', 'props.setProperty(INT_LIFECYCLE_CURSOR_KEY']) ||
      !hasAll(markIntegrationFailureBlock, ['intReauthorizeMutationActorLocked_',
        'AttemptCount: attempts', 'LastAttemptAt: new Date()', 'NextAttemptAt:',
        "'INTEGRATION_RECONCILE_ERROR'"]) ||
      !hasAll(integrationAuditBlock, ["headers.indexOf('LogID')", 'logIdColumn',
        'Integration audit write could not be verified'])) {
    errors.push('Integration reconciliation ไม่มี cursor/backoff/reauthorization/verified-audit guard ครบ');
  }
  if (!hasAll(queueIntegrationBlock, ["'QUEUE_INTEGRATION_INTENT'",
        "'QUEUE_INTEGRATION'", 'duplicate/reconciled']) ||
      !hasAll(integrationCancelBlock, ["'INTEGRATION_CANCEL_INTENT'",
        "'INTEGRATION_CANCELLED'", 'duplicate/reconciled']) ||
      !hasAll(integrationRetryBlock, ["'RETRY_INTEGRATION_INTENT'", "'RETRY_INTEGRATION'"]) ||
      !hasAll(markIntegrationFailureBlock, ["'INTEGRATION_ERROR_INTENT'",
        "'INTEGRATION_RECONCILE_ERROR_INTENT'"]) ||
      ![accessAdapterBlock, ticketAdapterBlock, changeAdapterBlock].every((block) =>
        block.includes("'CREATE_FROM_SERVICE_REQUEST_INTENT'")) ||
      !assetAdapterBlock.includes("'LINK_FROM_SERVICE_REQUEST_INTENT'")) {
    errors.push('Integration one-way queue/cancel/retry/adapter/error mutations ไม่มี durable intent/result audit ครบ');
  }
  if (!hasAll(integrationReauthBlock, ['lockedRequiredRole',
        'บทบาทผู้ดำเนินการไม่ตรงกับข้อกำหนดของ API']) ||
      !integration.includes('_requiredRole: ROLES.IT_ADMIN') ||
      !processOneBlock.includes('intAggregateRequestLifecycleLocked_') ||
      !completedReconcileBlock.includes('intAggregateRequestLifecycleLocked_') ||
      processOneBlock.includes('IntegrationStatus: INT_OUTBOX_STATUS.COMPLETED') ||
      completedReconcileBlock.includes('IntegrationStatus: INT_OUTBOX_STATUS.COMPLETED')) {
    errors.push('Integration locked ITAdmin contract หรือ 1:N aggregate source commit guard ไม่ครบ');
  }
  if (!hasAll(reverseProvenanceStateBlock, ['/^SourceServiceRequestID=(.+)$/',
        'conflicts.length', 'currentSource && currentSource !== requestId']) ||
      !integration.includes('intReverseProvenanceState_(row, requestId)') ||
      !lifecycleAggregateBlock.includes('intReverseProvenanceState_(targetRow')) {
    errors.push('Integration reverse provenance ไม่ปฏิเสธ legacy Notes marker conflict');
  }
  if (!hasAll(integrationCancelPreflight, ['SHEETS.RECORD_LINK', 'activeLink',
        'job.ResultRecordID', 'intPrimaryTargetId_', 'intFindReverseTarget_',
        'INT_OUTBOX_STATUS.COMPLETED']) ||
      !hasAll(integrationCancelBlock, ['intPreflightServiceRequestCancellationLocked_',
        'INT_OUTBOX_STATUS.CANCELLED', 'NextAttemptAt:', 'IntegrationStatus:',
        "'INTEGRATION_CANCELLED'"]) ||
      !hasAll(integrationRetryBlock, ['intServiceRequestTerminal_(request.Status)',
        'INT_OUTBOX_STATUS.CANCELLED'])) {
    errors.push('Integration cancellation/retry ไม่มี durable-target และ terminal-source guards ครบ');
  }
  const cancelPreflightAt = serviceCancelBlock.indexOf('intPreflightServiceRequestCancellationLocked_(req)');
  const cancelIntentAt = serviceCancelBlock.indexOf("'CANCEL_INTENT'");
  const cancelWorkflowAt = serviceCancelBlock.indexOf('wfCancelServiceRequestWorkflowLocked_(req, lockedUser, reason)');
  const cancelOutboxAt = serviceCancelBlock.indexOf('intCancelServiceRequestIntegrationsLocked_(req, lockedUser, reason)');
  const cancelSourceAt = serviceCancelBlock.indexOf('svcUpdateRowLocked_(SHEETS.SERVICE_REQUEST');
  if (cancelPreflightAt < 0 || cancelIntentAt < cancelPreflightAt ||
      cancelWorkflowAt < cancelIntentAt || cancelOutboxAt < cancelWorkflowAt ||
      cancelSourceAt < cancelOutboxAt ||
      !hasAll(serviceCancelBlock, ['svcReauthorizeMutationActorLocked_',
        'alreadyCancelled', 'svcWriteCriticalAuditLocked_', "'CANCEL_RECONCILED'",
        'hasCancelHistory', 'duplicate: true']) ||
      !hasAll(serviceWorkflowCancelBridgeBlock, ['WF_INSTANCE_STATUS_.CANCELLED',
        '{ skipSourceOutcome: true }', "'CANCEL_RECONCILED'"]) ||
      !hasAll(workflowFinishBlock, ['options = options || {}',
        'if (!options.skipSourceOutcome) wfApplySourceOutcomeLocked_(fresh',
        'if (!options.skipSourceOutcome) wfApplySourceOutcomeLocked_(instance'])) {
    errors.push('Service Request cancellation ต้อง preflight และ cancel workflow/outbox ก่อน source commit ภายใต้ lock เดียว');
  }
  if (!serviceCatalog.includes('svcAssertIntegrationComplete_') ||
      !serviceCatalog.includes('workflowEnsureServiceRequest_') ||
      !serviceCatalog.includes('svcEnsureRequestAttachments_')) {
    errors.push('Service Request P3 workflow/attachment/integration hooks ไม่ครบ');
  }

  // Attachment migration: authenticated Service Request, Ticket and Personal
  // Task flows must use registry IDs plus the authorization download proxy.
  // Public Ticket upload remains intentionally separate for anonymous users.
  const registeredUploadBlock = functionSource(sharedClient, 'uploadRegisteredFile');
  const registeredDownloadBlock = functionSource(sharedClient, 'downloadRegisteredAttachmentFile');
  const registryDtoBlock = functionSource(attachment, 'arAttachmentDto_');
  const legacyUploadBlock = functionSource(drive, 'uploadEvidence');
  if (!hasAll(registeredUploadBlock, ["callServer('uploadRegisteredAttachment'", 'moduleKey:',
        'recordId:', 'attachmentRole:', 'classification:', 'isEvidence:']) ||
      !hasAll(registeredDownloadBlock, ["callServer('downloadRegisteredAttachment'", 'data.base64',
        'URL.createObjectURL', 'URL.revokeObjectURL'])) {
    errors.push('Attachment client helper ไม่ใช้ registry upload และ authorized download proxy ครบ');
  }
  if (!registryDtoBlock || /\b(?:FileID|ExternalURL|ParentFolderID|StoragePath)\s*:/.test(registryDtoBlock)) {
    errors.push('Attachment DTO เปิดเผย storage locator/Drive identifier ไปยัง client');
  }
  const migratedLegacyModules = ['serviceCatalog', 'task', 'ticket'];
  const legacyDenyMatch = legacyUploadBlock.match(/if\s*\(\[([^\]]+)\]\.indexOf\(moduleKey\)\s*>\s*-1\)/);
  const legacyDenyModules = legacyDenyMatch ? Array.from(
    legacyDenyMatch[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]) : [];
  if (!migratedLegacyModules.every((moduleKey) => legacyDenyModules.includes(moduleKey)) ||
      !legacyUploadBlock.includes('ต้องอัปโหลดผ่าน Attachment Registry')) {
    errors.push('uploadEvidence ยังเปิด legacy bypass ให้โมดูลที่ย้ายเข้า Attachment Registry แล้ว');
  }
  [
    ['ServiceCatalog.html', serviceClient], ['Ticket.html', ticketClient], ['Task.html', taskClient]
  ].forEach(([name, source]) => {
    if (/\buploadFileInput\s*\(|\bcallServer\s*\(\s*['"]uploadEvidence['"]/.test(source)) {
      errors.push(`${name} ยังเรียก legacy uploadEvidence แทน Attachment Registry`);
    }
  });

  const submitServiceBlock = functionSource(serviceCatalog, 'submitServiceRequest');
  const updateServiceStatusBlock = functionSource(serviceCatalog, 'updateServiceRequestStatus');
  const updateServiceTaskBlock = functionSource(serviceCatalog, 'updateServiceRequestTask');
  const ensureServiceAttachmentsBlock = functionSource(serviceCatalog, 'svcEnsureRequestAttachments_');
  const serviceDtoBlock = functionSource(serviceCatalog, 'svcRequestDto_');
  if (!hasAll(cfg, ['AttachmentIDsJSON', 'CompletionAttachmentIDsJSON',
        'EvidenceAttachmentIDsJSON', 'RegistryAttachmentID']) ||
      !hasAll(submitServiceBlock, ['AttachmentIDsJSON:', 'svcEnsureRequestAttachments_',
        'svcDiscardUnclaimedServiceCatalogAttachment_']) ||
      !hasAll(ensureServiceAttachmentsBlock, ['claimRegisteredAttachment_',
        'claimLegacyRegisteredAttachment_', "fieldName: 'AttachmentIDsJSON'", 'svcUpdateRowLocked_']) ||
      !hasAll(updateServiceStatusBlock, ['svcClaimRegisteredAttachments_',
        "fieldName: 'CompletionAttachmentIDsJSON'", 'CompletionAttachmentIDsJSON']) ||
      !hasAll(updateServiceTaskBlock, ['svcClaimRegisteredAttachments_',
        "fieldName: 'EvidenceAttachmentIDsJSON'", 'EvidenceAttachmentIDsJSON']) ||
      !hasAll(serviceDtoBlock, ['attachmentIds:', 'completionAttachmentIds:',
        'evidenceAttachmentIds:'])) {
    errors.push('Service Catalog attachment migration ไม่มี durable claim/repair/completion/task evidence ครบ');
  }
  if (!hasAll(serviceClient, ['uploadRegisteredFileInput', "moduleKey: 'serviceCatalog'",
        "fieldName: 'AttachmentIDsJSON'", "fieldName: 'CompletionAttachmentIDsJSON'",
        "fieldName: 'EvidenceAttachmentIDsJSON'", 'registeredAttachmentButtonHtml'])) {
    errors.push('Service Catalog UI ไม่ครอบคลุม registry upload/download ของ request/completion/task');
  }

  const submitTicketBlock = functionSource(ticketServer, 'submitTicket');
  const createTicketBlock = functionSource(ticketServer, 'createTicketCore_');
  const ensureTicketAttachmentsBlock = functionSource(ticketServer, 'ticketEnsureRegisteredAttachments_');
  const discardTicketAttachmentsBlock = functionSource(ticketServer, 'ticketDiscardUnclaimedRegisteredAttachments_');
  const ticketDtoBlock = functionSource(ticketServer, 'serializeTicket_');
  if (!hasAll(submitTicketBlock, ['stagedAttachmentIds', 'arAssertClaimableAttachmentLocked_',
         'IdempotencyKey', 'LockService.getUserLock()', 'ticketEnsureRegisteredAttachments_',
         'ticketDiscardUnclaimedRegisteredAttachments_']) ||
      !hasAll(createTicketBlock, ['registeredAttachmentIds', 'AttachmentIDsJSON:',
        'IdempotencyKey:', 'savePublicTicketFiles_',
        'arAssertClaimableAttachmentLocked_']) ||
      !hasAll(ensureTicketAttachmentsBlock, ['arRepairDurableAttachmentIntent_',
        "fieldName: 'AttachmentIDsJSON'", 'durable ticket intent']) ||
      !hasAll(discardTicketAttachmentsBlock, ["String(row.Status || '').toUpperCase() !== 'STAGED'",
        'softDeleteRegisteredAttachment']) ||
      !hasAll(ticketDtoBlock, ['attachmentIds:', "evidence: ''", 'hasLegacyEvidence:'])) {
    errors.push('Authenticated Ticket attachment migration ไม่มี idempotent claim/compensation/public compatibility ครบ');
  }
  if (!hasAll(ticketClient, ['uploadRegisteredFileInput', "moduleKey: 'ticket'",
        "fieldName: 'AttachmentIDsJSON'", 'registeredAttachmentButtonHtml'])) {
    errors.push('Ticket UI ไม่ใช้ Attachment Registry สำหรับ authenticated upload/download');
  }

  const taskDataBlock = functionSource(taskServer, 'getTaskModuleData');
  const addTaskAttachmentBlock = functionSource(taskServer, 'addTaskAttachment');
  if (!hasAll(taskDataBlock, ['SHEETS.ATTACHMENT_REGISTRY', 'SHEETS.ATTACHMENT_LINK',
        "String(link.ModuleKey || '') !== 'task'", 'arAttachmentDto_']) ||
      !hasAll(addTaskAttachmentBlock, ['arRepairDurableAttachmentIntentLocked_', "recordType: 'PersonalTask'",
        'RegistryAttachmentID:', "FileID: '', FileURL: ''"]) ||
      !hasAll(taskClient, ['uploadRegisteredFile', "moduleKey: 'task'",
        "recordType: 'PersonalTask'", 'registeredAttachmentButtonHtml'])) {
    errors.push('Personal Task attachment migration ไม่ใช้ registry link/DTO/proxy ครบ');
  }
  // Attachment security invariants: locked fresh authorization, durable
  // pending/result audit, legal hold, strict claims and graph-aware retention.
  const freshAttachmentAuthBlock = functionSource(attachment, 'arAuthorizeMutationLocked_');
  const criticalAttachmentAuditBlock = functionSource(attachment, 'arBeginCriticalAuditLocked_');
  const completeAttachmentAuditBlock = functionSource(attachment, 'arCompleteCriticalAuditLocked_');
  const legalHoldBlock = functionSource(attachment, 'arSetAttachmentLegalHold_');
  const directLinkBlock = functionSource(attachment, 'linkRegisteredAttachment_');
  const durableRepairBlock = functionSource(attachment, 'arRepairDurableAttachmentIntentLocked_');
  const claimableBlock = functionSource(attachment, 'arAssertClaimableAttachment_');
  const claimableLockedBlock = functionSource(attachment, 'arAssertClaimableAttachmentLocked_');
  const reusableDuplicateBlock = functionSource(attachment, 'arFindReusableDuplicate_');
  const uploadCompensationBlock = functionSource(attachment, 'arCompensateFailedUpload_');
  const activeAttachmentLinksBlock = functionSource(attachment, 'arActiveLinksForAttachment_');
  const listRecordAttachmentsBlock = functionSource(attachment, 'listRecordAttachments');
  const primaryAttachmentContextBlock = functionSource(attachment, 'arPrimaryAuthorizedContext_');
  const normalizeAttachmentContextBlock = functionSource(attachment, 'arNormalizeContext_');
  const restoreAttachmentBlock = functionSource(attachment, 'restoreRegisteredAttachment');
  const authorizeAttachmentBlock = functionSource(attachment, 'authorizeRegisteredAttachment_');
  const workflowEvidenceBlock = functionSource(attachment, 'arAssertAttachmentsLinkedToRecordLocked_');
  const incidentProvenanceBlock = functionSource(attachment,
    'arEnsureIncidentTicketAttachmentProvenance_');
  const rawRetentionBlock = functionSource(retention, 'retentionMaybeTrashEvidence_');
  const lifecycleIntentBlock = functionSource(retention, 'retentionAttachmentIntentSet_');
  const attachmentSourceBlock = functionSource(retention, 'retentionAttachmentLinkSource_');
  const attachmentSourceActiveBlock = functionSource(retention, 'retentionEntityRowActive_');
  const attachmentTerminalAtBlock = functionSource(retention, 'retentionAttachmentTerminalAt_');
  const effectiveRetentionBlock = functionSource(retention,
    'retentionAttachmentLinkEffectiveDue_');
  const expireAttachmentLinkBlock = functionSource(retention, 'retentionExpireAttachmentLink_');
  const softDeleteRetentionAttachmentBlock = functionSource(retention,
    'retentionSoftDeleteAttachment_');
  const taskLinkBlock = functionSource(taskServer, 'addTaskLink');
  const taskDriveLocatorBlock = functionSource(taskServer, 'taskIsGoogleDriveLocator_');
  const escalateIncidentBlock = functionSource(ticketServer, 'escalateTicketToIncident');
  const incidentDtoBlock = functionSource(incidentServer, 'serializeIncident');

  if (!hasAll(freshAttachmentAuthBlock, ['apResetRuntimeReadCache_()',
        "apResolveActor_({ email: email })", 'arRequireAttachmentPermission_',
        'canEditModule', 'arCanAuthorizeRecord_'])) {
    errors.push('Attachment mutation authorization must be freshly resolved inside ScriptLock');
  }
  [directLinkBlock, durableRepairBlock, legalHoldBlock, restoreAttachmentBlock,
    functionSource(attachment, 'softDeleteRegisteredAttachment'),
    functionSource(attachment, 'uploadRegisteredAttachment'),
    functionSource(attachment, 'claimLegacyRegisteredAttachment_')].forEach((block) => {
    if (!block.includes('arAuthorizeMutationLocked_')) {
      errors.push('Attachment commit path is missing locked fresh authorization');
    }
  });
  if (!hasAll(criticalAttachmentAuditBlock, ["Result: 'pending'", 'OP_KEY=',
        'arReadRowDirect_', 'SHEETS.AUDIT_TRAIL', 'arAccessLogSheetName_()']) ||
      !hasAll(completeAttachmentAuditBlock, ["['success', 'error']", 'arUpdateRowDirect_',
        'arReadRowDirect_']) ||
      !hasAll(directLinkBlock, ['arBeginCriticalAuditLocked_', 'arCompleteCriticalAuditLocked_',
        'arUpdateRegistryDirect_', "Status: 'ACTIVE'"]) ||
      !hasAll(durableRepairBlock, ['arBeginCriticalAuditLocked_',
        'arCompleteCriticalAuditLocked_', 'arAssertDurableIntentReference_'])) {
    errors.push('Attachment link/repair mutations require verified pending/result audit and atomic registry state');
  }
  if (!actionPermission.includes("'attachment.legal_hold'") ||
      !hasAll(legalHoldBlock, ["'attachment.legal_hold'", 'LockService.getScriptLock()',
        'arBeginCriticalAuditLocked_', 'arRefreshAttachmentAggregatesLocked_',
        'ROLES.IT_ADMIN', 'ROLES.DPO'])) {
    errors.push('Controlled ITAdmin/DPO legal-hold API is incomplete');
  }
  if (!hasAll(claimableBlock, ["arAttachmentStatus_(attachment) !== 'STAGED'",
        'arActiveLinksForAttachment_(attachment).length',
        'arAttachmentReferencedByDurableIntent_']) ||
      !hasAll(claimableLockedBlock, ['arAuthorizeMutationLocked_',
        "arAttachmentStatus_(attachment) !== 'STAGED'", 'arLiveDriveFile_',
        'arAttachmentReferencedByDurableIntent_']) ||
      !hasAll(reusableDuplicateBlock, ['arAttachmentReferencedByDurableIntent_',
        'arHasExactActiveLink_', "arAttachmentStatus_(row) !== 'STAGED'"]) ||
      !hasAll(directLinkBlock, ['arAttachmentReferencedByDurableIntent_',
        'became owned by a durable business-record intent']) ||
      !hasAll(createTicketBlock, ['arAssertClaimableAttachmentLocked_']) ||
      !hasAll(submitServiceBlock, ['preExistingRequest', 'arAssertClaimableAttachmentLocked_']) ||
      !hasAll(addTaskAttachmentBlock, ['preExistingIntent', 'arAssertClaimableAttachmentLocked_'])) {
    errors.push('New attachment intents must be STAGED/zero-link under the source commit lock after duplicate lookup');
  }
  if (!hasAll(directLinkBlock, ['summaryAuditError', 'critical audit above']) ||
      !hasAll(uploadCompensationBlock, ["arAttachmentStatus_(current) !== 'STAGED'",
        'arActiveLinksForAttachment_(current).length',
        'arAttachmentReferencedByDurableIntent_', 'arBeginCriticalAuditLocked_'])) {
    errors.push('Post-commit attachment logging can trigger destructive compensation of a durable/link-owned upload');
  }
  if (!hasAll(activeAttachmentLinksBlock, ['hasRealLinks', 'matching.filter(arIsActiveLink_)',
        "arAttachmentStatus_(attachment) === 'ACTIVE'"]) ||
      !hasAll(listRecordAttachmentsBlock, ['allRealLinks', 'arLinkAttachmentId_',
        "arAttachmentStatus_(row) === 'ACTIVE'"]) ||
      !hasAll(authorizeAttachmentBlock, ['!arHasAnyRealLinkForAttachment_(attachment)']) ||
      !hasAll(primaryAttachmentContextBlock, ['!arHasAnyRealLinkForAttachment_(attachment)'])) {
    errors.push('Historical AttachmentLinks must disable every registry-only pseudo-link authorization fallback');
  }
  if (!hasAll(normalizeAttachmentContextBlock, ['canonicalModules',
        'Attachment module and record type do not match', 'canonicalModule !== normalizedModule'])) {
    errors.push('Attachment module/record-type canonical pairing is not enforced');
  }
  const rawTrashAt = rawRetentionBlock.indexOf('setTrashed(true)');
  if (!hasAll(rawRetentionBlock, ['LockService.getScriptLock()', 'SHEETS.ATTACHMENT_REGISTRY',
        'SHEETS.ATTACHMENT_LINK', 'registered.length || linked || held']) ||
      rawTrashAt < rawRetentionBlock.indexOf('registryRows =') ||
      rawTrashAt < rawRetentionBlock.indexOf('linkRows =')) {
    errors.push('Legacy raw evidence cleanup can bypass registry/link/legal-hold graph recheck');
  }
  if (!hasAll(restoreAttachmentBlock, ['arRestoreRequiresAdmin_',
        "'attachment.admin'", 'arRetentionExpiredLinks_', 'recoveryUntil',
        "'RESTORE_RETENTION_OVERRIDE'", 'arBeginCriticalAuditLocked_']) ||
      !hasAll(authorizeAttachmentBlock, ['[ADMIN_RETENTION_RESTORE]',
        "'attachment.admin'"])) {
    errors.push('Retention-deleted/EXPIRED restore lacks controlled usable admin recovery');
  }
  if (!hasAll(taskLinkBlock, ['taskIsGoogleDriveLocator_', 'Attachment Registry']) ||
      !hasAll(taskDriveLocatorBlock, ['drive\\.google\\.com', 'docs\\.google\\.com']) ||
      !hasAll(taskDataBlock, ['legacyDriveUnavailable', "url: legacyDrive ? '' : rawUrl"])) {
    errors.push('Personal Task raw Google Drive/Docs locator bypass is not closed');
  }
  if (!hasAll(workflowEvidenceBlock, ["arAttachmentStatus_(attachment) !== 'ACTIVE'",
        "['IsEvidence']", "['EntitySheet']", "'WorkflowAttachments'",
        "'APPROVAL_EVIDENCE'", 'arLiveDriveFile_']) ||
      !client.includes("attachmentRole: 'APPROVAL_EVIDENCE'")) {
    errors.push('Workflow approval evidence must be exact ACTIVE/private registry evidence');
  }
  if (escalateIncidentBlock.includes('EvidenceLink: t.EvidenceLink') ||
      !hasAll(escalateIncidentBlock, ["EvidenceLink: ''",
        'arEnsureIncidentTicketAttachmentProvenance_', 'ESCALATE_INCIDENT_RECONCILED']) ||
      !hasAll(incidentProvenanceBlock, ['SourceTicketID', 'INCIDENT_EVIDENCE',
        'arBeginCriticalAuditLocked_', "{ recordAction: 'read' }"]) ||
      !hasAll(incidentDtoBlock, ["evidence: r.SourceTicketID ? '' : r.EvidenceLink",
        'attachmentIds: incidentAttachmentIds', 'legacyEvidenceMigrationRequired:'])) {
    errors.push('Ticket to Incident evidence provenance is not opaque, auditable and terminal-safe');
  }
  if (!attachment.includes('approverTriageReader') ||
      !attachment.includes('resolvedActor.role === ROLES.APPROVER') ||
      !attachment.includes("wfHasActionPermission_(resolvedActor, 'attachment.view'")) {
    errors.push('Approver Ticket triage and Attachment Registry read policy are inconsistent');
  }
  if (!hasAll(lifecycleIntentBlock, ['retentionEntityRowActive_', 'PersonalTask']) ||
      !hasAll(effectiveRetentionBlock, ['retentionAttachmentTerminalAt_',
        'terminalAt.getTime() + policyDays', 'explicitDue']) ||
      !retention.includes('retentionAttachmentLinkSourceActive_(link)') ||
      !retention.includes('AC_STATUS.DONE') || !retention.includes('CHG_STATUS.DEPLOYED')) {
    errors.push('Attachment retention must honor active source lifecycle and terminal-at policy windows');
  }
  if (!hasAll(attachmentSourceBlock, ['retentionFindRowIncludingDeleted_']) ||
      !hasAll(attachmentSourceActiveBlock, ['_isDeletedRow_(row)']) ||
      !hasAll(attachmentTerminalAtBlock, ["['DeletedAt'", 'retentionFindRowIncludingDeleted_']) ||
      !hasAll(retention, ['sourceRetentionLinks',
        'Preserve the deleted source row as the terminal timestamp authority'])) {
    errors.push('Deleted attachment sources must remain retention authorities until active links expire');
  }
  if (!hasAll(expireAttachmentLinkBlock, ['arBeginCriticalAuditLocked_',
        'arCompleteCriticalAuditLocked_', 'arRefreshAttachmentAggregatesLocked_',
        'registryBefore', 'linkBefore']) ||
      !hasAll(softDeleteRetentionAttachmentBlock, ['arBeginCriticalAuditLocked_',
        'arCompleteCriticalAuditLocked_', 'registryBefore', 'fileWasTrashed'])) {
    errors.push('Retention attachment mutations require verified in-lock audit and rollback state');
  }

  ['SHEETS.USERS','SHEETS.SETTINGS','SHEETS.WORKFLOW_APPROVAL','SHEETS.ATTACHMENT_ACCESS_LOG',
    'SHEETS.INTEGRATION_OUTBOX'].forEach((marker) => {
    if (!setup.includes(`protectSensitiveSheet_(ss, ${marker}`)) {
      errors.push(`Setup ไม่ protect ${marker}`);
    }
  });
  if (!setup.includes('hardenSheetProtection_') || !setup.includes('setUnprotectedRanges([])')) {
    errors.push('Setup ไม่ reconcile/harden sheet protection เดิม');
  }
  ['WORKFLOW_PII_RETENTION_DAYS','ATTACHMENT_RETENTION_DAYS',
    'ATTACHMENT_STAGED_RETENTION_HOURS','ATTACHMENT_DOWNLOAD_MAX_MB'].forEach((key) => {
    if (!settings.includes(`'${key}'`)) errors.push(`Settings P3 ไม่พบ ${key}`);
  });
  if (!retention.includes('WORKFLOW_PII_RETENTION_DAYS') ||
      !retention.includes('ATTACHMENT_STAGED_RETENTION_HOURS')) {
    errors.push('P3 retention ไม่ครอบคลุม Workflow/Attachment');
  }

  const integrationSandbox = {
    sanitizeText: (value, max) => String(value === null || value === undefined ? '' : value).slice(0, max || 10000),
    console
  };
  vm.createContext(integrationSandbox);
  vm.runInContext(integration, integrationSandbox, { filename: 'Module_Integration.semantic.gs' });
  if (integrationSandbox.intNormalizeTarget_('Access Requests') !== 'access' ||
      integrationSandbox.intNormalizeTarget_('globalThis.evil')) {
    errors.push('Integration semantic test: target allowlist ไม่ถูกต้อง');
  }
  let unsafePathRejected = false;
  try { integrationSandbox.intResolveMapValue_('$request.constructor', { details: {} }); }
  catch (err) { unsafePathRejected = true; }
  if (!unsafePathRejected) errors.push('Integration semantic test: unsafe mapping path ผ่าน validation');
  let legacyReverseConflictRejected = false;
  try {
    integrationSandbox.intReverseProvenanceState_({
      SourceServiceRequestID: '', Notes: 'SourceServiceRequestID=REQ-A\nIntegrationID=INT-1'
    }, 'REQ-B');
  } catch (err) { legacyReverseConflictRejected = true; }
  if (!legacyReverseConflictRejected) {
    errors.push('Integration semantic test: legacy reverse provenance ของ request อื่นถูกยึดทับได้');
  }
  const matchingReverse = integrationSandbox.intReverseProvenanceState_({
    SourceServiceRequestID: 'REQ-A', Notes: 'SourceServiceRequestID=REQ-A'
  }, 'REQ-A');
  if (matchingReverse.needsRepair) {
    errors.push('Integration semantic test: exact reverse provenance ถูกระบุว่าต้อง repair');
  }

  const workflowSandbox = {
    sanitizeText: (value, max) => String(value === null || value === undefined ? '' : value).slice(0, max || 10000),
    console
  };
  vm.createContext(workflowSandbox);
  vm.runInContext(workflow, workflowSandbox, { filename: 'Module_Workflow.semantic.gs' });
  let unsafeWorkflowJsonRejected = false;
  try { workflowSandbox.wfNormalizeJsonObject_('{"__proto__":{"x":1}}', 'context', {}); }
  catch (err) { unsafeWorkflowJsonRejected = true; }
  if (!unsafeWorkflowJsonRejected) errors.push('Workflow semantic test: unsafe context JSON ผ่าน validation');
  const stepRows = [
    { StepID:'LEGACY', DefinitionID:'DEF-1', DefinitionVersion:'', Status:'ใช้งาน' },
    { StepID:'V2', DefinitionID:'DEF-1', DefinitionVersion:2, Status:'ใช้งาน' },
    { StepID:'V3', DefinitionID:'DEF-1', DefinitionVersion:3, Status:'ใช้งาน' }
  ];
  const exactGeneration = workflowSandbox.wfSelectCommittedDefinitionSteps_(stepRows,
    { DefinitionID:'DEF-1', Version:2 });
  const legacyFallback = workflowSandbox.wfSelectCommittedDefinitionSteps_(
    stepRows.filter((row) => row.StepID !== 'V2'), { DefinitionID:'DEF-1', Version:2 });
  if (exactGeneration.length !== 1 || exactGeneration[0].StepID !== 'V2' ||
      legacyFallback.length !== 1 || legacyFallback[0].StepID !== 'LEGACY') {
    errors.push('Workflow semantic test: exact generation/legacy fallback selection ไม่ fail-safe');
  }
} catch (err) {
  errors.push(`ตรวจ Workflow/Integration v1.11 ไม่สำเร็จ: ${err.message}`);
}

// Semantic regression test ของ response helper โดยไม่เรียก Google services
try {
  const responseSandbox = { Date };
  vm.createContext(responseSandbox);
  vm.runInContext(utilsSource, responseSandbox, { filename: 'Utils.response-test.gs' });
  const successResponse = responseSandbox.ok({ id: 'T-1' });
  const sessionResponse = responseSandbox.fail('SESSION_REQUIRED');
  if (!successResponse.success || successResponse.ok !== true || successResponse.data.id !== 'T-1' ||
      successResponse.errorCode !== null || !/^\d{4}-\d{2}-\d{2}T/.test(successResponse.timestamp)) {
    errors.push('ok() ไม่ผ่าน semantic response contract test');
  }
  if (sessionResponse.success !== false || sessionResponse.ok !== false || sessionResponse.data !== null ||
      sessionResponse.errorCode !== 'SESSION_REQUIRED' || sessionResponse.error !== 'SESSION_REQUIRED') {
    errors.push('fail() ไม่ผ่าน semantic response contract/error-code test');
  }
} catch (err) {
  errors.push(`ทดสอบ response helper ไม่สำเร็จ: ${err.message}`);
}

// ตรวจ client -> server wiring ของหลังบ้าน
htmlFiles.forEach((name) => {
  const source = read(name);

  // ทุก google.script.run ต้องประกาศ handler สำเร็จ/ล้มเหลวก่อนเรียก server จริง
  let runIndex = source.indexOf('google.script.run');
  while (runIndex !== -1) {
    const chain = source.slice(runIndex, runIndex + 1400);
    const nextRun = chain.indexOf('google.script.run', 1);
    const scopedChain = nextRun > -1 ? chain.slice(0, nextRun) : chain;
    if (scopedChain.indexOf('.withSuccessHandler(') === -1 || scopedChain.indexOf('.withFailureHandler(') === -1) {
      const line = source.slice(0, runIndex).split(/\r?\n/).length;
      errors.push(`${name}:${line}: google.script.run ต้องมี success และ failure handler`);
    }
    runIndex = source.indexOf('google.script.run', runIndex + 1);
  }

  const callRe = /\bcallServer(?:Quiet)?\s*\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  let match;
  while ((match = callRe.exec(source))) {
    const fn = match[1];
    if (!serverFunctions.has(fn)) errors.push(`${name}: เรียก server function ที่ไม่มี "${fn}"`);
    if (!allowed.has(fn)) errors.push(`${name}: "${fn}" ไม่อยู่ใน API_ALLOWED`);
  }

  // หน้า public ใช้ run() เรียกตรงโดยไม่ผ่าน API_ALLOWED แต่ function ต้องมีจริง
  const publicRe = /\brun\s*\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  while ((match = publicRe.exec(source))) {
    if (!serverFunctions.has(match[1])) errors.push(`${name}: เรียก public server function ที่ไม่มี "${match[1]}"`);
  }
});

// ตรวจ HTML partial ที่ include จาก server template
gsFiles.forEach((name) => {
  const source = read(name);
  const includeRe = /\binclude(?:Optional)?_\s*\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
  let match;
  while ((match = includeRe.exec(source))) {
    const target = `${match[1]}.html`;
    if (!htmlFiles.includes(target)) errors.push(`${name}: ไม่พบ HTML partial "${target}"`);
  }
});

if (!gsFiles.length) errors.push('ไม่พบไฟล์ .gs');
if (!htmlFiles.length) warnings.push('ไม่พบไฟล์ .html');

if (warnings.length) {
  console.warn('Warnings:');
  warnings.forEach((message) => console.warn(`- ${message}`));
}

if (errors.length) {
  console.error(`Validation FAILED (${errors.length} จุด):`);
  errors.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(
  `Validation PASSED: ${gsFiles.length} GS, ${htmlFiles.length} HTML, ` +
  `${serverFunctions.size} server functions, ${allowed.size} API allowlist entries`
);
