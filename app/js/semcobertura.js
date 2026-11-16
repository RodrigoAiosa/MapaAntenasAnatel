// SEM COBERTURA - quantas pessoas e escolas ficam longe de qualquer antena. Puro, sem DOM.
//
// Entrada: o arquivo de pessoas da UF ({mun:[[cod,nome]], p:[x,y,pessoas,iMun,...]} com x,y em
// graus*1e4) e o de escolas ({mun:[nome], e:[[inep,lat,lon,nome,iMun,flags],...]}, flags:
// 1 privada, 2 urbana), e uma funcao temAntena(lat, lon) -> bool ("ha antena a ate R km?").
//
// LIMITES: a pessoa e contada no CENTROIDE do setor censitario; num setor rural grande o
// centroide pode ficar longe de quem mora perto da antena, e o contrario tambem. Distancia ate
// uma antena nao e sinal. Por isso a tela fala em "moram em setores cujo centro fica a mais de R km".
(function (raiz) {
  'use strict';

  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function iniciar(dados, opcoes) {
    var o = opcoes || {};
    var mp = (dados.pessoas && dados.pessoas.mun) || [];
    var me = (dados.escolas && dados.escolas.mun) || [];
    return {
      dados: dados, soPublicas: !!o.soPublicas, i: 0, j: 0,
      np: dados.pessoas ? (dados.pessoas.p.length / 4) : 0,
      ne: dados.escolas ? dados.escolas.e.length : 0,
      pessoas: { total: 0, fora: 0, porMun: mp.map(function () { return [0, 0]; }) },
      escolas: { total: 0, fora: 0, porMun: me.map(function () { return [0, 0]; }), lista: [] }
    };
  }

  // Processa ate "quantos" itens (pessoas e escolas juntos). Devolve true quando terminou.
  function passo(st, temAntena, quantos) {
    var feitos = 0;
    var p = st.dados.pessoas && st.dados.pessoas.p;
    while (st.i < st.np && feitos < quantos) {
      var k = st.i * 4, n = p[k + 2];
      var fora = !temAntena(p[k + 1] / 1e4, p[k] / 1e4);
      st.pessoas.total += n;
      st.pessoas.porMun[p[k + 3]][0] += n;
      if (fora) { st.pessoas.fora += n; st.pessoas.porMun[p[k + 3]][1] += n; }
      st.i++; feitos++;
    }
    var e = st.dados.escolas && st.dados.escolas.e;
    while (st.j < st.ne && feitos < quantos) {
      var s = e[st.j];
      st.j++; feitos++;
      if (st.soPublicas && (s[5] & 1)) continue;
      var f = !temAntena(s[1], s[2]);
      st.escolas.total++;
      st.escolas.porMun[s[4]][0]++;
      if (f) { st.escolas.fora++; st.escolas.porMun[s[4]][1]++; st.escolas.lista.push(s); }
    }
    return st.i >= st.np && st.j >= st.ne;
  }

  // Une pessoas e escolas por nome de municipio (sem acento). Ordena por pessoas fora, depois escolas fora.
  function ranking(st, limite) {
    var por = {};
    function pega(nome) {
      var k = semAcento(nome);
      return por[k] || (por[k] = { nome: nome, pessoas: 0, pessoasFora: 0, escolas: 0, escolasFora: 0 });
    }
    var mp = (st.dados.pessoas && st.dados.pessoas.mun) || [];
    mp.forEach(function (m, i) {
      var r = pega(m[1]);
      r.pessoas += st.pessoas.porMun[i][0];
      r.pessoasFora += st.pessoas.porMun[i][1];
    });
    var me = (st.dados.escolas && st.dados.escolas.mun) || [];
    me.forEach(function (nome, i) {
      var r = pega(nome);
      r.escolas += st.escolas.porMun[i][0];
      r.escolasFora += st.escolas.porMun[i][1];
    });
    var lista = Object.keys(por).map(function (k) { return por[k]; }).filter(function (r) {
      return r.pessoasFora > 0 || r.escolasFora > 0;
    });
    lista.sort(function (a, b) {
      return b.pessoasFora - a.pessoasFora || b.escolasFora - a.escolasFora || a.nome.localeCompare(b.nome);
    });
    return limite ? lista.slice(0, limite) : lista;
  }

  function nomeDoMunicipio(st, s) {
    var me = (st.dados.escolas && st.dados.escolas.mun) || [];
    return me[s[4]] || '';
  }

  raiz.SemCobertura = { iniciar: iniciar, passo: passo, ranking: ranking, nomeDoMunicipio: nomeDoMunicipio, semAcento: semAcento };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.SemCobertura;
})(typeof window !== 'undefined' ? window : globalThis);
