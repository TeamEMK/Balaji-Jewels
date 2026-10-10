// ══════════════════════════════════════════════════════
// ORDER-TO-DISPATCH FMS — shared core (Spec v1.0)
// ──────────────────────────────────────────────────────
// Yahan teen cheezein rehti hain jo har stage use karta hai:
//   1. Status machine  — setStatus(): order_status + current_stage badalta hai
//      aur HAR badlav fms_order_status_log me likhta hai. Koi route seedha
//      order_status UPDATE nahi karta (spec 15.1).
//   2. Follow-up engine — openTask()/closeTasks(): ek cheez ke liye ek hi open
//      task; closing outcomes stage transition chalate hain (routes me).
//   3. Running numbers  — nextNo(): ORD-2610-0001 jaise document numbers.
//
// Saare datetime IST 'YYYY-MM-DD HH:MM:SS' string hain (migration 015 dekho).
// ══════════════════════════════════════════════════════

// ── Dates (IST) ──────────────────────────────────────
function istNowParts() {
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
}
function todayIST() { const p = istNowParts(); return `${p.year}-${p.month}-${p.day}`; }
function nowIST() { const p = istNowParts(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function addDays(dateStr, n) {
  const d = new Date((dateStr || todayIST()).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (parseInt(n, 10) || 0));
  return d.toISOString().slice(0, 10);
}
// b - a in whole days (dono 'YYYY-MM-DD...' strings)
function diffDays(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
  const dbb = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(da) || isNaN(dbb)) return null;
  return Math.round((dbb - da) / 86400000);
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function int(v) { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
function str(v, max = 2000) { return v === undefined || v === null ? null : String(v).trim().slice(0, max) || null; }
function dateOrNull(v) { return isDate(v) ? v : null; }

// ── Constants ────────────────────────────────────────
const STAGES = ['ORDER', 'CAD', 'APPROVAL', 'CONFIRMATION', 'ORDER_SHEET', 'BAGGING',
  'VENDOR', 'HALLMARK', 'LAB', 'DISPATCH', 'PAYMENT'];

const S = {
  DRAFT: 'Draft', OPEN: 'Open',
  CAD_IN_PROGRESS: 'CAD In Progress', CAD_RECEIVED: 'CAD Received', CAD_SENT: 'CAD Sent for Approval',
  CAD_APPROVED: 'CAD Approved', CAD_REJECTED: 'CAD Rejected',
  QUOTATION_SENT: 'Quotation Sent', CONFIRMED: 'Confirmed', HOLD: 'Hold', CANCELLED: 'Cancelled',
  BAGGING: 'Bagging In Progress', SHORTFALL: 'Shortfall - Awaiting Vendor', BAGGING_DONE: 'Bagging Done',
  ISSUED: 'Issued to Vendor', PART_RECEIVED: 'Partially Received', RECEIVED: 'Received from Vendor',
  HALLMARK_PENDING: 'Hallmarking Pending', HALLMARK_DONE: 'Hallmarking Done',
  CERT_PENDING: 'Certification Pending', CERTIFIED: 'Certified',
  READY: 'Ready for Dispatch', DISPATCHED: 'Dispatched',
  PAYMENT_PENDING: 'Payment Pending', PART_PAID: 'Partially Paid', PAID: 'Paid', CLOSED: 'Closed',
};
const TERMINAL = new Set([S.CANCELLED, S.CLOSED]);

// Follow-up types → kis stage ka default doer
const TASK_STAGE = {
  CAD_VENDOR: 'CAD', CAD_CLIENT_APPROVAL: 'APPROVAL', ORDER_CONFIRMATION: 'CONFIRMATION',
  REQUIREMENT_VENDOR: 'BAGGING', VENDOR_FG: 'VENDOR', HALLMARK: 'HALLMARK', LAB: 'LAB', PAYMENT: 'PAYMENT',
};
// Closing outcomes — ye log hote hi stage transition chalta hai (routes/o2d-*.js).
// Baaki types (requirement/vendor/hallmark/lab/payment) asli receipt record
// karne par khud band hote hain, follow-up se nahi.
const CLOSING_OUTCOMES = {
  CAD_VENDOR: ['CAD Received'],
  CAD_CLIENT_APPROVAL: ['Approved', 'Rejected', 'Hold', 'Cancelled'],
  ORDER_CONFIRMATION: ['Confirmed', 'Hold', 'Cancelled'],
};
const TYPE_OUTCOMES = {
  CAD_VENDOR: ['CAD Received', 'Delay - New Date Given'],
  CAD_CLIENT_APPROVAL: ['Approved', 'Rejected', 'Hold', 'Cancelled'],
  ORDER_CONFIRMATION: ['Confirmed', 'Hold', 'Cancelled'],
  REQUIREMENT_VENDOR: ['Material Dispatched', 'Delay - New Date Given'],
  VENDOR_FG: ['Partially Ready', 'Delay - New Date Given'],
  HALLMARK: ['In Process', 'Delay - New Date Given'],
  LAB: ['In Process', 'Delay - New Date Given'],
  PAYMENT: ['Promised on Date', 'Partial', 'Disputed'],
};

// ── Running numbers ──────────────────────────────────
// fms_sequence (doc_type, yymm) per mahina counter. UPDATE pehle — row na ho to
// INSERT; do log ek saath pehla number lene aayen to unique key ek ko rok degi
// aur wo dobara UPDATE kar lega.
async function nextSeq(q, docType, period) {
  const [u] = await q.query('UPDATE fms_sequence SET last_no = last_no + 1 WHERE doc_type=? AND yymm=?', [docType, period]);
  if (!u.affectedRows) {
    try {
      await q.query('INSERT INTO fms_sequence (doc_type, yymm, last_no) VALUES (?,?,1)', [docType, period]);
    } catch (e) {
      await q.query('UPDATE fms_sequence SET last_no = last_no + 1 WHERE doc_type=? AND yymm=?', [docType, period]);
    }
  }
  const [r] = await q.query('SELECT last_no FROM fms_sequence WHERE doc_type=? AND yymm=?', [docType, period]);
  return int(r[0] && r[0].last_no);
}
// ORD/REQ/ISS/RCV/DSP/PAY-YYMM-####
async function nextNo(q, prefix) {
  const t = todayIST();
  const yymm = t.slice(2, 4) + t.slice(5, 7);
  const n = await nextSeq(q, prefix, yymm);
  return `${prefix}-${yymm}-${String(n).padStart(4, '0')}`;
}
// Unique ID: BJ-2026-000123 (saal bhar chalta counter)
async function nextUniqueId(q) {
  const year = todayIST().slice(0, 4);
  const n = await nextSeq(q, 'UID', year);
  return `BJ-${year}-${String(n).padStart(6, '0')}`;
}

// ── Transactions ─────────────────────────────────────
async function withTx(db, fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

// Route ke andar validation error — 400 ke saath user ko dikhta hai.
class O2DError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
function fail(msg, status) { throw new O2DError(msg, status); }

// ── Status machine ───────────────────────────────────
// toStatus null ho to sirf stage badlega. extra = order par saath me likhne
// wale aur columns (cad_status, confirmed_on, ...).
async function setStatus(q, orderId, toStatus, { userId, remark, stage, extra } = {}) {
  const [rows] = await q.query('SELECT order_status, current_stage FROM fms_orders WHERE id=?', [orderId]);
  if (!rows[0]) fail('Order not found', 404);
  const cur = rows[0];
  const now = nowIST();
  const sets = ['updated_at=?', 'updated_by=?'];
  const params = [now, userId || null];
  const newStatus = toStatus || cur.order_status;
  const newStage = stage === undefined ? cur.current_stage : stage;
  if (toStatus) { sets.push('order_status=?'); params.push(toStatus); }
  if (stage !== undefined && stage !== cur.current_stage) {
    sets.push('current_stage=?', 'stage_entered_at=?'); params.push(stage, now);
  }
  if (newStatus === S.CLOSED) { sets.push('closed_on=?'); params.push(now); }
  for (const [k, v] of Object.entries(extra || {})) { sets.push(`${k}=?`); params.push(v); }
  params.push(orderId);
  await q.query(`UPDATE fms_orders SET ${sets.join(', ')} WHERE id=?`, params);
  if (newStatus !== cur.order_status || newStage !== cur.current_stage) {
    await q.query(
      `INSERT INTO fms_order_status_log (order_id, from_status, to_status, from_stage, to_stage, changed_by, changed_at, remark)
       VALUES (?,?,?,?,?,?,?,?)`,
      [orderId, cur.order_status, newStatus, cur.current_stage, newStage, userId || null, now, remark || null]);
  }
}

async function logChange(q, orderId, field, oldV, newV, reason, userId) {
  await q.query(
    `INSERT INTO fms_order_change_log (order_id, field_name, old_value, new_value, reason, changed_by, changed_at)
     VALUES (?,?,?,?,?,?,?)`,
    [orderId, field, oldV == null ? null : String(oldV), newV == null ? null : String(newV), reason || null, userId || null, nowIST()]);
}

// ── Stage targets / default doers ────────────────────
async function stageConfig(q) {
  const [rows] = await q.query('SELECT stage_key, stage_name, target_days, default_assignee_id, sort_order FROM fms_stage_target WHERE is_deleted=0 ORDER BY sort_order');
  const map = {};
  rows.forEach(r => { map[r.stage_key] = r; });
  return { list: rows, map };
}

// ── Follow-up engine ─────────────────────────────────
// Ek ref (cad/requirement/issue line/dispatch...) ke liye ek hi open task.
async function openTask(q, t, userId) {
  const [ex] = await q.query(
    "SELECT id FROM fms_followup_task WHERE task_type=? AND ref_table=? AND ref_id=? AND status='Open' AND is_deleted=0",
    [t.task_type, t.ref_table, t.ref_id]);
  const now = nowIST();
  if (ex[0]) {
    if (t.next_followup_date) {
      await q.query('UPDATE fms_followup_task SET next_followup_date=?, updated_at=?, updated_by=? WHERE id=?',
        [t.next_followup_date, now, userId || null, ex[0].id]);
    }
    return ex[0].id;
  }
  let assignee = t.assigned_to || null;
  if (!assignee) {
    const cfg = await stageConfig(q);
    const st = cfg.map[TASK_STAGE[t.task_type]];
    assignee = (st && st.default_assignee_id) || userId || null;
  }
  const [r] = await q.query(
    `INSERT INTO fms_followup_task (task_type, order_id, ref_table, ref_id, party_type, party_id, assigned_to, title,
       opened_on, next_followup_date, followup_count, status, created_at, created_by, is_deleted)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,'Open',?,?,0)`,
    [t.task_type, t.order_id || null, t.ref_table || null, t.ref_id || null, t.party_type || null, t.party_id || null,
      assignee, (t.title || '').slice(0, 255), now, t.next_followup_date || todayIST(), now, userId || null]);
  return r.insertId;
}

// where: { order_id, task_type, ref_table, ref_id } — jo diya utna match
async function closeTasks(q, where, reason, userId) {
  const conds = ["status='Open'", 'is_deleted=0'];
  const params = [];
  for (const k of ['order_id', 'task_type', 'ref_table', 'ref_id']) {
    if (where[k] !== undefined && where[k] !== null) { conds.push(`${k}=?`); params.push(where[k]); }
  }
  const now = nowIST();
  await q.query(`UPDATE fms_followup_task SET status='Closed', closed_on=?, closed_reason=?, updated_at=?, updated_by=? WHERE ${conds.join(' AND ')}`,
    [now, reason || null, now, userId || null, ...params]);
}

// ── Order helpers ────────────────────────────────────
function effectiveQty(o) { return int(o.qty_pcs) + int(o.additional_reduction_pcs); }

async function getOrder(q, id) {
  const [rows] = await q.query('SELECT * FROM fms_orders WHERE id=? AND is_deleted=0', [id]);
  if (!rows[0]) fail('Order not found', 404);
  return rows[0];
}

async function cancelOrder(q, orderId, reason, userId) {
  if (!reason) fail('Cancel reason is required');
  const o = await getOrder(q, orderId);
  if (TERMINAL.has(o.order_status)) fail(`Order is already ${o.order_status}`);
  await setStatus(q, orderId, S.CANCELLED, {
    userId, remark: reason, stage: null,
    extra: { cancel_reason: reason, confirmation_status: o.confirmation_status === 'Pending' ? 'Cancelled' : o.confirmation_status },
  });
  await closeTasks(q, { order_id: orderId }, 'Order cancelled', userId);
}

// Vendor se poora maal aane ke baad (ya hallmark ho jaane ke baad) agla kadam:
// Hallmark pending → Certification pending → Ready for Dispatch.
async function advanceAfterQuality(q, orderId, userId) {
  const o = await getOrder(q, orderId);
  if (o.hallmark_status !== 'Done') {
    if (o.order_status !== S.HALLMARK_PENDING) {
      await setStatus(q, orderId, S.HALLMARK_PENDING, { userId, stage: 'HALLMARK', extra: { hallmark_status: 'Pending' } });
    }
    return;
  }
  if (int(o.certificate_required) === 1 && o.cert_status !== 'Certified') {
    if (o.order_status !== S.CERT_PENDING) {
      await setStatus(q, orderId, S.CERT_PENDING, { userId, stage: 'LAB', extra: { cert_status: o.cert_status || 'Pending' } });
    }
    return;
  }
  if (o.order_status !== S.READY) {
    await setStatus(q, orderId, S.READY, { userId, stage: 'DISPATCH' });
  }
}

// ── Route & delay metrics (spec 2.1 + 13.5) ──────────
// Order kis-kis stage se guzrega — routing rules ke hisaab se.
function orderPath(o) {
  const nd = o.development_type === 'New Development';
  const cust = o.order_type === 'Customer Order';
  const p = ['ORDER'];
  if (nd) p.push('CAD', 'APPROVAL');
  if (cust) p.push('CONFIRMATION');
  p.push('ORDER_SHEET', 'BAGGING', 'VENDOR', 'HALLMARK');
  if (int(o.certificate_required) === 1) p.push('LAB');
  p.push('DISPATCH');
  if (cust) p.push('PAYMENT');
  return p;
}

// cfgMap = stageConfig().map. Har order ke saath list/detail/reports me jaata hai.
function orderMetrics(o, cfgMap, today) {
  today = today || todayIST();
  const stage = o.current_stage || null;
  const active = !TERMINAL.has(o.order_status) && o.order_status !== S.DRAFT;
  const target = stage && cfgMap[stage] ? int(cfgMap[stage].target_days) : null;
  const daysInStage = o.stage_entered_at ? diffDays(o.stage_entered_at, today) : null;
  const onHold = o.order_status === S.HOLD;
  const delayedAtStage = !!(active && !onHold && stage && stage !== 'PAYMENT' && target > 0 && daysInStage > target);
  const preDispatch = !!(active && stage && STAGES.indexOf(stage) < STAGES.indexOf('PAYMENT'));
  const overdueDelivery = !!(preDispatch && o.delivery_date && o.delivery_date < today);
  let projected = null;
  let atRisk = false;
  if (preDispatch && !onHold) {
    const path = orderPath(o);
    let idx = path.indexOf(stage);
    if (idx < 0) idx = 0;
    const curEnd = addDays((o.stage_entered_at || today).slice(0, 10), target || 0);
    let d = curEnd > today ? curEnd : today;
    for (const st of path.slice(idx + 1)) {
      if (st === 'PAYMENT') break;
      d = addDays(d, cfgMap[st] ? int(cfgMap[st].target_days) : 0);
    }
    projected = d;
    atRisk = !!o.delivery_date && projected > o.delivery_date;
  }
  return {
    effective_qty: effectiveQty(o),
    days_in_stage: daysInStage,
    stage_target: target,
    delayed_at_stage: delayedAtStage,
    days_over_target: delayedAtStage ? daysInStage - target : 0,
    overdue_delivery: overdueDelivery,
    days_overdue_delivery: overdueDelivery ? diffDays(o.delivery_date, today) : 0,
    days_to_delivery: o.delivery_date ? diffDays(today, o.delivery_date) : null,
    projected_completion: projected,
    at_risk: atRisk,
  };
}

module.exports = {
  orderPath, orderMetrics,
  todayIST, nowIST, addDays, diffDays, isDate, num, int, str, dateOrNull,
  STAGES, S, TERMINAL, TASK_STAGE, CLOSING_OUTCOMES, TYPE_OUTCOMES,
  nextNo, nextUniqueId, withTx, O2DError, fail,
  setStatus, logChange, stageConfig, openTask, closeTasks,
  effectiveQty, getOrder, cancelOrder, advanceAfterQuality,
};
