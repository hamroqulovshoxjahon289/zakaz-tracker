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
      loadUsers();
    }
    if (meRes.impersonating) document.getElementById('impersonate-banner').style.display = 'block';
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').classList.add('ready');
    connectSocket();
  } catch (e) {
    window.location.href = '/login';
  }
}

function connectSocket() {
  const socket = io();
  socket.on('state', (s) => { state = s; renderAll(); });
}

function renderAll() {
  renderDayBar();
  renderTvLinks();
  renderOrderFormLineOptions();
  renderLineFilters();
  renderOrders();
  renderLines();
  renderComplaints();
  renderNewUserStations();
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
        lineId: form.lineId.value
      })
    });
    form.orderNumber.value = ''; form.time.value = ''; form.note.value = '';
    toast("Zakaz qo'shildi");
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

function renderOrders() {
  const container = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');
  const active = state.orders.filter(o => !o.done);
  const linesToShow = activeLineFilter === 'all' ? state.lines : state.lines.filter(l => l.id === activeLineFilter);

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
            ${bucket.map((o, i) => `
              <div class="order-row" data-id="${o.id}">
                <div class="prio-num">${i + 1}</div>
                <div class="order-fields">
                  <input class="num-input" data-field="orderNumber" value="${escapeHtml(o.orderNumber)}">
                  <textarea class="note-input" data-field="note" placeholder="Izoh...">${escapeHtml(o.note || '')}</textarea>
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
                  <button class="btn small" data-action="up" title="Navbatda yuqoriga">▲</button>
                  <button class="btn small" data-action="down" title="Navbatda pastga">▼</button>
                  <button class="btn danger small" data-action="delete">O'chirish</button>
                </div>
              </div>
            `).join('')}
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

init();
