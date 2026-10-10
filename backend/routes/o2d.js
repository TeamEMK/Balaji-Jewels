// ══════════════════════════════════════════════════════
// ORDER-TO-DISPATCH FMS — route registrar (/api/o2d/*)
// ──────────────────────────────────────────────────────
// Spec /api/fms kehta hai, par wo prefix is app me pehle se Google-Sheet wale
// FMS ke paas hai (/api/fms/:id ...). Takrav se bachne ke liye /api/o2d.
// Saare routes requireAuth ke peeche; 'client' role requireAuth ki allowlist
// se hi bahar ho jaata hai.
// ══════════════════════════════════════════════════════
const lib = require('../lib/o2d');

module.exports = function registerO2DRoutes(app, ctx) {
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof lib.O2DError) return res.status(e.status).json({ error: e.message });
      console.error('O2D error:', req.method, req.path, e);
      if (!res.headersSent) res.status(500).json({ error: 'Server error. Please try again.' });
    }
  };
  const isAdmin = (req) => req.session.role === 'admin';
  const shared = { ...ctx, lib, wrap, isAdmin };

  require('./o2d-masters')(app, shared);
  require('./o2d-orders')(app, shared);
  require('./o2d-production')(app, shared);
  require('./o2d-sales')(app, shared);
  require('./o2d-reports')(app, shared);
};
