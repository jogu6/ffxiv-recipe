#requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Get-WCacheCleanupPaths([string]$Root,$Local,$Remote) {
    if($Local.outcome -cnotin @('succeeded','failed') -or -not $Local.Contains('logReceipt') -or -not $Local.logReceipt.sealed){throw 'Unverified terminal log'}
    foreach($pair in @(@('jobId','id'),@('projectId','project'),@('profileId','profile'),@('revision','revision'))){if($Local[$pair[0]] -cne $Remote[$pair[1]]){throw 'Remote cleanup identity mismatch'}}
    $sameAttempt=$Local.attempt -eq $Remote.attempt
    $supersededFailure=$Local.outcome -ceq 'failed' -and $Local.attempt -lt $Remote.attempt -and $Remote.state -cin @('succeeded','failed')
    if(-not $sameAttempt -and -not $supersededFailure){throw 'Remote cleanup attempt mismatch'}
    if($sameAttempt -and $Local.outcome -cne $Remote.state){throw 'Remote cleanup outcome mismatch'}
    if($Local.outcome -ceq 'succeeded' -and [BuildWorker.Guard]::CanonicalJson(($Local.manifest|ConvertTo-Json -Depth 32 -Compress -AsArray)) -cne [BuildWorker.Guard]::CanonicalJson(($Remote.result.artifacts|ConvertTo-Json -Depth 32 -Compress -AsArray))){throw 'Remote artifact evidence mismatch'}
    [void][BuildWorker.Guard]::Id($Local.jobId)
    if($Local.jobId -cnotmatch '^[0-9a-f-]{36}$' -or $Local.attempt -lt 1){throw 'Cleanup job path rejected'}
    $base='data/jobs/'+$Local.jobId+'/'+$Local.attempt
    return @('source','source.tar','source.tar.part','target','cache','temp','home'|ForEach-Object {[BuildWorker.Paths]::Inside($Root,$base+'/'+$_)})
}
function Remove-WCachePath([string]$Root,[string]$Path) {
    $absolute=[IO.Path]::GetFullPath($Path)
    $prefix=[IO.Path]::GetFullPath((Join-Path $Root 'data/jobs')).TrimEnd([char[]]@([char]92,[char]47))+[IO.Path]::DirectorySeparatorChar
    $relative=[IO.Path]::GetRelativePath($Root,$absolute).Replace([char]92,[char]47)
    if(-not $absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $relative -cnotmatch '^data/jobs/[0-9a-f-]{36}/[1-9][0-9]*/(source|source\.tar|source\.tar\.part|target|cache|temp|home)$'){throw 'Cleanup target outside job cache'}
    if(-not [IO.Path]::Exists($absolute)){return 0L}
    [BuildWorker.Paths]::NoLinks($absolute)
    $bytes=0L;$nodes=0;$stack=[Collections.Generic.Stack[IO.FileSystemInfo]]::new();$stack.Push((Get-Item -LiteralPath $absolute -Force))
    while($stack.Count){
        $node=$stack.Pop();if(++$nodes -gt 1000000){throw 'Cleanup inventory limit'}
        if($node.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Cleanup link rejected before deletion'}
        if($node -is [IO.DirectoryInfo]){foreach($entry in $node.EnumerateFileSystemInfos()){$stack.Push($entry)}}else{$bytes+=$node.Length}
    }
    # Resolve and validate the absolute target before this recursive deletion.
    Remove-Item -LiteralPath $absolute -Recurse -Force
    if([IO.Path]::Exists($absolute)){throw 'Cleanup target still exists'}
    return $bytes
}
function Invoke-WCacheCleanup([string]$Root,$Config) {
    if([IO.Path]::GetFullPath($Root).TrimEnd('\') -ine 'C:\BuildWorker-Production'){throw 'Production cleanup root required'}
    $mutex=[Threading.Mutex]::new($false,'Global\BuildWorker-C-BuildWorker-v1');$locked=$false
    try {
        try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
        if(-not $locked){throw 'Worker active'}
        $state=Get-Content -LiteralPath (Join-Path $Root 'control/state.json') -Raw|ConvertFrom-Json -AsHashtable
        if($state.phase -cne 'idle'){throw 'Unresolved worker job; cleanup refused'}
        $info=[BuildWorker.Protocol]::Ssh($Config.ssh.executable,$Config.ssh.host,$Config.ssh.user,$Config.ssh.port,(Join-Path $Root $Config.ssh.knownHosts),(Join-Path $Root $Config.ssh.identityPublicKey))
        $records=@(Get-ChildItem -LiteralPath (Join-Path $Root 'control/history') -Filter '*.json' -File)
        $removed=0L;$cleaned=@()
        foreach($record in $records){
            [BuildWorker.Paths]::NoLinks($record.FullName)
            $local=Get-Content -LiteralPath $record.FullName -Raw|ConvertFrom-Json -AsHashtable
            if(-not $local.Contains('logReceipt')){continue}
            $reply=[BuildWorker.Protocol]::Exchange($info,(@{version=1;op='status';jobId=$local.jobId}|ConvertTo-Json -Compress),[byte[]]::new(0),$Config.ssh.timeoutSeconds)
            $remote=($reply.Header|ConvertFrom-Json -AsHashtable).result
            $paths=Get-WCacheCleanupPaths $Root $local $remote
            $log=Join-Path $Root ('data/jobs/'+$local.jobId+'/'+$local.attempt+'/logs/build.log')
            if((Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant() -cne $local.logReceipt.sha256){throw 'Local sealed log mismatch'}
            foreach($path in $paths){$removed+=Remove-WCachePath $Root $path}
            $cleaned+=@{jobId=$local.jobId;attempt=$local.attempt}
        }
        $result=@{utc=[DateTime]::UtcNow.ToString('o');removedBytes=$removed;verifiedJobs=$cleaned;artifactsAndLogsRetained=$true}
        [BuildWorker.Paths]::AtomicText($Root,'control/cleanup-report.json',($result|ConvertTo-Json -Depth 8 -Compress))
        return $result
    }finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
Export-ModuleMember -Function Get-WCacheCleanupPaths,Remove-WCachePath,Invoke-WCacheCleanup
