// ══════════════════════════════════════════════════════
// O2D FMS — MD Dashboard (spec 13.3) + Reports (13.1–13.5)
// Har report backend se ek hi shakl me aata hai: { title, columns, rows,
// chart, notes } — isliye yahan ek hi renderer sab reports dikhata hai.
// ══════════════════════════════════════════════════════
(function () {
  'use strict';
  const O2D = window.O2D;
  const { $, h } = O2D;
  const chartBox = (id, height = 260) => `<div style="position:relative;height:${height}px"><canvas id="${id}"></canvas></div>`;
  const orderLink = (id, no) => `<a href="javascript:void(0)" onclick="event.stopPropagation();O2D.open('order',{id:${id}})" style="color:var(--primary);font-weight:600">${h(no)}</a>`;

  // KPI / chart click → Orders list with that filter
  O2D.showOrders = (filters) => {
    O2D.orderFilters = Object.assign({ page: 1 }, filters || {});
    O2D.open('orders');
  };

  // ══════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════
  O2D.views.dashboard = async (el, p) => {
    const from = p.from || ''; const to = p.to || ''; const cid = p.customerId || '';
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (cid) qs.set('customerId', cid);
    const d = await O2D.req('/api/o2d/dashboard/summary?' + qs.toString());
    const k = d.kpis;
    const go = "O2D.open('dashboard',{from:O2D.$('o2dDbF').value,to:O2D.$('o2dDbT').value,customerId:O2D.$('o2dDbC').value})";
    const cf = cid ? { client_id: cid } : {};
    const of = (extra) => `O2D.showOrders(${h(JSON.stringify(Object.assign({}, cf, extra)))})`;
    const trend = k.orders.pct_vs_prev == null ? `prev period ${k.orders.prev_count}`
      : `<span style="color:${k.orders.pct_vs_prev >= 0 ? 'var(--success)' : 'var(--destructive)'}">${k.orders.pct_vs_prev >= 0 ? '▲' : '▼'} ${Math.abs(k.orders.pct_vs_prev)}%</span> vs prev (${k.orders.prev_count})`;
    const t = d.tables;

    el.innerHTML = O2D.filterBar(
      O2D.fInput('', 'From', O2D.inp('o2dDbF', 'date', d.period.from, go))
      + O2D.fInput('', 'To', O2D.inp('o2dDbT', 'date', d.period.to, go))
      + O2D.fInput('', 'Client', O2D.sel('o2dDbC', O2D.customerOptions(true), cid, go, 'All clients'))
      + `<button class="btn btn-outline btn-sm" onclick="O2D.open('dashboard',{})">This month</button>
         <button class="btn btn-primary btn-sm" onclick="O2D.open('orderForm',{})">+ New order</button>`)
      + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:10px;margin-bottom:16px">
        ${O2D.kpi('Orders (period)', k.orders.count, `${k.orders.value ? O2D.money(k.orders.value) + ' · ' : ''}${trend}`, '', of({ from: d.period.from, to: d.period.to }))}
        ${O2D.kpi('Open orders', k.open_orders, 'click to list', '', of({ open: '1' }))}
        ${O2D.kpi('Overdue vs delivery', k.overdue_vs_delivery, 'past delivery date', k.overdue_vs_delivery ? 'var(--destructive)' : '', of({ delayed: '1' }))}
        ${O2D.kpi('At risk', k.at_risk, 'projected to miss delivery', k.at_risk ? 'var(--warning)' : '', of({ at_risk: '1' }))}
        ${O2D.kpi('Ready for dispatch', k.ready_for_dispatch, '', k.ready_for_dispatch ? 'var(--success)' : '', `O2D.open('dispatch',{${cid ? `customerId:'${cid}'` : ''}})`)}
        ${O2D.kpi('On hold', k.on_hold, '', k.on_hold ? 'var(--warning)' : '', of({ status: 'Hold' }))}
        ${O2D.kpi('Receivables', O2D.money(k.receivables), `overdue ${O2D.money(k.receivables_overdue)}`, k.receivables_overdue ? 'var(--destructive)' : '', "O2D.open('payments',{tab:'ageing'})")}
        ${O2D.kpi('Overdue follow-ups', k.overdue_followups, 'all users', k.overdue_followups ? 'var(--destructive)' : '', "O2D.open('followups',{tab:'overdue',mine:'0'})")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr));gap:0 16px">
        ${O2D.card('Orders by month — this year vs last year', chartBox('o2dChMonth'))}
        ${O2D.card('Open orders by stage', chartBox('o2dChPipe') + '<div style="font-size:11px;color:var(--muted-foreground);margin-top:6px">Click a bar to see those orders.</div>')}
        ${O2D.card('Bottleneck — avg days in stage vs target', chartBox('o2dChBott') + (d.charts.bottleneckNotes ? `<div style="font-size:11px;color:var(--muted-foreground);margin-top:6px">${h(d.charts.bottleneckNotes)}</div>` : ''))}
        ${O2D.card('Sales forecast', chartBox('o2dChFc') + (d.charts.ordersByMonth.forecastNotes ? `<div style="font-size:11px;color:var(--muted-foreground);margin-top:6px">${h(d.charts.ordersByMonth.forecastNotes)}</div>` : ''))}
      </div>
      ${d.charts.receivables.labels.length ? O2D.card('Receivables by client — Gold / Diamond / Labour split', chartBox('o2dChRecv', 280)) : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr));gap:0 16px">
        ${O2D.card(`Top delayed orders (${t.delayed.length})`, O2D.table([
          { key: 'order_no', label: 'Order', render: r => orderLink(r.id, r.order_no) }, { key: 'client', label: 'Client' }, { key: 'stage', label: 'Stage' },
          { key: 'owner', label: 'Owner' }, { key: 'days_delayed', label: 'Days late', render: r => `<b style="color:var(--destructive)">${r.days_delayed}</b>` },
          { key: 'reason', label: 'Why' }], t.delayed, { onRow: r => `O2D.open('order',{id:${r.id}})`, empty: 'No delayed orders 🎉' }))}
        ${O2D.card('Pending at vendors', O2D.table([
          { key: 'vendor', label: 'Vendor' }, { key: 'pcs', label: 'Pcs out', type: 'int' }, { key: 'wt', label: 'Weight (gm)', type: 'num3' },
          { key: 'days_out', label: 'Oldest (days)', render: r => `<span style="color:${r.days_out > 15 ? 'var(--destructive)' : 'inherit'}">${r.days_out}</span>` }],
        t.vendorPending, { empty: 'Nothing pending at vendors.' }))}
        ${O2D.card('Payments due this week / overdue', O2D.table([
          { key: 'client_name', label: 'Client' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'balance', label: 'Balance', type: 'money' },
          { key: 'payment_due_date', label: 'Due', render: r => `${O2D.fmtD(r.payment_due_date)}${r.overdue ? O2D.flag(Math.abs(r.days) + 'd overdue', 'var(--destructive)') : ''}` }],
        t.paymentsDue, { onRow: r => (r.order_id ? `O2D.open('order',{id:${r.order_id},tab:'dispatch'})` : "O2D.open('payments',{})"), empty: 'Nothing due this week.' }))}
        ${O2D.card('Hold / cancelled in period', O2D.table([
          { key: 'order_no', label: 'Order', render: r => orderLink(r.id, r.order_no) }, { key: 'client', label: 'Client' },
          { key: 'status', label: 'Status', render: r => O2D.chip(r.status) }, { key: 'on', label: 'On', type: 'date' }, { key: 'reason', label: 'Reason', nowrap: false }],
        t.holdCancel, { onRow: r => `O2D.open('order',{id:${r.id}})`, empty: 'None in this period.' }))}
      </div>`;

    const m = d.charts.ordersByMonth;
    O2D.drawChart('o2dChMonth', { type: 'bar', labels: m.labels, datasets: [{ label: 'Orders', data: m.counts }] });
    const pipe = d.charts.pipeline;
    O2D.drawChart('o2dChPipe', { type: 'barh', labels: pipe.map(x => x.stage), datasets: [{ label: 'Open orders', data: pipe.map(x => x.count) }],
      onClick: (i) => O2D.showOrders(Object.assign({}, cf, { stage: pipe[i].key, open: '1' })) });
    O2D.drawChart('o2dChBott', d.charts.bottleneck);
    O2D.drawChart('o2dChFc', m.forecast);
    const r = d.charts.receivables;
    if (r.labels.length) {
      O2D.drawChart('o2dChRecv', { type: 'stacked', labels: r.labels, datasets: ['Gold', 'Diamond', 'Labour', 'Other', 'Unsplit']
        .filter(key => r[key].some(v => v > 0)).map(key => ({ label: key, data: r[key] })) });
    }
  };

  // ══════════════════════════════════════════════════════
  // REPORTS
  // ══════════════════════════════════════════════════════
  const REPORT_HINT = {
    'order-journey': 'One row per order — every stage date, pcs, weight, invoice & payment. Best exported to Excel.',
    'orders-by-month': 'Monthly orders and value, compared with last year.',
    pipeline: 'How many orders are in each status right now.',
    'by-client': 'Top clients by orders and value.',
    'by-sales-person': 'Orders, value and conversion per sales person.',
    'type-mix': 'Customer vs Stock, New Development vs Existing design.',
    'stage-ageing': 'Open orders bucketed by days in their current stage.',
    bottleneck: 'Average days each stage takes vs its target.',
    delays: 'Orders past their delivery date and where they are stuck.',
    'vendor-performance': 'Turnaround, on-time % and wastage per FG vendor.',
    cad: 'CAD vendor turnaround, approval time and rejection rate.',
    shortfall: 'Bagging shortfalls and short-material requirements.',
    'dispatch-register': 'All dispatches and invoices.',
    receivables: 'Outstanding by client with ageing and Gold / Diamond split.',
    collection: 'Money collected vs invoiced, month by month.',
    'followup-compliance': 'Open and overdue follow-ups per user and type.',
    forecast: 'Actuals, confirmed & weighted pipeline and trend for the next 3 months.',
  };
  const MAX_ROWS = 500;

  O2D.views.reports = async (el, p) => {
    if (!p.key) {
      const list = await O2D.req('/api/o2d/reports');
      el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">${list.map(r => `
        <div onclick="O2D.open('reports',{key:'${h(r.key)}'})" style="cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
          <div style="font-size:13.5px;font-weight:700;margin-bottom:4px">${h(r.title)}</div>
          <div style="font-size:12px;color:var(--muted-foreground)">${h(REPORT_HINT[r.key] || '')}</div></div>`).join('')}</div>`;
      return;
    }
    const f = { from: p.from || '', to: p.to || '', client_id: p.client_id || '', sales_person_id: p.sales_person_id || '', status: p.status || '' };
    const qs = new URLSearchParams();
    Object.entries(f).forEach(([k2, v]) => { if (v) qs.set(k2, v); });
    const rep = await O2D.req(`/api/o2d/reports/${encodeURIComponent(p.key)}?${qs.toString()}`);
    const csv = `/api/o2d/reports/${encodeURIComponent(p.key)}?${qs.toString()}${qs.toString() ? '&' : ''}format=csv`;
    const go = `O2D.open('reports',{key:'${h(p.key)}',from:O2D.$('o2dRpF').value,to:O2D.$('o2dRpT').value,client_id:O2D.$('o2dRpC').value,sales_person_id:O2D.$('o2dRpS').value,status:O2D.$('o2dRpSt').value})`;
    const statuses = Object.values(O2D.lk.statuses || {}).map(s => ({ value: s, label: s }));
    const rows = rep.rows || [];
    const hasOrder = rows.some(r => r._order_id);
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="O2D.open('reports',{})">← All reports</button>
        <div style="font-size:15px;font-weight:700;flex:1">${h(rep.title)}</div>
        <a class="btn btn-outline btn-sm" href="${csv}" download>⬇ Export to Excel (CSV)</a></div>`
      + O2D.filterBar(O2D.fInput('', 'Order date from', O2D.inp('o2dRpF', 'date', f.from, go))
        + O2D.fInput('', 'To', O2D.inp('o2dRpT', 'date', f.to, go))
        + O2D.fInput('', 'Client', O2D.sel('o2dRpC', O2D.customerOptions(true), f.client_id, go, 'All clients'))
        + O2D.fInput('', 'Sales person', O2D.sel('o2dRpS', O2D.userOptions(), f.sales_person_id, go))
        + O2D.fInput('', 'Status', O2D.sel('o2dRpSt', statuses, f.status, go))
        + `<button class="btn btn-outline btn-sm" onclick="O2D.open('reports',{key:'${h(p.key)}'})">Clear</button>`)
      + (rep.chart && rep.chart.labels && rep.chart.labels.length ? O2D.card('', chartBox('o2dChRep', 300)) : '')
      + (rep.notes ? `<div style="font-size:12px;color:var(--muted-foreground);background:var(--muted);border-radius:10px;padding:8px 12px;margin-bottom:12px">ℹ️ ${h(rep.notes)}</div>` : '')
      + `<div style="font-size:12px;color:var(--muted-foreground);margin-bottom:6px">${rows.length} row(s)${rows.length > MAX_ROWS ? ` — showing first ${MAX_ROWS}, export for all` : ''}${hasOrder ? ' · click a row to open the order' : ''}</div>`
      + O2D.table(rep.columns.map(c => ({ key: c.key, label: c.label, type: c.type === 'text' ? undefined : c.type })), rows.slice(0, MAX_ROWS),
        { onRow: hasOrder ? (r => (r._order_id ? `O2D.open('order',{id:${r._order_id}})` : '')) : null, empty: 'No data for these filters.' });
    if (rep.chart && rep.chart.labels && rep.chart.labels.length) O2D.drawChart('o2dChRep', rep.chart);
  };
})();
