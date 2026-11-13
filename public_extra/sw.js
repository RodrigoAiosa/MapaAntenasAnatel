/* Service worker: abre o mapa na hora e funciona sem internet.
 *
 * - Páginas e arquivos do próprio site: "stale-while-revalidate". Responde do
 *   cache (instantâneo, mesmo offline) e atualiza em segundo plano. O pedido de
 *   atualização é condicional (304), então custa pouco.
 * - O que é de outro domínio (mapa de fundo, cobertura, ViaCEP, Nominatim) NÃO
 *   passa por aqui: o navegador pede direto. Offline, ficam as antenas.
 * - /status.json e /dados/ nunca são guardados.
 */
const VERSAO = "{{VERSAO}}";
const CACHE = "antenas-" + VERSAO;
const BASICOS = ["/", "/sobre", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  // Só a home é obrigatória; os demais são tolerados se falharem (ex.: 404).
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.add("/");
    await Promise.all(BASICOS.slice(1).map((u) => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("antenas-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/status.json" || url.pathname.startsWith("/dados/") || url.pathname === "/sw.js") return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const chave = req.mode === "navigate" && url.pathname === "/" ? "/" : req;
    const guardado = await cache.match(chave, { ignoreSearch: true });
    const rede = fetch(req).then((resp) => {
      if (resp && resp.ok) cache.put(chave, resp.clone());
      return resp;
    });
    if (guardado) { rede.catch(() => {}); return guardado; }
    try { return await rede; }
    catch (err) {
      if (req.mode === "navigate") { const home = await cache.match("/"); if (home) return home; }
      return new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
