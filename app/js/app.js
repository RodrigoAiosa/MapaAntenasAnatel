// MAPA DE ANTENAS ANATEL - aplicativo.
//
// Tres camadas empilhadas, que respondem perguntas diferentes:
//
//   1. mapa base (OpenStreetMap)  - onde fica
//   2. mancha de cobertura        - onde a OPERADORA AFIRMA que chega sinal
//   3. ERBs em canvas             - onde estao as torres licenciadas na Anatel
//
// A pergunta pratica e "qual a antena mais proxima deste endereco, de cada
// operadora, e ela tem 3G?" - e por isso a busca aceita uma coordenada (copiada
// do Google Maps ou de uma planilha) e devolve a mais proxima de cada operadora.
//
// Nasceu do mapa original do Cliver: canvas, mapas base e cobertura sao os
// mesmos, de proposito, para quem usa os dois nao reaprender o controle.

(function () {
  'use strict';

  // -------------------------------------------------------------- 0. AJUSTES

  // Cores das proprias marcas para Claro/TIM/Vivo - as mesmas do mapa
  // original, para um ponto vermelho querer dizer Claro nos dois mapas.
  var CORES_OP = {
    claro: '#e11d48',
    tim: '#2563eb',
    vivo: '#9333ea',
    algar: '#0d9488',
    brisanet: '#ea580c',
    unifique: '#16a34a',
    sercomtel: '#ca8a04',
    outra: '#64748b'
  };

  // Geracao MAIS ALTA da ERB. Escala de cor e nao de marca: 5G e "mais", 2G e
  // "menos" - o olho le a ordem sem precisar da legenda.
  var CORES_GER = {
    '2G': '#a8a29e',
    '3G': '#f59e0b',
    '4G': '#3b82f6',
    '5G': '#10b981',
    sem: '#cbd5e1'
  };

  // Mapas base - os mesmos dois do mapa original, com as mesmas regras:
  // nenhum tile pede chave, e tile que pede Referer so vale quando a pagina tem
  // endereco. Aberta pelo ABRIR_MAPA.bat (http://localhost) a base e o OSM
  // oficial; por duplo clique (file://) cai na OSM Franca, mais lenta, mas que
  // serve sem Referer. Historia completa no README, secao "Abrir o mapa".
  var COM_ENDERECO = /^https?:$/.test(location.protocol);
  var SERVIDOR_OSM_OFICIAL = {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credito: '&copy; OpenStreetMap'
  };
  var SERVIDOR_OSM_FRANCA = {
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    subdominios: 'abc',
    credito: '&copy; OpenStreetMap/ODbL &middot; rendu OSM France'
  };
  var SERVIDOR = COM_ENDERECO ? SERVIDOR_OSM_OFICIAL : SERVIDOR_OSM_FRANCA;

  function opcoesDaBase(classe) {
    var o = { maxZoom: 19, className: classe, attribution: SERVIDOR.credito + ' &middot; ERBs: Anatel' };
    if (SERVIDOR.subdominios) o.subdomains = SERVIDOR.subdominios;
    return o;
  }

  var BASES = {
    mapa: { nome: 'Mapa', url: function () { return SERVIDOR.url; }, opcoes: opcoesDaBase('tile-base tile-limpo') },
    ruas: { nome: 'Ruas', url: function () { return SERVIDOR.url; }, opcoes: opcoesDaBase('tile-base') }
  };

  // Acima deste tanto de ERBs na tela, o desenho passa de circulo com borda para
  // pixel puro. Quem decide e a DENSIDADE na tela, nao o zoom. As ERBs nunca
  // somem - muda so o simbolo.
  var LIMITE_CIRCULOS = 4000;
  var RAIO_CIRCULO = 4;

  // O canvas e desenhado com esta margem (fracao da tela) em cada lado: no
  // arraste, a area que entra ja tem as antenas, em vez de ficar vazia ate o
  // mapa parar. 10% e o mesmo padding do renderizador de canvas do Leaflet.
  var MARGEM_DESENHO = 0.1;
  // No zoom e no voo, o desenho pronto acompanha o mapa por CSS transform.
  // Esticado mais que isto ele vira borrao: some e volta redesenhado no fim.
  var ESCALA_MAX_SEGUIR = 4;

  var MENOS_MOVIMENTO = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Ate onde procurar a "mais proxima de cada operadora". Alem disso a resposta
  // honesta e "nenhuma por perto", e varrer o pais inteiro nao ajuda ninguem.
  var ALCANCE_POR_OPERADORA_KM = 50;
  var MAX_LISTA_PERTO = 150;

  // Duas ERBs a menos disto sao "o mesmo ponto" na ficha (mastro compartilhado,
  // RAN sharing, ou o cadastro de duas operadoras no mesmo predio).
  var MESMO_PONTO_KM = 0.05;

  // -------------------------------------------------------------- 1. ESTADO

  var D = null;
  var mapa = null;
  var camadaAntenas = null;
  var camadaCobertura = null;
  var camadaBase = null;
  var marcadorPonto = null;
  var circuloRaio = null;
  var camadaFeixes = null;
  var marcadorSel = null;
  var marcadorMira = null;
  var rendSvg = null;
  var UFS = [];

  var estado = {
    modoCor: 'operadora',   // operadora | geracao
    operadoras: {},         // indice -> ligado
    geracoes: 15,           // bits ligados (1=2G 2=3G 4=4G 8=5G)
    uf: -1,                 // indice em UFS, -1 = Brasil inteiro
    cobertura: null,
    coberturaCamada: null,
    opacidade: 0.6,
    selecionado: -1,
    ponto: null,            // {lat, lon} da busca por proximidade
    raioKm: 5,
    base: 'mapa',
    tema: 'escuro'
  };

  // Preferencia de tema do operador. localStorage pode faltar (aba anonima,
  // politica da empresa): sem ele, vale o padrao escuro.
  function lerTemaSalvo() {
    try { var t = localStorage.getItem('mapa-antenas-tema'); return t === 'claro' || t === 'escuro' ? t : null; }
    catch (e) { return null; }
  }
  function salvarTema(t) {
    try { localStorage.setItem('mapa-antenas-tema', t); } catch (e) { /* sem armazenamento: so nao lembra */ }
  }

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) { return Number(n).toLocaleString('pt-BR'); }

  // Sem acento e minusculo: "Sao Jose" acha "São José".
  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // ---------------------------------------------------------- 2. OS DADOS

  function carregarDados() {
    var linhas = ANT_TXT.split('\n');
    var n = linhas.length;
    var d = {
      n: n,
      lat: new Float64Array(n), lon: new Float64Array(n),
      wx: new Float64Array(n), wy: new Float64Array(n),
      op: new Uint8Array(n),
      ger: new Uint8Array(n),
      gerMax: new Int8Array(n),
      mun: new Uint16Array(n),
      uf: new Uint8Array(n),
      infra: new Uint8Array(n),
      tec: new Uint8Array(n),
      flags: new Uint8Array(n),
      setores: new Uint16Array(n),
      faixas: new Uint32Array(n),   // bits sobre ANT_FAIXAS
      numero: new Array(n),
      endereco: new Array(n),
      desde: new Array(n),
      div: new Array(n),
      empresa: new Array(n)
    };

    var idxUf = {};
    ANT_MUNICIPIOS.forEach(function (m) {
      if (!(m[1] in idxUf)) { idxUf[m[1]] = UFS.length; UFS.push(m[1]); }
    });
    var ufDoMun = new Uint8Array(ANT_MUNICIPIOS.length);
    ANT_MUNICIPIOS.forEach(function (m, i) { ufDoMun[i] = idxUf[m[1]]; });

    for (var i = 0; i < n; i++) {
      var p = linhas[i].split('|');
      var la = +p[0], lo = +p[1];
      d.lat[i] = la;
      d.lon[i] = lo;
      d.numero[i] = p[2];
      d.op[i] = +p[3];
      var g = +p[4];
      d.ger[i] = g;
      d.gerMax[i] = g ? (31 - Math.clz32(g)) : -1;
      d.mun[i] = +p[5];
      d.uf[i] = ufDoMun[+p[5]];
      d.endereco[i] = p[6];
      d.faixas[i] = +p[7];
      d.infra[i] = +p[8];
      d.desde[i] = p[9];
      d.setores[i] = p[10] === '' ? 0 : +p[10];
      d.tec[i] = +p[11];
      d.flags[i] = +p[12];
      d.div[i] = p[13];
      d.empresa[i] = p[14] || '';
      // Web Mercator normalizado [0..1]: calculado uma vez, cada quadro vira
      // multiplicar e subtrair.
      d.wx[i] = (lo + 180) / 360;
      var s = Math.sin(la * Math.PI / 180);
      d.wy[i] = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }

    // ORDEM DE DESENHO EMBARALHADA. O arquivo vem ordenado por municipio e
    // operadora, e no modo pixel quem e desenhado por ultimo cobre os outros:
    // na ordem do arquivo a Vivo (3a da lista) pintava de roxo toda capital e
    // parecia dona do pais. Embaralhar mistura as cores na proporcao real.
    // Semente fixa: o mesmo mapa sai igual toda vez que abre.
    d.ordem = new Uint32Array(n);
    for (var k = 0; k < n; k++) d.ordem[k] = k;
    var semente = 20261016;
    for (var j = n - 1; j > 0; j--) {
      semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
      var r = semente % (j + 1);
      var tmp = d.ordem[j]; d.ordem[j] = d.ordem[r]; d.ordem[r] = tmp;
    }
    // Indice em grade para as buscas por ponto, vizinhos e lote (M11).
    d.indice = Geo.criarIndice(d.lat, d.lon);
    return d;
  }

  function nomeOp(i) {
    var id = ANT_OPERADORAS[i];
    return ANT_NOMES_OPERADORA[id] || id;
  }

  function corOp(i) { return CORES_OP[ANT_OPERADORAS[i]] || CORES_OP.outra; }

  function corDe(i) {
    if (estado.modoCor === 'geracao') {
      var g = D.gerMax[i];
      return g < 0 ? CORES_GER.sem : CORES_GER[ANT_GERACOES[g]];
    }
    return corOp(D.op[i]);
  }

  function visivel(i) {
    if (!estado.operadoras[D.op[i]]) return false;
    if (estado.uf >= 0 && D.uf[i] !== estado.uf) return false;
    // ERB sem geracao informada (sao ~150) so aparece com todas ligadas: nao
    // da para afirmar que ela tem o 3G que a pessoa esta procurando.
    if (estado.geracoes !== 15 && !(D.ger[i] & estado.geracoes)) return false;
    return true;
  }

  function pilulasGeracao(mascara) {
    var h = '<span class="ger">';
    for (var k = 0; k < ANT_GERACOES.length; k++) {
      var nome = ANT_GERACOES[k];
      h += (mascara & (1 << k))
        ? '<b style="background:' + CORES_GER[nome] + '">' + nome + '</b>'
        : '<b class="nao">' + nome + '</b>';
    }
    return h + '</span>';
  }

  function municipioTexto(i) {
    var m = ANT_MUNICIPIOS[D.mun[i]] || ['', ''];
    return m[0] + (m[1] ? '/' + m[1] : '');
  }

  // ------------------------------------------------- 3. CAMADA DE ANTENAS
  // Canvas proprio, e nao L.CircleMarker: 114 mil marcadores do Leaflet seriam
  // 114 mil nos no DOM. A mecanica de alinhamento e a do mapa original,
  // com os dois bugs de posicao que ela ja evita (ver comentarios abaixo).
  var CamadaAntenas = L.Layer.extend({
    onAdd: function (map) {
      this._mapa = map;
      // leaflet-zoom-animated: o CSS do Leaflet da ao canvas a MESMA transicao
      // de transform dos tiles durante o zoom animado.
      var cv = this._canvas = L.DomUtil.create('canvas', 'camada-antenas leaflet-zoom-animated');
      cv.style.position = 'absolute';
      map.getPanes().overlayPane.appendChild(cv);
      this._ctx = cv.getContext('2d');
      this._sprites = {};
      // _latLngToNewLayerPoint e interno do Leaflet (o embutido e fixo). Sem
      // ele, volta o comportamento antigo: o canvas some durante o zoom.
      this._podeSeguir = typeof map._latLngToNewLayerPoint === 'function';
      map.on('moveend zoomend viewreset resize', this._agendarRedesenho, this);
      map.on('zoomstart', this._aoComecarZoom, this);
      map.on('zoomanim', this._aoAnimarZoom, this);
      map.on('zoom', this._seguirMapa, this);
      this.redesenhar();
    },

    onRemove: function (map) {
      L.DomUtil.remove(this._canvas);
      map.off('moveend zoomend viewreset resize', this._agendarRedesenho, this);
      map.off('zoomstart', this._aoComecarZoom, this);
      map.off('zoomanim', this._aoAnimarZoom, this);
      map.off('zoom', this._seguirMapa, this);
    },

    // ATENCAO, foi a razao de o canvas sumir no zoom: o desenho pronto nao
    // acompanhava a escala do mapa e os pontos saltavam de lugar. Agora ele
    // segue o mapa por transform, ancorado na coordenada do canto superior
    // esquerdo do desenho (_origem): a projecao e uniforme, entao escalar o
    // desenho a partir desse canto poe cada ponto onde ele deve estar.
    // Redesenha nitido quando o mapa para.
    _aplicarSeguir: function (pontoCanto, escala) {
      var cv = this._canvas;
      if (escala > ESCALA_MAX_SEGUIR || escala < 1 / ESCALA_MAX_SEGUIR) L.DomUtil.addClass(cv, 'em-zoom');
      else L.DomUtil.removeClass(cv, 'em-zoom');
      L.DomUtil.setTransform(cv, pontoCanto, escala);
    },

    _aoComecarZoom: function () {
      if (!this._podeSeguir && this._mapa.options.zoomAnimation) L.DomUtil.addClass(this._canvas, 'em-zoom');
    },

    // Zoom animado (roda, botoes, duplo clique): o Leaflet diz para onde vai.
    _aoAnimarZoom: function (e) {
      if (!this._podeSeguir || !this._origem) return;
      var map = this._mapa;
      this._aplicarSeguir(map._latLngToNewLayerPoint(this._origem, e.zoom, e.center),
                          map.getZoomScale(e.zoom, this._zoomDesenho));
    },

    // Voo (flyTo) e fim do zoom animado: o mapa ja esta no zoom do quadro.
    _seguirMapa: function () {
      var map = this._mapa;
      if (!this._podeSeguir || !this._origem || map._animatingZoom) return;
      this._aplicarSeguir(map.latLngToLayerPoint(this._origem), map.getZoomScale(map.getZoom(), this._zoomDesenho));
    },

    // ATENCAO, foi bug: com zoom e arraste atropelados os eventos chegam fora
    // de ordem e um deles redesenhava com o mapa ainda em movimento. O redesenho
    // e adiado ate o mapa PARAR de verdade, qualquer que seja a ordem.
    _agendarRedesenho: function () {
      if (this._pendente) return;
      var self = this;
      this._pendente = L.Util.requestAnimFrame(function () {
        self._pendente = null;
        if (self._mapa && self._mapa._animatingZoom) { self._agendarRedesenho(); return; }
        if (self._mapa && self._mapa._panAnim && self._mapa._panAnim._inProgress) {
          self._agendarRedesenho(); return;
        }
        self.redesenhar();
      });
    },

    // ATENCAO, foi bug: o canvas fica em containerPointToLayerPoint([0,0]), que
    // acumula o deslocamento de cada arraste. Sem somar esse canto, todo ponto
    // sai deslocado exatamente o tanto que o mapa foi arrastado.
    _parametros: function () {
      var map = this._mapa;
      var origem = map.getPixelOrigin();
      var canto = map.containerPointToLayerPoint([0, 0]);
      return { escala: 256 * Math.pow(2, map.getZoom()), dx: origem.x + canto.x, dy: origem.y + canto.y };
    },

    // Coordenadas: x = wx * escala - dx e o ponto NA TELA (container). O
    // canvas comeca margem.x antes da tela, entao no desenho soma-se a margem.
    redesenhar: function () {
      if (!this._mapa) return;
      var map = this._mapa, cv = this._canvas, ctx = this._ctx;
      var tam = map.getSize();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var mx = Math.round(tam.x * MARGEM_DESENHO), my = Math.round(tam.y * MARGEM_DESENHO);
      var larg = tam.x + 2 * mx, alt = tam.y + 2 * my;
      if (cv.width !== Math.round(larg * dpr) || cv.height !== Math.round(alt * dpr)) {
        cv.width = Math.round(larg * dpr);
        cv.height = Math.round(alt * dpr);
      }
      cv.style.width = larg + 'px';
      cv.style.height = alt + 'px';
      L.DomUtil.setTransform(cv, map.containerPointToLayerPoint([-mx, -my]), 1);
      this._origem = map.containerPointToLatLng([-mx, -my]);
      this._zoomDesenho = map.getZoom();

      var p = this._parametros();
      p.mx = mx; p.my = my;
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      var col = this._coletarVisiveis(p, tam.x, tam.y);
      this.ultimosVisiveis = col.lista;
      // Quem decide o simbolo e a densidade NA TELA, nao a da margem.
      if (col.naTela <= LIMITE_CIRCULOS) this._desenharCirculos(ctx, p, dpr, col.lista);
      else this._desenharPixels(ctx, W, H, p, dpr, col.lista);
      L.DomUtil.removeClass(cv, 'em-zoom');
      var el = $('#contador');
      if (el) el.textContent = fmt(col.naTela) + ' na tela';
      var z = $('#hud-zoom');
      if (z) z.textContent = 'z ' + map.getZoom();
    },

    _coletarVisiveis: function (p, largTela, altTela) {
      var out = [], naTela = 0;
      var x0 = -p.mx - 8, x1 = largTela + p.mx + 8;
      var y0 = -p.my - 8, y1 = altTela + p.my + 8;
      for (var k = 0; k < D.n; k++) {
        var i = D.ordem[k];
        var x = D.wx[i] * p.escala - p.dx;
        if (x < x0 || x > x1) continue;
        var y = D.wy[i] * p.escala - p.dy;
        if (y < y0 || y > y1) continue;
        if (!visivel(i)) continue;
        out.push(i);
        if (x >= 0 && x <= largTela && y >= 0 && y <= altTela) naTela++;
      }
      return { lista: out, naTela: naTela };
    },

    // Cada cor vira um sprite desenhado UMA vez (brilho + nucleo + borda);
    // cada antena e um drawImage, bem mais barato que arc + fill + stroke e
    // com o brilho de graca. No claro o brilho da lugar a borda branca.
    _sprite: function (cor, dpr) {
      var chave = cor + '|' + estado.tema + '|' + dpr;
      var s = this._sprites[chave];
      if (s) return s;
      var escuro = estado.tema === 'escuro';
      var R = RAIO_CIRCULO, G = escuro ? R * 3.1 : R + 2.5;
      var lado = Math.ceil(2 * G * dpr) + 2;
      var cv = document.createElement('canvas');
      cv.width = cv.height = lado;
      var c = cv.getContext('2d');
      var m = lado / 2;
      c.scale(1, 1);
      if (escuro) {
        var g = c.createRadialGradient(m, m, R * dpr * 0.6, m, m, G * dpr);
        g.addColorStop(0, comAlfa(cor, 0.42));
        g.addColorStop(1, comAlfa(cor, 0));
        c.fillStyle = g;
        c.fillRect(0, 0, lado, lado);
      } else {
        var sombra = c.createRadialGradient(m, m + dpr, R * dpr, m, m + dpr, G * dpr);
        sombra.addColorStop(0, 'rgba(0,30,70,.22)');
        sombra.addColorStop(1, 'rgba(0,30,70,0)');
        c.fillStyle = sombra;
        c.fillRect(0, 0, lado, lado);
      }
      c.beginPath();
      c.arc(m, m, R * dpr, 0, 6.2832);
      c.fillStyle = cor;
      c.fill();
      c.lineWidth = 1.2 * dpr;
      c.strokeStyle = escuro ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.92)';
      c.stroke();
      if (escuro) {
        c.beginPath();
        c.arc(m - R * dpr * 0.3, m - R * dpr * 0.3, R * dpr * 0.35, 0, 6.2832);
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.fill();
      }
      this._sprites[chave] = cv;
      return cv;
    },

    _desenharCirculos: function (ctx, p, dpr, lista) {
      for (var k = 0; k < lista.length; k++) {
        var i = lista[k];
        var sp = this._sprite(corDe(i), dpr);
        var x = (D.wx[i] * p.escala - p.dx + p.mx) * dpr;
        var y = (D.wy[i] * p.escala - p.dy + p.my) * dpr;
        ctx.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height / 2));
      }
    },

    // Acima do limite, cada ponto vira 2x2 pixels escritos direto no buffer: o
    // Brasil inteiro sai em milissegundos.
    _desenharPixels: function (ctx, W, H, p, dpr, lista) {
      var img = ctx.createImageData(W, H);
      var buf = new Uint32Array(img.data.buffer);
      var cache = {};
      for (var k = 0; k < lista.length; k++) {
        var i = lista[k];
        var cor = corDe(i);
        var abgr = cache[cor];
        if (abgr === undefined) abgr = cache[cor] = corParaABGR(cor);
        var x = Math.round((D.wx[i] * p.escala - p.dx + p.mx) * dpr);
        var y = Math.round((D.wy[i] * p.escala - p.dy + p.my) * dpr);
        for (var ay = 0; ay < 2; ay++) {
          var yy = y + ay;
          if (yy < 0 || yy >= H) continue;
          for (var ax = 0; ax < 2; ax++) {
            var xx = x + ax;
            if (xx < 0 || xx >= W) continue;
            buf[yy * W + xx] = abgr;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    },

    maisProximo: function (containerPonto, alcance) {
      var p = this._parametros();
      var lista = this.ultimosVisiveis || [];
      var melhor = -1, melhorD = alcance * alcance;
      for (var k = 0; k < lista.length; k++) {
        var i = lista[k];
        var dx = (D.wx[i] * p.escala - p.dx) - containerPonto.x;
        var dy = (D.wy[i] * p.escala - p.dy) - containerPonto.y;
        var d2 = dx * dx + dy * dy;
        if (d2 <= melhorD) { melhorD = d2; melhor = i; }
      }
      return melhor;
    }
  });

  function corParaABGR(hex) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    // Uint32 em little-endian: os bytes saem na ordem A,B,G,R.
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  function comAlfa(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  // Voo ate o destino com duracao pelo tamanho do salto: perto e rapido,
  // longe e um pouco mais longo, nunca arrastado. Sem movimento, pulo seco.
  function duracaoVoo(destino) {
    var km = mapa.getCenter().distanceTo(destino) / 1000;
    return Math.min(1.7, Math.max(0.55, 0.45 + Math.log(1 + km) * 0.16));
  }
  // O voo de abertura espera 650 ms; se a pessoa ja buscou ou mexeu no mapa
  // nesse meio-tempo, ele nao pode atropelar o que ela pediu.
  var timerAbertura = null;
  function cancelarAbertura() {
    if (timerAbertura) { clearTimeout(timerAbertura); timerAbertura = null; }
  }

  function voarPara(latlng, zoom) {
    cancelarAbertura();
    if (MENOS_MOVIMENTO) { mapa.setView(latlng, zoom); return; }
    mapa.flyTo(latlng, zoom, { duration: duracaoVoo(L.latLng(latlng)) });
  }
  function voarParaArea(bounds, opcoes) {
    opcoes = opcoes || {};
    cancelarAbertura();
    if (MENOS_MOVIMENTO) { mapa.fitBounds(bounds, opcoes); return; }
    opcoes.duration = duracaoVoo(bounds.getCenter());
    mapa.flyToBounds(bounds, opcoes);
  }

  // ------------------------------------------------------------- 4. O MAPA

  // Abre em Santa Catarina, onde o mapa nasceu; o seletor de UF leva ao resto.
  var VISTA_INICIAL = { centro: [-27.3, -50.4], zoom: 7 };

  function criarMapa() {
    mapa = L.map('mapa', {
      // Com movimento, abre no Brasil inteiro e voa ate a vista inicial.
      center: MENOS_MOVIMENTO ? VISTA_INICIAL.centro : [-15.5, -52.5],
      zoom: MENOS_MOVIMENTO ? VISTA_INICIAL.zoom : 4,
      zoomControl: true,
      preferCanvas: true,
      // Zoom animado: o canvas acompanha a animacao (ver _aoAnimarZoom). Quem
      // pediu menos movimento no sistema fica com o zoom seco.
      zoomAnimation: !MENOS_MOVIMENTO,
      fadeAnimation: !MENOS_MOVIMENTO,
      markerZoomAnimation: !MENOS_MOVIMENTO,
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 90,
      maxZoom: 19
    });
    // Raio e feixes vao em SVG (o resto do vetor fica em canvas, preferCanvas)
    // para o tracejado correr em CSS.
    rendSvg = L.svg({ padding: 0.5 });
    camadaFeixes = L.layerGroup().addTo(mapa);
    aplicarBase();
    camadaAntenas = new CamadaAntenas();
    camadaAntenas.addTo(mapa);
    marcadorMira = L.marker([0, 0], {
      icon: L.divIcon({ className: '', html: '<div class="mira"></div>', iconSize: [0, 0] }),
      interactive: false, keyboard: false
    });

    // Clique esquerdo (10/11/2026): na antena abre a ficha; com a ficha
    // aberta, clicar fora so fecha a ficha (senao o pino pularia toda vez que
    // alguem fecha uma ficha); no vazio, marca o pino.
    //
    // Arrastar o mapa nao marca nada: o Leaflet nao solta 'click' depois de
    // um arraste. O duplo clique (zoom) solta dois 'click' antes do
    // 'dblclick', por isso o pino espera um instante e e cancelado se vier
    // o segundo clique ou o zoom.
    var timerPino = null;
    function cancelarPino() { if (timerPino) { clearTimeout(timerPino); timerPino = null; } }
    mapa.on('click', function (e) {
      var i = camadaAntenas.maisProximo(e.containerPoint, 12);
      if (i >= 0) { cancelarPino(); selecionar(i); return; }
      if (estado.selecionado >= 0) { cancelarPino(); fecharFicha(); return; }
      if (timerPino) { cancelarPino(); return; } // segundo clique de um duplo
      var ll = e.latlng;
      timerPino = setTimeout(function () {
        timerPino = null;
        buscarPerto(ll.lat, ll.lng, false);
      }, 280);
    });
    mapa.on('dblclick zoomstart movestart', cancelarPino);
    // Botao direito (ou toque longo no celular): o mesmo pino, na hora.
    mapa.on('contextmenu', function (e) {
      cancelarPino();
      buscarPerto(e.latlng.lat, e.latlng.lng, false);
    });
    ligarPassarMouse();
  }

  // ------------------------------------------- PASSAR O MOUSE (dica e mira)
  // Uma conta por quadro, no maximo: o mousemove chega bem mais rapido que a
  // tela redesenha. A busca e sobre as visiveis do ultimo desenho.
  function ligarPassarMouse() {
    var ultimo = null, agendado = false, atual = -1;
    var dica = $('#dica'), coord = $('#hud-coord'), cont = mapa.getContainer();

    function esconder() {
      atual = -1;
      dica.classList.remove('ligada');
      var el = marcadorMira.getElement && marcadorMira.getElement();
      if (el && el.firstChild) el.firstChild.classList.remove('ligada');
      cont.style.cursor = '';
    }

    function quadro() {
      agendado = false;
      if (!ultimo) return;
      var e = ultimo;
      if (coord) coord.textContent = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
      if (mapa._animatingZoom) { esconder(); return; }
      var i = camadaAntenas.maisProximo(e.containerPoint, 9);
      if (i < 0) { esconder(); return; }
      cont.style.cursor = 'pointer';
      if (i !== atual) {
        atual = i;
        dica.innerHTML = '<div class="dica-op"><span class="bolinha" style="background:' + esc(corOp(D.op[i])) +
          '"></span><span style="color:' + esc(corOp(D.op[i])) + '">' + esc(nomeOp(D.op[i])) + '</span></div>' +
          pilulasGeracao(D.ger[i]) + '<div class="dica-sub">' + esc(municipioTexto(i)) + ' · ERB ' + esc(D.numero[i]) + '</div>';
        if (!mapa.hasLayer(marcadorMira)) marcadorMira.addTo(mapa);
        marcadorMira.setLatLng([D.lat[i], D.lon[i]]);
      }
      var el = marcadorMira.getElement && marcadorMira.getElement();
      if (el && el.firstChild) el.firstChild.classList.add('ligada');
      // A dica fica ao lado do cursor e vira para dentro perto da borda.
      var tam = mapa.getSize();
      var x = e.containerPoint.x + 16, y = e.containerPoint.y + 14;
      if (x + 250 > tam.x) x = e.containerPoint.x - 16 - dica.offsetWidth;
      if (y + 80 > tam.y) y = e.containerPoint.y - 14 - dica.offsetHeight;
      dica.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      dica.classList.add('ligada');
    }

    mapa.on('mousemove', function (e) {
      ultimo = e;
      if (!agendado) { agendado = true; L.Util.requestAnimFrame(quadro); }
    });
    mapa.on('mouseout movestart zoomstart', esconder);
  }

  function aplicarBase() {
    var def = BASES[estado.base] || BASES.mapa;
    if (camadaBase) mapa.removeLayer(camadaBase);
    camadaBase = L.tileLayer(def.url(estado.tema), def.opcoes).addTo(mapa);
    camadaBase.bringToBack();
    document.querySelectorAll('[data-base]').forEach(function (b) {
      var ativo = b.dataset.base === estado.base;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }

  // ------------------------------------------------------- 5. A COBERTURA

  function aplicarCobertura() {
    if (camadaCobertura) { mapa.removeLayer(camadaCobertura); camadaCobertura = null; }
    if (!estado.cobertura) { $('#cobertura-legenda').innerHTML = ''; return; }
    try {
      camadaCobertura = Cobertura.criar(estado.cobertura, estado.coberturaCamada, { opacity: estado.opacidade });
      vigiarFalhaDaMancha(camadaCobertura, Cobertura.fonte(estado.cobertura));
      camadaCobertura.addTo(mapa);
      // A mancha entra ABAIXO das antenas: ela e o fundo que explica o ponto.
      if (camadaCobertura.setZIndex) camadaCobertura.setZIndex(200);
      renderizarLegendaCobertura();
    } catch (e) {
      $('#cobertura-legenda').innerHTML =
        '<div class="msg erro">Nao consegui carregar a mancha: ' + esc(e.message) + '</div>';
    }
  }

  function renderizarLegendaCobertura() {
    var f = Cobertura.fonte(estado.cobertura);
    if (!f) { $('#cobertura-legenda').innerHTML = ''; return; }
    var c = Cobertura.camadaDe(f, estado.coberturaCamada) || Cobertura.camadaPadrao(f);
    var itens = (c && c.legenda) || [];
    var h = '<div class="legenda-titulo">' + esc(f.nome) + ' — ' + esc(c ? c.rotulo : '') + '</div>';
    for (var i = 0; i < itens.length; i++) {
      h += '<div class="legenda-item"><span class="quadro" style="background:' +
        esc(itens[i].cor) + '"></span>' + esc(itens[i].rotulo) + '</div>';
    }
    if (f.modelo) h += '<div class="nota">' + esc(f.modelo) + '</div>';
    h += '<div class="msg erro" id="cobertura-falha" role="status"></div>';
    $('#cobertura-legenda').innerHTML = h;
  }

  // Sem isto, servidor da operadora fora do ar era so uma mancha vazia, igual
  // a "sem cobertura" (10/11/2026: a TIM respondia 503 a tudo). Conta os tiles
  // de cada carregamento e, no fim dele, pergunta ao diagnosticoDaVista.
  function vigiarFalhaDaMancha(camada, f) {
    var chegaram = 0, falharam = 0;
    camada.on('loading', function () { chegaram = 0; falharam = 0; });
    camada.on('manchatile', function (e) { if (e.ok) chegaram++; else falharam++; });
    camada.on('load', function () {
      if (camada !== camadaCobertura) return;   // trocada no meio do caminho
      var caixa = $('#cobertura-falha');
      if (caixa) caixa.textContent = Cobertura.diagnosticoDaVista(f, chegaram, falharam);
    });
  }

  // ---------------------------------------------------------- 6. A FICHA

  function linha(rotulo, valor, tecnica) {
    return '<div class="ficha-linha' + (tecnica ? ' tecnica' : '') + '"><span>' + rotulo +
      '</span>' + valor + '</div>';
  }

  // Outras ERBs no mesmo ponto (mastro compartilhado), pelo indice em grade.
  function vizinhosNoMesmoPonto(i) {
    var out = [];
    Geo.paraCadaCandidato(D.indice, D.lat[i], D.lon[i], MESMO_PONTO_KM, function (j) {
      if (j !== i && Geo.distanciaKm(D.lat[i], D.lon[i], D.lat[j], D.lon[j]) <= MESMO_PONTO_KM) out.push(j);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // A mais proxima de cada operadora ate alcanceKm, e (opcional) todas ate
  // raioKm, respeitando os filtros. Serve a busca por ponto e ao lote.
  function proximasDoPonto(lat, lon, alcanceKm, raioKm) {
    var melhorOp = {}, noRaio = raioKm ? [] : null;
    Geo.paraCadaCandidato(D.indice, lat, lon, alcanceKm, function (i) {
      if (!visivel(i)) return;
      var d = Geo.distanciaKm(lat, lon, D.lat[i], D.lon[i]);
      if (d > alcanceKm) return;
      if (noRaio && d <= raioKm) noRaio.push([i, d]);
      var o = D.op[i];
      // Empate de distancia: o menor indice vence, como na varredura antiga
      // (que ia em ordem e so trocava por distancia menor).
      if (!melhorOp[o] || d < melhorOp[o][1] || (d === melhorOp[o][1] && i < melhorOp[o][0])) melhorOp[o] = [i, d];
    });
    if (noRaio) noRaio.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    return { melhorOp: melhorOp, noRaio: noRaio };
  }

  function selecionar(i) {
    estado.selecionado = i;
    var op = D.op[i];
    var h = '<div class="ficha-topo">' +
      '<span class="bolinha" style="background:' + esc(corOp(op)) + ';width:13px;height:13px"></span>' +
      '<div><div class="ficha-op" style="color:' + esc(corOp(op)) + '">' + esc(nomeOp(op)) + '</div>' +
      '<div class="ficha-num">ERB n&ordm; ' + esc(D.numero[i]) + '</div></div>' +
      '<button id="fechar-ficha" type="button" aria-label="Fechar">&times;</button></div>';

    if (D.flags[i] & 1) {
      h += '<div class="ficha-alerta"><strong>Posicao incerta</strong>' +
        '<span>A Anatel tem esta mesma estacao cadastrada tambem a ' + esc(D.div[i]) +
        ' km daqui. O mapa usa a coordenada mais frequente; confira antes de confiar.</span></div>';
    }

    h += '<div class="ficha-endereco">' + esc(D.endereco[i] || 'Endereco nao informado') +
      '<br><strong>' + esc(municipioTexto(i)) + '</strong></div>';

    h += linha('Geracoes', pilulasGeracao(D.ger[i]));
    var tecs = [];
    for (var k = 0; k < ANT_TECNOLOGIAS.length; k++) if (D.tec[i] & (1 << k)) tecs.push(ANT_TECNOLOGIAS[k]);
    if (tecs.length) h += linha('Tecnologias', '<strong>' + esc(tecs.join(', ')) + '</strong>');
    var fx = [];
    for (var b = 0; b < ANT_FAIXAS.length; b++) if (D.faixas[i] & (1 << b)) fx.push(ANT_FAIXAS[b]);
    if (fx.length) h += linha('Faixas', '<strong>' + esc(fx.join(' / ')) + ' MHz</strong>');
    var t5 = [];
    if (D.flags[i] & 2) t5.push('NSA');
    if (D.flags[i] & 4) t5.push('SA');
    if (t5.length) h += linha('Tipo do 5G', '<strong>' + t5.join(' + ') + '</strong>');
    if (D.setores[i]) h += linha('Setores', '<strong>' + D.setores[i] + '</strong>');
    var inf = ANT_INFRAS[D.infra[i]];
    if (inf) h += linha('Infraestrutura', '<strong>' + esc(inf) + '</strong>');
    if (D.desde[i]) {
      var pd = D.desde[i].split('-');
      h += linha('Licenciada desde', '<strong>' + esc(pd[1] + '/' + pd[0]) + '</strong>');
    }
    if (D.empresa[i]) h += linha('Empresa (Anatel)', '<strong>' + esc(D.empresa[i]) + '</strong>');
    if (estado.ponto) {
      h += linha('Distancia do ponto', '<strong>' +
        Geo.formatarDistancia(Geo.distanciaKm(estado.ponto.lat, estado.ponto.lon, D.lat[i], D.lon[i])) +
        '</strong>');
    }
    h += linha('Coordenada', '<code>' + D.lat[i].toFixed(5) + ', ' + D.lon[i].toFixed(5) + '</code>', true);

    var ll = D.lat[i].toFixed(6) + ',' + D.lon[i].toFixed(6);
    h += '<div class="ficha-links">' +
      '<a href="https://www.google.com/maps?q=' + ll + '" target="_blank" rel="noopener">Google Maps</a>' +
      '<a href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;viewpoint=' + ll +
      '" target="_blank" rel="noopener">Street View</a></div>';

    var viz = vizinhosNoMesmoPonto(i);
    if (viz.length) {
      h += '<div class="ficha-vizinhos"><div class="lista-titulo" style="margin-top:0">' +
        'No mesmo ponto (ate 50 m): ' + viz.length + ' outra(s) ERB(s)</div><div class="lista">';
      viz.forEach(function (j) { h += itemLista(j, ''); });
      h += '</div></div>';
    }

    var f = $('#ficha');
    f.innerHTML = h;
    // Reinicia a animacao de entrada a cada antena nova, e nao so na primeira.
    f.hidden = true;
    void f.offsetWidth;
    f.hidden = false;
    $('#fechar-ficha').addEventListener('click', fecharFicha);
    ligarItens(f);
    marcarSelecionada(i);
  }

  // O destaque da selecionada e um marcador CSS (pulso na cor da operadora),
  // e nao um anel no canvas: anima sem redesenhar as 114 mil antenas e
  // acompanha o zoom sozinho.
  function marcarSelecionada(i) {
    if (marcadorSel) { mapa.removeLayer(marcadorSel); marcadorSel = null; }
    if (i < 0) return;
    marcadorSel = L.marker([D.lat[i], D.lon[i]], {
      icon: L.divIcon({ className: '', html: '<div class="pulso-erb" style="--c:' + esc(corOp(D.op[i])) + '"></div>', iconSize: [0, 0] }),
      interactive: false, keyboard: false, zIndexOffset: 500
    }).addTo(mapa);
  }

  function fecharFicha() {
    estado.selecionado = -1;
    $('#ficha').hidden = true;
    marcarSelecionada(-1);
  }

  function itemLista(i, direita) {
    return '<button class="item-lista" data-i="' + i + '">' +
      '<span class="bolinha" style="background:' + esc(corOp(D.op[i])) + '"></span>' +
      '<strong>' + esc(nomeOp(D.op[i])) + '</strong>' + pilulasGeracao(D.ger[i]) +
      '<span class="sub">' + (direita || esc(D.numero[i])) + '</span></button>';
  }

  function ligarItens(raiz) {
    raiz.querySelectorAll('[data-i]').forEach(function (b) {
      b.addEventListener('click', function () { irPara(+b.dataset.i); });
    });
  }

  // A ficha abre na hora: o destaque e um marcador preso a coordenada, entao
  // nao depende do canvas ja estar redesenhado no lugar novo (antes era um
  // setTimeout de 60 ms, que perdia para um pan mais longo).
  function irPara(i) {
    voarPara([D.lat[i], D.lon[i]], Math.max(mapa.getZoom(), 15));
    selecionar(i);
  }

  // ----------------------------------------------------------- 7. A BUSCA

  // "-27.59, -48.55", "-27,59 -48,55", "-27.59;-48.55" (o que vem do Google
  // Maps, de outro sistema ou da planilha). A parte decimal e obrigatoria: "12 34"
  // e mais provavel ser um numero de estacao digitado com espaco.
  var RE_COORD = /^\s*(-?\d{1,2}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/;

  // Mensagem da busca: 'ok' (deu certo), 'erro' ou neutra. Antes tudo ia em
  // vermelho, e "1.234 ERBs em Joinville" parecia falha (ANT-02, 10/11/2026).
  function aviso(texto, tipo) {
    var el = $('#erro');
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' ' + tipo : '');
  }

  // CEP e endereco vao para fora (ViaCEP e Nominatim, ver app/js/endereco.js);
  // coordenada, numero da ERB e municipio nunca saem do navegador.
  var geocodificador = window.Endereco && window.fetch
    ? Endereco.criar({ fetch: window.fetch.bind(window) })
    : null;
  // Cada busca ganha um numero: resposta de uma busca antiga que chega depois
  // de uma nova e descartada, em vez de voar para o lugar errado.
  var buscaAtual = 0;

  function executarBusca() {
    var t = $('#entrada').value.trim();
    var lista = $('#lista');
    var minha = ++buscaAtual;
    aviso('');
    lista.hidden = true;
    if (!t) return;

    var m = RE_COORD.exec(t);
    if (m) {
      var la = +m[1].replace(',', '.'), lo = +m[2].replace(',', '.');
      // A mesma caixa do consolidar.py: o leste vai a -28 por causa de Noronha.
      if (la < -34 || la > 6 || lo < -74 || lo > -28) {
        aviso('Essa coordenada fica fora do Brasil (' + la + ', ' + lo +
          '). Confira o sinal de menos e a ordem: latitude primeiro.', 'erro');
        return;
      }
      buscarPerto(la, lo, true);
      return;
    }

    // "88015-200" e sempre CEP. Oito digitos sem hifen sao CEP se nao houver
    // ERB com esse numero (na base de 16/10/2026 nenhuma tem 8 digitos).
    var cep = window.Endereco ? Endereco.lerCep(t) : null;
    if (cep && /-/.test(t)) { buscarCep(cep, minha); return; }

    if (/^\d+$/.test(t)) {
      for (var i = 0; i < D.n; i++) {
        if (D.numero[i] === t) { irPara(i); return; }
      }
      if (cep) { buscarCep(cep, minha); return; }
      aviso('Nenhuma ERB com o numero ' + t + '.', 'erro');
      return;
    }

    // "Joinville" e municipio (sem rede). "Rua X, 300, Joinville" tem cara de
    // endereco e vai direto ao Nominatim. O que nao bate com municipio nenhum
    // tambem tenta como endereco antes de dar erro.
    var temCaraDeEndereco = window.Endereco ? Endereco.pareceEndereco(t) : false;
    if (!temCaraDeEndereco && buscarMunicipio(t)) return;
    if (!window.Endereco) { aviso('Nao achei municipio com "' + t + '".', 'erro'); return; }
    buscarEnderecoTexto(t, minha);
  }

  function semGeocodificador() {
    aviso('Este navegador nao consegue consultar CEP nem endereco. Cole a coordenada do lugar.', 'erro');
  }

  function falhaGeocodificacao(e) {
    if (e && e.tipo === 'rede') {
      aviso('Nao consegui consultar o endereco agora (' + e.message + ') Tente de novo em instantes, ' +
        'ou cole a coordenada do lugar.', 'erro');
    } else {
      aviso((e && e.message) || 'Falha ao consultar o endereco.', 'erro');
    }
  }

  function irParaEndereco(r) {
    buscarPerto(r.lat, r.lon, true, { rotulo: r.rotulo, precisao: r.precisao });
    // O endereco achado ja aparece no quadro "Antenas perto do ponto"; aqui
    // fica so a precisao, que e o que muda a confianca na resposta.
    aviso('Endereco encontrado. Posicao ' + Endereco.TEXTO_PRECISAO[r.precisao] + '.',
      r.precisao === 'imovel' || r.precisao === 'rua' ? 'ok' : '');
  }

  function buscarCep(cep, minha) {
    if (!geocodificador) { semGeocodificador(); return; }
    aviso('Procurando o CEP ' + Endereco.formatarCep(cep) + '...');
    geocodificador.buscarCep(cep).then(function (r) {
      if (minha !== buscaAtual) return;
      irParaEndereco(r);
    }, function (e) {
      if (minha !== buscaAtual) return;
      falhaGeocodificacao(e);
    });
  }

  function buscarEnderecoTexto(t, minha) {
    if (!geocodificador) { semGeocodificador(); return; }
    aviso('Procurando o endereco...');
    geocodificador.buscarTexto(t).then(function (achados) {
      if (minha !== buscaAtual) return;
      if (!achados.length) {
        aviso('Nao achei municipio nem endereco com "' + t + '". Confira a grafia, ' +
          'acrescente o municipio ("Rua X, Joinville") ou cole a coordenada.', 'erro');
        return;
      }
      if (achados.length === 1) { irParaEndereco(achados[0]); return; }
      // Varios: lista para escolher, como nos municipios repetidos.
      var h = '<div class="lista-titulo">' + achados.length + ' lugares batem:</div>';
      achados.forEach(function (r, k) {
        h += '<button class="item-lista" data-end="' + k + '"><strong>' + esc(r.rotulo) +
          '</strong><span class="sub">' + esc(Endereco.TEXTO_PRECISAO_CURTO[r.precisao]) + '</span></button>';
      });
      var lista = $('#lista');
      lista.innerHTML = h;
      lista.hidden = false;
      aviso('');
      lista.querySelectorAll('[data-end]').forEach(function (b) {
        b.addEventListener('click', function () { lista.hidden = true; irParaEndereco(achados[+b.dataset.end]); });
      });
    }, function (e) {
      if (minha !== buscaAtual) return;
      falhaGeocodificacao(e);
    });
  }

  // Devolve true quando achou municipio (e ja tratou), false quando nada bateu.
  function buscarMunicipio(t) {
    var alvo = normalizar(t);
    var uf = '';
    var mUf = /^(.*?)\s*[\/-]\s*([a-z]{2})$/.exec(alvo);
    if (mUf) { alvo = mUf[1]; uf = mUf[2].toUpperCase(); }

    var exatos = [], parciais = [];
    ANT_MUNICIPIOS.forEach(function (m, k) {
      if (uf && m[1] !== uf) return;
      var nome = normalizar(m[0]);
      if (nome === alvo) exatos.push(k);
      else if (nome.indexOf(alvo) >= 0) parciais.push(k);
    });
    var achados = exatos.length ? exatos : parciais;
    if (!achados.length) return false;
    if (achados.length === 1) { irParaMunicipio(achados[0]); return true; }

    // Varios (ex.: "Bom Jesus" existe em 5 UFs): lista para escolher em vez
    // de voar para o errado com confianca.
    achados.sort(function (a, b) {
      return (ANT_MUNICIPIOS[a][0] + ANT_MUNICIPIOS[a][1]).localeCompare(ANT_MUNICIPIOS[b][0] + ANT_MUNICIPIOS[b][1]);
    });
    var h = '<div class="lista-titulo">' + achados.length + ' municipios batem:</div>';
    achados.slice(0, 60).forEach(function (k) {
      h += '<button class="item-lista" data-mun="' + k + '"><strong>' + esc(ANT_MUNICIPIOS[k][0]) +
        '</strong><span class="sub">' + esc(ANT_MUNICIPIOS[k][1]) + '</span></button>';
    });
    var lista = $('#lista');
    lista.innerHTML = h;
    lista.hidden = false;
    lista.querySelectorAll('[data-mun]').forEach(function (b) {
      b.addEventListener('click', function () { lista.hidden = true; irParaMunicipio(+b.dataset.mun); });
    });
    return true;
  }

  function irParaMunicipio(k) {
    var b = null, n = 0;
    for (var i = 0; i < D.n; i++) {
      if (D.mun[i] !== k) continue;
      n++;
      if (!b) b = L.latLngBounds([D.lat[i], D.lon[i]], [D.lat[i], D.lon[i]]);
      else b.extend([D.lat[i], D.lon[i]]);
    }
    if (!b) return;
    voarParaArea(b.pad(0.15), { maxZoom: 15 });
    aviso(fmt(n) + ' ERBs em ' + ANT_MUNICIPIOS[k][0] + '/' + ANT_MUNICIPIOS[k][1] +
      ' (contando todas as operadoras e geracoes).', 'ok');
  }

  // ------------------------------------------- 8. ANTENAS PERTO DE UM PONTO

  // `origem` ({rotulo, precisao}) so vem da busca por CEP/endereco. Fica na
  // memoria para o cabecalho; o link da vista leva so a coordenada.
  //
  // O pino e arrastavel (10/11/2026): a busca por CEP cai na rua, e arrastar
  // ate a casa certa olhando o mapa corrige isso sem outro servico. Durante o
  // arraste o raio, a tabela e os feixes acompanham (uma conta por quadro); ao
  // soltar, o link da vista e atualizado. O pino tem 40 px de area de toque
  // para o dedo pegar ele, e nao o mapa.
  function buscarPerto(lat, lon, centralizar, origem) {
    estado.ponto = {
      lat: lat, lon: lon, rotulo: origem && origem.rotulo, precisao: origem && origem.precisao,
      ajustado: false, reverso: null, versao: 0
    };
    if (marcadorPonto) mapa.removeLayer(marcadorPonto);
    marcadorPonto = L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'pino-arrastavel',
        html: '<div class="alvo-busca"><span class="radar"></span></div>',
        iconSize: [40, 40], iconAnchor: [20, 20]
      }),
      draggable: true,
      autoPan: true,
      keyboard: false,
      title: 'Arraste para ajustar o ponto',
      zIndexOffset: 400
    }).addTo(mapa);
    ligarArrastePino(marcadorPonto);
    desenharRaio();
    if (centralizar) voarParaArea(circuloRaio.getBounds(), { maxZoom: 15 });
    renderizarPerto();
    $('#secao-perto').hidden = false;
    agendarLink();
    // No celular o painel esta fechado: abre para a resposta aparecer.
    if (window.matchMedia && window.matchMedia('(max-width: 780px)').matches) {
      document.body.classList.add('painel-aberto');
    }
  }

  function ligarArrastePino(m) {
    var agendado = false;
    function quadro() {
      agendado = false;
      if (estado.ponto) renderizarPerto(true);
    }
    // Clique no proprio pino nao chega ao mapa (nao marca outro pino em cima).
    m.on('click', function (e) { L.DomEvent.stopPropagation(e); });
    m.on('dragstart', function () {
      var el = m.getElement();
      if (el) el.classList.add('arrastando');
      // "Endereco encontrado. Posicao pela rua" deixa de valer ao arrastar.
      aviso('');
    });
    m.on('drag', function () {
      if (!estado.ponto) return;
      var ll = m.getLatLng();
      estado.ponto.lat = ll.lat;
      estado.ponto.lon = ll.lng;
      estado.ponto.ajustado = true;
      // O endereco achado antes (se houver) ja nao e deste lugar.
      estado.ponto.reverso = null;
      estado.ponto.versao++;
      if (circuloRaio) circuloRaio.setLatLng(ll);
      if (!agendado) { agendado = true; L.Util.requestAnimFrame(quadro); }
    });
    m.on('dragend', function () {
      var el = m.getElement();
      if (el) el.classList.remove('arrastando');
      if (!estado.ponto) return;
      renderizarPerto(true);
      agendarLink();
    });
  }

  // "Qual o endereco deste ponto?": so aqui a coordenada do pino sai do
  // navegador (Nominatim reverse), e so porque a pessoa clicou.
  function enderecoDoPino() {
    var P = estado.ponto;
    if (!P) return;
    if (!geocodificador) { P.reverso = { erro: 'Este navegador nao consegue consultar endereco.' }; renderizarCabecaPerto(); return; }
    var versao = P.versao;
    P.reverso = { buscando: true };
    renderizarCabecaPerto();
    geocodificador.buscarReverso(P.lat, P.lon).then(function (r) {
      if (estado.ponto !== P || P.versao !== versao) return; // o pino mudou
      P.reverso = r;
      renderizarCabecaPerto();
    }, function (e) {
      if (estado.ponto !== P || P.versao !== versao) return;
      P.reverso = {
        erro: e && e.tipo === 'rede'
          ? 'Nao consegui consultar agora (' + e.message + ') Tente de novo em instantes.'
          : (e && e.message) || 'Falha ao consultar o endereco.'
      };
      renderizarCabecaPerto();
    });
  }

  // Cabecalho do quadro "Antenas perto do ponto": de onde veio o ponto, a
  // coordenada, a precisao e o endereco do pino (quando pedido).
  function renderizarCabecaPerto() {
    var P = estado.ponto;
    if (!P) return;
    var coordP = '<code>' + P.lat.toFixed(5) + ', ' + P.lon.toFixed(5) + '</code>';
    var h;
    if (P.rotulo && !P.ajustado) {
      h = '<strong>' + esc(P.rotulo) + '</strong><br>' + coordP +
        ' <span class="sub">posicao ' + esc(Endereco.TEXTO_PRECISAO[P.precisao] || '') + '</span>';
    } else if (P.rotulo) {
      h = '<strong>Ponto ajustado a mao</strong><br>' + coordP +
        '<br><span class="sub">partiu de ' + esc(P.rotulo) + '</span>';
    } else {
      h = 'Ponto ' + coordP;
    }
    var R = P.reverso;
    if (R && R.buscando) {
      h += '<div class="perto-endereco">Procurando o endereco...</div>';
    } else if (R && R.erro) {
      h += '<div class="perto-endereco erro">' + esc(R.erro) + '</div>';
    } else if (R && R.rotulo) {
      var longe = R.distanciaM != null && R.distanciaM > 60;
      h += '<div class="perto-endereco"><span class="sub">Endereco aproximado (OpenStreetMap)</span><br><strong>' +
        esc(R.rotulo) + '</strong>' +
        (longe ? '<br><span class="sub">o lugar achado fica a ' + Geo.formatarDistancia(R.distanciaM / 1000) +
          ' do pino</span>' : '') + '</div>';
    }
    $('#perto-cabeca').innerHTML = h;
    // O botao some quando o ponto ja tem endereco valido (da busca, sem
    // arraste, ou o reverso ja achado) e enquanto a consulta esta em curso.
    var temEndereco = (P.rotulo && !P.ajustado) || (R && (R.rotulo || R.buscando));
    $('#perto-endereco').hidden = !!temEndereco;
  }

  function desenharRaio() {
    if (circuloRaio) mapa.removeLayer(circuloRaio);
    if (!estado.ponto) return;
    // Cor e tracejado vem do CSS (.raio-busca), que anima o tracejado.
    circuloRaio = L.circle([estado.ponto.lat, estado.ponto.lon], {
      radius: estado.raioKm * 1000, renderer: rendSvg, className: 'raio-busca',
      fill: true, interactive: false
    }).addTo(mapa);
  }

  // Um feixe do ponto ate a mais proxima de cada operadora, na cor dela: a
  // resposta da tabela aparece tambem no mapa.
  function desenharFeixes(melhorOp) {
    camadaFeixes.clearLayers();
    if (!estado.ponto) return;
    for (var k = 0; k < ANT_OPERADORAS.length; k++) {
      var m = melhorOp[k];
      if (!m || !estado.operadoras[k]) continue;
      L.polyline([[estado.ponto.lat, estado.ponto.lon], [D.lat[m[0]], D.lon[m[0]]]], {
        renderer: rendSvg, className: 'feixe', color: corOp(k), interactive: false
      }).addTo(camadaFeixes);
    }
  }

  function fecharPerto() {
    estado.ponto = null;
    estado.respostaRapida = null;
    if (marcadorPonto) { mapa.removeLayer(marcadorPonto); marcadorPonto = null; }
    if (circuloRaio) { mapa.removeLayer(circuloRaio); circuloRaio = null; }
    camadaFeixes.clearLayers();
    $('#secao-perto').hidden = true;
    agendarLink();
  }

  // Cartao-resposta: a melhor opcao primeiro, a tabela completa logo abaixo.
  function renderizarResposta(melhorOp, alcance) {
    var caixa = $('#resposta');
    var melhor = null, nOps = 0, nNoRaio = 0;
    for (var k = 0; k < ANT_OPERADORAS.length; k++) {
      if (!estado.operadoras[k] || !opPresente[k]) continue;
      nOps++;
      var m = melhorOp[k];
      if (!m) continue;
      if (m[1] <= estado.raioKm) nNoRaio++;
      if (!melhor || m[1] < melhor[1][1]) melhor = [k, m];
    }
    estado.respostaRapida = melhor ? { op: melhor[0], i: melhor[1][0], km: melhor[1][1] } : null;
    if (!melhor) {
      caixa.innerHTML = '<div class="resposta-vazia"><strong>Nenhuma antena em ' + alcance +
        ' km</strong> com os filtros atuais. Tente marcar mais operadoras ou gerações.</div>';
      return;
    }
    var k0 = melhor[0], i0 = melhor[1][0], d0 = melhor[1][1];
    caixa.innerHTML = '<button type="button" class="resposta-cartao" data-i="' + i0 +
      '" style="border-left-color:' + esc(corOp(k0)) + '" title="Ver esta antena no mapa">' +
      '<div class="resposta-rotulo">Mais próxima do ponto</div>' +
      '<div class="resposta-linha"><span class="resposta-op" style="color:' + esc(corOp(k0)) + '">' +
      esc(nomeOp(k0)) + '</span><span class="resposta-dist">' + Geo.formatarDistancia(d0) + '</span>' +
      pilulasGeracao(D.ger[i0]) + '</div>' +
      '<div class="resposta-sub">' + nNoRaio + ' de ' + nOps + ' operadora' + (nOps === 1 ? '' : 's') +
      ' com antena a até ' + estado.raioKm + ' km. Proximidade não garante sinal.</div></button>';
    caixa.querySelector('button').addEventListener('click', function () { irPara(i0); });
  }

  // Localizacao do aparelho: um toque marca o pino onde o usuario esta.
  // A coordenada fica no navegador (nao vai a nenhum servico).
  function usarMinhaLocalizacao() {
    var b = $('#usar-local');
    if (!navigator.geolocation) { aviso('Este navegador não informa a localização.', 'erro'); return; }
    var rotulo = b.textContent;
    b.disabled = true; b.textContent = 'Localizando...';
    aviso('Pedindo a localização ao aparelho...');
    function pronto() { b.disabled = false; b.textContent = rotulo; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      pronto();
      var la = pos.coords.latitude, lo = pos.coords.longitude;
      if (la < -34 || la > 6 || lo < -74 || lo > -28) {
        aviso('Sua localização (' + la.toFixed(3) + ', ' + lo.toFixed(3) + ') fica fora do Brasil, onde a base não cobre.', 'erro');
        return;
      }
      buscarPerto(la, lo, true);
      var prec = pos.coords.accuracy;
      aviso('Localização obtida' + (prec ? ' (precisão de cerca de ' + Geo.formatarDistancia(prec / 1000) + ')' : '') +
        '. Arraste o pino se precisar ajustar.', 'ok');
    }, function (e) {
      pronto();
      var msg = e && e.code === 1
        ? 'Permissão negada. Libere a localização para este site no navegador, ou digite o endereço.'
        : e && e.code === 3
          ? 'A localização demorou demais. Tente de novo ou digite o endereço.'
          : 'Não consegui obter a localização agora. Digite o endereço ou a coordenada.';
      aviso(msg, 'erro');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  // `continuo`: o redesenho vem de um gesto que se repete (arrastar o pino,
  // correr o raio). Sem a animacao de entrada, porque ela recomecaria a cada
  // quadro e a tabela ficaria apagada enquanto o gesto dura.
  function renderizarPerto(continuo) {
    if (!estado.ponto) return;
    $('#secao-perto').classList.toggle('sem-animacao', !!continuo);
    var P = estado.ponto;
    var alcance = Math.max(ALCANCE_POR_OPERADORA_KM, estado.raioKm);
    var res = proximasDoPonto(P.lat, P.lon, alcance, estado.raioKm);
    var noRaio = res.noRaio;
    var melhorOp = res.melhorOp;

    renderizarCabecaPerto();

    var h = '';
    for (var k = 0; k < ANT_OPERADORAS.length; k++) {
      if (!estado.operadoras[k] || !opPresente[k]) continue;
      var nome = nomeOp(k);
      var m = melhorOp[k];
      if (m) {
        h += '<tr data-i="' + m[0] + '"><td><span class="bolinha" style="display:inline-block;background:' +
          esc(corOp(k)) + '"></span> ' + esc(nome) + '</td><td>' + pilulasGeracao(D.ger[m[0]]) +
          '</td><td class="num">' + Geo.formatarDistancia(m[1]) + '</td></tr>';
      } else {
        h += '<tr><td><span class="bolinha" style="display:inline-block;background:' + esc(corOp(k)) +
          '"></span> ' + esc(nome) + '</td><td class="vazio" colspan="2">nenhuma em ' +
          alcance + ' km</td></tr>';
      }
    }
    renderizarResposta(melhorOp, alcance);
    var tab = $('#perto-operadoras');
    tab.innerHTML = h;
    ligarItens(tab);
    desenharFeixes(melhorOp);

    $('#perto-titulo').textContent = noRaio.length
      ? fmt(noRaio.length) + ' ERB(s) em ' + estado.raioKm + ' km' +
        (noRaio.length > MAX_LISTA_PERTO ? ' (mostrando as ' + MAX_LISTA_PERTO + ' mais proximas)' : '') + ':'
      : 'Nenhuma ERB em ' + estado.raioKm + ' km com os filtros atuais.';
    var lh = '';
    noRaio.slice(0, MAX_LISTA_PERTO).forEach(function (par) {
      lh += itemLista(par[0], Geo.formatarDistancia(par[1]));
    });
    var lista = $('#perto-lista');
    lista.innerHTML = lh;
    ligarItens(lista);
  }

  // ------------------------------------------------- 8b. LOTE DE PONTOS (M10)
  // Uma lista de coordenadas (enderecos de uma carteira, pontos de instalacao) vira
  // a mais proxima de cada operadora por ponto, com resumo e CSV.
  //
  // PRIVACIDADE: os pontos ficam SO na memoria deste navegador. Nada e
  // enviado nem gravado no arquivo do mapa, que continua sem dado pessoal
  // e pode circular. Fechar ou recarregar a aba apaga.
  var LIMITE_LOTE = 5000;
  var FATIA_LOTE = 250;          // pontos por fatia: a tela nao trava
  var lote = { pontos: [], ignoradas: [], resultado: null, geracao: 0, camada: null };

  function opsDoLote() {
    var ops = [];
    for (var k = 0; k < ANT_OPERADORAS.length; k++) if (opPresente[k] && estado.operadoras[k]) ops.push(k);
    return ops;
  }

  function processarLote() {
    var msg = $('#lote-msg');
    var lido = Geo.lerLote($('#lote-texto').value, LIMITE_LOTE);
    lote.pontos = lido.pontos;
    lote.ignoradas = lido.ignoradas;
    if (!lote.pontos.length) {
      msg.className = 'msg erro';
      msg.textContent = 'Nenhuma coordenada valida encontrada' +
        (lote.ignoradas.length ? ' (' + lote.ignoradas.length + ' linha(s) sem coordenada ou fora do Brasil).' : '.');
      limparLote(true);
      return;
    }
    rodarLote(true);
  }

  // Roda (ou roda de novo, quando um filtro muda) em fatias. Uma rodada nova
  // cancela a anterior pelo numero de geracao.
  function rodarLote(enquadrar) {
    if (!lote.pontos.length) return;
    var minha = ++lote.geracao;
    var pts = lote.pontos, ops = opsDoLote();
    var linhas = new Array(pts.length);
    var msg = $('#lote-msg');
    var k = 0;
    msg.className = 'msg';
    function fatia() {
      if (minha !== lote.geracao) return;
      var fim = Math.min(pts.length, k + FATIA_LOTE);
      for (; k < fim; k++) {
        var p = pts[k];
        var r = proximasDoPonto(p.lat, p.lon, ALCANCE_POR_OPERADORA_KM, 0).melhorOp;
        var geral = null;
        for (var a = 0; a < ops.length; a++) {
          var m = r[ops[a]];
          if (m && (!geral || m[1] < geral[1])) geral = [m[0], m[1], ops[a]];
        }
        linhas[k] = { ponto: p, porOp: r, geral: geral };
      }
      if (k < pts.length) {
        msg.textContent = 'Processando ' + fmt(k) + ' de ' + fmt(pts.length) + '...';
        setTimeout(fatia, 0);
        return;
      }
      lote.resultado = { linhas: linhas, ops: ops };
      mostrarResultadoLote();
      desenharLote(enquadrar);
    }
    fatia();
  }

  function mediana(v) {
    if (!v.length) return null;
    var s = v.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function mostrarResultadoLote() {
    var R = lote.resultado, n = R.linhas.length;
    var primeiro = {}, perto5 = {}, dists = {}, semNenhuma = 0;
    R.ops.forEach(function (o) { primeiro[o] = 0; perto5[o] = 0; dists[o] = []; });
    R.linhas.forEach(function (l) {
      if (!l.geral) semNenhuma++;
      else primeiro[l.geral[2]]++;
      R.ops.forEach(function (o) {
        var m = l.porOp[o];
        if (!m) return;
        dists[o].push(m[1]);
        if (m[1] <= 5) perto5[o]++;
      });
    });
    var ordem = R.ops.slice().sort(function (a, b) { return primeiro[b] - primeiro[a] || perto5[b] - perto5[a]; });
    var h = '<tr><td class="lote-cab">Operadora</td><td class="lote-cab num">1ª em</td>' +
      '<td class="lote-cab num">até 5 km</td><td class="lote-cab num">mediana</td></tr>';
    ordem.forEach(function (o) {
      var med = mediana(dists[o]);
      h += '<tr><td><span class="bolinha" style="display:inline-block;background:' + esc(corOp(o)) + '"></span> ' +
        esc(nomeOp(o)) + '</td><td class="num">' + fmt(primeiro[o]) + '</td><td class="num">' + fmt(perto5[o]) +
        '</td><td class="num">' + (med == null ? '—' : Geo.formatarDistancia(med)) + '</td></tr>';
    });
    $('#lote-resumo').innerHTML = h;

    var txt = fmt(n) + ' ponto(s) processado(s).';
    if (semNenhuma) txt += ' ' + fmt(semNenhuma) + ' sem nenhuma ERB em ' + ALCANCE_POR_OPERADORA_KM + ' km.';
    if (lote.ignoradas.length) {
      var amostra = lote.ignoradas.slice(0, 6).map(function (x) { return x.linha; }).join(', ');
      txt += ' ' + fmt(lote.ignoradas.length) + ' linha(s) ignorada(s) (' + amostra +
        (lote.ignoradas.length > 6 ? '...' : '') + '): sem coordenada, fora do Brasil ou acima de ' +
        fmt(LIMITE_LOTE) + ' pontos.';
    }
    var msg = $('#lote-msg');
    msg.className = 'msg ok';
    msg.textContent = txt;
    $('#lote-resultado').hidden = false;
  }

  function desenharLote(enquadrar) {
    if (lote.camada) { mapa.removeLayer(lote.camada); lote.camada = null; }
    var g = L.featureGroup();
    lote.pontos.forEach(function (p) {
      L.circleMarker([p.lat, p.lon], {
        radius: 5, weight: 2, color: '#0d1a2e', fillColor: '#F5B400', fillOpacity: 1
      }).bindTooltip(esc(p.id), { direction: 'top', offset: [0, -4] })
        .on('click', function (e) { L.DomEvent.stopPropagation(e); buscarPerto(p.lat, p.lon, false); })
        .addTo(g);
    });
    lote.camada = g.addTo(mapa);
    if (enquadrar && lote.pontos.length) voarParaArea(g.getBounds().pad(0.12), { maxZoom: 14 });
  }

  function limparLote(manterTexto) {
    lote.geracao++;
    lote.resultado = null;
    if (!manterTexto) { lote.pontos = []; lote.ignoradas = []; $('#lote-texto').value = ''; $('#lote-msg').textContent = ''; }
    if (lote.camada) { mapa.removeLayer(lote.camada); lote.camada = null; }
    $('#lote-resultado').hidden = true;
  }

  // CSV para o Excel em portugues: ";" separa, "," e a casa decimal, BOM no
  // comeco para o acento abrir certo. Texto que comeca com = + @ (ou - sem
  // ser numero) ganha um apostrofo: o Excel nao executa como formula.
  function celulaCsv(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+@]/.test(s) || (/^-/.test(s) && isNaN(+s.replace(',', '.')))) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function numCsv(x, casas) { return x == null ? '' : x.toFixed(casas).replace('.', ','); }

  function baixarCsvLote() {
    var R = lote.resultado;
    if (!R) return;
    var cab = ['id', 'latitude', 'longitude', 'mais_proxima', 'mais_proxima_km'];
    R.ops.forEach(function (o) {
      var n = nomeOp(o);
      cab.push(n + '_km', n + '_geracoes', n + '_erb');
    });
    var linhas = [cab.map(celulaCsv).join(';')];
    R.linhas.forEach(function (l) {
      var c = [l.ponto.id, numCsv(l.ponto.lat, 6), numCsv(l.ponto.lon, 6),
        l.geral ? nomeOp(l.geral[2]) : '', l.geral ? numCsv(l.geral[1], 3) : ''];
      R.ops.forEach(function (o) {
        var m = l.porOp[o];
        if (!m) { c.push('', '', ''); return; }
        var gers = [];
        for (var b = 0; b < ANT_GERACOES.length; b++) if (D.ger[m[0]] & (1 << b)) gers.push(ANT_GERACOES[b]);
        c.push(numCsv(m[1], 3), gers.join(' '), D.numero[m[0]]);
      });
      linhas.push(c.map(celulaCsv).join(';'));
    });
    var blob = new Blob(['﻿' + linhas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    var hoje = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'lote_antenas_' + hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' +
      String(hoje.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function ligarLote() {
    $('#lote-processar').addEventListener('click', processarLote);
    $('#lote-limpar').addEventListener('click', function () { limparLote(false); });
    $('#lote-baixar').addEventListener('click', baixarCsvLote);
    $('#lote-arquivo').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        var txt = String(leitor.result || '');
        // Planilha salva como CSV pelo Excel em portugues vem em Windows-1252:
        // o caractere de substituicao denuncia, e o arquivo e relido assim.
        if (txt.indexOf('�') >= 0) {
          var outro = new FileReader();
          outro.onload = function () { $('#lote-texto').value = String(outro.result || ''); processarLote(); };
          outro.readAsText(f, 'windows-1252');
          return;
        }
        $('#lote-texto').value = txt;
        processarLote();
      };
      leitor.readAsText(f, 'utf-8');
      this.value = '';
    });
  }

  // -------------------------------------------------------- 9. O RESUMO

  var opPresente = [];

  function renderizarResumo() {
    var total = 0;
    var porOp = new Uint32Array(ANT_OPERADORAS.length);
    var porGer = new Uint32Array(ANT_GERACOES.length);
    for (var i = 0; i < D.n; i++) {
      if (!visivel(i)) continue;
      total++;
      porOp[D.op[i]]++;
      for (var k = 0; k < ANT_GERACOES.length; k++) if (D.ger[i] & (1 << k)) porGer[k]++;
    }
    function barra(rotulo, n, cor) {
      var pct = total ? (n * 100 / total) : 0;
      return '<div class="barra-linha"><span class="barra-rotulo"><span class="bolinha" style="background:' +
        esc(cor) + '"></span>' + esc(rotulo) + '</span><span class="barra-trilho"><span class="barra-cheia" ' +
        'style="width:' + pct.toFixed(1) + '%;background:' + esc(cor) + '"></span></span>' +
        '<span class="barra-num">' + fmt(n) + '</span></div>';
    }
    var h = '<div class="resumo-total"><b id="resumo-numero" style="font-weight:inherit">' + fmt(total) +
      '</b> <span>ERBs no filtro' + (estado.uf >= 0 ? ' (' + esc(UFS[estado.uf]) + ')' : '') + '</span></div>';
    h += '<div class="resumo-bloco"><h3>Por operadora</h3>';
    for (var o = 0; o < ANT_OPERADORAS.length; o++) if (porOp[o]) h += barra(nomeOp(o), porOp[o], corOp(o));
    h += '</div><div class="resumo-bloco"><h3>Com a geracao</h3>';
    for (var g = 0; g < ANT_GERACOES.length; g++) {
      if (porGer[g]) h += barra(ANT_GERACOES[g], porGer[g], CORES_GER[ANT_GERACOES[g]]);
    }
    h += '<div class="nota">Uma ERB com 2G, 3G e 4G conta nas tres barras.</div></div>';
    $('#resumo').innerHTML = h;
    contar($('#resumo-numero'), ultimoTotal, total);
    ultimoTotal = total;
  }

  // O total do resumo corre do valor anterior ate o novo, em vez de trocar
  // seco: o olho ve quanto o filtro tirou ou pos.
  var ultimoTotal = 0;
  function contar(el, de, para) {
    if (!el || MENOS_MOVIMENTO || de === para) { if (el) el.textContent = fmt(para); return; }
    var t0 = performance.now(), dur = 650;
    function passo(agora) {
      var f = Math.min(1, (agora - t0) / dur);
      var suave = 1 - Math.pow(1 - f, 3);
      el.textContent = fmt(Math.round(de + (para - de) * suave));
      if (f < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }

  // -------------------------------------------------------- 10. INTERFACE

  function aoMudarFiltro() {
    camadaAntenas.redesenhar();
    renderizarResumo();
    renderizarPerto();
    // O lote respeita os filtros: muda o filtro, a resposta acompanha.
    if (lote.resultado) rodarLote(false);
    agendarLink();
  }

  function montarFiltroOperadoras() {
    var quantos = new Uint32Array(ANT_OPERADORAS.length);
    for (var k = 0; k < D.n; k++) quantos[D.op[k]]++;
    var h = '';
    for (var i = 0; i < ANT_OPERADORAS.length; i++) {
      // Toda categoria comeca ligada, inclusive as vazias: uma operadora que
      // entrar numa base futura nao pode nascer invisivel.
      estado.operadoras[i] = true;
      opPresente[i] = quantos[i] > 0;
      if (!quantos[i]) continue;
      h += '<label class="chip"><input type="checkbox" data-op="' + i + '" checked>' +
        '<span class="bolinha" style="background:' + esc(corOp(i)) + '"></span>' +
        esc(nomeOp(i)) + ' <span class="n">' + fmt(quantos[i]) + '</span></label>';
    }
    var alvo = $('#filtro-operadoras');
    alvo.innerHTML = h;
    alvo.querySelectorAll('input[data-op]').forEach(function (cx) {
      cx.addEventListener('change', function () {
        estado.operadoras[+cx.dataset.op] = cx.checked;
        aoMudarFiltro();
      });
    });
  }

  function montarFiltroGeracoes() {
    var h = '';
    ANT_GERACOES.forEach(function (g, k) {
      h += '<label class="chip"><input type="checkbox" data-ger="' + k + '" checked>' +
        '<span class="bolinha" style="background:' + CORES_GER[g] + '"></span>' + g + '</label>';
    });
    var alvo = $('#filtro-geracoes');
    alvo.innerHTML = h;
    alvo.querySelectorAll('input[data-ger]').forEach(function (cx) {
      cx.addEventListener('change', function () {
        var bit = 1 << +cx.dataset.ger;
        estado.geracoes = cx.checked ? (estado.geracoes | bit) : (estado.geracoes & ~bit);
        aoMudarFiltro();
      });
    });
  }

  function montarFiltroUf() {
    var quantos = new Uint32Array(UFS.length);
    for (var i = 0; i < D.n; i++) quantos[D.uf[i]]++;
    var ordem = UFS.map(function (u, k) { return k; })
      .sort(function (a, b) { return UFS[a].localeCompare(UFS[b]); });
    var h = '<option value="-1">Brasil inteiro (' + fmt(D.n) + ')</option>';
    ordem.forEach(function (k) {
      h += '<option value="' + k + '">' + esc(UFS[k]) + ' (' + fmt(quantos[k]) + ')</option>';
    });
    var sel = $('#filtro-uf');
    sel.innerHTML = h;
    sel.addEventListener('change', function () {
      estado.uf = +sel.value;
      aoMudarFiltro();
      var b = null;
      for (var i = 0; i < D.n; i++) {
        if (estado.uf >= 0 && D.uf[i] !== estado.uf) continue;
        if (!b) b = L.latLngBounds([D.lat[i], D.lon[i]], [D.lat[i], D.lon[i]]);
        else b.extend([D.lat[i], D.lon[i]]);
      }
      if (b) voarParaArea(b.pad(0.05));
    });
  }

  function montarSeletorBase() {
    var alvo = $('#seletor-base');
    var h = '';
    Object.keys(BASES).forEach(function (id) {
      h += '<button type="button" class="chip-botao" data-base="' + esc(id) +
        '" aria-pressed="false">' + esc(BASES[id].nome) + '</button>';
    });
    alvo.innerHTML = h;
    alvo.querySelectorAll('[data-base]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.base === estado.base) return;
        estado.base = b.dataset.base;
        aplicarBase();
        agendarLink();
      });
    });
  }

  function montarSeletorCobertura() {
    var alvo = $('#cobertura-operadoras');
    var h = '<label class="chip"><input type="radio" name="cob" value="" checked>Nenhuma</label>';
    Cobertura.FONTES.forEach(function (f) {
      h += '<label class="chip"><input type="radio" name="cob" value="' + esc(f.id) + '">' + esc(f.nome) + '</label>';
    });
    alvo.innerHTML = h;
    alvo.querySelectorAll('input[name=cob]').forEach(function (r) {
      r.addEventListener('change', function () {
        estado.cobertura = r.value || null;
        estado.coberturaCamada = null;
        montarCamadasDaCobertura();
        aplicarCobertura();
      });
    });
  }

  function montarCamadasDaCobertura() {
    var sel = $('#cobertura-camada');
    var caixa = $('#cobertura-detalhe');
    if (!estado.cobertura) { caixa.hidden = true; sel.innerHTML = ''; return; }
    var f = Cobertura.fonte(estado.cobertura);
    var h = '';
    (f.camadas || []).forEach(function (c) {
      h += '<option value="' + esc(c.id) + '"' + (c.padrao ? ' selected' : '') + '>' + esc(c.rotulo) + '</option>';
    });
    sel.innerHTML = h;
    caixa.hidden = false;
    sel.onchange = function () { estado.coberturaCamada = sel.value; aplicarCobertura(); };
  }

  function renderizarLegendaModo() {
    var h = '';
    if (estado.modoCor === 'geracao') {
      ANT_GERACOES.forEach(function (g) {
        h += '<div class="legenda-item"><span class="quadro" style="background:' + CORES_GER[g] +
          '"></span>' + g + (g === '5G' ? '' : ' (sem geracao acima)') + '</div>';
      });
      h += '<div class="legenda-item"><span class="quadro" style="background:' + CORES_GER.sem +
        '"></span>Geracao nao informada</div>' +
        '<div class="nota">A cor e a geracao MAIS ALTA da ERB. Uma torre 4G quase sempre tem ' +
        '2G/3G juntos: abra a ficha para ver todas.</div>';
    }
    $('#legenda-modo').innerHTML = h;
  }

  function aplicarTema(t) {
    estado.tema = t;
    document.documentElement.dataset.tema = t;
    if (camadaBase) aplicarBase();
    if (camadaAntenas) camadaAntenas.redesenhar();
  }

  function ligarInterface() {
    $('#buscar').addEventListener('click', executarBusca);
    document.querySelectorAll('#exemplos .exemplo').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#entrada').value = b.getAttribute('data-q');
        executarBusca();
      });
    });
    if (navigator.geolocation) {
      $('#usar-local').hidden = false;
      $('#usar-local').addEventListener('click', usarMinhaLocalizacao);
    }
    $('#entrada').addEventListener('keydown', function (e) { if (e.key === 'Enter') executarBusca(); });
    $('#limpar').addEventListener('click', function () {
      buscaAtual++; // resposta de CEP/endereco ainda a caminho e descartada
      $('#entrada').value = '';
      aviso('');
      $('#lista').hidden = true;
      fecharFicha();
      fecharPerto();
    });

    document.querySelectorAll('input[name=modo]').forEach(function (r) {
      r.addEventListener('change', function () {
        estado.modoCor = r.value;
        agendarLink();
        camadaAntenas.redesenhar();
        renderizarLegendaModo();
      });
    });

    $('#raio').addEventListener('input', function () {
      estado.raioKm = +this.value;
      agendarLink();
      $('#raio-valor').textContent = this.value + ' km';
      desenharRaio();
      renderizarPerto(true);
    });
    $('#perto-fechar').addEventListener('click', fecharPerto);
    $('#perto-endereco').addEventListener('click', enderecoDoPino);
    $('#copiar-link').addEventListener('click', copiarLink);
    $('#compartilhar').addEventListener('click', compartilhar);
    window.addEventListener('offline', function () {
      aviso('Sem internet: as antenas continuam no mapa. Busca por CEP/endereço, mapa de fundo e cobertura precisam de conexão.', '');
    });
    window.addEventListener('online', function () { aviso('Conexão restabelecida.', 'ok'); });

    $('#cobertura-opacidade').addEventListener('input', function () {
      estado.opacidade = +this.value / 100;
      $('#cobertura-opacidade-valor').textContent = this.value + '%';
      if (camadaCobertura && camadaCobertura.setOpacity) camadaCobertura.setOpacity(estado.opacidade);
    });

    $('#tema').addEventListener('click', function () {
      var novo = estado.tema === 'claro' ? 'escuro' : 'claro';
      aplicarTema(novo);
      salvarTema(novo);
    });

    $('#alternar-painel').addEventListener('click', function () {
      document.body.classList.toggle('painel-aberto');
      setTimeout(function () { mapa.invalidateSize(); }, 210);
    });
    $('#recolher-painel').addEventListener('click', alternarPainelLateral);
  }

  // ------------------------------------------- 10a. MENU LATERAL RECOLHIVEL
  // O botao do cabecalho esconde o painel para o mapa ocupar a tela toda (no
  // computador; no celular o painel ja abre fechado, com o botao Filtros).
  // Enquanto desliza, o painel flutua por cima do mapa e so o transform anima.
  // O mapa muda de tamanho de uma vez: ao recolher, logo no clique (o painel
  // ainda cobre a faixa nova); ao abrir, so no fim (o painel ja cobre a faixa
  // que sai). Nos dois casos ajustarMapaAoPalco desloca o mapa pelo quanto a
  // borda andou, e cada lugar fica no mesmo ponto da tela, sem pulo.
  // A busca por ponto com o painel recolhido nao o abre: o pino, o raio e os
  // feixes ja respondem no mapa, e quem recolheu pediu o mapa inteiro.
  var DURACAO_PAINEL_MS = 300; // o mesmo .3s do #painel no modelo.html
  var timerPainel = null;

  function alternarPainelLateral() {
    var corpo = document.body;
    var palco = $('#palco');
    var recolher = !corpo.classList.contains('painel-recolhido');
    clearTimeout(timerPainel);
    if (recolher) {
      var antes = palco.getBoundingClientRect().left;
      corpo.classList.remove('painel-abrindo');
      corpo.classList.add('painel-recolhido');
      ajustarMapaAoPalco(antes);
    } else {
      corpo.classList.add('painel-abrindo');
      corpo.classList.remove('painel-recolhido');
      timerPainel = setTimeout(function () {
        var noFim = palco.getBoundingClientRect().left;
        corpo.classList.remove('painel-abrindo');
        ajustarMapaAoPalco(noFim);
      }, MENOS_MOVIMENTO ? 0 : DURACAO_PAINEL_MS);
    }
    var b = $('#recolher-painel');
    var rotulo = recolher ? 'Mostrar o menu lateral' : 'Esconder o menu lateral';
    b.setAttribute('aria-expanded', String(!recolher));
    b.setAttribute('aria-label', rotulo);
    b.title = recolher ? rotulo : rotulo + ' (mapa em tela cheia)';
  }

  // A borda esquerda do mapa andou d px: sem correcao, o desenho andaria junto.
  // panBy(d) desloca o desenho -d e devolve cada lugar ao ponto da tela.
  function ajustarMapaAoPalco(esquerdaAntes) {
    var d = Math.round($('#palco').getBoundingClientRect().left - esquerdaAntes);
    mapa.invalidateSize({ pan: false });
    if (d) mapa.panBy([d, 0], { animate: false });
  }

  // ------------------------------------------- 10b. LINK DA VISTA (M12)
  // O endereco guarda a vista: #z=13&c=-27.59,-48.55&p=...&r=5&off=algar&g=2
  // &uf=SC&cor=geracao&base=ruas. Abrir o mesmo link em qualquer copia do mapa
  // (ABRIR_MAPA.bat) volta a mesma regiao, ponto e filtros. O tema nao vai:
  // e preferencia de quem abre. Os pontos do lote tambem nao: nao saem do
  // navegador (ver 8b).
  var timerLink = null;
  function agendarLink() {
    if (!mapa) return;
    clearTimeout(timerLink);
    timerLink = setTimeout(escreverLink, 350);
  }

  function montarLink() {
    var c = mapa.getCenter();
    var partes = ['z=' + (Math.round(mapa.getZoom() * 2) / 2), 'c=' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5)];
    if (estado.ponto) {
      partes.push('p=' + estado.ponto.lat.toFixed(5) + ',' + estado.ponto.lon.toFixed(5));
      partes.push('r=' + estado.raioKm);
    }
    var off = [];
    for (var k = 0; k < ANT_OPERADORAS.length; k++) if (opPresente[k] && !estado.operadoras[k]) off.push(ANT_OPERADORAS[k]);
    if (off.length) partes.push('off=' + off.join(','));
    if (estado.geracoes !== 15) partes.push('g=' + estado.geracoes);
    if (estado.uf >= 0) partes.push('uf=' + UFS[estado.uf]);
    if (estado.modoCor !== 'operadora') partes.push('cor=' + estado.modoCor);
    if (estado.base !== 'mapa') partes.push('base=' + estado.base);
    return '#' + partes.join('&');
  }

  function escreverLink() {
    try { location.replace(montarLink()); } catch (e) { /* sem endereco gravavel: segue sem link */ }
  }

  function lerLink() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var o = {};
    h.split('&').forEach(function (par) {
      var i = par.indexOf('=');
      if (i > 0) o[decodeURIComponent(par.slice(0, i))] = decodeURIComponent(par.slice(i + 1));
    });
    function coord(s) {
      var m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s || '');
      return m && Geo.dentroDoBrasil(+m[1], +m[2]) ? [+m[1], +m[2]] : null;
    }
    var link = {
      z: isFinite(+o.z) ? Math.min(19, Math.max(3, +o.z)) : null,
      c: coord(o.c), p: coord(o.p),
      r: isFinite(+o.r) ? Math.min(30, Math.max(1, Math.round(+o.r))) : null,
      off: o.off ? o.off.split(',') : [],
      g: isFinite(+o.g) && +o.g >= 1 && +o.g <= 15 ? +o.g : 15,
      uf: o.uf || '', cor: o.cor === 'geracao' ? 'geracao' : 'operadora',
      base: BASES[o.base] ? o.base : 'mapa'
    };
    return (link.c && link.z != null) ? link : null;
  }

  // Aplica o link nos controles (e nao so no estado), para a tela mostrar o
  // que esta valendo.
  function aplicarLink(link) {
    document.querySelectorAll('input[data-op]').forEach(function (cx) {
      var k = +cx.dataset.op;
      cx.checked = link.off.indexOf(ANT_OPERADORAS[k]) < 0;
      estado.operadoras[k] = cx.checked;
    });
    estado.geracoes = link.g;
    document.querySelectorAll('input[data-ger]').forEach(function (cx) {
      cx.checked = !!(link.g & (1 << +cx.dataset.ger));
    });
    var iUf = UFS.indexOf(link.uf);
    estado.uf = iUf;
    $('#filtro-uf').value = String(iUf);
    estado.modoCor = link.cor;
    document.querySelectorAll('input[name=modo]').forEach(function (r) { r.checked = r.value === link.cor; });
    renderizarLegendaModo();
    if (link.base !== estado.base) { estado.base = link.base; aplicarBase(); }
    mapa.setView(link.c, link.z, { animate: false });
    if (link.r) {
      estado.raioKm = link.r;
      $('#raio').value = link.r;
      $('#raio-valor').textContent = link.r + ' km';
    }
    renderizarResumo();
    camadaAntenas.redesenhar();
    if (link.p) buscarPerto(link.p[0], link.p[1], false);
  }

  function copiarLink() {
    escreverLink();
    var url = location.href, botao = $('#copiar-link');
    function avisar(t) {
      botao.textContent = t;
      setTimeout(function () { botao.textContent = 'Copiar link'; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { avisar('Link copiado'); },
        function () { window.prompt('Copie o link da vista:', url); });
    } else {
      window.prompt('Copie o link da vista:', url);
    }
  }

  // Compartilhar: no celular abre a folha de compartilhamento do aparelho; no
  // computador abre o WhatsApp Web. So sai o que o usuario decide enviar: o
  // link da vista (com o ponto marcado, se houver) e uma frase-resumo.
  function compartilhar() {
    escreverLink();
    var url = location.href, R = estado.respostaRapida, texto;
    if (estado.ponto && R) {
      var gs = [];
      for (var b = 0; b < ANT_GERACOES.length; b++) if (D.ger[R.i] & (1 << b)) gs.push(ANT_GERACOES[b]);
      texto = 'Antena mais próxima do ponto: ' + nomeOp(R.op) + ', a ' + Geo.formatarDistancia(R.km) +
        (gs.length ? ' (' + gs.join('/') + ')' : '') + '. Veja no mapa:';
    } else {
      texto = 'Mapa de Antenas Anatel: antenas de celular licenciadas, por operadora. Veja:';
    }
    if (navigator.share) {
      navigator.share({ title: 'Mapa de Antenas Anatel', text: texto, url: url }).catch(function () { /* cancelado */ });
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(texto + ' ' + url), '_blank', 'noopener');
    }
  }

  // ------------------------------------------------------------ 11. INICIO

  function falhaDeDados(motivo) {
    tirarAbertura();
    document.body.innerHTML =
      '<div style="padding:40px;font:16px/1.6 system-ui;color:var(--erro)">' +
      '<h1>O mapa nao conseguiu abrir</h1><p>' + esc(motivo) + '</p>' +
      '<p>Gere o arquivo de novo com a opcao 2 do INICIAR.bat.</p></div>';
  }

  // "16/10/2026 07:54" -> dias ate hoje. O arquivo circula: quem recebe o
  // mapa precisa ver que a base envelheceu (M07, 10/11/2026).
  var DIAS_BASE_VELHA = 15;
  function mostrarIdadeDaBase() {
    var el = $('#idade-base');
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(ANT_ORIGEM.data_anatel || '');
    if (!el) return;
    if (!m) { el.textContent = 'Base sem data'; el.classList.add('velha'); return; }
    var base = new Date(+m[3], +m[2] - 1, +m[1]);
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var dias = Math.max(0, Math.round((hoje - base) / 86400000));
    el.textContent = 'Base ' + m[1] + '/' + m[2] + '/' + m[3] + ' · ' +
      (dias === 0 ? 'de hoje' : dias === 1 ? 'de ontem' : 'há ' + dias + ' dias');
    el.classList.toggle('velha', dias > DIAS_BASE_VELHA);
    if (dias > DIAS_BASE_VELHA) {
      el.title = 'A Anatel atualiza a base todo dia. Gere o mapa de novo (INICIAR.bat, opcao 3).';
    }
  }

  function tirarAbertura() {
    var b = $('#boot');
    if (!b) return;
    b.classList.add('saindo');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 700);
  }

  // Le os dados DEPOIS de a tela de abertura ser pintada: a leitura das 114
  // mil linhas trava a pagina por algumas centenas de ms.
  function iniciar() {
    requestAnimationFrame(function () {
      setTimeout(function () {
        // Uma falha aqui nao pode deixar a tela de abertura girando para sempre.
        try { iniciarDeVerdade(); }
        catch (e) { falhaDeDados('Erro ao montar o mapa: ' + (e && e.message ? e.message : e)); }
      }, 0);
    });
  }

  function iniciarDeVerdade() {
    if (typeof ANT_TXT !== 'string' || !ANT_TXT) {
      falhaDeDados('Os dados das antenas nao foram embutidos no arquivo.');
      return;
    }
    var t0 = performance.now();
    aplicarTema(lerTemaSalvo() || 'escuro');
    D = carregarDados();
    criarMapa();
    montarFiltroOperadoras();
    montarFiltroGeracoes();
    montarFiltroUf();
    montarSeletorBase();
    montarSeletorCobertura();
    ligarInterface();
    ligarLote();
    renderizarResumo();
    renderizarLegendaModo();
    // O primeiro desenho (no addTo) roda antes de os filtros existirem e sai
    // vazio: redesenha agora que as operadoras estao ligadas.
    camadaAntenas.redesenhar();
    mostrarIdadeDaBase();
    tirarAbertura();
    // Aberto por um link de vista: vai direto para ela, sem o voo de abertura.
    var link = lerLink();
    if (link) aplicarLink(link);
    mapa.on('moveend', agendarLink);
    if (!link && !MENOS_MOVIMENTO) {
      // O Brasil inteiro aparece por um instante e o mapa voa ate a vista inicial.
      timerAbertura = setTimeout(function () {
        timerAbertura = null;
        mapa.flyTo(VISTA_INICIAL.centro, VISTA_INICIAL.zoom, { duration: 2.1 });
      }, 650);
      mapa.once('mousedown contextmenu', cancelarAbertura);
      mapa.getContainer().addEventListener('wheel', cancelarAbertura, { once: true, passive: true });
    }

    $('#base-info').textContent = ANT_ORIGEM.data_anatel || 'sem data';
    $('#total-info').textContent = fmt(D.n);
    if (ANT_ORIGEM.url) {
      $('#fonte-url').innerHTML = '<br>Fonte: <a href="' + esc(ANT_ORIGEM.url) +
        '" target="_blank" rel="noopener">Anatel &mdash; Estacoes do SMP</a>';
    }
    if (ANT_FORA) {
      $('#aviso-fora').textContent = ANT_FORA + ' ERB(s) ficaram de fora por nao ter coordenada valida ' +
        '(listadas no RELATORIO_GERACAO.txt e na planilha).';
      $('#aviso-fora').hidden = false;
    }
    $('#tempo').textContent = Math.round(performance.now() - t0) + ' ms';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
