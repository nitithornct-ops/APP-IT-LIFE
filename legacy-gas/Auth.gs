/**
 * Auth.gs
 * การยืนยันตัวตนแบบ "ล็อกอินในระบบ" (in-app login) เพื่อรองรับ Web App แบบ
 * เข้าถึงได้โดยไม่ต้องล็อกอิน Google (ANYONE_ANONYMOUS) — หน้าแจ้งซ่อมสาธารณะจึงไม่ต้องล็อกอิน
 *
 * หลักการ:
 *  - ฝั่งหลังบ้าน (เจ้าหน้าที่) ล็อกอินด้วย Username + รหัสผ่าน (Email ใช้รับ MFA)
 *  - ได้ session token เก็บใน CacheService ฝั่ง server (อายุ 6 ชม. ต่ออายุเมื่อใช้งาน)
 *  - client เก็บ token แล้วส่งกลับมาทุกครั้งผ่านฟังก์ชันกลาง api(token, fnName, args)
 *  - api() ตรวจ token แล้วตั้งผู้ใช้ปัจจุบัน (__CURRENT_USER) ก่อนเรียกฟังก์ชันเป้าหมาย
 *  - ทุกฟังก์ชันยังตรวจสิทธิ์ผ่าน requireModule/requireRole เหมือนเดิม (ตรวจที่ Server เสมอ)
 */

// ผู้ใช้ปัจจุบันต่อ 1 การเรียก (api() ตั้งค่าให้, รีเซ็ตทุก execution)
var __CURRENT_USER = null;

const SESSION_TTL_SEC = 3600; // idle timeout 1 ชั่วโมง
const SESSION_ABSOLUTE_TTL_SEC = 21600; // อายุสูงสุด 6 ชั่วโมง แม้มีการใช้งานต่อเนื่อง
const LOGIN_THROTTLE_TTL_SEC = 300; // 5 นาที ลดผลกระทบจากการจงใจล็อกบัญชี
const ADMIN_MFA_TTL_SEC = 600; // OTP 10 นาที
const PASSWORD_HASH_ITERATIONS_MIN_ = 10000;
const PASSWORD_HASH_ITERATIONS_MAX_ = 100000;

// ฟังก์ชันหลังบ้านที่อนุญาตให้ client เรียกผ่าน api() เท่านั้น
// Public helpdesk functions เรียกตรงจาก PublicTicket.html และไม่อยู่ในรายการนี้
const API_ALLOWED = {
  getSessionInfo: 1, getAppVersion: 1, getAppBuildInfo: 1,
  uploadEvidence: 1, changeMyPassword: 1, setUserPassword: 1,

  // ลบแบบกู้คืนได้ (soft-delete) + ถังขยะ + โลโก้องค์กร
  softDeleteRecord: 1, restoreRecord: 1, listDeletedRecords: 1,
  uploadOrgLogo: 1, removeOrgLogo: 1,

  getDashboardData: 1, getMyNotifications: 1,

  getTaskModuleData: 1, addTask: 1, updateTask: 1, setTaskStatus: 1, setTaskDueDate: 1,
  setTaskBoardState: 1, addTaskSubtask: 1, setTaskSubtaskStatus: 1, cancelTaskSubtask: 1,
  restoreTask: 1, addTaskProgressLog: 1, addTaskLink: 1, addTaskAttachment: 1, addTaskReminder: 1,
  getCalendarData: 1, getCalendarMeta: 1,

  getTicketModuleData: 1, getTicketAdminBootstrapV2: 1,
  submitTicket: 1, acknowledgeTicket: 1, triageTicket: 1,
  updateTicketWork: 1, forwardTicketToOutsource: 1, closeTicket: 1, cancelTicket: 1,
  escalateTicketToIncident: 1, reopenTicket: 1,
  getTicketAnalytics: 1,
  getTicketCategoriesAdmin: 1, saveTicketCategory: 1, setTicketCategoryStatus: 1,

  getServiceCatalogModuleData: 1, saveServiceCatalogItem: 1, setServiceCatalogStatus: 1,
  submitServiceRequest: 1, approveServiceRequest: 1, assignServiceRequest: 1,
  updateServiceRequestStatus: 1, updateServiceRequestTask: 1,
  confirmServiceRequest: 1, cancelServiceRequest: 1,

  // Workflow / Approval Engine, action permissions, attachment registry และ integration outbox
  getWorkflowModuleData: 1, getWorkflowInstanceDetail: 1,
  saveWorkflowDefinition: 1, setWorkflowDefinitionStatus: 1,
  decideWorkflowApproval: 1, delegateWorkflowApproval: 1,
  createWorkflowDelegation: 1, revokeWorkflowDelegation: 1,
  cancelWorkflowInstance: 1, runWorkflowAutomationNow: 1, backfillWorkflowTransactions: 1,
  getActionPermissionAdminData: 1, saveRoleActionPermission: 1,
  saveUserPermissionOverride: 1, saveApprovalGroup: 1,
  saveApprovalGroupMember: 1, setApprovalGroupMemberStatus: 1,
  uploadRegisteredAttachment: 1, listRecordAttachments: 1,
  downloadRegisteredAttachment: 1, softDeleteRegisteredAttachment: 1,
  restoreRegisteredAttachment: 1, setAttachmentLegalHold: 1,
  releaseAttachmentLegalHold: 1, downloadIncidentLegacyTicketEvidence: 1,
  processIntegrationOutboxNow: 1, retryServiceRequestIntegration: 1,
  getServiceRequestIntegrations: 1,

  getKBModuleData: 1, addArticle: 1, updateArticle: 1, setArticleStatus: 1, kbView: 1, kbHelpful: 1,

  getAccessModuleData: 1, submitAccessRequest: 1, approveAccessRequest: 1,
  itProcessAccessRequest: 1, reviewAccessEntry: 1, revokeAccessEntry: 1, deactivateEmployee: 1,

  getIncidentModuleData: 1, reportIncident: 1, updateIncident: 1, closeIncident: 1, markDPONotified: 1,
  assessIncidentRegulatory: 1, saveIncidentRegulatoryNotification: 1,

  getRiskModuleData: 1, addRisk: 1, updateRisk: 1, reviewRisk: 1, setRiskStatus: 1,
  getComplianceModuleData: 1, saveLegalRecord: 1, saveComplianceObligation: 1,
  recordComplianceAssessment: 1, saveCorrectiveAction: 1,

  getBackupModuleData: 1, addBackupLog: 1, updateBackupLog: 1,
  addRecoveryTest: 1, updateRecoveryTest: 1, addBCPPlan: 1, updateBCPPlan: 1,
  recordBCPInvocation: 1, reviewBCPPlan: 1, createSystemSnapshot: 1,
  verifySystemSnapshot: 1, restoreSnapshotToSandbox: 1,

  getLoggingModuleData: 1, addLogSystem: 1, addLogReview: 1,

  getAssetModuleData: 1, addAsset: 1, updateAsset: 1, setAssetStatus: 1,
  retireAsset: 1, updateAssetPatch: 1, generateAssetQR: 1, getAssetDetail: 1,
  assignAsset: 1, returnAsset: 1, transferAsset: 1,
  sendAssetToRepair: 1, returnAssetFromRepair: 1, getBorrowAnalytics: 1,
  getAssetAnalytics: 1, verifyAsset: 1,
  getAssetCategoriesAdmin: 1, saveAssetCategory: 1, setAssetCategoryStatus: 1,

  getCmdbModuleData: 1, saveConfigurationItem: 1, updateConfigurationItemStatus: 1,
  verifyConfigurationItem: 1, saveCIRelationship: 1,
  updateCIRelationshipStatus: 1, verifyCIRelationship: 1,

  getEmployeeModuleData: 1, saveEmployee: 1, setEmployeeStatus: 1,
  saveEmployeeAssignment: 1, setEmployeeAssignmentStatus: 1,
  startEmployeeLifecycle: 1, completeEmployeeLifecycle: 1,

  getBorrowModuleData: 1, getMaintenanceModuleData: 1, addMaintenancePlan: 1,
  updateMaintenancePlanResult: 1, cancelMaintenancePlan: 1,
  startMaintenance: 1, rescheduleMaintenance: 1, getPMAnalytics: 1,
  getPMTemplatesAdmin: 1, savePMTemplate: 1, setPMTemplateStatus: 1,
  getInventoryModuleData: 1, addInventoryItem: 1, updateInventoryItem: 1,
  setInventoryItemStatus: 1, recordInventoryTransaction: 1,
  adjustInventoryStock: 1, getInventoryLedger: 1, getInventoryAnalytics: 1,
  getLicenseModuleData: 1, addSoftwareLicense: 1, updateLicense: 1,
  setLicenseStatus: 1, runLicenseExpiryCheck: 1,
  getReportsModuleData: 1, getPdfDesignerData: 1, savePdfDesignTemplate: 1,
  previewPdfReport: 1, generateDesignedPdf: 1,
  generateCanvasPdf: 1, getUniversalReportSources: 1,
  getUniversalReportSample: 1, listCanvasTemplates: 1, saveCanvasTemplate: 1, deleteCanvasTemplate: 1,
  listGovernanceDocuments: 1, registerGovernanceDocument: 1,
  getUsersModuleData: 1, addSystemUser: 1,
  setSystemUserStatus: 1, updateSystemUserEmployeeCode: 1, setLineUserStatus: 1,
  getSettingsModuleData: 1, saveSystemSetting: 1,
  saveModuleFieldDefinition: 1, deleteModuleField: 1,
  getTesterModuleData: 1, addQaCase: 1, updateQaCaseResult: 1,

  getDataClassModuleData: 1, addDataset: 1, requestDestruction: 1,
  approveDestruction: 1, confirmDestroyed: 1,
  getPrivacyModuleData: 1, saveRopaRecord: 1, recordPrivacyConsent: 1,
  submitDataSubjectRequest: 1, updateDataSubjectRequest: 1,
  getProblemModuleData: 1, saveProblemRecord: 1, saveKnownErrorRecord: 1,
  getVulnerabilityModuleData: 1, saveVulnerabilityFinding: 1, updateVulnerabilityStatus: 1,
  getAuditModuleData: 1, saveAuditEngagement: 1, saveAuditFinding: 1, updateAuditFindingStatus: 1,

  getChangeModuleData: 1, submitChange: 1, signOffTest: 1, approveChange: 1, deployChange: 1,

  getVendorModuleData: 1, addVendor: 1, updateVendor: 1, setVendorStatus: 1, assessVendor: 1,
  getAIModuleData: 1, addAITool: 1, setAIStatus: 1,
  getCloudModuleData: 1, addCloudService: 1, setCloudStatus: 1,
  getAwarenessModuleData: 1, acknowledgePolicy: 1, addTrainingPlan: 1,
  completeTrainingPlan: 1, addTrainingRecord: 1,
  saveTrainingQuiz: 1, getTrainingQuiz: 1, submitTrainingQuiz: 1,

  getEvidenceData: 1, exportComplianceReportPdf: 1, exportSheetCsv: 1,
  getAuditTrail: 1,
  getNotificationSettings: 1, saveNotificationSettings: 1, runNotificationCheckNow: 1,
  testNotification: 1, testLineNotification: 1,
  processNotificationQueueNow: 1,
  getRetentionStatus: 1, runRetentionNow: 1,
  runLiveHealthCheckNow: 1,
  sendExecutiveReportNow: 1
};

// ===================================================================
// ฟังก์ชันกลางที่ client เรียกทุกครั้ง (ผ่าน callServer)
// ===================================================================
function api(token, fnName, args) {
  __CURRENT_USER = validateSession_(token);
  if (typeof fnName !== 'string' || !fnName) return fail('คำสั่งไม่ถูกต้อง');
  if (fnName.charAt(fnName.length - 1) === '_') return fail('ไม่อนุญาตให้เรียกฟังก์ชันภายใน');
  if (!API_ALLOWED[fnName]) return fail('ไม่อนุญาตให้เรียกฟังก์ชันนี้');
  const fn = globalThis[fnName];
  if (typeof fn !== 'function') return fail('ไม่พบฟังก์ชัน: ' + fnName);
  return fn.apply(null, Array.isArray(args) ? args : []);
}

// ===================================================================
// Login / Logout / Session
// ===================================================================
function adminLogin(username, password) {
  try {
    username = normalizeUsername_(username);
    if (isLoginThrottled_(username)) return fail('เข้าสู่ระบบผิดพลาดหลายครั้ง กรุณารอประมาณ 5 นาทีแล้วลองใหม่');
    const u = findRow_(SHEETS.USERS, 'Username', username);
    if (!u || String(u.Status).toLowerCase() !== 'active') {
      recordLoginFailure_(username);
      return fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (!u.PasswordHash) {
      recordLoginFailure_(username);
      return fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (!verifyPassword_(password, u.PasswordSalt, u.PasswordHash)) {
      recordLoginFailure_(username);
      writeAudit_({ email: u.Email || username }, 'LOGIN_FAIL', 'auth', '', '', 'รหัสผ่านไม่ถูกต้อง', 'denied');
      return fail('Username หรือรหัสผ่านไม่ถูกต้อง');
    }
    const email = String(u.Email || '').toLowerCase().trim();
    const user = userObj_(u, email);
    if (passwordHashNeedsUpgrade_(u.PasswordHash)) {
      const salt = genSalt_();
      const upgradedHash = hashPassword_(password, salt);
      updateRow_(SHEETS.USERS, u._row, { PasswordSalt: salt, PasswordHash: upgradedHash }, email);
      // Keep the in-memory row aligned for a no-MFA session issued below.
      u.PasswordSalt = salt;
      u.PasswordHash = upgradedHash;
    }
    clearLoginFailures_(username);

    if (getConfig_('ADMIN_MFA_ENABLED', 'true') === 'true') {
      const challenge = genToken_();
      const otp = generateAdminMfaOtp_();
      CacheService.getScriptCache().put('admin_mfa_' + challenge, JSON.stringify({
        email: email,
        otpHash: adminMfaHash_(challenge, otp),
        credentialVersion: authCredentialVersion_(u)
      }), ADMIN_MFA_TTL_SEC);
      sendAdminMfaOtp_(email, otp);
      writeAudit_(user, 'LOGIN_MFA_REQUIRED', 'auth', '', '', 'รอ OTP ยืนยันตัวตน', 'success');
      return ok({
        mfaRequired: true,
        challenge: challenge,
        emailMasked: maskEmail_(email),
        expiresMinutes: Math.round(ADMIN_MFA_TTL_SEC / 60)
      });
    }
    return createAdminSession_(u, email, false);
  } catch (e) {
    return fail(e.message);
  }
}

/** ขั้นที่ 2 ของการเข้าสู่ระบบหลังบ้าน: ยืนยัน OTP แล้วจึงออก Session token */
function adminVerifyMfa(challenge, otp) {
  try {
    challenge = sanitizeText(challenge, 200);
    otp = sanitizeText(otp, 12);
    if (!challenge || !/^\d{6}$/.test(otp)) throw new Error('รหัส OTP ไม่ถูกต้อง');
    const cache = CacheService.getScriptCache();
    const attemptKey = 'admin_mfa_attempt_' + authShortHash_(challenge);
    const attempts = parseInt(cache.get(attemptKey) || '0', 10);
    if (attempts >= 5) {
      cache.remove('admin_mfa_' + challenge);
      throw new Error('ยืนยัน OTP ผิดเกินจำนวนที่กำหนด กรุณาเข้าสู่ระบบใหม่');
    }
    cache.put(attemptKey, String(attempts + 1), ADMIN_MFA_TTL_SEC);

    const raw = cache.get('admin_mfa_' + challenge);
    if (!raw) throw new Error('OTP หมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่');
    const pending = JSON.parse(raw);
    if (!pending.otpHash || pending.otpHash !== adminMfaHash_(challenge, otp)) {
      writeAudit_({ email: pending.email || '' }, 'LOGIN_MFA_FAIL', 'auth', '', '', 'OTP ไม่ถูกต้อง', 'denied');
      throw new Error('รหัส OTP ไม่ถูกต้อง');
    }
    const u = findRow_(SHEETS.USERS, 'Email', String(pending.email).toLowerCase());
    if (!u || String(u.Status).toLowerCase() !== 'active') throw new Error('บัญชีถูกระงับหรือไม่พบในระบบ');
    if (!pending.credentialVersion || pending.credentialVersion !== authCredentialVersion_(u)) {
      cache.remove('admin_mfa_' + challenge);
      throw new Error('ข้อมูลรับรองบัญชีมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    cache.remove('admin_mfa_' + challenge);
    cache.remove(attemptKey);
    return createAdminSession_(u, String(pending.email).toLowerCase(), true);
  } catch (e) {
    return fail(e.message);
  }
}

function createAdminSession_(u, email, mfaVerified) {
  const token = genToken_();
  const now = Date.now();
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({
    email: email,
    issuedAt: now,
    absoluteExpiresAt: now + (SESSION_ABSOLUTE_TTL_SEC * 1000),
    credentialVersion: authCredentialVersion_(u)
  }), SESSION_TTL_SEC);
  const user = userObj_(u, email);
  writeAudit_(user, 'LOGIN', 'auth', '', '',
    mfaVerified ? 'เข้าสู่ระบบหลังบ้านผ่าน MFA' : 'เข้าสู่ระบบหลังบ้าน', 'success');
  return ok({
    token: token, email: user.email, name: user.name, role: user.role,
    roleLabel: user.roleLabel, dept: user.dept, modules: getAccessibleModules(user.role)
  });
}

function generateAdminMfaOtp_() {
  const hex = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
  return String(parseInt(hex, 16) % 1000000).padStart(6, '0');
}

function getAdminMfaPepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty('ADMIN_MFA_PEPPER');
  if (!pepper) {
    pepper = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('ADMIN_MFA_PEPPER', pepper);
  }
  return pepper;
}

function adminMfaHash_(challenge, otp) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(
    String(challenge) + ':' + String(otp), getAdminMfaPepper_(), Utilities.Charset.UTF_8));
}

function authShortHash_(value) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8)).substring(0, 32);
}

function sendAdminMfaOtp_(email, otp) {
  let result = 'success', err = '';
  const subject = 'รหัส OTP เข้าสู่ระบบหลังบ้าน';
  try {
    MailApp.sendEmail({
      to: email,
      subject: '[' + getConfig_('ORG_NAME', 'ISMS') + '] ' + subject,
      htmlBody: '<p>มีการเข้าสู่ระบบหลังบ้านด้วยบัญชีของท่าน</p>' +
        '<p>รหัส OTP คือ</p><p style="font-size:28px;font-weight:700;letter-spacing:5px">' +
        escapeHtml(otp) + '</p><p>รหัสมีอายุ ' + Math.round(ADMIN_MFA_TTL_SEC / 60) +
        ' นาที หากท่านไม่ได้ดำเนินการ กรุณาแจ้งผู้ดูแลระบบ</p>',
      name: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต') + ' - ISMS Security'
    });
  } catch (e) {
    result = 'fail';
    err = e.message;
  }
  logNotification_('Email-MFA', email, subject, 'auth', '', result, err);
  if (result !== 'success') throw new Error('ส่ง OTP ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ: ' + err);
}

function maskEmail_(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return '***';
  const local = parts[0];
  return (local.length <= 2 ? local.charAt(0) + '*' : local.substring(0, 2) + '***') + '@' + parts[1];
}

/** ออกจากระบบ — client เรียกตรง (ส่ง token) */
function adminLogout(token) {
  const cache = CacheService.getScriptCache();
  const tokenText = String(token || '').trim();
  const sessionKey = tokenText ? 'sess_' + tokenText : '';
  let raw = '';
  let actor = { email: '', name: '', role: '' };
  let lookupError = '';

  // Read the cache payload only. Do not touch Sheets until after invalidation;
  // a slow or damaged Users sheet must never keep a bearer token alive.
  if (sessionKey) {
    try {
      raw = cache.get(sessionKey) || '';
    } catch (e) {
      lookupError = sanitizeText(e && e.message || e, 300);
      console.error('adminLogout session lookup: ' + lookupError);
    }
  }

  try {
    if (sessionKey) cache.remove(sessionKey);
  } catch (e) {
    return fail('ไม่สามารถยกเลิก Session ได้ กรุณาลองใหม่', 'LOGOUT_INVALIDATION_FAILED');
  }

  // Invalid/expired tokens are idempotent no-ops. Do not let an anonymous
  // caller fill AuditTrail by submitting arbitrary token strings.
  if (!raw) return ok('ออกจากระบบแล้ว');

  try {
    try { actor = authLogoutActor_(raw); }
    catch (identityError) {
      lookupError = sanitizeText(identityError && identityError.message || identityError, 300);
      console.error('adminLogout actor lookup after invalidation: ' + lookupError);
    }
    const detail = 'session invalidated; sessionRef=' + authShortHash_(tokenText).substring(0, 16) +
      (lookupError ? '; identityLookup=' + lookupError : '');
    authAppendAuditDurable_(actor, 'LOGOUT', detail, 'success');
    return ok('ออกจากระบบแล้ว');
  } catch (e) {
    console.error('adminLogout audit after invalidation: ' + (e && e.message ? e.message : String(e)));
    return fail('Session ถูกยกเลิกแล้ว แต่บันทึก Audit Log ไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ',
      'LOGOUT_AUDIT_FAILED');
  }
}

/** Resolve the actor stored in a session without validating or extending it. */
function authLogoutActor_(rawSession) {
  let session = {};
  try { session = JSON.parse(rawSession); }
  catch (e) { session = { email: String(rawSession || '') }; }
  const email = String(session.email || '').toLowerCase().trim();
  let row = null;
  if (email) {
    row = readSheetObjects_(SHEETS.USERS, true).filter(function (item) {
      return String(item.Email || '').toLowerCase().trim() === email;
    })[0] || null;
  }
  return {
    email: email,
    name: row && (row.FullName || row.Email) || email,
    role: row && row.Role || ''
  };
}

/**
 * Append and verify a critical auth audit entry using the sheet's actual
 * header order. Unlike writeAudit_(), failures are returned to the caller.
 */
function authAppendAuditDurable_(actor, action, detail, result) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getDB_().getSheetByName(SHEETS.AUDIT_TRAIL);
    if (!sh) throw new Error('AuditTrail sheet is missing');
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const required = ['LogID', 'Timestamp', 'ActorEmail', 'ActorRole', 'Action', 'Module',
      'TargetSheet', 'TargetID', 'Detail', 'IPHint', 'Result'];
    const missing = required.filter(function (header) { return headers.indexOf(header) === -1; });
    if (missing.length) throw new Error('AuditTrail headers missing: ' + missing.join(','));

    const logId = generateId('LOG');
    const data = {
      LogID: logId,
      Timestamp: new Date(),
      ActorEmail: actor && actor.email || '',
      ActorRole: actor && actor.role || '',
      Action: action || '',
      Module: 'auth',
      TargetSheet: '',
      TargetID: '',
      Detail: detail || '',
      IPHint: '',
      Result: result || 'success'
    };
    const rowNumber = Math.max(2, sh.getLastRow() + 1);
    sh.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (header) {
      return sheetSafeValue_(Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '');
    })]);
    SpreadsheetApp.flush();

    const written = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const check = {};
    headers.forEach(function (header, index) { check[header] = written[index]; });
    if (String(check.LogID || '') !== logId || String(check.Action || '') !== String(action || '') ||
        String(check.ActorEmail || '').toLowerCase().trim() !== String(data.ActorEmail || '').toLowerCase().trim() ||
        String(check.Result || '') !== String(data.Result || '')) {
      throw new Error('AuditTrail verification failed');
    }
    return logId;
  } finally {
    lock.releaseLock();
  }
}

function validateSession_(token) {
  if (!token) return null;
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('sess_' + token);
    if (!raw) return null;
    let session;
    try { session = JSON.parse(raw); }
    catch (e) { session = { email: raw, issuedAt: Date.now(), absoluteExpiresAt: Date.now() + (SESSION_TTL_SEC * 1000) }; }
    const email = String(session.email || '').toLowerCase();
    if (!email || !session.absoluteExpiresAt || Date.now() >= Number(session.absoluteExpiresAt)) {
      cache.remove('sess_' + token);
      return null;
    }
    const u = findRow_(SHEETS.USERS, 'Email', email);
    if (!u || String(u.Status).toLowerCase() !== 'active' ||
        !session.credentialVersion || session.credentialVersion !== authCredentialVersion_(u)) {
      cache.remove('sess_' + token);
      return null;
    }
    const remainingSec = Math.max(1, Math.floor((Number(session.absoluteExpiresAt) - Date.now()) / 1000));
    cache.put('sess_' + token, JSON.stringify(session), Math.min(SESSION_TTL_SEC, remainingSec));
    return userObj_(u, email);
  } catch (e) {
    return null;
  }
}

function userObj_(u, email) {
  return {
    email: email,
    name: u.FullName || email,
    dept: u.Department || '',
    role: u.Role || ROLES.USER,
    roleLabel: ROLE_LABELS[u.Role] || u.Role,
    supervisor: u.Supervisor || '',
    active: true
  };
}

// ===================================================================
// รหัสผ่าน: hash + จัดการ
// ===================================================================
function hashPassword_(password, salt) {
  const iterations = getPasswordHashIterations_();
  let material = String(salt || '') + '::' + String(password || '');
  for (let i = 0; i < iterations; i++) {
    material = bytesToHex_(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8));
  }
  return 'v2$sha256$' + iterations + '$' + material;
}

function legacyHashPassword_(password, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(salt || '') + '::' + String(password || ''), Utilities.Charset.UTF_8);
  return bytesToHex_(raw);
}

function verifyPassword_(password, salt, storedHash) {
  const stored = String(storedHash || '');
  if (stored.indexOf('v2$sha256$') === 0) {
    const parts = stored.split('$');
    const iterations = parseInt(parts[2], 10);
    if (!iterations || iterations < PASSWORD_HASH_ITERATIONS_MIN_ ||
        iterations > PASSWORD_HASH_ITERATIONS_MAX_ || !parts[3] || !/^[a-f0-9]{64}$/i.test(parts[3])) {
      return false;
    }
    let material = String(salt || '') + '::' + String(password || '');
    for (let i = 0; i < iterations; i++) {
      material = bytesToHex_(Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8));
    }
    return material === parts[3];
  }
  return legacyHashPassword_(password, salt) === stored;
}

function passwordHashNeedsUpgrade_(storedHash) {
  const stored = String(storedHash || '');
  if (stored.indexOf('v2$sha256$') !== 0) return true;
  const parts = stored.split('$');
  const iterations = parseInt(parts[2], 10) || 0;
  return iterations < getPasswordHashIterations_();
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function getPasswordHashIterations_() {
  const n = parseInt(getConfig_('PASSWORD_HASH_ITERATIONS', '20000'), 10);
  return (!isNaN(n) && n >= PASSWORD_HASH_ITERATIONS_MIN_ &&
    n <= PASSWORD_HASH_ITERATIONS_MAX_) ? n : 20000;
}
function authCredentialVersion_(userRow) {
  const material = String(userRow && userRow.PasswordSalt || '') + '::' +
    String(userRow && userRow.PasswordHash || '');
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8));
}
function genSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function genToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function loginThrottleKey_(email) {
  const id = email || 'unknown';
  return 'login_fail_' + bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, id, Utilities.Charset.UTF_8)).substring(0, 32);
}

function getLoginMaxFailures_() {
  const n = parseInt(getConfig_('LOGIN_MAX_FAILS_5MIN', '10'), 10);
  return (!isNaN(n) && n >= 5 && n <= 30) ? n : 10;
}

function isLoginThrottled_(email) {
  const count = parseInt(CacheService.getScriptCache().get(loginThrottleKey_(email)) || '0', 10);
  return count >= getLoginMaxFailures_();
}

function recordLoginFailure_(email) {
  const cache = CacheService.getScriptCache();
  const key = loginThrottleKey_(email);
  const count = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(count), LOGIN_THROTTLE_TTL_SEC);
}

function validateNewPassword_(password, username) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร');
  if (value.length > 128) throw new Error('รหัสผ่านยาวเกิน 128 ตัวอักษร');
  const normalized = value.toLowerCase();
  const userPart = String(username || '').toLowerCase().trim();
  const common = ['password', 'password123', '123456789012', 'qwerty123456', 'admin123456', 'letmein123456'];
  if (common.indexOf(normalized) > -1 || (userPart.length >= 4 && normalized.indexOf(userPart) > -1)) {
    throw new Error('รหัสผ่านคาดเดาง่ายเกินไป กรุณาใช้ข้อความรหัสผ่านที่ยาวและไม่เกี่ยวกับชื่อผู้ใช้');
  }
  return value;
}

function clearLoginFailures_(email) {
  CacheService.getScriptCache().remove(loginThrottleKey_(email));
}

/** เปลี่ยนรหัสผ่านของตนเอง (ต้องล็อกอินอยู่) */
function changeMyPassword(oldPassword, newPassword) {
  try {
    const user = getCurrentUser();
    const u = findRow_(SHEETS.USERS, 'Email', user.email);
    if (!u) throw new Error('ไม่พบบัญชี');
    if (u.PasswordHash && !verifyPassword_(oldPassword, u.PasswordSalt, u.PasswordHash))
      throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    newPassword = validateNewPassword_(newPassword, u.Username || user.email);
    const salt = genSalt_();
    updateRow_(SHEETS.USERS, u._row, { PasswordSalt: salt, PasswordHash: hashPassword_(newPassword, salt) }, user.email);
    writeAudit_(user, 'CHANGE_PASSWORD', 'auth', SHEETS.USERS, user.email, '', 'success');
    return ok('เปลี่ยนรหัสผ่านเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** ผู้ดูแล (IT Admin) ตั้ง/รีเซ็ตรหัสผ่านให้ผู้ใช้อื่น */
function setUserPassword(targetUsername, newPassword) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    targetUsername = normalizeUsername_(targetUsername);
    const u = findRow_(SHEETS.USERS, 'Username', targetUsername);
    if (!u) throw new Error('ไม่พบบัญชีปลายทาง');
    newPassword = validateNewPassword_(newPassword, targetUsername);
    const salt = genSalt_();
    updateRow_(SHEETS.USERS, u._row, { PasswordSalt: salt, PasswordHash: hashPassword_(newPassword, salt) }, user.email);
    writeAudit_(user, 'SET_PASSWORD', 'auth', SHEETS.USERS, targetUsername, '', 'success');
    return ok('ตั้งรหัสผ่านให้ ' + targetUsername + ' เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// ผู้ใช้ปัจจุบัน + การ์ดตรวจสิทธิ์ (เหมือนเดิม แต่ใช้ session token)
// ===================================================================
function getCurrentUser() {
  if (__CURRENT_USER) return __CURRENT_USER;
  throw new Error('SESSION_REQUIRED'); // client จะดักเพื่อแสดงหน้าเข้าสู่ระบบ
}

function getAccessibleModules(role) {
  const list = [];
  Object.keys(MODULE_ACCESS).forEach(function (key) {
    const m = MODULE_ACCESS[key];
    const canEdit = (m.roles || []).indexOf(role) > -1;
    const canRead = canEdit || (m.readOnlyRoles || []).indexOf(role) > -1;
    if (canRead) list.push({ key: key, label: m.label, group: m.group || 'อื่นๆ', readOnly: !canEdit });
  });
  return list;
}

function canAccessModule(role, moduleKey) {
  const m = MODULE_ACCESS[moduleKey];
  if (!m) return false;
  return (m.roles || []).indexOf(role) > -1 || (m.readOnlyRoles || []).indexOf(role) > -1;
}

function canEditModule(role, moduleKey) {
  const m = MODULE_ACCESS[moduleKey];
  if (!m) return false;
  return (m.roles || []).indexOf(role) > -1;
}

function requireModule(moduleKey, needEdit) {
  const user = getCurrentUser();
  const allowed = needEdit ? canEditModule(user.role, moduleKey) : canAccessModule(user.role, moduleKey);
  if (!allowed) {
    writeAudit_(user, (needEdit ? 'EDIT_DENIED' : 'ACCESS_DENIED'), moduleKey, '', '',
      'พยายามเข้าถึงโมดูลโดยไม่มีสิทธิ์', 'denied');
    throw new Error('ท่านไม่มีสิทธิ์ในการ' + (needEdit ? 'แก้ไข' : 'เข้าถึง') + 'โมดูลนี้');
  }
  return user;
}

function requireRole(allowedRoles) {
  const user = getCurrentUser();
  if (allowedRoles.indexOf(user.role) === -1) {
    writeAudit_(user, 'ROLE_DENIED', '', '', '', 'ต้องการบทบาท: ' + allowedRoles.join('/'), 'denied');
    throw new Error('การดำเนินการนี้สงวนสำหรับ: ' + allowedRoles.map(function (r) { return ROLE_LABELS[r] || r; }).join(', '));
  }
  return user;
}

/** client เรียกตอนโหลดหลังบ้านเพื่อตรวจ session + คืนโปรไฟล์/เมนู */
function getSessionInfo() {
  try {
    const user = getCurrentUser();
    return ok({
      email: user.email, name: user.name, dept: user.dept, role: user.role,
      roleLabel: user.roleLabel, modules: getAccessibleModules(user.role)
    });
  } catch (e) {
    return fail(e.message);
  }
}
