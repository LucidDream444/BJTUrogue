# Split the supplied UI art into an empty framed track and a complete colored fill.
# Run from any directory; the originals remain intact.
Add-Type -AssemblyName System.Drawing
$clientRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../..'))
$uiFolder = Join-Path $clientRoot 'public/assets/ui/campus'
foreach ($variant in @(
    @{ Name = 'pink'; FillStart = 70; FillEnd = 480; EmptyStart = 600; EmptyEnd = 910 },
    @{ Name = 'blue'; FillStart = 70; FillEnd = 820; EmptyStart = 905; EmptyEnd = 935 }
)) {
    $source = [System.Drawing.Bitmap]::FromFile((Join-Path $uiFolder ('ui_campus_bar_' + $variant.Name + '.png')))
    $empty = [System.Drawing.Bitmap]::new($source.Width, $source.Height)
    $fill = [System.Drawing.Bitmap]::new($source.Width, $source.Height)
    $full = [System.Drawing.Bitmap]::new($source.Width, $source.Height)
    $cap = 70
    # Keep the source's metallic outer edge. Extend only the central horizontal strips.
    $g = [System.Drawing.Graphics]::FromImage($empty)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($source, [System.Drawing.Rectangle]::new($cap,0,$source.Width-2*$cap,$source.Height), $variant.EmptyStart,0,$variant.EmptyEnd-$variant.EmptyStart,$source.Height,[System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawImage($source, [System.Drawing.Rectangle]::new($source.Width-$cap,0,$cap,$source.Height), $source.Width-$cap,0,$cap,$source.Height,[System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    # The original right end is unfilled: mirror it to provide an empty left end too.
    for($y=0;$y -lt $source.Height;$y++) {
        for($x=0;$x -lt $cap;$x++) { $empty.SetPixel($x,$y,$source.GetPixel($source.Width-1-$x,$y)) }
    }
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($source, [System.Drawing.Rectangle]::new(0,0,$cap,$source.Height), 0,0,$cap,$source.Height,[System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawImage($source, [System.Drawing.Rectangle]::new($cap,0,$source.Width-2*$cap,$source.Height), $variant.FillStart,0,$variant.FillEnd-$variant.FillStart,$source.Height,[System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    for($y=0;$y -lt $source.Height;$y++) {
        for($x=0;$x -lt $cap;$x++) { $full.SetPixel($source.Width-1-$x,$y,$source.GetPixel($x,$y)) }
    }
    # Interior only: the frame is supplied by the empty texture, never an opaque overlay.
    $g=[System.Drawing.Graphics]::FromImage($fill)
    $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $path=[System.Drawing.Drawing2D.GraphicsPath]::new()
    $points=[System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(51,19),
        [System.Drawing.PointF]::new($source.Width-52,19),
        [System.Drawing.PointF]::new($source.Width-32,42),
        [System.Drawing.PointF]::new($source.Width-52,66),
        [System.Drawing.PointF]::new(51,66),
        [System.Drawing.PointF]::new(31,42)
    )
    $path.AddPolygon($points)
    $brush=[System.Drawing.TextureBrush]::new($full)
    $g.FillPath($brush,$path)
    $g.Dispose();$path.Dispose();$brush.Dispose()
    $empty.Save((Join-Path $uiFolder ('ui_campus_bar_' + $variant.Name + '_empty.png')),[System.Drawing.Imaging.ImageFormat]::Png)
    $fill.Save((Join-Path $uiFolder ('ui_campus_bar_' + $variant.Name + '_fill.png')),[System.Drawing.Imaging.ImageFormat]::Png)
    $source.Dispose();$empty.Dispose();$fill.Dispose();$full.Dispose()
}
