// ══════════════════════════════════════════════════════
// GOLD LEDGER — per-client, weight-based (18K/14K/9K), Fix/Unfix status,
// running balance. Client ka gold "Unfix" hota hai jab tak rate lock (Fix)
// na ho — tab tak sirf WEIGHT pata hota hai, ₹ amount nahi. Fix hone par
// weight × rate se ₹ amount ban jaata hai.
//
// Kai columns (purity %, "PG Gold WT" ka matlab, running-balance ka exact
// business formula) abhi tak user se confirm nahi hue the — isliye:
//   - Purity % ek settings (app_settings) me hai, admin badal sakta hai
//     bina code chhue (default: standard 18K=75%, 14K=58.33%, 9K=37.5%)
//   - Pure weight chahe to per-entry manually override bhi ho sakta hai
//     (pure_wt_override) — agar auto-calculate formula thoda bhi off ho
//   - Gold weight running balance ka direction (add/subtract) har entry
//     par explicit hai — "Recvd Gold" jaisi entry positive weight ke
//     saath likhi jaati hai par balance GHATATI hai, isliye guess nahi
//     karte, admin batata hai.
// ══════════════════════════════════════════════════════

const DEFAULT_PURITY = { p18: 0.75, p14: 0.5833, p9: 0.375 };

module.exports = function registerGoldLedgerRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  async function getPurity() {
    const [rows] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['gold_ledger_purity']);
    if (!rows[0]) return { ...DEFAULT_PURITY };
    try { return { ...DEFAULT_PURITY, ...JSON.parse(rows[0].value) }; } catch (e) { return { ...DEFAULT_PURITY }; }
  }

  function pureWt(e, purity) {
    if (e.pure_wt_override != null) return parseFloat(e.pure_wt_override);
    return (parseFloat(e.gold_wt_18k) || 0) * purity.p18
         + (parseFloat(e.gold_wt_14k) || 0) * purity.p14
         + (parseFloat(e.gold_wt_9k) || 0) * purity.p9;
  }

  // ── Purity % settings ──
  app.get('/api/gold-ledger/purity', requireAuth, requireAdmin, async (req, res) => {
    try { res.json(await getPurity()); }
    catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/gold-ledger/purity', requireAuth, requireAdmin, async (req, res) => {
    try {
      const p18 = parseFloat(req.body.p18), p14 = parseFloat(req.body.p14), p9 = parseFloat(req.body.p9);
      if ([p18, p14, p9].some(v => isNaN(v) || v < 0 || v > 1)) return res.status(400).json({ error: 'Purity must be a fraction between 0 and 1 (e.g. 0.75 for 75%)' });
      await db.query(
        `INSERT INTO app_settings (key_name,value) VALUES (?,?) ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value`,
        ['gold_ledger_purity', JSON.stringify({ p18, p14, p9 })]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── List — ek client ki poori ledger, date order me, running balance ke saath ──
  app.get('/api/gold-ledger/:clientId', requireAuth, requireAdmin, async (req, res) => {
    try {
      const purity = await getPurity();
      const [rows] = await db.query(
        `SELECT *, TO_CHAR(entry_date,'YYYY-MM-DD') AS entry_date_iso FROM gold_ledger_entries WHERE client_user_id=? ORDER BY entry_date ASC, id ASC`,
        [req.params.clientId]);

      let runningGoldBal = 0, runningDiaBal = 0, cumSaleAmt = 0, cumSaleWt = 0;
      const out = rows.map(e => {
        const wt = pureWt(e, purity);
        const totalWt = (parseFloat(e.gold_wt_18k) || 0) + (parseFloat(e.gold_wt_14k) || 0) + (parseFloat(e.gold_wt_9k) || 0);
        const goldAmount = parseFloat(e.gold_amount) || 0;
        const diaAmount = parseFloat(e.diamond_labour_amount) || 0;
        const recvdDia = parseFloat(e.recvd_against_dia_labour) || 0;
        const recvdGold = parseFloat(e.recvd_against_gold) || 0;

        runningGoldBal += (e.balance_direction === 'subtract' ? -wt : wt);
        runningDiaBal += (diaAmount - recvdDia);
        // Avg rate sirf FIXED + counts_as_sale entries se — unfixed ka gold_amount 0 hota hai,
        // use ginne se average galat ho jaata (weight jud jaata, amount nahi).
        if (e.fix_status === 'fixed' && e.counts_as_sale && wt > 0) { cumSaleAmt += goldAmount; cumSaleWt += wt; }
        const avgRate = cumSaleWt > 0 ? cumSaleAmt / cumSaleWt : null;
        const goldAmtRunningBal = avgRate != null ? runningGoldBal * avgRate : null;
        const totalDrCr = (goldAmtRunningBal || 0) + runningDiaBal;

        return {
          id: e.id, entryDate: e.entry_date_iso, particular: e.particular,
          gold18k: parseFloat(e.gold_wt_18k) || 0, gold14k: parseFloat(e.gold_wt_14k) || 0, gold9k: parseFloat(e.gold_wt_9k) || 0,
          totalWt: Math.round(totalWt * 1000) / 1000, pureWt: Math.round(wt * 1000) / 1000,
          pureWtOverride: e.pure_wt_override != null ? parseFloat(e.pure_wt_override) : null,
          fixStatus: e.fix_status, goldRate: e.gold_rate != null ? parseFloat(e.gold_rate) : null,
          goldAmount, diaAmount, total: Math.round((goldAmount + diaAmount) * 100) / 100,
          recvdDia, recvdGold, pgGoldWt: e.pg_gold_wt != null ? parseFloat(e.pg_gold_wt) : null,
          balanceDirection: e.balance_direction, countsAsSale: !!e.counts_as_sale, note: e.note || '',
          // running snapshots (is row ke baad ka balance)
          balanceGoldWt: Math.round(runningGoldBal * 1000) / 1000,
          diaBalanceToTake: Math.round(runningDiaBal * 100) / 100,
          avgGoldRateSold: avgRate != null ? Math.round(avgRate * 100) / 100 : null,
          goldAmtRunningBal: goldAmtRunningBal != null ? Math.round(goldAmtRunningBal * 100) / 100 : null,
          totalDrCr: Math.round(totalDrCr * 100) / 100,
        };
      });
      res.json({ purity, entries: out });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Add entry ──
  app.post('/api/gold-ledger', requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body;
      if (!b.clientUserId || !b.entryDate) return res.status(400).json({ error: 'Client and date required' });
      await db.query(
        `INSERT INTO gold_ledger_entries
         (client_user_id,entry_date,particular,gold_wt_18k,gold_wt_14k,gold_wt_9k,pure_wt_override,
          fix_status,gold_rate,gold_amount,diamond_labour_amount,recvd_against_dia_labour,recvd_against_gold,
          pg_gold_wt,balance_direction,counts_as_sale,note,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.clientUserId, b.entryDate, (b.particular || 'Sale Bill').trim(),
         b.gold18k || 0, b.gold14k || 0, b.gold9k || 0, b.pureWtOverride || null,
         b.fixStatus === 'fixed' ? 'fixed' : 'unfixed', b.goldRate || null, b.goldAmount || 0,
         b.diaAmount || 0, b.recvdDia || 0, b.recvdGold || 0, b.pgGoldWt || null,
         b.balanceDirection === 'subtract' ? 'subtract' : 'add', b.countsAsSale === false ? 0 : 1,
         (b.note || '').trim(), req.session.userId]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Edit entry ──
  app.put('/api/gold-ledger/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body;
      await db.query(
        `UPDATE gold_ledger_entries SET
           entry_date=?, particular=?, gold_wt_18k=?, gold_wt_14k=?, gold_wt_9k=?, pure_wt_override=?,
           fix_status=?, gold_rate=?, gold_amount=?, diamond_labour_amount=?, recvd_against_dia_labour=?,
           recvd_against_gold=?, pg_gold_wt=?, balance_direction=?, counts_as_sale=?, note=?
         WHERE id=?`,
        [b.entryDate, (b.particular || 'Sale Bill').trim(), b.gold18k || 0, b.gold14k || 0, b.gold9k || 0, b.pureWtOverride || null,
         b.fixStatus === 'fixed' ? 'fixed' : 'unfixed', b.goldRate || null, b.goldAmount || 0,
         b.diaAmount || 0, b.recvdDia || 0, b.recvdGold || 0, b.pgGoldWt || null,
         b.balanceDirection === 'subtract' ? 'subtract' : 'add', b.countsAsSale === false ? 0 : 1,
         (b.note || '').trim(), req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Fix — unfixed entry ki weight par rate lock karo, ₹ amount ban jaaye ──
  app.put('/api/gold-ledger/:id/fix', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rate = parseFloat(req.body.goldRate);
      if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'Valid gold rate required (₹ per gram of pure weight)' });
      const [rows] = await db.query('SELECT * FROM gold_ledger_entries WHERE id=?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
      const purity = await getPurity();
      const wt = pureWt(rows[0], purity);
      const amount = Math.round(wt * rate * 100) / 100;
      await db.query(`UPDATE gold_ledger_entries SET fix_status='fixed', gold_rate=?, gold_amount=? WHERE id=?`, [rate, amount, req.params.id]);
      res.json({ success: true, pureWt: wt, goldAmount: amount });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── Delete ──
  app.delete('/api/gold-ledger/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      await db.query('DELETE FROM gold_ledger_entries WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });
};
