/**
 * Code.gs
 * จุดเข้าหลักของ Web App (doGet) + router + ฟังก์ชันกลางที่ client เรียกผ่าน google.script.run
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || '';
  const requestedMode = (e && e.parameter && e.parameter.mode) || '';

  // ----- Lightweight endpoint สำหรับ Live Health Check: ไม่ render หน้าใหญ่ ลด false alarm จาก route/template -----
  if (e && e.parameter && e.parameter.health === 'public') {
    return HtmlService.createHtmlOutput(
      'OK app_life_public_client_id build=' + getAppBuildId_() +
      ' ts=' + Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss")
    )
      .setTitle('App LIFE Health')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  // ----- ซิงก์ LINE_LOGIN_CALLBACK_URL ให้ตรงกับ Deployment ปัจจุบันอัตโนมัติ -----
  syncLineCallbackUrlToDeployment_();

  // ----- LINE Login callback: แลก authorization code และส่ง one-time handoff กลับหน้า PublicTicket -----
  if (page === 'line-callback') {
    let result;
    try {
      const params = (e && e.parameter) || {};
      if (!params.code || !params.state) {
        throw new Error('URL นี้เป็น LINE Login Callback สำหรับให้ LINE redirect กลับมาเท่านั้น กรุณาเปิดหน้าแจ้งซ่อม แล้วกดปุ่ม LINE Login เพื่อเริ่มเข้าสู่ระบบ');
      }
      result = completeLineLoginCallback_(params);
      result.ok = true;
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : String(err) };
    }
    result.returnUrl = getPublicBaseUrl_() +
      '?mode=' + encodeURIComponent(result.returnMode || 'report');
    const cb = HtmlService.createTemplateFromFile('LineCallback');
    cb.lineCallbackPayload = Utilities.base64Encode(
      JSON.stringify(result), Utilities.Charset.UTF_8);
    return cb.evaluate()
      .setTitle('LINE Login')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  // ----- หลังบ้าน (เจ้าหน้าที่/Admin): เสิร์ฟ shell แล้วให้ client จัดการเข้าสู่ระบบด้วย token -----
  if (page === 'admin' || page === 'app' || page === 'backend') {
    const t = HtmlService.createTemplateFromFile('Index');
    t.orgName = getConfig_('ORG_NAME', 'กองทุนประกันชีวิต');
    t.logoUrl = getConfig_('ORG_LOGO_URL', '');
    t.publicUrl = getPublicBaseUrl_();
    return t.evaluate()
      .setTitle('ระบบบริหารความมั่นคงปลอดภัยสารสนเทศและไซเบอร์')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  // ----- ค่าเริ่มต้น = หน้าแจ้งซ่อมสาธารณะ (ไม่ต้อง login) · status/track = ติดตามสถานะ -----
  const pub = HtmlService.createTemplateFromFile('PublicTicket');
  const mode = requestedMode ||
    ((page === 'status' || page === 'track') ? 'status' : (page === 'kb' ? 'kb' : 'report'));
  pub.mode = ['report', 'status', 'kb'].indexOf(mode) > -1 ? mode : 'report';
  let lineBootstrapSession = '';
  try {
    lineBootstrapSession = claimLineLoginHandoff_(
      (e && e.parameter && e.parameter.line_handoff) || '');
  } catch (e) {}
  let lineLoginUrl = '';
  try { lineLoginUrl = createLineLoginRequest_(pub.mode); } catch (e) {}
  pub.lineLoginUrlPayload = Utilities.base64Encode(lineLoginUrl, Utilities.Charset.UTF_8);
  pub.lineBootstrapSessionPayload = Utilities.base64Encode(
    lineBootstrapSession, Utilities.Charset.UTF_8);
  pub.orgName = getConfig_('ORG_NAME', 'กองทุนประกันชีวิต');
  pub.logoUrl = getConfig_('ORG_LOGO_URL', '');
  pub.appUrl = getPublicBaseUrl_();
  pub.adminUrl = getPublicBaseUrl_() + (getPublicBaseUrl_().indexOf('?') > -1 ? '&' : '?') + 'page=admin';
  return pub.evaluate()
    .setTitle('แจ้งซ่อม / ขอรับบริการ IT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** URL ฐานของ Web App (ใช้สร้างลิงก์หน้าสาธารณะ) */
function getPublicBaseUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/**
 * อัปเดต LINE_LOGIN_CALLBACK_URL ใน Script Properties ให้ตรงกับ URL /exec ของ
 * Deployment ปัจจุบันโดยอัตโนมัติ เรียกจาก doGet (คำขอเว็บจริงเท่านั้น เพราะ
 * getUrl() จาก editor จะได้ /dev ซึ่งใช้กับ LINE callback ไม่ได้)
 *
 * ข้อควรรู้: การ sync นี้อัปเดตเฉพาะค่าฝั่ง Apps Script เท่านั้น — ยังต้องเพิ่ม
 * URL เดียวกันใน LINE Developers Console (Callback URL) ด้วย ไม่เช่นนั้น LINE จะ
 * ปฏิเสธด้วย redirect_uri mismatch แนะนำให้ redeploy แบบ "แก้ deployment เดิม →
 * New version" เพื่อให้ /exec URL คงที่ จะได้ไม่ต้องแก้ LINE Console ทุกครั้ง
 */
function syncLineCallbackUrlToDeployment_() {
  try {
    if (getConfig_('LINE_CALLBACK_AUTOSYNC', 'true') === 'false') return;
    let base = '';
    try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { return; }
    if (!/\/exec(?:$|\?)/i.test(base)) return; // เขียนเฉพาะ /exec ของ web app จริง ข้าม /dev
    const expected = getExpectedLineCallbackUrl_();
    if (!expected) return;
    const current = String(getConfig_('LINE_LOGIN_CALLBACK_URL', '') || '').trim();
    if (current === expected) return; // ตรงอยู่แล้ว ไม่ต้องเขียนซ้ำ
    // ไม่ทับค่าที่ผู้ดูแลตั้งเองด้วยโดเมนกำหนดเอง (เช่นผ่าน proxy) — sync เฉพาะ URL ของ GAS
    if (current && !/^https:\/\/script\.google\.com\/macros\//i.test(current)) return;
    setConfig_('LINE_LOGIN_CALLBACK_URL', expected);
  } catch (e) {
    // ห้ามให้การ sync ทำให้ doGet ล้ม
  }
}

/** Schema version ปัจจุบัน เพิ่มเลขเมื่อ DB_SCHEMA มีคอลัมน์ที่ระบบต้องใช้เพิ่ม */
function getCurrentSchemaVersion_() {
  return 13;
}

/** Build ID ใช้ตรวจจับการอัปโหลดไฟล์ไม่ครบ Deployment เดียวกัน */
function getAppBuildId_() {
  return '2026.07.21.1-workflow-integration';
}

/** เวอร์ชันระบบ (ใช้แสดงใน footer / ตรวจสอบ deploy) */
function getAppVersion() {
  return 'ISMS Governance System v1.11 (Workflow & Integration)';
}

/**
 * ตรวจว่า code ฝั่ง server, หน้า client และ schema อยู่รุ่นเดียวกัน
 * คืนเฉพาะ metadata ด้านสุขภาพระบบ ไม่มีค่า secret หรือข้อมูลผู้ใช้งาน
 */
function getAppBuildInfo() {
  try {
    const expectedSchema = getCurrentSchemaVersion_();
    const installedSchema = parseInt(getConfig_('APP_SCHEMA_VERSION', '0'), 10) || 0;
    const missing = [];
    const requiredSheets = [
      SHEETS.PERSONAL_TASK, SHEETS.TASK_SUBTASK, SHEETS.TICKET, SHEETS.TICKET_WORKLOG, SHEETS.ASSET,
      SHEETS.EMPLOYEES, SHEETS.EMPLOYEE_ASSIGNMENTS, SHEETS.EMPLOYEE_LIFECYCLE,
      SHEETS.NOTIFY_QUEUE, SHEETS.RETENTION_LOG, SHEETS.SETTINGS,
      SHEETS.LEGAL_REGISTER, SHEETS.COMPLIANCE_OBLIGATION,
      SHEETS.COMPLIANCE_ASSESSMENT, SHEETS.CORRECTIVE_ACTION,
      SHEETS.REGULATORY_NOTIFICATION, SHEETS.GOVERNANCE_DOCUMENT, SHEETS.PDF_DESIGN_TEMPLATE,
      SHEETS.PRIVACY_ROPA, SHEETS.PRIVACY_CONSENT, SHEETS.PRIVACY_DSR
      ,SHEETS.PROBLEM, SHEETS.KNOWN_ERROR, SHEETS.VULNERABILITY,
      SHEETS.AUDIT_ENGAGEMENT, SHEETS.AUDIT_FINDING,
      SHEETS.CONFIG_ITEM, SHEETS.CI_RELATIONSHIP,
      SHEETS.SERVICE_CATALOG, SHEETS.SERVICE_REQUEST,
      SHEETS.SERVICE_REQUEST_TASK, SHEETS.SERVICE_REQUEST_HISTORY,
      SHEETS.WORKFLOW_DEFINITION, SHEETS.WORKFLOW_STEP, SHEETS.WORKFLOW_INSTANCE,
      SHEETS.WORKFLOW_APPROVAL, SHEETS.WORKFLOW_HISTORY, SHEETS.WORKFLOW_DELEGATION,
      SHEETS.ATTACHMENT_REGISTRY, SHEETS.ATTACHMENT_LINK, SHEETS.ATTACHMENT_ACCESS_LOG,
      SHEETS.RECORD_LINK, SHEETS.INTEGRATION_OUTBOX,
      SHEETS.ACTION_PERMISSION, SHEETS.ROLE_ACTION_PERMISSION, SHEETS.USER_PERMISSION_OVERRIDE,
      SHEETS.APPROVAL_GROUP, SHEETS.APPROVAL_GROUP_MEMBER
    ];
    const ss = getDB_();

    requiredSheets.forEach(function (sheetName) {
      const sh = ss.getSheetByName(sheetName);
      if (!sh) {
        missing.push(sheetName + ' (ไม่พบชีต)');
        return;
      }
      const lastCol = sh.getLastColumn();
      const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      (DB_SCHEMA[sheetName] || []).forEach(function (col) {
        if (headers.indexOf(col) === -1) missing.push(sheetName + '.' + col);
      });
    });

    // ยึดโครงสร้างจริงเป็นหลักเมื่อ migration ทำผ่าน Sheets API/connector
    // (Script Property อาจยังเป็นรุ่นเดิมจนกว่าจะรัน setupSystem จาก Editor)
    const effectiveInstalledSchema = missing.length === 0 ? expectedSchema : installedSchema;

    return ok({
      version: getAppVersion(),
      buildId: getAppBuildId_(),
      schemaVersion: expectedSchema,
      installedSchemaVersion: effectiveInstalledSchema,
      schemaReady: missing.length === 0,
      missingSchema: missing.slice(0, 20)
    });
  } catch (e) {
    return fail('ตรวจสอบ Deployment/Schema ไม่สำเร็จ: ' + (e && e.message ? e.message : String(e)));
  }
}
