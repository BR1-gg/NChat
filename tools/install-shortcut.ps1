<#
Crea (o rimuove) il collegamento "NCHAT" sul Desktop e nel menu Start.

  powershell -ExecutionPolicy Bypass -File tools\install-shortcut.ps1
  powershell -ExecutionPolicy Bypass -File tools\install-shortcut.ps1 -Remove

Il collegamento avvia tools\run-tray.ps1 con una console nascosta, cosi l'unica
presenza di NCHAT e l'icona nella barra di sistema.

Nota: %DESKTOP% non e definito su Windows moderno e la cartella puo essere
spostata su un altro disco, quindi il percorso lo risolve .NET.
#>
[CmdletBinding()]
param(
  [switch] $Remove,
  # La porta del server di sviluppo. Serve solo per riconoscere la scorciatoia
  # dell'app installata da Edge, che apre il browser dritto su questo indirizzo.
  # Deve coincidere con -Port in tools\run-tray.ps1.
  [int] $Port = 5173
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $project 'tools\run-tray.ps1'
$trayIcon = Join-Path $project 'public\nchat.ico'

function Stop-WithError([string] $Message) {
  # Con $ErrorActionPreference = 'Stop' una Write-Error produrrebbe una
  # eccezione con stack trace: qui si vuole un messaggio pulito e un exit code.
  Write-Host ''
  Write-Host "  ERRORE: $Message" -ForegroundColor Red
  exit 1
}

function Get-ShortcutPaths {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = [Environment]::GetFolderPath('StartMenu')
  @(
    (Join-Path $desktop 'NCHAT.lnk'),
    (Join-Path (Join-Path $startMenu 'Programs') 'NCHAT.lnk')
  )
}

<#
  Le scorciatoie che NON devono esistere, e perche si rimuovono da sole.

  Edge crea un collegamento quando l'utente installa NCHAT come app ("Installa
  app"). Quella scorciatoia chiama il browser **dritto** sull'indirizzo del server di
  sviluppo, e quindi:

  1. non avvia niente, quindi se il server non e gia su apre una pagina vuota — e
     l'utente vede un'icona che non funziona e non sa perche;
  2. usa il profilo del browser, non quello con cui il tray avvia la finestra, quindi
     due finestre con due situazioni diverse;
  3. sta sul Desktop accanto a quella vera, e due icone con nomi quasi uguali sono il
     modo piu rapido per non sapere quale premere. Esattamente quello che e
     successo: «due icone, una per il server e una per la UI».

  Il nome che Edge dà e `<titolo del manifest>.lnk`, quindi cambia con il titolo.
  Si cercano quindi per **contenuto**: e l'unico modo per prenderla qualunque sia il
  nome, e per prenderla anche in un secondo momento, quando Edge l'ha creata con un
  titolo diverso.
#>
function Get-InstalledAppShortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $found = @()
  $folders = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
  )
  # Solo le scorciatoie che aprono **questuesta** app installata.
  #
  # La versione precedente accettava qualunque `.lnk` con `--app-url` negli
  # argomenti, e li cancellava. Quindi installare NCHAT cancellava anche le app
  # installate dall'utente per altri siti — Spotify, WhatsApp, un gestionale — senza
  # chiedere e senza che il messaggio dicesse quali. Non e un dettaglio: e il
  # programma che cancella roba dell'utente che non c'entra con NCHAT.
  #
  # Ora il filtro e su due cose che insieme identificano questa app: il nome del
  # collegamento, che Edge prende dal manifest (`NCHAT ...`), e l'indirizzo del
  # server di sviluppo, che la scorciatoia apre. Se non e NCHAT, non si tocca.
  $portPattern = "127\.0\.0\.1:$Port|localhost:$Port"
  foreach ($folder in $folders) {
    if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -ErrorAction SilentlyContinue) {
      $link = $shell.CreateShortcut($file.FullName)
      if ($link.Arguments -notmatch '--app-url') { continue }
      $isOurName = $file.BaseName -match '^NCHAT'
      $isOurUrl = $link.Arguments -match $portPattern
      if ($isOurName -or $isOurUrl) { $found += $file.FullName }
    }
  }
  return $found
}

function Remove-InstalledAppShortcuts {
  $rimossi = 0
  foreach ($path in (Get-InstalledAppShortcuts)) {
    try {
      Remove-Item -LiteralPath $path -Force
      Write-Host "  rimosso (app installata da Edge): $path"
      $rimossi += 1
    } catch {
      Write-Host "  non ho potuto rimuovere $path : $($_.Exception.Message)"
    }
  }
  return $rimossi
}

if ($Remove) {
  $removed = 0
  foreach ($path in Get-ShortcutPaths) {
    if (Test-Path $path) {
      Remove-Item -LiteralPath $path -Force
      Write-Host "  rimosso: $path"
      $removed += 1
    }
  }
  $removed += (Remove-InstalledAppShortcuts)
  if ($removed -eq 0) { Write-Host '  Nessun collegamento da rimuovere.' }
  exit 0
}

if (-not (Test-Path -LiteralPath $launcher)) { Stop-WithError "Non trovo $launcher." }
if (-not (Test-Path -LiteralPath $trayIcon)) { Stop-WithError "Non trovo l'icona $trayIcon. Rigenerala con tools\make-icons.ps1." }

<#
  L'host con cui eseguire il tray, risolto senza indovinare.

  Prima era `Join-Path $PSHOME 'powershell.exe'`, che funziona solo se lo script
  viene lanciato da Windows PowerShell 5.1: sotto PowerShell 7 `$PSHOME` e la
  cartella di pwsh, dove `powershell.exe` **non esiste**, e lo script si fermava con
  «Non trovo ...\PowerShell\7\powershell.exe». Il comando documentato per installare
  la scorciatoia funzionava quindi solo metà delle volte, e solo se l'utente non
  aveva PowerShell 7 come shell predefinita — che e esattamente cio che capita
  dopo aver installato pwsh per seguire le istruzioni di Node.

  Si prova l'host corrente e si cade su quello di sistema: il tray usa
  System.Windows.Forms, quindi Windows PowerShell e la scelta che funziona sempre.
#>
function Resolve-ShellExe {
  $current = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  if ($current -and (Test-Path -LiteralPath $current)) { return $current }
  $system = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path -LiteralPath $system) { return $system }
  return $null
}

$shellExe = Resolve-ShellExe
if (-not $shellExe) {
  Stop-WithError 'Non trovo un host PowerShell da usare per il collegamento.'
}

# Si riusa lo stesso oggetto WScript.Shell per piu collegamenti.
$shell = New-Object -ComObject WScript.Shell
$created = @()
foreach ($path in Get-ShortcutPaths) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $shellExe
  # Le virgolette servono: il percorso del progetto contiene spazi.
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $shortcut.WorkingDirectory = $project
  # 7 = minimized, nel caso il flag sopra non venisse onorato.
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NCHAT - visual prompt graph'
  $shortcut.IconLocation = "$trayIcon,0"
  $shortcut.Save()
  if (-not (Test-Path -LiteralPath $path)) { Stop-WithError "Il collegamento non e stato creato: $path" }
  $created += $path
  Write-Host "  creato: $path"
}

Write-Host ''
# Anche in installazione, non solo in rimozione: la scorciatoia di Edge ricompare
# ogni volta che l'utente reinstalla l'app, e una icona che torna e rompe il
# avvio e peggio di non averla mai tolta.
$leftovers = Remove-InstalledAppShortcuts
if ($leftovers -gt 0) {
  Write-Host "  Ho tolto anche $leftovers scorciatoie di NCHAT installate come app: aprivano solo la UI e non partivano con niente."
}
Write-Host ''
Write-Host "Fatto. $($created.Count) collegamenti, una sola icona."
Write-Host '  Avvio: icona + server + finestra. Chiudere la finestra non ferma il server.'
Write-Host '  Arresto: menu dell''icona nella barra di sistema -> "Ferma il server ed esci".'
Write-Host '  Non reinstallare NCHAT come app da Edge: crea una seconda icona che apre solo la UI.'
exit 0
