// ══════════════════════════════════════════════════════
// CLIENT DASHBOARD — "NEW Combined O2D" Google Sheet se client-wise order
// stats (total/pending/complete) nikal ke dikhata hai. Admin/PC ke liye.
//
// Sheet ka structure (live verify kiya gaya):
//   Rows 1-5  — ek manual summary/legend block (is route me use nahi hota)
//   Row 6     — asli header row
//   Row 7+    — har row ek order: A=Timestamp, B=Unique ID, C=Order No,
//               D=Client Name, E=No Of Pcs, F=Owner Name, G=Last Step
//               Status, H=FMS Status ('Complete' ya 'Pending', bas do hi
//               values hain)
//
// "Vendor": is sheet me 'Vendor Name' column (sabse last column) 908 me se
// sirf 1 row me bhara mila — isliye alag "vendor" field nahi banaya. User
// ne khud confirm kiya ki vendor = Client Name (col D) hi hai is business
// me, isliye client-level complete/pending yahi represent karta hai.
// ══════════════════════════════════════════════════════

const SPREADSHEET_ID = '1zn5wod98fd6Aagd0sPXAyH_SGOxfXR505BbIcQlewwU';
// Row 7 se data shuru, D=Client Name, H=FMS Status — generous upper bound
// (abhi 908 orders hain, order type badhega to bhi cover ho jaaye).
const DATA_RANGE = 'Sheet1!A7:H5000';

module.exports = function registerClientDashboardRoutes(app, ctx) {
  const { requireAuth, requireAdminOrPC } = ctx;
  const { getSheetsClient } = require('../lib/google');

  app.get('/api/client-dashboard', requireAuth, requireAdminOrPC, async (req, res) => {
    try {
      const sheets = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: DATA_RANGE });
      const rows = r.data.values || [];

      const clientsMap = {};
      let totalOrders = 0, pendingOrders = 0, completedOrders = 0, otherOrders = 0;

      for (const row of rows) {
        const clientName = (row[3] || '').trim();
        if (!clientName) continue; // khaali row — skip
        const fmsStatus = (row[7] || '').trim();
        totalOrders++;
        if (!clientsMap[clientName]) {
          clientsMap[clientName] = { name: clientName, total: 0, pending: 0, completed: 0, other: 0 };
        }
        const c = clientsMap[clientName];
        c.total++;
        if (/^complete$/i.test(fmsStatus)) { completedOrders++; c.completed++; }
        else if (/^pending$/i.test(fmsStatus)) { pendingOrders++; c.pending++; }
        else { otherOrders++; c.other++; } // koi aur/khaali status — abhi tak sheet me nahi dekha, par safety ke liye
      }

      const clients = Object.values(clientsMap).sort((a, b) => b.total - a.total);
      const clientsComplete = clients.filter(c => c.pending === 0 && c.other === 0).length;
      const clientsPending = clients.length - clientsComplete;

      res.json({
        totals: {
          orders: totalOrders,
          pendingOrders, completedOrders, otherOrders,
          totalClients: clients.length,
          clientsComplete, clientsPending,
        },
        clients,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load client dashboard: ' + err.message });
    }
  });
};
