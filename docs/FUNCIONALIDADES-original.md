# Mapa de Antenas Anatel

Cada **estação rádio base (ERB)** de telefonia celular licenciada na Anatel,
marcada no mapa e **colorida pela operadora**: Claro, TIM, Vivo, Algar,
Brisanet, Unifique, Sercomtel e outras. Junto vão a geração (2G a 5G), as
faixas de frequência e o endereço. A mesma base sai também em **planilha Excel**.

A pergunta prática que o mapa responde: *"qual é a antena mais próxima deste
endereço, de cada operadora, e ela tem 3G?"*. Cole a coordenada de um endereço
na busca e o painel mostra a mais próxima de cada operadora, com a distância.

**Abrir o mapa online: o site publicado**

Nada para instalar. O site é refeito toda segunda com a base do dia da Anatel
(veja [Publicação no GitHub Pages](#publicação-no-github-pages)). Para gerar a
planilha ou usar sem internet, siga o [Como usar](#como-usar).

> **Dado público.** É a base aberta da Anatel, sem nenhum dado pessoal. O
> mapa e a planilha podem circular.

## Créditos

A ideia e o motor original são de **Cliver Domingos Guisolphi**, num mapa
anterior dele (aposentado em 16/10/2026): Leaflet embutido, canvas próprio,
`cobertura.js`, `geo.js` e `lancador.ps1`. Os comentários que citam o "mapa
original" contam de onde veio cada regra.

O **Mapa de Antenas** foi criado a partir dele e é aprimorado e mantido por
**João Victor Faraco**:
- a base da Anatel e a consolidação de 3,3 milhões de linhas;
- a planilha;
- a busca da mais próxima por operadora;
- o visual e as animações de 10/11/2026.

---

## Como usar

Só quer consultar? Abra o [mapa online](https://jvfaraco.github.io/mapa-antenas-anatel/).
Para gerar o mapa e a planilha no próprio computador (Windows), dê duplo
clique em **`INICIAR.bat`**:

| Opção | O que faz | Quanto leva |
|---|---|---|
| **1** | baixa a base da Anatel (~90 MB, sem login) | ~10 s a 1 min |
| **2** | gera o `MapaDeAntenas.html` e a planilha `.xlsx` (offline) | ~1,5 min |
| **3** | as duas coisas | |
| **4** | gera só de uma ou mais UFs (ex.: `SC` ou `SC,PR,RS`), arquivos menores | ~1 min |
| **5** | roda os testes (offline, dados inventados) | segundos |
| **6** | abre o mapa | |

A Anatel atualiza a base **todo dia**. A opção 1 só baixa de novo quando o
arquivo do servidor mudou.

### O que sai

| Arquivo | Conteúdo |
|---|---|
| `MapaDeAntenas.html` | o mapa, arquivo único (~12 MB) |
| `Antenas_SMP_Anatel_<data>.xlsx` | a base em planilha (~19 MB), com a data da base da Anatel no nome |
| `RELATORIO_GERACAO.txt` | contagens e a conferência: lidas = no mapa + fora do mapa |

### Abrir o mapa

Use o **`ABRIR_MAPA.bat`** (ou a opção 6). Ele abre por `http://localhost`, e o
desenho do mapa vem do OpenStreetMap oficial, que é rápido. Com duplo clique no
HTML também funciona, mas o desenho vem de um servidor de reserva bem mais lento
(o mapa não mostra aviso disso; o quadro âmbar foi retirado em 19/10/2026).

> **Por quê.** Desde 11/09/2026 o `tile.openstreetmap.org` troca todo tile
> pedido **sem `Referer`** por uma imagem de "Access blocked" (com HTTP 200, ou
> seja, nada dá erro), e página aberta por duplo clique nunca manda `Referer`.
> Aberto pelo `.bat`, o navegador manda, e o OSM oficial serve: 2,3 s contra
> 33,4 s do servidor de reserva (OSM França) no mesmo roteiro. Nenhum mapa base
> pode pedir chave de API: chave embutida viajaria junto com o arquivo. O
> `lancador.ps1` escuta só em localhost, recusa pedido de outra máquina e
> entrega um único arquivo.

Precisa de internet só para o desenho do mapa, para a mancha de cobertura e
para a busca por CEP ou endereço. As antenas estão dentro do arquivo.

---

## O que dá para fazer no mapa

| Quero… | Como |
|---|---|
| Antenas perto de um endereço | Digite o endereço (`Rua Felipe Schmidt, 300, Florianópolis`), o CEP (`88015-200`) ou a coordenada (`-27.5954, -48.5480`), ou **clique no mapa** para marcar um pino |
| Só onde tem 3G (voz) | *Gerações* → deixe só o **3G** marcado |
| Ir para uma cidade | Digite o município (`Joinville`, ou `Bom Jesus/SC` quando o nome se repete) |
| Achar uma ERB pelo número | Digite o nº da estação (o mesmo da Anatel) |
| Ver só um estado | *Estado (UF)* |
| Comparar com o que a operadora promete | *Mancha de cobertura* (Claro, TIM, Vivo) |
| Ver a geração das torres | *Colorir por* → **Geração mais alta** |
| Ver o mapa na tela toda | Botão à esquerda do título: esconde o menu lateral, e o mesmo botão traz de volta. No celular o menu já abre fechado (botão *Filtros*) |

Passe o mouse sobre uma antena para ver a operadora e as gerações sem
clicar. A barra no canto inferior esquerdo mostra quantas ERBs estão na tela,
a coordenada sob o cursor e o zoom. O selo no topo diz a data da base e há
quantos dias ela foi baixada. Acima de 15 dias o selo fica âmbar: a Anatel
atualiza todo dia, e o arquivo circula.

Na busca por ponto, o mapa voa até lá, mostra o raio e liga o ponto à mais
próxima de cada operadora com um feixe na cor dela. Quem ativou "reduzir
movimento" no Windows recebe tudo sem animação.

Clique numa antena para abrir a **ficha**: operadora, endereço, gerações,
tecnologias, faixas, setores, tipo de infraestrutura, desde quando está
licenciada, links para o Google Maps e o Street View, e as **outras ERBs no
mesmo ponto** (torre compartilhada).

A busca por ponto respeita os filtros: com só o 3G marcado, "a mais próxima da
TIM" é a mais próxima **com 3G**.

### O pino

**Um clique** num lugar vazio do mapa marca um pino ali, com as antenas em
volta. O botão direito (ou segurar o dedo, no celular) faz o mesmo. O pino é
um só: um clique em outro lugar move ele para lá. Para não atrapalhar o manuseio:

- **arrastar o mapa** continua só arrastando, sem marcar nada;
- **duplo clique** continua dando zoom, sem marcar;
- **clique numa antena** abre a ficha. Com a ficha aberta, o primeiro clique
  fora só fecha a ficha, e o pino fica onde estava.

**O pino pode ser arrastado.** A tabela da mais próxima de cada operadora, o
raio e os feixes acompanham enquanto ele anda, e o link da vista é atualizado
quando você solta. É a forma de corrigir a busca por CEP ou endereço, que cai
na rua: busque, arraste o pino até a casa certa olhando o mapa, e o quadro passa
a dizer "Ponto ajustado à mão" e de onde ele partiu.

**"Qual o endereço deste ponto?"** é o botão no quadro do pino. Ele mostra o
endereço mais próximo que o OpenStreetMap conhece e a que distância do pino ele
fica. Numa área rural, esse endereço pode ser uma estrada a 1 km. A coordenada
do pino só vai para o OpenStreetMap quando alguém clica nesse botão. Marcar,
mover ou arrastar o pino não manda nada.

### CEP e endereço

A busca também aceita **CEP** (`88015-200` ou `88015200`) e **endereço escrito**
(`Rua XV de Novembro, Joinville`). Para isso o mapa precisa perguntar a dois
serviços gratuitos e sem chave:

- o **CEP** vai ao [ViaCEP](https://viacep.com.br), que devolve a rua, o bairro e
  o município. A rua é então procurada no OpenStreetMap;
- o **endereço** vai ao [Nominatim](https://nominatim.openstreetmap.org), o
  buscador do OpenStreetMap. Quando mais de um lugar bate (a mesma rua em
  bairros diferentes, por exemplo), aparece uma lista para escolher.

Limites que valem saber:

- **A posição é da rua, não do número.** O OpenStreetMap tem poucos números de
  casa no Brasil, e o CEP aponta para a rua (ou o trecho dela). O mapa diz a
  precisão de cada resultado: no número, pela rua, pelo bairro ou pelo centro
  do município. Para a antena mais próxima "na porta", arraste o pino até a casa
  ou use a coordenada.
- **Isto sai do navegador.** O texto do CEP ou do endereço vai para esses
  serviços, e só quando você clica em Buscar. Coordenada, município, número de
  ERB e pino continuam sem sair (o pino só sai no botão "Qual o endereço deste
  ponto?"). O link da vista guarda só a coordenada.
- **O lote não usa isto.** O lote de pontos continua só com coordenadas: mandar
  uma carteira de endereços para fora vazaria dado de cliente, e a política do
  Nominatim proíbe uso em lote.
- Os dois serviços são de terceiros. Se um deles estiver fora do ar, a busca
  diz isso e sugere colar a coordenada.

Número de 8 dígitos sem hífen é CEP quando não existe ERB com esse número.
Nenhuma ERB da base tem 8 dígitos.

### Lote de pontos

Para uma carteira inteira, e não um endereço por vez: cole no **Lote de
pontos** uma coordenada por linha, ou abra um CSV ou TXT. O formato pode ser
o da planilha (`ponto 1;-27,5954;-48,5480`), o do Google Maps
(`-27.5954, -48.548`) ou separado por tabulação. O que vier antes da
coordenada vira o identificador.

O mapa devolve:
- a mais próxima de cada operadora em cada ponto, até 50 km, respeitando os
  filtros de operadora, geração e UF;
- um resumo: em quantos pontos cada operadora é a mais próxima, em quantos ela
  tem ERB a até 5 km e a distância mediana;
- os pontos no mapa. Clicar num deles abre a busca por ponto;
- **Baixar CSV**, uma linha por ponto, em `;` com vírgula decimal, que abre
  direto no Excel.

Linha sem coordenada, fora do Brasil ou acima de 5.000 pontos não some: a
mensagem conta quantas foram e quais.

> **Os pontos ficam só neste navegador.** Nada é enviado, gravado no arquivo
> do mapa ou posto no link. Fechar a aba apaga. O mapa continua sem dado
> pessoal e pode circular.

### Link da vista

O endereço guarda a vista: região, zoom, ponto buscado, raio e filtros.
**Copiar link**, na barra de baixo, copia esse endereço. Colado num navegador
com o mapa aberto pelo `ABRIR_MAPA.bat`, ele volta à mesma vista. O tema e os
pontos do lote não vão no link.

### A planilha

| Aba | Conteúdo |
|---|---|
| **Estações** | uma ERB por linha, com filtro. As colunas `2G`/`3G`/`4G`/`5G` valem "Sim" ou vazio, para filtrar direto |
| **Por município** | quantas ERBs cada operadora tem em cada município, e quantas com cada geração |
| **Resumo** | operadora × geração e UF × operadora |
| **Fora do mapa** | ERBs sem coordenada válida (só aparece se houver alguma) |
| **Sobre** | fonte, data da base e as regras abaixo |

---

## De onde vem o dado

```
https://www.anatel.gov.br/dadosabertos/paineis_de_dados/outorga_e_licenciamento/estacoes_smp.zip
```

É o arquivo do painel *Outorga e Licenciamento → Estações* da Anatel: todas as
estações licenciadas do **Serviço Móvel Pessoal**. O zip tem um CSV só
(`Estacoes_SMP.csv`, ~1 GB descompactado), que **não é descompactado em
disco**: o gerador lê direto de dentro do zip.

> O conjunto "Estações Licenciadas" do dados.gov.br
> (`dadosabertos/PDA/Estacoes_Licenciadas/...SMP.csv`) **parou em 19/10/2023**.
> O do painel é o que a Anatel mantém vivo, conferido em 16/10/2026 com data de
> modificação do próprio dia.

**Licenciada não quer dizer ligada.** A base diz que a operadora tem licença
para operar aquela estação naquele endereço. Não diz se ela está no ar, nem
até onde o sinal chega. Para isso servem a mancha de cobertura e o sinal medido
no próprio local.

---

## Regras da consolidação

O CSV tem **uma linha por estação × setor × frequência × tecnologia**: 3,3
milhões de linhas para 114 mil estações. Cada regra abaixo foi medida na base
de 16/10/2026 e está em `ferramentas/consolidar.py`:

1. **Uma estação = um ponto.** A chave é o `Número Estação`. Gerações,
   tecnologias e faixas são a união de todas as linhas dela. Nenhuma estação
   tem mais de uma operadora.
2. **Coordenada = a mais frequente** entre as linhas da estação, contando só as
   que caem no Brasil. 1.871 estações têm mais de uma coordenada. Quase todas
   diferem em menos de 100 m (setores do mesmo mastro), mas **79 diferem em
   1 km ou mais**. Essas ficam marcadas: aviso "Posição incerta" na ficha e
   coluna *Coord. divergente (km)* na planilha. Não são corrigidas, porque daqui
   não há como saber qual das duas é a certa.
3. **Nenhuma ERB some em silêncio.** Quem não tem coordenada válida vai para
   "Fora do mapa", com o motivo, e o relatório confere `lidas = no mapa + fora`.
4. **Operadora por nome exato** (`Empresa Estação`). Nome desconhecido vai para
   **Outra**, e o nome original aparece na ficha e na planilha. É a mesma lição
   do `claro_br` no mapa original: casar por "contém" erra calado.
5. **Campo vazio fica vazio.** A infraestrutura (Greenfield, Rooftop…) falta em
   63% das linhas. Completar com o valor mais comum esconderia isso.

### Armadilha já resolvida

- **Fernando de Noronha.** A "caixa do Brasil" veio do mapa original com o
  limite leste em longitude −34, e a primeira geração jogou as **29 ERBs de
  Noronha** (−32,4) para fora do mapa. O relatório apontou na hora, porque
  todas eram do mesmo município. O limite agora é −28, que cobre também
  Trindade. Há teste para isso.

---

## Como o projeto é montado

```
coletar/baixar_anatel.py    baixa o zip (confere antes de substituir)  -> dados_anatel/
ferramentas/consolidar.py   3,3 mi linhas -> 1 linha por ERB (as regras acima)
ferramentas/planilha.py     a planilha .xlsx
ferramentas/gerar.py        orquestra: consolida, monta o HTML, a planilha e o relatório
app/modelo.html             a casca + todo o CSS (paleta propria; escuro e o padrao)
app/js/app.js               o aplicativo (canvas, filtros, busca, ficha, resumo, animacoes)
app/js/cobertura.js         a mancha das operadoras (veio do mapa original, igual)
app/js/endereco.js          busca por CEP (ViaCEP), endereço e endereço do pino (Nominatim), com a precisão
                            de cada resultado (10/11/2026)
app/js/geo.js               distâncias e janela de busca (do mapa original) + índice em
                            grade e leitura do lote (10/11/2026)
ferramentas/vendor/         Leaflet e as fontes Inter/Montserrat (OFL) embutidos (sem npm, sem CDN)
lancador.ps1                servidor local mínimo (só localhost, um arquivo)
tests/test_antenas.py       regras, geração de ponta a ponta e download cortado, com dados inventados
tests/geo_test.cjs          índice em grade, leitura do lote e busca por CEP/endereço sem rede
                            (Node; o test_antenas.py roda se houver Node)
.github/workflows/          publicar-mapa.yml: gera e publica o mapa no GitHub Pages
```

Só precisa de **Python** com `openpyxl`, que o `INICIAR.bat` instala se faltar.
Não depende do Node.

Editar `app/js/app.js` ou `app/modelo.html` e rodar a opção 2 remonta o HTML.
**Nunca edite o `MapaDeAntenas.html` direto**: ele é gerado e será
sobrescrito.

## Publicação no GitHub Pages

O site está em **o site publicado**.

O workflow `.github/workflows/publicar-mapa.yml` monta o mapa no próprio
GitHub e o publica como `index.html` do Pages. Ele roda toda segunda às 06:00
(horário de Brasília), quando chega código novo na `main` (`app/`,
`ferramentas/`, `coletar/` ou o próprio workflow) e quando alguém clica em
**Run workflow** na aba Actions. Os passos são estes:

1. roda os testes (`tests/test_antenas.py`, com dados inventados);
2. baixa a base do dia da Anatel (`coletar/baixar_anatel.py`);
3. gera só o mapa (`gerar.py --sem-planilha --saida _site`);
4. publica. O relatório de geração aparece no resumo da execução.

Se algum passo falhar, inclusive a conferência `lidas = no mapa + fora`, nada
é publicado e o site continua com a versão anterior. A base, a planilha e o
HTML gerado continuam fora do repositório (`.gitignore`).

Pelo endereço `https://…github.io`, o mapa base vem do OpenStreetMap oficial,
como pelo `ABRIR_MAPA.bat`. O lote de pontos continua só no navegador de quem
usa: o Pages entrega o arquivo e não recebe nada.

**Medido em 10/11/2026.** O portal da Anatel aceita as máquinas do GitHub. A
primeira execução baixou a base do dia, consolidou 3,3 milhões de linhas em
**114.459 ERBs**, fechou `lidas = no mapa + fora` sem nenhuma fora e publicou
tudo em cerca de 1min30s. Se a Anatel um dia passar a recusar, o passo 2 falha
e nada é publicado. Aí a saída é publicar o HTML gerado no notebook.

**Num fork, para ligar uma vez só:** o repositório precisa ser público, porque
em repositório privado o Pages exige plano pago. Depois, em **Settings > Pages >
Build and deployment > Source**, escolha **GitHub Actions** e rode o workflow
uma vez pela aba Actions.

## Licença

Código sob a licença [MIT](LICENSE). O Leaflet e as fontes Inter e Montserrat
embutidos em `ferramentas/vendor/` mantêm as licenças próprias (BSD-2 e OFL).
Os dados são da Anatel, de acesso público.
