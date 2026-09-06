const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
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

// Amallar jurnaliga yozuv qo'shadi (audit log)
function logAction(data, req, action, details) {
  const user = data.users.find(u => u.id === req.session.userId);
  data.auditLog.push({
    id: nanoid(8),
    userId: req.session.userId || null,
    userName: user ? user.name : "Noma'lum",
    action,
    details: details || '',
    createdAt: Date.now()
  });
  // Jurnal cheksiz o'smasligi uchun oxirgi 2000 tasini saqlaymiz
  if (data.auditLog.length > 2000) data.auditLog = data.auditLog.slice(-2000);
}

function findLine(data, lineId) {
  return data.lines.find(l => l.id === lineId);
}

function findStationById(data, stationId) {
  for (const line of data.lines) {
    const st = line.stations.find(s => s.id === stationId);
    if (st) return { line, station: st };
  }
  return null;
}

function usersForStation(data, stationId) {
  return data.users.filter(u => u.role === 'xodim' && (u.stationAccess || []).includes(stationId));
}

// Foydalanuvchiga bildirishnoma yaratadi, saqlaydi va jonli (socket) yuboradi
function notifyUser(data, userId, { title, message, orderId }) {
  if (!userId) return;
  const notif = {
    id: nanoid(8),
    userId,
    title,
    message,
    orderId: orderId || null,
    read: false,
    createdAt: Date.now()
  };
  data.notifications.push(notif);
  io.to('user:' + userId).emit('notification', notif);
  return notif;
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
    customers: data.customers,
    templates: data.templates,
    stats: {
      totalToday: orders.length,
      active: activeOrders.length,
      done: orders.filter(o => o.done).length,
      linesCount: data.lines.length,
      openComplaints: data.complaints.filter(c => c.status === 'ochiq').length,
      urgent: activeOrders.filter(o => o.urgent).length
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
  logAction(data, req, 'Yangi xodim qo\'shdi', `${name} (${username})`);
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
  const target = data.users.find(u => u.id === req.params.id);
  const before = data.users.length;
  data.users = data.users.filter(u => u.id !== req.params.id);
  if (data.users.length === before) return res.status(404).json({ error: 'Topilmadi' });
  if (target) logAction(data, req, "Xodimni o'chirdi", target.name);
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
  logAction(data, req, 'Yangi liniya qo\'shdi', name.trim());
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
  const now = Date.now();
  data.orders.forEach(o => data.archivedOrders.push({ ...o, archivedAt: now }));
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
  const { orderNumber, time, note, lineId, assignedUserId, urgent, customerId } = req.body;
  if (!orderNumber) return res.status(400).json({ error: 'Zakaz raqami kerak' });
  const data = load();
  const line = lineId ? findLine(data, lineId) : data.lines[0];
  if (!line) return res.status(400).json({ error: "Liniya topilmadi" });
  const maxPriority = data.orders.reduce((m, o) => Math.max(m, o.priority), 0);
  const now = Date.now();
  const order = {
    id: nanoid(8),
    orderNumber,
    time: time || '',
    note: note || '',
    lineId: line.id,
    stationIndex: 0,
    assignedUserId: assignedUserId || null,
    customerId: customerId || null,
    urgent: !!urgent,
    done: false,
    parentOrderId: null,
    completedStations: [],
    priority: maxPriority + 1,
    createdAt: now,
    updatedAt: now,
    stationEnteredAt: now
  };
  data.orders.push(order);
  logAction(data, req, 'Zakaz yaratdi', `#${orderNumber} — ${line.name}`);

  // Boshlang'ich stansiyada ishlaydigan xodimlarga va biriktirilgan xodimga bildirishnoma
  const startStation = line.stations[0];
  const notifiedIds = new Set();
  if (assignedUserId) {
    notifyUser(data, assignedUserId, {
      title: "Sizga yangi zakaz biriktirildi",
      message: `#${orderNumber} — ${line.name} / ${startStation ? startStation.name : ''}`,
      orderId: order.id
    });
    notifiedIds.add(assignedUserId);
  }
  if (startStation) {
    usersForStation(data, startStation.id).forEach(u => {
      if (notifiedIds.has(u.id)) return;
      notifyUser(data, u.id, {
        title: 'Yangi zakaz keldi',
        message: `#${orderNumber} — ${line.name} / ${startStation.name}ga tushdi`,
        orderId: order.id
      });
      notifiedIds.add(u.id);
    });
  }

  save(data);
  broadcastState();
  res.json({ order });
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const data = load();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Topilmadi' });
  const { orderNumber, time, note, assignedUserId, lineId, stationIndex, done, urgent, customerId } = req.body;
  if (orderNumber !== undefined) order.orderNumber = orderNumber;
  if (time !== undefined) order.time = time;
  if (note !== undefined) order.note = note;
  if (assignedUserId !== undefined) order.assignedUserId = assignedUserId;
  if (customerId !== undefined) order.customerId = customerId;
  if (urgent !== undefined) order.urgent = !!urgent;
  if (lineId !== undefined) { order.lineId = lineId; order.stationIndex = 0; order.stationEnteredAt = Date.now(); }
  if (stationIndex !== undefined) { order.stationIndex = stationIndex; order.stationEnteredAt = Date.now(); }
  if (done !== undefined) order.done = done;
  order.updatedAt = Date.now();
  logAction(data, req, 'Zakazni tahrirladi', `#${order.orderNumber}`);
  save(data);
  broadcastState();
  res.json({ order });
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const data = load();
  const order = data.orders.find(o => o.id === req.params.id);
  data.orders = data.orders.filter(o => o.id !== req.params.id);
  if (order) logAction(data, req, "Zakazni o'chirdi", `#${order.orderNumber}`);
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

  const now = Date.now();
  const finishedStation = line.stations[order.stationIndex];
  const durationMs = now - (order.stationEnteredAt || order.createdAt || now);
  order.completedStations.push({
    lineId: line.id, lineName: line.name,
    stationId: finishedStation ? finishedStation.id : null,
    stationName: finishedStation ? finishedStation.name : '',
    orderNumber: order.orderNumber,
    durationMs,
    at: now
  });

  const isLastStation = order.stationIndex >= line.stations.length - 1;
  const touchedGroups = new Set([line.group]);
  let announceText = '';
  let destStation = null;
  let destLine = line;

  if (!isLastStation) {
    order.stationIndex += 1;
    destStation = line.stations[order.stationIndex];
    announceText = `${order.orderNumber}: ${finishedStation ? finishedStation.name : ''}dan ${destStation.name}ga o'tdi`;
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
        createdAt: now,
        updatedAt: now,
        stationEnteredAt: now
      };
      data.orders.push(clone);
      const cloneStartStation = line.stations[0];
      if (cloneStartStation) {
        usersForStation(data, cloneStartStation.id).forEach(u => {
          notifyUser(data, u.id, {
            title: 'Yangi material buyurtmasi (XDF)',
            message: `#${clone.orderNumber} — ${line.name} / ${cloneStartStation.name}ga tushdi`,
            orderId: clone.id
          });
        });
      }
    }
    if (line.nextLineId) {
      const nextLine = findLine(data, line.nextLineId);
      if (nextLine) {
        order.lineId = nextLine.id;
        order.stationIndex = 0;
        destLine = nextLine;
        destStation = nextLine.stations[0];
        touchedGroups.add(nextLine.group);
        announceText = `${order.orderNumber} tayyor — ${nextLine.name}ga jo'natildi`;
      } else {
        order.done = true;
        announceText = `${order.orderNumber} yakunlandi`;
      }
    } else {
      order.done = true;
      announceText = `${order.orderNumber} yakunlandi`;
    }
  }

  order.stationEnteredAt = now;
  order.updatedAt = now;

  // Yangi bosqichdagi xodimlarga va zakazga biriktirilgan xodimga bildirishnoma
  const notifiedIds = new Set();
  if (order.assignedUserId) {
    notifyUser(data, order.assignedUserId, {
      title: 'Sizning zakazingiz siljidi',
      message: announceText,
      orderId: order.id
    });
    notifiedIds.add(order.assignedUserId);
  }
  if (destStation && !order.done) {
    usersForStation(data, destStation.id).forEach(u => {
      if (notifiedIds.has(u.id)) return;
      notifyUser(data, u.id, {
        title: 'Sizga yangi zakaz keldi',
        message: `#${order.orderNumber} — ${destLine.name} / ${destStation.name}ga tushdi`,
        orderId: order.id
      });
      notifiedIds.add(u.id);
    });
  }

  save(data);
  broadcastState();
  io.emit('announcement', { text: announceText, groups: [...touchedGroups] });
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
  if (status === 'hal_qilindi') logAction(data, req, 'Shikoyatni hal qildi', complaint.text.slice(0, 60));
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

// ---------- Notifications (shaxsiy bildirishnomalar) ----------
app.get('/api/notifications', requireAuth, (req, res) => {
  const data = load();
  const mine = data.notifications
    .filter(n => n.userId === req.session.userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  res.json({ notifications: mine, unread: mine.filter(n => !n.read).length });
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  const data = load();
  const n = data.notifications.find(x => x.id === req.params.id && x.userId === req.session.userId);
  if (!n) return res.status(404).json({ error: 'Topilmadi' });
  n.read = true;
  save(data);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  const data = load();
  data.notifications.forEach(n => { if (n.userId === req.session.userId) n.read = true; });
  save(data);
  res.json({ ok: true });
});

// ---------- Report (Hisobot) ----------
app.get('/api/report', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const allOrders = [...data.orders, ...data.archivedOrders];

  // Stansiya bo'yicha o'rtacha vaqt va son
  const stationStats = {}; // stationId -> { name, lineName, totalMs, count }
  allOrders.forEach(o => {
    (o.completedStations || []).forEach(cs => {
      if (!cs.stationId || typeof cs.durationMs !== 'number') return;
      if (!stationStats[cs.stationId]) {
        stationStats[cs.stationId] = { stationId: cs.stationId, stationName: cs.stationName, lineName: cs.lineName, totalMs: 0, count: 0 };
      }
      stationStats[cs.stationId].totalMs += cs.durationMs;
      stationStats[cs.stationId].count += 1;
    });
  });
  const stationReport = Object.values(stationStats).map(s => ({
    stationName: s.stationName,
    lineName: s.lineName,
    count: s.count,
    avgMinutes: Math.round((s.totalMs / s.count) / 60000)
  })).sort((a, b) => b.count - a.count);

  // Oxirgi 14 kunlik yakunlangan zakazlar soni (kun bo'yicha)
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = today.getTime() - i * dayMs;
    const dayEnd = dayStart + dayMs;
    const count = allOrders.filter(o => o.done && o.updatedAt >= dayStart && o.updatedAt < dayEnd).length;
    days.push({ date: new Date(dayStart).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' }), count });
  }

  res.json({
    totalCompleted: allOrders.filter(o => o.done).length,
    totalActive: data.orders.filter(o => !o.done).length,
    totalArchived: data.archivedOrders.length,
    stationReport,
    dailyCounts: days
  });
});

// ---------- Customers (Mijozlar) ----------
app.get('/api/customers', requireAuth, (req, res) => {
  const data = load();
  res.json({ customers: [...data.customers].sort((a, b) => b.createdAt - a.createdAt) });
});

app.post('/api/customers', requireAuth, (req, res) => {
  const { name, phone, note } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Mijoz ismi kerak' });
  const data = load();
  const customer = {
    id: nanoid(8),
    name: name.trim(),
    phone: (phone || '').trim(),
    note: (note || '').trim(),
    createdAt: Date.now()
  };
  data.customers.push(customer);
  logAction(data, req, 'Yangi mijoz qo\'shdi', customer.name);
  save(data);
  broadcastState();
  res.json({ customer });
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
  const data = load();
  const c = data.customers.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Topilmadi' });
  const { name, phone, note } = req.body;
  if (name !== undefined) c.name = name;
  if (phone !== undefined) c.phone = phone;
  if (note !== undefined) c.note = note;
  save(data);
  broadcastState();
  res.json({ customer: c });
});

app.delete('/api/customers/:id', requireAuth, (req, res) => {
  const data = load();
  data.customers = data.customers.filter(c => c.id !== req.params.id);
  data.orders.forEach(o => { if (o.customerId === req.params.id) o.customerId = null; });
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// ---------- Order Templates (Buyurtma shablonlari) ----------
app.get('/api/templates', requireAuth, (req, res) => {
  const data = load();
  res.json({ templates: [...data.templates].sort((a, b) => b.createdAt - a.createdAt) });
});

app.post('/api/templates', requireAuth, (req, res) => {
  const { name, note, lineId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Shablon nomi kerak' });
  const data = load();
  const template = {
    id: nanoid(8),
    name: name.trim(),
    note: (note || '').trim(),
    lineId: lineId || null,
    createdAt: Date.now()
  };
  data.templates.push(template);
  save(data);
  broadcastState();
  res.json({ template });
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  const data = load();
  data.templates = data.templates.filter(t => t.id !== req.params.id);
  save(data);
  broadcastState();
  res.json({ ok: true });
});

// ---------- Audit log (Amallar jurnali) ----------
app.get('/api/audit', requireAuth, requireAdmin, (req, res) => {
  const data = load();
  const log = [...data.auditLog].sort((a, b) => b.createdAt - a.createdAt).slice(0, 300);
  res.json({ log });
});

// ---------- Backups (Zaxira nusxa) ----------
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const MAX_BACKUPS = 30;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createBackup() {
  try {
    ensureBackupDir();
    const src = path.join(__dirname, 'data', 'db.json');
    if (!fs.existsSync(src)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    fs.copyFileSync(src, dest);
    // Eskilarini tozalash — faqat oxirgi MAX_BACKUPS tasi qoladi
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
    return dest;
  } catch (e) {
    console.error('Backup xatosi:', e.message);
    return null;
  }
}

app.get('/api/backups', requireAuth, requireAdmin, (req, res) => {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ backups: files });
});

app.post('/api/backups/create', requireAuth, requireAdmin, (req, res) => {
  const dest = createBackup();
  if (!dest) return res.status(500).json({ error: 'Zaxira nusxa yaratib bo\'lmadi' });
  res.json({ ok: true, file: path.basename(dest) });
});

app.get('/api/backups/:name/download', requireAuth, requireAdmin, (req, res) => {
  const filePath = path.join(BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Topilmadi' });
  res.download(filePath);
});

// Har 30 daqiqada avtomatik zaxira nusxa
setInterval(createBackup, 30 * 60 * 1000);

// ---------- Excel eksport ----------
app.get('/api/export/orders.xlsx', requireAuth, requireAdmin, async (req, res) => {
  const data = load();
  const allOrders = [...data.orders, ...data.archivedOrders];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Zakazlar');
  sheet.columns = [
    { header: 'Zakaz raqami', key: 'orderNumber', width: 20 },
    { header: 'Liniya', key: 'lineName', width: 16 },
    { header: 'Mijoz', key: 'customerName', width: 20 },
    { header: 'Vaqt', key: 'time', width: 10 },
    { header: 'Izoh', key: 'note', width: 30 },
    { header: 'Shoshilinch', key: 'urgent', width: 12 },
    { header: 'Holati', key: 'status', width: 14 },
    { header: 'Yaratilgan', key: 'createdAt', width: 20 },
    { header: 'Yangilangan', key: 'updatedAt', width: 20 }
  ];
  sheet.getRow(1).font = { bold: true };
  allOrders.forEach(o => {
    const line = findLine(data, o.lineId);
    const customer = data.customers.find(c => c.id === o.customerId);
    sheet.addRow({
      orderNumber: o.orderNumber,
      lineName: line ? line.name : '',
      customerName: customer ? customer.name : '',
      time: o.time || '',
      note: o.note || '',
      urgent: o.urgent ? 'Ha' : '',
      status: o.done ? 'Yakunlangan' : 'Faol',
      createdAt: new Date(o.createdAt).toLocaleString('uz-UZ'),
      updatedAt: new Date(o.updatedAt).toLocaleString('uz-UZ')
    });
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=zakazlar.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/export/report.xlsx', requireAuth, requireAdmin, async (req, res) => {
  const data = load();
  const allOrders = [...data.orders, ...data.archivedOrders];
  const workbook = new ExcelJS.Workbook();

  const stationStats = {};
  allOrders.forEach(o => {
    (o.completedStations || []).forEach(cs => {
      if (!cs.stationId || typeof cs.durationMs !== 'number') return;
      if (!stationStats[cs.stationId]) {
        stationStats[cs.stationId] = { stationName: cs.stationName, lineName: cs.lineName, totalMs: 0, count: 0 };
      }
      stationStats[cs.stationId].totalMs += cs.durationMs;
      stationStats[cs.stationId].count += 1;
    });
  });

  const sheet1 = workbook.addWorksheet('Stansiyalar');
  sheet1.columns = [
    { header: 'Liniya', key: 'lineName', width: 16 },
    { header: 'Stansiya', key: 'stationName', width: 16 },
    { header: 'Necha marta', key: 'count', width: 14 },
    { header: "O'rtacha vaqt (daqiqa)", key: 'avgMinutes', width: 20 }
  ];
  sheet1.getRow(1).font = { bold: true };
  Object.values(stationStats).forEach(s => {
    sheet1.addRow({
      lineName: s.lineName,
      stationName: s.stationName,
      count: s.count,
      avgMinutes: Math.round((s.totalMs / s.count) / 60000)
    });
  });

  const sheet2 = workbook.addWorksheet('Umumiy');
  sheet2.columns = [{ header: 'Ko\'rsatkich', key: 'k', width: 30 }, { header: 'Qiymat', key: 'v', width: 20 }];
  sheet2.getRow(1).font = { bold: true };
  sheet2.addRow({ k: 'Jami yakunlangan zakazlar', v: allOrders.filter(o => o.done).length });
  sheet2.addRow({ k: 'Hozir faol zakazlar', v: data.orders.filter(o => !o.done).length });
  sheet2.addRow({ k: 'Arxivlangan zakazlar', v: data.archivedOrders.length });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=hisobot.xlsx');
  await workbook.xlsx.write(res);
  res.end();
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
  const sessUserId = socket.request.session && socket.request.session.userId;
  if (sessUserId) {
    socket.join('user:' + sessUserId);
  }
});

server.listen(PORT, () => {
  console.log(`Zakaz Tracker ishga tushdi: http://localhost:${PORT}`);
  console.log(`TV ekran: http://localhost:${PORT}/tv`);
  console.log(`Admin/Xodim kirish: http://localhost:${PORT}/login  (login: admin, parol: admin123)`);
  load(); // db.json hali bo'lmasa yaratib qo'yadi
  createBackup(); // Ishga tushganda darhol bitta zaxira nusxa olamiz
});
