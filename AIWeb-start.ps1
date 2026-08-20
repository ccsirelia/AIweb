param(
  [int]$FrontendPort = 3000,
  [int]$BackendPort = 8008,
  [ValidateSet("production", "development")]
  [string]$Mode = "production"
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
  $backendArguments = @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$BackendPort")
  if ($Mode -eq "development") {
    $backendArguments = @("-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "$BackendPort")
  }
  $backend = Start-Process `
    -FilePath $python `
    -ArgumentList $backendArguments `
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
  $node = (Get-Command "node.exe" -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    throw "node.exe not found. Please install Node.js and ensure it is in PATH."
  }
  $nextBin = Join-Path $FrontendDir "node_modules\next\dist\bin\next"
  if (-not (Test-Path $nextBin)) {
    throw "Next.js runner not found: $nextBin. Please run npm install in frontend first."
  }
  if ($Mode -eq "production") {
    $buildMarker = Join-Path $FrontendDir ".next\BUILD_ID"
    $buildFingerprintFile = Join-Path $RuntimeDir "frontend-production-build.fingerprint"
    $nextEnvModule = Join-Path $FrontendDir "node_modules\@next\env"
    if (-not (Test-Path $nextEnvModule)) {
      throw "Next.js environment loader not found: $nextEnvModule. Please run npm install in frontend first."
    }
    $backendUrlResolver = @'
const { loadEnvConfig } = require(process.argv[1]);
loadEnvConfig(process.argv[2], false, { info() {}, error() {} });
process.stdout.write(process.env.BACKEND_API_URL ?? "http://localhost:8008");
'@
    $effectiveBackendApiUrl = "$(& $node -e $backendUrlResolver $nextEnvModule $FrontendDir)"
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to resolve the frontend BACKEND_API_URL."
    }
    $fingerprintPayload = "BACKEND_API_URL`0$effectiveBackendApiUrl"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $fingerprintBytes = [System.Text.Encoding]::UTF8.GetBytes($fingerprintPayload)
      $fingerprintHash = $sha256.ComputeHash($fingerprintBytes)
    } finally {
      $sha256.Dispose()
    }
    $currentBuildFingerprint = "backend-api-url-v1:" + ([System.BitConverter]::ToString($fingerprintHash)).Replace("-", "").ToLowerInvariant()
    $storedBuildFingerprint = if (Test-Path $buildFingerprintFile) {
      (Get-Content -LiteralPath $buildFingerprintFile -Raw).Trim()
    } else {
      ""
    }
    $buildInputs = @(
      (Join-Path $FrontendDir "next.config.ts"),
      (Join-Path $FrontendDir "package.json"),
      (Join-Path $FrontendDir "package-lock.json")
    ) | Where-Object { Test-Path $_ }
    foreach ($sourceDir in @("app", "components", "lib", "public")) {
      $sourcePath = Join-Path $FrontendDir $sourceDir
      if (Test-Path $sourcePath) {
        $buildInputs += Get-ChildItem -LiteralPath $sourcePath -Recurse -File | Select-Object -ExpandProperty FullName
      }
    }
    $needsBuild = (-not (Test-Path $buildMarker)) -or ($storedBuildFingerprint -ne $currentBuildFingerprint)
    if (-not $needsBuild) {
      $buildTime = (Get-Item $buildMarker).LastWriteTimeUtc
      $needsBuild = @($buildInputs | Where-Object { (Get-Item $_).LastWriteTimeUtc -gt $buildTime }).Count -gt 0
    }
    if ($needsBuild) {
      Write-Host "AIWeb frontend build is missing or stale; building production bundle..."
      # Next resolves the app directory relative to the current working
      # directory. The launcher itself may be invoked from the repository root,
      # so build explicitly inside frontend instead of relying on the caller's
      # location.
      Push-Location $FrontendDir
      try {
        & $node $nextBin build
      } finally {
        Pop-Location
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Next.js production build failed."
      }
      Set-Content -LiteralPath $buildFingerprintFile -Value $currentBuildFingerprint -Encoding Ascii -NoNewline
    }
  }
  $frontendArguments = @($nextBin, "start", "-p", "$FrontendPort")
  if ($Mode -eq "development") {
    $frontendArguments = @($nextBin, "dev", "-p", "$FrontendPort")
  }
  $frontendOut = Join-Path $LogDir "frontend.out.log"
  $frontendErr = Join-Path $LogDir "frontend.err.log"
  $frontend = Start-Process `
    -FilePath $node `
    -ArgumentList $frontendArguments `
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
Write-Host "  Mode    : $Mode"
Write-Host "  Logs    : $LogDir"
