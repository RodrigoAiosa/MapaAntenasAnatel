/* PAINEL EM SECOES RECOLHIVEIS (Lei de Hick / Miller: menos itens de uma vez)
 *
 * Cada titulo do painel vira um botao que abre e fecha a secao. "Encontrar" e
 * "Antenas perto do ponto" ficam sempre abertas. O estado escolhido pelo
 * usuario e lembrado neste navegador (localStorage, chave antenas.painel.v1).
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

  window.Painel = { abrir: abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
