/* Extrato de Tomate — TV shell with spatial navigation, remote keys and a full player.
   ES2017 only: real TVs run older Chromium and ES2020 syntax blanks the page. */

(function () {
  'use strict';

  var catalog = { hero: null, rows: [] };
  var continueRow = null;
  var nav = { current: null, scope: 'page' };
  var player = null;
  var hls = null;
  var current = null;
  var hideTimer = null;
  var saveTimer = null;
  var modalOpen = false;
  var captchaHandle = null;

  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- storage
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem('extrato.progress') || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveProgress(entry) {
    try {
      var store = loadStore();
      store[entry.key] = entry;
      localStorage.setItem('extrato.progress', JSON.stringify(store));
    } catch (e) { /* private mode */ }
  }

  function progressFor(key) {
    var store = loadStore();
    return store[key] || null;
  }

  // ---------------------------------------------------------------- rendering
  function artFor(item) {
    if (item.poster) {
      return item.poster;
    }
    // deterministic gradient: no external image, nothing broken offline
    var hash = 0;
    var text = String(item.id || item.title || '');
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) % 360;
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hash + ',48%,26%)"/>' +
      '<stop offset="1" stop-color="hsl(' + ((hash + 40) % 360) + ',44%,12%)"/>' +
      '</linearGradient></defs><rect width="200" height="300" fill="url(#g)"/>' +
      '<circle cx="100" cy="128" r="42" fill="#e8452c"/>' +
      '<path d="M100 86 q26 10 0 22 q-26 -12 0 -22" fill="#3a9a46"/>' +
      '<circle cx="86" cy="126" r="5" fill="#2a1410"/><circle cx="114" cy="126" r="5" fill="#2a1410"/>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function buildCard(item, rowKey) {
    var card = document.createElement('div');
    card.className = 'card focusable';
    card.tabIndex = 0;
    card.setAttribute('data-key', rowKey + ':' + item.id);

    var art = document.createElement('img');
    art.className = 'art';
    art.src = artFor(item);
    art.alt = item.title || '';
    art.loading = 'lazy';
    card.appendChild(art);

    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = item.title || 'Sem título';
    card.appendChild(label);

    var entry = progressFor(item.id);
    if (entry && entry.d > 0) {
      var bar = document.createElement('div');
      bar.className = 'progress';
      var fill = document.createElement('span');
      fill.style.width = Math.min(100, Math.round((entry.t / entry.d) * 100)) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      if (entry.t / entry.d > 0.02 && entry.t / entry.d < 0.96) {
        var badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = 'CONTINUAR';
        card.appendChild(badge);
      }
    }

    card.addEventListener('click', function () {
      if (window.EXTRATO_CONFIG && window.EXTRATO_CONFIG.mode !== 'local' && loggedIn() && item.raw) {
        openSeries(item);
      } else {
        openDetail(item);
      }
    });
    return card;
  }

  function renderRows() {
    var host = $('rows');
    host.innerHTML = '';
    var rows = [];

    if (continueRow && continueRow.items.length) {
      rows.push(continueRow);
    }
    rows = rows.concat(catalog.rows || []);

    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nada no catálogo ainda. Edite catalog.json para adicionar seus vídeos.';
      host.appendChild(empty);
      return;
    }

    rows.forEach(function (row, index) {
      var section = document.createElement('section');
      section.className = 'row';

      var title = document.createElement('h2');
      title.className = 'row-title';
      title.textContent = row.title || ('Linha ' + (index + 1));
      section.appendChild(title);

      var track = document.createElement('div');
      track.className = 'track';
      (row.items || []).forEach(function (item) {
        track.appendChild(buildCard(item, index));
      });
      section.appendChild(track);

      host.appendChild(section);
    });
  }

  function setHero(item) {
    if (!item) {
      return;
    }
    $('heroTitle').textContent = item.title || 'Extrato de Tomate';
    $('heroDesc').textContent = item.desc || '';
    $('heroKicker').textContent = item.kicker || 'DESTAQUE';
    var bg = $('heroBg');
    bg.style.backgroundImage = 'url("' + artFor(item) + '")';
    $('heroPlay').onclick = function () {
      if (window.EXTRATO_CONFIG && window.EXTRATO_CONFIG.mode !== 'local' && loggedIn() && item.raw) {
        openSeries(item);
      } else {
        play(item, 0);
      }
    };
    $('heroInfo').onclick = function () { openDetail(item); };
  }

  // ---------------------------------------------------------------- spatial navigation
  function focusables() {
    var scope = nav.scope === 'player' ? $('player')
      : (nav.scope === 'search' ? $('search')
        : (nav.scope === 'login' ? $('login')
          : (nav.scope === 'diag' ? $('diag') : (modalOpen ? $('modal') : document))));
    var list = Array.prototype.slice.call(scope.querySelectorAll('.focusable'));
    return list.filter(function (el) {
      return el.offsetParent !== null || el === nav.current;
    });
  }

  function setFocus(el) {
    if (!el) {
      return;
    }
    if (nav.current && nav.current.classList) {
      nav.current.classList.remove('focused');
    }
    nav.current = el;
    el.classList.add('focused');
    try { el.focus({ preventScroll: true }); } catch (e) { }
    reveal(el);
  }

  function reveal(el) {
    var track = el.closest ? el.closest('.track') : null;
    if (track) {
      var left = el.offsetLeft - track.clientWidth / 2 + el.offsetWidth / 2;
      track.scrollTo({ left: left, behavior: 'smooth' });
    }
    var rect = el.getBoundingClientRect();
    if (rect.top < 70 || rect.bottom > window.innerHeight - 40) {
      window.scrollBy({ top: rect.top - 120, behavior: 'smooth' });
    }
  }

  function move(direction) {
    var list = focusables();
    if (!list.length) {
      return;
    }
    if (!nav.current) {
      setFocus(list[0]);
      return;
    }
    var inRail = !!(nav.current.closest && nav.current.closest('.rail'));
    list = list.filter(function (el) {
      var isRail = !!(el.closest && el.closest('.rail'));
      if (inRail) {
        return isRail || direction === 'right';
      }
      if (isRail) {
        return direction === 'left';
      }
      return true;
    });
    if (!list.length) {
      return;
    }

    var from = nav.current.getBoundingClientRect();
    var fromX = from.left + from.width / 2;
    var fromY = from.top + from.height / 2;
    var best = null;
    var bestScore = Infinity;

    list.forEach(function (el) {
      if (el === nav.current) {
        return;
      }
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) {
        return;
      }
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var dx = x - fromX;
      var dy = y - fromY;
      var primary = 0;
      var secondary = 0;
      if (direction === 'right') { if (dx <= 6) { return; } primary = dx; secondary = Math.abs(dy); }
      else if (direction === 'left') { if (dx >= -6) { return; } primary = -dx; secondary = Math.abs(dy); }
      else if (direction === 'down') { if (dy <= 6) { return; } primary = dy; secondary = Math.abs(dx); }
      else { if (dy >= -6) { return; } primary = -dy; secondary = Math.abs(dx); }
      var score = primary + secondary * 2.4;
      if (direction === 'up' || direction === 'down') {
        score += secondary * 1.6;
      }
      if (secondary > 6) { score += 120; }
      var sameTrack = el.closest && nav.current.closest &&
        el.closest('.track') && el.closest('.track') === nav.current.closest('.track');
      if (sameTrack && (direction === 'left' || direction === 'right')) {
        score -= 40;
      }
      if (score < bestScore) { bestScore = score; best = el; }
    });

    if (!best) {
      // wrap inside the same row
      if (direction === 'left' || direction === 'right') {
        var row = nav.current.closest ? nav.current.closest('.track') : null;
        if (row) {
          var cards = Array.prototype.slice.call(row.querySelectorAll('.focusable'));
          var index = cards.indexOf(nav.current);
          if (index >= 0 && cards.length > 1) {
            best = direction === 'right' ? cards[0] : cards[cards.length - 1];
          }
        }
      }
      // rail is self contained; right jumps back to content
      if (!best && nav.current.closest && nav.current.closest('.rail') && direction === 'right') {
        var first = focusables().filter(function (el) { return !el.closest('.rail'); })[0];
        best = first || null;
      }
    }
    if (best) {
      setFocus(best);
    }
  }

  function openDetail(item) {
    current = item;
    nav.returnTo = document.querySelector('.focused');
    $('modalTitle').textContent = item.title || '';
    $('modalDesc').textContent = item.desc || 'Sem descrição.';
    $('modal').classList.remove('hidden');
    modalOpen = true;
    nav.scope = 'modal';
    setFocus($('modalPlay'));
  }

  function closeDetail() {
    $('modal').classList.add('hidden');
    modalOpen = false;
    nav.scope = 'page';
  }

  // ---------------------------------------------------------------- player
  function play(item, startAt) {
    if (!item || !item.video) {
      $('modalTitle').textContent = item && item.title ? item.title : 'Sem vídeo';
      $('modalDesc').textContent = 'Este item não tem link de vídeo. Edite catalog.json para apontar um .m3u8 ou .mp4.';
      $('modal').classList.remove('hidden');
      modalOpen = true;
      nav.scope = 'modal';
      setFocus($('modalPlay'));
      return;
    }
    current = item;
    $('player').classList.remove('hidden');
    $('playerTitle').textContent = item.title || '';
    var notice = $('playerNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'playerNotice';
      notice.className = 'player-notice hidden';
      $('player').appendChild(notice);
    }
    if (item.warning) {
      notice.textContent = 'Sem relay: o CDN bloqueia o navegador. Publique o Worker (2 cliques) e cole o endereço em config.js.';
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }
    nav.scope = 'player';
    var video = $('video');

    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');

    var source = item.video;
    if (source && source.indexOf('.m3u8') >= 0) {
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(source);
        hls.attachMedia(video);
      } else {
        video.src = source; // Safari/iOS plays HLS natively
      }
    } else {
      video.src = source;
    }

    var resume = startAt || 0;
    if (!resume) {
      var entry = progressFor(item.id);
      if (entry && entry.t > 5 && (!entry.d || entry.t < entry.d * 0.96)) {
        resume = entry.t;
      }
    }
    if (resume > 0) {
      video.addEventListener('loadedmetadata', function once() {
        video.removeEventListener('loadedmetadata', once);
        try { video.currentTime = resume; } catch (e) { }
      });
    }

    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () {
        $('playerHint').classList.remove('hidden');
      });
    }
    setFocus($('btnPlay'));
    scheduleHideUi();
    clearInterval(saveTimer);
    saveTimer = setInterval(persistProgress, 5000);
  }

  function persistProgress() {
    if (!current) { return; }
    var video = $('video');
    if (!video.duration || !isFinite(video.duration)) { return; }
    saveProgress({
      key: current.id,
      id: current.id,
      t: video.currentTime,
      d: video.duration,
      title: current.title || '',
      video: current.video || '',
      at: Date.now()
    });
  }

  function closePlayer() {
    persistProgress();
    clearInterval(saveTimer);
    var video = $('video');
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
    $('player').classList.add('hidden');
    $('playerHint').classList.add('hidden');
    nav.scope = modalOpen ? 'modal' : 'page';
    buildContinueRow();
    renderRows();
    if (nav.returnTo && document.body.contains(nav.returnTo)) {
      setFocus(nav.returnTo);
    } else {
      var list = focusables();
      if (list.length) { setFocus(list[0]); }
    }
  }

  function togglePlay() {
    var video = $('video');
    if (video.paused) {
      var p = video.play();
      if (p && p.catch) { p.catch(function () { }); }
    } else {
      video.pause();
    }
  }

  function seek(delta) {
    var video = $('video');
    var target = video.currentTime + delta;
    if (target < 0) { target = 0; }
    if (video.duration && target > video.duration - 1) { target = video.duration - 1; }
    video.currentTime = target;
  }

  function scheduleHideUi() {
    clearTimeout(hideTimer);
    var ui = $('playerUi');
    ui.classList.remove('hidden-ui');
    hideTimer = setTimeout(function () {
      if (!$('video').paused) { ui.classList.add('hidden-ui'); }
    }, 4200);
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) { seconds = 0; }
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function wirePlayer() {
    var video = $('video');
    video.addEventListener('timeupdate', function () {
      var d = video.duration || 0;
      $('curTime').textContent = formatTime(video.currentTime);
      $('durTime').textContent = formatTime(d);
      $('timelineFill').style.width = d ? ((video.currentTime / d) * 100) + '%' : '0%';
    });
    video.addEventListener('play', function () {
      $('btnPlay').textContent = '❚❚';
      scheduleHideUi();
    });
    video.addEventListener('pause', function () {
      $('btnPlay').textContent = '▶';
      $('playerUi').classList.remove('hidden-ui');
    });
    video.addEventListener('error', function () {
      if (!current || !current.episodeId || !window.Tomato) { return; }
      if (current.recoveries === undefined) { current.recoveries = 0; }
      if (current.recoveries >= 3) { return; }
      current.recoveries++;
      var resumeAt = video.currentTime || 0;
      window.Tomato.streamUrl(current.episodeId).then(function (stream) {
        return window.Tomato.prepare(stream.direct).then(function (prepared) {
          var item = current;
          item.video = prepared.playlist;
          item.direct = stream.direct;
          item.transport = prepared.mode;
          play(item, resumeAt);
        });
      }).catch(function () { });
    });

    video.addEventListener('ended', function () {
      persistProgress();
      closePlayer();
    });
    $('btnPlay').onclick = function () { togglePlay(); };
    $('btnBack').onclick = function () { seek(-10); scheduleHideUi(); };
    $('btnFwd').onclick = function () { seek(10); scheduleHideUi(); };
    $('btnMute').onclick = function () { video.muted = !video.muted; };
    $('btnNext').onclick = function () { closePlayer(); };
    $('playerClose').onclick = function () { closePlayer(); };
    $('modalClose').onclick = function () { closeDetail(); };
    $('modalPlay').onclick = function () {
      var item = current;
      closeDetail();
      if (item) { play(item, 0); }
    };
  }

  // ---------------------------------------------------------------- continue watching
  function buildContinueRow() {
    var store = loadStore();
    var items = [];
    Object.keys(store).forEach(function (key) {
      var entry = store[key];
      if (!entry || !entry.video) { return; }
      if (entry.d && entry.t > entry.d * 0.96) { return; }
      items.push({ id: entry.id || key, title: entry.title, video: entry.video, resume: entry.t });
    });
    items.sort(function (a, b) { return (b.resume || 0) - (a.resume || 0); });
    continueRow = items.length ? { title: 'Continuar assistindo', items: items } : null;
  }

  // ---------------------------------------------------------------- keys
  var KEY = {
    LEFT: [37, 4], RIGHT: [39, 5], UP: [38, 19], DOWN: [40, 20],
    OK: [13, 32], BACK: [27, 8, 461, 10009], PLAY: [179, 415], FWD: [417, 228], REW: [412, 227]
  };

  function includes(list, code) { return list.indexOf(code) >= 0; }

  function handleKey(event) {
    var code = event.keyCode;
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    if (nav.scope === 'diag') {
      if (includes(KEY.BACK, code)) {
        event.preventDefault();
        $('diag').classList.add('hidden');
        modalOpen = false;
        nav.scope = 'page';
      }
      return;
    }

    if (nav.scope === 'login') {
      if (includes(KEY.BACK, code)) { event.preventDefault(); closeLogin(); }
      return;
    }

    if (nav.scope === 'search') {
      if (includes(KEY.BACK, code)) { event.preventDefault(); closeSearch(); }
      return;
    }

    if (nav.scope === 'player') {
      if (includes(KEY.BACK, code)) { event.preventDefault(); closePlayer(); return; }
      if (includes(KEY.PLAY, code)) { event.preventDefault(); togglePlay(); scheduleHideUi(); return; }
      if (includes(KEY.FWD, code)) { event.preventDefault(); seek(10); scheduleHideUi(); return; }
      if (includes(KEY.REW, code)) { event.preventDefault(); seek(-10); scheduleHideUi(); return; }
      if (includes(KEY.LEFT, code)) { event.preventDefault(); move('left'); scheduleHideUi(); return; }
      if (includes(KEY.RIGHT, code)) { event.preventDefault(); move('right'); scheduleHideUi(); return; }
      if (includes(KEY.OK, code)) {
        event.preventDefault();
        scheduleHideUi();
        if (nav.current && nav.current.click) { nav.current.click(); } else { togglePlay(); }
        return;
      }
      if ($('playerUi').classList.contains('hidden-ui')) { scheduleHideUi(); }
      return;
    }

    if (includes(KEY.LEFT, code)) { event.preventDefault(); move('left'); return; }
    if (includes(KEY.RIGHT, code)) { event.preventDefault(); move('right'); return; }
    if (includes(KEY.UP, code)) { event.preventDefault(); move('up'); return; }
    if (includes(KEY.DOWN, code)) { event.preventDefault(); move('down'); return; }
    if (includes(KEY.OK, code)) {
      event.preventDefault();
      if (nav.current && nav.current.click) { nav.current.click(); }
      return;
    }
    if (includes(KEY.BACK, code)) {
      event.preventDefault();
      if (modalOpen) { closeDetail(); }
      return;
    }
  }

  // gamepad polling so a TV box controller works too
  function pollGamepads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      var pad = pads[i];
      if (!pad) { continue; }
      var now = Date.now();
      if (pad.timestamp === pad._lastStamp) { continue; }
      pad._lastStamp = pad.timestamp;
      var pressed = function (index) { return pad.buttons[index] && pad.buttons[index].pressed; };
      if (!pad._last) { pad._last = now; }
      if (now - pad._last < 90) { continue; }
      var moved = false;
      var fake = function (code) {
        pad._last = now;
        handleKey({ keyCode: code, preventDefault: function () { }, target: document.body });
        moved = true;
      };
      if (pressed(12)) { fake(38); }
      else if (pressed(13)) { fake(40); }
      else if (pressed(14)) { fake(37); }
      else if (pressed(15)) { fake(39); }
      else if (pressed(0)) { fake(13); }
      else if (pressed(1)) { fake(27); }
      if (!moved && pad.axes && pad.axes.length >= 2) {
        if (pad.axes[1] < -0.6) { fake(38); }
        else if (pad.axes[1] > 0.6) { fake(40); }
        else if (pad.axes[0] < -0.6) { fake(37); }
        else if (pad.axes[0] > 0.6) { fake(39); }
      }
    }
    requestAnimationFrame(pollGamepads);
  }


  // ---------------------------------------------------------------- rail actions
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var hero = $('heroPlay');
    if (hero) { setFocus(hero); }
  }

  function goContinue() {
    var row = document.querySelectorAll('.row')[continueRow ? 0 : -1];
    if (!continueRow) {
      scrollToTop();
      return;
    }
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var card = row.querySelector('.focusable');
      if (card) { setFocus(card); }
    }
  }

  function openSearch() {
    var overlay = $('search');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'search';
      overlay.className = 'modal';
      overlay.innerHTML = '<div class="modal-card">' +
        '<h2>Buscar</h2>' +
        '<input id="searchInput" type="search" placeholder="Digite o título e aperte Enter" autocomplete="off">' +
        '<div id="searchResults" class="search-results"></div>' +
        '<div class="modal-actions"><button class="btn focusable" id="searchClose" tabindex="0">Fechar</button></div>' +
        '</div>';
      document.body.appendChild(overlay);
      $('searchClose').onclick = closeSearch;
      $('searchInput').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          runSearch($('searchInput').value);
        }
        if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
      });
    }
    overlay.classList.remove('hidden');
    modalOpen = true;
    nav.scope = 'search';
    var input = $('searchInput');
    input.value = '';
    $('searchResults').innerHTML = '';
    setTimeout(function () { input.focus(); }, 40);
  }

  function closeSearch() {
    var overlay = $('search');
    if (overlay) { overlay.classList.add('hidden'); }
    modalOpen = false;
    nav.scope = 'page';
    scrollToTop();
  }

  function allItems() {
    var out = [];
    (catalog.rows || []).forEach(function (row) { out = out.concat(row.items || []); });
    return out;
  }

  function runSearch(term) {
    var query = (term || '').trim().toLowerCase();
    var host = $('searchResults');
    host.innerHTML = '';
    if (!query) { return; }
    var hits = allItems().filter(function (item) {
      return (item.title || '').toLowerCase().indexOf(query) >= 0;
    });
    if (!hits.length) {
      host.textContent = 'Nada encontrado para "' + term + '".';
      return;
    }
    hits.forEach(function (item) {
      var button = document.createElement('button');
      button.className = 'btn focusable';
      button.tabIndex = 0;
      button.textContent = item.title || '(sem título)';
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.marginBottom = '0.6vw';
      button.style.textAlign = 'left';
      button.onclick = function () {
        closeSearch();
        play(item, 0);
      };
      host.appendChild(button);
    });
  }

  function wireRail() {
    document.querySelectorAll('.rail-item').forEach(function (button) {
      var action = button.getAttribute('data-go');
      button.onclick = function () {
        if (action === 'home') { scrollToTop(); }
        else if (action === 'continue') { goContinue(); }
        else if (action === 'search') { openSearch(); }
        else if (action === 'account') { openLogin(); }
        else if (action === 'reload') { location.reload(); }
      };
    });
  }




  // ---------------------------------------------------------------- porta de entrada
  function renderWelcome() {
    var host = $('rows');
    host.innerHTML = '';

    $('heroTitle').textContent = 'Extrato de Tomate';
    $('heroKicker').textContent = 'SEM ANÚNCIOS';
    $('heroDesc').textContent = 'Entre com a mesma conta do aplicativo. O login acontece ' +
      'aqui no seu navegador — a senha não passa por servidor nenhum nosso, e o acesso fica ' +
      'guardado só neste aparelho.';
    $('heroPlay').textContent = '☺ Entrar';
    $('heroPlay').onclick = function () { openLogin(); };
    $('heroInfo').onclick = function () { openDiagnostic(); };

    var section = document.createElement('section');
    section.className = 'row';
    var title = document.createElement('h2');
    title.className = 'row-title';
    title.textContent = 'Primeiros passos';
    section.appendChild(title);

    var list = document.createElement('div');
    list.className = 'episode-list welcome-list';
    [['☺  Entrar na conta', 'abre o formulário com captcha', function () { openLogin(); }],
     ['⟳  Ver demonstração', 'clipes de teste, sem conta', function () {
       location.href = location.pathname + '?demo=1';
     }],
     ['⚙  Diagnóstico', 'testa token, catálogo, episódios e CORS', function () { openDiagnostic(); }]
    ].forEach(function (row) {
      var button = document.createElement('button');
      button.className = 'btn focusable episode-item';
      button.tabIndex = 0;
      button.textContent = row[0] + ' — ' + row[1];
      button.onclick = row[2];
      list.appendChild(button);
    });
    section.appendChild(list);
    host.appendChild(section);

    var cards = focusables();
    if (cards.length) { setFocus(cards[0]); }
  }

  function loadLocalCatalog() {
    fetch('./catalog.json', { cache: 'no-cache' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        catalog = data || { hero: null, rows: [] };
        setHero(catalog.hero);
        buildContinueRow();
        renderRows();
        var list = focusables();
        if (list.length) { setFocus(list[0]); }
      })
      .catch(function () {
        var empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Não consegui carregar catalog.json.';
        $('rows').appendChild(empty);
      });
  }


  // ---------------------------------------------------------------- diagnóstico na tela
  function openDiagnostic() {
    var overlay = $('diag');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'diag';
      overlay.className = 'modal';
      overlay.innerHTML = '<div class="modal-card"><h2>Diagnóstico</h2>' +
        '<div id="diagBody" class="diag-body">Testando…</div>' +
        '<input id="relayInput" class="login-input" type="url" placeholder="Endereço do relay (https://extrato-relay.SEU-USUARIO.workers.dev)">' +
        '<div class="modal-actions"><button class="btn primary focusable" id="relaySave" tabindex="0">Salvar relay</button>' +
        '<button class="btn focusable" id="diagRun" tabindex="0">Testar de novo</button>' +
        '<button class="btn focusable" id="diagClose" tabindex="0">Fechar</button></div></div>';
      document.body.appendChild(overlay);
      $('diagClose').onclick = function () {
        overlay.classList.add('hidden');
        modalOpen = false;
        nav.scope = 'page';
      };
      $('diagRun').onclick = function () { runDiagnostic(); };
      $('relaySave').onclick = function () {
        var value = $('relayInput').value.trim();
        if (window.Tomato) { window.Tomato.setRelayBase(value); }
        runDiagnostic();
      };
    }
    overlay.classList.remove('hidden');
    modalOpen = true;
    nav.scope = 'diag';
    if (window.Tomato) {
      $('relayInput').value = window.Tomato.relayBase() || '';
    }
    runDiagnostic();
  }

  function runDiagnostic() {
    var body = $('diagBody');
    body.innerHTML = 'Testando…';
    if (!window.Tomato) {
      body.textContent = 'tomato.js não carregou.';
      return;
    }
    window.Tomato.diagnose().then(function (steps) {
      body.innerHTML = '';
      steps.forEach(function (step) {
        var line = document.createElement('div');
        line.className = 'diag-line ' + (step.ok ? 'ok' : 'fail');
        line.textContent = (step.ok ? '✓ ' : '✗ ') + step.name + (step.detail ? ' — ' + step.detail : '');
        body.appendChild(line);
      });
    });
  }

  // ---------------------------------------------------------------- conta Tomate


  function loggedIn() {
    return !!(window.Tomato && window.Tomato.token());
  }

  function openLogin() {
    var overlay = $('login');
    overlay.classList.remove('hidden');
    modalOpen = true;
    nav.scope = 'login';
    $('loginError').classList.add('hidden');
    var logout = $('loginLogout');
    if (loggedIn()) { logout.classList.remove('hidden'); } else { logout.classList.add('hidden'); }
    var captchaHost = $('loginCaptcha');
    captchaHost.innerHTML = '';
    if (window.Tomato && window.EXTRATO_CONFIG && window.EXTRATO_CONFIG.hcaptchaKey) {
      window.Tomato.loadCaptcha(captchaHost, window.EXTRATO_CONFIG.hcaptchaKey)
        .then(function (handle) { captchaHandle = handle; })
        .catch(function (error) {
          captchaHost.textContent = 'Captcha não carregou (' + (error.message || '') +
            '). Dá para tentar entrar sem ele.';
          captchaHost.classList.add('login-error');
        });
    }
    setTimeout(function () {
      var email = $('loginEmail');
      if (email) { email.focus(); }
    }, 60);
  }

  function closeLogin() {
    $('login').classList.add('hidden');
    modalOpen = false;
    nav.scope = 'page';
  }

  function showLoginError(message) {
    var box = $('loginError');
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function submitLogin() {
    var email = $('loginEmail').value.trim();
    var password = $('loginPassword').value;
    if (!email || !password) {
      showLoginError('Preencha e-mail e senha.');
      return;
    }
    $('loginSubmit').textContent = 'Entrando…';
    $('loginError').classList.add('hidden');
    window.Tomato.login(email, password, captchaHandle ? captchaHandle.getToken() : '')
      .then(function () {
        $('loginSubmit').textContent = 'Entrar';
        closeLogin();
        reloadFromServer();
      })
      .catch(function (error) {
        $('loginSubmit').textContent = 'Entrar';
        showLoginError(error.message || 'Falha ao entrar.');
        if (captchaHandle && captchaHandle.reset) {
          try { captchaHandle.reset(); } catch (e) { }
        }
      });
  }

  function logout() {
    if (window.Tomato) { window.Tomato.clearToken(); }
    $('login').classList.add('hidden');
    modalOpen = false;
    nav.scope = 'page';
    reloadFromServer();
  }

  function reloadFromServer() {
    var host = $('rows');
    var tomatoMode = window.EXTRATO_CONFIG && window.EXTRATO_CONFIG.mode !== 'local';
    if (tomatoMode && !loggedIn() && !/[?&]demo=1/.test(location.search)) {
      renderWelcome();
      return;
    }
    host.innerHTML = '<p class="empty">Carregando catálogo…</p>';
    if (!loggedIn()) {
      loadLocalCatalog();
      return;
    }
    window.Tomato.loadCatalog().then(function (data) {
      catalog = data;
      setHero(data.hero);
      buildContinueRow();
      renderRows();
      var list = focusables();
      if (list.length) { setFocus(list[0]); }
    }).catch(function (error) {
      host.innerHTML = '';
      var box = document.createElement('p');
      box.className = 'empty';
      box.textContent = 'Não consegui carregar o catálogo: ' + (error.message || '');
      host.appendChild(box);
      var help = document.createElement('button');
      help.className = 'btn focusable';
      help.tabIndex = 0;
      help.textContent = 'Rodar diagnóstico';
      help.onclick = openDiagnostic;
      host.appendChild(help);
    });
  }

  // ---------------------------------------------------------------- série -> episódios
  function openSeries(item) {
    current = item;
    $('modalTitle').textContent = item.title || '';
    $('modalDesc').textContent = 'Carregando episódios…';
    $('modal').classList.remove('hidden');
    modalOpen = true;
    nav.scope = 'modal';
    setFocus($('modalPlay'));
    window.Tomato.loadSeries(item.id).then(function (data) {
      if (data.item && data.item.desc) { $('modalDesc').textContent = data.item.desc; }
      else { $('modalDesc').textContent = 'Escolha um episódio.'; }
      var list = $('episodeList');
      if (!list) {
        list = document.createElement('div');
        list.id = 'episodeList';
        list.className = 'episode-list';
        $('modalDesc').parentNode.insertBefore(list, $('modalDesc').nextSibling);
      }
      list.innerHTML = '';
      if (!data.seasons.length) {
        list.textContent = 'Nenhum episódio encontrado.';
        return;
      }
      data.seasons.forEach(function (episode) {
        var button = document.createElement('button');
        button.className = 'btn focusable episode-item';
        button.tabIndex = 0;
        button.textContent = (episode.number ? episode.number + '. ' : '') + episode.title;
        button.onclick = function () { playEpisode(episode); };
        list.appendChild(button);
      });
      $('modalPlay').classList.add('hidden');
    }).catch(function (error) {
      $('modalDesc').textContent = error.message || 'Falha ao abrir a série.';
    });
  }

  function playEpisode(episode) {
    $('modal').classList.add('hidden');
    modalOpen = false;
    window.Tomato.streamUrl(episode.id).then(function (stream) {
      return window.Tomato.prepare(stream.direct).then(function (prepared) {
        play({
          id: 'ep-' + episode.id,
          title: episode.title,
          video: prepared.playlist,
          direct: stream.direct,
          transport: prepared.mode,
          warning: prepared.warning,
          episodeId: episode.id
        }, 0);
      });
    }).catch(function (error) {
      $('modalTitle').textContent = 'Não deu para tocar';
      $('modalDesc').textContent = error.message || 'Stream indisponível.';
      $('modal').classList.remove('hidden');
      modalOpen = true;
      nav.scope = 'modal';
    });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('mousemove', function () { document.body.classList.add('pointer'); });
    wirePlayer();
    wireRail();
    requestAnimationFrame(pollGamepads);

    $('loginSubmit').onclick = function () { submitLogin(); };
    $('loginClose').onclick = function () { closeLogin(); };
    $('loginLogout').onclick = function () { logout(); };
    $('loginPassword').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); submitLogin(); }
    });

    reloadFromServer();

    if (/[?&]diag=1/.test(location.search)) {
      setTimeout(openDiagnostic, 400);
    }

    if (/[?&]reset=1/.test(location.search) && navigator.serviceWorker) {
      Promise.resolve(navigator.serviceWorker.getRegistrations()).then(function (regs) {
        regs.forEach(function (reg) { reg.unregister(); });
        return caches.keys();
      }).then(function (keys) {
        keys.forEach(function (key) { caches.delete(key); });
        location.href = location.pathname;
      });
      return;
    }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(function () { });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
