// ══════════════════════════════════════════════════════
// QUICK FORMS — koi bhi logged-in user form ka naam+link add kar sakta hai,
// sidebar ke "Forms" page se ek click me wo form khul jaata hai (naya tab).
// Koi role-restriction nahi — har kisi ko add/edit/delete ki permission hai,
// jaisa user ne khud chaha. Simple shared list, admin ki tarah kuch bhi
// approve/manage karne ki zaroorat nahi.
// ══════════════════════════════════════════════════════

module.exports = function registerFormsRoutes(app, ctx) {
  const { db, requireAuth } = ctx;

  app.get('/api/forms', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT f.id, f.name, f.link, f.added_by, u.name AS "addedByName",
                TO_CHAR(f.created_at,'YYYY-MM-DD HH12:MI AM') AS created_at
         FROM quick_forms f
         JOIN users u ON u.id = f.added_by
         ORDER BY f.name ASC`);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/forms', requireAuth, async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const link = typeof req.body?.link === 'string' ? req.body.link.trim() : '';
      if (!name) return res.status(400).json({ error: 'Form name is required' });
      if (!link) return res.status(400).json({ error: 'Form link is required' });
      if (!/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'Link must start with http:// or https://' });
      const [r] = await db.query('INSERT INTO quick_forms (name, link, added_by) VALUES (?,?,?)',
        [name, link, req.session.userId]);
      res.json({ success: true, id: r.insertId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Edit — koi bhi logged-in user (sirf apna add kiya hua hi nahi) — jaisa user ne chaha
  app.put('/api/forms/:id', requireAuth, async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const link = typeof req.body?.link === 'string' ? req.body.link.trim() : '';
      if (!name) return res.status(400).json({ error: 'Form name is required' });
      if (!link) return res.status(400).json({ error: 'Form link is required' });
      if (!/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'Link must start with http:// or https://' });
      const [rows] = await db.query('SELECT id FROM quick_forms WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Form not found' });
      await db.query('UPDATE quick_forms SET name=?, link=? WHERE id=?', [name, link, req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.delete('/api/forms/:id', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT id FROM quick_forms WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Form not found' });
      await db.query('DELETE FROM quick_forms WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });
};
