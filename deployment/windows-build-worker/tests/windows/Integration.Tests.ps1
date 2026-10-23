#requires -Version 7.4
param([string]$FixtureRoot, [string]$CodeRoot, [string]$BrokerRoot, [string]$TransportFile, [string]$ConfigFile, [ValidateSet('success', 'failed', 'upload-loss', 'finish-loss')][string]$Behavior)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $CodeRoot 'windows/Worker.psm1') -Force
if (-not $ConfigFile) {$ConfigFile=Join-Path $FixtureRoot 'client.json'}
$config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json -AsHashtable
$module = Get-Module Worker
& $module {
    param($root, $config, $brokerRoot, $behavior, $transportFile)
    [void](Test-WConfiguration $config)
    $script:BuildCount = 0
    $script:TestBehavior = $behavior
    $script:DropRemaining = if ($behavior -cin @('upload-loss', 'finish-loss')) { 3 } else { 0 }
    $script:BrokerRoot = $brokerRoot
    $script:TransportArgs=@()
    if ($transportFile) {$script:TransportArgs=@(Get-Content -LiteralPath $transportFile -Raw|ConvertFrom-Json)}
    # Only this isolated test replaces the transport and build implementation.
    $script:Rpc = {
        param($request, $data)
        if ($script:TransportArgs.Count) {
            $info=[Diagnostics.ProcessStartInfo]::new($script:TransportArgs[0])
            foreach ($arg in $script:TransportArgs[1..($script:TransportArgs.Count-1)]) {$info.ArgumentList.Add($arg)}
        } else {
            $info = [Diagnostics.ProcessStartInfo]::new('/usr/bin/python3')
            foreach ($arg in @('-E', '-s', '-B', (Join-Path $script:BrokerRoot 'broker.py'), '--worker', 'win1')) { $info.ArgumentList.Add($arg) }
            $info.Environment['SSH_ORIGINAL_COMMAND'] = 'build-worker-v1'
        }
        $response = [BuildWorker.Protocol]::Exchange($info, (Get-WJson $request), $data, 20)
        if ($script:DropRemaining -gt 0 -and (($script:TestBehavior -ceq 'upload-loss' -and $request.op -ceq 'upload-chunk') -or ($script:TestBehavior -ceq 'finish-loss' -and $request.op -ceq 'finish'))) {
            $script:DropRemaining--
            throw [BuildWorker.TransportFailure]::new()
        }
        $header = ConvertFrom-Json -InputObject $response.Header -AsHashtable
        return @{Result = $header.result; Data = $response.Data}
    }
    function script:Invoke-WBuild([string]$Root, $Config, $Job, $Profile) {
        $script:BuildCount++
        [BuildWorker.Paths]::AtomicText($Root, (Get-WJobRelative $Job) + '/logs/build.log', "fixture build log`n")
        if ($script:TestBehavior -ceq 'failed') { return $false }
        # A fixture byte file, not an executable build or command execution.
        $path = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/source/dist/app.exe')
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        [IO.File]::WriteAllBytes($path, [Text.Encoding]::ASCII.GetBytes('fixture-artifact'))
        return $true
    }
    $lost = $false
    try { Invoke-WCycle $root $config }
    catch [BuildWorker.TransportFailure] { $lost = $true }
    if ($behavior -cin @('upload-loss', 'finish-loss')) {
        if (-not $lost) { throw 'expected_transport_loss' }
        $pending = Read-WState $root
        if ($pending.phase -cnotin @('upload', 'finish')) { throw 'unsafe_resume_phase' }
        Invoke-WCycle $root $config
    } elseif ($lost) { throw 'unexpected_transport_loss' }
    if ((Read-WState $root).phase -cne 'idle' -or $script:BuildCount -ne 1) { throw 'build_was_repeated_or_not_completed' }
    Write-Output ("INTEGRATION behavior={0} buildCount={1} state=idle" -f $behavior, $script:BuildCount)
} $FixtureRoot $config $BrokerRoot $Behavior $TransportFile
