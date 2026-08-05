/**
 * Drive.gs
 * จัดการโฟลเดอร์และไฟล์หลักฐานใน Google Drive
 * โครงสร้าง: [ROOT] / ISMS_Evidence / <module> / <ปี พ.ศ.>
 *
 * ตั้งค่า (ไม่บังคับ) ในชีต Settings:
 *   EVIDENCE_ROOT_ID = รหัสโฟลเดอร์รากที่ต้องการ (ถ้าไม่ตั้ง ระบบจะสร้าง "ISMS_Evidence" ใน My Drive)
 */

function getEvidenceRoot_() {
  const id = getConfig_('EVIDENCE_ROOT_ID', '');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* falls through */ }
  }
  return getOrCreateChildFolder_(DriveApp.getRootFolder(), 'ISMS_Evidence');
}

function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/** คืนโฟลเดอร์หลักฐานของโมดูล/ปีปัจจุบัน (พ.ศ.) */
function getEvidenceFolder_(moduleName) {
  const root = getEvidenceRoot_();
  const modFolder = getOrCreateChildFolder_(root, moduleName || 'ทั่วไป');
  const year = String(new Date().getFullYear() + 543);
  return getOrCreateChildFolder_(modFolder, year);
}

/**
 * อัปโหลดไฟล์หลักฐานจาก client (base64) — คืน {url, name, id}
 * payload = { base64, filename, mimeType, module }
 * จำกัดขนาดและชนิดไฟล์เพื่อความปลอดภัย
 */
function uploadEvidence(payload) {
  try {
    if (!payload || !payload.base64 || !payload.filename) throw new Error('ไม่พบไฟล์ที่อัปโหลด');

    const requestedModule = sanitizeText(payload.module || '', 80);
    const moduleKey = requestedModule === 'ธรรมาภิบาล' ? 'evidence' : requestedModule;
    if (!moduleKey || !Object.prototype.hasOwnProperty.call(MODULE_ACCESS, moduleKey)) {
      throw new Error('ไม่พบโมดูลปลายทางสำหรับไฟล์แนบ');
    }
    // These modules have record-level authorization, retention and access-log
    // support in AttachmentRegistry. Keeping this legacy endpoint available for
    // them would bypass those controls and expose raw Drive IDs/URLs.
    if (['serviceCatalog', 'task', 'ticket', 'access', 'change', 'workflow'].indexOf(moduleKey) > -1) {
      throw new Error('โมดูลนี้ต้องอัปโหลดผ่าน Attachment Registry');
    }
    const user = requireModule(moduleKey, false);

    const allowedExt = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'];
    const ext = String(payload.filename).split('.').pop().toLowerCase();
    if (allowedExt.indexOf(ext) === -1) {
      throw new Error('ชนิดไฟล์ไม่อนุญาต (รองรับ: ' + allowedExt.join(', ') + ')');
    }

    const bytes = Utilities.base64Decode(payload.base64);
    const maxBytes = 15 * 1024 * 1024; // 15 MB
    if (bytes.length > maxBytes) throw new Error('ไฟล์ใหญ่เกิน 15 MB');

    const safeName = sanitizeText(payload.filename, 120).replace(/[\\\/:*?"<>|]/g, '_');
    const safeMimeByExt = {
      pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
      doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt:'text/plain', csv:'text/csv'
    };
    const blob = Utilities.newBlob(bytes, safeMimeByExt[ext] || 'application/octet-stream', safeName);
    const folder = getEvidenceFolder_(moduleKey);
    const stamped = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss') + '_' + safeName;
    const file = folder.createFile(blob).setName(stamped);
    file.setDescription('อัปโหลดโดย ' + user.email + ' โมดูล ' + moduleKey);

    writeAudit_(user, 'UPLOAD_EVIDENCE', moduleKey, '', file.getId(), stamped, 'success');
    if (moduleKey === 'serviceCatalog') {
      // Service Request accepts an attachment only when this durable claim is
      // present. writeAudit_ is intentionally best-effort for legacy callers,
      // so verify the claim here and remove an otherwise orphaned upload.
      const claimed = readSheetObjects_(SHEETS.AUDIT_TRAIL).some(function (row) {
        return String(row.Action || '') === 'UPLOAD_EVIDENCE' &&
          String(row.Module || '') === 'serviceCatalog' &&
          String(row.TargetID || '') === file.getId() &&
          String(row.ActorEmail || '').toLowerCase() === String(user.email || '').toLowerCase() &&
          String(row.Result || '').toLowerCase() === 'success';
      });
      if (!claimed) {
        try { file.setTrashed(true); } catch (ignore) {}
        throw new Error('ไม่สามารถยืนยันหลักฐานการอัปโหลด กรุณาลองใหม่');
      }
    }
    return ok({ url: file.getUrl(), name: stamped, id: file.getId() });
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * อัปโหลดโลโก้องค์กร (เฉพาะผู้ดูแลระบบ) — เก็บใน Drive แบบ "ใครมีลิงก์ก็ดูได้"
 * แล้วบันทึก URL ไว้ที่ Script Property: ORG_LOGO_URL เพื่อใช้แสดงทั้งหน้าหลังบ้านและหน้าแจ้งซ่อม
 * payload = { base64, filename, mimeType }
 */
function uploadOrgLogo(payload) {
  try {
    const user = requireModule('settings', true);
    if (!payload || !payload.base64 || !payload.filename) throw new Error('ไม่พบไฟล์โลโก้');
    const ext = String(payload.filename).split('.').pop().toLowerCase();
    const allowedExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
    if (allowedExt.indexOf(ext) === -1) throw new Error('รองรับเฉพาะไฟล์รูปภาพ (png, jpg, gif, webp, svg)');

    const bytes = Utilities.base64Decode(payload.base64);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('ไฟล์โลโก้ต้องไม่เกิน 2 MB');

    const folder = getEvidenceFolder_('branding');
    const safeName = 'logo_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss') + '.' + ext;
    const blob = Utilities.newBlob(bytes, payload.mimeType || 'image/png', safeName);
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain policy may restrict */ }

    // ลบไฟล์โลโก้เก่าใน Drive (best-effort) เพื่อไม่ให้รก
    const oldId = getConfig_('ORG_LOGO_FILE_ID', '');
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) {} }

    const viewUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
    setConfig_('ORG_LOGO_URL', viewUrl);
    setConfig_('ORG_LOGO_FILE_ID', file.getId());
    writeAudit_(user, 'UPDATE_LOGO', 'settings', '', file.getId(), safeName, 'success');
    return ok({ url: viewUrl });
  } catch (e) {
    return fail(e.message);
  }
}

/** ลบโลโก้องค์กร กลับไปใช้ตัวอักษรเริ่มต้น */
function removeOrgLogo() {
  try {
    const user = requireModule('settings', true);
    const oldId = getConfig_('ORG_LOGO_FILE_ID', '');
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) {} }
    setConfig_('ORG_LOGO_URL', '');
    setConfig_('ORG_LOGO_FILE_ID', '');
    writeAudit_(user, 'REMOVE_LOGO', 'settings', '', '', '', 'success');
    return ok('นำโลโก้ออกแล้ว');
  } catch (e) {
    return fail(e.message);
  }
}
