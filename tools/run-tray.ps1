<#
Icona nella barra di sistema (vicino all'orologio), come Discord.

  powershell -ExecutionPolicy Bypass -File tools\run-tray.ps1

Comportamento
-------------
- Avvia il server di sviluppo e apre la finestra applicazione.
- **Chiudere la finestra NON ferma il server.** L'icona del tray resta e il
  server continua a girare.
- Per fermare il server: menu dell'icona -> "Ferma il server ed esci".
- Per riaprire la finestra: doppio click sull'icona, oppure "Apri NCHAT".

Perche la finestra non va gestita
---------------------------------
La finestra e una finestra del browser: quando l'utente la chiude non succede
niente che questo processo debba sapere. Il tray non deve "notare" la chiusura,
semplicemente non sta guardando. Il ciclo di vita e del server, non della
finestra, ed e il tray a decidere quando finisce.

Nessuna dipendenza nuova: System.Windows.Forms fa parte di .NET Framework ed e
presente su ogni Windows.
#>
[CmdletBinding()]
param(
  [int] $Port = 5173,
  # Non mostrare il tray: avvia il server, apre la finestra ed esce. Serve per
  # verificare l'avvio e l'arresto senza dipendere dal desktop.
  [switch] $SelfTest,
  # Esegue solo cio che fa la voce di menu "Ferma il server ed esci", senza
  # tray. Serve per fermare un server rimasto orfano dopo un crash, e per
  # verificare quel percorso in automazione.
  [switch] $StopServer,
  [switch] $SharedBrowserProfile,
  # La porta del proxy locale per i modelli in cloud. Deve coincidere con
  # PROXY_PORT in src/llm/cloudProxy.ts, altrimenti l'app cerca il servizio su una
  # porta diversa da quella su cui il tray lo ha avviato, e il sintomo e una
  # chiave che sembra non arrivare.
  [int] $ProxyPort = 1235
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port/"
$lmUrl = 'http://localhost:1234/api/v1/models'
$iconPath = Join-Path $project 'public\nchat.ico'
$logDir = Join-Path $project 'logs'
$logPath = Join-Path $logDir 'dev-server.log'
$profile = Join-Path $env:LOCALAPPDATA 'NCHAT\browser-profile'

# Stato del processo, in ambito di script: i gestori degli eventi li leggono da
# qui e devono sopravvivere ai cicli di raccolta degli oggetti .NET.
$script:ServerProcess = $null
$script:OwnsServer = $false
$script:CloudProxyProcess = $null
$script:BalloonShown = $false

function Get-Browser {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Test-Up([string] $target) {
  try { Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true }
  catch { return $false }
}

function Stop-ProcessTree($Process) {
  if (-not $Process) { return }
  try { & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null } catch { }
}

function Get-ServerPid {
  # Il tray e autoritario sul server di sviluppo di NCHAT, anche se non
  # l'ha avviato lui: se il processo del tray e stato chiuso a forza, il
  # server resta e "Ferma il server" deve poterlo fermare comunque.
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    return [int] $connection.OwningProcess
  } catch {
    return 0
  }
}

function Stop-Server {
  # Prima il processo che ho avviato (configurazione con --host), poi
  # whatever ascolta sulla porta, cosi si coprono i due casi.
  Stop-ProcessTree $script:ServerProcess
  $pidOnPort = Get-ServerPid
  if ($pidOnPort -gt 0) {
    Stop-ProcessTree (Get-Process -Id $pidOnPort -ErrorAction SilentlyContinue)
  }
  for ($i = 0; $i -lt 10; $i += 1) {
    if (-not (Test-Up $url)) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return -not (Test-Up $url)
}

function Start-CloudProxy {
  # Il proxy locale per i modelli in cloud. Tiene la chiave in memoria e non la
  # scrive da nessuna parte, quindi quando muore la chiave muore con lui: e il
  # motivo per cui l'app la reinserisce e non la legge da un file.
  #
  # Non e obbligatorio: senza, LM Studio funziona come prima. Quindi se non parte
  # si avvisa una volta e si continua, invece di impedire all'app di aprire.
  $proxyUrl = "http://127.0.0.1:$ProxyPort/status"
  if (Test-Up $proxyUrl) {
    Write-Host '  Proxy cloud gia in esecuzione.'
    return $null
  }
  $script = Join-Path $project 'tools\cloud-proxy.mjs'
  if (-not (Test-Path $script)) { return $null }
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { return $null }

  $env:NCHAT_PROXY_PORT = "$ProxyPort"
  $proxyLog = Join-Path $logDir 'cloud-proxy.log'
  # Il percorso **tra apici**. Il progetto puo stare in una cartella con spazi —
  # e su questa macchina sta in "progetto llm node based chat" — e senza apici Node
  # divide la riga sul primo spazio e prova a caricare "D:\Desktop\progetto", che non
  # esiste: esce subito con MODULE_NOT_FOUND e il proxy non parte mai.
  #
  # Il sintomo per l'utente e il peggiore possibile, perche e **silenzioso**: senza
  # proxy non ci sono modelli in cloud, ma l'app non ha modo di dire «il servizio che
  # tiene la tua chiave non e partito», e il sintomo che resta e «la mia chiave non
  # funziona», che fa pensare a una chiave sbagliata invece che a un servizio che non
  # e partito. Il primo errore di questo tipo e durato perche il codice di avvio del
  # server accetta gia una lista di argomenti con virgolette, e il proxy no: due
  # modi diversi per la stessa cosa, e quello sbagliato era il meno usato.
  $process = Start-Process -FilePath (Get-Command node.exe).Source `
    -ArgumentList "`"$script`"" `
    -WorkingDirectory $project `
    -WindowStyle Hidden `
    -RedirectStandardOutput $proxyLog `
    -RedirectStandardError "$proxyLog.err" `
    -PassThru
  Write-Host "  Proxy cloud avviato (PID $($process.Id)), log in $proxyLog"

  for ($i = 0; $i -lt 15; $i += 1) {
    if (Test-Up $proxyUrl) { return $process }
    if ($process.HasExited) {
      Write-Host "  Il proxy cloud e usito subito. Log: $proxyLog"
      return $null
    }
    Start-Sleep -Milliseconds 400
  }
  Write-Host '  Il proxy cloud non ha risposto in tempo. Continuo senza: i modelli in cloud non funzioneranno.'
  return $null
}

function Start-Server {
  if (Test-Up $url) {
    Write-Host '  Server gia in esecuzione: non ne avvio un secondo.'
    return $null
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    $portable = Join-Path $env:LOCALAPPDATA 'NodePortable\npm.cmd'
    if (Test-Path $portable) { $env:PATH = "$(Split-Path -Parent $portable);$env:PATH" }
    else { throw 'npm non trovato nel PATH. Installa Node.js 20.19 o successivo.' }
  }
  if (-not (Test-Path (Join-Path $project 'node_modules'))) {
    Write-Host '  Prima esecuzione: installo le dipendenze...'
    Push-Location $project
    try { & npm.cmd install; if ($LASTEXITCODE -ne 0) { throw 'npm install fallito.' } }
    finally { Pop-Location }
  }

  # Log su file invece che su console: il processo non deve avere una finestra,
  # perche l'utente lo riconosce dal tray e non da una console nera.
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  # --host esplicito: senza, Vite si lega solo a "localhost", che puo risolversi
  # in IPv6, e sia il controllo di prontezza sia la finestra userebbero
  # 127.0.0.1 senza trovarlo.
  # NO_COLOR va impostato PRIMA di Start-Process: il figlio eredita
  # l'ambiente in quel momento, altrimenti il log su file si riempie di codici
  # ANSI di colore.
  $env:NO_COLOR = '1'
  $env:FORCE_COLOR = '0'
  $process = Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/c', 'npm.cmd run dev -- --host 127.0.0.1' `
    -WorkingDirectory $project `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError "$logPath.err" `
    -PassThru
  Write-Host "  Server avviato (PID $($process.Id)), log in $logPath"

  for ($i = 0; $i -lt 90; $i += 1) {
    if (Test-Up $url) { return $process }
    if ($process.HasExited) { throw "Il server e usito subito. Log: $logPath" }
    Start-Sleep -Milliseconds 1000
  }
  Stop-ProcessTree $process
  throw "Il server non ha risposto entro 90 secondi. Log: $logPath"
}

function Remove-StaleProfileLock {
  # Edge tiene un "lockfile" nel profilo. Se Edge e stato chiuso a forza
  # (crash, task manager) il file resta, il lancio successivo viene inoltrato
  # a un'istanza che non esiste piu, e il browser parte con 8 processi ma
  # SENZA finestra. Verificato su questa macchina.
  #
  # Il lockfile si tocca solo se nessun processo vivo usa il profilo: cancellarlo
  # mentre un'istanza e attiva permetterebbe a due istanze di scrivere sullo
  # stesso profilo, che e l'unico modo vero di corromperlo.
  $lock = Join-Path $profile 'lockfile'
  if (-not (Test-Path $lock)) { return }

  $users = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$profile*" })
  if ($users.Count -gt 0) { return }

  try {
    Remove-Item -LiteralPath $lock -Force
    Write-Host '  Rimosso un lockfile del browser lasciato da una chiusura forzata.'
  } catch {
    Write-Host "  Non ho potuto rimuovere il lockfile del browser: $($_.Exception.Message)"
  }
}

function Open-AppWindow {
  $browser = Get-Browser
  if (-not $browser) { throw 'Nessun browser Chromium trovato (Edge o Chrome).' }
  $arguments = @("--app=$url", '--window-size=1680,1000', '--no-first-run', '--no-default-browser-check')
  if (-not $SharedBrowserProfile) {
    # Profilo dedicato: garantisce una finestra senza schede anche se Edge e
    # gia aperto. Con il profilo normale la richiesta puo diventare una scheda.
    if (-not (Test-Path $profile)) { New-Item -ItemType Directory -Path $profile -Force | Out-Null }
    Remove-StaleProfileLock
    $arguments += "--user-data-dir=$profile"
  }
  Start-Process -FilePath $browser -ArgumentList $arguments | Out-Null
}

# --- 1. LM Studio: si annota, non si blocca.
#
# Prima questo era un cancello: senza LM Studio il launcher mostrava un avviso e
# usciva con codice 1, senza aprire niente. Sembrava prudente, ed era esattamente
# il contrario di un avvio affidabile, per tre ragioni che sono tutte vere:
#
# - LM Studio serve solo per **eseguire** una generazione. Il quadro, le note, i
#   prompt, i file, i gruppi, l'esportazione: tutto funziona senza un modello, e
#   senza rete. L'utente che sta disponendo il grafo non ha un server dei modelli
#   acceso, e non perche abbia dimenticato qualcosa.
# - Con un provider in cloud LM Studio non serve **affatto**: la chiave la tiene il
#   servizio locale. Controllarlo era un ostacolo a un caso in cui e irrilevante.
# - Un avviso modale all'avvio e la cosa peggiore che potesse succedere: l'utente
#   clicca l'icona e vede una finestra di errore, e la sua conclusione e «l'app non
#   parte». Non e vero, e il messaggio non lo diceva.
#
# Quindi: niente cancello, niente finestrella. Si scrive nel log e si prosegue. La
# spiegazione la da l'app stessa, che distingue «NCHAT e in funzione» da «il
# server dei modelli non risponde» — e dice anche quale dei due sia.
if (-not (Test-Up $lmUrl)) {
  Write-Host '  LM Studio non risponde: proseguo. Serve solo per eseguire una generazione in locale.'
  if ($SelfTest) { Write-Host '  (l app si apre lo stesso: il quadro funziona senza un modello)' }
}

# --- 2. -StopServer: stesso percorso della voce di menu, senza tray. Deve
#        funzionare anche su un server avviato da un altro processo.
if ($StopServer) {
  $onPort = Get-ServerPid
  if ($onPort -eq 0) {
    Write-Host "  Nessun server in ascolto su $url"
    exit 0
  }
  Write-Host "  Fermo il server in ascolto sulla porta $Port (PID $onPort)..."
  if (Stop-Server) { Write-Host '  Server fermato.'; exit 0 }
  Write-Error "Il server non si e chiuso. Log: $logPath"
  exit 1
}

# --- 3. Avvio
$script:ServerProcess = Start-Server
$script:OwnsServer = $null -ne $script:ServerProcess
# Dopo il server e prima della finestra: cosi l'app, quando si apre, trova gia il
# servizio e non deve aspettare che il tray si accorga che manca.
$script:CloudProxyProcess = Start-CloudProxy
Open-AppWindow

if ($SelfTest) {
  # Percorso senza tray: serve a verificare che avvio e arresto del server
  # funzionino, indipendentemente dal desktop.
  Write-Host "  Server attivo: $url"
  Stop-ProcessTree $script:ServerProcess
  Start-Sleep -Seconds 2
  $stillUp = Test-Up $url
  Write-Host "  Dopo l'arresto, il server risponde ancora? $stillUp"
  if ($stillUp) { Write-Error 'Il server non si e fermato.'; exit 1 }
  Write-Host '  Server fermato correttamente.'
  exit 0
}

# --- 3. Tray
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $iconPath)) { throw "Icona del tray mancante: $iconPath" }

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::new($iconPath)
$tray.Visible = $true
$tray.Text = 'NCHAT - server di sviluppo in esecuzione'

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Apri NCHAT')
$openItem.Add_Click({
  try {
    if (-not (Test-Up $url)) {
      $script:ServerProcess = Start-Server
      $script:OwnsServer = $null -ne $script:ServerProcess
    }
    Open-AppWindow
  } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'NCHAT', 'OK', 'Error') | Out-Null }
})

$menu.Items.Add('-') | Out-Null
$statusItem = $menu.Items.Add('Server: in avvio...')
$statusItem.Enabled = $false
$menu.Items.Add('-') | Out-Null

$logItem = $menu.Items.Add('Apri il log del server')
$logItem.Add_Click({ Start-Process -FilePath 'notepad.exe' -ArgumentList $logPath })

$restartItem = $menu.Items.Add('Riavvia il server')
$restartItem.Add_Click({
  try {
    Write-Host '  Riavvio il server...'
    Stop-Server | Out-Null
    $script:ServerProcess = Start-Server
    $script:OwnsServer = $null -ne $script:ServerProcess
    # Anche il proxy: dopo un riavvio non ha piu la chiave, e senza dirlo l'utente
    # vedrebbe "no key registered" e penserebbe di averla sbagliata.
    Stop-ProcessTree $script:CloudProxyProcess
    $script:CloudProxyProcess = Start-CloudProxy
    $script:StartedAt = Get-Date
    $script:BalloonShown = $false
    $script:tray.BalloonTipTitle = 'NCHAT'
    $script:tray.BalloonTipText = "Server riavviato su $url. Se usi un provider in cloud, reinserisci la chiave."
    $script:tray.BalloonTipIcon = 'Info'
    $script:tray.ShowBalloonTip(4000)
  } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'NCHAT', 'OK', 'Error') | Out-Null }
})

$stopItem = $menu.Items.Add('Ferma il server ed esci')
$stopItem.Add_Click({
  Write-Host '  Fermo il server...'
  # Il proxy muore con la chiave che aveva in memoria. Va fermato esplicitamente,
  # altrimenti resterebbe in ascolto su 127.0.0.1 con una chiave valida in un
  # processo che l'utente credeva chiuso.
  Stop-ProcessTree $script:CloudProxyProcess
  if (Stop-Server) {
    Write-Host '  Server fermato.'
  } else {
    $script:tray.BalloonTipTitle = 'NCHAT'
    $script:tray.BalloonTipText = 'Il server non si e chiuso. Guarda logs\dev-server.log.'
    $script:tray.BalloonTipIcon = 'Warning'
    $script:tray.ShowBalloonTip(6000)
  }
  $script:tray.Visible = $false
  $script:tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ $openItem.PerformClick() })

# Il balloon spiega che il server continua anche senza finestra: e il punto
# piu importante del comportamento e non e deducibile da un'icona.
$tray.BalloonTipTitle = 'NCHAT'
$tray.BalloonTipText = "Server avviato su $url. Puoi chiudere la finestra: il server resta attivo. Fermo dal menu qui vicino all'orologio."
$tray.BalloonTipIcon = 'Info'
$tray.ShowBalloonTip(8000)

# --- 4. Controllore: se il server muore da solo, il tray non mente.
#
# Il dubito ricorrente era "il server si chiude da solo". Non e vero: niente in
# NCHAT lo ferma e Vite non ha timeout di inattivita (misurato: 1h09m di
# uptime stabile, 27 MB). Se pero muore per un motivo esterno -- un riavvio, un
# antivirus, la chiusura della finestra della console -- il tray lo riavvia una
# volta da solo invece di limitarsi a dirlo, e mostra da quanto e su.
$script:StartedAt = Get-Date
$script:Restarts = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  $alive = $false
  if ($script:ServerProcess) { $alive = -not $script:ServerProcess.HasExited }
  else { $alive = Test-Up $url }

  if ($alive) {
    $up = (Get-Date) - $script:StartedAt
    $elapsed = if ($up.TotalHours -ge 1) {
      '{0}h {1:00}m' -f [int]$up.TotalHours, $up.Minutes
    } else { '{0}m {1:00}s' -f [int]$up.TotalMinutes, $up.Seconds }
    $script:statusItem.Text = "Server: attivo su $url ($elapsed)"
    $script:statusItem.ToolTipText = "In esecuzione da $elapsed. Il server resta attivo anche senza finestra."
    $script:stopItem.Enabled = $true
    $script:restartItem.Enabled = $true
  } else {
    $script:statusItem.Text = 'Server: fermo'
    $script:stopItem.Enabled = $false
    $script:restartItem.Enabled = $true
    # Un solo riavvio automatico: se il server muore di nuovo, il problema non
    # e un crash occasionale e insistere sarebbe solo un loop.
    if ($script:Restarts -eq 0) {
      $script:Restarts = 1
      try {
        $script:ServerProcess = Start-Server
        $script:OwnsServer = $null -ne $script:ServerProcess
        $script:StartedAt = Get-Date
        $script:tray.BalloonTipTitle = 'NCHAT'
        $script:tray.BalloonTipText = "Il server si era fermato, l'ho riavviato."
        $script:tray.BalloonTipIcon = 'Info'
        $script:tray.ShowBalloonTip(5000)
      } catch {
        $script:tray.BalloonTipTitle = 'NCHAT'
        $script:tray.BalloonTipText = "Il server non si e riavviato: $($_.Exception.Message)"
        $script:tray.BalloonTipIcon = 'Warning'
        $script:tray.ShowBalloonTip(8000)
      }
      return
    }
    if (-not $script:BalloonShown) {
      $script:BalloonShown = $true
      $script:tray.BalloonTipTitle = 'NCHAT'
      $script:tray.BalloonTipText = 'Il server e fermo e non riparte da solo. Usa "Riavvia il server" qui nel menu.'
      $script:tray.BalloonTipIcon = 'Warning'
      $script:tray.ShowBalloonTip(8000)
    }
  }
})
$timer.Start()

Write-Host "  Tray attivo. Server: $url"
Write-Host '  Chiudi la finestra: il server resta. Fermo dal menu del tray.'

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  $timer.Dispose()
  # Uscita pulita (menu, Ctrl+C, chiusura della sessione): il server non deve
  # restare orfano. Si ferma comunque quello in ascolto sulla porta, non solo
  # quello avviato da questo processo.
  Stop-Server | Out-Null
  $tray.Visible = $false
  $tray.Dispose()
  $menu.Dispose()
}
