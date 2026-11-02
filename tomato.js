/* Cliente do servidor Tomate rodando inteiro no navegador.
   Nada de servidor: o token fica no localStorage, o captcha é resolvido na página
   e, se o CDN bloquear por CORS, as URLs passam pelo relay (relay/worker.js). */

(function (global) {
  'use strict';

  var CONFIG = global.EXTRATO_CONFIG || {};
  var TOKEN_KEY = 'extrato.token';
  var USER_KEY = 'extrato.user';

  function apiHost() {
    return 'https://' + (CONFIG.apiHost || 'prod-api.tomatoanimes.com');
  }

  function relayBase() {
    var saved = '';
    try { saved = localStorage.getItem('extrato.relay') || ''; } catch (e) { }
    return (saved || CONFIG.relayUrl || '').replace(/\/$/, '');
  }

  function setRelayBase(value) {
    try {
      if (value) { localStorage.setItem('extrato.relay', value.replace(/\/$/, '')); }
      else { localStorage.removeItem('extrato.relay'); }
    } catch (e) { }
  }


  /* O CDN devolve access-control-allow-origin: * nos links assinados, então o
     navegador toca direto. O relay fica como opção para CDN antigo sem CORS. */
  function prepare(directUrl) {
    var base = relayBase();
    if (base) {
      return Promise.resolve({
        mode: 'relay',
        playlist: base + '/?u=' + encodeURIComponent(directUrl)
      });
    }
    return Promise.resolve({ mode: 'direct', playlist: directUrl });
  }

  function relay(url) {
    var base = relayBase();
    if (!url || !base) { return url; }
    if (url.indexOf(base) === 0) { return url; }
    return base + '/?u=' + encodeURIComponent(url);
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function saveToken(value) {
    try { localStorage.setItem(TOKEN_KEY, value); } catch (e) { }
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { }
  }

  function deviceFingerprint() {
    var ua = navigator.userAgent || '';
    var screenInfo = (window.screen ? window.screen.width + 'x' + window.screen.height : '');
    return (ua.split(')')[0] + ')/' + screenInfo).replace(/\s/g, '_');
  }

  function api(path, options) {
    options = options || {};
    var headers = {
      'Accept': 'application/json',
      'User-Agent': 'tomato-android',
      'X-Requested-With': 'com.tomatos.clientapp'
    };
    if (token()) {
      headers['Authorization'] = 'Bearer ' + token();
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    var controller = null;
    var timer = null;
    var settings = {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      mode: 'cors',
      credentials: 'omit'
    };
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      settings.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, options.timeout || 15000);
    }
    var base = relayBase();
    var target = apiHost() + path;
    if (base && !options.direct) {
      target = base + '/?u=' + encodeURIComponent(target);
    }
    return fetch(target, settings).then(function (response) {
      if (timer) { clearTimeout(timer); }
      return response.text().then(function (text) {
        var parsed = null;
        var isJson = true;
        try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; isJson = false; }
        return { ok: response.ok, status: response.status, data: parsed, isJson: isJson };
      });
    }).catch(function (error) {
      if (timer) { clearTimeout(timer); }
      throw new Error(error && error.name === 'AbortError'
        ? 'servidor não respondeu em 15s' : 'falha de rede: ' + (error && error.message));
    });
  }

  // ---------------------------------------------------------------- login
  function login(email, password, captchaToken) {
    return api('/login/', {
      method: 'POST',
      body: {
        email: email,
        password: password,
        verification: (captchaToken || captchaState.token || ''),
        fingerprint: deviceFingerprint()
      }
    }).then(function (result) {
      var data = result.data || {};
      var code = String(data.status_code);

      /* Contrato do app: 4 = sucesso (o token vem em data.token),
         1 = dados inválidos, 30 = captcha inválido, 4 + user_isbanned = bloqueado. */
      if (code === '4' && String(data.user_isbanned || 0) === '1') {
        throw new Error('Conta bloqueada: ' + (data.user_ban_reason_text || 'sem motivo informado'));
      }
      if (code === '4') {
        var found = data.token || findToken(data);
        if (!found) {
          throw new Error('o servidor aceitou o login mas não devolveu token (chaves: ' +
            Object.keys(data).join(', ') + ')');
        }
        saveToken(String(found).replace(/"/g, ''));
        try {
          localStorage.setItem(USER_KEY, JSON.stringify({
            email: email,
            name: data.user_name || '',
            bio: data.bio || '',
            uuid: data.uuid || ''
          }));
        } catch (e) { }
        return { token: String(found).replace(/"/g, ''), data: data };
      }

      if (code === '30') {
        throw new Error('Captcha inválido ou expirado — resolva de novo.');
      }
      if (code === '1') {
        throw new Error('E-mail ou senha inválidos.');
      }
      if (result.isJson === false || code === 'undefined') {
        throw new Error('o servidor respondeu HTTP ' + result.status +
          ' sem dados válidos — está fora do ar ou bloqueando esta rede. Tente em alguns minutos ' +
          'ou por outra conexão.');
      }
      var keys = Object.keys(data).slice(0, 8).join(', ');
      throw new Error((data.message || 'Login recusado') + ' (código ' + code + ')' +
        (keys ? ' · resposta: ' + keys : ''));
    });
  }

  function findToken(node, depth) {
    depth = depth || 0;
    if (!node || depth > 5) { return ''; }
    if (typeof node === 'string') { return ''; }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var nested = findToken(node[i], depth + 1);
        if (nested) { return nested; }
      }
      return '';
    }
    if (typeof node === 'object') {
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var name = keys[k].toLowerCase();
        if ((name.indexOf('token') >= 0 || name === 'user_key' || name === 'bearer')
            && typeof node[keys[k]] === 'string' && node[keys[k]].length > 12) {
          return node[keys[k]];
        }
      }
      for (var j = 0; j < keys.length; j++) {
        var deep = findToken(node[keys[j]], depth + 1);
        if (deep) { return deep; }
      }
    }
    return '';
  }

  // ---------------------------------------------------------------- parsing genérico
  function pick(object, names) {
    for (var i = 0; i < names.length; i++) {
      var value = object[names[i]];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  }

  function looksLikeItem(object) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) { return false; }
    var id = pick(object, ['anime_id', 'id', 'ID', 'series_id']);
    var title = pick(object, ['anime_title', 'title', 'name', 'title_english', 'title_romaji']);
    var art = pick(object, ['anime_cover_url', 'cover_url', 'cover', 'image', 'poster', 'thumbnail',
      'anime_cover', 'image_url', 'banner']);
    return id !== undefined && title !== undefined && typeof title === 'string';
  }

  function normalizeItem(object) {
    return {
      id: String(pick(object, ['anime_id', 'id', 'ID', 'series_id'])),
      title: String(pick(object, ['anime_title', 'title', 'name', 'title_english', 'title_romaji'])),
      poster: pick(object, ['anime_cover_url', 'cover_url', 'cover', 'image', 'poster', 'thumbnail',
        'anime_cover', 'image_url', 'banner']) || '',
      desc: String(pick(object, ['anime_synopsis', 'synopsis', 'description', 'summary', 'desc']) || ''),
      raw: object
    };
  }

  function harvest(node, found, depth) {
    depth = depth || 0;
    if (!node || depth > 6 || found.length > 400) { return found; }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length && i < 200; i++) { harvest(node[i], found, depth + 1); }
      return found;
    }
    if (typeof node === 'object') {
      if (looksLikeItem(node)) {
        found.push(node);
        return found;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) { harvest(node[keys[k]], found, depth + 1); }
    }
    return found;
  }

  function dedupe(items) {
    var seen = {};
    return items.filter(function (item) {
      if (!item.id || seen[item.id]) { return false; }
      seen[item.id] = true;
      return true;
    });
  }

  // ---------------------------------------------------------------- catálogo (API real)
  /* /v2/animes/feed devolve blocos: tipo 3 = destaque, 5 = fileira de animes,
     7 = episódios recentes, 1 = aviso, 8 = histórico. */

  function blockItems(block) {
    if (!block || !Array.isArray(block.data)) { return []; }
    return block.data.filter(function (entry) {
      return entry && (entry.anime_id || entry.ep_anime_id);
    });
  }

  function toCard(entry) {
    if (entry.ep_id) {
      return {
        id: 'ep-' + entry.ep_id,
        episodeId: String(entry.ep_id),
        animeId: String(entry.ep_anime_id),
        title: (entry.anime_name || '') + (entry.ep_name ? ' — ' + entry.ep_name : ''),
        poster: entry.thumbnail || '',
        episode: true
      };
    }
    return {
      id: String(entry.anime_id),
      animeId: String(entry.anime_id),
      title: '',                 // o feed só traz a capa; o nome vem ao abrir
      poster: entry.thumbnail || '',
      episode: false
    };
  }


  function describeStatus(status, what) {
    if (status === 500 || status === 502 || status === 503 || status === 504
        || status === 429 || status === 403) {
      return 'o servidor recusou o ' + what + ' (HTTP ' + status + '). É limite por IP: ' +
        'ative o modo avião por 5 segundos e volte (pega IP novo), troque para o 5G, ' +
        'ou configure o relay no Diagnóstico para nunca mais esbarrar nisso.';
    }
    if (status === 403) {
      return 'sessão recusada (HTTP 403) — clique em ☺ e entre de novo.';
    }
    if (status === 429) {
      return 'muitos pedidos seguidos (HTTP 429) — espere um pouco.';
    }
    return what + ': HTTP ' + status;
  }

  var CACHE_KEY = 'extrato.catalog';

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) { return null; }
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.payload) { return null; }
      return parsed;
    } catch (e) { return null; }
  }

  function writeCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: payload }));
    } catch (e) { }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function buildCatalog(payload) {
    var blocks = Array.isArray(payload.data) ? payload.data : [];
    if (!blocks.length) {
      throw new Error('catálogo veio vazio');
    }
    var hero = null;
    var rows = [];
    var warnings = [];

    blocks.forEach(function (block) {
      var type = Number(block.type);
      var items = blockItems(block);
      if (type === 1 && block.text) {
        warnings.push(String(block.text).split('\n').slice(0, 2).join(' '));
        return;
      }
      if (!items.length) { return; }
      var cards = items.map(toCard);
      if ((type === 3 || type === 6) && !hero) {
        hero = cards[0];
        hero.kicker = block.title || 'Em alta';
        return;
      }
      rows.push({ title: block.title || 'Destaques', items: cards });
    });

    return { hero: hero, rows: rows, warnings: warnings, raw: payload };
  }

  /* O feed às vezes devolve 500 sozinho; tenta mais duas vezes e, se não der,
     entrega o último catálogo bom em vez de tela vazia. */
  function loadCatalog(attempt) {
    attempt = attempt || 0;
    return api('/v2/animes/feed?page=1').then(function (result) {
      if (!result.ok) {
        throw new Error(describeStatus(result.status, 'catálogo'));
      }
      var catalog = buildCatalog(result.data || {});
      writeCache(result.data);
      return catalog;
    }).catch(function (error) {
      if (attempt < 2) {
        return delay(1500 + attempt * 2500).then(function () { return loadCatalog(attempt + 1); });
      }
      var cached = readCache();
      if (cached) {
        try {
          var fallback = buildCatalog(cached.payload);
          fallback.fromCache = new Date(cached.at).toLocaleString('pt-BR');
          fallback.warnings = (fallback.warnings || []).concat([error.message]);
          return fallback;
        } catch (e) { }
      }
      throw error;
    });
  }

  function loadSeries(animeId) {
    return api('/v2/anime/' + encodeURIComponent(animeId)).then(function (result) {
      if (!result.ok) {
        throw new Error(describeStatus(result.status, 'série'));
      }
      var payload = result.data || {};
      var details = payload.anime_details || {};
      var seasons = Array.isArray(payload.anime_seasons) ? payload.anime_seasons : [];
      if (!seasons.length) {
        throw new Error('esta série não tem temporadas');
      }
      var season = seasons[0];
      return api('/season/' + encodeURIComponent(season.season_id) + '/episodes', {
        method: 'POST',
        body: { page: 1, order: 1 }
      }).then(function (episodes) {
        var list = [];
        if (episodes.ok && Array.isArray(episodes.data.data)) {
          list = episodes.data.data.map(function (entry) {
            return {
              id: String(entry.ep_id || entry.id),
              title: entry.ep_name || entry.name || ('Episódio ' + (entry.ep_number || '')),
              number: entry.ep_number || '',
              dubbed: entry.dubbed,
              raw: entry
            };
          }).filter(function (entry) { return entry.id && entry.id !== 'undefined'; });
        }
        return {
          item: {
            id: String(details.anime_id || animeId),
            title: details.anime_name || '',
            desc: details.anime_description || '',
            poster: details.anime_cover_url || '',
            banner: details.anime_cape_url || '',
            episodes: details.anime_episodes || list.length
          },
          seasons: list,
          seasonCount: seasons.length,
          seasonName: season.season_name || ''
        };
      });
    });
  }

  function streamUrl(episodeId, quality) {
    return api('/v2/anime/episode/' + encodeURIComponent(episodeId) + '/stream').then(function (result) {
      if (!result.ok) {
        throw new Error(describeStatus(result.status, 'vídeo'));
      }
      var streams = (result.data && result.data.streams) || {};
      var order = quality === 'fhd' ? ['fhd', 'mhd', 'shd']
        : (quality === 'shd' ? ['shd', 'mhd', 'fhd'] : ['mhd', 'fhd', 'shd']);
      var url = '';
      for (var i = 0; i < order.length; i++) {
        if (streams[order[i]]) { url = streams[order[i]]; break; }
      }
      if (!url) { throw new Error('o servidor não devolveu vídeo para este episódio'); }
      return { direct: url, quality: order[i - 1] || 'mhd' };
    });
  }

  // ---------------------------------------------------------------- captcha
  /* Com render=explicit o hCaptcha exige esperar o onload da API; renderizar
     antes disso falha silenciosamente e o login ia sem verificação. */
  var captchaState = { token: '', widgetId: null, ready: false };

  function captchaToken() {
    return captchaState.token || '';
  }

  function loadCaptcha(container, siteKey) {
    return new Promise(function (resolve, reject) {
      var settled = false;

      function done() {
        if (settled) { return; }
        settled = true;
        resolve({
          getToken: captchaToken,
          widgetId: captchaState.widgetId,
          reset: function () {
            captchaState.token = '';
            if (global.hcaptcha && captchaState.widgetId !== null) {
              try { global.hcaptcha.reset(captchaState.widgetId); } catch (e) { }
            }
          }
        });
      }

      function render() {
        if (!global.hcaptcha || typeof global.hcaptcha.render !== 'function') {
          return false;
        }
        if (captchaState.ready) { done(); return true; }
        try {
          container.innerHTML = '';
          captchaState.widgetId = global.hcaptcha.render(container, {
            sitekey: siteKey,
            theme: 'dark',
            callback: function (response) { captchaState.token = response; },
            'expired-callback': function () { captchaState.token = ''; },
            'error-callback': function () { captchaState.token = ''; }
          });
          captchaState.ready = true;
          done();
          return true;
        } catch (error) {
          reject(error);
          return true;
        }
      }

      if (render()) { return; }

      global.__extratoCaptchaReady = function () { render(); };

      var script = document.querySelector('script[data-extrato-hcaptcha]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&hl=pt&onload=__extratoCaptchaReady';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-extrato-hcaptcha', '1');
        script.onerror = function () { reject(new Error('Falha ao carregar o hCaptcha.')); };
        document.head.appendChild(script);
      }

      // rede lenta: tenta de novo por conta própria antes de desistir
      var attempts = 0;
      var poll = setInterval(function () {
        attempts++;
        if (render() || attempts > 40) {
          clearInterval(poll);
          if (attempts > 40) { reject(new Error('hCaptcha não carregou a tempo.')); }
        }
      }, 250);
    });
  }

  // ---------------------------------------------------------------- diagnóstico
  function diagnose() {
    var steps = [];
    var shapes = {};

    function add(name, ok, detail) {
      steps.push({ name: name, ok: ok, detail: detail || '' });
    }

    return Promise.resolve()
      .then(function () {
        add('Token salvo no navegador', !!token(), token() ? 'presente' : 'nenhum — clique em Entrar');
        if (!token()) { return; }
        return api('/v2/animes/feed?page=1').then(function (feed) {
          add('Catálogo (/v2/animes/feed)', feed.ok,
            'HTTP ' + feed.status + ' · ' + ((feed.data && feed.data.data) ? feed.data.data.length : 0) + ' blocos');
          if (!feed.ok) { return; }
          var blocks = feed.data.data || [];
          var withItems = blocks.filter(function (b) { return b.data && b.data.length; });
          add('Fileiras com conteúdo', withItems.length > 0, withItems.length + ' de ' + blocks.length);
          var animeBlock = blocks.filter(function (b) { return Number(b.type) === 5 || Number(b.type) === 3; })[0];
          if (!animeBlock) { return; }
          var animeId = animeBlock.data[0].anime_id;
          return api('/v2/anime/' + animeId).then(function (detail) {
            var payload = detail.data || {};
            var info = payload.anime_details || {};
            var season = (payload.anime_seasons || [])[0] || {};
            add('Série (' + animeId + ')', detail.ok, detail.ok ? (info.anime_name || '?') : ('HTTP ' + detail.status));
            if (!detail.ok || !season.season_id) { return; }
            return api('/season/' + season.season_id + '/episodes', {
              method: 'POST', body: { page: 1, order: 1 }
            }).then(function (episodes) {
              var list = (episodes.data && episodes.data.data) || [];
              add('Episódios', episodes.ok, episodes.ok ? list.length + ' episódios' : ('HTTP ' + episodes.status));
              if (!list.length) { return; }
              var epId = list[0].ep_id || list[0].id;
              return streamUrl(epId).then(function (stream) {
                add('URL de stream', !!stream.direct, stream.direct.split('/')[2]);
                return fetch(stream.direct, { method: 'GET', mode: 'cors' }).then(function (response) {
                  add('CDN libera o navegador (CORS)', response.ok,
                    'HTTP ' + response.status + (response.ok ? ' — toca direto, sem relay' : ' — use o relay'));
                }).catch(function () {
                  add('CDN libera o navegador (CORS)', false, 'bloqueado — configure o relay');
                });
              });
            });
          });
        });
      })
      .catch(function (error) {
        add('Falha', false, String(error && error.message));
      })
      .then(function () { return steps; });
  }

  global.Tomato = {
    token: token,
    saveToken: saveToken,
    clearToken: clearToken,
    login: login,
    loadCatalog: loadCatalog,
    loadSeries: loadSeries,
    streamUrl: streamUrl,
    relay: relay,
    relayBase: relayBase,
    setRelayBase: setRelayBase,
    api: api,
    loadCaptcha: loadCaptcha,
    captchaToken: captchaToken,
    diagnose: diagnose,
    prepare: prepare
  };
})(window);
