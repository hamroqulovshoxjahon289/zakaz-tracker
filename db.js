const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');

function makeStation(name) {
  return { id: nanoid(8), name };
}

function defaultData() {
  const laboLine = {
    id: nanoid(8),
    name: 'Labo',
    group: 'labo',
    stations: [makeStation('Yuklash')],
    nextLineId: null,
    replenish: false,
    createdAt: Date.now()
  };
  const korpusLine = {
    id: nanoid(8),
    name: 'Korpus',
    group: 'korpus',
    stations: [makeStation('Ara'), makeStation('Kromka'), makeStation('Prisadka'), makeStation('Upakovka')],
    nextLineId: laboLine.id,
    replenish: true,
    createdAt: Date.now()
  };
  const fasadLine = {
    id: nanoid(8),
    name: 'Fasad',
    group: 'fasad',
    stations: [makeStation('Ishlov berish')],
    nextLineId: laboLine.id,
    replenish: false,
    createdAt: Date.now()
  };

  return {
    users: [
      {
        id: nanoid(8),
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin123', 8),
        name: 'Bosh Admin',
        role: 'admin',
        stationAccess: [],
        createdAt: Date.now()
      }
    ],
    lines: [korpusLine, fasadLine, laboLine],
    orders: [],
    complaints: [],
    dayStarted: false,
    dayStartedAt: null
  };
}

function migrate(data) {
  let changed = false;

  if (!data.complaints) { data.complaints = []; changed = true; }

  if (!data.lines) {
    // Eski (labo-asosidagi) formatdan yangi liniya tizimiga o'tish
    const laboLine = {
      id: nanoid(8), name: 'Labo', group: 'labo',
      stations: [makeStation('Yuklash')], nextLineId: null, replenish: false, createdAt: Date.now()
    };
    const korpusLine = {
      id: nanoid(8), name: 'Korpus', group: 'korpus',
      stations: [makeStation('Ara'), makeStation('Kromka'), makeStation('Prisadka'), makeStation('Upakovka')],
      nextLineId: laboLine.id, replenish: true, createdAt: Date.now()
    };
    const fasadLine = {
      id: nanoid(8), name: 'Fasad', group: 'fasad',
      stations: [makeStation('Ishlov berish')], nextLineId: laboLine.id, replenish: false, createdAt: Date.now()
    };
    data.lines = [korpusLine, fasadLine, laboLine];
    (data.orders || []).forEach(o => {
      o.lineId = korpusLine.id;
      o.stationIndex = 0;
      o.done = false;
      delete o.laboId;
      delete o.status;
    });
    data.labos = undefined;
    delete data.labos;
    changed = true;
  }

  data.orders.forEach(o => {
    if (o.assignedUserId === undefined) { o.assignedUserId = null; changed = true; }
    if (o.stationIndex === undefined) { o.stationIndex = 0; changed = true; }
    if (o.done === undefined) { o.done = false; changed = true; }
    if (o.completedStations === undefined) { o.completedStations = []; changed = true; }
    if (o.parentOrderId === undefined) { o.parentOrderId = null; changed = true; }
  });

  data.users.forEach(u => {
    if (u.stationAccess === undefined) { u.stationAccess = []; changed = true; }
  });

  return changed;
}

function load() {
  if (!fs.existsSync(FILE)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(FILE, 'utf-8');
  const data = JSON.parse(raw);
  const changed = migrate(data);
  if (changed) save(data);
  return data;
}

function save(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { load, save, nanoid, bcrypt };
