# Generates 12 synthetic XRay benchmark slips into %TEMP%\parlay-xray-x2c
# Images are local-only and must be deleted after the benchmark.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $env:TEMP 'parlay-xray-x2c'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Get-ChildItem $outDir -File | Remove-Item -Force

$family = New-Object System.Drawing.FontFamily 'Segoe UI'

function New-Font([float]$size, [bool]$bold) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font $family, $size, $style, ([System.Drawing.GraphicsUnit]::Point)
}

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path, [long]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, $quality)
  $bmp.Save($path, $codec, $ep)
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
    [int]$MetaSize = 14,
    [switch]$NoHeader
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
  if (-not $NoHeader) {
    $g.DrawString($Header, $title, $titleBrush, 36, $y)
    $y += 42
    $g.DrawString($Subhead, $meta, $metaBrush, 36, $y)
    $y += 40
  }
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

# A1 clean 4-leg DK
$a1Legs = @(
  @{ player = 'Nikola Jokic'; matchup = 'DEN vs OKC'; market = 'Over 27.5 Points'; odds = '-103' },
  @{ player = 'Shai Gilgeous-Alexander'; matchup = 'OKC vs DEN'; market = 'Over 32.5 Points'; odds = '-109' },
  @{ player = 'Jalen Brunson'; matchup = 'NYK vs CLE'; market = 'Over 27.5 Points'; odds = '-109' },
  @{ player = 'Donovan Mitchell'; matchup = 'CLE vs NYK'; market = 'Over 25.5 Points'; odds = '-119' }
)
$a1 = Draw-Slip 1024 1024 $dkBg $dkCard $white $gray $mint 'DRAFTKINGS  NBA PARLAY' '4 Legs   Mar 17 2026' $a1Legs
$a1.Save((Join-Path $outDir 'A1-clean-4.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$a1.Dispose()

# A2 clean 3-leg FD
$a2Legs = @(
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 27.5 Points'; odds = '-113' },
  @{ player = 'Giannis Antetokounmpo'; matchup = 'MIL vs MIA'; market = 'Over 8.5 Rebounds'; odds = '-132' },
  @{ player = 'Bam Adebayo'; matchup = 'MIA vs MIL'; market = 'Over 5.5 Rebounds'; odds = '-110' }
)
$a2 = Draw-Slip 1024 860 $fdBg $fdCard $white $gray $blue 'FANDUEL  NBA PARLAY' '3 Legs   Mar 17 2026' $a2Legs
$a2.Save((Join-Path $outDir 'A2-clean-3.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$a2.Dispose()

# A3 clean 5-leg mix including Under
$a3Legs = @(
  @{ player = 'Nikola Jokic'; matchup = 'DEN vs OKC'; market = 'Over 10.5 Assists'; odds = '-103' },
  @{ player = 'Shai Gilgeous-Alexander'; matchup = 'OKC vs DEN'; market = 'Over 6.5 Assists'; odds = '-143' },
  @{ player = 'Jalen Brunson'; matchup = 'NYK vs CLE'; market = 'Over 2.5 Threes'; odds = '+102' },
  @{ player = 'Donovan Mitchell'; matchup = 'CLE vs NYK'; market = 'Over 2.5 Threes'; odds = '-179' },
  @{ player = 'Coby White'; matchup = 'CHI vs WAS'; market = 'Under 13.5 Points'; odds = '-115' }
)
$a3 = Draw-Slip 1024 1180 $dkBg $dkCard $white $gray $mint 'DRAFTKINGS  NBA PARLAY' '5 Legs   Mar 17 2026' $a3Legs -TitleSize 24 -BodySize 18
$a3.Save((Join-Path $outDir 'A3-clean-5.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$a3.Dispose()

# B1 jpeg compressed of A1-like distinct 4-leg (same truth as a dedicated compressed set)
$b1src = Draw-Slip 1024 1024 $dkBg $dkCard $white $gray $mint 'DRAFTKINGS  NBA PARLAY' '4 Legs   compressed' $a1Legs
Save-Jpeg $b1src (Join-Path $outDir 'B1-compressed.jpg') 18
$b1src.Dispose()

# B2 small jpeg of A2
$b2src = Draw-Slip 1024 860 $fdBg $fdCard $white $gray $blue 'FANDUEL  NBA PARLAY' '3 Legs   small jpeg' $a2Legs
$b2small = New-Object System.Drawing.Bitmap 480, 400
$g2 = [System.Drawing.Graphics]::FromImage($b2small)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($b2src, 0, 0, 480, 400)
$g2.Dispose(); $b2src.Dispose()
Save-Jpeg $b2small (Join-Path $outDir 'B2-resized.jpg') 22
$b2small.Dispose()

# C1 dark / small secondary
$c1 = Draw-Slip 1024 1024 $dkBg $dkCard $white ([System.Drawing.Color]::FromArgb(90, 100, 110)) $mint 'DRAFTKINGS  NBA PARLAY' '4 Legs   dark mode' $a1Legs -TitleSize 22 -BodySize 16 -MetaSize 11
$c1.Save((Join-Path $outDir 'C1-dark-small-text.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$c1.Dispose()

# C2 low contrast
$lowBg = [System.Drawing.Color]::FromArgb(28, 32, 36)
$lowCard = [System.Drawing.Color]::FromArgb(36, 40, 44)
$lowText = [System.Drawing.Color]::FromArgb(120, 124, 128)
$lowAccent = [System.Drawing.Color]::FromArgb(110, 140, 128)
$c2Legs = @(
  @{ player = 'Evan Mobley'; matchup = 'CLE vs NYK'; market = 'Over 17.5 Points'; odds = '-126' },
  @{ player = 'Evan Mobley'; matchup = 'CLE vs NYK'; market = 'Over 2.5 Assists'; odds = '+109' },
  @{ player = 'Jalen Brunson'; matchup = 'NYK vs CLE'; market = 'Over 7.5 Assists'; odds = '+113' }
)
$c2 = Draw-Slip 1024 860 $lowBg $lowCard $lowText $lowText $lowAccent 'NBA PARLAY' '3 Legs   low contrast' $c2Legs
$c2.Save((Join-Path $outDir 'C2-low-contrast.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$c2.Dispose()

# D1 cropped: 4 drawn, last card cut
$d1full = Draw-Slip 1024 1024 $dkBg $dkCard $white $gray $mint 'DRAFTKINGS  NBA PARLAY' '4 Legs   cropped' $a1Legs
$cropH = 700
$d1 = $d1full.Clone((New-Object System.Drawing.Rectangle 0, 0, 1024, $cropH), $d1full.PixelFormat)
$d1full.Dispose()
$d1.Save((Join-Path $outDir 'D1-cropped-partial.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$d1.Dispose()

# D2 no sportsbook, last odds missing
$d2Legs = @(
  @{ player = 'Nikola Jokic'; matchup = $null; market = 'Over 13.5 Rebounds'; odds = '+106' },
  @{ player = 'Shai Gilgeous-Alexander'; matchup = $null; market = 'Over 4.5 Rebounds'; odds = '+103' },
  @{ player = 'Giannis Antetokounmpo'; matchup = $null; market = 'Over 4.5 Assists'; odds = '' }
)
$d2 = Draw-Slip 1024 780 $dkBg $dkCard $white $gray $mint '' '' $d2Legs -NoHeader
$d2.Save((Join-Path $outDir 'D2-missing-fields.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$d2.Dispose()

# E1 same-game + promo
$e1Bmp = New-Object System.Drawing.Bitmap 1024, 1100
$ge = [System.Drawing.Graphics]::FromImage($e1Bmp)
$ge.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ge.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$ge.Clear($dkBg)
$promo = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(180, 90, 20))
$ge.FillRectangle($promo, 28, 20, 968, 64)
$ft = New-Font 22 $true
$fm = New-Font 16 $false
$fb = New-Font 20 $true
$wb = New-Object System.Drawing.SolidBrush $white
$mb = New-Object System.Drawing.SolidBrush $gray
$ab = New-Object System.Drawing.SolidBrush $mint
$cb = New-Object System.Drawing.SolidBrush $dkCard
$ge.DrawString('SGP BOOST  +50%  SAME GAME PARLAY', $ft, $wb, 48, 34)
$ge.DrawString('DRAFTKINGS   DEN vs OKC   Mar 17 2026', $fm, $mb, 36, 100)
$e1Legs = @(
  @{ player = 'Nikola Jokic'; matchup = 'DEN vs OKC'; market = 'Over 27.5 Points'; odds = '-103' },
  @{ player = 'Nikola Jokic'; matchup = 'DEN vs OKC'; market = 'Over 10.5 Assists'; odds = '-103' },
  @{ player = 'Shai Gilgeous-Alexander'; matchup = 'OKC vs DEN'; market = 'Over 32.5 Points'; odds = '-109' }
)
$y = 150
foreach ($leg in $e1Legs) {
  $ge.FillRectangle($cb, 28, $y, 968, 170)
  $ge.DrawString($leg.player, $ft, $wb, 48, ($y + 16))
  $ge.DrawString($leg.matchup, $fm, $mb, 48, ($y + 58))
  $ge.DrawString($leg.market, $fb, $ab, 48, ($y + 96))
  $ge.DrawString($leg.odds, $ft, $wb, 820, ($y + 90))
  $y += 186
}
$ge.DrawString('Promo: SGP boost does not change the listed legs.', $fm, $mb, 36, 1020)
$e1Bmp.Save((Join-Path $outDir 'E1-same-game-promo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$ge.Dispose(); $e1Bmp.Dispose(); $promo.Dispose()

# E2 complex mixed sections
$e2Bmp = New-Object System.Drawing.Bitmap 1024, 1100
$g3 = [System.Drawing.Graphics]::FromImage($e2Bmp)
$g3.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g3.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g3.Clear($fdBg)
$g3.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 40, 120))), 28, 18, 968, 70)
$g3.DrawString('BOOSTED BETS  ·  NOT A LEG', $ft, $wb, 48, 36)
$g3.DrawString('FANDUEL  PLAYER PROPS', $ft, $wb, 36, 104)
$e2Legs = @(
  @{ player = 'Devin Booker'; matchup = 'PHX vs SAS'; market = 'Over 2.5 3-Pointers Made'; odds = '+142' },
  @{ player = 'Chet Holmgren'; matchup = 'OKC vs DEN'; market = 'Over 5.5 Rebounds'; odds = '-110' },
  @{ player = 'Jalen Brunson'; matchup = 'NYK vs CLE'; market = 'Over 27.5 Points'; odds = '-109' }
)
$y = 160
foreach ($leg in $e2Legs) {
  $g3.FillRectangle($cb, 28, $y, 968, 170)
  $g3.DrawString($leg.player, $ft, $wb, 48, ($y + 16))
  $g3.DrawString($leg.matchup, $fm, $mb, 48, ($y + 58))
  $g3.DrawString($leg.market, $fb, $ab, 48, ($y + 96))
  $g3.DrawString($leg.odds, $ft, $wb, 820, ($y + 90))
  $y += 186
}
$g3.DrawString('Popular today  ·  odds shown are the listed prices', $fm, $mb, 36, 1020)
$e2Bmp.Save((Join-Path $outDir 'E2-mixed-sections.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g3.Dispose(); $e2Bmp.Dispose()

# F1 non-slip box score
$f = New-Object System.Drawing.Bitmap 1024, 768
$gf = [System.Drawing.Graphics]::FromImage($f)
$gf.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gf.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$gf.Clear([System.Drawing.Color]::FromArgb(245, 247, 248))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 40, 48))
$gf.DrawString('FINAL   DEN 121   OKC 105', $ft, $dark, 48, 36)
$gf.DrawString('Box score  ·  Mar 17 2026  ·  no betting lines', $fm, $dark, 48, 90)
$rows = @(
  'Nikola Jokic     29 PTS   12 REB   11 AST',
  'Aaron Gordon     18 PTS    6 REB    3 AST',
  'Shai Gilgeous-Alexander  31 PTS   5 REB   6 AST',
  'Chet Holmgren    14 PTS    8 REB    2 AST'
)
$yy = 160
foreach ($row in $rows) {
  $gf.DrawString($row, $fb, $dark, 48, $yy)
  $yy += 56
}
$gf.DrawString('Team totals only. This is not a parlay slip.', $fm, $dark, 48, 520)
$f.Save((Join-Path $outDir 'F1-box-score-nonslip.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$gf.Dispose(); $f.Dispose(); $dark.Dispose()

$ft.Dispose(); $fm.Dispose(); $fb.Dispose()
$wb.Dispose(); $mb.Dispose(); $ab.Dispose(); $cb.Dispose()
$family.Dispose()
Write-Output $outDir
Get-ChildItem $outDir | ForEach-Object { "$($_.Name) $($_.Length)" }
