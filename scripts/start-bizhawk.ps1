param(
    [string]$EmuHawk = (Join-Path $PSScriptRoot '..\runtime\BizHawk-2.11.1\EmuHawk.exe'),
    [Parameter(Mandatory=$true)][string]$Rom,
    [ValidateRange(1,65535)][int]$Port = 8766,
    [switch]$Probe
)
$ErrorActionPreference = 'Stop'
$taskEmulator = (Resolve-Path -LiteralPath $EmuHawk).Path
$taskRom = (Resolve-Path -LiteralPath $Rom).Path
# -Probe also records RAM/PPU data under captures\scene-probe (development aid, read-only).
$taskScript = if ($Probe) { '..\scripts\dev\bridge-with-probe.lua' } else { '..\lua\bridge.lua' }
$taskBridge = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot $taskScript)).Path
# Direct argument passing avoids building a shell command from file paths.
Push-Location (Split-Path -Parent $taskEmulator)
try {
    & $taskEmulator '--socket_ip=127.0.0.1' "--socket_port=$Port" "--lua=$taskBridge" $taskRom
} finally {
    Pop-Location
}
