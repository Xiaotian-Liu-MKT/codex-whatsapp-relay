$ErrorActionPreference = "Stop"

$repoRoot = Join-Path $HOME ".codex\plugins\whatsapp-relay"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$scriptPath = Join-Path $repoRoot "plugins\whatsapp-relay\scripts\controller-autostart.mjs"
$logPath = Join-Path $repoRoot "plugins\whatsapp-relay\data\autostart.log"

Start-Sleep -Seconds 15

if (-not (Test-Path $nodeExe)) {
  throw "Node executable not found: $nodeExe"
}

if (-not (Test-Path $scriptPath)) {
  throw "Autostart script not found: $scriptPath"
}

$timestamp = Get-Date -Format o
"[$timestamp] autostart begin" | Out-File -FilePath $logPath -Append -Encoding utf8

& $nodeExe $scriptPath 2>&1 | ForEach-Object {
  $_ | Out-File -FilePath $logPath -Append -Encoding utf8
}

$exitCode = $LASTEXITCODE
$finishedAt = Get-Date -Format o
"[$finishedAt] autostart exit code: $exitCode" | Out-File -FilePath $logPath -Append -Encoding utf8

exit $exitCode
