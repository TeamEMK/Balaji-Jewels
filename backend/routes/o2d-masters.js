// ══════════════════════════════════════════════════════
// O2D FMS — Masters (Spec sec 3) + Stage Settings (TAT & default doer)
// ══════════════════════════════════════════════════════
module.exports = function registerO2DMasters(app, ctx) {
  const { db, requireAuth, requireAdmin, lib, wrap } = ctx;
  const { nowIST, str, num, int, fail } = lib;

  const VENDOR_TYPES = ['CAD', 'Diamond Supplier', 'Manufacturing (FG)', 'Hallmarking', 'Lab'];
  const LABOUR_BASIS = ['Per Gram', 'Per Piece', 'Per Carat'];
  const PAYMENT_STYLES = ['Invoice-wise', 'Category-wise'];

  // Ek hi call me saare dropdowns — order form, issue screen etc. sab yahi lete hain.
  app.get('/api/o2d/lookups', requireAuth, wrap(async (req, res) => {
    const [customers] = await db.query(
      `SELECT id, client_name, company_name, city, sales_person_id, quality_id, default_lab_id, certificate_required,
              gold_tunch_pct, labour_rate, labour_rate_basis, payment_terms_days, payment_style, is_active
       FROM fms_customers WHERE is_deleted=0 ORDER BY client_name`);
    const [vendors] = await db.query(
      'SELECT id, vendor_name, vendor_type, default_lead_time_days, is_active FROM fms_vendors WHERE is_deleted=0 ORDER BY vendor_name');
    const [quality] = await db.query('SELECT id, name, is_active FROM fms_quality_master WHERE is_deleted=0 ORDER BY name');
    const [labs] = await db.query('SELECT id, name, is_active FROM fms_lab_master WHERE is_deleted=0 ORDER BY name');
    const [reasons] = await db.query('SELECT id, name, is_active FROM fms_reason_master WHERE is_deleted=0 ORDER BY name');
    const [outcomes] = await db.query('SELECT id, name, task_type, is_active FROM fms_followup_outcome WHERE is_deleted=0 ORDER BY name');
    const [users] = await db.query("SELECT id, name, role, department FROM users WHERE role<>'client' ORDER BY name");
    const cfg = await lib.stageConfig(db);
    res.json({
      customers, vendors, quality, labs, reasons, outcomes, users, stages: cfg.list,
      vendorTypes: VENDOR_TYPES, labourBasis: LABOUR_BASIS, paymentStyles: PAYMENT_STYLES,
      typeOutcomes: lib.TYPE_OUTCOMES, closingOutcomes: lib.CLOSING_OUTCOMES, statuses: lib.S,
      isAdmin: req.session.role === 'admin', me: req.session.userId,
    });
  }));

  // ── Customers ──────────────────────────────────────
  function customerPayload(b) {
    const p = {
      client_name: str(b.client_name, 200), company_name: str(b.company_name, 200),
      contact_number: str(b.contact_number, 20), alt_contact_number: str(b.alt_contact_number, 20),
      email: str(b.email, 150), address: str(b.address, 2000), city: str(b.city, 100), state: str(b.state, 100),
      pin_code: str(b.pin_code, 10), gst_number: str(b.gst_number, 20),
      labour_rate: b.labour_rate === '' || b.labour_rate == null ? null : num(b.labour_rate),
      labour_rate_basis: LABOUR_BASIS.includes(b.labour_rate_basis) ? b.labour_rate_basis : 'Per Gram',
      gold_tunch_pct: b.gold_tunch_pct === '' || b.gold_tunch_pct == null ? null : num(b.gold_tunch_pct),
      certificate_required: b.certificate_required ? 1 : 0,
      default_lab_id: int(b.default_lab_id) || null, quality_id: int(b.quality_id) || null,
      payment_terms_days: b.payment_terms_days === '' || b.payment_terms_days == null ? 30 : int(b.payment_terms_days),
      payment_style: PAYMENT_STYLES.includes(b.payment_style) ? b.payment_style : 'Invoice-wise',
      whatsapp_group_name: str(b.whatsapp_group_name, 200), sales_person_id: int(b.sales_person_id) || null,
      is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0),
    };
    if (!p.client_name) fail('Client name is required');
    if (!p.contact_number || p.contact_number.replace(/\D/g, '').length < 10)
      fail('Contact number must be a 10-digit mobile number');
    if (p.pin_code && !/^\d{6}$/.test(p.pin_code)) fail('PIN code must be 6 digits');
    if (p.labour_rate == null || p.labour_rate < 0) fail('Labour rate is required');
    if (p.gold_tunch_pct == null || p.gold_tunch_pct < 0 || p.gold_tunch_pct > 100) fail('Gold tunch % is required (0–100)');
    if (!p.quality_id) fail('Default quality is required');
    if (p.certificate_required && !p.default_lab_id) fail('Select a default lab when certificate is required');
    return p;
  }
  async function assertUniqueName(table, col, name, exceptId) {
    const [r] = await db.query(`SELECT id FROM ${table} WHERE LOWER(${col})=LOWER(?) AND is_deleted=0 AND id<>?`, [name, exceptId || 0]);
    if (r[0]) fail(`"${name}" already exists`);
  }

  app.get('/api/o2d/customers', requireAuth, wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT c.*, q.name AS quality_name, l.name AS lab_name, u.name AS sales_person_name
       FROM fms_customers c
       LEFT JOIN fms_quality_master q ON q.id=c.quality_id
       LEFT JOIN fms_lab_master l ON l.id=c.default_lab_id
       LEFT JOIN users u ON u.id=c.sales_person_id
       WHERE c.is_deleted=0 ORDER BY c.client_name`);
    res.json(rows);
  }));
  app.post('/api/o2d/customers', requireAuth, wrap(async (req, res) => {
    const p = customerPayload(req.body || {});
    await assertUniqueName('fms_customers', 'client_name', p.client_name);
    const cols = Object.keys(p);
    const [r] = await db.query(
      `INSERT INTO fms_customers (${cols.join(',')}, created_at, created_by, is_deleted) VALUES (${cols.map(() => '?').join(',')},?,?,0)`,
      [...cols.map(k => p[k]), nowIST(), req.session.userId]);
    res.json({ success: true, id: r.insertId });
  }));
  app.put('/api/o2d/customers/:id', requireAuth, wrap(async (req, res) => {
    const p = customerPayload(req.body || {});
    await assertUniqueName('fms_customers', 'client_name', p.client_name, req.params.id);
    const cols = Object.keys(p);
    await db.query(`UPDATE fms_customers SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=?, updated_by=? WHERE id=? AND is_deleted=0`,
      [...cols.map(k => p[k]), nowIST(), req.session.userId, req.params.id]);
    res.json({ success: true });
  }));
  app.delete('/api/o2d/customers/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const [used] = await db.query('SELECT id FROM fms_orders WHERE client_id=? AND is_deleted=0 LIMIT 1', [req.params.id]);
    if (used[0]) fail('This customer has orders — mark it inactive instead of deleting');
    await db.query('UPDATE fms_customers SET is_deleted=1, updated_at=?, updated_by=? WHERE id=?', [nowIST(), req.session.userId, req.params.id]);
    res.json({ success: true });
  }));

  // ── Vendors ────────────────────────────────────────
  function vendorPayload(b) {
    const p = {
      vendor_name: str(b.vendor_name, 200), vendor_type: VENDOR_TYPES.includes(b.vendor_type) ? b.vendor_type : null,
      contact_person: str(b.contact_person, 100), contact_number: str(b.contact_number, 20),
      address: str(b.address, 2000), city: str(b.city, 100), state: str(b.state, 100), pin_code: str(b.pin_code, 10),
      gst_number: str(b.gst_number, 20),
      default_lead_time_days: b.default_lead_time_days === '' || b.default_lead_time_days == null ? 7 : int(b.default_lead_time_days),
      is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0),
    };
    if (!p.vendor_name) fail('Vendor name is required');
    if (!p.vendor_type) fail('Vendor type is required');
    if (!p.contact_number) fail('Contact number is required');
    if (p.pin_code && !/^\d{6}$/.test(p.pin_code)) fail('PIN code must be 6 digits');
    return p;
  }
  app.get('/api/o2d/vendors', requireAuth, wrap(async (req, res) => {
    const [rows] = await db.query('SELECT * FROM fms_vendors WHERE is_deleted=0 ORDER BY vendor_name');
    res.json(rows);
  }));
  app.post('/api/o2d/vendors', requireAuth, wrap(async (req, res) => {
    const p = vendorPayload(req.body || {});
    await assertUniqueName('fms_vendors', 'vendor_name', p.vendor_name);
    const cols = Object.keys(p);
    const [r] = await db.query(
      `INSERT INTO fms_vendors (${cols.join(',')}, created_at, created_by, is_deleted) VALUES (${cols.map(() => '?').join(',')},?,?,0)`,
      [...cols.map(k => p[k]), nowIST(), req.session.userId]);
    res.json({ success: true, id: r.insertId });
  }));
  app.put('/api/o2d/vendors/:id', requireAuth, wrap(async (req, res) => {
    const p = vendorPayload(req.body || {});
    await assertUniqueName('fms_vendors', 'vendor_name', p.vendor_name, req.params.id);
    const cols = Object.keys(p);
    await db.query(`UPDATE fms_vendors SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=?, updated_by=? WHERE id=? AND is_deleted=0`,
      [...cols.map(k => p[k]), nowIST(), req.session.userId, req.params.id]);
    res.json({ success: true });
  }));
  app.delete('/api/o2d/vendors/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const id = req.params.id;
    const checks = [
      ['fms_cad', 'cad_vendor_id'], ['fms_requirement', 'vendor_id'], ['fms_vendor_issue', 'vendor_id'], ['fms_hallmark', 'hallmark_centre_id'],
    ];
    for (const [t, c] of checks) {
      const [u] = await db.query(`SELECT id FROM ${t} WHERE ${c}=? AND is_deleted=0 LIMIT 1`, [id]);
      if (u[0]) fail('This vendor is used in transactions — mark it inactive instead of deleting');
    }
    await db.query('UPDATE fms_vendors SET is_deleted=1, updated_at=?, updated_by=? WHERE id=?', [nowIST(), req.session.userId, id]);
    res.json({ success: true });
  }));

  // ── Small lookups (quality / labs / reasons / outcomes) ──
  const SMALL = {
    quality: 'fms_quality_master', labs: 'fms_lab_master', reasons: 'fms_reason_master', outcomes: 'fms_followup_outcome',
  };
  function smallTable(kind) { const t = SMALL[kind]; if (!t) fail('Unknown master', 404); return t; }
  app.get('/api/o2d/masters/:kind', requireAuth, wrap(async (req, res) => {
    const t = smallTable(req.params.kind);
    const [rows] = await db.query(`SELECT * FROM ${t} WHERE is_deleted=0 ORDER BY name`);
    res.json(rows);
  }));
  app.post('/api/o2d/masters/:kind', requireAuth, wrap(async (req, res) => {
    const t = smallTable(req.params.kind);
    const name = str(req.body && req.body.name, 100);
    if (!name) fail('Name is required');
    await assertUniqueName(t, 'name', name);
    if (t === 'fms_followup_outcome') {
      const all = Object.values(lib.CLOSING_OUTCOMES).flat().map(x => x.toLowerCase());
      if (all.includes(name.toLowerCase())) fail(`"${name}" is a built-in closing outcome`);
    }
    const [r] = await db.query(`INSERT INTO ${t} (name, is_active, created_at, created_by, is_deleted) VALUES (?,1,?,?,0)`,
      [name, nowIST(), req.session.userId]);
    res.json({ success: true, id: r.insertId });
  }));
  app.put('/api/o2d/masters/:kind/:id', requireAuth, wrap(async (req, res) => {
    const t = smallTable(req.params.kind);
    const name = str(req.body && req.body.name, 100);
    if (!name) fail('Name is required');
    await assertUniqueName(t, 'name', name, req.params.id);
    await db.query(`UPDATE ${t} SET name=?, is_active=?, updated_at=?, updated_by=? WHERE id=?`,
      [name, req.body.is_active === undefined ? 1 : (req.body.is_active ? 1 : 0), nowIST(), req.session.userId, req.params.id]);
    res.json({ success: true });
  }));
  app.delete('/api/o2d/masters/:kind/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const t = smallTable(req.params.kind);
    await db.query(`UPDATE ${t} SET is_deleted=1, updated_at=?, updated_by=? WHERE id=?`, [nowIST(), req.session.userId, req.params.id]);
    res.json({ success: true });
  }));

  // ── Stage settings: TAT (target days) + default doer per stage ──
  app.get('/api/o2d/stage-targets', requireAuth, wrap(async (req, res) => {
    const cfg = await lib.stageConfig(db);
    res.json(cfg.list);
  }));
  app.put('/api/o2d/stage-targets', requireAuth, requireAdmin, wrap(async (req, res) => {
    const rows = Array.isArray(req.body && req.body.stages) ? req.body.stages : [];
    for (const r of rows) {
      if (!lib.STAGES.includes(r.stage_key)) continue;
      const days = int(r.target_days);
      if (days < 0 || days > 365) fail(`Target days for ${r.stage_key} must be 0–365`);
      await db.query('UPDATE fms_stage_target SET target_days=?, default_assignee_id=?, updated_at=?, updated_by=? WHERE stage_key=?',
        [days, int(r.default_assignee_id) || null, nowIST(), req.session.userId, r.stage_key]);
    }
    res.json({ success: true });
  }));
};
