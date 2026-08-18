'use strict';

/*
 * Service worker do Conversor de Horário.
 *
 * IMPORTANTE: ao publicar uma alteração, subir o número da versão abaixo.
 * É isso que faz a atualização chegar em quem já tem o app instalado — sem
 * versionar, o celular continuaria servindo a versão antiga do cache pra sempre.
 */
const VERSAO_CACHE = 'conversor-horario-v1';

// Só arquivos que existem com certeza: se qualquer item de addAll falhar,
// a instalação inteira é abortada e o app fica sem cache offline.
// Os PNGs de ícone entram no cache sob demanda (ver estratégia de fetch).
const ARQUIVOS_ESSENCIAIS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO_CACHE)
      .then((cache) => cache.addAll(ARQUIVOS_ESSENCIAIS))
      .then(() => self.skipWaiting())
      .catch((erro) => {
        console.error('[sw] falha ao montar o cache inicial', erro);
      }),
  );
});

self.addEventListener('activate', (evento) => {
  // Remove caches de versões anteriores pra não acumular lixo no celular.
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((chave) => chave !== VERSAO_CACHE).map((chave) => caches.delete(chave)),
      ))
      .then(() => self.clients.claim())
      .catch((erro) => {
        console.error('[sw] falha ao limpar caches antigos', erro);
      }),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;

  // Ignora POST e requisições de outras origens.
  if (requisicao.method !== 'GET' || new URL(requisicao.url).origin !== self.location.origin) {
    return;
  }

  // Navegação: rede primeiro, pra atualização publicada aparecer rápido.
  // Sem internet, cai pro index.html guardado no cache.
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      fetch(requisicao)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(VERSAO_CACHE).then((cache) => cache.put('./index.html', copia));
          return resposta;
        })
        .catch(() => caches.match('./index.html').then((cacheado) => cacheado || Response.error())),
    );
    return;
  }

  // Demais arquivos: cache primeiro (são estáticos e versionados pelo nome do cache).
  evento.respondWith(
    caches.match(requisicao).then((cacheado) => {
      if (cacheado) {
        return cacheado;
      }
      return fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            caches.open(VERSAO_CACHE).then((cache) => cache.put(requisicao, copia));
          }
          return resposta;
        })
        .catch((erro) => {
          console.warn('[sw] recurso indisponível offline', requisicao.url, erro);
          return Response.error();
        });
    }),
  );
});
