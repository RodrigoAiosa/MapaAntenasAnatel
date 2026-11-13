@echo off
chcp 65001 >nul
title Mapa de Antenas Anatel
cd /d "%~dp0"
color 0B

:: ---------------------------------------------------------------
:: Acha o Python. Prioriza o caminho real instalado nesta maquina,
:: porque o "python.exe" de WindowsApps pode ser so um atalho da
:: Microsoft Store que abre a loja em vez de rodar o script.
:: ---------------------------------------------------------------
set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -c "import sys" >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERRO] Nao encontrei o Python nesta maquina.
    echo  Instale em https://www.python.org/downloads/ marcando
    echo  a opcao "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

:: openpyxl escreve a planilha. O resto e biblioteca padrao do Python.
"%PY%" -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Instalando a biblioteca openpyxl, um instante...
    "%PY%" -m pip install --quiet openpyxl
    echo.
)

:MENU
cls
echo.
echo  ===========================================================
echo    MAPA DE ANTENAS ANATEL  -  ERBs licenciadas
echo  ===========================================================
echo.
echo    Mostra no mapa cada estacao radio base (antena de celular)
echo    da Claro, TIM, Vivo e demais, com a geracao (2G a 5G), e
echo    gera a mesma base em planilha Excel.
echo.
echo  -----------------------------------------------------------
echo.
echo    [1]  Baixar a base da Anatel      (~90 MB, sem login)
echo    [2]  Gerar o mapa e a planilha    (offline, ~1,5 min)
echo    [3]  Fazer tudo: baixar e gerar
echo.
echo    [4]  Gerar so de um estado        (ex.: SC - menor)
echo    [5]  Rodar os testes              (offline)
echo    [6]  Abrir o mapa
echo    [0]  Sair
echo.
echo  -----------------------------------------------------------
if exist "dados_anatel\estacoes_smp.zip" (
    echo    Base : ja baixada nesta pasta.
) else (
    echo    Base : ainda nao baixada - comece pela opcao 1.
)
if exist "MapaDeAntenas.html" (
    echo    Mapa : gerado.
) else (
    echo    Mapa : ainda nao gerado.
)
echo.
set /p OPCAO="   Escolha uma opcao: "

if "%OPCAO%"=="1" goto BAIXAR
if "%OPCAO%"=="2" goto GERAR
if "%OPCAO%"=="3" goto TUDO
if "%OPCAO%"=="4" goto GERARUF
if "%OPCAO%"=="5" goto TESTES
if "%OPCAO%"=="6" goto ABRIR
if "%OPCAO%"=="0" exit /b 0
goto MENU

:BAIXAR
cls
echo.
"%PY%" coletar\baixar_anatel.py
echo.
pause
goto MENU

:GERAR
cls
echo.
"%PY%" ferramentas\gerar.py
echo.
pause
goto MENU

:TUDO
cls
echo.
"%PY%" coletar\baixar_anatel.py
if errorlevel 1 goto FIMTUDO
"%PY%" ferramentas\gerar.py
:FIMTUDO
echo.
pause
goto MENU

:GERARUF
cls
echo.
echo  Gera o mapa e a planilha so das UFs escolhidas. Sai com o nome
echo  MapaDeAntenas_SC.html, por exemplo, sem mexer no mapa do Brasil.
echo.
set /p UFS="   UF(s), separadas por virgula (ex.: SC ou SC,PR,RS): "
if "%UFS%"=="" goto MENU
"%PY%" ferramentas\gerar.py --uf "%UFS%"
echo.
pause
goto MENU

:TESTES
cls
echo.
"%PY%" tests\test_antenas.py
echo.
pause
goto MENU

:ABRIR
:: Pelo lancador, e nao "start" no HTML: com endereco (http://localhost) o
:: mapa base vem do OSM oficial, bem mais rapido. Ver ABRIR_MAPA.bat.
if exist "MapaDeAntenas.html" (
    call "%~dp0ABRIR_MAPA.bat"
) else (
    echo.
    echo  O mapa ainda nao foi gerado. Use a opcao 2.
    echo.
    pause
)
goto MENU
