# Generates 3 local-only sportsbook-style slips for STEP 14P.X2C.4.
# Do not commit the images. Delete after the retest.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $env:TEMP 'parlay-xray-x2c4'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Get-ChildItem $outDir -File | Remove-Item -Force

$family = New-Object System.Drawing.FontFamily 'Segoe UI'

function New-Font([float]$size, [bool]$bold) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font $family, $size, $style, ([System.Drawing.GraphicsUnit]::Point)
}

function Draw-Slip {
  param(
    [int]$Width,
    [int]$Height,
    [System.Drawing.Color]$Bg,
    [System.Drawing.Color]$Card,
    [System.Drawing.Color]$TitleColor,
    [System.Drawing.Color]$MetaColor,
    [System.Drawing.Color]$Accent,
    [string]$Header,
    [string]$Subhead,
    [object[]]$Legs,
    [int]$TitleSize = 26,
    [int]$BodySize = 20,
    [int]$MetaSize = 14
  )
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear($Bg)
  $title = New-Font $TitleSize $true
  $body = New-Font $BodySize $true
  $meta = New-Font $MetaSize $false
  $titleBrush = New-Object System.Drawing.SolidBrush $TitleColor
  $metaBrush = New-Object System.Drawing.SolidBrush $MetaColor
  $accentBrush = New-Object System.Drawing.SolidBrush $Accent
  $cardBrush = New-Object System.Drawing.SolidBrush $Card
  $y = 24
  $g.DrawString($Header, $title, $titleBrush, 36, $y)
  $y += 42
  $g.DrawString($Subhead, $meta, $metaBrush, 36, $y)
  $y += 40
  foreach ($leg in $Legs) {
    $cardH = 168
    $g.FillRectangle($cardBrush, 28, $y, ($Width - 56), $cardH)
    $g.DrawString([string]$leg.player, $title, $titleBrush, 48, ($y + 12))
    if ($leg.matchup) { $g.DrawString([string]$leg.matchup, $meta, $metaBrush, 48, ($y + 54)) }
    $g.DrawString([string]$leg.market, $body, $accentBrush, 48, ($y + 88))
    if ($null -ne $leg.odds -and $leg.odds -ne '') {
      $g.DrawString([string]$leg.odds, $title, $titleBrush, ($Width - 200), ($y + 84))
    }
    $y += $cardH + 14
  }
  $title.Dispose(); $body.Dispose(); $meta.Dispose()
  $titleBrush.Dispose(); $metaBrush.Dispose(); $accentBrush.Dispose(); $cardBrush.Dispose()
  $g.Dispose()
  return $bmp
}

$dkBg = [System.Drawing.Color]::FromArgb(12, 18, 28)
$dkCard = [System.Drawing.Color]::FromArgb(24, 34, 48)
$white = [System.Drawing.Color]::White
$gray = [System.Drawing.Color]::FromArgb(180, 190, 200)
$mint = [System.Drawing.Color]::FromArgb(85, 221, 177)
$fdBg = [System.Drawing.Color]::FromArgb(20, 29, 58)
$fdCard = [System.Drawing.Color]::FromArgb(32, 44, 80)
$blue = [System.Drawing.Color]::FromArgb(149, 184, 255)

# R1: exact prior A2 failure class (Giannis Points + Giannis Rebounds + Bam Rebounds)
$r1Legs = @(
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 27.5 Points'; odds = '-113' },
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 8.5 Rebounds'; odds = '-132' },
  @{ player = 'Bam Adebayo'; matchup = 'MIA vs MIL'; market = 'Over 5.5 Rebounds'; odds = '-110' }
)
$r1 = Draw-Slip 1024 860 $fdBg $fdCard $white $gray $blue 'FANDUEL  NBA PARLAY' '3 Legs   Mar 17 2026' $r1Legs
$r1.Save((Join-Path $outDir 'R1-giannis-points-rebounds.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$r1.Dispose()

# R2: same-player Rebounds + Assists
$r2Legs = @(
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 8.5 Rebounds'; odds = '-132' },
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 6.5 Assists'; odds = '-110' },
  @{ player = 'Bam Adebayo'; matchup = 'MIA vs MIL'; market = 'Over 5.5 Rebounds'; odds = '-110' }
)
$r2 = Draw-Slip 1024 860 $fdBg $fdCard $white $gray $blue 'FANDUEL  NBA PARLAY' '3 Legs   Mar 17 2026' $r2Legs
$r2.Save((Join-Path $outDir 'R2-giannis-rebounds-assists.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$r2.Dispose()

# R3: clean 4-leg points control (prior A1)
$r3Legs = @(
  @{ player = 'Nikola Jokic'; matchup = 'DEN vs OKC'; market = 'Over 27.5 Points'; odds = '-103' },
  @{ player = 'Shai Gilgeous-Alexander'; matchup = 'OKC vs DEN'; market = 'Over 32.5 Points'; odds = '-109' },
  @{ player = 'Jalen Brunson'; matchup = 'NYK vs CLE'; market = 'Over 27.5 Points'; odds = '-109' },
  @{ player = 'Donovan Mitchell'; matchup = 'CLE vs NYK'; market = 'Over 25.5 Points'; odds = '-119' }
)
$r3 = Draw-Slip 1024 1024 $dkBg $dkCard $white $gray $mint 'DRAFTKINGS  NBA PARLAY' '4 Legs   Mar 17 2026' $r3Legs
$r3.Save((Join-Path $outDir 'R3-clean-points-control.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$r3.Dispose()

$family.Dispose()
Write-Output $outDir
Get-ChildItem $outDir | ForEach-Object { "$($_.Name) $($_.Length)" }
