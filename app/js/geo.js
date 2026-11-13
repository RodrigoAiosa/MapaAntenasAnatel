// Calculo de distancia e utilidades geograficas do app.
//
// Um erro aqui nao aparece na tela como erro: aparece como o app recomendando
// com toda a confianca uma torre que nao e a mais proxima. Por isso a suite de
// testes confere o haversine contra Vincenty (elipsoidal WGS84), que e um
// calculo independente, em vez de conferir contra distancias "conhecidas" da
// internet - varias delas sao rodoviarias ou aproximadas e nao servem de
// referencia para distancia em linha reta.

(function (raiz) {
  'use strict';

  const RAIO_TERRA_KM = 6371.0088; // raio medio aritmetico da IUGG
  const RAD = Math.PI / 180;

  // Distancia em km sobre a esfera. Contra o elipsoide WGS84 o desvio fica em
  // ~0,3% no pior caso brasileiro - 30 m numa torre a 10 km. Irrelevante para
  // "tem cobertura ai?", e muito mais barato que Vincenty rodando 106 mil vezes.
  function distanciaKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Km por grau de meridiano, DERIVADO do mesmo raio que o haversine usa.
  // Constante literal aqui foi bug: com 111,320 (que vem do raio equatorial,
  // nao do medio) a janela cobria 24,97 km para um raio pedido de 25 km, e a
  // busca perdia antenas 30 m antes da borda.
  const KM_POR_GRAU = RAIO_TERRA_KM * RAD;

  // Quantos graus de latitude/longitude correspondem a um raio em km.
  // A longitude encolhe com o cosseno da latitude: usar valor fixo cortaria
  // antenas reais no Norte do pais e traria antenas demais no Sul.
  //
  // A janela e um retangulo em graus e o raio e um circulo em km: o retangulo
  // precisa CONTER o circulo, nunca o contrario. Por isso o cosseno usado e o
  // da latitude mais afastada do equador dentro da janela (onde um grau de
  // longitude vale menos km), e nao o do centro. Sobrar janela custa alguns
  // microssegundos; faltar janela perde uma torre em silencio.
  // A margem existe porque uma janela EXATA e fragil: com ela, um ponto na
  // borda entra ou sai por erro de arredondamento de ponto flutuante, e quando
  // sai a antena some da lista sem nenhum sinal. Alargar 0,5% custa avaliar
  // alguns pontos a mais - o filtro por distancia exata roda depois e corta
  // quem sobrou.
  const MARGEM_JANELA = 1.005;

  function janelaEmGraus(latCentro, raioKm) {
    const dLat = (raioKm / KM_POR_GRAU) * MARGEM_JANELA;
    const latExtrema = Math.min(Math.abs(latCentro) + dLat, 89.9);
    const dLon = (raioKm / (KM_POR_GRAU * Math.max(Math.cos(latExtrema * RAD), 1e-6))) * MARGEM_JANELA;
    return { dLat, dLon };
  }

  // "820 m" / "3,4 km" / "27 km" - precisao que faz sentido para cada escala.
  function formatarDistancia(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1).replace('.', ',') + ' km';
    return Math.round(km) + ' km';
  }

  // Grau decimal -> "27°36'45.4\"S", para ecoar de volta o ponto pesquisado.
  function formatarDMS(valor, eixo) {
    const hemisferio = eixo === 'lat' ? (valor < 0 ? 'S' : 'N') : (valor < 0 ? 'W' : 'E');
    const abs = Math.abs(valor);
    const g = Math.floor(abs);
    const mFloat = (abs - g) * 60;
    let m = Math.floor(mFloat);
    let s = (mFloat - m) * 60;
    // Sem o arredondamento propagado, 59,96" vira 60,0" na tela.
    s = Math.round(s * 10) / 10;
    let gg = g;
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; gg += 1; }
    return gg + '°' + String(m).padStart(2, '0') + "'" +
           s.toFixed(1).replace('.', ',').padStart(4, '0') + '"' + hemisferio;
  }

  // ------------------------------------------------ INDICE ESPACIAL EM GRADE
  // A busca por ponto varria as 114 mil ERBs a cada consulta. Para um ponto
  // e rapido; para um lote de mil pontos sao 114 milhoes de testes (M11,
  // 10/11/2026). A grade divide a caixa do Brasil em celulas de PASSO graus e
  // guarda, por celula, os indices das antenas (formato CSR: inicio[] +
  // itens[]). A consulta so visita as celulas que tocam a janela do raio.
  //
  // A grade NAO decide nada: so entrega candidatos. Quem corta pela distancia
  // exata continua sendo o haversine, como antes - por isso o resultado e o
  // mesmo da varredura linear (ha teste comparando os dois).
  const CAIXA_BRASIL = { latMin: -34, latMax: 6, lonMin: -74, lonMax: -28 }; // a mesma do consolidar.py
  const PASSO_GRADE = 0.1;

  function criarIndice(lats, lons, passo) {
    passo = passo || PASSO_GRADE;
    const lat0 = CAIXA_BRASIL.latMin, lon0 = CAIXA_BRASIL.lonMin;
    const linhas = Math.ceil((CAIXA_BRASIL.latMax - lat0) / passo) + 1;
    const colunas = Math.ceil((CAIXA_BRASIL.lonMax - lon0) / passo) + 1;
    const n = lats.length;
    const celulaDe = new Uint32Array(n);
    const inicio = new Uint32Array(linhas * colunas + 1);
    for (let i = 0; i < n; i++) {
      const r = Math.min(linhas - 1, Math.max(0, Math.floor((lats[i] - lat0) / passo)));
      const c = Math.min(colunas - 1, Math.max(0, Math.floor((lons[i] - lon0) / passo)));
      const cel = r * colunas + c;
      celulaDe[i] = cel;
      inicio[cel + 1]++;
    }
    for (let k = 1; k < inicio.length; k++) inicio[k] += inicio[k - 1];
    const proximo = inicio.slice(0, linhas * colunas);
    const itens = new Uint32Array(n);
    for (let i = 0; i < n; i++) itens[proximo[celulaDe[i]]++] = i;
    return { passo, lat0, lon0, linhas, colunas, inicio, itens };
  }

  // Chama visitar(i) para cada antena das celulas que tocam a janela que
  // CONTEM o circulo de raioKm em volta de (lat, lon). Pode entregar antenas
  // fora do raio (o chamador filtra); nunca deixa de entregar uma de dentro.
  // A celula de um ponto e calculada com o mesmo floor da criacao, e a janela
  // ja tem a margem de 0,5% da janelaEmGraus.
  function paraCadaCandidato(indice, lat, lon, raioKm, visitar) {
    const jan = janelaEmGraus(lat, raioKm);
    const p = indice.passo;
    const r0 = Math.max(0, Math.floor((lat - jan.dLat - indice.lat0) / p));
    const r1 = Math.min(indice.linhas - 1, Math.floor((lat + jan.dLat - indice.lat0) / p));
    const c0 = Math.max(0, Math.floor((lon - jan.dLon - indice.lon0) / p));
    const c1 = Math.min(indice.colunas - 1, Math.floor((lon + jan.dLon - indice.lon0) / p));
    const ini = indice.inicio, itens = indice.itens;
    for (let r = r0; r <= r1; r++) {
      const base = r * indice.colunas;
      for (let c = c0; c <= c1; c++) {
        const cel = base + c;
        for (let k = ini[cel], fim = ini[cel + 1]; k < fim; k++) visitar(itens[k]);
      }
    }
  }

  // --------------------------------------------------- LEITURA DE UM LOTE
  // Uma coordenada por linha, no formato que vier da planilha, do Google
  // Maps ou do sistema: "ponto 1;-27,5954;-48,5480", "-27.5954, -48.548",
  // "123\t-27.59\t-48.55". A parte decimal e obrigatoria nos dois numeros (o
  // mesmo criterio da busca): "12 34" e mais provavel ser outra coisa.
  // O que vier antes da coordenada e o identificador; sem ele, "linha N".
  // Linha que nao tem coordenada (cabecalho, texto solto) NAO some: volta em
  // ignoradas[], com o motivo, para a tela contar.
  const RE_COORD_LOTE = /(-?\d{1,2}[.,]\d+)\s*[;,\t ]\s*(-?\d{1,3}[.,]\d+)/;

  function dentroDoBrasil(lat, lon) {
    return lat >= CAIXA_BRASIL.latMin && lat <= CAIXA_BRASIL.latMax &&
           lon >= CAIXA_BRASIL.lonMin && lon <= CAIXA_BRASIL.lonMax;
  }

  function lerLote(texto, limite) {
    const pontos = [], ignoradas = [];
    const linhas = String(texto || '').split(/\r\n|\r|\n/);
    for (let k = 0; k < linhas.length; k++) {
      const bruta = linhas[k];
      if (!bruta.trim()) continue;
      const m = RE_COORD_LOTE.exec(bruta);
      if (!m) { ignoradas.push({ linha: k + 1, motivo: 'sem coordenada' }); continue; }
      const lat = +m[1].replace(',', '.'), lon = +m[2].replace(',', '.');
      if (!dentroDoBrasil(lat, lon)) { ignoradas.push({ linha: k + 1, motivo: 'fora do Brasil' }); continue; }
      if (limite && pontos.length >= limite) { ignoradas.push({ linha: k + 1, motivo: 'acima do limite' }); continue; }
      let id = (bruta.slice(0, m.index) + ' ' + bruta.slice(m.index + m[0].length))
        .replace(/^[\s;,\t"']+|[\s;,\t"']+$/g, '').replace(/\s+/g, ' ');
      if (!id) id = 'linha ' + (k + 1);
      pontos.push({ linha: k + 1, id, lat, lon });
    }
    return { pontos, ignoradas };
  }

  const api = {
    distanciaKm, janelaEmGraus, formatarDistancia, formatarDMS, RAIO_TERRA_KM,
    CAIXA_BRASIL, criarIndice, paraCadaCandidato, lerLote, dentroDoBrasil
  };
  raiz.Geo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
