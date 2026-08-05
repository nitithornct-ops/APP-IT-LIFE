/**
 * Module_InventoryExtras.gs
 * ส่วนเสริมของโมดูล Inventory:
 *  1) ปรับยอด/ตรวจนับสต็อก (adjustInventoryStock) — บันทึกผลต่าง (variance) เป็นรายการ ADJUST
 *  2) บัญชีเคลื่อนไหวรายตัว (getInventoryLedger)
 *  3) รายงานวิเคราะห์ Inventory (getInventoryAnalytics) — มูลค่าสต็อก, ตามหมวด, แนวโน้มเข้า-ออก, ใช้เยอะ
 */

// ===================================================================
// 1) ปรับยอด / ตรวจนับสต็อก
// ===================================================================
function adjustInventoryStock(form) {
  try {
    const user = requireModule('inventory', true);
    form = form || {};
    const itemId = sanitizeText(form.itemId, 80);
    requireFields({ ItemID: itemId, 'จำนวนที่นับได้': form.counted }, ['ItemID', 'จำนวนที่นับได้']);
    const counted = numberOrZero_(form.counted);
    if (counted < 0) throw new Error('จำนวนที่นับได้ต้องไม่ติดลบ');
    const item = findRowEnsured_(SHEETS.INVENTORY, 'ItemID', itemId);
    if (!item) throw new Error('ไม่พบรายการ Inventory');
    const current = numberOrZero_(item.StockQty);
    const variance = counted - current;
    updateRow_(SHEETS.INVENTORY, item._row, { StockQty: counted }, user.email);
    const id = generateId('TX');
    appendRowEnsured_(SHEETS.INVENTORY_TX, {
      TransactionID: id, ItemID: itemId, ItemName: item.ItemName, TransactionType: 'ADJUST',
      Qty: Math.abs(variance), TicketID: '', ActionDate: new Date(),
      Notes: 'ตรวจนับ: จาก ' + current + ' → ' + counted + (form.notes ? ' | ' + sanitizeText(form.notes, 400) : ''),
      BalanceAfter: counted, Variance: variance
    }, user.email);
    writeAudit_(user, 'STOCK_ADJUST', 'inventory', SHEETS.INVENTORY, itemId,
      current + '→' + counted + ' (' + (variance >= 0 ? '+' : '') + variance + ')', 'success');
    return ok('ปรับยอด/ตรวจนับเรียบร้อย (ผลต่าง ' + (variance >= 0 ? '+' : '') + variance + ')');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 2) บัญชีเคลื่อนไหวรายตัว (Ledger)
// ===================================================================
function getInventoryLedger(itemId) {
  try {
    requireModule('inventory', false);
    itemId = sanitizeText(itemId, 80);
    const item = findRowEnsured_(SHEETS.INVENTORY, 'ItemID', itemId);
    if (!item) throw new Error('ไม่พบรายการ Inventory');
    const rows = readSheetObjectsEnsured_(SHEETS.INVENTORY_TX)
      .filter(function (r) { return String(r.ItemID) === String(itemId); })
      .sort(function (a, b) { return new Date(b.ActionDate || b.Timestamp) - new Date(a.ActionDate || a.Timestamp); })
      .slice(0, 200)
      .map(function (r) {
        return {
          id: r.TransactionID, type: r.TransactionType, qty: numberOrZero_(r.Qty),
          balanceAfter: (r.BalanceAfter === '' || r.BalanceAfter === undefined || r.BalanceAfter === null) ? null : numberOrZero_(r.BalanceAfter),
          variance: r.Variance, ticketId: r.TicketID,
          date: safeFmtDateTime_(r.ActionDate || r.Timestamp), notes: r.Notes
        };
      });
    return ok({
      item: { id: item.ItemID, name: item.ItemName, unit: item.Unit, stock: numberOrZero_(item.StockQty), min: numberOrZero_(item.MinQty) },
      transactions: rows
    });
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// 3) รายงานวิเคราะห์ Inventory
// ===================================================================
function getInventoryAnalytics() {
  try {
    const user = requireModule('inventory', false);
    if (user.role === ROLES.USER) throw new Error('บทบาทนี้ไม่มีสิทธิ์ดูรายงานวิเคราะห์');
    const now = new Date();
    const items = readSheetObjectsEnsured_(SHEETS.INVENTORY);

    let totalValue = 0, low = 0, activeCount = 0;
    const byCategory = {};
    items.forEach(function (r) {
      if (String(r.Status).toLowerCase() === 'inactive') return;
      activeCount++;
      const stock = numberOrZero_(r.StockQty), min = numberOrZero_(r.MinQty), price = numberOrZero_(r.UnitPrice);
      const val = stock * price;
      totalValue += val;
      if (stock <= min) low++;
      const ck = String(r.Category || 'ไม่ระบุ');
      byCategory[ck] = byCategory[ck] || { count: 0, value: 0 };
      byCategory[ck].count++; byCategory[ck].value += val;
    });

    const tx = readSheetObjectsEnsured_(SHEETS.INVENTORY_TX);
    const trend = {}, topOut = {};
    const monthKey = function (d) { return Utilities.formatDate(new Date(d), 'Asia/Bangkok', 'yyyy-MM'); };
    tx.forEach(function (r) {
      const dt = r.ActionDate || r.Timestamp;
      if (!dt) return;
      const d = new Date(dt);
      if (isNaN(d)) return;
      const k = monthKey(d);
      trend[k] = trend[k] || { in: 0, out: 0 };
      const q = numberOrZero_(r.Qty);
      if (String(r.TransactionType) === 'IN') trend[k].in += q;
      else if (String(r.TransactionType) === 'OUT') { trend[k].out += q; const nm = r.ItemName || r.ItemID; topOut[nm] = (topOut[nm] || 0) + q; }
    });

    const trendArr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      const v = trend[k] || { in: 0, out: 0 };
      trendArr.push({ month: k, in: v.in, out: v.out });
    }
    const catArr = Object.keys(byCategory).map(function (k) {
      return { label: k, count: byCategory[k].count, value: Math.round(byCategory[k].value) };
    }).sort(function (a, b) { return b.value - a.value; });
    const topArr = Object.keys(topOut).map(function (k) { return { label: k, value: topOut[k] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);

    return ok({
      totalValue: Math.round(totalValue), activeCount: activeCount, low: low,
      byCategory: catArr, trend: trendArr, topConsumed: topArr
    });
  } catch (e) { return fail(e.message); }
}
