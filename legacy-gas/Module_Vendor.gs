/**
 * Module_Vendor.gs
 * ทะเบียนผู้ให้บริการ/ผู้ขาย และสัญญา (Vendor / Contract)
 * รองรับ ServiceType, ผู้ติดต่อ, เบอร์โทร/อีเมลแยกฟิลด์, ช่วงสัญญา, สถานะ Active/Inactive
 * อ้างอิง: การควบคุมผู้ให้บริการภายนอก · ผูก VendorID กับ Asset/License ได้
 */

const VENDOR_SERVICE_TYPES = ['ร้านซ่อม', 'ผู้ขายอุปกรณ์', 'Software', 'Internet Provider', 'ผู้ให้บริการ MA', 'Cloud', 'อื่นๆ'];
const VENDOR_STATUSES = ['Active', 'Inactive'];

function getVendorModuleData() {
  try {
    const user = requireModule('vendor', false);
    const vendors = readSheetObjects_(SHEETS.VENDOR).map(function (r) {
      return {
        row: r._row, id: r.VendorID, name: r.VendorName,
        serviceType: r.ServiceType, scope: r.ServiceScope,
        contractNo: r.ContractNo, start: fmtDate(r.ContractStart), end: fmtDate(r.ContractExpiry),
        expiry: fmtDate(r.ContractExpiry), expiryDays: daysUntil(r.ContractExpiry),
        contact: r.ContactPerson, phone: r.Phone, email: r.Email, contactInfo: r.ContactInfo,
        owner: r.Owner, assessment: r.AssessmentResult, assessmentDate: fmtDate(r.AssessmentDate),
        status: r.Status || 'Active', notes: r.Notes
      };
    });
    return ok({
      role: user.role, canEdit: canEditModule(user.role, 'vendor'),
      serviceTypes: VENDOR_SERVICE_TYPES, statuses: VENDOR_STATUSES, vendors: vendors
    });
  } catch (e) { return fail(e.message); }
}

function addVendor(form) {
  try {
    const user = requireModule('vendor', true);
    form = form || {};
    const name = sanitizeText(form.name, 200);
    requireFields({ 'ชื่อผู้ให้บริการ': name }, ['ชื่อผู้ให้บริการ']);
    const email = sanitizeText(form.email, 160);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    const status = sanitizeText(form.status, 40) || 'Active';
    if (!isInList(status, VENDOR_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
    const id = generateId('VND');
    appendRow_(SHEETS.VENDOR, {
      VendorID: id, VendorName: name,
      ServiceType: sanitizeText(form.serviceType, 120), ServiceScope: sanitizeText(form.scope, 500),
      ContractNo: sanitizeText(form.contractNo, 100), ContractStart: parseDate(form.start),
      ContractExpiry: parseDate(form.end || form.expiry),
      ContactPerson: sanitizeText(form.contact, 120), Phone: sanitizeText(form.phone, 60), Email: email,
      ContactInfo: sanitizeText(form.contactInfo, 200),
      Owner: sanitizeText(form.owner, 120) || user.email,
      Status: status, Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'vendor', SHEETS.VENDOR, id, name, 'success');
    return ok('บันทึกผู้ให้บริการเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateVendor(vendorId, form) {
  try {
    const user = requireModule('vendor', true);
    const v = findRow_(SHEETS.VENDOR, 'VendorID', vendorId);
    if (!v) throw new Error('ไม่พบผู้ให้บริการ');
    form = form || {};
    const patch = {};
    const setText = function (key, fk, len) { if (form[fk] !== undefined) patch[key] = sanitizeText(form[fk], len); };
    setText('VendorName', 'name', 200);
    setText('ServiceType', 'serviceType', 120);
    setText('ServiceScope', 'scope', 500);
    setText('ContractNo', 'contractNo', 100);
    setText('ContactPerson', 'contact', 120);
    setText('Phone', 'phone', 60);
    setText('ContactInfo', 'contactInfo', 200);
    setText('Owner', 'owner', 120);
    setText('Notes', 'notes', 500);
    if (form.email !== undefined) {
      const email = sanitizeText(form.email, 160);
      if (email && !isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
      patch.Email = email;
    }
    if (form.start !== undefined) patch.ContractStart = parseDate(form.start);
    if (form.end !== undefined || form.expiry !== undefined) patch.ContractExpiry = parseDate(form.end || form.expiry);
    if (form.status !== undefined && form.status !== '') {
      const st = sanitizeText(form.status, 40);
      if (!isInList(st, VENDOR_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
      patch.Status = st;
    }
    updateRow_(SHEETS.VENDOR, v._row, patch, user.email);
    writeAudit_(user, 'UPDATE', 'vendor', SHEETS.VENDOR, vendorId, JSON.stringify(patch), 'success');
    return ok('แก้ไขผู้ให้บริการเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** ปิด/เปิดใช้งานผู้ให้บริการแบบปลอดภัย */
function setVendorStatus(vendorId, status) {
  try {
    const user = requireModule('vendor', true);
    const v = findRow_(SHEETS.VENDOR, 'VendorID', vendorId);
    if (!v) throw new Error('ไม่พบผู้ให้บริการ');
    status = sanitizeText(status, 40);
    if (!isInList(status, VENDOR_STATUSES)) throw new Error('สถานะไม่ถูกต้อง');
    updateRow_(SHEETS.VENDOR, v._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'vendor', SHEETS.VENDOR, vendorId, status, 'success');
    return ok('ปรับสถานะผู้ให้บริการเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function assessVendor(vendorId, result) {
  try {
    const user = requireModule('vendor', true);
    const v = findRow_(SHEETS.VENDOR, 'VendorID', vendorId);
    if (!v) throw new Error('ไม่พบผู้ให้บริการ');
    requireFields({ result: result }, ['result']);
    updateRow_(SHEETS.VENDOR, v._row, {
      AssessmentResult: sanitizeText(result, 1000), AssessmentDate: new Date()
    }, user.email);
    writeAudit_(user, 'ASSESS', 'vendor', SHEETS.VENDOR, vendorId, sanitizeText(result, 200), 'success');
    return ok('บันทึกผลการประเมิน/ตรวจรับเรียบร้อย');
  } catch (e) { return fail(e.message); }
}
