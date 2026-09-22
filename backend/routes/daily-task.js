// ══════════════════════════════════════════════════════
// DAILY TASK (timesheet) — department + task ke hisaab se roz kitna time
// diya, wo log karna. 'daily' (normal kaam) aur 'extra_working' (overtime)
// do alag buckets hain, ek hi table (daily_task_logs) me.
//
// NOTE: is table me ab bhi 'client_name' column hai (DB migration hata nahi
// hai), lekin UI se client field hata diya gaya hai (user request) — naye
// rows ab '' client_name ke saath save hote hain. Purani entries ka client
// data DB me bana rehta hai, bas kahin dikhta nahi.
// ══════════════════════════════════════════════════════

const { workingDaysInRange } = require('../lib/workdays');

module.exports = function registerDailyTaskRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  // ── Submit — ek din + ek log_type ka poora set. Dobara submit karne par
  // (jaise galti sudharni thi) purani entries usi din/type ke liye replace
  // ho jaati hain — duplicate nahi banti. ──
  app.post('/api/daily-task', requireAuth, async (req, res) => {
    try {
      const { entryDate, logType, rows } = req.body;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate || '')) return res.status(400).json({ error: 'Entry date required' });
      if (!['daily', 'extra_working'].includes(logType)) return res.status(400).json({ error: 'Invalid log type' });
      const clean = (Array.isArray(rows) ? rows : [])
        .map(r => ({
          department: (r.department || '').trim(),
          description: (r.description || '').trim(),
          minutes: parseInt(r.minutes, 10) || 0,
        }))
        .filter(r => r.description && r.minutes > 0);
      if (!clean.length) return res.status(400).json({ error: 'Add at least one valid row (description and time required)' });

      const uid = req.session.userId;
      await db.query('DELETE FROM daily_task_logs WHERE user_id=? AND entry_date=? AND log_type=?', [uid, entryDate, logType]);
      const values = clean.map(r => [uid, entryDate, logType, r.department, r.description, r.minutes]);
      await db.query(
        `INSERT INTO daily_task_logs (user_id,entry_date,log_type,client_name,department,description,minutes) VALUES ?`,
        [values.map(v => [v[0], v[1], v[2], '', v[3], v[4], v[5]])]);
      res.json({ success: true, count: clean.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Apni history — date ke hisaab se grouped summary (count + total minutes) ──
  app.get('/api/daily-task/mine', requireAuth, async (req, res) => {
    try {
      const logType = ['daily', 'extra_working'].includes(req.query.logType) ? req.query.logType : 'daily';
      const [rows] = await db.query(
        `SELECT TO_CHAR(entry_date,'YYYY-MM-DD') AS entry_date, COUNT(*) AS cnt, SUM(minutes) AS total_minutes
         FROM daily_task_logs WHERE user_id=? AND log_type=? GROUP BY entry_date ORDER BY entry_date DESC LIMIT 60`,
        [req.session.userId, logType]);
      res.json(rows.map(r => ({ date: r.entry_date, count: parseInt(r.cnt) || 0, totalMinutes: parseInt(r.total_minutes) || 0 })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Ek din ki poori detail — "My Past Submissions" expand karne par,
  // ya usi din ko dobara edit karne ke liye form me load karne ke liye. ──
  app.get('/api/daily-task/mine/:date', requireAuth, async (req, res) => {
    try {
      const logType = ['daily', 'extra_working'].includes(req.query.logType) ? req.query.logType : 'daily';
      const [rows] = await db.query(
        `SELECT id, department, description, minutes FROM daily_task_logs
         WHERE user_id=? AND entry_date=? AND log_type=? ORDER BY id ASC`,
        [req.session.userId, req.params.date, logType]);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Admin/HOD/PC — sabka daily-task summary, date-range ke hisaab se
  // (jaise MIS). Kaun kitna time de raha hai, employee-wise. ──
  app.get('/api/daily-task/all', requireAuth, async (req, res) => {
    try {
      const role = req.session.role;
      if (!['admin', 'hod', 'pc'].includes(role)) return res.status(403).json({ error: 'Not allowed' });
      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ error: 'Dates required' });
      const logType = ['daily', 'extra_working'].includes(req.query.logType) ? req.query.logType : 'daily';

      let deptFilter = '', params = [start, end, logType];
      if (role === 'hod') {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [req.session.userId]);
        deptFilter = 'AND u.department=?'; params.push(me[0]?.department || '');
      }
      const [rows] = await db.query(
        `SELECT u.id AS "userId", u.name, u.department, COUNT(*) AS cnt, SUM(dtl.minutes) AS total_minutes
         FROM daily_task_logs dtl JOIN users u ON dtl.user_id=u.id
         WHERE dtl.entry_date BETWEEN ? AND ? AND dtl.log_type=? ${deptFilter}
         GROUP BY u.id, u.name, u.department ORDER BY u.name ASC`, params);
      res.json(rows.map(r => ({ userId: r.userId, name: r.name, department: r.department || '', count: parseInt(r.cnt) || 0, totalMinutes: parseInt(r.total_minutes) || 0 })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Fill rate — Employee 360 Score ke liye. Date range me har employee ke
  // "working days" (apna week_off/extra_off respect karte hue) vs "kitne din
  // Daily Task bhara" — fillRate% isi se nikalta hai. ──
  app.get('/api/daily-task/fill-rate', requireAuth, async (req, res) => {
    try {
      const role = req.session.role;
      if (!['admin', 'hod', 'pc'].includes(role)) return res.status(403).json({ error: 'Not allowed' });
      const { start, end } = req.query;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return res.status(400).json({ error: 'Dates required' });

      let deptFilter = '', params = [];
      if (role === 'hod') {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [req.session.userId]);
        deptFilter = 'AND department=?'; params.push(me[0]?.department || '');
      }
      const [users] = await db.query(`SELECT id,name,department,week_off,extra_off FROM users WHERE role<>'client' ${deptFilter}`, params);

      const [logRows] = await db.query(
        `SELECT user_id, COUNT(DISTINCT entry_date) AS days_filled FROM daily_task_logs
         WHERE entry_date BETWEEN ? AND ? AND log_type='daily' GROUP BY user_id`, [start, end]);
      const filledByUser = {};
      logRows.forEach(r => { filledByUser[r.user_id] = parseInt(r.days_filled) || 0; });

      const rows = users.map(u => {
        const workingDays = workingDaysInRange(start, end, u.week_off || '', u.extra_off || '');
        const daysFilled = Math.min(filledByUser[u.id] || 0, workingDays || Infinity);
        const fillRate = workingDays > 0 ? Math.round((daysFilled / workingDays) * 1000) / 10 : null;
        return { userId: u.id, name: u.name, department: u.department || '', workingDays, daysFilled, fillRate };
      });
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
