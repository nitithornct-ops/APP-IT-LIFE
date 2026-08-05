/**
 * LineAuth.gs
 * LINE Login (OAuth 2.0 / OpenID Connect + PKCE) สำหรับหน้าแจ้งซ่อมสาธารณะ
 *
 * ความลับเก็บใน Script Properties เท่านั้น:
 *   LINE_LOGIN_ENABLED
 *   LINE_LOGIN_CHANNEL_ID
 *   LINE_LOGIN_CHANNEL_SECRET
 *   LINE_LOGIN_CALLBACK_URL
 *   LINE_SESSION_SECRET
 *   LINE_SESSION_HOURS
 *   LINE_REQUIRE_EMPLOYEE_LINK
 */

const LINE_OAUTH_STATE_TTL_SEC = 1800;
const LINE_LOGIN_HANDOFF_TTL_SEC = 120;
const LINE_LOGIN_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_LOGIN_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_LOGIN_REVOKE_URL = 'https://api.line.me/oauth2/v2.1/revoke';
const LINE_LOGIN_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_FRIENDSHIP_STATUS_URL = 'https://api.line.me/friendship/v1/status';

/** Bootstrap ที่หน้า PublicTicket เรียกได้ โดยไม่เปิดเผย channel ID/secret */
function getLineLoginBootstrapPublic(sessionToken) {
  try {
    const status = getLineLoginConfigurationStatus_();
    const result = {
      configured: status.configured,
      enabled: status.enabled,
      message: status.message,
      authenticated: false,
      sessionExpired: false,
      requireEmployeeLink: getConfig_('LINE_REQUIRE_EMPLOYEE_LINK', 'false') === 'true',
      profile: null
    };
    if (!sessionToken) return ok(result);
    try {
      const user = requireLineSession_(sessionToken);
      result.authenticated = true;
      result.profile = lineClientProfile_(user);
    } catch (sessionErr) {
      result.sessionExpired = true;
    }
    return ok(result);
  } catch (e) {
    return fail(e.message);
  }
}

/** สร้าง LINE authorization URL; state/nonce/verifier อยู่ฝั่ง Server */
function createLineLoginUrlPublic(returnMode) {
  try {
    return ok({ url: createLineLoginRequest_(returnMode) });
  } catch (e) {
    return fail(e.message);
  }
}

function createLineLoginRequest_(returnMode) {
  const status = getLineLoginConfigurationStatus_();
  if (!status.configured) throw new Error(status.message);

  returnMode = normalizeLineReturnMode_(returnMode);
  const state = randomLineToken_();
  const nonce = randomLineToken_();
  const verifier = randomLineToken_();
  const challenge = lineBase64Url_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, verifier, Utilities.Charset.UTF_8));
  const redirectUri = getConfig_('LINE_LOGIN_CALLBACK_URL', '').trim();

  CacheService.getScriptCache().put(
    lineOAuthStateCacheKey_(state),
    JSON.stringify({
      nonce: nonce,
      verifier: verifier,
      redirectUri: redirectUri,
      returnMode: returnMode,
      createdAt: Date.now()
    }),
    LINE_OAUTH_STATE_TTL_SEC
  );

  const params = {
    response_type: 'code',
    client_id: getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim(),
    redirect_uri: redirectUri,
    state: state,
    scope: 'openid profile',
    nonce: nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    bot_prompt: 'normal'
  };
  const query = Object.keys(params).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
  return LINE_LOGIN_AUTHORIZE_URL + '?' + query;
}

/**
 * เรียกจาก Code.gs:doGet เมื่อ LINE redirect กลับ ?page=line-callback
 * คืน one-time handoff ให้ LineCallback.html ส่งกลับหน้า PublicTicket
 */
function completeLineLoginCallback_(params) {
  params = params || {};
  if (params.error) {
    throw new Error('LINE ปฏิเสธการเข้าสู่ระบบ: ' +
      sanitizeText(params.error_description || params.error, 240));
  }
  const code = sanitizeText(params.code, 2000);
  const state = sanitizeText(params.state, 200);
  requireFields({ 'authorization code': code, 'state': state }, ['authorization code', 'state']);

  const stateKey = lineOAuthStateCacheKey_(state);
  const cache = CacheService.getScriptCache();
  const stateJson = cache.get(stateKey);
  cache.remove(stateKey); // state ใช้ได้ครั้งเดียว
  if (!stateJson) throw new Error('คำขอ LINE Login หมดอายุหรือถูกใช้งานแล้ว กรุณาเริ่ม Login ใหม่');

  let pending;
  try { pending = JSON.parse(stateJson); }
  catch (e) { throw new Error('ข้อมูลยืนยัน LINE Login ไม่สมบูรณ์ กรุณาเริ่มใหม่'); }
  if (!pending.createdAt || Date.now() - Number(pending.createdAt) > LINE_OAUTH_STATE_TTL_SEC * 1000) {
    throw new Error('คำขอ LINE Login หมดอายุ กรุณาเริ่มใหม่');
  }

  const tokenData = exchangeLineAuthorizationCode_(code, pending);
  const verified = verifyLineIdToken_(tokenData.id_token, pending.nonce);
  const lineUserId = sanitizeText(verified.sub, 200);
  if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
    throw new Error('LINE ไม่ได้ส่ง userId ที่ถูกต้องกลับมา');
  }

  const friendFlag = getLineFriendshipStatus_(tokenData.access_token);
  revokeLineAccessToken_(tokenData.access_token);
  const user = upsertLineUser_({
    lineUserId: lineUserId,
    displayName: sanitizeText(verified.name, 160) || 'LINE User',
    pictureUrl: sanitizeText(verified.picture, 1000),
    friendStatus: friendFlag === true ? 'Friend' : (friendFlag === false ? 'NotFriend' : 'Unknown')
  });
  const handoffToken = createLineLoginHandoff_(user.LineUserID);
  writeAudit_(lineActor_(user), 'LINE_LOGIN', 'ticket', SHEETS.LINE_USERS,
    lineUserId, 'LINE Login สำเร็จ', 'success');

  return {
    handoffToken: handoffToken,
    returnMode: normalizeLineReturnMode_(pending.returnMode)
  };
}

function exchangeLineAuthorizationCode_(code, pending) {
  const response = UrlFetchApp.fetch(LINE_LOGIN_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: pending.redirectUri,
      client_id: getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim(),
      client_secret: getConfig_('LINE_LOGIN_CHANNEL_SECRET', '').trim(),
      code_verifier: pending.verifier
    },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  let body = {};
  try { body = JSON.parse(response.getContentText() || '{}'); } catch (e) {}
  if (status !== 200 || !body.id_token || !body.access_token) {
    throw new Error('แลก LINE authorization code ไม่สำเร็จ (HTTP ' + status + '): ' +
      sanitizeText(body.error_description || body.error || 'Unknown error', 240));
  }
  return body;
}

function verifyLineIdToken_(idToken, expectedNonce) {
  const response = UrlFetchApp.fetch(LINE_LOGIN_VERIFY_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      id_token: idToken,
      client_id: getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim(),
      nonce: expectedNonce
    },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  let body = {};
  try { body = JSON.parse(response.getContentText() || '{}'); } catch (e) {}
  if (status !== 200 || !body.sub) {
    throw new Error('ตรวจ LINE ID token ไม่สำเร็จ (HTTP ' + status + '): ' +
      sanitizeText(body.error_description || body.error || 'Unknown error', 240));
  }
  const channelId = getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim();
  if (String(body.aud || '') !== channelId) throw new Error('LINE ID token ไม่ได้ออกให้ Channel นี้');
  if (expectedNonce && String(body.nonce || '') !== String(expectedNonce)) {
    throw new Error('LINE Login nonce ไม่ตรงกัน กรุณาเริ่ม Login ใหม่');
  }
  if (body.exp && Number(body.exp) * 1000 <= Date.now()) throw new Error('LINE ID token หมดอายุแล้ว');
  return body;
}

function getLineFriendshipStatus_(accessToken) {
  if (!accessToken) return null;
  try {
    const response = UrlFetchApp.fetch(LINE_FRIENDSHIP_STATUS_URL, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return null;
    const body = JSON.parse(response.getContentText() || '{}');
    return body.friendFlag === true;
  } catch (e) {
    return null;
  }
}

/** ไม่เก็บ LINE access/refresh token; revoke หลังอ่าน profile/friendship แล้วใช้ app session ของเราแทน */
function revokeLineAccessToken_(accessToken) {
  if (!accessToken) return;
  try {
    UrlFetchApp.fetch(LINE_LOGIN_REVOKE_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        access_token: accessToken,
        client_id: getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim(),
        client_secret: getConfig_('LINE_LOGIN_CHANNEL_SECRET', '').trim()
      },
      muteHttpExceptions: true
    });
  } catch (e) {}
}

function upsertLineUser_(profile) {
  ensureSheetBySchema_(SHEETS.LINE_USERS);
  const existing = findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', profile.lineUserId);
  const requireLink = getConfig_('LINE_REQUIRE_EMPLOYEE_LINK', 'false') === 'true';
  const now = new Date();
  if (existing) {
    let linkStatus = String(existing.LinkStatus || '');
    if (!requireLink && linkStatus !== 'Suspended') linkStatus = 'Active';
    if (!linkStatus || (requireLink && linkStatus === 'Unlinked')) {
      linkStatus = requireLink ? 'Pending' : 'Active';
    }
    updateRow_(SHEETS.LINE_USERS, existing._row, {
      DisplayName: profile.displayName,
      PictureURL: profile.pictureUrl,
      FullName: existing.FullName || profile.displayName,
      LinkStatus: linkStatus,
      FriendStatus: profile.friendStatus,
      LastLoginAt: now
    }, lineActorId_(profile.lineUserId));
  } else {
    appendRowEnsured_(SHEETS.LINE_USERS, {
      LineUserID: profile.lineUserId,
      DisplayName: profile.displayName,
      PictureURL: profile.pictureUrl,
      EmployeeCode: '',
      LinkedUserID: '',
      FullName: profile.displayName,
      Department: '',
      LinkStatus: requireLink ? 'Pending' : 'Active',
      FriendStatus: profile.friendStatus,
      LastLoginAt: now
    }, lineActorId_(profile.lineUserId));
  }
  return findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', profile.lineUserId);
}

function createLineSession_(lineUserId) {
  ensureSheetBySchema_(SHEETS.LINE_SESSIONS);
  const token = randomLineToken_();
  const hours = clampNumber_(getConfig_('LINE_SESSION_HOURS', '24'), 1, 720, 24);
  appendRowEnsured_(SHEETS.LINE_SESSIONS, {
    SessionHash: lineSessionHash_(token),
    LineUserID: lineUserId,
    ExpiresAt: new Date(Date.now() + hours * 3600000),
    RevokedAt: '',
    LastSeenAt: new Date()
  }, lineActorId_(lineUserId));
  return token;
}

/** one-time code สำหรับส่งจาก callback URL ไปออก session ที่หน้า PublicTicket */
function createLineLoginHandoff_(lineUserId) {
  const handoff = randomLineToken_();
  CacheService.getScriptCache().put(
    lineHandoffCacheKey_(handoff),
    String(lineUserId || ''),
    LINE_LOGIN_HANDOFF_TTL_SEC
  );
  return handoff;
}

function claimLineLoginHandoff_(handoff) {
  handoff = String(handoff || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(handoff)) return '';
  const cache = CacheService.getScriptCache();
  const key = lineHandoffCacheKey_(handoff);
  const lineUserId = cache.get(key);
  cache.remove(key);
  if (!lineUserId) return '';
  const user = findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', lineUserId);
  if (!user || String(user.LinkStatus) === 'Unlinked') return '';
  return createLineSession_(lineUserId);
}

function requireLineSession_(sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('LINE session ไม่ถูกต้อง');
  ensureSheetBySchema_(SHEETS.LINE_SESSIONS);
  const session = findRowEnsured_(SHEETS.LINE_SESSIONS, 'SessionHash', lineSessionHash_(token));
  if (!session || session.RevokedAt) throw new Error('LINE session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const expiresAt = session.ExpiresAt instanceof Date ? session.ExpiresAt : new Date(session.ExpiresAt);
  if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error('LINE session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const user = findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', session.LineUserID);
  if (!user || String(user.LinkStatus) === 'Unlinked') throw new Error('ไม่พบบัญชี LINE ที่เชื่อมกับระบบ');

  const lastSeen = session.LastSeenAt ? new Date(session.LastSeenAt).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > 30 * 60000) {
    updateRow_(SHEETS.LINE_SESSIONS, session._row, { LastSeenAt: new Date() },
      lineActorId_(session.LineUserID));
  }
  return user;
}

function requireActiveLineSession_(sessionToken) {
  const user = requireLineSession_(sessionToken);
  const status = String(user.LinkStatus || '');
  if (status !== 'Active') {
    if (status === 'Suspended') throw new Error('บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT');
    throw new Error('กรุณาผูกบัญชีกับทะเบียนผู้ใช้ก่อนแจ้งซ่อม');
  }
  return user;
}

/** ผูก LINE กับ EmployeeCode ในทะเบียน Users โดยไม่ใช้อีเมล */
function linkLineEmployeePublic(sessionToken, employeeCode) {
  try {
    const lineUser = requireLineSession_(sessionToken);
    if (String(lineUser.LinkStatus) === 'Suspended') {
      throw new Error('บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT');
    }
    employeeCode = sanitizeText(employeeCode, 80);
    requireFields({ 'รหัสพนักงาน': employeeCode }, ['รหัสพนักงาน']);
    checkPublicLookupRate_('line_link', lineUser.LineUserID, 10, 3600);
    ensureSheetBySchema_(SHEETS.USERS);

    const matches = readSheetObjects_(SHEETS.USERS).filter(function (u) {
      return String(u.EmployeeCode || '').trim().toLowerCase() === employeeCode.toLowerCase() &&
        String(u.Status || '').toLowerCase() === 'active';
    });
    if (matches.length !== 1) throw new Error('ไม่พบรหัสพนักงานที่ Active หรือรหัสซ้ำ กรุณาติดต่อส่วนงาน IT');
    const employee = matches[0];

    const alreadyLinked = readSheetObjectsEnsured_(SHEETS.LINE_USERS).some(function (u) {
      return String(u.LineUserID) !== String(lineUser.LineUserID) &&
        String(u.LinkedUserID) === String(employee.UserID) &&
        String(u.LinkStatus) === 'Active';
    });
    if (alreadyLinked) throw new Error('รหัสพนักงานนี้ผูกกับ LINE บัญชีอื่นแล้ว กรุณาติดต่อส่วนงาน IT');

    const autoApprove = getConfig_('LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'false') === 'true';
    updateRow_(SHEETS.LINE_USERS, lineUser._row, {
      EmployeeCode: employee.EmployeeCode,
      LinkedUserID: employee.UserID,
      FullName: employee.FullName || lineUser.DisplayName,
      Department: employee.Department || '',
      LinkStatus: autoApprove ? 'Active' : 'Pending'
    }, lineActorId_(lineUser.LineUserID));
    const updated = findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', lineUser.LineUserID);
    writeAudit_(lineActor_(updated), 'LINE_LINK_EMPLOYEE', 'ticket', SHEETS.LINE_USERS,
      employee.UserID, 'ผูกกับ EmployeeCode ' + employee.EmployeeCode +
      (autoApprove ? ' (auto-approved)' : ' (pending admin approval)'), 'success');
    return ok(lineClientProfile_(updated));
  } catch (e) {
    return fail(e.message);
  }
}

function logoutLinePublic(sessionToken) {
  try {
    const token = String(sessionToken || '').trim();
    if (token) {
      const session = findRowEnsured_(SHEETS.LINE_SESSIONS, 'SessionHash', lineSessionHash_(token));
      if (session && !session.RevokedAt) {
        updateRow_(SHEETS.LINE_SESSIONS, session._row, { RevokedAt: new Date() },
          lineActorId_(session.LineUserID));
      }
    }
    return ok('ออกจากระบบ LINE แล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

function lineClientProfile_(user) {
  return {
    displayName: user.DisplayName || '',
    pictureUrl: user.PictureURL || '',
    fullName: user.FullName || user.DisplayName || '',
    department: user.Department || '',
    employeeCode: user.EmployeeCode || '',
    linkStatus: user.LinkStatus || 'Pending',
    friendStatus: user.FriendStatus || 'Unknown'
  };
}

function lineActor_(user) {
  return {
    email: lineActorId_(user.LineUserID),
    name: user.FullName || user.DisplayName || 'LINE User',
    role: 'public-line',
    lineUserId: user.LineUserID,
    identityType: 'LINE'
  };
}

function lineActorId_(lineUserId) {
  return 'LINE:' + String(lineUserId || '');
}

function getLineLoginConfigurationStatus_() {
  const enabled = getConfig_('LINE_LOGIN_ENABLED', 'false') === 'true';
  const missing = [];
  const issues = [];
  const channelId = getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim();
  const channelSecret = getConfig_('LINE_LOGIN_CHANNEL_SECRET', '').trim();
  const callbackUrl = getConfig_('LINE_LOGIN_CALLBACK_URL', '').trim();
  const expectedCallback = getExpectedLineCallbackUrl_();
  if (!channelId) missing.push('LINE_LOGIN_CHANNEL_ID');
  else if (!/^\d+$/.test(channelId)) issues.push('LINE_LOGIN_CHANNEL_ID ต้องเป็นตัวเลข');
  if (!channelSecret) missing.push('LINE_LOGIN_CHANNEL_SECRET');
  else if (channelSecret.length < 20) issues.push('LINE_LOGIN_CHANNEL_SECRET สั้นผิดปกติ');
  if (!callbackUrl) missing.push('LINE_LOGIN_CALLBACK_URL');
  else {
    if (callbackUrl.indexOf('https://') !== 0) issues.push('LINE_LOGIN_CALLBACK_URL ต้องเป็น HTTPS');
    if (callbackUrl.indexOf('page=line-callback') === -1) {
      issues.push('LINE_LOGIN_CALLBACK_URL ต้องมี page=line-callback');
    }
    if (expectedCallback && callbackUrl !== expectedCallback) {
      issues.push('LINE_LOGIN_CALLBACK_URL ไม่ตรงกับ Deployment ปัจจุบัน ควรเป็น ' + expectedCallback);
    }
  }
  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      message: 'LINE Login ยังไม่เปิดใช้งาน',
      callbackUrl: callbackUrl,
      expectedCallback: expectedCallback,
      callbackMatchesDeployment: callbackUrl && expectedCallback ? callbackUrl === expectedCallback : false
    };
  }
  if (missing.length) {
    return {
      enabled: true,
      configured: false,
      message: 'ยังตั้งค่า LINE Login ไม่ครบ: ' + missing.join(', '),
      callbackUrl: callbackUrl,
      expectedCallback: expectedCallback,
      callbackMatchesDeployment: callbackUrl && expectedCallback ? callbackUrl === expectedCallback : false
    };
  }
  if (issues.length) {
    return {
      enabled: true,
      configured: false,
      message: 'ค่า LINE Login ไม่ถูกต้อง: ' + issues.join('; '),
      callbackUrl: callbackUrl,
      expectedCallback: expectedCallback,
      callbackMatchesDeployment: callbackUrl && expectedCallback ? callbackUrl === expectedCallback : false
    };
  }
  return {
    enabled: true,
    configured: true,
    message: '',
    callbackUrl: callbackUrl,
    expectedCallback: expectedCallback,
    callbackMatchesDeployment: callbackUrl && expectedCallback ? callbackUrl === expectedCallback : false
  };
}

function getExpectedLineCallbackUrl_() {
  let base = '';
  try {
    base = typeof getPublicBaseUrl_ === 'function' ? getPublicBaseUrl_() : '';
  } catch (e) {}
  if (!base) {
    try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  }
  return base ? base + (base.indexOf('?') > -1 ? '&' : '?') + 'page=line-callback' : '';
}

function getLineSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('LINE_SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('LINE_SESSION_SECRET', secret);
  }
  return secret;
}

function lineSessionHash_(token) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(
    String(token || ''), getLineSessionSecret_(), Utilities.Charset.UTF_8));
}

function randomLineToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function lineBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function lineOAuthStateCacheKey_(state) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(state || ''), Utilities.Charset.UTF_8);
  return 'line_oauth_' + bytesToHex_(digest).substring(0, 40);
}

function lineHandoffCacheKey_(handoff) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(handoff || ''), Utilities.Charset.UTF_8);
  return 'line_handoff_' + bytesToHex_(digest).substring(0, 40);
}

function normalizeLineReturnMode_(mode) {
  mode = String(mode || '').toLowerCase();
  return ['report', 'status', 'kb'].indexOf(mode) > -1 ? mode : 'report';
}

/** รันจาก Apps Script Editor เพื่อตรวจค่าที่ต้องตั้ง โดยไม่แสดงค่าความลับ */
function diagnoseLineLoginSetup() {
  assertEditorOwner_();
  const status = getLineLoginConfigurationStatus_();
  const callback = getConfig_('LINE_LOGIN_CALLBACK_URL', '');
  const base = ScriptApp.getService().getUrl() || '';
  const expectedCallback = getExpectedLineCallbackUrl_();
  return [
    'LINE_LOGIN_ENABLED = ' + (status.enabled ? 'true' : 'false'),
    'Configuration = ' + (status.configured ? 'READY' : status.message),
    'Web app URL = ' + (base || '(ยังไม่มี deployment URL)'),
    'Public LINE page = ' + (base ? base + '?page=line' : '(deploy ก่อน)'),
    'Callback URL in Script Properties = ' + (callback || '(ยังไม่ได้ตั้งค่า)'),
    'Expected callback for current deployment = ' + (expectedCallback || '(deploy ก่อน)'),
    'Callback matches current deployment = ' + (callback && expectedCallback && callback === expectedCallback ? 'YES' : 'NO'),
    'Reminder: ใส่ Expected callback เดียวกันนี้ใน LINE Developers > LINE Login > Callback URL',
    'Employee link required = ' + getConfig_('LINE_REQUIRE_EMPLOYEE_LINK', 'false'),
    'Employee auto-approve = ' + getConfig_('LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'false'),
    'Session hours = ' + getConfig_('LINE_SESSION_HOURS', '24')
  ].join('\n');
}
