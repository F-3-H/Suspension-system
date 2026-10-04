param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$WaitSeconds = 12
)
# Open a page and grab the screen.
#
# 两条纪律（都是这一轮踩出来的）：
#  1. 绝不 Stop-Process msedge/chrome。强杀会连带关掉人系统正在用的浏览器窗口，
#     而且被强杀之后，沙箱里往往再也起不了新的浏览器进程
#     （Chromium 新进程要建 mojo 命名管道，被沙箱拒绝：platform_channel Check failed 拒绝访问 0x5，exit 21）。
#  2. 不靠 --new-window 保证置前（它只是"请求"新窗口）。置前失败要能看见，
#     因此这里显式打印 AppActivate 的返回值；要稳定拿到画面请用 tools/shot-window.ps1（离屏 PrintWindow）。
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Start-Process msedge.exe -ArgumentList '--new-window', $Url
Start-Sleep -Seconds $WaitSeconds

$shell = New-Object -ComObject WScript.Shell
$activated = $false
for ($i = 0; $i -lt 8 -and -not $activated; $i++) {
  $proc = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
  if ($proc) {
    Write-Host ("window: " + $proc.MainWindowTitle)
    $activated = $shell.AppActivate($proc.Id)
  }
  if (-not $activated) { Start-Sleep -Milliseconds 700 }
}
Write-Host ("AppActivate = " + $activated)
Start-Sleep -Milliseconds 1200

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, (New-Object System.Drawing.Size($vs.Width, $vs.Height)))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host ("saved " + $Out + "  " + (Get-Item $Out).Length + " bytes")
