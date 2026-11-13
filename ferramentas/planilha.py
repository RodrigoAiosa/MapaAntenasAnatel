"""PLANILHA DAS ANTENAS - uma ERB por linha, mais resumos.

Abas:
  Estacoes      uma linha por estacao (ERB), com filtro e cabecalho congelado.
                As colunas 2G/3G/4G/5G sao "Sim"/vazio de proposito: filtrar
                "3G = Sim" no Excel e a pergunta mais comum (o 3G de voz).
  Por municipio quantas ERBs cada operadora tem em cada municipio.
  Resumo        operadora x geracao e UF x operadora.
  Fora do mapa  ERBs sem coordenada valida (aparece so se houver alguma).
  Sobre         fonte, data da base e as regras de consolidacao.

openpyxl em modo write_only: 114 mil linhas x 32 colunas sao 3,6 milhoes de
celulas, e o modo normal guardaria todas na memoria antes de gravar.
"""

from collections import Counter, defaultdict
from datetime import date

from consolidar import (GERACOES, NOMES_OPERADORA, OPERADORAS, nomes_geracoes,
                        nomes_tecnologias)

COLUNAS = [
    # (titulo, largura)
    ("Nº Estação", 12), ("Operadora", 11), ("Empresa (Anatel)", 16),
    ("Prestadora (razão social)", 30), ("CNPJ", 16), ("Nº Fistel", 13),
    ("UF", 5), ("Município", 24), ("Cód. IBGE", 10),
    ("Endereço", 34), ("Número", 8), ("Bairro", 22), ("Complemento", 22), ("CEP", 10),
    ("Latitude", 11), ("Longitude", 11),
    ("2G", 5), ("3G", 5), ("4G", 5), ("5G", 5),
    ("Gerações", 13), ("Tecnologias", 18), ("Faixas (MHz)", 20), ("Tipo 5G", 9),
    ("Setores", 8), ("Infraestrutura", 13), ("Caráter", 11),
    ("1º licenciamento", 13), ("Último licenciamento", 13), ("Validade", 11),
    ("Linhas na base", 9), ("Coord. divergente (km)", 12),
]


def _data(iso):
    if not iso:
        return None
    try:
        a, m, d = iso.split("-")
        return date(int(a), int(m), int(d))
    except ValueError:
        return None


def _estilos():
    from openpyxl.styles import Alignment, Font, PatternFill
    return {
        "cab_fonte": Font(bold=True, color="FFFFFF"),
        "cab_fundo": PatternFill("solid", fgColor="1E3A8A"),
        "cab_alinha": Alignment(vertical="center", wrap_text=True),
        "titulo": Font(bold=True, size=13),
        "negrito": Font(bold=True),
    }


def _cabecalho(ws, titulos, est):
    from openpyxl.cell import WriteOnlyCell
    linha = []
    for t in titulos:
        c = WriteOnlyCell(ws, value=t)
        c.font = est["cab_fonte"]
        c.fill = est["cab_fundo"]
        c.alignment = est["cab_alinha"]
        linha.append(c)
    ws.append(linha)


def _celula_data(ws, valor):
    from openpyxl.cell import WriteOnlyCell
    c = WriteOnlyCell(ws, value=valor)
    if valor is not None:
        c.number_format = "DD/MM/YYYY"
    return c


def _aba_estacoes(wb, estacoes, est):
    from openpyxl.utils import get_column_letter
    ws = wb.create_sheet("Estações")
    for i, (_, larg) in enumerate(COLUNAS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = larg
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(COLUNAS)), len(estacoes) + 1)
    _cabecalho(ws, [c[0] for c in COLUNAS], est)

    for e in estacoes:
        ger = e["geracoes"]
        ws.append([
            e["numero"],
            NOMES_OPERADORA[e["operadora"]],
            e["empresa"],
            e["prestadora"],
            e["cnpj"],
            e["fistel"],
            e["uf"],
            e["municipio"],
            e["ibge"],
            e["endereco"],
            e["end_numero"],
            e["bairro"],
            e["complemento"],
            e["cep"],
            e["lat"],
            e["lon"],
            "Sim" if ger & 1 else "",
            "Sim" if ger & 2 else "",
            "Sim" if ger & 4 else "",
            "Sim" if ger & 8 else "",
            " ".join(nomes_geracoes(ger)),
            " ".join(nomes_tecnologias(e["tecnologias"])),
            " ".join(str(f) for f in e["faixas"]),
            e["tipo5g"],
            e["setores"] or None,
            e["infra"],
            e["carater"],
            _celula_data(ws, _data(e["primeiro_lic"])),
            _celula_data(ws, _data(e["ultimo_lic"])),
            _celula_data(ws, _data(e["validade"])),
            e["linhas"],
            e["divergencia_km"] or None,
        ])


def _aba_municipios(wb, estacoes, est):
    from openpyxl.utils import get_column_letter
    ws = wb.create_sheet("Por município")
    titulos = (["UF", "Município", "Cód. IBGE", "Total de ERBs"] +
               [NOMES_OPERADORA[o] for o in OPERADORAS] +
               ["com 2G", "com 3G", "com 4G", "com 5G"])
    larguras = [5, 26, 10, 9] + [9] * len(OPERADORAS) + [8, 8, 8, 8]
    for i, w in enumerate(larguras, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    grupos = defaultdict(lambda: {"total": 0, "op": Counter(), "ger": Counter()})
    for e in estacoes:
        g = grupos[(e["uf"], e["municipio"], e["ibge"])]
        g["total"] += 1
        g["op"][e["operadora"]] += 1
        for i, nome in enumerate(GERACOES):
            if e["geracoes"] & (1 << i):
                g["ger"][nome] += 1

    ws.freeze_panes = "C2"
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(titulos)), len(grupos) + 1)
    _cabecalho(ws, titulos, est)
    for (uf, mun, ibge) in sorted(grupos):
        g = grupos[(uf, mun, ibge)]
        ws.append([uf, mun, ibge, g["total"]] +
                  [g["op"][o] or None for o in OPERADORAS] +
                  [g["ger"][n] or None for n in GERACOES])


def _aba_resumo(wb, estacoes, est):
    from openpyxl.cell import WriteOnlyCell
    ws = wb.create_sheet("Resumo")
    ws.column_dimensions["A"].width = 16
    for col in "BCDEFGHIJ":
        ws.column_dimensions[col].width = 11

    def titulo(txt):
        c = WriteOnlyCell(ws, value=txt)
        c.font = est["titulo"]
        ws.append([c])

    presentes = [o for o in OPERADORAS if any(e["operadora"] == o for e in estacoes)]

    titulo("ERBs por operadora e geração")
    ws.append(["Uma ERB com 2G, 3G e 4G conta nas três colunas de geração."])
    _cabecalho(ws, ["Operadora", "ERBs"] + ["com " + g for g in GERACOES], est)
    tot = Counter()
    ger = defaultdict(Counter)
    for e in estacoes:
        tot[e["operadora"]] += 1
        for i, nome in enumerate(GERACOES):
            if e["geracoes"] & (1 << i):
                ger[e["operadora"]][nome] += 1
    for o in presentes:
        ws.append([NOMES_OPERADORA[o], tot[o]] + [ger[o][g] for g in GERACOES])
    total = WriteOnlyCell(ws, value="Total")
    total.font = est["negrito"]
    ws.append([total, len(estacoes)] +
              [sum(ger[o][g] for o in presentes) for g in GERACOES])
    ws.append([])

    titulo("ERBs por UF e operadora")
    _cabecalho(ws, ["UF", "Total"] + [NOMES_OPERADORA[o] for o in presentes], est)
    por_uf = defaultdict(Counter)
    for e in estacoes:
        por_uf[e["uf"]][e["operadora"]] += 1
    for uf in sorted(por_uf):
        c = por_uf[uf]
        ws.append([uf, sum(c.values())] + [c[o] or None for o in presentes])


def _aba_fora(wb, fora, est):
    ws = wb.create_sheet("Fora do mapa")
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 11
    ws.column_dimensions["C"].width = 5
    ws.column_dimensions["D"].width = 24
    ws.column_dimensions["E"].width = 60
    _cabecalho(ws, ["Nº Estação", "Operadora", "UF", "Município", "Motivo"], est)
    for e in fora:
        ws.append([e["numero"], NOMES_OPERADORA[e["operadora"]], e["uf"], e["municipio"], e["motivo"]])


def _aba_sobre(wb, origem, info, est):
    from openpyxl.cell import WriteOnlyCell
    ws = wb.create_sheet("Sobre")
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 100
    t = WriteOnlyCell(ws, value="Antenas (ERBs) do Serviço Móvel Pessoal - base Anatel")
    t.font = est["titulo"]
    ws.append([t])
    ws.append([])
    linhas = [
        ("Fonte", origem.get("url", "")),
        ("Base atualizada pela Anatel em", origem.get("data_anatel", "") or "(desconhecido)"),
        ("Baixada em", origem.get("baixado_em", "") or "(desconhecido)"),
        ("Linhas no CSV da Anatel", info["linhas"]),
        ("Estações (ERBs) distintas", info["estacoes_lidas"]),
        ("ERBs nesta planilha / no mapa", info["no_mapa"]),
        ("ERBs fora do mapa (sem coordenada)", info["fora_do_mapa"]),
        ("ERBs com coordenada divergente", info["coord_divergente"]),
        ("", ""),
        ("Uma linha = uma estação", "O CSV da Anatel tem uma linha por estação x setor x frequência. "
         "Aqui cada Nº Estação vira uma linha; gerações, tecnologias e faixas são a união de todas as linhas dela."),
        ("Coordenada", "A mais frequente entre as linhas da estação, contando só as que caem no Brasil."),
        ("Coord. divergente (km)", "Preenchida quando a mesma estação aparece com outra coordenada a 1 km ou mais. "
         "Não foi corrigida: confira antes de confiar na posição."),
        ("Operadora", "Vem da coluna 'Empresa Estação'. Nome que não está na tabela vai para 'Outra' "
         "e o nome original fica na coluna 'Empresa (Anatel)'."),
        ("Campos vazios", "Ficam vazios. Infraestrutura, por exemplo, não é informada em boa parte da base."),
        ("Licença", "Dados abertos da Anatel. Cite a Anatel como fonte ao reutilizar."),
    ]
    for a, b in linhas:
        c = WriteOnlyCell(ws, value=a)
        c.font = est["negrito"]
        ws.append([c, b])


def escrever_planilha(caminho, estacoes, fora, info, origem):
    from openpyxl import Workbook
    est = _estilos()
    wb = Workbook(write_only=True)
    _aba_estacoes(wb, estacoes, est)
    _aba_municipios(wb, estacoes, est)
    _aba_resumo(wb, estacoes, est)
    if fora:
        _aba_fora(wb, fora, est)
    _aba_sobre(wb, origem, info, est)
    wb.save(caminho)
