/* TOUR DE BOAS-VINDAS COM GAMIFICACAO
 *
 * Na primeira visita, apresenta cada item do painel como uma "missao": cada
 * passo concluido vale XP, sobe o nivel e entra no sumario. O botao "Missoes"
 * no topo reabre o sumario a qualquer hora, e cada item dele leva direto ao
 * passo correspondente.
 *
 * Privacidade: so grava no localStorage do proprio navegador (chave
 * antenas.tour.v1) quais missoes foram vistas. Nada sai do aparelho.
 * Sem dependencias; roda tambem em file:// (storage com try/catch).
 */
(function () {
  'use strict';

  var CHAVE = 'antenas.tour.v1';
  var XP_POR_MISSAO = 10;
  var SEM_MOVIMENTO = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var NIVEIS = [
    { de: 0, nome: 'Iniciante' },
    { de: 30, nome: 'Explorador' },
    { de: 60, nome: 'Técnico de campo' },
    { de: 100, nome: 'Engenheiro de RF' },
    { de: 140, nome: 'Mestre das Antenas' }
  ];

  function secaoDe(seletor) {
    var el = document.querySelector(seletor);
    return el ? (el.closest('.secao') || el) : null;
  }

  var MISSOES = [
    { id: 'busca', icone: '🔎', titulo: 'Encontrar um lugar',
      alvo: function () { return secaoDe('#entrada'); }, painel: true,
      texto: 'Digite um endereço, CEP, coordenada, município ou o número de uma ERB, ou toque em "Usar minha localização". Sem ideia do que digitar? Use os exemplos abaixo do campo.' },
    { id: 'lugares', icone: '⭐', titulo: 'Meus lugares',
      alvo: function () { return document.getElementById('secao-lugares'); }, painel: true,
      texto: 'Salve pontos com "Salvar este ponto" e volte a eles com um toque. As buscas recentes ficam aqui também. Tudo só no seu navegador.' },
    { id: 'lote', icone: '📋', titulo: 'Lote de pontos',
      alvo: function () { return document.getElementById('secao-lote'); }, painel: true,
      texto: 'Cole uma lista de coordenadas (ou abra um CSV) e receba a antena mais próxima de cada operadora em cada ponto. Fica só no seu navegador.' },
    { id: 'cor', icone: '🎨', titulo: 'Colorir os pontos',
      alvo: function () { return secaoDe('input[name="modo"]'); }, painel: true,
      texto: 'Pinte as torres por operadora ou pela geração mais alta (2G a 5G). A legenda abaixo explica as cores.' },
    { id: 'operadoras', icone: '📡', titulo: 'Filtrar operadoras',
      alvo: function () { return secaoDe('#filtro-operadoras'); }, painel: true,
      texto: 'Mostre só as operadoras que interessam. A busca por ponto respeita este filtro, e o ranking "Qual operadora é melhor aqui?" aparece quando você marca um ponto.' },
    { id: 'geracoes', icone: '📶', titulo: 'Filtrar gerações',
      alvo: function () { return secaoDe('#filtro-geracoes'); }, painel: true,
      texto: 'Quer saber onde há 3G de voz? Deixe só o 3G marcado: a "mais próxima" passa a ser a mais próxima com 3G.' },
    { id: 'uf', icone: '🗺️', titulo: 'Escolher o estado',
      alvo: function () { return secaoDe('#filtro-uf'); }, painel: true,
      texto: 'Limite o mapa a um estado (UF) para ver menos pontos e achar o que procura mais rápido.' },
    { id: 'cobertura', icone: '🌐', titulo: 'Mancha de cobertura',
      alvo: function () { return secaoDe('#cobertura-operadoras'); }, painel: true,
      texto: 'Compare a torre com o que a operadora promete. Lembre: a antena mostra onde está a torre; a mancha mostra até onde a operadora diz que o sinal chega.' },
    { id: 'resumo', icone: '📊', titulo: 'Resumo do filtro',
      alvo: function () { return secaoDe('#resumo'); }, painel: true,
      texto: 'Números do que está filtrado: total de ERBs, por operadora e por geração.' },
    { id: 'mapa', icone: '📍', titulo: 'O mapa e o pino',
      alvo: function () { return document.getElementById('mapa'); },
      texto: 'Clique num lugar vazio para marcar um pino e ver a antena mais próxima de cada operadora. Arraste o pino para ajustar. Clique numa antena para abrir a ficha.' },
    { id: 'barra', icone: '🧭', titulo: 'Barra de status',
      alvo: function () { return document.getElementById('hud'); },
      texto: 'Mostra quantas ERBs estão na tela, a coordenada sob o cursor e o zoom. "Copiar link" guarda esta vista para compartilhar.' },
    { id: 'base', icone: '🗓️', titulo: 'Mapa base',
      alvo: function () { return document.getElementById('seletor-base'); },
      texto: 'Troque o desenho do mapa de fundo. O mapa vem do OpenStreetMap.' },
    { id: 'selo', icone: '🏷️', titulo: 'Data da base',
      alvo: function () { return document.getElementById('idade-base'); },
      texto: 'Diz de quando é a base da Anatel e há quantos dias foi baixada. Âmbar significa base velha. Lembre: licenciada não quer dizer ligada.' },
    { id: 'tema', icone: '🌗', titulo: 'Tema claro ou escuro',
      alvo: function () { return document.getElementById('tema'); },
      texto: 'Alterne entre o tema escuro e o claro, o que for melhor para seus olhos.' },
    { id: 'menu', icone: '↔️', titulo: 'Tela cheia do mapa',
      alvo: function () {
        var b = document.getElementById('recolher-painel');
        return visivel(b) ? b : document.getElementById('alternar-painel');
      },
      texto: 'Esconde o menu lateral para ver o mapa em tela cheia.',
      textoMovel: 'O botão "Filtros" abre o menu. Para fechar, arraste o menu para a esquerda com o dedo.' }
  ];

  var CSS = [
    '.tr-camada{position:fixed;inset:0;z-index:6000;font-family:inherit}',
    '.tr-escuro{position:fixed;inset:0;background:rgba(5,9,15,.72);backdrop-filter:blur(2px)}',
    '.tr-foco{position:fixed;border-radius:12px;pointer-events:none;box-shadow:0 0 0 9999px rgba(5,9,15,.72),0 0 0 3px var(--cor-ciano,#26d7e8),0 0 28px 4px var(--blue-glow,rgba(22,135,255,.38));transition:top .35s var(--curva,ease),left .35s var(--curva,ease),width .35s var(--curva,ease),height .35s var(--curva,ease)}',
    '.tr-foco.pulsa{animation:tr-pulsa 1.6s ease-in-out infinite}',
    '@keyframes tr-pulsa{50%{box-shadow:0 0 0 9999px rgba(5,9,15,.72),0 0 0 6px var(--cor-ciano,#26d7e8),0 0 40px 8px var(--blue-glow,rgba(22,135,255,.38))}}',
    '.tr-cartao{position:fixed;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;padding:16px 18px 14px;border-radius:16px;background:var(--card,#151c29);color:var(--text,#e8edf5);border:1px solid var(--border2,rgba(255,255,255,.14));box-shadow:var(--shadow-lg,0 10px 48px rgba(0,0,0,.6));animation:tr-entra .35s var(--mola,cubic-bezier(.34,1.28,.64,1))}',
    '@keyframes tr-entra{from{opacity:0;transform:translateY(10px) scale(.96)}}',
    '.tr-topo{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted,#8494aa);margin-bottom:6px}',
    '.tr-nivel{font-weight:700;color:var(--yellow,#F5B400);letter-spacing:.02em}',
    '.tr-xp{height:8px;border-radius:99px;background:var(--card2,#1b2435);overflow:hidden;margin:2px 0 12px}',
    '.tr-xp i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--cor-azul,#1687ff),var(--cor-ciano,#26d7e8),var(--yellow,#F5B400));transition:width .6s var(--curva,ease)}',
    '.tr-icone{font-size:28px;line-height:1;margin-right:10px}',
    '.tr-titulo{display:flex;align-items:center;margin:0 0 6px;font-size:18px;font-weight:700}',
    '.tr-texto{margin:0 0 14px;font-size:14px;line-height:1.55;color:var(--text,#e8edf5)}',
    '.tr-acoes{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.tr-acoes .tr-esp{flex:1}',
    '.tr-btn{font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--border2,rgba(255,255,255,.14));background:var(--card2,#1b2435);color:var(--text,#e8edf5);cursor:pointer;transition:transform .16s var(--curva,ease)}',
    '.tr-btn:hover{transform:translateY(-1px)}.tr-btn:active{transform:scale(.97)}',
    '.tr-btn.primario{background:var(--blue,#005BAC);border-color:transparent;color:#fff}',
    '.tr-btn.suave{background:transparent;border-color:transparent;color:var(--muted,#8494aa)}',
    '.tr-btn:focus-visible{outline:2px solid var(--cor-ciano,#26d7e8);outline-offset:2px}',
    '.tr-centro{top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 24px))}',
    '.tr-sumario{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:4px;max-height:44vh;overflow:auto}',
    '.tr-sumario button{width:100%;display:flex;align-items:center;gap:10px;text-align:left;font:inherit;font-size:13.5px;padding:7px 10px;border-radius:9px;border:1px solid transparent;background:var(--card2,#1b2435);color:var(--text,#e8edf5);cursor:pointer}',
    '.tr-sumario button:hover{border-color:var(--border2,rgba(255,255,255,.14))}',
    '.tr-sumario button:focus-visible{outline:2px solid var(--cor-ciano,#26d7e8)}',
    '.tr-sumario .tr-ok{margin-left:auto;font-weight:700;color:var(--cor-verde,#2db86a);white-space:nowrap}',
    '.tr-sumario .tr-pendente{margin-left:auto;color:var(--faint,#3d4d60);font-size:12px;white-space:nowrap}',
    '.tr-trofeu{font-size:56px;text-align:center;margin:4px 0;animation:tr-salta .8s var(--mola,cubic-bezier(.34,1.28,.64,1))}',
    '@keyframes tr-salta{from{transform:scale(.3) rotate(-20deg);opacity:0}}',
    '.tr-centrado{text-align:center}',
    '.tr-ponto{position:fixed;z-index:6100;font-weight:800;font-size:18px;color:var(--yellow,#F5B400);pointer-events:none;text-shadow:0 2px 8px rgba(0,0,0,.5);animation:tr-sobe 1s ease-out forwards}',
    '@keyframes tr-sobe{to{transform:translateY(-46px);opacity:0}}',
    '.tr-confete{position:fixed;top:-12px;width:9px;height:14px;z-index:6100;pointer-events:none;animation:tr-cai linear forwards}',
    '@keyframes tr-cai{to{transform:translateY(105vh) rotate(720deg);opacity:.9}}',
    '#tour-btn{font:inherit;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:0 11px;height:34px;border-radius:99px;border:1px solid var(--border2,rgba(255,255,255,.14));background:var(--card2,#1b2435);color:var(--text,#e8edf5);cursor:pointer}',
    '#tour-btn:hover{border-color:var(--cor-ciano,#26d7e8)}',
    '#tour-btn:focus-visible{outline:2px solid var(--cor-ciano,#26d7e8);outline-offset:2px}',
    '#tour-btn .tr-pct{color:var(--yellow,#F5B400)}',
    '@media (max-width:780px){#tour-btn .tr-rotulo{display:none}}',
    '@media (prefers-reduced-motion:reduce){.tr-cartao,.tr-trofeu,.tr-foco.pulsa{animation:none}.tr-foco,.tr-xp i{transition:none}}'
  ].join('\n');

  // ---------------------------------------------------------------- estado
  var estado = { vistas: [], concluido: false };

  function carregar() {
    try {
      var s = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (s && Array.isArray(s.vistas)) {
        estado.vistas = s.vistas.filter(function (id) { return idx(id) >= 0; });
        estado.concluido = !!s.concluido;
        return true;
      }
    } catch (e) { /* storage indisponivel: tour vale so nesta aba */ }
    return false;
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* ok */ }
  }
  function idx(id) {
    for (var i = 0; i < MISSOES.length; i++) if (MISSOES[i].id === id) return i;
    return -1;
  }
  function xp() { return estado.vistas.length * XP_POR_MISSAO; }
  function nivel() {
    var n = NIVEIS[0], i = 0, v = xp();
    for (i = 0; i < NIVEIS.length; i++) if (v >= NIVEIS[i].de) n = NIVEIS[i];
    return n.nome;
  }
  function pct() { return Math.round(estado.vistas.length * 100 / MISSOES.length); }

  // ------------------------------------------------------------------ util
  function el(tag, classe, html) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function visivel(e) {
    if (!e) return false;
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function mobile() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 780px)').matches);
  }
  function garantirPainel(precisa) {
    var corpo = document.body;
    if (!precisa) { if (mobile()) corpo.classList.remove('painel-aberto'); return; }
    if (mobile()) corpo.classList.add('painel-aberto');
    else if (corpo.classList.contains('painel-recolhido')) {
      var b = document.getElementById('recolher-painel');
      if (b) b.click();
    }
  }

  // ------------------------------------------------------------------- UI
  var camada = null, foco = null, cartao = null, restaurarFoco = null, atual = -1;

  function abrirCamada() {
    if (camada) return;
    restaurarFoco = document.activeElement;
    camada = el('div', 'tr-camada');
    camada.setAttribute('role', 'dialog');
    camada.setAttribute('aria-modal', 'true');
    camada.setAttribute('aria-label', 'Tour de boas-vindas');
    document.body.appendChild(camada);
    document.addEventListener('keydown', teclas, true);
    window.addEventListener('resize', reposicionar);
  }
  function fechar() {
    if (!camada) return;
    document.removeEventListener('keydown', teclas, true);
    window.removeEventListener('resize', reposicionar);
    camada.remove();
    camada = foco = cartao = null;
    atual = -1;
    garantirPainel(false);
    if (restaurarFoco && restaurarFoco.focus) try { restaurarFoco.focus(); } catch (e) { /* ok */ }
    atualizarBotao();
  }
  function limpar() {
    camada.innerHTML = '';
    foco = cartao = null;
  }

  function barraXp() {
    return '<div class="tr-topo"><span class="tr-nivel">Nível: ' + esc(nivel()) + '</span>' +
      '<span>' + xp() + ' XP · ' + estado.vistas.length + '/' + MISSOES.length + '</span></div>' +
      '<div class="tr-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct() +
      '" aria-label="Progresso das missões"><i style="width:' + pct() + '%"></i></div>';
  }

  function teclas(ev) {
    if (!camada) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(); return; }
    if (atual >= 0) {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); proxima(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); anterior(); }
    }
    if (ev.key === 'Tab' && cartao) { // prende o foco no cartao
      var f = cartao.querySelectorAll('button');
      if (!f.length) return;
      var primeiro = f[0], ultimo = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
      else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
      else if (!cartao.contains(document.activeElement)) { ev.preventDefault(); primeiro.focus(); }
    }
  }

  function sumarioHtml() {
    var h = '<ul class="tr-sumario">';
    MISSOES.forEach(function (m, i) {
      var feita = estado.vistas.indexOf(m.id) >= 0;
      h += '<li><button type="button" data-i="' + i + '"><span aria-hidden="true">' + m.icone + '</span>' +
        '<span>' + esc(m.titulo) + '</span>' +
        (feita ? '<span class="tr-ok">✓ +' + XP_POR_MISSAO + ' XP</span>'
               : '<span class="tr-pendente">a explorar</span>') + '</button></li>';
    });
    return h + '</ul>';
  }
  function ligarSumario(raiz) {
    raiz.querySelectorAll('.tr-sumario button').forEach(function (b) {
      b.addEventListener('click', function () { missao(parseInt(b.getAttribute('data-i'), 10)); });
    });
  }

  function telaSumario(inicial) {
    abrirCamada(); limpar(); atual = -1;
    camada.appendChild(el('div', 'tr-escuro'));
    var completo = estado.vistas.length === MISSOES.length;
    var proxima = 0;
    for (var i = 0; i < MISSOES.length; i++) {
      if (estado.vistas.indexOf(MISSOES[i].id) < 0) { proxima = i; break; }
    }
    cartao = el('div', 'tr-cartao tr-centro');
    cartao.innerHTML = barraXp() +
      '<h2 class="tr-titulo"><span class="tr-icone" aria-hidden="true">🏆</span>' +
      (inicial ? 'Bem-vindo ao Mapa de Antenas!' : 'Sumário de missões') + '</h2>' +
      '<p class="tr-texto">' + (completo
        ? 'Você completou todas as missões. Toque numa para rever.'
        : 'Complete as <strong>' + MISSOES.length + ' missões</strong> para conhecer cada item da tela, ganhe XP e suba de nível. Dura cerca de 1 minuto.') + '</p>' +
      sumarioHtml() +
      '<div class="tr-acoes"><button type="button" class="tr-btn suave" id="tr-sair">' +
      (inicial ? 'Pular tour' : 'Fechar') + '</button><span class="tr-esp"></span>' +
      '<button type="button" class="tr-btn primario" id="tr-comecar">' +
      (completo ? 'Rever do início' : (estado.vistas.length ? 'Continuar' : 'Começar missão')) + '</button></div>';
    camada.appendChild(cartao);
    ligarSumario(cartao);
    cartao.querySelector('#tr-sair').addEventListener('click', function () {
      if (inicial) { estado.concluido = true; salvar(); }
      fechar();
    });
    cartao.querySelector('#tr-comecar').addEventListener('click', function () {
      missao(completo ? 0 : proxima);
    });
    cartao.querySelector('#tr-comecar').focus();
  }

  function missao(i) {
    var m = MISSOES[i];
    if (!m) { return telaFinal(); }
    abrirCamada(); limpar(); atual = i;
    garantirPainel(!!m.painel);
    var alvo = m.alvo();
    if (window.Painel && alvo && m.painel) window.Painel.abrir(alvo, false); // secao recolhida: abre so durante o tour
    if (!visivel(alvo)) { // item ausente nesta tela (ex.: sem o botao): pula
      return i < MISSOES.length - 1 ? missao(i + 1) : telaFinal();
    }
    if (alvo.scrollIntoView) alvo.scrollIntoView({ block: 'center', behavior: 'auto' });

    camada.appendChild(el('div', 'tr-escuro')); // bloqueia cliques fora do cartao
    camada.lastChild.style.background = 'transparent';
    camada.lastChild.style.backdropFilter = 'none';
    foco = el('div', 'tr-foco' + (SEM_MOVIMENTO ? '' : ' pulsa'));
    camada.appendChild(foco);

    var feita = estado.vistas.indexOf(m.id) >= 0;
    cartao = el('div', 'tr-cartao');
    cartao.innerHTML = barraXp() +
      '<h2 class="tr-titulo"><span class="tr-icone" aria-hidden="true">' + m.icone + '</span>' + esc(m.titulo) + '</h2>' +
      '<div class="tr-topo" style="margin:-2px 0 6px"><span>Missão ' + (i + 1) + ' de ' + MISSOES.length + '</span></div>' +
      '<p class="tr-texto">' + esc((mobile() && m.textoMovel) || m.texto) + '</p>' +
      '<div class="tr-acoes">' +
      '<button type="button" class="tr-btn suave" id="tr-sumario">Sumário</button><span class="tr-esp"></span>' +
      (i > 0 ? '<button type="button" class="tr-btn" id="tr-voltar">Voltar</button>' : '') +
      '<button type="button" class="tr-btn primario" id="tr-prox">' +
      (i === MISSOES.length - 1 ? 'Concluir' : 'Entendi') + (feita ? '' : ' +' + XP_POR_MISSAO + ' XP') + '</button></div>';
    camada.appendChild(cartao);
    cartao.querySelector('#tr-sumario').addEventListener('click', function () { telaSumario(false); });
    var v = cartao.querySelector('#tr-voltar');
    if (v) v.addEventListener('click', anterior);
    cartao.querySelector('#tr-prox').addEventListener('click', proxima);
    cartao.querySelector('#tr-prox').focus();
    reposicionar();
    setTimeout(reposicionar, 450); // painel lateral no celular ainda esta deslizando
  }

  function reposicionar() {
    if (atual < 0 || !foco || !cartao) return;
    var alvo = MISSOES[atual].alvo();
    if (!visivel(alvo)) return;
    var r = alvo.getBoundingClientRect(), p = 6;
    var W = window.innerWidth, H = window.innerHeight;
    // alvos grandes (o mapa inteiro) viram uma moldura interna, nao um recorte da tela toda
    var t = Math.max(0, r.top - p), l = Math.max(0, r.left - p);
    var w = Math.min(W - l, r.width + 2 * p), h = Math.min(H - t, r.height + 2 * p);
    if (w > W * 0.8 && h > H * 0.6) { t += 8; l += 8; w -= 16; h -= 16; }
    foco.style.top = t + 'px'; foco.style.left = l + 'px';
    foco.style.width = w + 'px'; foco.style.height = h + 'px';

    var cw = cartao.offsetWidth, ch = cartao.offsetHeight, m = 12;
    var x, y;
    if (w > W * 0.8 && h > H * 0.6) { // alvo enorme: cartao no centro-inferior
      x = (W - cw) / 2; y = H - ch - 24;
    } else if (W - (l + w) >= cw + m) { x = l + w + m; y = t; }           // direita
    else if (l >= cw + m) { x = l - cw - m; y = t; }                      // esquerda
    else if (H - (t + h) >= ch + m) { x = l; y = t + h + m; }             // abaixo
    else if (t >= ch + m) { x = l; y = t - ch - m; }                      // acima
    else { x = (W - cw) / 2; y = H - ch - 16; }                           // sem lugar: base da tela
    x = Math.max(12, Math.min(x, W - cw - 12));
    y = Math.max(12, Math.min(y, H - ch - 12));
    cartao.style.left = x + 'px'; cartao.style.top = y + 'px';
  }

  function ganhar(i) {
    var m = MISSOES[i];
    if (estado.vistas.indexOf(m.id) >= 0) return;
    estado.vistas.push(m.id);
    salvar();
    if (SEM_MOVIMENTO || !cartao) return;
    var b = cartao.querySelector('#tr-prox').getBoundingClientRect();
    var p = el('div', 'tr-ponto', '+' + XP_POR_MISSAO + ' XP');
    p.style.left = (b.left + b.width / 2 - 24) + 'px';
    p.style.top = (b.top - 4) + 'px';
    document.body.appendChild(p);
    setTimeout(function () { p.remove(); }, 1000);
  }

  function proxima() {
    var i = atual;
    ganhar(i);
    if (i >= MISSOES.length - 1) telaFinal(); else missao(i + 1);
  }
  function anterior() { if (atual > 0) missao(atual - 1); }

  function confete() {
    if (SEM_MOVIMENTO) return;
    var cores = ['#1687ff', '#26d7e8', '#F5B400', '#2db86a', '#a78bfa', '#e05050'];
    for (var i = 0; i < 40; i++) {
      var c = el('div', 'tr-confete');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = cores[i % cores.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
      c.style.animationDelay = (Math.random() * 0.5) + 's';
      document.body.appendChild(c);
      setTimeout(function (n) { n.remove(); }, 4200, c);
    }
  }

  function telaFinal() {
    abrirCamada(); limpar(); atual = -1;
    estado.concluido = true; salvar();
    camada.appendChild(el('div', 'tr-escuro'));
    var completo = estado.vistas.length === MISSOES.length;
    cartao = el('div', 'tr-cartao tr-centro tr-centrado');
    cartao.innerHTML = '<div class="tr-trofeu" aria-hidden="true">' + (completo ? '🏆' : '⭐') + '</div>' +
      '<h2 class="tr-titulo" style="justify-content:center">' +
      (completo ? 'Conquista desbloqueada!' : 'Boa exploração!') + '</h2>' +
      '<p class="tr-texto">' + (completo
        ? 'Você completou as ' + MISSOES.length + ' missões e virou <strong>' + esc(nivel()) + '</strong> com ' + xp() + ' XP.'
        : 'Você fez ' + estado.vistas.length + ' de ' + MISSOES.length + ' missões (' + xp() + ' XP). Faltam algumas para o nível máximo.') + '</p>' +
      barraXp() + sumarioHtml() +
      '<div class="tr-acoes"><button type="button" class="tr-btn suave" id="tr-sumario-x" style="visibility:hidden">.</button><span class="tr-esp"></span>' +
      '<button type="button" class="tr-btn primario" id="tr-fim">Ir para o mapa</button></div>';
    camada.appendChild(cartao);
    ligarSumario(cartao);
    cartao.querySelector('#tr-sumario-x').setAttribute('tabindex', '-1');
    cartao.querySelector('#tr-sumario-x').setAttribute('aria-hidden', 'true');
    cartao.querySelector('#tr-fim').addEventListener('click', fechar);
    cartao.querySelector('#tr-fim').focus();
    if (completo) confete();
    atualizarBotao();
  }

  // ----------------------------------------------------- botao no cabecalho
  var botao = null;
  function atualizarBotao() {
    if (!botao) return;
    botao.querySelector('.tr-pct').textContent = pct() + '%';
    botao.title = 'Sumário de missões: ' + estado.vistas.length + ' de ' + MISSOES.length + ' concluídas';
  }
  function criarBotao() {
    var tema = document.getElementById('tema');
    if (!tema || !tema.parentNode) return;
    botao = el('button', null, '<span aria-hidden="true">🏆</span><span class="tr-rotulo">Missões</span><span class="tr-pct">0%</span>');
    botao.id = 'tour-btn';
    botao.type = 'button';
    botao.setAttribute('aria-label', 'Abrir o sumário de missões do tour');
    botao.addEventListener('click', function () { telaSumario(false); });
    tema.parentNode.insertBefore(botao, tema);
    atualizarBotao();
  }

  // ------------------------------------------------------------------ inicio
  function aguardarMapaPronto(fn) {
    var tentativas = 0;
    (function olhar() {
      var b = document.getElementById('boot');
      var pronto = !b || b.classList.contains('saindo') || !visivel(b) ||
        getComputedStyle(b).visibility === 'hidden';
      if (pronto || tentativas++ > 120) setTimeout(fn, 500);
      else setTimeout(olhar, 250);
    })();
  }

  function iniciar() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    var jaViu = carregar();
    criarBotao();
    if (!jaViu || (!estado.concluido && estado.vistas.length === 0)) {
      aguardarMapaPronto(function () { if (!camada) telaSumario(true); });
    }
  }

  window.Tour = { abrir: function () { telaSumario(false); }, reiniciar: function () {
    estado = { vistas: [], concluido: false }; salvar(); atualizarBotao(); telaSumario(true);
  } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
