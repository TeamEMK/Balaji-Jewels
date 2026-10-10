// ══════════════════════════════════════════════════════
// O2D FMS — Demo data: status + remove (admin).
// Demo orders browser se asli API ke through bante hain (js/o2d-demo.js) —
// yahan sirf "loaded hai?" aur "sab demo hata do". Saare demo masters
// "DEMO - " se shuru hote hain; asli data ko haath nahi lagta.
// ══════════════════════════════════════════════════════
const PREFIX = 'DEMO - ';

module.exports = function registerO2DDemo(app, ctx) {
  const { db, requireAuth, requireAdmin, lib, wrap } = ctx;
  const { int, withTx } = lib;

  async function demoCustomerIds(q) {
    const [rows] = await q.query('SELECT id FROM fms_customers WHERE client_name LIKE ?', [PREFIX + '%']);
    return rows.map(r => r.id);
  }

  app.get('/api/o2d/demo', requireAuth, wrap(async (req, res) => {
    const cids = await demoCustomerIds(db);
    let orders = 0;
    if (cids.length) {
      const [o] = await db.query(`SELECT COUNT(*) AS n FROM fms_orders WHERE client_id IN (${cids.map(() => '?').join(',')})`, cids);
      orders = int(o[0].n);
    }
    const [v] = await db.query('SELECT COUNT(*) AS n FROM fms_vendors WHERE vendor_name LIKE ?', [PREFIX + '%']);
    res.json({ loaded: cids.length > 0 || int(v[0].n) > 0, customers: cids.length, vendors: int(v[0].n), orders });
  }));

  async function removeDemo() {
    return withTx(db, async (q) => {
      const cids = await demoCustomerIds(q);
      let orders = 0;
      if (cids.length) {
        const marks = cids.map(() => '?').join(',');
        const [os] = await q.query(`SELECT id FROM fms_orders WHERE client_id IN (${marks})`, cids);
        for (const o of os) {
          const [still] = await q.query('SELECT id FROM fms_orders WHERE id=?', [o.id]);
          if (still[0]) { await ctx.o2dHardDeleteOrder(q, o.id, { allowShared: true }); orders++; }
        }
        // Receipts (paisa) — ye demo customers ke hi hain
        const [rs] = await q.query(`SELECT id FROM fms_payment_receipt WHERE customer_id IN (${marks})`, cids);
        const rids = rs.map(r => r.id);
        if (rids.length) {
          const rm = rids.map(() => '?').join(',');
          await q.query(`DELETE FROM fms_payment_allocation WHERE receipt_id IN (${rm})`, rids);
          await q.query(`DELETE FROM fms_payment_category_allocation WHERE receipt_id IN (${rm})`, rids);
          await q.query(`DELETE FROM fms_payment_receipt WHERE id IN (${rm})`, rids);
        }
        await q.query(`DELETE FROM fms_vendor_issue WHERE customer_id IN (${marks})
                         AND NOT EXISTS (SELECT 1 FROM fms_vendor_issue_line l WHERE l.issue_id=fms_vendor_issue.id)`, cids);
        await q.query(`DELETE FROM fms_customers WHERE id IN (${marks})`, cids);
      }
      // Demo vendors — kisi asli order me use hue hon to sirf inactive
      const [vs] = await q.query('SELECT id FROM fms_vendors WHERE vendor_name LIKE ?', [PREFIX + '%']);
      for (const { id } of vs) {
        const [u] = await q.query(
          `SELECT (SELECT COUNT(*) FROM fms_vendor_issue WHERE vendor_id=?) + (SELECT COUNT(*) FROM fms_cad WHERE cad_vendor_id=?)
                + (SELECT COUNT(*) FROM fms_requirement WHERE vendor_id=?) + (SELECT COUNT(*) FROM fms_hallmark WHERE hallmark_centre_id=?)
                + (SELECT COUNT(*) FROM fms_vendor_receipt WHERE vendor_id=?) AS n`, [id, id, id, id, id]);
        if (int(u[0].n)) await q.query('UPDATE fms_vendors SET is_active=0 WHERE id=?', [id]);
        else await q.query('DELETE FROM fms_vendors WHERE id=?', [id]);
      }
      return { orders, customers: cids.length, vendors: vs.length };
    });
  }

  app.delete('/api/o2d/demo', requireAuth, requireAdmin, wrap(async (req, res) => {
    res.json({ success: true, ...(await removeDemo()) });
  }));
};
