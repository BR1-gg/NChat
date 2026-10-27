@echo off
REM Avvia NCHAT come app: icona nella barra di sistema, server di sviluppo e
REM finestra dedicata.
REM
REM   - Se chiudi la finestra, il SERVER RESTA ATTIVO.
REM   - Per fermarlo: menu dell'icona vicino all'orologio -> "Ferma il server ed esci".
REM   - Per riaprire la finestra: doppio click sull'icona, oppure "Apri NCHAT".
REM
REM Il collegamento sul Desktop (create-desktop-shortcut.cmd) avvia direttamente
REM tools\run-tray.ps1 senza passare da qui, quindi senza console visibile.
REM Questo file resta per chi preferisce fare doppio click dalla cartella.

setlocal
cd /d "%~dp0"

if not exist "%~dp0tools\run-tray.ps1" (
  echo.
  echo  ERRORE: manca tools\run-tray.ps1
  echo.
  pause
  exit /b 1
)

REM -WindowStyle Hidden toglie la console nera. -File non -Command, altrimenti
REM le virgolette del percorso verrebbero reinterpretate.
start "NCHAT" /MIN powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\run-tray.ps1" %*
exit /b 0
