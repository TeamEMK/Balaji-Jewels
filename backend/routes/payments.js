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

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getSheetsClient, extractSpreadsheetId } = require('../lib/google');
const { parsePlanCellDate } = require('../lib/sheet-cols');

// Client naam ka farak — 2 dialects ke saath consistent honi chahiye (preview
// aur confirm dono ek hi key use karte hain, warna mapping match hi nahi hogi).
// _normName: sirf whitespace ka farak nazarandaz karta hai ("Shreeji Jewels"
// == "SHREEJI  JEWELS") — dedup ke liye. _fuzzyKey: punctuation bhi hata deta
// hai ("Shreeji Jewels." == "SHREEJI JEWELS") — sirf guess-matching ke liye,
// dedup ke liye NAHI (do alag naam galti se ek na ban jaayein).
const _normName = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
const _fuzzyKey = s => _normName(s).replace(/[^a-z0-9]+/g, '');

// FMS cell se paisa nikaalta hai — "₹1,25,000.00" jaisa comma/currency-symbol
// wala number theek se padhta hai, LEKIN agar cell me koi extra cheez ho
// (jaise "159953+4659" ek adhoora formula, ya "#VALUE!" ek sheet error) to
// use 0 maan kar chup nahi jaata — invalid flag karta hai. Warna comma/symbol
// hatane wali purani approach "+" bhi hata deti thi aur do numbers aapas me
// jud kar ek bahut bada (galat) number ban jaata tha — yehi asli bug tha.
function _parseMoney(raw) {
  let s = (raw || '').toString().trim();
  if (!s) return { value: 0, invalid: false }; // khaali cell — 0, koi error nahi
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').trim();
  if (!/^-?[\d,]+(\.\d+)?$/.test(s)) return { value: 0, invalid: true };
  const value = parseFloat(s.replace(/,/g, ''));
  return isNaN(value) ? { value: 0, invalid: true } : { value, invalid: false };
}

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

  // ── Bill — FMS se PREVIEW (Confirm screen ke liye, kuch save nahi karta).
  // Best-effort: har FMS sheet ke headers me Client Name + Gold/Diamond
  // amount + Bill date jaise naam wale columns dhoondta hai (kisi bhi
  // spacing/case ke saath). Sheet me ye columns na hon to us sheet ko chhod
  // deta hai (error nahi) — sabhi FMS sheets billing ke liye nahi bani hoti.
  //
  // Client name 'role=client' users se EXACT match hona chahiye — real FMS
  // sheets me business client names (jaise "NEMICHAND") hote hain jinke liye
  // login account ho hi na, isliye seedha save karne ki jagah pehle ek
  // Confirm screen dikhate hain: admin har unmatched naam ko existing client
  // se map kare, naya bana le, ya skip kare. ──
  app.post('/api/payments/bills/preview-fms', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [sheets] = await db.query('SELECT * FROM fms_sheets ORDER BY fms_name ASC');
      const [clientUsers] = await db.query(`SELECT id, name FROM users WHERE role='client' ORDER BY name ASC`);
      const clientByName = {};
      const fuzzyGroups = {};
      clientUsers.forEach(c => {
        clientByName[_normName(c.name)] = c;
        const fk = _fuzzyKey(c.name);
        if (fk) (fuzzyGroups[fk] = fuzzyGroups[fk] || []).push(c);
      });
      // Punctuation/spacing farak nazarandaz karke guess ("Shreeji Jewels."
      // == "SHREEJI  JEWELS") — sirf tab jab fuzzy key par EK hi client ho,
      // 2 alag clients clash karein to guess mat karo (ambiguous).
      const clientByFuzzy = {};
      Object.entries(fuzzyGroups).forEach(([fk, arr]) => { if (arr.length === 1) clientByFuzzy[fk] = arr[0]; });

      const rows = []; // {clientName, billNo, billDate, gold, diamond, fmsRef}
      const skippedSheets = [];
      const invalidRows = []; // {sheet, row, clientName, goldRaw, diamondRaw} — number jaisa nahi lagta, guess nahi karte
      if (sheets.length) {
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        for (const sheet of sheets) {
          try {
            const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
            const tabName = sheet.sheet_name || 'Sheet1';
            const fmsName = sheet.fms_name || sheet.sheet_name;
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
            if (iClient < 0 || iDate < 0 || (iGold < 0 && iDiamond < 0)) { skippedSheets.push(fmsName); continue; }

            for (let i = headerRowIdx + 1; i < data.length; i++) {
              const row = data[i];
              const clientName = (row[iClient] || '').toString().trim();
              if (!clientName) continue;
              const billDateRaw = (row[iDate] || '').toString().trim();
              if (!billDateRaw) continue;
              const { planDate } = parsePlanCellDate(billDateRaw);
              if (!planDate) continue;
              const goldP = iGold >= 0 ? _parseMoney(row[iGold]) : { value: 0, invalid: false };
              const diamondP = iDiamond >= 0 ? _parseMoney(row[iDiamond]) : { value: 0, invalid: false };
              // Cell me number nahi, kuch aur hai (jaise "159953+4659" ya
              // "#VALUE!") — is row ko GUESS nahi karte, seedha skip karke
              // admin ko dikha dete hain, taaki wo sheet me sudhaar sake.
              if (goldP.invalid || diamondP.invalid) {
                invalidRows.push({ sheet: fmsName, row: i + 1, clientName, goldRaw: (row[iGold] || '').toString(), diamondRaw: (row[iDiamond] || '').toString() });
                continue;
              }
              const gold = goldP.value, diamond = diamondP.value;
              if (gold <= 0 && diamond <= 0) continue;
              const billNo = iBillNo >= 0 ? (row[iBillNo] || '').toString().trim() : '';
              rows.push({ clientName, billNo, billDate: planDate, gold, diamond, fmsRef: `${sheet.id}:${tabName}:${i + 1}` });
            }
          } catch (e) { skippedSheets.push(sheet.fms_name || sheet.sheet_name); }
        }
      }

      if (!rows.length) return res.status(400).json({ error: 'No billable rows found in any FMS sheet (need Client Name + Bill Date + Gold/Diamond amount columns)' });

      // Unique client names — exact match status ke saath, taaki Confirm
      // screen sirf naam-wise dikhaye (row-wise nahi, sainkdon rows ho sakti
      // hain). _normName() whitespace ka farak nazarandaz karta hai — isi wajah
      // se pehle "SHREEJI JEWELS" aur "SHREEJI  JEWELS" (double space) alag-alag
      // row ban jaate the, ab ek hi row me aayenge.
      const byName = new Map();
      for (const r of rows) {
        const key = _normName(r.clientName);
        if (!byName.has(key)) byName.set(key, { name: r.clientName, count: 0 });
        byName.get(key).count++;
      }
      const clientNames = [...byName.entries()].map(([key, v]) => {
        const exact = clientByName[key];
        const fuzzy = !exact ? clientByFuzzy[_fuzzyKey(v.name)] : null;
        const match = exact || fuzzy;
        return {
          key, name: v.name, count: v.count,
          matchType: exact ? 'exact' : fuzzy ? 'guess' : 'none',
          suggestedUserId: match ? match.id : null, suggestedUserName: match ? match.name : '',
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      res.json({ rows, clientNames, users: clientUsers, skippedSheets, invalidRows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Bill — FMS Confirm screen se save. Har unique client name ka mapping
  // ({action:'skip'} | {action:'existing',userId} | {action:'create'})
  // frontend se aata hai (preview-fms wale rows ke saath, dobara Google
  // Sheets se padhna nahi padta). fms_ref se dobara sync par duplicate nahi
  // bante. ──
  app.post('/api/payments/bills/confirm-fms', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      const mapping = req.body.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : {};
      if (!rows.length) return res.status(400).json({ error: 'No rows to import' });

      // 'create' wale naye client (Catalog-only) accounts pehle bana lo —
      // random password (koi use nahi karega, bill track karne ke liye account
      // bas chahiye), unique email placeholder domain par.
      const clientIdByKey = {};
      let createdClients = 0;
      for (const [key, m] of Object.entries(mapping)) {
        if (!m || m.action === 'skip') continue;
        if (m.action === 'existing' && m.userId) { clientIdByKey[key] = parseInt(m.userId, 10); continue; }
        if (m.action === 'create') {
          const sampleRow = rows.find(r => _normName(r.clientName) === key);
          const displayName = (sampleRow && sampleRow.clientName) || key;
          const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'client';
          let email = `${slug}@fms-client.local`;
          const [exists] = await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER(?)', [email]);
          if (exists.length) email = `${slug}.${crypto.randomBytes(3).toString('hex')}@fms-client.local`;
          const randomPassword = crypto.randomBytes(16).toString('hex');
          const [ins] = await db.query(
            `INSERT INTO users (name,email,password,role,staff_type) VALUES (?,?,?,?,?)`,
            [displayName, email, bcrypt.hashSync(randomPassword, 10), 'client', 'office']);
          clientIdByKey[key] = ins.insertId;
          createdClients++;
        }
      }

      // ON CONFLICT ... DO UPDATE — pehle DO NOTHING tha, isliye sheet me
      // galti sudharne ke baad bhi dobara sync karne par purani (pehle se
      // import ho chuki) bill ka amount kabhi refresh nahi hota tha, wahi
      // galat number hamesha dikhta rehta. Ab fms_ref match hone par amount/
      // bill_no/bill_date hamesha sheet ki latest value se update ho jaate
      // hain — gold_paid/diamond_paid (payments) ko haath nahi lagate.
      //
      // Insert vs update ka alag count nahi rakha — Postgres/MySQL dono
      // "kitni rows affect hui" alag-alag tarah se batate hain (Postgres
      // hamesha 1 deta hai chahe insert ho ya update; MySQL update par 2,
      // no-op update par 0), isliye reliably distinguish nahi ho sakta. Ek
      // hi "processed" count zyada bharosemand hai.
      let processed = 0, skipped = 0;
      for (const r of rows) {
        const key = _normName(r.clientName);
        const clientId = clientIdByKey[key];
        if (!clientId) { skipped++; continue; }
        await db.query(
          `INSERT INTO client_bills (client_user_id,bill_no,bill_date,gold_amount,diamond_amount,source,fms_ref,created_by)
           VALUES (?,?,?,?,?,'fms',?,?)
           ON CONFLICT (fms_ref) DO UPDATE SET
             bill_no = EXCLUDED.bill_no, bill_date = EXCLUDED.bill_date,
             gold_amount = EXCLUDED.gold_amount, diamond_amount = EXCLUDED.diamond_amount`,
          [clientId, r.billNo || '', r.billDate, r.gold || 0, r.diamond || 0, r.fmsRef, req.session.userId]);
        processed++;
      }

      res.json({ imported: processed, skipped, createdClients });
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
