// ══════════════════════════════════════════════════════
// O2D FMS — Dispatch & Invoice (Stage 13) + Payment follow-up & receipt (14)
// Receipt do tarah: Invoice-wise (invoice chun kar) aur Category-wise
// (Gold/Diamond/Labour/Other — FIFO, sabse purana invoice pehle).
// ══════════════════════════════════════════════════════
module.exports = function registerO2DSales(app, ctx) {
  const { db, requireAuth, lib, wrap } = ctx;
  const {
    S, todayIST, nowIST, addDays, diffDays, isDate, num, int, str, dateOrNull, fail,
    withTx, setStatus, openTask, closeTasks, getOrder,
  } = lib;

  const CATEGORIES = ['Gold', 'Diamond', 'Labour', 'Other'];
  const CAT_COL = { Gold: 'gold_amount', Diamond: 'diamond_amount', Labour: 'labour_amount', Other: 'other_amount' };
  const PAYMENT_MODES = ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash', 'Gold (metal)', 'Other'];
  const round2 = (n) => Math.round(n * 100) / 100;

  // ── Dispatch ───────────────────────────────────────
  app.get('/api/o2d/dispatch/ready', requireAuth, wrap(async (req, res) => {
    const cid = int(req.query.customerId);
    const [rows] = await db.query(
      `SELECT o.id, o.order_no, o.unique_id, o.style_no, o.client_id, o.qty_pcs, o.additional_reduction_pcs, o.delivery_date,
              o.order_type, o.stage_entered_at, c.client_name,
              (SELECT COALESCE(SUM(received_pcs),0) FROM fms_vendor_receipt_line r WHERE r.order_id=o.id AND r.is_deleted=0) AS received_pcs,
              (SELECT COALESCE(SUM(received_weight_gm),0) FROM fms_vendor_receipt_line r WHERE r.order_id=o.id AND r.is_deleted=0) AS received_weight
       FROM fms_orders o LEFT JOIN fms_customers c ON c.id=o.client_id
       WHERE o.is_deleted=0 AND o.order_status=? ${cid ? 'AND o.client_id=?' : ''} ORDER BY c.client_name, o.delivery_date`,
      cid ? [S.READY, cid] : [S.READY]);
    res.json(rows);
  }));

  app.post('/api/o2d/dispatch', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const out = await withTx(db, async (q) => {
      const cid = int(b.customer_id);
      const [c] = await q.query('SELECT * FROM fms_customers WHERE id=? AND is_deleted=0', [cid]);
      if (!c[0]) fail('Select a customer');
      const cust = c[0];
      const invNo = str(b.invoice_no, 60);
      if (!invNo) fail('Invoice no is required');
      const [dup] = await q.query('SELECT id FROM fms_dispatch WHERE customer_id=? AND LOWER(invoice_no)=LOWER(?) AND is_deleted=0', [cid, invNo]);
      if (dup[0]) fail(`Invoice ${invNo} is already recorded for this customer`);
      if (!isDate(b.invoice_date)) fail('Invoice date is required');
      if (!isDate(b.dispatch_date)) fail('Dispatch date is required');
      const amount = round2(num(b.invoice_amount));
      if (!(amount > 0)) fail('Invoice amount is required');
      const cats = {};
      CATEGORIES.forEach(k => { cats[k] = round2(num(b[CAT_COL[k]])); if (cats[k] < 0) fail(`${k} amount cannot be negative`); });
      const catSum = round2(Object.values(cats).reduce((s, v) => s + v, 0));
      if (cust.payment_style === 'Category-wise' && !catSum) fail('This customer pays category-wise — enter the Gold / Diamond / Labour / Other break-up');
      if (catSum && Math.abs(catSum - amount) > 1) fail(`Category break-up (₹${catSum}) must add up to the invoice amount (₹${amount})`);
      const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => int(l.order_id));
      if (!lines.length) fail('Select at least one order');
      const seen = new Set();
      for (const l of lines) {
        const o = await getOrder(q, int(l.order_id));
        if (seen.has(o.id)) fail('Each order can appear only once');
        seen.add(o.id);
        if (o.client_id !== cid) fail(`Order ${o.order_no} belongs to another customer`);
        if (o.order_status !== S.READY) fail(`Order ${o.order_no} is not Ready for Dispatch`);
        if (int(l.pcs) <= 0) fail(`${o.order_no}: pcs are required`);
        l._order = o;
      }
      const lineSum = round2(lines.reduce((s, l) => s + num(l.line_amount), 0));
      if (lineSum && lineSum - amount > 1) fail('Order-wise amounts cannot be more than the invoice amount');
      const due = dateOrNull(b.payment_due_date) || addDays(b.invoice_date, int(cust.payment_terms_days) || 30);
      const no = await lib.nextNo(q, 'DSP');
      const [h] = await q.query(
        `INSERT INTO fms_dispatch (dispatch_no, customer_id, invoice_no, invoice_date, invoice_amount, gold_amount, diamond_amount, labour_amount, other_amount,
           dispatch_date, courier, awb_no, dispatched_via, payment_due_date, received_amount, balance, payment_status, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'Pending',?,?,?,0)`,
        [no, cid, invNo, b.invoice_date, amount, cats.Gold, cats.Diamond, cats.Labour, cats.Other, b.dispatch_date,
          str(b.courier, 100), str(b.awb_no, 100), str(b.dispatched_via, 100), due, amount, str(b.remark, 1000), nowIST(), uid]);
      for (const l of lines) {
        await q.query(
          `INSERT INTO fms_dispatch_line (dispatch_id, order_id, pcs, weight_gm, line_amount, created_at, created_by, is_deleted) VALUES (?,?,?,?,?,?,?,0)`,
          [h.insertId, l._order.id, int(l.pcs), l.weight_gm === '' || l.weight_gm == null ? null : num(l.weight_gm),
            l.line_amount === '' || l.line_amount == null ? null : round2(num(l.line_amount)), nowIST(), uid]);
        await setStatus(q, l._order.id, S.DISPATCHED, { userId: uid, remark: `${no}: invoice ${invNo} dispatched on ${b.dispatch_date}` });
        await setStatus(q, l._order.id, S.PAYMENT_PENDING, { userId: uid, stage: 'PAYMENT', remark: `Payment due ${due}` });
      }
      let next = addDays(due, -3);
      if (next < todayIST()) next = todayIST();
      await openTask(q, { task_type: 'PAYMENT', order_id: lines[0]._order.id, ref_table: 'fms_dispatch', ref_id: h.insertId,
        party_type: 'Customer', party_id: cid, next_followup_date: next, title: `Payment — invoice ${invNo} — ${cust.client_name}` }, uid);
      return { id: h.insertId, dispatch_no: no, order_id: lines[0]._order.id };
    });
    res.json({ success: true, ...out });
  }));

  app.get('/api/o2d/dispatch', requireAuth, wrap(async (req, res) => {
    const where = ['d.is_deleted=0'];
    const params = [];
    if (int(req.query.customerId)) { where.push('d.customer_id=?'); params.push(int(req.query.customerId)); }
    if (isDate(req.query.from)) { where.push('d.invoice_date>=?'); params.push(req.query.from); }
    if (isDate(req.query.to)) { where.push('d.invoice_date<=?'); params.push(req.query.to); }
    const [rows] = await db.query(
      `SELECT d.*, c.client_name FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id
       WHERE ${where.join(' AND ')} ORDER BY d.invoice_date DESC, d.id DESC LIMIT 1000`, params);
    const ids = rows.map(r => r.id);
    const lines = {};
    if (ids.length) {
      const [ls] = await db.query(`SELECT l.dispatch_id, l.order_id, l.pcs, o.order_no FROM fms_dispatch_line l JOIN fms_orders o ON o.id=l.order_id
                                   WHERE l.is_deleted=0 AND l.dispatch_id IN (${ids.map(() => '?').join(',')})`, ids);
      ls.forEach(l => { (lines[l.dispatch_id] = lines[l.dispatch_id] || []).push(l); });
    }
    const today = todayIST();
    res.json(rows.map(r => ({ ...r, lines: lines[r.id] || [],
      days_overdue: num(r.balance) > 0 && r.payment_due_date && r.payment_due_date < today ? diffDays(r.payment_due_date, today) : 0 })));
  }));

  // ── Payment recalculation ──────────────────────────
  async function recalcDispatch(q, dispatchId, uid) {
    const [dr] = await q.query('SELECT * FROM fms_dispatch WHERE id=? AND is_deleted=0', [dispatchId]);
    if (!dr[0]) fail('Invoice not found', 404);
    const d = dr[0];
    const [a] = await q.query('SELECT COALESCE(SUM(allocated_amount),0) AS s FROM fms_payment_allocation WHERE dispatch_id=? AND is_deleted=0', [dispatchId]);
    const [c] = await q.query('SELECT COALESCE(SUM(allocated_amount),0) AS s FROM fms_payment_category_allocation WHERE dispatch_id=? AND is_deleted=0', [dispatchId]);
    const received = round2(num(a[0].s) + num(c[0].s));
    const balance = round2(num(d.invoice_amount) - received);
    const status = balance <= 0.5 ? 'Paid' : (received > 0 ? 'Partially Paid' : 'Pending');
    await q.query('UPDATE fms_dispatch SET received_amount=?, balance=?, payment_status=?, updated_at=?, updated_by=? WHERE id=?',
      [received, Math.max(0, balance), status, nowIST(), uid || null, dispatchId]);
    if (status === 'Paid') await closeTasks(q, { task_type: 'PAYMENT', ref_table: 'fms_dispatch', ref_id: dispatchId }, 'Balance 0', uid);
    const [ls] = await q.query('SELECT DISTINCT order_id FROM fms_dispatch_line WHERE dispatch_id=? AND is_deleted=0', [dispatchId]);
    for (const l of ls) await recalcOrderPayment(q, l.order_id, uid);
  }
  async function recalcOrderPayment(q, orderId, uid) {
    const o = await getOrder(q, orderId);
    if ([S.CLOSED, S.CANCELLED].includes(o.order_status)) return;
    const [ds] = await q.query(
      `SELECT DISTINCT d.id, d.payment_status, d.received_amount FROM fms_dispatch d JOIN fms_dispatch_line l ON l.dispatch_id=d.id
       WHERE l.order_id=? AND l.is_deleted=0 AND d.is_deleted=0`, [orderId]);
    if (!ds.length) return;
    const allPaid = ds.every(d => d.payment_status === 'Paid');
    const anyPaid = ds.some(d => num(d.received_amount) > 0);
    if (allPaid) {
      await setStatus(q, orderId, S.PAID, { userId: uid, stage: 'PAYMENT', remark: 'All invoices paid' });
      await setStatus(q, orderId, S.CLOSED, { userId: uid, stage: null, remark: 'Fully paid — order closed' });
      await closeTasks(q, { order_id: orderId, task_type: 'PAYMENT' }, 'Order closed', uid);
    } else if (anyPaid && o.order_status !== S.PART_PAID) {
      await setStatus(q, orderId, S.PART_PAID, { userId: uid, stage: 'PAYMENT', remark: 'Part payment received' });
    }
  }
  async function categoryBalances(q, dispatchIds) {
    const out = {};
    if (!dispatchIds.length) return out;
    const [rows] = await q.query(
      `SELECT dispatch_id, category, COALESCE(SUM(allocated_amount),0) AS s FROM fms_payment_category_allocation
       WHERE is_deleted=0 AND dispatch_id IN (${dispatchIds.map(() => '?').join(',')}) GROUP BY dispatch_id, category`, dispatchIds);
    rows.forEach(r => { (out[r.dispatch_id] = out[r.dispatch_id] || {})[r.category] = num(r.s); });
    return out;
  }

  app.get('/api/o2d/payments/open-invoices', requireAuth, wrap(async (req, res) => {
    const cid = int(req.query.customerId);
    if (!cid) fail('Select a customer');
    const [rows] = await db.query(
      `SELECT d.*, c.client_name FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id
       WHERE d.customer_id=? AND d.is_deleted=0 AND d.balance>0 ORDER BY d.invoice_date, d.id`, [cid]);
    const cb = await categoryBalances(db, rows.map(r => r.id));
    const today = todayIST();
    res.json(rows.map(r => {
      const catBal = {};
      CATEGORIES.forEach(k => { catBal[k] = round2(num(r[CAT_COL[k]]) - num((cb[r.id] || {})[k])); });
      return { ...r, category_balance: catBal,
        days_overdue: r.payment_due_date && r.payment_due_date < today ? diffDays(r.payment_due_date, today) : 0 };
    }));
  }));

  app.post('/api/o2d/payments', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const out = await withTx(db, async (q) => {
      const cid = int(b.customer_id);
      const [c] = await q.query('SELECT id FROM fms_customers WHERE id=? AND is_deleted=0', [cid]);
      if (!c[0]) fail('Select a customer');
      if (!isDate(b.receipt_date)) fail('Receipt date is required');
      const amount = round2(num(b.amount_received));
      if (!(amount > 0)) fail('Amount received is required');
      if (!PAYMENT_MODES.includes(b.payment_mode)) fail('Select a payment mode');
      const mode = b.receipt_mode === 'Category-wise' ? 'Category-wise' : 'Invoice-wise';
      const [open] = await q.query('SELECT * FROM fms_dispatch WHERE customer_id=? AND is_deleted=0 AND balance>0 ORDER BY invoice_date, id', [cid]);
      const byId = {};
      open.forEach(d => { byId[d.id] = { ...d, balance: num(d.balance) }; });
      const invAllocs = [];
      const catAllocs = [];
      if (mode === 'Invoice-wise') {
        for (const a of (Array.isArray(b.allocations) ? b.allocations : [])) {
          const amt = round2(num(a.amount));
          if (amt <= 0) continue;
          const d = byId[int(a.dispatch_id)];
          if (!d) fail('An allocated invoice is not open for this customer');
          if (amt - d.balance > 0.5) fail(`Invoice ${d.invoice_no}: allocation ₹${amt} is more than its balance ₹${d.balance}`);
          d.balance = round2(d.balance - amt);
          invAllocs.push({ dispatch_id: d.id, amount: amt });
        }
        if (!invAllocs.length) fail('Tick at least one invoice and enter an amount');
      } else {
        const rows = (Array.isArray(b.categories) ? b.categories : []).filter(r => CATEGORIES.includes(r.category) && num(r.amount) > 0);
        if (!rows.length) fail('Enter an amount for at least one category');
        const cb = await categoryBalances(q, open.map(d => d.id));
        const catBal = {};
        open.forEach(d => { catBal[d.id] = {}; CATEGORIES.forEach(k => { catBal[d.id][k] = round2(num(d[CAT_COL[k]]) - num((cb[d.id] || {})[k])); }); });
        const manual = Array.isArray(b.manual_allocations) ? b.manual_allocations.filter(m => num(m.amount) > 0) : [];
        for (const r of rows) {
          let remaining = round2(num(r.amount));
          const picks = manual.filter(m => m.category === r.category);
          const targets = picks.length ? picks.map(m => ({ d: byId[int(m.dispatch_id)], cap: round2(num(m.amount)) })) : open.map(d => ({ d: byId[d.id], cap: Infinity }));
          for (const t of targets) {
            if (!t.d) fail('A picked invoice is not open for this customer');
            if (remaining <= 0) break;
            const room = Math.min(catBal[t.d.id][r.category], t.d.balance, t.cap);
            if (picks.length && t.cap - room > 0.5) fail(`Invoice ${t.d.invoice_no}: only ₹${Math.max(0, room)} ${r.category} is pending`);
            const amt = round2(Math.min(remaining, room));
            if (amt <= 0) continue;
            catAllocs.push({ dispatch_id: t.d.id, category: r.category, amount: amt });
            catBal[t.d.id][r.category] = round2(catBal[t.d.id][r.category] - amt);
            t.d.balance = round2(t.d.balance - amt);
            remaining = round2(remaining - amt);
          }
        }
        if (!catAllocs.length) fail('No open invoice has a pending balance in the selected categories');
      }
      const allocated = round2([...invAllocs, ...catAllocs].reduce((s, a) => s + a.amount, 0));
      if (allocated - amount > 0.5) fail(`Allocations (₹${allocated}) are more than the amount received (₹${amount})`);
      const no = await lib.nextNo(q, 'PAY');
      const [h] = await q.query(
        `INSERT INTO fms_payment_receipt (receipt_no, customer_id, receipt_date, amount_received, payment_mode, reference_no, receipt_mode, on_account_amount, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [no, cid, b.receipt_date, amount, b.payment_mode, str(b.reference_no, 100), mode, round2(amount - allocated), str(b.remark, 1000), nowIST(), uid]);
      for (const a of invAllocs) {
        await q.query('INSERT INTO fms_payment_allocation (receipt_id, dispatch_id, allocated_amount, created_at, created_by, is_deleted) VALUES (?,?,?,?,?,0)',
          [h.insertId, a.dispatch_id, a.amount, nowIST(), uid]);
      }
      for (const a of catAllocs) {
        await q.query('INSERT INTO fms_payment_category_allocation (receipt_id, dispatch_id, category, allocated_amount, created_at, created_by, is_deleted) VALUES (?,?,?,?,?,?,0)',
          [h.insertId, a.dispatch_id, a.category, a.amount, nowIST(), uid]);
      }
      const touched = [...new Set([...invAllocs, ...catAllocs].map(a => a.dispatch_id))];
      for (const id of touched) await recalcDispatch(q, id, uid);
      return { id: h.insertId, receipt_no: no, allocated, on_account: round2(amount - allocated), allocations: [...invAllocs, ...catAllocs] };
    });
    res.json({ success: true, ...out });
  }));

  app.get('/api/o2d/payments', requireAuth, wrap(async (req, res) => {
    const where = ['r.is_deleted=0'];
    const params = [];
    if (int(req.query.customerId)) { where.push('r.customer_id=?'); params.push(int(req.query.customerId)); }
    if (isDate(req.query.from)) { where.push('r.receipt_date>=?'); params.push(req.query.from); }
    if (isDate(req.query.to)) { where.push('r.receipt_date<=?'); params.push(req.query.to); }
    const [rows] = await db.query(
      `SELECT r.*, c.client_name FROM fms_payment_receipt r LEFT JOIN fms_customers c ON c.id=r.customer_id
       WHERE ${where.join(' AND ')} ORDER BY r.receipt_date DESC, r.id DESC LIMIT 1000`, params);
    res.json(rows);
  }));

  // Har khula invoice — payment follow-up screen (spec 10.1)
  app.get('/api/o2d/payments/followup', requireAuth, wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT d.*, c.client_name, t.id AS task_id, t.next_followup_date, t.last_followup_on, t.assigned_to, u.name AS assigned_to_name
       FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id
       LEFT JOIN fms_followup_task t ON t.task_type='PAYMENT' AND t.ref_table='fms_dispatch' AND t.ref_id=d.id AND t.status='Open' AND t.is_deleted=0
       LEFT JOIN users u ON u.id=t.assigned_to
       WHERE d.is_deleted=0 AND d.balance>0 ORDER BY d.payment_due_date, d.id`);
    const today = todayIST();
    res.json(rows.map(r => ({ ...r,
      days_overdue: r.payment_due_date && r.payment_due_date < today ? diffDays(r.payment_due_date, today) : 0,
      age_days: diffDays(r.invoice_date, today) })));
  }));

  // Receivables ageing (invoice ki umar se) + Gold/Diamond/Labour split
  app.get('/api/o2d/receivables/ageing', requireAuth, wrap(async (req, res) => {
    res.json(await ctx.o2dAgeing(db, { customerId: int(req.query.customerId) }));
  }));
  ctx.o2dAgeing = async (q, f = {}) => {
    const params = [];
    let extra = '';
    if (f.customerId) { extra = 'AND d.customer_id=?'; params.push(f.customerId); }
    const [rows] = await q.query(
      `SELECT d.*, c.client_name FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id
       WHERE d.is_deleted=0 AND d.balance>0 ${extra}`, params);
    const cb = await categoryBalances(q, rows.map(r => r.id));
    const today = todayIST();
    const byClient = {};
    const total = { b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, balance: 0, overdue: 0, Gold: 0, Diamond: 0, Labour: 0, Other: 0, Unsplit: 0 };
    rows.forEach(r => {
      const age = diffDays(r.invoice_date, today);
      const bal = num(r.balance);
      const key = age <= 30 ? 'b0_30' : age <= 60 ? 'b31_60' : age <= 90 ? 'b61_90' : 'b90';
      const c = byClient[r.customer_id] = byClient[r.customer_id] || { customer_id: r.customer_id, client_name: r.client_name,
        b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, balance: 0, overdue: 0, invoices: 0, Gold: 0, Diamond: 0, Labour: 0, Other: 0, Unsplit: 0 };
      c[key] += bal; c.balance += bal; c.invoices += 1; total[key] += bal; total.balance += bal;
      if (r.payment_due_date && r.payment_due_date < today) { c.overdue += bal; total.overdue += bal; }
      // Category balance — invoice-wise receipts category me nahi bante, isliye
      // wo hissa 'Unsplit' me (split sirf category balances jitna dikhta hai).
      let catSum = 0;
      CATEGORIES.forEach(k => {
        const v = Math.max(0, num(r[CAT_COL[k]]) - num((cb[r.id] || {})[k]));
        catSum += v;
      });
      const scale = catSum > bal && catSum > 0 ? bal / catSum : 1;
      let split = 0;
      CATEGORIES.forEach(k => {
        const v = Math.max(0, num(r[CAT_COL[k]]) - num((cb[r.id] || {})[k])) * scale;
        c[k] += v; total[k] += v; split += v;
      });
      c.Unsplit += Math.max(0, bal - split); total.Unsplit += Math.max(0, bal - split);
    });
    const clients = Object.values(byClient).map(c => {
      const o = { ...c };
      ['b0_30', 'b31_60', 'b61_90', 'b90', 'balance', 'overdue', ...CATEGORIES, 'Unsplit'].forEach(k => { o[k] = round2(o[k]); });
      return o;
    }).sort((a, b) => b.balance - a.balance);
    Object.keys(total).forEach(k => { total[k] = round2(total[k]); });
    return { clients, total };
  };
};
