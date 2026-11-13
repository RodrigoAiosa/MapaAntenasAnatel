@echo off
rem ABRE O MAPA DE ANTENAS PELO NAVEGADOR, COM ENDERECO (http://localhost).
rem
rem Por que nao dar duplo clique no HTML: aberto como arquivo, o navegador nao
rem manda Referer, e o servidor oficial do OpenStreetMap troca todo tile pedido
rem sem Referer por um aviso de bloqueio. O mapa entao cai num servidor de
rem reserva (OSM Franca), que funciona, mas e muito mais lento.
rem
rem Este .bat sobe um servidor minimo SO nesta maquina (lancador.ps1), que
rem entrega o HTML e mais nada, e abre o navegador nele. Fica uma janela
rem minimizada na barra de tarefas enquanto o mapa estiver em uso: feche-a
rem para encerrar. Rodar este .bat de novo so reabre o navegador.
if not exist "%~dp0MapaDeAntenas.html" (
  echo.
  echo  Nao achei o MapaDeAntenas.html nesta pasta.
  echo  Se voce recebeu o mapa: extraia tudo e deixe os arquivos juntos na mesma pasta.
  echo  Se voce gera o mapa: rode o INICIAR.bat, opcao 2.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0lancador.ps1" (
  echo.
  echo  Nao achei o lancador.ps1 nesta pasta. Ele tem que ficar junto do .bat.
  echo.
  pause
  exit /b 1
)
start "Mapa de Antenas" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancador.ps1" -Arquivo "%~dp0MapaDeAntenas.html" -Porta 8731 -Titulo "Mapa de Antenas"
