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


if __name__ == "__main__":
    unittest.main(verbosity=2)
