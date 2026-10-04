param(
  [string]$ProcName = 'msedge',
  [string]$TitleLike = '',
  [Parameter(Mandatory = $true)][string]$Out
)
# Off-screen capture of one window via PrintWindow: it paints the window into a bitmap
# without bringing it to the foreground, so it does not push the user's active window away
# (AppActivate keeps returning False on this machine).
# NOTE: this file is deliberately ASCII-only -- PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# and non-ASCII literals here break the parser (hit once already).
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$cands = @()
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  if ($p.MainWindowTitle -eq '') { continue }
  if ($ProcName -ne '' -and $p.ProcessName -notlike "*$ProcName*") { continue }
  if ($TitleLike -ne '' -and $p.MainWindowTitle -notlike "*$TitleLike*") { continue }
  $r = New-Object Win32+RECT
  if ([Win32]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    if ($w -gt 200 -and $h -gt 200 -and $r.Left -gt -30000) {
      $cands += [pscustomobject]@{ Proc = $p; W = $w; H = $h; L = $r.Left; T = $r.Top; Title = $p.MainWindowTitle }
    }
  }
}
Write-Host ("candidates: " + $cands.Count)
$cands | Sort-Object -Property @{Expression={$_.W * $_.H}; Descending=$true} | Select-Object Proc, W, H, Title | Format-Table -AutoSize | Out-String | Write-Host

$target = $cands | Sort-Object -Property @{Expression={$_.W * $_.H}; Descending=$true} | Select-Object -First 1
if (-not $target) { Write-Host 'NO WINDOW FOUND'; exit 2 }
Write-Host ("target: " + $target.Title + "  " + $target.W + "x" + $target.H)

$bmp = New-Object System.Drawing.Bitmap($target.W, $target.H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$okp = [Win32]::PrintWindow($target.Proc.MainWindowHandle, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("PrintWindow=" + $okp + "  saved " + $Out + "  " + (Get-Item $Out).Length + " bytes")
