#!/usr/bin/env python3
"""Sonda o zip de cobertura movel da Anatel e IMPRIME (no log do build) o tamanho, os
arquivos, o cabecalho e as primeiras linhas de cada CSV. Nao grava nada em public/.
Temporario: serve para descobrir as colunas antes de escrever o leitor definitivo."""
import io
import sys
import tempfile
import urllib.request
import zipfile

URL = "https://www.anatel.gov.br/dadosabertos/paineis_de_dados/infraestrutura/cobertura_movel.zip"
LIMITE = 400 * 1024 * 1024


PRAZO = 150.0  # segundos para baixar


def main():
    import time
    t0 = time.monotonic()
    req = urllib.request.Request(URL, headers={"User-Agent": "mapa-antenas-anatel/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        tam = int(r.headers.get("Content-Length") or 0)
        print("SONDA cobertura_movel.zip: Content-Length=%d bytes, Last-Modified=%s" % (tam, r.headers.get("Last-Modified")))
        if tam > LIMITE:
            print("SONDA: grande demais para sondar (> %d MB)" % (LIMITE // 1048576))
            return
        with tempfile.TemporaryFile() as tmp:
            while True:
                bloco = r.read(1 << 20)
                if not bloco:
                    break
                if time.monotonic() - t0 > PRAZO:
                    print("SONDA: download passou de %d s, abandonando" % PRAZO)
                    return
                tmp.write(bloco)
            tmp.seek(0)
            z = zipfile.ZipFile(tmp)
            for info in z.infolist():
                print("SONDA arquivo: %s (%d bytes descompactado)" % (info.filename, info.file_size))
                if not info.filename.lower().endswith((".csv", ".txt")):
                    continue
                with z.open(info) as f:
                    cru = f.read(4096)
                    for enc in ("utf-8-sig", "latin-1"):
                        try:
                            cru.decode(enc)
                            break
                        except UnicodeDecodeError:
                            continue
                    print("SONDA codificacao provavel: %s" % enc)
                with z.open(info) as f:
                    txt = io.TextIOWrapper(f, encoding=enc, errors="replace")
                    n = 0
                    for linha in txt:
                        n += 1
                        if n <= 4:
                            print("SONDA linha %d: %s" % (n, linha.rstrip()[:600]))
                    print("SONDA linhas no total: %d" % n)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("SONDA falhou: %s" % e)
    sys.exit(0)
