#!/usr/bin/env python3
"""Baixa o zip de cobertura movel da Anatel e grava, por UF, os percentuais de cobertura
por municipio (area e moradores), por operadora e tecnologia, em <saida>/<UF>.json
mais <saida>/indice.json.

Fonte: https://www.anatel.gov.br/dadosabertos/paineis_de_dados/infraestrutura/cobertura_movel.zip
O zip traz varios arquivos; este script le so o Cobertura_AAAA_MM_Municipios.csv mais recente:

  Codigo Municipio;Municipio;UF;Tecnologia;Operadora;Periodo;% area coberta;
  % moradores cobertos;% domicilios cobertos;Area (km2);Moradores;Domicilios

Tecnologia vem como '2G', '3G', '4G', '5G', ou unioes ('3G4G5G', '4G5G', 'Todas'):
a cobertura de QUALQUER das tecnologias do rotulo. Operadora inclui 'Todas'.
Os percentuais saem em fracao (0 a 1). E uma ESTIMATIVA da Anatel (modelo de
propagacao sobre o licenciamento), nao medicao.

  python3 scripts/baixar_cobertura_anatel.py public/dados/anatel [--zip arquivo.zip]
"""
import csv
import io
import json
import re
import sys
import tempfile
import time
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

URL = "https://www.anatel.gov.br/dadosabertos/paineis_de_dados/infraestrutura/cobertura_movel.zip"
PRAZO_DOWNLOAD = 240.0
ULTIMOS_NOMES = {}  # codigo IBGE -> nome, da ultima leitura (para as malhas)
RE_ARQUIVO = re.compile(r"Cobertura_(\d{4})_(\d{2})_Municipios\.csv$", re.I)


def norm(t):
    t = unicodedata.normalize("NFKD", t or "")
    return "".join(c for c in t if not unicodedata.combining(c)).strip().lower()


def numero(t):
    t = (t or "").strip().replace(",", ".")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def baixar(destino):
    req = urllib.request.Request(URL, headers={"User-Agent": "mapa-antenas-anatel/1.0"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=30) as r:
        while True:
            bloco = r.read(1 << 20)
            if not bloco:
                break
            destino.write(bloco)
            if time.monotonic() - t0 > PRAZO_DOWNLOAD:
                raise RuntimeError("download passou de %d s" % PRAZO_DOWNLOAD)
    destino.seek(0)


def escolher_arquivo(z):
    candidatos = sorted((i for i in z.infolist() if RE_ARQUIVO.search(i.filename)),
                        key=lambda i: RE_ARQUIVO.search(i.filename).groups())
    if not candidatos:
        raise RuntimeError("o zip nao traz Cobertura_AAAA_MM_Municipios.csv: " +
                           ", ".join(i.filename for i in z.infolist()))
    return candidatos[-1]


def ler_municipios(fluxo):
    """fluxo: arquivo binario do CSV. Devolve (por_uf, ops, tecs, periodos, nomes)."""
    texto = io.TextIOWrapper(fluxo, encoding="utf-8-sig", newline="")
    leitor = csv.reader(texto, delimiter=";")
    cab = [norm(c) for c in next(leitor)]

    def col(*nomes):
        for n in nomes:
            if n in cab:
                return cab.index(n)
        raise RuntimeError("coluna ausente %s; cabecalho: %s" % (nomes, cab))

    i_cod = col("codigo municipio")
    i_nome = col("municipio")
    i_uf = col("uf")
    i_tec = col("tecnologia")
    i_op = col("operadora")
    i_per = col("periodo")
    i_area = col("% area coberta")
    i_mor = col("% moradores cobertos")
    i_km2 = col("area (km2)")
    i_pop = col("moradores")

    ops, tecs = [], []
    por_uf = {}
    nomes = {}
    linhas = []
    for row in leitor:
        if len(row) <= max(i_nome, i_cod, i_uf, i_tec, i_op, i_per, i_area, i_mor, i_km2, i_pop):
            continue
        a, m = numero(row[i_area]), numero(row[i_mor])
        if a is None or m is None:
            continue
        nomes[row[i_cod].strip()] = row[i_nome].strip()
        linhas.append((row[i_cod].strip(), row[i_uf].strip().upper(), row[i_tec].strip(),
                       row[i_op].strip(), row[i_per].strip(), a, m,
                       numero(row[i_km2]), numero(row[i_pop])))
    if not linhas:
        raise RuntimeError("nenhuma linha util no CSV de municipios")
    # Se tudo vier em 0..1 e fracao; se passar de 1, e percentual (0..100).
    escala = 1.0 if max(max(l[5], l[6]) for l in linhas) <= 1.0 + 1e-9 else 100.0
    for cod, uf, tec, op, per, a, m, km2, pop in linhas:
        if tec not in tecs:
            tecs.append(tec)
        if op not in ops:
            ops.append(op)
        reg = por_uf.setdefault(uf, {}).setdefault(cod, {"a": None, "p": None, "d": []})
        if km2 is not None:
            reg["a"] = round(km2, 1)
        if pop is not None:
            reg["p"] = int(round(pop))
        reg["d"].append([ops.index(op), tecs.index(tec), round(a / escala, 4), round(m / escala, 4)])
    return por_uf, ops, tecs, sorted({l[4] for l in linhas if l[4]}), nomes


def executar(pasta, zip_local=None):
    pasta = Path(pasta)
    with tempfile.TemporaryFile() as tmp:
        if zip_local:
            tmp.write(Path(zip_local).read_bytes())
            tmp.seek(0)
        else:
            baixar(tmp)
        z = zipfile.ZipFile(tmp)
        info = escolher_arquivo(z)
        with z.open(info) as f:
            por_uf, ops, tecs, periodos, nomes = ler_municipios(f)
    pasta.mkdir(parents=True, exist_ok=True)
    m = RE_ARQUIVO.search(info.filename)
    periodo = "%s-%s" % (m.group(2), m.group(1))  # MM-AAAA, como a Anatel escreve
    for uf, muns in por_uf.items():
        (pasta / (uf + ".json")).write_text(
            json.dumps({"uf": uf, "periodo": periodo, "ops": ops, "tecs": tecs, "m": muns},
                       ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (pasta / "indice.json").write_text(json.dumps(
        {"ufs": sorted(por_uf), "periodo": periodo, "ops": ops, "tecs": tecs,
         "fonte": "Anatel, Painel Cobertura Movel (estimativa)"}, ensure_ascii=False), encoding="utf-8")
    print("cobertura Anatel: %s, %d UFs, operadoras=%s, tecnologias=%s, periodos no arquivo=%s" % (
        info.filename, len(por_uf), ops, tecs, periodos))
    ULTIMOS_NOMES.clear()
    ULTIMOS_NOMES.update(nomes)
    return sorted(por_uf)


if __name__ == "__main__":
    destino = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "public/dados/anatel"
    zl = sys.argv[sys.argv.index("--zip") + 1] if "--zip" in sys.argv else None
    executar(destino, zl)
