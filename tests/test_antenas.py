"""Testes do Mapa de Antenas - rodam offline, com dados INVENTADOS.

    python tests/test_antenas.py

Cobre as regras da consolidacao (consolidar.py) e a geracao de ponta a ponta
(gerar.py -> HTML + xlsx) a partir de um zip pequeno montado aqui mesmo. Nada
toca a base real nem os arquivos gerados na raiz: a saida vai para uma pasta
temporaria.
"""

import csv
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "ferramentas"))
sys.path.insert(0, str(RAIZ / "scripts"))

import consolidar as C  # noqa: E402
import gerar  # noqa: E402

CABECALHO = ("Número Fistel;Número Estação;NumCnpjCpf;NumServico;Frequência (MHz);Banda_MHZ;"
             "Frequência Inicial;Frequência Final;FreqTxMHz;FreqRxMHz;Designação Emissão;Número Ato;"
             "Data Validade;Entidade;NumSetor;Tecnologia;Tipo de Tecnologia 5G;Latitude;Longitude;"
             "Latitude decimal;Longitude decimal;EnderecoEstacao;EndBairro;EndNumero;EndComplemento;Cep;"
             "ClassInfraFisica;Data Primeiro Licenciamento;Data Licenciamento;AnoMesLic;Situacao;Caráter;"
             "Empresa Estação;Faixa Estação;Subfaixa Estação;Geração;Código Nacional;Código IBGE;"
             "Município-UF;UF;Nome da UF").split(";")


def linha(num, empresa="VIVO", lat="-27.5", lon="-48.5", ger="4G", tec="LTE", faixa="1800",
          setor="1", infra="", t5g="", d1="13/08/2003", d2="16/11/2023", val="2032-12-22",
          mun="Florianópolis - SC", uf="SC", end="RUA A", bairro="CENTRO", numero="10"):
    r = {k: "" for k in CABECALHO}
    r.update({
        "Número Estação": num, "Empresa Estação": empresa, "Entidade": empresa + " S.A.",
        "Latitude decimal": lat, "Longitude decimal": lon, "Geração": ger, "Tecnologia": tec,
        "Faixa Estação": faixa, "NumSetor": setor, "ClassInfraFisica": infra,
        "Tipo de Tecnologia 5G": t5g, "Data Primeiro Licenciamento": d1, "Data Licenciamento": d2,
        "Data Validade": val, "Município-UF": mun, "UF": uf, "Código IBGE": "4205407",
        "EnderecoEstacao": end, "EndBairro": bairro, "EndNumero": numero, "Caráter": "Primário",
        "Situacao": "Licenciada",
    })
    return r


def por_numero(estacoes):
    return {e["numero"]: e for e in estacoes}


class TesteConsolidacao(unittest.TestCase):

    def test_uma_estacao_varias_linhas_vira_uma(self):
        est, fora, info = C.consolidar([
            linha("1", ger="2G", tec="GSM", faixa="900", setor="1"),
            linha("1", ger="3G", tec="WCDMA", faixa="2100", setor="2"),
            linha("1", ger="4G", tec="LTE", faixa="700", setor="3"),
            linha("1", ger="4G", tec="LTE", faixa="700", setor="3"),
        ])
        self.assertEqual(len(est), 1)
        e = est[0]
        self.assertEqual(e["geracoes"], 1 | 2 | 4)
        self.assertEqual(C.nomes_geracoes(e["geracoes"]), ["2G", "3G", "4G"])
        self.assertEqual(e["faixas"], [700, 900, 2100])
        self.assertEqual(e["setores"], 3)
        self.assertEqual(e["linhas"], 4)
        self.assertEqual(info["estacoes_lidas"], 1)

    def test_coordenada_mais_frequente_vence(self):
        est, _, _ = C.consolidar([
            linha("1", lat="-27.5", lon="-48.5"),
            linha("1", lat="-27.5", lon="-48.5"),
            linha("1", lat="-27.6", lon="-48.6"),
        ])
        self.assertEqual((est[0]["lat"], est[0]["lon"]), (-27.5, -48.5))

    def test_coordenada_com_sinal_trocado_nunca_e_escolhida(self):
        # Caso real (estacao 1003845280): "16","42" no lugar de -16,8 / -42,0.
        # Mesmo sendo MAIS frequente, a invalida nao pode ganhar.
        est, fora, _ = C.consolidar([
            linha("1", lat="16", lon="42"),
            linha("1", lat="16", lon="42"),
            linha("1", lat="-16.84", lon="-42.06"),
        ])
        self.assertEqual(fora, [])
        self.assertEqual((est[0]["lat"], est[0]["lon"]), (-16.84, -42.06))

    def test_divergencia_acima_de_1km_fica_marcada(self):
        est, _, info = C.consolidar([
            linha("1", lat="-27.50", lon="-48.50"),
            linha("1", lat="-27.50", lon="-48.50"),
            linha("1", lat="-27.60", lon="-48.50"),  # ~11 km ao sul
            linha("2", lat="-27.50", lon="-48.50"),
            linha("2", lat="-27.5001", lon="-48.50"),  # ~11 m: mesmo mastro
        ])
        e = por_numero(est)
        self.assertGreater(e["1"]["divergencia_km"], 10)
        self.assertEqual(e["2"]["divergencia_km"], 0.0)
        self.assertEqual(info["coord_divergente"], 1)

    def test_fernando_de_noronha_entra_no_mapa(self):
        # Foi bug: a caixa do Brasil tinha o leste em -34 e jogou fora as 29
        # ERBs de Noronha (-32,4).
        est, fora, _ = C.consolidar([linha("1", lat="-3.8486", lon="-32.4103", mun="Fernando de Noronha - PE", uf="PE")])
        self.assertEqual(fora, [])
        self.assertEqual(len(est), 1)

    def test_sem_coordenada_valida_vai_para_fora_com_motivo(self):
        est, fora, info = C.consolidar([linha("1", lat="0", lon="0"), linha("2")])
        self.assertEqual([e["numero"] for e in est], ["2"])
        self.assertEqual(len(fora), 1)
        self.assertIn("sem coordenada", fora[0]["motivo"])
        # A conferencia que o gerador imprime: lidas = no mapa + fora.
        self.assertEqual(info["estacoes_lidas"], info["no_mapa"] + info["fora_do_mapa"])

    def test_operadora_desconhecida_vai_para_outra_sem_perder_o_nome(self):
        est, _, _ = C.consolidar([linha("1", empresa="Iez! Telecom Ltda."), linha("2", empresa="CLARO")])
        e = por_numero(est)
        self.assertEqual(e["1"]["operadora"], "outra")
        self.assertEqual(e["1"]["empresa"], "Iez! Telecom Ltda.")
        self.assertEqual(e["2"]["operadora"], "claro")

    def test_casamento_da_operadora_e_exato(self):
        # "contem CLARO" acertaria aqui e erraria calado numa revendedora.
        self.assertEqual(C.operadora_de("CLARO NET VIRTUAL"), "outra")
        self.assertEqual(C.operadora_de(" TIM "), "tim")

    def test_infraestrutura_vazia_fica_vazia_e_grafias_se_juntam(self):
        est, _, _ = C.consolidar([
            linha("1"),
            linha("2", infra="Greenfild"), linha("2", infra="GREENFIELD"),
        ])
        e = por_numero(est)
        self.assertEqual(e["1"]["infra"], "")
        self.assertEqual(e["2"]["infra"], "Greenfield")

    def test_datas(self):
        est, _, _ = C.consolidar([
            linha("1", d1="13/08/2003", d2="16/11/2023", val="2032-12-22"),
            linha("1", d1="01/01/2010", d2="26/08/2025", val="2030-01-01"),
        ])
        e = est[0]
        self.assertEqual(e["primeiro_lic"], "2003-08-13")   # o mais antigo
        self.assertEqual(e["ultimo_lic"], "2025-08-26")     # o mais recente
        self.assertEqual(e["validade"], "2032-12-22")
        self.assertEqual(C.data_iso("lixo"), "")

    def test_municipio_sem_o_sufixo_da_uf(self):
        self.assertEqual(C.municipio_de("Divinópolis - MG", "MG"), "Divinópolis")
        # So corta quando o sufixo bate com a UF: um nome com hifen fica inteiro.
        self.assertEqual(C.municipio_de("Embu-Guaçu - SP", "SP"), "Embu-Guaçu")
        self.assertEqual(C.municipio_de("Xique - Xique", "BA"), "Xique - Xique")


def montar_zip(caminho, linhas):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CABECALHO, delimiter=";", lineterminator="\n")
    w.writeheader()
    for r in linhas:
        w.writerow(r)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(C.NOME_CSV, ("﻿" + buf.getvalue()).encode("utf-8"))


class TesteGeracao(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        pasta = Path(cls.tmp.name)
        cls.zip = pasta / "estacoes_smp.zip"
        montar_zip(cls.zip, [
            linha("10", empresa="CLARO", ger="3G", tec="WCDMA", end="RUA </script> X"),
            linha("10", empresa="CLARO", ger="5G", tec="NR", t5g="SA-NSA"),
            linha("11", empresa="TIM", lat="-27.51", lon="-48.51", end="RUA | PIPE"),
            linha("12", empresa="GIGA+", lat="-23.5", lon="-46.6", mun="São Paulo - SP", uf="SP"),
            linha("13", empresa="VIVO", lat="0", lon="0"),
        ])
        cls.saida = pasta / "saida"
        cls.codigo = gerar.main(["--zip", str(cls.zip), "--saida", str(cls.saida)])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_sai_com_sucesso_e_relatorio_confere(self):
        self.assertEqual(self.codigo, 0)
        rel = (self.saida / "RELATORIO_GERACAO.txt").read_text(encoding="utf-8")
        self.assertIn("4 lidas = 3 no mapa + 1 fora   OK", rel)

    def test_html_sem_marcador_e_com_os_dados(self):
        html = (self.saida / "MapaDeAntenas.html").read_text(encoding="utf-8")
        self.assertNotIn("/*INSERIR:", html)
        self.assertIn("var ANT_TOTAL = 3;", html)
        self.assertIn("var ANT_FORA = 1;", html)
        # "</script>" de um endereco nao pode fechar a tag de dados.
        self.assertEqual(html.count("RUA <\\/script> X"), 1)
        m = re.search(r'var ANT_TXT = "(.*)";\n', html)
        registros = m.group(1).split("\\n")
        self.assertEqual(len(registros), 3)
        # Todo registro tem os 15 campos - um "|" vazado de um valor quebraria isso.
        self.assertTrue(all(len(r.split("|")) == 15 for r in registros), registros)
        claro = [r for r in registros if r.split("|")[2] == "10"][0].split("|")
        self.assertEqual(int(claro[4]), 2 | 8)          # 3G + 5G
        self.assertEqual(int(claro[12]) & 6, 6)          # 5G NSA e SA
        # Faixas em bits sobre ANT_FAIXAS: a ERB 10 so tem 1800 MHz.
        faixas = json.loads(re.search(r"var ANT_FAIXAS = (\[.*?\]);", html).group(1))
        self.assertEqual([f for k, f in enumerate(faixas) if int(claro[7]) & (1 << k)], [1800])
        giga = [r for r in registros if r.split("|")[2] == "12"][0].split("|")
        self.assertEqual(giga[14], "GIGA+")              # nome cru so na "outra"
        self.assertEqual(claro[14], "")

    def test_planilha(self):
        from openpyxl import load_workbook
        xlsx = list(self.saida.glob("Antenas_SMP_Anatel_*.xlsx"))
        self.assertEqual(len(xlsx), 1)
        wb = load_workbook(xlsx[0], read_only=True)
        self.assertEqual(wb.sheetnames, ["Estações", "Por município", "Resumo", "Fora do mapa", "Sobre"])
        linhas = list(wb["Estações"].iter_rows(values_only=True))
        cab = linhas[0]
        self.assertEqual(len(linhas), 1 + 3)
        claro = [l for l in linhas[1:] if l[0] == "10"][0]
        self.assertEqual(claro[cab.index("Operadora")], "Claro")
        self.assertEqual(claro[cab.index("3G")], "Sim")
        self.assertIsNone(claro[cab.index("2G")])
        self.assertEqual(claro[cab.index("Gerações")], "3G 5G")
        # Data de verdade, nao texto: e o que deixa filtrar e ordenar no Excel.
        self.assertEqual(claro[cab.index("1º licenciamento")].year, 2003)
        fora = list(wb["Fora do mapa"].iter_rows(values_only=True))
        self.assertEqual([l[0] for l in fora[1:]], ["13"])
        wb.close()

    def test_recorte_por_uf(self):
        pasta = self.saida / "uf"
        codigo = gerar.main(["--zip", str(self.zip), "--saida", str(pasta), "--uf", "sp", "--sem-planilha"])
        self.assertEqual(codigo, 0)
        html = (pasta / "MapaDeAntenas_SP.html").read_text(encoding="utf-8")
        self.assertIn("var ANT_TOTAL = 1;", html)
        # R15 (revisão de 19/10/2026): a ERB sem coordenada é de SC; no recorte de SP não há nenhuma fora.
        self.assertIn("var ANT_FORA = 0;", html)

    def test_recorte_por_uf_na_planilha(self):
        from openpyxl import load_workbook
        pasta = self.saida / "uf_planilha"
        self.assertEqual(gerar.main(["--zip", str(self.zip), "--saida", str(pasta), "--uf", "sc", "--sem-mapa"]), 0)
        wb = load_workbook(next(pasta.glob("Antenas_SMP_Anatel_*_SC.xlsx")))
        sobre = {r[0]: r[1] for r in wb["Sobre"].iter_rows(values_only=True) if len(r) > 1 and r[0]}
        wb.close()
        self.assertEqual(sobre["ERBs nesta planilha / no mapa"], 2)
        self.assertEqual(sobre["ERBs fora do mapa (sem coordenada)"], 1)
        self.assertEqual(sobre["Estações (ERBs) distintas"], 3)


class TesteGeoJs(unittest.TestCase):
    """Indice em grade e leitura do lote (app/js/geo.js), via tests/geo_test.cjs.

    O projeto nao depende do Node: sem ele na maquina, o teste e pulado e diz
    por que, em vez de passar calado.
    """

    def test_geo_js(self):
        import shutil
        import subprocess
        node = shutil.which("node")
        if not node:
            self.skipTest("Node nao instalado: tests/geo_test.cjs nao rodou")
        r = subprocess.run([node, str(RAIZ / "tests" / "geo_test.cjs")], capture_output=True,
                           text=True, encoding="utf-8", timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class TesteDownloadCortado(unittest.TestCase):
    """Queda de rede no meio do download (M08 / ANT-03, 10/11/2026).

    O .parcial de ate 90 MB nao pode ficar largado na pasta, e a base boa
    que ja estava la nao pode ser tocada. Nada vai a rede: o urlopen e falso.
    """

    def test_queda_no_meio_apaga_o_parcial_e_mantem_a_base(self):
        from unittest import mock
        sys.path.insert(0, str(RAIZ / "coletar"))
        import baixar_anatel as B

        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            destino = pasta / "estacoes_smp.zip"
            destino.write_bytes(b"BASE BOA")

            class RespostaQueCai:
                headers = {"Last-Modified": "Mon, 10 Nov 2026 10:00:00 GMT", "Content-Length": "300"}
                chamadas = 0

                def read(self, n):
                    self.chamadas += 1
                    if self.chamadas == 1:
                        return b"x" * 100
                    raise OSError("conexao resetada")

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

            with mock.patch.object(B, "PASTA", pasta), mock.patch.object(B, "DESTINO", destino), \
                    mock.patch.object(B, "ORIGEM", pasta / "origem.json"), \
                    mock.patch.object(B.urllib.request, "urlopen", lambda *a, **k: RespostaQueCai()), \
                    mock.patch("builtins.print"):
                with self.assertRaises(OSError):
                    B.baixar(forcar=True)

            self.assertEqual(sorted(p.name for p in pasta.iterdir()), ["estacoes_smp.zip"])
            self.assertEqual(destino.read_bytes(), b"BASE BOA")


class TesteCoberturaAnatel(unittest.TestCase):
    """O leitor do zip de cobertura: cabecalho como a Anatel publica, escolha do arquivo
    mais recente e conversao de virgula decimal."""

    CAB = ("\ufeffC\u00f3digo Munic\u00edpio;Munic\u00edpio;UF;Tecnologia;Operadora;Per\u00edodo;% \u00e1rea coberta;"
           "% moradores cobertos;% domicilios cobertos;\u00c1rea (km2);Moradores;Domic\u00edlios\n")

    def zip_com(self, pasta, nome, texto):
        caminho = Path(pasta) / "c.zip"
        with zipfile.ZipFile(caminho, "w") as z:
            z.writestr("Cobertura_2026_06_Municipios.csv", "x;y\n")
            z.writestr(nome, texto.encode("utf-8"))
        return caminho

    def test_le_o_arquivo_mais_recente_e_converte_decimais(self):
        import baixar_cobertura_anatel as b
        linhas = (self.CAB +
                  "1100122;Ji-Paran\u00e1;RO;3G4G5G;Todas;09-2026;0,11394;0,95339;0,94792;6896,6;124333;56566\n"
                  "1100122;Ji-Paran\u00e1;RO;3G4G5G;VIVO;09-2026;0,072;0,9324;0,92;6896,6;124333;56566\n")
        with tempfile.TemporaryDirectory() as d:
            z = self.zip_com(d, "Cobertura_2026_09_Municipios.csv", linhas)
            ufs = b.executar(Path(d) / "out", z)
            self.assertEqual(ufs, ["RO"])
            dados = json.loads((Path(d) / "out" / "RO.json").read_text(encoding="utf-8"))
            self.assertEqual(dados["periodo"], "09-2026")
            reg = dados["m"]["1100122"]
            self.assertEqual(reg["p"], 124333)
            self.assertEqual(len(reg["d"]), 2)
            i_op = dados["ops"].index("Todas")
            i_tec = dados["tecs"].index("3G4G5G")
            self.assertIn([i_op, i_tec, 0.1139, 0.9534], reg["d"])

    def test_percentual_de_0_a_100_vira_fracao(self):
        import baixar_cobertura_anatel as b
        linhas = self.CAB + "1;A;SC;4G;Todas;09-2026;50,0;80,0;80,0;10,0;1000;300\n"
        with tempfile.TemporaryDirectory() as d:
            z = self.zip_com(d, "Cobertura_2026_09_Municipios.csv", linhas)
            b.executar(Path(d) / "out", z)
            dados = json.loads((Path(d) / "out" / "SC.json").read_text(encoding="utf-8"))
            self.assertEqual(dados["m"]["1"]["d"][0][2:], [0.5, 0.8])

    def test_zip_sem_arquivo_de_municipios_falha_com_mensagem(self):
        import baixar_cobertura_anatel as b
        with tempfile.TemporaryDirectory() as d:
            caminho = Path(d) / "c.zip"
            with zipfile.ZipFile(caminho, "w") as z:
                z.writestr("outro.csv", "a")
            with self.assertRaises(RuntimeError):
                b.executar(Path(d) / "out", caminho)


class TesteMalhasIbge(unittest.TestCase):
    MALHA = {"features": [
        {"properties": {"codarea": "4200051"}, "geometry": {"type": "Polygon",
         "coordinates": [[[-49.123456, -26.1], [-49.0, -26.1], [-49.0, -26.0], [-49.123456, -26.1]]]}},
        {"properties": {"codarea": "0"}, "geometry": None}]}

    def test_compacta_nomes_e_arredonda(self):
        import baixar_malhas as m
        r = m.compactar(self.MALHA, {"4200051": "Abdon Batista"})
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["n"], "Abdon Batista")
        self.assertEqual(r[0]["g"]["coordinates"][0][0], [-49.1235, -26.1])

    def test_espelho_com_id_de_6_digitos_e_nome_na_propriedade(self):
        import baixar_malhas as m
        malha = {"features": [{"properties": {"id": "420005", "name": "X"}, "geometry": {
            "type": "Polygon", "coordinates": [[[-49, -26], [-48, -26], [-48, -25], [-49, -26]]]}}]}
        r = m.compactar(malha, {"4200051": "Abdon Batista"})
        self.assertEqual((r[0]["c"], r[0]["n"]), ("4200051", "Abdon Batista"))

    def test_desiste_depressa_quando_ninguem_responde(self):
        import baixar_malhas as m
        chamadas = []
        def sem_rede(url):
            chamadas.append(url)
            raise RuntimeError("sem rede")
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(m.executar(d, ["AC", "AL", "AM", "AP"], buscar=sem_rede), [])
            self.assertFalse((Path(d) / "indice.json").exists())
        self.assertEqual(len(chamadas), len(m.FONTES))  # cada fonte e tentada uma vez so

    def test_cai_para_a_proxima_fonte_e_a_descartada_nao_volta(self):
        import baixar_malhas as m
        chamadas = []
        def so_o_espelho(url):
            chamadas.append(url)
            if "raw.githubusercontent.com" in url:
                return self.MALHA
            raise RuntimeError("fora do ar")
        with tempfile.TemporaryDirectory() as d:
            feitas = m.executar(d, ["SC", "SP"], buscar=so_o_espelho, nomes={"4200051": "Abdon Batista"})
            self.assertEqual(feitas, ["SC", "SP"])
            self.assertTrue((Path(d) / "indice.json").exists())
        # IBGE v3 e v4 so foram tentados na primeira UF
        self.assertEqual(sum("servicodados" in u for u in chamadas), 2)


class TestePessoasEscolas(unittest.TestCase):
    def setUp(self):
        import preparar_pessoas_escolas as P
        self.P = P

    @staticmethod
    def blob(lon, lat, flags=1):
        import struct
        return b"GP\x00" + bytes([flags]) + struct.pack("<i", 4674) + b"\x01" + struct.pack("<I", 1) + struct.pack("<dd", lon, lat)

    def test_ponto_do_gpkg(self):
        self.assertEqual(self.P.ponto_do_gpkg(self.blob(-48.5, -27.5)), (-48.5, -27.5))
        self.assertIsNone(self.P.ponto_do_gpkg(self.blob(-48.5, -27.5, flags=0b00010001)))   # vazio
        self.assertIsNone(self.P.ponto_do_gpkg(b""))
        self.assertIsNone(self.P.ponto_do_gpkg(b"XX" + b"\x00" * 30))

    def test_numero_do_ibge(self):
        self.assertEqual([self.P.numero_br(x) for x in ('"928"', ".", "", "12,0", "abc")], [928, 0, 0, 12, 0])

    def test_centroide_pega_o_maior_anel_e_ignora_o_furo(self):
        quad = [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)]
        furo = [(1, 1), (1, 2), (2, 2), (2, 1), (1, 1)]
        pts = quad + furo
        x, y = self.P.centroide_do_poligono(pts, [0, 5])
        self.assertAlmostEqual(x, 2.0)
        self.assertAlmostEqual(y, 2.0)
        self.assertIsNone(self.P.centroide_do_poligono([], []))
        self.assertEqual(self.P.centroide_do_poligono([(1, 1), (1, 1)], [0]), (1.0, 1.0))   # degenerado

    def test_escolas_do_gpkg(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "e.gpkg"
            con = sqlite3.connect(str(f))
            con.execute("create table gpkg_contents (table_name text)")
            con.execute("insert into gpkg_contents values ('schools_2023')")
            con.execute("create table schools_2023 (fid integer, geom blob, abbrev_state text, name_muni text, "
                        "code_school integer, name_school text, admin_category text, urban text)")
            linhas = [
                (1, self.blob(-48.5, -27.5), "SC", "Florianópolis", 42000001, "EEB UM", "Pública", "Sim"),
                (2, self.blob(-48.6, -27.6), "SC", "Florianópolis", 42000002, "COLEGIO DOIS", "Privada", "Não"),
                (3, self.blob(0.0, 0.0), "SC", "Palhoça", 42000003, "FORA DO BRASIL", "Pública", "Sim"),
                (4, None, "SC", "Palhoça", 42000004, "SEM PONTO", "Pública", "Sim"),
                (5, self.blob(-47.9, -15.8), "DF", "Brasília", 53000001, "CEF TRES", "Pública", "Sim"),
            ]
            con.executemany("insert into schools_2023 values (?,?,?,?,?,?,?,?)", linhas)
            con.commit()
            con.close()
            por_uf, est = self.P.escolas_do_gpkg(f)
        self.assertEqual((est["lidas"], est["sem_ponto"], est["fora_do_brasil"], est["publicadas"]), (5, 1, 1, 3))
        sc = por_uf["SC"]
        self.assertEqual(sc["sem_coord"], 1)
        self.assertEqual(sc["mun"], ["Florianópolis"])
        self.assertEqual(sc["e"][0], [42000001, -27.5, -48.5, "EEB UM", 0, 2])      # publica, urbana
        self.assertEqual(sc["e"][1][5], 1)                                          # privada, rural

    def test_basico_e_pessoas_da_uf(self):
        try:
            import shapefile
        except ImportError:
            self.skipTest("pyshp nao instalado")
        P = self.P
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            cab = '"CD_SETOR";"CD_MUN";"NM_MUN";"v0001"\n'
            corpo = ('"420540705000001";"4205407";"Florianópolis";"928"\n'
                     '"420540705000002";"4205407";"Florianópolis";"."\n'
                     '"420540705000003";"4205407";"Florianópolis";"100"\n')
            with zipfile.ZipFile(d / "b.zip", "w") as z:
                z.writestr("basico.csv", (cab + corpo).encode("latin-1"))
            basico = P.ler_basico(d / "b.zip")
            self.assertEqual(basico["420540705000001"], (928, "4205407", "Florianópolis"))
            self.assertEqual(basico["420540705000002"][0], 0)

            base = d / "SC_setores_CD2022"
            w = shapefile.Writer(str(base), shapeType=shapefile.POLYGON)
            w.field("CD_SETOR", "C", 15)
            w.poly([[(-48.6, -27.6), (-48.6, -27.4), (-48.4, -27.4), (-48.4, -27.6), (-48.6, -27.6)]])
            w.record("420540705000001")
            w.poly([[(-48.3, -27.6), (-48.3, -27.5), (-48.2, -27.5), (-48.2, -27.6), (-48.3, -27.6)]])
            w.record("420540705000002")          # 0 pessoas: fica de fora
            w.poly([[(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]])
            w.record("420540705000003")          # fora do Brasil: descartado
            w.close()
            with zipfile.ZipFile(d / "orig.zip", "w") as z:
                for ext in (".shp", ".shx", ".dbf"):
                    z.write(str(base) + ext, "SC_setores_CD2022" + ext)

            def falso(url, destino, tentativas=3):
                Path(destino).write_bytes((d / "orig.zip").read_bytes())
            original, P.baixar = P.baixar, falso
            try:
                dados, est = P.pessoas_da_uf("SC", basico, d)
            finally:
                P.baixar = original
        self.assertEqual(dados["mun"], [["4205407", "Florianópolis"]])
        self.assertEqual(dados["p"], [-485000, -275000, 928, 0])
        self.assertEqual((est["setores"], est["sem_geometria"], est["pessoas"]), (3, 1, 928))


class TesteHistorico(unittest.TestCase):
    def test_data_do_5g_nao_e_a_da_antena(self):
        """Uma ERB de 2003 que ganhou 5G em 2022 conta 4G em 2003 e 5G em 2022."""
        import historico as H
        from datetime import date
        _, _, info = C.consolidar([
            linha("1", ger="4G", d1="13/08/2003"),
            linha("1", ger="4G", d1="01/02/2010"),     # outra frequencia, mais nova: vale a menor
            linha("1", ger="5G", tec="NR", d1="05/03/2022"),
            linha("2", empresa="CLARO", ger="3G", d1="2015-06-01"),
            linha("3", ger="4G", d1=""),                # sem data: nao entra na curva
        ])
        h = info["historico"]
        self.assertEqual(h[("SC", "vivo", "4G", 2003)], 1)
        self.assertEqual(h[("SC", "vivo", "5G", 2022)], 1)
        self.assertEqual(h[("SC", "claro", "3G", 2015)], 1)
        self.assertNotIn(("SC", "vivo", "4G", 2010), h)
        self.assertEqual(info["historico_sem_data"], 1)
        d = H.montar(h, info["historico_sem_data"], C.OPERADORAS, hoje=date(2026, 11, 16))
        self.assertEqual(d["anos"][0], 2003)
        self.assertEqual(d["anos"][-1], 2026)
        self.assertEqual(d["uf"]["SC"]["vivo"]["5G"][2022 - 2003], 1)
        self.assertEqual(sum(d["uf"]["SC"]["vivo"]["4G"]), 1)
        self.assertEqual(len(d["uf"]["SC"]["vivo"]["4G"]), len(d["anos"]))

    def test_sem_nenhuma_data_nao_quebra(self):
        import historico as H
        d = H.montar({}, 5, C.OPERADORAS)
        self.assertEqual((d["anos"], d["uf"], d["sem_data"]), ([], {}, 5))

    def test_gerar_escreve_historico_json(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            montar_zip(t / "b.zip", [linha("1", ger="5G", tec="NR", d1="05/03/2022")])
            self.assertEqual(gerar.main(["--zip", str(t / "b.zip"), "--saida", str(t / "o"), "--sem-planilha"]), 0)
            d = json.loads((t / "o" / "historico.json").read_text(encoding="utf-8"))
            self.assertEqual(d["uf"]["SC"]["vivo"]["5G"][-1 - (d["anos"][-1] - 2022)], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
