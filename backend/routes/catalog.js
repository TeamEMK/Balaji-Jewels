// ══════════════════════════════════════════════════════
// CATALOG
// ══════════════════════════════════════════════════════
// Jewelry items ka catalog — image + naam + description + price. 'client'
// role (customers) sirf ye dekh sakte hain (requireAuth se — koi bhi logged-in
// role padh sakta hai). Add/Edit/Delete sirf admin/HOD/PC kar sakte hain.
//
// 'client' role global allowlist se already sirf /api/catalog aur /api/me tak
// simit hai (server.js ke requireAuth me) — ye route-level checks us upar ek
// aur parat hain (write yahan bhi admin/HOD tak hi rukti hai).

module.exports = function registerCatalogRoutes(app, ctx) {
  const { db, requireAuth, requireAdminOrHod } = ctx;

  app.get('/api/catalog', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT id,name,description,price,image,created_at FROM catalog_items ORDER BY created_at DESC');
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/catalog', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { name, description, price, image } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });
      const priceVal = (price === '' || price === null || price === undefined) ? null : parseFloat(price);
      await db.query(
        'INSERT INTO catalog_items (name,description,price,image,created_by) VALUES (?,?,?,?,?)',
        [name, description || '', priceVal, image || null, req.session.userId]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/catalog/:id', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { name, description, price, image } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });
      const priceVal = (price === '' || price === null || price === undefined) ? null : parseFloat(price);
      // image undefined ho (form me photo badli hi nahi) to purani wahi rehne do —
      // sirf naam/description/price update karo, taaki har edit par photo dobara
      // upload karna zaroori na ho.
      if (image === undefined) {
        await db.query('UPDATE catalog_items SET name=?,description=?,price=? WHERE id=?',
          [name, description || '', priceVal, req.params.id]);
      } else {
        await db.query('UPDATE catalog_items SET name=?,description=?,price=?,image=? WHERE id=?',
          [name, description || '', priceVal, image || null, req.params.id]);
      }
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.delete('/api/catalog/:id', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      await db.query('DELETE FROM catalog_items WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
