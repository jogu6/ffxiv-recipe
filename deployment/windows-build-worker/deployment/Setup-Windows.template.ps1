#requires -Version 7.4
[CmdletBinding()]
param([switch]$Install,[switch]$VerifyDummy)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:SetupMigrationLibrary='__MIGRATION_LIBRARY__'
$script:SetupBootstrap='__BOOTSTRAP_SCRIPT__'
$script:SetupPublicKey='__PUBLIC_KEY__'
$script:SetupHost='__HOST__'
$script:SetupKnownHost='__HOST_KEY__'
$script:SetupValidationPayload='__VALIDATION_PAYLOAD__'
$script:SetupValidationSha256='__VALIDATION_SHA256__'
# Embed audited definitions, never dot-source files from the pre-existing installation.
. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:SetupMigrationLibrary))))
function Stop-SSetup([string]$Code,[string]$Message) {
    $failure=[InvalidOperationException]::new($Message)
    $failure.Data['setupFailure']=@{category=$Code;reason=$Message}
    throw $failure
}
function Read-SExact($Stream,[int]$Length) {
    $bytes=[byte[]]::new($Length);$offset=0
    while ($offset -lt $Length) {
        $task=$Stream.ReadAsync($bytes,$offset,$Length-$offset)
        if (-not $task.Wait(1500)) {Stop-SSetup 'agent-reply-timed-out' 'Agent reply timed out'}
        $count=$task.GetAwaiter().GetResult();if ($count -le 0) {Stop-SSetup 'agent-reply-truncated' 'Agent reply truncated'};$offset+=$count
    }
    return ,$bytes
}
function Test-SAgentReply([byte[]]$Body,[byte[]]$Expected) {
    if ($Body.Length -lt 5 -or $Body[0] -ne 12) {return $false}
    $count=[Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($Body,1));$offset=5;$found=$false
    if ($count -lt 0 -or $count -gt 256) {Stop-SSetup 'agent-identity-count-rejected' 'Agent identity count rejected'}
    for ($i=0;$i -lt $count;$i++) {
        foreach ($kind in @('key','comment')) {
            if ($offset+4 -gt $Body.Length) {Stop-SSetup 'truncated-agent-identity' 'Truncated Agent identity'}
            $len=[Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($Body,$offset));$offset+=4
            if ($len -lt 0 -or $len -gt 65536 -or $offset+$len -gt $Body.Length) {Stop-SSetup 'agent-identity-length-rejected' 'Agent identity length rejected'}
            if ($kind -ceq 'key' -and $len -eq $Expected.Length) {
                $same=$true;for ($j=0;$j -lt $len;$j++) {if ($Body[$offset+$j] -ne $Expected[$j]) {$same=$false;break}};if ($same) {$found=$true}
            }
            $offset+=$len
        }
    }
    if ($offset -ne $Body.Length) {Stop-SSetup 'unexpected-agent-trailing-data' 'Unexpected Agent trailing data'}
    return $found
}
function Test-SAgent {
    # Local read-only Agent identities request, no key loading/removal/signing or SSH connection.
    if ($env:SSH_AUTH_SOCK -and $env:SSH_AUTH_SOCK -ine '\\.\pipe\openssh-ssh-agent') {return 'custom-agent-endpoint-requires-review'}
    $pipe=[IO.Pipes.NamedPipeClientStream]::new('.','openssh-ssh-agent',[IO.Pipes.PipeDirection]::InOut)
    try {
        $pipe.Connect(1500);$pipe.Write([byte[]]@(0,0,0,1,11));$pipe.Flush()
        $head=Read-SExact $pipe 4;$length=[Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($head))
        if ($length -lt 5 -or $length -gt 1048576) {return 'agent-response-rejected'}
        $body=Read-SExact $pipe $length
        if (Test-SAgentReply $body ([Convert]::FromBase64String(($script:SetupPublicKey -split '\s+')[1]))) {return 'dedicated-key-listed'}
        return 'dedicated-key-not-listed'
    } catch {return 'agent-unavailable-or-locked'} finally {$pipe.Dispose()}
}
function Test-SAtomicReplace([string]$File) {
    $text=[IO.File]::ReadAllText($File);$hash=(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash
    $before=Read-MAcl $File;$temp=$File+'.owned-replacement'
    if ([IO.Path]::Exists($temp)) {Stop-SSetup 'atomic-probe-path-already-exists' 'Atomic probe path already exists'}
    [IO.File]::WriteAllText($temp,'owned replacement probe')
    [IO.File]::Replace($temp,$File,[NullString]::Value)
    $after=Read-MAcl $File
    if ($before.owner -cne $after.owner -or $before.access -cne $after.access) {Stop-SSetup 'atomic-replacement-changed-owner-dacl' 'Atomic replacement changed owner/DACL'}
    [IO.File]::WriteAllText($temp,$text)
    [IO.File]::Replace($temp,$File,[NullString]::Value)
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -cne $hash) {Stop-SSetup 'atomic-restoration-hash-mismatch' 'Atomic restoration hash mismatch'}
}
function Invoke-SNativeProbe([string]$Root,[string]$Sid) {
    Assert-DPPlainPath $Root 'owned-validation-probe'
    Assert-MAcl (Read-MAcl $Root) $Sid -Private -RequireProtected
    $parent=Join-Path $Root ('.setup-preflight-'+[Guid]::NewGuid().ToString('N'))
    New-MMetadata $parent $Sid | Out-Null
    $acl=New-MPrivateAcl $true $Sid
    foreach ($pair in @(@('S-1-5-32-545','ReadAndExecute'),@('S-1-5-11','Modify'))) {
        [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($pair[0]),$pair[1],'ContainerInherit,ObjectInherit','None','Allow'))
    }
    # Only this newly-created, private-ancestor fixture receives test ACEs.
    $fixtureParent=Join-Path $parent 'fixture parent with spaces';New-MMetadata $fixtureParent $Sid | Out-Null
    Set-Acl -LiteralPath $fixtureParent -AclObject $acl
    $test=Join-Path $fixtureParent 'tree';[void][IO.Directory]::CreateDirectory($test)
    $file=Join-Path $test 'probe file.txt';[IO.File]::WriteAllText($file,'owned preflight fixture v1')
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    $rejected=$false
    try {try {$pin=New-MPin $file $false;$pin.Dispose()} catch {$rejected=$true}} finally {$stream.Dispose()}
    if (-not $rejected) {Stop-SSetup 'windows-file-writer-lock-probe-failed' 'Windows file-writer lock probe failed'}
    Invoke-Migration $test $Sid | Out-Null
    Invoke-Migration $test $Sid -Restore | Out-Null
    Invoke-Migration $test $Sid | Out-Null
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $hash) {Stop-SSetup 'native-fixture-hash-changed' 'Native fixture hash changed'}
    Test-SAtomicReplace $file
    $legacy=Join-Path $fixtureParent 'legacy-layout';[void][IO.Directory]::CreateDirectory((Join-Path $legacy 'test-fixtures'))
    $legacyAcl=Get-Acl -LiteralPath $legacy
    $legacyAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    Set-Acl -LiteralPath $legacy -AclObject $legacyAcl
    $ownedTarget=Join-Path $parent 'owned-junction-target';New-MMetadata $ownedTarget $Sid | Out-Null
    $junction=Join-Path $legacy 'test-fixtures/link'
    New-Item -ItemType Junction -Path $junction -Target $ownedTarget | Out-Null
    $before=(Read-MAcl $legacy).descriptor
    $diagnostic=Get-DPPreflight $legacy $Sid -NativeLocks
    $blocked=@($diagnostic.blockers|Where-Object {$_.code -ceq 'unsafe-path' -and $_.details.rejectedPath -ieq $junction -and $_.details.reparseTag -ceq '0xA0000003'})
    if ($diagnostic.ready -or $blocked.Count -ne 1 -or (Read-MAcl $legacy).descriptor -cne $before) {Stop-SSetup 'observed-legacy-acl-junction-regression-failed' 'Observed legacy ACL/junction regression failed'}
    # Retain this owned test junction; never include it in production or follow its target.
    Set-MPrivateAcl $fixtureParent $true $Sid
    return @{legacyJunctionRejection='passed';legacyLayoutRetained=$true;atomicReplaceRestore='passed';path=$parent;aclOwnerInheritanceRestore='passed';fileWriterLock='passed';hash='passed';realBuild=$false}
}
function Invoke-SSshPreflight([string]$Directory) {
    # Authenticated read-only broker operation before changing existing ACLs or claiming jobs.
    Assert-DPPlainPath $Directory 'ssh-preflight-scratch'
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Assert-MAcl (Read-MAcl $Directory) $sid -Private -RequireProtected
    $identity=Join-Path $Directory 'agent-selector.pub';$hosts=Join-Path $Directory 'known_hosts'
    foreach ($p in @($identity,$hosts)) {Assert-DPPlainPath $p 'ssh-preflight-file';if ([IO.Path]::Exists($p)) {Stop-SSetup 'ssh-probe-path-already-exists' 'SSH probe path already exists'}}
    [IO.File]::WriteAllText($identity,$script:SetupPublicKey+"`n",[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($hosts,$script:SetupKnownHost+"`n",[Text.UTF8Encoding]::new($false))
    $text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:SetupBootstrap))
    $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
    if ($errors.Count) {Stop-SSetup 'embedded-bootstrap-parse-error' 'Embedded bootstrap parse error'}
    foreach ($name in @('Exact','Rpc')) {
        $functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
        if ($functions.Count -ne 1) {Stop-SSetup 'embedded-ssh-function-inventory-mismatch' 'Embedded SSH function inventory mismatch'}
        . ([scriptblock]::Create($functions[0].Extent.Text))
    }
    $ssh='C:\Windows\System32\OpenSSH\ssh.exe';$vpsHost=$script:SetupHost
    $descriptor=(Rpc @{op='package-info'}).Result
    if ($descriptor.size -le 0 -or $descriptor.size -gt 16777216 -or $descriptor.sha256 -cnotmatch '^[0-9a-f]{64}$') {Stop-SSetup 'invalid-authenticated-package-descriptor' 'Invalid authenticated package descriptor'}
    return @{verified=$true;hostKeyPinned=$true;forcedCommandProtocol=$true;operation='package-info';packageSha256=$descriptor.sha256;jobClaimed=$false}
}
function Assert-SPrerequisites {
    foreach ($path in @([IO.Path]::Combine($PSHOME,'pwsh.exe'),'C:\Windows\System32\OpenSSH\ssh.exe')) {
        if (-not $path.StartsWith('C:\',[StringComparison]::OrdinalIgnoreCase)) {Stop-SSetup 'system-prerequisite-is-outside-c' 'System prerequisite is outside C:'}
        Assert-DPPlainPath $path 'system-prerequisite'
        if (-not [IO.File]::Exists($path)) {Stop-SSetup 'missing-system-prerequisite' 'Missing system prerequisite'}
    }
    if ([IO.DriveInfo]::new('C:\').AvailableFreeSpace -lt 10737418240) {Stop-SSetup '10gib-free-on-c-required' '10GiB free on C: required'}
}
function Get-SAreaPlan([string]$Root,[string]$Sid,[ValidateSet('production','validation')][string]$Role) {
    Assert-DPPlainPath $Root ('area-'+$Role)
    $plan=@{root=$Root;role=$Role;create=$false;initializeMarker=$false}
    if (-not [IO.Path]::Exists($Root)) {$plan.create=$true;$plan.initializeMarker=$true;return $plan}
    if (-not [IO.Directory]::Exists($Root)) {Stop-SSetup 'dedicated-area-is-not-a-directory' 'Dedicated area is not a directory'}
    Assert-MAcl (Read-MAcl $Root) $Sid -Private -RequireProtected
    $marker=Join-Path $Root '.build-worker-area.json';Assert-DPPlainPath $marker 'area-marker'
    if (-not [IO.File]::Exists($marker)) {
        if (@(Get-ChildItem -LiteralPath $Root -Force).Count) {Stop-SSetup 'unrecognized-nonempty-dedicated-area-existing-files-left-unchanged' 'Unrecognized nonempty dedicated area; existing files left unchanged'}
        $plan.initializeMarker=$true;return $plan
    }
    Assert-MAcl (Read-MAcl $marker) $Sid -Private
    $v=Read-MJson $marker
    if ($v.schemaVersion -ne 1 -or $v.role -cne $Role -or $v.layout -cne 'separate-production-validation-v1') {Stop-SSetup 'dedicated-area-identity-mismatch-no-adoption-or-migration' 'Dedicated area identity mismatch; no adoption or migration'}
    return $plan
}
function New-SPrivateArea($Plan,[string]$Sid) {
    Assert-DPPlainPath $Plan.root 'private-area-create'
    if ($Plan.create) {
        Initialize-DPNative
        # CreateDirectoryW is exclusive and creates the private owner/DACL atomically.
        # ERROR_ALREADY_EXISTS is rejected; an existing directory never gets its ACL replaced.
        $sddl='O:'+$Sid+'D:P(A;OICI;FA;;;'+$Sid+')(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)'
        [BuildWorkerDeploymentDiagnostics.Metadata]::CreatePrivateDirectory($Plan.root,$sddl)
    }
    Assert-MAcl (Read-MAcl $Plan.root) $Sid -Private -RequireProtected
    if ($Plan.initializeMarker) {
        $marker=Join-Path $Plan.root '.build-worker-area.json';Assert-DPPlainPath $marker 'area-marker-create'
        $data=[Text.Encoding]::UTF8.GetBytes((@{schemaVersion=1;role=$Plan.role;layout='separate-production-validation-v1'}|ConvertTo-Json -Compress))
        $stream=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$stream.Write($data);$stream.Flush($true)} finally {$stream.Dispose()}
    }
}
function New-SValidationRun([string]$Root,[string]$Sid) {
    # Retained runs can contain deliberately unsafe fixtures. Never enumerate their descendants.
    $entries=@(Get-ChildItem -LiteralPath $Root -Force)
    $runs=@($entries|Where-Object {$_.Name -cne '.build-worker-area.json'})
    if ($runs.Count -ge 16) {Stop-SSetup 'validation-retention-limit-16-runs-reached-retain-existing-runs-for-reviewed-cleanup' 'Validation retention limit (16 runs) reached; retain existing runs for reviewed cleanup'}
    foreach ($entry in $runs) {
        if ($entry.Name -cnotmatch '^run-[0-9a-f]{32}$') {Stop-SSetup 'unknown-validation-area-entry-retained-unchanged' 'Unknown validation-area entry; retained unchanged'}
        Assert-DPPlainPath $entry.FullName 'validation-run-boundary'
        if (-not [IO.Directory]::Exists($entry.FullName)) {Stop-SSetup 'validation-run-is-not-a-directory' 'Validation run is not a directory'}
        Assert-MAcl (Read-MAcl $entry.FullName) $Sid -Private -RequireProtected
    }
    $run=Join-Path $Root ('run-'+[Guid]::NewGuid().ToString('N'))
    New-SPrivateArea @{root=$run;role='validation';create=$true;initializeMarker=$false} $Sid
    return $run
}
function Expand-SValidationPayload([string]$Run) {
    $raw=[Convert]::FromBase64String($script:SetupValidationPayload)
    $sha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($raw)).ToLowerInvariant()
    if ($raw.Length -gt 16777216 -or $sha -cne $script:SetupValidationSha256) {Stop-SSetup 'embedded-validation-payload-hash-mismatch' 'Embedded validation payload hash mismatch'}
    $payload=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json -AsHashtable
    if ($payload.schemaVersion -ne 1 -or $payload.files.Count -ne 19) {Stop-SSetup 'validation-inventory-mismatch' 'Validation inventory mismatch'}
    $suite=Join-Path $Run 'suite';Assert-DPPlainPath $suite 'validation-payload'
    if ([IO.Path]::Exists($suite)) {Stop-SSetup 'validation-suite-already-exists-never-reuse-test-fixtures' 'Validation suite already exists; never reuse test fixtures'}
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    # Validate all entries before creating any extracted file.
    [long]$total=0
    foreach ($entry in $payload.files) {
        if ($entry.path -cnotmatch '^(tests/windows/(Run-Tests|Static.Tests|Migration.Native.Tests)\.ps1|fixtures/[a-z]+\.(tar|json))$' -or -not $seen.Add($entry.path)) {Stop-SSetup 'unsafe-validation-payload-path' 'Unsafe validation payload path'}
        $data=[Convert]::FromBase64String($entry.data);$total+=$data.Length
        if ($data.Length -gt 2097152 -or $total -gt 16777216 -or [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant() -cne $entry.sha256) {Stop-SSetup 'validation-entry-hash-size-mismatch' 'Validation entry hash/size mismatch'}
    }
    foreach ($entry in $payload.files) {
        $path=Join-Path $suite $entry.path;Assert-DPPlainPath $path 'validation-extract'
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$stream.Write([Convert]::FromBase64String($entry.data));$stream.Flush($true)} finally {$stream.Dispose()}
    }
    return $suite
}
function Invoke-SInstalledValidation([string]$Root,[string]$Run) {
    $suite=Expand-SValidationPayload $Run
    $pwsh=[IO.Path]::Combine($PSHOME,'pwsh.exe')
    $oldTemp=$env:TEMP;$oldTmp=$env:TMP
    try {
        $scratch=Join-Path $Run 'compiler-temp';[void][IO.Directory]::CreateDirectory($scratch)
        $env:TEMP=$scratch;$env:TMP=$scratch
        & $pwsh -NoLogo -NoProfile -NonInteractive -File (Join-Path $suite 'tests/windows/Static.Tests.ps1') -CodeRoot $Root | Out-Host
        if ($LASTEXITCODE -ne 0) {Stop-SSetup 'installed-windows-static-validation-failed' 'Installed Windows static validation failed'}
        & $pwsh -NoLogo -NoProfile -NonInteractive -File (Join-Path $suite 'tests/windows/Run-Tests.ps1') -FixtureRoot (Join-Path $suite 'fixtures') -CodeRoot $Root | Out-Host
        if ($LASTEXITCODE -ne 0) {Stop-SSetup 'isolated-windows-native-validation-failed-no-dummy-job-claimed' 'Isolated Windows native validation failed; no dummy job claimed'}
    } finally {$env:TEMP=$oldTemp;$env:TMP=$oldTmp}
    return @{passed=$true;fixtureRoot=(Join-Path $suite 'fixtures');productionContainsFixtures=$false}
}
function Invoke-SBootstrap {
    $bootstrap=[scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:SetupBootstrap)))
    & $bootstrap -PrepareOnly | Out-Host
}
function Invoke-SDummyVerification([string]$Root) {
    & (Join-Path $Root 'deployment/Prepare-Windows.ps1') -VerifyDummy | Out-Host
}
function Get-SProductionPreflight([string]$Root,[string]$Sid) {
    $plan=Get-SAreaPlan $Root $Sid 'production'
    if ($plan.create -or $plan.initializeMarker) {
        return @{version=2;root=$Root;ready=$true;readOnly=$true;needsAclMigration=$false;state=$null;paths=@();blockers=[Collections.Generic.List[object]]::new();areaPlan=$plan}
    }
    $r=Get-DPPreflight $Root $Sid -NativeLocks
    # No legacy ACL migration or fixture exclusion is allowed in the new production area.
    foreach ($entry in $r.paths) {
        try {Assert-MAcl (Read-MAcl $entry.path) $Sid -Private}
        catch {Add-DPIssue $r 'production-acl-policy' $entry.path 'private-production-acl-required';$r.ready=$false}
    }
    if ($r.needsAclMigration) {Add-DPIssue $r 'production-acl-policy' $Root 'legacy-acl-migration-forbidden';$r.ready=$false}
    $r['areaPlan']=$plan
    return $r
}
function Invoke-SFlow([string]$Root,[string]$Sid,[switch]$Apply,[switch]$Dummy,[string]$ValidationRoot='C:\BuildWorker-Validation') {
    $r=@{root=$Root;ready=$false;readOnly=-not $Apply;state=$null;blockers=[Collections.Generic.List[object]]::new()}
    $r['stage']='diagnostic-preflight';$r['installationComplete']=$false;$r['endToEndComplete']=$false
    $r['nativeProbe']='not-run';$r['agent']='not-tested';$r['tasksEnabled']=$false;$r['changesStarted']=$false;$r['productionChangesStarted']=$false
    $r['legacyRoot']='C:\BuildWorker';$r['legacyInspected']=$false;$r['legacyModified']=$false;$r['validationRoot']=$ValidationRoot
    try {
        $p=Get-SProductionPreflight $Root $Sid
        foreach ($key in $p.Keys) {$r[$key]=$p[$key]}
        $r.readOnly=-not $Apply
        if (-not $r.ready) {return $r}
        if ([IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) -ieq [IO.Path]::GetFullPath($ValidationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) -or [IO.Path]::GetRelativePath($Root,$ValidationRoot) -notmatch '^\.\.' -or [IO.Path]::GetRelativePath($ValidationRoot,$Root) -notmatch '^\.\.') {Stop-SSetup 'production-and-validation-areas-must-be-disjoint-sibling-directories' 'Production and validation areas must be disjoint sibling directories'}
        $validationPlan=Get-SAreaPlan $ValidationRoot $Sid 'validation'
        Assert-SPrerequisites
        $r.agent=Test-SAgent
        if ($r.agent -cne 'dedicated-key-listed') {Add-DPIssue $r 'agent' '' $r.agent;$r.ready=$false}
        if (-not $Apply -or -not $r.ready) {return $r}
        $r.stage='validation-area-initialize';$r.changesStarted=$true
        New-SPrivateArea $validationPlan $Sid
        $run=New-SValidationRun $ValidationRoot $Sid;$r['validationRun']=$run
        $r.stage='windows-native-probe';$r.nativeProbe='running';$r.nativeProbe=Invoke-SNativeProbe $run $Sid
        $r.stage='ssh-read-only-preflight';$r['sshPreflight']=Invoke-SSshPreflight $r.nativeProbe.path
        $r.stage='production-area-initialize';$r.productionChangesStarted=$true
        New-SPrivateArea $r.areaPlan $Sid
        $r.stage='bootstrap-package-ssh-and-prepare'
        Invoke-SBootstrap
        $r.stage='isolated-installed-validation';$r['installedValidation']=Invoke-SInstalledValidation $Root $run
        $r.installationComplete=$true;$r.stage='prepared';$r['unverified']=@('dummy job and VPS artifact/log return not executed')
        if ($Dummy) {
            $r.stage='dummy-job-and-return';Invoke-SDummyVerification $Root
            $path=Join-Path $Root 'control/deployment-report.json';Assert-DPPlainPath $path 'completion-verification'
            $done=Read-MJson $path
            if (-not $done.dummyVerified -or -not $done.remoteArtifactsVerified -or -not $done.remoteLogVerified) {Stop-SSetup 'vps-dummy-completion-evidence-missing' 'VPS dummy completion evidence missing'}
            $r['jobId']=$done.jobId;$r['artifactDirectory']=$done.remoteArtifactDirectory;$r['logDirectory']=$done.remoteLogDirectory;$r.endToEndComplete=$true;$r.stage='dummy-artifact-return-verified';$r['unverified']=@()
        }
    } catch {
        if ($r.stage -ceq 'windows-native-probe') {$r.nativeProbe='failed'}
        $detail=if ($_.Exception.Data.Contains('deploymentPath')) {$_.Exception.Data['deploymentPath']} elseif ($_.Exception.Data.Contains('setupFailure')) {$_.Exception.Data['setupFailure']} else {@{exceptionType=$_.Exception.GetType().Name;reason='stage-precondition-or-operation-rejected'}}
        Add-DPIssue $r $r.stage $Root 'setup-stage-failed' $detail;$r.ready=$false
        $r['recovery']='Keep both dedicated areas and all journals. Legacy C:\BuildWorker is unchanged. Recover pending production transaction; never reset job state or automatically repeat a build.'
    }
    try {Assert-DPPlainPath $Root 'after-state-root';if ([IO.Directory]::Exists($Root)) {$r['afterState']=Get-DPStatus $Root}} catch {$r['afterState']='inspection-blocked-preserve-backups'}
    return $r
}
if ($MyInvocation.InvocationName -ceq '.') {return}
if (-not $IsWindows -or $PSVersionTable.PSVersion -lt [version]'7.4') {Stop-SSetup 'windows-11-and-powershell-7-4-required' 'Windows 11 and PowerShell 7.4+ required'}
if ($VerifyDummy -and -not $Install) {Stop-SSetup 'verifydummy-requires-explicit-install' 'VerifyDummy requires explicit Install'}
$root='C:\BuildWorker-Production'
if ([IO.Path]::GetFullPath($PSCommandPath) -ine 'C:\BuildWorker-Setup.ps1') {Stop-SSetup 'place-this-read-only-entry-file-at-c-buildworker-setup-ps1-outside-the-untrusted-target-tree' 'Place this read-only entry file at C:\BuildWorker-Setup.ps1, outside the untrusted target tree'}
Assert-DPPlainPath $PSCommandPath 'trusted-setup-entry'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$sid=([Security.Principal.NTAccount]::new($env:COMPUTERNAME,'ladmin')).Translate([Security.Principal.SecurityIdentifier]).Value
if ($id.User.Value -cne $sid) {Stop-SSetup 'use-the-existing-local-ladmin-session-no-account-agent-changes-performed' 'Use the existing local ladmin session; no account/Agent changes performed'}
if ($Install -and -not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {Stop-SSetup 'install-requires-elevated-ladmin-powershell-diagnosis-is-available-without-elevation' 'Install requires elevated ladmin PowerShell; diagnosis is available without elevation'}
$mutex=$null;$locked=$false
try {
    if ($Install) {
        $mutex=[Threading.Mutex]::new($false,'Global\BuildWorker-C-BuildWorker-v1')
        try {$locked=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
        if (-not $locked) {Stop-SSetup 'worker-deployment-active-nothing-changed' 'Worker/deployment active; nothing changed'}
    }
    $r=Invoke-SFlow $root $sid -Apply:$Install -Dummy:$VerifyDummy
    ConvertTo-Json -InputObject $r -Depth 18
    if ($r.blockers.Count) {exit 2}
} finally {if ($locked) {$mutex.ReleaseMutex()};if ($null -ne $mutex) {$mutex.Dispose()}}
