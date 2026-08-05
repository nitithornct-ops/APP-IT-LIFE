/**
 * Module_KB.gs
 * ฐานความรู้ (Knowledge Base) สำหรับ Help Desk
 *  - IT Admin: สร้าง/แก้ไข/เผยแพร่บทความวิธีแก้ปัญหาที่พบบ่อย
 *  - ผู้ใช้ทุกบทบาท: ค้นหาและอ่านบทความที่ "เผยแพร่" เพื่อแก้ปัญหาด้วยตนเอง (ลดงานซ้ำ)
 * เชื่อมกับโมดูล Ticket ผ่านหมวดหมู่ (Category) เดียวกัน
 */

const KB_STATUS = { PUBLISHED: 'เผยแพร่', DRAFT: 'ร่าง' };

function getKBModuleData() {
  try {
    const user = requireModule('kb', false);
    ensureSheetBySchema_(SHEETS.KB);
    const isIT = canEditModule(user.role, 'kb');

    let rows = readSheetObjects_(SHEETS.KB);
    if (!isIT) rows = rows.filter(function (r) { return String(r.Status) === KB_STATUS.PUBLISHED; });

    const articles = rows.map(serializeArticle_).sort(function (a, b) { return b.views - a.views; });

    // หมวดหมู่ใช้ร่วมกับ Ticket เพื่อความสอดคล้อง
    let categories = [];
    try {
      categories = readSheetObjects_(SHEETS.TICKET_CATEGORY)
        .filter(function (c) { return String(c.Status || 'Active').toLowerCase() !== 'inactive'; })
        .map(function (c) { return c.CategoryName; }).filter(String);
    } catch (e) {}
    // เติมหมวดที่บทความใช้อยู่จริงแต่ไม่อยู่ในทะเบียน
    articles.forEach(function (a) { if (a.category && categories.indexOf(a.category) === -1) categories.push(a.category); });

    return ok({ role: user.role, canManage: isIT, statuses: [KB_STATUS.PUBLISHED, KB_STATUS.DRAFT],
      categories: categories, articles: articles });
  } catch (e) { return fail(e.message); }
}

function serializeArticle_(r) {
  return {
    row: r._row, id: r.ArticleID, title: r.Title, category: r.Category,
    symptom: r.Symptom, solution: r.Solution, tags: r.Tags, status: r.Status,
    views: Number(r.Views) || 0, helpful: Number(r.Helpful) || 0,
    updatedAt: safeFmtDate_(r.LastUpdatedAt || r.Timestamp), author: r.CreatedBy
  };
}

/** IT: เพิ่มบทความ */
function addArticle(form) {
  try {
    const user = requireModule('kb', true);
    ensureSheetBySchema_(SHEETS.KB);
    form = form || {};
    const title = sanitizeText(form.title, 200);
    const solution = sanitizeText(form.solution, 5000);
    requireFields({ Title: title, Solution: solution }, ['Title', 'Solution']);
    const status = (form.status === KB_STATUS.DRAFT) ? KB_STATUS.DRAFT : KB_STATUS.PUBLISHED;
    const id = generateId('KB');
    appendRow_(SHEETS.KB, {
      ArticleID: id, Title: title, Category: sanitizeText(form.category, 80),
      Symptom: sanitizeText(form.symptom, 2000), Solution: solution,
      Tags: sanitizeText(form.tags, 200), Status: status, Views: 0, Helpful: 0
    }, user.email);
    writeAudit_(user, 'CREATE', 'kb', SHEETS.KB, id, title, 'success');
    return ok('บันทึกบทความเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

/** IT: แก้ไขบทความ */
function updateArticle(id, form) {
  try {
    const user = requireModule('kb', true);
    const a = findRow_(SHEETS.KB, 'ArticleID', id);
    if (!a) throw new Error('ไม่พบบทความ ' + id);
    form = form || {};
    const title = sanitizeText(form.title, 200);
    const solution = sanitizeText(form.solution, 5000);
    requireFields({ Title: title, Solution: solution }, ['Title', 'Solution']);
    updateRow_(SHEETS.KB, a._row, {
      Title: title, Category: sanitizeText(form.category, 80),
      Symptom: sanitizeText(form.symptom, 2000), Solution: solution, Tags: sanitizeText(form.tags, 200)
    }, user.email);
    writeAudit_(user, 'UPDATE', 'kb', SHEETS.KB, id, title, 'success');
    return ok('แก้ไขบทความเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** IT: เผยแพร่/เก็บเป็นร่าง */
function setArticleStatus(id, status) {
  try {
    const user = requireModule('kb', true);
    if (!isInList(status, [KB_STATUS.PUBLISHED, KB_STATUS.DRAFT])) throw new Error('สถานะไม่ถูกต้อง');
    const a = findRow_(SHEETS.KB, 'ArticleID', id);
    if (!a) throw new Error('ไม่พบบทความ ' + id);
    updateRow_(SHEETS.KB, a._row, { Status: status }, user.email);
    writeAudit_(user, 'SET_STATUS', 'kb', SHEETS.KB, id, status, 'success');
    return ok('อัปเดตสถานะเป็น "' + status + '" แล้ว');
  } catch (e) { return fail(e.message); }
}

/** อ่านบทความ + เพิ่มยอดวิว (ผู้ใช้ทุกบทบาทที่เข้าถึงได้) */
function kbView(id) {
  try {
    const user = requireModule('kb', false);
    const a = findRow_(SHEETS.KB, 'ArticleID', id);
    if (!a) throw new Error('ไม่พบบทความ ' + id);
    const isIT = canEditModule(user.role, 'kb');
    if (!isIT && String(a.Status) !== KB_STATUS.PUBLISHED) throw new Error('บทความนี้ยังไม่เผยแพร่');
    // นับวิวเฉพาะผู้อ่านทั่วไป (กันยอดเฟ้อจากการแก้ไขของ IT)
    if (!isIT) updateRow_(SHEETS.KB, a._row, { Views: (Number(a.Views) || 0) + 1 }, a.LastUpdatedBy || 'system');
    return ok(serializeArticle_(a));
  } catch (e) { return fail(e.message); }
}

/** โหวต "มีประโยชน์" (คนละ 1 ครั้งต่อรอบการเปิดหน้า — กันซ้ำเบื้องต้นที่ client) */
function kbHelpful(id) {
  try {
    requireModule('kb', false);
    const a = findRow_(SHEETS.KB, 'ArticleID', id);
    if (!a) throw new Error('ไม่พบบทความ ' + id);
    updateRow_(SHEETS.KB, a._row, { Helpful: (Number(a.Helpful) || 0) + 1 }, a.LastUpdatedBy || 'system');
    return ok('ขอบคุณสำหรับความคิดเห็น');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// Public (หน้าแจ้งซ่อมสาธารณะ ไม่ต้องล็อกอิน) — อ่านบทความที่ "เผยแพร่" เท่านั้น
// เรียกตรงจาก PublicTicket.html (เหมือน getPublicTicketFormData) ไม่ผ่าน api()
// ===================================================================
function getPublicKB(query, category) {
  try {
    let rows = [];
    try { rows = readSheetObjects_(SHEETS.KB); } catch (e) { return ok({ articles: [] }); }
    const q = sanitizeText(query, 100).toLowerCase();
    const cat = sanitizeText(category, 80);
    const list = rows
      .filter(function (r) { return String(r.Status) === KB_STATUS.PUBLISHED; })
      .filter(function (r) { return !cat || String(r.Category) === cat; })
      .filter(function (r) {
        if (!q) return true;
        return (String(r.Title) + ' ' + r.Symptom + ' ' + r.Solution + ' ' + r.Tags + ' ' + r.Category).toLowerCase().indexOf(q) > -1;
      })
      .sort(function (a, b) { return (Number(b.Views) || 0) - (Number(a.Views) || 0); })
      .slice(0, 30)
      .map(function (r) {
        return {
          id: r.ArticleID, title: r.Title, category: r.Category,
          symptom: r.Symptom, solution: r.Solution, tags: r.Tags,
          views: Number(r.Views) || 0, helpful: Number(r.Helpful) || 0
        };
      });
    // หมวดหมู่ของบทความที่เผยแพร่ (สำหรับตัวกรอง)
    const cats = [];
    rows.forEach(function (r) {
      if (String(r.Status) === KB_STATUS.PUBLISHED && r.Category && cats.indexOf(r.Category) === -1) cats.push(r.Category);
    });
    return ok({ articles: list, categories: cats });
  } catch (e) { return fail(e.message); }
}

/** Public: นับยอดอ่านเมื่อผู้ใช้กางบทความ (เฉพาะที่เผยแพร่) — fire-and-forget */
function viewPublicKB(id, clientId) {
  try {
    id = sanitizeText(id, 80);
    clientId = sanitizePublicClientId_(clientId);
    if (!clientId) return ok(false);
    checkPublicLookupRate_('kb_view_' + id, clientId, 3, 3600);
    const a = findRow_(SHEETS.KB, 'ArticleID', id);
    if (!a || String(a.Status) !== KB_STATUS.PUBLISHED) return ok(false);
    updateRow_(SHEETS.KB, a._row, { Views: (Number(a.Views) || 0) + 1 }, 'public');
    return ok(true);
  } catch (e) { return ok(false); }
}

/** จำนวนบทความที่เกี่ยวข้องกับหมวด (ใช้โชว์ตัวเลขนำทางบนฟอร์มแจ้งซ่อม) */
function countPublicKBByCategory(category) {
  try {
    let rows = [];
    try { rows = readSheetObjects_(SHEETS.KB); } catch (e) { return ok(0); }
    const cat = sanitizeText(category, 80);
    const n = rows.filter(function (r) {
      return String(r.Status) === KB_STATUS.PUBLISHED && (!cat || String(r.Category) === cat);
    }).length;
    return ok(n);
  } catch (e) { return ok(0); }
}
