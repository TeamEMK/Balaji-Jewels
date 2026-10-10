// ══════════════════════════════════════════════════════
// O2D FMS — Bagging & Shortfall (Stage 7), Vendor Issue/Receive (8–9),
// Hallmarking & Lab Certification (10–11).
// Saari pending/total ginti hamesha DB se dobara jodi jaati hai (recalc*),
// kabhi type nahi hoti (spec 14.1).
// ══════════════════════════════════════════════════════
module.exports = function registerO2DProduction(app, ctx) {
  const { db, requireAuth, requireAdmin, lib, wrap } = ctx;
  const {
    S, TERMINAL, todayIST, nowIST, addDays, isDate, num, int, str, dateOrNull, fail,
    withTx, setStatus, logChange, openTask, closeTasks, getOrder, effectiveQty, advanceAfterQuality,
  } = lib;

  const OPEN_REQ = "('Open','Partially Received')";

  // ── Bagging recalculation ──────────────────────────
  async function recalcBagging(q, baggingId, uid) {
    const [br] = await q.query('SELECT * FROM fms_bagging WHERE id=? AND is_deleted=0', [baggingId]);
    if (!br[0]) fail('Bagging record not found', 404);
    const b = br[0];
    const o = await getOrder(q, b.order_id);
    const orderQty = effectiveQty(o);
    const [s] = await q.query('SELECT COALESCE(SUM(bagged_pcs),0) AS bagged, COALESCE(SUM(rejected_pcs),0) AS rejected FROM fms_bagging_entry WHERE bagging_id=? AND is_deleted=0', [baggingId]);
    const bagged = int(s[0].bagged);
    const rejected = int(s[0].rejected);
    const pending = Math.max(0, orderQty - bagged);
    const [rq] = await q.query(`SELECT COUNT(*) AS n FROM fms_requirement WHERE order_id=? AND is_deleted=0 AND requirement_status IN ${OPEN_REQ}`, [b.order_id]);
    const openReqs = int(rq[0].n);
    let status;
    if (!int(b.details_verified)) status = 'Pending Verification';
    else if (pending <= 0) status = 'Completed';
    else if (openReqs) status = 'Shortfall - Awaiting Vendor';
    else status = 'In Progress';
    const completedOn = status === 'Completed' ? (b.completed_on || nowIST()) : null;
    await q.query(`UPDATE fms_bagging SET order_qty=?, total_bagged=?, total_rejected=?, pending_pcs=?, bagging_status=?, completed_on=?, updated_at=?, updated_by=? WHERE id=?`,
      [orderQty, bagged, rejected, pending, status, completedOn, nowIST(), uid || null, baggingId]);

    // Order status sirf bagging stage ke andar hi hilta hai
    if (status === 'Completed' && [S.BAGGING, S.SHORTFALL].includes(o.order_status)) {
      await setStatus(q, o.id, S.BAGGING_DONE, { userId: uid, stage: 'VENDOR', remark: `Bagging completed — ${bagged} pcs` });
    } else if (status === 'Shortfall - Awaiting Vendor' && o.order_status === S.BAGGING) {
      await setStatus(q, o.id, S.SHORTFALL, { userId: uid, stage: 'BAGGING', remark: `Short material: ${pending} pcs` });
    } else if (['In Progress', 'Pending Verification'].includes(status) && [S.SHORTFALL, S.BAGGING_DONE].includes(o.order_status)) {
      await setStatus(q, o.id, S.BAGGING, { userId: uid, stage: 'BAGGING', remark: `Bagging pending: ${pending} pcs` });
    }
    return { orderQty, bagged, rejected, pending, status };
  }
  ctx.o2dRecalcBagging = recalcBagging;

  async function getBagging(q, id) {
    const [r] = await q.query('SELECT * FROM fms_bagging WHERE id=? AND is_deleted=0', [id]);
    if (!r[0]) fail('Bagging record not found', 404);
    return r[0];
  }

  // Bagging board — production ki list
  app.get('/api/o2d/bagging', requireAuth, wrap(async (req, res) => {
    const all = req.query.all === '1';
    const [rows] = await db.query(
      `SELECT b.*, o.order_no, o.unique_id, o.order_status, o.style_no, o.delivery_date, o.bagging_query, o.bagging_query_remark,
              o.qty_pcs, o.additional_reduction_pcs, o.diamond_carat_weight, o.stage_entered_at, c.client_name, u.name AS doer_name
       FROM fms_bagging b JOIN fms_orders o ON o.id=b.order_id
       LEFT JOIN fms_customers c ON c.id=o.client_id LEFT JOIN users u ON u.id=b.doer_id
       WHERE b.is_deleted=0 AND o.is_deleted=0 ${all ? '' : "AND b.bagging_status<>'Completed' AND o.order_status NOT IN ('Cancelled','Closed')"}
       ORDER BY o.delivery_date, b.id`);
    const ids = rows.map(r => r.order_id);
    const reqMap = {};
    if (ids.length) {
      const [reqs] = await db.query(`SELECT order_id, SUM(required_pcs) AS req, SUM(received_pcs) AS rec,
                                       SUM(CASE WHEN requirement_status IN ${OPEN_REQ} THEN pending_pcs ELSE 0 END) AS still_short
                                     FROM fms_requirement WHERE is_deleted=0 AND requirement_status<>'Cancelled' AND order_id IN (${ids.map(() => '?').join(',')})
                                     GROUP BY order_id`, ids);
      reqs.forEach(r => { reqMap[r.order_id] = r; });
    }
    res.json(rows.map(r => ({
      ...r,
      requirement_raised_pcs: int(reqMap[r.order_id] && reqMap[r.order_id].req),
      received_from_vendor_pcs: int(reqMap[r.order_id] && reqMap[r.order_id].rec),
      still_short_pcs: int(reqMap[r.order_id] && reqMap[r.order_id].still_short),
    })));
  }));

  app.put('/api/o2d/bagging/:id/verify', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const ok = !!(req.body && req.body.ok);
    const remark = str(req.body && req.body.remark, 2000);
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const b = await getBagging(q, id);
      const o = await getOrder(q, b.order_id);
      if (TERMINAL.has(o.order_status)) fail(`Order is ${o.order_status}`);
      if (int(b.details_verified)) fail('Details are already verified');
      if (ok) {
        if (int(o.bagging_query)) fail('There is an open bagging query — the order desk must resolve it first');
        await q.query('UPDATE fms_bagging SET details_verified=1, verified_on=?, verified_by=?, verification_remark=? WHERE id=?',
          [nowIST(), uid, remark, id]);
      } else {
        if (!remark) fail('Describe what is wrong in the order sheet');
        await q.query('UPDATE fms_bagging SET verification_remark=? WHERE id=?', [remark, id]);
        await q.query('UPDATE fms_orders SET bagging_query=1, bagging_query_remark=?, updated_at=?, updated_by=? WHERE id=?', [remark, nowIST(), uid, o.id]);
        await logChange(q, o.id, 'bagging_query', null, 'Open', remark, uid);
      }
      await recalcBagging(q, id, uid);
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/bagging/:id/entries', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const e = req.body || {};
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const b = await getBagging(q, id);
      const o = await getOrder(q, b.order_id);
      if (TERMINAL.has(o.order_status)) fail(`Order is ${o.order_status}`);
      if (!int(b.details_verified)) fail('Verify the order sheet details first');
      if (int(o.bagging_query)) fail('There is an open bagging query on this order');
      const bagged = int(e.bagged_pcs);
      const rejected = int(e.rejected_pcs);
      if (bagged < 0 || rejected < 0) fail('Pieces cannot be negative');
      if (!bagged && !rejected) fail('Enter bagged or rejected pieces');
      const cur = await recalcBagging(q, id, uid);
      if (cur.bagged + bagged > cur.orderQty) fail(`Only ${cur.orderQty - cur.bagged} pcs are pending — you entered ${bagged}`);
      if (rejected > 0 && !str(e.rejection_reason)) fail('Rejection reason is required');
      const linked = int(e.linked_receipt_id) || null;
      if (linked) {
        const [lr] = await q.query('SELECT rr.id FROM fms_requirement_receipt rr JOIN fms_requirement r ON r.id=rr.requirement_id WHERE rr.id=? AND r.order_id=?', [linked, o.id]);
        if (!lr[0]) fail('Linked vendor receipt does not belong to this order');
      }
      await q.query(
        `INSERT INTO fms_bagging_entry (bagging_id, entry_date, bagged_pcs, rejected_pcs, rejection_reason, bagged_carat, remark, linked_receipt_id, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
        [id, dateOrNull(e.entry_date) || todayIST(), bagged, rejected, str(e.rejection_reason, 1000),
          e.bagged_carat === '' || e.bagged_carat == null ? null : num(e.bagged_carat), str(e.remark, 1000), linked, nowIST(), uid]);
      await recalcBagging(q, id, uid);
    });
    res.json({ success: true });
  }));

  app.delete('/api/o2d/bagging-entries/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    await withTx(db, async (q) => {
      const [e] = await q.query('SELECT bagging_id FROM fms_bagging_entry WHERE id=? AND is_deleted=0', [int(req.params.id)]);
      if (!e[0]) fail('Entry not found', 404);
      await q.query('UPDATE fms_bagging_entry SET is_deleted=1, updated_at=?, updated_by=? WHERE id=?', [nowIST(), req.session.userId, int(req.params.id)]);
      await recalcBagging(q, e[0].bagging_id, req.session.userId);
    });
    res.json({ success: true });
  }));

  // ── Requirement (shortfall) → diamond vendor ───────
  async function recalcRequirement(q, reqId, uid) {
    const [rr] = await q.query('SELECT * FROM fms_requirement WHERE id=? AND is_deleted=0', [reqId]);
    if (!rr[0]) fail('Requirement not found', 404);
    const r = rr[0];
    const [s] = await q.query('SELECT COALESCE(SUM(received_pcs),0) AS pcs, COALESCE(SUM(received_carat),0) AS ct FROM fms_requirement_receipt WHERE requirement_id=? AND is_deleted=0', [reqId]);
    const recPcs = int(s[0].pcs);
    const pending = Math.max(0, int(r.required_pcs) - recPcs);
    let status = r.requirement_status;
    if (status !== 'Cancelled') status = recPcs <= 0 ? 'Open' : (pending <= 0 ? 'Received' : 'Partially Received');
    await q.query('UPDATE fms_requirement SET received_pcs=?, received_carat=?, pending_pcs=?, requirement_status=?, updated_at=?, updated_by=? WHERE id=?',
      [recPcs, num(s[0].ct), pending, status, nowIST(), uid || null, reqId]);
    if (status === 'Received') await closeTasks(q, { task_type: 'REQUIREMENT_VENDOR', ref_table: 'fms_requirement', ref_id: reqId }, 'Fully received', uid);
    return { ...r, received_pcs: recPcs, pending_pcs: pending, requirement_status: status };
  }

  app.post('/api/o2d/requirements', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const id = await withTx(db, async (q) => {
      const bag = await getBagging(q, int(b.bagging_id));
      const o = await getOrder(q, bag.order_id);
      if (TERMINAL.has(o.order_status)) fail(`Order is ${o.order_status}`);
      if (!int(bag.details_verified)) fail('Verify the order sheet details first');
      const cur = await recalcBagging(q, bag.id, uid);
      const [v] = await q.query("SELECT id, vendor_name FROM fms_vendors WHERE id=? AND vendor_type='Diamond Supplier' AND is_deleted=0", [int(b.vendor_id)]);
      if (!v[0]) fail('Select a diamond supplier');
      const need = int(b.required_pcs);
      if (need <= 0) fail('Required pcs must be more than 0');
      const [op] = await q.query(`SELECT COALESCE(SUM(pending_pcs),0) AS p FROM fms_requirement WHERE order_id=? AND is_deleted=0 AND requirement_status IN ${OPEN_REQ}`, [o.id]);
      const alreadyAsked = int(op[0].p);
      if (need + alreadyAsked > cur.pending) fail(`Only ${Math.max(0, cur.pending - alreadyAsked)} pcs are short (other open requirements already cover ${alreadyAsked})`);
      if (!isDate(b.required_by_date)) fail('Required-by date is required');
      const no = await lib.nextNo(q, 'REQ');
      const [r] = await q.query(
        `INSERT INTO fms_requirement (requirement_no, order_id, bagging_id, vendor_id, required_pcs, required_carat, shape, size, quality,
           required_by_date, remark, requirement_status, received_pcs, received_carat, pending_pcs, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'Open',0,0,?,?,?,0)`,
        [no, o.id, bag.id, v[0].id, need, b.required_carat === '' || b.required_carat == null ? null : num(b.required_carat),
          str(b.shape, 50), str(b.size, 50), str(b.quality, 50), b.required_by_date, str(b.remark, 1000), need, nowIST(), uid]);
      await openTask(q, {
        task_type: 'REQUIREMENT_VENDOR', order_id: o.id, ref_table: 'fms_requirement', ref_id: r.insertId, party_type: 'Vendor', party_id: v[0].id,
        next_followup_date: b.required_by_date, title: `${no} — ${need} pcs short material — ${o.order_no}`,
      }, uid);
      await recalcBagging(q, bag.id, uid);
      return r.insertId;
    });
    res.json({ success: true, id });
  }));

  app.put('/api/o2d/requirements/:id/cancel', requireAuth, wrap(async (req, res) => {
    const reason = str(req.body && req.body.reason, 1000);
    if (!reason) fail('Cancel reason is required');
    await withTx(db, async (q) => {
      const [r] = await q.query('SELECT * FROM fms_requirement WHERE id=? AND is_deleted=0', [int(req.params.id)]);
      if (!r[0]) fail('Requirement not found', 404);
      if (r[0].requirement_status === 'Received') fail('A fully received requirement cannot be cancelled');
      await q.query("UPDATE fms_requirement SET requirement_status='Cancelled', remark=?, updated_at=?, updated_by=? WHERE id=?",
        [`${r[0].remark || ''} | Cancelled: ${reason}`, nowIST(), req.session.userId, r[0].id]);
      await closeTasks(q, { task_type: 'REQUIREMENT_VENDOR', ref_table: 'fms_requirement', ref_id: r[0].id }, 'Cancelled: ' + reason, req.session.userId);
      await recalcBagging(q, r[0].bagging_id, req.session.userId);
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/requirements/:id/receipts', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const r = await recalcRequirement(q, int(req.params.id), uid);
      if (!['Open', 'Partially Received'].includes(r.requirement_status)) fail(`Requirement is ${r.requirement_status}`);
      const pcs = int(b.received_pcs);
      if (pcs <= 0) fail('Received pcs must be more than 0');
      if (pcs > r.pending_pcs) fail(`Only ${r.pending_pcs} pcs are pending on this requirement`);
      await q.query(
        `INSERT INTO fms_requirement_receipt (requirement_id, receipt_date, received_pcs, received_carat, vendor_invoice_no, vendor_invoice_date, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,0)`,
        [r.id, dateOrNull(b.receipt_date) || todayIST(), pcs, b.received_carat === '' || b.received_carat == null ? null : num(b.received_carat),
          str(b.vendor_invoice_no, 50), dateOrNull(b.vendor_invoice_date), str(b.remark, 1000), nowIST(), uid]);
      await recalcRequirement(q, r.id, uid);
      await recalcBagging(q, r.bagging_id, uid);
    });
    res.json({ success: true });
  }));

  // ══════════════════════════════════════════════════════
  // Vendor Issue / Receive (finished goods)
  // ══════════════════════════════════════════════════════
  async function issuedPcsFor(q, orderId) {
    const [s] = await q.query('SELECT COALESCE(SUM(issued_pcs),0) AS issued, COALESCE(SUM(received_pcs),0) AS received FROM fms_vendor_issue_line WHERE order_id=? AND is_deleted=0', [orderId]);
    return { issued: int(s[0].issued), received: int(s[0].received) };
  }

  app.get('/api/o2d/issues/pending-orders', requireAuth, wrap(async (req, res) => {
    const cid = int(req.query.customerId);
    if (!cid) fail('Select a customer');
    const [rows] = await db.query(
      `SELECT o.id, o.order_no, o.unique_id, o.style_no, o.delivery_date, o.diamond_carat_weight, b.total_bagged
       FROM fms_orders o JOIN fms_bagging b ON b.order_id=o.id AND b.is_deleted=0
       WHERE o.client_id=? AND o.is_deleted=0 AND b.bagging_status='Completed' AND o.order_status NOT IN ('Cancelled','Closed')
       ORDER BY o.delivery_date, o.id`, [cid]);
    const out = [];
    for (const r of rows) {
      const s = await issuedPcsFor(db, r.id);
      const available = int(r.total_bagged) - s.issued;
      if (available > 0) out.push({ ...r, issued_pcs: s.issued, available_pcs: available });
    }
    res.json(out);
  }));

  app.post('/api/o2d/issues', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const out = await withTx(db, async (q) => {
      const cid = int(b.customer_id);
      const [c] = await q.query('SELECT id FROM fms_customers WHERE id=? AND is_deleted=0', [cid]);
      if (!c[0]) fail('Select a customer');
      const [v] = await q.query("SELECT id, vendor_name, default_lead_time_days FROM fms_vendors WHERE id=? AND vendor_type='Manufacturing (FG)' AND is_deleted=0", [int(b.vendor_id)]);
      if (!v[0]) fail('Select a manufacturing (FG) vendor');
      if (!isDate(b.issue_date)) fail('Issue date is required');
      if (!str(b.issue_invoice_no)) fail('Issue invoice / voucher no is required');
      const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => int(l.issued_pcs) > 0);
      if (!lines.length) fail('Enter issued pcs for at least one order');
      const seen = new Set();
      for (const l of lines) {
        const oid = int(l.order_id);
        if (seen.has(oid)) fail('Each order can appear only once in an issue');
        seen.add(oid);
        const o = await getOrder(q, oid);
        if (o.client_id !== cid) fail(`Order ${o.order_no} does not belong to this customer`);
        const [bg] = await q.query("SELECT total_bagged FROM fms_bagging WHERE order_id=? AND is_deleted=0 AND bagging_status='Completed'", [oid]);
        if (!bg[0]) fail(`Bagging is not complete for ${o.order_no}`);
        const s = await issuedPcsFor(q, oid);
        const avail = int(bg[0].total_bagged) - s.issued;
        if (int(l.issued_pcs) > avail) fail(`${o.order_no}: only ${avail} pcs are available to issue`);
        if (!(num(l.issued_weight_gm) > 0)) fail(`${o.order_no}: issued weight (gm) is required`);
        l._order = o;
      }
      const no = await lib.nextNo(q, 'ISS');
      const expected = dateOrNull(b.expected_return_date) || addDays(b.issue_date, int(v[0].default_lead_time_days) || 15);
      const totalPcs = lines.reduce((s, l) => s + int(l.issued_pcs), 0);
      const totalWt = lines.reduce((s, l) => s + num(l.issued_weight_gm), 0);
      const [h] = await q.query(
        `INSERT INTO fms_vendor_issue (issue_no, customer_id, vendor_id, issue_date, issue_invoice_no, total_pcs, total_weight, remark, expected_return_date, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [no, cid, v[0].id, b.issue_date, str(b.issue_invoice_no, 50), totalPcs, totalWt, str(b.remark, 1000), expected, nowIST(), uid]);
      for (const l of lines) {
        const [lr] = await q.query(
          `INSERT INTO fms_vendor_issue_line (issue_id, order_id, issued_pcs, issued_weight_gm, issued_carat, received_pcs, received_weight, line_status, created_at, created_by, is_deleted)
           VALUES (?,?,?,?,?,0,0,'Issued',?,?,0)`,
          [h.insertId, l._order.id, int(l.issued_pcs), num(l.issued_weight_gm), l.issued_carat === '' || l.issued_carat == null ? null : num(l.issued_carat), nowIST(), uid]);
        if ([S.BAGGING_DONE].includes(l._order.order_status)) {
          await setStatus(q, l._order.id, S.ISSUED, { userId: uid, stage: 'VENDOR', remark: `${no}: ${l.issued_pcs} pcs / ${num(l.issued_weight_gm)} gm issued to ${v[0].vendor_name}` });
        } else {
          await lib.setStatus(q, l._order.id, null, { userId: uid, remark: `${no}: ${l.issued_pcs} pcs issued to ${v[0].vendor_name}` });
        }
        await openTask(q, {
          task_type: 'VENDOR_FG', order_id: l._order.id, ref_table: 'fms_vendor_issue_line', ref_id: lr.insertId, party_type: 'Vendor', party_id: v[0].id,
          next_followup_date: expected, title: `${no} — ${l.issued_pcs} pcs at ${v[0].vendor_name} — ${l._order.order_no}`,
        }, uid);
      }
      return { id: h.insertId, issue_no: no };
    });
    res.json({ success: true, ...out });
  }));

  app.get('/api/o2d/issues', requireAuth, wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT i.*, v.vendor_name, c.client_name,
              (SELECT COALESCE(SUM(received_pcs),0) FROM fms_vendor_issue_line l WHERE l.issue_id=i.id AND l.is_deleted=0) AS received_pcs
       FROM fms_vendor_issue i LEFT JOIN fms_vendors v ON v.id=i.vendor_id LEFT JOIN fms_customers c ON c.id=i.customer_id
       WHERE i.is_deleted=0 ORDER BY i.id DESC LIMIT 500`);
    res.json(rows);
  }));

  app.get('/api/o2d/receipts/pending-lines', requireAuth, wrap(async (req, res) => {
    const vid = int(req.query.vendorId);
    if (!vid) fail('Select a vendor');
    const [rows] = await db.query(
      `SELECT l.*, i.issue_no, i.issue_date, i.issue_invoice_no, i.expected_return_date, o.order_no, o.unique_id, o.style_no, c.client_name
       FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id
       JOIN fms_orders o ON o.id=l.order_id LEFT JOIN fms_customers c ON c.id=o.client_id
       WHERE i.vendor_id=? AND l.is_deleted=0 AND i.is_deleted=0 AND l.received_pcs < l.issued_pcs AND o.order_status NOT IN ('Cancelled','Closed')
       ORDER BY i.issue_date, l.id`, [vid]);
    res.json(rows.map(r => ({ ...r, pending_pcs: int(r.issued_pcs) - int(r.received_pcs) })));
  }));

  // Vendor se maal aaya — order kis haal me hai, ye yahan tay hota hai.
  async function afterVendorReceipt(q, orderId, uid) {
    const o = await getOrder(q, orderId);
    const s = await issuedPcsFor(q, orderId);
    const full = s.received >= effectiveQty(o);
    if (!full) {
      if (o.order_status !== S.PART_RECEIVED) {
        await setStatus(q, orderId, S.PART_RECEIVED, { userId: uid, stage: 'VENDOR', remark: `${s.received} of ${effectiveQty(o)} pcs received` });
      }
      return;
    }
    const [hm] = await q.query('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN hallmark_done=1 THEN 1 ELSE 0 END),0) AS done FROM fms_vendor_receipt_line WHERE order_id=? AND is_deleted=0', [orderId]);
    const allHallmarked = int(hm[0].n) > 0 && int(hm[0].n) === int(hm[0].done);
    await setStatus(q, orderId, S.RECEIVED, { userId: uid, stage: 'HALLMARK', remark: `All ${s.received} pcs received from vendor`,
      extra: { hallmark_status: allHallmarked ? 'Done' : (o.hallmark_status === 'Done' ? 'Done' : 'Pending') } });
    await advanceAfterQuality(q, orderId, uid);
  }

  app.post('/api/o2d/receipts', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const out = await withTx(db, async (q) => {
      const [v] = await q.query('SELECT id FROM fms_vendors WHERE id=? AND is_deleted=0', [int(b.vendor_id)]);
      if (!v[0]) fail('Select a vendor');
      if (!isDate(b.receipt_date)) fail('Receipt date is required');
      if (!str(b.vendor_invoice_no)) fail("Vendor's invoice no is required");
      if (!isDate(b.vendor_invoice_date)) fail("Vendor's invoice date is required");
      const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => int(l.received_pcs) > 0);
      if (!lines.length) fail('Enter received pcs for at least one line');
      const no = await lib.nextNo(q, 'RCV');
      const [h] = await q.query(
        `INSERT INTO fms_vendor_receipt (receipt_no, vendor_id, receipt_date, vendor_invoice_no, vendor_invoice_date, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,0)`,
        [no, v[0].id, b.receipt_date, str(b.vendor_invoice_no, 50), b.vendor_invoice_date, str(b.remark, 1000), nowIST(), uid]);
      const orders = new Set();
      for (const l of lines) {
        const [il] = await q.query(
          `SELECT l.*, i.vendor_id, o.order_no FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id JOIN fms_orders o ON o.id=l.order_id
           WHERE l.id=? AND l.is_deleted=0`, [int(l.issue_line_id)]);
        if (!il[0]) fail('Issue line not found');
        const line = il[0];
        if (line.vendor_id !== v[0].id) fail(`${line.order_no}: this line was issued to a different vendor`);
        const pending = int(line.issued_pcs) - int(line.received_pcs);
        const pcs = int(l.received_pcs);
        if (pcs > pending) fail(`${line.order_no}: only ${pending} pcs are pending from this issue`);
        const rw = num(l.received_weight_gm);
        if (!(rw > 0)) fail(`${line.order_no}: received weight (gm) is required`);
        if (l.wastage_weight_gm === '' || l.wastage_weight_gm == null || num(l.wastage_weight_gm) < 0) fail(`${line.order_no}: wastage weight is required (0 if none)`);
        if (l.hallmark_done !== 0 && l.hallmark_done !== 1 && l.hallmark_done !== '0' && l.hallmark_done !== '1' && l.hallmark_done !== true && l.hallmark_done !== false)
          fail(`${line.order_no}: answer "Hallmarking done?"`);
        const hallmark = (l.hallmark_done === 1 || l.hallmark_done === '1' || l.hallmark_done === true) ? 1 : 0;
        const issuedForPcs = int(line.issued_pcs) ? num(line.issued_weight_gm) * pcs / int(line.issued_pcs) : 0;
        const wastage = num(l.wastage_weight_gm);
        const calc = Math.round((issuedForPcs - rw) * 1000) / 1000;
        const pct = issuedForPcs > 0 ? Math.round((wastage / issuedForPcs) * 100 * 1000) / 1000 : 0;
        await q.query(
          `INSERT INTO fms_vendor_receipt_line (receipt_id, issue_line_id, order_id, received_pcs, received_weight_gm, wastage_weight_gm, calc_wastage_gm, wastage_pct, hallmark_done, remark, created_at, created_by, is_deleted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
          [h.insertId, line.id, line.order_id, pcs, rw, wastage, calc, pct, hallmark, str(l.remark, 1000), nowIST(), uid]);
        const newRec = int(line.received_pcs) + pcs;
        const lineStatus = newRec >= int(line.issued_pcs) ? 'Received' : 'Partially Received';
        await q.query('UPDATE fms_vendor_issue_line SET received_pcs=?, received_weight=?, line_status=?, updated_at=?, updated_by=? WHERE id=?',
          [newRec, num(line.received_weight) + rw, lineStatus, nowIST(), uid, line.id]);
        if (lineStatus === 'Received') await closeTasks(q, { task_type: 'VENDOR_FG', ref_table: 'fms_vendor_issue_line', ref_id: line.id }, 'Fully received', uid);
        orders.add(line.order_id);
      }
      for (const oid of orders) await afterVendorReceipt(q, oid, uid);
      return { id: h.insertId, receipt_no: no };
    });
    res.json({ success: true, ...out });
  }));

  app.get('/api/o2d/vendors/:id/ledger', requireAuth, wrap(async (req, res) => {
    const vid = int(req.params.id);
    const from = isDate(req.query.from) ? req.query.from : '1900-01-01';
    const to = isDate(req.query.to) ? req.query.to : '2999-12-31';
    const [lines] = await db.query(
      `SELECT l.id, l.issued_pcs, l.issued_weight_gm, l.received_pcs, l.received_weight, l.line_status,
              i.issue_no, i.issue_date, i.expected_return_date, o.order_no, c.client_name,
              (SELECT COALESCE(SUM(wastage_weight_gm),0) FROM fms_vendor_receipt_line r WHERE r.issue_line_id=l.id AND r.is_deleted=0) AS wastage_gm
       FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id
       JOIN fms_orders o ON o.id=l.order_id LEFT JOIN fms_customers c ON c.id=o.client_id
       WHERE i.vendor_id=? AND l.is_deleted=0 AND i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date, l.id`, [vid, from, to]);
    const t = { issued_pcs: 0, issued_wt: 0, received_pcs: 0, received_wt: 0, wastage: 0 };
    const today = todayIST();
    const rows = lines.map(l => {
      t.issued_pcs += int(l.issued_pcs); t.issued_wt += num(l.issued_weight_gm);
      t.received_pcs += int(l.received_pcs); t.received_wt += num(l.received_weight); t.wastage += num(l.wastage_gm);
      return { ...l, pending_pcs: int(l.issued_pcs) - int(l.received_pcs),
        days_out: int(l.issued_pcs) > int(l.received_pcs) ? lib.diffDays(l.issue_date, today) : null };
    });
    res.json({ rows, totals: { ...t, pending_pcs: t.issued_pcs - t.received_pcs,
      wastage_pct: t.issued_wt > 0 ? Math.round(t.wastage / t.issued_wt * 10000) / 100 : 0 } });
  }));

  // ══════════════════════════════════════════════════════
  // Hallmarking & Lab
  // ══════════════════════════════════════════════════════
  app.get('/api/o2d/quality', requireAuth, wrap(async (req, res) => {
    const [orders] = await db.query(
      `SELECT o.id, o.order_no, o.unique_id, o.order_status, o.current_stage, o.hallmark_status, o.cert_status, o.certificate_required,
              o.qty_pcs, o.additional_reduction_pcs, o.lab_id, o.delivery_date, o.stage_entered_at, c.client_name, lm.name AS lab_name
       FROM fms_orders o LEFT JOIN fms_customers c ON c.id=o.client_id LEFT JOIN fms_lab_master lm ON lm.id=o.lab_id
       WHERE o.is_deleted=0 AND o.order_status IN ('Received from Vendor','Hallmarking Pending','Hallmarking Done','Certification Pending','Certified')
       ORDER BY o.delivery_date, o.id`);
    const [hm] = await db.query(`SELECT h.*, v.vendor_name AS centre_name, o.order_no FROM fms_hallmark h LEFT JOIN fms_vendors v ON v.id=h.hallmark_centre_id
                                 JOIN fms_orders o ON o.id=h.order_id WHERE h.is_deleted=0 ORDER BY h.id DESC LIMIT 300`);
    const [lab] = await db.query(`SELECT j.*, l.name AS lab_name, o.order_no FROM fms_lab_certificate j LEFT JOIN fms_lab_master l ON l.id=j.lab_id
                                  JOIN fms_orders o ON o.id=j.order_id WHERE j.is_deleted=0 ORDER BY j.id DESC LIMIT 300`);
    res.json({ orders, hallmark: hm, lab });
  }));

  app.post('/api/o2d/hallmark', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const id = await withTx(db, async (q) => {
      const o = await getOrder(q, int(b.order_id));
      if (o.order_status !== S.HALLMARK_PENDING) fail('Order is not pending hallmarking');
      const [v] = await q.query("SELECT id, vendor_name, default_lead_time_days FROM fms_vendors WHERE id=? AND vendor_type='Hallmarking' AND is_deleted=0", [int(b.hallmark_centre_id)]);
      if (!v[0]) fail('Select a hallmarking centre');
      const pcs = int(b.pcs_sent);
      if (pcs <= 0) fail('Pcs sent must be more than 0');
      const sent = dateOrNull(b.sent_on) || todayIST();
      const cfg = await lib.stageConfig(q);
      const exp = dateOrNull(b.expected_on) || addDays(sent, int(cfg.map.HALLMARK && cfg.map.HALLMARK.target_days) || 2);
      const [r] = await q.query(
        `INSERT INTO fms_hallmark (order_id, pcs_sent, sent_on, hallmark_centre_id, expected_on, status, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,'Sent',?,?,?,0)`, [o.id, pcs, sent, v[0].id, exp, str(b.remark, 1000), nowIST(), uid]);
      await setStatus(q, o.id, null, { userId: uid, remark: `${pcs} pcs sent for hallmarking to ${v[0].vendor_name}` });
      await openTask(q, { task_type: 'HALLMARK', order_id: o.id, ref_table: 'fms_hallmark', ref_id: r.insertId, party_type: 'Vendor', party_id: v[0].id,
        next_followup_date: exp, title: `Hallmark — ${pcs} pcs — ${o.order_no}` }, uid);
      return r.insertId;
    });
    res.json({ success: true, id });
  }));

  async function markHallmarkDone(q, orderId, uid, remark) {
    const o = await getOrder(q, orderId);
    if (![S.HALLMARK_PENDING, S.RECEIVED].includes(o.order_status)) fail('Order is not at the hallmarking stage');
    await setStatus(q, orderId, S.HALLMARK_DONE, { userId: uid, stage: 'HALLMARK', remark: remark || 'Hallmarking done', extra: { hallmark_status: 'Done' } });
    await advanceAfterQuality(q, orderId, uid);
  }

  app.put('/api/o2d/hallmark/:id/receive', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const [h] = await q.query('SELECT * FROM fms_hallmark WHERE id=? AND is_deleted=0', [int(req.params.id)]);
      if (!h[0]) fail('Hallmark job not found', 404);
      if (h[0].status !== 'Sent') fail('This hallmark job is already received');
      const pcs = int(b.pcs_received);
      if (pcs <= 0 || pcs > int(h[0].pcs_sent)) fail(`Pcs received must be between 1 and ${h[0].pcs_sent}`);
      await q.query("UPDATE fms_hallmark SET status='Received', received_on=?, pcs_received=?, huid_numbers=?, remark=?, updated_at=?, updated_by=? WHERE id=?",
        [dateOrNull(b.received_on) || todayIST(), pcs, str(b.huid_numbers, 4000), str(b.remark, 1000) || h[0].remark, nowIST(), uid, h[0].id]);
      await closeTasks(q, { task_type: 'HALLMARK', ref_table: 'fms_hallmark', ref_id: h[0].id }, 'Received', uid);
      const [open] = await q.query("SELECT COUNT(*) AS n FROM fms_hallmark WHERE order_id=? AND status='Sent' AND is_deleted=0", [h[0].order_id]);
      if (!int(open[0].n)) await markHallmarkDone(q, h[0].order_id, uid, `Hallmark received (${pcs} pcs)`);
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/orders/:id/hallmark-done', requireAuth, wrap(async (req, res) => {
    await withTx(db, async (q) => {
      const [open] = await q.query("SELECT COUNT(*) AS n FROM fms_hallmark WHERE order_id=? AND status='Sent' AND is_deleted=0", [int(req.params.id)]);
      if (int(open[0].n)) fail('A hallmark job is still out — receive it first');
      await markHallmarkDone(q, int(req.params.id), req.session.userId, str(req.body && req.body.remark, 1000) || 'Marked hallmarked (no job needed)');
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/lab-jobs', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    const id = await withTx(db, async (q) => {
      const o = await getOrder(q, int(b.order_id));
      if (o.order_status !== S.CERT_PENDING) fail('Order is not pending certification');
      const [l] = await q.query('SELECT id, name FROM fms_lab_master WHERE id=? AND is_deleted=0', [int(b.lab_id) || o.lab_id || 0]);
      if (!l[0]) fail('Select a lab');
      const pcs = int(b.pcs_sent);
      if (pcs <= 0) fail('Pcs sent must be more than 0');
      const sent = dateOrNull(b.sent_on) || todayIST();
      const cfg = await lib.stageConfig(q);
      const exp = dateOrNull(b.expected_on) || addDays(sent, int(cfg.map.LAB && cfg.map.LAB.target_days) || 5);
      const [r] = await q.query(
        `INSERT INTO fms_lab_certificate (order_id, lab_id, pcs_sent, sent_on, lab_challan_no, expected_on, status, remark, created_at, created_by, is_deleted)
         VALUES (?,?,?,?,?,?,'Sent',?,?,?,0)`, [o.id, l[0].id, pcs, sent, str(b.lab_challan_no, 50), exp, str(b.remark, 1000), nowIST(), uid]);
      await setStatus(q, o.id, null, { userId: uid, remark: `${pcs} pcs sent to ${l[0].name}`, extra: { cert_status: 'Sent' } });
      await openTask(q, { task_type: 'LAB', order_id: o.id, ref_table: 'fms_lab_certificate', ref_id: r.insertId, party_type: 'Lab', party_id: l[0].id,
        next_followup_date: exp, title: `Lab ${l[0].name} — ${pcs} pcs — ${o.order_no}` }, uid);
      return r.insertId;
    });
    res.json({ success: true, id });
  }));

  app.put('/api/o2d/lab-jobs/:id/receive', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const [j] = await q.query('SELECT * FROM fms_lab_certificate WHERE id=? AND is_deleted=0', [int(req.params.id)]);
      if (!j[0]) fail('Lab job not found', 404);
      if (j[0].status === 'Received') fail('This lab job is already fully received');
      const pcs = int(b.pcs_received);
      if (pcs <= 0 || pcs > int(j[0].pcs_sent)) fail(`Pcs received must be between 1 and ${j[0].pcs_sent}`);
      const status = pcs >= int(j[0].pcs_sent) ? 'Received' : 'Partially Received';
      await q.query('UPDATE fms_lab_certificate SET status=?, received_on=?, pcs_received=?, certificate_numbers=?, remark=?, updated_at=?, updated_by=? WHERE id=?',
        [status, dateOrNull(b.received_on) || todayIST(), pcs, str(b.certificate_numbers, 4000), str(b.remark, 1000) || j[0].remark, nowIST(), uid, j[0].id]);
      if (status === 'Received') await closeTasks(q, { task_type: 'LAB', ref_table: 'fms_lab_certificate', ref_id: j[0].id }, 'Received', uid);
      await setStatus(q, j[0].order_id, null, { userId: uid, remark: `Lab: ${pcs} of ${j[0].pcs_sent} pcs received`, extra: { cert_status: status } });
    });
    res.json({ success: true });
  }));

  // "Mark Done" — certificate attach hone ke baad hi (spec 8.2)
  app.post('/api/o2d/orders/:id/certification-done', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const uid = req.session.userId;
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status !== S.CERT_PENDING) fail('Order is not pending certification');
      const [open] = await q.query("SELECT COUNT(*) AS n FROM fms_lab_certificate WHERE order_id=? AND status<>'Received' AND is_deleted=0", [id]);
      if (int(open[0].n)) fail('A lab job is not fully received yet');
      const [f] = await q.query("SELECT COUNT(*) AS n FROM fms_order_files WHERE order_id=? AND file_type='certificate' AND is_deleted=0", [id]);
      if (!int(f[0].n)) fail('Attach at least one certificate before marking done');
      await setStatus(q, id, S.CERTIFIED, { userId: uid, stage: 'LAB', remark: 'Certificates attached — certified', extra: { cert_status: 'Certified' } });
      await advanceAfterQuality(q, id, uid);
    });
    res.json({ success: true });
  }));

  app.post('/api/o2d/orders/:id/certificate-not-required', requireAuth, wrap(async (req, res) => {
    const id = int(req.params.id);
    const reason = str(req.body && req.body.reason, 1000);
    if (!reason) fail('Reason is required');
    await withTx(db, async (q) => {
      const o = await getOrder(q, id);
      if (o.order_status !== S.CERT_PENDING) fail('Order is not pending certification');
      const [open] = await q.query("SELECT COUNT(*) AS n FROM fms_lab_certificate WHERE order_id=? AND status='Sent' AND is_deleted=0", [id]);
      if (int(open[0].n)) fail('A lab job is still out');
      await q.query("UPDATE fms_orders SET certificate_required=0, cert_status='Not Required' WHERE id=?", [id]);
      await logChange(q, id, 'certificate_required', '1', '0', reason, req.session.userId);
      await advanceAfterQuality(q, id, req.session.userId);
    });
    res.json({ success: true });
  }));
};
