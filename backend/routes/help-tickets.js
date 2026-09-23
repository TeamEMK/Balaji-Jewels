// ══════════════════════════════════════════════════════
// HELP TICKET — koi bhi employee help ticket raise kar sakta hai. Query
// module jaisa hi pattern hai, bas ek farak: yahan "kisse help chahiye"
// (target_user_id) OPTIONAL hota hai — diya ho to wahi target person bhi
// ticket dekh/resolve kar sakta hai (Admin/HR-mediated nahi, seedha peer se
// peer). Admin hamesha SAARE tickets dekhta hai, target ho ya na ho.
//
// Visibility:
//   - Admin: sab kuch
//   - Baaki sab: apne raise kiye hue + jo unhe target kiye gaye hon
//   - Target NA diya ho to sirf raiser + Admin ko dikhta hai (private request)
//
// Resolve kaun kar sakta hai: Admin, ya jise target kiya gaya hai.
//
// ROUTE ORDER: `/api/help-tickets/:id/resolve` ko `/api/help-tickets/:id` se
// PEHLE register kiya hai (queries.js jaisa hi convention).

module.exports = function registerHelpTicketRoutes(app, ctx) {
  const { db, requireAuth } = ctx;

  const canResolveTicket = (t, uid, role) =>
    role === 'admin' || (t.target_user_id != null && String(t.target_user_id) === String(uid));

  // Nayi ticket — koi bhi logged-in user daal sakta hai. targetUserId optional.
  app.post('/api/help-tickets', requireAuth, async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Please describe what help you need' });
      if (message.length > 5000) return res.status(400).json({ error: 'Message too long (max 5000 chars)' });
      let targetUserId = req.body?.targetUserId;
      targetUserId = targetUserId ? parseInt(targetUserId, 10) : null;
      if (targetUserId) {
        const [t] = await db.query(`SELECT id FROM users WHERE id=? AND role<>'client'`, [targetUserId]);
        if (!t.length) return res.status(400).json({ error: 'Selected person not found' });
      }
      const [r] = await db.query(
        'INSERT INTO help_tickets (user_id, target_user_id, message, status) VALUES (?,?,?,?)',
        [req.session.userId, targetUserId, message, 'open']);
      res.json({ success: true, id: r.insertId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // List — Admin sabki; baaki apni raise ki hui + jinme wo target hain
  app.get('/api/help-tickets', requireAuth, async (req, res) => {
    try {
      const isAdmin = req.session.role === 'admin';
      const where = isAdmin ? '' : 'WHERE t.user_id=? OR t.target_user_id=?';
      const params = isAdmin ? [] : [req.session.userId, req.session.userId];
      const [rows] = await db.query(
        `SELECT t.id, t.user_id, u.name AS "userName", u.department, u.staff_type,
                t.target_user_id, tu.name AS "targetName",
                t.message, t.status, t.response, t.resolved_by, r.name AS "resolverName",
                TO_CHAR(t.created_at,'YYYY-MM-DD HH12:MI AM') AS created_at,
                TO_CHAR(t.resolved_at,'YYYY-MM-DD HH12:MI AM') AS resolved_at
         FROM help_tickets t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN users tu ON tu.id = t.target_user_id
         LEFT JOIN users r ON r.id = t.resolved_by
         ${where}
         ORDER BY (t.status='open') DESC, t.created_at DESC`, params);
      const uid = req.session.userId, role = req.session.role;
      const withPerms = rows.map(t => ({
        ...t,
        canResolve: canResolveTicket(t, uid, role) && t.status === 'open',
        isOwner: String(t.user_id) === String(uid),
      }));
      res.json({ isAdmin, tickets: withPerms });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Resolve — Admin, ya jise target kiya gaya hai
  app.put('/api/help-tickets/:id/resolve', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM help_tickets WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
      const t = rows[0];
      if (!canResolveTicket(t, req.session.userId, req.session.role)) return res.status(403).json({ error: 'Only Admin or the person this ticket is for can resolve it' });
      const response = typeof req.body?.response === 'string' ? req.body.response.trim() : '';
      await db.query(
        "UPDATE help_tickets SET response=?, status='resolved', resolved_by=?, resolved_at=NOW() WHERE id=?",
        [response || null, req.session.userId, req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Edit — sirf jisne ticket daali (owner), aur tabhi jab abhi 'open' ho.
  app.put('/api/help-tickets/:id', requireAuth, async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Please describe what help you need' });
      if (message.length > 5000) return res.status(400).json({ error: 'Message too long (max 5000 chars)' });
      const [rows] = await db.query('SELECT user_id, status FROM help_tickets WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
      if (rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'You can only edit your own ticket' });
      if (rows[0].status !== 'open') return res.status(403).json({ error: 'Resolved tickets cannot be edited' });
      let targetUserId = req.body?.targetUserId;
      targetUserId = targetUserId ? parseInt(targetUserId, 10) : null;
      if (targetUserId) {
        const [t] = await db.query(`SELECT id FROM users WHERE id=? AND role<>'client'`, [targetUserId]);
        if (!t.length) return res.status(400).json({ error: 'Selected person not found' });
      }
      await db.query('UPDATE help_tickets SET message=?, target_user_id=? WHERE id=?', [message, targetUserId, req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Delete — Admin koi bhi ticket hata sakta hai; user sirf apni aur tabhi jab open ho
  app.delete('/api/help-tickets/:id', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT user_id, status FROM help_tickets WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
      const isAdmin = req.session.role === 'admin';
      const isOwner = rows[0].user_id === req.session.userId;
      if (!isAdmin && !isOwner) return res.status(403).json({ error: 'You can only delete your own ticket' });
      if (!isAdmin && rows[0].status !== 'open') return res.status(403).json({ error: 'Resolved tickets cannot be deleted' });
      await db.query('DELETE FROM help_tickets WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });
};
