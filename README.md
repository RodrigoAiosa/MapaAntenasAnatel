# Mapa de Antenas Anatel

Cada **estação rádio base (ERB)** de telefonia celular licenciada na Anatel,
no mapa, **colorida pela operadora** (Claro, TIM, Vivo, Algar, Brisanet,
Unifique, Sercomtel e outras), com geração (2G a 5G), faixas e endereço.
Responde: *"qual é a antena mais próxima deste endereço, de cada operadora, e ela tem 3G?"*

Versão pronta para a **Vercel**, derivada do projeto
[JvFaraco/mapa-antenas-anatel](https://github.com/JvFaraco/mapa-antenas-anatel) (MIT),
que por sua vez parte do mapa de Cliver Domingos Guisolphi. Todas as funções do
mapa (busca por endereço/CEP/coordenada, pino arrastável, lote de pontos, mancha
de cobertura, ficha da ERB) estão descritas em
[docs/FUNCIONALIDADES-original.md](docs/FUNCIONALIDADES-original.md).

## Publicar na Vercel

1. Na Vercel: **Add New → Project → Import** `RodrigoAiosa/MapaAntenasAnatel`.
2. Não mude nada: o `vercel.json` já define build (`python3 scripts/vercel_build.py`), saída (`public/`) e cabeçalhos.
3. **Deploy.** O build baixa a base da Anatel (~90 MB), gera o mapa e só publica se a conferência `lidas = no mapa + fora` fechar.
4. *(Atualização semanal)* Em **Settings → Git → Deploy Hooks**, crie um hook para `main`, e salve a URL como secret `VERCEL_DEPLOY_HOOK_URL` no GitHub (**Settings → Secrets and variables → Actions**). O workflow `atualizar-base.yml` refaz o deploy todo dia, 06:00 de Brasília.

Variáveis opcionais em [`.env.example`](.env.example): `SITE_URL`, `INCLUIR_PLANILHA=1` (publica o `.xlsx` em `/dados/`) e `UFS` (recorte).

> **Atenção:** o portal da Anatel aceitou as máquinas do GitHub, mas não foi possível
> testar a partir da Vercel. Se o download for recusado no build, o deploy falha e o
> site anterior continua no ar. Nesse caso, gere o `public/` num GitHub Actions
> e publique com `vercel deploy --prebuilt`.

## O que este repositório acrescenta ao original

| Item | Onde |
|---|---|
| Configuração de deploy da Vercel (build, saída, URLs limpas) | `vercel.json`, `scripts/vercel_build.py` |
| Cabeçalhos de segurança: CSP, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` | `vercel.json` |
| Cache correto por tipo de arquivo | `vercel.json` |
| SEO: `canonical`, Open Graph, Twitter Card, `robots.txt`, `sitemap.xml` | `scripts/vercel_build.py`, `public_extra/` |
| PWA: `manifest.webmanifest` e ícone, instalável no celular | `public_extra/` |
| **Cartão-resposta** (a melhor antena primeiro), **botão de localização por GPS** e **exemplos clicáveis** na busca | `app/js/app.js` |
| **Menu fecha arrastando para a esquerda** no celular (acompanha o dedo; não atrapalha rolagem nem a barra de raio) | `app/js/painel.js` |
| **Painel em seções recolhíveis** (o básico aberto, o avançado fechado; lembra sua escolha) | `app/js/painel.js` |
| **Meus lugares**: salvar pontos favoritos e buscas recentes (só no navegador) | `app/js/app.js` |
| **"Qual operadora é melhor aqui?"**: ranking de 0 a 100 por proximidade, geração e quantidade de antenas (não mede sinal) | `app/js/geo.js`, `app/js/app.js` |
| **Funciona offline** e abre instantâneo nas visitas seguintes (service worker; offline ficam as antenas, sem mapa de fundo) | `public_extra/sw.js` |
| **Botão Compartilhar**: WhatsApp (computador) ou folha de compartilhamento do aparelho (celular), com o link do ponto marcado | `app/js/app.js` |
| **Tour gamificado** na primeira visita: 15 missões com XP, níveis, sumário clicável, conquista final e botão 🏆 "Missões" no topo para refazer (só `localStorage`, nada sai do navegador) | `app/js/tour.js` |
| Página 404 própria | `public_extra/404.html` |
| Página **Sobre / Privacidade (LGPD)**: fonte, limites, serviços de terceiros | `public_extra/sobre.html` |
| `/status.json`: data da base, contagens e commit, para monitorar | `scripts/vercel_build.py` |
| Planilha Excel como download opcional | `INCLUIR_PLANILHA=1` |
| Atualização semanal automática via Deploy Hook | `.github/workflows/atualizar-base.yml` |
| CI com testes a cada push e pull request | `.github/workflows/ci.yml` |
| Funciona em qualquer sistema (o original depende de `.bat` e PowerShell) | `npm run build`, `npm run dev` |
| Dependabot, templates de issue/PR, `SECURITY.md`, `CONTRIBUTING.md`, `.env.example` | raiz e `.github/` |

## Desenvolvimento

```bash
npm test             # testes Python e Node (offline, dados inventados)
npm run build:sc     # baixa a base e gera public/ só com SC (rápido)
npm run build        # Brasil inteiro (~1,5 min, ~12 MB)
npm run dev          # serve public/ em http://localhost:3000
```

Requer Python 3.10+ e Node 20+ (Node só para `npm test` e os scripts). A planilha usa `openpyxl`.
Nunca edite `public/`: é gerado. Edite `app/`, `ferramentas/` ou `public_extra/`.

Os scripts `.bat`/`.ps1` do original continuam aqui para quem usa Windows.

## Fonte dos dados e limites

Base aberta da Anatel (painel *Outorga e Licenciamento → Estações*, SMP). **Licenciada não quer
dizer ligada**: a base mostra a licença, não se a antena está no ar nem o alcance do sinal.

## Licença

Código sob [MIT](LICENSE), com os direitos de João Victor Faraco preservados. Leaflet e as fontes
Inter e Montserrat (em `ferramentas/vendor/`) mantêm as licenças próprias (BSD-2 e OFL).
Mapas © colaboradores do OpenStreetMap.

## Foto da rua no balão do ponto

Ao marcar um ponto, o balão mostra coordenada, endereço, a antena mais próxima e a foto do Google Street View virada para essa antena. A foto só carrega depois de um clique (a coordenada vai ao Google). Para ativar, crie uma chave da Street View Static API, restrinja por referenciador ao seu domínio, defina um limite de cota e salve na Vercel como `STREETVIEW_KEY`. Sem a chave o balão mostra apenas o link "Abrir no Street View", que não precisa de chave.
