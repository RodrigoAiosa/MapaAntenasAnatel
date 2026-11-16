// EVOLUCAO DAS ANTENAS POR ANO - puro, sem DOM, para testar no Node.
//
// Os dados (dados/historico.json) trazem, por UF x operadora x geracao, quantas ERBs
// tiveram aquela geracao licenciada em cada ano. Aqui so se soma e se acumula.
//
// LIMITE: a base da Anatel so tem antenas que ainda existem. Antena desativada some, entao
// os anos antigos aparecem menores do que foram. A tela diz isso.
(function (raiz) {
  'use strict';

  // dados: o historico.json. opcoes: {uf: 'SC' ou ''(Brasil), ops: [nomes] ou null (todas),
  // gers: ['4G','5G'] ou null (todas)}. Devolve {anos, novas:{g:[...]}, acum:{g:[...]}}.
  function series(dados, opcoes) {
    var o = opcoes || {};
    var anos = (dados && dados.anos) || [];
    var gers = (o.gers && o.gers.length ? o.gers : (dados && dados.gers) || []);
    var novas = {}, acum = {};
    gers.forEach(function (g) { novas[g] = anos.map(function () { return 0; }); });
    if (!anos.length) return { anos: anos, novas: novas, acum: acum };
    var ufs = o.uf ? [o.uf] : Object.keys(dados.uf || {});
    var ops = o.ops || null;
    ufs.forEach(function (u) {
      var porOp = (dados.uf || {})[u];
      if (!porOp) return;
      Object.keys(porOp).forEach(function (op) {
        if (ops && ops.indexOf(op) < 0) return;
        gers.forEach(function (g) {
          var s = porOp[op][g];
          if (!s) return;
          for (var i = 0; i < s.length; i++) novas[g][i] += s[i];
        });
      });
    });
    gers.forEach(function (g) {
      var t = 0;
      acum[g] = novas[g].map(function (n) { t += n; return t; });
    });
    return { anos: anos, novas: novas, acum: acum };
  }

  // Primeiro ano com alguma ERB em qualquer das geracoes: corta o eixo para nao
  // desenhar decadas de zero.
  function primeiroAno(s) {
    for (var i = 0; i < s.anos.length; i++) {
      for (var g in s.acum) if (s.acum[g][i] > 0) return s.anos[i];
    }
    return null;
  }

  raiz.Evolucao = { series: series, primeiroAno: primeiroAno };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.Evolucao;
})(typeof window !== 'undefined' ? window : globalThis);
