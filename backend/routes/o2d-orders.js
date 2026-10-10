// ══════════════════════════════════════════════════════
// O2D FMS — Orders (Stage 1–2), CAD (3–4), Confirmation (5), Order Sheet &
// Handover (6), aur common Follow-up engine (sec 11).
// ══════════════════════════════════════════════════════
const express = require('express');

module.exports = function registerO2DOrders(app, ctx) {
  const { db, requireAuth, requireAdmin, lib, wrap, isAdmin } = ctx;
  const {
    S, TERMINAL, todayIST, nowIST, addDays, isDate, num, int, str, dateOrNull, fail,
    withTx, setStatus, logChange, openTask, closeTasks, getOrder, cancelOrder, effectiveQty,
  } = lib;

  const ORDER_TYPES = ['Customer Order', 'Stock Order'];
  const DEV_TYPES = ['New Development', 'From Existing Stock'];
  const PRE_PRODUCTION_STAGES = ['ORDER', 'CAD', 'APPROVAL', 'CONFIRMATION', 'ORDER_SHEET'];

  // ── Order payload ──────────────────────────────────
  function orderPayload(b) {
    return {
      order_no: str(b.order_no, 50),
      client_id: int(b.client_id) || null,
      sales_person_id: int(b.sales_person_id) || null,
      owner_id: int(b.owner_id) || null,
      order_type: ORDER_TYPES.includes(b.order_type) ? b.order_type : null,
      style_no: str(b.style_no, 100),
      development_type: DEV_TYPES.includes(b.development_type) ? b.development_type : null,
      qty_pcs: int(b.qty_pcs),
      additional_reduction_pcs: int(b.additional_reduction_pcs),
      diamond_carat_weight: b.diamond_carat_weight === '' || b.diamond_carat_weight == null ? null : num(b.diamond_carat_weight),
      quality_id: int(b.quality_id) || null,
      lab_id: int(b.lab_id) || null,
      certificate_required: b.certificate_required ? 1 : 0,
      lead_time_days: int(b.lead_time_days),
      delivery_date: dateOrNull(b.delivery_date),
      remark: str(b.remark, 4000),
    };
  }
  // Submit ke waqt poori validation (spec 4.1 + 4.2). Draft me sirf client chahiye.
  async function validateFull(q, o) {
    if (!o.client_id) fail('Client is required');
    const [c] = await q.query('SELECT id FROM fms_customers WHERE id=? AND is_deleted=0', [o.client_id]);
    if (!c[0]) fail('Selected client not found');
    if (!o.sales_person_id) fail('Sales person is required');
    if (!o.owner_id) fail('Owner is required');
    if (!o.order_type) fail('Order type is required');
    if (o.order_type === 'Customer Order' && !o.style_no) fail('Style No is required for a Customer Order');
    if (!o.development_type) fail('Development type is required');
    if (!(int(o.qty_pcs) > 0)) fail('Qty (pcs) must be more than 0');
    if (effectiveQty(o) <= 0) fail('Effective qty (Qty + Additional/Reduction) must be more than 0');
    if (o.diamond_carat_weight == null || num(o.diamond_carat_weight) < 0) fail('Diamond carat weight is required');
    if (!o.quality_id) fail('Quality is required');
    if (int(o.certificate_required) === 1 && !o.lab_id) fail('Lab is required when certificate is required');
    if (int(o.lead_time_days) < 0) fail('Lead time cannot be negative');
    if (!o.delivery_date) fail('Delivery date is required');
    if (o.id && o.development_type === 'New Development') {
      const [f] = await q.query("SELECT id FROM fms_order_files WHERE order_id=? AND file_type='design_photo' AND is_deleted=0 LIMIT 1", [o.id]);
      if (!f[0]) fail('Upload at least one design photo for a New Development order');
    }
  }
  async function saveDiamondLines(q, orderId, lines, userId) {
    if (!Array.isArray(lines)) return;
    await q.query('UPDATE fms_order_diamond_lines SET is_deleted=1 WHERE order_id=?', [orderId]);
    for (const l of lines.slice(0, 100)) {
      if (!l || (!str(l.shape) && !str(l.sieve_size) && !int(l.pcs) && !num(l.carat))) continue;
      await q.query(
        `INSERT INTO fms_order_diamond_lines (order_id, shape, sieve_size, pcs, carat, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,0)`,
        [orderId, str(l.shape, 50), str(l.sieve_size, 50), int(l.pcs), num(l.carat), nowIST(), userId]);
    }
  }

  // ── List ───────────────────────────────────────────
  const ORDER_SELECT = `
    SELECT o.*, c.client_name, c.city AS client_city, sp.name AS sales_person_name, ow.name AS owner_name,
           qm.name AS quality_name, lm.name AS lab_name
    FROM fms_orders o
    LEFT JOIN fms_customers c ON c.id=o.client_id
    LEFT JOIN users sp ON sp.id=o.sales_person_id
    LEFT JOIN users ow ON ow.id=o.owner_id
    LEFT JOIN fms_quality_master qm ON qm.id=o.quality_id
    LEFT JOIN fms_lab_master lm ON lm.id=o.lab_id`;

  app.get('/api/o2d/orders', requireAuth, wrap(async (req, res) => {
    const f = req.query;
    const where = ['o.is_deleted=0'];
    const params = [];
    const eq = (col, v) => { if (v) { where.push(`${col}=?`); params.push(v); } };
    eq('o.order_status', f.status);
    eq('o.current_stage', f.stage);
    eq('o.client_id', int(f.client_id) || null);
    eq('o.sales_person_id', int(f.sales_person_id) || null);
    eq('o.owner_id', int(f.owner_id) || null);
    eq('o.order_type', f.order_type);
    eq('o.development_type', f.development_type);
    if (isDate(f.from)) { where.push('o.created_at>=?'); params.push(f.from + ' 00:00:00'); }
    if (isDate(f.to)) { where.push('o.created_at<=?'); params.push(f.to + ' 23:59:59'); }
    if (f.open === '1') { where.push("o.order_status NOT IN ('Cancelled','Closed','Draft')"); }
    if (f.q) {
      const like = '%' + String(f.q).toLowerCase().slice(0, 60) + '%';
      where.push('(LOWER(o.order_no) LIKE ? OR LOWER(o.unique_id) LIKE ? OR LOWER(o.style_no) LIKE ? OR LOWER(c.client_name) LIKE ?)');
      params.push(like, like, like, like);
    }
    const [rows] = await db.query(`${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.id DESC`, params);
    const cfg = await lib.stageConfig(db);
    const today = todayIST();
    let out = rows.map(o => ({ ...o, ...lib.orderMetrics(o, cfg.map, today) }));
    if (f.delayed === '1') out = out.filter(o => o.delayed_at_stage || o.overdue_delivery);
    if (f.at_risk === '1') out = out.filter(o => o.at_risk);
    const total = out.length;
    const limit = Math.min(500, int(f.limit) || 50);
    const page = Math.max(1, int(f.page) || 1);
    res.json({ total, page, limit, rows: out.slice((page - 1) * limit, page * limit) });
  }));

  // ── 360° detail ────────────────────────────────────
  app.get('/api/o2d/orders/:id', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const [orows] = await db.query(`${ORDER_SELECT} WHERE o.id=? AND o.is_deleted=0`, [id]);
    if (!orows[0]) fail('Order not found', 404);
    const cfg = await lib.stageConfig(db);
    const order = { ...orows[0], ...lib.orderMetrics(orows[0], cfg.map, todayIST()), path: lib.orderPath(orows[0]) };
    const q = (sql, p = [id]) => db.query(sql, p).then(r => r[0]);

    const [customer] = await q('SELECT * FROM fms_customers WHERE id=?', [order.client_id || 0]);
    const diamondLines = await q('SELECT * FROM fms_order_diamond_lines WHERE order_id=? AND is_deleted=0 ORDER BY id');
    const files = await q(`SELECT f.id, f.file_type, f.ref_table, f.ref_id, f.file_name, f.mime, f.size_bytes, f.created_at, u.name AS uploaded_by
                           FROM fms_order_files f LEFT JOIN users u ON u.id=f.created_by
                           WHERE f.is_deleted=0 AND (f.order_id=? OR (f.ref_table='fms_dispatch' AND f.ref_id IN
                             (SELECT dispatch_id FROM fms_dispatch_line WHERE order_id=? AND is_deleted=0)))
                           ORDER BY f.id`, [id, id]);
    const statusLog = await q(`SELECT l.*, u.name AS changed_by_name FROM fms_order_status_log l LEFT JOIN users u ON u.id=l.changed_by
                               WHERE l.order_id=? ORDER BY l.id`);
    const changeLog = await q(`SELECT l.*, u.name AS changed_by_name FROM fms_order_change_log l LEFT JOIN users u ON u.id=l.changed_by
                               WHERE l.order_id=? ORDER BY l.id`);
    const cad = await q(`SELECT c.*, v.vendor_name FROM fms_cad c LEFT JOIN fms_vendors v ON v.id=c.cad_vendor_id
                         WHERE c.order_id=? AND c.is_deleted=0 ORDER BY c.revision_no`);
    const [bagging] = await q(`SELECT b.*, u.name AS doer_name FROM fms_bagging b LEFT JOIN users u ON u.id=b.doer_id
                               WHERE b.order_id=? AND b.is_deleted=0`);
    const baggingEntries = bagging ? await q('SELECT * FROM fms_bagging_entry WHERE bagging_id=? AND is_deleted=0 ORDER BY id', [bagging.id]) : [];
    const requirements = await q(`SELECT r.*, v.vendor_name FROM fms_requirement r LEFT JOIN fms_vendors v ON v.id=r.vendor_id
                                  WHERE r.order_id=? AND r.is_deleted=0 ORDER BY r.id`);
    const reqIds = requirements.map(r => r.id);
    const reqReceipts = reqIds.length
      ? await q(`SELECT * FROM fms_requirement_receipt WHERE requirement_id IN (${reqIds.map(() => '?').join(',')}) AND is_deleted=0 ORDER BY id`, reqIds)
      : [];
    const issueLines = await q(`SELECT l.*, i.issue_no, i.issue_date, i.issue_invoice_no, i.expected_return_date, i.vendor_id, v.vendor_name
                                FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id
                                LEFT JOIN fms_vendors v ON v.id=i.vendor_id
                                WHERE l.order_id=? AND l.is_deleted=0 ORDER BY l.id`);
    const receiptLines = await q(`SELECT rl.*, r.receipt_no, r.receipt_date, r.vendor_invoice_no, r.vendor_invoice_date, v.vendor_name
                                  FROM fms_vendor_receipt_line rl JOIN fms_vendor_receipt r ON r.id=rl.receipt_id
                                  LEFT JOIN fms_vendors v ON v.id=r.vendor_id
                                  WHERE rl.order_id=? AND rl.is_deleted=0 ORDER BY rl.id`);
    const hallmark = await q(`SELECT h.*, v.vendor_name AS centre_name FROM fms_hallmark h LEFT JOIN fms_vendors v ON v.id=h.hallmark_centre_id
                              WHERE h.order_id=? AND h.is_deleted=0 ORDER BY h.id`);
    const lab = await q(`SELECT j.*, l.name AS lab_name FROM fms_lab_certificate j LEFT JOIN fms_lab_master l ON l.id=j.lab_id
                         WHERE j.order_id=? AND j.is_deleted=0 ORDER BY j.id`);
    const dispatchLines = await q(`SELECT dl.*, d.dispatch_no, d.invoice_no, d.invoice_date, d.invoice_amount, d.dispatch_date,
                                          d.payment_due_date, d.received_amount, d.balance, d.payment_status, d.courier, d.awb_no
                                   FROM fms_dispatch_line dl JOIN fms_dispatch d ON d.id=dl.dispatch_id
                                   WHERE dl.order_id=? AND dl.is_deleted=0 ORDER BY dl.id`);
    const dispIds = [...new Set(dispatchLines.map(d => d.dispatch_id))];
    let payments = [];
    if (dispIds.length) {
      const ph = dispIds.map(() => '?').join(',');
      const inv = await q(`SELECT a.dispatch_id, a.allocated_amount, 'Invoice-wise' AS kind, NULL AS category, r.receipt_no, r.receipt_date, r.payment_mode
                           FROM fms_payment_allocation a JOIN fms_payment_receipt r ON r.id=a.receipt_id
                           WHERE a.dispatch_id IN (${ph}) AND a.is_deleted=0`, dispIds);
      const cat = await q(`SELECT a.dispatch_id, a.allocated_amount, 'Category-wise' AS kind, a.category, r.receipt_no, r.receipt_date, r.payment_mode
                           FROM fms_payment_category_allocation a JOIN fms_payment_receipt r ON r.id=a.receipt_id
                           WHERE a.dispatch_id IN (${ph}) AND a.is_deleted=0`, dispIds);
      payments = [...inv, ...cat].sort((a, b) => String(a.receipt_date).localeCompare(String(b.receipt_date)));
    }
    const tasks = await q(`SELECT t.*, u.name AS assigned_to_name FROM fms_followup_task t LEFT JOIN users u ON u.id=t.assigned_to
                           WHERE t.order_id=? AND t.is_deleted=0 ORDER BY t.id DESC`);
    const taskIds = tasks.map(t => t.id);
    const taskLogs = taskIds.length
      ? await q(`SELECT l.*, u.name AS created_by_name FROM fms_followup_log l LEFT JOIN users u ON u.id=l.created_by
                 WHERE l.task_id IN (${taskIds.map(() => '?').join(',')}) AND l.is_deleted=0 ORDER BY l.id DESC`, taskIds)
      : [];
    res.json({
      order, customer: customer || null, diamondLines, files, statusLog, changeLog, cad,
      bagging: bagging || null, baggingEntries, requirements, reqReceipts, issueLines, receiptLines,
      hallmark, lab, dispatchLines, payments, tasks, taskLogs,
    });
  }));

  // ── Create (always Draft first; Submit routes it) ──
  app.post('/api/o2d/orders', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const p = orderPayload(b);
    if (!p.client_id) fail('Client is required');
    const uid = req.session.userId;
    const out = await withTx(db, async (q) => {
      const uniqueId = await lib.nextUniqueId(q);
      const orderNo = p.order_no || await lib.nextNo(q, 'ORD');
      const now = nowIST();
      const cols = Object.keys(p).filter(k => k !== 'order_no');
      const [r] = await q.query(
        `INSERT INTO fms_orders (unique_id, order_no, ${cols.join(',')}, order_status, current_stage, stage_entered_at,
           cad_status, created_at, created_by, is_deleted)
         VALUES (?,?,${cols.map(() => '?').join(',')},?,?,?,?,?,?,0)`,
        [uniqueId, orderNo, ...cols.map(k => p[k]), S.DRAFT, 'ORDER', now, null, now, uid]);
      await q.query(
        `INSERT INTO fms_order_status_log (order_id, from_status, to_status, from_stage, to_stage, changed_by, changed_at, remark)
         VALUES (?,?,?,?,?,?,?,?)`, [r.insertId, null, S.DRAFT, null, 'ORDER', uid, now, 'Order created']);
      await saveDiamondLines(q, r.insertId, b.diamond_lines, uid);
      return { id: r.insertId, unique_id: uniqueId, order_no: orderNo };
    });
    res.json({ success: true, ...out });
  }));

  // ── Edit ───────────────────────────────────────────
  // Confirm hone tak sab editable; uske baad sirf Additional/Reduction Pcs,
  // Delivery Date aur Remark — reason ke saath, har badlav log (spec 4.2).
  app.put('/api/o2d/orders/:id', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const b = req.body || {};
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (TERMINAL.has(o.order_status)) fail(`A ${o.order_status} order cannot be edited`);
      const p = orderPayload(b);
      if (o.confirmed_on) {
        const reason = str(b.change_reason, 1000);
        if (!reason) fail('A reason is required to change a confirmed order');
        const allowed = { additional_reduction_pcs: p.additional_reduction_pcs, delivery_date: p.delivery_date, remark: p.remark };
        if (!allowed.delivery_date) fail('Delivery date is required');
        if (int(o.qty_pcs) + int(allowed.additional_reduction_pcs) <= 0) fail('Effective qty must be more than 0');
        const sets = []; const params = [];
        for (const [k, v] of Object.entries(allowed)) {
          const oldV = o[k] == null ? null : String(o[k]);
          const newV = v == null ? null : String(v);
          if (oldV !== newV) {
            sets.push(`${k}=?`); params.push(v);
            await logChange(q, id, k, oldV, newV, reason, uid);
          }
        }
        if (sets.length) {
          await q.query(`UPDATE fms_orders SET ${sets.join(',')}, updated_at=?, updated_by=? WHERE id=?`, [...params, nowIST(), uid, id]);
          // Bagging chal rahi ho to uska order_qty bhi naye effective qty par
          const [bag] = await q.query('SELECT id FROM fms_bagging WHERE order_id=? AND is_deleted=0', [id]);
          if (bag[0]) await ctx.o2dRecalcBagging(q, bag[0].id, uid);
        }
        return;
      }
      if (!p.client_id) fail('Client is required');
      const cols = Object.keys(p).filter(k => !(k === 'order_no' && !p.order_no));
      await q.query(`UPDATE fms_orders SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=?, updated_by=? WHERE id=?`,
        [...cols.map(k => p[k]), nowIST(), uid, id]);
      await saveDiamondLines(q, id, b.diamond_lines, uid);
      if (o.order_status !== S.DRAFT) await validateFull(q, { ...o, ...p, id });
    });
    res.json({ success: true });
  }));

  // ── Submit: Draft → Open → route (spec 2.1) ────────
  app.post('/api/o2d/orders/:id/submit', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status !== S.DRAFT) fail('Only a Draft order can be submitted');
      await validateFull(q, o);
      await q.query('UPDATE fms_orders SET submitted_on=? WHERE id=?', [nowIST(), id]);
      await setStatus(q, id, S.OPEN, { userId: uid, remark: 'Order submitted', stage: 'ORDER' });
      const nd = o.development_type === 'New Development';
      const cust = o.order_type === 'Customer Order';
      if (nd) {
        await setStatus(q, id, null, { userId: uid, stage: 'CAD', extra: { cad_status: 'Pending' }, remark: 'Routed to CAD' });
      } else if (cust) {
        await setStatus(q, id, null, { userId: uid, stage: 'CONFIRMATION', extra: { cad_status: 'Not Required', confirmation_status: 'Pending' }, remark: 'Routed to quotation & confirmation' });
      } else {
        await setStatus(q, id, S.CONFIRMED, {
          userId: uid, stage: 'ORDER_SHEET', remark: 'Stock order from existing stock — straight to order sheet',
          extra: { cad_status: 'Not Required', confirmation_status: 'Confirmed', confirmed_on: todayIST() },
        });
      }
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/orders/:id/cancel', requireAuth, wrap(async (req, res) => {
    const reason = str(req.body && req.body.reason, 1000);
    await withTx(db, (q) => cancelOrder(q, int(req.params.id), reason, req.session.userId));
    res.json({ success: true });
  }));

  // Hold sirf production se pehle (spec 2.2). Wapas aane par pichhla status/stage.
  app.post('/api/o2d/orders/:id/hold', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const reason = str(req.body && req.body.reason, 1000);
    if (!reason) fail('Hold reason is required');
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status === S.HOLD) fail('Order is already on hold');
      if (TERMINAL.has(o.order_status) || o.order_status === S.DRAFT) fail(`A ${o.order_status} order cannot be put on hold`);
      if (!PRE_PRODUCTION_STAGES.includes(o.current_stage)) fail('Hold is only allowed before production (bagging) starts');
      await setStatus(q, id, S.HOLD, { userId: req.session.userId, remark: reason, extra: { hold_from_stage: o.current_stage } });
    });
    res.json({ success: true });
  }));
  app.post('/api/o2d/orders/:id/resume', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status !== S.HOLD) fail('Order is not on hold');
      const [l] = await q.query("SELECT from_status FROM fms_order_status_log WHERE order_id=? AND to_status='Hold' ORDER BY id DESC LIMIT 1", [id]);
      const back = (l[0] && l[0].from_status && l[0].from_status !== S.HOLD) ? l[0].from_status : S.OPEN;
      await setStatus(q, id, back, { userId: req.session.userId, remark: str(req.body && req.body.remark, 1000) || 'Resumed from hold' });
      if (o.confirmation_status === 'Hold') await q.query("UPDATE fms_orders SET confirmation_status='Pending' WHERE id=?", [id]);
    });
    res.json({ success: true });
  }));

  // Admin override — galat status theek karne ke liye, reason zaroori.
  app.post('/api/o2d/orders/:id/status', requireAuth, requireAdmin, wrap(async (req, res) => {
    const id = int(req.params.id);
    const b = req.body || {};
    const to = Object.values(S).includes(b.to_status) ? b.to_status : null;
    if (!to) fail('Select a valid status');
    const remark = str(b.remark, 1000);
    if (!remark) fail('Remark is required for a manual status change');
    const stage = b.stage === '' ? null : (lib.STAGES.includes(b.stage) ? b.stage : undefined);
    await withTx(db, (q) => setStatus(q, id, to, { userId: req.session.userId, remark: 'Manual: ' + remark, stage }));
    res.json({ success: true });
  }));

  // Order poori tarah mitao (admin) — order ke saath uski har stage ki entry,
  // files, logs aur follow-ups bhi. Shared invoice / vendor voucher ke header
  // tabhi hatte hain jab unme koi aur order na bache; bache to totals dobara.
  app.delete('/api/o2d/orders/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const out = await withTx(db, (q) => hardDeleteOrder(q, int(req.params.id)));
    res.json({ success: true, ...out });
  }));
  // allowShared: demo data hatate waqt — poora invoice (saare orders same demo customer ke) mitta hai
  async function hardDeleteOrder(q, id, { allowShared = false } = {}) {
    const [or] = await q.query('SELECT id, order_no FROM fms_orders WHERE id=?', [id]);
    if (!or[0]) fail('Order not found', 404);
    const ids = async (sql, p) => (await q.query(sql, p))[0].map(r => r.id);
    const inList = (arr) => arr.map(() => '?').join(',');

    // Invoice: sirf isi order ka ho tabhi mitega; doosre orders bhi hon to rok do
    const [dl] = await q.query('SELECT DISTINCT dispatch_id FROM fms_dispatch_line WHERE order_id=?', [id]);
    const dispatchIds = dl.map(r => r.dispatch_id);
    if (dispatchIds.length && !allowShared) {
      const [shared] = await q.query(
        `SELECT d.invoice_no FROM fms_dispatch d WHERE d.id IN (${inList(dispatchIds)})
           AND EXISTS (SELECT 1 FROM fms_dispatch_line x WHERE x.dispatch_id=d.id AND x.order_id<>? AND x.is_deleted=0)`, [...dispatchIds, id]);
      if (shared[0]) fail(`Invoice ${shared[0].invoice_no} also covers other orders — this order cannot be deleted on its own`);
    }

    // Follow-ups (order ke, aur is order ke invoice ke)
    const taskIds = await ids(
      `SELECT id FROM fms_followup_task WHERE order_id=?${dispatchIds.length ? ` OR (ref_table='fms_dispatch' AND ref_id IN (${inList(dispatchIds)}))` : ''}`,
      [id, ...dispatchIds]);
    if (taskIds.length) {
      await q.query(`DELETE FROM fms_followup_log WHERE task_id IN (${inList(taskIds)})`, taskIds);
      await q.query(`DELETE FROM fms_followup_task WHERE id IN (${inList(taskIds)})`, taskIds);
    }

    // Dispatch + payment allocations; receipt ka paisa customer ke on-account me rehta hai
    if (dispatchIds.length) {
      const [rc] = await q.query(
        `SELECT receipt_id FROM fms_payment_allocation WHERE dispatch_id IN (${inList(dispatchIds)})
         UNION SELECT receipt_id FROM fms_payment_category_allocation WHERE dispatch_id IN (${inList(dispatchIds)})`, [...dispatchIds, ...dispatchIds]);
      await q.query(`DELETE FROM fms_payment_allocation WHERE dispatch_id IN (${inList(dispatchIds)})`, dispatchIds);
      await q.query(`DELETE FROM fms_payment_category_allocation WHERE dispatch_id IN (${inList(dispatchIds)})`, dispatchIds);
      for (const { receipt_id: rid } of rc) {
        const [a] = await q.query(
          `SELECT (SELECT COALESCE(SUM(allocated_amount),0) FROM fms_payment_allocation WHERE receipt_id=? AND is_deleted=0)
                + (SELECT COALESCE(SUM(allocated_amount),0) FROM fms_payment_category_allocation WHERE receipt_id=? AND is_deleted=0) AS s`, [rid, rid]);
        await q.query('UPDATE fms_payment_receipt SET on_account_amount=amount_received-? WHERE id=?', [num(a[0].s), rid]);
      }
      await q.query(`DELETE FROM fms_order_files WHERE ref_table='fms_dispatch' AND ref_id IN (${inList(dispatchIds)})`, dispatchIds);
      await q.query(`DELETE FROM fms_dispatch_line WHERE dispatch_id IN (${inList(dispatchIds)})`, dispatchIds);
      await q.query(`DELETE FROM fms_dispatch WHERE id IN (${inList(dispatchIds)})`, dispatchIds);
    }

    // Vendor issue / receipt lines; khaali header hatao, baaki ke totals dobara
    const [il] = await q.query('SELECT DISTINCT issue_id FROM fms_vendor_issue_line WHERE order_id=?', [id]);
    const [rl] = await q.query('SELECT DISTINCT receipt_id FROM fms_vendor_receipt_line WHERE order_id=?', [id]);
    await q.query('DELETE FROM fms_vendor_receipt_line WHERE order_id=?', [id]);
    await q.query('DELETE FROM fms_vendor_issue_line WHERE order_id=?', [id]);
    for (const { issue_id: iid } of il) {
      const [s] = await q.query('SELECT COUNT(*) AS n, COALESCE(SUM(issued_pcs),0) AS pcs, COALESCE(SUM(issued_weight_gm),0) AS wt FROM fms_vendor_issue_line WHERE issue_id=? AND is_deleted=0', [iid]);
      if (!int(s[0].n)) await q.query('DELETE FROM fms_vendor_issue WHERE id=?', [iid]);
      else await q.query('UPDATE fms_vendor_issue SET total_pcs=?, total_weight=? WHERE id=?', [int(s[0].pcs), num(s[0].wt), iid]);
    }
    for (const { receipt_id: rid } of rl) {
      const [s] = await q.query('SELECT COUNT(*) AS n FROM fms_vendor_receipt_line WHERE receipt_id=?', [rid]);
      if (!int(s[0].n)) await q.query('DELETE FROM fms_vendor_receipt WHERE id=?', [rid]);
    }

    // Bagging, short-material requirements, CAD, hallmark, lab
    const reqIds = await ids('SELECT id FROM fms_requirement WHERE order_id=?', [id]);
    if (reqIds.length) await q.query(`DELETE FROM fms_requirement_receipt WHERE requirement_id IN (${inList(reqIds)})`, reqIds);
    await q.query('DELETE FROM fms_requirement WHERE order_id=?', [id]);
    const bagIds = await ids('SELECT id FROM fms_bagging WHERE order_id=?', [id]);
    if (bagIds.length) await q.query(`DELETE FROM fms_bagging_entry WHERE bagging_id IN (${inList(bagIds)})`, bagIds);
    for (const t of ['fms_bagging', 'fms_cad', 'fms_hallmark', 'fms_lab_certificate', 'fms_order_files',
      'fms_order_diamond_lines', 'fms_order_status_log', 'fms_order_change_log']) {
      await q.query(`DELETE FROM ${t} WHERE order_id=?`, [id]);
    }
    await q.query('DELETE FROM fms_orders WHERE id=?', [id]);
    return { order_no: or[0].order_no, invoices: dispatchIds.length };
  }
  ctx.o2dHardDeleteOrder = hardDeleteOrder;

  // Bagging doer ne "details galat hain" bola tha — order desk theek karke yahan se waapas bhejta hai.
  app.post('/api/o2d/orders/:id/resolve-query', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const remark = str(req.body && req.body.remark, 1000);
    if (!remark) fail('Describe what was corrected');
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (!int(o.bagging_query)) fail('There is no open bagging query on this order');
      await q.query('UPDATE fms_orders SET bagging_query=0, updated_at=?, updated_by=? WHERE id=?', [nowIST(), req.session.userId, id]);
      await q.query("UPDATE fms_bagging SET details_verified=0, bagging_status='Pending Verification', verification_remark=? WHERE order_id=? AND is_deleted=0",
        [(o.bagging_query_remark || '') + ' | Resolved: ' + remark, id]);
      await logChange(q, id, 'bagging_query', 'Open', 'Resolved', remark, req.session.userId);
    });
    res.json({ success: true });
  }));

  // ── Files (DB me base64; spec: ERP ka upload mechanism) ──
  // 8 MB — file base64 ho kar DB me jaati hai (~11 MB), aur shared MySQL ka
  // max_allowed_packet aksar 16 MB hota hai. Spec ke 20 MB ke liye wo badhana padega.
  const FILE_MAX = 8 * 1024 * 1024;
  const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
    '3dm': 'application/octet-stream', stl: 'application/octet-stream',
  };
  const FILE_TYPES = ['design_photo', 'order_sheet', 'quotation', 'cad', 'certificate', 'invoice', 'other'];
  app.post('/api/o2d/files', requireAuth, express.raw({ type: () => true, limit: FILE_MAX }), wrap(async (req, res) => {
    const orderId = int(req.query.order_id);
    if (!orderId) fail('order_id is required');
    await getOrder(db, orderId);
    const fileType = FILE_TYPES.includes(req.query.file_type) ? req.query.file_type : 'other';
    const name = String(req.query.name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!EXT_MIME[ext]) fail('Allowed file types: jpg, png, webp, pdf, xlsx, xls, 3dm, stl');
    if (!req.body || !req.body.length) fail('File is empty');
    const mime = EXT_MIME[ext];
    const [r] = await db.query(
      `INSERT INTO fms_order_files (order_id, file_type, ref_table, ref_id, file_name, mime, size_bytes, data, created_at, created_by, is_deleted)
       VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
      [orderId, fileType, str(req.query.ref_table, 40), int(req.query.ref_id) || null, name, mime, req.body.length,
        req.body.toString('base64'), nowIST(), req.session.userId]);
    res.json({ success: true, id: r.insertId });
  }));
  app.get('/api/o2d/files/:id', requireAuth, wrap(async (req, res) => {
    const [r] = await db.query('SELECT file_name, mime, data FROM fms_order_files WHERE id=? AND is_deleted=0', [int(req.params.id)]);
    if (!r[0]) fail('File not found', 404);
    const buf = Buffer.from(r[0].data || '', 'base64');
    res.setHeader('Content-Type', r[0].mime || 'application/octet-stream');
    const disp = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(r[0].file_name)}"`);
    res.send(buf);
  }));
  app.delete('/api/o2d/files/:id', requireAuth, wrap(async (req, res) => {
    const [r] = await db.query('SELECT created_by FROM fms_order_files WHERE id=? AND is_deleted=0', [int(req.params.id)]);
    if (!r[0]) fail('File not found', 404);
    if (r[0].created_by !== req.session.userId && !isAdmin(req)) fail('Only the uploader or admin can delete this file', 403);
    await db.query('UPDATE fms_order_files SET is_deleted=1, updated_at=?, updated_by=? WHERE id=?', [nowIST(), req.session.userId, int(req.params.id)]);
    res.json({ success: true });
  }));

  // ══════════════════════════════════════════════════════
  // CAD (Stage 3–4) — Loop A (vendor) aur Loop B (client approval)
  // ══════════════════════════════════════════════════════
  async function cadRequest(q, orderId, b, uid) {
    const o = await getOrder(q, orderId);
    if (o.development_type !== 'New Development') fail('CAD is only for New Development orders');
    if (TERMINAL.has(o.order_status) || o.order_status === S.DRAFT) fail(`Cannot request CAD for a ${o.order_status} order`);
    const [active] = await q.query("SELECT id FROM fms_cad WHERE order_id=? AND is_deleted=0 AND cad_status IN ('Requested','Received','Sent for Approval','Hold')", [orderId]);
    if (active[0]) fail('A CAD request is already active for this order');
    const vendorId = int(b.cad_vendor_id);
    const [v] = await q.query("SELECT id, vendor_name, default_lead_time_days FROM fms_vendors WHERE id=? AND vendor_type='CAD' AND is_deleted=0", [vendorId]);
    if (!v[0]) fail('Select a CAD vendor');
    const requestedOn = dateOrNull(b.requested_on) || todayIST();
    const expectedOn = dateOrNull(b.expected_on) || addDays(requestedOn, int(v[0].default_lead_time_days) || 7);
    const [mx] = await q.query('SELECT MAX(revision_no) AS m FROM fms_cad WHERE order_id=?', [orderId]);
    const rev = int(mx[0] && mx[0].m) + 1;
    const [r] = await q.query(
      `INSERT INTO fms_cad (order_id, revision_no, cad_vendor_id, requested_on, expected_on, brief, cad_status, created_at, created_by, is_deleted)
       VALUES (?,?,?,?,?,?, 'Requested', ?,?,0)`,
      [orderId, rev, vendorId, requestedOn, expectedOn, str(b.brief, 4000), nowIST(), uid]);
    await setStatus(q, orderId, S.CAD_IN_PROGRESS, { userId: uid, stage: 'CAD', extra: { cad_status: 'Requested' }, remark: `CAD rev ${rev} requested from ${v[0].vendor_name}` });
    await openTask(q, {
      task_type: 'CAD_VENDOR', order_id: orderId, ref_table: 'fms_cad', ref_id: r.insertId, party_type: 'Vendor', party_id: vendorId,
      next_followup_date: dateOrNull(b.next_followup_date) || expectedOn, title: `CAD rev ${rev} — ${o.order_no}`,
    }, uid);
    return r.insertId;
  }
  async function getCad(q, cadId) {
    const [c] = await q.query('SELECT * FROM fms_cad WHERE id=? AND is_deleted=0', [cadId]);
    if (!c[0]) fail('CAD record not found', 404);
    return c[0];
  }
  async function cadReceive(q, cadId, b, uid) {
    const c = await getCad(q, cadId);
    if (c.cad_status !== 'Requested') fail(`CAD is already ${c.cad_status}`);
    const on = dateOrNull(b.received_on) || todayIST();
    await q.query("UPDATE fms_cad SET cad_status='Received', received_on=?, updated_at=?, updated_by=? WHERE id=?", [on, nowIST(), uid, cadId]);
    await setStatus(q, c.order_id, S.CAD_RECEIVED, { userId: uid, stage: 'CAD', extra: { cad_status: 'Received' }, remark: `CAD rev ${c.revision_no} received` });
    await closeTasks(q, { task_type: 'CAD_VENDOR', ref_table: 'fms_cad', ref_id: cadId }, 'CAD Received', uid);
  }
  async function cadSendApproval(q, cadId, b, uid) {
    const c = await getCad(q, cadId);
    if (c.cad_status !== 'Received') fail('CAD must be Received before sending for approval');
    const o = await getOrder(q, c.order_id);
    const internal = o.order_type === 'Stock Order';
    const sentOn = dateOrNull(b.sent_on) || todayIST();
    await q.query(`UPDATE fms_cad SET cad_status='Sent for Approval', sent_on=?, sent_channel=?, sent_note=?, approver_type=?, updated_at=?, updated_by=? WHERE id=?`,
      [sentOn, str(b.channel, 30) || 'WhatsApp', str(b.note, 2000), internal ? 'Internal' : 'Client', nowIST(), uid, cadId]);
    await setStatus(q, c.order_id, S.CAD_SENT, { userId: uid, stage: 'APPROVAL', extra: { cad_status: 'Sent for Approval' },
      remark: internal ? 'CAD sent for internal (owner/MD) approval' : `CAD sent to client via ${str(b.channel, 30) || 'WhatsApp'}` });
    const cfg = await lib.stageConfig(q);
    await openTask(q, {
      task_type: 'CAD_CLIENT_APPROVAL', order_id: c.order_id, ref_table: 'fms_cad', ref_id: cadId,
      party_type: internal ? 'Internal' : 'Customer', party_id: internal ? o.owner_id : o.client_id,
      assigned_to: internal ? o.owner_id : null,
      next_followup_date: dateOrNull(b.next_followup_date) || addDays(sentOn, int(cfg.map.APPROVAL && cfg.map.APPROVAL.target_days) || 3),
      title: `CAD approval — ${o.order_no}`,
    }, uid);
  }
  async function cadDecision(q, cadId, b, uid) {
    const c = await getCad(q, cadId);
    if (!['Sent for Approval', 'Hold'].includes(c.cad_status)) fail('CAD is not awaiting a decision');
    const decision = b.decision;
    const reason = str(b.reason, 2000);
    const o = await getOrder(q, c.order_id);
    const now = nowIST();
    if (decision === 'Approved') {
      await q.query("UPDATE fms_cad SET cad_status='Approved', approved_on=?, decision_reason=?, updated_at=?, updated_by=? WHERE id=?",
        [todayIST(), reason, now, uid, cadId]);
      await closeTasks(q, { task_type: 'CAD_CLIENT_APPROVAL', ref_table: 'fms_cad', ref_id: cadId }, 'Approved', uid);
      if (o.order_type === 'Stock Order') {
        await setStatus(q, o.id, S.CONFIRMED, { userId: uid, stage: 'ORDER_SHEET', remark: 'CAD approved internally — stock order confirmed',
          extra: { cad_status: 'Approved', confirmation_status: 'Confirmed', confirmed_on: todayIST() } });
      } else {
        await setStatus(q, o.id, S.CAD_APPROVED, { userId: uid, stage: 'CONFIRMATION', remark: 'CAD approved by client',
          extra: { cad_status: 'Approved', confirmation_status: 'Pending' } });
      }
    } else if (decision === 'Rejected') {
      if (!reason) fail('Rejection reason / changes required is mandatory');
      await q.query("UPDATE fms_cad SET cad_status='Rejected', decision_reason=?, updated_at=?, updated_by=? WHERE id=?", [reason, now, uid, cadId]);
      await closeTasks(q, { task_type: 'CAD_CLIENT_APPROVAL', ref_table: 'fms_cad', ref_id: cadId }, 'Rejected', uid);
      await setStatus(q, o.id, S.CAD_REJECTED, { userId: uid, stage: 'CAD', extra: { cad_status: 'Rejected' }, remark: `CAD rev ${c.revision_no} rejected: ${reason}` });
      // Naya revision — Loop A dobara (spec 5.1 Loop B.2)
      await cadRequest(q, o.id, {
        cad_vendor_id: int(b.cad_vendor_id) || c.cad_vendor_id, expected_on: b.expected_on,
        brief: str(b.brief, 4000) || `Changes required: ${reason}\n\n${c.brief || ''}`,
      }, uid);
    } else if (decision === 'Hold') {
      if (!reason) fail('Hold reason is required');
      if (!isDate(b.next_followup_date)) fail('Next follow-up date is required for Hold');
      await q.query("UPDATE fms_cad SET cad_status='Hold', decision_reason=?, updated_at=?, updated_by=? WHERE id=?", [reason, now, uid, cadId]);
      if (o.order_status !== S.HOLD) {
        await setStatus(q, o.id, S.HOLD, { userId: uid, remark: `CAD on hold: ${reason}`, extra: { cad_status: 'Hold', hold_from_stage: o.current_stage } });
      }
      await q.query("UPDATE fms_followup_task SET next_followup_date=? WHERE task_type='CAD_CLIENT_APPROVAL' AND ref_table='fms_cad' AND ref_id=? AND status='Open'",
        [b.next_followup_date, cadId]);
    } else if (decision === 'Cancelled') {
      if (!reason) fail('Cancel reason is required');
      await q.query("UPDATE fms_cad SET cad_status='Cancelled', decision_reason=?, updated_at=?, updated_by=? WHERE id=?", [reason, now, uid, cadId]);
      await q.query("UPDATE fms_orders SET cad_status='Cancelled' WHERE id=?", [o.id]);
      await cancelOrder(q, o.id, reason, uid);
    } else {
      fail('Decision must be Approved, Rejected, Hold or Cancelled');
    }
  }

  app.post('/api/o2d/orders/:id/cad', requireAuth, wrap(async (req, res) => {
    const id = await withTx(db, (q) => cadRequest(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true, id });
  }));
  app.put('/api/o2d/cad/:id/receive', requireAuth, wrap(async (req, res) => {
    await withTx(db, (q) => cadReceive(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true });
  }));
  app.put('/api/o2d/cad/:id/send-approval', requireAuth, wrap(async (req, res) => {
    await withTx(db, (q) => cadSendApproval(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true });
  }));
  app.put('/api/o2d/cad/:id/decision', requireAuth, wrap(async (req, res) => {
    await withTx(db, (q) => cadDecision(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true });
  }));

  // CAD board (kanban) — har New Development order ka latest CAD revision
  app.get('/api/o2d/cad-board', requireAuth, wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT o.id, o.order_no, o.unique_id, o.order_status, o.order_type, o.cad_status AS order_cad_status, o.style_no, o.delivery_date,
              o.updated_at, c.client_name
       FROM fms_orders o LEFT JOIN fms_customers c ON c.id=o.client_id
       WHERE o.is_deleted=0 AND o.development_type='New Development' AND o.order_status NOT IN ('Draft')
       ORDER BY o.id DESC LIMIT 500`);
    const ids = rows.map(r => r.id);
    const latest = {};
    if (ids.length) {
      const [cads] = await db.query(
        `SELECT c.*, v.vendor_name FROM fms_cad c LEFT JOIN fms_vendors v ON v.id=c.cad_vendor_id
         WHERE c.is_deleted=0 AND c.order_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.revision_no`, ids);
      cads.forEach(c => { latest[c.order_id] = c; });
    }
    const today = todayIST();
    const out = rows.map(o => {
      const c = latest[o.id];
      let column = c ? c.cad_status : 'Pending';
      if (o.order_status === S.CANCELLED) column = 'Cancelled';
      return {
        ...o, column, cad_id: c ? c.id : null, revision_no: c ? c.revision_no : 0, vendor_name: c ? c.vendor_name : null,
        requested_on: c ? c.requested_on : null, expected_on: c ? c.expected_on : null, received_on: c ? c.received_on : null,
        sent_on: c ? c.sent_on : null, approved_on: c ? c.approved_on : null, decision_reason: c ? c.decision_reason : null,
        overdue: !!(c && c.cad_status === 'Requested' && c.expected_on && c.expected_on < today),
      };
    }).filter(o => !(['Approved', 'Cancelled'].includes(o.column) && o.approved_on && lib.diffDays(o.approved_on, today) > 30)
      && !(o.column === 'Cancelled' && lib.diffDays((o.updated_at || '').slice(0, 10) || today, today) > 30));
    res.json(out);
  }));

  // ══════════════════════════════════════════════════════
  // Quotation & Confirmation (Stage 5, Loop C)
  // ══════════════════════════════════════════════════════
  async function quotationPosted(q, orderId, b, uid) {
    const o = await getOrder(q, orderId);
    if (o.order_type !== 'Customer Order') fail('Quotation is only for customer orders');
    if (o.current_stage !== 'CONFIRMATION' && o.order_status !== S.HOLD) fail('Order is not at the quotation / confirmation stage');
    if (o.confirmation_status === 'Confirmed') fail('Order is already confirmed');
    const cfg = await lib.stageConfig(q);
    await setStatus(q, orderId, S.QUOTATION_SENT, {
      userId: uid, stage: 'CONFIRMATION', remark: 'Picture + quotation posted on WhatsApp group',
      extra: {
        quotation_posted_on: nowIST(), confirmation_status: 'Pending',
        quotation_amount: b.quotation_amount === '' || b.quotation_amount == null ? null : num(b.quotation_amount),
        quotation_remark: str(b.quotation_remark, 2000),
      },
    });
    await openTask(q, {
      task_type: 'ORDER_CONFIRMATION', order_id: orderId, ref_table: 'fms_orders', ref_id: orderId, party_type: 'Customer', party_id: o.client_id,
      assigned_to: o.sales_person_id,
      next_followup_date: dateOrNull(b.next_followup_date) || addDays(todayIST(), int(cfg.map.CONFIRMATION && cfg.map.CONFIRMATION.target_days) || 3),
      title: `Order confirmation — ${o.order_no}`,
    }, uid);
  }
  async function confirmationDecision(q, orderId, b, uid) {
    const o = await getOrder(q, orderId);
    if (!o.quotation_posted_on) fail('Post the quotation first');
    if (!['Pending', 'Hold'].includes(o.confirmation_status)) fail('Order is not awaiting confirmation');
    const reason = str(b.reason, 2000);
    if (b.decision === 'Confirmed') {
      await setStatus(q, orderId, S.CONFIRMED, { userId: uid, stage: 'ORDER_SHEET', remark: reason || 'Client confirmed the order',
        extra: { confirmation_status: 'Confirmed', confirmed_on: todayIST(), confirmation_reason: reason } });
      await closeTasks(q, { task_type: 'ORDER_CONFIRMATION', ref_table: 'fms_orders', ref_id: orderId }, 'Confirmed', uid);
    } else if (b.decision === 'Hold') {
      if (!reason) fail('Hold reason is required');
      if (!isDate(b.next_followup_date)) fail('Next follow-up date is required for Hold');
      await setStatus(q, orderId, o.order_status === S.HOLD ? null : S.HOLD, { userId: uid, remark: `Client put order on hold: ${reason}`,
        extra: { confirmation_status: 'Hold', confirmation_reason: reason, hold_from_stage: 'CONFIRMATION' } });
      await q.query("UPDATE fms_followup_task SET next_followup_date=? WHERE task_type='ORDER_CONFIRMATION' AND ref_id=? AND status='Open'",
        [b.next_followup_date, orderId]);
    } else if (b.decision === 'Cancelled') {
      if (!reason) fail('Cancel reason is required');
      await q.query("UPDATE fms_orders SET confirmation_status='Cancelled', confirmation_reason=? WHERE id=?", [reason, orderId]);
      await cancelOrder(q, orderId, reason, uid);
    } else {
      fail('Decision must be Confirmed, Hold or Cancelled');
    }
  }
  app.put('/api/o2d/orders/:id/quotation-posted', requireAuth, wrap(async (req, res) => {
    await withTx(db, (q) => quotationPosted(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true });
  }));
  app.put('/api/o2d/orders/:id/confirmation', requireAuth, wrap(async (req, res) => {
    await withTx(db, (q) => confirmationDecision(q, int(req.params.id), req.body || {}, req.session.userId));
    res.json({ success: true });
  }));

  // ══════════════════════════════════════════════════════
  // Stage 6 — Order Sheet PDF + Hand over to production
  // ══════════════════════════════════════════════════════
  app.get('/api/o2d/orders/:id/order-sheet.pdf', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const [orows] = await db.query(`${ORDER_SELECT} WHERE o.id=? AND o.is_deleted=0`, [id]);
    if (!orows[0]) fail('Order not found', 404);
    const o = orows[0];
    const [lines] = await db.query('SELECT * FROM fms_order_diamond_lines WHERE order_id=? AND is_deleted=0 ORDER BY id', [id]);
    const [imgs] = await db.query(
      "SELECT file_type, mime, data FROM fms_order_files WHERE order_id=? AND is_deleted=0 AND file_type IN ('design_photo','cad') AND mime IN ('image/jpeg','image/png') ORDER BY id DESC",
      [id]);
    const design = imgs.find(f => f.file_type === 'design_photo');
    const cadImg = imgs.find(f => f.file_type === 'cad');
    const brand = (ctx.BRAND && ctx.BRAND.company) || 'Balaji Jewels';

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="OrderSheet-${o.order_no}.pdf"`);
    doc.pipe(res);
    const W = doc.page.width - 72;
    doc.font('Helvetica-Bold').fontSize(16).text(brand.toUpperCase(), { align: 'center' });
    doc.font('Helvetica').fontSize(11).text('ORDER SHEET — FOR BAGGING', { align: 'center' });
    doc.moveDown(0.6);
    const fmt = d => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—');
    const effQty = effectiveQty(o);
    const rows = [
      ['Order No', o.order_no], ['Unique ID', o.unique_id], ['Client', o.client_name || '—'], ['Style No', o.style_no || '—'],
      ['Order Type', o.order_type || '—'], ['Development', o.development_type || '—'],
      ['Qty (pcs)', `${o.qty_pcs}${int(o.additional_reduction_pcs) ? ` ${int(o.additional_reduction_pcs) > 0 ? '+' : ''}${o.additional_reduction_pcs} = ${effQty}` : ''}`],
      ['Diamond Carat Wt', o.diamond_carat_weight != null ? Number(o.diamond_carat_weight).toFixed(3) + ' ct' : '—'],
      ['Quality', o.quality_name || '—'], ['Lab', int(o.certificate_required) ? (o.lab_name || '—') : 'Not required'],
      ['Delivery Date', fmt(o.delivery_date)], ['Sales Person', o.sales_person_name || '—'], ['Owner', o.owner_name || '—'],
    ];
    const colW = W / 2;
    let y = doc.y;
    rows.forEach((r, i) => {
      const x = 36 + (i % 2) * colW;
      if (i % 2 === 0 && i) y += 20;
      doc.rect(x, y, colW, 20).stroke('#999');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(r[0], x + 5, y + 6, { width: 95 });
      doc.font('Helvetica').fontSize(9).fillColor('#000').text(String(r[1]), x + 100, y + 6, { width: colW - 105, ellipsis: true, height: 12 });
    });
    doc.y = y + 30;
    const imgY = doc.y;
    const imgH = 170;
    const placeImg = (f, x, label) => {
      try {
        doc.font('Helvetica-Bold').fontSize(9).text(label, x, imgY);
        doc.image(Buffer.from(f.data, 'base64'), x, imgY + 12, { fit: [W / 2 - 10, imgH], align: 'center' });
      } catch (e) { doc.font('Helvetica').fontSize(8).text('(image could not be rendered)', x, imgY + 14); }
    };
    if (design || cadImg) {
      if (design) placeImg(design, 36, 'Design Photo');
      if (cadImg) placeImg(cadImg, 36 + W / 2 + 10, 'CAD Image');
      doc.y = imgY + imgH + 22;
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Diamond Details', 36, doc.y);
    doc.moveDown(0.3);
    const heads = ['#', 'Shape', 'Size / Sieve', 'Pcs', 'Carat'];
    const cw = [30, 160, 160, 80, W - 430];
    let ty = doc.y;
    const drawRow = (vals, bold) => {
      let x = 36;
      vals.forEach((v, i) => {
        doc.rect(x, ty, cw[i], 18).stroke('#999');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(String(v), x + 4, ty + 5, { width: cw[i] - 8 });
        x += cw[i];
      });
      ty += 18;
    };
    drawRow(heads, true);
    if (lines.length) {
      lines.forEach((l, i) => drawRow([i + 1, l.shape || '—', l.sieve_size || '—', int(l.pcs), Number(l.carat || 0).toFixed(3)]));
      drawRow(['', 'TOTAL', '', lines.reduce((s, l) => s + int(l.pcs), 0), lines.reduce((s, l) => s + num(l.carat), 0).toFixed(3)], true);
    } else {
      drawRow(['', 'Total carat only (no line details)', '', '', Number(o.diamond_carat_weight || 0).toFixed(3)]);
    }
    doc.y = ty + 12;
    doc.font('Helvetica-Bold').fontSize(10).text('Remarks', 36);
    doc.font('Helvetica').fontSize(9).text(o.remark || '—', 36, doc.y + 2, { width: W });
    doc.moveDown(3);
    const sy = doc.y;
    doc.font('Helvetica').fontSize(9)
      .text('Prepared by (Order Desk): ____________________', 36, sy)
      .text('Received by (Production): ____________________', 36 + W / 2, sy);
    doc.fontSize(7).fillColor('#777').text(`Printed ${nowIST()}`, 36, doc.page.height - 50);
    doc.end();
  }));

  app.post('/api/o2d/orders/:id/handover', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const to = int(req.body && req.body.handed_over_to);
    if (!to) fail('Select the production person');
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status !== S.CONFIRMED) fail('Only a Confirmed order can be handed over to production');
      const [u] = await q.query("SELECT name FROM users WHERE id=? AND role<>'client'", [to]);
      if (!u[0]) fail('Production person not found');
      const qty = effectiveQty(o);
      await q.query(
        `INSERT INTO fms_bagging (order_id, doer_id, details_verified, order_qty, total_bagged, total_rejected, pending_pcs, bagging_status, created_at, created_by, is_deleted)
         VALUES (?,?,0,?,0,0,?,'Pending Verification',?,?,0)`, [id, to, qty, qty, nowIST(), uid]);
      await setStatus(q, id, S.BAGGING, { userId: uid, stage: 'BAGGING', remark: `Order sheet handed over to ${u[0].name}`,
        extra: { handed_over_on: nowIST(), handed_over_to: to } });
    });
    res.json({ success: true });
  }));

  // ══════════════════════════════════════════════════════
  // Follow-up engine (sec 11)
  // ══════════════════════════════════════════════════════
  const TASK_SELECT = `
    SELECT t.*, o.order_no, o.unique_id, o.order_status, o.client_id, c.client_name, u.name AS assigned_to_name,
           v.vendor_name AS party_vendor, pc.client_name AS party_customer, pu.name AS party_user
    FROM fms_followup_task t
    LEFT JOIN fms_orders o ON o.id=t.order_id
    LEFT JOIN fms_customers c ON c.id=o.client_id
    LEFT JOIN users u ON u.id=t.assigned_to
    LEFT JOIN fms_vendors v ON t.party_type='Vendor' AND v.id=t.party_id
    LEFT JOIN fms_customers pc ON t.party_type='Customer' AND pc.id=t.party_id
    LEFT JOIN users pu ON t.party_type='Internal' AND pu.id=t.party_id`;

  app.get('/api/o2d/followups', requireAuth, wrap(async (req, res) => {
    const f = req.query;
    const today = todayIST();
    const where = ['t.is_deleted=0'];
    const params = [];
    const tab = f.tab || 'today';
    if (tab === 'closed') where.push("t.status='Closed'");
    else {
      where.push("t.status='Open'");
      if (tab === 'today') { where.push('t.next_followup_date=?'); params.push(today); }
      else if (tab === 'overdue') { where.push('t.next_followup_date<?'); params.push(today); }
      else if (tab === 'upcoming') { where.push('t.next_followup_date>?'); params.push(today); }
    }
    if (f.type) { where.push('t.task_type=?'); params.push(f.type); }
    if (f.mine === '1') { where.push('t.assigned_to=?'); params.push(req.session.userId); }
    else if (int(f.assignee)) { where.push('t.assigned_to=?'); params.push(int(f.assignee)); }
    if (int(f.client_id)) { where.push('o.client_id=?'); params.push(int(f.client_id)); }
    if (int(f.vendor_id)) { where.push("t.party_type='Vendor' AND t.party_id=?"); params.push(int(f.vendor_id)); }
    if (int(f.order_id)) { where.push('t.order_id=?'); params.push(int(f.order_id)); }
    const [rows] = await db.query(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.next_followup_date, t.id LIMIT 1000`, params);
    // Har task ka aakhri outcome
    const ids = rows.map(r => r.id);
    const last = {};
    if (ids.length) {
      const [logs] = await db.query(`SELECT task_id, outcome, remark, followup_date FROM fms_followup_log WHERE task_id IN (${ids.map(() => '?').join(',')}) AND is_deleted=0 ORDER BY id`, ids);
      logs.forEach(l => { last[l.task_id] = l; });
    }
    res.json(rows.map(r => ({
      ...r,
      party_name: r.party_vendor || r.party_customer || r.party_user || r.party_type || '—',
      overdue: r.status === 'Open' && r.next_followup_date && r.next_followup_date < today,
      days_overdue: r.status === 'Open' && r.next_followup_date && r.next_followup_date < today ? lib.diffDays(r.next_followup_date, today) : 0,
      last_outcome: last[r.id] ? last[r.id].outcome : null, last_remark: last[r.id] ? last[r.id].remark : null,
    })));
  }));

  app.get('/api/o2d/followups/counts', requireAuth, wrap(async (req, res) => {
    const today = todayIST();
    const [r] = await db.query(
      `SELECT SUM(CASE WHEN next_followup_date=? THEN 1 ELSE 0 END) AS today_count,
              SUM(CASE WHEN next_followup_date<? THEN 1 ELSE 0 END) AS overdue_count
       FROM fms_followup_task WHERE status='Open' AND is_deleted=0 AND assigned_to=?`, [today, today, req.session.userId]);
    res.json({ today: int(r[0] && r[0].today_count), overdue: int(r[0] && r[0].overdue_count) });
  }));

  app.get('/api/o2d/followups/:id', requireAuth, wrap(async (req, res) => {
    const [t] = await db.query(`${TASK_SELECT} WHERE t.id=? AND t.is_deleted=0`, [int(req.params.id)]);
    if (!t[0]) fail('Follow-up not found', 404);
    const [logs] = await db.query(`SELECT l.*, u.name AS created_by_name FROM fms_followup_log l LEFT JOIN users u ON u.id=l.created_by
                                   WHERE l.task_id=? AND l.is_deleted=0 ORDER BY l.id DESC`, [t[0].id]);
    const [extra] = await db.query("SELECT name FROM fms_followup_outcome WHERE is_deleted=0 AND is_active=1 AND (task_type IS NULL OR task_type=?) ORDER BY name", [t[0].task_type]);
    const outcomes = [...(lib.TYPE_OUTCOMES[t[0].task_type] || []), ...extra.map(x => x.name)];
    res.json({ task: { ...t[0], party_name: t[0].party_vendor || t[0].party_customer || t[0].party_user || t[0].party_type },
      logs, outcomes, closing: lib.CLOSING_OUTCOMES[t[0].task_type] || [] });
  }));

  app.post('/api/o2d/followups/:id/log', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const b = req.body || {};
    const uid = req.session.userId;
    const MODES = ['Call', 'WhatsApp', 'Email', 'Visit', 'Internal'];
    await withTx(db, async (q) => {
      const [t] = await q.query('SELECT * FROM fms_followup_task WHERE id=? AND is_deleted=0', [id]);
      if (!t[0]) fail('Follow-up not found', 404);
      const task = t[0];
      if (task.status !== 'Open') fail('This follow-up is already closed');
      const outcome = str(b.outcome, 100);
      if (!outcome) fail('Outcome is required');
      const mode = MODES.includes(b.mode) ? b.mode : null;
      if (!mode) fail('Mode is required');
      const closing = (lib.CLOSING_OUTCOMES[task.task_type] || []).includes(outcome);
      const keepsLoop = closing && outcome === 'Hold';
      const next = dateOrNull(b.next_followup_date);
      if ((!closing || keepsLoop) && !next) fail('Next follow-up date is required');
      if (next && next < todayIST()) fail('Next follow-up date cannot be in the past');
      const now = nowIST();
      await q.query(
        `INSERT INTO fms_followup_log (task_id, followup_date, mode, spoke_to, outcome, remark, next_followup_date, promised_date, promised_amount, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [id, now, mode, str(b.spoke_to, 100), outcome, str(b.remark, 2000), next, dateOrNull(b.promised_date),
          b.promised_amount === '' || b.promised_amount == null ? null : num(b.promised_amount), now, uid]);
      await q.query(`UPDATE fms_followup_task SET last_followup_on=?, followup_count=followup_count+1, updated_at=?, updated_by=?
                     ${next ? ', next_followup_date=?' : ''} WHERE id=?`, next ? [now, now, uid, next, id] : [now, now, uid, id]);
      if (!closing) return;
      // Closing outcome → wahi transition jo stage screen ka button chalata hai
      const decisionBody = { decision: outcome, reason: str(b.reason, 2000) || str(b.remark, 2000), next_followup_date: next };
      if (task.task_type === 'CAD_VENDOR') await cadReceive(q, task.ref_id, { received_on: todayIST() }, uid);
      else if (task.task_type === 'CAD_CLIENT_APPROVAL') await cadDecision(q, task.ref_id, decisionBody, uid);
      else if (task.task_type === 'ORDER_CONFIRMATION') await confirmationDecision(q, task.order_id, decisionBody, uid);
    });
    res.json({ success: true });
  }));

  app.put('/api/o2d/followups/:id/reassign', requireAuth, wrap(async (req, res) => {
    const to = int(req.body && req.body.assigned_to);
    if (!to) fail('Select a user');
    const [t] = await db.query('SELECT assigned_to FROM fms_followup_task WHERE id=? AND is_deleted=0', [int(req.params.id)]);
    if (!t[0]) fail('Follow-up not found', 404);
    if (!isAdmin(req) && t[0].assigned_to !== req.session.userId) fail('Only admin or the current assignee can reassign', 403);
    await db.query('UPDATE fms_followup_task SET assigned_to=?, updated_at=?, updated_by=? WHERE id=?', [to, nowIST(), req.session.userId, int(req.params.id)]);
    res.json({ success: true });
  }));
};
