# ARAM Helper native bridge.
# Reads one JSON request per line on stdin, writes one JSON response per line on stdout.
# Commands: ping, ocr, capture, win, lcu, langs
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AhNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
[void][AhNative]::SetProcessDPIAware()

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait(-1)
  $task.Result
}

$script:engines = @{}
function Get-Engine([string]$lang) {
  if (-not $script:engines.ContainsKey($lang)) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($lang))
    if ($null -eq $engine) { throw "OCR language not installed: $lang" }
    $script:engines[$lang] = $engine
  }
  $script:engines[$lang]
}

function Get-ScreenBitmap([int]$x, [int]$y, [int]$w, [int]$h, [double]$scale, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  if ($file) {
    # Test mode: crop the region out of a screenshot file instead of the screen.
    $src = [System.Drawing.Image]::FromFile($file)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
    $src.Dispose()
  } else {
    $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  }
  $g.Dispose()
  if ($scale -ne 1) {
    $sw = [int]($w * $scale); $sh = [int]($h * $scale)
    $scaled = New-Object System.Drawing.Bitmap($sw, $sh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($scaled)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($bmp, 0, 0, $sw, $sh)
    $g2.Dispose(); $bmp.Dispose()
    $bmp = $scaled
  }
  $bmp
}

function ConvertTo-SoftwareBitmap($bmp) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  } finally { $bmp.UnlockBits($data) }
  $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
  [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $bmp.Width, $bmp.Height)
}

function Invoke-Ocr($req) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $scale = if ($req.scale) { [double]$req.scale } else { 1.0 }
  $engine = Get-Engine $req.lang
  $bmp = Get-ScreenBitmap $req.x $req.y $req.w $req.h $scale $req.file
  try {
    if ($req.save) { $bmp.Save($req.save, [System.Drawing.Imaging.ImageFormat]::Png) }
    $sb = ConvertTo-SoftwareBitmap $bmp
  } finally { $bmp.Dispose() }
  $result = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $sb.Dispose()
  $lines = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    $words = New-Object System.Collections.ArrayList
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      [void]$words.Add(@{
          t = $word.Text
          x = [int]($req.x + $r.X / $scale); y = [int]($req.y + $r.Y / $scale)
          w = [int]($r.Width / $scale); h = [int]($r.Height / $scale)
        })
    }
    [void]$lines.Add(@{ text = $line.Text; words = $words })
  }
  @{ lines = $lines; ms = $sw.ElapsedMilliseconds }
}

function Get-WindowInfo($req) {
  $cls = if ($req.cls) { [string]$req.cls } else { [NullString]::Value }
  $title = if ($req.title) { [string]$req.title } else { [NullString]::Value }
  $h = [AhNative]::FindWindow($cls, $title)
  if ($h -eq [IntPtr]::Zero) { return @{ found = $false } }
  $rc = New-Object AhNative+RECT
  [void][AhNative]::GetClientRect($h, [ref]$rc)
  $pt = New-Object AhNative+POINT
  [void][AhNative]::ClientToScreen($h, [ref]$pt)
  $wr = New-Object AhNative+RECT
  [void][AhNative]::GetWindowRect($h, [ref]$wr)
  @{
    found = $true
    x = $pt.X; y = $pt.Y; w = $rc.Right - $rc.Left; h = $rc.Bottom - $rc.Top
    outer = @{ x = $wr.Left; y = $wr.Top; w = $wr.Right - $wr.Left; h = $wr.Bottom - $wr.Top }
    foreground = ([AhNative]::GetForegroundWindow() -eq $h)
    minimized = [AhNative]::IsIconic($h)
    visible = [AhNative]::IsWindowVisible($h)
  }
}

function Get-LcuArgs {
  $p = Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" | Select-Object -First 1
  if ($null -eq $p) { return @{ found = $false } }
  @{ found = $true; commandLine = $p.CommandLine; path = $p.ExecutablePath }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    switch ($req.cmd) {
      'ping' { $res = @{ pong = $true } }
      'ocr' { $res = Invoke-Ocr $req }
      'capture' {
        $bmp = Get-ScreenBitmap $req.x $req.y $req.w $req.h 1 $null
        $bmp.Save($req.save, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
        $res = @{ saved = $req.save }
      }
      'win' { $res = Get-WindowInfo $req }
      'lcu' { $res = Get-LcuArgs }
      'langs' { $res = @{ langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) } }
      default { throw "unknown cmd: $($req.cmd)" }
    }
    $res.id = $id; $res.ok = $true
  } catch {
    $res = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}
