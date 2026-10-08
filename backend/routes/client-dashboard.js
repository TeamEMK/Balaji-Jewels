// ══════════════════════════════════════════════════════
// CLIENT DASHBOARD — "NEW Combined O2D" Google Sheet se client-wise order
// stats (total/pending/complete/cancelled/delivered + bagging) + har client
// ke individual orders ki full list. Admin/PC ke liye.
//
// Sheet ka structure (live verify kiya gaya):
//   Rows 1-5  — ek manual summary/legend block (is route me use nahi hota)
//   Row 6     — asli header row
//   Row 7+    — har row ek order:
//     A=Timestamp  B=Unique ID  C=Order No  D=Client Name  E=No Of Pcs
//     F=Owner Name  G=Last Step Status  H=FMS Status ('Complete'/'Pending')
//     I=Order Status ('Confirm'/'Order Cancelled'/'Pending')
//     J=Order Type ('Customer Order'/'Stock Order')  Y=Delivery Date
//     DL=Pcs Bagging Done  DM=Balance Pcs  DN=Pcs Cancel/Rejected
//     DO=Bagging Status
//   (Bagging quartet "Step 4" wala liya — sheet me 2 aur duplicate bagging
//   blocks (EG-EK "Step 8", aur EZ-FY) bhi hain, par wo dusra sirf 46 aur
//   teesra/chautha sirf 0-1 orders me bhare hain — DL-DO wala hi asal me
//   use hota hai, 221-225 of 908 me bhara hai.)
//
// "Vendor": is sheet me 'Vendor Name' column (sabse last column) 908 me se
// sirf 1 row me bhara mila — isliye alag "vendor" field nahi banaya. User
// ne khud confirm kiya ki vendor = Client Name (col D) hi hai is business
// me, isliye client-level complete/pending yahi represent karta hai.
//
// "Delivered": Delivery Date (col Y) sirf 339 of 908 orders me bhari hai
// (Complete orders me se bhi sirf ~38%) — isliye ye poora-bharosemand
// "delivered" signal nahi hai. Isko alag se "Delivery Date Recorded" naam
// se clearly label kiya hai, FMS Status ke Complete count se confuse na ho.
//
// "Cancelled": FMS Status me cancelled orders bhi 'Complete' hi dikhte hain
// (process band ho gaya matlab) — asli cancel-flag Order Status column (I)
// me 'Order Cancelled' se pata chalta hai. Isliye Completed count usse
// overlap karta hai (Completed = FMS-complete, jisme cancelled bhi included
// hain) — Cancelled ek ALAG, extra stat hai, Completed ko redefine nahi kiya.
// ══════════════════════════════════════════════════════

const SPREADSHEET_ID = '1zn5wod98fd6Aagd0sPXAyH_SGOxfXR505BbIcQlewwU';
// Row 7 se data shuru — generous upper bound (abhi 908 orders hain, order
// badhenge to bhi cover ho jaaye). DO tak taaki bagging quartet bhi mile.
const DATA_RANGE = 'Sheet1!A7:DO5000';

module.exports = function registerClientDashboardRoutes(app, ctx) {
  const { requireAuth, requireAdminOrPC } = ctx;
  const { getSheetsClient } = require('../lib/google');

  app.get('/api/client-dashboard', requireAuth, requireAdminOrPC, async (req, res) => {
    try {
      const sheets = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: DATA_RANGE });
      const rows = r.data.values || [];

      const clientsMap = {};
      let totalOrders = 0, pendingOrders = 0, completedOrders = 0, otherOrders = 0,
          deliveredOrders = 0, cancelledOrders = 0;

      for (const row of rows) {
        const clientName = (row[3] || '').trim();
        if (!clientName) continue; // khaali row — skip
        const fmsStatus = (row[7] || '').trim();
        const orderStatus = (row[8] || '').trim();
        const deliveryDate = (row[24] || '').trim(); // col Y
        const isCancelled = /cancel/i.test(orderStatus);
        totalOrders++;
        if (!clientsMap[clientName]) {
          clientsMap[clientName] = {
            name: clientName, total: 0, pending: 0, completed: 0, other: 0,
            delivered: 0, cancelled: 0, received: 0,
            orders: [],
          };
        }
        const c = clientsMap[clientName];
        c.total++;
        c.received++; // har row = ek order receive hua (order intake count)
        let statusKey;
        if (/^complete$/i.test(fmsStatus)) { completedOrders++; c.completed++; statusKey = 'completed'; }
        else if (/^pending$/i.test(fmsStatus)) { pendingOrders++; c.pending++; statusKey = 'pending'; }
        else { otherOrders++; c.other++; statusKey = 'other'; }
        if (deliveryDate) { deliveredOrders++; c.delivered++; }
        if (isCancelled) { cancelledOrders++; c.cancelled++; }

        c.orders.push({
          uniqueId: row[1] || '',
          orderNo: row[2] || '',
          pcs: row[4] || '',
          lastStepStatus: row[6] || '',
          fmsStatus: fmsStatus || '',
          orderStatus,
          orderType: (row[9] || '').trim(),
          deliveryDate,
          timestamp: row[0] || '',
          statusKey,
          isCancelled,
          pcsBaggingDone: row[115] || '',   // DL
          balancePcs: row[116] || '',       // DM
          pcsCancelRejected: row[117] || '', // DN
          baggingStatus: row[118] || '',    // DO
        });
      }

      const clients = Object.values(clientsMap).sort((a, b) => b.total - a.total);
      const clientsComplete = clients.filter(c => c.pending === 0 && c.other === 0).length;
      const clientsPending = clients.length - clientsComplete;

      res.json({
        totals: {
          orders: totalOrders,
          pendingOrders, completedOrders, otherOrders, deliveredOrders, cancelledOrders,
          receivedOrders: totalOrders,
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
