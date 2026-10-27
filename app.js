/*
 * PVP Tournier — app shell, PeerJS transport and UI rendering.
 * The pure draft/match rules live in logic.js.
 */
(function () {
  'use strict';

  const L = window.PVPLogic;

  const LS_USER = 'pvpt.username';
  const LS_RULES = 'pvpt.rules';
  const DEFAULT_POOL = [
    'sword',
    'axe',
    'diapot',
    'nethpot',
    'diasmp',
    'cart',
    'mace',
    'spearmace',
    'uhc',
    'smp',
    'vanilla'
  ];

  const FALLBACK_FACE =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" fill="#1b2114"/>' +
        '<circle cx="32" cy="25" r="11" fill="#46523a"/>' +
        '<path d="M11 61c2-13 10-20 21-20s19 7 21 20" fill="#46523a"/>' +
      '</svg>'
    );

  const FALLBACK_FULL =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640">' +
        '<circle cx="256" cy="190" r="92" fill="#2c3624"/>' +
        '<path d="M72 640c16-128 86-206 184-206s168 78 184 206" fill="#2c3624"/>' +
      '</svg>'
    );

  const STATUS_LABEL = {
    pending: 'Pending',
    accepted: 'Accepted',
    declined: 'Declined',
    busy: 'In a match',
    offline: 'Offline',
    expired: 'No answer',
    canceled: 'Canceled'
  };

  const S = {
    username: '',
    peerId: '',
    status: 'idle',
    online: false,
    errorMessage: '',
    peer: null,

    conn: null,
    role: null,
    isHost: false,
    game: null,
    screen: 'lobby',

    incoming: [],
    sent: [],
    requestsTab: 'incoming',

    modalType: null,
    modalDismissible: true,
    lastFocus: null,
    chooserStep: -1,

    pending: false,
    pendingPick: null,
    localVote: null,
    awaitingState: false,
    stateSynced: false,
    pendingTimer: null,
    stateTimer: null,

    leaving: false,
    retryCount: 0,
    sendingDuel: false,
    duelDraft: null,
    confettiKey: '',
    faceTimer: null
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function kitArt(kit) {
    return (
      '<img class="kit-art' + (kit.mono ? ' is-mono' : '') + '" src="icons/' +
      encodeURIComponent(kit.art || kit.id) + '.svg" alt="" ' +
      'width="1080" height="1080" draggable="false" />'
    );
  }

  function kitIcon(kit, extra) {
    return (
      '<span class="kit-ic ' + (extra || '') + '" style="--kc:' + kit.color + '" aria-hidden="true">' +
      kitArt(kit) +
      '</span>'
    );
  }

  function faceUrl(name, size) {
    return 'https://visage.surgeplay.com/face/' + (size || 64) + '/' + encodeURIComponent(name);
  }

  function fullUrl(name, size) {
    return 'https://visage.surgeplay.com/full/' + (size || 512) + '/' + encodeURIComponent(name);
  }

  function avatarHtml(name, extraClass) {
    const valid = name && !L.validateUsername(name);
    return (
      '<span class="avatar ' + (extraClass || '') + '">' +
      '<img src="' + (valid ? faceUrl(name) : FALLBACK_FACE) + '" alt="' + esc(name) +
      ' skin" loading="lazy" data-skin="' + esc(name) + '" />' +
      '</span>'
    );
  }

  function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function showScreen(name) {
    if (S.screen === name) return;
    S.screen = name;
    const map = {
      lobby: 'screen-lobby',
      draft: 'screen-draft',
      match: 'screen-match',
      victory: 'screen-victory'
    };
    $$('.screen').forEach(function (section) {
      section.classList.toggle('is-active', section.id === map[name]);
    });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (err) {
      window.scrollTo(0, 0);
    }
  }

  function setNetStatus(kind, label) {
    const pill = $('#netPill');
    const text = $('#netLabel');
    if (!pill || !text) return;
    pill.classList.remove('is-online', 'is-connecting', 'is-error');
    if (kind === 'online') pill.classList.add('is-online');
    if (kind === 'connecting') pill.classList.add('is-connecting');
    if (kind === 'error') pill.classList.add('is-error');
    text.textContent = label;
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                             */
  /* ------------------------------------------------------------------ */

  function toast(message, type, ms) {
    const root = $('#toastRoot');
    if (!root) return;
    const node = document.createElement('div');
    node.className = 'toast toast-' + (type || 'info');
    node.innerHTML = '<span class="toast-dot"></span><span>' + esc(message) + '</span>';
    root.appendChild(node);

    while (root.children.length > 4) root.removeChild(root.firstElementChild);

    requestAnimationFrame(function () {
      node.classList.add('show');
    });
    window.setTimeout(function () {
      node.classList.remove('show');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, ms || 4200);
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                             */
  /* ------------------------------------------------------------------ */

  function openModal(options) {
    closeModal(true);
    S.modalType = options.type || 'generic';
    S.modalDismissible = options.dismissible !== false;
    S.lastFocus = document.activeElement;

    const root = $('#modalRoot');
    root.innerHTML =
      '<div class="modal-backdrop" ' + (S.modalDismissible ? 'data-close' : '') + '></div>' +
      '<div class="modal ' + (options.size ? 'modal-' + options.size : '') + '" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
        '<div class="modal-head">' +
          '<div>' +
            '<div class="modal-eyebrow">' + esc(options.eyebrow || 'PVP Tournier') + '</div>' +
            '<h2 class="modal-title" id="modalTitle">' + esc(options.title || '') + '</h2>' +
            (options.subtitle ? '<p class="modal-sub">' + esc(options.subtitle) + '</p>' : '') +
          '</div>' +
          (S.modalDismissible ? '<button class="modal-x" type="button" data-close aria-label="Close dialog">✕</button>' : '') +
        '</div>' +
        '<div class="modal-body">' + (options.body || '') + '</div>' +
        (options.footer ? '<div class="modal-foot">' + options.footer + '</div>' : '') +
      '</div>';

    root.classList.add('is-open');
    document.body.classList.add('modal-open');

    if (typeof options.onMount === 'function') {
      options.onMount(root.querySelector('.modal'));
    }

    window.setTimeout(function () {
      const focusTarget =
        root.querySelector('[data-autofocus]') ||
        root.querySelector('.modal input:not([readonly]), .modal select, .modal textarea, .modal .btn');
      if (focusTarget) focusTarget.focus();
    }, 40);
  }

  function closeModal(instant) {
    const root = $('#modalRoot');
    if (!root) return;
    const wasOpen = root.classList.contains('is-open');
    root.classList.remove('is-open');
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    S.modalType = null;
    S.chooserStep = -1;

    if (wasOpen && !instant && S.lastFocus && document.contains(S.lastFocus)) {
      window.setTimeout(function () {
        try {
          S.lastFocus.focus();
        } catch (err) {
          /* ignore */
        }
      }, 30);
    }
  }

  function refreshRequests() {
    if (S.modalType !== 'requests') return;
    const body = $('#modalRoot .modal-body');
    if (body) body.innerHTML = requestsBody();
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    S.duelDraft = loadDraftRules();

    let savedName = '';
    try {
      savedName = localStorage.getItem(LS_USER) || '';
    } catch (err) {
      savedName = '';
    }
    const input = $('#usernameInput');
    if (input && savedName && !L.validateUsername(savedName)) {
      input.value = savedName;
    }

    updateFaceImg($('#lobbyFace'), (input && input.value) || '');
    renderLobby();
    setNetStatus('idle', 'Standby');
    bindEvents();

    if (!window.Peer) loadPeerFallback();
  }

  function bindEvents() {
    const connectBtn = $('#connectBtn');
    if (connectBtn) connectBtn.addEventListener('click', onConnectClick);

    const usernameInput = $('#usernameInput');
    if (usernameInput) {
      usernameInput.addEventListener('input', function () {
        const value = usernameInput.value.trim();
        clearTimeout(S.faceTimer);
        S.faceTimer = window.setTimeout(function () {
          updateFaceImg($('#lobbyFace'), value);
        }, 320);
        if (!S.online) {
          const hint = $('#identityHint');
          if (hint) {
            hint.classList.remove('error');
            hint.textContent = '3–16 characters · letters, numbers and underscore.';
          }
        }
      });
      usernameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          onConnectClick();
        }
      });
    }

    const sendBtn = $('#sendDuelBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        if (!S.online) {
          focusUsername();
          toast('Enter your Minecraft username first.', 'warn');
          return;
        }
        openSendModal();
      });
    }

    const requestsBtn = $('#viewRequestsBtn');
    if (requestsBtn) {
      requestsBtn.addEventListener('click', function () {
        if (!S.online) {
          focusUsername();
          toast('Enter your Minecraft username first.', 'warn');
          return;
        }
        openRequests('incoming');
      });
    }

    const draftBody = $('#draftBody');
    if (draftBody) draftBody.addEventListener('click', onDraftClick);

    const leaveDraft = $('#leaveDraftBtn');
    if (leaveDraft) leaveDraft.addEventListener('click', openLeaveConfirm);

    const leaveMatch = $('#leaveMatchBtn');
    if (leaveMatch) leaveMatch.addEventListener('click', openLeaveConfirm);

    const voteP1 = $('#voteP1');
    if (voteP1) voteP1.addEventListener('click', function () { castVote('p1'); });

    const voteP2 = $('#voteP2');
    if (voteP2) voteP2.addEventListener('click', function () { castVote('p2'); });

    const backBtn = $('#backToLobbyBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        closeModal(true);
        resetToLobby(true);
      });
    }

    const modalRoot = $('#modalRoot');
    if (modalRoot) modalRoot.addEventListener('click', onModalClick);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && S.modalType && S.modalDismissible) closeModal();
    });

    document.addEventListener(
      'error',
      function (event) {
        const img = event.target;
        if (!img || img.tagName !== 'IMG' || img.dataset.skin === undefined) return;
        if (img.dataset.failed === '1') return;
        img.dataset.failed = '1';
        img.src = img.dataset.kind === 'full' ? FALLBACK_FULL : FALLBACK_FACE;
      },
      true
    );

    window.addEventListener('beforeunload', function () {
      if (S.conn) sendTo(S.conn, { t: 'leave', v: 1 });
    });
  }

  function focusUsername() {
    const input = $('#usernameInput');
    if (!input) return;
    if (!S.online) input.focus();
  }

  function updateFaceImg(img, name) {
    if (!img) return;
    const clean = String(name || '').trim();
    const valid = clean && !L.validateUsername(clean);
    const desired = valid ? faceUrl(clean) : FALLBACK_FACE;
    if (img.getAttribute('src') === desired) return;
    img.dataset.skin = clean;
    img.dataset.failed = '';
    img.src = desired;
    img.alt = valid ? clean + ' skin' : 'Skin preview';
  }

  /* ------------------------------------------------------------------ */
  /* Lobby identity + uplink                                            */
  /* ------------------------------------------------------------------ */

  function onConnectClick() {
    if (S.online) {
      teardownUplink();
      toast('Uplink closed. Enter a username to reconnect.', 'info');
      return;
    }
    if (S.status === 'connecting') return;

    const input = $('#usernameInput');
    const name = input ? input.value.trim() : '';
    const error = L.validateUsername(name);
    if (error) {
      showHint(error, true);
      if (input) input.focus();
      return;
    }

    S.username = name;
    S.peerId = L.peerIdFor(name);
    S.errorMessage = '';
    try {
      localStorage.setItem(LS_USER, name);
    } catch (err) {
      /* ignore storage errors */
    }
    startPeer();
  }

  function showHint(text, isError) {
    const hint = $('#identityHint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('error', !!isError);
  }

  function renderLobby() {
    const input = $('#usernameInput');
    const connected = S.online;
    const connecting = S.status === 'connecting';
    const errored = S.status === 'error';

    if (input) {
      if (connected && S.username) input.value = S.username;
      else if (S.username && document.activeElement !== input) input.value = S.username;
      input.readOnly = connected;
    }

    const name = (S.username || (input ? input.value : '') || '').trim();
    updateFaceImg($('#lobbyFace'), name);

    const connectBtn = $('#connectBtn');
    if (connectBtn) {
      connectBtn.textContent = connected
        ? 'Change'
        : connecting
          ? 'Linking…'
          : errored && S.username
            ? 'Retry link'
            : 'Enter Lobby';
      connectBtn.disabled = connecting;
    }

    const link = $('#linkState');
    if (link) {
      link.className =
        'link-state' +
        (connected ? ' is-online' : connecting ? ' is-connecting' : errored ? ' is-error' : '');
      link.innerHTML =
        '<i></i><span>' +
        esc(connected ? 'Link live' : connecting ? 'Linking…' : errored ? 'Link error' : 'Not connected') +
        '</span>';
    }

    if (connected) {
      showHint('Linked as ' + S.username + ' · duel ID ' + S.peerId + ' · keep this tab open.', false);
    } else if (connecting) {
      showHint('Opening a direct peer link — this can take a few seconds.', false);
    } else if (errored) {
      showHint(S.errorMessage || 'The peer link could not be established.', true);
    } else {
      showHint('3–16 characters · letters, numbers and underscore.', false);
    }

    if (connected) {
      setNetStatus('online', 'Online');
    } else if (connecting) {
      setNetStatus('connecting', 'Linking…');
    } else if (errored) {
      setNetStatus('error', 'Link error');
    } else {
      setNetStatus('idle', 'Standby');
    }

    const sendBtn = $('#sendDuelBtn');
    if (sendBtn) sendBtn.disabled = !connected;

    const requestsBtn = $('#viewRequestsBtn');
    if (requestsBtn) requestsBtn.disabled = !connected;

    const badge = $('#requestBadge');
    if (badge) {
      badge.textContent = String(S.incoming.length);
      badge.classList.toggle('is-zero', S.incoming.length === 0);
      badge.setAttribute('aria-label', S.incoming.length + ' incoming duel requests');
    }

    const sub = $('#requestsSub');
    if (sub) {
      sub.textContent =
        S.incoming.length > 0
          ? S.incoming.length + ' waiting for an answer'
          : 'No incoming requests';
    }

    const micro = $('#lobbyMicro');
    if (micro) {
      micro.textContent = connected
        ? 'Connected as ' + S.username + ' — both players must keep this tab open.'
        : 'Both players need this page open in their browser to connect.';
    }
  }

  function focusUsername() {
    const input = $('#usernameInput');
    if (!input) return;
    if (!S.online) input.focus();
  }

  function updateFaceImg(img, name) {
    if (!img) return;
    const clean = String(name || '').trim();
    const valid = clean && !L.validateUsername(clean);
    const desired = valid ? faceUrl(clean) : FALLBACK_FACE;
    if (img.getAttribute('src') === desired) return;
    img.dataset.skin = clean;
    img.dataset.failed = '';
    img.src = desired;
    img.alt = valid ? clean + ' skin' : 'Skin preview';
  }

  function loadDraftRules() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_RULES) || 'null');
      const normal = raw ? L.normalizeRules(raw) : null;
      if (normal && normal.ok) return normal.rules;
    } catch (err) {
      /* ignore broken storage */
    }
    return {
      pool: DEFAULT_POOL.slice(),
      format: 3,
      banCount: 1,
      order: 'alternate',
      firstBan: 'p1',
      firstPick: 'p1'
    };
  }

  function saveDraftRules() {
    try {
      localStorage.setItem(LS_RULES, JSON.stringify(S.duelDraft));
    } catch (err) {
      /* ignore storage errors */
    }
  }

  /* ------------------------------------------------------------------ */
  /* PeerJS uplink                                                      */
  /* ------------------------------------------------------------------ */

  function startPeer() {
    if (!window.Peer) {
      loadPeerFallback();
      toast('The peer link is still loading — try again in a moment.', 'warn');
      return;
    }

    if (S.peer) {
      const old = S.peer;
      S.peer = null;
      try {
        old.destroy();
      } catch (err) {
        /* ignore */
      }
    }

    clearTimers();
    resetTransient();
    S.status = 'connecting';
    S.online = false;
    S.errorMessage = '';
    S.retryCount = 0;
    renderLobby();

    let peer;
    try {
      peer = new window.Peer(S.peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });
    } catch (err) {
      S.status = 'error';
      S.errorMessage = 'Could not start the peer link: ' + err.message;
      renderLobby();
      return;
    }

    S.peer = peer;

    peer.on('open', function () {
      if (S.peer !== peer) return;
      S.online = true;
      S.status = 'online';
      S.errorMessage = '';
      S.retryCount = 0;
      renderLobby();
      toast('Duel link established.', 'success');
    });

    peer.on('connection', handleIncomingConnection);

    peer.on('error', function (err) {
      handlePeerError(err, peer);
    });

    peer.on('disconnected', function () {
      if (S.peer !== peer) return;
      S.online = false;
      S.status = 'connecting';
      renderLobby();
      scheduleReconnect(peer);
    });

    peer.on('close', function () {
      if (S.peer !== peer) return;
      S.online = false;
      if (S.status !== 'error') S.status = 'idle';
      renderLobby();
    });
  }

  function teardownUplink() {
    teardownPeerSession();
    S.username = '';
    S.peerId = '';
    S.errorMessage = '';
    showScreen('lobby');
    renderLobby();
    const input = $('#usernameInput');
    if (input) {
      input.readOnly = false;
      input.focus();
    }
  }

  function teardownPeerSession() {
    clearTimers();
    resetTransient();
    if (S.conn) {
      const conn = S.conn;
      S.conn = null;
      try {
        conn.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (S.peer) {
      const peer = S.peer;
      S.peer = null;
      try {
        peer.destroy();
      } catch (err) {
        /* ignore */
      }
    }
    S.online = false;
    S.status = 'idle';
    S.pending = false;
    S.pendingPick = null;
    S.localVote = null;
    S.awaitingState = false;
  }

  function resetTransient() {
    S.incoming.forEach(function (req) {
      try {
        req.conn.close();
      } catch (err) {
        /* ignore */
      }
    });
    S.sent.forEach(function (req) {
      if (req.timer) clearTimeout(req.timer);
      try {
        req.conn.close();
      } catch (err) {
        /* ignore */
      }
    });
    S.incoming = [];
    S.sent = [];
  }

  function clearTimers() {
    if (S.pendingTimer) {
      clearTimeout(S.pendingTimer);
      S.pendingTimer = null;
    }
    if (S.stateTimer) {
      clearTimeout(S.stateTimer);
      S.stateTimer = null;
    }
  }

  function handlePeerError(err, peer) {
    const type = err && err.type;

    if (type === 'unavailable-id') {
      if (S.peer === peer) S.peer = null;
      try {
        peer.destroy();
      } catch (destroyErr) {
        /* ignore */
      }
      S.online = false;
      S.status = 'error';
      S.errorMessage =
        'That username is already online. Close the other tab (or wait a few seconds) and retry.';
      renderLobby();
      toast('Username already online — try again in a few seconds.', 'error', 7000);
      return;
    }

    if (type === 'peer-unavailable') {
      const message = String((err && err.message) || '');
      const req = S.sent.find(function (item) {
        return item.status === 'pending' && message.indexOf(item.peerId) !== -1;
      });
      if (req) {
        if (req.timer) clearTimeout(req.timer);
        req.status = 'offline';
        try {
          req.conn.close();
        } catch (closeErr) {
          /* ignore */
        }
        renderLobby();
        refreshRequests();
        toast(req.to + ' is not online right now.', 'error', 5200);
      } else {
        toast('That player could not be reached.', 'error', 4200);
      }
      return;
    }

    if (type === 'browser-incompatible') {
      S.status = 'error';
      S.online = false;
      S.errorMessage = 'This browser does not support WebRTC. Try Chrome, Edge, Firefox or Safari.';
      renderLobby();
      return;
    }

    if (type === 'invalid-id' || type === 'invalid-key') {
      S.status = 'error';
      S.online = false;
      S.errorMessage = 'The generated peer ID was rejected. Change your username and retry.';
      renderLobby();
      return;
    }

    if (
      type === 'network' ||
      type === 'server-error' ||
      type === 'socket-error' ||
      type === 'socket-closed' ||
      type === 'ssl-unavailable'
    ) {
      if (S.peer !== peer) return;
      S.online = false;
      if (S.status !== 'error') {
        S.status = 'connecting';
        renderLobby();
        scheduleReconnect(peer);
      }
      return;
    }

    console.warn('[PVP Tournier] PeerJS error', err);
  }

  function scheduleReconnect(peer) {
    if (S.peer !== peer) return;
    if (S.retryCount >= 4) {
      S.online = false;
      S.status = 'error';
      S.errorMessage = 'Could not reach the PeerJS broker. Check your connection and press Retry link.';
      renderLobby();
      return;
    }
    S.retryCount += 1;
    const delay = 1200 * S.retryCount;
    window.setTimeout(function () {
      if (S.peer !== peer) return;
      try {
        peer.reconnect();
      } catch (err) {
        /* ignore */
      }
    }, delay);
  }

  function loadPeerFallback() {
    if (window.Peer || document.getElementById('peerFallbackScript')) return;
    const script = document.createElement('script');
    script.id = 'peerFallbackScript';
    script.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
    script.onload = function () {
      if (S.status === 'error' && !S.username) {
        S.status = 'idle';
        renderLobby();
      }
    };
    script.onerror = function () {
      S.status = 'error';
      S.errorMessage = 'PeerJS could not be loaded. Check your connection or content blocker, then reload.';
      renderLobby();
    };
    document.body.appendChild(script);
  }

  /* ------------------------------------------------------------------ */
  /* PeerJS data protocol                                               */
  /* ------------------------------------------------------------------ */

  function sendTo(conn, payload) {
    if (!conn) return false;
    try {
      if (conn.open) {
        conn.send(payload);
        return true;
      }
      if (typeof conn.once === 'function') {
        conn.once('open', function () {
          try {
            if (conn.open) conn.send(payload);
          } catch (err) {
            /* connection went away before it opened */
          }
        });
        return true;
      }
      conn.send(payload);
      return true;
    } catch (err) {
      return false;
    }
  }

  function broadcastState(event) {
    if (!S.conn || !S.isHost || !S.game) return;
    sendTo(S.conn, { t: 'state', v: 1, game: S.game, event: event || null });
  }

  function handleIncomingConnection(conn) {
    conn.on('data', function (data) {
      onData(conn, data);
    });
    conn.on('close', function () {
      onConnClosed(conn);
    });
    conn.on('error', function () {
      onConnError(conn);
    });
  }

  function onData(conn, raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        return;
      }
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') {
      sendTo(conn, { t: 'pong', v: 1 });
      return;
    }
    if (msg.t === 'pong') return;
    if (Number(msg.v) !== 1) return;

    switch (msg.t) {
      case 'duel':
        handleDuelMessage(conn, msg);
        break;
      case 'duel-response':
        handleDuelResponse(conn, msg);
        break;
      case 'duel-cancel':
        handleDuelCancel(conn, msg);
        break;
      case 'state':
        handleRemoteState(conn, msg);
        break;
      case 'action':
        handleRemoteAction(conn, msg);
        break;
      case 'game-error':
        handleGameError(conn, msg);
        break;
      case 'leave':
        handleRemoteLeave(conn, msg);
        break;
      default:
        break;
    }
  }

  function handleDuelMessage(conn, msg) {
    const from = String(msg.from == null ? '' : msg.from).trim();
    const id = String(msg.id == null ? '' : msg.id);

    if (!id || !from || L.validateUsername(from) || !msg.rules) {
      declineConn(conn, id, 'invalid');
      return;
    }

    if (S.game || S.conn) {
      declineConn(conn, id, 'busy');
      return;
    }

    // Resolve crossed requests deterministically: the lexicographically smaller
    // username keeps its outgoing request, the other side accepts instead.
    const crossed = S.sent.find(function (req) {
      return req.status === 'pending' && req.to.toLowerCase() === from.toLowerCase();
    });
    if (crossed) {
      if (S.username.toLowerCase() < from.toLowerCase()) {
        declineConn(conn, id, 'busy');
        return;
      }
      crossed.status = 'canceled';
      if (crossed.timer) clearTimeout(crossed.timer);
      sendTo(crossed.conn, { t: 'duel-cancel', v: 1, id: crossed.id });
      try {
        crossed.conn.close();
      } catch (err) {
        /* ignore */
      }
      toast("Crossed requests — keeping " + from + "'s challenge.", 'info', 4200);
    }

    const already = S.incoming.some(function (req) {
      return req.id === id;
    });
    if (already) return;

    const normal = L.normalizeRules(msg.rules);
    if (!normal.ok) {
      declineConn(conn, id, 'invalid');
      return;
    }

    if (S.incoming.length >= 8) {
      declineConn(conn, id, 'busy');
      return;
    }

    S.incoming.unshift({
      id: id,
      from: from,
      rules: normal.rules,
      conn: conn,
      createdAt: Date.now(),
      status: 'pending'
    });

    renderLobby();
    refreshRequests();
    popBadge();
    toast(from + ' challenged you to a duel.', 'info', 5400);
  }

  function declineConn(conn, id, reason) {
    sendTo(conn, {
      t: 'duel-response',
      v: 1,
      id: id || '',
      accepted: false,
      reason: reason || 'declined'
    });
    window.setTimeout(function () {
      try {
        conn.close();
      } catch (err) {
        /* ignore */
      }
    }, 180);
  }

  function handleDuelResponse(conn, msg) {
    const req = S.sent.find(function (item) {
      return item.id === msg.id && item.conn === conn;
    });
    if (!req) {
      if (msg.accepted) sendTo(conn, { t: 'leave', v: 1 });
      return;
    }

    if (req.timer) clearTimeout(req.timer);

    if (req.status !== 'pending') {
      if (msg.accepted) sendTo(conn, { t: 'leave', v: 1 });
      try {
        conn.close();
      } catch (err) {
        /* ignore */
      }
      return;
    }

    if (msg.accepted) {
      if (S.game) {
        sendTo(conn, { t: 'leave', v: 1 });
        try {
          conn.close();
        } catch (err) {
          /* ignore */
        }
        return;
      }

      const opponent =
        msg.from && !L.validateUsername(String(msg.from)) ? String(msg.from) : req.to;

      req.status = 'accepted';

      S.sent.forEach(function (item) {
        if (item !== req) {
          item.status = 'canceled';
          if (item.timer) clearTimeout(item.timer);
          try {
            item.conn.close();
          } catch (err) {
            /* ignore */
          }
        }
      });
      S.incoming.forEach(function (item) {
        declineConn(item.conn, item.id, 'busy');
      });

      S.sent = [];
      S.incoming = [];
      S.conn = conn;
      S.role = 'p1';
      S.isHost = true;
      S.leaving = false;
      S.pending = false;
      S.pendingPick = null;
      S.localVote = null;
      S.awaitingState = false;
      S.confettiKey = '';
      S.game = L.createGame({
        id: req.id,
        rules: req.rules,
        players: { p1: S.username, p2: opponent }
      });

      closeModal(true);
      renderGame();
      broadcastState(null);
      toast('Duel accepted by ' + opponent + ' — draft starts now.', 'success', 5000);
      return;
    }

    const reason = msg.reason;
    req.status = reason === 'busy' ? 'busy' : reason === 'invalid' ? 'canceled' : 'declined';
    try {
      conn.close();
    } catch (err) {
      /* ignore */
    }
    renderLobby();
    refreshRequests();
    toast(
      reason === 'busy'
        ? req.to + ' is already in another duel.'
        : req.to + ' declined your duel request.',
      'warn',
      4600
    );
  }

  function handleDuelCancel(conn, msg) {
    const req = S.incoming.find(function (item) {
      return item.conn === conn && (!msg.id || item.id === msg.id);
    });
    if (!req) return;
    S.incoming = S.incoming.filter(function (item) {
      return item !== req;
    });
    try {
      conn.close();
    } catch (err) {
      /* ignore */
    }
    renderLobby();
    refreshRequests();
    toast(req.from + ' cancelled the duel request.', 'info', 4000);
  }

  function handleRemoteState(conn, msg) {
    if (conn !== S.conn || S.role !== 'p2') return;
    const game = msg.game;
    if (!L.isValidGame(game)) return;
    if (String(game.players.p2.username).toLowerCase() !== S.username.toLowerCase()) return;

    S.game = game;
    S.pending = false;
    S.pendingPick = null;
    S.localVote = null;
    S.awaitingState = false;
    S.stateSynced = true;
    if (S.stateTimer) {
      clearTimeout(S.stateTimer);
      S.stateTimer = null;
    }
    if (S.pendingTimer) {
      clearTimeout(S.pendingTimer);
      S.pendingTimer = null;
    }

    renderGame();
    if (msg.event) handleGameEvent(msg.event, false);
  }

  function handleRemoteAction(conn, msg) {
    if (conn !== S.conn || !S.isHost || !S.game) return;
    const result = L.applyAction(S.game, 'p2', msg.action);
    if (!result.ok) {
      sendTo(conn, { t: 'game-error', v: 1, message: result.error });
      return;
    }
    commitHost(result);
  }

  function handleGameError(conn, msg) {
    if (conn !== S.conn) return;
    S.pending = false;
    S.pendingPick = null;
    S.localVote = null;
    clearTimers();
    renderGame();
    toast(String(msg.message || 'The rival rejected that action.'), 'error', 4600);
  }

  function handleRemoteLeave(conn, msg) {
    if (S.conn && conn !== S.conn) return;
    const name = S.game ? S.game.players[L.otherRole(S.role)].username : 'Your rival';
    toast(name + ' left the duel. Back to the lobby.', 'warn', 4800);
    resetToLobby(false);
  }

  function onConnClosed(conn) {
    const wasIncoming = S.incoming.some(function (req) {
      return req.conn === conn;
    });
    S.incoming = S.incoming.filter(function (req) {
      return req.conn !== conn;
    });

    S.sent.forEach(function (req) {
      if (req.conn === conn && req.status === 'pending') {
        req.status = 'offline';
        if (req.timer) clearTimeout(req.timer);
      }
    });

    if (wasIncoming) refreshRequests();
    renderLobby();

    if (S.conn === conn) {
      S.conn = null;
      S.pending = false;
      S.pendingPick = null;
      S.localVote = null;
      clearTimers();
      if (S.game && !S.leaving) showDisconnect();
    }
  }

  function onConnError(conn) {
    S.sent.forEach(function (req) {
      if (req.conn === conn && req.status === 'pending') {
        req.status = 'offline';
        if (req.timer) clearTimeout(req.timer);
      }
    });
    refreshRequests();
    renderLobby();
  }

  function popBadge() {
    const badge = $('#requestBadge');
    if (!badge) return;
    badge.classList.remove('is-pop');
    void badge.offsetWidth;
    badge.classList.add('is-pop');
  }

  /* ------------------------------------------------------------------ */
  /* Send-request modal                                                 */
  /* ------------------------------------------------------------------ */

  function openSendModal() {
    if (!S.online) {
      focusUsername();
      toast('Enter your Minecraft username first.', 'warn');
      return;
    }

    S.duelDraft = S.duelDraft || loadDraftRules();

    openModal({
      type: 'send',
      eyebrow: 'Duel request',
      title: 'Send a challenge',
      subtitle: 'Choose the gamemode pool, the round format and exactly how the draft will run.',
      body: sendModalBody(),
      footer:
        '<button class="btn btn-ghost" type="button" data-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" id="sendRequestBtn" data-send-request disabled>Send Request →</button>',
      onMount: function (modal) {
        const opp = modal.querySelector('#opponentInput');
        if (opp) {
          opp.addEventListener('input', function () {
            updateOpponentFace(opp.value);
            updateSendPreview();
          });
          opp.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitDuelRequest();
            }
          });
        }
        updateOpponentFace('');
        syncRuleControls();
        updateSendPreview();
      }
    });
  }

  function segGroup(group, label, options, current) {
    const buttons = options
      .map(function (option) {
        const on = String(option.v) === String(current);
        return (
          '<button type="button" class="seg ' + (on ? 'is-on' : '') + '" data-group="' + group +
          '" data-value="' + esc(option.v) + '" aria-pressed="' + on + '">' +
          '<span>' + esc(option.t) + '</span>' +
          (option.s ? '<small>' + esc(option.s) + '</small>' : '') +
          '</button>'
        );
      })
      .join('');
    return (
      '<div class="field"><span class="label">' + esc(label) + '</span>' +
      '<div class="segmented" role="group" aria-label="' + esc(label) + '">' + buttons + '</div></div>'
    );
  }

  function sendModalBody() {
    const draft = S.duelDraft;
    const poolTiles = L.KITS.map(function (kit) {
      const on = draft.pool.indexOf(kit.id) !== -1;
      return (
        '<button type="button" class="pool-tile ' + (on ? 'is-on' : '') + '" style="--kc:' + kit.color +
        '" data-pool="' + kit.id + '" aria-pressed="' + on + '">' +
        kitIcon(kit) +
        '<span class="kit-copy"><span class="kit-name">' + esc(kit.name) + '</span>' +
        '<span class="kit-tag">' + esc(kit.tag) + '</span></span>' +
        '<span class="tick" aria-hidden="true">✓</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="field">' +
        '<label class="label" for="opponentInput">Opponent username</label>' +
        '<div class="opponent-row">' +
          '<span class="avatar"><img id="opponentFace" src="' + FALLBACK_FACE +
          '" alt="Opponent skin preview" data-skin="" /></span>' +
          '<input id="opponentInput" class="input" type="text" autocomplete="off" autocapitalize="off" ' +
          'spellcheck="false" maxlength="16" placeholder="Opponent Minecraft name" data-autofocus />' +
        '</div>' +
        '<p class="hint">They must have this page open and have entered the same username.</p>' +
      '</div>' +

      '<div class="field">' +
        '<div class="field-head"><span class="label">Gamemode pool</span>' +
        '<span class="counter" id="poolCount">0 selected</span></div>' +
        '<div class="pool-grid" id="poolGrid">' + poolTiles + '</div>' +
      '</div>' +

      '<div class="rule-grid">' +
        segGroup('format', 'Round format', [
          { v: 2, t: 'FT2', s: 'first to 2' },
          { v: 3, t: 'FT3', s: 'first to 3' },
          { v: 5, t: 'FT5', s: 'first to 5' }
        ], draft.format) +
        segGroup('banCount', 'Bans per player', [
          { v: 0, t: '0' },
          { v: 1, t: '1' },
          { v: 2, t: '2' },
          { v: 3, t: '3' }
        ], draft.banCount) +
      '</div>' +
      '<p class="hint ban-hint" id="banHint"></p>' +

      '<div class="rule-grid">' +
        segGroup('order', 'Pick order', [
          { v: 'alternate', t: 'Alternate', s: 'A · B · A · B' },
          { v: 'snake', t: 'Snake', s: 'A · B · B · A' }
        ], draft.order) +
        segGroup('firstBan', 'First ban', [
          { v: 'p1', t: 'You' },
          { v: 'p2', t: 'Rival' }
        ], draft.firstBan) +
        segGroup('firstPick', 'First pick', [
          { v: 'p1', t: 'You' },
          { v: 'p2', t: 'Rival' }
        ], draft.firstPick) +
      '</div>' +

      '<div class="seq-box">' +
        '<div class="seq-head"><span class="label">Draft sequence</span>' +
        '<span class="seq-count" id="seqCount"></span></div>' +
        '<div class="seq-list" id="seqList"></div>' +
      '</div>' +

      '<p class="form-error" id="sendError" role="alert"></p>'
    );
  }

  function updateSendPreview() {
    const draft = S.duelDraft;
    const check = L.validateRules(draft);
    const steps = L.buildSteps(draft);

    const seq = $('#seqList');
    if (seq) {
      seq.innerHTML = steps
        .map(function (step) {
          return (
            '<span class="seq-chip ' + (step.kind === 'ban' ? 'is-ban ' : '') +
            (step.owner === 'p2' ? 'p2' : '') + '">' +
            '<b>' + (step.kind === 'ban' ? 'BAN' : 'PICK') + '</b>' +
            (step.owner === 'p1' ? 'You' : 'Rival') +
            '</span>'
          );
        })
        .join('<span class="seq-arrow" aria-hidden="true">›</span>');
    }

    const poolCount = $('#poolCount');
    if (poolCount) {
      poolCount.textContent = draft.pool.length + ' selected';
      poolCount.classList.toggle('is-bad', !check.ok);
    }

    const seqCount = $('#seqCount');
    if (seqCount) {
      if (check.ok) {
        seqCount.textContent = steps.length + ' steps · ' + check.needed + ' modes needed';
        seqCount.classList.remove('is-bad');
      } else {
        const needed = L.requiredKits({
          format: Number(draft.format) || 3,
          banCount: Number(draft.banCount) || 0
        });
        seqCount.textContent = needed + ' needed · ' + draft.pool.length + ' selected';
        seqCount.classList.add('is-bad');
      }
    }

    const oppInput = $('#opponentInput');
    const opponent = oppInput ? oppInput.value.trim() : '';
    let error = '';

    if (!S.online) {
      error = 'The peer link is offline. Re-enter the lobby first.';
    } else if (!opponent) {
      error = 'Enter your opponent\'s Minecraft username.';
    } else {
      const nameError = L.validateUsername(opponent);
      if (nameError) error = nameError;
      else if (opponent.toLowerCase() === S.username.toLowerCase()) error = 'You cannot challenge yourself.';
      else if (!check.ok) error = check.error;
    }

    const errorEl = $('#sendError');
    if (errorEl) errorEl.textContent = error;

    const sendBtn = $('#sendRequestBtn');
    if (sendBtn) sendBtn.disabled = !!error || S.sendingDuel;
  }

  function updateOpponentFace(name) {
    const img = $('#opponentFace');
    if (img) updateFaceImg(img, name);
  }

  function syncRuleControls() {
    const draft = S.duelDraft;
    const maxBans = L.maxBansFor(draft.pool.length, draft.format);
    if (draft.banCount > maxBans) draft.banCount = maxBans;

    $$('.seg', $('#modalRoot')).forEach(function (button) {
      const group = button.dataset.group;
      if (!group) return;
      const isNumber = group === 'format' || group === 'banCount';
      const value = isNumber ? Number(button.dataset.value) : button.dataset.value;
      const on = String(value) === String(draft[group]);
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));

      if (group === 'banCount') {
        const disabled = value > maxBans;
        button.disabled = disabled;
        button.setAttribute('aria-disabled', String(disabled));
      }
    });

    const hint = $('#banHint');
    if (hint) {
      if (maxBans === 0) {
        hint.textContent =
          'FT' + draft.format + ' needs ' + L.picksFor(draft.format) + ' of ' +
          draft.pool.length + ' modes, so bans are locked at 0.';
      } else if (maxBans === 1) {
        hint.textContent = 'This pool allows 1 ban per player at FT' + draft.format + '.';
      } else {
        hint.textContent = 'This pool allows up to ' + maxBans + ' bans per player at FT' + draft.format + '.';
      }
    }
  }

  function setDraftRule(group, value) {
    const draft = S.duelDraft;
    if (group === 'format') draft.format = Number(value);
    else if (group === 'banCount') draft.banCount = Number(value);
    else if (group === 'order') draft.order = value === 'snake' ? 'snake' : 'alternate';
    else if (group === 'firstBan') draft.firstBan = value === 'p2' ? 'p2' : 'p1';
    else if (group === 'firstPick') draft.firstPick = value === 'p2' ? 'p2' : 'p1';

    syncRuleControls();
    updateSendPreview();
  }

  function togglePoolKit(id, tile) {
    const pool = S.duelDraft.pool;
    const index = pool.indexOf(id);
    if (index >= 0) pool.splice(index, 1);
    else pool.push(id);

    if (tile) {
      const on = index < 0;
      tile.classList.toggle('is-on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
    syncRuleControls();
    updateSendPreview();
  }

  function submitDuelRequest() {
    if (!S.online || !S.peer || S.sendingDuel) return;

    const oppInput = $('#opponentInput');
    const target = oppInput ? oppInput.value.trim() : '';
    const nameError = L.validateUsername(target);
    const check = L.validateRules(S.duelDraft);

    let error = '';
    if (nameError) error = nameError;
    else if (target.toLowerCase() === S.username.toLowerCase()) error = 'You cannot challenge yourself.';
    else if (!check.ok) error = check.error;

    if (error) {
      const errorEl = $('#sendError');
      if (errorEl) errorEl.textContent = error;
      toast(error, 'warn');
      return;
    }

    const duplicate = S.sent.some(function (req) {
      return req.status === 'pending' && req.to.toLowerCase() === target.toLowerCase();
    });
    if (duplicate) {
      toast('A request to ' + target + ' is already pending.', 'warn');
      return;
    }

    S.sendingDuel = true;
    saveDraftRules();

    const id = uid();
    const peerId = L.peerIdFor(target);
    let conn;

    try {
      conn = S.peer.connect(peerId, {
        reliable: true,
        serialization: 'json',
        metadata: { app: 'pvp-tournier', from: S.username }
      });
    } catch (err) {
      S.sendingDuel = false;
      toast('Could not open a peer connection. Try again.', 'error');
      return;
    }

    if (!conn) {
      S.sendingDuel = false;
      toast('Could not open a peer connection. Try again.', 'error');
      return;
    }

    const rules = {
      pool: S.duelDraft.pool.slice(),
      format: S.duelDraft.format,
      banCount: S.duelDraft.banCount,
      order: S.duelDraft.order,
      firstBan: S.duelDraft.firstBan,
      firstPick: S.duelDraft.firstPick
    };

    const req = {
      id: id,
      to: target,
      peerId: peerId,
      rules: rules,
      conn: conn,
      status: 'pending',
      createdAt: Date.now(),
      timer: null
    };
    S.sent.unshift(req);

    conn.on('open', function () {
      sendTo(conn, { t: 'duel', v: 1, id: id, from: S.username, rules: rules });
    });
    conn.on('data', function (data) {
      onData(conn, data);
    });
    conn.on('close', function () {
      onConnClosed(conn);
    });
    conn.on('error', function () {
      onConnError(conn);
    });

    req.timer = window.setTimeout(function () {
      if (req.status !== 'pending') return;
      req.status = 'expired';
      refreshRequests();
      renderLobby();
      try {
        conn.close();
      } catch (err) {
        /* ignore */
      }
      toast(target + ' did not answer the request.', 'warn', 5000);
    }, 25000);

    closeModal(true);
    S.requestsTab = 'sent';
    openRequests('sent');
    renderLobby();
    S.sendingDuel = false;
    toast('Duel request sent to ' + target + '.', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* Requests modal                                                     */
  /* ------------------------------------------------------------------ */

  function openRequests(tab) {
    if (!S.online) {
      focusUsername();
      toast('Enter your Minecraft username first.', 'warn');
      return;
    }
    S.requestsTab = tab || S.requestsTab || 'incoming';

    openModal({
      type: 'requests',
      eyebrow: 'Duel requests',
      title: 'Requests',
      subtitle: 'Incoming challenges and the requests you have sent.',
      body: requestsBody(),
      footer: '<button class="btn btn-outline" type="button" data-close>Close</button>'
    });
  }

  function requestsBody() {
    const tab = S.requestsTab === 'sent' ? 'sent' : 'incoming';
    return (
      '<div class="tabs" role="tablist">' +
        '<button type="button" class="tab ' + (tab === 'incoming' ? 'is-on' : '') +
        '" data-tab="incoming" role="tab" aria-selected="' + (tab === 'incoming') + '">' +
        'Incoming <span class="count">' + S.incoming.length + '</span></button>' +
        '<button type="button" class="tab ' + (tab === 'sent' ? 'is-on' : '') +
        '" data-tab="sent" role="tab" aria-selected="' + (tab === 'sent') + '">' +
        'Sent <span class="count">' + S.sent.length + '</span></button>' +
      '</div>' +
      '<div class="requests-list">' +
        (tab === 'incoming' ? incomingList() : sentList()) +
      '</div>'
    );
  }

  function rulesSummary(rules, viewer) {
    const bans = rules.banCount === 1 ? '1 ban' : rules.banCount + ' bans';
    const first = rules.firstBan === viewer ? 'you ban first' : 'rival bans first';
    return (
      'FT' + rules.format + ' · ' + bans + ' each · ' + L.picksFor(rules.format) +
      ' picks · ' + first + ' · ' + rules.order + ' · ' + rules.pool.length + '-mode pool'
    );
  }

  function incomingList() {
    if (S.incoming.length === 0) {
      return (
        '<div class="empty-state">' +
          '<div class="empty-ic" aria-hidden="true">⚔</div>' +
          '<h3>No incoming requests</h3>' +
          '<p>When someone challenges your username, the request will appear here in real time.</p>' +
        '</div>'
      );
    }

    return S.incoming
      .map(function (req) {
        return (
          '<div class="request-card">' +
            avatarHtml(req.from) +
            '<div class="request-main">' +
              '<div class="request-name">' + esc(req.from) +
              '<span class="mini">Challenger</span></div>' +
              '<p class="request-rules">' + esc(rulesSummary(req.rules, 'p2')) +
              ' · ' + timeAgo(req.createdAt) + '</p>' +
            '</div>' +
            '<div class="request-actions">' +
              '<button class="btn btn-primary btn-sm" type="button" data-accept="' + esc(req.id) + '">Accept</button>' +
              '<button class="btn btn-outline btn-sm" type="button" data-decline="' + esc(req.id) + '">Decline</button>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function sentList() {
    if (S.sent.length === 0) {
      return (
        '<div class="empty-state">' +
          '<div class="empty-ic" aria-hidden="true">➤</div>' +
          '<h3>No sent requests</h3>' +
          '<p>Send a duel request and its live status will show up here.</p>' +
        '</div>'
      );
    }

    return S.sent
      .map(function (req) {
        const label = STATUS_LABEL[req.status] || req.status;
        return (
          '<div class="request-card">' +
            avatarHtml(req.to) +
            '<div class="request-main">' +
              '<div class="request-name">' + esc(req.to) +
              '<span class="mini">' + esc(label) + '</span></div>' +
              '<p class="request-rules">' + esc(rulesSummary(req.rules, 'p1')) +
              ' · ' + timeAgo(req.createdAt) + '</p>' +
            '</div>' +
            '<div class="request-actions">' +
              (req.status === 'pending'
                ? '<button class="btn btn-outline btn-sm" type="button" data-cancel-sent="' + esc(req.id) + '">Cancel</button>'
                : '<span class="status-chip ' + esc(req.status) + '">' + esc(label) + '</span>') +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function acceptRequest(id) {
    const req = S.incoming.find(function (item) {
      return item.id === id;
    });
    if (!req) return;
    if (!S.online || S.game || S.conn) {
      toast('Cannot accept a duel right now.', 'warn');
      return;
    }

    S.incoming
      .filter(function (item) {
        return item !== req;
      })
      .forEach(function (item) {
        declineIncomingReq(item, true);
      });
    S.incoming = [req];

    S.sent.forEach(function (item) {
      item.status = 'canceled';
      if (item.timer) clearTimeout(item.timer);
      sendTo(item.conn, { t: 'duel-cancel', v: 1, id: item.id });
      window.setTimeout(function () {
        try {
          item.conn.close();
        } catch (err) {
          /* ignore */
        }
      }, 160);
    });
    S.sent = [];

    S.conn = req.conn;
    S.role = 'p2';
    S.isHost = false;
    S.leaving = false;
    S.pending = true;
    S.pendingPick = null;
    S.localVote = null;
    S.awaitingState = true;
    S.stateSynced = false;
    S.confettiKey = '';
    S.game = L.createGame({
      id: req.id,
      rules: req.rules,
      players: { p1: req.from, p2: S.username }
    });

    sendTo(req.conn, {
      t: 'duel-response',
      v: 1,
      id: req.id,
      accepted: true,
      from: S.username
    });

    S.incoming = [];
    S.sent = [];
    closeModal(true);
    renderGame();
    armStateTimeout();
    toast('Duel accepted — waiting for the draft to sync.', 'success', 4200);
  }

  function declineIncomingReq(req, silent) {
    sendTo(req.conn, {
      t: 'duel-response',
      v: 1,
      id: req.id,
      accepted: false,
      reason: 'declined'
    });
    window.setTimeout(function () {
      try {
        req.conn.close();
      } catch (err) {
        /* ignore */
      }
    }, 160);
    S.incoming = S.incoming.filter(function (item) {
      return item !== req;
    });
    if (!silent) {
      renderLobby();
      refreshRequests();
      toast('Declined ' + req.from + '\'s duel request.', 'info');
    }
  }

  function declineIncomingById(id) {
    const req = S.incoming.find(function (item) {
      return item.id === id;
    });
    if (!req) return;
    declineIncomingReq(req, false);
  }

  function cancelSent(id) {
    const req = S.sent.find(function (item) {
      return item.id === id;
    });
    if (!req) return;
    if (req.status === 'pending') {
      sendTo(req.conn, { t: 'duel-cancel', v: 1, id: req.id });
      req.status = 'canceled';
      if (req.timer) clearTimeout(req.timer);
      window.setTimeout(function () {
        try {
          req.conn.close();
        } catch (err) {
          /* ignore */
        }
      }, 160);
    }
    refreshRequests();
    renderLobby();
    toast('Duel request cancelled.', 'info');
  }

  function onModalClick(event) {
    const root = $('#modalRoot');
    if (!root || !root.contains(event.target)) return;

    if (event.target.closest('[data-close]')) {
      closeModal();
      return;
    }

    if (event.target.closest('[data-lobby]')) {
      closeModal();
      resetToLobby(false);
      return;
    }

    if (event.target.closest('[data-leave-confirm]')) {
      closeModal();
      resetToLobby(true);
      return;
    }

    if (S.modalType === 'send') {
      const seg = event.target.closest('.seg');
      if (seg && seg.dataset.group) {
        setDraftRule(seg.dataset.group, seg.dataset.value);
        return;
      }
      const poolTile = event.target.closest('[data-pool]');
      if (poolTile) {
        togglePoolKit(poolTile.dataset.pool, poolTile);
        return;
      }
      if (event.target.closest('[data-send-request]')) submitDuelRequest();
      return;
    }

    if (S.modalType === 'requests') {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        S.requestsTab = tab.dataset.tab === 'sent' ? 'sent' : 'incoming';
        refreshRequests();
        return;
      }
      const accept = event.target.closest('[data-accept]');
      if (accept) {
        acceptRequest(accept.dataset.accept);
        return;
      }
      const decline = event.target.closest('[data-decline]');
      if (decline) {
        declineIncomingById(decline.dataset.decline);
        return;
      }
      const cancel = event.target.closest('[data-cancel-sent]');
      if (cancel) {
        cancelSent(cancel.dataset.cancelSent);
        return;
      }
      return;
    }

    if (S.modalType === 'choose') {
      const tile = event.target.closest('[data-kit]');
      if (tile) chooseKit(tile.dataset.kit);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Game screen routing                                                */
  /* ------------------------------------------------------------------ */

  function renderGame() {
    if (!S.game) {
      showScreen('lobby');
      renderLobby();
      return;
    }
    if (S.game.phase === 'draft') {
      showScreen('draft');
      renderDraft();
    } else if (S.game.phase === 'match') {
      showScreen('match');
      renderMatch();
    } else if (S.game.phase === 'victory') {
      showScreen('victory');
      renderVictory();
    } else {
      showScreen('lobby');
    }
  }

  function commitHost(result) {
    if (!result || !result.ok) return;
    S.game = result.game;
    S.pending = false;
    S.pendingPick = null;
    S.localVote = null;
    S.awaitingState = false;
    if (S.pendingTimer) {
      clearTimeout(S.pendingTimer);
      S.pendingTimer = null;
    }
    renderGame();
    broadcastState(result.event || null);
    if (result.event) handleGameEvent(result.event, true);
  }

  function armPendingTimer() {
    if (S.pendingTimer) clearTimeout(S.pendingTimer);
    S.pendingTimer = window.setTimeout(function () {
      if (!S.pending) return;
      S.pending = false;
      S.pendingPick = null;
      S.localVote = null;
      S.pendingTimer = null;
      renderGame();
      toast('No response from the rival. Try that action again.', 'warn', 4200);
    }, 7000);
  }

  function armStateTimeout() {
    if (S.stateTimer) clearTimeout(S.stateTimer);
    S.stateTimer = window.setTimeout(function () {
      if (!S.awaitingState) return;
      S.awaitingState = false;
      S.pending = false;
      S.stateTimer = null;
      toast('The draft state did not arrive. Returning to the lobby.', 'error', 5200);
      resetToLobby(false);
    }, 12000);
  }

  /* ------------------------------------------------------------------ */
  /* Draft screen                                                       */
  /* ------------------------------------------------------------------ */

  function renderDraft() {
    const game = S.game;
    if (!game || game.phase !== 'draft') return;

    const me = S.role;
    const active = L.activeStepIndex(game);
    const activeStep = active >= 0 ? game.steps[active] : null;
    const isMyTurn = !!activeStep && activeStep.owner === me;

    fillPlayerChip($('#draftP1'), game.players.p1.username, 'p1');
    fillPlayerChip($('#draftP2'), game.players.p2.username, 'p2');

    const formatChip = $('#formatChip');
    if (formatChip) formatChip.textContent = 'FT' + game.rules.format;

    const turnPill = $('#turnPill');
    const turnText = $('#turnText');
    if (turnPill && turnText) {
      let classes = 'turn-pill';
      let label = 'Draft complete';

      if (activeStep) {
        if (S.awaitingState) {
          label = 'Syncing draft…';
        } else if (S.pending && isMyTurn) {
          classes += ' is-mine';
          label = 'Syncing ' + activeStep.kind + '…';
        } else if (isMyTurn) {
          classes += ' is-mine';
          label = activeStep.kind.toUpperCase() + ' · Your turn';
        } else {
          classes += ' is-theirs';
          label = 'Rival turn · ' + activeStep.kind;
        }
      }

      turnPill.className = classes;
      turnText.textContent = label;
    }

    const filled = game.steps.filter(function (step) {
      return !!step.kit;
    }).length;
    const bar = $('#draftProgressBar');
    if (bar) bar.style.width = Math.round((filled / game.steps.length) * 100) + '%';

    const meta = $('#draftMeta');
    if (meta) {
      meta.innerHTML =
        '<span class="chip"><b>FT' + game.rules.format + '</b></span>' +
        '<span class="chip">' + game.rules.banCount + ' ban each</span>' +
        '<span class="chip">' + L.picksFor(game.rules.format) + ' picks</span>' +
        '<span class="chip">' + game.rules.order + ' order</span>' +
        '<span class="chip">' + game.rules.pool.length + ' modes</span>';
    }

    const body = $('#draftBody');
    if (body) {
      body.innerHTML =
        renderSlotGroup('ban', active, isMyTurn) +
        renderSlotGroup('pick', active, isMyTurn);
    }
  }

  function fillPlayerChip(el, username, role) {
    if (!el) return;
    const mine = S.role === role;
    el.className = 'player-chip' + (role === 'p2' ? ' right' : '') + (mine ? ' is-me' : ' is-rival');
    el.innerHTML =
      avatarHtml(username) +
      '<div class="pc-copy">' +
        '<div class="pc-name" title="' + esc(username) + '">' + esc(username) + '</div>' +
        '<div class="pc-tag ' + role + '"><span class="role-dot"></span>' + (mine ? 'You' : 'Rival') + '</div>' +
      '</div>';
  }

  function renderSlotGroup(kind, activeIndex, isMyTurn) {
    const game = S.game;
    const steps = game.steps
      .map(function (step, index) {
        return { step: step, index: index };
      })
      .filter(function (item) {
        return item.step.kind === kind;
      });

    if (steps.length === 0) return '';

    const locked = steps.filter(function (item) {
      return !!item.step.kit;
    }).length;

    const cards = steps
      .map(function (item, kindIndex) {
        return slotHtml(item.step, item.index, kindIndex, activeIndex, isMyTurn);
      })
      .join('');

    return (
      '<section class="phase-group">' +
        '<div class="phase-head">' +
          '<span class="phase-title ' + (kind === 'ban' ? 'is-ban' : '') + '">' +
          (kind === 'ban' ? 'Ban phase' : 'Pick phase') + '</span>' +
          '<span class="phase-line"></span>' +
          '<span class="phase-count">' + locked + ' / ' + steps.length + ' locked</span>' +
        '</div>' +
        '<div class="slots">' + cards + '</div>' +
      '</section>'
    );
  }

  function slotHtml(step, index, kindIndex, activeIndex, isMyTurn) {
    const mine = step.owner === S.role;
    const isActive = index === activeIndex;
    const ghost = !!(S.pendingPick && S.pendingPick.stepIndex === index);
    const kitId = ghost ? S.pendingPick.kitId : step.kit;
    const kit = kitId ? L.KIT_MAP.get(kitId) : null;

    const classes = ['slot', step.kind === 'ban' ? 'is-ban' : 'is-pick'];
    if (kit) classes.push('is-filled');
    if (isActive && !ghost) classes.push('is-active', mine ? 'is-mine' : 'is-theirs');
    if (ghost) classes.push('is-filled', 'is-ghost');

    let foot = 'Waiting';
    if (ghost) foot = 'Syncing…';
    else if (kit) foot = step.kind === 'ban' ? 'Banned' : 'Locked in';
    else if (isActive && mine) foot = 'Choose kit →';
    else if (isActive) foot = 'Rival choosing…';

    const label =
      step.kind.toUpperCase() + ' ' + String(kindIndex + 1).padStart(2, '0') +
      ' · ' + (mine ? 'You' : 'Rival') +
      (kit ? ' · ' + L.KIT_MAP.get(kitId).name : '');

    return (
      '<button type="button" class="' + classes.join(' ') + '" data-step="' + index +
      '" aria-label="' + esc(label) + '">' +
        '<span class="slot-top">' +
          '<span class="slot-kind">' + step.kind.toUpperCase() + ' ' +
          String(kindIndex + 1).padStart(2, '0') + '</span>' +
          '<span class="slot-owner ' + step.owner + '">' + (mine ? 'You' : 'Rival') + '</span>' +
        '</span>' +
        '<span class="slot-body">' +
          (kit
            ? '<span class="slot-kit">' + kitIcon(kit) +
              '<span class="kit-name">' + esc(kit.name) + '</span></span>'
            : '<span class="slot-empty" aria-hidden="true">' + (isActive ? '+' : '·') + '</span>') +
        '</span>' +
        '<span class="slot-foot">' + foot + '</span>' +
      '</button>'
    );
  }

  function onDraftClick(event) {
    const slot = event.target.closest('.slot');
    if (!slot) return;

    const game = S.game;
    if (!game || game.phase !== 'draft') return;
    if (S.modalType) return;

    const index = Number(slot.getAttribute('data-step'));
    const step = game.steps[index];
    if (!step) return;

    if (step.kit) {
      const kit = L.KIT_MAP.get(step.kit);
      toast(
        (kit ? kit.name : 'That kit') + ' was ' +
        (step.kind === 'ban' ? 'banned' : 'picked') + ' by ' +
        (step.owner === S.role ? 'you' : 'your rival') + '.',
        'info',
        2800
      );
      return;
    }

    if (S.awaitingState) {
      toast('Still syncing the draft with your rival…', 'warn', 2400);
      return;
    }

    if (S.pending) {
      toast('Waiting for the rival to confirm…', 'warn', 2400);
      return;
    }

    const active = L.activeStepIndex(game);
    if (active !== index) {
      toast('That slot is not active yet.', 'warn', 2400);
      return;
    }

    if (step.owner !== S.role) {
      toast('It is your rival\'s turn.', 'warn', 2600);
      return;
    }

    openKitPicker(index);
  }

  function openKitPicker(stepIndex) {
    const game = S.game;
    if (!game || game.phase !== 'draft') return;
    if (S.pending || S.awaitingState) return;

    const step = game.steps[stepIndex];
    if (!step || step.kit) return;

    const remaining = L.remainingKits(game);
    if (remaining.length === 0) {
      toast('No gamemodes left in the pool.', 'warn');
      return;
    }

    const tiles = remaining
      .map(function (id, i) {
        const kit = L.KIT_MAP.get(id);
        return (
          '<button type="button" class="kit-tile" data-kit="' + kit.id + '" style="--kc:' + kit.color +
          ';--i:' + i + '">' +
            kitIcon(kit, 'lg') +
            '<span class="kit-name">' + esc(kit.name) + '</span>' +
            '<span class="kit-tag">' + esc(kit.tag) + '</span>' +
          '</button>'
        );
      })
      .join('');

    openModal({
      type: 'choose',
      size: 'md',
      eyebrow: step.kind === 'ban' ? 'Ban phase' : 'Pick phase',
      title: step.kind === 'ban' ? 'Deny a kit' : 'Lock in your kit',
      subtitle:
        (step.kind === 'ban' ? 'Remove one gamemode from the pool' : 'This gamemode joins the match timeline') +
        ' · ' + remaining.length + ' available',
      body: '<div class="kit-grid">' + tiles + '</div>',
      footer: '<button class="btn btn-ghost" type="button" data-close>Cancel</button>'
    });

    S.chooserStep = stepIndex;
  }

  function chooseKit(kitId) {
    const index = S.chooserStep;
    if (index < 0) return;
    closeModal(true);
    submitPick(index, kitId);
  }

  function submitPick(stepIndex, kitId) {
    if (!S.game || S.game.phase !== 'draft') return;
    if (S.pending || S.awaitingState) return;

    const active = L.activeStepIndex(S.game);
    if (active !== stepIndex) {
      toast('That slot is not active any more.', 'warn');
      return;
    }
    const step = S.game.steps[stepIndex];
    if (!step || step.owner !== S.role) {
      toast('It is not your turn.', 'warn');
      return;
    }

    if (S.isHost) {
      const result = L.applyPick(S.game, S.role, stepIndex, kitId);
      if (!result.ok) {
        toast(result.error, 'error');
        renderDraft();
        return;
      }
      commitHost(result);
      return;
    }

    S.pending = true;
    S.pendingPick = { stepIndex: stepIndex, kitId: kitId };
    armPendingTimer();
    renderDraft();
    sendTo(S.conn, {
      t: 'action',
      v: 1,
      action: { type: 'pick', stepIndex: stepIndex, kitId: kitId }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Match screen                                                       */
  /* ------------------------------------------------------------------ */

  function renderMatch() {
    const game = S.game;
    if (!game) return;

    const picks = L.pickedSteps(game);
    const timeline = picks
      .map(function (step, index) {
        const kit = L.KIT_MAP.get(step.kit);
        let classes = 'tl-item';
        if (index < game.round) classes += ' is-done';
        if (index === game.round) classes += ' is-current';
        return (
          '<span class="' + classes + '" title="' + esc(kit ? kit.name : 'Kit') + '">' +
            (kit ? kitIcon(kit) : '') +
            '<span class="tl-label">R' + (index + 1) + '</span>' +
          '</span>'
        );
      })
      .join('<span class="tl-arrow" aria-hidden="true">→</span>');

    const timelineEl = $('#timeline');
    if (timelineEl) timelineEl.innerHTML = timeline;

    const matchRules = $('#matchRules');
    if (matchRules) {
      matchRules.textContent =
        'FT' + game.rules.format + ' · ' + game.rules.banCount + ' ban each · ' +
        game.rules.pool.length + '-mode pool';
    }

    const scoreP1 = $('#scoreP1');
    if (scoreP1) {
      scoreP1.className = 'score-side p1';
      scoreP1.innerHTML =
        avatarHtml(game.players.p1.username) +
        '<span class="score-name">' + esc(game.players.p1.username) + '</span>' +
        '<span class="score-value">' + game.scores.p1 + '</span>';
    }
    const scoreP2 = $('#scoreP2');
    if (scoreP2) {
      scoreP2.className = 'score-side p2 right';
      scoreP2.innerHTML =
        avatarHtml(game.players.p2.username) +
        '<span class="score-name">' + esc(game.players.p2.username) + '</span>' +
        '<span class="score-value">' + game.scores.p2 + '</span>';
    }

    const roundNumber = $('#roundNumber');
    if (roundNumber) roundNumber.textContent = String(game.round + 1);
    const roundFormat = $('#roundFormat');
    if (roundFormat) roundFormat.textContent = 'FIRST TO ' + game.rules.format;

    const kitId = L.currentKit(game);
    const kit = kitId ? L.KIT_MAP.get(kitId) : null;
    const current = $('#currentKit');
    if (current) {
      if (kit) {
        current.innerHTML =
          '<span class="ck-watermark" style="--kc:' + kit.color + '" aria-hidden="true">' +
            kitArt(kit) +
          '</span>' +
          '<span class="ck-kicker">Now playing</span>' +
          '<span class="ck-icon">' + kitIcon(kit, 'xl') + '</span>' +
          '<span class="ck-name">' + esc(kit.name) + '</span>' +
          '<span class="ck-tag">' + esc(kit.tag) + '</span>' +
          '<span class="ck-round">Round ' + (game.round + 1) + ' · first to ' +
            game.rules.format + '</span>';
      } else {
        current.innerHTML = '<span class="ck-kicker">Waiting for the draft</span>';
      }
    }

    renderVotes(game);
  }

  function renderVotes(game) {
    const me = S.role;
    const rival = L.otherRole(me);
    const myVote = game.votes[me] || S.localVote;
    const rivalVote = game.votes[rival];

    fillVoteButton($('#voteP1'), 'p1', game, myVote, rivalVote);
    fillVoteButton($('#voteP2'), 'p2', game, myVote, rivalVote);

    const hint = $('#voteHint');
    if (hint) {
      let text;
      if (S.pending) {
        text = 'Syncing your vote…';
      } else if (myVote && rivalVote && myVote === rivalVote) {
        text = 'Votes match — awarding the round…';
      } else if (myVote) {
        text = 'You voted <strong>' + esc(game.players[myVote].username) +
          '</strong>. Waiting for the rival to confirm.';
      } else if (rivalVote) {
        text = 'Rival voted <strong>' + esc(game.players[rivalVote].username) +
          '</strong>. Confirm to award the round.';
      } else {
        text = 'Both players must press the same winner to award the round.';
      }
      hint.innerHTML = text;
    }

    const sync = $('#voteSync');
    if (sync) {
      sync.textContent = S.pending ? 'Syncing vote…' : 'Both votes must match';
      sync.classList.toggle('is-pending', S.pending);
    }
  }

  function fillVoteButton(button, role, game, myVote, rivalVote) {
    if (!button) return;
    const username = game.players[role].username;
    const isMe = role === S.role;
    const voted = myVote === role;
    const rivalFlag = rivalVote === role;

    button.className = 'vote-btn' + (voted ? ' is-voted' : '');
    button.disabled = S.pending || S.awaitingState;
    button.setAttribute('aria-pressed', String(voted));
    button.innerHTML =
      (rivalFlag ? '<span class="vote-flag">Rival vote</span>' : '') +
      avatarHtml(username) +
      '<span class="vote-info">' +
        '<span class="vote-title">' + esc(username) + '</span>' +
        '<span class="vote-sub">' + (isMe ? 'You' : 'Rival') + ' · ' +
          (voted ? 'Your vote' : 'Choose winner') + '</span>' +
      '</span>' +
      '<span class="vote-check" aria-hidden="true">✓</span>';
  }

  function castVote(winnerRole) {
    const game = S.game;
    if (!game || game.phase !== 'match') return;
    if (S.pending || S.awaitingState) return;

    if (S.isHost) {
      const result = L.applyVote(game, S.role, winnerRole);
      if (!result.ok) {
        toast(result.error, 'error');
        return;
      }
      commitHost(result);
      return;
    }

    S.pending = true;
    S.localVote = winnerRole;
    armPendingTimer();
    renderMatch();
    sendTo(S.conn, {
      t: 'action',
      v: 1,
      action: { type: 'vote', winner: winnerRole }
    });
  }

  function handleGameEvent(event, isLocal) {
    if (!event) return;

    if (event.type === 'pick' && event.role !== S.role) {
      const kit = L.KIT_MAP.get(event.kitId);
      if (kit) {
        toast(
          'Rival ' + (event.kind === 'ban' ? 'banned ' : 'picked ') + kit.name + '.',
          'info',
          2600
        );
      }
      return;
    }

    if (event.type === 'conflict') {
      toast('Votes conflicted — both votes were reset. Vote again.', 'warn', 5200);
      return;
    }

    if (event.type === 'round') {
      const game = S.game;
      const name = game.players[event.winner].username;
      flashRound(name, event.scores);
      toast(
        name + ' takes round ' + (event.round + 1) + ' · ' +
        event.scores.p1 + '–' + event.scores.p2,
        'success',
        4800
      );
      if (event.matchOver) {
        window.setTimeout(function () {
          toast(name + ' wins the duel!', 'success', 6000);
        }, 650);
      }
      return;
    }

    if (event.type === 'vote' && !isLocal) {
      const game = S.game;
      const name = game.players[event.winner].username;
      toast('Rival voted for ' + name + '.', 'info', 3000);
    }
  }

  function flashRound(name, scores) {
    const node = document.createElement('div');
    node.className = 'round-flash';
    node.innerHTML =
      '<span>Round decided</span>' +
      '<strong>' + esc(name) + ' wins</strong>' +
      '<small>' + scores.p1 + ' — ' + scores.p2 + '</small>';
    document.body.appendChild(node);
    requestAnimationFrame(function () {
      node.classList.add('show');
    });
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 1900);
  }

  /* ------------------------------------------------------------------ */
  /* Victory screen                                                     */
  /* ------------------------------------------------------------------ */

  function renderVictory() {
    const game = S.game;
    if (!game || !game.winner) return;

    const winner = game.winner;
    const name = game.players[winner].username;

    const title = $('#victoryTitle');
    if (title) title.textContent = name + ' WON!';

    const score = $('#victoryScore');
    if (score) score.textContent = game.scores.p1 + ' — ' + game.scores.p2;

    const img = $('#victoryRender');
    if (img) {
      const url = fullUrl(name);
      if (img.getAttribute('src') !== url) {
        img.dataset.skin = name;
        img.dataset.kind = 'full';
        img.dataset.failed = '';
        img.src = url;
      }
      img.alt = name + "'s Minecraft skin";
    }

    const recap = $('#victoryRecap');
    if (recap) {
      const history = game.history || [];
      recap.innerHTML = history
        .map(function (item) {
          const kit = L.KIT_MAP.get(item.kit);
          return (
            '<span class="recap-item ' + item.winner + '">' +
              (kit ? kitIcon(kit) : '') +
              '<b>R' + (item.round + 1) + '</b>' +
              '<em>' + esc(game.players[item.winner].username) + '</em>' +
            '</span>'
          );
        })
        .join('');
    }

    const key = game.id + ':' + winner + ':' + game.scores.p1 + '-' + game.scores.p2;
    if (S.confettiKey !== key) {
      S.confettiKey = key;
      launchConfetti();
    }
  }

  function launchConfetti() {
    const box = $('#confetti');
    if (!box) return;
    box.innerHTML = '';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const colors = ['#cfdf8b', '#a8bf5f', '#d9b46a', '#7fb3a2', '#e9ecdf', '#6f8f4b'];
    for (let i = 0; i < 46; i += 1) {
      const piece = document.createElement('i');
      const x = Math.random() * 100;
      const width = 4 + Math.random() * 7;
      const duration = 4 + Math.random() * 5;
      const delay = -Math.random() * 9;
      const drift = Math.random() * 120 - 60;
      piece.style.cssText =
        '--x:' + x + '%;--w:' + width + 'px;--c:' + colors[i % colors.length] +
        ';--r:' + Math.random() * 360 + 'deg;--dur:' + duration + 's;--delay:' + delay +
        's;--drift:' + drift + 'px';
      box.appendChild(piece);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Leaving / disconnecting                                            */
  /* ------------------------------------------------------------------ */

  function openLeaveConfirm() {
    if (!S.game) return;
    openModal({
      type: 'leave',
      size: 'sm',
      eyebrow: 'Abandon duel',
      title: 'Leave this duel?',
      subtitle: 'The draft and the score will be lost for both players.',
      body: '<p class="hint">Your rival will be notified and returned to the lobby.</p>',
      footer:
        '<button class="btn btn-outline" type="button" data-close>Stay</button>' +
        '<button class="btn btn-danger" type="button" data-leave-confirm>Leave duel</button>'
    });
  }

  function showDisconnect() {
    if (S.modalType === 'disconnect') return;
    openModal({
      type: 'disconnect',
      size: 'sm',
      dismissible: false,
      eyebrow: 'P2P link closed',
      title: 'Connection lost',
      subtitle: 'The direct link to your rival dropped, so the match cannot continue.',
      body:
        '<p class="hint">This usually happens when the rival closes the tab, loses internet or ' +
        'refreshes the page. Both players must keep this page open.</p>',
      footer: '<button class="btn btn-primary" type="button" data-lobby>Back to Lobby</button>'
    });
  }

  function resetToLobby(notifyRival) {
    const conn = S.conn;
    const extraConns = [];

    S.incoming.forEach(function (req) {
      extraConns.push(req.conn);
    });
    S.sent.forEach(function (req) {
      if (req.timer) clearTimeout(req.timer);
      extraConns.push(req.conn);
    });

    if (notifyRival && conn) sendTo(conn, { t: 'leave', v: 1 });

    S.leaving = true;
    S.conn = null;
    S.game = null;
    S.role = null;
    S.isHost = false;
    S.pending = false;
    S.pendingPick = null;
    S.localVote = null;
    S.awaitingState = false;
    S.stateSynced = false;
    S.confettiKey = '';
    S.incoming = [];
    S.sent = [];
    clearTimers();
    closeModal(true);

    if (conn) {
      window.setTimeout(function () {
        try {
          conn.close();
        } catch (err) {
          /* ignore */
        }
      }, 140);
    }
    extraConns.forEach(function (extra) {
      if (!extra || extra === conn) return;
      window.setTimeout(function () {
        try {
          extra.close();
        } catch (err) {
          /* ignore */
        }
      }, 140);
    });

    window.setTimeout(function () {
      S.leaving = false;
    }, 900);

    const box = $('#confetti');
    if (box) box.innerHTML = '';
    showScreen('lobby');
    renderLobby();
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                              */
  /* ------------------------------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
