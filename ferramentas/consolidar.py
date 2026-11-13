"""CONSOLIDACAO DA BASE DA ANATEL: de 3,3 milhoes de linhas para 1 linha por ERB.

O CSV da Anatel (Estacoes_SMP.csv) tem uma linha por ESTACAO x SETOR x
FREQUENCIA x TECNOLOGIA. Uma torre da Vivo com 2G/3G/4G/5G em tres setores e
varias faixas vira dezenas de linhas. Para o mapa e para a planilha a unidade
e a ESTACAO ("Numero Estacao"): o ponto no mapa e a linha no Excel.

Regras, cada uma medida na base de 16/10/2026 (114.315 estacoes):

1. A chave e o "Numero Estacao". Nenhuma estacao tem mais de uma operadora
   (conferido: zero casos), entao a operadora e da estacao, nao da linha.

2. A coordenada e a MAIS FREQUENTE entre as linhas da estacao, contando so as
   que caem dentro do Brasil. 1.871 estacoes trazem mais de uma coordenada:
   1.600 diferem em menos de 100 m (setores do mesmo mastro), mas 80 diferem
   em mais de 1 km. Essas ficam MARCADAS (coluna "Coord. divergente (km)"),
   nao corrigidas - nao ha como saber daqui qual das duas e a certa.
   Ha linhas com o sinal trocado ("16", "42" no lugar de "-16,8", "-42,0"):
   elas caem fora da caixa do Brasil e nunca sao escolhidas.

3. Estacao sem NENHUMA coordenada valida nao vira ponto, mas tambem nao some:
   vai para a lista "fora do mapa" com o motivo. Nenhuma ERB sai em silencio.

4. A operadora e a "Empresa Estacao" (nome comercial: VIVO, CLARO, TIM...),
   comparada EXATAMENTE contra a tabela OPERADORAS. Nome desconhecido vai para
   o balde "outra" e o nome cru continua na ficha e na planilha - a mesma
   licao do "claro_br" no mapa original: casar por "contem" erra calado.

5. Campo vazio fica vazio. Infraestrutura (Greenfield/Rooftop...) falta em
   63% das linhas: completar com o valor mais comum esconderia exatamente
   quantas nao foram informadas.
"""

import csv
import io
import math
import zipfile
from collections import Counter, defaultdict

NOME_CSV = "Estacoes_SMP.csv"

# A ordem aqui e a ordem dos indices no HTML e das cores no app.
# Valor da coluna "Empresa Estacao" -> categoria.
OPERADORAS = ["claro", "tim", "vivo", "algar", "brisanet", "unifique", "sercomtel", "outra"]
NOMES_OPERADORA = {
    "claro": "Claro", "tim": "TIM", "vivo": "Vivo", "algar": "Algar",
    "brisanet": "Brisanet", "unifique": "Unifique", "sercomtel": "Sercomtel",
    "outra": "Outra",
}
EMPRESA_PARA_OPERADORA = {
    "CLARO": "claro",
    "TIM": "tim",
    "VIVO": "vivo",
    "ALGAR": "algar",
    "BRISANET": "brisanet",
    "UNIFIQUE TELECOMUNICACOES S/A": "unifique",
    "SERCOMTEL": "sercomtel",
}

GERACOES = ["2G", "3G", "4G", "5G"]           # bit 0..3
TECNOLOGIAS = ["GSM", "EDGE", "CDMA", "WCDMA", "LTE", "NR"]  # bit 0..5

# Grafias da mesma classe que aparecem na base ("rooftop", "Greenfild"...).
INFRA_CANONICA = {
    "greenfield": "Greenfield", "greenfild": "Greenfield",
    "rooftop": "Rooftop", "indoor": "Indoor", "ran sharing": "Ran Sharing",
    "streetlevel": "Streetlevel", "cow": "COW", "harmonizada": "Harmonizada",
    "outdoor": "Outdoor", "smallcell": "SmallCell", "fastsite": "Fastsite",
}

# Caixa do Brasil. Longitude 0 (a "ilha nula") e as coordenadas com sinal
# trocado caem fora dela sem guarda extra.
#
# ATENCAO, foi bug: a caixa veio do mapa original com o leste em -34, e a
# primeira geracao jogou para "fora do mapa" as 29 ERBs de Fernando de Noronha
# (-32,4). O leste agora e -28, que cobre Noronha e Trindade (-29,3).
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -34.0, 6.0, -74.0, -28.0

# A partir de quanto uma coordenada alternativa da mesma estacao vira aviso.
# Abaixo de 1 km e o mesmo site (setores, arredondamento do cadastro).
DIVERGENCIA_AVISO_KM = 1.0

RAIO_TERRA_KM = 6371.0088  # o mesmo raio do geo.js


def distancia_km(la1, lo1, la2, lo2):
    p = math.pi / 180
    h = (math.sin((la2 - la1) * p / 2) ** 2 +
         math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2)
    return 2 * RAIO_TERRA_KM * math.asin(min(1.0, math.sqrt(h)))


def coordenada_valida(lat_txt, lon_txt):
    try:
        la, lo = float(lat_txt), float(lon_txt)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(la) and math.isfinite(lo)):
        return None
    if LAT_MIN <= la <= LAT_MAX and LON_MIN <= lo <= LON_MAX:
        return (la, lo)
    return None


def operadora_de(empresa):
    return EMPRESA_PARA_OPERADORA.get((empresa or "").strip(), "outra")


def data_iso(txt):
    """'13/08/2003' ou '2032-12-22' -> '2003-08-13'. Vazio ou invalido -> ''."""
    t = (txt or "").strip()
    if len(t) == 10 and t[2] == "/" and t[5] == "/":
        d, m, a = t[0:2], t[3:5], t[6:10]
        t = "%s-%s-%s" % (a, m, d)
    if len(t) == 10 and t[4] == "-" and t[7] == "-" and t.replace("-", "").isdigit():
        return t
    return ""


def municipio_de(municipio_uf, uf):
    """'Divinopolis - MG' -> 'Divinopolis'. So corta o sufixo se ele bater com a UF."""
    t = (municipio_uf or "").strip()
    suf = " - " + (uf or "").strip()
    if uf and t.endswith(suf):
        return t[: -len(suf)].strip()
    return t


def ler_linhas_do_zip(caminho_zip):
    """Le o CSV de dentro do zip em fluxo: nunca descompacta o 1 GB em disco."""
    z = zipfile.ZipFile(caminho_zip)
    bruto = z.open(NOME_CSV)
    texto = io.TextIOWrapper(bruto, encoding="utf-8-sig", newline="")
    try:
        yield from csv.DictReader(texto, delimiter=";")
    finally:
        texto.close()
        z.close()


class _Acumulador:
    __slots__ = ("linhas", "coords", "empresa", "entidade", "cnpj", "fistel", "uf",
                 "municipio", "ibge", "endereco", "numero", "bairro", "complemento",
                 "cep", "geracoes", "tecnologias", "faixas", "tipos5g", "setores",
                 "infra", "carater", "primeiro_lic", "ultimo_lic", "validade")

    def __init__(self):
        self.linhas = 0
        self.coords = Counter()
        self.entidade = Counter()
        self.infra = Counter()
        self.empresa = self.cnpj = self.fistel = self.uf = self.municipio = ""
        self.ibge = self.endereco = self.numero = self.bairro = ""
        self.complemento = self.cep = ""
        self.geracoes = set()
        self.tecnologias = set()
        self.faixas = set()
        self.tipos5g = set()
        self.setores = set()
        self.carater = set()
        self.primeiro_lic = self.ultimo_lic = self.validade = ""


def _primeiro(atual, novo):
    return atual or (novo or "").strip()


def consolidar(linhas):
    """Recebe as linhas cruas (dicts do CSV) e devolve (estacoes, fora, info).

    estacoes: lista de dicts, uma por ERB com coordenada valida, ordenada por
              UF, municipio, operadora, numero.
    fora:     ERBs sem coordenada valida, com o motivo.
    info:     contagens para o relatorio de geracao.
    """
    acc = defaultdict(_Acumulador)
    total_linhas = 0
    sem_numero = 0
    empresas_cruas = Counter()

    for r in linhas:
        total_linhas += 1
        num = (r.get("Número Estação") or "").strip()
        if not num:
            sem_numero += 1
            continue
        a = acc[num]
        a.linhas += 1
        a.coords[(r.get("Latitude decimal") or "", r.get("Longitude decimal") or "")] += 1

        emp = (r.get("Empresa Estação") or "").strip()
        a.empresa = a.empresa or emp
        ent = (r.get("Entidade") or "").strip()
        if ent:
            a.entidade[ent] += 1
        a.cnpj = _primeiro(a.cnpj, r.get("NumCnpjCpf"))
        a.fistel = _primeiro(a.fistel, r.get("Número Fistel"))
        a.uf = _primeiro(a.uf, r.get("UF"))
        a.municipio = a.municipio or municipio_de(r.get("Município-UF"), r.get("UF"))
        a.ibge = _primeiro(a.ibge, r.get("Código IBGE"))
        a.endereco = _primeiro(a.endereco, r.get("EnderecoEstacao"))
        a.numero = _primeiro(a.numero, r.get("EndNumero"))
        a.bairro = _primeiro(a.bairro, r.get("EndBairro"))
        a.complemento = _primeiro(a.complemento, r.get("EndComplemento"))
        a.cep = _primeiro(a.cep, r.get("Cep"))

        g = (r.get("Geração") or "").strip().upper()
        if g in GERACOES:
            a.geracoes.add(g)
        t = (r.get("Tecnologia") or "").strip().upper()
        if t in TECNOLOGIAS:
            a.tecnologias.add(t)
        f = (r.get("Faixa Estação") or "").strip()
        if f.isdigit():
            a.faixas.add(int(f))
        t5 = (r.get("Tipo de Tecnologia 5G") or "").strip()
        if t5:
            a.tipos5g.add(t5)
        s = (r.get("NumSetor") or "").strip()
        if s:
            a.setores.add(s)
        inf = (r.get("ClassInfraFisica") or "").strip()
        if inf:
            a.infra[INFRA_CANONICA.get(inf.lower(), inf)] += 1
        c = (r.get("Caráter") or "").strip()
        if c:
            a.carater.add(c)

        d1 = data_iso(r.get("Data Primeiro Licenciamento"))
        if d1 and (not a.primeiro_lic or d1 < a.primeiro_lic):
            a.primeiro_lic = d1
        d2 = data_iso(r.get("Data Licenciamento"))
        if d2 and d2 > a.ultimo_lic:
            a.ultimo_lic = d2
        dv = data_iso(r.get("Data Validade"))
        if dv and dv > a.validade:
            a.validade = dv

    estacoes = []
    fora = []
    divergentes = 0
    for num, a in acc.items():
        empresas_cruas[a.empresa] += 1
        validas = Counter()
        for (lt, ln), n in a.coords.items():
            cv = coordenada_valida(lt, ln)
            if cv:
                validas[cv] += n
        base = {
            "numero": num,
            "operadora": operadora_de(a.empresa),
            "empresa": a.empresa,
            "prestadora": a.entidade.most_common(1)[0][0] if a.entidade else "",
            "uf": a.uf,
            "municipio": a.municipio,
            "ibge": a.ibge,
        }
        if not validas:
            cruas = ", ".join("%s;%s" % k for k in list(a.coords)[:3])
            fora.append(dict(base, motivo="sem coordenada valida no Brasil (%s)" % cruas))
            continue

        # Empate na contagem: a menor coordenada vence, para o resultado nao
        # depender da ordem das linhas no arquivo da Anatel.
        (lat, lon), _ = sorted(validas.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        div = max((distancia_km(lat, lon, la, lo) for (la, lo) in validas), default=0.0)
        if div >= DIVERGENCIA_AVISO_KM:
            divergentes += 1

        mascara_ger = 0
        for i, g in enumerate(GERACOES):
            if g in a.geracoes:
                mascara_ger |= 1 << i
        mascara_tec = 0
        for i, t in enumerate(TECNOLOGIAS):
            if t in a.tecnologias:
                mascara_tec |= 1 << i

        estacoes.append(dict(
            base,
            lat=round(lat, 6),
            lon=round(lon, 6),
            cnpj=a.cnpj,
            fistel=a.fistel,
            endereco=a.endereco,
            end_numero=a.numero,
            bairro=a.bairro,
            complemento=a.complemento,
            cep=a.cep,
            geracoes=mascara_ger,
            tecnologias=mascara_tec,
            faixas=sorted(a.faixas),
            tipo5g="/".join(sorted(a.tipos5g)),
            setores=len(a.setores),
            infra=a.infra.most_common(1)[0][0] if a.infra else "",
            carater="/".join(sorted(a.carater)),
            primeiro_lic=a.primeiro_lic,
            ultimo_lic=a.ultimo_lic,
            validade=a.validade,
            linhas=a.linhas,
            divergencia_km=round(div, 3) if div >= DIVERGENCIA_AVISO_KM else 0.0,
        ))

    estacoes.sort(key=lambda e: (e["uf"], e["municipio"], OPERADORAS.index(e["operadora"]), e["numero"]))
    fora.sort(key=lambda e: (e["uf"], e["municipio"], e["numero"]))
    info = {
        "linhas": total_linhas,
        "linhas_sem_numero": sem_numero,
        "estacoes_lidas": len(acc),
        "no_mapa": len(estacoes),
        "fora_do_mapa": len(fora),
        "coord_divergente": divergentes,
        "empresas_cruas": dict(empresas_cruas),
    }
    return estacoes, fora, info


def nomes_geracoes(mascara):
    return [g for i, g in enumerate(GERACOES) if mascara & (1 << i)]


def nomes_tecnologias(mascara):
    return [t for i, t in enumerate(TECNOLOGIAS) if mascara & (1 << i)]
