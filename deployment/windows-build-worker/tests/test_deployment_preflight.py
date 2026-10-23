"""Whole-flow preflight tests. No Windows connection, no production queue, no real build."""
import base64
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_acl_migration import PRELUDE, MOCKS

ROOT=Path(__file__).resolve().parents[1]
PWSH=ROOT/'.tools/pwsh/pwsh'

# Native area/validation adapters only; flow, failure ordering and completion checks stay real.
SETUP_MOCKS=r'''
$script:ValidationRoot=Join-Path $PSScriptRoot 'validation'
function Get-SAreaPlan($Root,$Sid,$Role) {return @{root=$Root;role=$Role;create=$false;initializeMarker=$false}}
function Get-SProductionPreflight($Root,$Sid) {$r=Get-DPPreflight $Root $Sid -NativeLocks;$r['areaPlan']=Get-SAreaPlan $Root $Sid 'production';return $r}
function New-SPrivateArea {}
function New-SValidationRun($Root,$Sid) {return $Root}
function Invoke-SSshPreflight {return @{verified=$true}}
function Invoke-SInstalledValidation {return @{passed=$true}}
function Invoke-SDummyVerification {}
'''

class DeploymentPreflightTests(unittest.TestCase):
    def invoke(self,body,setup=False,mocks=True):
        with tempfile.TemporaryDirectory(prefix='deployment-preflight-') as directory:
            source=ROOT/'deployment'/('Setup-Windows.ps1' if setup else 'Migrate-WindowsAcl.ps1')
            script=Path(directory)/'case.ps1'
            script.write_text(PRELUDE+"\n. '"+str(source)+"'\n"+(MOCKS if mocks else '')+(SETUP_MOCKS if setup and mocks else '')+body)
            result=subprocess.run([str(PWSH),'-NoLogo','-NoProfile','-NonInteractive','-File',str(script)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=35)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_precise_diagnostics_for_root_parent_and_child_do_not_query_descendants(self):
        self.invoke(r'''
$script:Bad='';$script:Queries=@()
function Get-DPNode([string]$Path) {
 $script:Queries+=$Path
 return @{path=$Path;attributes=if ($Path -ceq $script:Bad) {'Directory, ReparsePoint'} else {'Directory'};attributesValue=if ($Path -ceq $script:Bad) {1040} else {16};kind='junction-or-volume-mount';reparseTag='0xA0000003';nameSurrogate=$true;tagQueryError=$null;targetRead=$false}
}
foreach ($bad in @($PSScriptRoot,$root,(Join-Path $root 'child'))) {
 $script:Bad=$bad;$script:Queries=@();$requested=Join-Path $root 'child/never-read'
 $caught=$null;try {Assert-DPPlainPath $requested 'test-stage'} catch {$caught=$_.Exception.Data['deploymentPath']}
 Check ($null -ne $caught);Check ($caught.rejectedPath -ceq $bad);Check ($caught.requestedPath -ceq $requested)
 Check ($caught.attributesValue -eq 1040);Check ($caught.reparseTag -ceq '0xA0000003');Check (-not $caught.targetRead)
 Check ($script:Queries[-1] -ceq $bad)
}
''')

    def test_nonredirecting_reparse_is_classified_but_never_whitelisted(self):
        self.invoke(r'''
Check ((Get-DPKind 0x80000017L) -ceq 'windows-overlay-filter')
Check ((Get-DPKind 0xA000000CL) -ceq 'symbolic-link')
Check ((Get-DPKind 0x9000001AL) -ceq 'cloud-placeholder')
Check ((Get-DPKind 0x12345678L) -ceq 'unknown-reparse-tag')
function Get-DPNode([string]$Path) {return @{path=$Path;attributes='ReparsePoint';attributesValue=1024;kind='windows-overlay-filter';reparseTag='0x80000017';nameSurrogate=$false;tagQueryError=$null;targetRead=$false}}
Reject {Assert-DPPlainPath $root 'wof-test'}
''')

    def test_hidden_system_and_compressed_attributes_are_not_confused_with_reparse(self):
        self.invoke(r'''
function Get-DPNode([string]$Path) {return @{path=$Path;attributes='Hidden, System, Directory, Compressed';attributesValue=2070;kind='ordinary';reparseTag=$null;nameSurrogate=$null;tagQueryError=$null;targetRead=$false}}
Assert-DPPlainPath $root 'ordinary-test'
''')

    def test_real_symlink_report_does_not_descend_or_change_any_file(self):
        self.invoke(r'''
Put 'ordinary.txt' 'keep'
[void][IO.Directory]::CreateSymbolicLink((Join-Path $root 'link'),$PSScriptRoot)
$r=Get-DPPreflight $root $sid -NativeLocks
Check (-not $r.ready);Check ($r.blockers.Count -ge 1)
$b=@($r.blockers|Where-Object {$_.code -ceq 'unsafe-path'})[0]
Check ($b.details.rejectedPath -ceq (Join-Path $root 'link'));Check (-not $b.details.targetRead)
Check ([IO.File]::ReadAllText((Join-Path $root 'ordinary.txt')) -ceq 'keep')
Check ($script:Changes.Count -eq 0);Check (-not [IO.Directory]::Exists((Join-Path $root '.acl-migration')))
''')

    def test_acl_owner_and_lock_failures_have_exact_stage_and_path(self):
        self.invoke(r'''
Put 'a' 'one';Put 'b' 'two';$path=Join-Path $root 'a';$view=Original;$view.owner='S-1-5-21-999';$script:Acl[$path]=$view
$r=Get-DPPreflight $root $sid -NativeLocks
Check (-not $r.ready)
$b=@($r.blockers|Where-Object {$_.path -ceq $path})[0];Check ($b.stage -ceq 'owner-and-ace-policy');Check ($b.details.owner -ceq 'S-1-5-21-999')
$script:Acl.Remove($path)
function New-MPin([string]$Path,[bool]$Directory) {throw 'Simulated sharing violation'}
$r=Get-DPPreflight $root $sid -NativeLocks;Check (-not $r.ready)
Check (@($r.blockers|Where-Object {$_.stage -ceq 'file-lock-and-write-dacl'}).Count -ge 1)
Check ($script:Changes.Count -eq 0)
''')

    def test_pending_backups_and_snapshot_corruption_are_reported_without_reset(self):
        self.invoke(r'''
Put 'control/packages/example/deployment-transaction.json' '{"status":"pending"}'
Put '.acl-migration/journal.json' '{"phase":"applying"}'
Put '.acl-migration/snapshot.json' '{"example":1}'
Put '.acl-migration/snapshot.sha256.json' '{"sha256":"bad"}'
$r=Get-DPPreflight $root $sid
Check (-not $r.ready);Check ($r.state.migration -ceq 'applying');Check ($r.state.snapshot -ceq 'checksum-mismatch')
Check ($r.state.deployment[0].status -ceq 'pending')
Check ([IO.File]::ReadAllText((Join-Path $root '.acl-migration/journal.json')) -ceq '{"phase":"applying"}')
''')

    def test_setup_diagnostics_and_blocked_install_do_not_run_probe_migration_bootstrap_or_agent(self):
        self.invoke(r'''
function Get-DPPreflight($Root,$Sid,[switch]$NativeLocks) {return @{ready=$false;readOnly=$true;needsAclMigration=$true;state=$null;blockers=[Collections.Generic.List[object]]::new()}}
function Invoke-SNativeProbe {throw 'must not be called'}
function Invoke-Migration {throw 'must not be called'}
function Test-SAgent {throw 'must not be called'}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply
Check (-not $r.installationComplete);Check (-not $r.changesStarted);Check (-not $r.endToEndComplete)
Check (@(Get-ChildItem -LiteralPath $root -Force).Count -eq 0)
''',setup=True)

    def test_native_probe_failure_prevents_all_existing_acl_and_install_changes(self):
        self.invoke(r'''
function Get-DPPreflight($Root,$Sid,[switch]$NativeLocks) {return @{ready=$true;readOnly=$true;needsAclMigration=$true;state=@{migration='absent'};blockers=[Collections.Generic.List[object]]::new()}}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
function Invoke-SNativeProbe {throw 'native probe failed'}
function Invoke-Migration {throw 'must not run'}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply
Check (-not $r.ready);Check ($r.stage -ceq 'windows-native-probe');Check ($r.nativeProbe -ceq 'failed');Check (-not $r.installationComplete)
Check ($script:Changes.Count -eq 0)
''',setup=True)

    def test_prepared_is_not_end_to_end_success_and_installer_requires_explicit_apply(self):
        self.invoke(r'''
function Get-DPPreflight($Root,$Sid,[switch]$NativeLocks) {return @{ready=$true;readOnly=$true;needsAclMigration=$true;state=@{migration='absent'};blockers=[Collections.Generic.List[object]]::new()}}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
$script:Probe=0;$script:Migrated=0;$script:Bootstrapped=0
function Invoke-SNativeProbe {$script:Probe++;return @{status='passed';path=$root}}
function Invoke-Migration {$script:Migrated++}
$script:SetupBootstrap=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('param([switch]$PrepareOnly,[switch]$VerifyDummy) $script:Bootstrapped++'))
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot
Check ($script:Probe -eq 0);Check ($script:Migrated -eq 0);Check ($script:Bootstrapped -eq 0);Check (-not $r.endToEndComplete)
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply
Check ($script:Probe -eq 1);Check ($script:Migrated -eq 0);Check ($script:Bootstrapped -eq 1)
Check ($r.installationComplete);Check (-not $r.endToEndComplete);Check ($r.stage -ceq 'prepared')
''',setup=True)

    def test_dummy_completion_requires_remote_artifact_and_log_evidence(self):
        self.invoke(r'''
function Get-DPPreflight($Root,$Sid,[switch]$NativeLocks) {return @{ready=$true;readOnly=$true;needsAclMigration=$false;state=@{migration='committed'};blockers=[Collections.Generic.List[object]]::new()}}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
function Invoke-SNativeProbe {return @{status='passed';path=$root}}
$script:SetupBootstrap=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('param([switch]$PrepareOnly,[switch]$VerifyDummy)'))
Put 'control/deployment-report.json' '{"dummyVerified":true,"remoteArtifactsVerified":false,"remoteLogVerified":false}'
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply -Dummy;Check (-not $r.endToEndComplete);Check (-not $r.ready)
Put 'control/deployment-report.json' '{"dummyVerified":true,"remoteArtifactsVerified":true,"remoteLogVerified":true,"jobId":"fixture-only","remoteArtifactDirectory":"fixture-artifacts","remoteLogDirectory":"fixture-logs"}'
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply -Dummy;Check ($r.endToEndComplete);Check ($r.jobId -ceq 'fixture-only')
''',setup=True)

    def test_agent_protocol_is_bounded_ignores_comments_and_matches_only_the_pinned_key(self):
        self.invoke(r'''
function BE([int]$n) {return ,[BitConverter]::GetBytes([Net.IPAddress]::HostToNetworkOrder($n))}
$key=[byte[]]@(1,2,3);$comment=[Text.Encoding]::UTF8.GetBytes('must not appear in output')
$body=[byte[]]@(@(12)+(BE 1)+(BE 3)+$key+(BE $comment.Length)+$comment)
Check (Test-SAgentReply $body $key);Check (-not (Test-SAgentReply $body ([byte[]]@(9,9,9))))
Reject {Test-SAgentReply ([byte[]]@(@(12)+(BE 999))) $key}
Reject {Test-SAgentReply ([byte[]]@($body+@(0))) $key}
Reject {Test-SAgentReply ([byte[]]@(@(12)+(BE 1)+(BE 100))) $key}
''',setup=True)

    def test_all_entry_points_embed_the_same_guard_and_native_metadata_code_compiles(self):
        helper=(ROOT/'deployment/Deployment-Preflight.ps1').read_text()
        for name in ('Migrate-WindowsAcl.ps1','Bootstrap-Windows.ps1','Prepare-Windows.ps1','Restore-Windows.ps1','Deployment-Transaction.ps1'):
            self.assertIn(helper,(ROOT/'deployment'/name).read_text(),name)
        self.invoke('Initialize-DPNative\nCheck ($null -ne ("BuildWorkerDeploymentDiagnostics.Metadata" -as [type]))',mocks=False)
        setup=(ROOT/'deployment/Setup-Windows.ps1').read_text()
        for marker in ('__MIGRATION_LIBRARY__','__BOOTSTRAP_SCRIPT__','__PUBLIC_KEY__'):
            self.assertNotIn(marker,setup)

    def test_pending_migration_baseline_differences_are_blocking_but_committed_history_is_informational(self):
        self.invoke(r'''
Put 'old.txt' 'original';Invoke-Migration $root $sid | Out-Null
Put 'new.txt' 'preserve added file'
$r=Get-DPPreflight $root $sid
Check ($r.ready);Check (-not $r.state.restoreBaselineMatches)
Check (@($r.state.changedFiles|Where-Object {$_.name -ceq 'new.txt' -and $_.reason -ceq 'added'}).Count -eq 1)
$j=Join-Path $root '.acl-migration/journal.json';$v=Read-MJson $j;$v.phase='applying';Write-MJson $j $v
$r=Get-DPPreflight $root $sid
Check (-not $r.ready);Check (@($r.blockers|Where-Object {$_.code -ceq 'migration-recovery-baseline-not-verified'}).Count -eq 1)
Check ([IO.File]::ReadAllText((Join-Path $root 'new.txt')) -ceq 'preserve added file')
''')

    def test_failed_ssh_read_only_preflight_stops_before_existing_acl_migration_or_bootstrap(self):
        self.invoke(r'''
function Get-DPPreflight($Root,$Sid,[switch]$NativeLocks) {return @{ready=$true;readOnly=$true;needsAclMigration=$true;state=@{migration='absent'};blockers=[Collections.Generic.List[object]]::new()}}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
function Invoke-SNativeProbe {return @{status='passed';path=$root}}
function Invoke-SSshPreflight {throw 'simulated authentication failure'}
function Invoke-Migration {throw 'must not run'}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:ValidationRoot -Apply
Check (-not $r.ready);Check ($r.stage -ceq 'ssh-read-only-preflight');Check (-not $r.installationComplete)
Check ($script:Changes.Count -eq 0)
''',setup=True)

    def test_vps_completion_validator_rejects_wrong_job_revision_artifact_hash_directory_and_receipt(self):
        self.invoke(r'''
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__PREPARE__',[ref]$tokens,[ref]$errors)
$f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-PDummyResult'},$true)
. ([scriptblock]::Create($f.Extent.Text))
$id='11111111-1111-4111-8111-111111111111'
$local=@{jobId=$id;attempt=1;profileId='smoke';revision=('a'*64);manifest=@(@{path='dist/smoke.txt';size=4;sha256=('b'*64)});logReceipt=@{jobId=$id;attempt=1;sealed=$true}}
$remote=@{id=$id;state='succeeded';project='worker-smoke';profile='smoke';revision=('a'*64);attempt=1;result=@{directory=('artifacts/worker-smoke/smoke/'+$id+'/1');artifacts=@(@{path='dist/smoke.txt';size=4;sha256=('b'*64)})}}
Assert-PDummyResult $local $remote
$remote.id='different';Reject {Assert-PDummyResult $local $remote};$remote.id=$id
$remote.revision=('c'*64);Reject {Assert-PDummyResult $local $remote};$remote.revision=('a'*64)
$remote.result.artifacts[0].sha256=('c'*64);Reject {Assert-PDummyResult $local $remote};$remote.result.artifacts[0].sha256=('b'*64)
$remote.result.directory='unexpected';Reject {Assert-PDummyResult $local $remote};$remote.result.directory='artifacts/worker-smoke/smoke/'+$id+'/1'
$local.logReceipt.sealed=$false;Reject {Assert-PDummyResult $local $remote}
'''.replace('__PREPARE__',str(ROOT/'deployment/Prepare-Windows.ps1')))

    def test_ssh_failure_classification_is_bounded_and_does_not_print_remote_text(self):
        self.invoke(r'''
Initialize-DPNative
foreach ($pair in @(@('Permission denied (publickey). secret-value','dedicated-key-authentication-refused'),@('Host key verification failed.','host-key-pinning-failed'),@('Connection refused','ssh-network-unavailable'))) {
 $stream=[IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($pair[0]))
 try {$kind=[BuildWorkerDeploymentDiagnostics.Metadata]::ReadSshCategory($stream).GetAwaiter().GetResult();Check ($kind -ceq $pair[1]);Check (-not $kind.Contains('secret-value'))} finally {$stream.Dispose()}
}
$stream=[IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes(('x'*2000000)))
try {$kind=[BuildWorkerDeploymentDiagnostics.Metadata]::ReadSshCategory($stream).GetAwaiter().GetResult();Check ($kind -ceq 'ssh-framing-or-remote-exit')} finally {$stream.Dispose()}
''',mocks=False)

    def test_sharing_error_codes_are_preserved_without_untrusted_error_text(self):
        self.invoke(r'''
function New-MPin([string]$Path,[bool]$Directory) {
 $e=[InvalidOperationException]::new('not printed')
 $e.Data['pinFailure']=@{path=$Path;classification='sharing-violation';nativeErrorCode=32;aclChanged=$false}
 throw $e
}
$r=Get-DPPreflight $root $sid -NativeLocks
Check (-not $r.ready)
$b=@($r.blockers|Where-Object {$_.stage -ceq 'file-lock-and-write-dacl'})[0]
Check ($b.details.nativeErrorCode -eq 32);Check ($b.details.classification -ceq 'sharing-violation');Check (-not $b.details.aclChanged)
''')

    def test_trusted_entry_is_outside_the_target_tree_and_does_not_overwrite_migration_baseline(self):
        source=(ROOT/'deployment/Setup-Windows.template.ps1').read_text()
        self.assertIn(r"$PSCommandPath) -ine 'C:\BuildWorker-Setup.ps1'",source)
        self.assertIn("Assert-DPPlainPath $PSCommandPath 'trusted-setup-entry'",source)
        self.assertNotIn("WriteAllText($PSCommandPath",source)

    def test_atomic_replace_probe_restores_its_own_fixture_and_leaves_other_files_unchanged(self):
        self.invoke(r'''
Put 'probe.txt' 'owned preflight fixture v1';Put 'unrelated.txt' 'untouched'
$p=Join-Path $root 'probe.txt';$sha=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
Test-SAtomicReplace $p
Check ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ceq $sha)
Check ([IO.File]::ReadAllText((Join-Path $root 'unrelated.txt')) -ceq 'untouched')
Check (-not [IO.File]::Exists($p+'.owned-replacement'))
''',setup=True)
