/**
 * Module_Employee.gs
 * ทะเบียนพนักงานและทรัพย์สินที่ครอบครอง
 *
 * แยก Employees ออกจาก Users เพื่อไม่ผูกข้อมูล HR เข้ากับบัญชีล็อกอินโดยตรง
 * EmployeeAssignments เก็บรายการครอบครองแบบ 1 พนักงานต่อหลายรายการ และเชื่อม AssetRegister
 * ด้วย AssetID เมื่อเป็นทรัพย์สินที่มีอยู่ในทะเบียนกลาง
 */

const EMPLOYEE_STATUSES_ = ['Active', 'Inactive'];
const EMPLOYEE_ASSIGNMENT_STATUSES_ = ['ครอบครอง', 'คืนแล้ว', 'ส่งซ่อม', 'สูญหาย'];
const EMPLOYEE_ASSET_CATEGORIES_ = [
  'Computer', 'Notebook', 'Monitor', 'iPad', 'โทรศัพท์มือถือ',
  'IP Phone Yealink', 'Printer', 'Scanner', 'Software', 'Network', 'อื่นๆ'
];

function employeeTextKey_(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function employeeFullName_(row) {
  return [row.PrefixTH, row.FirstNameTH, row.LastNameTH]
    .filter(function (value) { return String(value || '').trim(); })
    .join(' ').replace(/\s+/g, ' ').trim();
}

function employeeEnglishName_(row) {
  return [row.PrefixEN, row.FirstNameEN, row.LastNameEN]
    .filter(function (value) { return String(value || '').trim(); })
    .join(' ').replace(/\s+/g, ' ').trim();
}

function employeeRowToObj_(row) {
  return {
    row: row._row,
    id: row.EmployeeID,
    employeeCode: row.EmployeeCode || '',
    prefixTH: row.PrefixTH || '',
    firstNameTH: row.FirstNameTH || '',
    lastNameTH: row.LastNameTH || '',
    fullName: employeeFullName_(row),
    nickname: row.Nickname || '',
    prefixEN: row.PrefixEN || '',
    firstNameEN: row.FirstNameEN || '',
    lastNameEN: row.LastNameEN || '',
    englishName: employeeEnglishName_(row),
    position: row.Position || '',
    department: row.Department || '',
    usernameAD: row.UsernameAD || '',
    upn: row.UPN || '',
    email: row.Email || '',
    status: row.Status || 'Active',
    notes: row.Notes || '',
    createdAt: safeFmtDateTime_(row.Timestamp),
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt)
  };
}

function employeeAssignmentCurrent_(status) {
  return status === 'ครอบครอง' || status === 'ส่งซ่อม';
}

function employeeAssignmentToObj_(row) {
  const status = row.Status || 'ครอบครอง';
  return {
    id: 'assignment:' + row.AssignmentID,
    assignmentId: row.AssignmentID,
    employeeId: row.EmployeeID,
    employeeCode: row.EmployeeCode || '',
    source: 'ทะเบียนพนักงาน',
    editable: true,
    category: row.Category || 'อื่นๆ',
    itemName: row.ItemName || row.SoftwareName || '',
    assetId: row.AssetID || '',
    assetCode: row.AssetCode || '',
    ipAddress: row.IPAddressDHCP || '',
    producer: row.Producer || '',
    model: row.Model || '',
    macAddress: row.MacAddress || '',
    assetNumber: row.AssetNumber || '',
    serialNumber: row.SerialNumber || '',
    osSystem: row.OSSystem || '',
    hardwareSpec: row.HardwareSpec || '',
    softwareName: row.SoftwareName || '',
    softwareLicense: row.SoftwareLicense || '',
    phoneNumber: row.PhoneNumber || '',
    scanUser: row.ScanUser || '',
    scanFolder: row.ScanFolder || '',
    status: status,
    current: employeeAssignmentCurrent_(status),
    assignedDate: safeFmtDate_(row.AssignedDate),
    returnedDate: safeFmtDate_(row.ReturnedDate),
    notes: row.Notes || '',
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt || row.Timestamp)
  };
}

function employeeFindForAsset_(asset, maps) {
  const byCode = maps.byCode[employeeTextKey_(asset.OwnerEmployeeCode)];
  if (byCode) return byCode;
  const byEmail = maps.byEmail[employeeTextKey_(asset.OwnerEmail)];
  if (byEmail) return byEmail;
  return maps.byName[employeeTextKey_(asset.OwnerName || asset.Owner)] || null;
}

function employeeAssignedToMatches_(assignedTo, employee) {
  const text = employeeTextKey_(assignedTo);
  if (!text) return false;
  const parts = String(assignedTo || '').split(/[,;\n|]+/).map(employeeTextKey_);
  const candidates = [
    employee.employeeCode, employee.email, employee.upn,
    employee.usernameAD, employee.fullName, employee.englishName
  ].map(employeeTextKey_).filter(String);
  return candidates.some(function (candidate) {
    return text === candidate || parts.indexOf(candidate) > -1;
  });
}

function employeeAssetIsRetired_(status) {
  const value = employeeTextKey_(status);
  return value === 'retired' || value === 'จำหน่าย/เลิกใช้' || value === 'สูญหาย';
}

function employeeExternalAssetHolding_(row, employee) {
  return {
    id: 'asset:' + row.AssetID,
    assignmentId: '',
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    source: 'IT Asset',
    editable: false,
    category: row.Category || row.AssetType || 'อื่นๆ',
    itemName: row.AssetName || '',
    assetId: row.AssetID || '',
    assetCode: row.AssetCode || '',
    ipAddress: row.IPAddressDHCP || '',
    producer: row.Brand || row.Vendor || '',
    model: row.Model || '',
    macAddress: row.MacAddress || '',
    assetNumber: row.AssetCode || '',
    serialNumber: row.SerialNumber || '',
    osSystem: row.OSSystem || '',
    hardwareSpec: row.HardwareSpec || '',
    softwareName: '',
    softwareLicense: row.LicenseNo || '',
    phoneNumber: '',
    scanUser: '',
    scanFolder: '',
    status: 'ครอบครอง',
    current: true,
    assignedDate: safeFmtDate_(row.LoanDate || row.Timestamp),
    returnedDate: '',
    notes: row.Remark || row.Notes || '',
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt || row.Timestamp)
  };
}

function employeeSoftwareHolding_(row, employee) {
  return {
    id: 'license:' + row.LicenseID,
    assignmentId: '',
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    source: 'Software License',
    editable: false,
    category: 'Software',
    itemName: row.SoftwareName || '',
    assetId: '',
    assetCode: row.LicenseID || '',
    ipAddress: '',
    producer: '',
    model: row.LicenseType || '',
    macAddress: '',
    assetNumber: '',
    serialNumber: '',
    osSystem: '',
    hardwareSpec: '',
    softwareName: row.SoftwareName || '',
    softwareLicense: row.LicenseType || '',
    phoneNumber: '',
    scanUser: '',
    scanFolder: '',
    status: 'ครอบครอง',
    current: true,
    assignedDate: safeFmtDate_(row.StartDate),
    returnedDate: '',
    notes: row.Notes || '',
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt || row.Timestamp)
  };
}

function buildEmployeeHoldings_(employees, assignmentRows, assetRows, licenseRows) {
  const holdings = {};
  const maps = { byId: {}, byCode: {}, byEmail: {}, byName: {} };
  employees.forEach(function (employee) {
    holdings[employee.id] = [];
    maps.byId[employee.id] = employee;
    if (employee.employeeCode) maps.byCode[employeeTextKey_(employee.employeeCode)] = employee;
    if (employee.email) maps.byEmail[employeeTextKey_(employee.email)] = employee;
    if (employee.fullName && !maps.byName[employeeTextKey_(employee.fullName)]) {
      maps.byName[employeeTextKey_(employee.fullName)] = employee;
    }
  });

  const linkedAssetIds = {};
  assignmentRows.forEach(function (row) {
    const employee = maps.byId[row.EmployeeID] || maps.byCode[employeeTextKey_(row.EmployeeCode)];
    if (!employee) return;
    const item = employeeAssignmentToObj_(row);
    holdings[employee.id].push(item);
    if (item.current && item.assetId) linkedAssetIds[item.assetId] = true;
  });

  assetRows.forEach(function (row) {
    if (employeeAssetIsRetired_(row.Status) || linkedAssetIds[row.AssetID]) return;
    const employee = employeeFindForAsset_(row, maps);
    if (employee) holdings[employee.id].push(employeeExternalAssetHolding_(row, employee));
  });

  licenseRows.forEach(function (row) {
    if (employeeTextKey_(row.Status) === 'inactive' || !row.AssignedTo) return;
    employees.forEach(function (employee) {
      if (employeeAssignedToMatches_(row.AssignedTo, employee)) {
        holdings[employee.id].push(employeeSoftwareHolding_(row, employee));
      }
    });
  });

  Object.keys(holdings).forEach(function (employeeId) {
    holdings[employeeId].sort(function (a, b) {
      if (a.current !== b.current) return a.current ? -1 : 1;
      const category = String(a.category || '').localeCompare(String(b.category || ''));
      return category || String(a.itemName || '').localeCompare(String(b.itemName || ''));
    });
  });
  return holdings;
}

function getEmployeeModuleData() {
  try {
    const user = requireModule('employees', false);
    const employees = readSheetObjectsEnsured_(SHEETS.EMPLOYEES).map(employeeRowToObj_);
    const assignments = readSheetObjectsEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS);
    const assets = readSheetObjectsEnsured_(SHEETS.ASSET);
    const licenses = readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE);
    const holdings = buildEmployeeHoldings_(employees, assignments, assets, licenses);
    const lifecycles = employeeLifecycleRows_().sort(function (a, b) {
      return (b.createdAtEpoch || 0) - (a.createdAtEpoch || 0);
    });
    const lifecycleByEmployee = {};
    lifecycles.forEach(function (item) {
      if (!lifecycleByEmployee[item.employeeId]) lifecycleByEmployee[item.employeeId] = item;
    });
    const users = readSheetObjects_(SHEETS.USERS);
    const userByCode = {};
    const userByEmail = {};
    users.forEach(function (row) {
      if (row.EmployeeCode) userByCode[employeeTextKey_(row.EmployeeCode)] = row;
      if (row.Email) userByEmail[employeeTextKey_(row.Email)] = row;
    });

    employees.forEach(function (employee) {
      employee.holdings = holdings[employee.id] || [];
      employee.holdingCount = employee.holdings.filter(function (item) { return item.current; }).length;
      employee.deviceCount = employee.holdings.filter(function (item) {
        return item.current && item.category !== 'Software';
      }).length;
      employee.softwareCount = employee.holdings.filter(function (item) {
        return item.current && item.category === 'Software';
      }).length;
      const account = userByCode[employeeTextKey_(employee.employeeCode)] ||
        userByEmail[employeeTextKey_(employee.email)];
      employee.systemAccount = account ? {
        id: account.UserID,
        role: account.Role,
        status: account.Status,
        email: account.Email
      } : null;
      employee.lifecycle = lifecycleByEmployee[employee.id] || null;
    });

    employees.sort(function (a, b) {
      const activeA = employeeTextKey_(a.status) === 'active' ? 0 : 1;
      const activeB = employeeTextKey_(b.status) === 'active' ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      const dept = String(a.department || '').localeCompare(String(b.department || ''));
      return dept || String(a.fullName || '').localeCompare(String(b.fullName || ''));
    });

    const departments = {};
    employees.forEach(function (employee) {
      if (employee.department) departments[employee.department] = true;
    });
    users.forEach(function (row) {
      if (row.Department) departments[row.Department] = true;
    });

    const assetOptions = assets.filter(function (row) {
      return !employeeAssetIsRetired_(row.Status);
    }).map(function (row) {
      return {
        value: row.AssetID,
        label: (row.AssetCode ? row.AssetCode + ' · ' : '') + (row.AssetName || row.AssetID),
        code: row.AssetCode || '',
        name: row.AssetName || '',
        category: row.Category || row.AssetType || '',
        producer: row.Brand || row.Vendor || '',
        model: row.Model || '',
        serialNumber: row.SerialNumber || '',
        currentOwner: row.OwnerName || row.Owner || '',
        currentOwnerEmail: row.OwnerEmail || '',
        currentOwnerEmployeeCode: row.OwnerEmployeeCode || ''
      };
    });

    return ok({
      canEdit: canEditModule(user.role, 'employees'),
      statuses: EMPLOYEE_STATUSES_,
      assignmentStatuses: EMPLOYEE_ASSIGNMENT_STATUSES_,
      categories: EMPLOYEE_ASSET_CATEGORIES_,
      departments: Object.keys(departments).sort(),
      assetOptions: assetOptions,
      lifecycles: lifecycles.slice(0, 200),
      employees: employees
    });
  } catch (e) {
    return fail(e.message);
  }
}

function validateEmployeeUnique_(employeeId, employeeCode, email) {
  const codeKey = employeeTextKey_(employeeCode);
  const emailKey = employeeTextKey_(email);
  const duplicate = readSheetObjectsEnsured_(SHEETS.EMPLOYEES).filter(function (row) {
    return String(row.EmployeeID) !== String(employeeId || '');
  });
  if (duplicate.some(function (row) { return employeeTextKey_(row.EmployeeCode) === codeKey; })) {
    throw new Error('มีรหัสพนักงานนี้ในทะเบียนแล้ว');
  }
  if (emailKey && duplicate.some(function (row) { return employeeTextKey_(row.Email) === emailKey; })) {
    throw new Error('มี Email นี้ในทะเบียนพนักงานแล้ว');
  }
}

function saveEmployee(employeeId, form) {
  try {
    const user = requireModule('employees', true);
    employeeId = sanitizeText(employeeId, 100);
    form = form || {};
    const employeeCode = sanitizeText(form.employeeCode, 80);
    const firstNameTH = sanitizeText(form.firstNameTH, 120);
    const lastNameTH = sanitizeText(form.lastNameTH, 120);
    const email = sanitizeText(form.email, 160).toLowerCase();
    const status = sanitizeText(form.status, 30) || 'Active';
    requireFields({
      'รหัสพนักงาน': employeeCode,
      'ชื่อ': firstNameTH,
      'นามสกุล': lastNameTH
    }, ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล']);
    if (email && !isValidEmail(email)) throw new Error('รูปแบบ Email ไม่ถูกต้อง');
    if (!isInList(status, EMPLOYEE_STATUSES_)) throw new Error('สถานะพนักงานไม่ถูกต้อง');
    validateEmployeeUnique_(employeeId, employeeCode, email);

    const patch = {
      EmployeeCode: employeeCode,
      PrefixTH: sanitizeText(form.prefixTH, 40),
      FirstNameTH: firstNameTH,
      LastNameTH: lastNameTH,
      Nickname: sanitizeText(form.nickname, 80),
      PrefixEN: sanitizeText(form.prefixEN, 40),
      FirstNameEN: sanitizeText(form.firstNameEN, 120),
      LastNameEN: sanitizeText(form.lastNameEN, 120),
      Position: sanitizeText(form.position, 160),
      Department: sanitizeText(form.department, 160),
      UsernameAD: sanitizeText(form.usernameAD, 160),
      UPN: sanitizeText(form.upn, 200),
      Email: email,
      Status: status,
      Notes: sanitizeText(form.notes, 1500)
    };

    if (employeeId) {
      const current = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', employeeId);
      if (!current) throw new Error('ไม่พบพนักงาน');
      updateRow_(SHEETS.EMPLOYEES, current._row, patch, user.email);
      if (String(current.EmployeeCode || '') !== employeeCode) {
        readSheetObjectsEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS).forEach(function (row) {
          if (String(row.EmployeeID) === employeeId) {
            updateRow_(SHEETS.EMPLOYEE_ASSIGNMENTS, row._row, { EmployeeCode: employeeCode }, user.email);
          }
        });
      }
      writeAudit_(user, 'UPDATE', 'employees', SHEETS.EMPLOYEES, employeeId,
        employeeCode + ' · ' + firstNameTH + ' ' + lastNameTH, 'success');
      return ok('อัปเดตข้อมูลพนักงานเรียบร้อย');
    }

    employeeId = generateId('EMP');
    patch.EmployeeID = employeeId;
    appendRowEnsured_(SHEETS.EMPLOYEES, patch, user.email);
    writeAudit_(user, 'CREATE', 'employees', SHEETS.EMPLOYEES, employeeId,
      employeeCode + ' · ' + firstNameTH + ' ' + lastNameTH, 'success');
    return ok('เพิ่มพนักงานเรียบร้อย (' + employeeCode + ')');
  } catch (e) {
    return fail(e.message);
  }
}

function setEmployeeStatus(employeeId, status) {
  try {
    const user = requireModule('employees', true);
    employeeId = sanitizeText(employeeId, 100);
    status = sanitizeText(status, 30);
    if (!isInList(status, EMPLOYEE_STATUSES_)) throw new Error('สถานะพนักงานไม่ถูกต้อง');
    const employee = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', employeeId);
    if (!employee) throw new Error('ไม่พบพนักงาน');
    updateRow_(SHEETS.EMPLOYEES, employee._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'employees', SHEETS.EMPLOYEES,
      employeeId, String(employee.Status || '') + ' -> ' + status, 'success');
    return ok('ปรับสถานะพนักงานเป็น ' + status + ' แล้ว');
  } catch (e) {
    return fail(e.message);
  }
}

function employeeAssetOwnedByOther_(asset, employee) {
  const ownerCode = employeeTextKey_(asset.OwnerEmployeeCode);
  const ownerEmail = employeeTextKey_(asset.OwnerEmail);
  const ownerName = employeeTextKey_(asset.OwnerName || asset.Owner);
  if (!ownerCode && !ownerEmail && !ownerName) return false;
  return !(
    (ownerCode && ownerCode === employeeTextKey_(employee.EmployeeCode)) ||
    (ownerEmail && ownerEmail === employeeTextKey_(employee.Email)) ||
    (ownerName && ownerName === employeeTextKey_(employeeFullName_(employee)))
  );
}

function syncEmployeeAssignmentAsset_(assignment, employee, actorEmail) {
  if (!assignment.AssetID) return;
  const asset = findRowEnsured_(SHEETS.ASSET, 'AssetID', assignment.AssetID);
  if (!asset) return;
  const status = assignment.Status || 'ครอบครอง';
  const patch = {};
  if (employeeAssignmentCurrent_(status) || status === 'สูญหาย') {
    patch.OwnerEmployeeCode = employee.EmployeeCode || '';
    patch.OwnerName = employeeFullName_(employee);
    patch.Owner = patch.OwnerName;
    patch.OwnerEmail = employee.Email || '';
    patch.Department = employee.Department || '';
    patch.IPAddressDHCP = assignment.IPAddressDHCP || asset.IPAddressDHCP || '';
    patch.MacAddress = assignment.MacAddress || asset.MacAddress || '';
    patch.OSSystem = assignment.OSSystem || asset.OSSystem || '';
    patch.HardwareSpec = assignment.HardwareSpec || asset.HardwareSpec || '';
    patch.Status = status === 'ส่งซ่อม' ? 'ซ่อมบำรุง' :
      (status === 'สูญหาย' ? 'สูญหาย' : 'ใช้งานอยู่');
  } else if (!employeeAssetOwnedByOther_(asset, employee)) {
    patch.OwnerEmployeeCode = '';
    patch.OwnerName = '';
    patch.Owner = '';
    patch.OwnerEmail = '';
    patch.Department = '';
    patch.Status = 'พร้อมใช้งาน';
  }
  if (Object.keys(patch).length) updateRow_(SHEETS.ASSET, asset._row, patch, actorEmail);
}

function employeeAssignmentPatch_(employee, form, current) {
  const category = sanitizeText(form.category, 80) || (current && current.Category) || 'อื่นๆ';
  const status = sanitizeText(form.status, 40) || (current && current.Status) || 'ครอบครอง';
  if (!isInList(category, EMPLOYEE_ASSET_CATEGORIES_)) throw new Error('ประเภททรัพย์สินไม่ถูกต้อง');
  if (!isInList(status, EMPLOYEE_ASSIGNMENT_STATUSES_)) throw new Error('สถานะการครอบครองไม่ถูกต้อง');

  const assetId = sanitizeText(form.assetId, 100);
  let asset = null;
  if (assetId) {
    asset = findRowEnsured_(SHEETS.ASSET, 'AssetID', assetId);
    if (!asset) throw new Error('ไม่พบทรัพย์สินที่เลือกใน Asset Register');
    if (employeeAssignmentCurrent_(status) && employeeAssetOwnedByOther_(asset, employee)) {
      throw new Error('ทรัพย์สินนี้มีผู้ครอบครองอยู่แล้ว: ' + (asset.OwnerName || asset.Owner || asset.OwnerEmail));
    }
  }

  const itemName = sanitizeText(form.itemName, 200) ||
    (asset && asset.AssetName) || sanitizeText(form.softwareName, 200);
  requireFields({ 'ชื่อรายการ': itemName }, ['ชื่อรายการ']);
  const assignedDate = parseDate(form.assignedDate);
  let returnedDate = parseDate(form.returnedDate);
  if (status === 'คืนแล้ว' && !returnedDate) returnedDate = new Date();
  if (status !== 'คืนแล้ว') returnedDate = '';

  return {
    EmployeeID: employee.EmployeeID,
    EmployeeCode: employee.EmployeeCode,
    Category: category,
    ItemName: itemName,
    AssetID: assetId,
    AssetCode: sanitizeText(form.assetCode, 100) || (asset && asset.AssetCode) || '',
    IPAddressDHCP: sanitizeText(form.ipAddress, 120),
    Producer: sanitizeText(form.producer, 160) || (asset && (asset.Brand || asset.Vendor)) || '',
    Model: sanitizeText(form.model, 160) || (asset && asset.Model) || '',
    MacAddress: sanitizeText(form.macAddress, 120),
    AssetNumber: sanitizeText(form.assetNumber, 120) || (asset && asset.AssetCode) || '',
    SerialNumber: sanitizeText(form.serialNumber, 160) || (asset && asset.SerialNumber) || '',
    OSSystem: sanitizeText(form.osSystem, 160),
    HardwareSpec: sanitizeText(form.hardwareSpec, 1000),
    SoftwareName: sanitizeText(form.softwareName, 200),
    SoftwareLicense: sanitizeText(form.softwareLicense, 300),
    PhoneNumber: sanitizeText(form.phoneNumber, 100),
    ScanUser: sanitizeText(form.scanUser, 160),
    ScanFolder: sanitizeText(form.scanFolder, 500),
    Status: status,
    AssignedDate: assignedDate,
    ReturnedDate: returnedDate,
    Notes: sanitizeText(form.notes, 1500)
  };
}

function saveEmployeeAssignment(assignmentId, form) {
  try {
    const user = requireModule('employees', true);
    assignmentId = sanitizeText(assignmentId, 100);
    form = form || {};
    let current = null;
    if (assignmentId) {
      current = findRowEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS, 'AssignmentID', assignmentId);
      if (!current) throw new Error('ไม่พบรายการครอบครอง');
    }
    const employeeId = sanitizeText(form.employeeId, 100) || (current && current.EmployeeID);
    const employee = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', employeeId);
    if (!employee) throw new Error('ไม่พบพนักงาน');
    const patch = employeeAssignmentPatch_(employee, form, current);

    if (patch.AssetID && employeeAssignmentCurrent_(patch.Status)) {
      const duplicate = readSheetObjectsEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS).some(function (row) {
        return String(row.AssignmentID) !== String(assignmentId || '') &&
          String(row.AssetID || '') === patch.AssetID &&
          employeeAssignmentCurrent_(row.Status || 'ครอบครอง');
      });
      if (duplicate) throw new Error('ทรัพย์สินนี้มีรายการครอบครองที่ยังไม่คืนแล้ว');
    }

    if (assignmentId) {
      if (current.AssetID && String(current.AssetID) !== String(patch.AssetID || '')) {
        syncEmployeeAssignmentAsset_(
          Object.assign({}, current, { Status: 'คืนแล้ว', ReturnedDate: new Date() }),
          employee,
          user.email
        );
      }
      updateRow_(SHEETS.EMPLOYEE_ASSIGNMENTS, current._row, patch, user.email);
    } else {
      assignmentId = generateId('ASG');
      patch.AssignmentID = assignmentId;
      appendRowEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS, patch, user.email);
    }
    syncEmployeeAssignmentAsset_(patch, employee, user.email);
    writeAudit_(user, current ? 'UPDATE_ASSIGNMENT' : 'CREATE_ASSIGNMENT',
      'employees', SHEETS.EMPLOYEE_ASSIGNMENTS, assignmentId,
      employee.EmployeeCode + ' · ' + patch.Category + ' · ' + patch.ItemName, 'success');
    return ok(current ? 'อัปเดตรายการครอบครองเรียบร้อย' : 'เพิ่มรายการครอบครองเรียบร้อย');
  } catch (e) {
    return fail(e.message);
  }
}

function setEmployeeAssignmentStatus(assignmentId, status) {
  try {
    const user = requireModule('employees', true);
    assignmentId = sanitizeText(assignmentId, 100);
    status = sanitizeText(status, 40);
    if (!isInList(status, EMPLOYEE_ASSIGNMENT_STATUSES_)) {
      throw new Error('สถานะการครอบครองไม่ถูกต้อง');
    }
    const assignment = findRowEnsured_(SHEETS.EMPLOYEE_ASSIGNMENTS, 'AssignmentID', assignmentId);
    if (!assignment) throw new Error('ไม่พบรายการครอบครอง');
    const employee = findRowEnsured_(SHEETS.EMPLOYEES, 'EmployeeID', assignment.EmployeeID);
    if (!employee) throw new Error('ไม่พบพนักงานของรายการนี้');
    const patch = {
      Status: status,
      ReturnedDate: status === 'คืนแล้ว' ? (assignment.ReturnedDate || new Date()) : ''
    };
    updateRow_(SHEETS.EMPLOYEE_ASSIGNMENTS, assignment._row, patch, user.email);
    const merged = Object.assign({}, assignment, patch);
    syncEmployeeAssignmentAsset_(merged, employee, user.email);
    writeAudit_(user, 'UPDATE_ASSIGNMENT_STATUS', 'employees',
      SHEETS.EMPLOYEE_ASSIGNMENTS, assignmentId,
      String(assignment.Status || '') + ' -> ' + status, 'success');
    return ok('ปรับสถานะรายการเป็น ' + status + ' แล้ว');
  } catch (e) {
    return fail(e.message);
  }
}
