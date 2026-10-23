#requires -Version 7.4
[CmdletBinding()]
param([ValidateSet('Check', 'Run')][string]$Mode = 'Check', [switch]$Once)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows 11 is required. Use the isolated tests on Ubuntu.' }
$workerRoot = 'C:\BuildWorker-Production'
$codeDirectory = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
if ($codeDirectory -ine 'C:\BuildWorker-Production\windows') { throw 'Deploy the code under C:\BuildWorker-Production\windows first.' }
# Refuse a reparse point before creating compiler scratch directories.
for ($path = $workerRoot; $null -ne $path; $path = [IO.Path]::GetDirectoryName($path)) {
    if ([IO.Directory]::Exists($path) -and ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse point rejected.' }
}
# Local code, configuration and tokens must not be accessible to other users.
function Assert-PrivateWorkerAcl([string]$Path) {
    if (-not ([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path))) { return }
    $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
    $acl = Get-Acl -LiteralPath $Path
    if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Untrusted owner.' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'Worker ACL must be private.' }
    }
}
foreach ($relative in @('', 'windows', 'windows/Worker.ps1', 'windows/Worker.psm1', 'windows/WorkerCore.cs', 'windows/JobObject.cs', 'windows/LogSupport.cs', 'control', 'control/worker.json', 'control/state.json', 'data')) {
    $checkedPath = if ($relative -ceq '') { $workerRoot } else { Join-Path $workerRoot $relative }
    if (([IO.File]::Exists($checkedPath) -or [IO.Directory]::Exists($checkedPath)) -and ([IO.File]::GetAttributes($checkedPath) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse point rejected.' }
    Assert-PrivateWorkerAcl $checkedPath
}
$compilerScratch = Join-Path $workerRoot 'control/compiler-temp'
foreach ($path in @((Join-Path $workerRoot 'control'), $compilerScratch)) {
    if (([IO.Directory]::Exists($path) -or [IO.File]::Exists($path)) -and ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse point rejected.' }
}
[void][IO.Directory]::CreateDirectory($compilerScratch)
$oldTemp = [Environment]::GetEnvironmentVariable('TEMP', 'Process')
$oldTmp = [Environment]::GetEnvironmentVariable('TMP', 'Process')
try {
    [Environment]::SetEnvironmentVariable('TEMP', $compilerScratch, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $compilerScratch, 'Process')
    Import-Module (Join-Path $PSScriptRoot 'Worker.psm1') -Force
    $configPath = [BuildWorker.Paths]::Inside($workerRoot, 'control/worker.json')
    if (-not [IO.File]::Exists($configPath) -or ([IO.FileInfo]$configPath).Length -gt 1048576) { throw 'Configuration is missing or oversized.' }
    $text = [IO.File]::ReadAllText($configPath)
    [void][BuildWorker.Guard]::Json($text)
    $config = ConvertFrom-Json -InputObject $text -AsHashtable
    [void](Test-WConfiguration $config)
    if ($Mode -eq 'Check') { Write-Output 'Configuration valid. No SSH connection or build performed.' }
    else { Start-WWorker -Root $workerRoot -Config $config -Once:$Once }
} catch {
    Write-Error 'Worker rejected the operation. No request, credential or raw exception is printed.' -ErrorAction Continue
    exit 2
} finally {
    [Environment]::SetEnvironmentVariable('TEMP', $oldTemp, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $oldTmp, 'Process')
}
