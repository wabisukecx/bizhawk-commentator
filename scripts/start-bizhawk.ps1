param(
    [string]$EmuHawk = (Join-Path $PSScriptRoot '..\runtime\BizHawk-2.11.1\EmuHawk.exe'),
    [Parameter(Mandatory=$true)][string]$Rom,
    [ValidateRange(1,65535)][int]$Port = 8766,
    [string]$LuaScript
)
$ErrorActionPreference = 'Stop'
$taskEmulator = (Resolve-Path -LiteralPath $EmuHawk).Path
$taskRom = (Resolve-Path -LiteralPath $Rom).Path
# A pack may supply an optional development wrapper; normal play uses the common bridge.
$taskBridge = if ($LuaScript) { (Resolve-Path -LiteralPath $LuaScript).Path } else { (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\lua\bridge.lua')).Path }
# Direct argument passing avoids building a shell command from file paths.
Push-Location (Split-Path -Parent $taskEmulator)
try {
    & $taskEmulator '--socket_ip=127.0.0.1' "--socket_port=$Port" "--lua=$taskBridge" $taskRom
} finally {
    Pop-Location
}
