// ══════════════════════════════════════════════════════
// DAILY TASK (timesheet) — client + department + task ke hisaab se roz kitna
// time diya, wo log karna. 'daily' (normal kaam) aur 'extra_working'
// (overtime) do alag buckets hain, ek hi table (daily_task_logs) me.
// ══════════════════════════════════════════════════════

const { getSheetsClient, extractSpreadsheetId } = require('../lib/google');

module.exports = function registerDailyTaskRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  // ── Client list — dropdown ke liye. Departments jaisa hi pattern:
  // sab padh sakte hain, sirf admin naya add kar sakta hai. ──
  app.get('/api/daily-task/clients', requireAuth, async (req, res) => {
    try {
      const [saved] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['daily_task_clients']);
      const list = saved[0] ? JSON.parse(saved[0].value) : [];
      res.json(list.sort((a, b) => a.localeCompare(b)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/daily-task/clients', requireAuth, requireAdmin, async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Client name required' });
      const [saved] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['daily_task_clients']);
      const list = saved[0] ? JSON.parse(saved[0].value) : [];
      if (!list.some(c => c.toLowerCase() === name.toLowerCase())) list.push(name);
      await db.query(
        `INSERT INTO app_settings (key_name,value) VALUES (?,?) ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value`,
        ['daily_task_clients', JSON.stringify(list)]);
      res.json(list.sort((a, b) => a.localeCompare(b)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── FMS se client names khud khinch lo — Order to Quotation / Customer
  // Order jaisi FMS sheets me "Client Name" column me hi ye data pehle se
  // hai. Har FMS sheet ke headers me "Client Name" (kisi bhi spacing/case
  // ke saath) dhoondo, us column ki saari unique values nikaal ke list me
  // jod do — dobara chalane par sirf NAYE naam add hote hain, purane nahi
  // duplicate hote. ──
  app.post('/api/daily-task/clients/sync-fms', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [sheets] = await db.query('SELECT * FROM fms_sheets ORDER BY fms_name ASC');
      const found = new Set();
      if (sheets.length) {
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        await Promise.all(sheets.map(async (sheet) => {
          try {
            const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
            const tabName = sheet.sheet_name || 'Sheet1';
            const headerRowIdx = (sheet.header_row || 1) - 1;
            const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
            const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
            const data = response.data.values || [];
            const headers = data[headerRowIdx] || [];
            const clientColIdx = headers.findIndex(h => /client\s*name/i.test((h || '').toString()));
            if (clientColIdx < 0) return;
            for (const row of data.slice(headerRowIdx + 1)) {
              const v = (row[clientColIdx] || '').toString().trim();
              if (v) found.add(v);
            }
          } catch (e) { /* is sheet skip, baaki chalte rahein */ }
        }));
      }

      const [saved] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['daily_task_clients']);
      const list = saved[0] ? JSON.parse(saved[0].value) : [];
      const existing = new Set(list.map(c => c.toLowerCase()));
      let added = 0;
      for (const name of found) {
        if (!existing.has(name.toLowerCase())) { list.push(name); existing.add(name.toLowerCase()); added++; }
      }
      await db.query(
        `INSERT INTO app_settings (key_name,value) VALUES (?,?) ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value`,
        ['daily_task_clients', JSON.stringify(list)]);
      res.json({ added, total: list.length, clients: list.sort((a, b) => a.localeCompare(b)) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

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
          clientName: (r.clientName || '').trim(),
          department: (r.department || '').trim(),
          description: (r.description || '').trim(),
          minutes: parseInt(r.minutes, 10) || 0,
        }))
        .filter(r => r.clientName && r.description && r.minutes > 0);
      if (!clean.length) return res.status(400).json({ error: 'Add at least one valid row (client, description and time required)' });

      const uid = req.session.userId;
      await db.query('DELETE FROM daily_task_logs WHERE user_id=? AND entry_date=? AND log_type=?', [uid, entryDate, logType]);
      const values = clean.map(r => [uid, entryDate, logType, r.clientName, r.department, r.description, r.minutes]);
      await db.query(
        `INSERT INTO daily_task_logs (user_id,entry_date,log_type,client_name,department,description,minutes) VALUES ?`,
        [values]);
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
        `SELECT id, client_name, department, description, minutes FROM daily_task_logs
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

};
