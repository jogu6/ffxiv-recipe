#requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('BuildWorker.Guard' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'WorkerCore.cs'), (Join-Path $PSScriptRoot 'JobObject.cs'), (Join-Path $PSScriptRoot 'LogSupport.cs')
}
$script:Rpc = $null
$script:LogEvidence = $null
$script:PulseClock = [Diagnostics.Stopwatch]::StartNew()
$script:CapacityClock = [Diagnostics.Stopwatch]::StartNew()

function Assert-W($Condition, [string]$Code = 'invalid') {
    if (-not $Condition) { throw [BuildWorker.Rejected]::new($Code) }
}
function Get-WJson($Value) { ConvertTo-Json -InputObject $Value -Depth 64 -Compress }
function Assert-WFields($Value, [string[]]$Required, [string[]]$Optional = @()) {
    Assert-W ($Value -is [Collections.IDictionary])
    foreach ($key in $Required) { Assert-W ($Value.Keys -ccontains $key) 'missing_field' }
    foreach ($key in $Value.Keys) { Assert-W (($Required -ccontains $key) -or ($Optional -ccontains $key)) 'unknown_field' }
}
function Assert-WInteger($Value, [long]$Min, [long]$Max) {
    Assert-W (($Value -is [int] -or $Value -is [long]) -and $Value -ge $Min -and $Value -le $Max) 'number_limit'
}
function Assert-WString($Value, [int]$Max = 4096) {
    Assert-W ($Value -is [string] -and $Value.Length -le $Max -and -not $Value.Contains([char]0))
}
function Get-WProfileRevision($Definition) { [BuildWorker.Guard]::Revision((Get-WJson $Definition)) }

function Test-WConfiguration($Config) {
    Assert-WFields $Config @('schemaVersion', 'enabled', 'workerId', 'ssh', 'storage', 'tools', 'profiles', 'environment', 'pathEntries')
    Assert-WInteger $Config.schemaVersion 1 1
    Assert-W ($Config.enabled -is [bool])
    [void][BuildWorker.Guard]::Id($Config.workerId)
    Assert-WFields $Config.ssh @('executable', 'host', 'user', 'port', 'knownHosts', 'identityPublicKey', 'timeoutSeconds')
    Assert-WString $Config.ssh.executable
    Assert-WString $Config.ssh.host
    Assert-WString $Config.ssh.user
    Assert-WInteger $Config.ssh.port 1 65535
    Assert-WInteger $Config.ssh.timeoutSeconds 1 20
    Assert-W ($Config.ssh.knownHosts -ceq 'control/known_hosts')
    Assert-W ($Config.ssh.identityPublicKey -ceq 'control/worker-key.pub')
    [void][BuildWorker.Protocol]::Ssh($Config.ssh.executable, $Config.ssh.host, $Config.ssh.user, $Config.ssh.port, 'known_hosts', 'public_key')
    Assert-WFields $Config.storage @('minimumFreeBytes', 'maxWorkspaceBytes', 'startReservationBytes') @('maxBuildMemoryBytes')
    if($Config.storage.Contains('maxBuildMemoryBytes')){Assert-WInteger $Config.storage.maxBuildMemoryBytes 0 17179869184;if($Config.storage.maxBuildMemoryBytes -ne 0){Assert-WInteger $Config.storage.maxBuildMemoryBytes 268435456 17179869184}}
    Assert-WInteger $Config.storage.minimumFreeBytes 1048576 1099511627776
    Assert-WInteger $Config.storage.maxWorkspaceBytes 1048576 1099511627776
    Assert-WInteger $Config.storage.startReservationBytes 1048576 1099511627776
    Assert-W ($Config.storage.startReservationBytes -lt $Config.storage.maxWorkspaceBytes)
    Assert-W ($Config.tools -is [Collections.IDictionary])
    [BuildWorker.Guard]::Unique([string[]]@($Config.tools.Keys))
    foreach ($name in $Config.tools.Keys) {
        [void][BuildWorker.Guard]::Id($name)
        $tool = $Config.tools[$name]
        Assert-WFields $tool @('executable', 'prefixArgs')
        Assert-WString $tool.executable
        Assert-W ([IO.Path]::IsPathFullyQualified($tool.executable) -and [IO.Path]::GetExtension($tool.executable) -ieq '.exe')
        Assert-W ($tool.prefixArgs -is [array] -and $tool.prefixArgs.Count -le 100)
        foreach ($arg in $tool.prefixArgs) { Assert-WString $arg }
    }
    Assert-W ($Config.environment -is [Collections.IDictionary])
    $forbidden = @('PATH', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOTNET_CLI_HOME',
        'CARGO_HOME', 'CARGO_TARGET_DIR', 'RUSTUP_HOME', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_PREFIX',
        'SCCACHE_DIR', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GH_TOKEN', 'GITHUB_TOKEN',
        'PYTHONUSERBASE', 'PIP_CACHE_DIR', 'NUGET_PACKAGES', 'GRADLE_USER_HOME', 'MAVEN_USER_HOME', 'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'MSBUILDDISABLENODEREUSE')
    $envNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($key in $Config.environment.Keys) {
        Assert-W ($key -cmatch '^[A-Z][A-Z0-9_]*$' -and $envNames.Add($key) -and $forbidden -inotcontains $key) 'reserved_environment'
        Assert-WString $Config.environment[$key]
    }
    Assert-W ($Config.pathEntries -is [array])
    foreach ($path in $Config.pathEntries) { Assert-WString $path; Assert-W ([IO.Path]::IsPathFullyQualified($path) -and -not $path.Contains(';')) }
    Assert-W ($Config.profiles -is [array] -and $Config.profiles.Count -le 1000)
    $pairs = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $projects = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($profile in $Config.profiles) {
        Assert-WFields $profile @('projectId', 'profileId', 'revision', 'definition')
        [void][BuildWorker.Guard]::Id($profile.projectId)
        [void][BuildWorker.Guard]::Portable($profile.projectId)
        [void][BuildWorker.Guard]::Id($profile.profileId)
        [void][BuildWorker.Guard]::Portable($profile.profileId)
        [void][BuildWorker.Guard]::Sha($profile.revision)
        Assert-W ($pairs.Add($profile.projectId + '/' + $profile.profileId)) 'profile_collision'
        if ($projects.ContainsKey($profile.projectId)) { Assert-W ($projects[$profile.projectId] -ceq $profile.projectId) 'project_collision' }
        $projects[$profile.projectId] = $profile.projectId
        $definition = $profile.definition
        Assert-WFields $definition @('steps', 'artifacts', 'timeoutSeconds')
        Assert-WInteger $definition.timeoutSeconds 1 86400
        Assert-W ($definition.steps -is [array] -and $definition.steps.Count -gt 0 -and $definition.steps.Count -le 32)
        foreach ($step in $definition.steps) {
            Assert-WFields $step @('tool', 'args', 'cwd')
            [void][BuildWorker.Guard]::Id($step.tool)
            Assert-W ($Config.tools.Keys -ccontains $step.tool) 'unknown_tool'
            Assert-W ($step.args -is [array] -and $step.args.Count -le 100)
            foreach ($arg in $step.args) { Assert-WString $arg }
            if ($step.cwd -cne '.') { [void][BuildWorker.Guard]::Portable($step.cwd) }
        }
        Assert-W ($definition.artifacts -is [array] -and $definition.artifacts.Count -gt 0 -and $definition.artifacts.Count -le 32)
        [long]$total = 0
        foreach ($artifact in $definition.artifacts) {
            Assert-WFields $artifact @('path', 'maxBytes')
            [void][BuildWorker.Guard]::Portable($artifact.path)
            Assert-WInteger $artifact.maxBytes 1 536870912
            $total += $artifact.maxBytes
        }
        Assert-W ($total -le 1073741824)
        [BuildWorker.Guard]::Unique([string[]]@($definition.artifacts | ForEach-Object { $_.path }))
        Assert-W ((Get-WProfileRevision $definition) -ceq $profile.revision) 'profile_mismatch'
    }
    return $true
}
function Get-WProfile($Config, $Job) {
    $matches = @($Config.profiles | Where-Object { $_.projectId -ceq $Job.project -and $_.profileId -ceq $Job.profile })
    Assert-W ($matches.Count -eq 1 -and $matches[0].revision -ceq $Job.revision) 'profile_mismatch'
    Assert-W ((Get-WProfileRevision $matches[0].definition) -ceq $Job.revision) 'profile_mismatch'
    return $matches[0]
}
function Test-WJob($Config, $Job) {
    Assert-WFields $Job @('id', 'project', 'profile', 'revision', 'snapshot', 'state', 'attempt', 'worker', 'lease_until', 'created', 'updated', 'reason', 'result', 'token', 'source')
    Assert-W ($Job.id -is [string] -and $Job.id -cmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    [void][BuildWorker.Guard]::Id($Job.project)
    [void][BuildWorker.Guard]::Id($Job.profile)
    [void][BuildWorker.Guard]::Sha($Job.revision)
    [void][BuildWorker.Guard]::Sha($Job.snapshot)
    Assert-WInteger $Job.attempt 1 1000000
    Assert-W ($Job.worker -ceq $Config.workerId -and $Job.state -ceq 'claimed') 'foreign_job'
    Assert-WString $Job.token 128
    Assert-W ($Job.token.Length -ge 20)
    [void](Get-WProfile $Config $Job)
    [void][BuildWorker.Archive]::Descriptor((Get-WJson $Job.source), 20000, 134217728, 1073741824, 1153433600)
    Assert-W ($Job.source.sha256 -ceq $Job.snapshot)
}
function Get-WCapabilities($Config) {
    $list = @($Config.profiles | ForEach-Object { @{projectId = $_.projectId; profileId = $_.profileId; revision = $_.revision} })
    return ,$list
}
function Send-WRpc($Config, $Request, [byte[]]$Data = @(), [switch]$NoRetry) {
    $Request.version = 1
    $tries = if ($NoRetry) { 1 } else { 3 }
    for ($i = 0; $i -lt $tries; $i++) {
        try { return & $script:Rpc $Request $Data }
        catch [BuildWorker.TransportFailure] {
            if ($i -eq $tries - 1) { throw }
            Start-Sleep -Seconds ([Math]::Pow(2, $i))
        }
    }
}
function Get-WOwnedRequest($Job, [string]$Operation) {
    return @{op = $Operation; jobId = $Job.id; attempt = $Job.attempt; token = $Job.token}
}
function Save-WState([string]$Root, $State) { [BuildWorker.Paths]::AtomicText($Root, 'control/state.json', (Get-WJson $State)) }
function Read-WState([string]$Root) {
    $path = [BuildWorker.Paths]::Inside($Root, 'control/state.json')
    if (-not [IO.File]::Exists($path)) { return @{version = 1; phase = 'idle'; job = $null} }
    Assert-W (([IO.FileInfo]$path).Length -le 8388608) 'state_size'
    $text = [IO.File]::ReadAllText($path)
    [void][BuildWorker.Guard]::Json($text)
    $value = ConvertFrom-Json -InputObject $text -AsHashtable
    Assert-WFields $value @('version', 'phase', 'job') @('manifest', 'outcome')
    Assert-WInteger $value.version 1 1
    Assert-W (@('idle', 'claiming', 'download', 'extracting', 'ready', 'building', 'collecting', 'upload', 'finish', 'blocked') -ccontains $value.phase)
    return $value
}
function Get-WJobRelative($Job) { 'data/jobs/' + $Job.id + '/' + $Job.attempt }
function Assert-WCapacity([string]$Root, $Config, [long]$Reservation = 0) {
    $data = [BuildWorker.Paths]::Inside($Root, 'data')
    $control = [BuildWorker.Paths]::Inside($Root, 'control')
    $used = [BuildWorker.Paths]::Usage($data, $Config.storage.maxWorkspaceBytes) + [BuildWorker.Paths]::Usage($control, $Config.storage.maxWorkspaceBytes)
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Root)))
    Assert-W ([BuildWorker.Paths]::Capacity($drive.AvailableFreeSpace, $used, $Config.storage.minimumFreeBytes, $Config.storage.maxWorkspaceBytes, $Reservation)) 'capacity'
}
function Invoke-WPulse([string]$Root, $Config, $Job, [switch]$Force) {
    if ($Force -or $script:PulseClock.Elapsed.TotalSeconds -ge 45) {
        [void](Send-WRpc $Config (Get-WOwnedRequest $Job 'heartbeat'))
        $script:PulseClock.Restart()
    }
    if ($Force -or $script:CapacityClock.Elapsed.TotalSeconds -ge 10) {
        Assert-WCapacity $Root $Config
        $script:CapacityClock.Restart()
    }
}
function Assert-WRemote($Config, $Job) {
    $reply = Send-WRpc $Config @{op = 'status'; jobId = $Job.id}
    $remote = $reply.Result
    Assert-W ($null -ne $remote) 'remote_state'
    foreach ($name in @('id', 'project', 'profile', 'revision', 'snapshot', 'worker')) { Assert-W ($remote[$name] -ceq $Job[$name]) 'remote_identity' }
    Assert-W ($remote.attempt -eq $Job.attempt) 'remote_attempt'
    Assert-W (@('claimed', 'building', 'uploading', 'succeeded', 'failed') -ccontains $remote.state) 'recovery_required'
    return $remote
}
function Receive-WSource([string]$Root, $Config, $Job) {
    $relative = (Get-WJobRelative $Job) + '/source.tar'
    $complete = [BuildWorker.Paths]::Inside($Root, $relative)
    $partial = [BuildWorker.Paths]::Inside($Root, $relative + '.part')
    if ([IO.File]::Exists($complete)) {
        Assert-W (([IO.FileInfo]$complete).Length -eq $Job.source.size -and [BuildWorker.Guard]::HashFile($complete) -ceq $Job.snapshot) 'source_hash'
        return $complete
    }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($partial))
    $file = [IO.FileStream]::new($partial, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        Assert-W ($file.Length -le $Job.source.size) 'source_size'
        [void]$file.Seek(0, [IO.SeekOrigin]::End)
        while ($file.Position -lt $Job.source.size) {
            Invoke-WPulse $Root $Config $Job
            $request = Get-WOwnedRequest $Job 'download'
            $request.offset = $file.Position
            $request.length = [Math]::Min(1048576, $Job.source.size - $file.Position)
            $reply = Send-WRpc $Config $request
            $meta = $reply.Result
            Assert-W ($meta.offset -eq $file.Position -and $meta.size -eq $Job.source.size -and $meta.sha256 -ceq $Job.snapshot) 'download_metadata'
            Assert-W ($reply.Data.Length -eq $request.length -and [BuildWorker.Guard]::Hash($reply.Data) -ceq $meta.chunkSha256) 'chunk_hash'
            $file.Write($reply.Data, 0, $reply.Data.Length)
            $file.Flush($true)
        }
    } finally { $file.Dispose() }
    $pulse = [Action]{ Invoke-WPulse $Root $Config $Job }
    Assert-W ([BuildWorker.Guard]::HashFile($partial, $pulse) -ceq $Job.snapshot) 'source_hash'
    [IO.File]::Move($partial, $complete)
    return $complete
}
function New-WBuildEnvironment([string]$Root, $Config, $Job) {
    $base = Get-WJobRelative $Job
    $values = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $values[$name] = $value }
    }
    foreach ($name in $Config.environment.Keys) { $values[$name] = $Config.environment[$name] }
    $redirects = @{
        USERPROFILE = 'home'; HOME = 'home'; APPDATA = 'home/AppData/Roaming'; LOCALAPPDATA = 'home/AppData/Local'
        TEMP = 'temp'; TMP = 'temp'; TMPDIR = 'temp'; DOTNET_CLI_HOME = 'home/dotnet'; CARGO_HOME = 'cache/cargo'
        CARGO_TARGET_DIR = 'target'; RUSTUP_HOME = 'cache/rustup'; NPM_CONFIG_CACHE = 'cache/npm'; NPM_CONFIG_PREFIX = 'home/npm'
        SCCACHE_DIR = 'cache/sccache'; PYTHONUSERBASE = 'home/python'; PIP_CACHE_DIR = 'cache/pip'; NUGET_PACKAGES = 'cache/nuget'
        GRADLE_USER_HOME = 'cache/gradle'; MAVEN_USER_HOME = 'cache/maven'
    }
    foreach ($name in $redirects.Keys) {
        $path = [BuildWorker.Paths]::Inside($Root, $base + '/' + $redirects[$name])
        [void][IO.Directory]::CreateDirectory($path)
        $values[$name] = $path
    }
    # WinINet otherwise creates a legacy Content.IE5 junction during native tool startup.
    # Pre-create ordinary job-local directories; all reparse points remain forbidden.
    foreach ($suffix in @('Microsoft/Windows/INetCache/IE','Microsoft/Windows/INetCache/Content.IE5')) {
        $path=[BuildWorker.Paths]::Inside($Root,$base+'/home/AppData/Local/'+$suffix)
        [void][IO.Directory]::CreateDirectory($path)
        [BuildWorker.Paths]::NoLinks($path)
    }
    $values['NPM_CONFIG_USERCONFIG'] = [BuildWorker.Paths]::Inside($Root, $base + '/home/npmrc')
    $values['GIT_CONFIG_GLOBAL'] = [BuildWorker.Paths]::Inside($Root, $base + '/home/gitconfig')
    $values['PYTHONDONTWRITEBYTECODE'] = '1'; $values['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'; $values['DOTNET_SKIP_FIRST_TIME_EXPERIENCE'] = '1'
    $values['GIT_CONFIG_NOSYSTEM'] = '1'; $values['GIT_TERMINAL_PROMPT'] = '0'; $values['MSBUILDDISABLENODEREUSE'] = '1'
    $paths = [Collections.Generic.List[string]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $candidates = @($Config.tools.Values | ForEach-Object { [IO.Path]::GetDirectoryName($_.executable) }) + @($Config.pathEntries)
    if ($values.ContainsKey('SystemRoot')) { $candidates += @($values['SystemRoot'], [IO.Path]::Combine($values['SystemRoot'], 'System32')) }
    foreach ($path in $candidates) { if ($seen.Add($path)) { $paths.Add($path) } }
    $values['Path'] = [string]::Join(';', $paths)
    return ,$values
}
function Invoke-WBuild([string]$Root, $Config, $Job, $Profile) {
    $environment = New-WBuildEnvironment $Root $Config $Job
    $source = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/source')
    $logPath = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/logs/build.log')
    [BuildWorker.Paths]::AtomicText($Root, (Get-WJobRelative $Job) + '/logs/build.log', "BuildWorker approved build started`n")
    $memoryLimit=if($Config.storage.Contains('maxBuildMemoryBytes')){[long]$Config.storage.maxBuildMemoryBytes}else{0L}
    $tree = [BuildWorker.JobTree]::new($memoryLimit)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        foreach ($step in $Profile.definition.steps) {
            Invoke-WPulse $Root $Config $Job -Force
            $tool = $Config.tools[$step.tool]
            $cwd = if ($step.cwd -ceq '.') { $source } else { [BuildWorker.Paths]::Inside($source, $step.cwd) }
            Assert-W ([IO.Directory]::Exists($cwd)) 'working_directory'
            $arguments = [string[]](@($tool.prefixArgs) + @($step.args))
            Assert-W ($timer.Elapsed.TotalSeconds -lt $Profile.definition.timeoutSeconds) 'build_timeout'
            $tree.StartLogged($tool.executable, $arguments, $cwd, $environment, $logPath)
            while (-not $tree.Completed) {
                Assert-W ($timer.Elapsed.TotalSeconds -lt $Profile.definition.timeoutSeconds) 'build_timeout'
                Invoke-WPulse $Root $Config $Job
                Start-Sleep -Milliseconds 250
            }
            if ($tree.ExitCode -ne 0) { return $false }
        }
        return $true
    } finally { $tree.Dispose() }
}
function Get-WSortedArtifacts($Profile) {
    $paths = [string[]]@($Profile.definition.artifacts | ForEach-Object { $_.path })
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    return ,$paths
}
function Collect-WArtifacts([string]$Root, $Config, $Job, $Profile) {
    $base = Get-WJobRelative $Job
    $source = [BuildWorker.Paths]::Inside($Root, $base + '/source')
    $paths = Get-WSortedArtifacts $Profile
    $manifest = @()
    $pulse = [Action]{ Invoke-WPulse $Root $Config $Job }
    for ($i = 0; $i -lt $paths.Count; $i++) {
        $name = $paths[$i]
        $approved = @($Profile.definition.artifacts | Where-Object { $_.path -ceq $name })[0]
        $from = [BuildWorker.Paths]::Inside($source, $name)
        Assert-W ([IO.File]::Exists($from)) 'missing_artifact'
        $size = ([IO.FileInfo]$from).Length
        Assert-W ($size -gt 0 -and $size -le $approved.maxBytes) 'artifact_size'
        $to = [BuildWorker.Paths]::Inside($Root, $base + '/return/' + $i)
        [BuildWorker.Paths]::CopyBounded($from, $to, $size, $pulse)
        $manifest += @{path = $name; size = $size; sha256 = [BuildWorker.Guard]::HashFile($to, $pulse)}
    }
    return ,$manifest
}
function Send-WArtifacts([string]$Root, $Config, $Job, $Manifest, $Profile) {
    Assert-W ($Manifest -is [array] -and $Manifest.Count -eq $Profile.definition.artifacts.Count) 'local_manifest'
    $expected = Get-WSortedArtifacts $Profile
    $pulse = [Action]{ Invoke-WPulse $Root $Config $Job }
    for ($i = 0; $i -lt $Manifest.Count; $i++) {
        $item = $Manifest[$i]
        Assert-WFields $item @('path', 'size', 'sha256')
        Assert-W ($item.path -ceq $expected[$i]) 'local_manifest'
        [void][BuildWorker.Guard]::Sha($item.sha256)
        $approved = @($Profile.definition.artifacts | Where-Object { $_.path -ceq $item.path })[0]
        Assert-WInteger $item.size 1 $approved.maxBytes
        $local = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/return/' + $i)
        Assert-W (([IO.FileInfo]$local).Length -eq $item.size -and [BuildWorker.Guard]::HashFile($local, $pulse) -ceq $item.sha256) 'local_artifact_hash'
    }
    $request = Get-WOwnedRequest $Job 'begin-upload'; $request.manifest = $Manifest
    $reply = Send-WRpc $Config $request
    $upload = $reply.Result
    [void][BuildWorker.Guard]::Id($upload.uploadId)
    Assert-W ($upload.offsets -is [array] -and $upload.offsets.Count -eq $Manifest.Count) 'upload_offsets'
    for ($i = 0; $i -lt $Manifest.Count; $i++) {
        $item = $Manifest[$i]
        Assert-WInteger $upload.offsets[$i] 0 $item.size
        [long]$offset = $upload.offsets[$i]
        $path = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/return/' + $i)
        $file = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            while ($offset -lt $item.size) {
                Invoke-WPulse $Root $Config $Job
                [void]$file.Seek($offset, [IO.SeekOrigin]::Begin)
                [int]$length = [Math]::Min(1048576, $item.size - $offset)
                $data = [byte[]]::new($length); $done = 0
                while ($done -lt $length) { $n = $file.Read($data, $done, $length - $done); Assert-W ($n -gt 0) 'local_artifact_hash'; $done += $n }
                $request = Get-WOwnedRequest $Job 'upload-chunk'
                $request.uploadId = $upload.uploadId; $request.index = $i; $request.offset = $offset
                $request.sha256 = [BuildWorker.Guard]::Hash($data); $request.dataLength = $length
                $reply = Send-WRpc $Config $request $data
                Assert-WInteger $reply.Result.offset ($offset + $length) $item.size
                $offset = $reply.Result.offset
            }
        } finally { $file.Dispose() }
    }
}
function Send-WLog([string]$Root, $Config, $Job, [switch]$Terminal) {
    $path = [BuildWorker.Paths]::Inside($Root, (Get-WJobRelative $Job) + '/logs/build.log')
    if (-not [IO.File]::Exists($path)) { return }
    $size = ([IO.FileInfo]$path).Length
    Assert-WInteger $size 0 2097152
    $sha = [BuildWorker.Guard]::HashFile($path)
    $reply = Send-WRpc $Config (Get-WOwnedRequest $Job 'log-status')
    if ($reply.Result.sealed) { Assert-W ($reply.Result.offset -eq $size -and $reply.Result.sha256 -ceq $sha) 'remote_log_hash'; $script:LogEvidence=@{jobId=$Job.id;attempt=$Job.attempt;sealed=$true;size=$size;sha256=$sha}; return }
    Assert-WInteger $reply.Result.offset 0 $size
    [long]$offset = $reply.Result.offset
    $file = [IO.File]::OpenRead($path)
    try {
        while ($offset -lt $size) {
            if (-not $Terminal) { Invoke-WPulse $Root $Config $Job }
            [void]$file.Seek($offset, [IO.SeekOrigin]::Begin)
            $data = [byte[]]::new([Math]::Min(65536, $size - $offset))
            $read = $file.Read($data, 0, $data.Length)
            Assert-W ($read -eq $data.Length) 'local_log_hash'
            $request = Get-WOwnedRequest $Job 'upload-log'
            $request.offset = $offset; $request.sha256 = [BuildWorker.Guard]::Hash($data); $request.dataLength = $data.Length
            $reply = Send-WRpc $Config $request $data
            Assert-WInteger $reply.Result.offset ($offset + $data.Length) $size
            $offset = $reply.Result.offset
        }
    } finally { $file.Dispose() }
    $request = Get-WOwnedRequest $Job 'seal-log'; $request.size = $size; $request.sha256 = $sha
    $sealed=Send-WRpc $Config $request
    Assert-W ($sealed.Result.sealed -and $sealed.Result.size -eq $size -and $sealed.Result.sha256 -ceq $sha) 'remote_log_hash'
    $script:LogEvidence=@{jobId=$Job.id;attempt=$Job.attempt;sealed=$true;size=$size;sha256=$sha}
}
function Complete-WLocal([string]$Root, $State, [string]$Outcome) {
    $job = $State.job
    $record = @{jobId = $job.id; attempt = $job.attempt; projectId = $job.project; profileId = $job.profile; revision = $job.revision; outcome = $Outcome}
    if ($null -ne $script:LogEvidence -and $script:LogEvidence.jobId -ceq $job.id -and $script:LogEvidence.attempt -eq $job.attempt) {$record.logReceipt=$script:LogEvidence}
    if ($Outcome -ceq 'succeeded') {
        Assert-W ($State.Contains('manifest')) 'missing_local_manifest'
        $record.manifest = $State.manifest
        $record.directory = (Get-WJobRelative $job) + '/return'
        [BuildWorker.Paths]::AtomicText($Root, 'data/success/' + $job.project + '/' + $job.profile + '/latest.json', (Get-WJson $record))
    }
    [BuildWorker.Paths]::AtomicText($Root, 'control/history/' + $job.id + '-' + $job.attempt + '.json', (Get-WJson $record))
    Save-WState $Root @{version = 1; phase = 'idle'; job = $null}
}
function Invoke-WCycle([string]$Root, $Config) {
    $state = Read-WState $Root
    if ($state.phase -ceq 'idle') {
        Assert-WCapacity $Root $Config $Config.storage.startReservationBytes
        # Known outages must leave the idle state intact. A lost claim response
        # remains an uncertain ownership boundary and still requires review.
        $ready=Send-WRpc $Config @{op='ping'} -NoRetry
        Assert-W ($ready.Result.ready -eq $true) 'broker_unavailable'
        $state = @{version = 1; phase = 'claiming'; job = $null}; Save-WState $Root $state
        $reply = Send-WRpc $Config @{op = 'claim'; profiles = (Get-WCapabilities $Config)} -NoRetry
        if ($null -eq $reply.Result) { Save-WState $Root @{version = 1; phase = 'idle'; job = $null}; return }
        $state.job = $reply.Result; $state.phase = 'download'; Save-WState $Root $state
    }
    Assert-W ($state.phase -cnotin @('claiming', 'blocked')) 'operator_recovery_required'
    $job = $state.job
    Test-WJob $Config $job
    $profile = Get-WProfile $Config $job
    $remote = Assert-WRemote $Config $job
    if ($remote.state -cin @('succeeded', 'failed')) {
        Assert-W ($state.phase -cin @('upload', 'finish')) 'unexpected_terminal_state'
        if ($remote.state -ceq 'succeeded') { Assert-W ($state.Contains('manifest') -and [BuildWorker.Guard]::CanonicalJson((Get-WJson $state.manifest)) -ceq [BuildWorker.Guard]::CanonicalJson((Get-WJson $remote.result.artifacts))) 'remote_manifest' }
        Send-WLog $Root $Config $job -Terminal
        Complete-WLocal $Root $state $remote.state
        return
    }
    if ($state.phase -cin @('building', 'collecting', 'extracting')) {
        # After a restart the execution boundary is uncertain. Never repeat a build.
        $state.phase = 'blocked'; Save-WState $Root $state
        try { [void](Send-WRpc $Config (Get-WOwnedRequest $job 'interrupt')) } catch { }
        throw [BuildWorker.Rejected]::new('operator_recovery_required')
    }
    Invoke-WPulse $Root $Config $job -Force
    $base = Get-WJobRelative $job
    $source = [BuildWorker.Paths]::Inside($Root, $base + '/source')
    if ($state.phase -ceq 'download') {
        Assert-W ($remote.state -ceq 'claimed') 'remote_state'
        $archive = Receive-WSource $Root $Config $job
        $state.phase = 'extracting'; Save-WState $Root $state
        $pulse = [Action]{ Invoke-WPulse $Root $Config $job }
        [BuildWorker.Archive]::Extract($archive, $source, (Get-WJson $job.source), $pulse)
        $state.phase = 'ready'; Save-WState $Root $state
    }
    if ($state.phase -ceq 'ready') {
        $pulse = [Action]{ Invoke-WPulse $Root $Config $job }
        [BuildWorker.Archive]::VerifyTree($source, (Get-WJson $job.source), $pulse)
        # start is idempotent; persist building before any actual process is created.
        [void](Send-WRpc $Config (Get-WOwnedRequest $job 'start'))
        $state.phase = 'building'; Save-WState $Root $state
        try { $success = Invoke-WBuild $Root $Config $job $profile }
        catch {
            $state.phase = 'blocked'; Save-WState $Root $state
            try { [void](Send-WRpc $Config (Get-WOwnedRequest $job 'interrupt')) } catch { }
            throw
        }
        if ($success) {
            $state.phase = 'collecting'; Save-WState $Root $state
            $state.manifest = Collect-WArtifacts $Root $Config $job $profile
            $state.phase = 'upload'; Save-WState $Root $state
        } else { $state.outcome = 'failed'; $state.phase = 'finish'; Save-WState $Root $state }
    }
    if ($state.phase -ceq 'upload') {
        Send-WArtifacts $Root $Config $job $state.manifest $profile
        $state.outcome = 'succeeded'; $state.phase = 'finish'; Save-WState $Root $state
    }
    if ($state.phase -ceq 'finish') {
        Send-WLog $Root $Config $job
        $request = Get-WOwnedRequest $job 'finish'; $request.outcome = $state.outcome
        $request.message = if ($state.outcome -ceq 'succeeded') { '' } else { 'Approved build step returned a nonzero exit code' }
        $reply = Send-WRpc $Config $request
        Assert-W ($reply.Result.state -ceq $state.outcome) 'remote_result'
        Complete-WLocal $Root $state $state.outcome
    }
}
function Start-WWorker([string]$Root, $Config, [switch]$Once) {
    Assert-W $IsWindows 'windows_required'
    Assert-W ([IO.Path]::GetFullPath($Root).TrimEnd('\') -ieq 'C:\BuildWorker-Production') 'worker_root'
    [BuildWorker.Paths]::NoLinks($Root)
    [void](Test-WConfiguration $Config)
    Assert-W $Config.enabled 'disabled'
    foreach ($relative in @('control', 'data')) { [void][IO.Directory]::CreateDirectory([BuildWorker.Paths]::Inside($Root, $relative)) }
    foreach ($relative in @($Config.ssh.knownHosts, $Config.ssh.identityPublicKey)) { Assert-W ([IO.File]::Exists([BuildWorker.Paths]::Inside($Root, $relative))) 'ssh_prerequisite' }
    foreach ($tool in $Config.tools.Values) { Assert-W ([IO.File]::Exists($tool.executable)) 'missing_tool' }
    Assert-W ($Config.profiles.Count -gt 0) 'empty_allowlist'
    $mutex = [Threading.Mutex]::new($false, 'Global\BuildWorker-C-BuildWorker-v1')
    $acquired = $false
    try {
        try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
        Assert-W $acquired 'worker_already_running'
        $script:Rpc = {
            param($request, $data)
            $known = [BuildWorker.Paths]::Inside($Root, $Config.ssh.knownHosts)
            $identity = [BuildWorker.Paths]::Inside($Root, $Config.ssh.identityPublicKey)
            $info = [BuildWorker.Protocol]::Ssh($Config.ssh.executable, $Config.ssh.host, $Config.ssh.user, $Config.ssh.port, $known, $identity)
            $response = [BuildWorker.Protocol]::Exchange($info, (ConvertTo-Json -InputObject $request -Depth 64 -Compress), $data, $Config.ssh.timeoutSeconds)
            $header = ConvertFrom-Json -InputObject $response.Header -AsHashtable
            return @{Result = $header.result; Data = $response.Data}
        }.GetNewClosure()
        do {
            try { Invoke-WCycle $Root $Config }
            catch [BuildWorker.TransportFailure] { if ($Once) { throw }; Start-Sleep -Seconds 30 }
            catch {
                # Never print exception/request/token/environment contents.
                Write-Warning 'Worker stopped for capacity, policy, integrity or recovery review. See local state and operations guide.'
                $failure=[BuildWorker.Rejected]::new('operator_review_required')
                $base=$_.Exception.GetBaseException()
                $code=if($base -is [BuildWorker.Rejected] -and $base.Message -cmatch '^[a-z0-9_]{1,80}$'){$base.Message}else{'runtime_failure'}
                try {[BuildWorker.Paths]::AtomicText($Root,'control/last-worker-failure.json',(Get-WJson @{type=$base.GetType().Name;code=$code;utc=[DateTime]::UtcNow.ToString('o')}))} catch {}
                $failure.Data['workerFailureCode']=$code
                if ($base.Data.Contains('deploymentPath')) {$failure.Data['deploymentPath']=$base.Data['deploymentPath']}
                throw $failure
            }
            if (-not $Once) { Start-Sleep -Seconds 30 }
        } while (-not $Once)
    } finally { if ($acquired) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
Export-ModuleMember -Function Test-WConfiguration, Get-WProfileRevision, Start-WWorker
