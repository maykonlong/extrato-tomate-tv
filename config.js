/* Configuração — edite só este arquivo.
   RELAY_URL: endereço do seu Cloudflare Worker (relay/worker.js). Sem ele, só o
   catálogo local toca; o CDN do servidor bloqueia o navegador por falta de CORS. */
window.EXTRATO_CONFIG = {
  relayUrl: '',          // ex.: 'https://extrato-relay.seu-usuario.workers.dev'
  apiHost: 'prod-api.tomatoanimes.com',
  defaultQuality: '720p'
};
