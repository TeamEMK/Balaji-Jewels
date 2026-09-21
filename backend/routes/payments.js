// ══════════════════════════════════════════════════════
// PAYMENT COLLECTION & CLIENT LEDGER
// ══════════════════════════════════════════════════════
// Data flow: Billing -> Dispatch -> FMS. Client wahi 'client' role wale users
// hain (jo Catalog dekhne ke liye login karte hain) — koi alag 'Clients' list
// nahi banayi, existing role reuse kiya.
//
// Gold aur diamond ka payment ALAG-ALAG track hota hai — har bill me dono
// components hain, har client ke apne payment terms hain (jaise gold 10-15
// din, diamond 45-60 din) — isliye ek hi bill ka gold portion "due" ho sakta
// hai jabki diamond portion abhi "not due" ho.
//
// Sirf admin dekh/badal sakta hai — financial data hai.

const { getSheetsClient, extractSpreadsheetId } = require('../lib/google');
const { parsePlanCellDate } = require('../lib/sheet-cols');

module.exports = function registerPaymentsRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  // Ek bill + uske terms se gold/diamond pending, due-date, overdue-days
  // nikalta hai — GET /api/payments/bills, /ledger, /aging, /customers sab
  // isi ek jagah se hisaab lete hain, taaki numbers hamesha match karein.
  function billStatus(bill, terms, todayISO) {
    const goldDays = terms && terms.gold_days != null ? terms.gold_days : 0;
    const diamondDays = terms && terms.diamond_days != null ? terms.diamond_days : 0;
    const addDays = (dateStr, days) => {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + (parseInt(days, 10) || 0));
      return d.toISOString().split('T')[0];
    };
    const goldDueDate = addDays(bill.bill_date, goldDays);
    const diamondDueDate = addDays(bill.bill_date, diamondDays);
    const goldPending = Math.round((parseFloat(bill.gold_amount) - parseFloat(bill.gold_paid)) * 100) / 100;
    const diamondPending = Math.round((parseFloat(bill.diamond_amount) - parseFloat(bill.diamond_paid)) * 100) / 100;
    const daysBetween = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
    return {
      goldDueDate, diamondDueDate, goldPending, diamondPending,
      goldOverdueDays: goldPending > 0 ? Math.max(0, daysBetween(todayISO, goldDueDate)) : 0,
      diamondOverdueDays: diamondPending > 0 ? Math.max(0, daysBetween(todayISO, diamondDueDate)) : 0,
      goldIsDue: goldPending > 0 && goldDueDate <= todayISO,
      diamondIsDue: diamondPending > 0 && diamondDueDate <= todayISO,
      hasTerms: !!terms,
    };
  }

  async function getTermsMap() {
    const [rows] = await db.query('SELECT user_id, gold_days, diamond_days FROM client_payment_terms');
    const map = {};
    rows.forEach(r => { map[r.user_id] = r; });
    return map;
  }

  // ── Clients — 'client' role users, apne payment terms ke saath ──
  app.get('/api/payments/clients', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [users] = await db.query(
        `SELECT u.id, u.name, u.email, t.gold_days, t.diamond_days
         FROM users u LEFT JOIN client_payment_terms t ON t.user_id = u.id
         WHERE u.role='client' ORDER BY u.name ASC`);
      res.json(users);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/payments/clients/:userId/terms', requireAuth, requireAdmin, async (req, res) => {
    try {
      const goldDays = req.body.goldDays === '' || req.body.goldDays == null ? null : parseInt(req.body.goldDays, 10);
      const diamondDays = req.body.diamondDays === '' || req.body.diamondDays == null ? null : parseInt(req.body.diamondDays, 10);
      await db.query(
        `INSERT INTO client_payment_terms (user_id,gold_days,diamond_days) VALUES (?,?,?)
         ON CONFLICT (user_id) DO UPDATE SET gold_days = EXCLUDED.gold_days, diamond_days = EXCLUDED.diamond_days, updated_at = NOW()`,
        [req.params.userId, goldDays, diamondDays]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Bill — manual entry ──
  app.post('/api/payments/bills', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { clientUserId, billNo, billDate, goldAmount, diamondAmount } = req.body;
      if (!clientUserId || !billDate) return res.status(400).json({ error: 'Client and bill date required' });
      const gold = parseFloat(goldAmount) || 0, diamond = parseFloat(diamondAmount) || 0;
      if (gold <= 0 && diamond <= 0) return res.status(400).json({ error: 'Enter at least gold or diamond amount' });
      await db.query(
        `INSERT INTO client_bills (client_user_id,bill_no,bill_date,gold_amount,diamond_amount,source,created_by) VALUES (?,?,?,?,?,'manual',?)`,
        [clientUserId, (billNo || '').trim(), billDate, gold, diamond, req.session.userId]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Bill — FMS se sync. Best-effort: har FMS sheet ke headers me Client
  // Name + Gold/Diamond amount + Bill date jaise naam wale columns dhoondta
  // hai (kisi bhi spacing/case ke saath). Sheet me ye columns na hon to us
  // sheet ko chhod deta hai (error nahi) — sabhi FMS sheets billing ke liye
  // nahi bani hoti. fms_ref se dobara sync par duplicate nahi bante. ──
  app.post('/api/payments/bills/sync-fms', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [sheets] = await db.query('SELECT * FROM fms_sheets ORDER BY fms_name ASC');
      const [clientUsers] = await db.query(`SELECT id, name FROM users WHERE role='client'`);
      const clientByName = {};
      clientUsers.forEach(c => { clientByName[c.name.trim().toLowerCase()] = c.id; });

      let imported = 0, skippedSheets = [], skippedNoClient = 0;
      if (sheets.length) {
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        for (const sheet of sheets) {
          try {
            const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
            const tabName = sheet.sheet_name || 'Sheet1';
            const headerRowIdx = (sheet.header_row || 1) - 1;
            const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
            const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
            const data = response.data.values || [];
            const headers = data[headerRowIdx] || [];
            const find = (re) => headers.findIndex(h => re.test((h || '').toString()));
            const iClient = find(/client\s*name/i);
            const iGold = find(/gold.*(amount|value|amt)|(amount|value).*gold/i);
            const iDiamond = find(/diamond.*(amount|value|amt)|(amount|value).*diamond/i);
            const iDate = find(/bill.*date|invoice.*date/i);
            const iBillNo = find(/bill\s*no|invoice\s*no/i);
            if (iClient < 0 || iDate < 0 || (iGold < 0 && iDiamond < 0)) { skippedSheets.push(sheet.fms_name || sheet.sheet_name); continue; }

            for (let i = headerRowIdx + 1; i < data.length; i++) {
              const row = data[i];
              const clientName = (row[iClient] || '').toString().trim();
              if (!clientName) continue;
              const clientId = clientByName[clientName.toLowerCase()];
              if (!clientId) { skippedNoClient++; continue; }
              const billDateRaw = (row[iDate] || '').toString().trim();
              if (!billDateRaw) continue;
              const { planDate } = parsePlanCellDate(billDateRaw);
              if (!planDate) continue;
              const gold = iGold >= 0 ? parseFloat((row[iGold] || '0').toString().replace(/[^0-9.-]/g, '')) || 0 : 0;
              const diamond = iDiamond >= 0 ? parseFloat((row[iDiamond] || '0').toString().replace(/[^0-9.-]/g, '')) || 0 : 0;
              if (gold <= 0 && diamond <= 0) continue;
              const fmsRef = `${sheet.id}:${tabName}:${i + 1}`;
              const billNo = iBillNo >= 0 ? (row[iBillNo] || '').toString().trim() : '';
              const [result] = await db.query(
                `INSERT INTO client_bills (client_user_id,bill_no,bill_date,gold_amount,diamond_amount,source,fms_ref,created_by)
                 VALUES (?,?,?,?,?,'fms',?,?) ON CONFLICT (fms_ref) DO NOTHING`,
                [clientId, billNo, planDate, gold, diamond, fmsRef, req.session.userId]);
              if (result.affectedRows) imported++;
            }
          } catch (e) { skippedSheets.push(sheet.fms_name || sheet.sheet_name); }
        }
      }
      res.json({ imported, skippedSheets, skippedNoClient });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Payment record karo — ek bill ke against, gold/diamond alag-alag ──
  app.post('/api/payments/bills/:id/payment', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { paymentDate, goldAmount, diamondAmount, note } = req.body;
      const gold = parseFloat(goldAmount) || 0, diamond = parseFloat(diamondAmount) || 0;
      if (!paymentDate) return res.status(400).json({ error: 'Payment date required' });
      if (gold <= 0 && diamond <= 0) return res.status(400).json({ error: 'Enter at least gold or diamond payment amount' });
      const [bills] = await db.query('SELECT * FROM client_bills WHERE id=?', [req.params.id]);
      if (!bills[0]) return res.status(404).json({ error: 'Bill not found' });
      await db.query('INSERT INTO client_payments (bill_id,payment_date,gold_amount,diamond_amount,note,created_by) VALUES (?,?,?,?,?,?)',
        [req.params.id, paymentDate, gold, diamond, (note || '').trim(), req.session.userId]);
      await db.query('UPDATE client_bills SET gold_paid = gold_paid + ?, diamond_paid = diamond_paid + ? WHERE id=?',
        [gold, diamond, req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── a) Overall Billing Sheet — total bills, gold/diamond split, terms reference ──
  app.get('/api/payments/overview', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { start, end } = req.query;
      const params = []; let where = '';
      if (start && end) { where = 'WHERE bill_date BETWEEN ? AND ?'; params.push(start, end); }
      const [[totals]] = await db.query(
        `SELECT COUNT(*) AS bill_count, COALESCE(SUM(gold_amount),0) AS gold_total, COALESCE(SUM(diamond_amount),0) AS diamond_total,
                COALESCE(SUM(gold_paid),0) AS gold_paid_total, COALESCE(SUM(diamond_paid),0) AS diamond_paid_total
         FROM client_bills ${where}`, params);
      const [clients] = await db.query(
        `SELECT u.id, u.name, t.gold_days, t.diamond_days FROM users u LEFT JOIN client_payment_terms t ON t.user_id=u.id WHERE u.role='client' ORDER BY u.name ASC`);
      res.json({
        billCount: parseInt(totals.bill_count) || 0,
        goldTotal: parseFloat(totals.gold_total) || 0,
        diamondTotal: parseFloat(totals.diamond_total) || 0,
        goldPaidTotal: parseFloat(totals.gold_paid_total) || 0,
        diamondPaidTotal: parseFloat(totals.diamond_paid_total) || 0,
        clients,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── b) Client-wise Ledger + d) Customer Summary drill-down — ek client
  // (ya sabke) bills, due/not-due split, gold/diamond alag-alag ──
  app.get('/api/payments/bills', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { clientId, start, end } = req.query;
      const today = _istPartsSafe();
      let where = [], params = [];
      if (clientId) { where.push('client_user_id=?'); params.push(clientId); }
      if (start && end) { where.push('bill_date BETWEEN ? AND ?'); params.push(start, end); }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const [bills] = await db.query(
        `SELECT b.*, u.name AS client_name, TO_CHAR(b.bill_date,'YYYY-MM-DD') AS bill_date_iso
         FROM client_bills b JOIN users u ON b.client_user_id=u.id ${whereSql} ORDER BY b.bill_date DESC`, params);
      const termsMap = await getTermsMap();
      const rows = bills.map(b => {
        const terms = termsMap[b.client_user_id];
        const st = billStatus({ ...b, bill_date: b.bill_date_iso }, terms, today);
        return {
          id: b.id, clientId: b.client_user_id, clientName: b.client_name, billNo: b.bill_no,
          billDate: b.bill_date_iso, goldAmount: parseFloat(b.gold_amount), diamondAmount: parseFloat(b.diamond_amount),
          goldPaid: parseFloat(b.gold_paid), diamondPaid: parseFloat(b.diamond_paid), source: b.source, ...st,
        };
      });
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── c) Aging Summary — gold aur diamond pending, alag-alag bucket me ──
  app.get('/api/payments/aging', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { start, end } = req.query;
      const today = _istPartsSafe();
      let where = [], params = [];
      if (start && end) { where.push('bill_date BETWEEN ? AND ?'); params.push(start, end); }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const [bills] = await db.query(`SELECT * , TO_CHAR(bill_date,'YYYY-MM-DD') AS bill_date_iso FROM client_bills ${whereSql}`, params);
      const termsMap = await getTermsMap();

      const bucketOf = (days) => days <= 30 ? '0-30' : days <= 60 ? '30-60' : days <= 90 ? '60-90' : days <= 120 ? '90-120' : '120+';
      const buckets = ['0-30', '30-60', '60-90', '90-120', '120+'];
      const gold = Object.fromEntries(buckets.map(b => [b, 0]));
      const diamond = Object.fromEntries(buckets.map(b => [b, 0]));

      for (const b of bills) {
        const st = billStatus({ ...b, bill_date: b.bill_date_iso }, termsMap[b.client_user_id], today);
        if (st.goldIsDue) gold[bucketOf(st.goldOverdueDays)] += st.goldPending;
        if (st.diamondIsDue) diamond[bucketOf(st.diamondOverdueDays)] += st.diamondPending;
      }
      const round2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
      res.json({ buckets, gold: round2(gold), diamond: round2(diamond) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── d) Customer Summary View — per client total due + balance ──
  app.get('/api/payments/customers', requireAuth, requireAdmin, async (req, res) => {
    try {
      const today = _istPartsSafe();
      const [clients] = await db.query(`SELECT id, name, email FROM users WHERE role='client' ORDER BY name ASC`);
      const [bills] = await db.query(`SELECT *, TO_CHAR(bill_date,'YYYY-MM-DD') AS bill_date_iso FROM client_bills`);
      const termsMap = await getTermsMap();
      const byClient = {};
      clients.forEach(c => { byClient[c.id] = { clientId: c.id, name: c.name, email: c.email, billCount: 0, goldTotal: 0, diamondTotal: 0, goldPending: 0, diamondPending: 0, goldOverdue: 0, diamondOverdue: 0 }; });
      for (const b of bills) {
        const agg = byClient[b.client_user_id];
        if (!agg) continue;
        const st = billStatus({ ...b, bill_date: b.bill_date_iso }, termsMap[b.client_user_id], today);
        agg.billCount++;
        agg.goldTotal += parseFloat(b.gold_amount);
        agg.diamondTotal += parseFloat(b.diamond_amount);
        agg.goldPending += st.goldPending;
        agg.diamondPending += st.diamondPending;
        if (st.goldIsDue) agg.goldOverdue += st.goldPending;
        if (st.diamondIsDue) agg.diamondOverdue += st.diamondPending;
      }
      const rows = Object.values(byClient).map(a => ({
        ...a,
        goldTotal: Math.round(a.goldTotal * 100) / 100, diamondTotal: Math.round(a.diamondTotal * 100) / 100,
        goldPending: Math.round(a.goldPending * 100) / 100, diamondPending: Math.round(a.diamondPending * 100) / 100,
        goldOverdue: Math.round(a.goldOverdue * 100) / 100, diamondOverdue: Math.round(a.diamondOverdue * 100) / 100,
        totalDue: Math.round((a.goldPending + a.diamondPending) * 100) / 100,
        totalBalance: Math.round(((a.goldTotal - a.goldPending) + (a.diamondTotal - a.diamondPending)) * 100) / 100,
      }));
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // IST 'aaj' — dates.js wale format me, koi extra dependency chahiye taaki
  // is file ko standalone bhi samjha ja sake.
  function _istPartsSafe() {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
      const p = {}; for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
      return `${p.year}-${p.month}-${p.day}`;
    } catch (e) { return new Date().toISOString().split('T')[0]; }
  }

};
