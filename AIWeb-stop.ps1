param()

$ErrorActionPreference = "Stop"
$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$RuntimeDir = Join-Path $Root ".runtime"
$BackendPidFile = Join-Path $RuntimeDir "aiweb-backend.pid"
$FrontendPidFile = Join-Path $RuntimeDir "aiweb-frontend.pid"
$Stopped = New-Object System.Collections.Generic.HashSet[int]

function Stop-ProcessTreeSafely {
  param([int]$ProcessId, [string]$Label)

  if ($ProcessId -le 0 -or $Stopped.Contains($ProcessId)) {
    return
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) {
    return
  }

  & taskkill /PID $ProcessId /T /F | Out-Null
  [void]$Stopped.Add($ProcessId)
  Write-Host "AIWeb $Label stopped. PID: $ProcessId"
}

function Stop-TrackedProcess {
  param([string]$PidFile, [string]$Kind)

  if (-not (Test-Path $PidFile)) {
    Write-Host "AIWeb $Kind is not tracked by PID file."
    return
  }

  $raw = (Get-Content $PidFile -Raw).Trim()
  if (-not ($raw -match '^\d+$')) {
    Remove-Item $PidFile -Force
    Write-Host "AIWeb $Kind PID file was invalid and has been removed."
    return
  }

  $processId = [int]$raw
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item $PidFile -Force
    Write-Host "AIWeb $Kind PID file removed; process was not running."
    return
  }

  $command = "$($process.CommandLine)"
  $rootMatch = $command -like "*$Root*"
  $kindMatch = if ($Kind -eq "backend") {
    $command -like "*uvicorn*" -or $command -like "*main:app*" -or $command -like "*$BackendDir*"
  } else {
    $command -like "*next*" -or $command -like "*npm*" -or $command -like "*node*" -or $command -like "*$FrontendDir*"
  }

  if (-not ($rootMatch -and $kindMatch)) {
    throw "Refusing to stop PID $processId because it does not look like an AIWeb $Kind process."
  }

  Stop-ProcessTreeSafely $processId $Kind
  Remove-Item $PidFile -Force
}

function Stop-DiscoveredAIWebProcesses {
  $processes = Get-CimInstance Win32_Process

  $backendMatches = $processes | Where-Object {
    $cmd = "$($_.CommandLine)"
    ($cmd -like "*$BackendDir*" -or $cmd -like "*$Root*backend*") -and
    ($cmd -like "*uvicorn*" -or $cmd -like "*main:app*" -or $cmd -like "*.venv*Scripts*python*")
  } | Sort-Object ParentProcessId

  foreach ($process in $backendMatches) {
    Stop-ProcessTreeSafely ([int]$process.ProcessId) "backend"
  }

  $frontendMatches = $processes | Where-Object {
    $cmd = "$($_.CommandLine)"
    ($cmd -like "*$FrontendDir*" -or $cmd -like "*$Root*frontend*") -and
    ($cmd -like "*next*" -or $cmd -like "*npm*" -or $cmd -like "*node*")
  } | Sort-Object ParentProcessId

  foreach ($process in $frontendMatches) {
    Stop-ProcessTreeSafely ([int]$process.ProcessId) "frontend"
  }
}

Stop-TrackedProcess $FrontendPidFile "frontend"
Stop-TrackedProcess $BackendPidFile "backend"
Stop-DiscoveredAIWebProcesses

Write-Host "AIWeb stop completed."
