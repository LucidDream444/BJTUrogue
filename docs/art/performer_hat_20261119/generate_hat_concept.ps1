Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$repo = Resolve-Path (Join-Path $root '..\..')
$sourcePath = Join-Path $repo 'client\public\assets\sprites\player\goose\player_goose_portrait.png'
$previewPath = Join-Path $PSScriptRoot 'performer_hat_concept.png'
$cutoutPath = Join-Path $PSScriptRoot 'performer_hat_cutout.png'
$gooseAssetDir = Join-Path $repo 'client\public\assets\sprites\player\goose'
$hatPath = Join-Path $gooseAssetDir 'player_goose_hat_performer.png'
$performerPortraitPath = Join-Path $gooseAssetDir 'player_goose_performer_portrait.png'

function New-SolidBrush([string]$hex, [int]$alpha = 255) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B))
}

function Scale-Points([object[]]$points, [float]$scale, [float]$offsetX, [float]$offsetY) {
  $result = [System.Drawing.PointF[]]::new($points.Count)
  for ($i = 0; $i -lt $points.Count; $i++) {
    $result[$i] = [System.Drawing.PointF]::new(
      $points[$i][0] * $scale + $offsetX,
      $points[$i][1] * $scale + $offsetY
    )
  }
  return $result
}

function Draw-PerformerHat(
  [System.Drawing.Graphics]$graphics,
  [float]$scale,
  [float]$offsetX,
  [float]$offsetY
) {
  $outline = New-SolidBrush '#0b1119'
  $body = New-SolidBrush '#182434'
  $highlight = New-SolidBrush '#34485e'
  $band = New-SolidBrush '#d9ad57'
  $bandLight = New-SolidBrush '#f3d78b'
  $blue = New-SolidBrush '#64b7df'
  $shadow = New-SolidBrush '#081018' 90

  try {
    # Soft shadow under the brim, kept behind the hat.
    $shadowPoints = Scale-Points @(
      @(18, 30), @(45, 25), @(47, 31), @(19, 36)
    ) $scale $offsetX ($offsetY + 1.6 * $scale)
    $graphics.FillPolygon($shadow, $shadowPoints)

    # Slanted brim.
    $brimOutline = Scale-Points @(
      @(15, 29), @(44, 23), @(47, 28), @(44, 31), @(18, 36)
    ) $scale $offsetX $offsetY
    $brimBody = Scale-Points @(
      @(17, 30), @(44, 25), @(45, 28), @(18, 34)
    ) $scale $offsetX $offsetY
    $graphics.FillPolygon($outline, $brimOutline)
    $graphics.FillPolygon($body, $brimBody)

    # Short crown, tilted with the brim.
    $crownOutline = Scale-Points @(
      @(22, 14), @(38, 11), @(43, 24), @(42, 27), @(20, 32), @(18, 29)
    ) $scale $offsetX $offsetY
    $crownBody = Scale-Points @(
      @(24, 16), @(37, 13), @(41, 24), @(40, 26), @(21, 30)
    ) $scale $offsetX $offsetY
    $graphics.FillPolygon($outline, $crownOutline)
    $graphics.FillPolygon($body, $crownBody)

    # Gold hat band.
    $bandOutline = Scale-Points @(
      @(20, 21), @(41, 17), @(43, 23), @(20, 28)
    ) $scale $offsetX $offsetY
    $bandFill = Scale-Points @(
      @(21, 22), @(41, 18), @(42, 21), @(21, 26)
    ) $scale $offsetX $offsetY
    $graphics.FillPolygon($outline, $bandOutline)
    $graphics.FillPolygon($band, $bandFill)

    # Crown top and edge highlights.
    $top = Scale-Points @(
      @(23, 15), @(38, 12), @(40, 15), @(24, 18)
    ) $scale $offsetX $offsetY
    $graphics.FillPolygon($highlight, $top)
    $linePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#54708a'), [Math]::Max(1, 0.7 * $scale))
    $graphics.DrawLine(
      $linePen,
      $offsetX + 24 * $scale,
      $offsetY + 19 * $scale,
      $offsetX + 40 * $scale,
      $offsetY + 16 * $scale
    )

    # Small turquoise pin: enough color to read as a stage performer at game scale.
    $pin = [System.Drawing.RectangleF]::new(
      $offsetX + 35.2 * $scale,
      $offsetY + 18.3 * $scale,
      2.4 * $scale,
      2.4 * $scale
    )
    $graphics.FillEllipse($blue, $pin)

    $bandPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#f3d78b'), [Math]::Max(1, 0.55 * $scale))
    try {
      $graphics.DrawLine(
        $bandPen,
        $offsetX + 23 * $scale,
        $offsetY + 22.2 * $scale,
        $offsetX + 38 * $scale,
        $offsetY + 19.2 * $scale
      )
    } finally {
      $bandPen.Dispose()
    }
  } finally {
    foreach ($brush in @($outline, $body, $highlight, $band, $bandLight, $blue, $shadow)) {
      $brush.Dispose()
    }
    if ($null -ne $linePen) { $linePen.Dispose() }
  }
}

$source = [System.Drawing.Bitmap]::FromFile($sourcePath)

# Transparent 128x128 cutout for later sprite work.
$cutout = [System.Drawing.Bitmap]::new(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cutoutGraphics = [System.Drawing.Graphics]::FromImage($cutout)
try {
  $cutoutGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $cutoutGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $cutoutGraphics.DrawImageUnscaled($source, 0, 0)
  Draw-PerformerHat $cutoutGraphics 1 0 0
  $cutout.Save($cutoutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $cutout.Save($performerPortraitPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $cutoutGraphics.Dispose()
  $cutout.Dispose()
}

# Gameplay hat layer: same 96x96 canvas and pivot as player_goose_neck.
$hat = [System.Drawing.Bitmap]::new(96, 96, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$hatGraphics = [System.Drawing.Graphics]::FromImage($hat)
try {
  $hatGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $hatGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  Draw-PerformerHat $hatGraphics 1 47 6
  $hat.Save($hatPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $hatGraphics.Dispose()
  $hat.Dispose()
}

# Presentation image. The goose itself is scaled with nearest-neighbour so the
# preview keeps the exact in-game silhouette.
$preview = [System.Drawing.Bitmap]::new(640, 640, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($preview)
try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#09131f'))

  $spot = New-SolidBrush '#17314a'
  $innerSpot = New-SolidBrush '#224863'
  $floor = New-SolidBrush '#0e2233'
  try {
    $graphics.FillEllipse($spot, 70, 36, 500, 520)
    $graphics.FillEllipse($innerSpot, 138, 104, 364, 414)
    $graphics.FillEllipse($floor, 92, 510, 456, 54)
  } finally {
    $spot.Dispose()
    $innerSpot.Dispose()
    $floor.Dispose()
  }

  $graphics.DrawImage($source, 64, 80, 512, 512)
  Draw-PerformerHat $graphics 4 64 80

  $framePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#b78a45'), 2)
  $innerPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#34566f'), 1)
  try {
    $graphics.DrawRectangle($framePen, 12, 12, 615, 615)
    $graphics.DrawRectangle($innerPen, 20, 20, 599, 599)
  } finally {
    $framePen.Dispose()
    $innerPen.Dispose()
  }

  $preview.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $preview.Dispose()
  $source.Dispose()
}

Write-Output $previewPath
Write-Output $cutoutPath
Write-Output $hatPath
Write-Output $performerPortraitPath
