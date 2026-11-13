/* PAINEL EM SECOES RECOLHIVEIS (Lei de Hick / Miller: menos itens de uma vez)
 *
 * Cada titulo do painel vira um botao que abre e fecha a secao. "Encontrar" e
 * "Antenas perto do ponto" ficam sempre abertas. O estado escolhido pelo
 * usuario e lembrado neste navegador (localStorage, chave antenas.painel.v1).
 * No celular, o menu tambem fecha arrastando para a esquerda.
 */
(function () {
  'use strict';
  var CHAVE = 'antenas.painel.v1';
  // Abertas na primeira visita; o resto (avancado) comeca fechado.
  var ABERTAS = ['meus lugares', 'operadoras no mapa', 'geracoes'];

  function ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { return {}; }
  }
  function gravar(o) {
    try { localStorage.setItem(CHAVE, JSON.stringify(o)); } catch (e) { /* ok */ }
  }

  function definir(secao, abre) {
    var h = secao.querySelector(':scope > h2');
    secao.classList.toggle('recolhida', !abre);
    if (h) {
      h.setAttribute('aria-expanded', abre ? 'true' : 'false');
      var c = h.querySelector('.caret');
      if (c) c.textContent = abre ? '▾' : '▸';
    }
  }

  function abrir(el, guardar) {
    var s = el && el.closest ? el.closest('.secao.recolhida') : null;
    if (!s) return;
    definir(s, true);
    if (guardar) {
      var o = ler();
      o[s.getAttribute('data-chave')] = true;
      gravar(o);
    }
  }

  function iniciar() {
    var salvo = ler();
    document.querySelectorAll('#painel > .secao').forEach(function (s) {
      var h = s.querySelector(':scope > h2');
      if (!h || s.id === 'secao-perto' || s.querySelector('#entrada')) return;
      var chave = (h.textContent || '').trim().toLowerCase();
      s.setAttribute('data-chave', chave);
      s.classList.add('recolhivel');
      h.setAttribute('role', 'button');
      h.tabIndex = 0;
      h.insertAdjacentHTML('beforeend', '<span class="caret" aria-hidden="true"></span>');
      definir(s, chave in salvo ? !!salvo[chave] : ABERTAS.indexOf(chave) >= 0);
      function alternar() {
        var abre = s.classList.contains('recolhida');
        definir(s, abre);
        var o = ler(); o[chave] = abre; gravar(o);
      }
      h.addEventListener('click', alternar);
      h.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
      });
    });
  }

  // ------------------------------------------------ ARRASTAR PARA A ESQUERDA (CELULAR)
  // No celular o menu cobre a tela quase toda; o jeito natural de fechar e
  // empurrar para o lado. O painel acompanha o dedo e fecha se o gesto passar
  // de 30% da largura ou for rapido. Ignora gestos que comecam em controles
  // que ja usam o arrasto (barra de raio) ou em areas que rolam de lado.
  var CELULAR = '(max-width: 780px)';

  function ehCelular() { return !!(window.matchMedia && window.matchMedia(CELULAR).matches); }

  function rolaDeLado(el, limite) {
    for (; el && el !== limite && el.nodeType === 1; el = el.parentNode) {
      if (el.scrollWidth > el.clientWidth + 2) {
        var ov = getComputedStyle(el).overflowX;
        if (ov === 'auto' || ov === 'scroll') return true;
      }
    }
    return false;
  }

  function arrastarParaFechar() {
    var painel = document.getElementById('painel');
    if (!painel) return;
    var corpo = document.body;
    var x0 = 0, y0 = 0, t0 = 0, dx = 0, ativo = false, decidido = false, horizontal = false;

    function reiniciar() { ativo = decidido = horizontal = false; dx = 0; }

    painel.addEventListener('touchstart', function (e) {
      if (!ehCelular() || !corpo.classList.contains('painel-aberto') || e.touches.length !== 1) return;
      var alvo = e.target;
      if (alvo.closest && alvo.closest('input[type="range"]')) return;
      if (rolaDeLado(alvo, painel)) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
      ativo = true; decidido = false; horizontal = false; dx = 0;
    }, { passive: true });

    painel.addEventListener('touchmove', function (e) {
      if (!ativo) return;
      var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!decidido) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decidido = true;
        horizontal = mx < 0 && Math.abs(mx) > Math.abs(my) * 1.3;
        if (horizontal) painel.style.transition = 'none';
      }
      if (!horizontal) { ativo = false; return; }   // era rolagem vertical: deixa o navegador
      dx = Math.min(0, mx);
      painel.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });

    function soltar() {
      if (!ativo || !horizontal) { reiniciar(); return; }
      var largura = painel.offsetWidth || 1;
      var rapido = (-dx / Math.max(Date.now() - t0, 1)) > 0.5 && -dx > 40;
      var fechar = -dx > largura * 0.3 || rapido;
      painel.style.transition = '';
      painel.style.transform = '';
      if (fechar) corpo.classList.remove('painel-aberto');
      reiniciar();
    }
    painel.addEventListener('touchend', soltar);
    painel.addEventListener('touchcancel', soltar);

    // Puxador: dica visual de que o menu desliza para o lado.
    var p = document.createElement('div');
    p.className = 'painel-puxador';
    p.setAttribute('aria-hidden', 'true');
    corpo.appendChild(p);
  }

  window.Painel = { abrir: abrir };
  function tudo() { iniciar(); arrastarParaFechar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tudo);
  else tudo();
})();
