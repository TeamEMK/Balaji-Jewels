// ══════════════════════════════════════════════════════
// ORDER-TO-DISPATCH FMS — frontend core
// ──────────────────────────────────────────────────────
// Poora module window.O2D namespace me hai (app.js ke globals se takrav
// na ho). Ye file: shell + sub-nav, formatters, modal/form builder, table &
// chart helpers, Follow-up drawer/screen, Masters & Stage Settings.
// Baaki screens: o2d-orders.js, o2d-ops.js, o2d-insights.js.
// app.js ke helpers use hote hain: api, escapeHtml, showToast,
// confirmDialog, promptDialog, cssVar, ME.
// ══════════════════════════════════════════════════════
(function () {
  'use strict';
  const O2D = window.O2D = window.O2D || {};
  const $ = (id) => document.getElementById(id);
  const h = (s) => escapeHtml(s == null ? '' : s);
  O2D.$ = $; O2D.h = h;

  // ── Constants ──────────────────────────────────────
  O2D.STAGE_LABEL = {
    ORDER: 'Order Entry', CAD: 'CAD', APPROVAL: 'CAD Approval', CONFIRMATION: 'Confirmation', ORDER_SHEET: 'Order Sheet',
    BAGGING: 'Bagging', VENDOR: 'At Vendor', HALLMARK: 'Hallmark', LAB: 'Lab', DISPATCH: 'Dispatch', PAYMENT: 'Payment',
  };
  O2D.STAGES = Object.keys(O2D.STAGE_LABEL);
  O2D.TASK_LABEL = {
    CAD_VENDOR: 'CAD – Vendor', CAD_CLIENT_APPROVAL: 'CAD – Approval', ORDER_CONFIRMATION: 'Confirmation',
    REQUIREMENT_VENDOR: 'Short Material', VENDOR_FG: 'Vendor (FG)', HALLMARK: 'Hallmark', LAB: 'Lab', PAYMENT: 'Payment',
  };
  O2D.INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
    'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

  // Status chip colour — status families share one token (never colour-only:
  // the chip always carries the status text).
  function statusTone(s) {
    if (!s) return 'var(--muted-foreground)';
    if (['Closed', 'Paid', 'Ready for Dispatch', 'Certified', 'Hallmarking Done', 'Bagging Done', 'Received from Vendor', 'CAD Approved', 'Confirmed', 'Received', 'Approved', 'Completed'].includes(s)) return 'var(--success)';
    if (['Cancelled', 'Rejected', 'CAD Rejected'].includes(s)) return 'var(--destructive)';
    if (['Hold', 'Shortfall - Awaiting Vendor', 'Partially Received', 'Partially Paid', 'Payment Pending', 'Pending Verification'].includes(s)) return 'var(--warning)';
    if (s === 'Draft') return 'var(--muted-foreground)';
    return 'var(--chart-1)';
  }
  O2D.chip = (s, tone) => {
    const c = tone || statusTone(s);
    return `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap;color:${c};background:color-mix(in srgb,${c} 12%,transparent);border:1px solid color-mix(in srgb,${c} 28%,transparent)">${h(s || '—')}</span>`;
  };
  O2D.flag = (text, tone) => `<span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:6px;margin-left:4px;color:${tone};background:color-mix(in srgb,${tone} 12%,transparent)">${h(text)}</span>`;

  // ── Formatters ─────────────────────────────────────
  O2D.today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  O2D.addDays = (d, n) => { const x = new Date((d || O2D.today()) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + (parseInt(n, 10) || 0)); return x.toISOString().slice(0, 10); };
  O2D.diffDays = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T00:00:00Z')) / 86400000);
  O2D.fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—');
  O2D.fmtDT = (d) => (d ? `${O2D.fmtD(d)} ${String(d).slice(11, 16)}` : '—');
  O2D.num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  O2D.money = (v) => (v == null || v === '' ? '—' : '₹' + O2D.num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  O2D.n3 = (v) => (v == null || v === '' ? '—' : O2D.num(v).toFixed(3));
  O2D.n1 = (v) => (v == null || v === '' ? '—' : O2D.num(v).toFixed(1));
  O2D.fmtVal = (v, type) => {
    if (type === 'date') return O2D.fmtD(v);
    if (type === 'money') return O2D.money(v);
    if (type === 'num3') return O2D.n3(v);
    if (type === 'num1') return O2D.n1(v);
    if (type === 'pct') return v == null || v === '' ? '—' : O2D.num(v).toFixed(1) + '%';
    if (type === 'int') return v == null || v === '' ? '—' : String(Math.round(O2D.num(v)));
    return v == null || v === '' ? '—' : h(v);
  };

  // ── Lookups ────────────────────────────────────────
  O2D.lk = null;
  O2D.loadLookups = async (force) => {
    if (O2D.lk && !force) return O2D.lk;
    const d = await api('/api/o2d/lookups');
    if (d.error) throw new Error(d.error);
    O2D.lk = d;
    return d;
  };
  const byId = (list, id) => (list || []).find(x => String(x.id) === String(id));
  O2D.userName = (id) => { const u = byId(O2D.lk && O2D.lk.users, id); return u ? u.name : '—'; };
  O2D.opts = (list, sel, label, empty) => (empty === false ? '' : `<option value="">${h(empty || '— Select —')}</option>`)
    + (list || []).map(x => `<option value="${h(x.id)}" ${String(x.id) === String(sel) ? 'selected' : ''}>${h(label(x))}</option>`).join('');
  O2D.userOptions = () => (O2D.lk.users || []).map(u => ({ value: u.id, label: u.name + (u.department ? ` · ${u.department}` : '') }));
  O2D.customerOptions = (all) => (O2D.lk.customers || []).filter(c => all || c.is_active).map(c => ({ value: c.id, label: c.client_name + (c.city ? ` · ${c.city}` : '') }));
  O2D.vendorOptions = (type) => (O2D.lk.vendors || []).filter(v => v.is_active && (!type || v.vendor_type === type)).map(v => ({ value: v.id, label: v.vendor_name }));
  O2D.qualityOptions = () => (O2D.lk.quality || []).filter(x => x.is_active).map(x => ({ value: x.id, label: x.name }));
  O2D.labOptions = () => (O2D.lk.labs || []).filter(x => x.is_active).map(x => ({ value: x.id, label: x.name }));
  O2D.customer = (id) => byId(O2D.lk.customers, id);
  O2D.vendor = (id) => byId(O2D.lk.vendors, id);

  // ── Files ──────────────────────────────────────────
  O2D.fileUrl = (id, download) => `/api/o2d/files/${id}${download ? '?download=1' : ''}`;
  O2D.upload = async (orderId, file, fileType, refTable, refId) => {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB`);
    const qs = new URLSearchParams({ order_id: orderId, file_type: fileType, name: file.name });
    if (refTable) qs.set('ref_table', refTable);
    if (refId) qs.set('ref_id', refId);
    const headers = { 'Content-Type': 'application/octet-stream' };
    const token = localStorage.getItem('authToken');
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch('/api/o2d/files?' + qs.toString(), { method: 'POST', headers, body: file, credentials: 'include' });
    const d = await r.json().catch(() => ({ error: 'Upload failed (' + r.status + ')' }));
    if (!r.ok || d.error) throw new Error(d.error || 'Upload failed');
    return d;
  };
  O2D.uploadMany = async (orderId, files, fileType, refTable, refId) => {
    const fails = [];
    for (const f of Array.from(files || [])) {
      try { await O2D.upload(orderId, f, fileType, refTable, refId); } catch (e) { fails.push(e.message); }
    }
    if (fails.length) showToast('Some files failed: ' + fails.join('; '), 'error');
    return fails.length === 0;
  };
  O2D.fileChips = (files, { canDelete, onChange } = {}) => {
    if (!files || !files.length) return '<span style="color:var(--muted-foreground);font-size:12px">No files</span>';
    return files.map(f => {
      const isImg = /^image\//.test(f.mime || '');
      return `<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;padding:4px 8px;margin:0 6px 6px 0;font-size:12px;background:var(--card)">
        ${isImg ? `<img src="${O2D.fileUrl(f.id)}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:4px">` : '📄'}
        <a href="${O2D.fileUrl(f.id)}" target="_blank" rel="noopener" style="color:var(--primary)">${h(f.file_name)}</a>
        ${canDelete ? `<button title="Delete file" onclick="O2D.deleteFile(${f.id}, '${onChange || ''}')" style="background:none;border:none;cursor:pointer;color:var(--destructive);padding:0">✕</button>` : ''}
      </span>`;
    }).join('');
  };
  O2D.deleteFile = async (id, after) => {
    if (!await confirmDialog('Delete this file?', { title: 'Delete file', okText: 'Delete', danger: true })) return;
    const r = await api(`/api/o2d/files/${id}`, 'DELETE');
    if (r.error) return showToast(r.error, 'error');
    showToast('File deleted');
    if (after && typeof O2D[after] === 'function') O2D[after]();
  };

  // ── Modal ──────────────────────────────────────────
  function ensureModal() {
    if ($('o2dModal')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'o2dModal';
    div.innerHTML = '<div class="modal" id="o2dModalBox"></div>';
    document.body.appendChild(div);
  }
  let modalSubmit = null;
  O2D.modal = ({ title, html, width, submitText, onSubmit, danger, footer = true }) => {
    ensureModal();
    modalSubmit = onSubmit || null;
    $('o2dModalBox').style.width = (width || 560) + 'px';
    $('o2dModalBox').innerHTML = `
      <button class="modal-close-x" onclick="O2D.closeModal()" title="Close">✕</button>
      <h3>${h(title)}</h3>
      <div class="alert error" id="o2dModalErr"></div>
      <div id="o2dModalBody">${html || ''}</div>
      ${footer ? `<div class="modal-footer">
        <button class="btn btn-outline" onclick="O2D.closeModal()">${onSubmit ? 'Cancel' : 'Close'}</button>
        ${onSubmit ? `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="o2dModalOk" onclick="O2D.submitModal()">${h(submitText || 'Save')}</button>` : ''}
      </div>` : ''}`;
    $('o2dModal').classList.add('open');
  };
  O2D.modalError = (msg) => { const e = $('o2dModalErr'); if (!e) return; e.textContent = msg; e.style.display = msg ? 'block' : 'none'; if (msg) e.scrollIntoView({ block: 'nearest' }); };
  O2D.closeModal = () => { if ($('o2dModal')) closeModal('o2dModal'); modalSubmit = null; };
  O2D.submitModal = async () => {
    if (!modalSubmit) return;
    const btn = $('o2dModalOk');
    O2D.modalError('');
    if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Saving…'; }
    try {
      const ok = await modalSubmit();
      if (ok !== false) O2D.closeModal();
    } catch (e) {
      O2D.modalError(e.message || String(e));
    } finally {
      if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = btn.dataset.t; }
    }
  };
  // api() wrapper that throws on error — used inside modal submits
  O2D.req = async (url, method, body) => {
    const r = await api(url, method || 'GET', body || null);
    if (r && r.error) throw new Error(r.error);
    return r;
  };

  // ── Form builder ───────────────────────────────────
  // field: { name, label, type, options[], required, placeholder, help, showIf(v), span, min, step, value, readonly, accept, multiple }
  const fieldId = (p, n) => `${p}_${n}`;
  O2D.formHtml = (fields, values = {}, p = 'o2df') => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:0 14px">${fields.map(f => {
    if (f.type === 'section') return `<div style="grid-column:1/-1;font-size:12px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--border)">${h(f.label)}</div>`;
    if (f.type === 'html') return `<div style="grid-column:1/-1" id="${fieldId(p, f.name)}_wrap">${f.html || ''}</div>`;
    const v = values[f.name] !== undefined ? values[f.name] : (f.value !== undefined ? f.value : '');
    const id = fieldId(p, f.name);
    const req = f.required ? ' <span style="color:var(--destructive)">*</span>' : '';
    const ro = f.readonly ? 'disabled' : '';
    let input;
    if (f.type === 'select') {
      const opts = typeof f.options === 'function' ? f.options(values) : (f.options || []);
      input = `<select id="${id}" ${ro}>${f.noEmpty ? '' : `<option value="">${h(f.placeholder || '— Select —')}</option>`}${opts.map(o => {
        const ov = typeof o === 'object' ? o.value : o; const ol = typeof o === 'object' ? o.label : o;
        return `<option value="${h(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${h(ol)}</option>`;
      }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" rows="${f.rows || 3}" placeholder="${h(f.placeholder || '')}" ${ro}>${h(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      input = `<label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:500;color:var(--foreground);margin-top:6px;cursor:pointer"><input type="checkbox" id="${id}" style="width:auto" ${v === true || v === 1 || v === '1' ? 'checked' : ''} ${ro}> ${h(f.checkLabel || 'Yes')}</label>`;
    } else if (f.type === 'file') {
      input = `<input type="file" id="${id}" ${f.multiple ? 'multiple' : ''} accept="${h(f.accept || '.jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.3dm,.stl')}">`;
    } else if (f.type === 'info') {
      input = `<div id="${id}" style="font-size:13px;padding:8px 0;color:var(--foreground)">${f.html !== undefined ? f.html : h(v)}</div>`;
    } else {
      input = `<input type="${f.type || 'text'}" id="${id}" value="${h(v)}" placeholder="${h(f.placeholder || '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.list ? `list="${f.list}"` : ''} autocomplete="off" ${ro}>`;
    }
    return `<div class="form-group" id="${id}_wrap" style="${f.span ? 'grid-column:1/-1;' : ''}">
      <label for="${id}">${h(f.label)}${req}</label>${input}
      ${f.help ? `<div style="font-size:11px;color:var(--muted-foreground);margin-top:4px">${f.help}</div>` : ''}
    </div>`;
  }).join('')}</div>`;

  O2D.formRead = (fields, p = 'o2df') => {
    const v = {};
    fields.forEach(f => {
      if (['section', 'info', 'html'].includes(f.type)) return;
      const el = $(fieldId(p, f.name));
      if (!el) return;
      if (f.type === 'checkbox') v[f.name] = el.checked ? 1 : 0;
      else if (f.type === 'file') v[f.name] = el.files;
      else v[f.name] = el.value.trim();
    });
    return v;
  };
  O2D.formBind = (fields, p = 'o2df', onChange) => {
    const apply = () => {
      const v = O2D.formRead(fields, p);
      fields.forEach(f => {
        if (!f.showIf) return;
        const w = $(fieldId(p, f.name) + '_wrap');
        if (w) w.style.display = f.showIf(v) ? '' : 'none';
      });
      if (onChange) onChange(v);
    };
    fields.forEach(f => {
      const el = $(fieldId(p, f.name));
      if (el) { el.addEventListener('change', apply); el.addEventListener('input', apply); }
    });
    apply();
    return apply;
  };
  O2D.formValidate = (fields, v) => {
    for (const f of fields) {
      if (!f.required || ['section', 'info', 'html'].includes(f.type)) continue;
      if (f.showIf && !f.showIf(v)) continue;
      const val = v[f.name];
      if (f.type === 'file' ? !(val && val.length) : (val === '' || val == null)) throw new Error(`${f.label} is required`);
    }
  };
  // One-call modal form
  O2D.formModal = ({ title, fields, values, submitText, width, intro, onSubmit, danger, onChange }) => {
    O2D.modal({
      title, width, submitText, danger,
      html: (intro ? `<div style="font-size:12.5px;color:var(--muted-foreground);margin-bottom:12px;line-height:1.5">${intro}</div>` : '') + O2D.formHtml(fields, values || {}, 'o2dm'),
      onSubmit: async () => {
        const v = O2D.formRead(fields, 'o2dm');
        O2D.formValidate(fields, v);
        return onSubmit(v);
      },
    });
    O2D.formBind(fields, 'o2dm', onChange);
  };

  // ── Table ──────────────────────────────────────────
  // cols: [{ key, label, type, render(row), align }]
  O2D.table = (cols, rows, { onRow, empty, rowStyle } = {}) => {
    if (!rows || !rows.length) return `<div class="empty" style="padding:28px;text-align:center;color:var(--muted-foreground);font-size:13px">${h(empty || 'Nothing here yet.')}</div>`;
    const right = (c) => ['int', 'money', 'num3', 'num1', 'pct'].includes(c.type) || c.align === 'right';
    return `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--card)"><table style="font-size:12.5px">
      <thead><tr>${cols.map(c => `<th style="white-space:nowrap;${right(c) ? 'text-align:right' : ''}">${h(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr ${onRow ? `onclick="${onRow(r, i)}" style="cursor:pointer;${rowStyle ? rowStyle(r) : ''}"` : (rowStyle ? `style="${rowStyle(r)}"` : '')}>${cols.map(c =>
        `<td style="${right(c) ? 'text-align:right;' : ''}${c.nowrap === false ? '' : 'white-space:nowrap;'}">${c.render ? c.render(r) : O2D.fmtVal(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  };

  // ── Charts (Chart.js, theme tokens) ────────────────
  const CAT = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];
  const charts = {};
  O2D.drawChart = (canvasId, spec) => {
    const el = $(canvasId);
    if (!el || typeof Chart === 'undefined' || !spec) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    const pal = CAT.map(v => cssVar(v));
    let type = spec.type;
    let indexAxis; let stacked = false;
    // Pie with many slices reads badly — becomes a horizontal bar
    if ((type === 'pie' || type === 'doughnut') && spec.labels.length > 6) type = 'barh';
    if (type === 'barh') { type = 'bar'; indexAxis = 'y'; }
    if (type === 'stacked') { type = 'bar'; stacked = true; }
    const isPie = type === 'pie' || type === 'doughnut';
    const datasets = spec.datasets.map((d, i) => {
      const color = d.color || pal[i % pal.length];
      if (isPie) return { label: d.label, data: d.data, backgroundColor: d.data.map((_, j) => pal[j % pal.length]), borderColor: cssVar('--card', '#fff'), borderWidth: 2 };
      if (d.kind === 'line' || type === 'line') {
        return { type: 'line', label: d.label, data: d.data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
          borderDash: d.dashed ? [6, 4] : undefined, spanGaps: true, tension: 0.25 };
      }
      const bg = d.highlight != null && d.highlight >= 0 ? d.data.map((_, j) => (j === d.highlight ? cssVar('--destructive') : color)) : color;
      return { type: 'bar', label: d.label, data: d.data, backgroundColor: bg, borderRadius: 4, maxBarThickness: 34 };
    });
    const showLegend = isPie || datasets.length > 1;
    charts[canvasId] = new Chart(el.getContext('2d'), {
      type,
      data: { labels: spec.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis,
        interaction: { mode: isPie ? 'nearest' : 'index', intersect: isPie },
        plugins: { legend: { display: showLegend, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: isPie ? undefined : {
          x: { stacked, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked, beginAtZero: true, grid: { color: cssVar('--border') }, ticks: { font: { size: 10 } } },
        },
        onClick: spec.onClick ? (evt, els) => { if (els.length) spec.onClick(els[0].index); } : undefined,
      },
    });
  };

  // ── Shell & routing ────────────────────────────────
  const NAV = [
    ['dashboard', '📊 Dashboard'], ['orders', '📋 Orders'], ['followups', '🔔 Follow-ups'], ['cad', '🎨 CAD'], ['confirm', '✅ Confirmation'],
    ['bagging', '🧺 Bagging'], ['issue', '📤 Vendor Issue'], ['receive', '📥 Vendor Receive'], ['quality', '🏷️ Hallmark & Lab'],
    ['dispatch', '🚚 Dispatch'], ['payments', '💰 Payments'], ['reports', '📈 Reports'], ['masters', '⚙️ Masters'],
  ];
  O2D.views = O2D.views || {};
  O2D.state = { view: 'dashboard', params: {} };
  O2D.open = async (view, params) => {
    O2D.state = { view, params: params || {} };
    try { if (!params || !params.id) localStorage.setItem('o2dView', view); } catch (e) { /* ignore */ }
    const nav = $('o2dNav');
    if (nav) nav.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.v === view || (view === 'order' && t.dataset.v === 'orders') || (view === 'orderForm' && t.dataset.v === 'orders')));
    const el = $('o2dView');
    if (!el) return;
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted-foreground);font-size:13px">Loading…</div>';
    try {
      await O2D.loadLookups();
      const fn = O2D.views[view];
      if (!fn) { el.innerHTML = 'Unknown screen'; return; }
      await fn(el, params || {});
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div style="padding:24px;color:var(--destructive)">⚠️ ${h(e.message || e)}</div>`;
    }
    window.scrollTo({ top: 0 });
  };
  O2D.refresh = () => O2D.open(O2D.state.view, O2D.state.params);

  window.loadO2D = async () => {
    const page = $('page-o2d');
    if (!page) return;
    if (!$('o2dNav')) {
      page.innerHTML = `
        <div style="overflow-x:auto;margin-bottom:16px;padding-bottom:2px">
          <div class="tab-group" id="o2dNav" style="display:inline-flex;min-width:max-content">
            ${NAV.map(([k, l]) => `<div class="tab" data-v="${k}" onclick="O2D.open('${k}')">${l}${k === 'followups' ? ' <span id="o2dFuBadge" class="tab-count" style="margin-left:4px"></span>' : ''}</div>`).join('')}
          </div>
        </div>
        <div id="o2dView"></div>`;
    }
    let v = 'dashboard';
    try { v = localStorage.getItem('o2dView') || 'dashboard'; } catch (e) { /* ignore */ }
    if (!O2D.views[v]) v = 'dashboard';
    O2D.refreshBadge();
    await O2D.open(v);
  };

  // Due-today + overdue follow-ups for me → badge on sidebar + sub-nav
  O2D.refreshBadge = async () => {
    const r = await api('/api/o2d/followups/counts');
    if (!r || r.error) return;
    const n = (r.today || 0) + (r.overdue || 0);
    ['o2dFuBadge', 'o2dNavBadge'].forEach(id => {
      const b = $(id);
      if (!b) return;
      b.textContent = n;
      b.style.display = n ? (id === 'o2dNavBadge' ? 'flex' : 'inline-block') : 'none';
      b.title = `${r.today || 0} due today, ${r.overdue || 0} overdue`;
      if (id === 'o2dFuBadge') b.classList.toggle('show', n > 0);
    });
  };

  // Small UI bits reused by views
  O2D.card = (title, body, extra) => `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:16px">
    ${title ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap"><div style="font-size:14px;font-weight:700">${title}</div>${extra || ''}</div>` : ''}${body}</div>`;
  O2D.kpi = (label, value, sub, tone, onclick) => `<div ${onclick ? `onclick="${onclick}"` : ''} style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;${onclick ? 'cursor:pointer;' : ''}">
    <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px">${h(label)}</div>
    <div style="font-size:24px;font-weight:700;margin-top:4px;color:${tone || 'var(--foreground)'}">${value}</div>
    ${sub ? `<div style="font-size:11.5px;color:var(--muted-foreground);margin-top:2px">${sub}</div>` : ''}</div>`;
  O2D.filterBar = (html) => `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">${html}</div>`;
  O2D.fInput = (id, label, html) => `<div style="display:flex;flex-direction:column;gap:3px"><span style="font-size:10.5px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase">${h(label)}</span>${html}</div>`;
  const ctl = 'padding:7px 10px;border:1px solid var(--input);border-radius:8px;font-size:12.5px;background:var(--card);color:var(--foreground);font-family:inherit';
  O2D.ctlStyle = ctl;
  O2D.sel = (id, options, value, onchange, empty = 'All') => `<select id="${id}" style="${ctl}" ${onchange ? `onchange="${onchange}"` : ''}>${empty !== false ? `<option value="">${h(empty)}</option>` : ''}${options.map(o => `<option value="${h(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${h(o.label)}</option>`).join('')}</select>`;
  O2D.inp = (id, type, value, onchange, extra = '') => `<input id="${id}" type="${type}" value="${h(value || '')}" style="${ctl}" ${onchange ? `onchange="${onchange}"` : ''} ${extra}>`;

  // ══════════════════════════════════════════════════════
  // FOLLOW-UP drawer (log form + history) — every loop uses this
  // ══════════════════════════════════════════════════════
  O2D.openFollowup = async (taskId, after) => {
    const d = await api(`/api/o2d/followups/${taskId}`);
    if (d.error) return showToast(d.error, 'error');
    const t = d.task;
    const isPayOrVendor = ['PAYMENT', 'REQUIREMENT_VENDOR', 'VENDOR_FG', 'HALLMARK', 'LAB', 'CAD_VENDOR'].includes(t.task_type);
    const closingHint = {
      CAD_VENDOR: '“CAD Received” closes this loop and moves the order to CAD Received.',
      CAD_CLIENT_APPROVAL: 'Approved / Rejected (new revision) / Hold / Cancelled are decisions — they move the order.',
      ORDER_CONFIRMATION: 'Confirmed / Hold / Cancelled are decisions — they move the order.',
      REQUIREMENT_VENDOR: 'This closes automatically when the full shortfall is received (Bagging screen).',
      VENDOR_FG: 'This closes automatically when all issued pcs are received (Vendor Receive screen).',
      HALLMARK: 'This closes when the hallmark job is received (Hallmark & Lab screen).',
      LAB: 'This closes when the lab job is received (Hallmark & Lab screen).',
      PAYMENT: 'This closes automatically when the invoice balance becomes 0 (Payments screen).',
    }[t.task_type] || '';
    const fields = [
      { name: 'mode', label: 'Mode', type: 'select', required: true, options: ['Call', 'WhatsApp', 'Email', 'Visit', 'Internal'], value: 'Call' },
      { name: 'spoke_to', label: 'Spoke to', placeholder: 'Name' },
      { name: 'outcome', label: 'Outcome', type: 'select', required: true, options: d.outcomes.map(o => ({ value: o, label: d.closing.includes(o) ? `${o}  ⟶ decision` : o })) },
      { name: 'reason', label: 'Reason / changes required', type: 'textarea', rows: 2, required: true, span: true,
        showIf: v => ['Rejected', 'Hold', 'Cancelled'].includes(v.outcome) },
      { name: 'next_followup_date', label: 'Next follow-up date', type: 'date', required: true, min: O2D.today(), value: O2D.addDays(O2D.today(), 1),
        showIf: v => !d.closing.includes(v.outcome) || v.outcome === 'Hold' },
      { name: 'promised_date', label: 'Promised date', type: 'date', showIf: () => isPayOrVendor },
      { name: 'promised_amount', label: 'Promised amount (₹)', type: 'number', step: '0.01', showIf: () => t.task_type === 'PAYMENT' },
      { name: 'remark', label: 'Remark', type: 'textarea', rows: 2, span: true },
    ];
    const hist = d.logs.length ? d.logs.map(l => `<div style="border-left:3px solid var(--border);padding:4px 0 6px 10px;margin-bottom:6px">
        <div style="font-size:12px"><b>${h(l.outcome)}</b> · ${h(l.mode)}${l.spoke_to ? ' · ' + h(l.spoke_to) : ''} <span style="color:var(--muted-foreground)">— ${O2D.fmtDT(l.followup_date)} by ${h(l.created_by_name || '')}</span></div>
        ${l.remark ? `<div style="font-size:12px;color:var(--muted-foreground)">${h(l.remark)}</div>` : ''}
        <div style="font-size:11px;color:var(--muted-foreground)">${l.next_followup_date ? 'Next: ' + O2D.fmtD(l.next_followup_date) : ''}${l.promised_date ? ' · Promised: ' + O2D.fmtD(l.promised_date) : ''}${l.promised_amount ? ' · ' + O2D.money(l.promised_amount) : ''}</div>
      </div>`).join('') : '<div style="font-size:12px;color:var(--muted-foreground)">No follow-ups yet.</div>';
    const overdue = t.status === 'Open' && t.next_followup_date && t.next_followup_date < O2D.today();
    const head = `<div style="background:var(--muted);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.6">
      <div><b>${h(O2D.TASK_LABEL[t.task_type] || t.task_type)}</b> — ${h(t.title || '')}</div>
      <div>Order: <a href="javascript:void(0)" onclick="O2D.closeModal();O2D.open('order',{id:${t.order_id}})" style="color:var(--primary)">${h(t.order_no || '')}</a> · ${h(t.client_name || '')} · Party: ${h(t.party_name || '—')}</div>
      <div>Assigned: ${h(t.assigned_to_name || '—')} · Next: <b style="color:${overdue ? 'var(--destructive)' : 'inherit'}">${O2D.fmtD(t.next_followup_date)}</b> · Follow-ups: ${t.followup_count || 0} ${t.status === 'Closed' ? O2D.chip('Closed') : ''}</div>
      ${closingHint ? `<div style="color:var(--muted-foreground);font-size:11.5px;margin-top:4px">ℹ️ ${closingHint}</div>` : ''}
      ${t.status === 'Open' ? `<div style="margin-top:6px"><a href="javascript:void(0)" onclick="O2D.reassignTask(${t.id})" style="color:var(--primary);font-size:12px">Reassign</a></div>` : ''}
    </div>`;
    if (t.status !== 'Open') {
      O2D.modal({ title: 'Follow-up', html: head + `<div style="font-size:12px;font-weight:700;margin-bottom:6px">History</div>${hist}`, width: 620 });
      return;
    }
    O2D.formModal({
      title: 'Add follow-up', width: 640, submitText: 'Save follow-up', fields,
      intro: head + `<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:12px;font-weight:700">History (${d.logs.length})</summary><div style="margin-top:8px">${hist}</div></details>`,
      onSubmit: async (v) => {
        await O2D.req(`/api/o2d/followups/${taskId}/log`, 'POST', v);
        showToast('Follow-up saved');
        O2D.refreshBadge();
        if (typeof after === 'function') after(); else O2D.refresh();
      },
    });
  };
  O2D.reassignTask = async (taskId) => {
    O2D.formModal({
      title: 'Reassign follow-up', width: 420, submitText: 'Reassign',
      fields: [{ name: 'assigned_to', label: 'Assign to', type: 'select', required: true, options: O2D.userOptions() }],
      onSubmit: async (v) => { await O2D.req(`/api/o2d/followups/${taskId}/reassign`, 'PUT', v); showToast('Reassigned'); O2D.refreshBadge(); O2D.refresh(); },
    });
  };

  // ── My Follow-ups screen ───────────────────────────
  O2D.views.followups = async (el, p) => {
    const tab = p.tab || 'today';
    const f = { type: p.type || '', mine: p.mine === undefined ? '1' : p.mine, assignee: p.assignee || '', client_id: p.client_id || '', vendor_id: p.vendor_id || '' };
    const qs = new URLSearchParams({ tab, ...f });
    const rows = await O2D.req('/api/o2d/followups?' + qs.toString());
    const tabs = [['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['all', 'All open'], ['closed', 'Closed']];
    const go = (patch) => `O2D.open('followups', Object.assign(${JSON.stringify({ tab, ...f })}, ${patch}))`;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="tab-group">${tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="${go(`{tab:'${k}'}`).replace(/"/g, '&quot;')}">${l}</div>`).join('')}</div>
      </div>
      ${O2D.filterBar(
        O2D.fInput('', 'Type', O2D.sel('o2dFuType', Object.entries(O2D.TASK_LABEL).map(([v, l]) => ({ value: v, label: l })), f.type, 'O2D.fuFilter()'))
        + O2D.fInput('', 'Assigned to', O2D.sel('o2dFuAssignee', [{ value: 'mine', label: 'Me' }, ...O2D.userOptions()], f.mine === '1' ? 'mine' : f.assignee, 'O2D.fuFilter()', 'Everyone'))
        + O2D.fInput('', 'Client', O2D.sel('o2dFuClient', O2D.customerOptions(true), f.client_id, 'O2D.fuFilter()'))
        + O2D.fInput('', 'Vendor', O2D.sel('o2dFuVendor', O2D.vendorOptions(), f.vendor_id, 'O2D.fuFilter()')))}
      ${O2D.table([
        { key: 'next_followup_date', label: 'Next', render: r => `<b style="color:${r.overdue ? 'var(--destructive)' : 'inherit'}">${O2D.fmtD(r.next_followup_date)}</b>${r.overdue ? O2D.flag(r.days_overdue + 'd late', 'var(--destructive)') : ''}` },
        { key: 'task_type', label: 'Type', render: r => h(O2D.TASK_LABEL[r.task_type] || r.task_type) },
        { key: 'order_no', label: 'Order', render: r => `<a href="javascript:void(0)" onclick="event.stopPropagation();O2D.open('order',{id:${r.order_id}})" style="color:var(--primary)">${h(r.order_no || '')}</a>` },
        { key: 'client_name', label: 'Client' },
        { key: 'party_name', label: 'Party' },
        { key: 'title', label: 'What', nowrap: false },
        { key: 'assigned_to_name', label: 'Assigned' },
        { key: 'followup_count', label: '#', type: 'int' },
        { key: 'last_outcome', label: 'Last outcome' },
        { key: 'act', label: '', render: r => `<button class="btn btn-sm ${r.status === 'Open' ? 'btn-primary' : 'btn-outline'}" onclick="event.stopPropagation();O2D.openFollowup(${r.id})">${r.status === 'Open' ? '+ Follow-up' : 'View'}</button>` },
      ], rows, { empty: tab === 'today' ? 'No follow-ups due today 🎉' : 'No follow-ups here.' })}`;
  };
  O2D.fuFilter = () => {
    const a = $('o2dFuAssignee').value;
    O2D.open('followups', { tab: O2D.state.params.tab || 'today', type: $('o2dFuType').value, mine: a === 'mine' ? '1' : '0',
      assignee: a === 'mine' ? '' : a, client_id: $('o2dFuClient').value, vendor_id: $('o2dFuVendor').value });
  };

  // ══════════════════════════════════════════════════════
  // MASTERS + Stage Settings
  // ══════════════════════════════════════════════════════
  const yes = (v) => (v === 1 || v === true || v === '1' ? 'Yes' : 'No');
  O2D.views.masters = async (el, p) => {
    const tab = p.tab || 'customers';
    const tabs = [['customers', 'Customers'], ['vendors', 'Vendors'], ['quality', 'Quality'], ['labs', 'Labs'], ['reasons', 'Cancel / Reject Reasons'],
      ['outcomes', 'Follow-up Outcomes'], ['stages', 'Stage Settings (TAT & Doer)']];
    let body = '';
    if (tab === 'customers') {
      const rows = await O2D.req('/api/o2d/customers');
      body = `<div style="display:flex;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
          <input id="o2dCustSearch" placeholder="Search customer…" style="${ctl};width:240px" oninput="O2D.filterRows('o2dCustTbl', this.value)" autocomplete="off">
          <button class="btn btn-primary" onclick="O2D.editCustomer()">+ Add Customer</button></div>
        <div id="o2dCustTbl">${O2D.table([
          { key: 'client_name', label: 'Client', render: r => `<b>${h(r.client_name)}</b>${r.is_active ? '' : O2D.flag('Inactive', 'var(--muted-foreground)')}` },
          { key: 'company_name', label: 'Company' }, { key: 'contact_number', label: 'Contact' }, { key: 'city', label: 'City' },
          { key: 'labour_rate', label: 'Labour', render: r => `${O2D.money(r.labour_rate)} ${h(r.labour_rate_basis || '')}` },
          { key: 'gold_tunch_pct', label: 'Tunch %', type: 'num1' }, { key: 'quality_name', label: 'Quality' },
          { key: 'certificate_required', label: 'Cert', render: r => yes(r.certificate_required) + (r.lab_name ? ` (${h(r.lab_name)})` : '') },
          { key: 'payment_terms_days', label: 'Terms', render: r => `${r.payment_terms_days || 30}d · ${h(r.payment_style || '')}` },
          { key: 'sales_person_name', label: 'Sales Person' },
        ], rows, { onRow: r => `O2D.editCustomer(${r.id})`, empty: 'No customers yet — add your first customer.' })}</div>`;
      O2D._custRows = rows;
    } else if (tab === 'vendors') {
      const rows = await O2D.req('/api/o2d/vendors');
      body = `<div style="display:flex;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
          <input placeholder="Search vendor…" style="${ctl};width:240px" oninput="O2D.filterRows('o2dVendTbl', this.value)" autocomplete="off">
          <button class="btn btn-primary" onclick="O2D.editVendor()">+ Add Vendor</button></div>
        <div id="o2dVendTbl">${O2D.table([
          { key: 'vendor_name', label: 'Vendor', render: r => `<b>${h(r.vendor_name)}</b>${r.is_active ? '' : O2D.flag('Inactive', 'var(--muted-foreground)')}` },
          { key: 'vendor_type', label: 'Type' }, { key: 'contact_person', label: 'Contact person' }, { key: 'contact_number', label: 'Phone' },
          { key: 'city', label: 'City' }, { key: 'default_lead_time_days', label: 'Lead time (days)', type: 'int' }, { key: 'gst_number', label: 'GST' },
        ], rows, { onRow: r => `O2D.editVendor(${r.id})`, empty: 'No vendors yet.' })}</div>`;
      O2D._vendRows = rows;
    } else if (tab === 'stages') {
      const rows = await O2D.req('/api/o2d/stage-targets');
      const admin = O2D.lk.isAdmin;
      body = `<div style="font-size:12.5px;color:var(--muted-foreground);margin-bottom:12px;line-height:1.6">
          Har stage ka <b>TAT (target days)</b> — isse zyada din stage me rehne par order "delayed" dikhta hai aur bottleneck report me aata hai.
          <b>Default doer</b> — us stage ka naya follow-up task kisko assign ho (khaali chhodo to jo user action kare usko).
          ${admin ? '' : '<br><b>Only admin can change these.</b>'}</div>
        ${O2D.table([
          { key: 'stage_name', label: 'Stage', render: r => `<b>${h(r.stage_name)}</b>` },
          { key: 'target_days', label: 'Target days (TAT)', render: r => `<input type="number" min="0" max="365" id="o2dSt_${r.stage_key}_d" value="${r.target_days}" style="${ctl};width:90px" ${admin ? '' : 'disabled'}>` },
          { key: 'default_assignee_id', label: 'Default doer', render: r => `<select id="o2dSt_${r.stage_key}_u" style="${ctl};min-width:200px" ${admin ? '' : 'disabled'}><option value="">— Whoever acts —</option>${O2D.userOptions().map(u => `<option value="${u.value}" ${String(u.value) === String(r.default_assignee_id) ? 'selected' : ''}>${h(u.label)}</option>`).join('')}</select>` },
        ], rows)}
        ${admin ? `<div style="margin-top:12px;text-align:right"><button class="btn btn-primary" onclick="O2D.saveStages()">Save Stage Settings</button></div>` : ''}`;
      O2D._stageRows = rows;
    } else {
      const rows = await O2D.req('/api/o2d/masters/' + tab);
      const label = { quality: 'quality', labs: 'lab', reasons: 'reason', outcomes: 'outcome' }[tab];
      body = `${tab === 'outcomes' ? `<div style="font-size:12px;color:var(--muted-foreground);margin-bottom:10px">Extra (non-closing) outcomes shown in every follow-up. Closing outcomes like CAD Received / Approved / Confirmed are built-in.</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:10px"><input id="o2dSmallNew" placeholder="New ${label}…" style="${ctl};width:240px" autocomplete="off">
        <button class="btn btn-primary" onclick="O2D.addSmall('${tab}')">+ Add</button></div>
        ${O2D.table([
          { key: 'name', label: 'Name', render: r => `<b>${h(r.name)}</b>${r.is_active ? '' : O2D.flag('Inactive', 'var(--muted-foreground)')}` },
          { key: 'act', label: '', render: r => `<button class="btn btn-outline btn-sm" onclick="O2D.editSmall('${tab}',${r.id},'${h(r.name).replace(/'/g, '&#39;')}',${r.is_active ? 1 : 0})">Edit</button>
              ${O2D.lk.isAdmin ? `<button class="btn btn-outline btn-sm" style="color:var(--destructive)" onclick="O2D.delSmall('${tab}',${r.id})">Delete</button>` : ''}` },
        ], rows)}`;
    }
    const demo = O2D.demoBar ? await O2D.demoBar() : '';
    el.innerHTML = `${demo}<div class="tab-group" style="display:inline-flex;flex-wrap:wrap;margin-bottom:14px">${tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="O2D.open('masters',{tab:'${k}'})">${l}</div>`).join('')}</div>${body}`;
  };
  O2D.filterRows = (wrapId, q) => {
    q = (q || '').toLowerCase();
    document.querySelectorAll(`#${wrapId} tbody tr`).forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  };
  O2D.saveStages = async () => {
    const stages = O2D._stageRows.map(r => ({ stage_key: r.stage_key, target_days: $(`o2dSt_${r.stage_key}_d`).value, default_assignee_id: $(`o2dSt_${r.stage_key}_u`).value }));
    const r = await api('/api/o2d/stage-targets', 'PUT', { stages });
    if (r.error) return showToast(r.error, 'error');
    showToast('Stage settings saved');
    await O2D.loadLookups(true);
    O2D.refresh();
  };
  O2D.addSmall = async (kind) => {
    const name = $('o2dSmallNew').value.trim();
    if (!name) return showToast('Enter a name', 'error');
    const r = await api('/api/o2d/masters/' + kind, 'POST', { name });
    if (r.error) return showToast(r.error, 'error');
    showToast('Added'); await O2D.loadLookups(true); O2D.refresh();
  };
  O2D.editSmall = (kind, id, name, active) => {
    O2D.formModal({
      title: 'Edit', width: 420,
      fields: [{ name: 'name', label: 'Name', required: true, value: name }, { name: 'is_active', label: 'Active', type: 'checkbox', value: active }],
      onSubmit: async (v) => { await O2D.req(`/api/o2d/masters/${kind}/${id}`, 'PUT', v); showToast('Saved'); await O2D.loadLookups(true); O2D.refresh(); },
    });
  };
  O2D.delSmall = async (kind, id) => {
    if (!await confirmDialog('Delete this entry?', { title: 'Delete', okText: 'Delete', danger: true })) return;
    const r = await api(`/api/o2d/masters/${kind}/${id}`, 'DELETE');
    if (r.error) return showToast(r.error, 'error');
    showToast('Deleted'); await O2D.loadLookups(true); O2D.refresh();
  };

  O2D.editCustomer = (id) => {
    const c = id ? (O2D._custRows || []).find(x => x.id === id) : { is_active: 1, payment_terms_days: 30, labour_rate_basis: 'Per Gram', payment_style: 'Invoice-wise' };
    const fields = [
      { type: 'section', label: 'Customer' },
      { name: 'client_name', label: 'Client name', required: true },
      { name: 'company_name', label: 'Company name' },
      { name: 'contact_number', label: 'Contact number (10 digit)', required: true, type: 'tel' },
      { name: 'alt_contact_number', label: 'Alternate number', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'whatsapp_group_name', label: 'WhatsApp group name' },
      { name: 'address', label: 'Address', type: 'textarea', span: true, rows: 2 },
      { name: 'city', label: 'City' },
      { name: 'state', label: 'State', type: 'select', options: O2D.INDIAN_STATES },
      { name: 'pin_code', label: 'PIN code' },
      { name: 'gst_number', label: 'GST number' },
      { type: 'section', label: 'Commercial defaults (auto-fill on orders)' },
      { name: 'labour_rate', label: 'Labour rate', type: 'number', step: '0.01', required: true },
      { name: 'labour_rate_basis', label: 'Labour basis', type: 'select', noEmpty: true, options: O2D.lk.labourBasis },
      { name: 'gold_tunch_pct', label: 'Gold tunch %', type: 'number', step: '0.01', required: true, placeholder: 'e.g. 75.00' },
      { name: 'quality_id', label: 'Default quality', type: 'select', required: true, options: O2D.qualityOptions() },
      { name: 'certificate_required', label: 'Certificate required', type: 'checkbox' },
      { name: 'default_lab_id', label: 'Default lab', type: 'select', options: O2D.labOptions(), required: true, showIf: v => v.certificate_required === 1 },
      { name: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', min: 0 },
      { name: 'payment_style', label: 'Payment style', type: 'select', noEmpty: true, options: O2D.lk.paymentStyles, help: 'Category-wise payers must have Gold/Diamond/Labour break-up on every invoice.' },
      { name: 'sales_person_id', label: 'Default sales person', type: 'select', options: O2D.userOptions() },
      { name: 'is_active', label: 'Active', type: 'checkbox' },
    ];
    O2D.formModal({
      title: id ? 'Edit customer' : 'Add customer', width: 760, fields, values: c,
      onSubmit: async (v) => {
        await O2D.req(id ? `/api/o2d/customers/${id}` : '/api/o2d/customers', id ? 'PUT' : 'POST', v);
        showToast('Customer saved'); await O2D.loadLookups(true); O2D.refresh();
      },
    });
    if (id && O2D.lk.isAdmin) {
      const f = document.querySelector('#o2dModalBox .modal-footer');
      if (f) f.insertAdjacentHTML('afterbegin', `<button class="btn btn-outline" style="margin-right:auto;color:var(--destructive)" onclick="O2D.deleteMaster('customers',${id})">Delete</button>`);
    }
  };
  O2D.editVendor = (id) => {
    const v0 = id ? (O2D._vendRows || []).find(x => x.id === id) : { is_active: 1, default_lead_time_days: 7 };
    const fields = [
      { name: 'vendor_name', label: 'Vendor name', required: true },
      { name: 'vendor_type', label: 'Vendor type', type: 'select', required: true, options: O2D.lk.vendorTypes },
      { name: 'contact_person', label: 'Contact person' },
      { name: 'contact_number', label: 'Contact number', required: true, type: 'tel' },
      { name: 'address', label: 'Address', type: 'textarea', span: true, rows: 2 },
      { name: 'city', label: 'City' },
      { name: 'state', label: 'State', type: 'select', options: O2D.INDIAN_STATES },
      { name: 'pin_code', label: 'PIN code' },
      { name: 'gst_number', label: 'GST number' },
      { name: 'default_lead_time_days', label: 'Default lead time (days)', type: 'number', min: 0, help: 'Proposes expected dates for CAD / issue / requirement.' },
      { name: 'is_active', label: 'Active', type: 'checkbox' },
    ];
    O2D.formModal({
      title: id ? 'Edit vendor' : 'Add vendor', width: 700, fields, values: v0,
      onSubmit: async (v) => {
        await O2D.req(id ? `/api/o2d/vendors/${id}` : '/api/o2d/vendors', id ? 'PUT' : 'POST', v);
        showToast('Vendor saved'); await O2D.loadLookups(true); O2D.refresh();
      },
    });
    if (id && O2D.lk.isAdmin) {
      const f = document.querySelector('#o2dModalBox .modal-footer');
      if (f) f.insertAdjacentHTML('afterbegin', `<button class="btn btn-outline" style="margin-right:auto;color:var(--destructive)" onclick="O2D.deleteMaster('vendors',${id})">Delete</button>`);
    }
  };
  O2D.deleteMaster = async (kind, id) => {
    if (!await confirmDialog('Delete permanently? (Use "Active" off if it has history.)', { title: 'Delete', okText: 'Delete', danger: true })) return;
    const r = await api(`/api/o2d/${kind}/${id}`, 'DELETE');
    if (r.error) return showToast(r.error, 'error');
    O2D.closeModal(); showToast('Deleted'); await O2D.loadLookups(true); O2D.refresh();
  };
})();
