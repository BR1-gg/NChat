@echo off
REM Avvia NCHAT in modalita sviluppo.
REM Il progetto richiede Node installato; se "npm" non e nel PATH,
REM imposta NODE_PORTABLE prima di eseguire questo file.

setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\NodePortable\npm.cmd" (
    echoUso di Node Portable trovato in %LOCALAPPDATA%\NodePortable
    set "PATH=%LOCALAPPDATA%\NodePortable;%PATH%"
  ) else (
    echo.
    echo  ERRORE: npm non trovato nel PATH.
    echo  Installa Node.js oppure imposta NODE_PORTABLE sulla cartella che
    echo  contiene node.exe e npm.cmd, poi riapri questo file.
    echo.
    pause
    exit /b 1
  )
)

if not exist node_modules (
  echo Prima esecuzione: installo le dipendenze...
  call npm.cmd install
  if errorlevel 1 (
    echo Installazione delle dipendenze fallita.
    pause
    exit /b 1
  )
)

echo.
echo  NCHAT in sviluppo: http://localhost:5173
echo  Per fermare il server premi Ctrl+C in questa finestra.
echo.
call npm.cmd run dev
