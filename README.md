# Extrato de Tomate — PWA

Shell de TV/navegador com player HLS, navegação por controle remoto, retomada de
onde parou e layout responsivo (TV, TV box, tablet, celular).

## Rodar localmente

```bash
cd pwa
python -m http.server 8765
# abra http://127.0.0.1:8765/
```

Teclas: setas navegam, Enter abre, Esc/Backspace volta, `f` (ou FWD do controle)
avança 10 s. O menu lateral tem Início, Continuar, Buscar e Recarregar.

## Publicar no GitHub Pages

O workflow em `.github/workflows/pages.yml` cuida disso a cada push na `main`.
Em **Settings → Pages**, escolha *Source: GitHub Actions*.

## Conteúdo

Edite `catalog.json`:

```json
{
  "hero": { "id": "x", "title": "Destaque", "desc": "...", "video": "https://.../index.m3u8" },
  "rows": [ { "title": "Minha linha", "items": [ { "id": "a", "title": "Vídeo", "video": "https://.../x.mp4" } ] } ]
}
```

Aceita HLS (`.m3u8`, via hls.js) e MP4 direto.

## Sobre o CDN do servidor

Testado: a API manda `access-control-allow-origin: *`, mas o CDN **não** manda
CORS nenhum — o navegador não consegue ler os segmentos direto. Por isso existe
`relay/worker.js`: um Cloudflare Worker (plano grátis) que repassa a URL assinada
com CORS e reescreve a playlist para os segmentos também passarem por ele.

```bash
npx wrangler deploy relay/worker.js --name extrato-relay
```

Depois coloque o endereço em `config.js` (`relayUrl`) e use as URLs do CDN no
formato `https://SEU-WORKER.workers.dev/?u=<url assinada codificada>`.


## Modo servidor (login no navegador)

Com `mode: 'tomato'` em `config.js`, a página mostra o catálogo local enquanto
ninguém entrou. O ícone ☺ do menu abre o login: e-mail, senha e hCaptcha
resolvidos **na própria página**. O token fica no `localStorage` e nunca sai
dali — não existe servidor nosso no meio.

Autodiagnóstico: abra `?diag=1` (ou o botão que aparece quando o catálogo falha).
Ele testa, passo a passo: token → catálogo → série → episódios → URL de stream →
se o CDN libera o navegador (CORS).

### Se o CDN bloquear (CORS)

O relay em `relay/worker.js` resolve. Publique e ponha o endereço em
`config.js` (`relayUrl`):

```bash
npx wrangler deploy relay/worker.js --name extrato-relay
```
