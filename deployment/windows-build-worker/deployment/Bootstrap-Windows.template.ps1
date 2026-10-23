#requires -Version 7.4
# Fixed outbound-only bootstrap: package download, validation, preparation; dummy cycle is explicit opt-in.
[CmdletBinding()]
param([switch]$PrepareOnly, [switch]$VerifyDummy, [switch]$InitializePrivateRoot, [string]$RestoreInitialAcl, [switch]$InspectAcl)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows 11 and PowerShell 7.4+ required' }
if (-not $PSHOME.StartsWith('C:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'PowerShell must run from C:' }
$workerRoot = 'C:\BuildWorker-Production'
$vpsHost = '__HOST__'
$expectedKey = '__PUBLIC_KEY__'
$knownHost = '__HOST_KEY__'
# __BOOTSTRAP_ACL__
if ($InspectAcl -and ($InitializePrivateRoot -or $RestoreInitialAcl -or $VerifyDummy -or $PrepareOnly)) { throw 'InspectAcl is read-only; do not combine it with other switches' }
if (($InitializePrivateRoot -and $RestoreInitialAcl) -or (($InitializePrivateRoot -or $RestoreInitialAcl) -and ($VerifyDummy -or $PrepareOnly))) { throw 'ACL maintenance is offline-only; do not combine it with deployment switches' }
function Normal([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not ($full -ieq $workerRoot -or $full.StartsWith($workerRoot + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Worker path escape' }
    Assert-DPPlainPath $full 'bootstrap'
    return $full
}
function Portable-ZipName([string]$Name) {
    if ($Name.Length -eq 0 -or $Name.Length -gt 240) { throw 'Invalid ZIP path length' }
    foreach ($part in $Name.Split('/')) {
        if ($part -in @('', '.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(\.|$)') { throw 'Unsafe ZIP component' }
        foreach ($c in $part.ToCharArray()) { if ([int]$c -lt 32 -or [int]$c -gt 126 -or '\:<>"|?*'.Contains($c)) { throw 'Unsafe ZIP character' } }
    }
}
function Write-PrivateText([string]$Path, [string]$Text) {
    $Path = Normal $Path
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
[void](Normal $workerRoot)
if ($InspectAcl) {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $report = @{root = $workerRoot; currentSid = $currentSid; layout = 'missing'; paths = @(); readOnly = $true}
    if ([IO.Directory]::Exists($workerRoot)) {
        $report.layout = Get-BLayout $workerRoot (@(Get-BInitialBackups $workerRoot $currentSid))
        foreach ($relative in @('', 'Bootstrap-Windows.ps1', 'windows', 'control', 'control/packages', 'control/worker.json', 'control/state.json', 'data')) {
            $path = if ($relative) { Normal (Join-Path $workerRoot $relative) } else { $workerRoot }
            if ([IO.Path]::Exists($path)) {
                $view = Get-BAclView $path
                $report.paths += @{path = $path; owner = $view.owner; rules = $view.rules; issue = (Get-BAclIssue $view $currentSid)}
            }
        }
    }
    ConvertTo-Json -InputObject $report -Depth 12
    return
}
foreach ($relative in @('control/state.json', 'control/worker.json')) {
    $path = Normal (Join-Path $workerRoot $relative)
    if ([IO.File]::Exists($path)) {
        $existing = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable
        if (($relative.EndsWith('state.json') -and $existing.phase -cne 'idle') -or ($relative.EndsWith('worker.json') -and $existing.enabled)) { throw 'Stop/recover the existing worker before bootstrap; nothing reset' }
    }
}
$updateMutex = [Threading.Mutex]::new($false, 'Global\BuildWorker-C-BuildWorker-v1')
$updateLocked = $false
$transaction = $null
try {
    try { $updateLocked = $updateMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $updateLocked = $true }
    if (-not $updateLocked) { throw 'An existing worker is active; deployment was not started' }
    $stateCheck = Normal (Join-Path $workerRoot 'control/state.json')
    if ([IO.File]::Exists($stateCheck) -and (Get-Content -LiteralPath $stateCheck -Raw | ConvertFrom-Json -AsHashtable).phase -cne 'idle') { throw 'Unresolved worker state; nothing reset' }
    $configCheck = Normal (Join-Path $workerRoot 'control/worker.json')
    if ([IO.File]::Exists($configCheck) -and (Get-Content -LiteralPath $configCheck -Raw | ConvertFrom-Json -AsHashtable).enabled) { throw 'Existing worker is enabled' }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    # Legacy ACL adoption is retired. Setup owns exclusive private creation of the new area.
    if ($RestoreInitialAcl -or $InitializePrivateRoot) {throw 'Legacy ACL adoption is disabled for production; use the external Setup entry'}
    if (-not [IO.Directory]::Exists($workerRoot)) {throw 'Production area is missing; run the external Setup entry first'}
    $marker=Normal (Join-Path $workerRoot '.build-worker-area.json')
    if (-not [IO.File]::Exists($marker) -or ([IO.FileInfo]$marker).Length -gt 1048576) {throw 'Dedicated production marker missing or oversized; no adoption'}
    if (Get-BAclIssue (Get-BAclView $marker) $currentSid) {throw 'Production marker ACL is not private'}
    $area=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json -AsHashtable
    if ($area.schemaVersion -ne 1 -or $area.role -cne 'production' -or $area.layout -cne 'separate-production-validation-v1') {throw 'Dedicated production marker mismatch; no adoption'}
    # Strict access checks apply to every installed/partial environment. Initialization is separate and opt-in.
    foreach ($relative in @('', 'control', 'control/packages')) {
        $path = if ($relative) { Normal (Join-Path $workerRoot $relative) } else { $workerRoot }
        if (-not [IO.Path]::Exists($path)) { continue }
        $issue = Get-BAclIssue (Get-BAclView $path) $currentSid
        if ($issue) {
            $layout = Get-BLayout $workerRoot (@(Get-BInitialBackups $workerRoot $currentSid))
            $hint = if ($layout -ceq 'initial') { 'Initial directory: review ACLs, then use -InitializePrivateRoot for offline initialization.' } else { 'Existing/partial or unknown contents: explicit ACL review required; initialization refused.' }
            throw ('Existing ACL is not private; left unchanged. Path=' + $path + '; ' + $issue + '. ' + $hint)
        }
    }
    Assert-BNoPendingAcl $workerRoot
    # A killed deployment must be recovered before a new deployment can supersede its backups.
    foreach ($parent in @('control/packages', 'control/backups')) {
        $path = Normal (Join-Path $workerRoot $parent)
        if ([IO.Directory]::Exists($path)) {
            foreach ($dir in Get-ChildItem -LiteralPath $path -Directory) {
                $journal = Normal (Join-Path $dir.FullName 'deployment-transaction.json')
                if ([IO.File]::Exists($journal) -and (Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json -AsHashtable).status -in @('pending', 'rollback-failed')) { throw ('Recover deployment journal first: ' + $journal) }
            }
        }
    }
$downloadRoot = Normal (Join-Path $workerRoot ('control/packages/' + [Guid]::NewGuid().ToString('N')))
[void][IO.Directory]::CreateDirectory($downloadRoot)
$identity = Join-Path $downloadRoot 'worker-key.pub'
# Use only the public selector for the key already held by the user's Agent.
Write-PrivateText $identity ($expectedKey + "`n")
$hosts = Join-Path $downloadRoot 'known_hosts'
Write-PrivateText $hosts ($knownHost + "`n")
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
if (-not [IO.File]::Exists($ssh)) { throw 'Existing Windows OpenSSH client required' }
function Exact($Stream, [int]$Length, [Diagnostics.Stopwatch]$Timer) {
    $data = [byte[]]::new($Length); $done = 0
    while ($done -lt $Length) {
        $remaining = 30000 - [int]$Timer.ElapsedMilliseconds
        if ($remaining -le 0) { throw 'SSH response timeout' }
        $read = $Stream.ReadAsync($data, $done, $Length - $done)
        if (-not $read.Wait($remaining)) { throw 'SSH response timeout' }
        $count = $read.GetAwaiter().GetResult()
        if ($count -le 0) { throw 'Truncated SSH response' }
        $done += $count
    }
    return ,$data
}
function Rpc($Request) {
    $Request.version = 1
    $info = [Diagnostics.ProcessStartInfo]::new($ssh)
    foreach ($arg in @('-T','-F','NUL','-o','BatchMode=yes','-o','PreferredAuthentications=publickey','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','IdentitiesOnly=yes','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','GlobalKnownHostsFile=NUL','-o',('UserKnownHostsFile=' + $hosts),'-o','ConnectTimeout=10','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2','-i',$identity,('ffxivdev@' + $vpsHost),'build-worker-v1')) { $info.ArgumentList.Add($arg) }
    $info.UseShellExecute = $false; $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
    Initialize-DPNative
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info; $started = $false;$stderr=$null
    try {
        $started = $process.Start()
        $stderr = [BuildWorkerDeploymentDiagnostics.Metadata]::ReadSshCategory($process.StandardError.BaseStream)
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $raw = [Text.Encoding]::UTF8.GetBytes(($Request | ConvertTo-Json -Compress))
        $prefix = [BitConverter]::GetBytes([Net.IPAddress]::HostToNetworkOrder([int]$raw.Length))
        $process.StandardInput.BaseStream.Write($prefix, 0, 4); $process.StandardInput.BaseStream.Write($raw, 0, $raw.Length); $process.StandardInput.Close()
        # Bounded buffers and one deadline, including slow or interrupted responses.
        $head = Exact $process.StandardOutput.BaseStream 4 $timer
        $length = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($head))
        if ($length -lt 2 -or $length -gt 65536) { throw 'Invalid SSH JSON length' }
        $header = [Text.Encoding]::UTF8.GetString((Exact $process.StandardOutput.BaseStream $length $timer)) | ConvertFrom-Json -AsHashtable
        if ($header.version -ne 1 -or -not $header.ok -or $header.dataLength -lt 0 -or $header.dataLength -gt 1048576) { throw 'Dedicated SSH receiver rejected the package request' }
        $data = Exact $process.StandardOutput.BaseStream $header.dataLength $timer
        $extra = [byte[]]::new(1)
        $tail = $process.StandardOutput.BaseStream.ReadAsync($extra, 0, 1)
        $remaining = 30000 - [int]$timer.ElapsedMilliseconds
        if ($remaining -le 0 -or -not $tail.Wait($remaining) -or $tail.GetAwaiter().GetResult() -ne 0) { throw 'Unexpected SSH trailing data or timeout' }
        $remaining = 30000 - [int]$timer.ElapsedMilliseconds
        if ($remaining -le 0 -or -not $process.WaitForExit($remaining) -or $process.ExitCode -ne 0) { throw 'SSH exchange failed' }
        [void]$stderr.GetAwaiter().GetResult()
        return @{Result = $header.result; Data = $data}
    } catch {
        $category='ssh-framing-or-timeout'
        if ($started -and $process.WaitForExit(100) -and $null -ne $stderr -and $stderr.IsCompletedSuccessfully) {$category=$stderr.GetAwaiter().GetResult()}
        $failure=[InvalidOperationException]::new(('SSH exchange failed: '+$category))
        $failure.Data['setupFailure']=@{category=$category;operation=$Request.op;rawStderrPrinted=$false}
        throw $failure
    } finally { if ($started -and -not $process.HasExited) { $process.Kill() }; $process.Dispose() }
}
$drive = [IO.DriveInfo]::new('C:\')
if ($drive.AvailableFreeSpace -lt 10737418240) { throw 'At least 10GiB free on C: required' }
$package = (Rpc @{op = 'package-info'}).Result
if ($package.size -le 0 -or $package.size -gt 16777216 -or $package.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid package descriptor' }
$zipPath = Join-Path $downloadRoot 'worker.zip'
$file = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    while ($file.Position -lt $package.size) {
        $reply = Rpc @{op = 'download-package'; offset = $file.Position; length = [Math]::Min(1048576, $package.size - $file.Position)}
        $sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($reply.Data)).ToLowerInvariant()
        if ($reply.Result.sha256 -cne $package.sha256 -or $reply.Result.offset -ne $file.Position -or $reply.Data.Length -le 0 -or $sha -cne $reply.Result.chunkSha256) { throw 'Package chunk mismatch' }
        if ($file.Position + $reply.Data.Length -gt $package.size) { throw 'Package overflow' }
        $file.Write($reply.Data, 0, $reply.Data.Length)
    }
    $file.Flush($true)
} finally { $file.Dispose() }
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $package.sha256) { throw 'Package SHA-256 differs' }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$staging = Join-Path $downloadRoot 'expanded'; [void][IO.Directory]::CreateDirectory($staging)
try {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    if ($archive.Entries.Count -gt 128) { throw 'Too many package entries' }
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName
        Portable-ZipName $name
        if ($name -notmatch '^(windows/|deployment/|worker-key\.pub$)' -or $name -match '(^/|\\|:|(^|/)\.\.(/|$))' -or -not $seen.Add($name)) { throw 'Unexpected package entry' }
        if ($entry.Length -gt 2097152 -or (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw 'Unsafe package entry' }
        $total += $entry.Length; if ($total -gt 16777216) { throw 'Expanded package too large' }
        $destination = Join-Path $staging $name
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $inputStream = $entry.Open(); $outputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
        try {
            $buffer = [byte[]]::new(65536); [long]$written = 0
            while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $written += $count; if ($written -gt $entry.Length) { throw 'ZIP entry overflow' }; $outputStream.Write($buffer, 0, $count)
            }
            if ($written -ne $entry.Length) { throw 'ZIP entry truncated' }
        } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
} finally { $archive.Dispose() }
$manifest = Get-Content -LiteralPath (Join-Path $staging 'deployment/package-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
if ($manifest.schemaVersion -ne 1 -or $manifest.files.Count + 1 -ne $seen.Count) { throw 'Manifest inventory differs' }
$manifestSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($item in $manifest.files) {
    if (-not $manifestSeen.Add($item.path) -or $item.path -ceq 'deployment/package-manifest.json') { throw 'Duplicate manifest path' }
    if (-not $seen.Contains($item.path) -or (Get-FileHash -LiteralPath (Join-Path $staging $item.path) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha256) { throw 'Manifest mismatch' }
}
# Load only the manifest-verified helper, before overwriting any installed code.
. (Join-Path $staging 'deployment/Deployment-Transaction.ps1')
$paths = @($seen) + @('control/worker.json', 'control/worker-key.pub', 'control/known_hosts', 'control/deployment-report.json')
Assert-DIdle $workerRoot
Assert-DPrivateAcl $workerRoot $paths
$transaction = New-DTransaction $workerRoot $downloadRoot $paths
foreach ($name in $seen) { Set-DFile $transaction $name (Join-Path $staging $name) }
# Same process/thread: named mutex remains held through preparation (recursive acquisition).
& (Join-Path $workerRoot 'deployment/Prepare-Windows.ps1') -DeploymentTransaction $transaction
# Prepare changed these files under its own transaction. Track them for outer crash recovery too.
foreach ($e in $transaction.entries) {
    if ($e.path.StartsWith('control/')) {
        $path = Get-DPath $workerRoot $e.path
        if ([IO.File]::Exists($path)) { $e.installedHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    }
}
$transaction.status = 'committed'; Save-DJournal $transaction
# Optional network/build verification starts only after a committed deployment. Never roll back job state.
if ($VerifyDummy -and -not $PrepareOnly) { & (Join-Path $workerRoot 'deployment/Prepare-Windows.ps1') -VerifyDummy }
} catch {
    if ($null -ne $transaction -and $transaction.status -ceq 'pending') {
        try { Undo-DTransaction $transaction }
        catch { $transaction.status = 'rollback-failed'; Save-DJournal $transaction; Write-Warning ('Automatic restore incomplete; retain journal: ' + $transaction.directory) }
    }
    throw
} finally { if ($updateLocked) { $updateMutex.ReleaseMutex() }; $updateMutex.Dispose() }
