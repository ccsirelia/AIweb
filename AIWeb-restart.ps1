param(
  [int]$FrontendPort = 3000,
  [int]$BackendPort = 8008,
  [ValidateSet("production", "development")]
  [string]$Mode = "production"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $Root "AIWeb-stop.ps1")
Start-Sleep -Seconds 2
& (Join-Path $Root "AIWeb-start.ps1") -FrontendPort $FrontendPort -BackendPort $BackendPort -Mode $Mode
