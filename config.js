/* Configuração — edite só este arquivo.
   mode: 'tomato' usa o servidor (login + catálogo + player) e cai para o catálogo
   local enquanto ninguém estiver logado. 'local' fica só no catalog.json.
   relayUrl: Cloudflare Worker (relay/worker.js) que resolve o CORS do CDN. */
window.EXTRATO_CONFIG = {
  mode: 'tomato',
  apiHost: 'prod-api.tomatoanimes.com',
  hcaptchaKey: 'd0706611-1d89-4b8c-af79-3caf0f14feba',
  relayUrl: ''
};
