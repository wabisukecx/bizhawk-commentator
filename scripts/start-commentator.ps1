param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskProject = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskUrl = 'http://127.0.0.1:8989'
$taskEntry = Join-Path $taskProject 'app\server.js'
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskProject 'package.json') -Raw | ConvertFrom-Json).version
$taskRunning = $false
try {
    $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
    $taskRunning = ($taskStatus.appId -eq 'bizhawk-commentator')
} catch { }
if ($taskRunning -and $taskStatus.appVersion -ne $taskVersion) {
    if ($taskStatus.running) { throw 'Stop monitoring in the subtitle page, then launch this file again to apply the update.' }
    $taskOwners = @(Get-NetTCPConnection -LocalPort 8989 -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
    if ($taskOwners.Count -ne 1) { throw 'Could not identify a single app process; no process was stopped.' }
    $taskOld = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $taskOwners[0])
    if ($taskOld.Name -ne 'node.exe' -or $taskOld.CommandLine.IndexOf($taskEntry, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'The port belongs to another application; it was not stopped.'
    }
    $taskBackupDir = Join-Path $taskProject 'runtime\commentator'
    New-Item -ItemType Directory -Path $taskBackupDir -Force | Out-Null
    $taskBackupText = ConvertTo-Json -InputObject @($taskStatus.history) -Depth 10
    [System.IO.File]::WriteAllText((Join-Path $taskBackupDir 'history-before-update.json'), $taskBackupText)
    Stop-Process -Id $taskOld.ProcessId -Force
    $taskRunning = $false
}
if (-not $taskRunning) {
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    $taskLogs = Join-Path $taskProject 'runtime\commentator'
    New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskEntry + '"') -WorkingDirectory $taskProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'app.log') -RedirectStandardError (Join-Path $taskLogs 'app-error.log') -PassThru
    for ($taskTry = 0; $taskTry -lt 40; $taskTry++) {
        Start-Sleep -Milliseconds 250
        try {
            $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 1
            if ($taskStatus.appId -eq 'bizhawk-commentator') { $taskRunning = $true; break }
        } catch { }
        if ($taskProcess.HasExited) { break }
    }
    if (-not $taskRunning) { throw "Could not start the app. Check $taskLogs\app-error.log" }
}
if (-not $NoBrowser) { Start-Process $taskUrl -WindowStyle Hidden }
Write-Output "Commentator: $taskUrl"
