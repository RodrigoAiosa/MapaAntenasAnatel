# LANCADOR DO MAPA DE ANTENAS - abre o mapa por http://localhost.
#
# POR QUE EXISTE: desde 11/09/2026 o servidor oficial do OpenStreetMap troca
# todo tile pedido SEM Referer por um aviso de "Access blocked" - e com HTTP
# 200, entao nada da erro, o mapa inteiro so vira aviso. Pagina aberta por
# duplo clique (file://) nunca manda Referer. Com endereco, mesmo que seja so
# localhost, o navegador manda, e o OSM oficial serve. Medido em 11/09/2026:
# 2,3 s no roteiro de 7 passos em que o servidor de reserva (OSM Franca), o
# unico que serve sem Referer, levou 33,4 s.
#
# O QUE FAZ: sobe um servidor HTTP minimo SO nesta maquina, entrega o arquivo
# passado em -Arquivo e abre o navegador nele. Os tiles continuam indo direto
# da internet para o navegador; este servidor so entrega o HTML.
#
# SEGURANCA - importa porque o lote de pontos pode ter coordenadas privadas:
#   - escuta so em localhost. O HttpListener recusa pedido cujo Host nao seja
#     localhost:porta, o que tambem barra DNS rebinding (um site de fora que
#     aponte o proprio nome para 127.0.0.1 recebe 400, nunca o arquivo);
#   - e so o Host nao basta: o http.sys aceita a CONEXAO em todas as placas de
#     rede e so depois olha o cabecalho, que outra maquina pode forjar. Por
#     isso todo pedido que nao venha de um endereco de loopback leva 403;
#   - entrega UM arquivo. Qualquer outro caminho e 404. O caminho pedido nunca
#     vira caminho de disco, entao nao ha listagem de pasta nem "../" que
#     alcance outro arquivo.
#
# Sem instalar nada e sem administrador: HttpListener em localhost nao pede
# reserva de URL (testado em 11/09/2026 com usuario comum).
#
# Veio do mapa original do Cliver; muda so o .bat que o chama. Escrito em
# ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI, e acento
# viraria lixo na janela.

param(
  [Parameter(Mandatory = $true)] [string] $Arquivo,
  [int] $Porta = 8731,
  [string] $Titulo = 'Mapa',
  # Para os testes: sobe o servidor sem abrir o navegador.
  [switch] $SemNavegador
)

$ErrorActionPreference = 'Stop'

$caminho = [System.IO.Path]::GetFullPath($Arquivo)
if (-not (Test-Path -LiteralPath $caminho -PathType Leaf)) {
  Write-Host ''
  Write-Host "  Nao achei o arquivo do mapa: $caminho"
  Write-Host ''
  exit 2
}
$nome = [System.IO.Path]::GetFileName($caminho)

# Resposta do endereco /__lancador. E como uma segunda execucao do .bat
# reconhece que o MESMO mapa ja esta sendo servido naquela porta.
$assinatura = 'lancador-mapa-antenas|' + $caminho.ToLowerInvariant()

try { $Host.UI.RawUI.WindowTitle = "$Titulo - servidor local" } catch { }

function Abrir-NoNavegador([int] $p) {
  if (-not $SemNavegador) { Start-Process ("http://localhost:$p/") }
}

function Ja-Servindo([int] $p) {
  try {
    $req = [System.Net.WebRequest]::Create("http://localhost:$p/__lancador")
    $req.Timeout = 1500
    # O proxy da empresa nunca deve receber pedido para localhost.
    $req.Proxy = $null
    $resp = $req.GetResponse()
    $leitor = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $texto = $leitor.ReadToEnd()
    $leitor.Close()
    $resp.Close()
    return ($texto -eq $assinatura)
  } catch {
    return $false
  }
}

# Porta preferida primeiro; se estiver ocupada por OUTRO programa, as nove
# seguintes. Se ja houver um lancador deste mesmo mapa rodando, so abre o
# navegador nele e sai: rodar o .bat duas vezes nao pode empilhar servidores.
$ouvinte = $null
$portaUsada = 0
for ($p = $Porta; $p -lt ($Porta + 10); $p++) {
  if (Ja-Servindo $p) {
    Write-Host "  O mapa ja esta aberto em http://localhost:$p/ - abrindo o navegador."
    Abrir-NoNavegador $p
    exit 0
  }
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try {
    $l.Start()
    $ouvinte = $l
    $portaUsada = $p
    break
  } catch {
    try { $l.Close() } catch { }
  }
}
if (-not $ouvinte) {
  Write-Host ''
  Write-Host "  Nenhuma porta livre entre $Porta e $($Porta + 9). Feche outros programas e tente de novo."
  Write-Host ''
  exit 3
}

Write-Host ''
Write-Host "  $Titulo aberto em http://localhost:$portaUsada/"
Write-Host ''
Write-Host '  Deixe esta janela aberta enquanto usar o mapa.'
Write-Host '  Feche-a para encerrar.'
Write-Host ''
Abrir-NoNavegador $portaUsada

while ($ouvinte.IsListening) {
  $tarefa = $ouvinte.GetContextAsync()
  # Espera em fatias: um GetContext() direto prende o PowerShell, e nem o
  # Ctrl+C fecharia a janela ate chegar o proximo pedido.
  while (-not $tarefa.Wait(500)) { }
  $ctx = $tarefa.Result
  $resp = $ctx.Response
  try {
    $metodo = $ctx.Request.HttpMethod
    $pedido = $ctx.Request.Url.AbsolutePath
    # O navegador nunca guarda o mapa: regerar o arquivo com o lancador aberto
    # tem que valer no proximo F5.
    $resp.Headers['Cache-Control'] = 'no-store'
    $resp.Headers['X-Content-Type-Options'] = 'nosniff'
    if (-not [System.Net.IPAddress]::IsLoopback($ctx.Request.RemoteEndPoint.Address)) {
      $resp.StatusCode = 403
    } elseif ($metodo -ne 'GET' -and $metodo -ne 'HEAD') {
      $resp.StatusCode = 405
    } elseif ($pedido -eq '/' -or $pedido -eq ('/' + $nome)) {
      # Lido a cada pedido, e nao uma vez na partida, pelo mesmo motivo.
      $bytes = [System.IO.File]::ReadAllBytes($caminho)
      $resp.ContentType = 'text/html; charset=utf-8'
      $resp.ContentLength64 = $bytes.Length
      if ($metodo -eq 'GET') { $resp.OutputStream.Write($bytes, 0, $bytes.Length) }
    } elseif ($pedido -eq '/__lancador') {
      $b = [System.Text.Encoding]::UTF8.GetBytes($assinatura)
      $resp.ContentType = 'text/plain; charset=utf-8'
      $resp.ContentLength64 = $b.Length
      $resp.OutputStream.Write($b, 0, $b.Length)
    } else {
      $resp.StatusCode = 404
    }
  } catch {
    # O navegador fechou a conexao no meio da resposta: nada a fazer.
  } finally {
    try { $resp.Close() } catch { }
  }
}
