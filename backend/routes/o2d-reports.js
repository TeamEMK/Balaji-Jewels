// ══════════════════════════════════════════════════════
// O2D FMS — Reports (spec 13.1–13.5) + MD Dashboard (13.3)
// ──────────────────────────────────────────────────────
// Har report ek hi shakl lautaati hai: { title, columns:[{key,label,type}],
// rows, chart:{type, labels, datasets}, notes } — frontend ek hi renderer se
// sab dikhata hai, aur ?format=csv par wahi columns Excel-ready CSV ban jaate
// hain. Ginti SQL ke bajay JS me — dono DB par date-math ek jaisa rahe.
// ══════════════════════════════════════════════════════
module.exports = function registerO2DReports(app, ctx) {
  const { db, requireAuth, lib, wrap } = ctx;
  const { S, TERMINAL, STAGES, todayIST, addDays, diffDays, isDate, num, int, fail } = lib;

  const STAGE_LABEL = {
    ORDER: 'Order Entry', CAD: 'CAD', APPROVAL: 'CAD Approval', CONFIRMATION: 'Confirmation', ORDER_SHEET: 'Order Sheet',
    BAGGING: 'Bagging', VENDOR: 'At Vendor', HALLMARK: 'Hallmark', LAB: 'Lab', DISPATCH: 'Ready / Dispatch', PAYMENT: 'Payment',
  };
  const round = (n, d = 2) => { const p = Math.pow(10, d); return Math.round((num(n)) * p) / p; };
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const ym = (d) => (d ? String(d).slice(0, 7) : null);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymLabel = (k) => `${MONTHS[int(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
  function lastMonths(n, endYm) {
    const out = [];
    let y = int(endYm.slice(0, 4)); let m = int(endYm.slice(5, 7));
    for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (!m) { m = 12; y -= 1; } }
    return out;
  }
  function addMonths(k, n) {
    let y = int(k.slice(0, 4)); let m = int(k.slice(5, 7)) + n;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  async function inQuery(sql, ids) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const [rows] = await db.query(sql.replace('(:ids)', `(${chunk.map(() => '?').join(',')})`), chunk);
      out.push(...rows);
    }
    return out;
  }
  const group = (rows, key) => { const m = {}; rows.forEach(r => { (m[r[key]] = m[r[key]] || []).push(r); }); return m; };

  // ── Dataset ────────────────────────────────────────
  // f: { from, to, client_id, sales_person_id, vendor_id, status }
  async function loadDataset(f = {}) {
    const where = ['o.is_deleted=0', "o.order_status<>'Draft'"];
    const params = [];
    if (isDate(f.from)) { where.push('o.created_at>=?'); params.push(f.from + ' 00:00:00'); }
    if (isDate(f.to)) { where.push('o.created_at<=?'); params.push(f.to + ' 23:59:59'); }
    if (int(f.client_id)) { where.push('o.client_id=?'); params.push(int(f.client_id)); }
    if (int(f.sales_person_id)) { where.push('o.sales_person_id=?'); params.push(int(f.sales_person_id)); }
    if (f.status) { where.push('o.order_status=?'); params.push(f.status); }
    const [orders] = await db.query(
      `SELECT o.*, c.client_name, sp.name AS sales_person_name, ow.name AS owner_name, qm.name AS quality_name, lm.name AS lab_name
       FROM fms_orders o LEFT JOIN fms_customers c ON c.id=o.client_id LEFT JOIN users sp ON sp.id=o.sales_person_id
       LEFT JOIN users ow ON ow.id=o.owner_id LEFT JOIN fms_quality_master qm ON qm.id=o.quality_id LEFT JOIN fms_lab_master lm ON lm.id=o.lab_id
       WHERE ${where.join(' AND ')} ORDER BY o.id`, params);
    const ids = orders.map(o => o.id);
    const rel = {
      log: group(await inQuery('SELECT * FROM fms_order_status_log WHERE order_id IN (:ids) ORDER BY id', ids), 'order_id'),
      cad: group(await inQuery(`SELECT c.*, v.vendor_name FROM fms_cad c LEFT JOIN fms_vendors v ON v.id=c.cad_vendor_id
                                WHERE c.is_deleted=0 AND c.order_id IN (:ids) ORDER BY c.revision_no`, ids), 'order_id'),
      bag: group(await inQuery('SELECT * FROM fms_bagging WHERE is_deleted=0 AND order_id IN (:ids)', ids), 'order_id'),
      req: group(await inQuery(`SELECT r.*, v.vendor_name FROM fms_requirement r LEFT JOIN fms_vendors v ON v.id=r.vendor_id
                                WHERE r.is_deleted=0 AND r.order_id IN (:ids) ORDER BY r.id`, ids), 'order_id'),
      issue: group(await inQuery(`SELECT l.*, i.issue_no, i.issue_date, i.issue_invoice_no, i.vendor_id, i.expected_return_date, v.vendor_name
                                  FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id LEFT JOIN fms_vendors v ON v.id=i.vendor_id
                                  WHERE l.is_deleted=0 AND l.order_id IN (:ids) ORDER BY i.issue_date, l.id`, ids), 'order_id'),
      rcv: group(await inQuery(`SELECT rl.*, r.receipt_date, r.vendor_id FROM fms_vendor_receipt_line rl JOIN fms_vendor_receipt r ON r.id=rl.receipt_id
                                WHERE rl.is_deleted=0 AND rl.order_id IN (:ids) ORDER BY r.receipt_date, rl.id`, ids), 'order_id'),
      hm: group(await inQuery('SELECT * FROM fms_hallmark WHERE is_deleted=0 AND order_id IN (:ids) ORDER BY id', ids), 'order_id'),
      lab: group(await inQuery(`SELECT j.*, l.name AS lab_name FROM fms_lab_certificate j LEFT JOIN fms_lab_master l ON l.id=j.lab_id
                                WHERE j.is_deleted=0 AND j.order_id IN (:ids) ORDER BY j.id`, ids), 'order_id'),
      dsp: group(await inQuery(`SELECT dl.*, d.dispatch_no, d.invoice_no, d.invoice_date, d.invoice_amount, d.dispatch_date, d.payment_due_date,
                                       d.received_amount, d.balance, d.payment_status,
                                       (SELECT COALESCE(SUM(pcs),0) FROM fms_dispatch_line x WHERE x.dispatch_id=d.id AND x.is_deleted=0) AS dispatch_pcs
                                FROM fms_dispatch_line dl JOIN fms_dispatch d ON d.id=dl.dispatch_id
                                WHERE dl.is_deleted=0 AND d.is_deleted=0 AND dl.order_id IN (:ids)`, ids), 'order_id'),
    };
    const reqIds = [].concat(...Object.values(rel.req)).map(r => r.id);
    rel.reqRcv = group(await inQuery('SELECT * FROM fms_requirement_receipt WHERE is_deleted=0 AND requirement_id IN (:ids) ORDER BY receipt_date', reqIds), 'requirement_id');
    const dspIds = [...new Set([].concat(...Object.values(rel.dsp)).map(d => d.dispatch_id))];
    const payInv = await inQuery(`SELECT a.dispatch_id, r.receipt_date FROM fms_payment_allocation a JOIN fms_payment_receipt r ON r.id=a.receipt_id
                                  WHERE a.is_deleted=0 AND a.dispatch_id IN (:ids)`, dspIds);
    const payCat = await inQuery(`SELECT a.dispatch_id, r.receipt_date FROM fms_payment_category_allocation a JOIN fms_payment_receipt r ON r.id=a.receipt_id
                                  WHERE a.is_deleted=0 AND a.dispatch_id IN (:ids)`, dspIds);
    rel.lastPay = {};
    [...payInv, ...payCat].forEach(p => { if (!rel.lastPay[p.dispatch_id] || p.receipt_date > rel.lastPay[p.dispatch_id]) rel.lastPay[p.dispatch_id] = p.receipt_date; });

    let list = orders;
    if (int(f.vendor_id)) {
      const vid = int(f.vendor_id);
      list = orders.filter(o => (rel.cad[o.id] || []).some(c => c.cad_vendor_id === vid) ||
        (rel.req[o.id] || []).some(r => r.vendor_id === vid) || (rel.issue[o.id] || []).some(l => l.vendor_id === vid));
    }
    const cfg = await lib.stageConfig(db);
    const today = todayIST();
    list = list.map(o => ({ ...o, m: lib.orderMetrics(o, cfg.map, today) }));
    return { orders: list, rel, cfg, today };
  }

  // Ek order ki poori journey (spec 13.1)
  function journey(o, rel, today) {
    const cad = rel.cad[o.id] || [];
    const bag = (rel.bag[o.id] || [])[0];
    const reqs = (rel.req[o.id] || []).filter(r => r.requirement_status !== 'Cancelled');
    const issues = rel.issue[o.id] || [];
    const rcvs = rel.rcv[o.id] || [];
    const hms = rel.hm[o.id] || [];
    const labs = rel.lab[o.id] || [];
    const dsps = rel.dsp[o.id] || [];
    const logs = rel.log[o.id] || [];
    const firstLog = (to) => { const l = logs.find(x => x.to_status === to); return l ? l.changed_at.slice(0, 10) : null; };
    const orderDate = (o.submitted_on || o.created_at || '').slice(0, 10);
    const approved = cad.filter(c => c.approved_on).map(c => c.approved_on).sort().pop() || null;
    const cadFirst = cad[0] ? cad[0].requested_on : null;
    const reqRcvDates = reqs.flatMap(r => (rel.reqRcv[r.id] || []).map(x => x.receipt_date)).sort();
    const issuedWt = issues.reduce((s, l) => s + num(l.issued_weight_gm), 0);
    const rcvWt = rcvs.reduce((s, l) => s + num(l.received_weight_gm), 0);
    const wastage = rcvs.reduce((s, l) => s + num(l.wastage_weight_gm), 0);
    const issuedForRcv = rcvs.reduce((s, l) => {
      const il = issues.find(x => x.id === l.issue_line_id);
      return s + (il && int(il.issued_pcs) ? num(il.issued_weight_gm) * int(l.received_pcs) / int(il.issued_pcs) : 0);
    }, 0);
    const firstIssue = issues[0] ? issues[0].issue_date : null;
    const lastRcv = rcvs.length ? rcvs[rcvs.length - 1].receipt_date : null;
    const dispatchDate = dsps.map(d => d.dispatch_date).sort()[0] || null;
    const share = (d) => (num(d.line_amount) && num(d.invoice_amount) ? num(d.line_amount) / num(d.invoice_amount)
      : (int(d.dispatch_pcs) ? int(d.pcs) / int(d.dispatch_pcs) : 1));
    const invAmt = dsps.reduce((s, d) => s + num(d.invoice_amount) * share(d), 0);
    const recAmt = dsps.reduce((s, d) => s + num(d.received_amount) * share(d), 0);
    const bal = dsps.reduce((s, d) => s + num(d.balance) * share(d), 0);
    const due = dsps.map(d => d.payment_due_date).sort()[0] || null;
    const lastPay = dsps.map(d => rel.lastPay[d.dispatch_id]).filter(Boolean).sort().pop() || null;
    return {
      order_no: o.order_no, unique_id: o.unique_id, client: o.client_name, sales_person: o.sales_person_name, owner: o.owner_name,
      order_type: o.order_type, dev_type: o.development_type, style_no: o.style_no, qty: o.m.effective_qty,
      carat: num(o.diamond_carat_weight), quality: o.quality_name, lab: int(o.certificate_required) ? o.lab_name : 'Not required',
      order_date: orderDate, delivery_date: o.delivery_date, status: o.order_status, stage: STAGE_LABEL[o.current_stage] || '',
      cad_requested_on: cadFirst, cad_received_on: cad.filter(c => c.received_on).map(c => c.received_on).sort().pop() || null,
      cad_sent_on: cad.filter(c => c.sent_on).map(c => c.sent_on).sort().pop() || null, cad_approved_on: approved,
      cad_revisions: cad.length, days_in_cad: cadFirst && approved ? diffDays(cadFirst, approved) : null,
      quotation_posted_on: o.quotation_posted_on ? o.quotation_posted_on.slice(0, 10) : null, confirmed_on: o.confirmed_on,
      days_to_confirm: o.confirmed_on && orderDate ? diffDays(orderDate, o.confirmed_on) : null,
      bagging_start: o.handed_over_on ? o.handed_over_on.slice(0, 10) : null, bagging_done: bag && bag.completed_on ? bag.completed_on.slice(0, 10) : null,
      bagged_pcs: bag ? int(bag.total_bagged) : null, rejected_pcs: bag ? int(bag.total_rejected) : null,
      shortfall_pcs: reqs.reduce((s, r) => s + int(r.required_pcs), 0),
      requirement_raised_on: reqs[0] ? reqs[0].created_at.slice(0, 10) : null, vendor_received_on: reqRcvDates.pop() || null,
      days_in_bagging: o.handed_over_on && bag && bag.completed_on ? diffDays(o.handed_over_on, bag.completed_on) : null,
      vendor: [...new Set(issues.map(l => l.vendor_name))].join(', '), issue_date: firstIssue,
      issued_pcs: issues.reduce((s, l) => s + int(l.issued_pcs), 0), issued_wt: round(issuedWt, 3),
      issue_invoice_no: [...new Set(issues.map(l => l.issue_invoice_no))].join(', '), receipt_date: lastRcv,
      received_pcs: rcvs.reduce((s, l) => s + int(l.received_pcs), 0), received_wt: round(rcvWt, 3),
      wastage_wt: round(wastage, 3), wastage_pct: issuedForRcv > 0 ? round(wastage / issuedForRcv * 100, 2) : null,
      days_at_vendor: firstIssue ? diffDays(firstIssue, lastRcv || today) : null,
      hallmark_sent: hms[0] ? hms[0].sent_on : null, hallmark_received: hms.filter(h => h.received_on).map(h => h.received_on).sort().pop() || null,
      lab_name: labs[0] ? labs[0].lab_name : null, lab_sent_on: labs[0] ? labs[0].sent_on : null,
      cert_received_on: labs.filter(j => j.received_on).map(j => j.received_on).sort().pop() || null,
      days_at_lab: labs[0] ? diffDays(labs[0].sent_on, labs.filter(j => j.received_on).map(j => j.received_on).sort().pop() || today) : null,
      dispatch_date: dispatchDate, invoice_no: [...new Set(dsps.map(d => d.invoice_no))].join(', '),
      invoice_date: dsps.map(d => d.invoice_date).sort()[0] || null, invoice_amount: round(invAmt),
      days_to_dispatch: dispatchDate && orderDate ? diffDays(orderDate, dispatchDate) : null,
      on_time: dispatchDate ? (o.delivery_date && dispatchDate <= o.delivery_date ? 'Y' : 'N') : '',
      due_date: due, received_amount: round(recAmt), balance: round(bal), last_receipt_date: lastPay,
      days_overdue: due && bal > 0.5 && due < today ? diffDays(due, today) : 0,
      payment_status: dsps.length ? (bal <= 0.5 ? 'Paid' : (recAmt > 0 ? 'Partially Paid' : 'Payment Pending')) : '',
      _firstLog: firstLog,
    };
  }

  // Har stage me kitne din lage — status log se (spec 13.5)
  function stageVisits(o, rel, today) {
    const logs = (rel.log[o.id] || []).filter(l => l.to_stage !== undefined);
    const visits = [];
    let cur = null;
    for (const l of logs) {
      if (l.to_stage === (cur && cur.stage)) continue;
      if (cur) { cur.out = l.changed_at; cur.days = diffDays(cur.in, l.changed_at); visits.push(cur); }
      cur = l.to_stage ? { stage: l.to_stage, in: l.changed_at } : null;
    }
    if (cur) { cur.out = null; cur.days = diffDays(cur.in, today); cur.open = true; visits.push(cur); }
    return visits;
  }

  // ── Report definitions ─────────────────────────────
  const C = (key, label, type = 'text') => ({ key, label, type });
  const value = (o) => num(o.quotation_amount);

  const REPORTS = {
    'order-journey': {
      title: 'Order Journey Report',
      run({ orders, rel, today }) {
        const columns = [
          C('order_no', 'Order No'), C('unique_id', 'Unique ID'), C('client', 'Client'), C('sales_person', 'Sales Person'), C('owner', 'Owner'),
          C('order_type', 'Order Type'), C('dev_type', 'Dev Type'), C('style_no', 'Style No'), C('qty', 'Qty', 'int'), C('carat', 'Carat', 'num3'),
          C('quality', 'Quality'), C('lab', 'Lab'), C('order_date', 'Order Date', 'date'), C('delivery_date', 'Delivery Date', 'date'),
          C('status', 'Status'), C('stage', 'Stage'),
          C('cad_requested_on', 'CAD Requested', 'date'), C('cad_received_on', 'CAD Received', 'date'), C('cad_sent_on', 'Sent for Approval', 'date'),
          C('cad_approved_on', 'CAD Approved', 'date'), C('cad_revisions', 'Revisions', 'int'), C('days_in_cad', 'Days in CAD', 'int'),
          C('quotation_posted_on', 'Quotation Posted', 'date'), C('confirmed_on', 'Confirmed On', 'date'), C('days_to_confirm', 'Days Order→Confirm', 'int'),
          C('bagging_start', 'Bagging Start', 'date'), C('bagging_done', 'Bagging Done', 'date'), C('bagged_pcs', 'Bagged Pcs', 'int'),
          C('rejected_pcs', 'Rejected Pcs', 'int'), C('shortfall_pcs', 'Shortfall Pcs', 'int'), C('requirement_raised_on', 'Requirement Raised', 'date'),
          C('vendor_received_on', 'Diamond Vendor Received', 'date'), C('days_in_bagging', 'Days in Bagging', 'int'),
          C('vendor', 'FG Vendor'), C('issue_date', 'Issue Date', 'date'), C('issued_pcs', 'Issued Pcs', 'int'), C('issued_wt', 'Issued Wt (gm)', 'num3'),
          C('issue_invoice_no', 'Issue Invoice No'), C('receipt_date', 'Receipt Date', 'date'), C('received_pcs', 'Received Pcs', 'int'),
          C('received_wt', 'Received Wt (gm)', 'num3'), C('wastage_wt', 'Wastage (gm)', 'num3'), C('wastage_pct', 'Wastage %', 'pct'),
          C('days_at_vendor', 'Days at Vendor', 'int'), C('hallmark_sent', 'Hallmark Sent', 'date'), C('hallmark_received', 'Hallmark Received', 'date'),
          C('lab_name', 'Lab Name'), C('lab_sent_on', 'Lab Sent', 'date'), C('cert_received_on', 'Certificate Received', 'date'), C('days_at_lab', 'Days at Lab', 'int'),
          C('dispatch_date', 'Dispatch Date', 'date'), C('invoice_no', 'Invoice No'), C('invoice_date', 'Invoice Date', 'date'),
          C('invoice_amount', 'Invoice Amount', 'money'), C('days_to_dispatch', 'Days Order→Dispatch', 'int'), C('on_time', 'On-time'),
          C('due_date', 'Due Date', 'date'), C('received_amount', 'Received', 'money'), C('balance', 'Balance', 'money'),
          C('last_receipt_date', 'Last Receipt', 'date'), C('days_overdue', 'Days Overdue', 'int'), C('payment_status', 'Payment Status'),
        ];
        const rows = orders.map(o => { const j = journey(o, rel, today); delete j._firstLog; j._order_id = o.id; return j; });
        return { columns, rows };
      },
    },

    'orders-by-month': {
      title: 'Orders by Month — this year vs last year',
      run({ orders, today }) {
        const months = lastMonths(12, today.slice(0, 7));
        const cnt = {}; const val = {};
        orders.forEach(o => { const k = ym(o.submitted_on || o.created_at); cnt[k] = (cnt[k] || 0) + 1; val[k] = (val[k] || 0) + value(o); });
        const rows = months.map(k => {
          const ly = addMonths(k, -12);
          return { month: ymLabel(k), count: cnt[k] || 0, value: round(val[k] || 0), count_ly: cnt[ly] || 0, value_ly: round(val[ly] || 0) };
        });
        return {
          columns: [C('month', 'Month'), C('count', 'Orders', 'int'), C('value', 'Value', 'money'), C('count_ly', 'Orders (last yr)', 'int'), C('value_ly', 'Value (last yr)', 'money')],
          rows,
          chart: { type: 'bar', labels: rows.map(r => r.month), datasets: [
            { label: 'Orders', data: rows.map(r => r.count) },
            { label: 'Last year', data: rows.map(r => r.count_ly), kind: 'line' }] },
          notes: 'Value = quotation amount entered at confirmation (orders without it count as ₹0). Last-year figures need the date filter to include last year.',
        };
      },
    },

    pipeline: {
      title: 'Orders by Status (current pipeline)',
      run({ orders }) {
        const c = {};
        orders.forEach(o => { c[o.order_status] = (c[o.order_status] || 0) + 1; });
        const order = Object.values(S);
        const rows = Object.keys(c).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(k => ({ status: k, count: c[k] }));
        return { columns: [C('status', 'Status'), C('count', 'Orders', 'int')], rows,
          chart: { type: 'doughnut', labels: rows.map(r => r.status), datasets: [{ label: 'Orders', data: rows.map(r => r.count) }] } };
      },
    },

    'by-client': {
      title: 'Orders by Client (top 10)',
      run({ orders }) {
        const m = {};
        orders.forEach(o => { const k = o.client_name || '—'; m[k] = m[k] || { client: k, count: 0, value: 0, pcs: 0 }; m[k].count++; m[k].value += value(o); m[k].pcs += o.m.effective_qty; });
        const all = Object.values(m).sort((a, b) => b.count - a.count || b.value - a.value);
        const rows = all.map(r => ({ ...r, value: round(r.value) }));
        const top = rows.slice(0, 10);
        return { columns: [C('client', 'Client'), C('count', 'Orders', 'int'), C('pcs', 'Pcs', 'int'), C('value', 'Value', 'money')], rows,
          chart: { type: 'barh', labels: top.map(r => r.client), datasets: [{ label: 'Orders', data: top.map(r => r.count) }] } };
      },
    },

    'by-sales-person': {
      title: 'Orders by Sales Person',
      run({ orders }) {
        const m = {};
        orders.forEach(o => {
          const k = o.sales_person_name || '—';
          m[k] = m[k] || { sales_person: k, count: 0, confirmed: 0, cancelled: 0, value: 0 };
          m[k].count++; if (o.confirmed_on) m[k].confirmed++; if (o.order_status === S.CANCELLED) m[k].cancelled++; m[k].value += value(o);
        });
        const rows = Object.values(m).sort((a, b) => b.count - a.count).map(r => ({ ...r, value: round(r.value),
          conversion: r.count ? round(r.confirmed / r.count * 100, 1) : 0 }));
        return { columns: [C('sales_person', 'Sales Person'), C('count', 'Orders', 'int'), C('confirmed', 'Confirmed', 'int'),
          C('cancelled', 'Cancelled', 'int'), C('conversion', 'Conversion %', 'pct'), C('value', 'Value', 'money')], rows,
          chart: { type: 'bar', labels: rows.map(r => r.sales_person), datasets: [{ label: 'Orders', data: rows.map(r => r.count) }, { label: 'Confirmed', data: rows.map(r => r.confirmed) }] } };
      },
    },

    'type-mix': {
      title: 'Customer vs Stock, New Development vs Existing',
      run({ orders }) {
        const k = {};
        orders.forEach(o => { const key = `${o.order_type || '—'} · ${o.development_type || '—'}`; k[key] = (k[key] || 0) + 1; });
        const rows = Object.keys(k).sort().map(x => ({ mix: x, count: k[x] }));
        return { columns: [C('mix', 'Order type · Development'), C('count', 'Orders', 'int')], rows,
          chart: { type: 'pie', labels: rows.map(r => r.mix), datasets: [{ label: 'Orders', data: rows.map(r => r.count) }] } };
      },
    },

    'stage-ageing': {
      title: 'Stage-wise Ageing — orders sitting in each stage',
      run({ orders, rel, cfg, today }) {
        const sit = {}; const hist = {};
        orders.forEach(o => {
          if (!TERMINAL.has(o.order_status) && o.current_stage) (sit[o.current_stage] = sit[o.current_stage] || []).push(o.m.days_in_stage || 0);
          stageVisits(o, rel, today).filter(v => !v.open).forEach(v => { (hist[v.stage] = hist[v.stage] || []).push(v.days); });
        });
        const rows = STAGES.map(st => ({
          stage: STAGE_LABEL[st], open_orders: (sit[st] || []).length,
          avg_days_now: sit[st] ? round(avg(sit[st]), 1) : null, avg_days_hist: hist[st] ? round(avg(hist[st]), 1) : null,
          target: int(cfg.map[st] && cfg.map[st].target_days),
        }));
        return { columns: [C('stage', 'Stage'), C('open_orders', 'Orders sitting', 'int'), C('avg_days_now', 'Avg days (now)', 'num1'),
          C('avg_days_hist', 'Avg days (completed)', 'num1'), C('target', 'Target days', 'int')], rows,
          chart: { type: 'bar', labels: rows.map(r => r.stage), datasets: [{ label: 'Orders sitting', data: rows.map(r => r.open_orders) }] } };
      },
    },

    bottleneck: {
      title: 'Bottleneck Report — avg days vs target',
      run({ orders, cfg }) {
        const by = {};
        const owners = {}; const clients = {};
        orders.forEach(o => {
          if (TERMINAL.has(o.order_status) || !o.current_stage || o.order_status === S.HOLD) return;
          const st = o.current_stage;
          by[st] = by[st] || { days: [], over: 0, overdue: 0 };
          by[st].days.push(o.m.days_in_stage || 0);
          if (o.m.delayed_at_stage) {
            by[st].over += o.m.days_over_target; by[st].overdue++;
            owners[o.owner_name || '—'] = (owners[o.owner_name || '—'] || 0) + 1;
            clients[o.client_name || '—'] = (clients[o.client_name || '—'] || 0) + 1;
          }
        });
        const rows = STAGES.filter(st => st !== 'PAYMENT').map(st => ({
          stage: STAGE_LABEL[st], avg_days: by[st] ? round(avg(by[st].days), 1) : 0, target: int(cfg.map[st] && cfg.map[st].target_days),
          delayed_orders: by[st] ? by[st].overdue : 0, days_over_target: by[st] ? by[st].over : 0,
        }));
        const worst = rows.reduce((w, r) => (r.days_over_target > (w ? w.days_over_target : 0) ? r : w), null);
        rows.forEach(r => { r.bottleneck = worst && r.stage === worst.stage ? 'YES' : ''; });
        const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ') || '—';
        return { columns: [C('stage', 'Stage'), C('avg_days', 'Avg days in stage', 'num1'), C('target', 'Target', 'int'),
          C('delayed_orders', 'Delayed orders', 'int'), C('days_over_target', 'Σ days over target', 'int'), C('bottleneck', 'Bottleneck')], rows,
          chart: { type: 'bar', labels: rows.map(r => r.stage), datasets: [{ label: 'Avg days', data: rows.map(r => r.avg_days), highlight: worst ? rows.indexOf(worst) : -1 },
            { label: 'Target', data: rows.map(r => r.target), kind: 'line' }] },
          notes: `Bottleneck = stage with the highest total days over target across open orders. Most delayed items — by owner: ${top(owners)}; by client: ${top(clients)}.` };
      },
    },

    delays: {
      title: 'Delay Report — orders past delivery date',
      run({ orders, rel }) {
        const late = orders.filter(o => o.m.overdue_delivery);
        const rows = late.map(o => ({ order_no: o.order_no, client: o.client_name, stage: STAGE_LABEL[o.current_stage] || '', status: o.order_status,
          sales_person: o.sales_person_name, owner: o.owner_name, vendor: [...new Set((rel.issue[o.id] || []).map(l => l.vendor_name))].join(', '),
          delivery_date: o.delivery_date, days_late: o.m.days_overdue_delivery, _order_id: o.id }))
          .sort((a, b) => b.days_late - a.days_late);
        const byStage = {};
        rows.forEach(r => { byStage[r.stage] = (byStage[r.stage] || 0) + 1; });
        return { columns: [C('order_no', 'Order No'), C('client', 'Client'), C('stage', 'Stage'), C('status', 'Status'), C('sales_person', 'Sales Person'),
          C('owner', 'Owner'), C('vendor', 'Vendor'), C('delivery_date', 'Delivery Date', 'date'), C('days_late', 'Days late', 'int')], rows,
          chart: { type: 'bar', labels: Object.keys(byStage), datasets: [{ label: 'Late orders', data: Object.values(byStage) }] } };
      },
    },

    'vendor-performance': {
      title: 'Vendor Performance (finished goods)',
      run({ orders, rel, today }) {
        const v = {};
        orders.forEach(o => {
          (rel.issue[o.id] || []).forEach(l => {
            const x = v[l.vendor_name || '—'] = v[l.vendor_name || '—'] || { vendor: l.vendor_name || '—', issued_pcs: 0, issued_wt: 0, received_pcs: 0, received_wt: 0, wastage: 0, issuedForRcv: 0, days: [], pending_pcs: 0, pending_wt: 0 };
            x.issued_pcs += int(l.issued_pcs); x.issued_wt += num(l.issued_weight_gm);
            const rc = (rel.rcv[o.id] || []).filter(r => r.issue_line_id === l.id);
            rc.forEach(r => {
              x.received_pcs += int(r.received_pcs); x.received_wt += num(r.received_weight_gm); x.wastage += num(r.wastage_weight_gm);
              x.issuedForRcv += int(l.issued_pcs) ? num(l.issued_weight_gm) * int(r.received_pcs) / int(l.issued_pcs) : 0;
              x.days.push(diffDays(l.issue_date, r.receipt_date));
            });
            const pend = int(l.issued_pcs) - int(l.received_pcs);
            if (pend > 0) { x.pending_pcs += pend; x.pending_wt += int(l.issued_pcs) ? num(l.issued_weight_gm) * pend / int(l.issued_pcs) : 0; }
          });
        });
        const rows = Object.values(v).map(x => ({ vendor: x.vendor, issued_pcs: x.issued_pcs, issued_wt: round(x.issued_wt, 3), received_pcs: x.received_pcs,
          received_wt: round(x.received_wt, 3), avg_days_to_return: x.days.length ? round(avg(x.days), 1) : null,
          wastage_pct: x.issuedForRcv > 0 ? round(x.wastage / x.issuedForRcv * 100, 2) : null, pending_pcs: x.pending_pcs, pending_wt: round(x.pending_wt, 3) }))
          .sort((a, b) => b.issued_pcs - a.issued_pcs);
        return { columns: [C('vendor', 'Vendor'), C('issued_pcs', 'Issued Pcs', 'int'), C('issued_wt', 'Issued Wt', 'num3'), C('received_pcs', 'Received Pcs', 'int'),
          C('received_wt', 'Received Wt', 'num3'), C('avg_days_to_return', 'Avg days to return', 'num1'), C('wastage_pct', 'Wastage %', 'pct'),
          C('pending_pcs', 'Pending Pcs', 'int'), C('pending_wt', 'Pending Wt', 'num3')], rows,
          chart: { type: 'bar', labels: rows.map(r => r.vendor), datasets: [{ label: 'Avg days to return', data: rows.map(r => r.avg_days_to_return || 0) }] } };
      },
    },

    cad: {
      title: 'CAD Report — vendor turnaround, approval time, rejection rate',
      run({ orders, rel }) {
        const v = {};
        orders.forEach(o => (rel.cad[o.id] || []).forEach(c => {
          const x = v[c.vendor_name || '—'] = v[c.vendor_name || '—'] || { vendor: c.vendor_name || '—', requests: 0, received: 0, turn: [], approval: [], approved: 0, rejected: 0 };
          x.requests++;
          if (c.received_on) { x.received++; x.turn.push(diffDays(c.requested_on, c.received_on)); }
          if (c.approved_on && c.sent_on) x.approval.push(diffDays(c.sent_on, c.approved_on));
          if (c.cad_status === 'Approved') x.approved++;
          if (c.cad_status === 'Rejected') x.rejected++;
        }));
        const rows = Object.values(v).map(x => ({ vendor: x.vendor, requests: x.requests, received: x.received,
          avg_turnaround: x.turn.length ? round(avg(x.turn), 1) : null, avg_approval_days: x.approval.length ? round(avg(x.approval), 1) : null,
          approved: x.approved, rejected: x.rejected, rejection_rate: x.approved + x.rejected ? round(x.rejected / (x.approved + x.rejected) * 100, 1) : null }));
        return { columns: [C('vendor', 'CAD Vendor'), C('requests', 'Requests', 'int'), C('received', 'Received', 'int'), C('avg_turnaround', 'Avg turnaround (days)', 'num1'),
          C('avg_approval_days', 'Avg client approval (days)', 'num1'), C('approved', 'Approved', 'int'), C('rejected', 'Rejected', 'int'), C('rejection_rate', 'Rejection %', 'pct')], rows,
          chart: { type: 'bar', labels: rows.map(r => r.vendor), datasets: [{ label: 'Avg turnaround', data: rows.map(r => r.avg_turnaround || 0) },
            { label: 'Avg approval', data: rows.map(r => r.avg_approval_days || 0) }] } };
      },
    },

    shortfall: {
      title: 'Bagging Shortfall Report',
      run({ orders, rel }) {
        const byMonth = {}; const byVendor = {};
        const rows = [];
        orders.forEach(o => (rel.req[o.id] || []).filter(r => r.requirement_status !== 'Cancelled').forEach(r => {
          const k = ym(r.created_at);
          byMonth[k] = (byMonth[k] || 0) + int(r.required_pcs);
          const rc = (rel.reqRcv[r.id] || []).map(x => x.receipt_date).sort();
          const fulfil = r.requirement_status === 'Received' && rc.length ? diffDays(r.created_at, rc[rc.length - 1]) : null;
          const x = byVendor[r.vendor_name || '—'] = byVendor[r.vendor_name || '—'] || { pcs: 0, days: [] };
          x.pcs += int(r.required_pcs); if (fulfil != null) x.days.push(fulfil);
          rows.push({ requirement_no: r.requirement_no, order_no: o.order_no, client: o.client_name, vendor: r.vendor_name, required_pcs: int(r.required_pcs),
            received_pcs: int(r.received_pcs), pending_pcs: int(r.pending_pcs), status: r.requirement_status, raised_on: r.created_at.slice(0, 10),
            days_to_fulfil: fulfil, _order_id: o.id });
        }));
        const months = Object.keys(byMonth).sort();
        const vendorSummary = Object.entries(byVendor).map(([k, x]) => `${k}: ${x.pcs} pcs${x.days.length ? `, avg ${round(avg(x.days), 1)} days` : ''}`).join(' · ');
        return { columns: [C('requirement_no', 'Req No'), C('order_no', 'Order No'), C('client', 'Client'), C('vendor', 'Vendor'), C('required_pcs', 'Required', 'int'),
          C('received_pcs', 'Received', 'int'), C('pending_pcs', 'Pending', 'int'), C('status', 'Status'), C('raised_on', 'Raised On', 'date'), C('days_to_fulfil', 'Days to fulfil', 'int')],
          rows, chart: { type: 'bar', labels: months.map(ymLabel), datasets: [{ label: 'Shortfall pcs', data: months.map(k => byMonth[k]) }] },
          notes: vendorSummary ? `By vendor — ${vendorSummary}` : '' };
      },
    },

    'dispatch-register': {
      title: 'Dispatch & Invoice Register',
      async run(_ds, f) {
        const where = ['d.is_deleted=0']; const params = [];
        if (isDate(f.from)) { where.push('d.invoice_date>=?'); params.push(f.from); }
        if (isDate(f.to)) { where.push('d.invoice_date<=?'); params.push(f.to); }
        if (int(f.client_id)) { where.push('d.customer_id=?'); params.push(int(f.client_id)); }
        const [rows] = await db.query(`SELECT d.*, c.client_name,
              (SELECT COUNT(*) FROM fms_dispatch_line l WHERE l.dispatch_id=d.id AND l.is_deleted=0) AS orders_count,
              (SELECT COALESCE(SUM(pcs),0) FROM fms_dispatch_line l WHERE l.dispatch_id=d.id AND l.is_deleted=0) AS pcs
            FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id WHERE ${where.join(' AND ')} ORDER BY d.invoice_date DESC, d.id DESC`, params);
        return { columns: [C('dispatch_no', 'Dispatch No'), C('client_name', 'Client'), C('invoice_no', 'Invoice No'), C('invoice_date', 'Invoice Date', 'date'),
          C('dispatch_date', 'Dispatch Date', 'date'), C('orders_count', 'Orders', 'int'), C('pcs', 'Pcs', 'int'), C('invoice_amount', 'Amount', 'money'),
          C('gold_amount', 'Gold', 'money'), C('diamond_amount', 'Diamond', 'money'), C('labour_amount', 'Labour', 'money'), C('other_amount', 'Other', 'money'),
          C('received_amount', 'Received', 'money'), C('balance', 'Balance', 'money'), C('payment_due_date', 'Due', 'date'), C('payment_status', 'Status'),
          C('courier', 'Courier'), C('awb_no', 'AWB')], rows };
      },
    },

    receivables: {
      title: 'Receivables Ageing (by client, with Gold / Diamond split)',
      async run(_ds, f) {
        const a = await ctx.o2dAgeing(db, { customerId: int(f.client_id) });
        const top = a.clients.slice(0, 12);
        return { columns: [C('client_name', 'Client'), C('invoices', 'Invoices', 'int'), C('b0_30', '0–30', 'money'), C('b31_60', '31–60', 'money'),
          C('b61_90', '61–90', 'money'), C('b90', '90+', 'money'), C('balance', 'Total', 'money'), C('overdue', 'Overdue', 'money'),
          C('Gold', 'Gold due', 'money'), C('Diamond', 'Diamond due', 'money'), C('Labour', 'Labour due', 'money'), C('Other', 'Other due', 'money'), C('Unsplit', 'Unsplit', 'money')],
          rows: a.clients,
          chart: { type: 'stacked', labels: top.map(r => r.client_name), datasets: [
            { label: '0–30', data: top.map(r => r.b0_30) }, { label: '31–60', data: top.map(r => r.b31_60) },
            { label: '61–90', data: top.map(r => r.b61_90) }, { label: '90+', data: top.map(r => r.b90) }] },
          notes: 'Age = days since invoice date. "Unsplit" = balance on invoices without a category break-up.' };
      },
    },

    collection: {
      title: 'Payment Collection by Month vs Invoiced',
      async run(_ds, f) {
        const today = todayIST();
        const months = lastMonths(12, today.slice(0, 7));
        const start = months[0] + '-01';
        const cust = int(f.client_id);
        const [inv] = await db.query(`SELECT invoice_date, invoice_amount FROM fms_dispatch WHERE is_deleted=0 AND invoice_date>=? ${cust ? 'AND customer_id=?' : ''}`, cust ? [start, cust] : [start]);
        const [rec] = await db.query(`SELECT receipt_date, amount_received FROM fms_payment_receipt WHERE is_deleted=0 AND receipt_date>=? ${cust ? 'AND customer_id=?' : ''}`, cust ? [start, cust] : [start]);
        const a = {}; const b = {};
        inv.forEach(r => { a[ym(r.invoice_date)] = (a[ym(r.invoice_date)] || 0) + num(r.invoice_amount); });
        rec.forEach(r => { b[ym(r.receipt_date)] = (b[ym(r.receipt_date)] || 0) + num(r.amount_received); });
        const rows = months.map(k => ({ month: ymLabel(k), invoiced: round(a[k] || 0), collected: round(b[k] || 0) }));
        return { columns: [C('month', 'Month'), C('invoiced', 'Invoiced', 'money'), C('collected', 'Collected', 'money')], rows,
          chart: { type: 'line', labels: rows.map(r => r.month), datasets: [{ label: 'Invoiced', data: rows.map(r => r.invoiced) }, { label: 'Collected', data: rows.map(r => r.collected) }] } };
      },
    },

    'followup-compliance': {
      title: 'Follow-up Compliance — overdue follow-ups by user / type',
      async run() {
        const today = todayIST();
        const [rows] = await db.query(`SELECT t.task_type, t.status, t.next_followup_date, t.followup_count, u.name AS user_name
                                       FROM fms_followup_task t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.is_deleted=0`);
        const m = {};
        rows.forEach(r => {
          const k = `${r.user_name || '—'}|${r.task_type}`;
          const x = m[k] = m[k] || { user: r.user_name || '—', task_type: r.task_type, open: 0, overdue: 0, closed: 0, fu: [] };
          if (r.status === 'Open') { x.open++; if (r.next_followup_date < today) x.overdue++; } else { x.closed++; x.fu.push(int(r.followup_count)); }
        });
        const out = Object.values(m).map(x => ({ user: x.user, task_type: x.task_type, open: x.open, overdue: x.overdue, closed: x.closed,
          avg_followups_to_close: x.fu.length ? round(avg(x.fu), 1) : null })).sort((a, b) => b.overdue - a.overdue);
        const byUser = {};
        out.forEach(r => { byUser[r.user] = (byUser[r.user] || 0) + r.overdue; });
        return { columns: [C('user', 'User'), C('task_type', 'Type'), C('open', 'Open', 'int'), C('overdue', 'Overdue', 'int'), C('closed', 'Closed', 'int'),
          C('avg_followups_to_close', 'Avg follow-ups to close', 'num1')], rows: out,
          chart: { type: 'bar', labels: Object.keys(byUser), datasets: [{ label: 'Overdue follow-ups', data: Object.values(byUser) }] } };
      },
    },

    forecast: {
      title: 'Sales Forecast',
      async run(ds) { return forecast(ds); },
    },
  };

  // ── Sales forecast (spec 13.4) ─────────────────────
  // Actual (har mahine ke orders) + Confirmed pipeline (confirmed, abhi dispatch
  // nahi — delivery mahine me) + Weighted pipeline (CAD/Approval/Quotation stage
  // × pichhle 6 mahine ka conversion) + Trend (3-mahine moving average, aage 3 mahine).
  async function forecast(ds) {
    const today = ds.today;
    const thisYm = today.slice(0, 7);
    const months = lastMonths(12, thisYm);
    const future = [1, 2, 3].map(n => addMonths(thisYm, n));
    const all = await loadDataset({});
    const cnt = {}; const val = {};
    all.orders.forEach(o => { const k = ym(o.submitted_on || o.created_at); cnt[k] = (cnt[k] || 0) + 1; val[k] = (val[k] || 0) + value(o); });
    const sixAgo = addMonths(thisYm, -6) + '-01';
    const quoted = all.orders.filter(o => o.quotation_posted_on && o.quotation_posted_on >= sixAgo);
    const conv = quoted.length ? quoted.filter(o => o.confirmed_on).length / quoted.length : 0;
    const confirmedPipe = {}; const weighted = {};
    all.orders.forEach(o => {
      if (TERMINAL.has(o.order_status)) return;
      const k = ym(o.delivery_date) || thisYm;
      const kk = k < thisYm ? thisYm : k;
      const dispatched = ['PAYMENT'].includes(o.current_stage);
      if (o.confirmed_on && !dispatched) confirmedPipe[kk] = (confirmedPipe[kk] || 0) + value(o);
      else if (['CAD', 'APPROVAL', 'CONFIRMATION'].includes(o.current_stage)) weighted[kk] = (weighted[kk] || 0) + value(o) * conv;
    });
    const series = months.map(k => val[k] || 0);
    const cseries = months.map(k => cnt[k] || 0);
    const last3 = series.slice(-3); const last3c = cseries.slice(-3);
    const trendVal = avg(last3) || 0; const trendCnt = avg(last3c) || 0;
    const labels = [...months, ...future].map(ymLabel);
    const rows = [...months, ...future].map((k, i) => ({
      month: ymLabel(k), actual_count: i < 12 ? (cnt[k] || 0) : null, actual_value: i < 12 ? round(val[k] || 0) : null,
      confirmed_pipeline: round(confirmedPipe[k] || 0), weighted_pipeline: round(weighted[k] || 0),
      trend_count: i >= 12 ? round(trendCnt, 1) : null, trend_value: i >= 12 ? round(trendVal) : null,
    }));
    const useValue = series.some(v => v > 0);
    return {
      columns: [C('month', 'Month'), C('actual_count', 'Orders', 'int'), C('actual_value', 'Order value', 'money'), C('confirmed_pipeline', 'Confirmed pipeline', 'money'),
        C('weighted_pipeline', 'Weighted pipeline', 'money'), C('trend_count', 'Trend orders', 'num1'), C('trend_value', 'Trend value', 'money')],
      rows,
      chart: { type: 'line', labels, datasets: useValue ? [
        { label: 'Actual value', data: rows.map(r => r.actual_value) },
        { label: 'Confirmed pipeline', data: rows.map(r => r.confirmed_pipeline || null) },
        { label: 'Weighted pipeline', data: rows.map(r => r.weighted_pipeline || null) },
        { label: 'Trend', data: rows.map((r, i) => (i >= 11 ? (i === 11 ? r.actual_value : r.trend_value) : null)), dashed: true }]
        : [{ label: 'Actual orders', data: rows.map(r => r.actual_count) },
          { label: 'Trend', data: rows.map((r, i) => (i >= 11 ? (i === 11 ? r.actual_count : r.trend_count) : null)), dashed: true }] },
      notes: `Assumptions: conversion rate (confirmed ÷ quoted, last 6 months) = ${round(conv * 100, 1)}% on ${quoted.length} quoted orders; `
        + `trend = 3-month moving average (${round(trendCnt, 1)} orders${useValue ? `, ₹${round(trendVal)}` : ''} per month). `
        + 'Value uses the quotation amount captured at confirmation — orders without it are counted as ₹0.',
      summary: { conversion_pct: round(conv * 100, 1), trend_count: round(trendCnt, 1), trend_value: round(trendVal) },
    };
  }

  // ── Routes ─────────────────────────────────────────
  function toCsv(rep) {
    const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [rep.columns.map(c => esc(c.label)).join(',')];
    rep.rows.forEach(r => lines.push(rep.columns.map(c => esc(r[c.key])).join(',')));
    return '﻿' + lines.join('\r\n');
  }
  app.get('/api/o2d/reports', requireAuth, (req, res) => {
    res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })));
  });
  app.get('/api/o2d/reports/:name', requireAuth, wrap(async (req, res) => {
    const def = REPORTS[req.params.name];
    if (!def) fail('Unknown report', 404);
    const ds = await loadDataset(req.query);
    const out = await def.run(ds, req.query);
    const rep = { key: req.params.name, title: def.title, ...out };
    if (req.query.format === 'csv' || req.query.format === 'xlsx') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}-${todayIST()}.csv"`);
      return res.send(toCsv(rep));
    }
    res.json(rep);
  }));

  // ── MD Dashboard (13.3) — ek hi aggregated payload ──
  app.get('/api/o2d/dashboard/summary', requireAuth, wrap(async (req, res) => {
    const today = todayIST();
    const from = isDate(req.query.from) ? req.query.from : today.slice(0, 7) + '-01';
    const to = isDate(req.query.to) ? req.query.to : today;
    const span = Math.max(1, diffDays(from, to) + 1);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const cust = int(req.query.customerId);
    const all = await loadDataset({ client_id: cust });
    const inRange = (o, a, b) => { const d = (o.submitted_on || o.created_at || '').slice(0, 10); return d >= a && d <= b; };
    const cur = all.orders.filter(o => inRange(o, from, to));
    const prev = all.orders.filter(o => inRange(o, prevFrom, prevTo));
    const open = all.orders.filter(o => !TERMINAL.has(o.order_status));
    const ageing = await ctx.o2dAgeing(db, { customerId: cust });
    const [fu] = await db.query(`SELECT COUNT(*) AS n FROM fms_followup_task WHERE status='Open' AND is_deleted=0 AND next_followup_date<?`, [today]);
    const pct = (a, b) => (b ? round((a - b) / b * 100, 1) : null);
    const kpis = {
      orders: { count: cur.length, value: round(cur.reduce((s, o) => s + value(o), 0)), prev_count: prev.length,
        pct_vs_prev: pct(cur.length, prev.length) },
      open_orders: open.length,
      overdue_vs_delivery: open.filter(o => o.m.overdue_delivery).length,
      at_risk: open.filter(o => o.m.at_risk && !o.m.overdue_delivery).length,
      ready_for_dispatch: open.filter(o => o.order_status === S.READY).length,
      on_hold: open.filter(o => o.order_status === S.HOLD).length,
      receivables: ageing.total.balance, receivables_overdue: ageing.total.overdue,
      overdue_followups: int(fu[0].n),
    };

    // Charts
    const byMonth = await REPORTS['orders-by-month'].run(all);
    const fc = await forecast(all);
    const pipeline = STAGES.map(st => ({ stage: STAGE_LABEL[st], key: st, count: open.filter(o => o.current_stage === st).length }));
    const bott = await REPORTS.bottleneck.run(all);
    const recvTop = ageing.clients.slice(0, 8);

    // Action tables
    const delayed = open.filter(o => o.m.overdue_delivery || o.m.delayed_at_stage)
      .map(o => ({ id: o.id, order_no: o.order_no, client: o.client_name, stage: STAGE_LABEL[o.current_stage] || o.order_status, owner: o.owner_name,
        days_delayed: Math.max(o.m.days_overdue_delivery, o.m.days_over_target), reason: o.m.overdue_delivery ? 'Past delivery date' : 'Over stage target' }))
      .sort((a, b) => b.days_delayed - a.days_delayed).slice(0, 10);
    const [vp] = await db.query(`SELECT v.vendor_name, i.issue_date, l.issued_pcs, l.received_pcs, l.issued_weight_gm
                                 FROM fms_vendor_issue_line l JOIN fms_vendor_issue i ON i.id=l.issue_id LEFT JOIN fms_vendors v ON v.id=i.vendor_id
                                 JOIN fms_orders o ON o.id=l.order_id
                                 WHERE l.is_deleted=0 AND l.received_pcs<l.issued_pcs ${cust ? 'AND o.client_id=?' : ''}`, cust ? [cust] : []);
    const vend = {};
    vp.forEach(r => {
      const x = vend[r.vendor_name || '—'] = vend[r.vendor_name || '—'] || { vendor: r.vendor_name || '—', pcs: 0, wt: 0, oldest: r.issue_date };
      const pend = int(r.issued_pcs) - int(r.received_pcs);
      x.pcs += pend; x.wt += int(r.issued_pcs) ? num(r.issued_weight_gm) * pend / int(r.issued_pcs) : 0;
      if (r.issue_date < x.oldest) x.oldest = r.issue_date;
    });
    const vendorPending = Object.values(vend).map(x => ({ vendor: x.vendor, pcs: x.pcs, wt: round(x.wt, 3), days_out: diffDays(x.oldest, today) }))
      .sort((a, b) => b.days_out - a.days_out);
    const holdCancel = [];
    all.orders.forEach(o => {
      (all.rel.log[o.id] || []).forEach(l => {
        const d = (l.changed_at || '').slice(0, 10);
        if ((l.to_status === S.HOLD || l.to_status === S.CANCELLED) && d >= from && d <= to) {
          holdCancel.push({ id: o.id, order_no: o.order_no, client: o.client_name, status: l.to_status, on: d, reason: l.remark });
        }
      });
    });
    const weekEnd = addDays(today, 7);
    const [due] = await db.query(`SELECT d.id, d.invoice_no, d.invoice_date, d.payment_due_date, d.balance, c.client_name,
                                         (SELECT order_id FROM fms_dispatch_line x WHERE x.dispatch_id=d.id AND x.is_deleted=0 ORDER BY x.id LIMIT 1) AS order_id
                                  FROM fms_dispatch d LEFT JOIN fms_customers c ON c.id=d.customer_id
                                  WHERE d.is_deleted=0 AND d.balance>0 AND d.payment_due_date<=? ${cust ? 'AND d.customer_id=?' : ''}
                                  ORDER BY d.payment_due_date`, cust ? [weekEnd, cust] : [weekEnd]);
    res.json({
      period: { from, to, prevFrom, prevTo }, kpis,
      charts: {
        ordersByMonth: { labels: byMonth.chart.labels, counts: byMonth.rows.map(r => r.count), forecast: fc.chart, forecastNotes: fc.notes },
        pipeline, bottleneck: bott.chart, bottleneckRows: bott.rows, bottleneckNotes: bott.notes,
        receivables: { labels: recvTop.map(r => r.client_name), Gold: recvTop.map(r => r.Gold), Diamond: recvTop.map(r => r.Diamond),
          Labour: recvTop.map(r => r.Labour), Other: recvTop.map(r => r.Other), Unsplit: recvTop.map(r => r.Unsplit) },
      },
      tables: {
        delayed, vendorPending, holdCancel: holdCancel.sort((a, b) => b.on.localeCompare(a.on)).slice(0, 20),
        paymentsDue: due.map(d => ({ ...d, overdue: d.payment_due_date < today, days: diffDays(today, d.payment_due_date) })),
      },
    });
  }));
};
