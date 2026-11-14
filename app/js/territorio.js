// COBERTURA DO TERRITORIO - quanto de um municipio fica longe de qualquer antena.
//
// Conta por AMOSTRAGEM: uma grade de pontos sobre o municipio, e para cada ponto
// que cai DENTRO do contorno pergunta-se "ha antena a ate R km?". A fracao de
// pontos com resposta sim e a fracao do territorio. Nao ha uniao de circulos nem
// geometria pesada: o erro cai com o passo da grade, e o passo acompanha o
// tamanho do municipio.
//
// O QUE ISTO NAO E: nao mede sinal. Um circulo de R km em volta da antena
// ignora relevo, frequencia, potencia e predios. E uma medida de "distancia a
// uma antena licenciada". Moradores tambem nao entram: so area.
//
// Sem dependencia de DOM, para rodar igual no navegador e no teste em Node.

(function (raiz) {
  'use strict';

  var RAD = Math.PI / 180;
  var KM_POR_GRAU = 111.195; // coerente com o raio medio usado em Geo (6371 km)

  // Ray casting num anel [[lon, lat], ...]. Pontos exatamente na borda podem cair
  // de qualquer lado: irrelevante para uma grade de amostragem.
  function pontoNoAnel(lat, lon, anel) {
    var dentro = false;
    for (var i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      var xi = anel[i][0], yi = anel[i][1], xj = anel[j][0], yj = anel[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  }

  // Poligono = [anel externo, furo, furo...]. Dentro = no externo e em nenhum furo.
  function pontoNoPoligono(lat, lon, aneis) {
    if (!aneis.length || !pontoNoAnel(lat, lon, aneis[0])) return false;
    for (var k = 1; k < aneis.length; k++) if (pontoNoAnel(lat, lon, aneis[k])) return false;
    return true;
  }

  // Aceita Polygon e MultiPolygon do GeoJSON: { type, coordinates }.
  function poligonos(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }

  function pontoNaGeometria(lat, lon, geom) {
    var ps = poligonos(geom);
    for (var i = 0; i < ps.length; i++) if (pontoNoPoligono(lat, lon, ps[i])) return true;
    return false;
  }

  function caixa(geom) {
    var c = { latMin: 90, latMax: -90, lonMin: 180, lonMax: -180 };
    poligonos(geom).forEach(function (p) {
      p[0].forEach(function (v) {
        if (v[1] < c.latMin) c.latMin = v[1];
        if (v[1] > c.latMax) c.latMax = v[1];
        if (v[0] < c.lonMin) c.lonMin = v[0];
        if (v[0] > c.lonMax) c.lonMax = v[0];
      });
    });
    return c;
  }

  // Area em km2 pela formula do cadarco, num plano equirretangular ajustado a
  // latitude media do anel. Boa para municipios (erro de ordem de 1%).
  function areaAnelKm2(anel) {
    var lat0 = 0;
    for (var i = 0; i < anel.length; i++) lat0 += anel[i][1];
    var fx = Math.cos((lat0 / anel.length) * RAD) * KM_POR_GRAU, fy = KM_POR_GRAU;
    var s = 0;
    for (var a = 0, b = anel.length - 1; a < anel.length; b = a++) {
      s += (anel[b][0] * fx) * (anel[a][1] * fy) - (anel[a][0] * fx) * (anel[b][1] * fy);
    }
    return Math.abs(s) / 2;
  }

  function areaKm2(geom) {
    var total = 0;
    poligonos(geom).forEach(function (p) {
      total += areaAnelKm2(p[0]);
      for (var k = 1; k < p.length; k++) total -= areaAnelKm2(p[k]);
    });
    return total;
  }

  // Passo da grade em km: cerca de 60 amostras no lado do municipio, entre 0,25
  // e 5 km. Municipio pequeno ganha grade fina; o maior (Altamira, ~160 mil km2)
  // fica em 5 km, que ainda e bem menor que qualquer raio de interesse.
  function passoAdaptativo(areaKm) {
    return Math.min(5, Math.max(0.25, Math.sqrt(Math.max(areaKm, 0.01)) / 60));
  }

  // temAntena(lat, lon) -> true/false: o chamador decide o raio e os filtros.
  // Devolve fracaoCoberta (0..1, ou null se nenhuma amostra caiu dentro),
  // contagens, o passo usado e ate `maxSemCobertura` pontos descobertos (para
  // desenhar no mapa, espalhados ao longo da grade).
  function amostrarCobertura(geom, temAntena, opcoes) {
    opcoes = opcoes || {};
    var maxSem = opcoes.maxSemCobertura == null ? 300 : opcoes.maxSemCobertura;
    var area = areaKm2(geom);
    var passo = opcoes.passoKm || passoAdaptativo(area);
    var cx = caixa(geom);
    var dLat = passo / KM_POR_GRAU;
    var dentro = 0, cobertos = 0, sem = [];
    var descobertos = [];
    for (var lat = cx.latMin + dLat / 2; lat <= cx.latMax; lat += dLat) {
      var dLon = passo / (KM_POR_GRAU * Math.max(0.05, Math.cos(lat * RAD)));
      for (var lon = cx.lonMin + dLon / 2; lon <= cx.lonMax; lon += dLon) {
        if (!pontoNaGeometria(lat, lon, geom)) continue;
        dentro++;
        if (temAntena(lat, lon)) cobertos++; else descobertos.push([lat, lon]);
      }
    }
    if (descobertos.length <= maxSem) sem = descobertos;
    else {
      var salto = descobertos.length / maxSem;
      for (var k = 0; k < maxSem; k++) sem.push(descobertos[Math.floor(k * salto)]);
    }
    return {
      areaKm2: area, passoKm: passo, amostras: dentro, cobertos: cobertos,
      fracaoCoberta: dentro ? cobertos / dentro : null,
      semCobertura: sem
    };
  }

  raiz.Territorio = {
    pontoNaGeometria: pontoNaGeometria, caixa: caixa, areaKm2: areaKm2,
    passoAdaptativo: passoAdaptativo, amostrarCobertura: amostrarCobertura
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.Territorio;
})(typeof window !== 'undefined' ? window : globalThis);
