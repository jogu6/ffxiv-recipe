#requires -Version 7.4
param([Parameter(Mandatory)][string]$FixtureRoot, [Parameter(Mandatory)][string]$CodeRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $CodeRoot 'windows/Worker.psm1') -Force
$script:Passed = 0; $script:Failed = 0; $script:Skipped = 0
function Check($Value) { if (-not $Value) { throw 'assertion_failed' } }
function Reject([scriptblock]$Body) { $rejected = $false; try { & $Body | Out-Null } catch { $rejected = $true }; Check $rejected }
function Case([string]$Name, [scriptblock]$Body) {
    try { & $Body; $script:Passed++; Write-Output "PASS $Name" }
    catch { $script:Failed++; Write-Output "FAIL $Name : $($_.Exception.Message)" }
}
$fixtures = Get-Content -LiteralPath (Join-Path $FixtureRoot 'fixtures.json') -Raw | ConvertFrom-Json -AsHashtable
$module = Get-Module Worker
if ($IsWindows) {
    $fixtures.config.ssh.executable = Join-Path $env:WINDIR 'System32/OpenSSH/ssh.exe'
    $fixtures.config.tools.node.executable = Join-Path $FixtureRoot 'fixture-node.exe'
}
Case 'Python canonical profile hashes including unicode and escaping' {
    foreach ($vector in $fixtures.vectors) { Check ((Get-WProfileRevision $vector.definition) -ceq $vector.revision) }
}
Case 'Reject duplicate and malformed JSON' {
    foreach ($json in @('{"x":1,"x":2}', '{"x":NaN}', '{')) { Reject { [BuildWorker.Guard]::Json($json) } }
}
Case 'Reject Windows unsafe names and traversals' {
    foreach ($path in @('../x', '/x', 'C:/x', 'x\y', 'x//y', 'x/./y', 'x/../y', 'CON', 'NUL.txt', 'aux.exe', 'CONIN$', 'conout$.txt', 'COM1', 'LPT9.txt', 'x:y', 'x.', 'x ', '日本語.txt')) {
        Reject { [BuildWorker.Guard]::Portable($path) }
    }
}
Case 'Reject file and directory case collisions' {
    foreach ($paths in @(@('a', 'A'), @('src/a', 'SRC/b'), @('a', 'a/b'), @('a/b', 'a'))) { Reject { [BuildWorker.Guard]::Unique([string[]]$paths) } }
    [BuildWorker.Guard]::Unique(@('src/a', 'src/b'))
}
Case 'Check available capacity with reservation' {
    Check ([BuildWorker.Paths]::Capacity(100, 20, 10, 100, 30))
    Check (-not [BuildWorker.Paths]::Capacity(39, 20, 10, 100, 30))
    Check (-not [BuildWorker.Paths]::Capacity(100, 71, 10, 100, 30))
}
Case 'Build memory limits are optional bounded integers' {
    $candidate=$fixtures.config|ConvertTo-Json -Depth 64|ConvertFrom-Json -AsHashtable
    $candidate.storage['maxBuildMemoryBytes']=4294967296L
    Check (Test-WConfiguration $candidate)
    $candidate.storage.maxBuildMemoryBytes=0L
    Check (Test-WConfiguration $candidate)
    $candidate.storage.maxBuildMemoryBytes=17179869185L
    Reject {Test-WConfiguration $candidate}
    $candidate.storage.maxBuildMemoryBytes='unlimited'
    Reject {Test-WConfiguration $candidate}
}
Case 'Cache cleanup requires matching terminal receipts and preserves returned files' {
    Import-Module (Join-Path $CodeRoot 'windows/CacheCleanup.psm1') -Force
    $root=Join-Path $FixtureRoot 'cleanup-root'
    $jobId='12345678-1234-1234-1234-123456789abc'
    $manifest=@(@{path='app.exe';size=5;sha256=('a'*64)})
    $local=@{jobId=$jobId;attempt=1;projectId='alpha';profileId='exe';revision=('b'*64);outcome='succeeded';logReceipt=@{sealed=$true};manifest=$manifest}
    $remote=@{id=$jobId;attempt=1;project='alpha';profile='exe';revision=('b'*64);state='succeeded';result=@{artifacts=$manifest}}
    $paths=Get-WCacheCleanupPaths $root $local $remote
    Check ($paths.Count -eq 7)
    $base=Join-Path $root ('data/jobs/'+$jobId+'/1')
    [void][IO.Directory]::CreateDirectory((Join-Path $base 'source'))
    [void][IO.Directory]::CreateDirectory((Join-Path $base 'return'))
    [IO.File]::WriteAllText((Join-Path $base 'source/remove'),'cache')
    [IO.File]::WriteAllText((Join-Path $base 'return/0'),'retain')
    Check ((Remove-WCachePath $root (Join-Path $base 'source')) -gt 0)
    Check ([IO.File]::ReadAllText((Join-Path $base 'return/0')) -ceq 'retain')
    Reject {Remove-WCachePath $root (Join-Path $base 'return')}
    $remote.state='building';Reject {Get-WCacheCleanupPaths $root $local $remote}
    $remote.state='succeeded';$local.logReceipt.sealed=$false;Reject {Get-WCacheCleanupPaths $root $local $remote}
    $local.logReceipt.sealed=$true;$local.outcome='failed';$remote.attempt=2
    Check ((Get-WCacheCleanupPaths $root $local $remote).Count -eq 7)
}
Case 'Native tool cache aliases are ordinary isolated directories before any build process starts' {
    & $module {
        param($root,$config,$job)
        $values=New-WBuildEnvironment $root $config $job
        foreach($name in @('IE','Content.IE5')) {
            $path=Join-Path $values['LOCALAPPDATA'] ('Microsoft/Windows/INetCache/'+$name)
            if(-not [IO.Directory]::Exists($path) -or ([IO.File]::GetAttributes($path)-band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe native cache alias'}
        }
    } (Join-Path $FixtureRoot 'native-cache-environment') $fixtures.config $fixtures.job
}
Case 'Capacity inventory totals nested files and rejects links without visiting their target' {
    $root=Join-Path $FixtureRoot 'capacity-tree'
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'nested'))
    [IO.File]::WriteAllBytes((Join-Path $root 'a'),[byte[]]::new(31))
    [IO.File]::WriteAllBytes((Join-Path $root 'nested/b'),[byte[]]::new(47))
    Check ([BuildWorker.Paths]::Usage($root,1000) -eq 78)
    Check ([BuildWorker.Paths]::Usage($root,1) -gt 1)
    $target=Join-Path $FixtureRoot 'capacity-outside'
    [void][IO.Directory]::CreateDirectory($target)
    $link=Join-Path $root 'link'
    $kind=if($IsWindows){'Junction'}else{'SymbolicLink'}
    [void](New-Item -ItemType $kind -Path $link -Target $target)
    try {Reject {[BuildWorker.Paths]::Usage($root,1000)}} finally {[IO.Directory]::Delete($link)}
}
Case 'Atomic state stays inside worker root' {
    [BuildWorker.Paths]::AtomicText($FixtureRoot, 'control/state.json', '{"phase":"idle"}')
    Check ([IO.File]::ReadAllText((Join-Path $FixtureRoot 'control/state.json')) -ceq '{"phase":"idle"}')
    Reject { [BuildWorker.Paths]::AtomicText($FixtureRoot, '../escape.json', 'bad') }
}
Case 'Extract real server USTAR snapshot and verify inventory' {
    $fixture = $fixtures.archives.valid
    $destination = Join-Path $FixtureRoot 'valid-source'
    [BuildWorker.Archive]::Extract((Join-Path $FixtureRoot $fixture.archive), $destination, ($fixture.source | ConvertTo-Json -Depth 64 -Compress))
    [BuildWorker.Archive]::VerifyTree($destination, ($fixture.source | ConvertTo-Json -Depth 64 -Compress))
    Check ([IO.File]::ReadAllText((Join-Path $destination 'src/main.txt')) -ceq "hello`n")
}
Case 'Reject tampered source archive SHA-256' {
    $fixture = $fixtures.archives.valid
    $descriptor = $fixture.source.Clone(); $descriptor.sha256 = '0' * 64
    Reject { [BuildWorker.Archive]::Extract((Join-Path $FixtureRoot $fixture.archive), (Join-Path $FixtureRoot 'wrong-hash'), ($descriptor | ConvertTo-Json -Depth 64 -Compress)) }
    Check (-not [IO.Directory]::Exists((Join-Path $FixtureRoot 'wrong-hash')))
}
foreach ($name in @('traversal', 'absolute', 'symlink', 'hardlink', 'pax', 'duplicate', 'unlisted', 'missing', 'filehash', 'size', 'case', 'reserved', 'trailing', 'checksum')) {
    $caseName = $name
    Case "Reject malicious archive $caseName" {
        $fixture = $fixtures.archives[$caseName]
        Reject { [BuildWorker.Archive]::Extract((Join-Path $FixtureRoot $fixture.archive), (Join-Path $FixtureRoot ('bad-' + $caseName)), ($fixture.source | ConvertTo-Json -Depth 64 -Compress)) }
        Check (-not [IO.File]::Exists((Join-Path $FixtureRoot 'outside.txt')))
    }
}
Case 'Reject modified, missing and extra files before build' {
    $fixture = $fixtures.archives.valid
    $descriptor = $fixture.source | ConvertTo-Json -Depth 64 -Compress
    $destination = Join-Path $FixtureRoot 'valid-source'
    [IO.File]::WriteAllText((Join-Path $destination 'src/main.txt'), 'edited')
    Reject { [BuildWorker.Archive]::VerifyTree($destination, $descriptor) }
    [IO.File]::WriteAllText((Join-Path $destination 'src/main.txt'), "hello`n")
    [IO.File]::WriteAllText((Join-Path $destination 'extra.txt'), 'unexpected')
    Reject { [BuildWorker.Archive]::VerifyTree($destination, $descriptor) }
}
Case 'Reject source and destination symlink/reparse paths' {
    $fixture = $fixtures.archives.valid
    $link = Join-Path $FixtureRoot 'link'
    $linkType = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
    [void](New-Item -ItemType $linkType -Path $link -Target (Join-Path $FixtureRoot 'valid-source'))
    try { Reject { [BuildWorker.Paths]::Inside($link, 'src/main.txt') } }
    finally {
        # Remove only this test-created link, never its target. Capacity scans reject links.
        if ($IsWindows) { [IO.Directory]::Delete($link) } else { [IO.File]::Delete($link) }
    }
}
Case 'Validate allowlist and profile revision' {
    Check (Test-WConfiguration $fixtures.config)
    $bad = $fixtures.config | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json -AsHashtable
    $bad.profiles[0].revision = '0' * 64
    Reject { Test-WConfiguration $bad }
    $bad = $fixtures.config | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json -AsHashtable
    $bad.profiles[0].definition.steps[0].tool = 'unapproved'
    Reject { Test-WConfiguration $bad }
}
Case 'Job cannot provide command, path or environment fields' {
    & $module {
        param($config, $job)
        Test-WJob $config $job
        foreach ($key in @('command', 'env', 'sourceRoot')) {
            $bad = $job.Clone(); $bad[$key] = 'forbidden'
            $rejected = $false; try { Test-WJob $config $bad } catch { $rejected = $true }
            if (-not $rejected) { throw 'job_field_not_rejected' }
        }
    } $fixtures.config $fixtures.job
}
Case 'Reject different project, worker and profile revision' {
    & $module {
        param($config, $job)
        foreach ($key in @('project', 'worker', 'revision')) {
            $bad = $job.Clone(); $bad[$key] = if ($key -ceq 'revision') { '0' * 64 } else { 'foreign' }
            $rejected = $false; try { Test-WJob $config $bad } catch { $rejected = $true }
            if (-not $rejected) { throw 'foreign_job_accepted' }
        }
    } $fixtures.config $fixtures.job
}
Case 'Build environment has one Path and scoped writable directories' {
    & $module {
        param($root, $config, $job)
        $environment = New-WBuildEnvironment $root $config $job
        if (@($environment.Keys | Where-Object { $_ -ieq 'PATH' }).Count -ne 1) { throw 'duplicate_path' }
        foreach ($name in @('USERPROFILE', 'TEMP', 'TMP', 'CARGO_HOME', 'CARGO_TARGET_DIR', 'RUSTUP_HOME', 'NPM_CONFIG_CACHE', 'APPDATA', 'LOCALAPPDATA', 'DOTNET_CLI_HOME', 'PIP_CACHE_DIR', 'NUGET_PACKAGES')) {
            if (-not $environment[$name].StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw 'environment_escape' }
        }
        if ($environment.ContainsKey('SSH_AUTH_SOCK') -or $environment.ContainsKey('GH_TOKEN')) { throw 'credential_inherited' }
        [void][BuildWorker.JobTree]::EnvironmentBlock($environment)
    } $FixtureRoot $fixtures.config $fixtures.job
}
Case 'Reject Path or cache environment overrides in config' {
    foreach ($name in @('PATH', 'Path', 'TEMP', 'CARGO_HOME', 'GH_TOKEN', 'RUSTC_WRAPPER')) {
        $bad = $fixtures.config | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json -AsHashtable
        $bad.environment[$name] = 'forbidden'
        Reject { Test-WConfiguration $bad }
    }
}
Case 'Native environment block rejects case-insensitive duplicates' {
    $values = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $values['Path'] = 'one'; $values['PATH'] = 'two'
    Reject { [BuildWorker.JobTree]::EnvironmentBlock($values) }
}
Case 'CreateProcess quoting handles quotes and trailing backslashes' {
    Check ([BuildWorker.JobTree]::Quote('a b') -ceq '"a b"')
    Check ([BuildWorker.JobTree]::Quote('a"b') -ceq '"a\"b"')
    Check ([BuildWorker.JobTree]::Quote('x\') -ceq '"x\\"')
}
Case 'SSH arguments disable prompts, host key writes, config and forwarding' {
    $info = [BuildWorker.Protocol]::Ssh($fixtures.config.ssh.executable, 'vps.invalid', 'ffxivdev', 22, 'known', 'public')
    foreach ($arg in @('BatchMode=yes', 'StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'ForwardAgent=no', 'ClearAllForwardings=yes', 'IdentitiesOnly=yes', 'PreferredAuthentications=publickey', 'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'build-worker-v1')) { Check ($info.ArgumentList.Contains($arg)) }
    Check (-not $info.UseShellExecute)
}
Case 'Restart during build blocks without rerunning build' {
    & $module {
        param($root, $config, $job)
        $script:Rpc = { param($request, $data)
            if ($request.op -ceq 'status') { return @{Result = $job; Data = [byte[]]@()} }
            if ($request.op -ceq 'interrupt') { return @{Result = @{}; Data = [byte[]]@()} }
            throw 'unexpected_rpc'
        }.GetNewClosure()
        Save-WState $root @{version = 1; phase = 'building'; job = $job}
        $rejected = $false; try { Invoke-WCycle $root $config } catch { $rejected = $true }
        if (-not $rejected -or (Read-WState $root).phase -cne 'blocked') { throw 'unsafe_restart' }
    } $FixtureRoot $fixtures.config $fixtures.job
}
Case 'Lost claim response remains unresolved without re-claim' {
    & $module {
        param($root, $config)
        Save-WState $root @{version = 1; phase = 'claiming'; job = $null}
        $script:Rpc = { throw 'must_not_contact_server' }
        $rejected = $false; try { Invoke-WCycle $root $config } catch { $rejected = $true }
        if (-not $rejected -or (Read-WState $root).phase -cne 'claiming') { throw 'unsafe_claim_retry' }
    } $FixtureRoot $fixtures.config
}
Case 'Captured logs redact common credentials and private keys' {
    $text = "token=secret-value`nBearer sample-value`n-----BEGIN PRIVATE KEY-----`nhidden-value`n-----END PRIVATE KEY-----`nordinary output`n"
    $inputStream = [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($text))
    $path = Join-Path $FixtureRoot 'capture/redacted.log'
    try { [BuildWorker.BoundedLog]::Capture($inputStream, $path) } finally { $inputStream.Dispose() }
    $captured = [IO.File]::ReadAllText($path)
    Check (-not $captured.Contains('secret-value') -and -not $captured.Contains('sample-value') -and -not $captured.Contains('hidden-value'))
    Check ($captured.Contains('ordinary output'))
}
Case 'Captured logs stay bounded and discard oversized lines' {
    $text = ("short line`n" * 220000) + ('x' * 10000) + "`n"
    $inputStream = [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($text))
    $path = Join-Path $FixtureRoot 'capture/bounded.log'
    try { [BuildWorker.BoundedLog]::Capture($inputStream, $path) } finally { $inputStream.Dispose() }
    Check (([IO.FileInfo]$path).Length -le 2097152)
    Check (-not [IO.File]::ReadAllText($path).Contains('xxxxxxxxxx'))
}
Case 'Runtime path rejection preserves the exact unsafe ancestor without following its child' {
    $parent=Join-Path $FixtureRoot 'runtime-path-parent';[void][IO.Directory]::CreateDirectory($parent)
    $alias=Join-Path $FixtureRoot 'runtime-path-alias'
    $kind=if ($IsWindows) {'Junction'} else {'SymbolicLink'}
    [void](New-Item -ItemType $kind -Path $alias -Target $parent)
    try {
        $detail=$null
        try {[BuildWorker.Paths]::NoLinks((Join-Path $alias 'not-visited/file'))} catch {$detail=$_.Exception.GetBaseException().Data['deploymentPath']}
        Check ($null -ne $detail);Check ($detail['rejectedPath'] -ceq $alias);Check (-not $detail['targetRead'])
    } finally {[IO.Directory]::Delete($alias)}
}
Case 'Log receipt rejects a false server seal and records only verified hash evidence' {
    & $module {
        param($root,$config,$job)
        $path=[BuildWorker.Paths]::Inside($root,(Get-WJobRelative $job)+'/logs/build.log')
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path));[IO.File]::WriteAllText($path,'receipt fixture')
        $script:ReceiptSha=[BuildWorker.Guard]::HashFile($path);$script:ReceiptSize=([IO.FileInfo]$path).Length
        $script:Rpc={param($request,$data)
            if ($request.op -ceq 'log-status') {return @{Result=@{sealed=$true;offset=$script:ReceiptSize;sha256=('0'*64)};Data=[byte[]]@()}}
            throw 'unexpected RPC'
        }
        $rejected=$false;try {Send-WLog $root $config $job -Terminal} catch {$rejected=$true}
        if (-not $rejected) {throw 'false log hash accepted'}
        $script:Rpc={param($request,$data) return @{Result=@{sealed=$true;offset=$script:ReceiptSize;sha256=$script:ReceiptSha};Data=[byte[]]@()}}
        Send-WLog $root $config $job -Terminal
        if ($script:LogEvidence.sha256 -cne $script:ReceiptSha -or $script:LogEvidence.jobId -cne $job.id -or -not $script:LogEvidence.sealed) {throw 'verified receipt missing'}
    } $FixtureRoot $fixtures.config $fixtures.job
}
Case 'Bootstrap framed reader accepts exact bytes and rejects truncation' {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CodeRoot 'deployment/Bootstrap-Windows.ps1'), [ref]$tokens, [ref]$errors)
    $function = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Exact'}, $true)
    . ([scriptblock]::Create($function.Extent.Text))
    $stream = [IO.MemoryStream]::new([byte[]]@(1,2,3))
    try { $bytes = Exact $stream 3 ([Diagnostics.Stopwatch]::StartNew()); Check ($bytes.Length -eq 3); Reject { Exact $stream 1 ([Diagnostics.Stopwatch]::StartNew()) } }
    finally { $stream.Dispose() }
}
Case 'Bootstrap ZIP validation rejects reserved names, ADS and traversal' {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CodeRoot 'deployment/Bootstrap-Windows.ps1'), [ref]$tokens, [ref]$errors)
    $function = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Portable-ZipName'}, $true)
    . ([scriptblock]::Create($function.Extent.Text))
    foreach ($path in @('windows/../bad', 'windows/NUL', 'windows/a:b', 'windows/a.', 'windows/a ', 'windows//a', 'C:/bad')) { Reject { Portable-ZipName $path } }
    Portable-ZipName 'windows/Worker.ps1'
}
Case 'Prepare history handles zero one multiple and cached results without duplicate claims' {
    $source = [IO.File]::ReadAllText((Join-Path $CodeRoot 'deployment/Prepare-Windows.ps1'))
    $start = $source.IndexOf("        `$history = Join-Path")
    $end = $source.IndexOf("        if (`$result.outcome", $start)
    Check ($start -gt 0 -and $end -gt $start)
    $selection = [scriptblock]::Create($source.Substring($start, $end - $start))
    foreach ($mode in @('absent','empty','single','multiple','cached')) {
        & {
            param($mode,$selection,$base)
            $workerRoot = Join-Path $base ('prepare-history-' + $mode)
            $config = @{profiles=@(@{projectId='worker-smoke';profileId='smoke';revision='approved'})}
            $script:HistoryClaims = 0
            $script:HistoryMode = $mode
            function Assert-NormalPath($Path) {}
            function Start-WWorker {
                param($Root,$Config,[switch]$Once)
                $script:HistoryClaims++
                if ($script:HistoryMode -cin @('single','multiple')) {
                    $dir = Join-Path $Root 'control/history'
                    [void][IO.Directory]::CreateDirectory($dir)
                    [IO.File]::WriteAllText((Join-Path $dir 'new.json'), '{"outcome":"succeeded","jobId":"selected"}')
                    if ($script:HistoryMode -ceq 'multiple') {[IO.File]::WriteAllText((Join-Path $dir 'extra.json'), '{}')}
                }
            }
            if ($mode -cne 'absent') {
                $dir = Join-Path $workerRoot 'control/history'
                [void][IO.Directory]::CreateDirectory($dir)
                if ($mode -ceq 'cached') {
                    [IO.File]::WriteAllText((Join-Path $dir 'old.json'), '{"outcome":"succeeded","jobId":"cached","projectId":"worker-smoke","profileId":"smoke","revision":"approved","logReceipt":{"sealed":true}}')
                }
            }
            $failure = $null
            try {. $selection} catch {$failure = $_}
            if ($mode -cin @('absent','empty','multiple')) {
                Check ($null -ne $failure)
                Check ($failure.Exception.Message -ceq 'No completed dummy job; preserve state and inspect VPS queue without resetting it')
            } else {
                if ($failure) {throw $failure}
                Check ($result.jobId -ceq $(if ($mode -ceq 'cached') {'cached'} else {'selected'}))
            }
            Check ($script:HistoryClaims -eq $(if ($mode -ceq 'cached') {0} else {1}))
        } $mode $selection $FixtureRoot
    }
}
# These exercise actual Win32 APIs only on Windows; never start a build command.
if ($IsWindows) {
    Case 'Windows installed-tree ACL migration preserves hashes and supports restore and rerun' {
        & (Join-Path $PSScriptRoot 'Migration.Native.Tests.ps1') -FixtureRoot $FixtureRoot -CodeRoot $CodeRoot -CaseName Lifecycle
    }
    Case 'Windows ACL migration refuses locked files and unknown ACEs' {
        & (Join-Path $PSScriptRoot 'Migration.Native.Tests.ps1') -FixtureRoot $FixtureRoot -CodeRoot $CodeRoot -CaseName Rejection
    }
    . (Join-Path $CodeRoot 'deployment/Bootstrap-Acl.ps1')
    Case 'Windows initial inherited ACL is protected and restored only in test fixture' {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $parent = Join-Path $FixtureRoot 'acl-native-parent'
        [void][IO.Directory]::CreateDirectory($parent)
        $acl = New-BPrivateAcl $true $sid $sid
        [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        Set-Acl -LiteralPath $parent -AclObject $acl
        $root = Join-Path $parent 'initial'
        [void][IO.Directory]::CreateDirectory($root)
        $bootstrap = Join-Path $root 'Bootstrap-Windows.ps1'
        [IO.File]::WriteAllText($bootstrap, '# harmless ACL fixture')
        $hash = (Get-FileHash -LiteralPath $bootstrap -Algorithm SHA256).Hash
        $owner = (Get-Acl -LiteralPath $root).GetOwner([Security.Principal.SecurityIdentifier]).Value
        Check ($null -ne (Get-BAclIssue (Get-BAclView $root) $sid))
        Initialize-BPrivateRoot $root $sid | Out-Null
        Check ($null -eq (Get-BAclIssue (Get-BAclView $root) $sid))
        Check ((Get-Acl -LiteralPath $root).AreAccessRulesProtected)
        Check ((Get-Acl -LiteralPath $root).GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $owner)
        $directory = @(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
        Restore-BInitialAcl $root $directory $sid | Out-Null
        Check (-not (Get-Acl -LiteralPath $root).AreAccessRulesProtected)
        Check ($null -ne (Get-BAclIssue (Get-BAclView $root) $sid))
        Check ((Get-FileHash -LiteralPath $bootstrap -Algorithm SHA256).Hash -ceq $hash)
    }
    Case 'Windows existing worker data and explicit broad grants refuse ACL initialization' {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $root = Join-Path $FixtureRoot 'acl-existing-root'
        [void][IO.Directory]::CreateDirectory((Join-Path $root 'data'))
        $artifact = Join-Path $root 'data/latest.exe'
        [IO.File]::WriteAllText($artifact, 'keep-success')
        $before = (Get-Acl -LiteralPath $root).Sddl
        Reject { Initialize-BPrivateRoot $root $sid }
        Check ((Get-Acl -LiteralPath $root).Sddl -ceq $before)
        Check ([IO.File]::ReadAllText($artifact) -ceq 'keep-success')
        $initial = Join-Path $FixtureRoot 'acl-explicit-root'
        [void][IO.Directory]::CreateDirectory($initial)
        $acl = New-BPrivateAcl $true $sid $sid
        [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'Allow'))
        Set-Acl -LiteralPath $initial -AclObject $acl
        $before = (Get-Acl -LiteralPath $initial).Sddl
        Reject { Initialize-BPrivateRoot $initial $sid }
        Check ((Get-Acl -LiteralPath $initial).Sddl -ceq $before)
    }
    Case 'Windows named Mutex excludes second instance' {
        $name = 'Global\BuildWorker-Test-' + [Guid]::NewGuid().ToString('N')
        $first = [Threading.Mutex]::new($false, $name)
        try {
            Check ($first.WaitOne(0))
            $info = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
            foreach ($arg in @('-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
                ('$m=[Threading.Mutex]::new($false,"' + $name + '");try {if($m.WaitOne(0)){$m.ReleaseMutex();exit 9}else{exit 0}}finally{$m.Dispose()}'))) { $info.ArgumentList.Add($arg) }
            $info.UseShellExecute = $false
            $second = [Diagnostics.Process]::Start($info)
            try { Check ($second.WaitForExit(10000)); Check ($second.ExitCode -eq 0) }
            finally { if (-not $second.HasExited) { $second.Kill() }; $second.Dispose() }
        }
        finally { $first.ReleaseMutex(); $first.Dispose() }
    }
    Case 'Windows Job Object can be created and disposed empty' {
        $tree = [BuildWorker.JobTree]::new(0)
        try { Check ($tree.ActiveProcesses -eq 0);Check ($tree.MemoryLimitBytes -eq 0) } finally { $tree.Dispose() }
    }
    Case 'Windows Job Object starts and stops an owned harmless process' {
        $environment = & $module { param($root,$config,$job) New-WBuildEnvironment $root $config $job } $FixtureRoot $fixtures.config $fixtures.job
        $tree = [BuildWorker.JobTree]::new(1073741824)
        try {
            $tree.Start((Get-Process -Id $PID).Path, @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60'), $FixtureRoot, $environment)
            Check ($tree.ActiveProcesses -ge 1)
            Check (-not $tree.Completed)
        } finally { $tree.Dispose() }
    }
    Case 'Windows Job Object captures bounded stdout through restricted handles' {
        $environment = & $module { param($root,$config,$job) New-WBuildEnvironment $root $config $job } $FixtureRoot $fixtures.config $fixtures.job
        $tree = [BuildWorker.JobTree]::new(1073741824)
        $log = Join-Path $FixtureRoot 'capture/native.log'
        try {
            $tree.StartLogged((Get-Process -Id $PID).Path, @('-NoLogo','-NoProfile','-NonInteractive','-Command','Write-Output "owned child output"'), $FixtureRoot, $environment, $log)
            $timer = [Diagnostics.Stopwatch]::StartNew()
            while (-not $tree.Completed -and $timer.Elapsed.TotalSeconds -lt 20) { Start-Sleep -Milliseconds 25 }
            Check ($tree.Completed); Check ($tree.ExitCode -eq 0)
        } finally { $tree.Dispose() }
        Check ([IO.File]::ReadAllText($log).Contains('owned child output'))
    }
} else {
    $script:Skipped += 8
    Write-Output 'SKIP four Windows ACL, one Mutex and three Job Object native tests (requires Windows)'
}
Case 'Offline polling stays idle and reconnects without a build claim' {
    $offlineRoot=Join-Path $FixtureRoot 'offline-poll'
    [void][IO.Directory]::CreateDirectory((Join-Path $offlineRoot 'control'))
    [void][IO.Directory]::CreateDirectory((Join-Path $offlineRoot 'data'))
    [BuildWorker.Paths]::AtomicText($offlineRoot,'control/state.json','{"version":1,"phase":"idle","job":null}')
    & $module {
        param($root,$config)
        $old=Get-Variable -Name Rpc -Scope Script -ErrorAction SilentlyContinue
        try {
            $script:Rpc={param($request,$data) if($request.op -cne 'ping'){throw 'offline_claim_attempted'};throw [BuildWorker.TransportFailure]::new()}
            try{Invoke-WCycle $root $config;throw 'offline_failure_expected'}catch [BuildWorker.TransportFailure]{}
            if((Read-WState $root).phase -cne 'idle'){throw 'offline_state_changed'}
            $script:Rpc={param($request,$data) if($request.op -ceq 'ping'){return @{Result=@{ready=$true};Data=@()}};if($request.op -ceq 'claim'){return @{Result=$null;Data=@()}};throw 'unexpected_poll_operation'}
            Invoke-WCycle $root $config
            if((Read-WState $root).phase -cne 'idle'){throw 'reconnect_not_idle'}
        }finally{if($null -ne $old){$script:Rpc=$old.Value}else{Remove-Variable -Name Rpc -Scope Script -ErrorAction SilentlyContinue}}
    } $offlineRoot $fixtures.config
}
Write-Output ("RESULT passed={0} failed={1} skipped={2}" -f $script:Passed, $script:Failed, $script:Skipped)
if ($script:Failed -gt 0) { exit 1 }
