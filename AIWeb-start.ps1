param(
  [int]$FrontendPort = 5008,
  [int]$BackendPort = 8008
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $Root ".runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$BackendPidFile = Join-Path $RuntimeDir "aiweb-backend.pid"
$FrontendPidFile = Join-Path $RuntimeDir "aiweb-frontend.pid"

New-Item -ItemType Directory -Force $RuntimeDir, $LogDir | Out-Null

function Test-AIWebProcess {
  param([string]$PidFile, [string]$Kind)
  if (-not (Test-Path $PidFile)) { return $false }
  $processId = [int](Get-Content $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $command = "$($process.CommandLine)"
  $rootMatch = $command -like "*$Root*"
  $kindMatch = if ($Kind -eq "backend") { $command -like "*uvicorn*" -or $command -like "*python*" } else { $command -like "*next*" -or $command -like "*npm*" -or $command -like "*node*" }
  return ($rootMatch -and $kindMatch)
}

if (Test-AIWebProcess $BackendPidFile "backend") {
  Write-Host "AIWeb backend already running. PID: $(Get-Content $BackendPidFile -Raw)"
} else {
  $python = Join-Path $BackendDir ".venv\Scripts\python.exe"
  if (-not (Test-Path $python)) {
    throw "Backend venv python not found: $python"
  }
  $backendOut = Join-Path $LogDir "backend.out.log"
  $backendErr = Join-Path $LogDir "backend.err.log"
  $backend = Start-Process `
    -FilePath $python `
    -ArgumentList @("-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "$BackendPort") `
    -WorkingDirectory $BackendDir `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -Path $BackendPidFile -Value $backend.Id
  Write-Host "AIWeb backend started on http://localhost:$BackendPort. PID: $($backend.Id)"
}

if (Test-AIWebProcess $FrontendPidFile "frontend") {
  Write-Host "AIWeb frontend already running. PID: $(Get-Content $FrontendPidFile -Raw)"
} else {
  $frontendOut = Join-Path $LogDir "frontend.out.log"
  $frontendErr = Join-Path $LogDir "frontend.err.log"
  $frontend = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "-p", "$FrontendPort") `
    -WorkingDirectory $FrontendDir `
    -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -Path $FrontendPidFile -Value $frontend.Id
  Write-Host "AIWeb frontend started on http://localhost:$FrontendPort. PID: $($frontend.Id)"
}

Write-Host ""
Write-Host "AIWeb is starting:"
Write-Host "  Frontend: http://localhost:$FrontendPort"
Write-Host "  Backend : http://localhost:$BackendPort"
Write-Host "  Logs    : $LogDir"
