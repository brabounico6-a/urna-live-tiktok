import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = String(process.env.ADMIN_PIN || '2213');
const DEFAULT_USERNAME = String(process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const EULER_API_KEY = String(process.env.EULER_API_KEY || '').trim();
const TARGET_VOTES = 10000;
const WINNER_SHOW_MS = 7000;

const defaultState = {
  votes: { flavio: 0, lula: 0 }, participants: [], round: 1, winner: null,
  connection: { status: 'offline', username: DEFAULT_USERNAME, roomId: '', message: 'Desconectado' },
  config: {
    leftName: 'Flávio Bolsonaro', rightName: 'Lula', leftCode: '22', rightCode: '13',
    leftGiftAliases: ['White Rose', 'Rosa Branca', 'Rosa branca'], rightGiftAliases: ['Rose', 'Rosa'],
    giftVotesPerItem: 1, exactCommentOnly: true
  },
  lastActivity: null, recentActivity: []
};
const cloneDefault = () => JSON.parse(JSON.stringify(defaultState));
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return cloneDefault();
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      ...cloneDefault(), ...parsed,
      votes: { ...defaultState.votes, ...(parsed.votes || {}) },
      config: { ...defaultState.config, ...(parsed.config || {}) },
      connection: { ...defaultState.connection, ...(parsed.connection || {}), status: 'offline', roomId: '', message: 'Desconectado' },
      winner: null,
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      recentActivity: Array.isArray(parsed.recentActivity) ? parsed.recentActivity.slice(0, 20) : []
    };
  } catch (err) { console.error('Falha ao carregar estado:', err.message); return cloneDefault(); }
}

let state = loadState();
let participantSet = new Set(state.participants);
let connection = null, reconnectTimer = null, resetWinnerTimer = null, manuallyDisconnected = false;
const processedMessageIds = new Map();
let saveTimer = null, stateEmitTimer = null;
const voteBatches = { flavio: { amount: 0, last: null, timer: null }, lula: { amount: 0, last: null, timer: null } };

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const safe = { ...state, participants: [...participantSet], winner: null,
        connection: { ...state.connection, status: 'offline', roomId: '', message: 'Desconectado' } };
      fs.writeFileSync(STATE_FILE, JSON.stringify(safe, null, 2));
    } catch (err) { console.warn('Não foi possível salvar estado:', err.message); }
  }, 450);
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function publicState() {
  return { votes: state.votes, participants: participantSet.size, round: state.round, winner: state.winner,
    targetVotes: TARGET_VOTES, connection: state.connection, config: state.config,
    lastActivity: state.lastActivity, recentActivity: state.recentActivity };
}
function emitStateNow() { clearTimeout(stateEmitTimer); stateEmitTimer = null; io.emit('state', publicState()); }
function scheduleStateEmit() {
  if (stateEmitTimer) return;
  stateEmitTimer = setTimeout(() => { stateEmitTimer = null; io.emit('state', publicState()); }, 85);
}
function auth(req) { return String(req.headers['x-admin-pin'] || req.body?.pin || '') === ADMIN_PIN; }
function userLabel(data = {}) { return data.user?.uniqueId || data.user?.displayId || data.uniqueId || data.user?.nickname || data.nickname || 'usuario'; }
function userKey(data = {}) { return String(data.user?.userId || data.user?.id || data.userId || data.user?.uniqueId || data.user?.displayId || data.uniqueId || userLabel(data)); }
function markParticipant(data) { const key = userKey(data); if (key) participantSet.add(key); }
function rememberMessage(id) {
  if (!id) return false;
  const key = String(id); if (processedMessageIds.has(key)) return true;
  processedMessageIds.set(key, Date.now());
  if (processedMessageIds.size > 3000) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, ts] of processedMessageIds) if (ts < cutoff) processedMessageIds.delete(k);
  }
  return false;
}
function addActivity(activity) {
  state.lastActivity = { ...activity, time: new Date().toISOString() };
  state.recentActivity.unshift(state.lastActivity); state.recentActivity = state.recentActivity.slice(0, 20);
}
function queueVoteBatch(side, amount, activity) {
  const batch = voteBatches[side]; batch.amount += amount; batch.last = activity;
  if (batch.timer) return;
  batch.timer = setTimeout(() => {
    batch.timer = null; if (!batch.amount) return;
    io.emit('vote-batch', { side, amount: batch.amount, totalVotes: state.votes[side], participantCount: participantSet.size,
      user: batch.last?.user || 'usuario', detail: batch.last?.detail || '', type: batch.last?.type || 'vote',
      count: batch.last?.count || 1, time: new Date().toISOString() });
    batch.amount = 0; batch.last = null;
  }, 80);
}
function finishWinner(side) {
  if (state.winner) return;
  const isFlavio = side === 'flavio';
  state.winner = { side, name: isFlavio ? state.config.leftName : state.config.rightName,
    code: isFlavio ? state.config.leftCode : state.config.rightCode, votes: TARGET_VOTES,
    round: state.round, time: new Date().toISOString() };
  scheduleSave(); emitStateNow(); io.emit('winner', state.winner);
  clearTimeout(resetWinnerTimer);
  resetWinnerTimer = setTimeout(() => {
    state.votes = { flavio: 0, lula: 0 }; participantSet = new Set(); state.participants = [];
    state.round += 1; state.winner = null; state.lastActivity = null; state.recentActivity = [];
    scheduleSave(); emitStateNow();
  }, WINNER_SHOW_MS);
}
function addVotes(side, amount, activity) {
  if (state.winner) return;
  const n = Math.max(0, Math.floor(Number(amount) || 0)); if (!n) return;
  const before = state.votes[side]; state.votes[side] = Math.min(TARGET_VOTES, before + n);
  const credited = state.votes[side] - before; if (!credited) return;
  addActivity({ side, amount: credited, ...activity }); queueVoteBatch(side, credited, state.lastActivity);
  scheduleSave(); scheduleStateEmit();
  if (state.votes[side] >= TARGET_VOTES) finishWinner(side);
}
function getGiftName(data = {}) { return data.giftName || data.gift?.name || data.extendedGiftInfo?.name || data.gift?.giftName || ''; }
function getRepeatCount(data = {}) { const raw = data.repeatCount ?? data.gift?.repeatCount ?? data.gift?.repeat_count ?? 1; return Math.max(1, Math.floor(Number(raw) || 1)); }
function isRepeatEnd(data = {}) { const v = data.repeatEnd ?? data.gift?.repeatEnd ?? data.gift?.repeat_end; return v === true || v === 1 || v === '1'; }
function getGiftType(data = {}) { return Number(data.giftType ?? data.gift?.type ?? data.gift?.giftType ?? data.gift?.gift_type ?? 0); }
function matchesAlias(name, aliases = []) { const n = normalizeText(name); return aliases.some(alias => normalizeText(alias) === n); }
function handleChat(data) {
  const messageId = data.msgId || data.messageUuid || data.common?.msgId; if (rememberMessage(messageId)) return;
  const comment = String(data.content ?? data.comment ?? '').trim(); if (!comment) return;
  const normalized = normalizeText(comment), leftCode = normalizeText(state.config.leftCode), rightCode = normalizeText(state.config.rightCode);
  const leftMatch = state.config.exactCommentOnly ? normalized === leftCode : normalized.includes(leftCode);
  const rightMatch = state.config.exactCommentOnly ? normalized === rightCode : normalized.includes(rightCode);
  if (leftMatch && !rightMatch) { markParticipant(data); addVotes('flavio', 1, { type: 'comment', user: userLabel(data), detail: comment }); }
  else if (rightMatch && !leftMatch) { markParticipant(data); addVotes('lula', 1, { type: 'comment', user: userLabel(data), detail: comment }); }
}
function handleGift(data) {
  const giftType = getGiftType(data); if (giftType === 1 && !isRepeatEnd(data)) return;
  const messageId = data.msgId || data.common?.msgId; if (rememberMessage(messageId)) return;
  const giftName = getGiftName(data), repeatCount = getRepeatCount(data);
  const amount = repeatCount * Math.max(1, Math.floor(Number(state.config.giftVotesPerItem) || 1));
  let side = null; if (matchesAlias(giftName, state.config.leftGiftAliases)) side = 'flavio';
  if (matchesAlias(giftName, state.config.rightGiftAliases)) side = 'lula';
  if (side) { markParticipant(data); addVotes(side, amount, { type: 'gift', user: userLabel(data), detail: giftName || `Presente #${data.giftId || '?'}`, count: repeatCount }); }
  else { addActivity({ type: 'gift-unmapped', user: userLabel(data), detail: giftName || `Presente #${data.giftId || '?'}`, count: repeatCount, amount: 0, side: null }); scheduleStateEmit(); }
}

async function disconnectTikTok(reason = 'Desconectado') {
  manuallyDisconnected = true; clearTimeout(reconnectTimer); reconnectTimer = null;
  const old = connection; connection = null; if (old) { try { await old.disconnect(); } catch {} }
  state.connection = { ...state.connection, status: 'offline', roomId: '', message: reason }; emitStateNow();
}
async function connectTikTok(username, isReconnect = false) {
  const clean = String(username || '').replace(/^@/, '').trim(); if (!clean) throw new Error('Informe o @usuario da conta que está fazendo a LIVE.');
  manuallyDisconnected = false; clearTimeout(reconnectTimer);
  if (connection) { try { await connection.disconnect(); } catch {} connection = null; }
  state.connection = { status: 'connecting', username: clean, roomId: '', message: isReconnect ? 'Reconectando à LIVE…' : 'Conectando à LIVE…' }; emitStateNow();
  const options = { enableExtendedGiftInfo: false, processInitialData: false }; if (EULER_API_KEY) options.signApiKey = EULER_API_KEY;
  const live = new TikTokLiveConnection(clean, options); connection = live;
  live.on(WebcastEvent.CHAT, handleChat); live.on(WebcastEvent.GIFT, handleGift);
  live.on(ControlEvent.ERROR, err => console.error('TikTok connector:', err?.message || err));
  live.on(ControlEvent.DISCONNECTED, () => {
    if (connection !== live) return; connection = null;
    state.connection = { ...state.connection, status: 'offline', roomId: '', message: 'Conexão com a LIVE caiu' }; emitStateNow();
    if (!manuallyDisconnected) reconnectTimer = setTimeout(() => connectTikTok(clean, true).catch(err => {
      state.connection = { ...state.connection, status: 'error', message: err.message }; emitStateNow();
    }), 3000);
  });
  try {
    const connState = await live.connect(); if (connection !== live) return;
    state.connection = { status: 'online', username: clean, roomId: String(connState.roomId || live.roomId || ''), message: 'LIVE conectada' };
    scheduleSave(); emitStateNow();
  } catch (err) {
    if (connection === live) connection = null;
    state.connection = { status: 'error', username: clean, roomId: '', message: err?.message || 'Não foi possível conectar à LIVE.' };
    emitStateNow(); throw err;
  }
}

const app = express(); const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });
app.use(express.json({ limit: '100kb' })); app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/api/state', (_req, res) => res.json(publicState()));
app.post('/api/admin/check', (req, res) => { if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' }); res.json({ ok: true }); });
app.post('/api/connect', async (req, res) => { if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' }); try { await connectTikTok(req.body.username); res.json({ ok: true, state: publicState() }); } catch (err) { res.status(400).json({ ok: false, error: err?.message || 'Falha ao conectar' }); } });
app.post('/api/disconnect', async (req, res) => { if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' }); await disconnectTikTok('Desconectado pelo painel'); res.json({ ok: true }); });
app.post('/api/config', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' });
  const body = req.body || {}, list = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  state.config = { ...state.config,
    leftName: String(body.leftName || state.config.leftName).slice(0, 50), rightName: String(body.rightName || state.config.rightName).slice(0, 50),
    leftCode: String(body.leftCode || state.config.leftCode).trim().slice(0, 20), rightCode: String(body.rightCode || state.config.rightCode).trim().slice(0, 20),
    leftGiftAliases: list(body.leftGiftAliases).length ? list(body.leftGiftAliases) : state.config.leftGiftAliases,
    rightGiftAliases: list(body.rightGiftAliases).length ? list(body.rightGiftAliases) : state.config.rightGiftAliases,
    giftVotesPerItem: 1, exactCommentOnly: body.exactCommentOnly !== false };
  scheduleSave(); emitStateNow(); res.json({ ok: true, state: publicState() });
});
app.post('/api/manual-vote', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' });
  const side = req.body.side === 'lula' ? 'lula' : req.body.side === 'flavio' ? 'flavio' : null;
  if (!side) return res.status(400).json({ ok: false, error: 'Lado inválido' });
  const amount = Math.min(10000, Math.max(1, Math.floor(Number(req.body.amount) || 1)));
  addVotes(side, amount, { type: 'manual', user: 'Painel', detail: `+${amount} manual` }); res.json({ ok: true });
});
app.post('/api/simulate', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' });
  const type = String(req.body.type || ''), fakeUser = { user: { uniqueId: req.body.user || 'teste', userId: `test-${Date.now()}-${Math.random()}` } };
  if (type === 'comment') handleChat({ ...fakeUser, content: String(req.body.value || ''), msgId: `sim-${Date.now()}-${Math.random()}` });
  else if (type === 'gift') handleGift({ ...fakeUser, giftName: String(req.body.value || ''), repeatCount: Number(req.body.count || 1), giftType: 2, repeatEnd: true, msgId: `sim-${Date.now()}-${Math.random()}` });
  else return res.status(400).json({ ok: false, error: 'Simulação inválida' });
  res.json({ ok: true });
});
app.post('/api/manual-adjust', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' });
  const side = req.body.side === 'lula' ? 'lula' : req.body.side === 'flavio' ? 'flavio' : null;
  if (!side) return res.status(400).json({ ok: false, error: 'Lado inválido' });
  const delta = Math.max(-10000, Math.min(10000, Math.floor(Number(req.body.delta) || 0)));
  state.votes[side] = Math.max(0, Math.min(TARGET_VOTES, state.votes[side] + delta));
  addActivity({ side, amount: delta, type: 'manual', user: 'Painel', detail: `${delta >= 0 ? '+' : ''}${delta} manual` });
  scheduleSave(); emitStateNow();
  if (state.votes[side] >= TARGET_VOTES) finishWinner(side);
  res.json({ ok: true });
});
app.post('/api/reset', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, error: 'PIN incorreto' });
  clearTimeout(resetWinnerTimer); state.votes = { flavio: 0, lula: 0 }; participantSet = new Set(); state.participants = [];
  state.winner = null; state.lastActivity = null; state.recentActivity = []; if (req.body.nextRound === true) state.round += 1;
  scheduleSave(); emitStateNow(); res.json({ ok: true });
});
io.on('connection', socket => socket.emit('state', publicState()));
server.listen(PORT, '0.0.0.0', () => console.log(`Urna LIVE V4 em http://localhost:${PORT}`));
