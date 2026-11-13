"""BUILD PARA A VERCEL: baixa a base da Anatel, gera o mapa e monta public/.

    python3 scripts/vercel_build.py [--zip base.zip] [--uf SC,PR] [--planilha]

O que acontece (a Vercel roda isto a cada deploy):

 1. baixa o zip da Anatel (coletar/baixar_anatel.py), a menos que --zip seja dado;
 2. gera o mapa (ferramentas/gerar.py) numa pasta temporaria;
 3. confere a regra "lidas = no mapa + fora": se divergir, o build FALHA e a
    Vercel mantem o deploy anterior no ar;
 4. monta public/ com index.html (SEO, Open Graph e PWA injetados), 404.html,
    sobre.html (privacidade e fontes), robots.txt, sitemap.xml,
    manifest.webmanifest, icon.svg e status.json (data da base e contagens);
 5. com --planilha (ou INCLUIR_PLANILHA=1) tambem publica o .xlsx em /dados/.

Variaveis de ambiente opcionais:
    SITE_URL                  URL publica (padrao: VERCEL_PROJECT_PRODUCTION_URL)
    INCLUIR_PLANILHA=1        gera e publica a planilha (instala openpyxl se faltar)
    UFS                       recorte por UF, ex.: SC,PR (padrao: Brasil inteiro)

So biblioteca padrao do Python, exceto openpyxl, que so a planilha usa.
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
EXTRA = RAIZ / "public_extra"
PUBLIC = RAIZ / "public"
TITULO = "Mapa de Antenas Anatel"
DESCRICAO = ("Todas as antenas (ERBs) de telefonia celular licenciadas na Anatel, "
             "coloridas por operadora e geração (2G a 5G). Descubra a antena mais "
             "próxima de qualquer endereço.")


def executar(cmd):
    print("$ " + " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, cwd=RAIZ)


def url_do_site():
    explicita = os.environ.get("SITE_URL", "").strip().rstrip("/")
    if explicita:
        return explicita if explicita.startswith("http") else "https://" + explicita
    producao = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    return ("https://" + producao) if producao else ""


def tags_de_cabecalho(base):
    """Meta tags que o modelo original nao tem: SEO, Open Graph, PWA."""
    t = html.escape(TITULO, quote=True)
    d = html.escape(DESCRICAO, quote=True)
    linhas = [
        '<meta name="theme-color" content="#0b0f14">',
        '<meta name="color-scheme" content="dark light">',
        '<meta name="referrer" content="strict-origin-when-cross-origin">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        '<link rel="apple-touch-icon" href="/icon.svg">',
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="pt_BR">',
        '<meta property="og:title" content="%s">' % t,
        '<meta property="og:description" content="%s">' % d,
        '<meta name="twitter:card" content="summary">',
        '<meta name="twitter:title" content="%s">' % t,
        '<meta name="twitter:description" content="%s">' % d,
    ]
    if base:
        linhas.append('<link rel="canonical" href="%s/">' % base)
        linhas.append('<meta property="og:url" content="%s/">' % base)
        linhas.append('<meta property="og:image" content="%s/icon.svg">' % base)
    return "\n".join(linhas) + "\n"


def injetar_cabecalho(conteudo, base):
    # Ancora no <meta name="description"> do modelo: unico e antes de qualquer script.
    ancora = re.search(r'<meta name="description"[^>]*>\n?', conteudo)
    if not ancora:
        raise SystemExit("ERRO: nao achei <meta name=\"description\"> no HTML gerado.")
    fim = ancora.end()
    return conteudo[:fim] + tags_de_cabecalho(base) + conteudo[fim:]


def ler_conferencia(relatorio):
    m = re.search(r"Conferencia: (\d+) lidas = (\d+) no mapa \+ (\d+) fora\s+(OK|\*\*\* DIVERGENTE)", relatorio)
    if not m:
        raise SystemExit("ERRO: o relatorio de geracao nao traz a linha de conferencia.")
    lidas, no_mapa, fora, status = int(m[1]), int(m[2]), int(m[3]), m[4]
    if status != "OK" or lidas != no_mapa + fora or no_mapa == 0:
        raise SystemExit("ERRO: conferencia divergente (%d lidas, %d no mapa, %d fora). "
                         "Nada sera publicado." % (lidas, no_mapa, fora))
    return {"lidas": lidas, "no_mapa": no_mapa, "fora_do_mapa": fora}


def escrever(caminho, texto):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(texto, encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zip", type=Path, help="usa este zip e nao baixa da Anatel")
    ap.add_argument("--uf", default=os.environ.get("UFS", ""))
    ap.add_argument("--planilha", action="store_true",
                    default=os.environ.get("INCLUIR_PLANILHA") == "1")
    args = ap.parse_args(argv)

    if args.zip:
        zip_base = args.zip.resolve()
        origem = {}
    else:
        executar([sys.executable, "coletar/baixar_anatel.py", "--forcar"])
        zip_base = RAIZ / "dados_anatel" / "estacoes_smp.zip"
        try:
            origem = json.loads((RAIZ / "dados_anatel" / "origem.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            origem = {}

    if args.planilha:
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            executar([sys.executable, "-m", "pip", "install", "--quiet", "--user",
                      "--break-system-packages", "openpyxl"])

    with tempfile.TemporaryDirectory() as tmp:
        saida = Path(tmp)
        cmd = [sys.executable, "ferramentas/gerar.py", "--zip", zip_base, "--saida", saida]
        if not args.planilha:
            cmd.append("--sem-planilha")
        if args.uf:
            cmd += ["--uf", args.uf]
        executar(cmd)

        mapas = sorted(saida.glob("MapaDeAntenas*.html"))
        rel = sorted(saida.glob("RELATORIO_GERACAO*.txt"))
        if not mapas or not rel:
            raise SystemExit("ERRO: o gerador nao produziu o mapa ou o relatorio.")
        relatorio = rel[0].read_text(encoding="utf-8")
        conferencia = ler_conferencia(relatorio)
        print(relatorio)

        base = url_do_site()
        if PUBLIC.exists():
            shutil.rmtree(PUBLIC)
        PUBLIC.mkdir()
        escrever(PUBLIC / "index.html",
                 injetar_cabecalho(mapas[0].read_text(encoding="utf-8"), base))

        planilhas = sorted(saida.glob("Antenas_SMP_Anatel_*.xlsx"))
        nome_planilha = ""
        if planilhas:
            nome_planilha = "Antenas_SMP_Anatel.xlsx"
            (PUBLIC / "dados").mkdir()
            shutil.copy2(planilhas[0], PUBLIC / "dados" / nome_planilha)

    # Arquivos estaticos mantidos em public_extra/ (404, sobre, manifest, icone, robots).
    data_anatel = origem.get("data_anatel") or "indisponível"
    for modelo in sorted(EXTRA.iterdir()):
        conteudo = modelo.read_text(encoding="utf-8")
        conteudo = (conteudo.replace("{{SITE_URL}}", base)
                    .replace("{{DATA_ANATEL}}", html.escape(data_anatel))
                    .replace("{{NO_MAPA}}", "{:,}".format(conferencia["no_mapa"]).replace(",", "."))
                    .replace("{{LINK_PLANILHA}}",
                             '<p><a href="/dados/%s" download>Baixar a planilha (.xlsx)</a></p>' % nome_planilha
                             if nome_planilha else ""))
        escrever(PUBLIC / modelo.name, conteudo)

    escrever(PUBLIC / "sitemap.xml",
             '<?xml version="1.0" encoding="UTF-8"?>\n'
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
             '  <url><loc>%s/</loc></url>\n  <url><loc>%s/sobre</loc></url>\n</urlset>\n' % (base, base)
             if base else
             '<?xml version="1.0" encoding="UTF-8"?>\n'
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n')
    if base:
        with open(PUBLIC / "robots.txt", "a", encoding="utf-8") as f:
            f.write("Sitemap: %s/sitemap.xml\n" % base)

    escrever(PUBLIC / "status.json", json.dumps({
        "projeto": TITULO,
        "base_anatel": origem.get("data_anatel"),
        "baixada_em": origem.get("baixado_em"),
        "gerado_em_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recorte_uf": args.uf or None,
        "estacoes": conferencia,
        "commit": os.environ.get("VERCEL_GIT_COMMIT_SHA"),
    }, ensure_ascii=False, indent=2) + "\n")

    tamanho = sum(p.stat().st_size for p in PUBLIC.rglob("*") if p.is_file()) / 1048576
    print("\nOK: public/ pronto (%.1f MB, %d ERBs no mapa)." % (tamanho, conferencia["no_mapa"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
