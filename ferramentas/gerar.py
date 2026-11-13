"""GERADOR DO MAPA DE ANTENAS - roda depois de cada download da base.

    python ferramentas/gerar.py [--uf SC,PR] [--sem-planilha] [--sem-mapa] [--zip caminho.zip]

Le o zip da Anatel (dados_anatel/estacoes_smp.zip, baixado pelo
coletar/baixar_anatel.py), consolida uma linha por ERB e escreve:

    MapaDeAntenas.html                    arquivo unico; abrir pelo ABRIR_MAPA.bat
                                          (por duplo clique o mapa base cai no
                                          servidor de reserva, bem mais lento)
    Antenas_SMP_Anatel_<data>.xlsx        a mesma base, em planilha
    RELATORIO_GERACAO.txt                 contagens e conferencia

--uf gera so as UFs pedidas (mapa e planilha menores, nome com sufixo _SC_PR).

INVARIANTE: nenhuma ERB some em silencio. Toda estacao lida ou entra no mapa
ou aparece no relatorio (e na aba "Fora do mapa") com o motivo.

Aqui nao ha dado pessoal: e base publica da
Anatel, pode circular. Por isso o mapa e a planilha saem na raiz do projeto.
"""

import argparse
import base64
import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
sys.path.insert(0, str(AQUI))

from consolidar import (EMPRESA_PARA_OPERADORA, GERACOES, NOMES_OPERADORA,  # noqa: E402
                        OPERADORAS, TECNOLOGIAS, consolidar, ler_linhas_do_zip)

ZIP_PADRAO = RAIZ / "dados_anatel" / "estacoes_smp.zip"
ORIGEM = RAIZ / "dados_anatel" / "origem.json"
MODELO = RAIZ / "app" / "modelo.html"


def limpar(s):
    """'|' separa campo e '\\n' separa registro: nenhum dos dois pode vazar de um valor."""
    return " ".join(str(s).replace("|", " ").split())


def como_literal(valor):
    # json.dumps resolve aspas e controle, mas NAO "</script>" nem "<!--":
    # um endereco com isso fecharia a tag e derrubaria a pagina inteira.
    return (json.dumps(valor, ensure_ascii=False)
            .replace("</", "<\\/")
            .replace("<!--", "<\\!--"))


def endereco_curto(e):
    rua = e["endereco"]
    if e["end_numero"] and e["end_numero"].upper() not in ("S/N", "SN", "0"):
        rua = (rua + ", " + e["end_numero"]) if rua else e["end_numero"]
    if e["bairro"]:
        rua = (rua + " - " + e["bairro"]) if rua else e["bairro"]
    return rua


def bloco_dados(estacoes, info, origem):
    municipios, idx_mun = [], {}
    infras, idx_inf = [""], {"": 0}
    # As faixas vao como BITS sobre a lista das que existem na base (sao 10 no
    # Brasil inteiro): "700 850 1800 2100 2300 2500" em cada uma das 114 mil
    # ERBs custava ~2,5 MB no HTML; o numero equivalente cabe em 1 a 4 digitos.
    faixas = sorted({f for e in estacoes for f in e["faixas"]})
    if len(faixas) > 31:
        raise SystemExit("ERRO: %d faixas distintas nao cabem num inteiro de bits do JS." % len(faixas))
    bit_faixa = {f: 1 << i for i, f in enumerate(faixas)}
    linhas = []
    for e in estacoes:
        chave = (e["municipio"], e["uf"])
        if chave not in idx_mun:
            idx_mun[chave] = len(municipios)
            municipios.append([e["municipio"], e["uf"], e["ibge"]])
        if e["infra"] not in idx_inf:
            idx_inf[e["infra"]] = len(infras)
            infras.append(e["infra"])

        # flags: 1=coordenada divergente  2=5G NSA  4=5G SA
        flags = 0
        if e["divergencia_km"]:
            flags |= 1
        partes5g = set(e["tipo5g"].replace("-", "/").split("/")) if e["tipo5g"] else set()
        if "NSA" in partes5g:
            flags |= 2
        if "SA" in partes5g:
            flags |= 4

        linhas.append("|".join([
            "%.5f" % e["lat"],
            "%.5f" % e["lon"],
            limpar(e["numero"]),
            str(OPERADORAS.index(e["operadora"])),
            str(e["geracoes"]),
            str(idx_mun[chave]),
            limpar(endereco_curto(e)),
            str(sum(bit_faixa[f] for f in e["faixas"])),
            str(idx_inf[e["infra"]]),
            e["primeiro_lic"][:7],
            str(e["setores"] or ""),
            str(e["tecnologias"]),
            str(flags),
            ("%.1f" % e["divergencia_km"]) if e["divergencia_km"] else "",
            # O nome cru so vai quando a categoria o escondeu ("Outra").
            limpar(e["empresa"]) if e["operadora"] == "outra" else "",
        ]))

    return (
        "// Gerado por ferramentas/gerar.py - NAO EDITE A MAO.\n"
        "// Registros: lat|lon|numero|operadora|geracoes|municipio|endereco|faixas|infra|"
        "licenciada_desde|setores|tecnologias|flags|divergencia_km|empresa\n"
        "// geracoes: bits 1=2G 2=3G 4=4G 8=5G. tecnologias: bits na ordem de ANT_TECNOLOGIAS.\n"
        "// faixas: bits na ordem de ANT_FAIXAS (MHz).\n"
        "// flags: 1=coordenada divergente 2=5G NSA 4=5G SA.\n"
        "var ANT_FAIXAS = " + como_literal(faixas) + ";\n"
        "var ANT_OPERADORAS = " + como_literal(OPERADORAS) + ";\n"
        "var ANT_NOMES_OPERADORA = " + como_literal(NOMES_OPERADORA) + ";\n"
        "var ANT_GERACOES = " + como_literal(GERACOES) + ";\n"
        "var ANT_TECNOLOGIAS = " + como_literal(TECNOLOGIAS) + ";\n"
        "var ANT_MUNICIPIOS = " + como_literal(municipios) + ";\n"
        "var ANT_INFRAS = " + como_literal(infras) + ";\n"
        "var ANT_ORIGEM = " + como_literal({
            "data_anatel": origem.get("data_anatel", ""),
            "baixado_em": origem.get("baixado_em", ""),
            "url": origem.get("url", ""),
        }) + ";\n"
        "var ANT_TOTAL = " + str(len(linhas)) + ";\n"
        "var ANT_FORA = " + str(info["fora_do_mapa"]) + ";\n"
        "var ANT_TXT = " + como_literal("\n".join(linhas)) + ";\n"
    )


def fontes_css():
    # Inter e Montserrat embutidas (Fontsource, licenca OFL, vendor/LICENSE-*.txt),
    # o mapa abre offline com a tipografia certa.
    regras = []
    for familia, arquivo in (("Inter", "inter-latin-wght.woff2"),
                             ("Montserrat", "montserrat-latin-wght.woff2")):
        dados = base64.b64encode((AQUI / "vendor" / arquivo).read_bytes()).decode("ascii")
        regras.append("@font-face{font-family:'%s';font-style:normal;font-weight:100 900;"
                      "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2');}"
                      % (familia, dados))
    return "\n".join(regras)


def montar_html(destino, estacoes, info, origem):
    def ler(rel):
        return (RAIZ / rel).read_text(encoding="utf-8")

    partes = {
        "FONTES_CSS": fontes_css,
        "LEAFLET_CSS": lambda: ler("ferramentas/vendor/leaflet.css"),
        "LEAFLET_JS": lambda: ler("ferramentas/vendor/leaflet.js"),
        "DADOS": lambda: bloco_dados(estacoes, info, origem),
        "GEO_JS": lambda: ler("app/js/geo.js"),
        "ENDERECO_JS": lambda: ler("app/js/endereco.js"),
        "COBERTURA_JS": lambda: ler("app/js/cobertura.js"),
        "APP_JS": lambda: ler("app/js/app.js"),
    }
    html = MODELO.read_text(encoding="utf-8")
    for nome, conteudo in partes.items():
        marcador = "/*INSERIR:" + nome + "*/"
        if marcador not in html:
            raise SystemExit("ERRO: o marcador %s sumiu de app/modelo.html." % marcador)
        # str.replace nao interpreta nada do conteudo (ao contrario de re.sub,
        # onde um "\1" dentro do Leaflet viraria referencia de grupo).
        html = html.replace(marcador, conteudo(), 1)
    if "/*INSERIR:" in html:
        raise SystemExit("ERRO: sobrou marcador de insercao no HTML final.")
    destino.write_text(html, encoding="utf-8")


def relatorio(info, estacoes, fora, origem, saidas, ufs, segundos):
    L = []
    L.append("RELATORIO DE GERACAO - MAPA DE ANTENAS (ERBs do SMP, base Anatel)")
    L.append("=" * 72)
    L.append("Base Anatel ..: " + (origem.get("data_anatel") or "(sem data)"))
    L.append("Baixada em ...: " + (origem.get("baixado_em") or "(sem data)"))
    L.append("Gerado em ....: " + datetime.now().strftime("%d/%m/%Y %H:%M"))
    if ufs:
        L.append("Recorte ......: so " + ", ".join(ufs))
    L.append("")
    L.append("ENTRADA")
    L.append("-" * 72)
    L.append("  Linhas no CSV da Anatel ...................... %10d" % info["linhas"])
    L.append("  Linhas sem numero de estacao (ignoradas) ..... %10d" % info["linhas_sem_numero"])
    L.append("  Estacoes (ERBs) distintas .................... %10d" % info.get("estacoes_nacionais", info["estacoes_lidas"]))
    L.append("")
    L.append("SAIDA")
    L.append("-" * 72)
    L.append("  ERBs no mapa e na planilha ................... %10d" % len(estacoes))
    L.append("  ERBs fora do mapa (sem coordenada valida) .... %10d" % len(fora))
    L.append("  ERBs com coordenada divergente (>= 1 km) ..... %10d" % info["coord_divergente"])
    confere = info["estacoes_lidas"] == info["no_mapa"] + info["fora_do_mapa"]
    L.append("")
    L.append("  Conferencia: %d lidas = %d no mapa + %d fora%s" % (
        info["estacoes_lidas"], info["no_mapa"], info["fora_do_mapa"],
        "   OK" if confere else "   *** DIVERGENTE ***"))
    L.append("")
    L.append("  Por operadora:" + ("  (recorte)" if ufs else ""))
    por_op = Counter(e["operadora"] for e in estacoes)
    for o in OPERADORAS:
        n = por_op.get(o, 0)
        pct = (n * 100 / len(estacoes)) if estacoes else 0
        L.append("    %-12s %8d   %5.1f%%" % (NOMES_OPERADORA[o], n, pct))
    L.append("")
    L.append("  Por geracao (uma ERB conta em cada geracao que tem):")
    for i, g in enumerate(GERACOES):
        n = sum(1 for e in estacoes if e["geracoes"] & (1 << i))
        L.append("    %-12s %8d" % (g, n))
    L.append("")
    L.append("  Valores crus de 'Empresa Estacao' (base inteira):")
    for nome, n in sorted(info["empresas_cruas"].items(), key=lambda kv: -kv[1]):
        cat = EMPRESA_PARA_OPERADORA.get(nome)
        L.append("    %-52s %7d   %s" % (nome[:52], n, ("-> " + cat) if cat else "-> outra"))
    L.append("")
    if fora:
        L.append("FORA DO MAPA - lista nominal (%d)" % len(fora))
        L.append("-" * 72)
        for e in fora[:300]:
            L.append("  %s | %-10s | %-26s | %s" % (e["numero"].ljust(11), NOMES_OPERADORA[e["operadora"]],
                                                   (e["municipio"] + "/" + e["uf"])[:26], e["motivo"]))
        if len(fora) > 300:
            L.append("  ... e mais %d (lista completa na aba 'Fora do mapa')." % (len(fora) - 300))
        L.append("")
    L.append("ARQUIVOS")
    L.append("-" * 72)
    for p in saidas:
        L.append("  %-40s %8.2f MB" % (p.name, p.stat().st_size / 1048576))
    L.append("")
    L.append("Tempo total: %.0f s" % segundos)
    L.append("")
    return "\n".join(L), confere


def main(argv=None):
    ap = argparse.ArgumentParser(description="Gera o Mapa de Antenas e a planilha a partir da base da Anatel.")
    ap.add_argument("--zip", type=Path, default=ZIP_PADRAO)
    ap.add_argument("--uf", default="", help="recorte por UF, ex.: SC ou SC,PR,RS")
    ap.add_argument("--sem-planilha", action="store_true")
    ap.add_argument("--sem-mapa", action="store_true")
    ap.add_argument("--saida", type=Path, default=RAIZ, help="pasta de saida (padrao: raiz do projeto)")
    args = ap.parse_args(argv)

    if not args.zip.exists():
        print("\nNao encontrei a base da Anatel:\n  %s\n\nRode primeiro a opcao 1 do INICIAR.bat "
              "(baixar da Anatel).\n" % args.zip)
        return 1
    try:
        origem = json.loads(ORIGEM.read_text(encoding="utf-8")) if args.zip == ZIP_PADRAO else {}
    except (OSError, ValueError):
        origem = {}
    if not origem.get("data_anatel"):
        # Sem origem.json (zip copiado a mao): a data do proprio arquivo e o
        # melhor que se tem, e o relatorio diz de onde ela veio.
        origem.setdefault("data_anatel", datetime.fromtimestamp(args.zip.stat().st_mtime)
                          .strftime("%d/%m/%Y %H:%M") + " (data do arquivo)")
    origem.setdefault("url", "https://www.anatel.gov.br/dadosabertos/paineis_de_dados/"
                             "outorga_e_licenciamento/estacoes_smp.zip")

    t0 = time.time()
    print("Lendo %s (3,3 milhoes de linhas, ~1 minuto)..." % args.zip.name)
    estacoes, fora, info = consolidar(ler_linhas_do_zip(args.zip))
    print("  %d ERBs consolidadas em %.0f s" % (info["estacoes_lidas"], time.time() - t0))

    ufs = [u.strip().upper() for u in args.uf.split(",") if u.strip()]
    if ufs:
        estacoes = [e for e in estacoes if e["uf"] in ufs]
        fora = [e for e in fora if e["uf"] in ufs]
        if not estacoes:
            print("Nenhuma ERB nas UFs pedidas: %s" % ", ".join(ufs))
            return 1
        # Contagens do recorte, não as nacionais: o HTML e a aba Sobre dizem
        # "nesta planilha / no mapa" (R15, revisão de 19/10/2026).
        info = dict(info, estacoes_nacionais=info["estacoes_lidas"],
                    estacoes_lidas=len(estacoes) + len(fora), no_mapa=len(estacoes),
                    fora_do_mapa=len(fora),
                    coord_divergente=sum(1 for e in estacoes if e.get("divergencia_km")))
    sufixo = ("_" + "_".join(ufs)) if ufs else ""

    data_base = origem.get("last_modified", "")
    try:
        from email.utils import parsedate_to_datetime
        data_arq = parsedate_to_datetime(data_base).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        data_arq = datetime.fromtimestamp(args.zip.stat().st_mtime).strftime("%Y-%m-%d")

    args.saida.mkdir(parents=True, exist_ok=True)
    saidas = []
    if not args.sem_mapa:
        html = args.saida / ("MapaDeAntenas%s.html" % sufixo)
        montar_html(html, estacoes, info, origem)
        saidas.append(html)
        print("  mapa ......: %s" % html)
    if not args.sem_planilha:
        from planilha import escrever_planilha
        xlsx = args.saida / ("Antenas_SMP_Anatel_%s%s.xlsx" % (data_arq, sufixo))
        print("  escrevendo a planilha (%d linhas)..." % len(estacoes))
        escrever_planilha(xlsx, estacoes, fora, info, origem)
        saidas.append(xlsx)
        print("  planilha ..: %s" % xlsx)

    texto, confere = relatorio(info, estacoes, fora, origem, saidas, ufs, time.time() - t0)
    (args.saida / ("RELATORIO_GERACAO%s.txt" % sufixo)).write_text(texto, encoding="utf-8")
    print("\n" + texto)
    if not confere:
        print("*** A CONFERENCIA NAO BATEU - nao distribua estes arquivos. ***")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
