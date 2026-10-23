"""Production/fixture separation, with real temp paths and native-only ACL substitutes.
No Windows connection, real queue or real project build is performed.
"""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from test_acl_migration import PRELUDE, MOCKS

ROOT=Path(__file__).resolve().parents[1]
PWSH=ROOT/'.tools/pwsh/pwsh'

class ProductionIsolationTests(unittest.TestCase):
    def invoke(self,body):
        with tempfile.TemporaryDirectory(prefix='production-isolation-') as directory:
            script=Path(directory)/'case.ps1'
            script.write_text(PRELUDE+"\n. '"+str(ROOT/'deployment/Setup-Windows.ps1')+"'\n"+MOCKS+r'''
# Only ACL/Win32 handle operations are substituted; real path checks, file hashes and flow remain.
$script:Legacy=Join-Path $PSScriptRoot 'BuildWorker'
$script:Validation=Join-Path $PSScriptRoot 'BuildWorker-Validation'
function Read-MAcl([string]$Path) {
 if ($Path.StartsWith($script:Legacy+[IO.Path]::DirectorySeparatorChar) -or $Path -ceq $script:Legacy) {throw 'Forbidden legacy ACL read'}
 return (Private)
}
function Assert-SPrerequisites {}
function Test-SAgent {return 'dedicated-key-listed'}
function Initialize-DPNative {}
''' +body)
            result=subprocess.run([str(PWSH),'-NoLogo','-NoProfile','-NonInteractive','-File',str(script)],capture_output=True,text=True,timeout=50)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_runtime_archive_contains_no_tests_fixtures_or_embedded_setup(self):
        from tools.prepare_windows_bundle import PACKAGE_PATHS
        self.assertTrue(all(not p.startswith(('tests/','test-export/')) for p in PACKAGE_PATHS))
        with zipfile.ZipFile(ROOT/'dist/build-worker-windows.zip') as z:
            self.assertNotIn('deployment/Setup-Windows.ps1',z.namelist())
            self.assertFalse(any(p.startswith(('tests/','test-export/')) for p in z.namelist()))
        for name in ('Bootstrap-Windows.template.ps1','Deployment-Transaction.ps1'):
            s=(ROOT/'deployment'/name).read_text()
            self.assertNotIn('test-export/windows-fixtures/',s)
            self.assertNotIn('tests/windows/',s)

    def test_validation_payload_is_separate_hash_checked_and_matches_exported_fixtures(self):
        from tools.prepare_windows_bundle import validation_payload,VALIDATION_PATHS
        data=validation_payload(ROOT);v=json.loads(data)
        self.assertEqual(len(v['files']),19)
        self.assertEqual(len(VALIDATION_PATHS),19)
        for f in v['files']:
            decoded=base64.b64decode(f['data'],validate=True)
            source=ROOT/('test-export/windows-fixtures/'+Path(f['path']).name if f['path'].startswith('fixtures/') else f['path'])
            self.assertEqual(decoded,source.read_bytes())
            self.assertEqual(hashlib.sha256(decoded).hexdigest(),f['sha256'])
        self.invoke(r'''
$suite=Expand-SValidationPayload $script:Validation
Check ([IO.File]::Exists((Join-Path $suite 'fixtures/fixtures.json')))
Check (-not [IO.Path]::Exists((Join-Path $root 'tests')))
Check (-not [IO.Path]::Exists((Join-Path $root 'test-export')))
Reject {Expand-SValidationPayload $script:Validation}
''')

    def test_corrupt_or_traversing_validation_payload_writes_nothing(self):
        self.invoke(r'''
$script:SetupValidationSha256='0'*64
Reject {Expand-SValidationPayload $script:Validation}
Check (-not [IO.Path]::Exists($script:Validation))
$p=@{schemaVersion=1;files=@()};foreach ($i in 1..19) {$p.files+=@{path='../outside';sha256=('0'*64);data='YQ=='}}
$raw=[Text.Encoding]::UTF8.GetBytes(($p|ConvertTo-Json -Depth 10 -Compress))
$script:SetupValidationPayload=[Convert]::ToBase64String($raw)
$script:SetupValidationSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($raw)).ToLowerInvariant()
Reject {Expand-SValidationPayload $script:Validation}
Check (-not [IO.Path]::Exists($script:Validation))
''')

    def test_observed_legacy_junction_is_not_read_followed_or_changed_by_production_setup(self):
        self.invoke(r'''
[void][IO.Directory]::CreateDirectory((Join-Path $script:Legacy 'test-fixtures'))
$outside=Join-Path $PSScriptRoot 'unrelated-volume';[void][IO.Directory]::CreateDirectory($outside)
$sentinel=Join-Path $outside 'preserve.txt';[IO.File]::WriteAllText($sentinel,'untouched')
$junction=Join-Path $script:Legacy 'test-fixtures/link';[void][IO.Directory]::CreateSymbolicLink($junction,$outside)
$legacyConfig=Join-Path $script:Legacy 'worker.json';[IO.File]::WriteAllText($legacyConfig,'keep settings and backups')
$before=(Get-FileHash $legacyConfig).Hash
# Query any old node/target => fail. The rejected-path diagnostic is modeled below separately.
$original=${function:Get-DPNode}
function Get-DPNode([string]$Path) {
 if ($Path -ceq $script:Legacy -or $Path.StartsWith($script:Legacy+[IO.Path]::DirectorySeparatorChar) -or $Path.StartsWith($outside)) {throw 'Forbidden legacy/target access'}
 & $original $Path
}
function Invoke-SNativeProbe($Root,$Sid) {return @{path=$Root;legacyJunctionRejection='passed'}}
function Invoke-SSshPreflight {return @{verified=$true}}
function New-SPrivateArea($Plan,$Sid) {
 [void][IO.Directory]::CreateDirectory($Plan.root)
 if ($Plan.initializeMarker) {[IO.File]::WriteAllText((Join-Path $Plan.root '.build-worker-area.json'),(@{schemaVersion=1;role=$Plan.role;layout='separate-production-validation-v1'}|ConvertTo-Json -Compress))}
}
function Invoke-SBootstrap {Put 'windows/Worker.ps1' 'new production code';Put 'control/worker.json' '{"enabled":false}'}
function Invoke-SInstalledValidation($Root,$Run) {$suite=Expand-SValidationPayload $Run;return @{passed=$true;fixtureRoot=(Join-Path $suite 'fixtures')}}
function Invoke-SDummyVerification {
 Put 'control/deployment-report.json' '{"dummyVerified":true,"remoteArtifactsVerified":true,"remoteLogVerified":true,"jobId":"isolated-evidence","remoteArtifactDirectory":"fixture-artifacts","remoteLogDirectory":"fixture-logs"}'
}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:Validation -Apply -Dummy
Check ($r.ready);Check ($r.installationComplete);Check ($r.endToEndComplete);Check (-not $r.readOnly)
Check (-not $r.legacyInspected);Check (-not $r.legacyModified)
Check ((Get-FileHash $legacyConfig).Hash -ceq $before);Check ([IO.Directory]::Exists($junction))
Check ([IO.File]::ReadAllText($sentinel) -ceq 'untouched');Check ($script:Changes.Count -eq 0)
Check ($r.installedValidation.fixtureRoot.StartsWith($script:Validation))
Check (-not [IO.Path]::Exists((Join-Path $root 'tests')));Check (-not [IO.Path]::Exists((Join-Path $root 'test-fixtures')))
''')

    def test_observed_windows_tag_in_production_is_still_a_blocker_without_changes(self):
        self.invoke(r'''
New-SPrivateArea (Get-SAreaPlan $root $sid 'production') $sid
Put 'test-fixtures/ordinary.txt' 'test content must not bypass production policy'
$bad=Join-Path $root 'test-fixtures/link';[void][IO.Directory]::CreateDirectory($bad)
$original=${function:Get-DPNode}
function Get-DPNode([string]$Path) {
 if ($Path -ceq $bad) {return @{path=$Path;attributes='Directory, ReparsePoint';attributesValue=1040;kind='junction-or-volume-mount';reparseTag='0xA0000003';nameSurrogate=$true;tagQueryError=$null;targetRead=$false}}
 & $original $Path
}
function New-SValidationRun {throw 'must not run'}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:Validation -Apply -Dummy
Check (-not $r.ready);Check (-not $r.changesStarted);Check (-not $r.installationComplete)
$b=@($r.blockers|Where-Object {$_.code -ceq 'unsafe-path'})[0]
Check ($b.details.rejectedPath -ceq $bad);Check ($b.details.reparseTag -ceq '0xA0000003')
Check ($script:Changes.Count -eq 0)
''')

    def test_existing_unknown_area_and_broad_acl_are_never_adopted_or_migrated(self):
        self.invoke(r'''
Put 'keep.txt' 'unknown existing content'
Reject {Get-SAreaPlan $root $sid 'production'}
Check ([IO.File]::ReadAllText((Join-Path $root 'keep.txt')) -ceq 'unknown existing content')
function Read-MAcl {return (Original)}
Reject {Get-SAreaPlan $root $sid 'production'}
Check ($script:Changes.Count -eq 0)
''')

    def test_missing_roots_plan_read_only_and_production_initialization_is_after_ssh(self):
        self.invoke(r'''
$production=Join-Path $PSScriptRoot 'new-production'
$p=Get-SAreaPlan $production $sid 'production';Check ($p.create);Check (-not [IO.Path]::Exists($production))
function New-SPrivateArea($Plan,$Sid) {
 if ($Plan.role -ceq 'production') {throw 'Production must remain absent after authentication failure'}
 [void][IO.Directory]::CreateDirectory($Plan.root)
}
function New-SValidationRun($Root,$Sid) {return $Root}
function Invoke-SNativeProbe($Root,$Sid) {return @{path=$Root}}
function Invoke-SSshPreflight {throw 'auth failure'}
$r=Invoke-SFlow $production $sid -ValidationRoot $script:Validation -Apply
Check (-not $r.ready);Check ($r.stage -ceq 'ssh-read-only-preflight')
Check (-not [IO.Path]::Exists($production));Check (-not $r.endToEndComplete)
''')

    def test_validation_root_link_and_overlapping_roots_are_rejected_without_writes(self):
        self.invoke(r'''
[void][IO.Directory]::CreateSymbolicLink($script:Validation,$root)
$r=Invoke-SFlow $root $sid -ValidationRoot $script:Validation -Apply
Check (-not $r.ready);Check (-not $r.changesStarted);Check ($r.blockers[0].details.rejectedPath -ceq $script:Validation)
$r=Invoke-SFlow $root $sid -ValidationRoot (Join-Path $root 'fixtures') -Apply
Check (-not $r.ready);Check (-not $r.changesStarted)
Check ($script:Changes.Count -eq 0)
''')

    def test_prior_validation_runs_are_retained_without_following_fixture_links_and_capped(self):
        self.invoke(r'''
[void][IO.Directory]::CreateDirectory($script:Validation)
foreach ($i in 1..16) {
 $path=Join-Path $script:Validation ('run-'+$i.ToString('x32'))
 [void][IO.Directory]::CreateDirectory($path)
 [void][IO.Directory]::CreateSymbolicLink((Join-Path $path 'link'),$root)
}
Reject {New-SValidationRun $script:Validation $sid}
Check (@(Get-ChildItem $script:Validation).Count -eq 16);Check ($script:Changes.Count -eq 0)
''')

    def test_runtime_native_test_failure_cannot_claim_a_dummy_job(self):
        self.invoke(r'''
function New-SPrivateArea($Plan,$Sid) {[void][IO.Directory]::CreateDirectory($Plan.root)}
function New-SValidationRun($Root,$Sid) {return $Root}
function Invoke-SNativeProbe($Root,$Sid) {return @{path=$Root}}
function Invoke-SSshPreflight {return @{verified=$true}}
function Invoke-SBootstrap {}
function Invoke-SInstalledValidation {throw 'simulated native failure'}
function Invoke-SDummyVerification {throw 'must not claim a job'}
$r=Invoke-SFlow $root $sid -ValidationRoot $script:Validation -Apply -Dummy
Check (-not $r.ready);Check ($r.stage -ceq 'isolated-installed-validation')
Check (-not $r.installationComplete);Check (-not $r.endToEndComplete)
''')

    def test_fixed_runtime_paths_and_shared_legacy_exclusion_lock(self):
        for name in ('windows/Worker.ps1','windows/Worker.psm1','windows/Start-Worker.cmd','deployment/Prepare-Windows.ps1','deployment/Restore-Windows.ps1','deployment/Bootstrap-Windows.ps1','deployment/BuildWorker.task.xml'):
            s=(ROOT/name).read_text()
            self.assertIn(r'C:\BuildWorker-Production',s,name)
            self.assertNotIn('C:\\BuildWorker\\',s,name)
        s=(ROOT/'deployment/Setup-Windows.template.ps1').read_text()
        self.assertIn("$root='C:\\BuildWorker-Production'",s)
        self.assertIn('Global\\BuildWorker-C-BuildWorker-v1',s)
        self.assertNotIn('Invoke-Migration $Root $Sid',s)
        self.assertIn('legacyJunctionRejection',s)
        self.assertIn('CreateDirectoryW(path,ref attr)',(ROOT/'deployment/Deployment-Preflight.ps1').read_text())

if __name__=='__main__':unittest.main()
