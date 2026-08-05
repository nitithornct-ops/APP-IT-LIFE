/**
 * Module_AssetExtras.gs
 * ส่วนเสริมของโมดูลทรัพย์สิน IT:
 *  1) หมวดหมู่ทรัพย์สิน (CRUD) — เก็บในชีต AssetCategories, มี CodePrefix สำหรับสร้างรหัสอัตโนมัติ
 *  2) การตรวจนับทรัพย์สิน (Stock-take) — verifyAsset บันทึกวัน/ผู้ตรวจ/ผลการพบ
 *  3) รายงานวิเคราะห์ทรัพย์สิน (getAssetAnalytics) — มูลค่า, ค่าเสื่อม, สถานะ, อายุ, ประกัน, การตรวจนับ
 *
 * อ้างอิงค่าคงที่จาก Module_Asset.gs (ASSET_STATUS, ASSET_CATEGORIES, isAssetRetired_, computeAssetDepreciation_ ฯลฯ)
 */

// ===================================================================
// 1) หมวดหมู่ทรัพย์สิน
// ===================================================================
function assetCategorySeed_() {
  return [
    { name: 'Computer', prefix: 'PC' }, { name: 'Notebook', prefix: 'NB' },
    { name: 'Printer', prefix: 'PRN' }, { name: 'Network', prefix: 'NET' },
    { name: 'Server', prefix: 'SRV' }, { name: 'Software', prefix: 'SW' },
    { name: 'อื่นๆ', prefix: 'GEN' }
  ];
}

/** สร้างชีตหมวดหมู่ + ใส่ค่าตั้งต้นครั้งแรก (ถ้ายังว่าง) */
function seedAssetCategories_() {
  ensureSheetBySchema_(SHEETS.ASSET_CATEGORY);
  if (readSheetObjects_(SHEETS.ASSET_CATEGORY).length === 0) {
    assetCategorySeed_().forEach(function (c) {
      appendRow_(SHEETS.ASSET_CATEGORY, {
        CategoryID: generateId('ACAT'), CategoryName: c.name, CodePrefix: c.prefix,
        Status: 'Active', Notes: ''
      }, 'system');
    });
  }
}

function getActiveAssetCategories_() {
  seedAssetCategories_();
  return readSheetObjects_(SHEETS.ASSET_CATEGORY)
    .filter(function (r) { return !r.Status || String(r.Status).toLowerCase() === 'active'; })
    .map(function (r) { return { id: r.CategoryID, name: r.CategoryName, prefix: r.CodePrefix, status: r.Status, notes: r.Notes }; });
}

/** รายชื่อหมวดหมู่ที่ใช้งานอยู่ (fallback เป็นค่าคงที่เดิมถ้าอ่านไม่ได้) */
function assetCategoryNames_() {
  try {
    const names = getActiveAssetCategories_().map(function (c) { return c.name; }).filter(String);
    return names.length ? names : ASSET_CATEGORIES;
  } catch (e) { return ASSET_CATEGORIES; }
}

function isValidAssetCategory_(name) {
  return assetCategoryNames_().indexOf(String(name)) > -1;
}

/** คืน CodePrefix ของหมวดหมู่ (สำหรับสร้างรหัสทรัพย์สิน) */
function assetCategoryPrefix_(name) {
  try {
    const hit = getActiveAssetCategories_().filter(function (c) { return c.name === String(name); })[0];
    if (hit && hit.prefix) return String(hit.prefix).toUpperCase();
  } catch (e) {}
  const legacy = { Computer: 'PC', Notebook: 'NB', Printer: 'PRN', Network: 'NET', Server: 'SRV', Software: 'SW' };
  return legacy[name] || 'GEN';
}

function getAssetCategoriesAdmin() {
  try {
    requireRole([ROLES.IT_ADMIN]);
    seedAssetCategories_();
    const cats = readSheetObjects_(SHEETS.ASSET_CATEGORY).map(function (r) {
      return { id: r.CategoryID, name: r.CategoryName, prefix: r.CodePrefix, status: r.Status || 'Active', notes: r.Notes };
    });
    return ok({ categories: cats });
  } catch (e) { return fail(e.message); }
}

function saveAssetCategory(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    const name = sanitizeText(form.name, 60);
    requireFields({ 'ชื่อหมวดหมู่': name }, ['ชื่อหมวดหมู่']);
    let prefix = sanitizeText(form.prefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) prefix = 'GEN';
    const status = sanitizeText(form.status, 20) || 'Active';
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    ensureSheetBySchema_(SHEETS.ASSET_CATEGORY);

    const existing = readSheetObjects_(SHEETS.ASSET_CATEGORY);
    const dup = existing.filter(function (r) {
      return String(r.CategoryName).trim() === name && String(r.CategoryID) !== String(form.id || '');
    });
    if (dup.length) throw new Error('มีหมวดหมู่ชื่อนี้อยู่แล้ว');

    const payload = { CategoryName: name, CodePrefix: prefix, Status: status, Notes: sanitizeText(form.notes, 300) };
    if (form.id) {
      const row = findRow_(SHEETS.ASSET_CATEGORY, 'CategoryID', form.id);
      if (!row) throw new Error('ไม่พบหมวดหมู่ที่ต้องการแก้ไข');
      updateRow_(SHEETS.ASSET_CATEGORY, row._row, payload, user.email);
      writeAudit_(user, 'UPDATE', 'asset', SHEETS.ASSET_CATEGORY, form.id, name, 'success');
      return ok('แก้ไขหมวดหมู่เรียบร้อย');
    }
    const id = generateId('ACAT');
    payload.CategoryID = id;
    appendRow_(SHEETS.ASSET_CATEGORY, payload, user.email);
    writeAudit_(user, 'CREATE', 'asset', SHEETS.ASSET_CATEGORY, id, name, 'success');
    return ok('เพิ่มหมวดหมู่เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setAssetCategoryStatus(id, status) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    status = sanitizeText(status, 20);
    if (['Active', 'Inactive'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    const row = findRow_(SHEETS.ASSET_CATEGORY, 'CategoryID', id);
    if (!row) throw new Error('ไม่พบหมวดหมู่');
    updateRow_(SHEETS.ASSET_CATEGORY, row._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'asset', SHEETS.ASSET_CATEGORY, id, status, 'success');
    return ok('ปรับสถานะหมวดหมู่เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 2) การตรวจนับทรัพย์สิน (Stock-take)
// ===================================================================
const ASSET_AUDIT_RESULTS = ['พบ/ตรงตำแหน่ง', 'พบ/ผิดตำแหน่ง', 'ไม่พบ/สูญหาย'];

function getAssetAuditCycleDays_() {
  return clampNumber_(getConfig_('ASSET_AUDIT_CYCLE_DAYS', '180'), 30, 730, 180);
}

/**
 * บันทึกผลการตรวจนับทรัพย์สินรายตัว
 * result: พบ/ตรงตำแหน่ง | พบ/ผิดตำแหน่ง | ไม่พบ/สูญหาย
 * ถ้าพบผิดตำแหน่งและระบุสถานที่จริง จะอัปเดต Location ให้ · ถ้าไม่พบจะปรับสถานะเป็น "สูญหาย"
 */
function verifyAsset(assetId, result, form) {
  try {
    const user = requireModule('asset', true);
    ensureSheetBySchema_(SHEETS.ASSET); // ให้แน่ใจว่ามีคอลัมน์ตรวจนับก่อนเขียน
    const a = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    if (!a) throw new Error('ไม่พบทรัพย์สิน');
    result = sanitizeText(result, 40);
    if (ASSET_AUDIT_RESULTS.indexOf(result) === -1) throw new Error('ผลการตรวจนับไม่ถูกต้อง');
    form = form || {};
    const note = sanitizeText(form.note, 300);
    const foundLocation = sanitizeText(form.location, 120);

    const patch = { LastAuditDate: new Date(), LastAuditBy: user.email, AuditStatus: result };
    if (result === 'พบ/ผิดตำแหน่ง' && foundLocation) patch.Location = foundLocation;
    if (result === 'ไม่พบ/สูญหาย') patch.Status = ASSET_STATUS.LOST;
    updateRow_(SHEETS.ASSET, a._row, patch, user.email);

    appendAssetHistory_(assetId, a.AssetName, 'Audit', '', user.email,
      'ตรวจนับ: ' + result + (foundLocation ? ' @' + foundLocation : '') + (note ? ' — ' + note : ''), user.email,
      { location: foundLocation, status: result });
    writeAudit_(user, 'AUDIT_VERIFY', 'asset', SHEETS.ASSET, assetId, result, 'success');
    return ok('บันทึกผลการตรวจนับเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 3) รายงานวิเคราะห์ทรัพย์สิน
// ===================================================================
function getAssetAnalytics() {
  try {
    const user = requireModule('asset', false);
    if (user.role === ROLES.USER) throw new Error('บทบาทนี้ไม่มีสิทธิ์ดูรายงานวิเคราะห์');
    const cycle = getAssetAuditCycleDays_();
    const rows = readSheetObjects_(SHEETS.ASSET);

    let total = 0, active = 0, totalValue = 0, totalBook = 0;
    const byStatus = {}, byCategory = {}, byDept = {};
    const warranty = { expired: 0, soon30: 0, soon90: 0, later: 0 };
    const age = { y0: 0, y1: 0, y3: 0, y5: 0 };
    const audit = { verified: 0, due: 0, missing: 0 };
    const bump = function (m, k) { k = String(k || 'ไม่ระบุ'); m[k] = (m[k] || 0) + 1; };

    rows.forEach(function (r) {
      total++;
      const status = String(r.Status || '');
      bump(byStatus, status);
      const retired = isAssetRetired_(status);
      const dep = computeAssetDepreciation_(r.Price, r.PurchaseDate, r.UsefulLifeYears);
      if (retired) return;

      active++;
      const price = Number(r.Price) || 0;
      totalValue += price;
      totalBook += (dep.bookValue || 0);

      const ck = String(r.Category || r.AssetType || 'ไม่ระบุ');
      byCategory[ck] = byCategory[ck] || { count: 0, value: 0 };
      byCategory[ck].count++; byCategory[ck].value += price;
      bump(byDept, r.Department);

      if (r.WarrantyExpire) {
        const w = daysUntil(r.WarrantyExpire);
        if (w < 0) warranty.expired++;
        else if (w <= 30) warranty.soon30++;
        else if (w <= 90) warranty.soon90++;
        else warranty.later++;
      }
      if (dep.ageYears !== null) {
        const y = dep.ageYears;
        if (y < 1) age.y0++; else if (y < 3) age.y1++; else if (y < 5) age.y3++; else age.y5++;
      }
      const ad = daysSince_(r.LastAuditDate);
      if (String(r.AuditStatus || '').indexOf('ไม่พบ') > -1) audit.missing++;
      else if (ad !== null && ad <= cycle) audit.verified++;
      else audit.due++;
    });

    const catArr = Object.keys(byCategory).map(function (k) {
      return { label: k, count: byCategory[k].count, value: Math.round(byCategory[k].value) };
    }).sort(function (a, b) { return b.value - a.value; });
    const toArr = function (m) {
      return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; })
        .sort(function (a, b) { return b.value - a.value; });
    };

    return ok({
      total: total, active: active,
      totalValue: Math.round(totalValue), totalBookValue: Math.round(totalBook),
      byStatus: toArr(byStatus), byCategory: catArr, byDepartment: toArr(byDept),
      warranty: warranty, age: age, audit: audit, auditCycleDays: cycle
    });
  } catch (e) { return fail(e.message); }
}
