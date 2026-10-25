(function () {
  const $ = id => document.getElementById(id);
  let adminPin = sessionStorage.getItem('urnaAdminPin') || '';

  function createUI() {
    if ($('liveMoreBtn')) return;

    const style = document.createElement('style');
    style.textContent = `
      /* esconder painel antigo quebrado */
      #adminToggle,
      #adminPanel{
        display:none !important;
      }

      #liveMoreBtn{
        position:fixed;
        right:14px;
        top:48px;
        z-index:99998;
        width:44px;
        height:44px;
        border-radius:14px;
        border:1px solid rgba(255,255,255,.16);
        background:rgba(8,20,32,.95);
        color:#fff;
        font-size:29px;
        line-height:1;
        display:flex;
        align-items:center;
        justify-content:center;
        box-shadow:0 10px 30px rgba(0,0,0,.42);
        touch-action:manipulation;
      }

      #liveMenuBackdrop{
        display:none;
        position:fixed;
        inset:0;
        z-index:99998;
        background:rgba(0,0,0,.62);
        backdrop-filter:blur(3px);
      }

      #liveMenuBackdrop.open{
        display:block;
      }

      #liveMenu{
        position:absolute;
        top:15px;
        right:10px;
        width:min(92vw,420px);
        max-height:88vh;
        overflow:auto;
        box-sizing:border-box;
        border-radius:22px;
        padding:16px;
        background:#07131f;
        border:1px solid #29445b;
        color:#e9f4fb;
        box-shadow:0 25px 80px rgba(0,0,0,.7);
      }

      .lm-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-bottom:12px;
      }

      .lm-head h2{
        margin:0;
        font-size:19px;
      }

      #lmClose{
        width:38px;
        height:38px;
        border-radius:10px;
        border:1px solid #314b61;
        background:#102131;
        color:#fff;
        font-size:18px;
      }

      .lm-box{
        margin-top:10px;
        padding:12px;
        border-radius:14px;
        background:#0a1a28;
        border:1px solid #1c374c;
      }

      .lm-box h3{
        margin:0 0 9px;
        font-size:13px;
      }

      .lm-label{
        display:block;
        margin:7px 0;
        font-size:11px;
        color:#9bb0c0;
        font-weight:800;
      }

      .lm-input,
      .lm-textarea{
        width:100%;
        box-sizing:border-box;
        margin-top:5px;
        padding:11px;
        border-radius:10px;
        border:1px solid #29485f;
        background:#04101b;
        color:#fff;
        outline:none;
      }

      .lm-row{
        display:flex;
        gap:7px;
        margin-top:8px;
      }

      .lm-row > *{
        flex:1;
      }

      .lm-grid{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:7px;
      }

      .lm-btn{
        min-height:42px;
        border-radius:10px;
        border:1px solid #2c4b62;
        background:#102434;
        color:#eaf4fa;
        font-weight:900;
        font-size:11px;
        touch-action:manipulation;
      }

      .lm-btn.blue{
        background:#0c68a7;
        border-color:#2996d4;
        color:#fff;
      }

      .lm-btn.green{
        background:#116a48;
        border-color:#32ba7c;
      }

      .lm-btn.red{
        background:#681d28;
        border-color:#a13b49;
      }

      .lm-btn.full{
        width:100%;
        margin-top:8px;
      }

      #lmError{
        margin-top:8px;
        font-size:11px;
        color:#ff8f9a;
      }

      #lmStatus{
        margin-top:8px;
        font-size:10px;
        color:#96adbd;
      }

      #lmAdminContent{
        display:none;
      }

      #lmAdminContent.unlocked{
        display:block;
      }

      #lmVoice.on{
        background:#126a48;
        border-color:#38d18a;
      }

      .lm-check{
        display:flex;
        align-items:center;
        gap:7px;
        margin-top:9px;
        font-size:10px;
        color:#b3c4cf;
      }

      .lm-check input{
        width:auto;
      }

      @media(max-width:480px){
        #liveMoreBtn{
          top:43px;
          right:8px;
          width:40px;
          height:40px;
        }

        #liveMenu{
          right:6px;
          width:calc(100vw - 12px);
        }
      }
    `;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'liveMoreBtn';
    btn.type = 'button';
    btn.textContent = '⋮';
    btn.setAttribute('aria-label', 'Configurações');
    document.body.appendChild(btn);

    const backdrop = document.createElement('div');
    backdrop.id = 'liveMenuBackdrop';

    backdrop.innerHTML = `
      <div id="liveMenu">
        <div class="lm-head">
          <div>
            <small style="color:#7590a5;font-weight:900">PAINEL DA LIVE</small>
            <h2>Configurações</h2>
          </div>
          <button id="lmClose" type="button">✕</button>
        </div>

        <div id="lmPinBox" class="lm-box">
          <h3>🔐 Desbloquear controles</h3>

          <label class="lm-label">
            PIN administrativo
            <input
              id="lmPin"
              class="lm-input"
              inputmode="numeric"
              placeholder="Digite seu PIN"
            >
          </label>

          <button id="lmUnlock" class="lm-btn blue full" type="button">
            DESBLOQUEAR
          </button>

          <div id="lmError"></div>
        </div>

        <div id="lmAdminContent">

          <div class="lm-box">
            <h3>📡 TikTok LIVE</h3>

            <label class="lm-label">
              @usuário que está fazendo a LIVE
              <input
                id="lmUsername"
                class="lm-input"
                placeholder="ex: meuusuario"
                autocapitalize="off"
                autocomplete="off"
              >
            </label>

            <div class="lm-row">
              <button id="lmConnect" class="lm-btn green" type="button">
                🟢 CONECTAR
              </button>

              <button id="lmDisconnect" class="lm-btn" type="button">
                DESCONECTAR
              </button>
            </div>

            <div id="lmStatus">Desconectado</div>
          </div>

          <div class="lm-box">
            <h3>🔊 Voz</h3>

            <button id="lmVoice" class="lm-btn full" type="button">
              🔇 VOZ DESLIGADA
            </button>
          </div>

          <div class="lm-box">
            <h3>🧪 Teste rápido</h3>

            <div class="lm-grid">
              <button class="lm-btn" data-lm-test="left-comment">
                💬 22
              </button>

              <button class="lm-btn" data-lm-test="right-comment">
                💬 13
              </button>

              <button class="lm-btn" data-lm-test="left-gift">
                🤍🌹 Rosa Branca
              </button>

              <button class="lm-btn" data-lm-test="right-gift">
                🌹 Rosa
              </button>
            </div>
          </div>

          <div class="lm-box">
            <h3>➕ Ajuste manual</h3>

            <div class="lm-grid">
              <button class="lm-btn" id="lmMinusLeft">−1 Flávio</button>
              <button class="lm-btn" id="lmPlusLeft">+1 Flávio</button>
              <button class="lm-btn" id="lmMinusRight">−1 Lula</button>
              <button class="lm-btn" id="lmPlusRight">+1 Lula</button>
            </div>

            <div class="lm-row">
              <button id="lmReset" class="lm-btn red">ZERAR</button>
              <button id="lmNextRound" class="lm-btn">NOVA RODADA</button>
            </div>
          </div>

          <div class="lm-box">
            <h3>⚙️ Configuração da votação</h3>

            <div class="lm-grid">
              <label class="lm-label">
                Nome esquerda
                <input id="lmLeftName" class="lm-input">
              </label>

              <label class="lm-label">
                Nome direita
                <input id="lmRightName" class="lm-input">
              </label>

              <label class="lm-label">
                Número esquerda
                <input id="lmLeftCode" class="lm-input">
              </label>

              <label class="lm-label">
                Número direita
                <input id="lmRightCode" class="lm-input">
              </label>
            </div>

            <label class="lm-label">
              Presentes esquerda
              <textarea id="lmLeftGifts" class="lm-textarea" rows="2"></textarea>
            </label>

            <label class="lm-label">
              Presentes direita
              <textarea id="lmRightGifts" class="lm-textarea" rows="2"></textarea>
            </label>

            <label class="lm-check">
              <input id="lmExact" type="checkbox" checked>
              Só contar comentário exatamente igual ao número
            </label>

            <button id="lmSave" class="lm-btn blue full">
              💾 SALVAR CONFIGURAÇÃO
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
  }

  async function post(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Pin': adminPin
      },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Erro');
    }

    return data;
  }

  async function loadState() {
    try {
      const r = await fetch('/api/state?menu=' + Date.now(), {
        cache: 'no-store'
      });

      const state = await r.json();

      const c = state.config || {};

      $('lmLeftName').value = c.leftName || '';
      $('lmRightName').value = c.rightName || '';
      $('lmLeftCode').value = c.leftCode || '22';
      $('lmRightCode').value = c.rightCode || '13';

      $('lmLeftGifts').value =
        (c.leftGiftAliases || []).join(', ');

      $('lmRightGifts').value =
        (c.rightGiftAliases || []).join(', ');

      $('lmExact').checked =
        c.exactCommentOnly !== false;

      if (state.connection?.username) {
        $('lmUsername').value =
          state.connection.username;
      }

      $('lmStatus').textContent =
        state.connection?.message || 'Desconectado';
    } catch {}
  }

  function unlockUI() {
    $('lmPinBox').style.display = 'none';
    $('lmAdminContent').classList.add('unlocked');
    loadState();
  }

  async function unlock() {
    adminPin = String($('lmPin').value || '').trim();

    if (!adminPin) {
      $('lmError').textContent = 'Digite o PIN.';
      return;
    }

    try {
      await post('/api/admin/check');

      sessionStorage.setItem(
        'urnaAdminPin',
        adminPin
      );

      $('lmError').textContent = '';

      unlockUI();
    } catch (e) {
      $('lmError').textContent =
        '❌ ' + e.message;
    }
  }

  async function adjust(side, delta) {
    try {
      if (delta > 0) {
        await post('/api/manual-vote', {
          side,
          amount: delta
        });
      } else {
        await post('/api/manual-adjust', {
          side,
          delta
        });
      }
    } catch (e) {
      alert(e.message);
    }
  }

  function bind() {
    createUI();

    $('liveMoreBtn').onclick = () => {
      $('liveMenuBackdrop').classList.add('open');

      if (adminPin) {
        post('/api/admin/check')
          .then(unlockUI)
          .catch(() => {
            adminPin = '';
            sessionStorage.removeItem('urnaAdminPin');
            $('lmPinBox').style.display = 'block';
            $('lmAdminContent').classList.remove('unlocked');
          });
      }
    };

    $('lmClose').onclick = () => {
      $('liveMenuBackdrop').classList.remove('open');
    };

    $('lmUnlock').onclick = unlock;

    $('lmPin').addEventListener('keydown', e => {
      if (e.key === 'Enter') unlock();
    });

    $('lmConnect').onclick = async () => {
      const username =
        String($('lmUsername').value || '')
          .trim()
          .replace(/^@/, '');

      if (!username) {
        $('lmStatus').textContent =
          'Digite o usuário do TikTok.';
        return;
      }

      $('lmStatus').textContent =
        'Conectando...';

      try {
        await post('/api/connect', {
          username
        });

        $('lmStatus').textContent =
          '✅ LIVE conectada';
      } catch (e) {
        $('lmStatus').textContent =
          '❌ ' + e.message;
      }
    };

    $('lmDisconnect').onclick = async () => {
      try {
        await post('/api/disconnect');
        $('lmStatus').textContent =
          'Desconectado';
      } catch (e) {
        $('lmStatus').textContent =
          '❌ ' + e.message;
      }
    };

    $('lmVoice').onclick = async () => {
      const enabled =
        localStorage.getItem('urnaVoiceEnabled') === '1';

      if (enabled) {
        localStorage.removeItem('urnaVoiceEnabled');

        if (typeof window.disableVoice === 'function') {
          window.disableVoice();
        }

        $('lmVoice').classList.remove('on');
        $('lmVoice').textContent =
          '🔇 VOZ DESLIGADA';
      } else {
        localStorage.setItem(
          'urnaVoiceEnabled',
          '1'
        );

        if (typeof window.enableVoice === 'function') {
          try {
            await window.enableVoice();
          } catch {}
        }

        $('lmVoice').classList.add('on');
        $('lmVoice').textContent =
          '🔊 VOZ LIGADA';
      }
    };

    document.querySelectorAll('[data-lm-test]')
      .forEach(btn => {
        btn.onclick = async () => {
          const stateRes =
            await fetch('/api/state?test=' + Date.now());

          const state =
            await stateRes.json();

          const c = state.config;

          const map = {
            'left-comment': {
              type: 'comment',
              value: c.leftCode
            },

            'right-comment': {
              type: 'comment',
              value: c.rightCode
            },

            'left-gift': {
              type: 'gift',
              value:
                c.leftGiftAliases?.[0] ||
                'White Rose'
            },

            'right-gift': {
              type: 'gift',
              value:
                c.rightGiftAliases?.[0] ||
                'Rose'
            }
          };

          try {
            await post(
              '/api/simulate',
              map[btn.dataset.lmTest]
            );
          } catch (e) {
            alert(e.message);
          }
        };
      });

    $('lmPlusLeft').onclick =
      () => adjust('flavio', 1);

    $('lmMinusLeft').onclick =
      () => adjust('flavio', -1);

    $('lmPlusRight').onclick =
      () => adjust('lula', 1);

    $('lmMinusRight').onclick =
      () => adjust('lula', -1);

    $('lmReset').onclick = async () => {
      if (!confirm('Zerar todos os votos?')) return;

      try {
        await post('/api/reset', {
          nextRound: false
        });
      } catch (e) {
        alert(e.message);
      }
    };

    $('lmNextRound').onclick = async () => {
      if (!confirm('Iniciar nova rodada?')) return;

      try {
        await post('/api/reset', {
          nextRound: true
        });
      } catch (e) {
        alert(e.message);
      }
    };

    $('lmSave').onclick = async () => {
      try {
        await post('/api/config', {
          leftName:
            $('lmLeftName').value.trim(),

          rightName:
            $('lmRightName').value.trim(),

          leftCode:
            $('lmLeftCode').value.trim(),

          rightCode:
            $('lmRightCode').value.trim(),

          leftGiftAliases:
            $('lmLeftGifts')
              .value
              .split(',')
              .map(x => x.trim())
              .filter(Boolean),

          rightGiftAliases:
            $('lmRightGifts')
              .value
              .split(',')
              .map(x => x.trim())
              .filter(Boolean),

          exactCommentOnly:
            $('lmExact').checked,

          giftVotesPerItem: 1
        });

        alert('Configuração salva.');
      } catch (e) {
        alert(e.message);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      bind
    );
  } else {
    bind();
  }
})();
