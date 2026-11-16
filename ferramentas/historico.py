"""Evolucao das ERBs por ano, reconstruida da propria base da Anatel.

Cada linha da base traz a "Data Primeiro Licenciamento" da estacao naquela frequencia/
geracao. A menor data de cada geracao dentro de uma ERB diz quando ela passou a ter 2G, 3G,
4G ou 5G. Somando por UF, operadora, geracao e ano sai a curva de instalacao.

LIMITE (dito na tela): so entram ERBs que ainda constam na base. Antenas desativadas desde
entao nao aparecem, entao os anos antigos ficam subestimados. A serie "de verdade" (com
desligamentos) vem dos instantaneos guardados por scripts/instantaneo.py.
"""

import json
from datetime import date

GERACOES = ["2G", "3G", "4G", "5G"]


def montar(contagem, sem_data, operadoras, hoje=None):
    """contagem: {(uf, operadora, geracao, ano): n}. Devolve o dicionario do historico.json.

    Cada serie e a lista de ERBs NOVAS por ano (o navegador acumula), de anos[0] a anos[-1].
    """
    hoje = hoje or date.today()
    anos_com_dado = [a for (_, _, _, a) in contagem]
    if not anos_com_dado:
        return {"anos": [], "ops": list(operadoras), "gers": GERACOES, "uf": {}, "sem_data": sem_data}
    a0, a1 = min(anos_com_dado), max(max(anos_com_dado), hoje.year)
    n = a1 - a0 + 1
    saida = {}
    for (uf, op, g, ano), qtd in contagem.items():
        serie = saida.setdefault(uf, {}).setdefault(op, {}).setdefault(g, [0] * n)
        serie[ano - a0] += qtd
    return {
        "anos": list(range(a0, a1 + 1)),
        "ops": list(operadoras),
        "gers": GERACOES,
        "uf": {uf: saida[uf] for uf in sorted(saida)},
        "sem_data": sem_data,
        "gerado": hoje.isoformat(),
    }


def escrever(caminho, contagem, sem_data, operadoras, hoje=None):
    dados = montar(contagem, sem_data, operadoras, hoje)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return dados
