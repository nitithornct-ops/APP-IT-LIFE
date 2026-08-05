/**
 * Module_Asset.gs
 * ทะเบียนทรัพย์สิน IT (IT Asset Management)
 * รองรับทั้งฟิลด์ ISMS เดิม (License/Patch/Criticality) และชุดขยายตามสเปก
 * (AssetCode, Brand, SerialNumber, PurchaseDate, WarrantyExpire, OwnerEmail, VendorID, QRCodeURL ฯลฯ)
 *
 * ความสามารถ: เพิ่ม/แก้ไข/ค้นหา/ดูรายละเอียด/ปิดใช้งานปลอดภัย/สร้าง QR/ผูกประวัติ PM·ยืมคืน·License
 */

// ประเภท ISMS เดิม (ใช้กับ Patch/Criticality)
const ASSET_TYPES = ['Server', 'Network Device', 'Software/License', 'Endpoint', 'Storage', 'อื่นๆ'];
const ASSET_CRIT = ['สูง', 'กลาง', 'ต่ำ'];

// หมวดหมู่ตามสเปก IT Asset
const ASSET_CATEGORIES = ['Computer', 'Notebook', 'Printer', 'Network', 'Server', 'Software', 'อื่นๆ'];

// สถานะตามสเปก
const ASSET_STATUS = {
  AVAILABLE: 'พร้อมใช้งาน',
  IN_USE: 'ใช้งานอยู่',
  MAINTENANCE: 'ซ่อมบำรุง',
  DISPOSED: 'จำหน่าย/เลิกใช้',
  LOST: 'สูญหาย'
};
const ASSET_STATUSES = Object.keys(ASSET_STATUS).map(function (k) { return ASSET_STATUS[k]; });

// อายุการใช้งานตั้งต้น (ปี) สำหรับคำนวณค่าเสื่อมแบบเส้นตรง เมื่อไม่ได้ระบุรายตัว
const ASSET_DEFAULT_LIFE_YEARS = 5;

/** คำนวณค่าเสื่อมราคาแบบเส้นตรง (straight-line) → มูลค่าคงเหลือตามบัญชี */
function computeAssetDepreciation_(price, purchaseDate, usefulLifeYears) {
  const p = Number(price) || 0;
  const life = Number(usefulLifeYears) || ASSET_DEFAULT_LIFE_YEARS;
  const pd = purchaseDate ? new Date(purchaseDate) : null;
  if (!p || !pd || isNaN(pd)) {
    return { price: p, ageYears: null, bookValue: p || null, depreciationPct: null, lifeYears: life };
  }
  const ageYears = (new Date() - pd) / (365.25 * 86400000);
  let remain = 1 - (ageYears / life);
  if (remain < 0) remain = 0;
  return {
    price: p, ageYears: +ageYears.toFixed(1),
    bookValue: Math.round(p * remain),
    depreciationPct: Math.round((1 - remain) * 100), lifeYears: life
  };
}

/** ทรัพย์สินที่ถือว่าเลิกใช้แล้ว (รวมค่าเดิม 'Retired' เพื่อ backward-compat) */
function isAssetRetired_(status) {
  const s = String(status || '');
  return s === ASSET_STATUS.DISPOSED || s === ASSET_STATUS.LOST || s.toLowerCase() === 'retired';
}
function isAssetActive_(status) { return !isAssetRetired_(status); }

function getAssetModuleData() {
  try {
    const user = requireModule('asset', false);
    const assets = readSheetObjectsEnsured_(SHEETS.ASSET).map(serializeAsset_);
    const vendors = getVendorOptions_();
    return ok({
      role: user.role, canEdit: canEditModule(user.role, 'asset'),
      canManageCategories: user.role === ROLES.IT_ADMIN,
      canViewAnalytics: user.role !== ROLES.USER,
      types: ASSET_TYPES, criticalities: ASSET_CRIT,
      categories: assetCategoryNames_(), statuses: ASSET_STATUSES,
      auditCycleDays: getAssetAuditCycleDays_(),
      vendors: vendors, assets: assets
    });
  } catch (e) { return fail(e.message); }
}

function serializeAsset_(r) {
  const dep = computeAssetDepreciation_(r.Price, r.PurchaseDate, r.UsefulLifeYears);
  return {
    row: r._row, id: r.AssetID, code: r.AssetCode, name: r.AssetName,
    type: r.AssetType, category: r.Category, brand: r.Brand, model: r.Model,
    serial: r.SerialNumber, vendor: r.Vendor, vendorId: r.VendorID,
    purchaseDate: safeFmtDate_(r.PurchaseDate),
    warrantyExpire: safeFmtDate_(r.WarrantyExpire), warrantyDays: daysUntil(r.WarrantyExpire),
    price: r.Price,
    usefulLife: r.UsefulLifeYears || '', ageYears: dep.ageYears,
    bookValue: dep.bookValue, depreciationPct: dep.depreciationPct,
    license: r.LicenseNo, expiry: safeFmtDate_(r.LicenseExpiry), expiryDays: daysUntil(r.LicenseExpiry),
    location: r.Location, department: r.Department,
    owner: r.Owner, ownerName: r.OwnerName, ownerEmail: r.OwnerEmail,
    patchStatus: r.PatchStatus, patchDate: safeFmtDate_(r.PatchDate), criticality: r.Criticality,
    status: r.Status || ASSET_STATUS.AVAILABLE, qrUrl: r.QRCodeURL,
    lastAudit: safeFmtDate_(r.LastAuditDate), lastAuditBy: r.LastAuditBy || '',
    auditStatus: r.AuditStatus || '', auditDays: daysSince_(r.LastAuditDate),
    loanDate: safeFmtDate_(r.LoanDate), loanDue: safeFmtDate_(r.LoanDueDate),
    loanDueDays: daysUntil(r.LoanDueDate), onLoan: !!r.LoanDueDate,
    notes: r.Notes, remark: r.Remark
  };
}

function addAsset(form) {
  try {
    const user = requireModule('asset', true);
    form = form || {};
    const name = sanitizeText(form.name, 150);
    requireFields({ 'ชื่อทรัพย์สิน': name }, ['ชื่อทรัพย์สิน']);
    const category = sanitizeText(form.category, 60);
    if (category && !isValidAssetCategory_(category)) throw new Error('หมวดหมู่ทรัพย์สินไม่ถูกต้อง');
    const status = sanitizeText(form.status, 40) || ASSET_STATUS.AVAILABLE;
    if (!isInList(status, ASSET_STATUSES)) throw new Error('สถานะทรัพย์สินไม่ถูกต้อง');
    const type = sanitizeText(form.type, 60) || category || 'อื่นๆ';

    const id = generateId('AST');
    const code = sanitizeText(form.code, 60) || generateAssetCode_(category);
    const email = sanitizeText(form.ownerEmail, 160);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลเจ้าของไม่ถูกต้อง');

    appendRow_(SHEETS.ASSET, {
      AssetID: id, AssetCode: code, AssetName: name, AssetType: type, Category: category,
      Brand: sanitizeText(form.brand, 100), Model: sanitizeText(form.model, 100),
      SerialNumber: sanitizeText(form.serial, 100), Vendor: sanitizeText(form.vendor, 100),
      VendorID: sanitizeText(form.vendorId, 80),
      PurchaseDate: parseDate(form.purchaseDate), WarrantyExpire: parseDate(form.warrantyExpire),
      Price: numberOrZero_(form.price) || '',
      LicenseNo: sanitizeText(form.license, 100), LicenseExpiry: parseDate(form.expiry),
      Location: sanitizeText(form.location, 120), Department: sanitizeText(form.department, 120),
      Owner: sanitizeText(form.ownerName, 120) || sanitizeText(form.owner, 120),
      OwnerName: sanitizeText(form.ownerName, 120), OwnerEmail: email,
      PatchStatus: sanitizeText(form.patchStatus, 60), PatchDate: parseDate(form.patchDate),
      Criticality: sanitizeText(form.criticality, 20),
      Status: status, QRCodeURL: buildAssetQrUrl_(code, name),
      UsefulLifeYears: numberOrZero_(form.usefulLife) || '',
      Notes: sanitizeText(form.notes, 500), Remark: sanitizeText(form.remark, 500)
    }, user.email);
    appendAssetHistory_(id, name, 'Create', '', user.email, 'ลงทะเบียนทรัพย์สิน', user.email);
    writeAudit_(user, 'CREATE', 'asset', SHEETS.ASSET, id, name + ' (' + code + ')', 'success');
    return ok('บันทึกทรัพย์สินเรียบร้อย (' + code + ')');
  } catch (e) { return fail(e.message); }
}

function updateAsset(assetId, form) {
  try {
    const user = requireModule('asset', true);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    form = form || {};
    const patch = {};
    const setText = function (key, formKey, len) {
      if (form[formKey] !== undefined) patch[key] = sanitizeText(form[formKey], len);
    };
    setText('AssetName', 'name', 150);
    setText('AssetCode', 'code', 60);
    setText('Brand', 'brand', 100);
    setText('Model', 'model', 100);
    setText('SerialNumber', 'serial', 100);
    setText('Vendor', 'vendor', 100);
    setText('VendorID', 'vendorId', 80);
    setText('Location', 'location', 120);
    setText('Department', 'department', 120);
    setText('PatchStatus', 'patchStatus', 60);
    setText('Criticality', 'criticality', 20);
    setText('Notes', 'notes', 500);
    setText('Remark', 'remark', 500);
    if (form.category !== undefined) {
      const c = sanitizeText(form.category, 60);
      if (c && !isValidAssetCategory_(c)) throw new Error('หมวดหมู่ทรัพย์สินไม่ถูกต้อง');
      patch.Category = c;
    }
    if (form.usefulLife !== undefined) patch.UsefulLifeYears = numberOrZero_(form.usefulLife) || '';
    if (form.ownerName !== undefined) { patch.OwnerName = sanitizeText(form.ownerName, 120); patch.Owner = patch.OwnerName; }
    if (form.ownerEmail !== undefined) {
      const email = sanitizeText(form.ownerEmail, 160);
      if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลเจ้าของไม่ถูกต้อง');
      patch.OwnerEmail = email;
    }
    if (form.purchaseDate !== undefined) patch.PurchaseDate = parseDate(form.purchaseDate);
    if (form.warrantyExpire !== undefined) patch.WarrantyExpire = parseDate(form.warrantyExpire);
    if (form.expiry !== undefined) patch.LicenseExpiry = parseDate(form.expiry);
    if (form.license !== undefined) patch.LicenseNo = sanitizeText(form.license, 100);
    if (form.price !== undefined) patch.Price = numberOrZero_(form.price) || '';
    if (form.status !== undefined && form.status !== '') {
      const st = sanitizeText(form.status, 40);
      if (!isInList(st, ASSET_STATUSES)) throw new Error('สถานะทรัพย์สินไม่ถูกต้อง');
      patch.Status = st;
    }
    // อัปเดต QR ถ้า code/ชื่อเปลี่ยน
    const newCode = patch.AssetCode || a.AssetCode;
    const newName = patch.AssetName || a.AssetName;
    if (patch.AssetCode || patch.AssetName) patch.QRCodeURL = buildAssetQrUrl_(newCode, newName);

    updateRow_(SHEETS.ASSET, a._row, patch, user.email);
    appendAssetHistory_(assetId, newName, 'Update', '', user.email, 'แก้ไขข้อมูลทรัพย์สิน', user.email);
    writeAudit_(user, 'UPDATE', 'asset', SHEETS.ASSET, assetId, JSON.stringify(patch), 'success');
    return ok('แก้ไขทรัพย์สินเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** เปลี่ยนสถานะทรัพย์สิน (พร้อมใช้งาน/ใช้งานอยู่/ซ่อมบำรุง/จำหน่าย/สูญหาย) */
function setAssetStatus(assetId, status, remark) {
  try {
    const user = requireModule('asset', true);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    status = sanitizeText(status, 40);
    if (!isInList(status, ASSET_STATUSES)) throw new Error('สถานะทรัพย์สินไม่ถูกต้อง');
    updateRow_(SHEETS.ASSET, a._row, { Status: status }, user.email);
    appendAssetHistory_(assetId, a.AssetName, 'Status', '', user.email, 'เปลี่ยนสถานะเป็น ' + status +
      (remark ? ' (' + sanitizeText(remark, 200) + ')' : ''), user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'asset', SHEETS.ASSET, assetId, status, 'success');
    return ok('เปลี่ยนสถานะทรัพย์สินเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** ปิดใช้งานแบบปลอดภัย (จำหน่าย/เลิกใช้) — ไม่ลบแถวทิ้ง */
function retireAsset(assetId) {
  try {
    const user = requireModule('asset', true);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    updateRow_(SHEETS.ASSET, a._row, { Status: ASSET_STATUS.DISPOSED }, user.email);
    appendAssetHistory_(assetId, a.AssetName, 'Retire', '', user.email, 'จำหน่าย/เลิกใช้', user.email);
    writeAudit_(user, 'RETIRE', 'asset', SHEETS.ASSET, assetId, a.AssetName, 'success');
    return ok('ปิดใช้งานทรัพย์สินเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** อัปเดตสถานะ Patch (ISMS) */
function updateAssetPatch(assetId, patchStatus, patchDate) {
  try {
    const user = requireModule('asset', true);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    updateRow_(SHEETS.ASSET, a._row, {
      PatchStatus: sanitizeText(patchStatus, 60), PatchDate: parseDate(patchDate) || new Date()
    }, user.email);
    writeAudit_(user, 'UPDATE', 'asset', SHEETS.ASSET, assetId, 'patch: ' + patchStatus, 'success');
    return ok('ปรับปรุงสถานะ Patch เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** สร้าง/รีเฟรช QR Code ของทรัพย์สิน — คืน URL รูป QR */
function generateAssetQR(assetId) {
  try {
    const user = requireModule('asset', true);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    const url = buildAssetQrUrl_(a.AssetCode || a.AssetID, a.AssetName);
    updateRow_(SHEETS.ASSET, a._row, { QRCodeURL: url }, user.email);
    writeAudit_(user, 'QR', 'asset', SHEETS.ASSET, assetId, '', 'success');
    return ok({ url: url });
  } catch (e) { return fail(e.message); }
}

/** รายละเอียดทรัพย์สินรายตัว + ประวัติ (ยืมคืน/PM/License) */
function getAssetDetail(assetId) {
  try {
    requireModule('asset', false);
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    const movements = readSheetObjectsEnsured_(SHEETS.ASSET_MOVEMENT)
      .filter(function (m) { return String(m.AssetID) === String(assetId); })
      .map(function (m) {
        return { date: safeFmtDate_(m.ActionDate), action: m.ActionType, from: m.FromUser, to: m.ToUser, status: m.Status, notes: m.Notes };
      });
    const pm = readSheetObjectsEnsured_(SHEETS.MAINTENANCE)
      .filter(function (p) { return String(p.AssetID) === String(assetId); })
      .map(function (p) {
        return { date: safeFmtDate_(p.PlanDate), actual: safeFmtDate_(p.ActualDate), status: p.Status, technician: p.Technician, result: p.Result };
      });
    const licenses = readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE)
      .filter(function (l) { return String(l.AssignedTo || '').indexOf(assetId) > -1 || String(l.AssignedTo || '').indexOf(a.AssetName) > -1; })
      .map(function (l) { return { name: l.SoftwareName, type: l.LicenseType, expire: safeFmtDate_(l.ExpireDate) }; });
    return ok({ asset: serializeAsset_(a), movements: movements, pm: pm, licenses: licenses });
  } catch (e) { return fail(e.message); }
}

// ===== helpers =====
function generateAssetCode_(category) {
  const prefix = 'AS-' + (assetCategoryPrefix_(category) || 'GEN');
  const datePart = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMM');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return prefix + '-' + datePart + rand;
}

/** สร้าง URL รูป QR (บริการสาธารณะ ไม่ต้องยืนยันตัวตน) เข้ารหัสรหัสทรัพย์สิน */
function buildAssetQrUrl_(code, name) {
  const data = encodeURIComponent(String(code || '') + (name ? ' | ' + name : ''));
  return 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + data;
}

/** ตัวเลือก Vendor (id+ชื่อ) สำหรับ dropdown */
function getVendorOptions_() {
  try {
    return readSheetObjects_(SHEETS.VENDOR).map(function (r) { return { id: r.VendorID, name: r.VendorName }; });
  } catch (e) { return []; }
}

/**
 * บันทึกประวัติทรัพย์สินลงชีต Asset_History (ใช้ร่วมกับโมดูล Borrow/Return)
 * ActionType: Create/Update/Status/Retire/Assign/Return/Transfer
 * opts: { department, location, ticketId, evidence, status }
 */
function appendAssetHistory_(assetId, assetName, action, fromUser, toUser, notes, actorEmail, opts) {
  opts = opts || {};
  try {
    appendRowEnsured_(SHEETS.ASSET_MOVEMENT, {
      MovementID: generateId('MOV'),
      AssetID: assetId, AssetName: assetName, ActionType: action,
      FromUser: fromUser || '', ToUser: toUser || '',
      Department: opts.department || '', Location: opts.location || '',
      ActionDate: new Date(), RelatedTicketID: opts.ticketId || '',
      Status: opts.status || 'บันทึก', EvidenceLink: opts.evidence || '',
      Notes: sanitizeText(notes, 500),
      DueDate: opts.dueDate || '', Condition: opts.condition || ''
    }, actorEmail || 'system');
  } catch (e) {
    console.error('appendAssetHistory_ error: ' + e.message);
  }
}

// ===================================================================
// Borrow / Return / Transfer — service ร่วมกับ Asset
// ===================================================================

/** ยืม/มอบหมายทรัพย์สินให้ผู้ใช้ → สถานะ "ใช้งานอยู่" + อัปเดตเจ้าของ/แผนก/สถานที่ */
function assignAsset(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const a = assetForMovement_(form.assetId);
    const toUser = sanitizeText(form.toUser, 160);
    requireFields({ 'ผู้รับ/ผู้ถือครอง': toUser }, ['ผู้รับ/ผู้ถือครอง']);
    if (isAssetRetired_(a.Status)) throw new Error('ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว');
    const dept = sanitizeText(form.department, 120);
    const location = sanitizeText(form.location, 120);
    const email = sanitizeText(form.toEmail, 160);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลผู้รับไม่ถูกต้อง');
    const now = new Date();
    const dueDate = parseDate(form.dueDate);

    updateRow_(SHEETS.ASSET, a._row, {
      Status: ASSET_STATUS.IN_USE, OwnerName: toUser, Owner: toUser, OwnerEmail: email,
      Department: dept || a.Department, Location: location || a.Location,
      LoanDate: now, LoanDueDate: dueDate || ''
    }, user.email);
    appendAssetHistory_(a.AssetID, a.AssetName, 'Assign', a.OwnerName || a.Owner, toUser,
      sanitizeText(form.notes, 500), user.email,
      { department: dept, location: location, ticketId: form.ticketId, evidence: form.evidence, status: 'ยืม/ใช้งาน', dueDate: dueDate || '' });
    writeAudit_(user, 'ASSIGN', 'borrow', SHEETS.ASSET, a.AssetID, toUser + (dueDate ? ' (คืน ' + fmtDate(dueDate) + ')' : ''), 'success');
    return ok('บันทึกการยืม/มอบหมายเรียบร้อย' + (dueDate ? ' · กำหนดคืน ' + fmtDate(dueDate) : ''));
  } catch (e) { return fail(e.message); }
}

/** คืนทรัพย์สิน → สถานะ "พร้อมใช้งาน" + ล้างผู้ถือครอง */
function returnAsset(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const a = assetForMovement_(form.assetId);
    const location = sanitizeText(form.location, 120) || 'คลัง IT';
    const condition = sanitizeText(form.condition, 200);
    updateRow_(SHEETS.ASSET, a._row, {
      Status: ASSET_STATUS.AVAILABLE, OwnerName: '', Owner: '', OwnerEmail: '', Location: location,
      LoanDate: '', LoanDueDate: ''
    }, user.email);
    appendAssetHistory_(a.AssetID, a.AssetName, 'Return', a.OwnerName || a.Owner, '',
      sanitizeText(form.notes, 500), user.email,
      { location: location, ticketId: form.ticketId, evidence: form.evidence, status: 'คืนแล้ว', condition: condition });
    writeAudit_(user, 'RETURN', 'borrow', SHEETS.ASSET, a.AssetID, (a.OwnerName || a.Owner || '') + (condition ? ' · สภาพ: ' + condition : ''), 'success');
    return ok('บันทึกการคืนเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** โอนย้ายทรัพย์สินไปผู้ใช้/แผนก/สถานที่ใหม่ (สถานะคงเป็นใช้งานอยู่) */
function transferAsset(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const a = assetForMovement_(form.assetId);
    if (isAssetRetired_(a.Status)) throw new Error('ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว');
    const toUser = sanitizeText(form.toUser, 160);
    const dept = sanitizeText(form.department, 120);
    const location = sanitizeText(form.location, 120);
    const email = sanitizeText(form.toEmail, 160);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลผู้รับไม่ถูกต้อง');
    if (!toUser && !dept && !location) throw new Error('กรุณาระบุผู้รับ หรือแผนก/สถานที่ปลายทาง');

    const patch = { Status: ASSET_STATUS.IN_USE, LoanDate: new Date() };
    if (toUser) { patch.OwnerName = toUser; patch.Owner = toUser; patch.OwnerEmail = email; }
    if (dept) patch.Department = dept;
    if (location) patch.Location = location;
    const dueDate = parseDate(form.dueDate);
    if (form.dueDate !== undefined) patch.LoanDueDate = dueDate || '';
    updateRow_(SHEETS.ASSET, a._row, patch, user.email);
    appendAssetHistory_(a.AssetID, a.AssetName, 'Transfer', a.OwnerName || a.Owner, toUser || (a.OwnerName || a.Owner),
      sanitizeText(form.notes, 500), user.email,
      { department: dept, location: location, ticketId: form.ticketId, evidence: form.evidence, status: 'โอนย้าย', dueDate: dueDate || '' });
    writeAudit_(user, 'TRANSFER', 'borrow', SHEETS.ASSET, a.AssetID, toUser + ' / ' + dept + ' / ' + location, 'success');
    return ok('บันทึกการโอนย้ายเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function assetForMovement_(assetId) {
  const a = findRow_(SHEETS.ASSET, 'AssetID', sanitizeText(assetId, 80));
  if (!a) throw new Error('ไม่พบทรัพย์สิน กรุณาเลือกจากรายการ');
  return a;
}

/** ส่งทรัพย์สินเข้าซ่อม → สถานะ "ซ่อมบำรุง" (หยุดถือว่าถูกยืมอยู่) */
function sendAssetToRepair(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const a = assetForMovement_(form.assetId);
    if (isAssetRetired_(a.Status)) throw new Error('ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว');
    const vendor = sanitizeText(form.toUser, 160);
    updateRow_(SHEETS.ASSET, a._row, {
      Status: ASSET_STATUS.MAINTENANCE, LoanDate: '', LoanDueDate: ''
    }, user.email);
    appendAssetHistory_(a.AssetID, a.AssetName, 'ส่งซ่อม', a.OwnerName || a.Owner, vendor,
      sanitizeText(form.notes, 500), user.email,
      { location: sanitizeText(form.location, 120), ticketId: form.ticketId, evidence: form.evidence, status: 'ส่งซ่อม' });
    writeAudit_(user, 'REPAIR_SEND', 'borrow', SHEETS.ASSET, a.AssetID, vendor || '', 'success');
    return ok('บันทึกส่งซ่อมเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** รับทรัพย์สินคืนจากซ่อม → สถานะ "พร้อมใช้งาน" */
function returnAssetFromRepair(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const a = assetForMovement_(form.assetId);
    const location = sanitizeText(form.location, 120) || 'คลัง IT';
    updateRow_(SHEETS.ASSET, a._row, { Status: ASSET_STATUS.AVAILABLE, Location: location }, user.email);
    appendAssetHistory_(a.AssetID, a.AssetName, 'รับคืนจากซ่อม', '', '',
      sanitizeText(form.notes, 500), user.email,
      { location: location, ticketId: form.ticketId, evidence: form.evidence, status: 'ซ่อมเสร็จ', condition: sanitizeText(form.condition, 200) });
    writeAudit_(user, 'REPAIR_RETURN', 'borrow', SHEETS.ASSET, a.AssetID, '', 'success');
    return ok('บันทึกรับคืนจากซ่อมเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
