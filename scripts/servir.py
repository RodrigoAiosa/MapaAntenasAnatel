"""Servidor local para ver public/ depois do build (multiplataforma).

    python3 scripts/servir.py [porta]

Serve por http://localhost, que manda o Referer que o OpenStreetMap exige
(abrir o HTML por duplo clique cai no servidor de reserva, bem mais lento).
Escuta so em 127.0.0.1.
"""
import functools
import http.server
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def main():
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    if not (PUBLIC / "index.html").exists():
        sys.exit("public/index.html nao existe. Rode antes: npm run build "
                 "(ou: python3 scripts/vercel_build.py --uf SC para um recorte rapido).")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(PUBLIC))
    with http.server.ThreadingHTTPServer(("127.0.0.1", porta), handler) as srv:
        print("Mapa em http://localhost:%d  (Ctrl+C para parar)" % porta)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
