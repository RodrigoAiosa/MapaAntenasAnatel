#!/usr/bin/env python3
"""Baixa do IBGE as malhas municipais (contornos) e os nomes, por UF, e grava
arquivos compactos em <saida>/<UF>.json, mais <saida>/indice.json.

Usado pelo painel "Cobertura do municipio". Tenta o IBGE (v3, v4) e, se nao responder,
um espelho em GeoJSON. Os nomes vem do CSV da Anatel (dict codigo -> nome). Nao e fatal: se o IBGE estiver fora
do ar, o build segue sem o painel (o app so mostra o painel quando o indice existe).

  python3 scripts/baixar_malhas.py public/dados/malha
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

COD_UF = {"AC": 12, "AL": 27, "AM": 13, "AP": 16, "BA": 29, "CE": 23, "DF": 53, "ES": 32, "GO": 52,
          "MA": 21, "MG": 31, "MS": 50, "MT": 51, "PA": 15, "PB": 25, "PE": 26, "PI": 22, "PR": 41,
          "RJ": 33, "RN": 24, "RO": 11, "RR": 14, "RS": 43, "SC": 42, "SE": 28, "SP": 35, "TO": 17}
UFS = sorted(COD_UF)
# Fontes, em ordem de preferencia. {uf} = sigla, {cod} = codigo numerico da UF.
#  1. API de malhas do IBGE (v3); 2. a mesma, v4; 3. espelho em GeoJSON por estado
#     (tbrugz/geodata-br, dominio publico CC0, derivado do IBGE).
FONTES = [
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima",
    "https://servicodados.ibge.gov.br/api/v4/malhas/estados/{cod}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima",
    "https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-{cod}-mun.json",
]
CHAVES_CODIGO = ("codarea", "codigo", "id", "cd_mun", "geocodigo", "code")
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
    """malha: FeatureCollection. nomes: dict {codigo: nome} (ex.: do CSV da Anatel).
    Devolve [{c: codigo, n: nome, g: geometria}] ordenado por nome."""
    por_codigo = {str(k): v for k, v in (nomes or {}).items()}
    saida = []
    for f in malha.get("features", []):
        p = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
        codigo = ""
        for chave in CHAVES_CODIGO:
            if p.get(chave):
                codigo = str(p[chave])
                break
        # Alguns espelhos trazem o codigo de 6 digitos (sem o verificador).
        if len(codigo) == 6 and not por_codigo.get(codigo):
            achado = [c for c in por_codigo if c.startswith(codigo)]
            codigo = achado[0] if len(achado) == 1 else codigo
        g = f.get("geometry") or {}
        if g.get("type") not in ("Polygon", "MultiPolygon") or not codigo:
            continue
        saida.append({"c": codigo, "n": por_codigo.get(codigo) or p.get("name") or p.get("nome") or codigo,
                      "g": {"type": g["type"], "coordinates": arredondar(g["coordinates"])}})
    saida.sort(key=lambda m: m["n"])
    return saida


def executar(pasta, ufs=UFS, buscar=buscar_json, nomes=None):
    """nomes: dict {codigo: nome}. Para cada UF tenta as FONTES na ordem; uma fonte que
    falha na primeira UF e descartada para as demais (nao gasta prazo de novo)."""
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    feitas = []
    fontes = list(FONTES)
    inicio = time.monotonic()
    seguidas = 0
    for uf in ufs:
        if time.monotonic() - inicio > PRAZO_TOTAL:
            print("  aviso: prazo de %d s esgotado, parando nas malhas ja baixadas" % PRAZO_TOTAL)
            break
        if not fontes or seguidas >= FALHAS_SEGUIDAS:
            print("  aviso: nenhuma fonte de malha respondeu, desistindo")
            break
        muns = None
        for fonte in list(fontes):
            try:
                url = fonte.format(uf=uf, cod=COD_UF.get(uf, ""))
                muns = compactar(buscar(url), nomes)
                if not muns:
                    raise RuntimeError("malha vazia")
                break
            except Exception as e:
                print("  aviso: %s falhou em %s (%s)" % (fonte.split("/")[2], uf, str(e)[:160]))
                muns = None
                if not feitas:       # ainda nenhuma UF deu certo: descarta esta fonte
                    fontes.remove(fonte)
        if not muns:
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
    feitas = executar(destino, nomes=None)
    print("malhas: %d de %d UFs" % (len(feitas), len(UFS)))
    sys.exit(0)
