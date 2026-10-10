// ══════════════════════════════════════════════════════
// O2D FMS — Demo data loader (admin, Masters page)
// ──────────────────────────────────────────────────────
// 16 sample orders har stage par — browser se asli API ke through, ek-ek
// step, jaise koi haath se banata. Isliye status / follow-up / bagging /
// invoice ginti sab sahi rehti hai. Koi step fail ho to screen par wahi
// step + server ka message dikhta hai, aur aadha bana demo apne aap hat jaata.
// Hatana: "Remove demo data" (DELETE /api/o2d/demo) — sirf "DEMO - " wale.
// ══════════════════════════════════════════════════════
(function () {
  'use strict';
  const O2D = window.O2D;
  const { $, h } = O2D;
  const PNG_HEX = '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6300010000050001A5F645400000000049454E44AE426082';
  const pngFile = (name) => {
    const bytes = new Uint8Array(PNG_HEX.match(/../g).map(x => parseInt(x, 16)));
    return new File([bytes], name, { type: 'image/png' });
  };

  // Masters page ki patti (admin)
  O2D.demoBar = async () => {
    if (!O2D.lk.isAdmin) return '';
    const d = await api('/api/o2d/demo');
    if (!d || d.error) return '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--muted);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12.5px">
      <div>🧪 <b>Demo data</b> — ${d.loaded ? `${d.orders} demo orders loaded (clients / vendors starting with "DEMO - ").` : 'load 16 sample orders at every stage to try the system.'}</div>
      ${d.loaded ? '<button class="btn btn-outline btn-sm" style="color:var(--destructive)" onclick="O2D.demoRemove()">🗑 Remove demo data</button>'
        : '<button class="btn btn-primary btn-sm" onclick="O2D.demoLoad()">+ Load demo data (16 orders)</button>'}</div>`;
  };

  O2D.demoRemove = async () => {
    if (!await confirmDialog('All "DEMO - " clients and vendors, with their orders, invoices, payments and follow-ups, will be permanently deleted. Your real data is not touched.',
      { title: 'Remove demo data?', okText: 'Yes, remove', danger: true })) return;
    const r = await api('/api/o2d/demo', 'DELETE');
    if (r.error) return showToast(r.error, 'error');
    showToast(`Demo data removed — ${r.orders} orders`);
    await O2D.loadLookups(true); O2D.refreshBadge(); O2D.refresh();
  };

  O2D.demoLoad = async () => {
    if (!await confirmDialog('This adds 3 demo clients, 4 demo vendors and 16 demo orders — CAD, approval, quotation, hold, bagging, shortfall, at vendor, hallmark, lab, ready, dispatched, paid and cancelled. You can remove them later from here.',
      { title: 'Load demo data?', okText: 'Load' })) return;
    O2D.modal({ title: 'Loading demo data…', footer: false, width: 460,
      html: `<div style="font-size:13px;line-height:1.7"><div id="o2dDemoStep">Starting…</div>
        <div style="height:8px;background:var(--muted);border-radius:99px;overflow:hidden;margin-top:10px"><div id="o2dDemoBar" style="height:100%;width:0;background:var(--primary);transition:width .2s"></div></div>
        <div style="font-size:11.5px;color:var(--muted-foreground);margin-top:8px">Please keep this page open (about a minute).</div></div>` });
    let stepNo = 0; const TOTAL = 150;
    const show = (label) => {
      stepNo++;
      const s = $('o2dDemoStep'); if (s) s.textContent = label;
      const b = $('o2dDemoBar'); if (b) b.style.width = Math.min(100, Math.round(stepNo / TOTAL * 100)) + '%';
    };
    const call = async (label, url, method = 'GET', body = null) => {
      show(label);
      const r = await api(url, method, body);
      if (!r || r.error) throw new Error(`${label} — ${(r && r.error) || 'no response'}`);
      return r;
    };
    const upload = async (label, orderId, name, type, refTable, refId) => {
      show(label);
      try { return await O2D.upload(orderId, pngFile(name), type, refTable, refId); } catch (e) { throw new Error(`${label} — ${e.message}`); }
    };
    const made = [];
    try {
      const existing = await call('Checking existing demo data', '/api/o2d/demo');
      if (existing.loaded) throw new Error('Demo data is already loaded — remove it first');
      const lk = await call('Reading masters', '/api/o2d/lookups');
      const me = lk.me || (window.ME && ME.id);
      const quality = (lk.quality.find(x => x.is_active) || lk.quality[0] || {}).id;
      const lab = (n) => (lk.labs.find(l => l.name === n && l.is_active) || lk.labs.find(l => l.is_active) || {}).id;
      if (!quality || !lab('IGI')) throw new Error('Add at least one Quality and one Lab in Masters first');
      const reason = (lk.reasons.find(r => r.name === 'Client Dropped') || lk.reasons[0] || { name: 'Client Dropped' }).name;
      const today = O2D.today();
      const plus = (n) => O2D.addDays(today, n);

      // ── Masters ──
      const cust = {};
      for (const [k, c] of Object.entries({
        shree: { client_name: 'DEMO - Shree Jewellers', company_name: 'Shree Jewellers Pvt Ltd', contact_number: '9800000001', city: 'Jaipur', state: 'Rajasthan',
          labour_rate: 550, labour_rate_basis: 'Per Gram', gold_tunch_pct: 76, certificate_required: 1, default_lab_id: lab('IGI'), payment_terms_days: 30, payment_style: 'Category-wise' },
        ratna: { client_name: 'DEMO - Ratna Gems', company_name: 'Ratna Gems', contact_number: '9800000002', city: 'Mumbai', state: 'Maharashtra',
          labour_rate: 450, labour_rate_basis: 'Per Gram', gold_tunch_pct: 75, certificate_required: 0, payment_terms_days: 45, payment_style: 'Invoice-wise' },
        kalash: { client_name: 'DEMO - Kalash Jewels', company_name: 'Kalash Jewels LLP', contact_number: '9800000003', city: 'Surat', state: 'Gujarat',
          labour_rate: 500, labour_rate_basis: 'Per Gram', gold_tunch_pct: 91.6, certificate_required: 1, default_lab_id: lab('GIA'), payment_terms_days: 30, payment_style: 'Invoice-wise' },
      })) {
        cust[k] = (await call(`Creating client ${c.client_name}`, '/api/o2d/customers', 'POST', { ...c, quality_id: quality, sales_person_id: me, is_active: 1 })).id;
      }
      const v = {};
      for (const [k, name, type, days] of [['cad', 'CAD Studio', 'CAD', 5], ['dia', 'Diamond Supplier', 'Diamond Supplier', 3],
        ['fg', 'Karigar Workshop', 'Manufacturing (FG)', 15], ['hm', 'Hallmark Centre', 'Hallmarking', 2]]) {
        v[k] = (await call(`Creating vendor DEMO - ${name}`, '/api/o2d/vendors', 'POST', { vendor_name: 'DEMO - ' + name, vendor_type: type,
          contact_number: '9800000100', city: 'Mumbai', default_lead_time_days: days, is_active: 1 })).id;
      }

      // ── Helpers ──
      const order = async (label, o) => {
        const body = { sales_person_id: me, owner_id: me, order_type: 'Customer Order', development_type: 'From Existing Stock', quality_id: quality,
          lead_time_days: 20, delivery_date: plus(20), certificate_required: 0, lab_id: null,
          diamond_lines: [{ shape: 'Round', sieve_size: '+2-4', pcs: 120, carat: 1.8 }], ...o };
        if (body.lead_time_days !== 20 && !o.delivery_date) body.delivery_date = plus(body.lead_time_days);
        const r = await call(`${label}: creating order`, '/api/o2d/orders', 'POST', body);
        if (body.development_type === 'New Development') await upload(`${label}: design photo`, r.id, 'design.png', 'design_photo');
        await call(`${label}: submitting`, `/api/o2d/orders/${r.id}/submit`, 'POST', {});
        made.push(r.order_no);
        return r.id;
      };
      const confirm = async (label, id, amount) => {
        await call(`${label}: quotation posted`, `/api/o2d/orders/${id}/quotation-posted`, 'PUT', { quotation_amount: amount, quotation_remark: 'Demo quotation' });
        await call(`${label}: client confirmed`, `/api/o2d/orders/${id}/confirmation`, 'PUT', { decision: 'Confirmed', reason: 'Demo — confirmed on call' });
      };
      const toBagging = async (label, id, amount) => {
        await confirm(label, id, amount);
        await call(`${label}: handover to production`, `/api/o2d/orders/${id}/handover`, 'POST', { handed_over_to: me });
        const d = await call(`${label}: reading bagging`, `/api/o2d/orders/${id}`);
        await call(`${label}: verifying order sheet`, `/api/o2d/bagging/${d.bagging.id}/verify`, 'PUT', { ok: true, remark: 'Demo — details OK' });
        return d.bagging.id;
      };
      const bagAll = async (label, id, pcs, amount) => {
        const bag = await toBagging(label, id, amount);
        await call(`${label}: bagging ${pcs} pcs`, `/api/o2d/bagging/${bag}/entries`, 'POST', { bagged_pcs: pcs });
      };
      let ivNo = 0;
      const issue = async (label, customerId, id, pcs, wt) => {
        ivNo++;
        await call(`${label}: issue to karigar`, '/api/o2d/issues', 'POST', { customer_id: customerId, vendor_id: v.fg, issue_date: today,
          issue_invoice_no: 'DEMO-IV-' + ivNo, expected_return_date: plus(12), lines: [{ order_id: id, issued_pcs: pcs, issued_weight_gm: wt }] });
      };
      let vbNo = 0;
      const receive = async (label, id, pcs, wt, wastage, hallmarked) => {
        const pl = await call(`${label}: reading vendor lines`, `/api/o2d/receipts/pending-lines?vendorId=${v.fg}`);
        const line = pl.find(l => l.order_id === id);
        if (!line) throw new Error(`${label} — issue line not found`);
        vbNo++;
        await call(`${label}: receive from karigar`, '/api/o2d/receipts', 'POST', { vendor_id: v.fg, receipt_date: today, vendor_invoice_no: 'DEMO-VB-' + vbNo,
          vendor_invoice_date: today, lines: [{ issue_line_id: line.id, received_pcs: pcs, received_weight_gm: wt, wastage_weight_gm: wastage, hallmark_done: hallmarked ? 1 : 0 }] });
      };
      let invNo = 0;
      const dispatch = async (label, customerId, id, pcs, wt, amount, cats) => {
        invNo++;
        const r = await call(`${label}: dispatch & invoice`, '/api/o2d/dispatch', 'POST', { customer_id: customerId, invoice_no: 'DEMO-INV-' + invNo, invoice_date: today,
          invoice_amount: amount, ...(cats || {}), dispatch_date: today, courier: 'Demo Courier', awb_no: 'DEMO' + (1000 + invNo),
          lines: [{ order_id: id, pcs, weight_gm: wt, line_amount: amount }] });
        await upload(`${label}: invoice file`, id, `demo-invoice-${invNo}.png`, 'invoice', 'fms_dispatch', r.id);
        return r.id;
      };

      // 1) New design — CAD requested, vendor gave a new date
      const o1 = await order('Order 1 (Ring)', { client_id: cust.shree, style_no: 'DM-RING-101', development_type: 'New Development', qty_pcs: 12,
        diamond_carat_weight: 2.4, certificate_required: 1, lab_id: lab('IGI'), remark: 'Demo: 18kt rose gold ladies ring' });
      await call('Order 1: request CAD', `/api/o2d/orders/${o1}/cad`, 'POST', { cad_vendor_id: v.cad, brief: 'Same as design photo, band 2mm' });
      const fu1 = await call('Order 1: reading follow-up', `/api/o2d/followups?tab=all&mine=0&order_id=${o1}`);
      if (fu1[0]) await call('Order 1: follow-up call', `/api/o2d/followups/${fu1[0].id}/log`, 'POST', { mode: 'Call', outcome: 'Delay - New Date Given', next_followup_date: plus(2), remark: 'Demo: vendor needs 2 more days' });

      // 2) New design — CAD received, sent to client for approval
      const o2 = await order('Order 2 (Pendant)', { client_id: cust.shree, style_no: 'DM-PEND-202', development_type: 'New Development', qty_pcs: 8,
        diamond_carat_weight: 1.6, certificate_required: 1, lab_id: lab('IGI'), lead_time_days: 25, remark: 'Demo: pendant with pear centre' });
      const cad2 = await call('Order 2: request CAD', `/api/o2d/orders/${o2}/cad`, 'POST', { cad_vendor_id: v.cad });
      await call('Order 2: CAD received', `/api/o2d/cad/${cad2.id}/receive`, 'PUT', {});
      await call('Order 2: CAD sent for approval', `/api/o2d/cad/${cad2.id}/send-approval`, 'PUT', { channel: 'WhatsApp' });

      // 3) New design — client rejected CAD, revision 2 requested
      const o3 = await order('Order 3 (Bracelet)', { client_id: cust.kalash, style_no: 'DM-BRAC-303', development_type: 'New Development', qty_pcs: 5,
        diamond_carat_weight: 3.1, certificate_required: 1, lab_id: lab('GIA'), lead_time_days: 30, remark: 'Demo: tennis bracelet' });
      const cad3 = await call('Order 3: request CAD', `/api/o2d/orders/${o3}/cad`, 'POST', { cad_vendor_id: v.cad });
      await call('Order 3: CAD received', `/api/o2d/cad/${cad3.id}/receive`, 'PUT', {});
      await call('Order 3: CAD sent for approval', `/api/o2d/cad/${cad3.id}/send-approval`, 'PUT', { channel: 'Email' });
      await call('Order 3: client rejected CAD', `/api/o2d/cad/${cad3.id}/decision`, 'PUT', { decision: 'Rejected', reason: 'Demo: make the clasp smaller' });

      // 4) Quotation posted, waiting for client
      const o4 = await order('Order 4 (Earrings)', { client_id: cust.ratna, style_no: 'DM-EAR-404', qty_pcs: 20, diamond_carat_weight: 3.2, remark: 'Demo: stud earrings pairs' });
      await call('Order 4: quotation posted', `/api/o2d/orders/${o4}/quotation-posted`, 'PUT', { quotation_amount: 120000, quotation_remark: 'Demo quotation on WhatsApp group' });

      // 5) Client put on hold
      const o5 = await order('Order 5 (Mangalsutra)', { client_id: cust.kalash, style_no: 'DM-MANG-505', qty_pcs: 6, diamond_carat_weight: 1.1, certificate_required: 1, lab_id: lab('GIA'), remark: 'Demo: mangalsutra' });
      await call('Order 5: quotation posted', `/api/o2d/orders/${o5}/quotation-posted`, 'PUT', { quotation_amount: 68000 });
      await call('Order 5: client put on hold', `/api/o2d/orders/${o5}/confirmation`, 'PUT', { decision: 'Hold', reason: 'Demo: client travelling, call next week', next_followup_date: plus(7) });

      // 6) Confirmed — order sheet ready, not yet handed over
      const o6 = await order('Order 6 (Nose pin)', { client_id: cust.ratna, style_no: 'DM-NOSE-606', qty_pcs: 30, diamond_carat_weight: 0.9, remark: 'Demo: nose pins' });
      await confirm('Order 6', o6, 42000);

      // 7) Bagging in progress
      const o7 = await order('Order 7 (Bangles)', { client_id: cust.ratna, style_no: 'DM-BANG-707', qty_pcs: 10, diamond_carat_weight: 4.5, lead_time_days: 15, remark: 'Demo: bangle pairs' });
      const bag7 = await toBagging('Order 7', o7, 210000);
      await call('Order 7: bagging 6 pcs (1 rejected)', `/api/o2d/bagging/${bag7}/entries`, 'POST', { bagged_pcs: 6, rejected_pcs: 1, rejection_reason: 'Chipped stone', bagged_carat: 2.7 });

      // 8) Bagging shortfall — material asked from diamond supplier
      const o8 = await order('Order 8 (Kada)', { client_id: cust.shree, style_no: 'DM-KADA-808', qty_pcs: 8, diamond_carat_weight: 2.2, certificate_required: 1, lab_id: lab('IGI'), remark: 'Demo: gents kada' });
      const bag8 = await toBagging('Order 8', o8, 160000);
      await call('Order 8: bagging 5 pcs', `/api/o2d/bagging/${bag8}/entries`, 'POST', { bagged_pcs: 5 });
      await call('Order 8: short material requirement', '/api/o2d/requirements', 'POST', { bagging_id: bag8, vendor_id: v.dia, required_pcs: 3, required_by_date: plus(3),
        shape: 'Round', size: '+2-4', remark: 'Demo: 3 pcs short' });

      // 9) At karigar
      const o9 = await order('Order 9 (Chain)', { client_id: cust.shree, style_no: 'DM-CHAIN-909', qty_pcs: 6, diamond_carat_weight: 1.2, certificate_required: 1, lab_id: lab('IGI'), remark: 'Demo: diamond chain' });
      await bagAll('Order 9', o9, 6, 140000);
      await issue('Order 9', cust.shree, o9, 6, 42.5);

      // 10) Part received from karigar
      const o10 = await order('Order 10 (Tops)', { client_id: cust.ratna, style_no: 'DM-TOPS-1010', qty_pcs: 10, diamond_carat_weight: 1.5, remark: 'Demo: tops' });
      await bagAll('Order 10', o10, 10, 90000);
      await issue('Order 10', cust.ratna, o10, 10, 35);
      await receive('Order 10', o10, 4, 13.8, 0.2, true);

      // 11) Received, hallmarking pending
      const o11 = await order('Order 11 (Ring set)', { client_id: cust.kalash, style_no: 'DM-RSET-1111', qty_pcs: 4, diamond_carat_weight: 2.0, certificate_required: 1, lab_id: lab('GIA'), remark: 'Demo: couple ring set' });
      await bagAll('Order 11', o11, 4, 115000);
      await issue('Order 11', cust.kalash, o11, 4, 18);
      await receive('Order 11', o11, 4, 17.6, 0.4, false);

      // 12) Hallmarked, at lab for certification
      const o12 = await order('Order 12 (Pendant set)', { client_id: cust.shree, style_no: 'DM-PSET-1212', qty_pcs: 5, diamond_carat_weight: 2.8, certificate_required: 1, lab_id: lab('IGI'), remark: 'Demo: pendant set' });
      await bagAll('Order 12', o12, 5, 175000);
      await issue('Order 12', cust.shree, o12, 5, 30);
      await receive('Order 12', o12, 5, 29.4, 0.6, true);
      await call('Order 12: sent to lab', '/api/o2d/lab-jobs', 'POST', { order_id: o12, lab_id: lab('IGI'), pcs_sent: 5, lab_challan_no: 'DEMO-LAB-1' });

      // 13) Ready for dispatch
      const o13 = await order('Order 13 (Ring)', { client_id: cust.ratna, style_no: 'DM-RING-1313', qty_pcs: 3, diamond_carat_weight: 0.75, lead_time_days: 10, remark: 'Demo: solitaire rings' });
      await bagAll('Order 13', o13, 3, 85000);
      await issue('Order 13', cust.ratna, o13, 3, 12);
      await receive('Order 13', o13, 3, 11.7, 0.3, true);

      // 14) Dispatched, part payment received
      const o14 = await order('Order 14 (Necklace)', { client_id: cust.ratna, style_no: 'DM-NECK-1414', qty_pcs: 4, diamond_carat_weight: 2.0, lead_time_days: 5, remark: 'Demo: necklace sets' });
      await bagAll('Order 14', o14, 4, 185000);
      await issue('Order 14', cust.ratna, o14, 4, 60);
      await receive('Order 14', o14, 4, 58.8, 1.2, true);
      const d14 = await dispatch('Order 14', cust.ratna, o14, 4, 58.8, 185000, { gold_amount: 110000, diamond_amount: 60000, labour_amount: 15000 });
      await call('Order 14: part payment', '/api/o2d/payments', 'POST', { customer_id: cust.ratna, receipt_date: today, amount_received: 75000, payment_mode: 'NEFT',
        reference_no: 'DEMO-UTR-1', receipt_mode: 'Invoice-wise', allocations: [{ dispatch_id: d14, amount: 75000 }], remark: 'Demo part payment' });

      // 15) Fully paid — closed
      const o15 = await order('Order 15 (Bracelet)', { client_id: cust.shree, style_no: 'DM-BRAC-1515', qty_pcs: 2, diamond_carat_weight: 1.0, certificate_required: 0, lead_time_days: 7, remark: 'Demo: kids bracelets' });
      await bagAll('Order 15', o15, 2, 60000);
      await issue('Order 15', cust.shree, o15, 2, 9);
      await receive('Order 15', o15, 2, 8.8, 0.2, true);
      const d15 = await dispatch('Order 15', cust.shree, o15, 2, 8.8, 60000, { gold_amount: 35000, diamond_amount: 20000, labour_amount: 5000 });
      await call('Order 15: full payment', '/api/o2d/payments', 'POST', { customer_id: cust.shree, receipt_date: today, amount_received: 60000, payment_mode: 'RTGS',
        reference_no: 'DEMO-UTR-2', receipt_mode: 'Category-wise', categories: [{ category: 'Gold', amount: 35000 }, { category: 'Diamond', amount: 20000 }, { category: 'Labour', amount: 5000 }] });

      // 16) Stock order cancelled
      const o16 = await order('Order 16 (Stock)', { client_id: cust.kalash, order_type: 'Stock Order', style_no: 'DM-STK-1616', qty_pcs: 15, diamond_carat_weight: 2.5, remark: 'Demo: stock earrings' });
      await call('Order 16: cancelled', `/api/o2d/orders/${o16}/cancel`, 'POST', { reason });
    } catch (e) {
      const s = $('o2dDemoStep');
      if (s) s.innerHTML = `<div style="color:var(--destructive);font-weight:600">❌ Failed at: ${h(e.message)}</div><div style="margin-top:6px">Removing the partly created demo data…</div>`;
      const r = await api('/api/o2d/demo', 'DELETE');
      if (s) s.innerHTML += `<div style="margin-top:6px">${r && !r.error ? 'Cleaned up. Please send a screenshot of this message.' : 'Cleanup failed: ' + h((r && r.error) || '') + ' — use "Remove demo data".'}</div>
        <div style="margin-top:10px;text-align:right"><button class="btn btn-outline btn-sm" onclick="O2D.closeModal();O2D.refresh()">Close</button></div>`;
      return;
    }
    O2D.closeModal();
    showToast(`Demo data loaded — ${made.length} orders`);
    await O2D.loadLookups(true); O2D.refreshBadge();
    O2D.orderFilters = { page: 1 };
    O2D.open('orders');
  };
})();
