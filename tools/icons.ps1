# Shrinks only the item icons (img/items, from tools/wiki.mjs) over 50 KB that are bigger than 200 px, to 200 px
# (high-quality resampling); every other icon stays exactly as the wiki has it.
#   powershell -ExecutionPolicy Bypass -File tools\icons.ps1
param([string]$Dir = (Join-Path $PSScriptRoot '..\img\items'), [int]$OverKB = 50, [int]$Size = 200)
Add-Type -AssemblyName System.Drawing
$done = 0
foreach ($f in Get-ChildItem $Dir -File | Where-Object { $_.Length -gt $OverKB * 1KB }) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  if ($img.Width -le $Size -and $img.Height -le $Size) { $img.Dispose(); continue }
  $k = [Math]::Min([double]$Size / $img.Width, [double]$Size / $img.Height)
  $w = [int]($img.Width * $k); $h = [int]($img.Height * $k)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose(); $img.Dispose()
  $bmp.Save($f.FullName + '.tmp', [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Move-Item ($f.FullName + '.tmp') $f.FullName -Force
  $done++
}
"$done icons over $OverKB KB shrunk to $Size px"
