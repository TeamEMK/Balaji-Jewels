// ══════════════════════════════════════════════════════
// O2D FMS — Orders: list, entry form (sections A–E), 360° detail page,
// aur saare stage actions (O2D.act.*) jo detail page aur stage screens
// dono use karte hain.
// ══════════════════════════════════════════════════════
(function () {
  'use strict';
  const O2D = window.O2D;
  const { $, h } = O2D;
  const act = O2D.act = O2D.act || {};
  const after = () => { O2D.refreshBadge(); O2D.refresh(); };

  // ══════════════════════════════════════════════════════
  // ORDER LIST
  // ══════════════════════════════════════════════════════
  O2D.orderFilters = O2D.orderFilters || { page: 1 };
  O2D.views.orders = async (el) => {
    const f = O2D.orderFilters;
    const qs = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
    qs.set('limit', 50);
    const d = await O2D.req('/api/o2d/orders?' + qs.toString());
    const st = O2D.lk.statuses;
    const typeShort = (o) => `${o.order_type === 'Stock Order' ? 'Stock' : 'Customer'} · ${o.development_type === 'New Development' ? 'New Dev' : 'Existing'}`;
    const pages = Math.max(1, Math.ceil(d.total / d.limit));
    const exportQs = new URLSearchParams({ format: 'csv' });
    ['from', 'to', 'client_id', 'status', 'sales_person_id'].forEach(k => { if (f[k]) exportQs.set(k, f[k]); });
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div style="font-size:13px;color:var(--muted-foreground)">${d.total} order(s)</div>
        <div style="display:flex;gap:8px">
          <a class="btn btn-outline" href="/api/o2d/reports/order-journey?${exportQs}" title="Order Journey report (Excel / CSV)">⬇ Export</a>
          <button class="btn btn-primary" onclick="O2D.open('orderForm')">+ New Order</button>
        </div>
      </div>
      ${O2D.filterBar(
        O2D.fInput('', 'Search', O2D.inp('o2dOfQ', 'search', f.q, 'O2D.applyOrderFilters()', 'placeholder="Order / ID / style / client" style="' + O2D.ctlStyle + ';width:200px"'))
        + O2D.fInput('', 'Status', O2D.sel('o2dOfStatus', Object.values(st).map(s => ({ value: s, label: s })), f.status, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Stage', O2D.sel('o2dOfStage', O2D.STAGES.map(s => ({ value: s, label: O2D.STAGE_LABEL[s] })), f.stage, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Client', O2D.sel('o2dOfClient', O2D.customerOptions(true), f.client_id, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Sales person', O2D.sel('o2dOfSales', O2D.userOptions(), f.sales_person_id, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Owner', O2D.sel('o2dOfOwner', O2D.userOptions(), f.owner_id, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Order type', O2D.sel('o2dOfType', [{ value: 'Customer Order', label: 'Customer Order' }, { value: 'Stock Order', label: 'Stock Order' }], f.order_type, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'From', O2D.inp('o2dOfFrom', 'date', f.from, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'To', O2D.inp('o2dOfTo', 'date', f.to, 'O2D.applyOrderFilters()'))
        + O2D.fInput('', 'Show', O2D.sel('o2dOfShow', [{ value: 'open', label: 'Open only' }, { value: 'delayed', label: 'Delayed' }, { value: 'at_risk', label: 'At risk' }],
          f.open === '1' ? 'open' : f.delayed === '1' ? 'delayed' : f.at_risk === '1' ? 'at_risk' : '', 'O2D.applyOrderFilters()', 'All'))
        + `<button class="btn btn-outline btn-sm" onclick="O2D.orderFilters={page:1};O2D.refresh()">Clear</button>`)}
      ${O2D.table([
        { key: 'order_no', label: 'Order', render: o => `<b>${h(o.order_no)}</b><div style="font-size:10.5px;color:var(--muted-foreground)">${h(o.unique_id)}</div>` },
        { key: 'client_name', label: 'Client' },
        { key: 'style_no', label: 'Style' },
        { key: 'type', label: 'Type', render: o => `<span style="font-size:11.5px">${typeShort(o)}</span>` },
        { key: 'effective_qty', label: 'Qty', type: 'int' },
        { key: 'delivery_date', label: 'Delivery', render: o => `${O2D.fmtD(o.delivery_date)}${o.overdue_delivery ? O2D.flag(o.days_overdue_delivery + 'd late', 'var(--destructive)') : ''}` },
        { key: 'stage', label: 'Stage', render: o => h(O2D.STAGE_LABEL[o.current_stage] || '—') },
        { key: 'order_status', label: 'Status', render: o => O2D.chip(o.order_status)
          + (o.delayed_at_stage ? O2D.flag('Delayed', 'var(--destructive)') : '') + (o.at_risk && !o.overdue_delivery ? O2D.flag('At risk', 'var(--warning)') : '')
          + (o.bagging_query ? O2D.flag('Query', 'var(--warning)') : '') },
        { key: 'days_in_stage', label: 'Days in stage', render: o => (o.days_in_stage == null || ['Closed', 'Cancelled', 'Draft'].includes(o.order_status) ? '—'
          : `<span style="color:${o.delayed_at_stage ? 'var(--destructive)' : 'inherit'};font-weight:${o.delayed_at_stage ? 700 : 400}">${o.days_in_stage}${o.stage_target ? ' / ' + o.stage_target : ''}</span>`) },
        { key: 'sales_person_name', label: 'Sales' },
        ...(O2D.lk.isAdmin ? [{ key: 'del', label: '', render: o => `<button class="btn btn-outline btn-sm" title="Delete order" style="color:var(--destructive);border-color:color-mix(in srgb,var(--destructive) 40%,transparent)"
          onclick="event.stopPropagation();O2D.act.deleteOrder(${o.id},'${h(o.order_no)}')">🗑 Delete</button>` }] : []),
      ], d.rows, { onRow: o => `O2D.open('order',{id:${o.id}})`, empty: 'No orders match these filters.' })}
      ${pages > 1 ? `<div style="display:flex;justify-content:center;gap:10px;align-items:center;margin-top:12px">
        <button class="btn btn-outline btn-sm" ${d.page <= 1 ? 'disabled' : ''} onclick="O2D.orderFilters.page=${d.page - 1};O2D.refresh()">◀ Prev</button>
        <span style="font-size:12px;color:var(--muted-foreground)">Page ${d.page} of ${pages}</span>
        <button class="btn btn-outline btn-sm" ${d.page >= pages ? 'disabled' : ''} onclick="O2D.orderFilters.page=${d.page + 1};O2D.refresh()">Next ▶</button></div>` : ''}`;
  };
  O2D.applyOrderFilters = () => {
    const show = $('o2dOfShow').value;
    O2D.orderFilters = {
      page: 1, q: $('o2dOfQ').value.trim(), status: $('o2dOfStatus').value, stage: $('o2dOfStage').value, client_id: $('o2dOfClient').value,
      sales_person_id: $('o2dOfSales').value, owner_id: $('o2dOfOwner').value, order_type: $('o2dOfType').value, from: $('o2dOfFrom').value, to: $('o2dOfTo').value,
      open: show === 'open' ? '1' : '', delayed: show === 'delayed' ? '1' : '', at_risk: show === 'at_risk' ? '1' : '',
    };
    O2D.refresh();
  };

  // ══════════════════════════════════════════════════════
  // ORDER ENTRY FORM (spec sec 4)
  // ══════════════════════════════════════════════════════
  let formState = null;
  O2D.views.orderForm = async (el, p) => {
    let d = null;
    if (p.id) d = await O2D.req(`/api/o2d/orders/${p.id}`);
    const o = d ? d.order : { order_type: 'Customer Order', development_type: 'New Development', qty_pcs: '', additional_reduction_pcs: 0,
      lead_time_days: '', delivery_date: '', certificate_required: 0, owner_id: O2D.lk.me };
    const confirmed = !!(d && o.confirmed_on);
    const lockedAll = d && ['Cancelled', 'Closed'].includes(o.order_status);
    if (lockedAll) { el.innerHTML = O2D.card('', `This order is ${h(o.order_status)} and cannot be edited.`); return; }
    const ro = (name) => confirmed && !['additional_reduction_pcs', 'delivery_date', 'remark', 'change_reason'].includes(name);
    formState = { id: p.id || null, confirmed, deliveryTouched: !!(d && o.delivery_date), lines: d ? d.diamondLines.map(l => ({ ...l })) : [] };
    const F = [
      { type: 'section', label: 'A · Order Identification' },
      { name: 'unique_id', label: 'Unique ID', type: 'info', html: d ? `<b>${h(o.unique_id)}</b>` : '<span style="color:var(--muted-foreground)">Auto — BJ-YYYY-######</span>' },
      { name: 'order_no', label: 'Order No', placeholder: 'Blank = auto ORD-YYMM-####', help: 'Client / internal order number' },
      { name: 'status_info', label: 'Order status', type: 'info', html: d ? O2D.chip(o.order_status) : O2D.chip('Draft') },
      { type: 'section', label: 'B · Client & People' },
      { name: 'client_id', label: 'Client name', type: 'select', required: true, options: O2D.customerOptions(!!d), help: 'Not in the list? Add it in Masters → Customers.' },
      { name: 'client_info', label: 'Client defaults', type: 'info', html: '—' },
      { name: 'sales_person_id', label: 'Sales person', type: 'select', required: true, options: O2D.userOptions() },
      { name: 'owner_id', label: 'Owner (responsible)', type: 'select', required: true, options: O2D.userOptions() },
      { type: 'section', label: 'C · Order Type & Product' },
      { name: 'order_type', label: 'Order type', type: 'select', required: true, noEmpty: true, options: ['Customer Order', 'Stock Order'] },
      { name: 'style_no', label: 'Style No (customer order)', required: true, showIf: v => v.order_type === 'Customer Order' },
      { name: 'development_type', label: 'Development type', type: 'select', required: true, noEmpty: true, options: ['New Development', 'From Existing Stock'] },
      { name: 'qty_pcs', label: 'Qty (pcs)', type: 'number', min: 1, required: true },
      { name: 'additional_reduction_pcs', label: 'Additional (+) / Reduction (−) pcs', type: 'number', help: 'Effective qty = Qty + this' },
      { name: 'diamond_carat_weight', label: 'Diamond carat weight (total)', type: 'number', step: '0.001', min: 0, required: true },
      { name: 'quality_id', label: 'Quality', type: 'select', required: true, options: O2D.qualityOptions() },
      { name: 'certificate_required', label: 'Certificate required', type: 'checkbox' },
      { name: 'lab_id', label: 'Lab', type: 'select', required: true, options: O2D.labOptions(), showIf: v => v.certificate_required === 1 },
      { name: 'design_photo', label: 'Design photo(s)', type: 'file', multiple: true, accept: '.jpg,.jpeg,.png,.webp,.pdf', showIf: v => v.development_type === 'New Development',
        help: 'Required for New Development (on submit).' },
      { name: 'order_sheet_file', label: 'Order sheet file', type: 'file', accept: '.pdf,.xlsx,.xls,.jpg,.jpeg,.png' },
      { name: 'files_existing', label: 'Uploaded files', type: 'html', html: d ? `<div style="margin-bottom:12px">${O2D.fileChips(d.files.filter(f => ['design_photo', 'order_sheet'].includes(f.file_type)), { canDelete: !confirmed, onChange: 'refresh' })}</div>` : '' },
      { name: 'lines', label: 'Diamond details', type: 'html', html: '<div id="o2dLines"></div>' },
      { type: 'section', label: 'D · Timeline' },
      { name: 'lead_time_days', label: 'Lead time (days)', type: 'number', min: 0, required: true },
      { name: 'delivery_date', label: 'Delivery date', type: 'date', required: true, help: 'Auto = order date + lead time (editable)' },
      { name: 'remark', label: 'Remark', type: 'textarea', span: true, rows: 2 },
      ...(d ? [{ type: 'section', label: 'E · CAD Status' }, { name: 'cad_info', label: 'CAD status', type: 'info', html: O2D.chip(o.cad_status || 'Not started') }] : []),
      ...(confirmed ? [{ type: 'section', label: 'Change after confirmation' },
        { name: 'change_reason', label: 'Reason for change', type: 'textarea', rows: 2, span: true, required: true,
          help: 'Order is confirmed — only Additional/Reduction pcs, Delivery date and Remark can change. Every change is logged.' }] : []),
    ].map(f => (f.name && ro(f.name) && !['info', 'html', 'section'].includes(f.type) ? { ...f, readonly: true, required: false } : f));
    formState.fields = F;
    const values = { ...o };
    if (d) ['client_id', 'sales_person_id', 'owner_id', 'quality_id', 'lab_id'].forEach(k => { values[k] = o[k] || ''; });
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="${d ? `O2D.open('order',{id:${o.id}})` : "O2D.open('orders')"}">← Back</button>
        <div style="font-size:16px;font-weight:700">${d ? `Edit order ${h(o.order_no)}` : 'New order'}</div>
      </div>
      <div class="alert error" id="o2dFormErr"></div>
      ${O2D.card('', O2D.formHtml(F, values, 'o2do'))}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-bottom:30px">
        <button class="btn btn-outline" onclick="${d ? `O2D.open('order',{id:${o.id}})` : "O2D.open('orders')"}">Cancel</button>
        ${!d || o.order_status === 'Draft' ? `<button class="btn btn-outline" id="o2dSaveDraft" onclick="O2D.saveOrder(false)">Save as Draft</button>
          <button class="btn btn-primary" id="o2dSaveSubmit" onclick="O2D.saveOrder(true)">Save & Submit</button>`
        : `<button class="btn btn-primary" id="o2dSaveSubmit" onclick="O2D.saveOrder(false)">Save changes</button>`}
      </div>`;
    renderLines();
    let prevClient = values.client_id;
    O2D.formBind(F, 'o2do', (v) => {
      // Client select → defaults auto-fill (spec 4.2)
      const c = O2D.customer(v.client_id);
      const info = $('o2do_client_info');
      if (info) info.innerHTML = c ? `Tunch <b>${O2D.num(c.gold_tunch_pct).toFixed(2)}%</b> · Labour <b>${O2D.money(c.labour_rate)}</b> ${h(c.labour_rate_basis || '')} · Terms ${c.payment_terms_days || 30}d · ${h(c.payment_style || '')}` : '—';
      if (c && String(v.client_id) !== String(prevClient) && !confirmed) {
        prevClient = v.client_id;
        const set = (n, val) => { const e = $('o2do_' + n); if (e && val != null && val !== '') e.value = val; };
        set('sales_person_id', c.sales_person_id); set('quality_id', c.quality_id); set('lab_id', c.default_lab_id);
        const cb = $('o2do_certificate_required'); if (cb) cb.checked = !!c.certificate_required;
        $('o2do_certificate_required').dispatchEvent(new Event('change'));
      }
      // Lead time → delivery date suggestion (until user edits the date)
      if (!formState.deliveryTouched && v.lead_time_days !== '' && !confirmed) {
        const dd = $('o2do_delivery_date');
        if (dd) dd.value = O2D.addDays(d ? (o.created_at || '').slice(0, 10) : O2D.today(), v.lead_time_days);
      }
    });
    const dd = $('o2do_delivery_date');
    if (dd) dd.addEventListener('input', () => { formState.deliveryTouched = true; });
  };

  function renderLines() {
    const box = $('o2dLines');
    if (!box) return;
    const ro = formState.confirmed;
    const ctl = O2D.ctlStyle + ';width:100%';
    const tot = formState.lines.reduce((a, l) => ({ pcs: a.pcs + (parseInt(l.pcs, 10) || 0), ct: a.ct + O2D.num(l.carat) }), { pcs: 0, ct: 0 });
    box.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Diamond details (shape / sieve / pcs / carat) — optional, prints on the bagging sheet</div>
      <div style="overflow-x:auto"><table style="font-size:12.5px;max-width:640px"><thead><tr><th>Shape</th><th>Size / Sieve</th><th>Pcs</th><th>Carat</th><th></th></tr></thead><tbody>
      ${formState.lines.map((l, i) => `<tr>
        <td><input style="${ctl}" value="${h(l.shape || '')}" ${ro ? 'disabled' : ''} oninput="O2D._line(${i},'shape',this.value)"></td>
        <td><input style="${ctl}" value="${h(l.sieve_size || '')}" ${ro ? 'disabled' : ''} oninput="O2D._line(${i},'sieve_size',this.value)"></td>
        <td><input type="number" min="0" style="${ctl}" value="${h(l.pcs || '')}" ${ro ? 'disabled' : ''} oninput="O2D._line(${i},'pcs',this.value)"></td>
        <td><input type="number" step="0.001" min="0" style="${ctl}" value="${h(l.carat || '')}" ${ro ? 'disabled' : ''} oninput="O2D._line(${i},'carat',this.value)"></td>
        <td>${ro ? '' : `<button class="btn btn-outline btn-sm" onclick="O2D._lineDel(${i})">✕</button>`}</td></tr>`).join('')}
      <tr><td colspan="2" style="text-align:right;font-weight:700">Total</td><td style="font-weight:700">${tot.pcs}</td><td style="font-weight:700">${tot.ct.toFixed(3)}</td><td></td></tr>
      </tbody></table></div>
      ${ro ? '' : '<button class="btn btn-outline btn-sm" style="margin:6px 0 14px" onclick="O2D._lineAdd()">+ Add line</button>'}`;
  }
  O2D._line = (i, k, v) => { formState.lines[i][k] = v; };
  O2D._lineAdd = () => { formState.lines.push({}); renderLines(); };
  O2D._lineDel = (i) => { formState.lines.splice(i, 1); renderLines(); };

  O2D.saveOrder = async (submit) => {
    const err = $('o2dFormErr');
    err.style.display = 'none';
    const btns = ['o2dSaveDraft', 'o2dSaveSubmit'].map(id => $(id)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; });
    try {
      const F = formState.fields;
      const v = O2D.formRead(F, 'o2do');
      if (submit || formState.confirmed) O2D.formValidate(F, v);
      else if (!v.client_id) throw new Error('Client is required');
      const body = { ...v, diamond_lines: formState.lines };
      delete body.design_photo; delete body.order_sheet_file;
      let id = formState.id;
      if (id) await O2D.req(`/api/o2d/orders/${id}`, 'PUT', body);
      else { const r = await O2D.req('/api/o2d/orders', 'POST', body); id = r.id; formState.id = id; }
      if (v.design_photo && v.design_photo.length) await O2D.uploadMany(id, v.design_photo, 'design_photo');
      if (v.order_sheet_file && v.order_sheet_file.length) await O2D.uploadMany(id, v.order_sheet_file, 'order_sheet');
      if (submit) {
        const r = await api(`/api/o2d/orders/${id}/submit`, 'POST', {});
        if (r.error) {
          showToast('Saved as Draft — ' + r.error, 'error');
          await O2D.open('orderForm', { id });
          const e2 = $('o2dFormErr'); if (e2) { e2.textContent = r.error; e2.style.display = 'block'; }
          return;
        }
        showToast('Order submitted');
      } else showToast('Order saved');
      O2D.refreshBadge();
      O2D.open('order', { id });
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block'; err.scrollIntoView({ block: 'center' });
    } finally {
      btns.forEach(b => { if (document.body.contains(b)) b.disabled = false; });
    }
  };

  // ══════════════════════════════════════════════════════
  // ORDER DETAIL — 360° (spec sec 12)
  // ══════════════════════════════════════════════════════
  O2D.views.order = async (el, p) => {
    const d = await O2D.req(`/api/o2d/orders/${p.id}`);
    O2D.cur = d;
    const o = d.order;
    const tab = p.tab || 'overview';
    const term = ['Cancelled', 'Closed'].includes(o.order_status);
    // Stage stepper — order ke route ke hisaab se
    const path = o.path || [];
    const curIdx = path.indexOf(o.current_stage);
    const stepper = `<div style="display:flex;gap:4px;overflow-x:auto;padding:4px 0 2px">${path.map((s, i) => {
      const done = o.order_status === 'Closed' || (curIdx >= 0 && i < curIdx);
      const now = i === curIdx && !term;
      const c = now ? (o.delayed_at_stage ? 'var(--destructive)' : 'var(--primary)') : done ? 'var(--success)' : 'var(--muted-foreground)';
      return `<div style="flex:1;min-width:84px;text-align:center"><div style="height:5px;border-radius:3px;background:${done || now ? c : 'var(--border)'}"></div>
        <div style="font-size:10.5px;margin-top:4px;color:${c};font-weight:${now ? 700 : 500};white-space:nowrap">${done ? '✓ ' : ''}${h(O2D.STAGE_LABEL[s])}</div></div>`;
    }).join('')}</div>`;
    const dl = o.days_to_delivery;
    const deliveryNote = term ? '' : (o.overdue_delivery ? O2D.flag(`${o.days_overdue_delivery}d over`, 'var(--destructive)')
      : (dl != null ? O2D.flag(`${dl}d left`, dl <= 3 ? 'var(--warning)' : 'var(--muted-foreground)') : ''));
    const header = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div style="font-size:18px;font-weight:700">${h(o.order_no)} <span style="font-size:12px;color:var(--muted-foreground);font-weight:500">${h(o.unique_id)}</span></div>
          <div style="font-size:13px;margin-top:4px">${h(o.client_name || '—')} · Style <b>${h(o.style_no || '—')}</b> · Qty <b>${o.effective_qty}</b> pcs · ${h(o.order_type || '')} · ${h(o.development_type || '')}</div>
          <div style="font-size:12.5px;margin-top:4px;color:var(--muted-foreground)">Delivery <b style="color:var(--foreground)">${O2D.fmtD(o.delivery_date)}</b> ${deliveryNote}
            ${o.at_risk && !o.overdue_delivery ? O2D.flag('At risk — projected ' + O2D.fmtD(o.projected_completion), 'var(--warning)') : ''}
            · Days in stage <b style="color:${o.delayed_at_stage ? 'var(--destructive)' : 'var(--foreground)'}">${o.days_in_stage == null ? '—' : o.days_in_stage}${o.stage_target ? ' / ' + o.stage_target : ''}</b></div>
        </div>
        <div style="text-align:right">${O2D.chip(o.order_status)}${o.bagging_query ? O2D.flag('Bagging query', 'var(--warning)') : ''}
          <div style="font-size:11.5px;color:var(--muted-foreground);margin-top:6px">Owner ${h(o.owner_name || '—')} · Sales ${h(o.sales_person_name || '—')}</div></div>
      </div>
      ${o.order_status === 'Draft' ? '' : `<div style="margin-top:12px">${stepper}</div>`}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${actionButtons(d)}</div>
      ${o.bagging_query ? `<div style="margin-top:10px;font-size:12.5px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--warning) 12%,transparent)">⚠️ <b>Bagging query:</b> ${h(o.bagging_query_remark || '')}</div>` : ''}
      ${o.cancel_reason && o.order_status === 'Cancelled' ? `<div style="margin-top:10px;font-size:12.5px;color:var(--destructive)">Cancelled: ${h(o.cancel_reason)}</div>` : ''}
    </div>`;
    const tabs = [['overview', 'Overview'], ['timeline', 'Timeline'], ['cad', 'CAD'], ['bagging', 'Bagging'], ['vendor', 'Vendor'],
      ['quality', 'Hallmark & Lab'], ['dispatch', 'Dispatch & Payment'], ['followups', `Follow-ups (${d.tasks.filter(t => t.status === 'Open').length})`], ['activity', 'Activity']];
    el.innerHTML = `<button class="btn btn-outline btn-sm" style="margin-bottom:10px" onclick="O2D.open('orders')">← Orders</button>${header}
      <div style="overflow-x:auto;margin-bottom:12px"><div class="tab-group" style="display:inline-flex;min-width:max-content">${tabs.map(([k, l]) =>
        `<div class="tab ${k === tab ? 'active' : ''}" onclick="O2D.open('order',{id:${o.id},tab:'${k}'})">${l}</div>`).join('')}</div></div>
      <div>${(TAB[tab] || TAB.overview)(d)}</div>`;
  };

  // Stage ke hisaab se jo kaam abhi baaki hai — wahi button dikhte hain.
  function actionButtons(d) {
    const o = d.order;
    const B = (label, fn, cls = 'btn-outline') => `<button class="btn ${cls} btn-sm" onclick="${fn}">${label}</button>`;
    const out = [];
    const st = o.order_status;
    const term = ['Cancelled', 'Closed'].includes(st);
    const latestCad = d.cad[d.cad.length - 1];
    if (st === 'Draft') {
      out.push(B('✏️ Edit', `O2D.open('orderForm',{id:${o.id}})`), B('🚀 Submit', `O2D.act.submit(${o.id})`, 'btn-primary'));
      if (O2D.lk.isAdmin) out.push(B('🗑 Delete order', `O2D.act.deleteOrder(${o.id},'${h(o.order_no)}')`));
      return out.join('');
    }
    if (o.current_stage === 'CAD' && (!latestCad || ['Cancelled'].includes(latestCad.cad_status)) && !term) out.push(B('🎨 Request CAD', `O2D.act.requestCad(${o.id})`, 'btn-primary'));
    if (latestCad && latestCad.cad_status === 'Requested') out.push(B('📥 CAD Received', `O2D.act.receiveCad(${latestCad.id},${o.id})`, 'btn-primary'));
    if (latestCad && latestCad.cad_status === 'Received') out.push(B('📤 Send for approval', `O2D.act.sendCadApproval(${latestCad.id},'${o.order_type}')`, 'btn-primary'));
    if (latestCad && ['Sent for Approval', 'Hold'].includes(latestCad.cad_status) && !term) out.push(B('⚖️ CAD decision', `O2D.act.cadDecision(${latestCad.id})`, 'btn-primary'));
    if (o.order_type === 'Customer Order' && o.current_stage === 'CONFIRMATION' && !term) {
      if (!o.quotation_posted_on || ['Open', 'CAD Approved'].includes(st)) out.push(B('💬 Quotation posted', `O2D.act.postQuotation(${o.id})`, 'btn-primary'));
      else out.push(B('✅ Confirmation decision', `O2D.act.confirmDecision(${o.id})`, 'btn-primary'), B('💬 Re-post quotation', `O2D.act.postQuotation(${o.id})`));
    }
    if (st === 'Confirmed') out.push(B('🖨 Print order sheet', `O2D.act.printSheet(${o.id})`), B('🏭 Hand over to production', `O2D.act.handover(${o.id})`, 'btn-primary'));
    else if (o.confirmed_on) out.push(B('🖨 Order sheet', `O2D.act.printSheet(${o.id})`));
    if (o.bagging_query) out.push(B('🛠 Resolve bagging query', `O2D.act.resolveQuery(${o.id})`, 'btn-primary'));
    if (d.bagging && d.bagging.bagging_status !== 'Completed' && !term) out.push(B('🧺 Bagging', `O2D.open('order',{id:${o.id},tab:'bagging'})`));
    if (['Bagging Done', 'Issued to Vendor', 'Partially Received'].includes(st)) {
      out.push(B('📤 Issue to vendor', `O2D.open('issue',{customerId:${o.client_id}})`), B('📥 Receive from vendor', "O2D.open('receive')"));
    }
    if (st === 'Hallmarking Pending') out.push(B('🏷 Send for hallmark', `O2D.act.sendHallmark(${o.id},${o.effective_qty})`, 'btn-primary'), B('✓ Already hallmarked', `O2D.act.hallmarkDone(${o.id})`));
    if (st === 'Certification Pending') {
      const openLab = d.lab.find(j => j.status !== 'Received');
      if (!openLab) out.push(B('🔬 Send to lab', `O2D.act.sendLab(${o.id},${o.effective_qty},${o.lab_id || 0})`, 'btn-primary'));
      if (openLab) out.push(B('📥 Receive from lab', `O2D.act.receiveLab(${openLab.id},${openLab.pcs_sent},${o.id})`, 'btn-primary'));
      out.push(B('📎 Attach certificate', `O2D.act.uploadCert(${o.id},${(d.lab[d.lab.length - 1] || {}).id || 0})`), B('✓ Mark certified', `O2D.act.certDone(${o.id})`),
        B('Not required', `O2D.act.certNotRequired(${o.id})`));
    }
    if (st === 'Ready for Dispatch') out.push(B('🚚 Create dispatch', `O2D.open('dispatch',{customerId:${o.client_id},orderId:${o.id}})`, 'btn-primary'));
    if (['Payment Pending', 'Partially Paid', 'Dispatched'].includes(st)) out.push(B('💰 Record payment', `O2D.open('payments',{tab:'receipt',customerId:${o.client_id}})`, 'btn-primary'));
    const openTasks = d.tasks.filter(t => t.status === 'Open');
    if (openTasks.length === 1) out.push(B('🔔 Add follow-up', `O2D.openFollowup(${openTasks[0].id})`));
    else if (openTasks.length > 1) out.push(B(`🔔 Follow-ups (${openTasks.length})`, `O2D.open('order',{id:${o.id},tab:'followups'})`));
    if (!term) {
      out.push(B('✏️ Edit', `O2D.open('orderForm',{id:${o.id}})`), B('📎 Attach file', `O2D.act.attach(${o.id})`));
      const preProd = ['ORDER', 'CAD', 'APPROVAL', 'CONFIRMATION', 'ORDER_SHEET'].includes(o.current_stage);
      if (st === 'Hold') out.push(B('▶ Resume', `O2D.act.resume(${o.id})`));
      else if (preProd) out.push(B('⏸ Hold', `O2D.act.hold(${o.id})`));
      out.push(B('✖ Cancel order', `O2D.act.cancel(${o.id})`));
    }
    if (O2D.lk.isAdmin) out.push(B('⚙ Change status', `O2D.act.override(${o.id})`), B('🗑 Delete order', `O2D.act.deleteOrder(${o.id},'${h(o.order_no)}')`));
    return out.join('');
  }

  // ── Detail tabs ────────────────────────────────────
  const kv = (pairs) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 18px">${pairs.map(([k, v]) =>
    `<div><div style="font-size:10.5px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.04em">${h(k)}</div><div style="font-size:13px;margin-top:2px">${v == null || v === '' ? '—' : v}</div></div>`).join('')}</div>`;
  const filesOf = (d, types, ref) => d.files.filter(f => types.includes(f.file_type) && (!ref || (f.ref_table === ref[0] && f.ref_id === ref[1])));
  const TAB = {
    overview(d) {
      const o = d.order; const c = d.customer || {};
      const groups = [['design_photo', 'Design photos'], ['order_sheet', 'Order sheet'], ['quotation', 'Quotation'], ['cad', 'CAD files'],
        ['certificate', 'Certificates'], ['invoice', 'Invoice'], ['other', 'Other']];
      return O2D.card('Order', kv([
        ['Order No', h(o.order_no)], ['Unique ID', h(o.unique_id)], ['Created', O2D.fmtDT(o.created_at)], ['Submitted', O2D.fmtDT(o.submitted_on)],
        ['Client', h(o.client_name)], ['Sales person', h(o.sales_person_name)], ['Owner', h(o.owner_name)],
        ['Order type', h(o.order_type)], ['Style No', h(o.style_no)], ['Development', h(o.development_type)],
        ['Qty (pcs)', `${o.qty_pcs}${O2D.num(o.additional_reduction_pcs) ? ` ${o.additional_reduction_pcs > 0 ? '+' : ''}${o.additional_reduction_pcs} → <b>${o.effective_qty}</b>` : ''}`],
        ['Diamond carat', O2D.n3(o.diamond_carat_weight) + ' ct'], ['Quality', h(o.quality_name)],
        ['Certificate', o.certificate_required ? 'Required — ' + h(o.lab_name || '') : 'Not required'],
        ['Lead time', (o.lead_time_days || 0) + ' days'], ['Delivery date', O2D.fmtD(o.delivery_date)], ['CAD status', h(o.cad_status)],
        ['Quotation', o.quotation_posted_on ? `${O2D.money(o.quotation_amount)} · posted ${O2D.fmtDT(o.quotation_posted_on)}` : '—'],
        ['Confirmation', h(o.confirmation_status) + (o.confirmed_on ? ' · ' + O2D.fmtD(o.confirmed_on) : '')],
        ['Handed over', o.handed_over_on ? `${O2D.fmtDT(o.handed_over_on)} → ${h(O2D.userName(o.handed_over_to))}` : '—'],
        ['Hallmark', h(o.hallmark_status)], ['Certification', h(o.cert_status)],
      ]) + (o.remark ? `<div style="margin-top:12px;font-size:13px"><b>Remark:</b> ${h(o.remark)}</div>` : ''))
        + O2D.card('Client defaults', kv([['Company', h(c.company_name)], ['Contact', h(c.contact_number)], ['City', h(c.city)],
          ['Gold tunch', c.gold_tunch_pct != null ? O2D.num(c.gold_tunch_pct).toFixed(2) + '%' : '—'], ['Labour', c.labour_rate != null ? `${O2D.money(c.labour_rate)} ${h(c.labour_rate_basis || '')}` : '—'],
          ['Payment', `${c.payment_terms_days || 30} days · ${h(c.payment_style || '')}`], ['WhatsApp group', h(c.whatsapp_group_name)]]))
        + (d.diamondLines.length ? O2D.card('Diamond details', O2D.table([{ key: 'shape', label: 'Shape' }, { key: 'sieve_size', label: 'Size / Sieve' },
          { key: 'pcs', label: 'Pcs', type: 'int' }, { key: 'carat', label: 'Carat', type: 'num3' }], d.diamondLines)) : '')
        + O2D.card('Files', groups.map(([t, l]) => { const fs = d.files.filter(f => f.file_type === t); return fs.length ? `<div style="margin-bottom:8px"><div style="font-size:11.5px;font-weight:700;margin-bottom:4px">${l}</div>${O2D.fileChips(fs, { canDelete: true, onChange: 'refresh' })}</div>` : ''; }).join('') || '<span style="color:var(--muted-foreground);font-size:12px">No files yet</span>',
          `<button class="btn btn-outline btn-sm" onclick="O2D.act.attach(${o.id})">📎 Attach file</button>`);
    },
    timeline(d) {
      const items = d.statusLog.slice().reverse();
      return O2D.card('Order timeline', items.map((l, i) => `<div style="display:flex;gap:12px">
          <div style="display:flex;flex-direction:column;align-items:center"><div style="width:11px;height:11px;border-radius:50%;margin-top:4px;background:${i === 0 ? 'var(--primary)' : 'var(--border)'}"></div>${i < items.length - 1 ? '<div style="flex:1;width:2px;background:var(--border)"></div>' : ''}</div>
          <div style="padding-bottom:14px"><div style="font-size:13px">${O2D.chip(l.to_status)} ${l.to_stage && l.to_stage !== l.from_stage ? `<span style="font-size:11.5px;color:var(--muted-foreground)">→ ${h(O2D.STAGE_LABEL[l.to_stage] || l.to_stage)}</span>` : ''}</div>
          <div style="font-size:11.5px;color:var(--muted-foreground);margin-top:3px">${O2D.fmtDT(l.changed_at)} · ${h(l.changed_by_name || 'System')}</div>
          ${l.remark ? `<div style="font-size:12.5px;margin-top:2px">${h(l.remark)}</div>` : ''}</div></div>`).join('') || 'No history yet.');
    },
    cad(d) {
      const o = d.order;
      if (o.development_type !== 'New Development') return O2D.card('', 'CAD not required — From Existing Stock.');
      return O2D.card('CAD revisions', O2D.table([
        { key: 'revision_no', label: 'Rev', type: 'int' }, { key: 'vendor_name', label: 'CAD vendor' }, { key: 'requested_on', label: 'Requested', type: 'date' },
        { key: 'expected_on', label: 'Expected', type: 'date' }, { key: 'received_on', label: 'Received', type: 'date' }, { key: 'sent_on', label: 'Sent for approval', type: 'date' },
        { key: 'sent_channel', label: 'Channel' }, { key: 'approver_type', label: 'Approver' }, { key: 'approved_on', label: 'Approved', type: 'date' },
        { key: 'cad_status', label: 'Status', render: r => O2D.chip(r.cad_status) }, { key: 'decision_reason', label: 'Reason / changes', nowrap: false },
        { key: 'files', label: 'Files', render: r => O2D.fileChips(filesOf(d, ['cad'], ['fms_cad', r.id])) },
      ], d.cad, { empty: 'CAD not requested yet.' }) + (d.cad.length ? `<div style="font-size:12px;margin-top:10px"><b>Latest brief:</b> ${h(d.cad[d.cad.length - 1].brief || '—')}</div>` : ''));
    },
    bagging(d) {
      const o = d.order; const b = d.bagging;
      if (!b) return O2D.card('', o.order_status === 'Confirmed' ? 'Not handed over to production yet — use “Hand over to production”.' : 'Bagging starts after the order sheet is handed over to production.');
      return O2D.baggingPanel(d);
    },
    vendor(d) {
      return O2D.card('Issued to vendor', O2D.table([
        { key: 'issue_no', label: 'Issue No' }, { key: 'vendor_name', label: 'Vendor' }, { key: 'issue_date', label: 'Date', type: 'date' },
        { key: 'issue_invoice_no', label: 'Voucher No' }, { key: 'issued_pcs', label: 'Pcs', type: 'int' }, { key: 'issued_weight_gm', label: 'Weight (gm)', type: 'num3' },
        { key: 'issued_carat', label: 'Carat', type: 'num3' }, { key: 'expected_return_date', label: 'Expected back', type: 'date' },
        { key: 'received_pcs', label: 'Received pcs', type: 'int' }, { key: 'line_status', label: 'Status', render: r => O2D.chip(r.line_status) },
      ], d.issueLines, { empty: 'Nothing issued yet.' }))
        + O2D.card('Received from vendor', O2D.table([
          { key: 'receipt_no', label: 'Receipt No' }, { key: 'vendor_name', label: 'Vendor' }, { key: 'receipt_date', label: 'Date', type: 'date' },
          { key: 'vendor_invoice_no', label: 'Vendor bill' }, { key: 'received_pcs', label: 'Pcs', type: 'int' }, { key: 'received_weight_gm', label: 'Weight (gm)', type: 'num3' },
          { key: 'wastage_weight_gm', label: 'Wastage (gm)', type: 'num3' }, { key: 'calc_wastage_gm', label: 'Calc. wastage', type: 'num3' },
          { key: 'wastage_pct', label: 'Wastage %', render: r => `<span style="color:${O2D.num(r.wastage_pct) > 3 ? 'var(--destructive)' : 'inherit'};font-weight:${O2D.num(r.wastage_pct) > 3 ? 700 : 400}">${O2D.num(r.wastage_pct).toFixed(2)}%</span>` },
          { key: 'hallmark_done', label: 'Hallmarked', render: r => (r.hallmark_done ? 'Yes' : 'No') },
        ], d.receiptLines, { empty: 'Nothing received yet.' }));
    },
    quality(d) {
      return O2D.card('Hallmarking', O2D.table([
        { key: 'centre_name', label: 'Centre' }, { key: 'pcs_sent', label: 'Pcs sent', type: 'int' }, { key: 'sent_on', label: 'Sent', type: 'date' },
        { key: 'expected_on', label: 'Expected', type: 'date' }, { key: 'received_on', label: 'Received', type: 'date' }, { key: 'pcs_received', label: 'Pcs back', type: 'int' },
        { key: 'huid_numbers', label: 'HUID', nowrap: false }, { key: 'status', label: 'Status', render: r => O2D.chip(r.status) },
        { key: 'a', label: '', render: r => (r.status === 'Sent' ? `<button class="btn btn-primary btn-sm" onclick="O2D.act.receiveHallmark(${r.id},${r.pcs_sent})">Receive</button>` : '') },
      ], d.hallmark, { empty: d.order.hallmark_status === 'Done' ? 'Hallmarked at vendor — no job needed.' : 'No hallmark job.' }))
        + O2D.card('Lab certification', O2D.table([
          { key: 'lab_name', label: 'Lab' }, { key: 'pcs_sent', label: 'Pcs sent', type: 'int' }, { key: 'sent_on', label: 'Sent', type: 'date' }, { key: 'lab_challan_no', label: 'Challan' },
          { key: 'expected_on', label: 'Expected', type: 'date' }, { key: 'received_on', label: 'Received', type: 'date' }, { key: 'pcs_received', label: 'Pcs back', type: 'int' },
          { key: 'certificate_numbers', label: 'Certificate nos', nowrap: false }, { key: 'status', label: 'Status', render: r => O2D.chip(r.status) },
          { key: 'f', label: 'Certificates', render: r => O2D.fileChips(filesOf(d, ['certificate'], ['fms_lab_certificate', r.id])) },
        ], d.lab, { empty: d.order.certificate_required ? 'Not sent to lab yet.' : 'Certificate not required.' })
        + (filesOf(d, ['certificate']).length ? `<div style="margin-top:10px"><b style="font-size:12px">All certificates:</b><br>${O2D.fileChips(filesOf(d, ['certificate']))}</div>` : ''));
    },
    dispatch(d) {
      const bal = d.dispatchLines.reduce((s, l) => s + O2D.num(l.balance), 0);
      return O2D.card('Invoices / dispatch', O2D.table([
        { key: 'dispatch_no', label: 'Dispatch No' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'invoice_date', label: 'Invoice date', type: 'date' },
        { key: 'dispatch_date', label: 'Dispatched', type: 'date' }, { key: 'pcs', label: 'Pcs', type: 'int' }, { key: 'weight_gm', label: 'Weight', type: 'num3' },
        { key: 'invoice_amount', label: 'Invoice amt', type: 'money' }, { key: 'line_amount', label: 'This order', type: 'money' },
        { key: 'received_amount', label: 'Received', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'payment_due_date', label: 'Due', render: r => `${O2D.fmtD(r.payment_due_date)}${O2D.num(r.balance) > 0 && r.payment_due_date < O2D.today() ? O2D.flag(O2D.diffDays(r.payment_due_date, O2D.today()) + 'd overdue', 'var(--destructive)') : ''}` },
        { key: 'payment_status', label: 'Status', render: r => O2D.chip(r.payment_status) }, { key: 'courier', label: 'Courier' }, { key: 'awb_no', label: 'AWB' },
      ], d.dispatchLines, { empty: 'Not dispatched yet.' })
        + (filesOf(d, ['invoice']).length ? `<div style="margin-top:10px"><b style="font-size:12px">Invoice PDF:</b> ${O2D.fileChips(filesOf(d, ['invoice']))}</div>` : ''))
        + O2D.card(`Payments received${d.dispatchLines.length ? ` — balance ${O2D.money(bal)}` : ''}`, O2D.table([
          { key: 'receipt_no', label: 'Receipt' }, { key: 'receipt_date', label: 'Date', type: 'date' }, { key: 'payment_mode', label: 'Mode' },
          { key: 'kind', label: 'Allocation' }, { key: 'category', label: 'Category' }, { key: 'allocated_amount', label: 'Amount', type: 'money' },
        ], d.payments, { empty: 'No payments yet.' }));
    },
    followups(d) {
      return O2D.card('Follow-up tasks', d.tasks.map(t => {
        const logs = d.taskLogs.filter(l => l.task_id === t.id);
        const overdue = t.status === 'Open' && t.next_followup_date < O2D.today();
        return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>${h(O2D.TASK_LABEL[t.task_type] || t.task_type)}</b> — ${h(t.title || '')} ${O2D.chip(t.status)}</div>
          <div>${t.status === 'Open' ? `<button class="btn btn-primary btn-sm" onclick="O2D.openFollowup(${t.id})">+ Follow-up</button>` : ''}</div></div>
          <div style="font-size:12px;color:var(--muted-foreground);margin-top:3px">Assigned ${h(t.assigned_to_name || '—')} · Opened ${O2D.fmtDT(t.opened_on)} · ${t.status === 'Open' ? `Next <b style="color:${overdue ? 'var(--destructive)' : 'inherit'}">${O2D.fmtD(t.next_followup_date)}</b>` : `Closed ${O2D.fmtDT(t.closed_on)} — ${h(t.closed_reason || '')}`} · ${t.followup_count} follow-up(s)</div>
          ${logs.map(l => `<div style="font-size:12px;margin-top:6px;padding-left:10px;border-left:3px solid var(--border)"><b>${h(l.outcome)}</b> · ${h(l.mode)} · ${O2D.fmtDT(l.followup_date)} · ${h(l.created_by_name || '')}${l.remark ? ` — ${h(l.remark)}` : ''}${l.next_followup_date ? ` <span style="color:var(--muted-foreground)">(next ${O2D.fmtD(l.next_followup_date)})</span>` : ''}</div>`).join('')}
        </div>`;
      }).join('') || 'No follow-ups for this order yet.');
    },
    activity(d) {
      const ev = [
        ...d.statusLog.map(l => ({ at: l.changed_at, who: l.changed_by_name, what: `Status → <b>${h(l.to_status)}</b>${l.remark ? ' — ' + h(l.remark) : ''}` })),
        ...d.changeLog.map(l => ({ at: l.changed_at, who: l.changed_by_name, what: `Changed <b>${h(l.field_name)}</b>: ${h(l.old_value || '—')} → ${h(l.new_value || '—')}${l.reason ? ' — ' + h(l.reason) : ''}` })),
        ...d.taskLogs.map(l => ({ at: l.followup_date, who: l.created_by_name, what: `Follow-up: <b>${h(l.outcome)}</b> (${h(l.mode)})${l.remark ? ' — ' + h(l.remark) : ''}` })),
        ...d.files.map(f => ({ at: f.created_at, who: f.uploaded_by, what: `Uploaded ${h(f.file_type)}: ${h(f.file_name)}` })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return O2D.card('Activity / audit log', O2D.table([
        { key: 'at', label: 'When', render: r => O2D.fmtDT(r.at) }, { key: 'who', label: 'Who' }, { key: 'what', label: 'What', nowrap: false, render: r => r.what },
      ], ev));
    },
  };

  // Bagging panel — detail tab aur Bagging screen dono me
  O2D.baggingPanel = (d) => {
    const o = d.order; const b = d.bagging;
    const term = ['Cancelled', 'Closed'].includes(o.order_status);
    const reqs = d.requirements.filter(r => r.requirement_status !== 'Cancelled');
    const raised = reqs.reduce((s, r) => s + O2D.num(r.required_pcs), 0);
    const recd = reqs.reduce((s, r) => s + O2D.num(r.received_pcs), 0);
    const stillShort = reqs.filter(r => ['Open', 'Partially Received'].includes(r.requirement_status)).reduce((s, r) => s + O2D.num(r.pending_pcs), 0);
    const tile = (l, v, tone) => `<div style="flex:1;min-width:100px;background:var(--muted);border-radius:10px;padding:8px 10px"><div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase">${l}</div><div style="font-size:19px;font-weight:700;color:${tone || 'var(--foreground)'}">${v}</div></div>`;
    const btns = [];
    if (!term) {
      if (!b.details_verified && !o.bagging_query) btns.push(`<button class="btn btn-primary btn-sm" onclick="O2D.act.verify(${b.id})">✔ Verify order sheet</button>`);
      if (b.details_verified && b.pending_pcs > 0) btns.push(`<button class="btn btn-primary btn-sm" onclick="O2D.act.bagEntry(${b.id},${b.pending_pcs},${o.id})">+ Bagging entry</button>`);
      if (b.details_verified && b.pending_pcs - stillShort > 0) btns.push(`<button class="btn btn-outline btn-sm" onclick="O2D.act.raiseReq(${b.id},${b.pending_pcs - stillShort})">⚠ Raise requirement (${b.pending_pcs - stillShort} short)</button>`);
    }
    const shortBanner = b.details_verified && b.pending_pcs > 0 && !stillShort && b.total_bagged > 0
      ? `<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;font-size:12.5px;background:color-mix(in srgb,var(--warning) 12%,transparent)">Short material: <b>${b.pending_pcs} pcs</b> — raise a requirement if diamonds are not in stock.</div>` : '';
    return O2D.card(`Bagging — ${O2D.chip(b.bagging_status)}`, `
      <div style="font-size:12px;color:var(--muted-foreground);margin-bottom:10px">Doer ${h(b.doer_name || O2D.userName(b.doer_id))} · ${b.details_verified ? `Verified ${O2D.fmtDT(b.verified_on)}` : 'Order sheet not verified yet'}${b.verification_remark ? ` · ${h(b.verification_remark)}` : ''}</div>
      ${shortBanner}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${tile('Order qty', b.order_qty)}${tile('Bagged', b.total_bagged, 'var(--success)')}${tile('Rejected', b.total_rejected, b.total_rejected ? 'var(--destructive)' : '')}
        ${tile('Pending', b.pending_pcs, b.pending_pcs ? 'var(--warning)' : 'var(--success)')}${tile('Requirement raised', raised)}${tile('Received from vendor', recd)}${tile('Still short', stillShort, stillShort ? 'var(--destructive)' : '')}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${btns.join('')}</div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">Bagging rounds</div>
      ${O2D.table([{ key: 'entry_date', label: 'Date', type: 'date' }, { key: 'bagged_pcs', label: 'Bagged', type: 'int' }, { key: 'rejected_pcs', label: 'Rejected', type: 'int' },
        { key: 'rejection_reason', label: 'Rejection reason', nowrap: false }, { key: 'bagged_carat', label: 'Carat', type: 'num3' }, { key: 'linked_receipt_id', label: 'From vendor receipt', render: r => (r.linked_receipt_id ? '#' + r.linked_receipt_id : '—') },
        { key: 'remark', label: 'Remark', nowrap: false },
        { key: 'x', label: '', render: r => (O2D.lk.isAdmin && !term ? `<button class="btn btn-outline btn-sm" onclick="O2D.act.delEntry(${r.id})">✕</button>` : '') }], d.baggingEntries, { empty: 'No bagging rounds yet.' })}
      <div style="font-size:12px;font-weight:700;margin:14px 0 6px">Short-material requirements</div>
      ${O2D.table([{ key: 'requirement_no', label: 'Req No' }, { key: 'vendor_name', label: 'Diamond supplier' }, { key: 'required_pcs', label: 'Required', type: 'int' },
        { key: 'required_carat', label: 'Carat', type: 'num3' }, { key: 'shape', label: 'Shape' }, { key: 'size', label: 'Size' }, { key: 'quality', label: 'Quality' },
        { key: 'required_by_date', label: 'Required by', type: 'date' }, { key: 'received_pcs', label: 'Received', type: 'int' }, { key: 'pending_pcs', label: 'Pending', type: 'int' },
        { key: 'requirement_status', label: 'Status', render: r => O2D.chip(r.requirement_status) },
        { key: 'r', label: 'Receipts', nowrap: false, render: r => d.reqReceipts.filter(x => x.requirement_id === r.id).map(x => `#${x.id}: ${x.received_pcs} pcs ${O2D.fmtD(x.receipt_date)}${x.vendor_invoice_no ? ' (' + h(x.vendor_invoice_no) + ')' : ''}`).join('<br>') || '—' },
        { key: 'a', label: '', render: r => (['Open', 'Partially Received'].includes(r.requirement_status) && !term
          ? `<button class="btn btn-primary btn-sm" onclick="O2D.act.receiveReq(${r.id},${r.pending_pcs})">Receive</button> <button class="btn btn-outline btn-sm" onclick="O2D.act.cancelReq(${r.id})">Cancel</button>` : '') }],
      d.requirements, { empty: 'No shortfall raised.' })}`);
  };

  // ══════════════════════════════════════════════════════
  // ACTIONS (shared by detail page + stage screens)
  // ══════════════════════════════════════════════════════
  const simple = async (url, method, body, msg) => {
    const r = await api(url, method, body || {});
    if (r.error) { showToast(r.error, 'error'); return false; }
    showToast(msg || 'Done'); after(); return true;
  };
  const reasonOptions = () => (O2D.lk.reasons || []).filter(r => r.is_active).map(r => r.name);
  const reasonFields = (label) => [
    { name: 'reason_pick', label: 'Reason', type: 'select', options: reasonOptions() },
    { name: 'reason', label: label || 'Details', type: 'textarea', rows: 2, span: true },
  ];
  const joinReason = (v) => [v.reason_pick, v.reason].filter(Boolean).join(' — ');

  act.submit = (id) => simple(`/api/o2d/orders/${id}/submit`, 'POST', {}, 'Order submitted');
  // Poora order system se mit jaata hai — CAD, bagging, vendor, hallmark/lab,
  // invoice, follow-ups, files, history sab. Wapas nahi aata.
  act.deleteOrder = async (id, orderNo) => {
    const msg = `Order ${orderNo || ''} will be permanently deleted from the system — along with its CAD, bagging, vendor issue/receipt, `
      + 'hallmark/lab, invoice, follow-ups, files and history. Money already received stays with the customer as on-account. This cannot be undone.';
    if (!await confirmDialog(msg, { title: `Delete order ${orderNo || ''}?`, okText: 'Yes, delete', danger: true })) return;
    const r = await api(`/api/o2d/orders/${id}`, 'DELETE');
    if (r.error) return showToast(r.error, 'error');
    showToast(`Order ${r.order_no} deleted`); O2D.refreshBadge();
    if (O2D.state.view === 'orders') O2D.refresh(); else O2D.open('orders');
  };
  act.cancel = (id) => O2D.formModal({
    title: 'Cancel order', submitText: 'Cancel order', danger: true, width: 480, fields: reasonFields('Details'),
    intro: 'All open follow-ups for this order will close. This cannot be undone.',
    onSubmit: async (v) => { const reason = joinReason(v); if (!reason) throw new Error('Reason is required'); await O2D.req(`/api/o2d/orders/${id}/cancel`, 'POST', { reason }); showToast('Order cancelled'); after(); },
  });
  act.hold = (id) => O2D.formModal({
    title: 'Put order on hold', submitText: 'Hold', width: 480, fields: reasonFields('Details'),
    onSubmit: async (v) => { const reason = joinReason(v); if (!reason) throw new Error('Reason is required'); await O2D.req(`/api/o2d/orders/${id}/hold`, 'POST', { reason }); showToast('On hold'); after(); },
  });
  act.resume = (id) => simple(`/api/o2d/orders/${id}/resume`, 'POST', {}, 'Resumed');
  act.override = (id) => O2D.formModal({
    title: 'Change status (admin)', width: 520, submitText: 'Change',
    intro: 'For correcting mistakes only — normal flow should move through the stage screens.',
    fields: [
      { name: 'to_status', label: 'New status', type: 'select', required: true, options: Object.values(O2D.lk.statuses) },
      { name: 'stage', label: 'Stage', type: 'select', options: O2D.STAGES.map(s => ({ value: s, label: O2D.STAGE_LABEL[s] })), placeholder: '— Keep current —' },
      { name: 'remark', label: 'Remark', type: 'textarea', required: true, span: true },
    ],
    onSubmit: async (v) => { if (!v.stage) delete v.stage; await O2D.req(`/api/o2d/orders/${id}/status`, 'POST', v); showToast('Status changed'); after(); },
  });
  act.attach = (orderId) => O2D.formModal({
    title: 'Attach file', width: 480, submitText: 'Upload',
    fields: [{ name: 'file_type', label: 'Type', type: 'select', required: true, noEmpty: true,
      options: [['design_photo', 'Design photo'], ['order_sheet', 'Order sheet'], ['quotation', 'Quotation'], ['cad', 'CAD file'], ['certificate', 'Certificate'], ['invoice', 'Invoice'], ['other', 'Other']].map(([v, l]) => ({ value: v, label: l })) },
    { name: 'files', label: 'File(s)', type: 'file', multiple: true, required: true }],
    onSubmit: async (v) => { await O2D.uploadMany(orderId, v.files, v.file_type); showToast('Uploaded'); after(); },
  });

  // CAD
  act.requestCad = (orderId) => {
    const vendors = O2D.vendorOptions('CAD');
    O2D.formModal({
      title: 'Request CAD from vendor', width: 560, submitText: 'Request CAD',
      intro: vendors.length ? 'Design photos of the order are shared as reference. A vendor follow-up loop starts until the CAD is received.' : '⚠️ No CAD vendor in Masters → Vendors yet.',
      fields: [
        { name: 'cad_vendor_id', label: 'CAD vendor', type: 'select', required: true, options: vendors },
        { name: 'requested_on', label: 'Requested on', type: 'date', required: true, value: O2D.today() },
        { name: 'expected_on', label: 'Expected on', type: 'date', help: 'Blank = requested + vendor lead time' },
        { name: 'brief', label: 'Design brief / instructions', type: 'textarea', span: true, rows: 3 },
      ],
      onChange: (v) => {
        const vd = O2D.vendor(v.cad_vendor_id); const e = $('o2dm_expected_on');
        if (vd && e && !e.dataset.touched) e.value = O2D.addDays(v.requested_on || O2D.today(), vd.default_lead_time_days || 7);
      },
      onSubmit: async (v) => { await O2D.req(`/api/o2d/orders/${orderId}/cad`, 'POST', v); showToast('CAD requested'); after(); },
    });
    const e = $('o2dm_expected_on'); if (e) e.addEventListener('input', () => { e.dataset.touched = '1'; });
  };
  act.receiveCad = (cadId, orderId) => O2D.formModal({
    title: 'CAD received', width: 520, submitText: 'Mark received',
    fields: [{ name: 'received_on', label: 'Received on', type: 'date', required: true, value: O2D.today() },
      { name: 'files', label: 'CAD files (images / 3DM / STL / PDF)', type: 'file', multiple: true }],
    onSubmit: async (v) => {
      await O2D.req(`/api/o2d/cad/${cadId}/receive`, 'PUT', { received_on: v.received_on });
      if (v.files && v.files.length) await O2D.uploadMany(orderId, v.files, 'cad', 'fms_cad', cadId);
      showToast('CAD received'); after();
    },
  });
  act.sendCadApproval = (cadId, orderType) => O2D.formModal({
    title: orderType === 'Stock Order' ? 'Send CAD for internal (owner/MD) approval' : 'Send CAD to client for approval', width: 520, submitText: 'Sent',
    fields: [{ name: 'sent_on', label: 'Sent on', type: 'date', required: true, value: O2D.today() },
      { name: 'channel', label: 'Channel', type: 'select', noEmpty: true, options: ['WhatsApp', 'Email', 'In person'] },
      { name: 'next_followup_date', label: 'First follow-up', type: 'date', help: 'Blank = per Stage Settings TAT' },
      { name: 'note', label: 'Note', type: 'textarea', span: true, rows: 2 }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/cad/${cadId}/send-approval`, 'PUT', v); showToast('Sent for approval'); after(); },
  });
  act.cadDecision = (cadId) => O2D.formModal({
    title: 'CAD decision', width: 560, submitText: 'Save decision',
    intro: 'Rejected → a new CAD revision is requested automatically from the same vendor (vendor loop restarts).',
    fields: [
      { name: 'decision', label: 'Decision', type: 'select', required: true, options: ['Approved', 'Rejected', 'Hold', 'Cancelled'] },
      { name: 'reason', label: 'Reason / changes required', type: 'textarea', rows: 3, span: true, required: true, showIf: v => ['Rejected', 'Hold', 'Cancelled'].includes(v.decision) },
      { name: 'next_followup_date', label: 'Next follow-up', type: 'date', required: true, min: O2D.today(), showIf: v => v.decision === 'Hold' },
      { name: 'expected_on', label: 'New revision expected on', type: 'date', showIf: v => v.decision === 'Rejected' },
    ],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/cad/${cadId}/decision`, 'PUT', v); showToast('Decision saved'); after(); },
  });

  // Quotation & confirmation
  act.postQuotation = (orderId) => O2D.formModal({
    title: 'Picture & quotation posted on WhatsApp group', width: 560, submitText: 'Mark posted',
    intro: 'Tick after posting the picture + quotation on the client’s / party’s WhatsApp group. The time is stamped and a confirmation follow-up starts.',
    fields: [
      { name: 'posted', label: 'Posted on WhatsApp group', type: 'checkbox', checkLabel: 'Yes, posted', required: true },
      { name: 'quotation_amount', label: 'Quotation amount (₹)', type: 'number', step: '0.01', help: 'Used for value reports & sales forecast' },
      { name: 'next_followup_date', label: 'First follow-up', type: 'date', help: 'Blank = per Stage Settings TAT' },
      { name: 'quotation_remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
      { name: 'files', label: 'Quotation file', type: 'file' },
    ],
    onSubmit: async (v) => {
      if (!v.posted) throw new Error('Tick “Posted on WhatsApp group”');
      await O2D.req(`/api/o2d/orders/${orderId}/quotation-posted`, 'PUT', v);
      if (v.files && v.files.length) await O2D.uploadMany(orderId, v.files, 'quotation');
      showToast('Quotation posted'); after();
    },
  });
  act.confirmDecision = (orderId) => O2D.formModal({
    title: 'Order confirmation', width: 520, submitText: 'Save',
    fields: [
      { name: 'decision', label: 'Client decision', type: 'select', required: true, options: ['Confirmed', 'Hold', 'Cancelled'] },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 2, span: true, required: true, showIf: v => ['Hold', 'Cancelled'].includes(v.decision) },
      { name: 'next_followup_date', label: 'Next follow-up (hold)', type: 'date', required: true, min: O2D.today(), showIf: v => v.decision === 'Hold' },
    ],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/orders/${orderId}/confirmation`, 'PUT', v); showToast('Saved'); after(); },
  });

  // Order sheet & handover
  act.printSheet = (orderId) => window.open(`/api/o2d/orders/${orderId}/order-sheet.pdf`, '_blank');
  act.handover = (orderId) => O2D.formModal({
    title: 'Hand over to production', width: 480, submitText: 'Hand over',
    intro: 'Print the order sheet first. Handing over starts bagging and creates the bagging record.',
    fields: [{ name: 'handed_over_to', label: 'Production / bagging person', type: 'select', required: true, options: O2D.userOptions(),
      value: ((O2D.lk.stages || []).find(s => s.stage_key === 'BAGGING') || {}).default_assignee_id || '' }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/orders/${orderId}/handover`, 'POST', v); showToast('Handed over — bagging started'); after(); },
  });
  act.resolveQuery = (orderId) => O2D.formModal({
    title: 'Resolve bagging query', width: 480, submitText: 'Resolved — send back',
    fields: [{ name: 'remark', label: 'What was corrected?', type: 'textarea', required: true, span: true }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/orders/${orderId}/resolve-query`, 'POST', v); showToast('Sent back to bagging'); after(); },
  });

  // Bagging
  act.verify = (bagId) => O2D.formModal({
    title: 'Verify order sheet details', width: 500, submitText: 'Save',
    intro: 'Step 1 — check the order sheet. If details are wrong, the order is flagged “Bagging Query” and goes back to the order desk.',
    fields: [{ name: 'ok', label: 'Are the details correct?', type: 'select', required: true, noEmpty: true, options: [{ value: '1', label: 'Yes — correct' }, { value: '0', label: 'No — raise query' }] },
      { name: 'remark', label: 'What is wrong?', type: 'textarea', rows: 2, span: true, required: true, showIf: v => v.ok === '0' }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/bagging/${bagId}/verify`, 'PUT', { ok: v.ok === '1', remark: v.remark }); showToast(v.ok === '1' ? 'Verified' : 'Query raised'); after(); },
  });
  act.bagEntry = async (bagId, pending, orderId) => {
    let d = O2D.cur && O2D.cur.bagging && O2D.cur.bagging.id === bagId ? O2D.cur : null;
    if (!d && orderId) { const r = await api(`/api/o2d/orders/${orderId}`); if (!r.error) d = r; }
    const rcpts = d ? d.reqReceipts : [];
    O2D.formModal({
      title: `Bagging entry (${pending} pcs pending)`, width: 560, submitText: 'Save entry',
      fields: [
        { name: 'entry_date', label: 'Date', type: 'date', required: true, value: O2D.today() },
        { name: 'bagged_pcs', label: 'Bagged pcs', type: 'number', min: 0, max: pending, required: true },
        { name: 'rejected_pcs', label: 'Rejected pcs', type: 'number', min: 0, value: 0, help: 'Rejected are not counted as bagged' },
        { name: 'rejection_reason', label: 'Rejection reason', type: 'textarea', rows: 2, span: true, required: true, showIf: v => parseInt(v.rejected_pcs, 10) > 0 },
        { name: 'bagged_carat', label: 'Bagged carat', type: 'number', step: '0.001' },
        { name: 'linked_receipt_id', label: 'Used material from vendor receipt', type: 'select', options: rcpts.map(x => ({ value: x.id, label: `#${x.id} — ${x.received_pcs} pcs on ${O2D.fmtD(x.receipt_date)}` })), placeholder: '— None —' },
        { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
      ],
      onSubmit: async (v) => { await O2D.req(`/api/o2d/bagging/${bagId}/entries`, 'POST', v); showToast('Entry saved'); after(); },
    });
  };
  act.delEntry = async (id) => {
    if (!await confirmDialog('Remove this bagging round? Totals will be recalculated.', { title: 'Remove entry', okText: 'Remove', danger: true })) return;
    simple(`/api/o2d/bagging-entries/${id}`, 'DELETE', null, 'Entry removed');
  };
  act.raiseReq = (bagId, shortPcs) => {
    const vendors = O2D.vendorOptions('Diamond Supplier');
    O2D.formModal({
      title: 'Raise requirement to diamond supplier', width: 600, submitText: 'Raise requirement',
      intro: vendors.length ? `Short material: <b>${shortPcs} pcs</b>. A vendor follow-up starts until the material is received.` : '⚠️ No Diamond Supplier vendor in Masters yet.',
      fields: [
        { name: 'vendor_id', label: 'Diamond supplier', type: 'select', required: true, options: vendors },
        { name: 'required_pcs', label: 'Required pcs', type: 'number', min: 1, max: shortPcs, value: shortPcs, required: true },
        { name: 'required_carat', label: 'Required carat', type: 'number', step: '0.001' },
        { name: 'shape', label: 'Shape' }, { name: 'size', label: 'Size / sieve' }, { name: 'quality', label: 'Quality', placeholder: 'e.g. VVS-EF' },
        { name: 'required_by_date', label: 'Required by', type: 'date', required: true, min: O2D.today(), value: O2D.addDays(O2D.today(), 3) },
        { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
      ],
      onSubmit: async (v) => { await O2D.req('/api/o2d/requirements', 'POST', { ...v, bagging_id: bagId }); showToast('Requirement raised'); after(); },
    });
  };
  act.receiveReq = (reqId, pending) => O2D.formModal({
    title: `Receive short material (${pending} pcs pending)`, width: 540, submitText: 'Save receipt',
    intro: 'After receiving, add another bagging entry for these pcs (linked to this receipt).',
    fields: [
      { name: 'receipt_date', label: 'Receipt date', type: 'date', required: true, value: O2D.today() },
      { name: 'received_pcs', label: 'Received pcs', type: 'number', min: 1, max: pending, required: true },
      { name: 'received_carat', label: 'Received carat', type: 'number', step: '0.001' },
      { name: 'vendor_invoice_no', label: 'Vendor invoice no' }, { name: 'vendor_invoice_date', label: 'Vendor invoice date', type: 'date' },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
    ],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/requirements/${reqId}/receipts`, 'POST', v); showToast('Material received'); after(); },
  });
  act.cancelReq = (reqId) => O2D.formModal({
    title: 'Cancel requirement', width: 460, submitText: 'Cancel requirement', danger: true,
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: true }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/requirements/${reqId}/cancel`, 'PUT', v); showToast('Requirement cancelled'); after(); },
  });

  // Hallmark & lab
  act.sendHallmark = (orderId, qty) => O2D.formModal({
    title: 'Send for hallmarking', width: 520, submitText: 'Sent',
    fields: [
      { name: 'hallmark_centre_id', label: 'Hallmarking centre', type: 'select', required: true, options: O2D.vendorOptions('Hallmarking') },
      { name: 'pcs_sent', label: 'Pcs sent', type: 'number', min: 1, value: qty, required: true },
      { name: 'sent_on', label: 'Sent on', type: 'date', required: true, value: O2D.today() },
      { name: 'expected_on', label: 'Expected on', type: 'date', help: 'Blank = per Stage Settings TAT' },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
    ],
    onSubmit: async (v) => { await O2D.req('/api/o2d/hallmark', 'POST', { ...v, order_id: orderId }); showToast('Sent for hallmarking'); after(); },
  });
  act.receiveHallmark = (jobId, pcs) => O2D.formModal({
    title: 'Receive from hallmarking', width: 520, submitText: 'Received',
    fields: [{ name: 'received_on', label: 'Received on', type: 'date', required: true, value: O2D.today() },
      { name: 'pcs_received', label: 'Pcs received', type: 'number', min: 1, max: pcs, value: pcs, required: true },
      { name: 'huid_numbers', label: 'HUID numbers', type: 'textarea', rows: 2, span: true, placeholder: 'Optional — one per line' },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/hallmark/${jobId}/receive`, 'PUT', v); showToast('Hallmark received'); after(); },
  });
  act.hallmarkDone = async (orderId) => {
    const remark = await promptDialog('Pieces are already hallmarked — any note?', { title: 'Mark hallmarked', okText: 'Mark done', placeholder: 'Optional' });
    if (remark === null) return;
    simple(`/api/o2d/orders/${orderId}/hallmark-done`, 'POST', { remark }, 'Hallmark done');
  };
  act.sendLab = (orderId, qty, labId) => O2D.formModal({
    title: 'Send to lab for certification', width: 520, submitText: 'Sent',
    fields: [
      { name: 'lab_id', label: 'Lab', type: 'select', required: true, options: O2D.labOptions(), value: labId || '' },
      { name: 'pcs_sent', label: 'Pcs sent', type: 'number', min: 1, value: qty, required: true },
      { name: 'sent_on', label: 'Sent on', type: 'date', required: true, value: O2D.today() },
      { name: 'lab_challan_no', label: 'Lab challan no' },
      { name: 'expected_on', label: 'Expected on', type: 'date', help: 'Blank = per Stage Settings TAT' },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
    ],
    onSubmit: async (v) => { await O2D.req('/api/o2d/lab-jobs', 'POST', { ...v, order_id: orderId }); showToast('Sent to lab'); after(); },
  });
  act.receiveLab = (jobId, pcs, orderId) => O2D.formModal({
    title: 'Receive from lab', width: 540, submitText: 'Received',
    fields: [{ name: 'received_on', label: 'Received on', type: 'date', required: true, value: O2D.today() },
      { name: 'pcs_received', label: 'Pcs received', type: 'number', min: 1, max: pcs, value: pcs, required: true },
      { name: 'certificate_numbers', label: 'Certificate numbers', type: 'textarea', rows: 2, span: true, placeholder: 'Optional — one per piece' },
      { name: 'files', label: 'Certificate files', type: 'file', multiple: true },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true }],
    onSubmit: async (v) => {
      await O2D.req(`/api/o2d/lab-jobs/${jobId}/receive`, 'PUT', v);
      if (v.files && v.files.length && orderId) await O2D.uploadMany(orderId, v.files, 'certificate', 'fms_lab_certificate', jobId);
      showToast('Lab job received — attach certificates and mark certified'); after();
    },
  });
  act.uploadCert = (orderId, jobId) => O2D.formModal({
    title: 'Attach certificate(s)', width: 480, submitText: 'Upload',
    fields: [{ name: 'files', label: 'Certificate PDF / images', type: 'file', multiple: true, required: true }],
    onSubmit: async (v) => { await O2D.uploadMany(orderId, v.files, 'certificate', jobId ? 'fms_lab_certificate' : null, jobId || null); showToast('Certificate attached'); after(); },
  });
  act.certDone = (orderId) => simple(`/api/o2d/orders/${orderId}/certification-done`, 'POST', {}, 'Certified — ready for dispatch');
  act.certNotRequired = (orderId) => O2D.formModal({
    title: 'Certificate not required', width: 460, submitText: 'Confirm',
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: true }],
    onSubmit: async (v) => { await O2D.req(`/api/o2d/orders/${orderId}/certificate-not-required`, 'POST', v); showToast('Moved to Ready for Dispatch'); after(); },
  });
})();
