const socket = io();
const $ = id => document.getElementById(id);
let currentState = null;
let adminPin = sessionStorage.getItem('urnaAdminPin') || '';
let toastTimer;
let animationReady = false;
let lastActivityKey = '';
let lastWinnerKey = '';
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
  if(state.winner){
    showWinner(state.winner);
  }else{
    hideWinner();
  }

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

function ensureDualAnimationUI(){
  const zone=$('ballotZone');
  if(!zone) return;

  let leftHand=$('voteHandLeft') || $('voteHand');
  if(leftHand && leftHand.id!=='voteHandLeft'){
    leftHand.id='voteHandLeft';
    leftHand.classList.add('hand-left');
  }

  if(leftHand && !$('voteHandRight')){
    const h=leftHand.cloneNode(true);
    h.id='voteHandRight';
    h.classList.remove('hand-left');
    h.classList.add('hand-right');
    zone.appendChild(h);
  }

  let leftSplash=$('voteSplashLeft') || $('voteSplash');
  if(leftSplash && leftSplash.id!=='voteSplashLeft'){
    leftSplash.id='voteSplashLeft';
    leftSplash.classList.add('splash-left');
  }

  if(leftSplash && !$('voteSplashRight')){
    const x=leftSplash.cloneNode(true);
    x.id='voteSplashRight';
    x.classList.remove('splash-left');
    x.classList.add('splash-right');
    x.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
    zone.appendChild(x);
  }

  let leftConfirm=$('voteConfirmLeft') || $('voteConfirm');
  if(leftConfirm && leftConfirm.id!=='voteConfirmLeft'){
    leftConfirm.id='voteConfirmLeft';
    leftConfirm.classList.add('confirm-left');
  }

  if(leftConfirm && !$('voteConfirmRight')){
    const x=leftConfirm.cloneNode(true);
    x.id='voteConfirmRight';
    x.classList.remove('confirm-left');
    x.classList.add('confirm-right');
    zone.appendChild(x);
  }
}

const sideQueues={left:[],right:[]};
const sideRunning={left:false,right:false};

const sideCode=(side,c)=>String(
  side==='left' ? c.leftCode : c.rightCode
).replace(/\D/g,'').slice(0,6);

const sideName=(side,c)=>
  side==='left' ? c.leftName : c.rightName;

const sidePhoto=side=>
  side==='left' ? '/flavio.jpg' : '/lula.jpg';

function setUrnPhoto(side,config,typed,status){
  const screen=$(side==='left'?'screenLeft':'screenRight');
  if(!screen) return;

  screen.classList.add('has-photo');

  screen.style.backgroundImage=
    `linear-gradient(rgba(0,10,20,.05),rgba(0,10,20,.72)),url("${sidePhoto(side)}")`;

  screen.style.backgroundSize='cover';
  screen.style.backgroundPosition='center 18%';

  const number=screen.querySelector('span');
  const info=screen.querySelector('small');

  if(number) number.textContent=typed || sideCode(side,config);
  if(info) info.textContent=`${sideName(side,config)} • ${status}`;
}

function clearUrnPhoto(side,config){
  const screen=$(side==='left'?'screenLeft':'screenRight');
  if(!screen) return;

  screen.classList.remove('has-photo','typing','success');
  screen.style.backgroundImage='';

  const number=screen.querySelector('span');
  const info=screen.querySelector('small');

  if(number) number.textContent=sideCode(side,config);
  if(info) info.textContent='VOTO';
}

function enqueueVoteAnimation(activity,config){
  if(!activity || !['comment','gift'].includes(activity.type)) return;

  const side=
    activity.side==='flavio' ? 'left' :
    activity.side==='lula' ? 'right' : null;

  if(!side || Number(activity.amount||0)<=0) return;

  ensureDualAnimationUI();

  const queue=sideQueues[side];
  const item={
    activity:{...activity},
    config:{...config}
  };

  // Não deixa criar uma fila gigante.
  // Os votos continuam entrando no placar normalmente.
  if(queue.length){
    const last=queue[queue.length-1];

    last.activity.amount=
      Number(last.activity.amount||0)+Number(activity.amount||0);

    last.activity.count=
      Number(last.activity.count||0)+Number(activity.count||0);

    last.activity.user=activity.user;
    last.activity.detail=activity.detail;
  }else{
    queue.push(item);
  }

  runVoteAnimationQueue(side);
}

async function runVoteAnimationQueue(side){
  if(sideRunning[side] || !sideQueues[side].length) return;

  sideRunning[side]=true;
  voteAnimationRunning=true;

  try{
    while(sideQueues[side].length){
      await animateVote(side,sideQueues[side].shift());
    }
  }finally{
    sideRunning[side]=false;

    voteAnimationRunning=
      sideRunning.left || sideRunning.right;

    if(currentState){
      clearUrnPhoto(side,currentState.config);
    }
  }
}

async function animateVote(side,item){
  const {activity,config}=item;

  const code=sideCode(side,config);
  if(!code) return;

  const zone=$('ballotZone');

  const hand=$(
    side==='left' ? 'voteHandLeft' : 'voteHandRight'
  );

  const urn=$(
    side==='left' ? 'urnLeft' : 'urnRight'
  );

  const screen=$(
    side==='left' ? 'screenLeft' : 'screenRight'
  );

  const splash=$(
    side==='left' ? 'voteSplashLeft' : 'voteSplashRight'
  );

  const confirm=$(
    side==='left' ? 'voteConfirmLeft' : 'voteConfirmRight'
  );

  const candidate=document.querySelector(
    side==='left' ? '.candidate-left' : '.candidate-right'
  );

  const score=$(
    side==='left' ? 'leftVotes' : 'rightVotes'
  );

  if(!zone || !hand || !urn || !screen) return;

  const amount=Math.max(1,Number(activity.amount||1));

  if(splash){
    const u=splash.querySelector('span');
    const t=splash.querySelector('strong');

    if(u) u.textContent=`@${activity.user||'usuario'}`;

    if(t){
      t.textContent=
        `${activity.type==='gift'?'PRESENTE':'COMENTÁRIO'} → ${code}`+
        `${amount>1?` • +${amount}`:''}`;
    }

    splash.classList.add('show');
  }

  confirm?.classList.remove('show');

  urn.classList.add('vote-focus');
  screen.classList.add('typing');
  screen.style.backgroundImage='';

  const number=screen.querySelector('span');
  const info=screen.querySelector('small');

  if(number) number.textContent='';
  if(info) info.textContent='DIGITANDO…';

  const zoneRect=zone.getBoundingClientRect();
  const urnRect=urn.getBoundingClientRect();

  hand.className=`vote-hand hand-${side}`;

  hand.style.left=
    `${urnRect.left-zoneRect.left+urnRect.width/2}px`;

  hand.style.top=
    `${zone.clientHeight+50}px`;

  void hand.offsetWidth;

  hand.classList.add('visible');

  await sleep(45);

  let typed='';

  for(const digit of code){

    const key=zone.querySelector(
      `.key[data-side="${side}"][data-digit="${digit}"]`
    );

    if(!key) continue;

    const rect=key.getBoundingClientRect();

    hand.style.left=
      `${rect.left-zoneRect.left+rect.width/2}px`;

    hand.style.top=
      `${rect.top-zoneRect.top+rect.height/2-3}px`;

    await sleep(135);

    hand.classList.add('tap');
    key.classList.add('pressed');

    typed+=digit;

    // A FOTO APARECE ASSIM QUE DIGITA.
    setUrnPhoto(
      side,
      config,
      typed,
      'CANDIDATO'
    );

    await sleep(62);

    hand.classList.remove('tap');
    key.classList.remove('pressed');

    await sleep(28);
  }

  const confirmKey=zone.querySelector(
    `.key-confirm[data-side="${side}"]`
  );

  if(confirmKey){

    const rect=confirmKey.getBoundingClientRect();

    hand.style.left=
      `${rect.left-zoneRect.left+rect.width/2}px`;

    hand.style.top=
      `${rect.top-zoneRect.top+rect.height/2-3}px`;

    setUrnPhoto(
      side,
      config,
      code,
      'CONFIRMANDO…'
    );

    await sleep(135);

    hand.classList.add('tap');
    confirmKey.classList.add('pressed');

    playConfirmTone();

    await sleep(85);

    hand.classList.remove('tap');
    confirmKey.classList.remove('pressed');
  }

  screen.classList.remove('typing');
  screen.classList.add('success');

  setUrnPhoto(
    side,
    config,
    code,
    `VOTO COMPUTADO${amount>1?` +${amount}`:''}`
  );

  if(confirm){
    confirm.textContent=
      `✓ +${amount} ${sideName(side,config)}`;

    confirm.classList.add('show');
  }

  candidate?.classList.add('vote-pulse');
  score?.classList.add('vote-bump');

  await sleep(260);

  candidate?.classList.remove('vote-pulse');
  score?.classList.remove('vote-bump');

  hand.classList.add('exit');

  await sleep(75);

  hand.className=`vote-hand hand-${side}`;

  confirm?.classList.remove('show');
  splash?.classList.remove('show');

  urn.classList.remove('vote-focus');

  clearUrnPhoto(side,config);

  await sleep(20);
}


function ensureWinnerUI(){
  if($('winnerOverlay')) return;

  const div=document.createElement('div');
  div.id='winnerOverlay';
  div.className='winner-overlay';

  div.innerHTML=`
    <div class="winner-box">
      <div class="winner-trophy">🏆</div>
      <img id="winnerPhoto" class="winner-photo" alt="">
      <div class="winner-label">VENCEDOR DA RODADA</div>
      <div id="winnerName" class="winner-name"></div>
      <div id="winnerCode" class="winner-code"></div>
      <div class="winner-score">10.000 VOTOS</div>
      <div class="winner-next">Nova rodada começando...</div>
    </div>
  `;

  document.body.appendChild(div);
}

function showWinner(winner){
  if(!winner) return;

  ensureWinnerUI();

  const overlay=$('winnerOverlay');
  const photo=$('winnerPhoto');

  photo.src=
    winner.side==='flavio'
      ? '/flavio.jpg'
      : '/lula.jpg';

  $('winnerName').textContent=winner.name || '';
  $('winnerCode').textContent=`NÚMERO ${winner.code || ''}`;

  overlay.classList.add('show');

  const key=[
    winner.round,
    winner.side,
    winner.time
  ].join('|');

  if(key !== lastWinnerKey){
    lastWinnerKey=key;

    if('speechSynthesis' in window){
      try{
        const u=new SpeechSynthesisUtterance(
          `${winner.name} venceu a rodada com dez mil votos`
        );

        u.lang='pt-BR';
        u.rate=1.02;
        u.pitch=1;
        speechSynthesis.speak(u);
      }catch{}
    }

    try{
      playConfirmTone();
    }catch{}
  }
}

function hideWinner(){
  $('winnerOverlay')?.classList.remove('show');
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

let pendingSocketState=null;
let renderFramePending=false;

socket.on('state',state=>{
  const key=activityKey(state.lastActivity);

  const shouldAnimate=
    animationReady &&
    key &&
    key!==lastActivityKey;

  if(key) lastActivityKey=key;

  currentState=state;

  if(shouldAnimate){
    enqueueVoteAnimation(
      state.lastActivity,
      state.config
    );
  }

  pendingSocketState=state;

  if(!renderFramePending){
    renderFramePending=true;

    requestAnimationFrame(()=>{
      renderFramePending=false;

      if(pendingSocketState){
        render(pendingSocketState);
        pendingSocketState=null;
      }
    });
  }
});
initial().catch(()=>toast('Falha ao carregar o painel'));
