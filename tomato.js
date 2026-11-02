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
    return fetch(apiHost() + path, settings).then(function (response) {
      if (timer) { clearTimeout(timer); }
      return response.text().then(function (text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
        return { ok: response.ok, status: response.status, data: parsed };
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
        verification: captchaToken || '',
        fingerprint: deviceFingerprint()
      }
    }).then(function (result) {
      var data = result.data || {};
      var statusCode = data.status_code;
      var ok = (statusCode === 0 || statusCode === '0' || statusCode === 3 || statusCode === '3')
        && findToken(data);
      if (!ok) {
        var message = data.message || 'Login recusado pelo servidor.';
        if (String(statusCode) === '1') { message = 'E-mail ou senha inválidos.'; }
        if (String(statusCode) === '2') { message = 'Captcha inválido ou expirado — resolva de novo.'; }
        var error = new Error(message);
        error.payload = data;
        throw error;
      }
      var found = findToken(data);
      saveToken(found);
      try { localStorage.setItem(USER_KEY, JSON.stringify({ email: email })); } catch (e) { }
      return { token: found, data: data };
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

  // ---------------------------------------------------------------- catálogo
  var HOME_PATHS = ['/v2/anime/home', '/v2/anime/recent', '/v2/anime/genres'];

  function loadCatalog() {
    var index = 0;

    function next() {
      if (index >= HOME_PATHS.length) {
        throw new Error('Nenhum endpoint de catálogo respondeu.');
      }
      var path = HOME_PATHS[index++];
      return api(path).then(function (result) {
        if (!result.ok) { return next(); }
        var raw = harvest(result.data, [], 0);
        var items = dedupe(raw.map(normalizeItem)).filter(function (item) { return item.title; });
        if (!items.length) { return next(); }
        var rowTitle = path.indexOf('recent') >= 0 ? 'Adicionados recentemente'
          : (path.indexOf('genres') >= 0 ? 'Catálogo' : 'Em alta');
        return {
          hero: items[0],
          rows: [
            { title: rowTitle, items: items.slice(0, 30) },
            { title: 'Todos', items: items.slice(30) }
          ].filter(function (row) { return row.items.length; }),
          raw: result.data
        };
      });
    }

    return next();
  }

  function loadSeries(id) {
    return api('/v2/anime/' + encodeURIComponent(id)).then(function (result) {
      if (!result.ok) {
        throw new Error('Série indisponível (' + result.status + ').');
      }
      var episodes = harvestEpisodes(result.data);
      return {
        item: normalizeItem(result.data.anime || result.data.data || result.data),
        seasons: episodes
      };
    });
  }

  function harvestEpisodes(node, depth, out) {
    depth = depth || 0;
    out = out || [];
    if (!node || depth > 7 || out.length > 500) { return out; }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) { harvestEpisodes(node[i], depth + 1, out); }
      return out;
    }
    if (typeof node === 'object') {
      var id = pick(node, ['episode_id', 'id']);
      var title = pick(node, ['episode_title', 'title', 'name']);
      if (id !== undefined && title !== undefined && typeof title === 'string'
          && (node.episode_number !== undefined || node.episode_id !== undefined
              || node.anime_id !== undefined)) {
        out.push({
          id: String(id),
          title: String(title),
          number: pick(node, ['episode_number', 'number', 'episode']) || '',
          raw: node
        });
        return out;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) { harvestEpisodes(node[keys[k]], depth + 1, out); }
    }
    return out;
  }

  // ---------------------------------------------------------------- stream
  function streamUrl(episodeId) {
    return api('/v2/anime/episode/' + encodeURIComponent(episodeId) + '/stream').then(function (result) {
      var url = findUrl(result.data);
      if (!url) {
        throw new Error(result.ok ? 'O servidor não devolveu URL de vídeo.' : 'Stream negado (' + result.status + ').');
      }
      return { direct: url, proxied: relay(url) };
    });
  }

  function findUrl(node, depth) {
    depth = depth || 0;
    if (!node || depth > 6) { return ''; }
    if (typeof node === 'string') {
      return /^https?:\/\/.+\.(m3u8|mp4)(\?|$)/.test(node) ? node : '';
    }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var inArray = findUrl(node[i], depth + 1);
        if (inArray) { return inArray; }
      }
      return '';
    }
    if (typeof node === 'object') {
      var preferred = ['stream_url', 'url', 'hls', 'link', 'file', 'source', 'video'];
      for (var p = 0; p < preferred.length; p++) {
        var direct = node[preferred[p]];
        if (typeof direct === 'string' && /^https?:\/\//.test(direct)) { return direct; }
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var deep = findUrl(node[keys[k]], depth + 1);
        if (deep) { return deep; }
      }
    }
    return '';
  }

  // ---------------------------------------------------------------- captcha
  function loadCaptcha(container, siteKey) {
    return new Promise(function (resolve, reject) {
      function render() {
        if (!global.hcaptcha) { reject(new Error('hCaptcha não carregou.')); return; }
        container.innerHTML = '';
        var widgetId = global.hcaptcha.render(container, {
          sitekey: siteKey,
          theme: 'dark',
          callback: function (response) { resolve({ token: response, widgetId: widgetId }); }
        });
      }
      if (global.hcaptcha) { render(); return; }
      var script = document.createElement('script');
      script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&hl=pt';
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = function () { reject(new Error('Falha ao carregar o hCaptcha.')); };
      document.head.appendChild(script);
    });
  }


  // ---------------------------------------------------------------- diagnóstico
  function diagnose() {
    var steps = [];
    var firstId = '';
    var firstEpisodeId = '';

    function add(name, ok, detail) {
      steps.push({ name: name, ok: ok, detail: detail || '' });
    }

    return Promise.resolve()
      .then(function () {
        add('Token salvo no navegador', !!token(), token() ? 'presente' : 'nenhum — clique em Entrar');
        add('Relay configurado', !!relayBase(),
          relayBase() || 'não — o CDN não manda CORS, então o play vai bloquear');
        if (!token()) { return; }
        return api('/v2/anime/home').then(function (result) {
          var keys = result.data && typeof result.data === 'object'
            ? Object.keys(result.data).slice(0, 8).join(', ') : 'sem JSON';
          add('Catálogo (/v2/anime/home)', result.ok, 'HTTP ' + result.status + ' · ' + keys);
          if (!result.ok) { return; }
          var items = dedupe(harvest(result.data, [], 0)).map(normalizeItem);
          add('Séries encontradas no catálogo', items.length > 0, items.length + ' itens');
          if (!items.length) { return; }
          firstId = items[0].id;
          add('Primeira série', true, items[0].title + ' (id ' + firstId + ')');
          return api('/v2/anime/' + encodeURIComponent(firstId)).then(function (series) {
            var episodes = harvestEpisodes(series.data);
            add('Episódios da série', episodes.length > 0,
              series.ok ? episodes.length + ' episódios' : 'HTTP ' + series.status);
            if (!episodes.length) { return; }
            firstEpisodeId = episodes[0].id;
            add('Primeiro episódio', true, episodes[0].title + ' (id ' + firstEpisodeId + ')');
            return api('/v2/anime/episode/' + encodeURIComponent(firstEpisodeId) + '/stream').then(function (stream) {
              var url = findUrl(stream.data);
              add('URL de stream', !!url, url ? 'recebida (' + url.split('/')[2] + ')' : 'HTTP ' + stream.status);
              if (!url) { return; }
              return fetch(url, { method: 'GET', mode: 'cors' }).then(function (response) {
                add('CDN libera o navegador (CORS)', response.ok,
                  'HTTP ' + response.status + ' — ' +
                  (response.ok ? 'dá para tocar direto, sem relay'
                    : 'bloqueado; use o relay (relay/worker.js)'));
              }).catch(function (error) {
                add('CDN libera o navegador (CORS)', false,
                  'bloqueado pelo navegador (CORS) — use o relay (relay/worker.js)');
              });
            });
          });
        });
      })
      .catch(function (error) {
        add('Falha inesperada', false, String(error && error.message));
      })
      .then(function () { return steps; });
  }


  // ---------------------------------------------------------------- improviso sem relay
  /* O CDN não manda CORS. Sem um relay próprio, o jeito é: baixar o texto da
     playlist por um proxy público que libere CORS, reescrever cada segmento
     para passar pelo mesmo proxy e entregar ao player uma playlist em blob.
     Funciona, mas depende de proxy de terceiros — o relay próprio é melhor. */
  var PUBLIC_PROXY = 'https://api.allorigins.win/raw?url=';

  function viaProxy(url) {
    return PUBLIC_PROXY + encodeURIComponent(url);
  }

  function prepare(directUrl) {
    var base = relayBase();
    if (base) {
      return Promise.resolve({
        mode: 'relay',
        playlist: base + '/?u=' + encodeURIComponent(directUrl)
      });
    }

    if (!/\.m3u8(\?|$)/i.test(directUrl)) {
      return Promise.resolve({ mode: 'proxy', playlist: viaProxy(directUrl) });
    }

    return fetch(viaProxy(directUrl), { mode: 'cors' })
      .then(function (response) {
        if (!response.ok) { throw new Error('proxy respondeu ' + response.status); }
        return response.text();
      })
      .then(function (text) {
        if (text.indexOf('#EXTM3U') < 0) {
          throw new Error('proxy não devolveu playlist');
        }
        var base = directUrl;
        var out = text.split(/\r?\n/).map(function (line) {
          var trimmed = line.trim();
          if (!trimmed || trimmed.charAt(0) === '#') { return line; }
          var absolute = new URL(trimmed, base).toString();
          if (/\.m3u8(\?|$)/i.test(absolute)) {
            return absolute; // master playlist: prepare() de novo quando o player pedir
          }
          return viaProxy(absolute);
        }).join('\n');
        var blob = new Blob([out], { type: 'application/vnd.apple.mpegurl' });
        return { mode: 'proxy', playlist: URL.createObjectURL(blob) };
      })
      .catch(function (error) {
        return { mode: 'direct', playlist: directUrl, warning: 'CORS sem relay: ' + error.message };
      });
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
    diagnose: diagnose,
    prepare: prepare
  };
})(window);
