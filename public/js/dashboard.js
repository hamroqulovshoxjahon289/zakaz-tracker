let me = null;
let state = { lines: [], orders: [], employees: [], complaints: [], dayStarted: false, stats: {} };
let activeLineFilter = 'all';

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.style.display = 'none', 3200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function findLine(lineId) { return state.lines.find(l => l.id === lineId); }
function findStation(lineId, idx) { const l = findLine(lineId); return l ? l.stations[idx] : null; }

// ---------- Init ----------
async function init() {
  try {
    const meRes = await api('/api/me');
    if (!meRes.user) { window.location.href = '/login'; return; }
    me = meRes.user;
    document.getElementById('who-name').textContent = me.name;
    document.getElementById('who-role').textContent = me.role === 'admin' ? 'Admin' : 'Xodim';
    if (me.role === 'admin') {
      document.getElementById('tab-users-btn').style.display = '';
      document.getElementById('tab-lines-btn').style.display = '';
      document.getElementById('tab-report-btn').style.display = '';
      document.getElementById('tab-audit-btn').style.display = '';
      loadUsers();
    }
    if (meRes.impersonating) document.getElementById('impersonate-banner').style.display = 'block';
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').classList.add('ready');
    connectSocket();
    loadNotifications();
  } catch (e) {
    window.location.href = '/login';
  }
}

function connectSocket() {
  const socket = io();
  socket.on('state', (s) => { state = s; renderAll(); });
  socket.on('notification', (n) => {
    playNotifSound();
    toast(`🔔 ${n.title}`);
    prependNotification(n);
  });
  setInterval(renderOrders, 60000); // muddati o'tgan zakazlar belgisini yangilab turish
}

function renderAll() {
  renderDayBar();
  renderTvLinks();
  renderOrderFormLineOptions();
  renderCustomerOptions();
  renderTemplatePicker();
  renderLineFilters();
  renderOrders();
  renderLines();
  renderComplaints();
  renderNewUserStations();
  renderCustomers();
  renderTemplates();
}

// ---------- Day control ----------
document.getElementById('start-day-btn').addEventListener('click', async () => {
  try { await api('/api/day/start', { method: 'POST' }); toast('Kun boshlandi'); }
  catch (e) { toast(e.message, true); }
});
document.getElementById('finish-day-btn').addEventListener('click', async () => {
  if (!confirm("Kunni yakunlaysizmi? Bugungi barcha zakazlar ro'yxati tozalanadi.")) return;
  try { await api('/api/day/finish', { method: 'POST' }); toast('Kun yakunlandi'); }
  catch (e) { toast(e.message, true); }
});

function renderDayBar() {
  const dot = document.getElementById('day-dot');
  const text = document.getElementById('day-text');
  const startBtn = document.getElementById('start-day-btn');
  const finishBtn = document.getElementById('finish-day-btn');
  if (state.dayStarted) {
    dot.classList.add('on'); text.textContent = 'Kun boshlangan';
    startBtn.style.display = 'none'; finishBtn.style.display = '';
  } else {
    dot.classList.remove('on'); text.textContent = 'Kun boshlanmagan';
    startBtn.style.display = ''; finishBtn.style.display = 'none';
  }
}

// ---------- TV links ----------
function renderTvLinks() {
  const groups = [...new Set(state.lines.map(l => l.group))];
  const el = document.getElementById('tv-links');
  el.innerHTML = `<a href="/tv" target="_blank">📺 Barcha kanallar</a>` +
    groups.map(g => `<a href="/tv/${encodeURIComponent(g)}" target="_blank">📺 ${escapeHtml(g)}</a>`).join('');
}

// ---------- Order creation ----------
function renderOrderFormLineOptions() {
  const sel = document.getElementById('order-form-line');
  const current = sel.value;
  sel.innerHTML = state.lines.map(l => `<option value="${l.id}">${escapeHtml(l.name)} (${escapeHtml(l.stations[0] ? l.stations[0].name : '')} dan boshlanadi)</option>`).join('');
  if (current) sel.value = current;
}

document.getElementById('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const orderNumber = form.orderNumber.value.trim();
  if (!orderNumber) return;
  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        orderNumber,
        time: form.time.value.trim(),
        note: form.note.value.trim(),
        lineId: form.lineId.value,
        customerId: form.customerId.value || null,
        urgent: form.urgent.checked
      })
    });
    form.orderNumber.value = ''; form.time.value = ''; form.note.value = ''; form.urgent.checked = false;
    document.getElementById('template-picker').value = '';
    toast("Zakaz qo'shildi");
  } catch (e) { toast(e.message, true); }
});

// ---------- Customers (Mijozlar) ----------
function renderCustomerOptions() {
  const sel = document.getElementById('order-form-customer');
  const current = sel.value;
  sel.innerHTML = `<option value="">Mijoz yo'q</option>` + (state.customers || []).map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)}${c.phone ? ' — ' + escapeHtml(c.phone) : ''}</option>`).join('');
  if (current) sel.value = current;
}

function renderCustomers() {
  const list = state.customers || [];
  const el = document.getElementById('customers-list');
  const emptyEl = document.getElementById('customers-empty');
  if (!el) return;
  if (!list.length) { el.innerHTML = ''; if (emptyEl) emptyEl.style.display = 'block'; return; }
  if (emptyEl) emptyEl.style.display = 'none';
  el.innerHTML = list.map(c => `
    <div class="customer-row" data-id="${c.id}">
      <div><b>${escapeHtml(c.name)}</b> ${c.phone ? `<span>· ${escapeHtml(c.phone)}</span>` : ''} ${c.note ? `<span>· ${escapeHtml(c.note)}</span>` : ''}</div>
      <button class="btn danger small" data-action="del-customer">O'chirish</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-action="del-customer"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.customer-row').dataset.id;
      if (!confirm("Bu mijozni o'chirasizmi?")) return;
      try { await api(`/api/customers/${id}`, { method: 'DELETE' }); toast("Mijoz o'chirildi"); }
      catch (e) { toast(e.message, true); }
    });
  });
}

document.getElementById('new-customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name: form.name.value.trim(), phone: form.phone.value.trim(), note: form.note.value.trim() })
    });
    form.reset();
    toast("Mijoz qo'shildi");
  } catch (e) { toast(e.message, true); }
});

// ---------- Order Templates (Shablonlar) ----------
function renderTemplatePicker() {
  const sel = document.getElementById('template-picker');
  sel.innerHTML = `<option value="">— Shablondan tanlash (ixtiyoriy) —</option>` + (state.templates || []).map(t =>
    `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

document.getElementById('template-picker').addEventListener('change', (e) => {
  const t = (state.templates || []).find(x => x.id === e.target.value);
  if (!t) return;
  const form = document.getElementById('order-form');
  form.note.value = t.note || '';
  if (t.lineId) form.lineId.value = t.lineId;
});

function renderTemplates() {
  const list = state.templates || [];
  const el = document.getElementById('templates-list');
  if (!el) return;
  el.innerHTML = list.map(t => `
    <div class="template-item" data-id="${t.id}">
      <div><b>${escapeHtml(t.name)}</b> ${t.note ? `<span>— ${escapeHtml(t.note)}</span>` : ''}</div>
      <button class="btn danger small" data-action="del-template">O'chirish</button>
    </div>
  `).join('') || '<div class="empty-hint">Hali shablon yo\'q</div>';
  el.querySelectorAll('[data-action="del-template"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.template-item').dataset.id;
      if (!confirm("Bu shablonni o'chirasizmi?")) return;
      try { await api(`/api/templates/${id}`, { method: 'DELETE' }); toast("Shablon o'chirildi"); }
      catch (e) { toast(e.message, true); }
    });
  });
}

document.getElementById('new-template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: form.name.value.trim(), note: form.note.value.trim() })
    });
    form.reset();
    toast('Shablon saqlandi');
  } catch (e) { toast(e.message, true); }
});

// ---------- Line filter chips ----------
function renderLineFilters() {
  const el = document.getElementById('line-filters');
  const chips = [{ id: 'all', name: 'Barchasi' }, ...state.lines.map(l => ({ id: l.id, name: l.name }))];
  el.innerHTML = chips.map(c => `<button class="chip ${activeLineFilter === c.id ? 'active' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => { activeLineFilter = btn.dataset.id; renderLineFilters(); renderOrders(); });
  });
}

// ---------- Orders (grouped by line -> station) ----------
function employeeOptions(selectedId) {
  return `<option value="">Xodim yo'q</option>` + state.employees.map(u =>
    `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
}

function moveTargetOptions(order) {
  let html = '';
  state.lines.forEach(l => {
    l.stations.forEach((st, idx) => {
      const val = `${l.id}|${idx}`;
      const selected = (order.lineId === l.id && order.stationIndex === idx) ? 'selected' : '';
      html += `<option value="${val}" ${selected}>${escapeHtml(l.name)} → ${escapeHtml(st.name)}</option>`;
    });
  });
  return html;
}

const OVERDUE_MS = 2 * 60 * 60 * 1000; // 2 soat

function renderOrders() {
  const container = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');
  const active = state.orders.filter(o => !o.done);
  const linesToShow = activeLineFilter === 'all' ? state.lines : state.lines.filter(l => l.id === activeLineFilter);
  const now = Date.now();

  const anyOrders = active.some(o => linesToShow.find(l => l.id === o.lineId));
  if (!anyOrders) {
    container.innerHTML = '';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    container.innerHTML = linesToShow.map(line => {
      const lineOrders = active.filter(o => o.lineId === line.id);
      if (!lineOrders.length) return '';
      const stationsHtml = line.stations.map((st, idx) => {
        const bucket = lineOrders.filter(o => o.stationIndex === idx).sort((a, b) => a.priority - b.priority);
        if (!bucket.length) return '';
        const isLast = idx === line.stations.length - 1;
        const nextLine = line.nextLineId ? findLine(line.nextLineId) : null;
        const advanceLabel = isLast
          ? (nextLine ? `${escapeHtml(nextLine.name)}ga →` : 'Yakunlash ✓')
          : `${escapeHtml(line.stations[idx + 1].name)}ga →`;
        return `
          <div class="station-block" data-line="${line.id}" data-station="${idx}">
            <div class="station-title">${escapeHtml(st.name)} <span class="count">(${bucket.length})</span></div>
            ${bucket.map((o, i) => {
              const age = now - (o.stationEnteredAt || o.createdAt || now);
              const isOverdue = age > OVERDUE_MS;
              return `
              <div class="order-row ${isOverdue ? 'overdue' : ''}" data-id="${o.id}">
                <div class="prio-num">${i + 1}</div>
                <div class="order-fields">
                  <input class="num-input" data-field="orderNumber" value="${escapeHtml(o.orderNumber)}">
                  ${o.urgent ? `<span class="urgent-tag">🔴 SHOSHILINCH</span>` : ''}
                  <textarea class="note-input" data-field="note" placeholder="Izoh...">${escapeHtml(o.note || '')}</textarea>
                  ${isOverdue ? `<div class="overdue-badge">⚠ ${Math.floor(age / 3600000)} soatdan beri shu bosqichda</div>` : ''}
                </div>
                <div>
                  <div class="field-label">Vaqt</div>
                  <input class="time-input" data-field="time" value="${escapeHtml(o.time || '')}">
                </div>
                <div>
                  <div class="field-label">Xodim</div>
                  <select data-field="assignedUserId">${employeeOptions(o.assignedUserId)}</select>
                </div>
                <div>
                  <div class="field-label">Bosqich (qo'lda)</div>
                  <select data-action="move">${moveTargetOptions(o)}</select>
                </div>
                <div class="order-actions">
                  <button class="btn success small" data-action="advance">${advanceLabel}</button>
                  <button class="btn small urgent-toggle-btn" data-action="toggle-urgent">${o.urgent ? '🔴 Shoshilinchni bekor qilish' : '🔴 Shoshilinch qilish'}</button>
                  <button class="btn small" data-action="up" title="Navbatda yuqoriga">▲</button>
                  <button class="btn small" data-action="down" title="Navbatda pastga">▼</button>
                  <button class="btn danger small" data-action="delete">O'chirish</button>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        `;
      }).join('');
      return `
        <div class="line-block">
          <div class="line-block-head">
            <h4>${escapeHtml(line.name)}</h4>
            <span class="group-tag">${escapeHtml(line.group)}</span>
          </div>
          ${stationsHtml || '<div class="empty-hint">Bu liniyada faol zakaz yo\'q</div>'}
        </div>
      `;
    }).join('');
  }

  bindOrderRowEvents();
  renderDoneOrders();
}

function bindOrderRowEvents() {
  document.querySelectorAll('.order-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-field="orderNumber"]').addEventListener('change', (e) => updateOrder(id, { orderNumber: e.target.value }));
    row.querySelector('[data-field="note"]').addEventListener('change', (e) => updateOrder(id, { note: e.target.value }));
    row.querySelector('[data-field="time"]').addEventListener('change', (e) => updateOrder(id, { time: e.target.value }));
    row.querySelector('[data-field="assignedUserId"]').addEventListener('change', (e) => updateOrder(id, { assignedUserId: e.target.value || null }));
    row.querySelector('[data-action="move"]').addEventListener('change', (e) => {
      const [lineId, stationIndex] = e.target.value.split('|');
      updateOrder(id, { lineId, stationIndex: Number(stationIndex) });
    });
    row.querySelector('[data-action="advance"]').addEventListener('click', () => advanceOrder(id));
    row.querySelector('[data-action="toggle-urgent"]').addEventListener('click', () => {
      const order = state.orders.find(o => o.id === id);
      updateOrder(id, { urgent: !(order && order.urgent) });
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteOrder(id));
    const upBtn = row.querySelector('[data-action="up"]');
    const downBtn = row.querySelector('[data-action="down"]');
    if (upBtn) upBtn.addEventListener('click', () => moveWithinBucket(id, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveWithinBucket(id, 1));
  });
}

async function updateOrder(id, patch) {
  try { await api(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); }
  catch (e) { toast(e.message, true); }
}

async function advanceOrder(id) {
  try { await api(`/api/orders/${id}/advance`, { method: 'POST' }); }
  catch (e) { toast(e.message, true); }
}

async function deleteOrder(id) {
  if (!confirm("Bu zakazni o'chirasizmi?")) return;
  try { await api(`/api/orders/${id}`, { method: 'DELETE' }); toast("Zakaz o'chirildi"); }
  catch (e) { toast(e.message, true); }
}

async function moveWithinBucket(id, dir) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;
  const fullOrdered = [...state.orders].sort((a, b) => a.priority - b.priority);
  const bucketIds = fullOrdered.filter(o => o.lineId === order.lineId && o.stationIndex === order.stationIndex).map(o => o.id);
  const posInBucket = bucketIds.indexOf(id);
  const neighborPos = posInBucket + dir;
  if (neighborPos < 0 || neighborPos >= bucketIds.length) return;
  const neighborId = bucketIds[neighborPos];
  const fullIds = fullOrdered.map(o => o.id);
  const i1 = fullIds.indexOf(id), i2 = fullIds.indexOf(neighborId);
  [fullIds[i1], fullIds[i2]] = [fullIds[i2], fullIds[i1]];
  try { await api('/api/orders/reorder', { method: 'POST', body: JSON.stringify({ orderIds: fullIds }) }); }
  catch (e) { toast(e.message, true); }
}

// ---------- Done orders ----------
document.getElementById('done-toggle').addEventListener('click', () => {
  document.getElementById('done-list').classList.toggle('show');
});

function renderDoneOrders() {
  const done = state.orders.filter(o => o.done).sort((a, b) => b.updatedAt - a.updatedAt);
  document.getElementById('done-count').textContent = done.length;
  const el = document.getElementById('done-list');
  el.innerHTML = done.slice(0, 100).map(o => `
    <div class="done-row">
      <span><b>#${escapeHtml(o.orderNumber)}</b> — ${escapeHtml(o.note || '')}</span>
      <button class="btn danger small" data-id="${o.id}">O'chirish</button>
    </div>
  `).join('') || '<div class="empty-hint">Hali yakunlangan zakaz yo\'q</div>';
  el.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteOrder(btn.dataset.id));
  });
}

// ---------- Lines management ----------
document.getElementById('line-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const stationNames = form.stationNames.value.split(',').map(s => s.trim()).filter(Boolean);
  try {
    await api('/api/lines', {
      method: 'POST',
      body: JSON.stringify({ name: form.name.value.trim(), group: form.group.value.trim(), stationNames })
    });
    form.reset();
    toast('Liniya qo\'shildi');
  } catch (e) { toast(e.message, true); }
});

function renderLines() {
  const el = document.getElementById('lines-list');
  el.innerHTML = state.lines.map(line => `
    <div class="line-card" data-id="${line.id}">
      <div class="line-card-head">
        <span class="name">${escapeHtml(line.name)}</span>
        <button class="btn danger small" data-action="delete-line" data-id="${line.id}">Liniyani o'chirish</button>
      </div>
      <div class="line-meta-row">
        <div><label>Nomi</label><input data-field="name" value="${escapeHtml(line.name)}"></div>
        <div><label>TV guruhi</label><input data-field="group" value="${escapeHtml(line.group)}"></div>
        <div><label>Keyingi liniya</label>
          <select data-field="nextLineId">
            <option value="">— Yo'q (yakuniy) —</option>
            ${state.lines.filter(l => l.id !== line.id).map(l => `<option value="${l.id}" ${line.nextLineId === l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
          </select>
        </div>
        <div class="checkbox-row">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" data-field="replenish" ${line.replenish ? 'checked' : ''}>
            Yakunlanganda yangi material buyurtmasi (XDF) yaratilsin
          </label>
        </div>
      </div>
      <div class="stations-row">
        ${line.stations.map(st => `
          <span class="station-pill">${escapeHtml(st.name)}
            <button data-action="del-station" data-line="${line.id}" data-station="${st.id}" title="Bosqichni o'chirish">✕</button>
          </span>
        `).join('')}
        <span class="add-station-inline">
          <input placeholder="Yangi bosqich" data-line="${line.id}" class="add-station-input">
          <button class="btn small" data-action="add-station" data-line="${line.id}">+</button>
        </span>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-field="name"]').forEach(inp => inp.addEventListener('change', (e) => updateLine(e.target.closest('.line-card').dataset.id, { name: e.target.value })));
  el.querySelectorAll('[data-field="group"]').forEach(inp => inp.addEventListener('change', (e) => updateLine(e.target.closest('.line-card').dataset.id, { group: e.target.value })));
  el.querySelectorAll('[data-field="nextLineId"]').forEach(sel => sel.addEventListener('change', (e) => updateLine(e.target.closest('.line-card').dataset.id, { nextLineId: e.target.value })));
  el.querySelectorAll('[data-field="replenish"]').forEach(cb => cb.addEventListener('change', (e) => updateLine(e.target.closest('.line-card').dataset.id, { replenish: e.target.checked })));
  el.querySelectorAll('[data-action="delete-line"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm("Bu liniyani o'chirasizmi?")) return;
    try { await api(`/api/lines/${btn.dataset.id}`, { method: 'DELETE' }); toast("Liniya o'chirildi"); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll('[data-action="del-station"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm("Bu bosqichni o'chirasizmi? Undagi zakazlar oldingi bosqichga suriladi.")) return;
    try { await api(`/api/lines/${btn.dataset.line}/stations/${btn.dataset.station}`, { method: 'DELETE' }); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll('[data-action="add-station"]').forEach(btn => btn.addEventListener('click', async () => {
    const input = el.querySelector(`.add-station-input[data-line="${btn.dataset.line}"]`);
    const name = input.value.trim();
    if (!name) return;
    try { await api(`/api/lines/${btn.dataset.line}/stations`, { method: 'POST', body: JSON.stringify({ name }) }); input.value = ''; }
    catch (e) { toast(e.message, true); }
  }));
}

async function updateLine(id, patch) {
  try { await api(`/api/lines/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); }
  catch (e) { toast(e.message, true); }
}

// ---------- Complaints ----------
document.getElementById('complaint-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const text = form.text.value.trim();
  if (!text) return;
  try {
    await api('/api/complaints', { method: 'POST', body: JSON.stringify({ text }) });
    form.reset();
    toast('Shikoyat yuborildi');
  } catch (e) { toast(e.message, true); }
});

function renderComplaints() {
  const complaints = state.complaints || [];
  const listEl = document.getElementById('complaints-list');
  const emptyEl = document.getElementById('complaints-empty');
  const badge = document.getElementById('complaints-badge');

  const openCount = complaints.filter(c => c.status === 'ochiq').length;
  if (openCount > 0) { badge.textContent = openCount; badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }

  if (!listEl) return;
  if (!complaints.length) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  listEl.innerHTML = complaints.map(c => `
    <div class="complaint-item ${c.status === 'hal_qilindi' ? 'resolved' : ''}">
      <div class="complaint-body">
        <div class="complaint-meta">${escapeHtml(c.userName)} · ${new Date(c.createdAt).toLocaleString('uz-UZ')}</div>
        <div class="complaint-text">${escapeHtml(c.text)}</div>
      </div>
      <div class="complaint-actions">
        ${c.status === 'ochiq'
          ? `<button class="btn success small" data-action="resolve" data-id="${c.id}">Hal qilindi</button>`
          : `<button class="btn small" data-action="reopen" data-id="${c.id}">Qayta ochish</button>`}
        <button class="btn danger small" data-action="del-complaint" data-id="${c.id}">O'chirish</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-action="resolve"]').forEach(btn => btn.addEventListener('click', async () => {
    try { await api(`/api/complaints/${btn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ status: 'hal_qilindi' }) }); } catch (e) { toast(e.message, true); }
  }));
  listEl.querySelectorAll('[data-action="reopen"]').forEach(btn => btn.addEventListener('click', async () => {
    try { await api(`/api/complaints/${btn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ status: 'ochiq' }) }); } catch (e) { toast(e.message, true); }
  }));
  listEl.querySelectorAll('[data-action="del-complaint"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm("Bu shikoyatni o'chirasizmi?")) return;
    try { await api(`/api/complaints/${btn.dataset.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Users (admin only) ----------
async function loadUsers() {
  try { const res = await api('/api/users'); renderUsers(res.users); }
  catch (e) { /* not admin */ }
}

function allStationsFlat() {
  const list = [];
  state.lines.forEach(l => l.stations.forEach(st => list.push({ id: st.id, label: `${l.name} · ${st.name}` })));
  return list;
}

function renderNewUserStations() {
  const el = document.getElementById('new-user-stations');
  if (!el) return;
  el.innerHTML = allStationsFlat().map(s => `
    <label class="station-checkbox"><input type="checkbox" value="${s.id}"> ${escapeHtml(s.label)}</label>
  `).join('');
  el.querySelectorAll('.station-checkbox').forEach(lbl => {
    const cb = lbl.querySelector('input');
    cb.addEventListener('change', () => lbl.classList.toggle('checked', cb.checked));
  });
}

document.getElementById('new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const stationAccess = [...document.querySelectorAll('#new-user-stations input:checked')].map(cb => cb.value);
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value.trim(),
        username: form.username.value.trim(),
        password: form.password.value,
        role: form.role.value,
        stationAccess
      })
    });
    form.reset();
    renderNewUserStations();
    toast("Foydalanuvchi qo'shildi");
    loadUsers();
  } catch (e) { toast(e.message, true); }
});

function renderUsers(users) {
  const el = document.getElementById('users-list');
  const flatStations = allStationsFlat();
  el.innerHTML = users.map(u => `
    <div class="user-row" data-id="${u.id}">
      <div class="user-row-top">
        <div class="user-meta">
          <b>${escapeHtml(u.name)} <span class="role-pill ${u.role}">${u.role === 'admin' ? 'Admin' : 'Xodim'}</span></b>
          <span>login: ${escapeHtml(u.username)}</span>
        </div>
        <div style="display:flex; gap:8px;">
          ${u.id !== me.id ? `<button class="btn small" data-action="impersonate" data-id="${u.id}">Uning nomidan kirish</button>` : ''}
          <button class="btn small" data-action="pw" data-id="${u.id}">Parolni almashtirish</button>
          ${u.id !== me.id ? `<button class="btn danger small" data-action="del" data-id="${u.id}">O'chirish</button>` : ''}
        </div>
      </div>
      ${u.role === 'xodim' ? `
        <div class="station-access-row">
          ${flatStations.map(s => `
            <label class="station-checkbox ${u.stationAccess.includes(s.id) ? 'checked' : ''}">
              <input type="checkbox" value="${s.id}" ${u.stationAccess.includes(s.id) ? 'checked' : ''}> ${escapeHtml(s.label)}
            </label>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');

  el.querySelectorAll('.user-row').forEach(row => {
    const userId = row.dataset.id;
    row.querySelectorAll('.station-access-row .station-checkbox').forEach(lbl => {
      const cb = lbl.querySelector('input');
      cb.addEventListener('change', async () => {
        lbl.classList.toggle('checked', cb.checked);
        const checked = [...row.querySelectorAll('.station-access-row input:checked')].map(x => x.value);
        try { await api(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ stationAccess: checked }) }); }
        catch (e) { toast(e.message, true); }
      });
    });
  });

  el.querySelectorAll('[data-action="impersonate"]').forEach(btn => btn.addEventListener('click', async () => {
    try { await api(`/api/users/${btn.dataset.id}/impersonate`, { method: 'POST' }); window.location.reload(); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll('[data-action="pw"]').forEach(btn => btn.addEventListener('click', async () => {
    const pw = prompt('Yangi parolni kiriting (kamida 4 belgi):');
    if (!pw) return;
    try { await api(`/api/users/${btn.dataset.id}/password`, { method: 'PUT', body: JSON.stringify({ password: pw }) }); toast("Parol o'zgartirildi"); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll('[data-action="del"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm("Bu foydalanuvchini o'chirasizmi?")) return;
    try { await api(`/api/users/${btn.dataset.id}`, { method: 'DELETE' }); toast("Foydalanuvchi o'chirildi"); loadUsers(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'users') loadUsers();
    if (btn.dataset.tab === 'report') { loadReport(); loadBackups(); }
    if (btn.dataset.tab === 'audit') loadAudit();
  });
});

// ---------- Logout / impersonation ----------
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});
document.getElementById('stop-impersonate').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/impersonate/stop', { method: 'POST' });
  window.location.reload();
});

// ---------- Personal Notifications ----------
let notifState = { items: [], unread: 0 };
let audioCtx = null;

function playNotifSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1160].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.25);
    });
  } catch (e) { /* audio not available */ }
}

async function loadNotifications() {
  try {
    const res = await api('/api/notifications');
    notifState.items = res.notifications;
    notifState.unread = res.unread;
    renderNotifications();
  } catch (e) { /* ignore */ }
}

function prependNotification(n) {
  notifState.items.unshift(n);
  notifState.unread += 1;
  renderNotifications();
}

function renderNotifications() {
  const badge = document.getElementById('notif-badge');
  if (notifState.unread > 0) { badge.textContent = notifState.unread; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }

  const listEl = document.getElementById('notif-list');
  if (!notifState.items.length) {
    listEl.innerHTML = '<div class="notif-empty">Bildirishnomalar yo\'q</div>';
    return;
  }
  listEl.innerHTML = notifState.items.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
      <div class="t">${escapeHtml(n.title)}</div>
      <div class="m">${escapeHtml(n.message)}</div>
      <div class="time">${new Date(n.createdAt).toLocaleString('uz-UZ')}</div>
      ${!n.read ? `<button class="btn small" data-action="mark-read">Ko'rdim</button>` : ''}
    </div>
  `).join('');
  listEl.querySelectorAll('[data-action="mark-read"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.notif-item');
      const id = item.dataset.id;
      const n = notifState.items.find(x => x.id === id);
      if (n && !n.read) { n.read = true; notifState.unread = Math.max(0, notifState.unread - 1); }
      renderNotifications();
      try { await api(`/api/notifications/${id}/read`, { method: 'POST' }); } catch (e) {}
    });
  });
}

document.getElementById('notif-bell').addEventListener('click', () => {
  const dd = document.getElementById('notif-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('notif-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('notif-dropdown').style.display = 'none';
});
document.getElementById('notif-read-all').addEventListener('click', async () => {
  notifState.items.forEach(n => n.read = true);
  notifState.unread = 0;
  renderNotifications();
  try { await api('/api/notifications/read-all', { method: 'POST' }); } catch (e) {}
});

// ---------- Report (admin) ----------
async function loadReport() {
  try {
    const res = await api('/api/report');
    document.getElementById('rep-completed').textContent = res.totalCompleted;
    document.getElementById('rep-active').textContent = res.totalActive;
    document.getElementById('rep-archived').textContent = res.totalArchived;

    const maxCount = Math.max(1, ...res.dailyCounts.map(d => d.count));
    document.getElementById('rep-chart').innerHTML = res.dailyCounts.map(d => `
      <div class="bar-col">
        <div class="bar-fill" style="height:${Math.round((d.count / maxCount) * 100)}%"></div>
        <div class="bar-label">${d.count}</div>
        <div class="bar-label">${d.date}</div>
      </div>
    `).join('');

    const tbody = document.getElementById('rep-station-table');
    tbody.innerHTML = res.stationReport.length ? res.stationReport.map(s => `
      <tr>
        <td>${escapeHtml(s.lineName)}</td>
        <td>${escapeHtml(s.stationName)}</td>
        <td>${s.count}</td>
        <td>${s.avgMinutes} daqiqa</td>
      </tr>
    `).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--text-low);">Hali ma\'lumot yo\'q</td></tr>';
  } catch (e) { toast(e.message, true); }
}

// ---------- Backups (Zaxira nusxa) ----------
async function loadBackups() {
  try {
    const res = await api('/api/backups');
    const el = document.getElementById('backups-list');
    if (!el) return;
    if (!res.backups.length) {
      el.innerHTML = '<div class="empty-hint">Hali zaxira nusxa yo\'q</div>';
      return;
    }
    el.innerHTML = res.backups.map(b => `
      <div class="backup-item">
        <span>${escapeHtml(b.name)} — ${(b.size / 1024).toFixed(1)} KB — ${new Date(b.createdAt).toLocaleString('uz-UZ')}</span>
        <a class="btn small" href="/api/backups/${encodeURIComponent(b.name)}/download">Yuklab olish</a>
      </div>
    `).join('');
  } catch (e) { toast(e.message, true); }
}

document.getElementById('backup-now-btn').addEventListener('click', async () => {
  try {
    await api('/api/backups/create', { method: 'POST' });
    toast('Zaxira nusxa olindi');
    loadBackups();
  } catch (e) { toast(e.message, true); }
});

// ---------- Audit log (Jurnal, admin) ----------
async function loadAudit() {
  try {
    const res = await api('/api/audit');
    const el = document.getElementById('audit-list');
    if (!res.log.length) {
      el.innerHTML = '<div class="empty-hint">Hali yozuv yo\'q</div>';
      return;
    }
    el.innerHTML = res.log.map(l => `
      <div class="audit-item">
        <div><b>${escapeHtml(l.userName)}</b> — ${escapeHtml(l.action)} ${l.details ? `<span style="color:var(--text-mid)">(${escapeHtml(l.details)})</span>` : ''}</div>
        <div class="a-meta">${new Date(l.createdAt).toLocaleString('uz-UZ')}</div>
      </div>
    `).join('');
  } catch (e) { toast(e.message, true); }
}

init();
