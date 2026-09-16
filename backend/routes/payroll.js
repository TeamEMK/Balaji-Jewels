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
