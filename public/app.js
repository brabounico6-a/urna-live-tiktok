const socket = io({ transports: ['websocket', 'polling'] });
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('pt-BR').format(Number(n || 0));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let currentState = null;
let adminPin = sessionStorage.getItem('urnaAdminPin') || '';
let toastTimer = null;
let voiceEnabled = localStorage.getItem('urnaVoiceEnabled') === '1';
let voiceTimer = null;
let pendingVoice = null;
let lastVoiceAt = 0;
let winnerKey = '';
let audioCtx = null;

const anim = {
  flavio: { running: false, pending: null },
  lula: { running: false, pending: null }
};

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
}

async function api(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': adminPin },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na operação');
  return data;
}

function getAudioCtx() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

const confirmTonePool = Array.from({ length: 3 }, () => {
  const a = new Audio('/audio/confirma-urna.mp3');
  a.preload = 'auto';
  a.volume = 1;
  return a;
});
let confirmToneIndex = 0;

async function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') await ctx.resume();

    // Desbloqueia também o MP3 de confirmação no Android/WebView.
    const a = confirmTonePool[0];
    a.volume = 0.001;
    await a.play();
    a.pause();
    a.currentTime = 0;
    a.volume = 1;
  } catch {}
}

function beep(freq = 900, duration = .045, volume = .035) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + duration + .01);
  } catch {}
}

function playConfirmTone() {
  try {
    const a = confirmTonePool[confirmToneIndex % confirmTonePool.length];
    confirmToneIndex++;
    a.pause();
    a.currentTime = 0;
    a.volume = 1;
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Fallback curto se o WebView bloquear o MP3.
        const seq = [1760, 2093, 2349, 2093, 2637];
        seq.forEach((f, i) => setTimeout(() => beep(f, i === 4 ? .09 : .05, .075), i * 58));
      });
    }
  } catch {
    const seq = [1760, 2093, 2349, 2093, 2637];
    seq.forEach((f, i) => setTimeout(() => beep(f, i === 4 ? .09 : .05, .075), i * 58));
  }
}

window.addEventListener('pointerdown', unlockAudio, { passive: true });

const localVoices = {
  flavio: new Audio('/audio/flavio.mp3'),
  lula: new Audio('/audio/lula.mp3')
};
Object.values(localVoices).forEach(a => { a.preload = 'auto'; a.volume = 1; });
let activeVoiceAudio = null;
let voiceCooldownUntil = 0;

function voiceSupported() {
  return typeof Audio !== 'undefined';
}

async function enableVoice() {
  voiceEnabled = true;
  localStorage.setItem('urnaVoiceEnabled', '1');
  try {
    const a = localVoices.flavio;
    a.volume = 0.001;
    await a.play();
    a.pause();
    a.currentTime = 0;
    a.volume = 1;
  } catch {}
  updateVoiceUi();
  toast('Voz local ativada');
}

function updateVoiceUi() {
  if (!$('voiceStatus')) return;
  $('voiceStatus').textContent = voiceEnabled ? 'Voz local ativada • sem fila para evitar atraso' : 'Toque em ATIVAR VOZ uma vez';
  if ($('voiceBtn')) $('voiceBtn').textContent = voiceEnabled ? '🔊 VOZ ATIVADA' : '🔊 ATIVAR VOZ';
}

function playLocalVoice(side) {
  if (!voiceEnabled || !voiceSupported()) return;
  const now = Date.now();
  if (now < voiceCooldownUntil) return;
  voiceCooldownUntil = now + 900;
  try {
    if (activeVoiceAudio) {
      activeVoiceAudio.pause();
      activeVoiceAudio.currentTime = 0;
    }
    const a = localVoices[side];
    if (!a) return;
    a.currentTime = 0;
    activeVoiceAudio = a;
    a.play().catch(() => {
      voiceEnabled = false;
      localStorage.removeItem('urnaVoiceEnabled');
      updateVoiceUi();
      toast('Toque em ATIVAR VOZ para liberar o áudio');
    });
  } catch {}
}

function sideMeta(side, state = currentState) {
  const c = state?.config || {};
  if (side === 'flavio') return { key: 'flavio', ui: 'Left', code: c.leftCode || '22', name: c.leftName || 'Flávio Bolsonaro', photo: '/flavio.jpg' };
  return { key: 'lula', ui: 'Right', code: c.rightCode || '13', name: c.rightName || 'Lula', photo: '/lula.jpg' };
}

function renderState(state) {
  currentState = state;
  const l = Number(state.votes?.flavio || 0);
  const r = Number(state.votes?.lula || 0);
  const total = l + r;
  const target = Number(state.targetVotes || 10000);
  const lp = total ? l / total * 100 : 50;
  const rp = total ? r / total * 100 : 50;
  const showShare = total >= 10;

  $('leftVotes').textContent = fmt(l);
  $('rightVotes').textContent = fmt(r);
  $('leftGoalNow').textContent = fmt(l);
  $('rightGoalNow').textContent = fmt(r);
  $('leftPct').textContent = showShare ? `${lp.toFixed(1)}%` : '—';
  $('rightPct').textContent = showShare ? `${rp.toFixed(1)}%` : '—';
  $('leftGoalBar').style.width = `${Math.min(100, l / target * 100)}%`;
  $('rightGoalBar').style.width = `${Math.min(100, r / target * 100)}%`;
  $('versusLeft').style.width = `${showShare ? lp : 50}%`;
  $('versusRight').style.width = `${showShare ? rp : 50}%`;
  $('versusCaption').textContent = showShare ? `${lp.toFixed(1)}% x ${rp.toFixed(1)}%` : 'A porcentagem aparece após 10 votos';
  $('totalVotes').textContent = fmt(total);
  $('participants').textContent = fmt(state.participants || 0);
  $('round').textContent = `#${String(state.round || 1).padStart(2, '0')}`;

  const c = state.config;
  $('leftName').textContent = c.leftName;
  $('rightName').textContent = c.rightName;
  $('leftCode').textContent = c.leftCode;
  $('rightCode').textContent = c.rightCode;
  $('screenLeftName').textContent = c.leftName;
  $('screenRightName').textContent = c.rightName;
  $('screenLeftCode').textContent = c.leftCode;
  $('screenRightCode').textContent = c.rightCode;

  const conn = state.connection || {};
  $('statusPill').className = `status-pill ${conn.status || 'offline'}`;
  $('statusText').textContent = conn.status === 'online' ? 'LIVE' : conn.status === 'connecting' ? 'CONECTANDO' : conn.status === 'error' ? 'ERRO' : 'OFFLINE';
  $('connectionMessage').textContent = conn.message || 'Desconectado';
  if (!$('usernameInput').value && conn.username) $('usernameInput').value = conn.username;

  const a = state.lastActivity;
  if (a) {
    $('activityUser').textContent = `@${a.user || 'usuario'}`;
    $('activityCount').textContent = a.amount ? `+${a.amount}` : '•';
    if (a.type === 'comment') $('activityText').textContent = `comentou ${a.detail}`;
    else if (a.type === 'gift') $('activityText').textContent = `enviou ${a.detail}${a.count > 1 ? ` ×${a.count}` : ''}`;
    else if (a.type === 'gift-unmapped') $('activityText').textContent = `${a.detail} ainda não está configurado`;
    else $('activityText').textContent = a.detail || 'Atualização';
  } else {
    $('activityUser').textContent = 'Aguardando votos...';
    $('activityText').textContent = 'Conecte a LIVE para começar';
    $('activityCount').textContent = '+0';
  }

  if (document.activeElement !== $('cfgLeftName')) $('cfgLeftName').value = c.leftName;
  if (document.activeElement !== $('cfgRightName')) $('cfgRightName').value = c.rightName;
  if (document.activeElement !== $('cfgLeftCode')) $('cfgLeftCode').value = c.leftCode;
  if (document.activeElement !== $('cfgRightCode')) $('cfgRightCode').value = c.rightCode;
  if (document.activeElement !== $('cfgLeftGifts')) $('cfgLeftGifts').value = (c.leftGiftAliases || []).join(', ');
  if (document.activeElement !== $('cfgRightGifts')) $('cfgRightGifts').value = (c.rightGiftAliases || []).join(', ');
  $('cfgExact').checked = c.exactCommentOnly !== false;

  $('eventLog').innerHTML = (state.recentActivity || []).map(ev => {
    const cls = ev.side === 'flavio' ? 'left' : ev.side === 'lula' ? 'right' : '';
    return `<div class="event-row ${cls}"><b>@${escapeHtml(ev.user || 'usuario')}</b> • ${escapeHtml(ev.detail || ev.type)} ${ev.amount ? `<strong>+${ev.amount}</strong>` : ''}</div>`;
  }).join('') || '<div class="event-row">Nenhum evento ainda.</div>';

  if (state.winner) showWinner(state.winner);
  else hideWinner();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function applyBatch(batch) {
  if (!currentState) return;
  currentState.votes = currentState.votes || { flavio: 0, lula: 0 };
  currentState.votes[batch.side] = batch.totalVotes;
  if (Number.isFinite(batch.participantCount)) currentState.participants = batch.participantCount;
  renderState(currentState);
  queueAnimation(batch.side, batch);
}

function queueAnimation(side, batch) {
  const slot = anim[side];
  if (!slot) return;
  if (slot.running) {
    if (slot.pending) {
      slot.pending.amount += Number(batch.amount || 0);
      slot.pending.totalVotes = batch.totalVotes;
      slot.pending.user = batch.user;
      slot.pending.detail = batch.detail;
      slot.pending.type = batch.type;
    } else {
      slot.pending = { ...batch };
    }
    return;
  }
  runAnimation(side, { ...batch });
}

async function runAnimation(side, batch) {
  const slot = anim[side];
  slot.running = true;
  try {
    await animateVote(side, batch);
  } finally {
    slot.running = false;
    if (slot.pending) {
      const next = slot.pending;
      slot.pending = null;
      runAnimation(side, next);
    }
  }
}

async function animateVote(side, batch) {
  const meta = sideMeta(side);
  const urna = $(`urn${meta.ui}`);
  const screen = $(`screen${meta.ui}`);
  const hand = $(`hand${meta.ui}`);
  const pop = $(`pop${meta.ui}`);
  const keypad = urna.querySelector('.keypad');
  const status = $(`screen${meta.ui}Status`);
  const codeEl = $(`screen${meta.ui}Code`);
  const liveTag = $(side === 'flavio' ? 'leftLiveTag' : 'rightLiveTag');
  const code = String(meta.code).replace(/\D/g, '').slice(0, 6);
  if (!code) return;

  pop.querySelector('span').textContent = `@${batch.user || 'usuario'}`;
  pop.querySelector('strong').textContent = `+${batch.amount || 1} VOTO${Number(batch.amount || 1) > 1 ? 'S' : ''}`;
  pop.classList.add('show');
  liveTag.textContent = batch.type === 'gift' ? 'PRESENTE' : 'COMENTÁRIO';

  screen.classList.remove('success');
  screen.classList.add('active');
  codeEl.textContent = '';
  status.textContent = 'DIGITANDO...';

  const boxRect = urna.getBoundingClientRect();
  hand.style.left = '50%';
  hand.style.top = `${urna.clientHeight + 50}px`;
  hand.classList.add('visible');
  await sleep(45);

  let typed = '';
  for (const digit of code) {
    const key = keypad.querySelector(`button[data-digit="${digit}"]`);
    if (!key) continue;
    const r = key.getBoundingClientRect();
    hand.style.left = `${r.left - boxRect.left + r.width / 2}px`;
    hand.style.top = `${r.top - boxRect.top + r.height / 2}px`;
    await sleep(125);
    hand.classList.add('tap'); key.classList.add('pressed');
    beep(820 + Number(digit) * 22, .04, .028);
    typed += digit; codeEl.textContent = typed;
    status.textContent = 'CANDIDATO ENCONTRADO';
    await sleep(55);
    hand.classList.remove('tap'); key.classList.remove('pressed');
    await sleep(24);
  }

  const confirmKey = keypad.querySelector('[data-action="confirm"]');
  const cr = confirmKey.getBoundingClientRect();
  hand.style.left = `${cr.left - boxRect.left + cr.width / 2}px`;
  hand.style.top = `${cr.top - boxRect.top + cr.height / 2}px`;
  status.textContent = 'CONFIRMANDO...';
  await sleep(120);
  hand.classList.add('tap'); confirmKey.classList.add('pressed');
  playConfirmTone();
  await sleep(85);
  hand.classList.remove('tap'); confirmKey.classList.remove('pressed');

  screen.classList.add('success');
  status.textContent = `VOTO COMPUTADO +${batch.amount || 1}`;
  urna.classList.add('flash');
  playLocalVoice(side);
  await sleep(300);
  urna.classList.remove('flash');
  hand.classList.remove('visible');
  pop.classList.remove('show');
  screen.classList.remove('success', 'active');
  liveTag.textContent = 'AGUARDANDO';
  await sleep(30);
}

function showWinner(winner) {
  const key = `${winner.round}|${winner.side}|${winner.time}`;
  const meta = sideMeta(winner.side);
  $('winnerPhoto').src = meta.photo;
  $('winnerName').textContent = winner.name || meta.name;
  $('winnerCode').textContent = winner.code || meta.code;
  $('winnerOverlay').classList.add('show');
  if (key !== winnerKey) {
    winnerKey = key;
    playLocalVoice(winner.side);
  }
}

function hideWinner() {
  $('winnerOverlay').classList.remove('show');
}

function unlockUI() {
  $('authBox').classList.add('hidden');
  $('adminContent').classList.remove('hidden');
}

async function initial() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  const state = await res.json();
  renderState(state);
  updateVoiceUi();
  if (adminPin) {
    try { await api('/api/admin/check'); unlockUI(); }
    catch { adminPin = ''; sessionStorage.removeItem('urnaAdminPin'); }
  }
}

$('adminToggle').onclick = () => { $('adminPanel').classList.remove('hidden'); $('adminPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('closeAdmin').onclick = () => $('adminPanel').classList.add('hidden');
$('unlockBtn').onclick = async () => {
  adminPin = $('pinInput').value.trim();
  try { await api('/api/admin/check'); sessionStorage.setItem('urnaAdminPin', adminPin); unlockUI(); toast('Painel desbloqueado'); }
  catch (e) { adminPin = ''; toast(e.message); }
};
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('unlockBtn').click(); });
$('voiceBtn').onclick = enableVoice;

$('connectBtn').onclick = async () => {
  $('connectBtn').disabled = true;
  try { await api('/api/connect', { username: $('usernameInput').value.trim() }); toast('LIVE conectada'); }
  catch (e) { toast(e.message); }
  finally { $('connectBtn').disabled = false; }
};
$('disconnectBtn').onclick = async () => { try { await api('/api/disconnect'); toast('Desconectado'); } catch (e) { toast(e.message); } };

for (const btn of document.querySelectorAll('[data-test]')) {
  btn.onclick = async () => {
    const map = {
      'left-comment': { type: 'comment', value: currentState.config.leftCode },
      'right-comment': { type: 'comment', value: currentState.config.rightCode },
      'left-gift': { type: 'gift', value: currentState.config.leftGiftAliases[0] || 'White Rose' },
      'right-gift': { type: 'gift', value: currentState.config.rightGiftAliases[0] || 'Rose' }
    };
    try { await api('/api/simulate', map[btn.dataset.test]); }
    catch (e) { toast(e.message); }
  };
}

async function manual(side, amount) {
  try {
    if (amount > 0) await api('/api/manual-vote', { side, amount });
    else {
      const res = await fetch('/api/manual-adjust', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': adminPin },
        body: JSON.stringify({ side, delta: amount })
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Erro');
    }
  } catch (e) { toast(e.message); }
}
$('plusLeft').onclick = () => manual('flavio', 1);
$('plusRight').onclick = () => manual('lula', 1);
$('minusLeft').onclick = () => manual('flavio', -1);
$('minusRight').onclick = () => manual('lula', -1);
$('resetBtn').onclick = async () => { if (!confirm('Zerar os votos desta rodada?')) return; try { await api('/api/reset', { nextRound: false }); toast('Votos zerados'); } catch (e) { toast(e.message); } };
$('nextRoundBtn').onclick = async () => { if (!confirm('Iniciar nova rodada?')) return; try { await api('/api/reset', { nextRound: true }); toast('Nova rodada iniciada'); } catch (e) { toast(e.message); } };
$('saveConfigBtn').onclick = async () => {
  const payload = {
    leftName: $('cfgLeftName').value.trim(), rightName: $('cfgRightName').value.trim(),
    leftCode: $('cfgLeftCode').value.trim(), rightCode: $('cfgRightCode').value.trim(),
    leftGiftAliases: $('cfgLeftGifts').value.split(',').map(s => s.trim()).filter(Boolean),
    rightGiftAliases: $('cfgRightGifts').value.split(',').map(s => s.trim()).filter(Boolean),
    exactCommentOnly: $('cfgExact').checked
  };
  try { await api('/api/config', payload); toast('Configuração salva'); } catch (e) { toast(e.message); }
};

socket.on('state', renderState);
socket.on('vote-batch', applyBatch);
socket.on('winner', showWinner);
socket.on('connect', () => console.log('socket conectado'));
socket.on('connect_error', () => {});

initial().catch(() => toast('Falha ao carregar o painel'));
