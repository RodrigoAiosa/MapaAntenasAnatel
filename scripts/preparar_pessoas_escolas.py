"""Prepara os dados de POPULACAO POR SETOR e de ESCOLAS, ja compactos, para o painel
"Sem cobertura". Roda no GitHub Actions (workflow "Preparar populacao e escolas"), nao no
build da Vercel: baixa ~700 MB e leva alguns minutos. O resultado vai para dados_prontos/
e o build so copia.

    python3 scripts/preparar_pessoas_escolas.py dados_prontos [--ufs SC,PR] [--so pessoas|escolas]

Fontes (abertas):
  * IBGE, Censo 2022: CSV "Agregados por setores - basico" (v0001 = pessoas) e contornos dos
    setores (shapefile por UF). O ponto de cada setor e o centroide do maior anel do contorno.
  * geobr/IPEA (schools_2023.gpkg), a partir do Catalogo de Escolas do INEP, com coordenadas
    do INEP conferidas por geocodificacao.

Saidas:
  dados_prontos/pessoas/<UF>.json  {"uf","mun":[[cod,nome]],"p":[x,y,pessoas,iMun, ...]}
        x = longitude*1e4 e y = latitude*1e4, inteiros (11 m de resolucao).
  dados_prontos/escolas/<UF>.json  {"uf","mun":[nome],"e":[[codINEP,lat,lon,nome,iMun,flags],...]}
        flags: 1 = privada, 2 = urbana.
  dados_prontos/pessoas/indice.json, escolas/indice.json  {"ufs":[...],"fonte","ano"}
So biblioteca padrao + pyshp (pip install pyshp).
"""

import argparse
import csv
import io
import json
import math
import sqlite3
import struct
import sys
import urllib.request
import zipfile
from multiprocessing import Pool
from pathlib import Path

UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
       "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]
IBGE = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/"
URL_BASICO = IBGE + "Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip"
URL_SHP = ("https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/"
           "malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/"
           "{uf}_setores_CD2022.zip")
URL_ESCOLAS = "https://github.com/ipea/geobr/releases/download/v1.7.0/schools_2023.gpkg"
ANO_ESCOLAS = 2023
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -34.0, 5.5, -74.5, -28.0


def baixar(url, destino, tentativas=3):
    ultimo = None
    for _ in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "mapa-antenas-anatel"})
            with urllib.request.urlopen(req, timeout=120) as r, open(destino, "wb") as f:
                while True:
                    bloco = r.read(1 << 20)
                    if not bloco:
                        break
                    f.write(bloco)
            return
        except Exception as e:  # noqa: BLE001 - tenta de novo e depois reclama
            ultimo = e
    raise RuntimeError("falhou %s: %s" % (url, ultimo))


# ------------------------------------------------------------------ escolas (GeoPackage)

def ponto_do_gpkg(blob):
    """Le (lon, lat) de um blob de geometria GeoPackage com um ponto WKB. None se vazio."""
    if not blob or len(blob) < 21 or blob[0:2] != b"GP":
        return None
    flags = blob[3]
    if flags & 0b00010000:          # geometria vazia
        return None
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get((flags >> 1) & 7)
    if env is None:
        return None
    wkb = blob[8 + env:]
    if len(wkb) < 21:
        return None
    fmt = "<" if wkb[0] == 1 else ">"
    tipo = struct.unpack(fmt + "I", wkb[1:5])[0] & 0xFFFF
    if tipo != 1:
        return None
    x, y = struct.unpack(fmt + "dd", wkb[5:21])
    if x != x or y != y:
        return None
    return x, y


def dentro_do_brasil(lat, lon):
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def escolas_do_gpkg(caminho):
    """Devolve ({uf: {"mun": [nomes], "e": [linhas]}}, estatisticas)."""
    con = sqlite3.connect(str(caminho))
    tabela = con.execute("select table_name from gpkg_contents").fetchone()[0]
    colunas = [r[1] for r in con.execute('pragma table_info("%s")' % tabela)]
    falta = {"geom", "abbrev_state", "name_muni", "code_school", "name_school",
             "admin_category", "urban"} - set(colunas)
    if falta:
        raise RuntimeError("colunas esperadas nao existem no gpkg: %s" % sorted(falta))
    cur = con.execute('select geom, abbrev_state, name_muni, code_school, name_school, '
                      'admin_category, urban from "%s"' % tabela)
    por_uf, ind_mun = {}, {}
    est = {"lidas": 0, "sem_ponto": 0, "fora_do_brasil": 0, "sem_uf": 0}
    for geom, uf, mun, cod, nome, adm, urb in cur:
        est["lidas"] += 1
        uf = (uf or "").strip().upper()
        if uf not in UFS:
            est["sem_uf"] += 1
            continue
        p = ponto_do_gpkg(geom)
        if p is None:
            est["sem_ponto"] += 1
            continue
        lon, lat = p
        if not dentro_do_brasil(lat, lon):
            est["fora_do_brasil"] += 1
            continue
        d = por_uf.setdefault(uf, {"mun": [], "e": []})
        idx = ind_mun.setdefault(uf, {})
        mun = (mun or "").strip()
        if mun not in idx:
            idx[mun] = len(d["mun"])
            d["mun"].append(mun)
        flags = (1 if (adm or "").strip().lower().startswith("priv") else 0) | \
                (2 if (urb in (1, True, "1") or str(urb).strip().lower() in ("sim", "urbana", "true")) else 0)
        d["e"].append([int(cod) if str(cod).isdigit() else 0, round(lat, 5), round(lon, 5),
                       (nome or "").strip(), idx[mun], flags])
    con.close()
    est["publicadas"] = sum(len(d["e"]) for d in por_uf.values())
    return por_uf, est


# ------------------------------------------------------------------ setores (populacao)

def numero_br(txt):
    """'1.234' nao existe no CSV do IBGE; o ponto sozinho significa 'sem dado'."""
    t = (txt or "").strip().strip('"')
    if not t or t == ".":
        return 0
    try:
        return int(float(t.replace(",", ".")))
    except ValueError:
        return 0


def ler_basico(caminho_zip):
    """{CD_SETOR: (pessoas, cod_mun, nome_mun)} do CSV nacional."""
    z = zipfile.ZipFile(caminho_zip)
    nome = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    texto = io.TextIOWrapper(z.open(nome), encoding="latin-1", newline="")
    saida = {}
    for r in csv.DictReader(texto, delimiter=";"):
        saida[(r.get("CD_SETOR") or "").strip()] = (
            numero_br(r.get("v0001")), (r.get("CD_MUN") or "").strip(), (r.get("NM_MUN") or "").strip())
    return saida


def centroide_do_anel(pontos):
    """Centroide por area (formula do sapateiro). Devolve (x, y, area_com_sinal)."""
    a = cx = cy = 0.0
    n = len(pontos)
    for i in range(n - 1):
        x0, y0 = pontos[i]
        x1, y1 = pontos[i + 1]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a *= 0.5
    if abs(a) < 1e-18:
        xs = [p[0] for p in pontos]
        ys = [p[1] for p in pontos]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (6 * a), cy / (6 * a), a


def centroide_do_poligono(pontos, partes):
    """Centroide do MAIOR anel externo (area absoluta). pontos: [(x,y)], partes: indices de inicio."""
    if not pontos:
        return None
    limites = list(partes) + [len(pontos)]
    melhor = None
    for i in range(len(partes)):
        anel = pontos[limites[i]:limites[i + 1]]
        if len(anel) < 2:
            continue
        x, y, a = centroide_do_anel(anel)
        if melhor is None or abs(a) > abs(melhor[2]):
            melhor = (x, y, a)
    return None if melhor is None else (melhor[0], melhor[1])


def pessoas_da_uf(uf, basico, pasta_tmp):
    """Baixa o shapefile da UF e devolve ({'uf','mun','p'}, estatisticas)."""
    import shapefile  # pyshp
    zip_uf = Path(pasta_tmp) / (uf + ".zip")
    baixar(URL_SHP.format(uf=uf), zip_uf)
    z = zipfile.ZipFile(zip_uf)
    por_ext = {Path(n).suffix.lower(): n for n in z.namelist()}
    leitor = shapefile.Reader(shp=io.BytesIO(z.read(por_ext[".shp"])),
                              shx=io.BytesIO(z.read(por_ext[".shx"])),
                              dbf=io.BytesIO(z.read(por_ext[".dbf"])), encoding="latin-1")
    campos = [c[0] for c in leitor.fields[1:]]
    i_setor = campos.index("CD_SETOR")
    mun, ind_mun, p = [], {}, []
    est = {"setores": 0, "sem_dado": 0, "sem_geometria": 0, "pessoas": 0}
    for sr in leitor.iterShapeRecords():
        est["setores"] += 1
        cod = str(sr.record[i_setor]).strip()
        dado = basico.get(cod)
        if dado is None:
            est["sem_dado"] += 1
            continue
        pessoas, cmun, nmun = dado
        c = centroide_do_poligono(sr.shape.points, sr.shape.parts)
        if c is None or not dentro_do_brasil(c[1], c[0]):
            est["sem_geometria"] += 1
            continue
        if pessoas <= 0:
            continue
        if cmun not in ind_mun:
            ind_mun[cmun] = len(mun)
            mun.append([cmun, nmun])
        p += [int(round(c[0] * 1e4)), int(round(c[1] * 1e4)), pessoas, ind_mun[cmun]]
        est["pessoas"] += pessoas
    zip_uf.unlink()
    return {"uf": uf, "mun": mun, "p": p}, est


def _trabalho(args):
    uf, basico, tmp = args
    try:
        dados, est = pessoas_da_uf(uf, basico, tmp)
        return uf, dados, est, None
    except Exception as e:  # noqa: BLE001
        return uf, None, None, "%s: %s" % (type(e).__name__, e)


def escrever_json(caminho, obj):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pasta")
    ap.add_argument("--ufs", default="")
    ap.add_argument("--so", choices=["pessoas", "escolas"], default="")
    ap.add_argument("--paralelo", type=int, default=3)
    args = ap.parse_args(argv)
    pasta = Path(args.pasta)
    ufs = [u for u in (args.ufs.upper().split(",") if args.ufs else UFS) if u in UFS]
    tmp = Path(args.pasta) / ".tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    falhas = []

    if args.so in ("", "escolas"):
        print("escolas: baixando %s" % URL_ESCOLAS, flush=True)
        gp = tmp / "escolas.gpkg"
        baixar(URL_ESCOLAS, gp)
        por_uf, est = escolas_do_gpkg(gp)
        gp.unlink()
        print("escolas:", est, flush=True)
        feitas = []
        for uf in ufs:
            if uf in por_uf:
                escrever_json(pasta / "escolas" / (uf + ".json"), dict(uf=uf, **por_uf[uf]))
                feitas.append(uf)
        escrever_json(pasta / "escolas" / "indice.json",
                      {"ufs": feitas, "fonte": "INEP, Catalogo de Escolas, via geobr/IPEA", "ano": ANO_ESCOLAS})
        print("escolas: %d UFs, %d escolas" % (len(feitas), sum(len(por_uf[u]["e"]) for u in feitas)), flush=True)

    if args.so in ("", "pessoas"):
        print("pessoas: baixando o CSV basico", flush=True)
        zb = tmp / "basico.zip"
        baixar(URL_BASICO, zb)
        basico = ler_basico(zb)
        zb.unlink()
        print("pessoas: %d setores no CSV" % len(basico), flush=True)
        feitas = []
        with Pool(max(1, args.paralelo)) as pool:
            for uf, dados, est, erro in pool.imap_unordered(_trabalho, [(u, basico, str(tmp)) for u in ufs]):
                if erro:
                    falhas.append(uf)
                    print("pessoas: %s FALHOU (%s)" % (uf, erro), flush=True)
                    continue
                escrever_json(pasta / "pessoas" / (uf + ".json"), dados)
                feitas.append(uf)
                print("pessoas: %s %s" % (uf, est), flush=True)
        escrever_json(pasta / "pessoas" / "indice.json",
                      {"ufs": sorted(feitas), "fonte": "IBGE, Censo Demografico 2022, agregados por setor", "ano": 2022})
    try:
        tmp.rmdir()
    except OSError:
        pass
    if falhas:
        print("FALHARAM: %s" % ", ".join(falhas))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
