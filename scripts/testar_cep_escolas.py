"""TESTE: da para recuperar a posicao das escolas sem coordenada pelo CEP do endereco?

Mede duas coisas numa UF (padrao SP):
  1) PRECISAO: pega escolas que TEM coordenada, geocodifica o CEP delas e compara com a
     coordenada do INEP (distancia em km). Diz quanto o CEP erra.
  2) COBERTURA: tenta as escolas SEM coordenada e conta quantas o servico de CEP resolve.

    python3 scripts/testar_cep_escolas.py SP --amostra 200 --faltantes 300
Nada e gravado: so imprime as estatisticas.
"""
import argparse
import json
import math
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preparar_pessoas_escolas as P  # noqa: E402

CEP = re.compile(r"\b(\d{5})-?(\d{3})\b")


def cep_do_endereco(txt):
    m = CEP.search(txt or "")
    return (m.group(1) + m.group(2)) if m else ""


def km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def geocodificar(cep, espera=0.25):
    """BrasilAPI v2 -> (lat, lon, servico) ou None. Respeita 429 esperando."""
    url = "https://brasilapi.com.br/api/cep/v2/" + cep
    for tentativa in range(4):
        try:
            time.sleep(espera)
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mapa-antenas"}), timeout=20) as r:
                d = json.load(r)
            c = (d.get("location") or {}).get("coordinates") or {}
            if c.get("latitude") and c.get("longitude"):
                return float(c["latitude"]), float(c["longitude"]), d.get("service", "")
            return None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3 * (tentativa + 1))
                continue
            return None
        except Exception:  # noqa: BLE001
            time.sleep(1)
    return None


def pct(v, q):
    v = sorted(v)
    return v[min(len(v) - 1, int(q * len(v)))] if v else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("uf")
    ap.add_argument("--amostra", type=int, default=200)
    ap.add_argument("--faltantes", type=int, default=300)
    a = ap.parse_args()
    gp = Path("/tmp/escolas.gpkg")
    if not gp.exists():
        P.baixar(P.URL_ESCOLAS, gp)
    con = sqlite3.connect(str(gp))
    tab = con.execute("select table_name from gpkg_contents").fetchone()[0]
    com, sem = [], []
    for geom, uf, mun, nome, end in con.execute('select geom, abbrev_state, name_muni, name_school, address from "%s"' % tab):
        if (uf or "").upper() != a.uf.upper():
            continue
        cep = cep_do_endereco(end)
        pt = P.ponto_do_gpkg(geom)
        (com if pt else sem).append((pt, cep, mun, nome, end))
    print("%s: %d com coordenada, %d sem" % (a.uf, len(com), len(sem)))
    print("  com CEP no endereco: %d/%d (com coord), %d/%d (sem coord)" % (
        sum(1 for x in com if x[1]), len(com), sum(1 for x in sem if x[1]), len(sem)))
    random.seed(7)

    # 1) precisao
    amostra = random.sample([x for x in com if x[1]], min(a.amostra, sum(1 for x in com if x[1])))
    erros, falhas, servicos = [], 0, {}
    for pt, cep, mun, nome, end in amostra:
        r = geocodificar(cep)
        if not r:
            falhas += 1
            continue
        servicos[r[2]] = servicos.get(r[2], 0) + 1
        erros.append(km(pt[1], pt[0], r[0], r[1]))
    print("PRECISAO (%d escolas com coordenada, CEP geocodificado):" % len(amostra))
    print("  resolvidas: %d (%.0f%%), sem resposta: %d" % (len(erros), 100.0 * len(erros) / max(1, len(amostra)), falhas))
    if erros:
        print("  erro km: mediana %.2f, p75 %.2f, p90 %.2f, p95 %.2f" % (pct(erros, .5), pct(erros, .75), pct(erros, .9), pct(erros, .95)))
        for lim in (0.5, 1, 2, 5):
            print("  dentro de %.1f km: %.0f%%" % (lim, 100.0 * sum(1 for e in erros if e <= lim) / len(erros)))
    print("  servicos usados:", servicos)

    # 2) cobertura nas que faltam
    falt = random.sample([x for x in sem if x[1]], min(a.faltantes, sum(1 for x in sem if x[1])))
    ok = 0
    for pt, cep, mun, nome, end in falt:
        if geocodificar(cep):
            ok += 1
    print("COBERTURA (%d escolas sem coordenada, com CEP): resolvidas %d (%.0f%%)" % (len(falt), ok, 100.0 * ok / max(1, len(falt))))
    print("exemplos sem coordenada:")
    for x in sem[:3]:
        print("  ", x[3], "|", x[4])


if __name__ == "__main__":
    main()
