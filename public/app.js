const socket = io();
const $ = id => document.getElementById(id);
let currentState = null;
let adminPin = sessionStorage.getItem('urnaAdminPin') || '';
let toastTimer;
let animationReady = false;
let lastActivityKey = '';
let voteAnimationRunning = false;
const voteAnimationQueue = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const activityKey = a => a ? [a.time,a.type,a.user,a.detail,a.amount,a.side].join('|') : '';


let voteAudioContext = null;
function getVoteAudioContext(){
  if(voteAudioContext) return voteAudioContext;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if(!AudioCtx) return null;
  voteAudioContext = new AudioCtx();
  return voteAudioContext;
}

async function unlockVoteAudio(){
  try{
    const ctx = getVoteAudioContext();
    if(ctx && ctx.state === 'suspended') await ctx.resume();
  }catch{}
}

function playConfirmTone(){
  // Reprodução eletrônica local inspirada no "pilili" de confirmação/fim.
  // Não depende de arquivo externo, então continua funcionando hospedado.
  try{
    const ctx = getVoteAudioContext();
    if(!ctx) return;
    if(ctx.state === 'suspended') ctx.resume().catch(()=>{});
    const now = ctx.currentTime + 0.015;
    const tones = [
      {f:1760, at:0.000, dur:0.060},
      {f:2093, at:0.070, dur:0.060},
      {f:2349, at:0.140, dur:0.060},
      {f:2093, at:0.210, dur:0.060},
      {f:2637, at:0.280, dur:0.105}
    ];
    for(const tone of tones){
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(tone.f, now + tone.at);
      gain.gain.setValueAtTime(0.0001, now + tone.at);
      gain.gain.exponentialRampToValueAtTime(0.085, now + tone.at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + tone.at);
      osc.stop(now + tone.at + tone.dur + 0.01);
    }
  }catch{}
}

window.addEventListener('pointerdown', unlockVoteAudio, {passive:true});
window.addEventListener('keydown', unlockVoteAudio, {passive:true});


const fmt = n => new Intl.NumberFormat('pt-BR').format(Number(n || 0));
const firstName = s => String(s || '').split(/\s+/)[0];

function toast(msg){
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>$('toast').classList.remove('show'),2400);
}

async function api(url, body = {}){
  const res = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Admin-Pin':adminPin},
    body:JSON.stringify(body)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Erro na operação');
  return data;
}

function render(state){
  currentState = state;
  const l = Number(state.votes.flavio || 0), r = Number(state.votes.lula || 0), total = l+r;
  const lp = total ? l/total*100 : 50;
  const rp = total ? r/total*100 : 50;
  $('leftVotes').textContent = fmt(l); $('rightVotes').textContent = fmt(r);
  $('leftPct').textContent = total ? `${lp.toFixed(1)}%` : '0.0%';
  $('rightPct').textContent = total ? `${rp.toFixed(1)}%` : '0.0%';
  $('barLeft').style.width = `${lp}%`; $('barRight').style.width = `${rp}%`;
  $('totalVotes').textContent = fmt(total); $('participants').textContent = fmt(state.participants);
  $('round').textContent = `#${String(state.round).padStart(2,'0')}`;

  const c=state.config;
  $('leftName').textContent=c.leftName; $('rightName').textContent=c.rightName;
  $('leftCode').textContent=c.leftCode; $('rightCode').textContent=c.rightCode;
  $('leftCommentCode').textContent=c.leftCode; $('rightCommentCode').textContent=c.rightCode;
  $('leftMethodName').textContent=firstName(c.leftName); $('rightMethodName').textContent=firstName(c.rightName);
  $('leftGiftText').textContent=c.leftGiftAliases[0] || 'Presente esquerda';
  $('rightGiftText').textContent=c.rightGiftAliases[0] || 'Presente direita';
  if(!voteAnimationRunning){
    const sl=$('screenLeft'), sr=$('screenRight');
    if(sl){ sl.querySelector('span').textContent=c.leftCode; sl.querySelector('small').textContent='VOTO'; }
    if(sr){ sr.querySelector('span').textContent=c.rightCode; sr.querySelector('small').textContent='VOTO'; }
  }

  const conn=state.connection;
  $('statusPill').className=`status-pill ${conn.status}`;
  $('statusText').textContent=conn.status==='online'?'LIVE':conn.status==='connecting'?'CONECTANDO':conn.status==='error'?'ERRO':'OFFLINE';
  $('connectionMessage').textContent=conn.message || '';
  if(!$('usernameInput').value && conn.username) $('usernameInput').value=conn.username;

  const a=state.lastActivity;
  $('activityCard').className='activity-card';
  if(a){
    $('activityUser').textContent=`@${a.user || 'usuario'}`;
    let text='';
    if(a.type==='comment') text=`comentou ${a.detail} → +${a.amount} voto${a.amount>1?'s':''}`;
    else if(a.type==='gift') text=`enviou ${a.detail}${a.count>1?` ×${a.count}`:''} → +${a.amount} voto${a.amount>1?'s':''}`;
    else if(a.type==='gift-unmapped') text=`enviou ${a.detail} • presente ainda não configurado`;
    else text=a.detail || `+${a.amount}`;
    $('activityText').textContent=text;
    if(a.side==='flavio') $('activityCard').classList.add('left');
    if(a.side==='lula') $('activityCard').classList.add('right');
  } else {
    $('activityUser').textContent='Aguardando votos…'; $('activityText').textContent='Conecte a LIVE ou use o modo teste';
  }

  if(document.activeElement !== $('cfgLeftName')) $('cfgLeftName').value=c.leftName;
  if(document.activeElement !== $('cfgRightName')) $('cfgRightName').value=c.rightName;
  if(document.activeElement !== $('cfgLeftCode')) $('cfgLeftCode').value=c.leftCode;
  if(document.activeElement !== $('cfgRightCode')) $('cfgRightCode').value=c.rightCode;
  if(document.activeElement !== $('cfgLeftGifts')) $('cfgLeftGifts').value=c.leftGiftAliases.join(', ');
  if(document.activeElement !== $('cfgRightGifts')) $('cfgRightGifts').value=c.rightGiftAliases.join(', ');
  $('cfgExact').checked=c.exactCommentOnly !== false;

  $('eventLog').innerHTML = (state.recentActivity || []).map(ev=>{
    const cls=ev.side==='flavio'?'left':ev.side==='lula'?'right':'';
    const sign=ev.amount?`<strong>+${ev.amount}</strong>`:'';
    return `<div class="event-row ${cls}"><b>@${escapeHtml(ev.user||'usuario')}</b> • ${escapeHtml(ev.detail||ev.type)} ${sign}</div>`;
  }).join('') || '<div class="event-row">Nenhum evento ainda.</div>';
}

function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function enqueueVoteAnimation(activity, config){
  if(!activity || !['comment','gift'].includes(activity.type)) return;
  if(!['flavio','lula'].includes(activity.side) || Number(activity.amount || 0) <= 0) return;
  voteAnimationQueue.push({activity:{...activity}, config:{...config}});
  runVoteAnimationQueue();
}

async function runVoteAnimationQueue(){
  if(voteAnimationRunning || !voteAnimationQueue.length) return;
  voteAnimationRunning = true;
  try{
    while(voteAnimationQueue.length){
      const item = voteAnimationQueue.shift();
      await animateVote(item.activity, item.config);
    }
  } finally {
    voteAnimationRunning = false;
    if(currentState) render(currentState);
  }
}

async function animateVote(activity, config){
  const side = activity.side === 'flavio' ? 'left' : 'right';
  const code = String(side === 'left' ? config.leftCode : config.rightCode).replace(/\D/g,'').slice(0,6);
  if(!code) return;

  const zone = $('ballotZone');
  const hand = $('voteHand');
  const urn = side === 'left' ? $('urnLeft') : $('urnRight');
  const screen = side === 'left' ? $('screenLeft') : $('screenRight');
  const candidate = document.querySelector(side === 'left' ? '.candidate-left' : '.candidate-right');
  const score = side === 'left' ? $('leftVotes') : $('rightVotes');
  const splash = $('voteSplash');
  const confirm = $('voteConfirm');
  if(!zone || !hand || !urn || !screen) return;

  const sideLabel = side === 'left' ? config.leftName : config.rightName;
  const amount = Math.max(1, Number(activity.amount || 1));
  $('voteSplashUser').textContent = `@${activity.user || 'usuario'}`;
  $('voteSplashText').textContent = `${activity.type === 'gift' ? 'PRESENTE' : 'COMENTÁRIO'} → VOTO ${code}${amount > 1 ? ` (+${amount})` : ''}`;
  splash.className = `vote-splash ${side} show`;
  confirm.classList.remove('show');
  urn.classList.add('vote-focus');

  const screenNumber = screen.querySelector('span');
  const screenText = screen.querySelector('small');
  screen.classList.remove('success');
  screen.classList.add('typing');
  screenNumber.textContent = '';
  screenText.textContent = 'DIGITANDO…';

  const zoneRect = zone.getBoundingClientRect();
  const urnRect = urn.getBoundingClientRect();
  hand.className = 'vote-hand';
  hand.style.left = `${urnRect.left - zoneRect.left + urnRect.width/2}px`;
  hand.style.top = `${zone.clientHeight + 70}px`;
  void hand.offsetWidth;
  hand.classList.add('visible');
  await sleep(120);

  for(const digit of code){
    const key = zone.querySelector(`.key[data-side="${side}"][data-digit="${digit}"]`);
    if(!key) continue;
    const keyRect = key.getBoundingClientRect();
    const x = keyRect.left - zoneRect.left + keyRect.width/2;
    const y = keyRect.top - zoneRect.top + keyRect.height/2 - 4;
    hand.style.left = `${x}px`;
    hand.style.top = `${y}px`;
    await sleep(330);
    hand.classList.add('tap');
    key.classList.add('pressed');
    screenNumber.textContent += digit;
    await sleep(125);
    hand.classList.remove('tap');
    key.classList.remove('pressed');
    await sleep(95);
  }

  const confirmKey = zone.querySelector(`.key-confirm[data-side="${side}"]`);
  if(confirmKey){
    const keyRect = confirmKey.getBoundingClientRect();
    const x = keyRect.left - zoneRect.left + keyRect.width/2;
    const y = keyRect.top - zoneRect.top + keyRect.height/2 - 4;
    hand.style.left = `${x}px`;
    hand.style.top = `${y}px`;
    screenText.textContent = 'CONFIRMANDO…';
    await sleep(360);
    hand.classList.add('tap');
    confirmKey.classList.add('pressed');
    playConfirmTone();
    await sleep(210);
    hand.classList.remove('tap');
    confirmKey.classList.remove('pressed');
  }

  screen.classList.remove('typing');
  screen.classList.add('success');
  screenText.textContent = 'VOTO COMPUTADO';
  confirm.textContent = `✓ VOTO ${code} COMPUTADO${amount > 1 ? ` • +${amount}` : ''}`;
  confirm.classList.add('show');
  candidate?.classList.add('vote-pulse');
  score?.classList.add('vote-bump');
  await sleep(650);
  candidate?.classList.remove('vote-pulse');
  score?.classList.remove('vote-bump');

  hand.classList.add('exit');
  await sleep(280);
  hand.className = 'vote-hand';
  confirm.classList.remove('show');
  splash.classList.remove('show');
  urn.classList.remove('vote-focus');
  screen.classList.remove('success','typing');
  screenNumber.textContent = code;
  screenText.textContent = 'VOTO';
  await sleep(90);
}

async function initial(){
  const res=await fetch('/api/state');
  const state=await res.json();
  render(state);
  lastActivityKey=activityKey(state.lastActivity);
  animationReady=true;
  if(adminPin) try{await api('/api/admin/check'); unlockUI();}catch{sessionStorage.removeItem('urnaAdminPin');adminPin='';}
}

function unlockUI(){ $('authBox').classList.add('hidden'); $('adminContent').classList.remove('hidden'); }

$('adminToggle').onclick=()=>{$('adminPanel').classList.remove('hidden'); $('adminPanel').scrollIntoView({behavior:'smooth',block:'start'});};
$('closeAdmin').onclick=()=>$('adminPanel').classList.add('hidden');
$('unlockBtn').onclick=async()=>{
  adminPin=$('pinInput').value.trim();
  try{await api('/api/admin/check'); sessionStorage.setItem('urnaAdminPin',adminPin); unlockUI(); toast('Painel desbloqueado');}
  catch(e){adminPin='';toast(e.message);}
};
$('pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('unlockBtn').click();});

$('connectBtn').onclick=async()=>{
  $('connectBtn').disabled=true;
  try{await api('/api/connect',{username:$('usernameInput').value.trim()});toast('LIVE conectada');}
  catch(e){toast(e.message);}finally{$('connectBtn').disabled=false;}
};
$('disconnectBtn').onclick=async()=>{try{await api('/api/disconnect');toast('Desconectado');}catch(e){toast(e.message);}};

for(const btn of document.querySelectorAll('[data-test]')){
  btn.onclick=async()=>{
    const key=btn.dataset.test;
    const map={
      'left-comment':{type:'comment',value:currentState.config.leftCode},
      'right-comment':{type:'comment',value:currentState.config.rightCode},
      'left-gift':{type:'gift',value:currentState.config.leftGiftAliases[0]||'White Rose'},
      'right-gift':{type:'gift',value:currentState.config.rightGiftAliases[0]||'Rose'}
    };
    try{await api('/api/simulate',map[key]);}catch(e){toast(e.message);}
  };
}

async function manual(side,amount){
  if(amount>0){try{await api('/api/manual-vote',{side,amount});}catch(e){toast(e.message);}return;}
  // Para -1, ajusta localmente através de endpoint seguro futuro: simula reset não; usa rota dedicada abaixo.
  try{
    const res=await fetch('/api/manual-adjust',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Pin':adminPin},body:JSON.stringify({side,delta:amount})});
    const d=await res.json(); if(!res.ok) throw new Error(d.error||'Erro');
  }catch(e){toast(e.message);}
}
$('plusLeft').onclick=()=>manual('flavio',1); $('plusRight').onclick=()=>manual('lula',1);
$('minusLeft').onclick=()=>manual('flavio',-1); $('minusRight').onclick=()=>manual('lula',-1);

$('resetBtn').onclick=async()=>{if(!confirm('Zerar todos os votos desta rodada?'))return;try{await api('/api/reset',{nextRound:false});toast('Votos zerados');}catch(e){toast(e.message);}};
$('nextRoundBtn').onclick=async()=>{if(!confirm('Zerar votos e iniciar uma nova rodada?'))return;try{await api('/api/reset',{nextRound:true});toast('Nova rodada iniciada');}catch(e){toast(e.message);}};
$('saveConfigBtn').onclick=async()=>{
  const payload={
    leftName:$('cfgLeftName').value.trim(),rightName:$('cfgRightName').value.trim(),leftCode:$('cfgLeftCode').value.trim(),rightCode:$('cfgRightCode').value.trim(),
    leftGiftAliases:$('cfgLeftGifts').value.split(',').map(s=>s.trim()).filter(Boolean),rightGiftAliases:$('cfgRightGifts').value.split(',').map(s=>s.trim()).filter(Boolean),
    exactCommentOnly:$('cfgExact').checked,giftVotesPerItem:1
  };
  try{await api('/api/config',payload);toast('Configuração salva');}catch(e){toast(e.message);}
};

socket.on('state',state=>{
  const key=activityKey(state.lastActivity);
  const shouldAnimate=animationReady && key && key!==lastActivityKey;
  if(key) lastActivityKey=key;
  render(state);
  if(shouldAnimate) enqueueVoteAnimation(state.lastActivity,state.config);
});
initial().catch(()=>toast('Falha ao carregar o painel'));
