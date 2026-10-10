// ══════════════════════════════════════════════════════
// O2D FMS — stage screens: CAD board, Confirmation, Bagging, Vendor Issue,
// Vendor Receive (+ ledger), Hallmark & Lab, Dispatch, Payments.
// Actions O2D.act.* (o2d-orders.js) se aate hain.
// ══════════════════════════════════════════════════════
(function () {
  'use strict';
  const O2D = window.O2D;
  const { $, h } = O2D;
  const ctl = O2D.ctlStyle;
  const orderLink = (id, no) => `<a href="javascript:void(0)" onclick="event.stopPropagation();O2D.open('order',{id:${id}})" style="color:var(--primary);font-weight:600">${h(no)}</a>`;

  // ══════════════════════════════════════════════════════
  // CAD BOARD (kanban + list)
  // ══════════════════════════════════════════════════════
  O2D.views.cad = async (el, p) => {
    const rows = await O2D.req('/api/o2d/cad-board');
    const cols = [['Pending', 'To request'], ['Requested', 'Requested'], ['Received', 'Received'], ['Sent for Approval', 'Sent for approval'],
      ['Hold', 'Hold'], ['Approved', 'Approved (30d)'], ['Cancelled', 'Cancelled (30d)']];
    const list = p.list === '1';
    const btn = (r) => {
      if (r.column === 'Pending') return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.requestCad(${r.id})">Request CAD</button>`;
      if (r.column === 'Requested') return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.receiveCad(${r.cad_id},${r.id})">Received</button>`;
      if (r.column === 'Received') return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.sendCadApproval(${r.cad_id},'${r.order_type}')">Send for approval</button>`;
      if (['Sent for Approval', 'Hold'].includes(r.column)) return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.cadDecision(${r.cad_id})">Decision</button>`;
      return '';
    };
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <div style="font-size:12.5px;color:var(--muted-foreground)">New Development orders — latest CAD revision. Red = vendor past expected date.</div>
      <div class="tab-group"><div class="tab ${list ? '' : 'active'}" onclick="O2D.open('cad',{})">Board</div><div class="tab ${list ? 'active' : ''}" onclick="O2D.open('cad',{list:'1'})">List</div></div></div>`;
    if (list) {
      el.innerHTML = head + O2D.table([
        { key: 'order_no', label: 'Order', render: r => orderLink(r.id, r.order_no) }, { key: 'client_name', label: 'Client' }, { key: 'order_type', label: 'Type' },
        { key: 'revision_no', label: 'Rev', type: 'int' }, { key: 'vendor_name', label: 'Vendor' }, { key: 'requested_on', label: 'Requested', type: 'date' },
        { key: 'expected_on', label: 'Expected', render: r => `${O2D.fmtD(r.expected_on)}${r.overdue ? O2D.flag('late', 'var(--destructive)') : ''}` },
        { key: 'received_on', label: 'Received', type: 'date' }, { key: 'sent_on', label: 'Sent', type: 'date' }, { key: 'approved_on', label: 'Approved', type: 'date' },
        { key: 'column', label: 'CAD status', render: r => O2D.chip(r.column) }, { key: 'a', label: '', render: btn },
      ], rows, { onRow: r => `O2D.open('order',{id:${r.id}})` });
      return;
    }
    el.innerHTML = head + `<div style="display:grid;grid-template-columns:repeat(${cols.length},minmax(200px,1fr));gap:10px;overflow-x:auto;padding-bottom:6px">${cols.map(([k, l]) => {
      const items = rows.filter(r => r.column === k);
      return `<div style="background:var(--muted);border-radius:12px;padding:10px;min-height:120px">
        <div style="font-size:12px;font-weight:700;margin-bottom:8px">${h(l)} <span style="color:var(--muted-foreground)">(${items.length})</span></div>
        ${items.map(r => `<div onclick="O2D.open('order',{id:${r.id}})" style="cursor:pointer;background:var(--card);border:1px solid ${r.overdue ? 'var(--destructive)' : 'var(--border)'};border-radius:10px;padding:8px 10px;margin-bottom:8px">
          <div style="font-size:12.5px;font-weight:700">${h(r.order_no)} ${r.revision_no > 1 ? O2D.flag('Rev ' + r.revision_no, 'var(--chart-1)') : ''}</div>
          <div style="font-size:11.5px;color:var(--muted-foreground)">${h(r.client_name || '')} · ${h(r.order_type === 'Stock Order' ? 'Stock' : 'Customer')}</div>
          ${r.vendor_name ? `<div style="font-size:11.5px">${h(r.vendor_name)}${r.expected_on && k === 'Requested' ? ` · exp <b style="color:${r.overdue ? 'var(--destructive)' : 'inherit'}">${O2D.fmtD(r.expected_on)}</b>` : ''}</div>` : ''}
          ${r.decision_reason && ['Hold', 'Cancelled'].includes(k) ? `<div style="font-size:11px;color:var(--muted-foreground)">${h(r.decision_reason)}</div>` : ''}
          <div style="margin-top:6px">${btn(r)}</div></div>`).join('') || '<div style="font-size:11.5px;color:var(--muted-foreground)">—</div>'}
      </div>`;
    }).join('')}</div>`;
  };

  // ══════════════════════════════════════════════════════
  // CONFIRMATION
  // ══════════════════════════════════════════════════════
  O2D.views.confirm = async (el) => {
    const d = await O2D.req('/api/o2d/orders?stage=CONFIRMATION&limit=500');
    const rows = d.rows.filter(o => o.order_type === 'Customer Order' && !['Cancelled', 'Closed'].includes(o.order_status));
    const toPost = rows.filter(o => !o.quotation_posted_on || ['Open', 'CAD Approved'].includes(o.order_status));
    const waiting = rows.filter(o => !toPost.includes(o));
    const base = [
      { key: 'order_no', label: 'Order', render: o => orderLink(o.id, o.order_no) }, { key: 'client_name', label: 'Client' }, { key: 'style_no', label: 'Style' },
      { key: 'effective_qty', label: 'Qty', type: 'int' }, { key: 'sales_person_name', label: 'Sales person' }, { key: 'delivery_date', label: 'Delivery', type: 'date' },
      { key: 'days_in_stage', label: 'Days waiting', render: o => `<span style="color:${o.delayed_at_stage ? 'var(--destructive)' : 'inherit'}">${o.days_in_stage ?? '—'}</span>` },
    ];
    el.innerHTML = O2D.card(`Awaiting quotation post (${toPost.length})`, O2D.table([...base,
      { key: 'cad_status', label: 'CAD', render: o => O2D.chip(o.cad_status) },
      { key: 'a', label: '', render: o => `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.postQuotation(${o.id})">Mark posted</button>` }],
    toPost, { onRow: o => `O2D.open('order',{id:${o.id}})`, empty: 'Nothing waiting for a quotation.' }))
      + O2D.card(`Awaiting client decision (${waiting.length})`, O2D.table([...base,
        { key: 'quotation_amount', label: 'Quotation', type: 'money' }, { key: 'quotation_posted_on', label: 'Posted', render: o => O2D.fmtDT(o.quotation_posted_on) },
        { key: 'order_status', label: 'Status', render: o => O2D.chip(o.order_status) },
        { key: 'a', label: '', render: o => `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.confirmDecision(${o.id})">Record decision</button>` }],
      waiting, { onRow: o => `O2D.open('order',{id:${o.id}})`, empty: 'No quotations pending.' }));
  };

  // ══════════════════════════════════════════════════════
  // BAGGING
  // ══════════════════════════════════════════════════════
  O2D.views.bagging = async (el, p) => {
    const all = p.all === '1';
    const rows = await O2D.req('/api/o2d/bagging' + (all ? '?all=1' : ''));
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:var(--muted-foreground)">Live tracking: Order Qty | Bagged | Rejected | Pending | Requirement raised | Received from vendor | Still short</div>
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" ${all ? 'checked' : ''} onchange="O2D.open('bagging',{all:this.checked?'1':'0'})"> Show completed</label></div>`
      + O2D.table([
        { key: 'order_no', label: 'Order', render: r => orderLink(r.order_id, r.order_no) + (r.bagging_query ? O2D.flag('Query', 'var(--warning)') : '') },
        { key: 'client_name', label: 'Client' }, { key: 'doer_name', label: 'Doer' }, { key: 'delivery_date', label: 'Delivery', type: 'date' },
        { key: 'order_qty', label: 'Order qty', type: 'int' }, { key: 'total_bagged', label: 'Bagged', type: 'int' }, { key: 'total_rejected', label: 'Rejected', type: 'int' },
        { key: 'pending_pcs', label: 'Pending', render: r => `<b style="color:${r.pending_pcs ? 'var(--warning)' : 'var(--success)'}">${r.pending_pcs}</b>` },
        { key: 'requirement_raised_pcs', label: 'Req raised', type: 'int' }, { key: 'received_from_vendor_pcs', label: 'Recd from vendor', type: 'int' },
        { key: 'still_short_pcs', label: 'Still short', render: r => `<span style="color:${r.still_short_pcs ? 'var(--destructive)' : 'inherit'}">${r.still_short_pcs}</span>` },
        { key: 'bagging_status', label: 'Status', render: r => O2D.chip(r.bagging_status) },
        { key: 'a', label: '', render: r => {
          if (r.bagging_status === 'Completed') return '';
          if (r.bagging_query) return `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();O2D.act.resolveQuery(${r.order_id})">Resolve query</button>`;
          if (!r.details_verified) return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.verify(${r.id})">Verify</button>`;
          const short = r.pending_pcs - r.still_short_pcs;
          return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();O2D.act.bagEntry(${r.id},${r.pending_pcs},${r.order_id})">+ Entry</button>
            ${short > 0 ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();O2D.act.raiseReq(${r.id},${short})">Raise req</button>` : ''}
            ${r.still_short_pcs ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();O2D.open('order',{id:${r.order_id},tab:'bagging'})">Receive material</button>` : ''}`;
        } },
      ], rows, { onRow: r => `O2D.open('order',{id:${r.order_id},tab:'bagging'})`, empty: all ? 'No bagging records.' : 'Nothing in bagging right now.' });
  };

  // ══════════════════════════════════════════════════════
  // VENDOR ISSUE (customer → pending orders → vendor → issue)
  // ══════════════════════════════════════════════════════
  O2D.views.issue = async (el, p) => {
    const cid = p.customerId || '';
    const pending = cid ? await O2D.req(`/api/o2d/issues/pending-orders?customerId=${cid}`) : [];
    const recent = await O2D.req('/api/o2d/issues');
    O2D._issuePending = pending;
    const vendors = O2D.vendorOptions('Manufacturing (FG)');
    el.innerHTML = O2D.card('Issue to manufacturing vendor', `
      ${O2D.filterBar(O2D.fInput('', '1 · Customer', O2D.sel('o2dIsCust', O2D.customerOptions(true), cid, "O2D.open('issue',{customerId:this.value})", '— Select customer —')))}
      ${!cid ? '<div style="font-size:12.5px;color:var(--muted-foreground)">Select a customer to see its orders with completed bagging.</div>' : `
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">2 · Pending orders (bagging completed, not fully issued)</div>
        ${O2D.table([
          { key: 'chk', label: '', render: r => `<input type="checkbox" id="o2dIsChk_${r.id}" checked onchange="O2D.issueTotals()">` },
          { key: 'order_no', label: 'Order', render: r => orderLink(r.id, r.order_no) }, { key: 'style_no', label: 'Style' }, { key: 'delivery_date', label: 'Delivery', type: 'date' },
          { key: 'total_bagged', label: 'Bagged', type: 'int' }, { key: 'issued_pcs', label: 'Issued', type: 'int' }, { key: 'available_pcs', label: 'Available', type: 'int' },
          { key: 'p', label: 'Issue pcs', render: r => `<input type="number" id="o2dIsPcs_${r.id}" min="1" max="${r.available_pcs}" value="${r.available_pcs}" style="${ctl};width:80px" oninput="O2D.issueTotals()">` },
          { key: 'w', label: 'Weight (gm)', render: r => `<input type="number" id="o2dIsWt_${r.id}" step="0.001" min="0" style="${ctl};width:100px" oninput="O2D.issueTotals()">` },
          { key: 'c', label: 'Carat', render: r => `<input type="number" id="o2dIsCt_${r.id}" step="0.001" min="0" style="${ctl};width:90px">` },
        ], pending, { empty: 'No orders of this customer are ready to issue.' })}
        ${pending.length ? `<div style="font-size:12px;font-weight:700;margin:14px 0 6px">3 · Vendor & voucher</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0 14px">
          <div class="form-group"><label>Vendor (FG) *</label><select id="o2dIsVendor" onchange="O2D.issueExpected()"><option value="">— Select —</option>${vendors.map(v => `<option value="${v.value}">${h(v.label)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Issue date *</label><input type="date" id="o2dIsDate" value="${O2D.today()}" onchange="O2D.issueExpected()"></div>
          <div class="form-group"><label>Issue voucher / invoice no *</label><input id="o2dIsInv" autocomplete="off"></div>
          <div class="form-group"><label>Expected return</label><input type="date" id="o2dIsExp"></div>
          <div class="form-group" style="grid-column:1/-1"><label>Remark</label><input id="o2dIsRemark" autocomplete="off"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div id="o2dIsTotals" style="font-size:13px"></div>
          <button class="btn btn-primary" id="o2dIsSave" onclick="O2D.saveIssue(${cid})">Save issue</button></div>` : ''}`}`)
      + O2D.card('Recent issues', O2D.table([
        { key: 'issue_no', label: 'Issue No' }, { key: 'issue_date', label: 'Date', type: 'date' }, { key: 'client_name', label: 'Customer' }, { key: 'vendor_name', label: 'Vendor' },
        { key: 'issue_invoice_no', label: 'Voucher' }, { key: 'total_pcs', label: 'Pcs', type: 'int' }, { key: 'total_weight', label: 'Weight (gm)', type: 'num3' },
        { key: 'received_pcs', label: 'Received', type: 'int' }, { key: 'expected_return_date', label: 'Expected back', type: 'date' },
      ], recent.slice(0, 50), { empty: 'No issues yet.' }));
    O2D.issueTotals();
  };
  O2D.issueExpected = () => {
    const v = O2D.vendor($('o2dIsVendor').value);
    if (v) $('o2dIsExp').value = O2D.addDays($('o2dIsDate').value || O2D.today(), v.default_lead_time_days || 15);
  };
  O2D.issueTotals = () => {
    const box = $('o2dIsTotals'); if (!box) return;
    let pcs = 0; let wt = 0; let n = 0;
    (O2D._issuePending || []).forEach(r => { if ($('o2dIsChk_' + r.id).checked) { n++; pcs += parseInt($('o2dIsPcs_' + r.id).value, 10) || 0; wt += O2D.num($('o2dIsWt_' + r.id).value); } });
    box.innerHTML = `Selected <b>${n}</b> order(s) · <b>${pcs}</b> pcs · <b>${wt.toFixed(3)}</b> gm`;
  };
  O2D.saveIssue = async (cid) => {
    const lines = (O2D._issuePending || []).filter(r => $('o2dIsChk_' + r.id).checked).map(r => ({
      order_id: r.id, issued_pcs: $('o2dIsPcs_' + r.id).value, issued_weight_gm: $('o2dIsWt_' + r.id).value, issued_carat: $('o2dIsCt_' + r.id).value }));
    const body = { customer_id: cid, vendor_id: $('o2dIsVendor').value, issue_date: $('o2dIsDate').value, issue_invoice_no: $('o2dIsInv').value.trim(),
      expected_return_date: $('o2dIsExp').value, remark: $('o2dIsRemark').value, lines };
    const b = $('o2dIsSave'); b.disabled = true;
    const r = await api('/api/o2d/issues', 'POST', body);
    b.disabled = false;
    if (r.error) return showToast(r.error, 'error');
    showToast(`Issue ${r.issue_no} saved`); O2D.refreshBadge(); O2D.refresh();
  };

  // ══════════════════════════════════════════════════════
  // VENDOR RECEIVE (+ ledger)
  // ══════════════════════════════════════════════════════
  O2D.views.receive = async (el, p) => {
    const tab = p.tab || 'receive';
    const vid = p.vendorId || '';
    const tabs = `<div class="tab-group" style="display:inline-flex;margin-bottom:12px"><div class="tab ${tab === 'receive' ? 'active' : ''}" onclick="O2D.open('receive',{vendorId:'${vid}'})">Receive</div>
      <div class="tab ${tab === 'ledger' ? 'active' : ''}" onclick="O2D.open('receive',{tab:'ledger',vendorId:'${vid}'})">Vendor ledger</div></div>`;
    if (tab === 'ledger') {
      const from = p.from || ''; const to = p.to || '';
      const led = vid ? await O2D.req(`/api/o2d/vendors/${vid}/ledger?from=${from}&to=${to}`) : null;
      const go = "O2D.open('receive',{tab:'ledger',vendorId:O2D.$('o2dLgV').value,from:O2D.$('o2dLgF').value,to:O2D.$('o2dLgT').value})";
      el.innerHTML = tabs + O2D.card('Vendor ledger', O2D.filterBar(
        O2D.fInput('', 'Vendor', O2D.sel('o2dLgV', O2D.vendorOptions(), vid, go, '— Select vendor —'))
        + O2D.fInput('', 'From', O2D.inp('o2dLgF', 'date', from, go)) + O2D.fInput('', 'To', O2D.inp('o2dLgT', 'date', to, go)))
        + (led ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:12px">
            ${O2D.kpi('Issued pcs', led.totals.issued_pcs)}${O2D.kpi('Issued wt (gm)', O2D.n3(led.totals.issued_wt))}${O2D.kpi('Received pcs', led.totals.received_pcs)}
            ${O2D.kpi('Received wt (gm)', O2D.n3(led.totals.received_wt))}${O2D.kpi('Wastage', O2D.n3(led.totals.wastage) + ' gm', led.totals.wastage_pct + '%', led.totals.wastage_pct > 3 ? 'var(--destructive)' : '')}
            ${O2D.kpi('Pending pcs', led.totals.pending_pcs, '', led.totals.pending_pcs ? 'var(--warning)' : '')}</div>`
          + O2D.table([{ key: 'issue_no', label: 'Issue' }, { key: 'issue_date', label: 'Date', type: 'date' }, { key: 'order_no', label: 'Order' }, { key: 'client_name', label: 'Client' },
            { key: 'issued_pcs', label: 'Issued', type: 'int' }, { key: 'issued_weight_gm', label: 'Issued wt', type: 'num3' }, { key: 'received_pcs', label: 'Received', type: 'int' },
            { key: 'received_weight', label: 'Received wt', type: 'num3' }, { key: 'wastage_gm', label: 'Wastage', type: 'num3' }, { key: 'pending_pcs', label: 'Pending', type: 'int' },
            { key: 'days_out', label: 'Days out', type: 'int' }, { key: 'line_status', label: 'Status', render: r => O2D.chip(r.line_status) }], led.rows)
          : '<div style="font-size:12.5px;color:var(--muted-foreground)">Select a vendor.</div>'));
      return;
    }
    const lines = vid ? await O2D.req(`/api/o2d/receipts/pending-lines?vendorId=${vid}`) : [];
    O2D._rcvLines = lines;
    el.innerHTML = tabs + O2D.card('Receive finished goods from vendor', `
      ${O2D.filterBar(O2D.fInput('', '1 · Vendor', O2D.sel('o2dRcV', O2D.vendorOptions(), vid, "O2D.open('receive',{vendorId:this.value})", '— Select vendor —')))}
      ${!vid ? '<div style="font-size:12.5px;color:var(--muted-foreground)">Select a vendor to see its open issue lines.</div>' : `
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">2 · Open issue lines — partial receipts allowed</div>
        ${O2D.table([
          { key: 'order_no', label: 'Order', render: r => orderLink(r.order_id, r.order_no) }, { key: 'client_name', label: 'Client' },
          { key: 'issue_no', label: 'Issue' }, { key: 'issue_date', label: 'Issued', type: 'date' },
          { key: 'issued_pcs', label: 'Issued pcs', type: 'int' }, { key: 'issued_weight_gm', label: 'Issued wt', type: 'num3' }, { key: 'pending_pcs', label: 'Pending', type: 'int' },
          { key: 'p', label: 'Recd pcs', render: r => `<input type="number" id="o2dRcPcs_${r.id}" min="0" max="${r.pending_pcs}" style="${ctl};width:72px" oninput="O2D.rcvCalc(${r.id})">` },
          { key: 'w', label: 'Recd wt (gm)', render: r => `<input type="number" id="o2dRcWt_${r.id}" step="0.001" min="0" style="${ctl};width:96px" oninput="O2D.rcvCalc(${r.id})">` },
          { key: 'x', label: 'Wastage (gm)', render: r => `<input type="number" id="o2dRcWs_${r.id}" step="0.001" min="0" style="${ctl};width:90px" oninput="O2D.rcvCalc(${r.id})"><div id="o2dRcCalc_${r.id}" style="font-size:10.5px;color:var(--muted-foreground)"></div>` },
          { key: 'hm', label: 'Hallmarked?', render: r => `<select id="o2dRcHm_${r.id}" style="${ctl}"><option value="">—</option><option value="1">Yes</option><option value="0">No</option></select>` },
        ], lines, { empty: 'No open lines for this vendor.' })}
        ${lines.length ? `<div style="font-size:12px;font-weight:700;margin:14px 0 6px">3 · Vendor bill</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0 14px">
          <div class="form-group"><label>Receipt date *</label><input type="date" id="o2dRcDate" value="${O2D.today()}"></div>
          <div class="form-group"><label>Vendor invoice no *</label><input id="o2dRcInv" autocomplete="off"></div>
          <div class="form-group"><label>Vendor invoice date *</label><input type="date" id="o2dRcInvD" value="${O2D.today()}"></div>
          <div class="form-group"><label>Remark</label><input id="o2dRcRemark" autocomplete="off"></div></div>
        <div style="text-align:right"><button class="btn btn-primary" id="o2dRcSave" onclick="O2D.saveReceipt(${vid})">Save receipt</button></div>` : ''}`}`);
  };
  // Calculated wastage = issued weight for these pcs − received weight (cross-check)
  O2D.rcvCalc = (id) => {
    const r = (O2D._rcvLines || []).find(x => x.id === id); if (!r) return;
    const pcs = parseInt($('o2dRcPcs_' + id).value, 10) || 0; const rw = O2D.num($('o2dRcWt_' + id).value);
    const issued = r.issued_pcs ? O2D.num(r.issued_weight_gm) * pcs / r.issued_pcs : 0;
    const box = $('o2dRcCalc_' + id);
    if (!pcs || !rw) { box.textContent = ''; return; }
    const calc = issued - rw; const ws = O2D.num($('o2dRcWs_' + id).value);
    const pct = issued ? (ws / issued * 100) : 0;
    box.innerHTML = `calc ${calc.toFixed(3)} · <span style="color:${pct > 3 ? 'var(--destructive)' : 'inherit'}">${pct.toFixed(2)}%</span>`;
  };
  O2D.saveReceipt = async (vid) => {
    const lines = (O2D._rcvLines || []).map(r => ({ issue_line_id: r.id, received_pcs: $('o2dRcPcs_' + r.id).value, received_weight_gm: $('o2dRcWt_' + r.id).value,
      wastage_weight_gm: $('o2dRcWs_' + r.id).value, hallmark_done: $('o2dRcHm_' + r.id).value })).filter(l => parseInt(l.received_pcs, 10) > 0);
    const b = $('o2dRcSave'); b.disabled = true;
    const r = await api('/api/o2d/receipts', 'POST', { vendor_id: vid, receipt_date: $('o2dRcDate').value, vendor_invoice_no: $('o2dRcInv').value.trim(),
      vendor_invoice_date: $('o2dRcInvD').value, remark: $('o2dRcRemark').value, lines });
    b.disabled = false;
    if (r.error) return showToast(r.error, 'error');
    showToast(`Receipt ${r.receipt_no} saved`); O2D.refreshBadge(); O2D.refresh();
  };

  // ══════════════════════════════════════════════════════
  // HALLMARK & LAB
  // ══════════════════════════════════════════════════════
  O2D.views.quality = async (el) => {
    const d = await O2D.req('/api/o2d/quality');
    const qty = (o) => (parseInt(o.qty_pcs, 10) || 0) + (parseInt(o.additional_reduction_pcs, 10) || 0);
    const hp = d.orders.filter(o => o.order_status === 'Hallmarking Pending');
    const cp = d.orders.filter(o => o.order_status === 'Certification Pending');
    const hmOut = d.hallmark.filter(j => j.status === 'Sent');
    const labOpen = d.lab.filter(j => j.status !== 'Received');
    const labDone = d.lab.filter(j => j.status === 'Received');
    const ordCol = { key: 'order_no', label: 'Order', render: r => orderLink(r.order_id || r.id, r.order_no) };
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(520px,100%),1fr));gap:0 16px">
      ${O2D.card(`Hallmarking pending (${hp.length})`, O2D.table([ordCol, { key: 'client_name', label: 'Client' }, { key: 'q', label: 'Pcs', render: qty },
        { key: 'a', label: '', render: o => hmOut.some(j => j.order_id === o.id) ? '<span style="font-size:11.5px;color:var(--muted-foreground)">At centre</span>'
          : `<button class="btn btn-primary btn-sm" onclick="O2D.act.sendHallmark(${o.id},${qty(o)})">Send</button> <button class="btn btn-outline btn-sm" onclick="O2D.act.hallmarkDone(${o.id})">Already done</button>` }],
      hp, { empty: 'Nothing pending hallmarking.' }))}
      ${O2D.card(`At hallmark centre (${hmOut.length})`, O2D.table([ordCol, { key: 'centre_name', label: 'Centre' }, { key: 'pcs_sent', label: 'Pcs', type: 'int' },
        { key: 'sent_on', label: 'Sent', type: 'date' }, { key: 'expected_on', label: 'Expected', render: j => `${O2D.fmtD(j.expected_on)}${j.expected_on < O2D.today() ? O2D.flag('late', 'var(--destructive)') : ''}` },
        { key: 'a', label: '', render: j => `<button class="btn btn-primary btn-sm" onclick="O2D.act.receiveHallmark(${j.id},${j.pcs_sent})">Receive</button>` }], hmOut, { empty: 'None out.' }))}
      ${O2D.card(`Certification pending (${cp.length})`, O2D.table([ordCol, { key: 'client_name', label: 'Client' }, { key: 'lab_name', label: 'Lab' }, { key: 'cert_status', label: 'Cert', render: o => O2D.chip(o.cert_status || 'Pending') },
        { key: 'a', label: '', render: o => {
          const job = d.lab.find(j => j.order_id === o.id); // latest (list is newest first)
          if (!job || job.status === 'Received') {
            return `${!job ? `<button class="btn btn-primary btn-sm" onclick="O2D.act.sendLab(${o.id},${qty(o)},${o.lab_id || 0})">Send to lab</button>` : ''}
              ${job ? `<button class="btn btn-outline btn-sm" onclick="O2D.act.uploadCert(${o.id},${job.id})">Attach cert</button> <button class="btn btn-primary btn-sm" onclick="O2D.act.certDone(${o.id})">Mark certified</button>` : ''}
              <button class="btn btn-outline btn-sm" onclick="O2D.act.certNotRequired(${o.id})">Not required</button>`;
          }
          return '<span style="font-size:11.5px;color:var(--muted-foreground)">At lab</span>';
        } }], cp, { empty: 'Nothing pending certification.' }))}
      ${O2D.card(`At lab (${labOpen.length})`, O2D.table([ordCol, { key: 'lab_name', label: 'Lab' }, { key: 'pcs_sent', label: 'Pcs', type: 'int' }, { key: 'lab_challan_no', label: 'Challan' },
        { key: 'sent_on', label: 'Sent', type: 'date' }, { key: 'expected_on', label: 'Expected', render: j => `${O2D.fmtD(j.expected_on)}${j.expected_on < O2D.today() ? O2D.flag('late', 'var(--destructive)') : ''}` },
        { key: 'status', label: 'Status', render: j => O2D.chip(j.status) },
        { key: 'a', label: '', render: j => `<button class="btn btn-primary btn-sm" onclick="O2D.act.receiveLab(${j.id},${j.pcs_sent},${j.order_id})">Receive</button>` }], labOpen, { empty: 'None at lab.' }))}
      </div>${O2D.card('Recently received from lab', O2D.table([ordCol, { key: 'lab_name', label: 'Lab' }, { key: 'pcs_received', label: 'Pcs', type: 'int' },
        { key: 'received_on', label: 'Received', type: 'date' }, { key: 'certificate_numbers', label: 'Certificates', nowrap: false }], labDone.slice(0, 20), { empty: '—' }))}`;
  };

  // ══════════════════════════════════════════════════════
  // DISPATCH & INVOICE
  // ══════════════════════════════════════════════════════
  O2D.views.dispatch = async (el, p) => {
    const cid = p.customerId || '';
    const ready = await O2D.req('/api/o2d/dispatch/ready' + (cid ? `?customerId=${cid}` : ''));
    const register = await O2D.req('/api/o2d/dispatch' + (cid ? `?customerId=${cid}` : ''));
    O2D._dspReady = ready;
    const c = cid ? O2D.customer(cid) : null;
    const catWise = c && c.payment_style === 'Category-wise';
    const pre = p.orderId ? String(p.orderId) : null;
    el.innerHTML = O2D.card('Ready for dispatch', `
      ${O2D.filterBar(O2D.fInput('', 'Client', O2D.sel('o2dDsCust', O2D.customerOptions(true), cid, "O2D.open('dispatch',{customerId:this.value})", 'All clients')))}
      ${O2D.table([
        ...(cid ? [{ key: 'chk', label: '', render: r => `<input type="checkbox" id="o2dDsChk_${r.id}" ${!pre || String(r.id) === pre ? 'checked' : ''}>` }] : []),
        { key: 'order_no', label: 'Order', render: r => orderLink(r.id, r.order_no) }, { key: 'client_name', label: 'Client' }, { key: 'style_no', label: 'Style' },
        { key: 'delivery_date', label: 'Delivery', type: 'date' }, { key: 'received_pcs', label: 'Pcs', type: 'int' }, { key: 'received_weight', label: 'Weight (gm)', type: 'num3' },
        ...(cid ? [
          { key: 'p', label: 'Dispatch pcs', render: r => `<input type="number" id="o2dDsPcs_${r.id}" min="1" value="${O2D.num(r.received_pcs) || (O2D.num(r.qty_pcs) + O2D.num(r.additional_reduction_pcs))}" style="${ctl};width:72px">` },
          { key: 'w', label: 'Weight', render: r => `<input type="number" id="o2dDsWt_${r.id}" step="0.001" value="${O2D.num(r.received_weight) || ''}" style="${ctl};width:92px">` },
          { key: 'a', label: 'Order amount (₹)', render: r => `<input type="number" id="o2dDsAmt_${r.id}" step="0.01" style="${ctl};width:110px">` }] : []),
      ], ready, { empty: 'No orders are ready for dispatch.' })}
      ${!cid ? '<div style="font-size:12.5px;color:var(--muted-foreground);margin-top:8px">Select a client to create a dispatch / invoice (one invoice can cover several orders of the same client).</div>' : ready.length ? `
        <div style="font-size:12px;font-weight:700;margin:14px 0 6px">Invoice</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0 14px">
          <div class="form-group"><label>Invoice no *</label><input id="o2dDsInv" autocomplete="off"></div>
          <div class="form-group"><label>Invoice date *</label><input type="date" id="o2dDsInvD" value="${O2D.today()}" onchange="O2D.dspDue()"></div>
          <div class="form-group"><label>Invoice amount (₹) *</label><input type="number" step="0.01" id="o2dDsAmt" oninput="O2D.dspCat()"></div>
          <div class="form-group"><label>Gold amount ${catWise ? '*' : ''}</label><input type="number" step="0.01" id="o2dDsGold" oninput="O2D.dspCat()"></div>
          <div class="form-group"><label>Diamond amount ${catWise ? '*' : ''}</label><input type="number" step="0.01" id="o2dDsDia" oninput="O2D.dspCat()"></div>
          <div class="form-group"><label>Labour amount</label><input type="number" step="0.01" id="o2dDsLab" oninput="O2D.dspCat()"></div>
          <div class="form-group"><label>Other amount</label><input type="number" step="0.01" id="o2dDsOth" oninput="O2D.dspCat()"></div>
          <div class="form-group"><label>Dispatch date *</label><input type="date" id="o2dDsDate" value="${O2D.today()}"></div>
          <div class="form-group"><label>Payment due date</label><input type="date" id="o2dDsDue"></div>
          <div class="form-group"><label>Courier</label><input id="o2dDsCourier" autocomplete="off"></div>
          <div class="form-group"><label>AWB no</label><input id="o2dDsAwb" autocomplete="off"></div>
          <div class="form-group"><label>Dispatched via</label><input id="o2dDsVia" autocomplete="off" placeholder="Hand / courier / person"></div>
          <div class="form-group"><label>Invoice PDF *</label><input type="file" id="o2dDsPdf" accept=".pdf,.jpg,.jpeg,.png"></div>
          <div class="form-group" style="grid-column:1/-1"><label>Remark</label><input id="o2dDsRemark" autocomplete="off"></div>
        </div>
        <div id="o2dDsCatMsg" style="font-size:12px;margin-bottom:8px;color:var(--muted-foreground)">${catWise ? 'This client pays category-wise — Gold / Diamond / Labour / Other break-up is required and must add up to the invoice amount.' : 'Category break-up is optional (needed only if the client pays category-wise).'}</div>
        <div style="text-align:right"><button class="btn btn-primary" id="o2dDsSave" onclick="O2D.saveDispatch(${cid})">Create dispatch & invoice</button></div>` : ''}`)
      + O2D.card('Dispatch & invoice register', O2D.table([
        { key: 'dispatch_no', label: 'Dispatch' }, { key: 'client_name', label: 'Client' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'invoice_date', label: 'Inv date', type: 'date' },
        { key: 'dispatch_date', label: 'Dispatched', type: 'date' }, { key: 'orders', label: 'Orders', nowrap: false, render: r => r.lines.map(l => orderLink(l.order_id, l.order_no)).join(', ') },
        { key: 'invoice_amount', label: 'Amount', type: 'money' }, { key: 'received_amount', label: 'Received', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'payment_due_date', label: 'Due', render: r => `${O2D.fmtD(r.payment_due_date)}${r.days_overdue ? O2D.flag(r.days_overdue + 'd overdue', 'var(--destructive)') : ''}` },
        { key: 'payment_status', label: 'Status', render: r => O2D.chip(r.payment_status) },
      ], register.slice(0, 100), { empty: 'No dispatches yet.' }));
    O2D.dspDue();
  };
  O2D.dspDue = () => {
    const c = O2D.customer(O2D.state.params.customerId); const e = $('o2dDsDue');
    if (c && e && $('o2dDsInvD')) e.value = O2D.addDays($('o2dDsInvD').value || O2D.today(), c.payment_terms_days || 30);
  };
  O2D.dspCat = () => {
    const m = $('o2dDsCatMsg'); if (!m) return;
    const amt = O2D.num($('o2dDsAmt').value);
    const sum = ['o2dDsGold', 'o2dDsDia', 'o2dDsLab', 'o2dDsOth'].reduce((s, id) => s + O2D.num($(id).value), 0);
    if (!sum) return;
    const ok = Math.abs(sum - amt) <= 1;
    m.innerHTML = `Break-up total <b>${O2D.money(sum)}</b> ${ok ? '✓ matches invoice' : `<span style="color:var(--destructive)">≠ invoice ${O2D.money(amt)}</span>`}`;
  };
  O2D.saveDispatch = async (cid) => {
    const lines = (O2D._dspReady || []).filter(r => $('o2dDsChk_' + r.id) && $('o2dDsChk_' + r.id).checked)
      .map(r => ({ order_id: r.id, pcs: $('o2dDsPcs_' + r.id).value, weight_gm: $('o2dDsWt_' + r.id).value, line_amount: $('o2dDsAmt_' + r.id).value }));
    const pdf = $('o2dDsPdf').files;
    if (!pdf || !pdf.length) return showToast('Upload the invoice PDF', 'error');
    if (!lines.length) return showToast('Tick at least one order', 'error');
    const body = { customer_id: cid, invoice_no: $('o2dDsInv').value.trim(), invoice_date: $('o2dDsInvD').value, invoice_amount: $('o2dDsAmt').value,
      gold_amount: $('o2dDsGold').value, diamond_amount: $('o2dDsDia').value, labour_amount: $('o2dDsLab').value, other_amount: $('o2dDsOth').value,
      dispatch_date: $('o2dDsDate').value, payment_due_date: $('o2dDsDue').value, courier: $('o2dDsCourier').value, awb_no: $('o2dDsAwb').value,
      dispatched_via: $('o2dDsVia').value, remark: $('o2dDsRemark').value, lines };
    const b = $('o2dDsSave'); b.disabled = true;
    const r = await api('/api/o2d/dispatch', 'POST', body);
    if (r.error) { b.disabled = false; return showToast(r.error, 'error'); }
    try { await O2D.upload(r.order_id, pdf[0], 'invoice', 'fms_dispatch', r.id); }
    catch (e) { showToast(`Dispatch ${r.dispatch_no} saved, but invoice upload failed: ${e.message} — attach it from the order page`, 'error'); }
    showToast(`Dispatch ${r.dispatch_no} created — payment follow-up started`);
    O2D.refreshBadge(); O2D.open('dispatch', { customerId: cid });
  };

  // ══════════════════════════════════════════════════════
  // PAYMENTS (follow-up, receipt — invoice-wise / category-wise, ageing)
  // ══════════════════════════════════════════════════════
  const CATS = ['Gold', 'Diamond', 'Labour', 'Other'];
  O2D.views.payments = async (el, p) => {
    const tab = p.tab || 'followup';
    const tabs = [['followup', 'Payment follow-up'], ['receipt', 'Record receipt'], ['receipts', 'Receipts'], ['ageing', 'Receivables ageing']];
    const head = `<div class="tab-group" style="display:inline-flex;flex-wrap:wrap;margin-bottom:12px">${tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="O2D.open('payments',{tab:'${k}'})">${l}</div>`).join('')}</div>`;
    if (tab === 'followup') {
      const rows = await O2D.req('/api/o2d/payments/followup');
      el.innerHTML = head + O2D.table([
        { key: 'client_name', label: 'Client' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'invoice_date', label: 'Date', type: 'date' },
        { key: 'invoice_amount', label: 'Amount', type: 'money' }, { key: 'received_amount', label: 'Received', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'payment_due_date', label: 'Due', type: 'date' },
        { key: 'days_overdue', label: 'Days overdue', render: r => (r.days_overdue ? `<b style="color:var(--destructive)">${r.days_overdue}</b>` : '—') },
        { key: 'last_followup_on', label: 'Last follow-up', render: r => O2D.fmtDT(r.last_followup_on) }, { key: 'next_followup_date', label: 'Next', type: 'date' },
        { key: 'assigned_to_name', label: 'Assigned' },
        { key: 'a', label: '', render: r => `${r.task_id ? `<button class="btn btn-outline btn-sm" onclick="O2D.openFollowup(${r.task_id})">+ Follow-up</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="O2D.open('payments',{tab:'receipt',customerId:${r.customer_id}})">Receipt</button>` },
      ], rows, { empty: 'No outstanding invoices 🎉' });
      return;
    }
    if (tab === 'receipts') {
      const rows = await O2D.req('/api/o2d/payments');
      el.innerHTML = head + O2D.table([{ key: 'receipt_no', label: 'Receipt' }, { key: 'receipt_date', label: 'Date', type: 'date' }, { key: 'client_name', label: 'Client' },
        { key: 'amount_received', label: 'Amount', type: 'money' }, { key: 'payment_mode', label: 'Mode' }, { key: 'reference_no', label: 'Ref / UTR' },
        { key: 'receipt_mode', label: 'Allocation' }, { key: 'on_account_amount', label: 'On account', type: 'money' }, { key: 'remark', label: 'Remark', nowrap: false }], rows, { empty: 'No receipts yet.' });
      return;
    }
    if (tab === 'ageing') {
      const a = await O2D.req('/api/o2d/receivables/ageing');
      const t = a.total;
      el.innerHTML = head + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px">
          ${O2D.kpi('Outstanding', O2D.money(t.balance))}${O2D.kpi('Overdue', O2D.money(t.overdue), '', t.overdue ? 'var(--destructive)' : '')}
          ${O2D.kpi('0–30 days', O2D.money(t.b0_30))}${O2D.kpi('31–60', O2D.money(t.b31_60))}${O2D.kpi('61–90', O2D.money(t.b61_90))}${O2D.kpi('90+', O2D.money(t.b90), '', t.b90 ? 'var(--destructive)' : '')}
          ${O2D.kpi('Gold receivable', O2D.money(t.Gold))}${O2D.kpi('Diamond receivable', O2D.money(t.Diamond))}${O2D.kpi('Labour receivable', O2D.money(t.Labour))}</div>`
        + O2D.table([{ key: 'client_name', label: 'Client' }, { key: 'invoices', label: 'Invoices', type: 'int' }, { key: 'b0_30', label: '0–30', type: 'money' },
          { key: 'b31_60', label: '31–60', type: 'money' }, { key: 'b61_90', label: '61–90', type: 'money' }, { key: 'b90', label: '90+', type: 'money' },
          { key: 'balance', label: 'Total', type: 'money' }, { key: 'overdue', label: 'Overdue', type: 'money' }, { key: 'Gold', label: 'Gold', type: 'money' },
          { key: 'Diamond', label: 'Diamond', type: 'money' }, { key: 'Labour', label: 'Labour', type: 'money' }, { key: 'Other', label: 'Other', type: 'money' }, { key: 'Unsplit', label: 'Unsplit', type: 'money' }],
        a.clients, { empty: 'No receivables.' })
        + '<div style="font-size:11.5px;color:var(--muted-foreground);margin-top:8px">Age = days since invoice date. Unsplit = balance on invoices without a category break-up.</div>';
      return;
    }
    // Record receipt
    const cid = p.customerId || '';
    const inv = cid ? await O2D.req(`/api/o2d/payments/open-invoices?customerId=${cid}`) : [];
    O2D._payInv = inv;
    const c = cid ? O2D.customer(cid) : null;
    const mode = p.mode || (c && c.payment_style === 'Category-wise' ? 'Category-wise' : 'Invoice-wise');
    const catBal = {}; CATS.forEach(k => { catBal[k] = inv.reduce((s, i) => s + O2D.num(i.category_balance[k]), 0); });
    el.innerHTML = head + O2D.card('Record payment receipt', `
      ${O2D.filterBar(O2D.fInput('', 'Customer', O2D.sel('o2dPyCust', O2D.customerOptions(true), cid, "O2D.open('payments',{tab:'receipt',customerId:this.value})", '— Select customer —')))}
      ${!cid ? '<div style="font-size:12.5px;color:var(--muted-foreground)">Select a customer to see open invoices.</div>' : !inv.length ? '<div style="font-size:13px">No open invoices for this customer.</div>' : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0 14px">
        <div class="form-group"><label>Receipt date *</label><input type="date" id="o2dPyDate" value="${O2D.today()}"></div>
        <div class="form-group"><label>Amount received (₹) *</label><input type="number" step="0.01" id="o2dPyAmt" oninput="O2D.payTotals()"></div>
        <div class="form-group"><label>Payment mode *</label><select id="o2dPyMode"><option value="">— Select —</option>${['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash', 'Gold (metal)', 'Other'].map(m => `<option>${m}</option>`).join('')}</select></div>
        <div class="form-group"><label>Reference / UTR / cheque no</label><input id="o2dPyRef" autocomplete="off"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Remark</label><input id="o2dPyRemark" autocomplete="off"></div>
      </div>
      <div class="tab-group" style="display:inline-flex;margin-bottom:10px">
        <div class="tab ${mode === 'Invoice-wise' ? 'active' : ''}" onclick="O2D.open('payments',{tab:'receipt',customerId:${cid},mode:'Invoice-wise'})">Invoice-wise</div>
        <div class="tab ${mode === 'Category-wise' ? 'active' : ''}" onclick="O2D.open('payments',{tab:'receipt',customerId:${cid},mode:'Category-wise'})">Category-wise (Gold / Diamond…)</div></div>
      ${mode === 'Invoice-wise' ? O2D.table([
        { key: 'chk', label: '', render: r => `<input type="checkbox" id="o2dPyChk_${r.id}" onchange="O2D.payTick(${r.id})">` },
        { key: 'invoice_no', label: 'Invoice' }, { key: 'invoice_date', label: 'Date', type: 'date' }, { key: 'invoice_amount', label: 'Amount', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' }, { key: 'payment_due_date', label: 'Due', render: r => `${O2D.fmtD(r.payment_due_date)}${r.days_overdue ? O2D.flag(r.days_overdue + 'd', 'var(--destructive)') : ''}` },
        { key: 'a', label: 'Allocate (₹)', render: r => `<input type="number" step="0.01" id="o2dPyAl_${r.id}" style="${ctl};width:120px" oninput="O2D.payTotals()">` },
      ], inv) : `<div style="font-size:12.5px;color:var(--muted-foreground);margin-bottom:8px">Amount per category is applied to this customer’s open invoices oldest first (FIFO).</div>
        ${O2D.table([{ key: 'k', label: 'Category' }, { key: 'b', label: 'Open balance', type: 'money' },
          { key: 'a', label: 'Amount received (₹)', render: r => `<input type="number" step="0.01" id="o2dPyCat_${r.k}" style="${ctl};width:130px" oninput="O2D.payTotals()">` }],
          CATS.map(k => ({ k, b: catBal[k] })))}
        ${inv.some(i => !CATS.some(k => O2D.num(i.category_balance[k]) > 0)) ? '<div style="font-size:12px;color:var(--warning);margin-top:6px">Some invoices have no category break-up — use Invoice-wise for those.</div>' : ''}`}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px"><div id="o2dPyTotals" style="font-size:13px"></div>
        <button class="btn btn-primary" id="o2dPySave" onclick="O2D.savePayment(${cid},'${mode}')">Save receipt</button></div>`}`);
    O2D.payTotals();
  };
  O2D.payTick = (id) => {
    const r = O2D._payInv.find(x => x.id === id); const al = $('o2dPyAl_' + id);
    al.value = $('o2dPyChk_' + id).checked ? O2D.num(r.balance) : '';
    O2D.payTotals();
  };
  O2D.payTotals = () => {
    const box = $('o2dPyTotals'); if (!box) return;
    const amt = O2D.num(($('o2dPyAmt') || {}).value);
    let alloc = 0;
    (O2D._payInv || []).forEach(r => { const e = $('o2dPyAl_' + r.id); if (e) alloc += O2D.num(e.value); });
    CATS.forEach(k => { const e = $('o2dPyCat_' + k); if (e) alloc += O2D.num(e.value); });
    const rem = amt - alloc;
    box.innerHTML = `Received <b>${O2D.money(amt)}</b> · Allocated <b>${O2D.money(alloc)}</b> · ${rem >= 0 ? `On account <b>${O2D.money(rem)}</b>` : `<span style="color:var(--destructive)">Over-allocated by ${O2D.money(-rem)}</span>`}`;
  };
  O2D.savePayment = async (cid, mode) => {
    const body = { customer_id: cid, receipt_date: $('o2dPyDate').value, amount_received: $('o2dPyAmt').value, payment_mode: $('o2dPyMode').value,
      reference_no: $('o2dPyRef').value, remark: $('o2dPyRemark').value, receipt_mode: mode };
    if (mode === 'Invoice-wise') body.allocations = O2D._payInv.map(r => ({ dispatch_id: r.id, amount: $('o2dPyAl_' + r.id).value })).filter(a => O2D.num(a.amount) > 0);
    else body.categories = CATS.map(k => ({ category: k, amount: $('o2dPyCat_' + k).value })).filter(a => O2D.num(a.amount) > 0);
    const b = $('o2dPySave'); b.disabled = true;
    const r = await api('/api/o2d/payments', 'POST', body);
    b.disabled = false;
    if (r.error) return showToast(r.error, 'error');
    showToast(`Receipt ${r.receipt_no} saved — allocated ${O2D.money(r.allocated)}${r.on_account ? `, ${O2D.money(r.on_account)} on account` : ''}`);
    O2D.refreshBadge(); O2D.open('payments', { tab: 'receipt', customerId: cid });
  };
})();
