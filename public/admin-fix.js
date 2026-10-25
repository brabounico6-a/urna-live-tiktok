(function () {
  let pin = sessionStorage.getItem('urnaAdminPin') || '';

  const $ = id => document.getElementById(id);

  function msg(text, ok = false) {
    let el = document.getElementById('adminFixMessage');

    if (!el) {
      el = document.createElement('div');
      el.id = 'adminFixMessage';
      el.style.marginTop = '10px';
      el.style.padding = '9px';
      el.style.borderRadius = '9px';
      el.style.fontSize = '12px';

      const auth = $('authBox');
      if (auth) auth.appendChild(el);
    }

    el.textContent = text;
    el.style.background = ok ? '#103c2a' : '#481820';
    el.style.color = '#fff';
  }

  async function post(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Pin': pin
      },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Erro');
    }

    return data;
  }

  function showControls() {
    const auth = $('authBox');
    const content = $('adminContent');

    if (auth) auth.style.display = 'none';

    if (content) {
      content.classList.remove('hidden');
      content.style.display = 'block';
      content.style.visibility = 'visible';
      content.style.opacity = '1';
    }
  }

  async function unlock() {
    const input = $('pinInput');

    if (!input) {
      alert('Campo do PIN não encontrado');
      return;
    }

    pin = String(input.value || '').trim();

    if (!pin) {
      msg('Digite o PIN.');
      return;
    }

    try {
      await post('/api/admin/check');

      sessionStorage.setItem('urnaAdminPin', pin);

      showControls();

      msg('✅ Painel desbloqueado', true);
    } catch (e) {
      msg('❌ ' + e.message);
    }
  }

  async function connectLive() {
    const input = $('usernameInput');

    if (!input) {
      alert('Campo do usuário TikTok não encontrado');
      return;
    }

    const username = String(input.value || '')
      .trim()
      .replace(/^@/, '');

    if (!username) {
      alert('Digite o usuário do TikTok');
      return;
    }

    const btn = $('connectBtn');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'CONECTANDO...';
    }

    try {
      await post('/api/connect', { username });

      if ($('connectionMessage')) {
        $('connectionMessage').textContent =
          '✅ LIVE conectada em @' + username;
      }

      if (btn) btn.textContent = '✅ LIVE CONECTADA';
    } catch (e) {
      if ($('connectionMessage')) {
        $('connectionMessage').textContent =
          '❌ ' + e.message;
      }

      if (btn) btn.textContent = 'CONECTAR LIVE';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function disconnectLive() {
    try {
      await post('/api/disconnect');

      if ($('connectionMessage')) {
        $('connectionMessage').textContent =
          'Desconectado';
      }
    } catch (e) {
      alert(e.message);
    }
  }

  function bind() {
    const unlockBtn = $('unlockBtn');
    const pinInput = $('pinInput');
    const connectBtn = $('connectBtn');
    const disconnectBtn = $('disconnectBtn');

    if (unlockBtn) {
      unlockBtn.onclick = function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        unlock();
        return false;
      };
    }

    if (pinInput) {
      pinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          unlock();
        }
      });
    }

    if (connectBtn) {
      connectBtn.onclick = function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        connectLive();
        return false;
      };
    }

    if (disconnectBtn) {
      disconnectBtn.onclick = function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        disconnectLive();
        return false;
      };
    }

    if (pin) {
      post('/api/admin/check')
        .then(showControls)
        .catch(() => {
          sessionStorage.removeItem('urnaAdminPin');
          pin = '';
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
