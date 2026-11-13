// Testes do app/js/geo.js (indice em grade e leitura do lote) e do aviso de
// mancha que nao chegou (app/js/cobertura.js), sem rede e sem navegador.
// Rodado pelo tests/test_antenas.py quando o Node existe na maquina; sem
// Node, aquele teste e pulado (o projeto nao depende do Node).
//
//     node tests/geo_test.cjs
'use strict';
const assert = require('assert');
const path = require('path');
const Geo = require(path.join(__dirname, '..', 'app', 'js', 'geo.js'));
const Cobertura = require(path.join(__dirname, '..', 'app', 'js', 'cobertura.js'));

let falhas = 0;
function caso(nome, fn) {
  try { fn(); console.log('ok   ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

// Gerador fixo: o mesmo conjunto toda vez.
let semente = 20261110;
function aleatorio() {
  semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
  return semente / 4294967296;
}

caso('grade entrega exatamente o mesmo que a varredura linear', () => {
  const n = 20000;
  const lats = new Float64Array(n), lons = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Aglomerado perto de Florianopolis + espalhado pelo Brasil, com pontos
    // colados nas bordas de celula (multiplos de 0,1 grau).
    if (i % 3 === 0) { lats[i] = -27.6 + (aleatorio() - 0.5) * 0.6; lons[i] = -48.5 + (aleatorio() - 0.5) * 0.6; }
    else if (i % 7 === 0) { lats[i] = -27.5 + Math.round(aleatorio() * 10) / 10; lons[i] = -48.5 - Math.round(aleatorio() * 10) / 10; }
    else { lats[i] = -33.5 + aleatorio() * 38.5; lons[i] = -73.5 + aleatorio() * 45; }
  }
  const idx = Geo.criarIndice(lats, lons);
  const consultas = [[-27.5954, -48.548, 5], [-27.5, -48.5, 0.05], [-3.1, -60.0, 50], [-33.7, -53.4, 30], [5.2, -60.7, 50], [-27.6, -48.5, 12.3]];
  for (let q = 0; q < 300; q++) consultas.push([-33 + aleatorio() * 37, -73 + aleatorio() * 44, 0.5 + aleatorio() * 49.5]);
  for (const [la, lo, raio] of consultas) {
    const linear = [];
    for (let i = 0; i < n; i++) if (Geo.distanciaKm(la, lo, lats[i], lons[i]) <= raio) linear.push(i);
    const grade = [];
    Geo.paraCadaCandidato(idx, la, lo, raio, (i) => { if (Geo.distanciaKm(la, lo, lats[i], lons[i]) <= raio) grade.push(i); });
    grade.sort((a, b) => a - b);
    assert.deepStrictEqual(grade, linear, 'divergiu em ' + la + ', ' + lo + ' raio ' + raio);
  }
});

caso('grade guarda cada antena uma vez so', () => {
  const lats = [-27.5, -27.5, -3.0, 5.27, -33.75], lons = [-48.5, -48.5, -60.0, -60.2, -53.4];
  const idx = Geo.criarIndice(lats, lons);
  assert.strictEqual(idx.itens.length, 5);
  assert.deepStrictEqual(Array.from(idx.itens).sort(), [0, 1, 2, 3, 4]);
});

caso('lote: formatos de planilha, Google Maps e tabulacao', () => {
  const r = Geo.lerLote([
    'id;lat;lon',
    'ponto 1;-27,5954;-48,5480',
    '-26.30, -48.84',
    '123\t-27.59\t-48.55',
    '"Loja Centro",-23.5505,-46.6333',
    '',
    'sem nada aqui',
    '40.71, -74.00'
  ].join('\n'));
  assert.deepStrictEqual(r.pontos.map(p => [p.id, p.lat, p.lon]), [
    ['ponto 1', -27.5954, -48.548],
    ['linha 3', -26.3, -48.84],
    ['123', -27.59, -48.55],
    ['Loja Centro', -23.5505, -46.6333]
  ]);
  assert.deepStrictEqual(r.ignoradas, [
    { linha: 1, motivo: 'sem coordenada' },
    { linha: 7, motivo: 'sem coordenada' },
    { linha: 8, motivo: 'fora do Brasil' }
  ]);
});

caso('lote: limite de pontos nao some com o excedente', () => {
  const r = Geo.lerLote('-27.1,-48.1\n-27.2,-48.2\n-27.3,-48.3', 2);
  assert.strictEqual(r.pontos.length, 2);
  assert.deepStrictEqual(r.ignoradas, [{ linha: 3, motivo: 'acima do limite' }]);
});

caso('lote: Noronha entra (leste ate -28, como no consolidar.py)', () => {
  const r = Geo.lerLote('-3.85, -32.42');
  assert.strictEqual(r.pontos.length, 1);
});

// ------------------------------------------------ aviso de mancha ausente
const N = Cobertura.FALHAS_PARA_AVISAR;
const tim = Cobertura.fonte('tim');
const vivo = Cobertura.fonte('vivo');
const claro = Cobertura.fonte('claro');

caso('mancha: um tile que chegou cala o aviso', () => {
  assert.strictEqual(Cobertura.diagnosticoDaVista(tim, 1, 30), '');
});

caso('mancha: poucas falhas (borda, zoom de transicao) nao avisam', () => {
  assert.strictEqual(Cobertura.diagnosticoDaVista(tim, 0, N - 1), '');
});

caso('mancha: TIM e Vivo sem nenhum tile = servidor fora do ar', () => {
  for (const f of [tim, vivo]) {
    const msg = Cobertura.diagnosticoDaVista(f, 0, N);
    assert.ok(msg.includes('servidor da ' + f.nome) && msg.includes('fora do ar'), msg);
    assert.ok(!msg.includes('nao ha cobertura'), msg);
  }
});

caso('mancha: na Claro o aviso tambem admite "sem cobertura aqui"', () => {
  assert.strictEqual(claro.ausenteFalha, true);
  const msg = Cobertura.diagnosticoDaVista(claro, 0, 20);
  assert.ok(msg.includes('nao ha cobertura aqui') && msg.includes('fora do ar'), msg);
});

caso('mancha: so a Claro trata tile ausente como falha', () => {
  const marcadas = Cobertura.FONTES.filter((f) => f.ausenteFalha).map((f) => f.id);
  assert.deepStrictEqual(marcadas, ['claro']);
});

// ------------------------------------------------ CEP e endereco (endereco.js)
// Sem rede: um fetch falso responde pelo ViaCEP e pelo Nominatim e guarda os
// pedidos, para conferir o que sairia do navegador.
const Endereco = require(path.join(__dirname, '..', 'app', 'js', 'endereco.js'));

let filaAsync = Promise.resolve();
function casoAsync(nome, fn) {
  filaAsync = filaAsync.then(fn).then(
    () => console.log('ok   ' + nome),
    (e) => { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); });
}

function nominatimItem(o) {
  return Object.assign({ lat: '-27.59', lon: '-48.55', place_rank: 26, display_name: 'x' }, o);
}
const RUA_FLORIPA = { road: 'Avenida Rio Branco', suburb: 'Centro', city: 'Florianópolis', 'ISO3166-2-lvl4': 'BR-SC' };

function fetchFalso(rotas) {
  const pedidos = [];
  const fn = async (url) => {
    pedidos.push(url);
    for (const [teste, corpo] of rotas) {
      if (teste(url)) {
        if (corpo instanceof Error) throw corpo;
        return { ok: true, status: 200, json: async () => corpo };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  return { fn, pedidos };
}
function geocod(rotas, extra) {
  const f = fetchFalso(rotas);
  const esperas = [];
  let relogio = 0;
  const g = Endereco.criar(Object.assign({
    fetch: f.fn, dentroDoBrasil: Geo.dentroDoBrasil,
    agora: () => relogio, esperar: async (ms) => { esperas.push(ms); relogio += ms; }
  }, extra));
  return { g, pedidos: f.pedidos, esperas };
}
const VIACEP_FLORIPA = {
  cep: '88015-200', logradouro: 'Avenida Rio Branco', bairro: 'Centro',
  localidade: 'Florianópolis', uf: 'SC', estado: 'Santa Catarina'
};

caso('endereco: CEP com e sem hifen; o resto nao e CEP', () => {
  assert.strictEqual(Endereco.lerCep('88015-200'), '88015200');
  assert.strictEqual(Endereco.lerCep(' 88015200 '), '88015200');
  for (const t of ['8801520', '880152000', '88015-20', 'cep 88015-200', '-27.59, -48.55']) {
    assert.strictEqual(Endereco.lerCep(t), null, t);
  }
});

caso('endereco: cara de endereco x nome de municipio', () => {
  for (const t of ['Rua Felipe Schmidt 300', 'Av. Brasil', 'avenida paulista', 'Centro, Joinville', 'Praça XV']) {
    assert.ok(Endereco.pareceEndereco(t), t);
  }
  for (const t of ['Joinville', 'Bom Jesus/SC', 'São José', 'Ruapuana']) {
    assert.ok(!Endereco.pareceEndereco(t), t);
  }
});

caso('endereco: precisao pelo place_rank do Nominatim', () => {
  assert.strictEqual(Endereco.precisaoDe({ place_rank: 30 }), 'imovel');
  assert.strictEqual(Endereco.precisaoDe({ place_rank: 26 }), 'rua');
  assert.strictEqual(Endereco.precisaoDe({ place_rank: 20 }), 'bairro');
  assert.strictEqual(Endereco.precisaoDe({ place_rank: 16 }), 'cidade');
  assert.strictEqual(Endereco.precisaoDe({}), 'cidade');
});

caso('endereco: rotulo curto com UF', () => {
  assert.strictEqual(Endereco.rotuloDe({ address: Object.assign({ house_number: '300' }, RUA_FLORIPA) }),
    'Avenida Rio Branco, 300, Centro, Florianópolis/SC');
  assert.strictEqual(Endereco.rotuloDe({ display_name: 'só isto' }), 'só isto');
});

casoAsync('endereco: trechos da mesma rua viram um resultado so', async () => {
  const { g, pedidos } = geocod([[(u) => u.includes('nominatim'), [
    nominatimItem({ address: RUA_FLORIPA }),
    nominatimItem({ lat: '-27.6', address: RUA_FLORIPA }),
    nominatimItem({ address: Object.assign({}, RUA_FLORIPA, { city: 'Joinville' }) })
  ]]]);
  const r = await g.buscarTexto('Avenida Rio Branco');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].lat, -27.59);
  const u = new URL(pedidos[0]);
  assert.strictEqual(u.searchParams.get('countrycodes'), 'br');
  assert.strictEqual(u.searchParams.get('q'), 'Avenida Rio Branco');
});

casoAsync('endereco: resultado fora do Brasil e descartado', async () => {
  const { g } = geocod([[(u) => u.includes('nominatim'), [nominatimItem({ lat: '40.7', lon: '-74.0' })]]]);
  assert.deepStrictEqual(await g.buscarTexto('Broadway'), []);
});

casoAsync('endereco: CEP acha a rua e nunca diz "no numero"', async () => {
  const { g, pedidos } = geocod([
    [(u) => u.includes('viacep.com.br/ws/88015200/json/'), VIACEP_FLORIPA],
    [(u) => u.includes('street='), [nominatimItem({ place_rank: 30, address: RUA_FLORIPA })]]
  ]);
  const r = await g.buscarCep('88015-200');
  assert.strictEqual(r.precisao, 'rua');
  assert.strictEqual(r.rotulo, 'Avenida Rio Branco, Centro, Florianópolis/SC (CEP 88015-200)');
  const u = new URL(pedidos[1]);
  assert.strictEqual(u.searchParams.get('street'), 'Avenida Rio Branco');
  assert.strictEqual(u.searchParams.get('city'), 'Florianópolis');
  assert.strictEqual(u.searchParams.get('state'), 'Santa Catarina');
});

casoAsync('endereco: rua achada em outra cidade nao vale; cai para o bairro', async () => {
  const { g } = geocod([
    [(u) => u.includes('viacep'), VIACEP_FLORIPA],
    [(u) => u.includes('street='), [nominatimItem({ address: Object.assign({}, RUA_FLORIPA, { city: 'Joinville' }) })]],
    [(u) => u.includes('q=Centro'), [nominatimItem({ place_rank: 20, lat: '-27.596', address: { suburb: 'Centro', city: 'Florianópolis' } })]]
  ]);
  const r = await g.buscarCep('88015200');
  assert.strictEqual(r.precisao, 'bairro');
  assert.strictEqual(r.lat, -27.596);
});

casoAsync('endereco: CEP de cidade inteira (sem rua) vai ao centro do municipio', async () => {
  const { g } = geocod([
    [(u) => u.includes('viacep'), { cep: '89990-000', logradouro: '', bairro: '', localidade: 'Ipuaçu', uf: 'SC', estado: 'Santa Catarina' }],
    [(u) => u.includes('city=Ipua'), [nominatimItem({ place_rank: 16, lat: '-26.63', lon: '-52.45', address: { town: 'Ipuaçu' } })]]
  ]);
  const r = await g.buscarCep('89990000');
  assert.strictEqual(r.precisao, 'cidade');
  assert.strictEqual(r.rotulo, 'Ipuaçu/SC (CEP 89990-000)');
});

casoAsync('endereco: CEP inexistente da erro de CEP, sem chamar o Nominatim', async () => {
  const { g, pedidos } = geocod([[(u) => u.includes('viacep'), { erro: 'true' }]]);
  await assert.rejects(g.buscarCep('99999999'), (e) => e.tipo === 'cep' && e.message.includes('99999-999'));
  assert.strictEqual(pedidos.length, 1);
});

casoAsync('endereco: falha de rede vira erro "rede", nao excecao crua', async () => {
  const { g } = geocod([[() => true, new TypeError('Failed to fetch')]]);
  await assert.rejects(g.buscarTexto('Rua X, Joinville'), (e) => e.tipo === 'rede' && e.message.includes('nominatim'));
});

casoAsync('endereco: no maximo 1 pedido por segundo ao Nominatim', async () => {
  const { g, esperas } = geocod([]);
  await g.buscarTexto('a 1');
  await g.buscarTexto('b 2');
  await g.buscarTexto('c 3');
  assert.strictEqual(esperas.length, 2);
  assert.ok(esperas.every((ms) => ms >= 1000), String(esperas));
});

casoAsync('endereco do pino: reverso devolve rotulo, precisao e distancia', async () => {
  const { g, pedidos } = geocod([[(u) => u.includes('/reverse?'), nominatimItem({
    lat: '-27.5925', lon: '-48.5480', place_rank: 30, address: Object.assign({ house_number: '532', country_code: 'br' }, RUA_FLORIPA)
  })]]);
  const r = await g.buscarReverso(-27.5920, -48.5480);
  assert.strictEqual(r.rotulo, 'Avenida Rio Branco, 532, Centro, Florianópolis/SC');
  assert.strictEqual(r.precisao, 'imovel');
  assert.ok(r.distanciaM >= 50 && r.distanciaM <= 60, String(r.distanciaM)); // 0,0005 grau de latitude ~ 56 m
  const u = new URL(pedidos[0]);
  assert.strictEqual(u.searchParams.get('lat'), '-27.592000');
  assert.strictEqual(u.searchParams.get('lon'), '-48.548000');
});

casoAsync('endereco do pino: sem endereco no OSM e fora do Brasil viram erro "nada"', async () => {
  const vazio = geocod([[(u) => u.includes('/reverse?'), { error: 'Unable to geocode' }]]);
  await assert.rejects(vazio.g.buscarReverso(-10, -50), (e) => e.tipo === 'nada');
  const fora = geocod([[(u) => u.includes('/reverse?'), nominatimItem({ address: { road: 'Ruta 3', country_code: 'ar' } })]]);
  await assert.rejects(fora.g.buscarReverso(-30, -58), (e) => e.tipo === 'nada' && e.message.includes('fora do Brasil'));
});

casoAsync('endereco do pino: busca e reverso dividem o limite de 1 pedido/s', async () => {
  const { g, esperas } = geocod([[(u) => u.includes('/reverse?'), nominatimItem({ address: RUA_FLORIPA })]]);
  await g.buscarTexto('Rua X, Joinville');
  await g.buscarReverso(-27.59, -48.55);
  assert.strictEqual(esperas.length, 1);
  assert.ok(esperas[0] >= 1000, String(esperas));
});

caso('ranking: mais perto e geracao mais alta vencem; sem antena fica no fim com nota 0', () => {
  const r = Geo.rankingOperadoras([
    { op: 0, km: 0.3, ger: 0b1110 }, { op: 0, km: 1.2, ger: 0b0100 },   // op 0: 4G a 300 m
    { op: 1, km: 2.0, ger: 0b0011 },                                     // op 1: so 3G, mais longe
  ], [0, 1, 2], 5);
  assert.deepStrictEqual(r.map((x) => x.op), [0, 1, 2]);
  assert.strictEqual(r[0].melhorGeracao, 3);
  assert.strictEqual(r[0].quantidade, 2);
  assert.strictEqual(r[2].nota, 0);
  assert.strictEqual(r[2].maisPerto, null);
  assert.ok(r[0].nota > r[1].nota && r[1].nota > 0 && r[0].nota <= 100);
});

caso('ranking: lista vazia devolve todas com nota 0, sem quebrar', () => {
  const r = Geo.rankingOperadoras([], [0, 1], 5);
  assert.strictEqual(r.length, 2);
  assert.ok(r.every((x) => x.nota === 0 && x.melhorGeracao === -1));
});

caso('rumo: pontos cardeais', () => {
  const perto = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 0.5;
  assert.ok(perto(Geo.rumoGraus(-23, -46, -22, -46), 0));
  assert.ok(perto(Geo.rumoGraus(-23, -46, -23, -45), 90));
  assert.ok(perto(Geo.rumoGraus(-23, -46, -24, -46), 180));
  assert.ok(perto(Geo.rumoGraus(-23, -46, -23, -47), 270));
});

filaAsync.then(() => {
  if (falhas) { console.log(falhas + ' falha(s)'); process.exit(1); }
  console.log('todos ok');
});
