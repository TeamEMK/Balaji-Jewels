// ══════════════════════════════════════════════════════
// O2D FMS — Demo data (admin): 6 orders alag-alag stage par, taaki har screen
// me kuch dikhe aur team system samajh sake.
// ──────────────────────────────────────────────────────
// Data asli API se hi banta hai — process ke andar ek temporary loopback
// listener khol kar, admin ke hi login (cookie/token) se — isliye har order ki
// status, follow-up, bagging, invoice ginti bilkul waisi hi hoti hai jaise
// haath se banane par. Saare demo masters "DEMO - " se shuru hote hain, aur
// "Remove demo data" unhe aur unke orders ko poora mita deta hai.
// ══════════════════════════════════════════════════════
const http = require('http');

const PREFIX = 'DEMO - ';
const PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6300010000050001A5F645400000000049454E44AE426082', 'hex');

module.exports = function registerO2DDemo(app, ctx) {
  const { db, requireAuth, requireAdmin, lib, wrap } = ctx;
  const { todayIST, addDays, int, fail, withTx } = lib;

  // Loopback client: same app, same auth as the admin who clicked
  async function selfClient(req) {
    const server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const auth = {};
    if (req.headers.cookie) auth.cookie = req.headers.cookie;
    if (req.headers.authorization) auth.authorization = req.headers.authorization;
    const call = (method, url, body, raw) => new Promise((resolve, reject) => {
      const payload = raw || (body ? Buffer.from(JSON.stringify(body)) : null);
      const headers = { ...auth };
      if (payload) {
        headers['content-type'] = raw ? 'application/octet-stream' : 'application/json';
        headers['content-length'] = payload.length;
      }
      const r = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { data = {}; }
          if (res.statusCode >= 400) return reject(new lib.O2DError(`Demo step failed (${method} ${url.split('?')[0]}): ${data.error || res.statusCode}`, 500));
          resolve(data);
        });
      });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
    return { call, close: () => new Promise(resolve => server.close(() => resolve())) };
  }

  async function demoCustomerIds(q) {
    const [rows] = await q.query('SELECT id FROM fms_customers WHERE client_name LIKE ?', [PREFIX + '%']);
    return rows.map(r => r.id);
  }

  app.get('/api/o2d/demo', requireAuth, wrap(async (req, res) => {
    res.json({ loaded: (await demoCustomerIds(db)).length > 0 });
  }));

  app.post('/api/o2d/demo', requireAuth, requireAdmin, wrap(async (req, res) => {
    if ((await demoCustomerIds(db)).length) fail('Demo data is already loaded — remove it first');
    const me = req.session.userId;
    const today = todayIST();
    const plus = (n) => addDays(today, n);
    const c = await selfClient(req);
    const made = [];
    try {
      const { call } = c;
      const lk = await call('GET', '/api/o2d/lookups');
      const quality = (lk.quality.find(x => x.is_active) || lk.quality[0] || {}).id;
      const igi = (lk.labs.find(l => l.name === 'IGI') || lk.labs[0] || {}).id;
      if (!quality || !igi) fail('Quality / Lab masters are empty — add at least one of each first');

      // ── Masters ──
      const shree = await call('POST', '/api/o2d/customers', {
        client_name: PREFIX + 'Shree Jewellers', company_name: 'Shree Jewellers Pvt Ltd', contact_number: '9800000001', city: 'Jaipur', state: 'Rajasthan',
        labour_rate: 550, labour_rate_basis: 'Per Gram', gold_tunch_pct: 76, quality_id: quality, certificate_required: 1, default_lab_id: igi,
        payment_terms_days: 30, payment_style: 'Category-wise', sales_person_id: me, is_active: 1 });
      const ratna = await call('POST', '/api/o2d/customers', {
        client_name: PREFIX + 'Ratna Gems', company_name: 'Ratna Gems', contact_number: '9800000002', city: 'Mumbai', state: 'Maharashtra',
        labour_rate: 450, labour_rate_basis: 'Per Gram', gold_tunch_pct: 75, quality_id: quality, certificate_required: 0,
        payment_terms_days: 45, payment_style: 'Invoice-wise', sales_person_id: me, is_active: 1 });
      const v = {};
      for (const [k, name, type, days] of [['cad', 'CAD Studio', 'CAD', 5], ['dia', 'Diamond Supplier', 'Diamond Supplier', 3],
        ['fg', 'Karigar Workshop', 'Manufacturing (FG)', 15], ['hm', 'Hallmark Centre', 'Hallmarking', 2]]) {
        v[k] = (await call('POST', '/api/o2d/vendors', { vendor_name: PREFIX + name, vendor_type: type, contact_number: '9800000100', city: 'Mumbai',
          default_lead_time_days: days, is_active: 1 })).id;
      }

      // ── Orders ──
      const newOrder = async (o) => {
        const r = await call('POST', '/api/o2d/orders', {
          sales_person_id: me, owner_id: me, order_type: 'Customer Order', quality_id: quality, lead_time_days: 20, delivery_date: plus(20),
          diamond_lines: [{ shape: 'Round', sieve_size: '+2-4', pcs: 120, carat: 1.8 }], ...o });
        if (o.development_type === 'New Development') await call('POST', `/api/o2d/files?order_id=${r.id}&file_type=design_photo&name=design.png`, null, PNG);
        await call('POST', `/api/o2d/orders/${r.id}/submit`);
        made.push(r.order_no);
        return r.id;
      };
      const toProduction = async (id) => {
        await call('PUT', `/api/o2d/orders/${id}/quotation-posted`, { quotation_amount: 95000 });
        await call('PUT', `/api/o2d/orders/${id}/confirmation`, { decision: 'Confirmed', reason: 'Demo — client confirmed on call' });
        await call('POST', `/api/o2d/orders/${id}/handover`, { handed_over_to: me });
        const d = await call('GET', `/api/o2d/orders/${id}`);
        await call('PUT', `/api/o2d/bagging/${d.bagging.id}/verify`, { ok: true });
        return d.bagging.id;
      };

      // 1) New design — CAD requested from vendor (CAD board → Requested)
      const o1 = await newOrder({ client_id: shree.id, style_no: 'DM-RING-101', development_type: 'New Development', qty_pcs: 12, diamond_carat_weight: 2.4,
        lab_id: igi, certificate_required: 1, remark: 'Demo: 18kt rose gold ladies ring' });
      await call('POST', `/api/o2d/orders/${o1}/cad`, { cad_vendor_id: v.cad, brief: 'Same as design photo, band 2mm' });
      const fu1 = await call('GET', `/api/o2d/followups?tab=all&mine=0&order_id=${o1}`);
      if (fu1[0]) await call('POST', `/api/o2d/followups/${fu1[0].id}/log`, { mode: 'Call', outcome: 'Delay - New Date Given', next_followup_date: plus(2), remark: 'Demo: vendor said 2 more days' });

      // 2) New design — CAD received, sent to client for approval
      const o2 = await newOrder({ client_id: shree.id, style_no: 'DM-PEND-202', development_type: 'New Development', qty_pcs: 8, diamond_carat_weight: 1.6,
        lab_id: igi, certificate_required: 1, delivery_date: plus(25), lead_time_days: 25, remark: 'Demo: pendant with pear centre' });
      const cad2 = await call('POST', `/api/o2d/orders/${o2}/cad`, { cad_vendor_id: v.cad });
      await call('PUT', `/api/o2d/cad/${cad2.id}/receive`, {});
      await call('PUT', `/api/o2d/cad/${cad2.id}/send-approval`, { channel: 'WhatsApp' });

      // 3) Existing design — quotation posted, waiting for client confirmation
      const o3 = await newOrder({ client_id: ratna.id, style_no: 'DM-EAR-303', development_type: 'From Existing Stock', qty_pcs: 20, diamond_carat_weight: 3.2,
        certificate_required: 0, remark: 'Demo: stud earrings pair' });
      await call('PUT', `/api/o2d/orders/${o3}/quotation-posted`, { quotation_amount: 120000, quotation_remark: 'Demo quotation on WhatsApp group' });

      // 4) Bagging in progress — 6 of 10 bagged, 1 rejected
      const o4 = await newOrder({ client_id: ratna.id, style_no: 'DM-BANG-404', development_type: 'From Existing Stock', qty_pcs: 10, diamond_carat_weight: 4.5,
        certificate_required: 0, delivery_date: plus(15), lead_time_days: 15, remark: 'Demo: bangle pair' });
      const bag4 = await toProduction(o4);
      await call('POST', `/api/o2d/bagging/${bag4}/entries`, { bagged_pcs: 6, rejected_pcs: 1, rejection_reason: 'Chipped stone', bagged_carat: 2.7 });

      // 5) Issued to manufacturing vendor (Karigar)
      const o5 = await newOrder({ client_id: shree.id, style_no: 'DM-CHAIN-505', development_type: 'From Existing Stock', qty_pcs: 6, diamond_carat_weight: 1.2,
        lab_id: igi, certificate_required: 1, remark: 'Demo: diamond chain' });
      const bag5 = await toProduction(o5);
      await call('POST', `/api/o2d/bagging/${bag5}/entries`, { bagged_pcs: 6 });
      await call('POST', '/api/o2d/issues', { customer_id: shree.id, vendor_id: v.fg, issue_date: today, issue_invoice_no: 'DEMO-IV-1',
        expected_return_date: plus(12), lines: [{ order_id: o5, issued_pcs: 6, issued_weight_gm: 42.5, issued_carat: 1.2 }] });

      // 6) Made, dispatched with invoice, part payment received
      const o6 = await newOrder({ client_id: ratna.id, style_no: 'DM-NECK-606', development_type: 'From Existing Stock', qty_pcs: 4, diamond_carat_weight: 2.0,
        certificate_required: 0, delivery_date: plus(5), lead_time_days: 5, remark: 'Demo: necklace set' });
      const bag6 = await toProduction(o6);
      await call('POST', `/api/o2d/bagging/${bag6}/entries`, { bagged_pcs: 4 });
      await call('POST', '/api/o2d/issues', { customer_id: ratna.id, vendor_id: v.fg, issue_date: today, issue_invoice_no: 'DEMO-IV-2',
        lines: [{ order_id: o6, issued_pcs: 4, issued_weight_gm: 60 }] });
      const pl = await call('GET', `/api/o2d/receipts/pending-lines?vendorId=${v.fg}`);
      const line6 = pl.find(l => l.order_id === o6);
      await call('POST', '/api/o2d/receipts', { vendor_id: v.fg, receipt_date: today, vendor_invoice_no: 'DEMO-VB-1', vendor_invoice_date: today,
        lines: [{ issue_line_id: line6.id, received_pcs: 4, received_weight_gm: 58.8, wastage_weight_gm: 1.2, hallmark_done: 1 }] });
      const dsp = await call('POST', '/api/o2d/dispatch', { customer_id: ratna.id, invoice_no: 'DEMO-INV-1', invoice_date: today, invoice_amount: 185000,
        gold_amount: 110000, diamond_amount: 60000, labour_amount: 15000, dispatch_date: today, courier: 'Demo Courier', awb_no: 'DEMO123',
        lines: [{ order_id: o6, pcs: 4, weight_gm: 58.8, line_amount: 185000 }] });
      await call('POST', `/api/o2d/files?order_id=${o6}&file_type=invoice&ref_table=fms_dispatch&ref_id=${dsp.id}&name=demo-invoice.png`, null, PNG);
      await call('POST', '/api/o2d/payments', { customer_id: ratna.id, receipt_date: today, amount_received: 75000, payment_mode: 'NEFT', reference_no: 'DEMO-UTR-1',
        receipt_mode: 'Invoice-wise', allocations: [{ dispatch_id: dsp.id, amount: 75000 }], remark: 'Demo part payment' });
    } catch (e) {
      // Aadha bana demo na rahe — jo bana wo hata do
      await c.close();
      try { await removeDemo(); } catch (e2) { console.error('O2D demo cleanup failed', e2); }
      throw e;
    }
    await c.close();
    res.json({ success: true, orders: made });
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
        // Receipts (paisa) aur khaali headers bhi — ye demo customers ke hi hain
        const [rs] = await q.query(`SELECT id FROM fms_payment_receipt WHERE customer_id IN (${marks})`, cids);
        const rids = rs.map(r => r.id);
        if (rids.length) {
          const rm = rids.map(() => '?').join(',');
          await q.query(`DELETE FROM fms_payment_allocation WHERE receipt_id IN (${rm})`, rids);
          await q.query(`DELETE FROM fms_payment_category_allocation WHERE receipt_id IN (${rm})`, rids);
          await q.query(`DELETE FROM fms_payment_receipt WHERE id IN (${rm})`, rids);
        }
        await q.query(`DELETE FROM fms_followup_task WHERE party_type='Customer' AND party_id IN (${marks})`, cids);
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
