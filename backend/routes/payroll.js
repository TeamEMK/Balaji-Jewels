// ══════════════════════════════════════════════════════
// LEAVE TRACKER + PAYROLL
// ══════════════════════════════════════════════════════
// Attendance machine se CSV upload hoti hai (ek mahine ke liye, per-employee
// days present), aur company ke Leave Tracker ka approved data (leave_requests,
// status='approved') milke payroll banate hain:
//
//   totalDays (policy.perDayBasis se)  = fixed 30 | us mahine ke calendar days |
//                                        us employee ke actual working days
//                                        (Sunday/week_off/extra_off chhod kar)
//   perDayRate  = monthly_salary / totalDays
//   absentDays  = totalDays - daysPresent (attendance CSV se)
//   paidLeaveDays = us mahine ke APPROVED leave_requests se, policy ke
//                   paidLeavePerMonth tak capped (aur absentDays se zyada nahi)
//   unpaidDays (LOP) = absentDays - paidLeaveDays
//   deduction   = unpaidDays * perDayRate
//   netPayable  = monthly_salary - deduction
//
// Sirf admin dekh/badal sakta hai — salary sensitive data hai.

const { workingDaysInMonth } = require('../lib/workdays');

const DEFAULT_POLICY = { perDayBasis: 'fixed30', paidLeavePerMonth: 1 };

// Client ki biometric machine "Basic Work Duration Report" export karti hai
// (Monthly Status Report) — har employee ka 6-row block:
//   "Emp. Code:", ..., code, ..., "Emp. Name:", ..., name
//   "Status",  ..., per-din status (P/A/WO/WOP/CL/H/half day), ..., "Late Mark", n
//   "InTime",  ...per-din in-time..., "Leave", n
//   "OutTime", ...per-din out-time..., "Sunday", n
//   "Total",   ...per-din duration..., "Ot", n
//   (khaali label, per-din deviation minutes, total)
// Din-columns position-based NAHI hain (report me beech-beech me khaali
// merged-cell gaps hote hain) — isliye 'Days' header row se column->day
// mapping banate hain, phir Status row usi mapping se padhte hain.
const MONTH_ABBR = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseWorkDurationReport(rows) {
  const daysRowIdx = rows.findIndex(r => ((r[0] || '').trim()) === 'Days');
  if (daysRowIdx < 0) throw new Error("Could not find the 'Days' header row — is this a Basic Work Duration Report sheet?");
  const daysRow = rows[daysRowIdx];
  const dayCols = [];
  for (let i = 2; i < daysRow.length; i++) {
    const v = (daysRow[i] || '').trim();
    const m = v.match(/^(\d{1,2})/);
    if (m) dayCols.push(i);
  }
  if (!dayCols.length) throw new Error('Could not read the day columns from the Days row');

  // "Aug 01 2026  To  Aug 31 2026" jaisi line se report ka mahina nikalo —
  // sirf validation/warning ke liye (selected month se match nahi kiya to block nahi karte, warn karte hain)
  let reportMonth = null;
  for (const r of rows.slice(0, 5)) {
    const text = (r || []).join(' ');
    const m = text.match(/([A-Za-z]{3})\w*\s+\d{1,2}\s+(\d{4})\s*to/i);
    if (m) { const mon = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()]; if (mon) { reportMonth = `${m[2]}-${String(mon).padStart(2, '0')}`; break; } }
  }

  const isPresent = s => /^p$/i.test(s) || /^wop$/i.test(s);
  const isHalfDay = s => /^half\s*day$/i.test(s);

  const employees = [];
  for (let i = 0; i < rows.length; i++) {
    if (((rows[i][0] || '').trim()) !== 'Emp. Code:') continue;
    const codeRow = rows[i];
    const nameLabelIdx = codeRow.findIndex(c => (c || '').trim() === 'Emp. Name:');
    let empCode = '', empName = '';
    for (let c = 1; c < (nameLabelIdx > -1 ? nameLabelIdx : codeRow.length); c++) {
      if ((codeRow[c] || '').trim()) { empCode = codeRow[c].trim(); break; }
    }
    if (nameLabelIdx > -1) {
      for (let c = nameLabelIdx + 1; c < codeRow.length; c++) {
        if ((codeRow[c] || '').trim()) { empName = codeRow[c].trim(); break; }
      }
    }
    const statusRow = rows[i + 1];
    if (!empName || !statusRow || ((statusRow[0] || '').trim()) !== 'Status') continue; // malformed block — skip, poori sheet fail nahi

    let presentDays = 0;
    for (const col of dayCols) {
      const raw = (statusRow[col] || '').trim();
      if (!raw) continue;
      if (isPresent(raw)) presentDays += 1;
      else if (isHalfDay(raw)) presentDays += 0.5;
      // WO/A/CL/H/absent/Joining — present nahi ginte
    }
    employees.push({ empCode, empName, presentDays: Math.round(presentDays * 10) / 10 });
  }
  return { reportMonth, employees };
}

// Attendance sync — chahe Google Sheet se aaye ya CSV se, dono ek hi tarah
// match hote hain: email exact > name exact > first-name guess > kuch nahi
// (ambiguous/none) — taaki dono jagah ek hi Confirm modal reuse ho sake aur
// matching logic ek hi jagah rahe.
function matchAttendanceEntry(entry, users) {
  const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const firstWord = s => norm(s).split(' ')[0] || '';
  if (entry.email) {
    const byEmail = users.find(u => norm(u.email) === norm(entry.email));
    if (byEmail) return { matchType: 'exact', user: byEmail };
  }
  if (entry.name) {
    const byName = users.find(u => norm(u.name) === norm(entry.name));
    if (byName) return { matchType: 'exact', user: byName };
    const empFirst = firstWord(entry.name);
    const firstMatches = users.filter(u => firstWord(u.name) === empFirst && empFirst);
    if (firstMatches.length === 1) return { matchType: 'guess', user: firstMatches[0] };
    if (firstMatches.length > 1) return { matchType: 'ambiguous', user: null };
  }
  return { matchType: 'none', user: null };
}

module.exports = function registerPayrollRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  async function getPolicy() {
    const [rows] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['payroll_policy']);
    if (!rows[0]) return { ...DEFAULT_POLICY };
    try { return { ...DEFAULT_POLICY, ...JSON.parse(rows[0].value) }; } catch (e) { return { ...DEFAULT_POLICY }; }
  }

  // ── Policy (per-day rate basis + paid leave quota) ──
  app.get('/api/payroll/settings', requireAuth, requireAdmin, async (req, res) => {
    try { res.json(await getPolicy()); }
    catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/payroll/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { perDayBasis, paidLeavePerMonth } = req.body;
      if (!['fixed30', 'calendar', 'working'].includes(perDayBasis)) return res.status(400).json({ error: 'Invalid perDayBasis' });
      const paidLeave = parseFloat(paidLeavePerMonth);
      if (isNaN(paidLeave) || paidLeave < 0) return res.status(400).json({ error: 'Invalid paidLeavePerMonth' });
      const value = JSON.stringify({ perDayBasis, paidLeavePerMonth: paidLeave });
      await db.query(
        `INSERT INTO app_settings (key_name,value) VALUES (?,?) ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value`,
        ['payroll_policy', value]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Salary bulk set — CSV client-side parse hoke rows yahan aate hain ──
  app.post('/api/payroll/salary/bulk', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'No rows' });
      const [allUsers] = await db.query('SELECT id,email,name FROM users');
      let updated = 0; const skipped = [];
      for (const r of rows) {
        const email = (r.email || '').trim().toLowerCase();
        const name = (r.name || '').trim().toLowerCase();
        const salary = parseFloat(r.salary);
        if (isNaN(salary) || salary < 0) { skipped.push(r.email || r.name || '?'); continue; }
        let user = email ? allUsers.find(u => (u.email || '').toLowerCase() === email) : null;
        if (!user && name) user = allUsers.find(u => (u.name || '').toLowerCase() === name);
        if (!user) { skipped.push(r.email || r.name || '?'); continue; }
        await db.query('UPDATE users SET monthly_salary=? WHERE id=?', [salary, user.id]);
        updated++;
      }
      res.json({ updated, skipped });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Attendance upload — ek mahine ke liye, per-employee days present.
  //    UNIQUE(user_id,month) hai — dobara upload karne par purani value
  //    replace hoti hai (galti sudharna aasan). ──
  app.post('/api/payroll/attendance', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { month, rows } = req.body;
      if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'Month required as YYYY-MM' });
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows' });
      const [allUsers] = await db.query('SELECT id,email,name FROM users');
      let updated = 0; const skipped = [];
      for (const r of rows) {
        const email = (r.email || '').trim().toLowerCase();
        const name = (r.name || '').trim().toLowerCase();
        const daysPresent = parseFloat(r.daysPresent);
        if (isNaN(daysPresent) || daysPresent < 0) { skipped.push(r.email || r.name || '?'); continue; }
        let user = email ? allUsers.find(u => (u.email || '').toLowerCase() === email) : null;
        if (!user && name) user = allUsers.find(u => (u.name || '').toLowerCase() === name);
        if (!user) { skipped.push(r.email || r.name || '?'); continue; }
        await db.query(
          `INSERT INTO attendance_records (user_id,month,days_present,uploaded_by) VALUES (?,?,?,?)
           ON CONFLICT (user_id,month) DO UPDATE SET days_present = EXCLUDED.days_present, uploaded_by = EXCLUDED.uploaded_by, updated_at = NOW()`,
          [user.id, month, daysPresent, req.session.userId]);
        updated++;
      }
      res.json({ updated, skipped });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Attendance — biometric "Basic Work Duration Report" CSV upload (jab
  //    biometric software seedha CSV/Excel export deta hai). Frontend
  //    (uploadAttendanceCSV) CSV ko 2D array me parse karke yahan bhejta hai
  //    (parseCSVRows se), phir wahi parseWorkDurationReport() + naam-matching
  //    (matchAttendanceEntry) jo niche simple email/name CSV ke liye bhi use hoti hai. ──
  app.post('/api/payroll/attendance/preview-report-csv', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rawRows.length) return res.status(400).json({ error: 'No rows' });

      let parsed;
      try { parsed = parseWorkDurationReport(rawRows); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      if (!parsed.employees.length) return res.status(400).json({ error: 'No employee attendance blocks found in this file' });

      const [allUsers] = await db.query(`SELECT id,name,email FROM users WHERE role<>'client' ORDER BY name ASC`);
      const rows = parsed.employees.map(emp => {
        const m = matchAttendanceEntry({ name: emp.empName }, allUsers);
        return {
          empCode: emp.empCode, empName: emp.empName, presentDays: emp.presentDays,
          matchType: m.matchType, suggestedUserId: m.user ? m.user.id : null, suggestedUserName: m.user ? m.user.name : '',
        };
      });

      res.json({ reportMonth: parsed.reportMonth, rows, users: allUsers });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Attendance — CSV upload bhi ab isi Confirm preview se guzarta hai
  //    (Google Sheet sync jaisa hi structure — user ki request). CSV me
  //    email column ho to sabse pehle wahi try hota hai (sabse bharosemand),
  //    warna name (exact, phir first-name guess). Kuch save NAHI hota yahan —
  //    sirf match dikhata hai, save Confirm par POST /api/payroll/attendance
  //    se hi hota hai (wahi endpoint jo pehle se hai). ──
  app.post('/api/payroll/attendance/preview-csv', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rawRows.length) return res.status(400).json({ error: 'No rows' });

      const entries = []; let invalidCount = 0;
      for (const r of rawRows) {
        const daysPresent = parseFloat(r.daysPresent);
        if (isNaN(daysPresent) || daysPresent < 0) { invalidCount++; continue; }
        const email = (r.email || '').trim(), name = (r.name || '').trim();
        if (!email && !name) { invalidCount++; continue; }
        entries.push({ email, name, daysPresent: Math.round(daysPresent * 10) / 10 });
      }
      if (!entries.length) return res.status(400).json({ error: 'No valid rows found — check email/name and days_present columns' });

      const [allUsers] = await db.query(`SELECT id,name,email FROM users WHERE role<>'client' ORDER BY name ASC`);
      const rows = entries.map(e => {
        const m = matchAttendanceEntry(e, allUsers);
        return {
          empCode: '', empName: e.name || e.email, presentDays: e.daysPresent,
          matchType: m.matchType, suggestedUserId: m.user ? m.user.id : null, suggestedUserName: m.user ? m.user.name : '',
        };
      });

      res.json({ reportMonth: null, rows, users: allUsers, invalidCount });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Compute — ek mahine ka poora payroll breakdown, har employee ke liye ──
  app.get('/api/payroll', requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month;
      if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'Month required as YYYY-MM' });
      const [year, mon] = month.split('-').map(Number);
      const policy = await getPolicy();

      const [users] = await db.query(
        `SELECT id,name,email,department,monthly_salary,week_off,extra_off FROM users WHERE role<>'client' ORDER BY name ASC`);
      const [attRows] = await db.query('SELECT user_id,days_present FROM attendance_records WHERE month=?', [month]);
      const attByUser = {};
      attRows.forEach(a => { attByUser[a.user_id] = parseFloat(a.days_present); });

      // Approved leaves jo is mahine se overlap karte hain — sabke liye ek hi query
      const monthEndDay = new Date(year, mon, 0).getDate();
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-${String(monthEndDay).padStart(2, '0')}`;
      const [leaveRows] = await db.query(
        `SELECT user_id, leave_type, TO_CHAR(from_date,'YYYY-MM-DD') AS from_date, TO_CHAR(to_date,'YYYY-MM-DD') AS to_date
         FROM leave_requests WHERE status='approved' AND from_date<=? AND to_date>=?`, [monthEnd, monthStart]);
      const leaveDaysByUser = {};
      for (const l of leaveRows) {
        const from = l.from_date < monthStart ? monthStart : l.from_date;
        const to = l.to_date > monthEnd ? monthEnd : l.to_date;
        const days = Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
        const weight = l.leave_type === 'half_day' ? 0.5 : 1;
        leaveDaysByUser[l.user_id] = (leaveDaysByUser[l.user_id] || 0) + days * weight;
      }

      const rows = users.map(u => {
        const totalDays = policy.perDayBasis === 'fixed30' ? 30
          : policy.perDayBasis === 'calendar' ? monthEndDay
          : workingDaysInMonth(year, mon, u.week_off || '', u.extra_off || '');

        const hasAttendance = attByUser[u.id] !== undefined;
        const daysPresent = hasAttendance ? attByUser[u.id] : null;
        const salary = u.monthly_salary != null ? parseFloat(u.monthly_salary) : null;

        let absentDays = null, paidLeaveDays = 0, unpaidDays = null, perDayRate = null, deduction = null, netPayable = null;
        if (hasAttendance) {
          absentDays = Math.max(0, totalDays - daysPresent);
          const approvedLeave = leaveDaysByUser[u.id] || 0;
          paidLeaveDays = Math.min(absentDays, approvedLeave, policy.paidLeavePerMonth);
          unpaidDays = Math.round((absentDays - paidLeaveDays) * 10) / 10;
        }
        if (salary != null) {
          perDayRate = Math.round((salary / totalDays) * 100) / 100;
          if (unpaidDays != null) {
            deduction = Math.round(unpaidDays * perDayRate * 100) / 100;
            netPayable = Math.round((salary - deduction) * 100) / 100;
          }
        }

        return {
          userId: u.id, name: u.name, email: u.email, department: u.department || '',
          monthlySalary: salary, totalDays, daysPresent, hasAttendance,
          absentDays, paidLeaveDays: Math.round(paidLeaveDays * 10) / 10, unpaidDays,
          perDayRate, deduction, netPayable,
        };
      });

      res.json({ month, policy, rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
