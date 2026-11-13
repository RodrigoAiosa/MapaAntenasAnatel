// Busca por CEP e por endereco escrito (10/11/2026).
//
// Diferente do resto do mapa, isto SAI do navegador: o CEP vai para o ViaCEP
// (viacep.com.br) e o endereco vai para o Nominatim do OpenStreetMap
// (nominatim.openstreetmap.org), os dois gratuitos e sem chave. So sai o que a
// pessoa digitou na busca, e so quando ela clica em Buscar. O lote de pontos
// continua so com coordenadas e nunca passa por aqui: mandar uma carteira
// inteira para fora seria vazar endereco de cliente, e o Nominatim proibe uso
// em lote (https://operations.osmfoundation.org/policies/nominatim/).
//
// A posicao que volta e da RUA, quase nunca do numero: o OpenStreetMap tem
// poucos numeros de casa no Brasil. Por isso cada resultado diz a precisao
// ('imovel', 'rua', 'bairro' ou 'cidade') e o app mostra isso na tela.
//
// O caminho inverso (coordenada do pino -> endereco, `buscarReverso`) tambem
// vai ao Nominatim, mas so quando a pessoa clica em "Qual o endereco deste
// ponto?". Clicar, arrastar o pino ou colar uma coordenada nao manda nada:
// a posicao de um cliente so sai do navegador quando alguem pede.
//
// O modulo nao toca no DOM: recebe o fetch por parametro, e o
// tests/geo_test.cjs roda tudo sem rede.

(function (raiz) {
  'use strict';

  const URL_VIACEP = 'https://viacep.com.br/ws/';
  const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const URL_NOMINATIM_REVERSO = 'https://nominatim.openstreetmap.org/reverse';
  // A politica do Nominatim pede no maximo 1 pedido por segundo.
  const INTERVALO_NOMINATIM_MS = 1100;
  const TEMPO_LIMITE_MS = 12000;
  const MAX_RESULTADOS = 8;

  // "88015-200", "88015200", " 88015 - 200 " nao: so com ou sem o hifen.
  const RE_CEP = /^\s*(\d{5})-?(\d{3})\s*$/;

  // Numero, virgula ou tipo de logradouro no comeco: e endereco, nao nome de
  // municipio. "Bom Jesus/SC" continua indo para a busca de municipio.
  const RE_ENDERECO = /\d|,|^(rua|r\.|av|av\.|avenida|travessa|tv|tv\.|rodovia|rod|rod\.|estrada|alameda|al\.|praca|largo|servidao|beco|via)\s/;

  function semAcento(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function lerCep(texto) {
    const m = RE_CEP.exec(String(texto || ''));
    return m ? m[1] + m[2] : null;
  }

  function formatarCep(cep) {
    return cep.slice(0, 5) + '-' + cep.slice(5);
  }

  function pareceEndereco(texto) {
    return RE_ENDERECO.test(semAcento(texto));
  }

  // place_rank do Nominatim: 30 = imovel, 26-29 = rua, 17-25 = bairro ou
  // localidade dentro do municipio, abaixo disso = municipio ou maior.
  function precisaoDe(r) {
    const rank = +r.place_rank || 0;
    if (rank >= 30) return 'imovel';
    if (rank >= 26) return 'rua';
    if (rank >= 17) return 'bairro';
    return 'cidade';
  }

  function ufDe(a) {
    const iso = a && a['ISO3166-2-lvl4'];
    return iso && /^BR-[A-Z]{2}$/.test(iso) ? iso.slice(3) : '';
  }

  function cidadeDe(a) {
    return (a && (a.city || a.town || a.village || a.municipality || a.city_district)) || '';
  }

  // Rotulo curto: "Rua Felipe Schmidt, 300, Centro, Florianopolis/SC".
  function rotuloDe(r) {
    const a = r.address;
    if (!a) return r.display_name || '';
    const partes = [];
    const rua = a.road || a.pedestrian || a.footway || a.square || '';
    if (rua) partes.push(a.house_number ? rua + ', ' + a.house_number : rua);
    const bairro = a.suburb || a.neighbourhood || a.quarter || a.hamlet || '';
    if (bairro) partes.push(bairro);
    const cidade = cidadeDe(a), uf = ufDe(a);
    if (cidade) partes.push(uf ? cidade + '/' + uf : cidade);
    else if (a.state) partes.push(a.state);
    return partes.length ? partes.join(', ') : (r.display_name || '');
  }

  // O OpenStreetMap corta a mesma rua em varios trechos, e cada trecho volta
  // como um resultado. Mostrar "Rua Felipe Schmidt" tres vezes so confunde:
  // fica o primeiro (o Nominatim ja ordena pela relevancia).
  function agrupar(resultados) {
    const vistos = new Set(), saida = [];
    for (const r of resultados) {
      const chave = r.precisao + '|' + semAcento(r.rotulo);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(r);
    }
    return saida;
  }

  function erro(tipo, mensagem) {
    const e = new Error(mensagem);
    e.tipo = tipo;
    return e;
  }

  function criar(opcoes) {
    opcoes = opcoes || {};
    const buscar = opcoes.fetch;
    const agora = opcoes.agora || (() => Date.now());
    const esperar = opcoes.esperar || (ms => new Promise(ok => setTimeout(ok, ms)));
    const dentroDoBrasil = opcoes.dentroDoBrasil ||
      (raiz.Geo && raiz.Geo.dentroDoBrasil) ||
      ((la, lo) => la >= -34 && la <= 6 && lo >= -74 && lo <= -28);
    let ultimoNominatim = -Infinity;

    async function pedirJson(url) {
      if (typeof buscar !== 'function') throw erro('rede', 'Este navegador nao faz pedidos (fetch).');
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const relogio = ctl ? setTimeout(() => ctl.abort(), TEMPO_LIMITE_MS) : null;
      let resp;
      try {
        resp = await buscar(url, ctl ? { signal: ctl.signal } : undefined);
      } catch (e) {
        throw erro('rede', 'Sem resposta de ' + new URL(url).host + '.');
      } finally {
        if (relogio) clearTimeout(relogio);
      }
      if (!resp.ok) throw erro('rede', new URL(url).host + ' respondeu HTTP ' + resp.status + '.');
      try { return await resp.json(); }
      catch (e) { throw erro('rede', new URL(url).host + ' devolveu algo que nao e JSON.'); }
    }

    // Busca e reverso dividem o mesmo limite de 1 pedido por segundo.
    async function vezDoNominatim() {
      const falta = ultimoNominatim + INTERVALO_NOMINATIM_MS - agora();
      if (falta > 0) await esperar(falta);
      ultimoNominatim = agora();
    }

    async function nominatim(params) {
      await vezDoNominatim();
      const q = new URLSearchParams(Object.assign({
        format: 'jsonv2', addressdetails: '1', countrycodes: 'br',
        limit: String(MAX_RESULTADOS), 'accept-language': 'pt-BR'
      }, params));
      const lista = await pedirJson(URL_NOMINATIM + '?' + q.toString());
      if (!Array.isArray(lista)) return [];
      const saida = [];
      for (const r of lista) {
        const lat = +r.lat, lon = +r.lon;
        if (!isFinite(lat) || !isFinite(lon) || !dentroDoBrasil(lat, lon)) continue;
        saida.push({ lat, lon, rotulo: rotuloDe(r), precisao: precisaoDe(r), cidade: cidadeDe(r.address) });
      }
      return agrupar(saida);
    }

    // Endereco escrito: devolve a lista (vazia quando nada bate).
    async function buscarTexto(texto) {
      const t = String(texto || '').trim();
      if (!t) return [];
      return nominatim({ q: t });
    }

    // CEP: o ViaCEP diz a rua, o bairro e o municipio, e o Nominatim acha a
    // rua. Se a rua nao for achada, cai para o bairro e depois para o centro
    // do municipio, sempre avisando a precisao. Devolve um resultado so.
    async function buscarCep(cep) {
      const c = lerCep(cep);
      if (!c) throw erro('cep', 'CEP precisa de 8 digitos.');
      const v = await pedirJson(URL_VIACEP + c + '/json/');
      if (!v || v.erro) throw erro('cep', 'O CEP ' + formatarCep(c) + ' nao existe na base dos Correios (ViaCEP).');
      const cidade = v.localidade || '', uf = v.uf || '', estado = v.estado || uf;
      const fim = (cidade ? cidade + '/' + uf : uf) + ' (CEP ' + formatarCep(c) + ')';
      const mesmaCidade = r => !r.cidade || semAcento(r.cidade) === semAcento(cidade);

      if (v.logradouro) {
        const ruas = (await nominatim({ street: v.logradouro, city: cidade, state: estado, limit: '3' }))
          .filter(mesmaCidade);
        if (ruas.length) {
          const r = ruas[0];
          return {
            lat: r.lat, lon: r.lon, precisao: r.precisao === 'imovel' ? 'rua' : r.precisao,
            rotulo: v.logradouro + (v.bairro ? ', ' + v.bairro : '') + ', ' + fim
          };
        }
      }
      if (v.bairro) {
        const bairros = (await nominatim({ q: v.bairro + ', ' + cidade + ', ' + estado, limit: '3' }))
          .filter(r => mesmaCidade(r) && r.precisao !== 'cidade');
        if (bairros.length) {
          return {
            lat: bairros[0].lat, lon: bairros[0].lon, precisao: 'bairro',
            rotulo: (v.logradouro ? v.logradouro + ', ' : '') + v.bairro + ', ' + fim
          };
        }
      }
      const cidades = await nominatim({ city: cidade, state: estado, limit: '1' });
      if (cidades.length) {
        return {
          lat: cidades[0].lat, lon: cidades[0].lon, precisao: 'cidade',
          rotulo: (v.logradouro ? v.logradouro + ', ' : '') + (v.bairro ? v.bairro + ', ' : '') + fim
        };
      }
      throw erro('nada', 'O CEP ' + formatarCep(c) + ' existe (' + fim + '), mas o OpenStreetMap nao achou o lugar.');
    }

    // Coordenada -> o endereco mais proximo que o OpenStreetMap conhece. O
    // `distanciaM` diz quao longe do pino fica o que ele achou: numa area rural
    // o "endereco" pode ser a estrada a 800 m, e a tela precisa dizer isso.
    async function buscarReverso(lat, lon) {
      if (!isFinite(lat) || !isFinite(lon)) throw erro('nada', 'Coordenada invalida.');
      await vezDoNominatim();
      const q = new URLSearchParams({
        format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'pt-BR',
        lat: (+lat).toFixed(6), lon: (+lon).toFixed(6)
      });
      const r = await pedirJson(URL_NOMINATIM_REVERSO + '?' + q.toString());
      if (!r || r.error || !r.address) throw erro('nada', 'O OpenStreetMap nao tem endereco para este ponto.');
      if (r.address.country_code && r.address.country_code !== 'br') {
        throw erro('nada', 'Este ponto fica fora do Brasil.');
      }
      const la = +r.lat, lo = +r.lon;
      const distanciaM = isFinite(la) && isFinite(lo) && raiz.Geo && raiz.Geo.distanciaKm
        ? Math.round(raiz.Geo.distanciaKm(lat, lon, la, lo) * 1000) : null;
      return { rotulo: rotuloDe(r), precisao: precisaoDe(r), distanciaM };
    }

    return { buscarCep, buscarTexto, buscarReverso };
  }

  const TEXTO_PRECISAO = {
    imovel: 'no numero',
    rua: 'pela rua, nao pelo numero',
    bairro: 'pelo bairro, aproximada',
    cidade: 'pelo centro do municipio, bem aproximada',
    manual: 'ajustada a mao no mapa'
  };

  // Para a lista de escolha, onde o espaco e curto.
  const TEXTO_PRECISAO_CURTO = { imovel: 'numero', rua: 'rua', bairro: 'bairro', cidade: 'cidade' };

  const api = {
    criar, lerCep, formatarCep, pareceEndereco, precisaoDe, rotuloDe, agrupar,
    TEXTO_PRECISAO, TEXTO_PRECISAO_CURTO
  };
  raiz.Endereco = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
