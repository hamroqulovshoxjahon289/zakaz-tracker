const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { load, save, nanoid, bcrypt } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'zakaz-tracker-maxfiy-kalit-o-zgartiring';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// ---------- Helpers ----------
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, stationAccess: u.stationAccess || [] };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Tizimga kirilmagan' });
  next();
}

function requireAdmin(req, res, next) {
  const data = load();
  const u = data.users.find(x => x.id === req.session.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Faqat admin uchun' });
  next();
}

function broadcastState() {
  const data = load();
  io.emit('state', publicState(data));
}

function findLine(data, lineId) {
  return data.lines.find(l => l.id === lineId);
}

function publicState(data) {
  const orders = [...data.orders].sort((a, b) => a.priority - b.priority);
  const employees = data.users
    .filter(u => u.role === 'xodim')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(publicUser);
  const complaints = [...data.complaints].sort((a, b) => b.createdAt - a.createdAt);
  const activeOrders = orders.filter(o => !o.done);
  return {
    dayStarted: data.dayStarted,
    dayStartedAt: data.dayStartedAt,
    lines: data.lines,
    orders,
    employees,
    complaints,
    stats: {
      totalToday: orders.length,
      active: activeOrders.length,
      done: orders.filter(o => o.done).length,
      linesCount: data.lines.length,
      openComplaints: data.complaints.filter(c => c.status === 'ochiq').length
    }
  };
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = load();
  const user = data.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Login yoki parol xato' });
  }
  req.session.userId = user.id;
  req.session.realUserId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const data = load();
  const user = data.users.find(u => u.id === req.session.userId);
  const isImpersonating = req.session.realUserId && req.session.realUserId !== req.session.userId;
  res.json({ user: publicUser(user), impersonating: isImpersonating });
});

app.post('/api/users/:id/impersonate', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const target = data.users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Topilmadi' });
  req.session.userId = target.id;
  res.json({ user: publicUser(target) });
});

app.post('/api/impersonate/stop', requireAuth, (req, res) => {
  const data = load();
  if (req.session.realUserId) {
    const real = data.users.find(u => u.id === req.session.realUserId);
    if (real) req.session.userId = real.id;
  }
  const user = data.users.find(u => u.id === req.session.userId);
  res.json({ user: publicUser(user) });
});

// ---------- Users ----------
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  res.json({ users: data.users.map(publicUser) });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, name, role, stationAccess } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: "Barcha maydonlar to'ldirilishi shart" });
  const data = load();
  if (data.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Bu login band' });
  }
  const user = {
    id: nanoid(8),
    username,
    passwordHash: bcrypt.hashSync(password, 8),
    name,
    role: role === 'admin' ? 'admin' : 'xodim',
    stationAccess: Array.isArray(stationAccess) ? stationAccess : [],
    createdAt: Date.now()
  };
  data.users.push(user);
  save(data);
  broadcastState();
  res.json({ user: publicUser(user) });
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const u = data.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Topilmadi' });
  const { name, stationAccess } = req.body;
  if (name !== undefined) u.name = name;
  if (stationAccess !== undefined) u.stationAccess = Array.isArray(stationAccess) ? stationAccess : [];
  save(data);
  broadcastState();
  res.json({ user: publicUser(u) });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  if (req.params.id === req.session.userId) return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  const before = data.users.length;
  data.users = data.users.filter(u => u.id !== req.params.id);
  if (data.users.length === before) return res.status(404).json({ error: 'Topilmadi' });
  save(data);
  broadcastState();
  res.json({ ok: true });
});

app.put('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Parol juda qisqa' });
  const data = load();
  const u = data.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Topilmadi' });
  u.passwordHash = bcrypt.hashSync(password, 8);
  save(data);
  res.json({ ok: true });
});

// ---------- Lines & Stations (Liniyalar) ----------
app.get('/api/lines', requireAuth, (req, res) => {
  const data = load();
  res.json({ lines: data.lines });
});

app.post('/api/lines', requireAuth, requireAdmin, (req, res) => {
  const { name, group, stationNames, nextLineId, replenish } = req.body;
  if (!name || !group) return res.status(400).json({ error: "Liniya nomi va guruhi kerak" });
  const data = load();
  const stations = (Array.isArray(stationNames) ? stationNames : [name])
    .filter(s => s && s.trim())
    .map(s => ({ id: nanoid(8), name: s.trim() }));
  if (!stations.length) stations.push({ id: nanoid(8), name: 'Bosqich 1' });
  const line = {
    id: nanoid(8),
    name: name.trim(),
    group: group.trim().toLowerCase(),
    stations,
    nextLineId: nextLineId || null,
    replenish: !!replenish,
    createdAt: Date.now()
  };
  data.lines.push(line);
  save(data);
  broadcastState();
  res.json({ line });
});

app.put('/api/lines/:id', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const line = findLine(data, req.params.id);
  if (!line) return res.status(404).json({ error: 'Topilmadi' });
  const { name, group, nextLineId, replenish } = req.body;
  if (name !== undefined) line.name = name;
  if (group !== undefined) line.group = group.trim().toLowerCase();
  if (nextLineId !== undefined) line.nextLineId = nextLineId || null;
  if (replenish !== undefined) line.replenish = !!replenish;
  save(data);
  broadcastState();
  res.json({ line });
});

app.post('/api/lines/:id/stations', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Stansiya nomi kerak' });
  const data = load();
  const line = findLine(data, req.params.id);
  if (!line) return res.status(404).json({ error: 'Topilmadi' });
  const station = { id: nanoid(8), name: name.trim() };
  line.stations.push(station);
  save(data);
  broadcastState();
  res.json({ station });
});

app.delete('/api/lines/:lineId/stations/:stationId', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const line = findLine(data, req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Topilmadi' });
  const idx = line.stations.findIndex(s => s.id === req.params.stationId);
  if (idx === -1) return res.status(404).json({ error: 'Stansiya topilmadi' });
  if (line.stations.length === 1) return res.status(400).json({ error: "Liniyada kamida 1 ta stansiya bo'lishi kerak" });
  // Bu stansiyada turgan zakazlarni oldingi bosqichga suramiz
  data.orders.forEach(o => {
    if (o.lineId === line.id && o.stationIndex >= idx) {
      o.stationIndex = Math.max(0, idx - 1);
    }
  });
  line.stations.splice(idx, 1);
  save(data);
  broadcastState();
  res.json({ ok: true });
});

app.delete('/api/lines/:id', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const inUse = data.orders.some(o => o.lineId === req.params.id && !o.done);
  if (inUse) return res.status(400).json({ error: "Bu liniyada faol zakazlar bor, avval ularni ko'chiring" });
  data.lines = data.lines.filter(l => l.id !== req.params.id);
  data.lines.forEach(l => { if (l.nextLineId === req.params.id) l.nextLineId = null; });
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// ---------- Day control ----------
app.post('/api/day/start', requireAuth, (req, res) => {
  const data = load();
  data.dayStarted = true;
  data.dayStartedAt = Date.now();
  save(data);
  broadcastState();
  res.json({ ok: true });
});

app.post('/api/day/finish', requireAuth, (req, res) => {
  const data = load();
  data.dayStarted = false;
  data.orders = [];
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// ---------- Orders ----------
app.get('/api/orders', requireAuth, (req, res) => {
  const data = load();
  res.json({ orders: [...data.orders].sort((a, b) => a.priority - b.priority) });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const { orderNumber, time, note, lineId, assignedUserId } = req.body;
  if (!orderNumber) return res.status(400).json({ error: 'Zakaz raqami kerak' });
  const data = load();
  const line = lineId ? findLine(data, lineId) : data.lines[0];
  if (!line) return res.status(400).json({ error: "Liniya topilmadi" });
  const maxPriority = data.orders.reduce((m, o) => Math.max(m, o.priority), 0);
  const order = {
    id: nanoid(8),
    orderNumber,
    time: time || '',
    note: note || '',
    lineId: line.id,
    stationIndex: 0,
    assignedUserId: assignedUserId || null,
    done: false,
    parentOrderId: null,
    completedStations: [],
    priority: maxPriority + 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  data.orders.push(order);
  save(data);
  broadcastState();
  res.json({ order });
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const data = load();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Topilmadi' });
  const { orderNumber, time, note, assignedUserId, lineId, stationIndex, done } = req.body;
  if (orderNumber !== undefined) order.orderNumber = orderNumber;
  if (time !== undefined) order.time = time;
  if (note !== undefined) order.note = note;
  if (assignedUserId !== undefined) order.assignedUserId = assignedUserId;
  if (lineId !== undefined) { order.lineId = lineId; order.stationIndex = 0; }
  if (stationIndex !== undefined) order.stationIndex = stationIndex;
  if (done !== undefined) order.done = done;
  order.updatedAt = Date.now();
  save(data);
  broadcastState();
  res.json({ order });
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const data = load();
  data.orders = data.orders.filter(o => o.id !== req.params.id);
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// Priority-based reordering (up/down within a station bucket, computed client-side)
app.post('/api/orders/reorder', requireAuth, (req, res) => {
  const { orderIds } = req.body;
  if (!Array.isArray(orderIds)) return res.status(400).json({ error: "Noto'g'ri format" });
  const data = load();
  orderIds.forEach((id, idx) => {
    const order = data.orders.find(o => o.id === id);
    if (order) order.priority = idx + 1;
  });
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// Zakazni bir bosqich oldinga suradi; liniya oxiriga yetsa keyingi liniyaga o'tkazadi,
// agar keyingi liniya bo'lmasa - zakaz yakunlangan hisoblanadi.
// "replenish" liniyalarda (masalan Korpus) shu bosqichda avtomatik yangi
// material buyurtmasi (klon) liniya boshiga qo'shiladi.
app.post('/api/orders/:id/advance', requireAuth, (req, res) => {
  const data = load();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Topilmadi' });
  const line = findLine(data, order.lineId);
  if (!line) return res.status(400).json({ error: "Liniya topilmadi" });

  const finishedStation = line.stations[order.stationIndex];
  order.completedStations.push({
    lineId: line.id, lineName: line.name,
    stationId: finishedStation ? finishedStation.id : null,
    stationName: finishedStation ? finishedStation.name : '',
    orderNumber: order.orderNumber,
    at: Date.now()
  });

  const isLastStation = order.stationIndex >= line.stations.length - 1;

  if (!isLastStation) {
    order.stationIndex += 1;
  } else {
    // Liniyaning oxirgi bosqichi tugadi
    if (line.replenish) {
      const maxPriority = data.orders.reduce((m, o) => Math.max(m, o.priority), 0);
      const clone = {
        id: nanoid(8),
        orderNumber: order.orderNumber,
        time: '',
        note: 'Material tayyorlash (XDF)',
        lineId: line.id,
        stationIndex: 0,
        assignedUserId: null,
        done: false,
        parentOrderId: order.id,
        completedStations: [],
        priority: maxPriority + 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      data.orders.push(clone);
    }
    if (line.nextLineId) {
      const nextLine = findLine(data, line.nextLineId);
      if (nextLine) {
        order.lineId = nextLine.id;
        order.stationIndex = 0;
      } else {
        order.done = true;
      }
    } else {
      order.done = true;
    }
  }

  order.updatedAt = Date.now();
  save(data);
  broadcastState();
  res.json({ order });
});

// ---------- Complaints ----------
app.get('/api/complaints', requireAuth, (req, res) => {
  const data = load();
  res.json({ complaints: [...data.complaints].sort((a, b) => b.createdAt - a.createdAt) });
});

app.post('/api/complaints', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Shikoyat matni kiritilmagan' });
  const data = load();
  const author = data.users.find(u => u.id === req.session.userId);
  const complaint = {
    id: nanoid(8),
    userId: author ? author.id : null,
    userName: author ? author.name : "Noma'lum",
    text: text.trim(),
    status: 'ochiq',
    createdAt: Date.now(),
    resolvedAt: null
  };
  data.complaints.push(complaint);
  save(data);
  broadcastState();
  res.json({ complaint });
});

app.put('/api/complaints/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['ochiq', 'hal_qilindi'].includes(status)) return res.status(400).json({ error: "Noto'g'ri status" });
  const data = load();
  const complaint = data.complaints.find(c => c.id === req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Topilmadi' });
  complaint.status = status;
  complaint.resolvedAt = status === 'hal_qilindi' ? Date.now() : null;
  save(data);
  broadcastState();
  res.json({ complaint });
});

app.delete('/api/complaints/:id', requireAuth, (req, res) => {
  const data = load();
  data.complaints = data.complaints.filter(c => c.id !== req.params.id);
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// Public read-only state (TV uses this, no auth)
app.get('/api/state', (req, res) => {
  const data = load();
  res.json(publicState(data));
});

// ---------- Pages ----------
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'views', 'tv.html')));
app.get('/tv/:group', (req, res) => res.sendFile(path.join(__dirname, 'views', 'tv.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  const data = load();
  socket.emit('state', publicState(data));
});

server.listen(PORT, () => {
  console.log(`Zakaz Tracker ishga tushdi: http://localhost:${PORT}`);
  console.log(`TV ekran: http://localhost:${PORT}/tv`);
  console.log(`Admin/Xodim kirish: http://localhost:${PORT}/login  (login: admin, parol: admin123)`);
});
