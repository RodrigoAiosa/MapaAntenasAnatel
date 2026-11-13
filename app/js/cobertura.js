// MANCHA DE COBERTURA DAS OPERADORAS - registro unico de fontes.
//
// As antenas dizem onde esta a TORRE. A mancha diz onde a operadora afirma que
// chega SINAL. Sao respostas diferentes para a mesma pergunta: uma torre a 2 km
// com um morro no meio nao cobre, e uma a 8 km em campo aberto cobre.
//
// Os tres servidores falam PROTOCOLOS DIFERENTES:
//
//   Vivo  = WMS               -> o bbox vai nos parametros do WMS
//   TIM   = ArcGIS export     -> bbox + tamanho, imagem gerada sob demanda
//   Claro = ArcGIS tile cache -> tile pronto em /tile/{z}/{y}/{x}
//
// Por isso este arquivo e um REGISTRO, e nao tres blocos parecidos: cada
// operadora declara o seu tipo e os seus parametros, e existe UMA funcao por
// tipo que monta a camada no Leaflet. Trocar um endereco e mexer numa linha.
//
// Nada aqui depende de fetch, XHR ou modulo ES: o app roda em file:// e cada
// tile entra como imagem comum, que o navegador busca sem esbarrar em CORS.
// Nenhum dos tres endpoints pede token, chave ou cabecalho de origem.

(function (raiz) {
  'use strict';

  // Meia-largura do mundo em EPSG:3857, em metros. O Web Mercator e um quadrado
  // de -BORDA a +BORDA nos dois eixos - e dai que sai o bbox de cada tile.
  var BORDA_3857 = 20037508.342789244;

  var TAMANHO_TILE = 256;

  // Abaixo deste zoom a mancha nao informa nada: o pais inteiro vira uma chapa
  // de tinta e cada quadro pediria dezenas de imagens ao servidor da operadora.
  var ZOOM_MINIMO = 7;

  // Teto do mapa (o proprio app vai ate 19). Precisa ser declarado: o padrao de
  // L.TileLayer e 18, e sem isto a mancha SUMIRIA no zoom 19 - o mais util de
  // todos, que e quando se olha um endereco.
  var ZOOM_MAXIMO = 19;

  // Tolerancia da deteccao de agua, em distancia RGB.
  //
  // Precisa ser APERTADA: no mapa escuro a agua e rgb(38,38,38) e a terra mais
  // proxima e rgb(16,16,16) - 38 de distancia. Uma tolerancia larga comeria a
  // terra junto e a mancha sumiria da cidade inteira. Os tiles do mapa base sao
  // PNG de paleta, com preenchimento chapado, entao nao e preciso folga: o tom
  // chega exato.
  var TOLERANCIA_AGUA = 14;

  // --------------------------------------------------------------- GEOMETRIA

  // Retangulo do tile {x,y,z} em EPSG:3857, na ordem que WMS 1.1.1 e ArcGIS
  // esperam: minX, minY, maxX, maxY.
  //
  // O eixo Y do esquema de tiles cresce para BAIXO (y=0 e o topo do mundo) e o
  // do Mercator cresce para CIMA. Inverter isso espelha o mapa no equador sem
  // dar erro nenhum - a imagem chega, so mostra o lugar errado.
  function bboxDoTile(x, y, z) {
    var lado = (2 * BORDA_3857) / Math.pow(2, z);
    var minX = -BORDA_3857 + x * lado;
    var maxY = BORDA_3857 - y * lado;
    return [minX, maxY - lado, minX + lado, maxY];
  }

  // ---------------------------------------------------- MONTAGEM DAS URLs
  // Funcoes puras, sem Leaflet: sao elas que os testes conferem, e sao elas
  // que as camadas chamam de verdade. Testar uma copia nao guardaria nada.

  function urlTileArcgis(fonte, camada, coords) {
    // ARMADILHA: o ArcGIS serve /tile/{z}/{y}/{x} - LINHA antes de COLUNA. O
    // padrao XYZ que quase todo mundo escreve de cabeca e {z}/{x}/{y}. Trocar
    // os dois NAO da erro: as imagens chegam normalmente, do lugar errado, e o
    // mapa parece apenas "deslocado".
    return fonte.servidor + '/' + camada.servico + '/MapServer/tile/' +
           coords.z + '/' + coords.y + '/' + coords.x;
  }

  function urlExportArcgis(fonte, camada, coords, tamanho) {
    var bb = bboxDoTile(coords.x, coords.y, coords.z);
    // 102100 e o codigo ESRI para o EPSG:3857 - mesmo sistema, nome diferente.
    // bboxSR e imageSR tem que ser o MESMO, senao o servidor reprojeta e a
    // imagem volta esticada.
    return fonte.servidor + '/' + camada.servico + '/MapServer/export' +
      '?bbox=' + bb.join(',') +
      '&bboxSR=102100&imageSR=102100' +
      '&size=' + tamanho + ',' + tamanho +
      '&format=png32&transparent=true' +
      '&layers=show:' + (camada.subcamadas || '0,1') +
      '&f=image';
  }

  // O Leaflet monta a URL do WMS sozinho (bbox, width, height e srs saem do
  // proprio mapa); daqui saem so os parametros que sao da camada.
  function parametrosWms(fonte, camada) {
    return {
      layers: camada.servico,
      format: 'image/png',
      transparent: true,
      styles: ''
    };
  }

  // ------------------------------------------------- RECORTE NA LINHA D'AGUA
  //
  // As operadoras publicam cobertura sobre o MAR - e verdade, sinal se propaga
  // muito bem sobre agua. Mas na tela isso vira tinta boiando no oceano, sem
  // borda, e o mapa fica sujo: a mancha nao termina em lugar nenhum.
  //
  // O recorte usa o PROPRIO MAPA BASE como molde. Para cada tile de mancha,
  // le-se o tile de mapa da MESMA posicao z/x/y (os dois usam o mesmo esquema de
  // tiles, entao encaixam pixel a pixel), marcam-se os pixels da cor da agua e a
  // mancha e apagada exatamente ali.
  //
  // Por que assim, e nao com um contorno do litoral guardado no arquivo: um
  // contorno do Brasil inteiro com precisao de praia teria varios MB - num app
  // que precisa caber num anexo de e-mail - e ainda assim cortaria no lugar
  // errado, porque seria um litoral DIFERENTE do que esta desenhado na tela.
  // Usando o mapa como molde, o corte cai exatamente na costa que a pessoa ve,
  // e acompanha de graca a troca de mapa base e de tema.

  // Um pixel e agua se estiver perto o bastante da cor de agua daquele mapa.
  // Comparacao em distancia ao quadrado para nao pagar raiz quadrada 65 mil
  // vezes por tile.
  function ehAgua(r, g, b, cor, tolerancia) {
    var dr = r - cor[0], dg = g - cor[1], db = b - cor[2];
    var t = (tolerancia == null ? TOLERANCIA_AGUA : tolerancia);
    return dr * dr + dg * dg + db * db <= t * t;
  }

  // Recebe os pixels do tile de MAPA e devolve os pixels de uma mascara: opaca
  // onde ha terra, transparente onde ha agua. E ela que, aplicada por
  // 'destination-in', apaga a mancha em cima do mar.
  //
  // O RGB da mascara e branco so porque precisa ser alguma coisa - o que importa
  // e o canal alfa.
  function mascaraDeAgua(pixels, cor, tolerancia) {
    var n = pixels.length;
    var saida = new Uint8ClampedArray(n);
    for (var i = 0; i < n; i += 4) {
      saida[i] = 255; saida[i + 1] = 255; saida[i + 2] = 255;
      saida[i + 3] = ehAgua(pixels[i], pixels[i + 1], pixels[i + 2], cor, tolerancia) ? 0 : 255;
    }
    return saida;
  }

  // ------------------------------------------------------------- AS FONTES
  //
  // CADA OPERADORA MODELA A REALIDADE DE UM JEITO, e as tres nao tem escala
  // comum. Inventar uma ("sinal fraco/medio/forte" para todo mundo) seria
  // fabricar informacao que o dado nao tem. Por isso a legenda e declarada
  // junto de cada camada, com as cores LIDAS das legendas oficiais:
  //
  //   Claro  -> classes de QUALIDADE (que aparelho o sinal sustenta)
  //   TIM    -> area ABERTA x FECHADA, e servicos proprios para o RURAL
  //   Vivo   -> area ABERTA x FECHADA, nos dois tons da mesma mancha
  //
  // As cores nao sao escolha de design: sao as que o servidor devolve. Mudar
  // uma aqui faz a legenda mentir sobre o que esta desenhado no mapa.

  var ABERTA = 'Area aberta — ao ar livre';
  var FECHADA = 'Area fechada — dentro do imovel';

  // A Vivo publica cada tecnologia como UMA camada com dois tons, e os dois
  // tons sao exatamente as duas camadas por estacao-base (conferido na legenda
  // oficial: GetLegendGraphic de COBERTURA_4G rotula as tarjas como
  // PREDCOB_LTE_1BS e PREDCOB_LTE_1BS_indoor).
  function legendaVivo(corAberta, corFechada) {
    return [
      { cor: corAberta, rotulo: ABERTA },
      { cor: corFechada, rotulo: FECHADA }
    ];
  }

  // Claro 3G e 4G: a classificacao por aparelho, que e a informacao mais util
  // do conjunto todo para este projeto.
  var LEGENDA_CLARO_QUALIDADE = [
    { cor: '#396b14', rotulo: 'Boa p/ roteador, modem, tablet, smartphone' },
    { cor: '#eaed18', rotulo: 'Boa p/ modem, tablet, smartphone' },
    { cor: '#ea1541', rotulo: 'Boa p/ smartphone' }
  ];

  // TIM: o servidor devolve as duas subcamadas na mesma imagem, uma por cima da
  // outra. Onde as duas se sobrepoem o tom fica intermediario - por isso a
  // legenda tem tres tarjas e nao duas.
  var LEGENDA_TIM_ABERTA_FECHADA = [
    { cor: '#89d7ff', rotulo: 'Area aberta' },
    { cor: '#002672', rotulo: 'Area fechada' },
    { cor: '#3c74b0', rotulo: 'As duas' }
  ];

  var FONTES = [
    // ------------------------------------------------------------- CLARO
    {
      id: 'claro',
      nome: 'Claro',
      tipo: 'arcgis-tile',
      // Onde nao ha cobertura o tile da Claro volta com erro (500). Por isso,
      // na Claro, nenhum tile na vista nao prova que o servidor caiu.
      ausenteFalha: true,
      servidor: 'https://cobertura.claro.com.br/arcgis/mapserver',
      atribuicao: 'Cobertura &copy; Claro',
      // Tile cacheado (singleFusedMapCache), zoom 0 a 23, EPSG:3857. E o mais
      // eficiente dos tres formatos: a imagem ja existe pronta no servidor.
      modelo: 'A Claro informa a QUALIDADE do sinal, nao so coberto/descoberto.',
      camadas: [
        { id: '4g', rotulo: '4G — dados', grupo: 'Rede', servico: 'Claro_4G_prd',
          padrao: true, legenda: LEGENDA_CLARO_QUALIDADE },
        { id: '3g', rotulo: '3G — voz', grupo: 'Rede', servico: 'Claro_3G_prd',
          legenda: LEGENDA_CLARO_QUALIDADE },
        { id: '2g', rotulo: '2G', grupo: 'Rede', servico: 'Claro_2G_prd',
          legenda: [
            { cor: '#396b14', rotulo: 'Excelente' },
            { cor: '#eaed18', rotulo: 'Bom' },
            { cor: '#ea1541', rotulo: 'Regular' }
          ] },
        { id: '5g', rotulo: '5G', grupo: 'Rede', servico: 'Claro_5G_prd',
          legenda: [{ cor: '#396b14', rotulo: 'Cobertura' }] },
        { id: '5g-sa', rotulo: '5G SA', grupo: 'Rede', servico: 'Claro_5G_SA_prd',
          legenda: [
            { cor: '#396b14', rotulo: 'Bom p/ smartphone e tablet' },
            { cor: '#eaed18', rotulo: 'Bom p/ smartphone, tablet e internet movel' }
          ] },
        { id: '3g-rural', rotulo: '3G rural', grupo: 'Fora da cidade',
          servico: 'Claro_3G_Rural_prd',
          legenda: [{ cor: '#396b14', rotulo: 'Cobertura rural' }],
          nota: 'Camada so de area rural: sobre a cidade ela vem vazia, e isso ' +
                'nao e falha do servico.' }
      ],
      // O RECADO QUE IMPORTA PARA ESTE PROJETO.
      //
      // Equipamento com chip (alarme, rastreador, maquininha) esta muito mais perto de
      // um MODEM do que de um smartphone. Uma area classificada apenas como "boa
      // p/ smartphone" pode nao sustentar o equipamento, e achatar as tres
      // classes num "tem sinal" apagaria justamente essa diferenca.
      recado: 'Equipamento com chip (alarme, rastreador, maquininha) comporta-se ' +
              'como MODEM, nao como celular. Onde a Claro so garante smartphone, ' +
              'ele pode nao se sustentar.'
    },

    // --------------------------------------------------------------- TIM
    {
      id: 'tim',
      nome: 'TIM',
      tipo: 'arcgis-export',
      servidor: 'https://tim.img.com.br/server/rest/services/manchasCobertura',
      atribuicao: 'Cobertura &copy; TIM',
      modelo: 'A TIM separa area aberta de fechada, e tem servicos proprios ' +
              'para o RURAL.',
      camadas: [
        { id: '4g', rotulo: '4G — dados', grupo: 'Rede', servico: 'spot4G',
          padrao: true, legenda: LEGENDA_TIM_ABERTA_FECHADA },
        { id: '3g', rotulo: '3G — voz', grupo: 'Rede', servico: 'spot3G',
          legenda: LEGENDA_TIM_ABERTA_FECHADA },
        { id: '2g', rotulo: '2G', grupo: 'Rede', servico: 'spot2G',
          legenda: LEGENDA_TIM_ABERTA_FECHADA },
        { id: '5g', rotulo: '5G', grupo: 'Rede', servico: 'spot5G',
          legenda: LEGENDA_TIM_ABERTA_FECHADA },
        { id: 'nbiot', rotulo: 'NB-IoT', grupo: 'Rede', servico: 'spotNBiOT',
          legenda: LEGENDA_TIM_ABERTA_FECHADA },
        // Servico de camada unica: nao tem indoor/outdoor, e a TIM publica as
        // classes so como "0" e "1", sem nome. Dizer o que os tons significam
        // seria inventar - a legenda diz o que da para afirmar.
        { id: 'voz-rural', rotulo: 'Voz rural', grupo: 'Fora da cidade',
          servico: 'spotRuralVoz', subcamadas: '0',
          legenda: [
            { cor: '#bde7ff', rotulo: 'Mancha rural — tom claro' },
            { cor: '#6a93bf', rotulo: 'Mancha rural — tom escuro' }
          ],
          nota: 'A TIM nao nomeia as classes desta camada (a legenda oficial ' +
                'traz so "0" e "1"), entao nao da para dizer qual tom e o sinal ' +
                'mais forte.' },
        { id: 'dados-rural', rotulo: 'Dados rural', grupo: 'Fora da cidade',
          servico: 'spot_Rural_Dados', subcamadas: '0',
          legenda: [
            { cor: '#bee8ff', rotulo: 'Mancha rural — tom claro' },
            { cor: '#6b92c0', rotulo: 'Mancha rural — tom escuro' }
          ],
          nota: 'A TIM nao nomeia as classes desta camada (a legenda oficial ' +
                'traz so "0" e "1"), entao nao da para dizer qual tom e o sinal ' +
                'mais forte.' }
      ]
    },

    // -------------------------------------------------------------- VIVO
    {
      id: 'vivo',
      nome: 'Vivo',
      tipo: 'wms',
      servidor: 'https://mapadecobertura.vivo.com.br/api/coverage',
      atribuicao: 'Cobertura &copy; Vivo',
      modelo: 'A Vivo separa area aberta de fechada, nos dois tons da mesma ' +
              'mancha.',
      camadas: [
        // As COBERTURA_* sao as camadas do site oficial: ja vem coloridas e
        // trazem aberta e fechada juntas, nos dois tons.
        { id: '4g', rotulo: '4G — dados', grupo: 'Rede', servico: 'COBERTURA_4G',
          padrao: true, legenda: legendaVivo('#fa55bb', '#eb3c7d') },
        { id: '3g', rotulo: '3G — voz', grupo: 'Rede', servico: 'COBERTURA_3G',
          legenda: legendaVivo('#ffd2de', '#ff96b2') },
        { id: '4g-plus', rotulo: '4.5G', grupo: 'Rede', servico: 'COBERTURA_4G_PLUS',
          legenda: legendaVivo('#f7b1cb', '#ef6497') },
        { id: '2g', rotulo: '2G', grupo: 'Rede', servico: 'COBERTURA_2G',
          legenda: legendaVivo('#ffb84c', '#ff9900') },
        { id: '5g', rotulo: '5G', grupo: 'Rede', servico: 'COBERTURA_5G_NR',
          legenda: legendaVivo('#e4b4ff', '#bd4aff') },
        { id: 'nbiot', rotulo: 'NB-IoT', grupo: 'Rede', servico: 'COBERTURA_NBIOT',
          legenda: [{ cor: '#699d02', rotulo: 'Cobertura' }] },

        // As PREDCOB_* sao o dado por estacao-base, uma camada por situacao.
        // Ficam disponiveis porque sao o unico jeito de ver SO a area fechada,
        // isolada da aberta - mas o servidor as devolve no estilo generico do
        // GeoServer, ou seja, CINZA. Nao e defeito do app.
        { id: '4g-bs-aberta', rotulo: '4G — so area aberta', grupo: 'Por estacao-base',
          servico: 'PREDCOB_LTE_1BS', legenda: null },
        { id: '4g-bs-fechada', rotulo: '4G — so area fechada', grupo: 'Por estacao-base',
          servico: 'PREDCOB_LTE_1BS_indoor', legenda: null },
        { id: '3g-bs-aberta', rotulo: '3G — so area aberta', grupo: 'Por estacao-base',
          servico: 'PREDCOB_3G_1BS', legenda: null },
        { id: '3g-bs-fechada', rotulo: '3G — so area fechada', grupo: 'Por estacao-base',
          servico: 'PREDCOB_3G_1BS_indoor', legenda: null },
        { id: '4g-plus-bs-aberta', rotulo: '4.5G — so area aberta', grupo: 'Por estacao-base',
          servico: 'PREDCOB_LTE_plus_1BS', legenda: null },
        { id: '4g-plus-bs-fechada', rotulo: '4.5G — so area fechada', grupo: 'Por estacao-base',
          servico: 'PREDCOB_LTE_plus_1BS_indoor', legenda: null },
        { id: '2g-bs-aberta', rotulo: '2G — so area aberta', grupo: 'Por estacao-base',
          servico: 'PREDCOB_GSM_1BS', legenda: null },
        { id: '2g-bs-fechada', rotulo: '2G — so area fechada', grupo: 'Por estacao-base',
          servico: 'PREDCOB_GSM_1BS_indoor', legenda: null }
      ],
      // Vale para todas as PREDCOB_*, que sao as que caem no estilo generico.
      notaGrupo: {
        'Por estacao-base': 'A Vivo devolve estas camadas em CINZA, no estilo ' +
          'generico do servidor - a cor nao significa nada. Elas existem aqui ' +
          'porque sao o unico jeito de ver a area fechada separada da aberta.'
      }
    }
  ];

  // ------------------------------------------------------------- CONSULTAS

  function fonte(id) {
    for (var i = 0; i < FONTES.length; i++) if (FONTES[i].id === id) return FONTES[i];
    return null;
  }

  function camadaDe(f, id) {
    if (!f) return null;
    for (var i = 0; i < f.camadas.length; i++) if (f.camadas[i].id === id) return f.camadas[i];
    return null;
  }

  // A camada que abre quando a pessoa liga a operadora. 4G e o padrao porque e
  // dele que modulos com chip dependem para transmitir.
  function camadaPadrao(f) {
    if (!f) return null;
    for (var i = 0; i < f.camadas.length; i++) if (f.camadas[i].padrao) return f.camadas[i];
    return f.camadas[0];
  }

  // Legenda pronta para desenhar: as tarjas da camada mais os avisos que valem
  // para ela (o do grupo e o da operadora).
  function legenda(idFonte, idCamada) {
    var f = fonte(idFonte);
    var c = camadaDe(f, idCamada);
    if (!f || !c) return null;
    var avisos = [];
    if (c.nota) avisos.push(c.nota);
    if (f.notaGrupo && f.notaGrupo[c.grupo]) avisos.push(f.notaGrupo[c.grupo]);
    return {
      operadora: f.nome,
      camada: c.rotulo,
      modelo: f.modelo,
      itens: c.legenda || [],
      avisos: avisos,
      recado: f.recado || ''
    };
  }

  // --------------------------------------------------- MONTAGEM NO LEAFLET

  // COMPORTAMENTO COMPARTILHADO PELOS TRES PROTOCOLOS.
  //
  // Cada tile deixa de ser uma <img> e passa a ser um <canvas>: a mancha e
  // desenhada nele e, em cima, aplica-se a mascara de terra por
  // 'destination-in'. Escrito UMA vez e misturado nas duas classes - se cada
  // protocolo tivesse a sua copia, o recorte funcionaria em duas operadoras e
  // seria esquecido na terceira, que e exatamente o defeito que o registro de
  // fontes existe para evitar.
  var COMPOSICAO = {
    createTile: function (coords, done) {
      var tam = this.getTileSize();
      var tile = document.createElement('canvas');
      tile.width = tam.x;
      tile.height = tam.y;

      var self = this;
      var molde = this.options.mascara ? this.options.mascara(coords) : null;
      var mancha = new Image();
      var base = null;
      var pendentes = molde ? 2 : 1;
      var manchaChegou = false;

      function passo() {
        if (--pendentes > 0) return;
        try {
          if (manchaChegou) self._comporTile(tile, mancha, base, molde);
        } catch (e) {
          // Nunca deixar o tile pendurado por causa do recorte: sem mancha a
          // pessoa fica sem resposta; com mancha inteira ela so fica um pouco
          // por cima da agua.
        }
        done(null, tile);
      }

      // TILE AUSENTE NAO E FALHA: onde nao ha cobertura o servidor recusa a
      // imagem (a Claro devolve 500 com um JSON dentro). O canvas simplesmente
      // fica transparente, que e o que aquilo significa - sem cobertura ali.
      // Cada tile ainda conta se chegou ou nao ('manchatile'): quem decide se
      // a vista inteira falhou e o diagnosticoDaVista, olhando o conjunto.
      mancha.onload = function () {
        manchaChegou = true;
        self.fire('manchatile', { ok: true });
        passo();
      };
      mancha.onerror = function () {
        self.fire('manchatile', { ok: false });
        passo();
      };

      if (molde) {
        base = new Image();
        // Sem isto o canvas fica "tainted" e getImageData e barrado - o recorte
        // inteiro morre. Os tres mapas base respondem com
        // Access-Control-Allow-Origin: *, o que vale inclusive em file://.
        base.crossOrigin = 'anonymous';
        base.onload = passo;
        base.onerror = function () { base = null; passo(); };
        base.src = molde.url;
      }
      mancha.src = this._urlDaMancha(coords);

      return tile;
    },

    _comporTile: function (tile, mancha, base, molde) {
      var ctx = tile.getContext('2d');
      ctx.drawImage(mancha, 0, 0, tile.width, tile.height);
      if (!base || !molde) return;

      var pixels = this._pixelsDoMapa(base, tile.width, tile.height);
      if (!pixels) return;      // canvas barrado: mancha inteira, sem recorte

      var recorte = document.createElement('canvas');
      recorte.width = tile.width;
      recorte.height = tile.height;
      var ctxR = recorte.getContext('2d');
      var img = ctxR.createImageData(tile.width, tile.height);
      img.data.set(mascaraDeAgua(pixels, molde.cor, molde.tolerancia));
      ctxR.putImageData(img, 0, 0);

      // destination-in = fica o que ja estava desenhado E esta coberto pelo que
      // vem agora. Ou seja: a mancha sobrevive so onde a mascara e opaca.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(recorte, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    },

    _pixelsDoMapa: function (base, largura, altura) {
      try {
        var cv = document.createElement('canvas');
        cv.width = largura;
        cv.height = altura;
        var c = cv.getContext('2d');
        c.drawImage(base, 0, 0, largura, altura);
        return c.getImageData(0, 0, largura, altura).data;
      } catch (e) {
        return null;   // origem sem CORS: melhor mancha inteira do que nenhuma
      }
    }
  };

  // Duas classes, um comportamento. Muda so de onde sai a URL da mancha.
  // Criadas na primeira chamada porque o L so existe no navegador.
  var ClasseTileMontada = null, ClasseWmsMontada = null;

  function classeTile() {
    if (!ClasseTileMontada) {
      ClasseTileMontada = L.TileLayer.extend(L.Util.extend({}, COMPOSICAO, {
        _urlDaMancha: function (coords) {
          return this.options.montarUrl(coords, this.getTileSize().x);
        }
      }));
    }
    return ClasseTileMontada;
  }

  function classeWms() {
    if (!ClasseWmsMontada) {
      ClasseWmsMontada = L.TileLayer.WMS.extend(L.Util.extend({}, COMPOSICAO, {
        // ATENCAO: declarar 'mascara' aqui e OBRIGATORIO. O L.TileLayer.WMS joga
        // em parametro de URL toda opcao que nao reconhece - sem esta linha o
        // recorte viraria "&mascara=function(coords){...}" pendurado no GetMap
        // e a Vivo devolveria erro em vez de mancha.
        options: { mascara: null },
        // O Leaflet ja sabe montar a URL do WMS (bbox, width, height e srs saem
        // do mapa); aqui so se pega o resultado dele para desenhar no canvas.
        _urlDaMancha: function (coords) {
          return L.TileLayer.WMS.prototype.getTileUrl.call(this, coords);
        }
      }));
    }
    return ClasseWmsMontada;
  }

  function opcoesComuns(f, opcoes) {
    return {
      opacity: opcoes.opacidade == null ? 0.6 : opcoes.opacidade,
      // Acima do mapa base e abaixo do canvas das antenas (que vive no
      // overlayPane, um painel inteiro acima deste).
      zIndex: 5,
      minZoom: ZOOM_MINIMO,
      maxZoom: ZOOM_MAXIMO,
      className: 'tile-cobertura',
      attribution: f.atribuicao,
      // Funcao (coords) -> { url, cor } com o tile de mapa que serve de molde do
      // recorte. Vem de quem conhece o mapa base - este arquivo nao precisa
      // saber qual mapa esta ligado nem de que cor e a agua dele.
      mascara: opcoes.mascara || null
    };
  }

  // UMA FUNCAO POR PROTOCOLO. E so isto que sabe a diferenca entre os tres
  // servidores; o resto do app so chama criar(operadora, camada).
  var MONTADORES = {
    'arcgis-tile': function (f, c, opcoes) {
      var o = opcoesComuns(f, opcoes);
      o.montarUrl = function (coords) { return urlTileArcgis(f, c, coords); };
      return new (classeTile())('', o);
    },

    'arcgis-export': function (f, c, opcoes) {
      // A URL do export nao e z/x/y, entao L.tileLayer nao serve direto. Em vez
      // de trocar a pagina inteira por uma imagem a cada movimento (que pisca) ou
      // de carregar o esri-leaflet (biblioteca a mais, num app que precisa abrir
      // por duplo clique), a subclasse calcula o bbox de cada tile 256x256. Fica
      // em tiles de verdade: o navegador cacheia e o pan reaproveita o que ja
      // baixou.
      var o = opcoesComuns(f, opcoes);
      o.montarUrl = function (coords, tamanho) {
        return urlExportArcgis(f, c, coords, tamanho || TAMANHO_TILE);
      };
      return new (classeTile())('', o);
    },

    'wms': function (f, c, opcoes) {
      var o = opcoesComuns(f, opcoes);
      var p = parametrosWms(f, c);
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
      // O Leaflet monta bbox, width, height e srs=EPSG:3857 a partir do mapa.
      return new (classeWms())(f.servidor, o);
    }
  };

  // A VISTA INTEIRA FALHOU? Recebe quantos tiles da mancha chegaram e quantos
  // falharam num carregamento (do 'loading' ao 'load' da camada) e devolve o
  // aviso para a legenda, ou '' quando nao ha o que avisar.
  //
  // Um tile que chegou basta para calar o aviso. Poucas falhas tambem nao
  // avisam: na borda do mapa ou num zoom de transicao sobra um ou outro tile.
  // TIM e Vivo devolvem imagem transparente onde nao ha cobertura, entao
  // nenhum tile = servidor fora. Na Claro (ausenteFalha) a falha tambem e o
  // jeito normal de dizer "sem cobertura aqui", e o aviso diz as duas coisas.
  // Medido em 10/11/2026: tim.img.com.br respondia 503 a qualquer pedido.
  var FALHAS_PARA_AVISAR = 4;

  function diagnosticoDaVista(f, chegaram, falharam) {
    if (!f || chegaram > 0 || falharam < FALHAS_PARA_AVISAR) return '';
    if (f.ausenteFalha) {
      return 'Nenhuma parte da mancha da ' + f.nome + ' chegou nesta vista. Ou nao ' +
        'ha cobertura aqui, ou o servidor da ' + f.nome + ' esta fora do ar agora.';
    }
    return 'O servidor da ' + f.nome + ' nao respondeu: nenhuma parte da mancha ' +
      'chegou. Deve estar fora do ar agora; tente de novo mais tarde. As antenas ' +
      'nao dependem disso.';
  }

  function criar(idFonte, idCamada, opcoes) {
    var f = fonte(idFonte);
    if (!f) throw new Error('operadora desconhecida: ' + idFonte);
    var c = camadaDe(f, idCamada) || camadaPadrao(f);
    var montar = MONTADORES[f.tipo];
    if (!montar) throw new Error('protocolo sem montador: ' + f.tipo);
    return montar(f, c, opcoes || {});
  }

  var api = {
    FONTES: FONTES,
    BORDA_3857: BORDA_3857,
    ZOOM_MINIMO: ZOOM_MINIMO,
    ZOOM_MAXIMO: ZOOM_MAXIMO,
    TAMANHO_TILE: TAMANHO_TILE,
    TOLERANCIA_AGUA: TOLERANCIA_AGUA,
    ehAgua: ehAgua,
    mascaraDeAgua: mascaraDeAgua,
    bboxDoTile: bboxDoTile,
    urlTileArcgis: urlTileArcgis,
    urlExportArcgis: urlExportArcgis,
    parametrosWms: parametrosWms,
    fonte: fonte,
    camadaDe: camadaDe,
    camadaPadrao: camadaPadrao,
    legenda: legenda,
    FALHAS_PARA_AVISAR: FALHAS_PARA_AVISAR,
    diagnosticoDaVista: diagnosticoDaVista,
    criar: criar
  };

  raiz.Cobertura = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
