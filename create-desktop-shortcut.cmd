@echo off
REM Crea (o rimuove) il collegamento "NCHAT" sul Desktop e nel menu Start.
REM Il collegamento avvia il server di sviluppo e apre una finenza dedicata
REM senza barra del browser.
REM
REM   create-desktop-shortcut.cmd            crea o aggiorna i collegamenti
REM   create-desktop-shortcut.cmd delete     li rimuove
REM
REM La logica sta in tools\install-shortcut.ps1, cosi e leggibile e verificabile.

setlocal
cd /d "%~dp0"

if /i "%~1"=="delete" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-shortcut.ps1" -Remove
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-shortcut.ps1"
)

if errorlevel 1 (
  echo.
  echo  Operazione non riuscita. Leggi il messaggio sopra.
  echo.
  pause
  exit /b 1
)

echo.
pause
exit /b 0
