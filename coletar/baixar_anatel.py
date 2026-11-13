"""BAIXA A BASE DE ESTACOES DO SMP (ERBs) DA ANATEL.

    python coletar/baixar_anatel.py [--forcar]

Fonte: o painel "Outorga e Licenciamento > Estacoes" do portal de dados da
Anatel publica um zip com TODAS as estacoes licenciadas do Servico Movel
Pessoal (telefonia celular), atualizado todo dia:

    https://www.anatel.gov.br/dadosabertos/paineis_de_dados/outorga_e_licenciamento/estacoes_smp.zip

Dado publico, sem login e sem chave. O zip tem um CSV so (Estacoes_SMP.csv,
~1 GB descompactado, ~3,3 milhoes de linhas: uma por estacao x setor x
frequencia). Ele NAO e descompactado aqui: o gerar.py le o CSV direto de
dentro do zip, e 1 GB a menos em disco nao faz falta a ninguem.

POR QUE ESTE ARQUIVO E NAO O DO dados.gov.br: o conjunto "Estacoes
Licenciadas" do PDA (dadosabertos/PDA/Estacoes_Licenciadas/...SMP.csv) parou
em 19/10/2023. O do painel e o que a Anatel mantem vivo - conferido em
16/10/2026 com Last-Modified do proprio dia.

O download vai para um arquivo .parcial e so vira estacoes_smp.zip depois de
conferido (tamanho e zip valido). Um download cortado no meio nunca substitui
uma base boa.
"""

import json
import shutil
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

URL = ("https://www.anatel.gov.br/dadosabertos/paineis_de_dados/"
       "outorga_e_licenciamento/estacoes_smp.zip")
RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "dados_anatel"
DESTINO = PASTA / "estacoes_smp.zip"
ORIGEM = PASTA / "origem.json"
NOME_CSV = "Estacoes_SMP.csv"


def ler_origem():
    try:
        return json.loads(ORIGEM.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def conferir_zip(caminho):
    """Devolve o tamanho descompactado do CSV, ou levanta erro com o motivo."""
    with zipfile.ZipFile(caminho) as z:
        nomes = z.namelist()
        if NOME_CSV not in nomes:
            raise ValueError("o zip nao tem %s (tem: %s)" % (NOME_CSV, ", ".join(nomes)))
        return z.getinfo(NOME_CSV).file_size


def baixar(forcar=False):
    PASTA.mkdir(parents=True, exist_ok=True)
    pedido = urllib.request.Request(URL, headers={"User-Agent": "mapa-antenas-anatel/1.0"})

    anterior = ler_origem()
    print("Fonte: " + URL)
    with urllib.request.urlopen(pedido, timeout=120) as resp:
        modificado = resp.headers.get("Last-Modified", "")
        total = int(resp.headers.get("Content-Length") or 0)
        if (not forcar and DESTINO.exists() and modificado
                and anterior.get("last_modified") == modificado):
            print("A base local ja e a mais nova (Anatel: %s). Nada a baixar." % modificado)
            print("Use --forcar para baixar de novo assim mesmo.")
            return 0

        parcial = DESTINO.with_suffix(".zip.parcial")
        lido = 0
        t0 = time.time()
        ultimo = 0.0
        # Queda de rede ou Ctrl+C no meio: o .parcial (ate 90 MB) sai da pasta
        # em vez de ocupar disco (e sincronizar, se a pasta for de nuvem) ate o proximo download
        # (ANT-03, review de 10/11/2026). A base boa nunca e tocada aqui.
        try:
            with open(parcial, "wb") as saida:
                while True:
                    bloco = resp.read(1 << 20)
                    if not bloco:
                        break
                    saida.write(bloco)
                    lido += len(bloco)
                    agora = time.time()
                    if agora - ultimo > 1:
                        ultimo = agora
                        pct = (" %5.1f%%" % (lido * 100 / total)) if total else ""
                        print("\r  %7.1f MB%s" % (lido / 1048576, pct), end="", flush=True)
        except BaseException:
            print()
            parcial.unlink(missing_ok=True)
            raise
        print("\r  %7.1f MB em %.0f s          " % (lido / 1048576, time.time() - t0))

    if total and lido != total:
        parcial.unlink(missing_ok=True)
        raise SystemExit("[ERRO] Download cortado: chegaram %d de %d bytes. "
                         "A base anterior foi mantida." % (lido, total))
    try:
        tamanho_csv = conferir_zip(parcial)
    except (zipfile.BadZipFile, ValueError) as e:
        parcial.unlink(missing_ok=True)
        raise SystemExit("[ERRO] O arquivo baixado nao e o zip esperado: %s. "
                         "A base anterior foi mantida." % e) from e

    shutil.move(str(parcial), str(DESTINO))

    data_anatel = ""
    if modificado:
        try:
            data_anatel = parsedate_to_datetime(modificado).astimezone().strftime("%d/%m/%Y %H:%M")
        except (TypeError, ValueError):
            data_anatel = modificado
    ORIGEM.write_text(json.dumps({
        "url": URL,
        "last_modified": modificado,
        "data_anatel": data_anatel,
        "baixado_em": datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M"),
        "bytes_zip": lido,
        "bytes_csv": tamanho_csv,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print("Base salva em %s" % DESTINO)
    print("Atualizada pela Anatel em: %s" % (data_anatel or "(sem data no servidor)"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(baixar(forcar="--forcar" in sys.argv[1:]))
    except OSError as e:
        sys.exit("[ERRO] Nao consegui baixar da Anatel: %s\n"
                 "       Confira a internet/proxy. A base anterior (se houver) foi mantida." % e)
