#!/usr/bin/env python3
"""Baixa do IBGE as malhas municipais (contornos) e os nomes, por UF, e grava
arquivos compactos em <saida>/<UF>.json, mais <saida>/indice.json.

Usado pelo painel "Cobertura do municipio". Nao e fatal: se o IBGE estiver fora
do ar, o build segue sem o painel (o app so mostra o painel quando o indice existe).

  python3 scripts/baixar_malhas.py public/dados/malha
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
       "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]
BASE = "https://servicodados.ibge.gov.br/api"
URL_MALHA = BASE + "/v3/malhas/estados/{uf}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima"
URL_NOMES = BASE + "/v1/localidades/estados/{uf}/municipios"
CASAS = 4  # ~11 m: sobra para uma grade de amostragem de centenas de metros


PRAZO_TOTAL = 240.0   # segundos para todas as UFs: o build nunca espera o IBGE alem disso
FALHAS_SEGUIDAS = 2   # duas UFs seguidas sem resposta = IBGE inacessivel daqui, desiste


def buscar_json(url, tentativas=2, espera=1.5):
    ultimo = None
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "mapa-antenas-anatel/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception as e:  # rede, JSON ruim, 5xx
            ultimo = e
            time.sleep(espera * (t + 1))
    raise RuntimeError("falhou %s: %s" % (url, ultimo))


def arredondar(coords):
    if coords and isinstance(coords[0], (int, float)):
        return [round(coords[0], CASAS), round(coords[1], CASAS)]
    return [arredondar(c) for c in coords]


def compactar(malha, nomes):
    """malha: FeatureCollection do IBGE. nomes: lista [{id, nome}] da API de localidades.
    Devolve [{c: codigo, n: nome, g: geometria}] ordenado por nome."""
    por_codigo = {str(n["id"]): n["nome"] for n in nomes}
    saida = []
    for f in malha.get("features", []):
        p = f.get("properties") or {}
        codigo = str(p.get("codarea") or p.get("codigo") or "")
        g = f.get("geometry") or {}
        if g.get("type") not in ("Polygon", "MultiPolygon") or not codigo:
            continue
        saida.append({"c": codigo, "n": por_codigo.get(codigo, codigo),
                      "g": {"type": g["type"], "coordinates": arredondar(g["coordinates"])}})
    saida.sort(key=lambda m: m["n"])
    return saida


def executar(pasta, ufs=UFS, buscar=buscar_json):
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    feitas = []
    inicio = time.monotonic()
    seguidas = 0
    for uf in ufs:
        if time.monotonic() - inicio > PRAZO_TOTAL:
            print("  aviso: prazo de %d s esgotado, parando nas malhas ja baixadas" % PRAZO_TOTAL)
            break
        if seguidas >= FALHAS_SEGUIDAS:
            print("  aviso: IBGE sem resposta, desistindo das malhas")
            break
        try:
            muns = compactar(buscar(URL_MALHA.format(uf=uf)), buscar(URL_NOMES.format(uf=uf)))
            if not muns:
                raise RuntimeError("malha vazia")
        except Exception as e:
            print("  aviso: malha de %s indisponivel (%s)" % (uf, e))
            seguidas += 1
            continue
        seguidas = 0
        (pasta / (uf + ".json")).write_text(
            json.dumps({"uf": uf, "municipios": muns}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        feitas.append(uf)
    if feitas:
        (pasta / "indice.json").write_text(
            json.dumps({"ufs": feitas, "fonte": "IBGE, malhas municipais"}, ensure_ascii=False),
            encoding="utf-8")
    return feitas


if __name__ == "__main__":
    destino = sys.argv[1] if len(sys.argv) > 1 else "public/dados/malha"
    feitas = executar(destino)
    print("malhas: %d de %d UFs" % (len(feitas), len(UFS)))
    sys.exit(0)
