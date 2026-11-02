/**
 * Extrato de Tomate — relay de CORS.
 *
 * O CDN responde ao navegador sem `Access-Control-Allow-Origin`, então nenhuma
 * página consegue ler os segmentos direto. Este Worker faz o repasse: recebe a
 * URL assinada em ?u=, busca no servidor de origem e devolve com CORS liberado.
 * Também reescreve as linhas da playlist .m3u8 para que cada segmento passe por
 * aqui — sem isso o player pede os .ts direto no CDN e trava.
 *
 * Deploy:  npx wrangler deploy relay/worker.js --name extrato-relay
 * Teste:   https://SEU-WORKER.workers.dev/health
 */

const ALLOWED_HOSTS = [
  'tomatoanimes.com',
  'prod-api.tomatoanimes.com',
  'cdn.tomatoanimes.com',
  'el-content.com',
  'hacsadhost.workers.dev'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Authorization, Accept, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function hostAllowed(hostname) {
  return ALLOWED_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host));
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const incoming = new URL(request.url);

    if (incoming.pathname === '/health') {
      return json({ ok: true, service: 'extrato-relay', at: new Date().toISOString() });
    }

    const target = incoming.searchParams.get('u');
    if (!target) {
      return json({ error: 'missing u parameter', usage: '/?u=<url assinada>' }, 400);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(target);
    } catch (error) {
      return json({ error: 'invalid url' }, 400);
    }

    if (!/^https?:$/.test(upstreamUrl.protocol) || !hostAllowed(upstreamUrl.hostname)) {
      return json({ error: 'host not allowed', host: upstreamUrl.hostname }, 403);
    }

    const headers = new Headers();
    const pass = ['range', 'authorization', 'accept', 'user-agent'];
    for (const name of pass) {
      const value = request.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }
    if (!headers.has('user-agent')) {
      headers.set('user-agent', 'tomato-android');
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        redirect: 'follow'
      });
    } catch (error) {
      return json({ error: 'upstream failed', detail: String(error) }, 502);
    }

    const type = upstream.headers.get('content-type') || '';
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8($|\?)/i.test(upstreamUrl.pathname + upstreamUrl.search);

    if (isPlaylist && upstream.ok) {
      const text = await upstream.text();
      const self = incoming.origin + incoming.pathname;
      const out = text.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line; // comentário ou tag (#EXT-X-...): URI vem na linha seguinte
        }
        const absolute = new URL(trimmed, upstreamUrl).toString();
        return self + '?u=' + encodeURIComponent(absolute);
      }).join('\n');

      return new Response(out, {
        status: upstream.status,
        headers: {
          ...CORS,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store'
        }
      });
    }

    const responseHeaders = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(CORS)) {
      responseHeaders.set(key, value);
    }
    responseHeaders.delete('set-cookie');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
