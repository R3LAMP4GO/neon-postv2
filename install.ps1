$ErrorActionPreference = "Stop"

$url = "https://github.com/R3LAMP4GO/neon-postv2/releases/latest/download/Neon-Post-4.1.3-x64-setup.exe"
$exe = Join-Path $env:TEMP "neon-setup.exe"

Write-Host "Downloading installer..."
Invoke-WebRequest -Uri $url -OutFile $exe

Write-Host "Installing (silent)..."
Start-Process -FilePath $exe -ArgumentList "/S" -Wait

Write-Host "Creating Desktop shortcut..."
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenuPaths = @(
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
)
$lnk = Get-ChildItem -Path $startMenuPaths -Recurse -Filter "Neon Post.lnk" -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($lnk) {
  Copy-Item -Path $lnk.FullName -Destination $desktop -Force
  Write-Host "Done. Look for Neon Post on your Desktop."
} else {
  Write-Warning "Installed, but Start Menu shortcut not found. Open Start menu and search 'Neon Post'."
}
