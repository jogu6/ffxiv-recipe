# Ubuntu-only orchestration integration: Windows entry adapters and native APIs are substituted.
# Real manifest, transaction, SSH framed broker, snapshot extraction, upload and log receipts.
param([string]$FixtureRoot,[string]$CodeRoot,[string]$BrokerRoot,[string]$TransportFile)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $CodeRoot 'deployment/Setup-Windows.ps1')
. (Join-Path $CodeRoot 'deployment/Deployment-Transaction.ps1')
Import-Module (Join-Path $CodeRoot 'windows/Worker.psm1') -Force
function Check($ok) {if (-not $ok) {throw 'Whole-flow isolated integration assertion failed'}}
$sid='S-1-5-21-100-200-300-1001'
function Read-MAcl {
 return @{owner=$sid;group=$sid;access='PRIVATE';descriptor='FIXTURE';protected=$true;rules=@(
  foreach ($id in @($sid,'S-1-5-32-544','S-1-5-18')) {@{common=$true;callback=$false;type='AccessAllowed';sid=$id;flags=3;mask=0x1f01ff}}
 )}
}
function Assert-DPrivateAcl {} # Native Windows access checks have dedicated real-Windows probes.
function Initialize-MNative {}
function New-MPin($Path,$Directory) {return [IO.MemoryStream]::new()}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
function New-SPrivateArea($Plan,$Sid) {
 if ($Plan.create) {Check (-not [IO.Path]::Exists($Plan.root));[void][IO.Directory]::CreateDirectory($Plan.root)}
 if ($Plan.initializeMarker) {
  [IO.File]::WriteAllText((Join-Path $Plan.root '.build-worker-area.json'),(@{schemaVersion=1;role=$Plan.role;layout='separate-production-validation-v1'}|ConvertTo-Json -Compress))
 }
}
function Invoke-SNativeProbe($Root,$Sid) {return @{path=$Root;nativeWin32='not-run-on-Ubuntu'}}
$script:TransportArgs=@(Get-Content -LiteralPath $TransportFile -Raw|ConvertFrom-Json)
function Test-Rpc($Request,[byte[]]$Data=[byte[]]::new(0)) {
 $Request.version=1
 $info=[Diagnostics.ProcessStartInfo]::new($script:TransportArgs[0])
 foreach ($arg in $script:TransportArgs[1..($script:TransportArgs.Count-1)]) {$info.ArgumentList.Add($arg)}
 $response=[BuildWorker.Protocol]::Exchange($info,($Request|ConvertTo-Json -Depth 64 -Compress),$Data,25)
 $h=$response.Header|ConvertFrom-Json -AsHashtable
 return @{Result=$h.result;Data=$response.Data}
}
function Invoke-SSshPreflight($Directory) {
 $script:Descriptor=(Test-Rpc @{op='package-info'}).Result
 Check ($script:Descriptor.sha256 -ceq [BuildWorker.Guard]::HashFile((Join-Path $BrokerRoot 'dist/build-worker-windows.zip')))
 return @{verified=$true;transport='actual loopback SSH';jobClaimed=$false}
}
function Invoke-SBootstrap {
 $directory=Join-Path $FixtureRoot ('control/packages/'+[Guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($directory)
 $zip=Join-Path $directory 'runtime.zip';$bytes=[Collections.Generic.List[byte]]::new()
 while ($bytes.Count -lt $script:Descriptor.size) {
  $reply=Test-Rpc @{op='download-package';offset=$bytes.Count;length=[Math]::Min(1048576,$script:Descriptor.size-$bytes.Count)}
  Check ($reply.Result.chunkSha256 -ceq [BuildWorker.Guard]::Hash($reply.Data));$bytes.AddRange($reply.Data)
 }
 [IO.File]::WriteAllBytes($zip,$bytes.ToArray());Check ([BuildWorker.Guard]::HashFile($zip) -ceq $script:Descriptor.sha256)
 $expanded=Join-Path $directory 'expanded';[IO.Compression.ZipFile]::ExtractToDirectory($zip,$expanded)
 $manifest=Get-Content (Join-Path $expanded 'deployment/package-manifest.json') -Raw|ConvertFrom-Json -AsHashtable
 foreach ($entry in $manifest.files) {Check ([BuildWorker.Guard]::HashFile((Join-Path $expanded $entry.path)) -ceq $entry.sha256)}
 $paths=@($manifest.files.path)+@('deployment/package-manifest.json','control/worker.json')
 $transaction=New-DTransaction $FixtureRoot $directory $paths
 foreach ($name in $paths) {
  if ($name -ceq 'control/worker.json') {Set-DFile $transaction $name $script:ClientConfigFile}
  else {Set-DFile $transaction $name (Join-Path $expanded $name)}
 }
 $transaction.status='committed';Save-DJournal $transaction
}
# Keep test-only client configuration out of production deployment inventory.
$script:ClientConfigFile=Join-Path ([IO.Path]::GetDirectoryName($FixtureRoot)) 'client.json'
function Invoke-SInstalledValidation($Root,$Run) {
 $suite=Expand-SValidationPayload $Run
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -NonInteractive -File (Join-Path $suite 'tests/windows/Run-Tests.ps1') -FixtureRoot (Join-Path $suite 'fixtures') -CodeRoot $Root | Out-Host
 Check ($LASTEXITCODE -eq 0)
 return @{passed=$true;fixtureRoot=(Join-Path $suite 'fixtures');windowsNativeVerified=$false}
}
function Invoke-SDummyVerification($Root) {
 # This script mocks only the build process, then runs the actual client cycle over real SSH.
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -NonInteractive -File (Join-Path $CodeRoot 'tests/windows/Integration.Tests.ps1') -FixtureRoot $Root -CodeRoot $Root -BrokerRoot $BrokerRoot -TransportFile $TransportFile -ConfigFile $script:ClientConfigFile -Behavior success | Out-Host
 Check ($LASTEXITCODE -eq 0)
 $history=@(Get-ChildItem (Join-Path $Root 'control/history') -File);Check ($history.Count -eq 1)
 $local=Get-Content $history[0].FullName -Raw|ConvertFrom-Json -AsHashtable
 $remote=(Test-Rpc @{op='status';jobId=$local.jobId}).Result
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Root 'deployment/Prepare-Windows.ps1'),[ref]$tokens,[ref]$errors)
 $f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-PDummyResult'},$true)
 . ([scriptblock]::Create($f.Extent.Text))
 Assert-PDummyResult $local $remote
 $log=[BuildWorker.Paths]::Inside($Root,([IO.Path]::GetDirectoryName($local.directory).Replace('\','/')+'/logs/build.log'))
 Check ($local.logReceipt.sha256 -ceq [BuildWorker.Guard]::HashFile($log))
 $report=@{dummyVerified=$true;remoteArtifactsVerified=$true;remoteLogVerified=$true;jobId=$local.jobId;remoteArtifactDirectory=$remote.result.directory;remoteLogDirectory=('results/'+$local.jobId+'/'+$local.attempt)}
 [BuildWorker.Paths]::AtomicText($Root,'control/deployment-report.json',($report|ConvertTo-Json -Compress))
}
$r=Invoke-SFlow $FixtureRoot $sid -ValidationRoot (Join-Path ([IO.Path]::GetDirectoryName($FixtureRoot)) 'BuildWorker-Validation') -Apply -Dummy
$r|ConvertTo-Json -Depth 12|Write-Host
Check ($r.ready);Check ($r.installationComplete);Check ($r.endToEndComplete)
Check (-not $r.legacyInspected);Check (-not $r.legacyModified)
Check (-not [IO.Path]::Exists((Join-Path $FixtureRoot 'tests')))
Check (-not [IO.Path]::Exists((Join-Path $FixtureRoot 'test-export')))
Write-Output 'ISOLATED setup=complete protocol=actual-loopback-SSH dummy=fixture-bytes artifacts-and-logs=verified Windows-native=unverified'
