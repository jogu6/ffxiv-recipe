#requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\BuildWorker-Production'
if([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ine ($root+'\windows')){throw 'Fixed worker path required'}
Import-Module (Join-Path $PSScriptRoot 'Worker.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'CacheCleanup.psm1') -Force
$config=Get-Content -LiteralPath (Join-Path $root 'control/worker.json') -Raw|ConvertFrom-Json -AsHashtable
[void](Test-WConfiguration $config)
if(@($config.profiles|Where-Object {$_.projectId -ceq 'ffxiv-recipe' -and $_.profileId -ceq 'windows-exe'}).Count -ne 1){throw 'Approved EXE profile missing'}
$config.enabled=$true
while($true){
    try {
        Start-WWorker -Root $root -Config $config -Once
        try{Invoke-WCacheCleanup -Root $root -Config $config|Out-Null}catch [BuildWorker.TransportFailure]{}
    }catch [BuildWorker.TransportFailure]{}
    Start-Sleep -Seconds 30
}
