import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const propsPath = path.join(__dirname, 'server.properties.json');
const props = fs.existsSync(propsPath) ? JSON.parse(fs.readFileSync(propsPath, 'utf8')) : {};

const PORT = Number(process.env.PORT || 3000);
const SERVER_NAME = process.env.SERVER_NAME || props.serverName || 'My Blocks Server';
const MOTD = process.env.MOTD || props.motd || 'Welcome to Blocks!';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || props.maxPlayers || 24);
const STARTING_BALANCE = Math.max(0, Math.min(100000, Number(process.env.BLOCKS_STARTING_BALANCE ?? props.startingBalance ?? 1000)));
const OWNER_KEY = String(process.env.BLOCKS_OWNER_KEY || props.ownerKey || '').trim();
const CATALOG_META = [{"id":"crown","name":"Golden Crown","price":250,"slot":"head"},{"id":"tophat","name":"Top Hat","price":150,"slot":"head"},{"id":"ears","name":"Cat Ears","price":100,"slot":"head"},{"id":"halo","name":"Angel Halo","price":300,"slot":"head"},{"id":"wizard","name":"Wizard Hat","price":200,"slot":"head"},{"id":"phones","name":"Headphones","price":180,"slot":"head"},{"id":"pack","name":"Backpack","price":120,"slot":"back"},{"id":"wings","name":"Angel Wings","price":500,"slot":"back"}];
const PART_KEYS = ["head","torso","leftArm","rightArm","leftLeg","rightLeg"];

const GAMES_DIR = path.resolve(__dirname, 'games');
const SUBMISSIONS_PATH = path.join(__dirname, 'game-submissions.json');
const accountsPath = path.join(__dirname, 'server-accounts.json');

if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
}

function safeGameFilePath(worldId) {
  const cleanId = String(worldId || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  if (!cleanId) return null;
  const resolved = path.resolve(GAMES_DIR, cleanId + '.json');
  if (!resolved.startsWith(GAMES_DIR + path.sep)) return null;
  return resolved;
}

function sanitizeWorld(raw, existingIds) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').replace(/[\r\n<>]/g, '').trim().slice(0, 36);
  if (name.length < 2) return null;
  let id = (String(raw.id || name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)) || 'custom-game';
  if (existingIds) {
    const base = id;
    let n = 2;
    while (existingIds.has(id)) id = base + '-' + n++;
  }
  const hex = (v, fb) => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : fb;
  const clp = (v, mn, mx, fb) => Number.isFinite(Number(v)) ? Math.max(mn, Math.min(mx, Number(v))) : fb;
  const boxes = (Array.isArray(raw.boxes) ? raw.boxes.slice(0, 300) : []).map((b) => ({
    x: clp(b.x, -145, 145, 0),
    y: clp(b.y, -20, 120, 0),
    z: clp(b.z, -145, 145, 0),
    w: clp(b.w, 0.5, 120, 3),
    h: clp(b.h, 0.2, 80, 3),
    d: clp(b.d, 0.5, 120, 3),
    color: hex(b.color, '#4c7dff'),
  }));
  const sp = Array.isArray(raw.spawn) ? raw.spawn : [0, 1, 0];
  const author = typeof raw.author === 'string'
    ? raw.author.replace(/[\r\n<>]/g, '').trim().slice(0, 24)
    : undefined;
  return {
    id,
    name,
    description: String(raw.description || 'Custom game').replace(/[\r\n<>]/g, '').trim().slice(0, 120) || 'Custom game',
    mode: raw.mode === 'obby' || raw.mode === 'tag' ? raw.mode : 'sandbox',
    skyColor: hex(raw.skyColor, '#87b9e8'),
    fogColor: hex(raw.fogColor, hex(raw.skyColor, '#87b9e8')),
    accentColor: hex(raw.accentColor, '#4c7dff'),
    spawn: [clp(sp[0], -140, 140, 0), clp(sp[1], 0.5, 100, 1), clp(sp[2], -140, 140, 0)],
    ...(Array.isArray(raw.goal) && raw.goal.length === 3 ? { goal: [clp(raw.goal[0], -140, 140, 0), clp(raw.goal[1], 0, 120, 10), clp(raw.goal[2], -140, 140, -30)] } : {}),
    hasBaseplate: raw.hasBaseplate !== false,
    boxes,
    ...(author ? { author } : {}),
    projectFile: id + '.json',
  };
}

function saveWorldFile(world) {
  const targetPath = safeGameFilePath(world.id);
  if (!targetPath) return;
  try {
    fs.writeFileSync(targetPath, JSON.stringify({ ...world, projectFile: world.id + '.json' }, null, 2), 'utf8');
  } catch {}
}

function deleteWorldFile(worldId) {
  const targetPath = safeGameFilePath(worldId);
  if (!targetPath) return;
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  } catch {}
}

function loadWorldsFromFolder() {
  const list = [];
  const ids = new Set();
  const files = fs.readdirSync(GAMES_DIR).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  for (const file of files) {
    const resolved = path.resolve(GAMES_DIR, file);
    if (!resolved.startsWith(GAMES_DIR + path.sep)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      const clean = sanitizeWorld(raw, ids);
      if (clean) {
        clean.projectFile = file;
        ids.add(clean.id);
        list.push(clean);
      }
    } catch {}
  }
  if (list.length === 0 && Array.isArray(props.worlds)) {
    for (const w of props.worlds) {
      const clean = sanitizeWorld(w, ids);
      if (clean) {
        ids.add(clean.id);
        list.push(clean);
        saveWorldFile(clean);
      }
    }
  }
  list.sort((a, b) => (a.id === 'baseplate' ? -1 : b.id === 'baseplate' ? 1 : 0));
  return list;
}

const WORLDS = loadWorldsFromFolder();
let pendingSubmissions = [];
if (fs.existsSync(SUBMISSIONS_PATH)) {
  try {
    const rawSubs = JSON.parse(fs.readFileSync(SUBMISSIONS_PATH, 'utf8'));
    if (Array.isArray(rawSubs)) {
      pendingSubmissions = rawSubs.filter((s) => s && typeof s.id === 'string' && typeof s.submittedBy === 'string' && s.world);
    }
  } catch {}
}

function saveSubmissions() {
  try {
    fs.writeFileSync(SUBMISSIONS_PATH, JSON.stringify(pendingSubmissions, null, 2), 'utf8');
  } catch {}
}

function verifyOwnerKey(candidate) {
  if (!OWNER_KEY || typeof candidate !== 'string' || !candidate.trim()) return false;
  const a = crypto.createHash('sha256').update(candidate.trim()).digest();
  const b = crypto.createHash('sha256').update(OWNER_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

const accounts = new Map();

function sanitizeTransform(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const clp = (v, min, max, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n * 100) / 100)) : fb;
  };
  const x = clp(raw.x, -0.8, 0.8, 0);
  const y = clp(raw.y, -0.8, 0.8, 0);
  const z = clp(raw.z, -0.8, 0.8, 0);
  const scale = clp(raw.scale, 0.5, 1.8, 1);
  const rotX = clp(raw.rotX, -180, 180, 0);
  const rotY = clp(raw.rotY, -180, 180, 0);
  const rotZ = clp(raw.rotZ, -180, 180, 0);
  if (x === 0 && y === 0 && z === 0 && scale === 1 && rotX === 0 && rotY === 0 && rotZ === 0) return undefined;
  return { x, y, z, scale, rotX, rotY, rotZ };
}

function sanitizeAvatar(raw, ownedItems) {
  const obj = typeof raw === 'object' && raw !== null ? raw : {};
  const c = String(obj.bodyColor || '#9fa1d6');
  const bodyColor = /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#9fa1d6';
  let partColors;
  if (obj.partColors && typeof obj.partColors === 'object') {
    const cleanParts = {};
    let hasPart = false;
    for (const pk of PART_KEYS) {
      const pc = obj.partColors[pk];
      if (typeof pc === 'string' && /^#[0-9a-fA-F]{6}$/.test(pc)) {
        cleanParts[pk] = pc;
        hasPart = true;
      }
    }
    if (hasPart) partColors = cleanParts;
  }
  const owned = ownedItems ? new Set(ownedItems) : null;
  const rawHead = typeof obj.headItem === 'string' ? obj.headItem.slice(0, 24) : null;
  const rawBack = typeof obj.backItem === 'string' ? obj.backItem.slice(0, 24) : null;
  const headItem = rawHead && CATALOG_META.some((i) => i.id === rawHead && i.slot === 'head') && (!owned || owned.has(rawHead)) ? rawHead : null;
  const backItem = rawBack && CATALOG_META.some((i) => i.id === rawBack && i.slot === 'back') && (!owned || owned.has(rawBack)) ? rawBack : null;
  const headTransform = sanitizeTransform(obj.headTransform);
  const backTransform = sanitizeTransform(obj.backTransform);
  return {
    bodyColor,
    ...(partColors ? { partColors } : {}),
    headItem,
    backItem,
    ...(headTransform ? { headTransform } : {}),
    ...(backTransform ? { backTransform } : {}),
  };
}

function loadAccounts() {
  if (!fs.existsSync(accountsPath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && typeof v.username === 'string' && typeof v.passwordHash === 'string') {
        accounts.set(k.toLowerCase(), {
          username: v.username,
          passwordHash: v.passwordHash,
          robux: Number.isFinite(Number(v.robux)) ? Number(v.robux) : STARTING_BALANCE,
          ownedItems: Array.isArray(v.ownedItems) ? v.ownedItems.map(String) : [],
          avatar: sanitizeAvatar(v.avatar),
          createdAt: Number(v.createdAt) || Date.now(),
          sessionHashes: Array.isArray(v.sessionHashes) ? v.sessionHashes.map(String).slice(-5) : [],
        });
      }
    }
  } catch {}
}

function saveAccounts() {
  try {
    const obj = {};
    for (const [k, v] of accounts.entries()) obj[k] = v;
    fs.writeFileSync(accountsPath, JSON.stringify(obj, null, 2), 'utf8');
  } catch {}
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  try {
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublicAccount(acc) {
  return {
    username: acc.username,
    robux: acc.robux,
    ownedItems: [...acc.ownedItems],
    avatar: {
      ...acc.avatar,
      ...(acc.avatar.partColors ? { partColors: { ...acc.avatar.partColors } } : {}),
      ...(acc.avatar.headTransform ? { headTransform: { ...acc.avatar.headTransform } } : {}),
      ...(acc.avatar.backTransform ? { backTransform: { ...acc.avatar.backTransform } } : {}),
    },
    createdAt: acc.createdAt,
  };
}

function cleanAccountUsername(raw) {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return clean.length >= 2 ? clean : null;
}

loadAccounts();

const app = express();
app.use(express.json());

app.use('/api/server-info', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const clients = new Map();
const tagHolders = new Map();
const chatHistory = [];

for (const w of WORLDS) {
  if (w.mode === 'tag') tagHolders.set(w.id, null);
}

function getWorldPlayers(worldId) {
  const list = [];
  for (const c of clients.values()) {
    if (c.player.worldId === worldId) list.push(c.player);
  }
  return list;
}

function getServerInfo() {
  return {
    serverName: SERVER_NAME,
    motd: MOTD,
    version: props.version || '1.1.0',
    onlinePlayers: clients.size,
    maxPlayers: MAX_PLAYERS,
    startingBalance: STARTING_BALANCE,
    ownerAuthEnabled: Boolean(OWNER_KEY),
    pendingSubmissionsCount: pendingSubmissions.length,
    worlds: WORLDS.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      mode: w.mode,
      accentColor: w.accentColor,
      playerCount: getWorldPlayers(w.id).length,
      ...(w.author ? { author: w.author } : {}),
      ...(w.projectFile ? { projectFile: w.projectFile } : {}),
    })),
  };
}

function sendTo(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastAll(payload, excludeId = null) {
  const raw = JSON.stringify(payload);
  for (const [id, c] of clients.entries()) {
    if (id !== excludeId && c.ws.readyState === 1) c.ws.send(raw);
  }
}

function broadcastOwners(payload) {
  const raw = JSON.stringify(payload);
  for (const c of clients.values()) {
    if (c.isOwner && c.ws.readyState === 1) c.ws.send(raw);
  }
}

function broadcastWorld(worldId, payload, excludeId = null) {
  const raw = JSON.stringify(payload);
  for (const [id, c] of clients.entries()) {
    if (id !== excludeId && c.player.worldId === worldId && c.ws.readyState === 1) {
      c.ws.send(raw);
    }
  }
}

function pushChat(sender, text, system = false, worldId = undefined) {
  const msg = {
    id: Math.random().toString(36).slice(2, 10),
    sender,
    text: String(text).slice(0, 200),
    system,
    worldId,
    timestamp: Date.now(),
  };
  chatHistory.push(msg);
  if (chatHistory.length > 60) chatHistory.shift();
  broadcastAll({ type: 'chat:message', message: msg });
}

function assignTagIfNeeded(worldId) {
  const w = WORLDS.find((x) => x.id === worldId);
  if (!w || w.mode !== 'tag') return;
  const current = tagHolders.get(worldId);
  const inWorld = getWorldPlayers(worldId);
  if (inWorld.length === 0) {
    tagHolders.set(worldId, null);
    return;
  }
  if (!current || !inWorld.some((p) => p.id === current)) {
    const next = inWorld[0];
    tagHolders.set(worldId, next.id);
    broadcastWorld(worldId, { type: 'tag:update', tagHolderId: next.id });
    pushChat('Server', next.username + ' is IT!', true, worldId);
  }
}

app.get('/api/server-info', (_req, res) => {
  res.json(getServerInfo());
});

app.get('/', (_req, res) => {
  const info = getServerInfo();
  const safeName = info.serverName.replace(/[<>&]/g, '');
  const safeMotd = info.motd.replace(/[<>&]/g, '');
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${safeName}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0e17;color:#eef2fb;display:grid;place-items:center;min-height:100vh;margin:0}
.box{max-width:460px;padding:28px;border-radius:16px;background:#131826;border:1px solid #26304a}
code{background:#1b2236;padding:3px 7px;border-radius:6px}</style></head>
<body><div class="box">
<h1>${safeName}</h1>
<p>${safeMotd}</p>
<p>Players online: <b>${info.onlinePlayers} / ${info.maxPlayers}</b></p>
<p>Games hosted: <b>${info.worlds.map((w) => w.name).join(', ')}</b></p>
<p>Paste this page's URL into <b>Blocks Multiplayer &rarr; Server Address</b> to join!</p>
</div></body></html>`);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/ws' || url.pathname === '/') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  if (clients.size >= MAX_PLAYERS) {
    sendTo(ws, { type: 'error', message: 'Server is full (' + MAX_PLAYERS + ' max players).' });
    ws.close();
    return;
  }

  let clientId = null;
  let socketFailedAuth = 0;

  sendTo(ws, { type: 'auth:required', serverInfo: getServerInfo() });

  function completeLogin(accKey, acc, sessionToken, requestedWorldId) {
    for (const [oldId, existing] of clients.entries()) {
      if (existing.accountKey === accKey) {
        clients.delete(oldId);
        broadcastWorld(existing.player.worldId, { type: 'player:left', id: oldId });
        sendTo(existing.ws, { type: 'error', message: 'Signed in from another session.' });
        existing.ws.close();
      }
    }

    clientId = Math.random().toString(36).slice(2, 10);
    const defaultWorld = WORLDS[0]?.id || 'baseplate';
    const world = WORLDS.find((w) => w.id === requestedWorldId) || WORLDS[0];
    const worldId = world ? world.id : defaultWorld;
    const spawn = world?.spawn || [0, 0.7, 0];

    const player = {
      id: clientId,
      username: acc.username,
      worldId,
      x: spawn[0],
      y: spawn[1],
      z: spawn[2],
      ry: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      ground: true,
      moving: false,
      avatar: {
        ...acc.avatar,
        ...(acc.avatar.partColors ? { partColors: { ...acc.avatar.partColors } } : {}),
        ...(acc.avatar.headTransform ? { headTransform: { ...acc.avatar.headTransform } } : {}),
        ...(acc.avatar.backTransform ? { backTransform: { ...acc.avatar.backTransform } } : {}),
      },
    };

    clients.set(clientId, { ws, accountKey: accKey, player, isOwner: false, failedAuth: 0, lastObbyRewardAt: 0 });

    sendTo(ws, {
      type: 'welcome',
      playerId: clientId,
      username: player.username,
      sessionToken,
      account: toPublicAccount(acc),
      serverInfo: getServerInfo(),
      worlds: WORLDS,
      worldState: {
        worldId,
        players: getWorldPlayers(worldId),
        tagHolderId: tagHolders.get(worldId) || null,
      },
      chatHistory,
    });

    broadcastWorld(worldId, { type: 'player:joined', player }, clientId);
    broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
    pushChat('Server', player.username + ' joined the server.', true);
    assignTagIfNeeded(worldId);
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!clientId) {
      if (msg.type === 'auth:signup') {
        const cleanName = cleanAccountUsername(msg.username);
        const password = typeof msg.password === 'string' ? msg.password : '';
        if (!cleanName) return sendTo(ws, { type: 'auth:error', message: 'Username must be 2-18 letters, numbers, spaces, _ or -.' });
        if (password.length < 4 || password.length > 100) return sendTo(ws, { type: 'auth:error', message: 'Password must be at least 4 characters.' });
        const accKey = cleanName.toLowerCase();
        if (accounts.has(accKey)) return sendTo(ws, { type: 'auth:error', message: 'Username already exists on this server. Log in instead!' });
        const sessionToken = crypto.randomBytes(24).toString('hex');
        const acc = {
          username: cleanName,
          passwordHash: hashPassword(password),
          robux: STARTING_BALANCE,
          ownedItems: [],
          avatar: { bodyColor: '#9fa1d6', headItem: null, backItem: null },
          createdAt: Date.now(),
          sessionHashes: [hashToken(sessionToken)],
        };
        accounts.set(accKey, acc);
        saveAccounts();
        completeLogin(accKey, acc, sessionToken, msg.worldId);
        return;
      }
      if (msg.type === 'auth:login') {
        if (socketFailedAuth >= 8) return sendTo(ws, { type: 'auth:error', message: 'Too many failed login attempts.' });
        const cleanName = cleanAccountUsername(msg.username);
        const password = typeof msg.password === 'string' ? msg.password : '';
        const accKey = cleanName ? cleanName.toLowerCase() : '';
        const acc = accKey ? accounts.get(accKey) : undefined;
        if (!acc || !verifyPassword(password, acc.passwordHash)) {
          socketFailedAuth++;
          return sendTo(ws, { type: 'auth:error', message: 'Invalid username or password for this server.' });
        }
        socketFailedAuth = 0;
        const sessionToken = crypto.randomBytes(24).toString('hex');
        acc.sessionHashes = [...acc.sessionHashes.slice(-3), hashToken(sessionToken)];
        saveAccounts();
        completeLogin(accKey, acc, sessionToken, msg.worldId);
        return;
      }
      if (msg.type === 'auth:session') {
        const token = typeof msg.token === 'string' ? msg.token : '';
        if (!token) return sendTo(ws, { type: 'auth:error', message: 'Please sign in or sign up.', clearToken: true });
        const th = hashToken(token);
        for (const [accKey, acc] of accounts.entries()) {
          if (acc.sessionHashes.includes(th)) {
            completeLogin(accKey, acc, token, msg.worldId);
            return;
          }
        }
        sendTo(ws, { type: 'auth:error', message: 'Session expired or not found on this server.', clearToken: true });
        return;
      }
      return;
    }

    if (!clients.has(clientId)) return;
    const client = clients.get(clientId);
    const player = client.player;
    const account = accounts.get(client.accountKey);
    if (!account) return;

    if (msg.type === 'auth:logout') {
      const oldId = clientId;
      clientId = null;
      clients.delete(oldId);
      if (typeof msg.token === 'string' && msg.token) {
        const th = hashToken(msg.token);
        account.sessionHashes = account.sessionHashes.filter((h) => h !== th);
        saveAccounts();
      }
      broadcastWorld(player.worldId, { type: 'player:left', id: oldId });
      broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
      pushChat('Server', player.username + ' logged out.', true);
      assignTagIfNeeded(player.worldId);
      sendTo(ws, { type: 'auth:required', serverInfo: getServerInfo(), clearToken: true });
      return;
    }

    if (msg.type === 'player:move') {
      player.x = Number(msg.x) || 0;
      player.y = Number(msg.y) || 0;
      player.z = Number(msg.z) || 0;
      player.ry = Number(msg.ry) || 0;
      player.vx = Number(msg.vx) || 0;
      player.vy = Number(msg.vy) || 0;
      player.vz = Number(msg.vz) || 0;
      player.ground = Boolean(msg.ground);
      player.moving = Boolean(msg.moving);
      broadcastWorld(player.worldId, { type: 'player:moved', player }, clientId);
    } else if (msg.type === 'player:avatar') {
      const nextAvatar = sanitizeAvatar(msg.avatar, account.ownedItems);
      account.avatar = nextAvatar;
      player.avatar = nextAvatar;
      saveAccounts();
      sendTo(ws, { type: 'account:update', account: toPublicAccount(account) });
      broadcastWorld(
        player.worldId,
        { type: 'player:avatar', id: clientId, avatar: player.avatar },
        clientId
      );
    } else if (msg.type === 'shop:buy') {
      const item = CATALOG_META.find((i) => i.id === String(msg.itemId || ''));
      if (!item) return sendTo(ws, { type: 'error', message: 'Item not found.' });
      if (account.ownedItems.includes(item.id)) return sendTo(ws, { type: 'error', message: 'Already owned.' });
      if (account.robux < item.price) return sendTo(ws, { type: 'error', message: 'Not enough R$.' });
      account.robux -= item.price;
      account.ownedItems.push(item.id);
      if (item.slot === 'head') account.avatar.headItem = item.id;
      else account.avatar.backItem = item.id;
      player.avatar = { ...account.avatar };
      saveAccounts();
      sendTo(ws, { type: 'account:update', account: toPublicAccount(account), notice: 'Purchased ' + item.name + ' for ' + item.price + ' R$!' });
      broadcastWorld(player.worldId, { type: 'player:avatar', id: clientId, avatar: player.avatar }, clientId);
    } else if (msg.type === 'obby:finish') {
      const w = WORLDS.find((x) => x.id === player.worldId);
      if (!w || w.mode !== 'obby') return;
      const now = Date.now();
      if (now - client.lastObbyRewardAt < 45000) return;
      client.lastObbyRewardAt = now;
      account.robux += 50;
      saveAccounts();
      sendTo(ws, { type: 'account:update', account: toPublicAccount(account), notice: '+50 R$ reward for finishing ' + w.name + '!' });
    } else if (msg.type === 'world:switch') {
      const target = WORLDS.find((w) => w.id === msg.worldId);
      if (!target) return;
      const oldWorldId = player.worldId;
      if (oldWorldId === target.id) return;

      broadcastWorld(oldWorldId, { type: 'player:left', id: clientId }, clientId);
      player.worldId = target.id;
      player.x = target.spawn[0];
      player.y = target.spawn[1];
      player.z = target.spawn[2];
      player.vx = player.vy = player.vz = 0;

      assignTagIfNeeded(oldWorldId);
      assignTagIfNeeded(target.id);

      sendTo(ws, {
        type: 'world:state',
        worldState: {
          worldId: target.id,
          players: getWorldPlayers(target.id),
          tagHolderId: tagHolders.get(target.id) || null,
        },
      });
      broadcastWorld(target.id, { type: 'player:joined', player }, clientId);
      broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
      pushChat('Server', player.username + ' entered ' + target.name + '.', true);
    } else if (msg.type === 'world:submit') {
      if (pendingSubmissions.length >= 25) {
        sendTo(ws, { type: 'error', message: 'Submission queue is full. Wait for the owner to review.' });
        return;
      }
      const userCount = pendingSubmissions.filter((s) => s.submittedBy === account.username).length;
      if (userCount >= 3) {
        sendTo(ws, { type: 'error', message: 'You already have 3 games waiting for owner review.' });
        return;
      }
      const cleanWorld = sanitizeWorld(msg.world, new Set(WORLDS.map((w) => w.id)));
      if (!cleanWorld) {
        sendTo(ws, { type: 'error', message: 'Invalid game project.' });
        return;
      }
      cleanWorld.author = account.username;
      const submission = {
        id: crypto.randomBytes(6).toString('hex'),
        submittedBy: account.username,
        submittedAt: Date.now(),
        world: cleanWorld,
      };
      pendingSubmissions.push(submission);
      saveSubmissions();
      sendTo(ws, { type: 'submission:sent', submission });
      broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
      broadcastOwners({ type: 'submission:added', submission, submissions: pendingSubmissions });
      pushChat('Server', account.username + ' submitted "' + cleanWorld.name + '" for owner review!', true);
    } else if (msg.type === 'owner:auth') {
      if (!OWNER_KEY) {
        sendTo(ws, { type: 'owner:status', isOwner: false, error: 'Live owner login is disabled. Edit server.properties.json or set BLOCKS_OWNER_KEY.' });
        return;
      }
      if (client.failedAuth >= 5) {
        sendTo(ws, { type: 'owner:status', isOwner: false, error: 'Too many failed passkey attempts.' });
        return;
      }
      if (verifyOwnerKey(msg.key)) {
        client.isOwner = true;
        client.failedAuth = 0;
        sendTo(ws, { type: 'owner:status', isOwner: true });
        sendTo(ws, { type: 'owner:submissions', submissions: pendingSubmissions });
      } else {
        client.failedAuth++;
        sendTo(ws, { type: 'owner:status', isOwner: false, error: 'Incorrect owner passkey.' });
      }
    } else if (msg.type === 'submission:approve') {
      if (!client.isOwner) return sendTo(ws, { type: 'error', message: 'Only the server owner can approve submissions.' });
      const idx = pendingSubmissions.findIndex((s) => s.id === msg.submissionId);
      if (idx === -1) return;
      if (WORLDS.length >= 24) return sendTo(ws, { type: 'error', message: 'Server world limit (24) reached.' });
      const [sub] = pendingSubmissions.splice(idx, 1);
      const cleanWorld = sanitizeWorld(sub.world, new Set(WORLDS.map((w) => w.id)));
      if (!cleanWorld) return;
      cleanWorld.author = sub.submittedBy;
      WORLDS.push(cleanWorld);
      saveWorldFile(cleanWorld);
      saveSubmissions();
      if (cleanWorld.mode === 'tag') tagHolders.set(cleanWorld.id, null);
      broadcastAll({ type: 'world:added', world: cleanWorld, serverInfo: getServerInfo() });
      broadcastOwners({ type: 'owner:submissions', submissions: pendingSubmissions });
      pushChat('Server', 'Owner approved "' + cleanWorld.name + '" by ' + sub.submittedBy + '!', true);
    } else if (msg.type === 'submission:reject') {
      if (!client.isOwner) return sendTo(ws, { type: 'error', message: 'Only the server owner can reject submissions.' });
      const idx = pendingSubmissions.findIndex((s) => s.id === msg.submissionId);
      if (idx === -1) return;
      const [sub] = pendingSubmissions.splice(idx, 1);
      saveSubmissions();
      broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
      broadcastOwners({ type: 'owner:submissions', submissions: pendingSubmissions });
      pushChat('Server', 'Submission "' + sub.world.name + '" by ' + sub.submittedBy + ' was declined.', true);
    } else if (msg.type === 'world:create') {
      if (!client.isOwner) {
        sendTo(ws, { type: 'error', message: 'Only the server owner can publish games directly.' });
        return;
      }
      if (WORLDS.length >= 24) return;
      const newWorld = sanitizeWorld(msg.world, new Set(WORLDS.map((w) => w.id)));
      if (!newWorld) return;
      if (!newWorld.author) newWorld.author = player.username;
      WORLDS.push(newWorld);
      saveWorldFile(newWorld);
      if (newWorld.mode === 'tag') tagHolders.set(newWorld.id, null);
      broadcastAll({ type: 'world:added', world: newWorld, serverInfo: getServerInfo() });
      pushChat('Server', 'Owner ' + player.username + ' published "' + newWorld.name + '"!', true);
    } else if (msg.type === 'world:delete') {
      if (!client.isOwner) {
        sendTo(ws, { type: 'error', message: 'Only the server owner can remove games.' });
        return;
      }
      if (WORLDS.length <= 1) {
        sendTo(ws, { type: 'error', message: 'Server must keep at least 1 game.' });
        return;
      }
      const idx = WORLDS.findIndex((w) => w.id === msg.worldId);
      if (idx === -1) return;
      const [removed] = WORLDS.splice(idx, 1);
      deleteWorldFile(removed.id);
      tagHolders.delete(removed.id);
      const fallback = WORLDS[0];
      for (const c of clients.values()) {
        if (c.player.worldId === removed.id) {
          c.player.worldId = fallback.id;
          c.player.x = fallback.spawn[0];
          c.player.y = fallback.spawn[1];
          c.player.z = fallback.spawn[2];
          sendTo(c.ws, {
            type: 'world:state',
            worldState: {
              worldId: fallback.id,
              players: getWorldPlayers(fallback.id),
              tagHolderId: tagHolders.get(fallback.id) || null,
            },
          });
        }
      }
      broadcastAll({ type: 'world:removed', worldId: removed.id, fallbackWorldId: fallback.id, serverInfo: getServerInfo() });
      pushChat('Server', 'Owner ' + player.username + ' removed game "' + removed.name + '".', true);
    } else if (msg.type === 'tag:bump') {
      const world = WORLDS.find((w) => w.id === player.worldId);
      if (!world || world.mode !== 'tag') return;
      if (tagHolders.get(player.worldId) !== clientId) return;
      const target = clients.get(String(msg.targetId || ''));
      if (!target || target.player.worldId !== player.worldId) return;
      const dist = Math.hypot(
        player.x - target.player.x,
        player.y - target.player.y,
        player.z - target.player.z
      );
      if (dist <= 4.5) {
        tagHolders.set(player.worldId, target.player.id);
        broadcastWorld(player.worldId, { type: 'tag:update', tagHolderId: target.player.id });
        pushChat('Server', target.player.username + ' was tagged by ' + player.username + '!', true, player.worldId);
      }
    } else if (msg.type === 'chat:send') {
      const text = String(msg.text || '').trim().slice(0, 200);
      if (!text) return;

      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        const lc = cmd.toLowerCase();
        if (lc === 'help') {
          sendTo(ws, {
            type: 'chat:message',
            message: {
              id: Math.random().toString(36).slice(2),
              sender: 'Server',
              text: 'Commands: /list, /tp <player>, /spawn, /me <action>, /help',
              system: true,
              timestamp: Date.now(),
            },
          });
        } else if (lc === 'list') {
          const names = [...clients.values()]
            .map((c) => c.player.username + ' (' + c.player.worldId + ')')
            .join(', ');
          sendTo(ws, {
            type: 'chat:message',
            message: {
              id: Math.random().toString(36).slice(2),
              sender: 'Server',
              text: 'Online (' + clients.size + '/' + MAX_PLAYERS + '): ' + names,
              system: true,
              timestamp: Date.now(),
            },
          });
        } else if (lc === 'tp') {
          const query = args.join(' ').trim().toLowerCase();
          const target = [...clients.values()].find(
            (c) => c.player.id !== clientId && c.player.username.toLowerCase().includes(query)
          );
          if (target && target.player.worldId === player.worldId) {
            sendTo(ws, {
              type: 'player:teleport',
              x: target.player.x,
              y: target.player.y + 1,
              z: target.player.z + 2,
            });
          } else {
            sendTo(ws, {
              type: 'chat:message',
              message: {
                id: Math.random().toString(36).slice(2),
                sender: 'Server',
                text: 'Player not found in your current world.',
                system: true,
                timestamp: Date.now(),
              },
            });
          }
        } else if (lc === 'spawn') {
          const w = WORLDS.find((x) => x.id === player.worldId);
          const sp = w?.spawn || [0, 0.7, 0];
          sendTo(ws, { type: 'player:teleport', x: sp[0], y: sp[1], z: sp[2] });
        } else if (lc === 'me') {
          pushChat('Server', '* ' + player.username + ' ' + args.join(' '), true);
        }
        return;
      }

      pushChat(player.username, text, false, player.worldId);
    }
  });

  ws.on('close', () => {
    if (!clientId || !clients.has(clientId)) return;
    const { player } = clients.get(clientId);
    clients.delete(clientId);
    broadcastWorld(player.worldId, { type: 'player:left', id: clientId });
    broadcastAll({ type: 'server:info', serverInfo: getServerInfo() });
    pushChat('Server', player.username + ' left the server.', true);
    assignTagIfNeeded(player.worldId);
  });
});

if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [cmd, ...args] = trimmed.split(' ');
    if (cmd === 'list') {
      console.log('Online:', [...clients.values()].map((c) => c.player.username).join(', ') || '(none)');
    } else if (cmd === 'say') {
      pushChat('Server', args.join(' '), true);
    } else if (cmd === 'kick') {
      const targetName = args.join(' ').toLowerCase();
      for (const c of clients.values()) {
        if (c.player.username.toLowerCase() === targetName) {
          sendTo(c.ws, { type: 'error', message: 'Kicked by server console.' });
          c.ws.close();
        }
      }
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${SERVER_NAME}] Blocks Multiplayer Server listening on port ${PORT} (${WORLDS.length} games in /games)`);
});
