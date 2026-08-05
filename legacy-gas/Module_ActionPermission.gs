/**
 * Module_ActionPermission.gs
 *
 * Action-level permission registry and approval-group administration for the
 * shared Workflow / Attachment / Integration services.
 *
 * Security rules:
 * - Unknown permission keys are denied.
 * - An inactive permission definition is denied even when a fallback exists.
 * - Active user overrides take precedence over role mappings; conflicting
 *   active rows fail closed (DENY wins).
 * - Once a permission has any configured role mapping, an omitted/inactive
 *   role mapping is denied. The fallback matrix is used only while that key
 *   has no configured role mappings, which keeps a fresh migration usable
 *   without weakening an administered matrix.
 * - Email-based actors, overrides, group owners and group members must refer
 *   to an active Users row. Role values supplied by a client are never trusted
 *   when an email is available.
 */

const AP_EFFECTS_ = ['ALLOW', 'DENY'];
const AP_STATUSES_ = ['Active', 'Inactive'];
const AP_GROUP_MEMBER_ROLES_ = ['PRIMARY', 'MEMBER', 'BACKUP'];
var AP_RUNTIME_READ_CACHE_ = { expiresAt: 0, rows: {} };

/**
 * Bootstrap policy used before/while permission seed rows are installed.
 * Keep keys stable: seeded ActionPermissions/RoleActionPermissions may replace
 * these defaults without requiring a code deployment.
 */
const AP_PERMISSION_FALLBACK_ = {
  'workflow.view_own': {
    moduleKey: 'workflow', action: 'VIEW_OWN',
    description: 'ดู Workflow ที่ตนเป็นผู้ร้องขอ',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.view_assigned': {
    moduleKey: 'workflow', action: 'VIEW_ASSIGNED',
    description: 'ดู Workflow/Approval ที่ได้รับมอบหมาย',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.view_all': {
    moduleKey: 'workflow', action: 'VIEW_ALL',
    description: 'ดู Workflow ทุกหน่วยงาน',
    roles: ['ITAdmin', 'Executive']
  },
  'workflow.start': {
    moduleKey: 'workflow', action: 'START',
    description: 'เริ่ม Workflow ผ่านโมดูลต้นทางที่ตนมีสิทธิ์',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.approve': {
    moduleKey: 'workflow', action: 'APPROVE',
    description: 'พิจารณารายการอนุมัติที่ได้รับมอบหมาย',
    roles: ['Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.delegate': {
    moduleKey: 'workflow', action: 'DELEGATE',
    description: 'มอบหมายสิทธิ์พิจารณาแทนตาม Workflow',
    roles: ['Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.cancel_own': {
    moduleKey: 'workflow', action: 'CANCEL_OWN',
    description: 'ยกเลิก Workflow ของตนเมื่อ policy อนุญาต',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'workflow.manage': {
    moduleKey: 'workflow', action: 'MANAGE',
    description: 'จัดการนิยามและรายการ Workflow',
    roles: ['ITAdmin']
  },
  'workflow.admin': {
    moduleKey: 'workflow', action: 'ADMIN',
    description: 'ตั้งค่าระบบ Workflow และสิทธิ์ขั้นสูง',
    roles: ['ITAdmin']
  },
  'workflow.run_automation': {
    moduleKey: 'workflow', action: 'RUN_AUTOMATION',
    description: 'สั่งประมวลผล reminder/escalation ของ Workflow',
    roles: ['ITAdmin']
  },

  'attachment.view': {
    moduleKey: 'attachment', action: 'VIEW',
    description: 'ดู metadata ไฟล์ที่มีสิทธิ์ในรายการต้นทาง',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'attachment.download': {
    moduleKey: 'attachment', action: 'DOWNLOAD',
    description: 'ดาวน์โหลดไฟล์ที่มีสิทธิ์ในรายการต้นทาง',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'attachment.upload': {
    moduleKey: 'attachment', action: 'UPLOAD',
    description: 'อัปโหลดไฟล์เข้าโมดูลต้นทางที่มีสิทธิ์แก้ไข',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'attachment.delete_own': {
    moduleKey: 'attachment', action: 'DELETE_OWN',
    description: 'ยกเลิกไฟล์ที่ตนอัปโหลดเมื่อรายการต้นทางยังแก้ไขได้',
    roles: ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO']
  },
  'attachment.delete_any': {
    moduleKey: 'attachment', action: 'DELETE_ANY',
    description: 'ยกเลิกไฟล์ของผู้ใช้อื่น',
    roles: ['ITAdmin']
  },
  'attachment.manage': {
    moduleKey: 'attachment', action: 'MANAGE',
    description: 'จัดการทะเบียนไฟล์แนบ',
    roles: ['ITAdmin']
  },
  'attachment.admin': {
    moduleKey: 'attachment', action: 'ADMIN',
    description: 'ตั้งค่าระบบไฟล์แนบ',
    roles: ['ITAdmin']
  },
  'attachment.legal_hold': {
    moduleKey: 'attachment', action: 'LEGAL_HOLD',
    description: 'Set or release a verified legal hold on registered attachment links',
    roles: ['ITAdmin', 'DPO']
  },
  'attachment.legacy_incident_proxy': {
    moduleKey: 'attachment', action: 'LEGACY_INCIDENT_PROXY',
    description: 'Proxy legacy Ticket evidence for an authorized Incident review without exposing Drive locators',
    roles: ['ITAdmin', 'DPO']
  },

  'integration.view': {
    moduleKey: 'integration', action: 'VIEW',
    description: 'ดูสถานะ integration outbox',
    roles: ['ITAdmin']
  },
  'integration.enqueue': {
    moduleKey: 'integration', action: 'ENQUEUE',
    description: 'สร้างงาน integration ผ่าน adapter ที่อนุญาต',
    roles: ['ITAdmin']
  },
  'integration.execute': {
    moduleKey: 'integration', action: 'EXECUTE',
    description: 'ประมวลผล integration outbox',
    roles: ['ITAdmin']
  },
  'integration.retry': {
    moduleKey: 'integration', action: 'RETRY',
    description: 'สั่ง retry integration ที่ล้มเหลว',
    roles: ['ITAdmin']
  },
  'integration.manage': {
    moduleKey: 'integration', action: 'MANAGE',
    description: 'จัดการกฎและสถานะ integration',
    roles: ['ITAdmin']
  },
  'integration.admin': {
    moduleKey: 'integration', action: 'ADMIN',
    description: 'ตั้งค่าระบบ integration',
    roles: ['ITAdmin']
  }
};

// ============================================================================
// Admin APIs
// ============================================================================

function getActionPermissionAdminData() {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    apEnsureSheets_();

    const configuredPermissions = readSheetObjectsEnsured_(SHEETS.ACTION_PERMISSION, true);
    const roleMappings = readSheetObjectsEnsured_(SHEETS.ROLE_ACTION_PERMISSION, true);
    const overrides = readSheetObjectsEnsured_(SHEETS.USER_PERMISSION_OVERRIDE, true);
    const groups = readSheetObjectsEnsured_(SHEETS.APPROVAL_GROUP, true);
    const members = readSheetObjectsEnsured_(SHEETS.APPROVAL_GROUP_MEMBER, true);
    const activeUsers = readSheetObjects_(SHEETS.USERS, true).filter(function (row) {
      return apIsActiveStatus_(row.Status) && isValidEmail(String(row.Email || '').toLowerCase().trim());
    });

    const effective = {};
    Object.keys(AP_PERMISSION_FALLBACK_).forEach(function (key) {
      const item = AP_PERMISSION_FALLBACK_[key];
      effective[key] = {
        permissionKey: key,
        moduleKey: item.moduleKey,
        action: item.action,
        description: item.description,
        status: 'Active',
        source: 'fallback'
      };
    });
    configuredPermissions.forEach(function (row) {
      const key = apNormalizePermissionKey_(row.PermissionKey, false);
      if (!key) return;
      effective[key] = apPermissionDto_(row, 'sheet');
    });

    const memberCount = {};
    members.forEach(function (row) {
      if (!apIsActiveStatus_(row.Status)) return;
      memberCount[String(row.GroupID || '')] = (memberCount[String(row.GroupID || '')] || 0) + 1;
    });

    return ok({
      actor: { email: user.email, role: user.role },
      effects: AP_EFFECTS_.slice(),
      statuses: AP_STATUSES_.slice(),
      memberRoles: AP_GROUP_MEMBER_ROLES_.slice(),
      roles: Object.keys(ROLE_LABELS).map(function (role) {
        return { value: role, label: ROLE_LABELS[role] || role };
      }),
      permissions: Object.keys(effective).map(function (key) { return effective[key]; })
        .sort(function (a, b) { return String(a.permissionKey).localeCompare(String(b.permissionKey)); }),
      configuredPermissions: configuredPermissions.map(function (row) {
        return apPermissionDto_(row, 'sheet');
      }),
      rolePermissions: roleMappings.map(apRolePermissionDto_),
      userOverrides: overrides.map(apUserOverrideDto_),
      groups: groups.map(function (row) {
        const dto = apGroupDto_(row);
        dto.activeMemberCount = memberCount[String(row.GroupID || '')] || 0;
        return dto;
      }),
      groupMembers: members.map(apGroupMemberDto_),
      users: activeUsers.map(function (row) {
        return {
          email: String(row.Email || '').toLowerCase().trim(),
          name: row.FullName || row.Email || '',
          department: row.Department || '',
          role: row.Role || ''
        };
      }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
    });
  } catch (e) {
    return fail(e.message, 'ACTION_PERMISSION_ADMIN_LOAD_FAILED');
  }
}

function saveRoleActionPermission(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    form = form || {};
    apEnsureSheets_();

    const role = apNormalizeRole_(form.role);
    const permissionKey = apNormalizePermissionKey_(form.permissionKey, true);
    apAssertKnownPermission_(permissionKey);
    const effect = apNormalizeEffect_(form.effect, true);
    const status = apNormalizeStatus_(form.status, true);
    if (role === ROLES.IT_ADMIN && permissionKey === 'workflow.admin' &&
      (effect !== 'ALLOW' || status !== 'Active')) {
      throw new Error('ห้ามปิดสิทธิ์ workflow.admin ระดับบทบาท ITAdmin; ใช้ user override แบบมีผู้ดูแลสำรอง');
    }
    const mappingId = sanitizeText(form.mappingId || form.id, 100);
    const notes = sanitizeText(form.notes, 1000);

    const result = apWithLock_(function () {
      const lockedUser = apAuthorizeAdminMutationLocked_(user);
      apAssertKnownPermission_(permissionKey);
      if (role === ROLES.IT_ADMIN && permissionKey === 'workflow.admin' &&
          (effect !== 'ALLOW' || status !== 'Active')) {
        throw new Error('ห้ามปิดสิทธิ์ workflow.admin ระดับบทบาท ITAdmin; ใช้ user override แบบมีผู้ดูแลสำรอง');
      }
      const rows = readSheetObjects_(SHEETS.ROLE_ACTION_PERMISSION, true);
      let row = null;
      if (mappingId) {
        row = rows.filter(function (item) { return String(item.MappingID) === mappingId; })[0] || null;
        if (!row) throw new Error('ไม่พบรายการสิทธิ์ของบทบาทที่ต้องการแก้ไข');
      } else {
        row = rows.filter(function (item) {
          return String(item.Role) === role &&
            apNormalizePermissionKey_(item.PermissionKey, false) === permissionKey;
        })[0] || null;
      }
      const duplicate = rows.filter(function (item) {
        return String(item.Role) === role &&
          apNormalizePermissionKey_(item.PermissionKey, false) === permissionKey &&
          (!row || String(item.MappingID) !== String(row.MappingID));
      })[0];
      if (duplicate) throw new Error('บทบาทนี้มีการกำหนด PermissionKey ดังกล่าวแล้ว');

      const id = row ? String(row.MappingID) : generateId('RAP');
      const payload = {
        MappingID: id,
        Role: role,
        PermissionKey: permissionKey,
        Effect: effect,
        Status: status,
        Notes: notes
      };
      const created = !row;
      return apCriticalMutationLocked_(lockedUser, {
        action: created ? 'CREATE_ROLE_ACTION_PERMISSION' : 'UPDATE_ROLE_ACTION_PERMISSION',
        targetSheet: SHEETS.ROLE_ACTION_PERMISSION,
        targetId: id,
        detail: role + ' / ' + permissionKey + ' / ' + effect + ' / ' + status
      }, function (verifiedUser) {
        if (row) apUpdateRowLocked_(SHEETS.ROLE_ACTION_PERMISSION, row._row, payload, verifiedUser.email);
        else apAppendRowLocked_(SHEETS.ROLE_ACTION_PERMISSION, payload, verifiedUser.email);
        return { id: id, created: created };
      });
    });

    return ok(result, result.created ? 'เพิ่มสิทธิ์ราย action ของบทบาทแล้ว' : 'อัปเดตสิทธิ์ราย action ของบทบาทแล้ว');
  } catch (e) {
    return fail(e.message, 'ROLE_ACTION_PERMISSION_SAVE_FAILED');
  }
}

function saveUserPermissionOverride(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    form = form || {};
    apEnsureSheets_();

    const targetEmail = String(sanitizeText(form.userEmail || form.email, 200)).toLowerCase().trim();
    if (!isValidEmail(targetEmail)) throw new Error('อีเมลผู้ใช้ไม่ถูกต้อง');
    apRequireActiveUser_(targetEmail, 'ผู้ใช้ที่รับสิทธิ์ override');
    const permissionKey = apNormalizePermissionKey_(form.permissionKey, true);
    apAssertKnownPermission_(permissionKey);
    const effect = apNormalizeEffect_(form.effect, true);
    const status = apNormalizeStatus_(form.status, true);
    if (targetEmail === user.email && effect === 'ALLOW') {
      throw new Error('ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้');
    }
    const reason = sanitizeText(form.reason, 1000);
    if (!reason) throw new Error('กรุณาระบุเหตุผลของ permission override');
    const startAt = apParseOptionalDate_(form.startAt, 'วันที่เริ่ม', false);
    const endAt = apParseOptionalDate_(form.endAt, 'วันที่สิ้นสุด', true);
    if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
      throw new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม');
    }
    if (permissionKey === 'workflow.admin' && effect === 'DENY' && status === 'Active' &&
        startAt && startAt.getTime() > Date.now()) {
      throw new Error('ไม่อนุญาตให้ตั้ง workflow.admin DENY ล่วงหน้า เพราะอาจทำให้ระบบไม่มีผู้ดูแลเมื่อถึงเวลา');
    }
    const overrideId = sanitizeText(form.overrideId || form.id, 100);

    const result = apWithLock_(function () {
      // Re-evaluate the last-admin invariant under the same lock as the write.
      // Otherwise two concurrent DENY requests can each observe the other admin.
      const lockedUser = apAuthorizeAdminMutationLocked_(user);
      apAssertKnownPermission_(permissionKey);
      apRequireActiveUser_(targetEmail, 'ผู้ใช้ที่รับสิทธิ์ override');
      if (targetEmail === lockedUser.email && effect === 'ALLOW') {
        throw new Error('ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้');
      }
      if (permissionKey === 'workflow.admin' && effect === 'DENY' && status === 'Active') {
        const remainingAdmins = apReadSheetIfPresent_(SHEETS.USERS).filter(function (adminRow) {
          const email = String(adminRow.Email || '').toLowerCase().trim();
          return email && email !== targetEmail && String(adminRow.Role || '') === ROLES.IT_ADMIN &&
            apIsActiveStatus_(adminRow.Status) &&
            wfHasActionPermission_({ email: email, role: adminRow.Role }, 'workflow.admin');
        });
        if (!remainingAdmins.length) throw new Error('ต้องเหลือ ITAdmin ที่มี workflow.admin อย่างน้อยหนึ่งบัญชี');
      }
      const rows = readSheetObjects_(SHEETS.USER_PERMISSION_OVERRIDE, true);
      let row = null;
      if (overrideId) {
        row = rows.filter(function (item) { return String(item.OverrideID) === overrideId; })[0] || null;
        if (!row) throw new Error('ไม่พบ permission override ที่ต้องการแก้ไข');
      } else {
        // One governed row per user/key keeps precedence deterministic and makes
        // repeated admin submissions idempotent. Change its effective dates to
        // schedule a future override rather than appending a conflicting row.
        row = rows.filter(function (item) {
          return String(item.UserEmail || '').toLowerCase().trim() === targetEmail &&
            apNormalizePermissionKey_(item.PermissionKey, false) === permissionKey;
        })[0] || null;
      }
      const duplicate = rows.filter(function (item) {
        return String(item.UserEmail || '').toLowerCase().trim() === targetEmail &&
          apNormalizePermissionKey_(item.PermissionKey, false) === permissionKey &&
          (!row || String(item.OverrideID) !== String(row.OverrideID));
      })[0];
      if (duplicate) throw new Error('ผู้ใช้นี้มี permission override สำหรับ PermissionKey ดังกล่าวแล้ว');

      const id = row ? String(row.OverrideID) : generateId('UPO');
      const payload = {
        OverrideID: id,
        UserEmail: targetEmail,
        PermissionKey: permissionKey,
        Effect: effect,
        StartAt: startAt || '',
        EndAt: endAt || '',
        Reason: reason,
        Status: status,
        ApprovedBy: lockedUser.email
      };
      const created = !row;
      return apCriticalMutationLocked_(lockedUser, {
        action: created ? 'CREATE_USER_PERMISSION_OVERRIDE' : 'UPDATE_USER_PERMISSION_OVERRIDE',
        targetSheet: SHEETS.USER_PERMISSION_OVERRIDE,
        targetId: id,
        detail: targetEmail + ' / ' + permissionKey + ' / ' + effect + ' / ' + status
      }, function (verifiedUser) {
        payload.ApprovedBy = verifiedUser.email;
        if (row) apUpdateRowLocked_(SHEETS.USER_PERMISSION_OVERRIDE, row._row, payload, verifiedUser.email);
        else apAppendRowLocked_(SHEETS.USER_PERMISSION_OVERRIDE, payload, verifiedUser.email);
        return { id: id, created: created };
      });
    });

    return ok(result, result.created ? 'เพิ่ม permission override แล้ว' : 'อัปเดต permission override แล้ว');
  } catch (e) {
    return fail(e.message, 'USER_PERMISSION_OVERRIDE_SAVE_FAILED');
  }
}

function saveApprovalGroup(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    form = form || {};
    apEnsureSheets_();

    const groupId = sanitizeText(form.groupId || form.id, 100);
    const groupCode = String(sanitizeText(form.groupCode || form.code, 80)).toUpperCase().trim();
    const groupName = sanitizeText(form.groupName || form.name, 200);
    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(groupCode)) {
      throw new Error('รหัสกลุ่มต้องมี 2-80 ตัว และใช้เฉพาะ A-Z, 0-9, _ หรือ -');
    }
    if (!groupName) throw new Error('กรุณาระบุชื่อกลุ่มอนุมัติ');
    const ownerEmail = String(sanitizeText(form.ownerEmail, 200)).toLowerCase().trim();
    if (ownerEmail) {
      if (!isValidEmail(ownerEmail)) throw new Error('อีเมลเจ้าของกลุ่มไม่ถูกต้อง');
      apRequireActiveUser_(ownerEmail, 'เจ้าของกลุ่ม');
    }
    const status = apNormalizeStatus_(form.status, true);
    const payload = {
      GroupCode: groupCode,
      GroupName: groupName,
      Department: sanitizeText(form.department, 200),
      Description: sanitizeText(form.description, 1500),
      Status: status,
      OwnerEmail: ownerEmail,
      Notes: sanitizeText(form.notes, 1000)
    };

    const result = apWithLock_(function () {
      const lockedUser = apAuthorizeAdminMutationLocked_(user);
      if (ownerEmail) apRequireActiveUser_(ownerEmail, 'เจ้าของกลุ่ม');
      const rows = readSheetObjects_(SHEETS.APPROVAL_GROUP, true);
      let row = null;
      if (groupId) {
        row = rows.filter(function (item) { return String(item.GroupID) === groupId; })[0] || null;
        if (!row) throw new Error('ไม่พบกลุ่มอนุมัติที่ต้องการแก้ไข');
      }
      const duplicate = rows.filter(function (item) {
        return String(item.GroupCode || '').toUpperCase().trim() === groupCode &&
          (!row || String(item.GroupID) !== String(row.GroupID));
      })[0];
      if (duplicate) throw new Error('รหัสกลุ่มอนุมัตินี้ถูกใช้งานแล้ว');

      const id = row ? String(row.GroupID) : generateId('APG');
      payload.GroupID = id;
      const created = !row;
      return apCriticalMutationLocked_(lockedUser, {
        action: created ? 'CREATE_APPROVAL_GROUP' : 'UPDATE_APPROVAL_GROUP',
        targetSheet: SHEETS.APPROVAL_GROUP,
        targetId: id,
        detail: groupCode + ' / ' + groupName + ' / ' + status
      }, function (verifiedUser) {
        if (row) apUpdateRowLocked_(SHEETS.APPROVAL_GROUP, row._row, payload, verifiedUser.email);
        else apAppendRowLocked_(SHEETS.APPROVAL_GROUP, payload, verifiedUser.email);
        return { id: id, created: created };
      });
    });

    return ok(result, result.created ? 'เพิ่มกลุ่มอนุมัติแล้ว' : 'อัปเดตกลุ่มอนุมัติแล้ว');
  } catch (e) {
    return fail(e.message, 'APPROVAL_GROUP_SAVE_FAILED');
  }
}

function saveApprovalGroupMember(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    form = form || {};
    apEnsureSheets_();

    const memberId = sanitizeText(form.memberId || form.id, 100);
    const group = apFindApprovalGroup_(form.groupId || form.groupCode);
    if (!group) throw new Error('ไม่พบกลุ่มอนุมัติ');
    const targetEmail = String(sanitizeText(form.userEmail || form.email, 200)).toLowerCase().trim();
    if (!isValidEmail(targetEmail)) throw new Error('อีเมลสมาชิกไม่ถูกต้อง');
    apRequireActiveUser_(targetEmail, 'สมาชิกกลุ่ม');
    const memberRole = apNormalizeMemberRole_(form.memberRole || form.role);
    const priority = apPriority_(form.priority);
    const validFrom = apParseOptionalDate_(form.validFrom, 'วันที่เริ่มสมาชิก', false);
    const validUntil = apParseOptionalDate_(form.validUntil, 'วันที่สิ้นสุดสมาชิก', true);
    if (validFrom && validUntil && validUntil.getTime() < validFrom.getTime()) {
      throw new Error('วันที่สิ้นสุดสมาชิกต้องไม่น้อยกว่าวันที่เริ่ม');
    }
    const status = apNormalizeStatus_(form.status, true);

    const result = apWithLock_(function () {
      const lockedUser = apAuthorizeAdminMutationLocked_(user);
      const lockedGroup = apFindApprovalGroup_(form.groupId || form.groupCode);
      if (!lockedGroup) throw new Error('ไม่พบกลุ่มอนุมัติ');
      const activeTarget = apRequireActiveUser_(targetEmail, 'สมาชิกกลุ่ม');
      if (status === 'Active' && !wfHasActionPermission_({
        email: targetEmail, role: activeTarget.Role,
        name: activeTarget.FullName || targetEmail,
        department: activeTarget.Department || ''
      }, 'workflow.approve')) {
        throw new Error('สมาชิกกลุ่มที่ Active ต้องมีสิทธิ์ workflow.approve');
      }
      const rows = readSheetObjects_(SHEETS.APPROVAL_GROUP_MEMBER, true);
      let row = null;
      if (memberId) {
        row = rows.filter(function (item) { return String(item.MemberID) === memberId; })[0] || null;
        if (!row) throw new Error('ไม่พบสมาชิกกลุ่มที่ต้องการแก้ไข');
      } else {
        row = rows.filter(function (item) {
          return String(item.GroupID) === String(lockedGroup.GroupID) &&
            String(item.UserEmail || '').toLowerCase().trim() === targetEmail;
        })[0] || null;
      }
      const duplicate = rows.filter(function (item) {
        return String(item.GroupID) === String(lockedGroup.GroupID) &&
          String(item.UserEmail || '').toLowerCase().trim() === targetEmail &&
          (!row || String(item.MemberID) !== String(row.MemberID));
      })[0];
      if (duplicate) throw new Error('ผู้ใช้นี้เป็นสมาชิกของกลุ่มอนุมัติดังกล่าวอยู่แล้ว');

      const id = row ? String(row.MemberID) : generateId('AGM');
      const payload = {
        MemberID: id,
        GroupID: lockedGroup.GroupID,
        UserEmail: targetEmail,
        MemberRole: memberRole,
        Priority: priority,
        ValidFrom: validFrom || '',
        ValidUntil: validUntil || '',
        Status: status,
        Notes: sanitizeText(form.notes, 1000)
      };
      const created = !row;
      return apCriticalMutationLocked_(lockedUser, {
        action: created ? 'CREATE_APPROVAL_GROUP_MEMBER' : 'UPDATE_APPROVAL_GROUP_MEMBER',
        targetSheet: SHEETS.APPROVAL_GROUP_MEMBER,
        targetId: id,
        detail: String(lockedGroup.GroupCode || lockedGroup.GroupID) + ' / ' + targetEmail +
          ' / ' + memberRole + ' / ' + status
      }, function (verifiedUser) {
        if (row) apUpdateRowLocked_(SHEETS.APPROVAL_GROUP_MEMBER, row._row, payload, verifiedUser.email);
        else apAppendRowLocked_(SHEETS.APPROVAL_GROUP_MEMBER, payload, verifiedUser.email);
        return { id: id, groupId: lockedGroup.GroupID, created: created };
      });
    });

    return ok(result, result.created ? 'เพิ่มสมาชิกกลุ่มอนุมัติแล้ว' : 'อัปเดตสมาชิกกลุ่มอนุมัติแล้ว');
  } catch (e) {
    return fail(e.message, 'APPROVAL_GROUP_MEMBER_SAVE_FAILED');
  }
}

function setApprovalGroupMemberStatus(memberId, status) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    wfRequireActionPermission_(user, 'workflow.admin');
    apEnsureSheets_();
    memberId = sanitizeText(memberId, 100);
    if (!memberId) throw new Error('กรุณาระบุสมาชิกกลุ่ม');
    status = apNormalizeStatus_(status, true);

    apWithLock_(function () {
      const lockedUser = apAuthorizeAdminMutationLocked_(user);
      const row = readSheetObjects_(SHEETS.APPROVAL_GROUP_MEMBER, true).filter(function (item) {
        return String(item.MemberID) === memberId;
      })[0];
      if (!row) throw new Error('ไม่พบสมาชิกกลุ่ม');
      if (status === 'Active') {
        const targetEmail = String(row.UserEmail || '').toLowerCase().trim();
        const activeTarget = apRequireActiveUser_(targetEmail, 'สมาชิกกลุ่ม');
        if (!wfHasActionPermission_({
          email: targetEmail, role: activeTarget.Role,
          name: activeTarget.FullName || targetEmail,
          department: activeTarget.Department || ''
        }, 'workflow.approve')) {
          throw new Error('สมาชิกกลุ่มที่ Active ต้องมีสิทธิ์ workflow.approve');
        }
      }
      return apCriticalMutationLocked_(lockedUser, {
        action: 'SET_APPROVAL_GROUP_MEMBER_STATUS',
        targetSheet: SHEETS.APPROVAL_GROUP_MEMBER,
        targetId: memberId,
        detail: status
      }, function (verifiedUser) {
        apUpdateRowLocked_(SHEETS.APPROVAL_GROUP_MEMBER, row._row,
          { Status: status }, verifiedUser.email);
        return { id: memberId, status: status };
      });
    });
    return ok({ id: memberId, status: status }, 'อัปเดตสถานะสมาชิกกลุ่มแล้ว');
  } catch (e) {
    return fail(e.message, 'APPROVAL_GROUP_MEMBER_STATUS_FAILED');
  }
}

// ============================================================================
// Internal authorization / routing helpers
// ============================================================================

/**
 * Return true only for a known, active permission and an active actor.
 * Preferred signature: wfHasActionPermission_(user, permissionKey, context)
 * Convenience forms wfHasActionPermission_(permissionKey) and
 * wfHasActionPermission_(permissionKey, user, context) are also accepted.
 *
 * This helper grants a capability only. Callers must still enforce record-level
 * scope (owner, assigned approver, source-module visibility and SoD).
 */
function wfHasActionPermission_(actorArg, permissionArg, contextArg) {
  try {
    const args = apPermissionArgs_(actorArg, permissionArg, contextArg);
    const permissionKey = apNormalizePermissionKey_(args.permissionKey, false);
    if (!permissionKey) return false;

    const fallback = AP_PERMISSION_FALLBACK_[permissionKey] || null;
    const permissionRows = apReadSheetIfPresent_(SHEETS.ACTION_PERMISSION).filter(function (row) {
      return apNormalizePermissionKey_(row.PermissionKey, false) === permissionKey;
    });
    if (!fallback && !permissionRows.length) return false; // unknown = default deny
    if (permissionRows.length && !permissionRows.some(function (row) { return apIsActiveStatus_(row.Status); })) {
      return false; // explicitly defined but disabled
    }

    const actor = apResolveActor_(args.actor);
    if (!actor || !actor.role) return false;

    if (actor.email) {
      const overrideEffects = apReadSheetIfPresent_(SHEETS.USER_PERMISSION_OVERRIDE)
        .filter(function (row) {
          return String(row.UserEmail || '').toLowerCase().trim() === actor.email &&
            apNormalizePermissionKey_(row.PermissionKey, false) === permissionKey &&
            apIsActiveStatus_(row.Status) && apEffectiveNow_(row.StartAt, row.EndAt, new Date());
        }).map(function (row) { return apNormalizeEffect_(row.Effect, false); })
        .filter(String);
      if (overrideEffects.indexOf('DENY') > -1) return false;
      if (overrideEffects.indexOf('ALLOW') > -1) return true;
    }

    const allRoleRows = apReadSheetIfPresent_(SHEETS.ROLE_ACTION_PERMISSION).filter(function (row) {
      return apNormalizePermissionKey_(row.PermissionKey, false) === permissionKey;
    });
    if (allRoleRows.length) {
      const roleEffects = allRoleRows.filter(function (row) {
        return String(row.Role || '') === actor.role && apIsActiveStatus_(row.Status);
      }).map(function (row) { return apNormalizeEffect_(row.Effect, false); }).filter(String);
      if (roleEffects.indexOf('DENY') > -1) return false;
      if (roleEffects.indexOf('ALLOW') > -1) return true;
      return false; // configured key, but role omitted/inactive => deny
    }

    return !!(fallback && fallback.roles.indexOf(actor.role) > -1);
  } catch (e) {
    // Permission checks fail closed and must never expose sheet/internal errors.
    console.error('wfHasActionPermission_: ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

function wfRequireActionPermission_(actorArg, permissionArg, contextArg) {
  const args = apPermissionArgs_(actorArg, permissionArg, contextArg);
  if (!wfHasActionPermission_(args.actor, args.permissionKey, args.context)) {
    throw new Error('ท่านไม่มีสิทธิ์ดำเนินการ: ' + sanitizeText(args.permissionKey, 120));
  }
  return apResolveActor_(args.actor);
}

/**
 * Resolve active emails for an Approval Group ID or GroupCode.
 * Default behavior returns PRIMARY/MEMBER; BACKUP is used only when no primary
 * members are currently effective. Set options.includeBackups=true to include
 * all roles, or options.memberRoles=['BACKUP'] for explicit escalation routing.
 */
function wfResolveApprovalGroupEmails_(groupIdOrCode, atDate, options) {
  try {
    if (atDate && typeof atDate === 'object' && !(atDate instanceof Date) && !options) {
      options = atDate;
      atDate = null;
    }
    options = options || {};
    const effectiveAt = atDate ? apDateForRuntime_(atDate) : new Date();
    if (!effectiveAt) return [];
    const key = String(groupIdOrCode || '').trim();
    if (!key) return [];

    const group = apReadSheetIfPresent_(SHEETS.APPROVAL_GROUP).filter(function (row) {
      return (String(row.GroupID || '') === key ||
        String(row.GroupCode || '').toUpperCase().trim() === key.toUpperCase()) &&
        apIsActiveStatus_(row.Status);
    })[0];
    if (!group) return [];
    if (options.department && String(group.Department || '').trim() !== String(options.department).trim()) {
      return [];
    }

    const users = {};
    apReadSheetIfPresent_(SHEETS.USERS).forEach(function (row) {
      const email = String(row.Email || '').toLowerCase().trim();
      if (email && isValidEmail(email) && apIsActiveStatus_(row.Status)) users[email] = row;
    });

    let rows = apReadSheetIfPresent_(SHEETS.APPROVAL_GROUP_MEMBER).filter(function (row) {
      const email = String(row.UserEmail || '').toLowerCase().trim();
      return String(row.GroupID || '') === String(group.GroupID) && users[email] &&
        apIsActiveStatus_(row.Status) && apEffectiveNow_(row.ValidFrom, row.ValidUntil, effectiveAt) &&
        wfHasActionPermission_({
          email: email, role: users[email].Role,
          name: users[email].FullName || email,
          department: users[email].Department || ''
        }, 'workflow.approve');
    });
    rows.sort(function (a, b) {
      const priorityDiff = apPriority_(a.Priority) - apPriority_(b.Priority);
      if (priorityDiff) return priorityDiff;
      const rank = { PRIMARY: 0, MEMBER: 1, BACKUP: 2 };
      const roleA = apNormalizeMemberRole_(a.MemberRole, false) || 'MEMBER';
      const roleB = apNormalizeMemberRole_(b.MemberRole, false) || 'MEMBER';
      return rank[roleA] - rank[roleB] ||
        String(a.UserEmail || '').localeCompare(String(b.UserEmail || ''));
    });

    if (Array.isArray(options.memberRoles) && options.memberRoles.length) {
      const allowedRoles = options.memberRoles.map(function (role) {
        return apNormalizeMemberRole_(role, false);
      }).filter(String);
      rows = rows.filter(function (row) {
        return allowedRoles.indexOf(apNormalizeMemberRole_(row.MemberRole, false) || 'MEMBER') > -1;
      });
    } else if (!options.includeBackups) {
      const primary = rows.filter(function (row) {
        return (apNormalizeMemberRole_(row.MemberRole, false) || 'MEMBER') !== 'BACKUP';
      });
      rows = primary.length ? primary : rows.filter(function (row) {
        return apNormalizeMemberRole_(row.MemberRole, false) === 'BACKUP';
      });
    }

    const seen = {};
    return rows.map(function (row) { return String(row.UserEmail || '').toLowerCase().trim(); })
      .filter(function (email) {
        if (!email || seen[email]) return false;
        seen[email] = true;
        return true;
      });
  } catch (e) {
    console.error('wfResolveApprovalGroupEmails_: ' + (e && e.message ? e.message : String(e)));
    return [];
  }
}

// ============================================================================
// Private utilities
// ============================================================================

function apEnsureSheets_() {
  [SHEETS.ACTION_PERMISSION, SHEETS.ROLE_ACTION_PERMISSION, SHEETS.USER_PERMISSION_OVERRIDE,
    SHEETS.APPROVAL_GROUP, SHEETS.APPROVAL_GROUP_MEMBER].forEach(ensureSheetBySchema_);
}

function apWithLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/**
 * Re-resolve an administrator from the Users sheet and the current action
 * permission matrix while ScriptLock is held. Resetting the runtime cache is
 * mandatory: an admin mutation must never rely on authorization data loaded
 * before it acquired the lock.
 */
function apAuthorizeAdminMutationLocked_(actor) {
  apResetRuntimeReadCache_();
  const email = String(actor && (actor.email || actor.Email) || '').toLowerCase().trim();
  if (!isValidEmail(email)) throw new Error('ไม่พบตัวตนผู้ดูแลสำหรับบันทึกการเปลี่ยนแปลง');
  const userRow = apRequireActiveUser_(email, 'ผู้ดูแลระบบ');
  if (String(userRow.Role || '') !== ROLES.IT_ADMIN) {
    throw new Error('เฉพาะ ITAdmin ที่ Active เท่านั้นที่แก้ไข Action Permission ได้');
  }
  const freshActor = {
    email: email,
    role: String(userRow.Role),
    name: userRow.FullName || email,
    department: userRow.Department || ''
  };
  wfRequireActionPermission_(freshActor, 'workflow.admin');
  return freshActor;
}

/**
 * Critical permission mutations use a durable two-phase audit record:
 * 1) append and verify PENDING intent before touching the governed row;
 * 2) re-authorize from fresh sheets immediately before the mutation;
 * 3) update and verify the same audit row as success/error.
 *
 * If completion cannot be verified after a successful sheet write, the
 * precommitted intent remains durable instead of losing the audit silently.
 */
function apCriticalMutationLocked_(actor, spec, mutateFn) {
  spec = spec || {};
  if (typeof mutateFn !== 'function') throw new Error('ไม่พบ critical mutation handler');

  // Re-check immediately before the audit-intent mutation as well. The caller
  // has already done one locked check for invariant reads, but must not rely on
  // that earlier snapshot for either durable write.
  const intentActor = apAuthorizeAdminMutationLocked_(actor);
  const intent = apBeginCriticalAuditLocked_(intentActor, spec);
  let result;
  try {
    const verifiedActor = apAuthorizeAdminMutationLocked_(intentActor);
    result = mutateFn(verifiedActor);
  } catch (mutationError) {
    try {
      apCompleteCriticalAuditLocked_(intent, 'error',
        sanitizeText(mutationError && mutationError.message || mutationError, 1000));
    } catch (auditError) {
      throw new Error('Action Permission mutation ล้มเหลวและปิด audit intent ไม่สำเร็จ (' +
        intent.logId + '): ' + sanitizeText(mutationError && mutationError.message || mutationError, 500));
    }
    throw mutationError;
  }
  apCompleteCriticalAuditLocked_(intent, 'success', 'COMPLETED');
  return result;
}

function apBeginCriticalAuditLocked_(actor, spec) {
  const action = sanitizeText(spec.action, 120);
  const targetSheet = sanitizeText(spec.targetSheet, 160);
  const targetId = sanitizeText(spec.targetId, 160);
  const detail = sanitizeText(spec.detail, 1500);
  if (!action || !targetSheet || !targetId) {
    throw new Error('ข้อมูล critical audit intent ไม่ครบถ้วน');
  }
  const logId = generateId('LOG');
  const rowNumber = apAppendRowLocked_(SHEETS.AUDIT_TRAIL, {
    LogID: logId,
    Timestamp: new Date(),
    ActorEmail: actor.email,
    ActorRole: actor.role,
    Action: action,
    Module: 'actionPermission',
    TargetSheet: targetSheet,
    TargetID: targetId,
    Detail: '[INTENT] ' + detail,
    IPHint: '',
    Result: 'pending'
  }, actor.email);
  const persisted = apReadAuditRowLocked_(rowNumber);
  if (!persisted || String(persisted.LogID || '') !== logId ||
      String(persisted.ActorEmail || '').toLowerCase().trim() !== actor.email ||
      String(persisted.ActorRole || '') !== actor.role ||
      String(persisted.Action || '') !== action ||
      String(persisted.Module || '') !== 'actionPermission' ||
      String(persisted.TargetSheet || '') !== targetSheet ||
      String(persisted.TargetID || '') !== targetId ||
      String(persisted.Result || '').toLowerCase() !== 'pending') {
    throw new Error('ไม่สามารถยืนยัน durable audit intent; ยกเลิกการเปลี่ยนแปลงสิทธิ์');
  }
  return {
    logId: logId,
    rowNumber: rowNumber,
    action: action,
    targetSheet: targetSheet,
    targetId: targetId,
    detail: detail,
    actorEmail: actor.email,
    actorRole: actor.role
  };
}

function apCompleteCriticalAuditLocked_(intent, result, suffix) {
  const normalizedResult = String(result || '').toLowerCase();
  if (['success', 'error'].indexOf(normalizedResult) === -1) {
    throw new Error('สถานะ critical audit completion ไม่ถูกต้อง');
  }
  apUpdateRowLocked_(SHEETS.AUDIT_TRAIL, intent.rowNumber, {
    Detail: '[' + (normalizedResult === 'success' ? 'COMPLETED' : 'FAILED') + '] ' +
      intent.detail + (suffix ? ' / ' + sanitizeText(suffix, 1000) : ''),
    Result: normalizedResult
  }, intent.actorEmail);
  const persisted = apReadAuditRowLocked_(intent.rowNumber);
  if (!persisted || String(persisted.LogID || '') !== String(intent.logId) ||
      String(persisted.ActorEmail || '').toLowerCase().trim() !== String(intent.actorEmail) ||
      String(persisted.ActorRole || '') !== String(intent.actorRole) ||
      String(persisted.Action || '') !== String(intent.action) ||
      String(persisted.Module || '') !== 'actionPermission' ||
      String(persisted.TargetSheet || '') !== String(intent.targetSheet) ||
      String(persisted.TargetID || '') !== String(intent.targetId) ||
      String(persisted.Result || '').toLowerCase() !== normalizedResult) {
    throw new Error('ไม่สามารถยืนยัน critical audit completion ' + intent.logId);
  }
  return true;
}

/** Lock-free; call only while apWithLock_ owns ScriptLock. */
function apReadAuditRowLocked_(rowNumber) {
  const sh = getSheet_(SHEETS.AUDIT_TRAIL);
  if (!sh || rowNumber < 2 || rowNumber > sh.getLastRow()) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const row = { _row: rowNumber };
  headers.forEach(function (header, index) { row[header] = values[index]; });
  return row;
}

/** Lock-free; call only while apWithLock_ owns the ScriptLock. */
function apAppendRowLocked_(sheetName, dataObj, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const now = new Date();
  const data = Object.assign({}, dataObj || {});
  if (headers.indexOf('Timestamp') > -1 && !data.Timestamp) data.Timestamp = now;
  if (headers.indexOf('CreatedBy') > -1 && !data.CreatedBy) data.CreatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedBy') > -1) data.LastUpdatedBy = actorEmail || '';
  if (headers.indexOf('LastUpdatedAt') > -1) data.LastUpdatedAt = now;
  const values = headers.map(function (header) {
    return sheetSafeValue_(Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '');
  });
  const rowNumber = Math.max(2, sh.getLastRow() + 1);
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  apResetRuntimeReadCache_();
  return rowNumber;
}

/** Lock-free; call only while apWithLock_ owns the ScriptLock. */
function apUpdateRowLocked_(sheetName, rowNumber, patch, actorEmail) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  const now = new Date();
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, header)) {
      values[index] = sheetSafeValue_(patch[header]);
    }
    if (header === 'LastUpdatedBy') values[index] = actorEmail || '';
    if (header === 'LastUpdatedAt') values[index] = now;
  });
  range.setValues([values]);
  apResetRuntimeReadCache_();
  return true;
}

/** Read without auto-creating a missing sheet; authorization must not mutate schema. */
function apReadSheetIfPresent_(sheetName) {
  const now = Date.now();
  if (!AP_RUNTIME_READ_CACHE_ || AP_RUNTIME_READ_CACHE_.expiresAt <= now) {
    AP_RUNTIME_READ_CACHE_ = { expiresAt: now + 30000, rows: {} };
  }
  if (Object.prototype.hasOwnProperty.call(AP_RUNTIME_READ_CACHE_.rows, sheetName)) {
    return AP_RUNTIME_READ_CACHE_.rows[sheetName];
  }
  const sh = getDB_().getSheetByName(sheetName);
  if (!sh) {
    AP_RUNTIME_READ_CACHE_.rows[sheetName] = [];
    return [];
  }
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    AP_RUNTIME_READ_CACHE_.rows[sheetName] = [];
    return [];
  }
  const headers = values[0];
  const rows = values.slice(1).map(function (row, offset) {
    const obj = { _row: offset + 2 };
    headers.forEach(function (header, index) { obj[header] = row[index]; });
    return obj;
  });
  AP_RUNTIME_READ_CACHE_.rows[sheetName] = rows;
  return rows;
}

function apResetRuntimeReadCache_() {
  AP_RUNTIME_READ_CACHE_ = { expiresAt: 0, rows: {} };
}

function apPermissionArgs_(actorArg, permissionArg, contextArg) {
  const firstLooksLikePermission = typeof actorArg === 'string' &&
    /^[a-z][a-z0-9]*(?:[._:-][a-z0-9_:-]+)+$/i.test(String(actorArg).trim()) &&
    String(actorArg).indexOf('@') === -1;
  if (firstLooksLikePermission && (permissionArg === undefined ||
    (permissionArg && typeof permissionArg === 'object' && !Array.isArray(permissionArg)))) {
    return {
      actor: permissionArg && (permissionArg.email || permissionArg.role) ? permissionArg : null,
      permissionKey: actorArg,
      context: permissionArg && !(permissionArg.email || permissionArg.role) ? permissionArg : contextArg || {}
    };
  }
  if (firstLooksLikePermission && typeof permissionArg === 'string' &&
    (permissionArg.indexOf('@') > -1 || Object.keys(ROLE_LABELS).indexOf(permissionArg) > -1)) {
    return { actor: permissionArg, permissionKey: actorArg, context: contextArg || {} };
  }
  return { actor: actorArg || null, permissionKey: permissionArg, context: contextArg || {} };
}

function apResolveActor_(actorArg) {
  let actor = actorArg;
  if (!actor) actor = getCurrentUser();
  if (typeof actor === 'string') {
    actor = actor.indexOf('@') > -1 ? { email: actor } : { role: actor };
  }
  if (!actor || typeof actor !== 'object') return null;
  const email = String(actor.email || actor.Email || '').toLowerCase().trim();
  if (email) {
    if (!isValidEmail(email)) return null;
    const userRow = apReadSheetIfPresent_(SHEETS.USERS).filter(function (row) {
      return String(row.Email || '').toLowerCase().trim() === email && apIsActiveStatus_(row.Status);
    })[0];
    if (!userRow || !apKnownRole_(userRow.Role)) return null;
    return {
      email: email,
      role: String(userRow.Role),
      name: userRow.FullName || email,
      department: userRow.Department || ''
    };
  }
  const role = String(actor.role || actor.Role || '');
  return apKnownRole_(role) ? { email: '', role: role, name: '', department: '' } : null;
}

function apKnownRole_(role) {
  return Object.keys(ROLE_LABELS).indexOf(String(role || '')) > -1;
}

function apNormalizeRole_(value) {
  const role = sanitizeText(value, 80);
  if (!apKnownRole_(role)) throw new Error('บทบาทไม่ถูกต้อง');
  return role;
}

function apNormalizePermissionKey_(value, required) {
  const key = String(sanitizeText(value, 120) || '').toLowerCase().trim();
  if (!key) {
    if (required) throw new Error('กรุณาระบุ PermissionKey');
    return '';
  }
  if (!/^[a-z][a-z0-9]*(?:[._:-][a-z0-9_:-]+)+$/.test(key)) {
    if (required) throw new Error('รูปแบบ PermissionKey ไม่ถูกต้อง');
    return '';
  }
  return key;
}

function apAssertKnownPermission_(permissionKey) {
  if (AP_PERMISSION_FALLBACK_[permissionKey]) return true;
  const found = apReadSheetIfPresent_(SHEETS.ACTION_PERMISSION).some(function (row) {
    return apNormalizePermissionKey_(row.PermissionKey, false) === permissionKey;
  });
  if (!found) throw new Error('PermissionKey นี้ยังไม่ได้ลงทะเบียนใน ActionPermissions');
  return true;
}

function apNormalizeEffect_(value, required) {
  const normalized = String(value || '').trim().toUpperCase();
  const aliases = {
    ALLOW: 'ALLOW', GRANT: 'ALLOW', PERMIT: 'ALLOW', YES: 'ALLOW', 'อนุญาต': 'ALLOW',
    DENY: 'DENY', BLOCK: 'DENY', NO: 'DENY', 'ไม่อนุญาต': 'DENY'
  };
  const effect = aliases[normalized] || aliases[String(value || '').trim()] || '';
  if (!effect && required) throw new Error('Effect ต้องเป็น ALLOW หรือ DENY');
  return effect;
}

function apNormalizeStatus_(value, required) {
  const text = String(value === undefined || value === null || value === '' ? 'Active' : value).trim();
  if (apIsActiveStatus_(text)) return 'Active';
  if (['inactive', 'disabled', 'no', 'false', '0', 'ระงับ', 'ยกเลิก', 'ไม่ใช้งาน']
    .indexOf(text.toLowerCase()) > -1) return 'Inactive';
  if (required) throw new Error('สถานะต้องเป็น Active หรือ Inactive');
  return '';
}

function apIsActiveStatus_(value) {
  return ['active', 'enabled', 'yes', 'true', '1', 'ใช้งาน']
    .indexOf(String(value || '').toLowerCase().trim()) > -1;
}

function apNormalizeMemberRole_(value, required) {
  const raw = String(value || 'MEMBER').trim();
  const aliases = {
    PRIMARY: 'PRIMARY', LEAD: 'PRIMARY', OWNER: 'PRIMARY', 'หลัก': 'PRIMARY',
    MEMBER: 'MEMBER', APPROVER: 'MEMBER', 'สมาชิก': 'MEMBER',
    BACKUP: 'BACKUP', DELEGATE: 'BACKUP', 'สำรอง': 'BACKUP'
  };
  const role = aliases[raw.toUpperCase()] || aliases[raw] || '';
  if (!role && required !== false) throw new Error('MemberRole ต้องเป็น PRIMARY, MEMBER หรือ BACKUP');
  return role;
}

function apPriority_(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 100;
  const n = Number(value);
  if (!isFinite(n) || n < 1 || n > 999 || Math.floor(n) !== n) {
    throw new Error('Priority ต้องเป็นจำนวนเต็ม 1-999');
  }
  return n;
}

function apParseOptionalDate_(value, label, endOfDay) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw new Error((label || 'วันที่') + ' ไม่ถูกต้อง');
    return new Date(value.getTime());
  }
  const text = String(value).trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    if (d.getFullYear() !== Number(match[1]) || d.getMonth() !== Number(match[2]) - 1 ||
      d.getDate() !== Number(match[3])) throw new Error((label || 'วันที่') + ' ไม่ถูกต้อง');
    return d;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)) {
    throw new Error((label || 'วันที่') + ' ต้องเป็น yyyy-MM-dd หรือ ISO datetime');
  }
  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) throw new Error((label || 'วันที่') + ' ไม่ถูกต้อง');
  return parsed;
}

function apDateForRuntime_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());
  try { return apParseOptionalDate_(value, 'วันที่อ้างอิง', false) || null; }
  catch (e) { return null; }
}

function apEffectiveNow_(startValue, endValue, atDate) {
  const at = atDate instanceof Date ? atDate : new Date(atDate);
  if (isNaN(at.getTime())) return false;
  let start = null, end = null;
  try {
    if (startValue !== undefined && startValue !== null && startValue !== '') {
      start = startValue instanceof Date ? startValue : apParseOptionalDate_(startValue, 'วันที่เริ่ม', false);
    }
    if (endValue !== undefined && endValue !== null && endValue !== '') {
      end = endValue instanceof Date ? endValue : apParseOptionalDate_(endValue, 'วันที่สิ้นสุด', true);
    }
  } catch (e) {
    return false; // malformed stored date is never treated as active
  }
  if (start && (isNaN(start.getTime()) || at.getTime() < start.getTime())) return false;
  if (end && (isNaN(end.getTime()) || at.getTime() > end.getTime())) return false;
  return true;
}

function apRequireActiveUser_(email, label) {
  const row = apReadSheetIfPresent_(SHEETS.USERS).filter(function (item) {
    return String(item.Email || '').toLowerCase().trim() === String(email || '').toLowerCase().trim() &&
      apIsActiveStatus_(item.Status);
  })[0];
  if (!row) throw new Error((label || 'ผู้ใช้') + ' ต้องเป็นบัญชี Active ในระบบ');
  return row;
}

function apFindApprovalGroup_(groupIdOrCode) {
  const key = String(groupIdOrCode || '').trim();
  if (!key) return null;
  return readSheetObjectsEnsured_(SHEETS.APPROVAL_GROUP, true).filter(function (row) {
    return String(row.GroupID || '') === key ||
      String(row.GroupCode || '').toUpperCase().trim() === key.toUpperCase();
  })[0] || null;
}

function apPermissionDto_(row, source) {
  return {
    permissionKey: apNormalizePermissionKey_(row.PermissionKey, false),
    moduleKey: row.ModuleKey || '',
    action: row.Action || '',
    description: row.Description || '',
    status: row.Status || '',
    source: source || 'sheet'
  };
}

function apRolePermissionDto_(row) {
  return {
    id: row.MappingID,
    role: row.Role,
    permissionKey: apNormalizePermissionKey_(row.PermissionKey, false),
    effect: apNormalizeEffect_(row.Effect, false) || '',
    status: row.Status || '',
    notes: row.Notes || '',
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt)
  };
}

function apUserOverrideDto_(row) {
  return {
    id: row.OverrideID,
    userEmail: String(row.UserEmail || '').toLowerCase().trim(),
    permissionKey: apNormalizePermissionKey_(row.PermissionKey, false),
    effect: apNormalizeEffect_(row.Effect, false) || '',
    startAt: safeFmtDateTime_(row.StartAt),
    endAt: safeFmtDateTime_(row.EndAt),
    reason: row.Reason || '',
    status: row.Status || '',
    approvedBy: row.ApprovedBy || '',
    effectiveNow: apIsActiveStatus_(row.Status) && apEffectiveNow_(row.StartAt, row.EndAt, new Date()),
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt)
  };
}

function apGroupDto_(row) {
  return {
    id: row.GroupID,
    code: row.GroupCode,
    name: row.GroupName,
    department: row.Department || '',
    description: row.Description || '',
    status: row.Status || '',
    ownerEmail: row.OwnerEmail || '',
    notes: row.Notes || '',
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt)
  };
}

function apGroupMemberDto_(row) {
  return {
    id: row.MemberID,
    groupId: row.GroupID,
    userEmail: String(row.UserEmail || '').toLowerCase().trim(),
    memberRole: apNormalizeMemberRole_(row.MemberRole, false) || 'MEMBER',
    priority: Number(row.Priority) || 100,
    validFrom: safeFmtDateTime_(row.ValidFrom),
    validUntil: safeFmtDateTime_(row.ValidUntil),
    status: row.Status || '',
    notes: row.Notes || '',
    effectiveNow: apIsActiveStatus_(row.Status) && apEffectiveNow_(row.ValidFrom, row.ValidUntil, new Date()),
    updatedAt: safeFmtDateTime_(row.LastUpdatedAt)
  };
}
