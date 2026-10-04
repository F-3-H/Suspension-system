param(
  [string]$ProcName = 'msedge',
  [int]$Width = 1024,
  [int]$Height = 520
)
# Resize a real browser window so the page is tested at laptop-like viewport heights.
# ASCII-only on purpose: PowerShell 5.1 reads BOM-less .ps1 as ANSI.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMove {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$best = $null; $bestArea = 0
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  if ($p.ProcessName -notlike "*$ProcName*") { continue }
  if ($p.MainWindowTitle -eq '') { continue }
  $r = New-Object WinMove+RECT
  if ([WinMove]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    if ($w * $h -gt $bestArea -and $r.Left -gt -30000) { $bestArea = $w * $h; $best = $p }
  }
}
if (-not $best) { Write-Host 'NO WINDOW'; exit 2 }
# A maximized window cannot be resized by MoveWindow alone: it only rewrites the restore
# bounds while the window stays maximized. Restore first (SW_RESTORE = 9).
[void][WinMove]::ShowWindow($best.MainWindowHandle, 9)
Start-Sleep -Milliseconds 400
$ok = [WinMove]::MoveWindow($best.MainWindowHandle, 40, 40, $Width, $Height, $true)
Start-Sleep -Milliseconds 400
$r2 = New-Object WinMove+RECT
[void][WinMove]::GetWindowRect($best.MainWindowHandle, [ref]$r2)
Write-Host ("resized '" + $best.MainWindowTitle + "' to " + $Width + "x" + $Height + " -> " + $ok +
  "  actual=" + ($r2.Right - $r2.Left) + "x" + ($r2.Bottom - $r2.Top))
