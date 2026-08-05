/**
 * Module_AuditTrail.gs
 * หน้าดู/ค้นหา Audit Trail ของระบบ (read-only)
 * ผู้เข้าถึง: IT Admin (จัดการ), Executive (อ่าน) — ตรวจสิทธิ์ฝั่ง Server
 * อ้างอิง: สนับสนุนทุกหมวด
 */

function getAuditTrail(filters) {
  try {
    requireModule('auditTrail', false);
    filters = filters || {};
    const fromD = filters.from ? new Date(filters.from) : null;
    const toD = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const fActor = String(filters.actor || '').toLowerCase().trim();
    const fAction = String(filters.action || '').trim();
    const fModule = String(filters.module || '').trim();
    const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);

    const all = readSheetObjects_(SHEETS.AUDIT_TRAIL);
    const out = [];
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const r = all[i];
      const ts = (r.Timestamp instanceof Date) ? r.Timestamp : new Date(r.Timestamp);
      if (fromD && ts < fromD) continue;
      if (toD && ts > toD) continue;
      if (fActor && String(r.ActorEmail).toLowerCase().indexOf(fActor) === -1) continue;
      if (fAction && String(r.Action) !== fAction) continue;
      if (fModule && String(r.Module) !== fModule) continue;
      out.push({
        time: fmtDateTime(r.Timestamp), actor: r.ActorEmail, role: r.ActorRole,
        action: r.Action, module: r.Module, target: r.TargetSheet + (r.TargetID ? '/' + r.TargetID : ''),
        detail: r.Detail, result: r.Result
      });
    }

    // ค่าตัวเลือกสำหรับ filter (distinct)
    const actions = {}, modules = {};
    all.forEach(function (r) {
      if (r.Action) actions[r.Action] = true;
      if (r.Module) modules[r.Module] = true;
    });

    return ok({
      rows: out, total: all.length, shown: out.length,
      actions: Object.keys(actions).sort(), modules: Object.keys(modules).sort()
    });
  } catch (e) { return fail(e.message); }
}
