<#
Genera le icone PNG della PWA a partire dal design del favicon.
Nessuna dipendenza: usa solo System.Drawing, presente in Windows PowerShell.

  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

Le icone sono file sorgente committati: questo script serve solo per
rigenerarle se il design del favicon cambia.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'public'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Palette identica a public/favicon.svg
$Bg       = [System.Drawing.Color]::FromArgb(255, 18, 21, 29)
$From     = [System.Drawing.Color]::FromArgb(255, 141, 165, 255)  # #8da5ff
$To       = [System.Drawing.Color]::FromArgb(255, 155, 109, 255)  # #9b6dff

# Rettangoli del grafo, in coordinate del viewBox 64x64 del favicon:
# x, y, larghezza, altezza. Le linee passano per due nodi tondi.
$Blocks = @(
  @(18.0, 20.0, 12.0, 10.0),
  @(34.0, 34.0, 12.0, 10.0),
  @(30.0, 25.0, 10.0, 14.0)
)
# nodi tondi: x, y, raggio, colore
$Dots = @(
  @(18.0, 20.0, 4.0, $From),
  @(46.0, 44.0, 4.0, $To)
)

function New-Bitmap([int] $size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bitmap, $g)
}

function Draw-Icon([string] $path, [int] $size, [bool] $maskable) {
  $created = New-Bitmap $size
  $bitmap = $created[0]
  $g = $created[1]

  # Sfondo: quadrato con angoli arrotondati per "any", pieno per "maskable"
  # (la piattaforma ritaglia da se la maskable).
  if ($maskable) {
    $bgBrush = New-Object System.Drawing.SolidBrush($Bg)
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
  } else {
    $radius = $size * (16.0 / 64.0)
    $pathShape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $pathShape.AddArc(0, 0, $d, $d, 180, 90)
    $pathShape.AddArc($size - $d, 0, $d, $d, 270, 90)
    $pathShape.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $pathShape.AddArc(0, $size - $d, $d, $d, 90, 90)
    $pathShape.CloseFigure()
    $bgBrush = New-Object System.Drawing.SolidBrush($Bg)
    $g.FillPath($bgBrush, $pathShape)
  }

  # Il motivo occupa il 64 del canvas in "any" e il 56 in "maskable", cosi
  # resta dentro la safe zone circolare (diametro 80) che Android ritaglia.
  $extent = if ($maskable) { $size * (56.0 / 64.0) } else { $size * 1.0 }
  $scale  = $extent / 64.0
  $offset = ($size - $extent) / 2.0

  $penWidth = 4.0 * $scale
  $stroke = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF([float]$offset, [float]$offset)),
    (New-Object System.Drawing.PointF([float]($offset + $extent), [float]($offset + $extent))),
    $From, $To)
  $pen = New-Object System.Drawing.Pen($stroke, [float]$penWidth)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # Si usa l'overload a 4 float, non Rectangle/RectangleF: PowerShell sceglie
  # altrimenti quello intero e arrotonda le coordinate.
  foreach ($b in $Blocks) {
    $x = [float]($offset + $b[0] * $scale)
    $y = [float]($offset + $b[1] * $scale)
    $w = [float]($b[2] * $scale)
    $h = [float]($b[3] * $scale)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
  }

  foreach ($dot in $Dots) {
    $brush = New-Object System.Drawing.SolidBrush($dot[3])
    $d = [float]($dot[2] * 2 * $scale)
    $g.FillEllipse(
      $brush,
      [float]($offset + ($dot[0] - $dot[2]) * $scale),
      [float]($offset + ($dot[1] - $dot[2]) * $scale),
      $d, $d)
  }

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bitmap.Dispose()
  $pen.Dispose()
  $stroke.Dispose()
  Write-Host ("  {0,-28} {1,6} bytes" -f (Split-Path -Leaf $path), (Get-Item $path).Length)
}

function Save-Icon([string] $path, [int] $size) {
  # NotifyIcon vuole un System.Drawing.Icon, non un PNG. Si genera l'hicon da
  # un bitmap e lo si salva come .ico, che e quello che il tray si aspetta.
  $created = New-Bitmap $size
  $bitmap = $created[0]
  $g = $created[1]
  $radius = $size * (16.0 / 64.0)
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $shape.AddArc(0, 0, $d, $d, 180, 90)
  $shape.AddArc($size - $d, 0, $d, $d, 270, 90)
  $shape.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $shape.AddArc(0, $size - $d, $d, $d, 90, 90)
  $shape.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($Bg)), $shape)

  $stroke = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)),
    (New-Object System.Drawing.PointF([float]$size, [float]$size)),
    $From, $To)
  $pen = New-Object System.Drawing.Pen($stroke, [float](4.0 * $size / 64.0))
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  foreach ($b in $Blocks) {
    $g.DrawRectangle(
      $pen,
      [float]($b[0] * $size / 64.0), [float]($b[1] * $size / 64.0),
      [float]($b[2] * $size / 64.0), [float]($b[3] * $size / 64.0))
  }
  foreach ($dot in $Dots) {
    $diameter = [float]($dot[2] * 2 * $size / 64.0)
    $g.FillEllipse(
      (New-Object System.Drawing.SolidBrush($dot[3])),
      [float](($dot[0] - $dot[2]) * $size / 64.0),
      [float](($dot[1] - $dot[2]) * $size / 64.0),
      $diameter, $diameter)
  }

  $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $stream = [System.IO.File]::Create($path)
  try { $icon.Save($stream) } finally { $stream.Close() }

  # DestroyIcon: senza, l'hicon resta valido per sempre e il processo non
  # libera mai quella risorsa GDI.
  if (-not ('Win32.NativeIcon' -as [type])) {
    Add-Type -Namespace Win32 -Name NativeIcon -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool DestroyIcon(System.IntPtr handle);
'@
  }
  [Win32.NativeIcon]::DestroyIcon($icon.Handle) | Out-Null

  $pen.Dispose(); $stroke.Dispose(); $g.Dispose(); $bitmap.Dispose()
  Write-Host ("  {0,-28} {1,6} bytes" -f (Split-Path -Leaf $path), (Get-Item $path).Length)
}

Write-Host "Genero le icone in $outDir"
Draw-Icon (Join-Path $outDir 'icon-192.png')        192  $false
Draw-Icon (Join-Path $outDir 'icon-512.png')        512  $false
Draw-Icon (Join-Path $outDir 'icon-maskable-512.png') 512 $true
Save-Icon (Join-Path $outDir 'nchat.ico') 32
Write-Host "Fatto."
