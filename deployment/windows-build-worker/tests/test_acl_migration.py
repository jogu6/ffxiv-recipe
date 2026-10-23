"""Real temp files/journals; only Windows ACL and native handle APIs are mocked on Ubuntu."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PWSH=ROOT/'.tools/pwsh/pwsh'
PRELUDE=r'''
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Check($ok) {if (-not $ok) {throw 'Migration test assertion failed'}}
function Reject([scriptblock]$action) {$yes=$false;try {& $action | Out-Null} catch {$yes=$true};Check $yes}
$root=Join-Path $PSScriptRoot 'worker';[void][IO.Directory]::CreateDirectory($root)
$sid='S-1-5-21-100-200-300-1001'
function Rule($who) {return @{common=$true;callback=$false;type='AccessAllowed';sid=$who;flags=16;mask=0x1f01ff}}
function Original {return @{owner='S-1-5-32-544';group='S-1-5-32-544';access='ORIGINAL';descriptor='OG-ORIGINAL';rules=@((Rule $sid),(Rule 'S-1-5-32-545'),(Rule 'S-1-5-11'));protected=$false}}
function Private {return @{owner='S-1-5-32-544';group='S-1-5-32-544';access='PRIVATE';descriptor='OG-PRIVATE';rules=@((Rule $sid),(Rule 'S-1-5-32-544'),(Rule 'S-1-5-18'));protected=$true}}
function Put($name,$text) {$path=Join-Path $root $name;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path));[IO.File]::WriteAllText($path,$text)}
'''
MOCKS=r'''
$script:Acl=@{};$script:Changes=@();$script:FailOn='';$script:FailRestore=$false;$script:PinsCreated=0;$script:PinsDisposed=0
function Initialize-MNative {}
function New-MPin([string]$Path,[bool]$Directory) {
    $script:PinsCreated++
    $o=[pscustomobject]@{Identity=$Path}
    $o | Add-Member -MemberType ScriptMethod -Name Dispose -Value {$script:PinsDisposed++}
    return $o
}
function Read-MAcl([string]$Path) {if ($script:Acl.ContainsKey($Path)) {return $script:Acl[$Path]};if ($Path.Contains('.acl-migration')) {$a=Private;$a.protected=[IO.Directory]::Exists($Path);return $a};return (Original)}
function Read-MSavedAcl([string]$Sddl) {if ($Sddl -ceq 'OG-ORIGINAL') {return (Original)};if ($Sddl -ceq 'OG-PRIVATE') {return (Private)};throw 'Unknown original descriptor'}
function Set-MPrivateAcl([string]$Path,[bool]$Directory,[string]$UserSid) {
    $script:Changes+=$Path
    if ($script:FailOn -and $Path.EndsWith($script:FailOn)) {$script:FailOn='';throw 'Injected ACL failure'}
    $script:Acl[$Path]=Private
}
function Set-MOriginalAcl([string]$Path,[string]$Sddl) {
    if ($script:FailRestore) {throw 'Injected restore failure'}
    $view=Read-MAcl $Path;$view=(Read-MSavedAcl ('OG-'+$Sddl))
    $script:Acl[$Path]=$view
}
function New-MMetadata([string]$Path,[string]$UserSid) {[void][IO.Directory]::CreateDirectory($Path)}
'''

class AclMigrationTests(unittest.TestCase):
    def invoke(self, body, mocks=True):
        with tempfile.TemporaryDirectory(prefix='acl-migration-') as directory:
            script=Path(directory)/'case.ps1'
            script.write_text(PRELUDE+"\n. '"+str(ROOT/'deployment/Migrate-WindowsAcl.ps1')+"'\n"+(MOCKS if mocks else '')+body)
            result=subprocess.run([str(PWSH),'-NoLogo','-NoProfile','-NonInteractive','-File',str(script)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=25)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_allowed_owner_and_aces_and_all_unknown_variants_refused(self):
        self.invoke(r'''
Assert-MAcl (Original) $sid
foreach ($owner in @($sid,'S-1-5-32-544','S-1-5-18')) {$a=Original;$a.owner=$owner;Assert-MAcl $a $sid}
$a=Original;$a.owner='S-1-5-21-999';Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].sid='S-1-1-0';Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].type='AccessDenied';Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].callback=$true;Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].common=$false;Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].flags=64;Reject {Assert-MAcl $a $sid}
$a=Original;$a.rules[0].mask=0x1000000;Reject {Assert-MAcl $a $sid}
Reject {Assert-MAcl (Original) $sid -Private}
Assert-MAcl (Private) $sid -Private
''')

    def test_installed_files_settings_fixtures_and_owners_preserved(self):
        self.invoke(r'''
Put 'windows/Worker.ps1' '# keep code';Put 'control/worker.json' '{"enabled":false}';Put 'control/state.json' '{"phase":"idle"}'
Put 'tests/fixture.tar' 'keep fixture';Put 'data/latest.exe' 'keep success'
Invoke-Migration $root $sid | Out-Null
$j=Read-MJson (Join-Path $root '.acl-migration/journal.json');Check ($j.phase -ceq 'committed')
$s=Read-MJson (Join-Path $root '.acl-migration/snapshot.json');Check ($s.items.Count -ge 9)
foreach ($e in $s.items) {Check ($e.owner -ceq 'S-1-5-32-544');Check ($e.descriptor -ceq 'OG-ORIGINAL');Assert-MAcl (Read-MAcl (Assert-MPath $root $e.name)) $sid -Private}
Check ([IO.File]::ReadAllText((Join-Path $root 'data/latest.exe')) -ceq 'keep success')
Check ([IO.File]::ReadAllText((Join-Path $root 'tests/fixture.tar')) -ceq 'keep fixture')
Check ($script:PinsCreated -eq $script:PinsDisposed)
$changeCountBefore=$script:Changes.Count;Invoke-Migration $root $sid | Out-Null;Check ($script:Changes.Count -eq $changeCountBefore)
Invoke-Migration $root $sid -Restore | Out-Null
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'rolled-back')
foreach ($e in $s.items) {Check ((Read-MAcl (Assert-MPath $root $e.name)).access -ceq 'ORIGINAL')}
''')

    def test_unknown_owner_ace_or_link_stops_before_any_existing_acl_change(self):
        self.invoke(r'''
Put 'windows/x' 'keep';$path=Join-Path $root 'windows/x';$a=Original;$a.owner='S-1-5-21-999';$script:Acl[$path]=$a
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
$script:Acl.Remove($path);$a=Original;$a.rules[0].sid='S-1-1-0';$script:Acl[$path]=$a
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
$script:Acl.Remove($path)
[void][IO.Directory]::CreateSymbolicLink((Join-Path $root 'outside-link'),$PSScriptRoot)
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
''')

    def test_partial_failure_restores_and_same_command_retries(self):
        self.invoke(r'''
Put 'windows/a' 'one';Put 'windows/b' 'two';$script:FailOn='a'
Reject {Invoke-Migration $root $sid}
$s=Read-MJson (Join-Path $root '.acl-migration/snapshot.json')
foreach ($e in $s.items) {Check ((Read-MAcl (Assert-MPath $root $e.name)).access -ceq 'ORIGINAL')}
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'rolled-back')
Invoke-Migration $root $sid | Out-Null
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'committed')
''')

    def test_restore_failure_and_interrupted_apply_are_recovered_on_rerun(self):
        self.invoke(r'''
Put 'windows/a' 'one';Put 'windows/b' 'two';$script:FailOn='a';$script:FailRestore=$true
Reject {Invoke-Migration $root $sid}
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'rollback-failed')
$script:FailRestore=$false;Invoke-Migration $root $sid | Out-Null
$path=Join-Path $root '.acl-migration/journal.json';$j=Read-MJson $path;$j.phase='applying';Write-MJson $path $j
Invoke-Migration $root $sid | Out-Null
Check ((Read-MJson $path).phase -ceq 'committed')
Check ($script:PinsCreated -eq $script:PinsDisposed)
''')

    def test_file_changes_or_missing_extra_entries_prevent_recovery(self):
        self.invoke(r'''
Put 'windows/a' 'one';Invoke-Migration $root $sid | Out-Null
$before=$script:Changes.Count;Put 'windows/a' 'edited'
Reject {Invoke-Migration $root $sid -Restore};Check ($script:Changes.Count -eq $before)
Check ([IO.File]::ReadAllText((Join-Path $root 'windows/a')) -ceq 'edited')
Put 'windows/a' 'one';Put 'extra.txt' 'keep'
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq $before)
''')

    def test_corrupted_snapshot_and_forged_paths_or_saved_acl_are_refused(self):
        self.invoke(r'''
Put 'windows/a' 'one';Invoke-Migration $root $sid | Out-Null
$p=Join-Path $root '.acl-migration/snapshot.json';$sha=Join-Path $root '.acl-migration/snapshot.sha256.json'
$s=Read-MJson $p;$s.items[0].name='../escape';Write-MJson $p $s
Reject {Invoke-Migration $root $sid}
Write-MJson $sha @{sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}
Reject {Invoke-Migration $root $sid}
$s.items[0].name='';$s.items[0].descriptor='UNKNOWN';Write-MJson $p $s
Write-MJson $sha @{sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}
Reject {Invoke-Migration $root $sid -Restore}
''')

    def test_active_worker_and_foreign_key_project_paths_are_refused(self):
        self.invoke(r'''
Put 'control/worker.json' '{"enabled":true}';Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
Put 'control/worker.json' '{"enabled":false}';Put 'control/state.json' '{"phase":"building"}'
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
foreach ($name in @('../x','C:/x','x\\y','D:/x','.ssh/key','gcal-ci/config','ffxiv-recipe/file','keys/id_ed25519','private.pem')) {Reject {Assert-MPath $root $name}}
''')

    def test_hard_links_and_metadata_links_refused(self):
        self.invoke(r'''
Put 'windows/a' 'one';[void](New-Item -ItemType HardLink -Path (Join-Path $root 'hard') -Target (Join-Path $root 'windows/a'))
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
''')

    def test_native_helper_compiles_and_entry_point_has_fixed_root_and_no_external_actions(self):
        self.invoke('Initialize-MNative\nCheck ($null -ne ("BuildWorkerAclMigration.Pin" -as [type]))',mocks=False)
        text=(ROOT/'deployment/Migrate-WindowsAcl.ps1').read_text()
        for forbidden in ('Start-Process','Start-WWorker','ssh.exe','Register-ScheduledTask','Enable-ScheduledTask','Remove-Item','SetOwner','takeown','icacls'):
            self.assertNotIn(forbidden,text)
        self.assertIn("$root='C:\\BuildWorker-Production'",text)
        self.assertIn('Global\\BuildWorker-C-BuildWorker-v1',text)
        self.assertIn('0x02200000',text)

    def test_interrupted_backup_without_checksum_or_journal_can_resume_only_if_original_acl_matches(self):
        self.invoke(r'''
Put 'windows/a' 'one';Invoke-Migration $root $sid | Out-Null
Invoke-Migration $root $sid -Restore | Out-Null
[IO.File]::Delete((Join-Path $root '.acl-migration/journal.json'))
[IO.File]::Delete((Join-Path $root '.acl-migration/snapshot.sha256.json'))
Invoke-Migration $root $sid | Out-Null
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'committed')
''')

    def test_metadata_junction_and_unknown_files_refused(self):
        self.invoke(r'''
[void][IO.Directory]::CreateDirectory((Join-Path $root '.acl-migration'))
[void][IO.Directory]::CreateSymbolicLink((Join-Path $root '.acl-migration/compiler-temp'),$PSScriptRoot)
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
''')

    def test_private_metadata_files_can_inherit_from_protected_metadata_directory(self):
        self.invoke(r'''
$a=Private;$a.protected=$false;Assert-MAcl $a $sid -Private
Reject {Assert-MAcl $a $sid -Private -RequireProtected}
$a=Private;$a.rules=@((Rule $sid));Reject {Assert-MAcl $a $sid -Private -RequireProtected}
Put 'x' 'one';Invoke-Migration $root $sid | Out-Null
Invoke-Migration $root $sid | Out-Null
Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'committed')
''')

    def test_pending_migration_blocks_bootstrap_without_weakening_acl_checks(self):
        self.invoke(r'''
. '__BOOTSTRAP_ACL__'
[void][IO.Directory]::CreateDirectory((Join-Path $root '.acl-migration'))
$p=Join-Path $root '.acl-migration/journal.json'
Write-MJson $p @{version=1;root=$root;phase='applying'}
Reject {Assert-BNoPendingAcl $root}
Write-MJson $p @{version=1;root=$root;phase='committed'}
Assert-BNoPendingAcl $root
'''.replace('__BOOTSTRAP_ACL__',str(ROOT/'deployment/Bootstrap-Acl.ps1')))

    def test_nested_metadata_links_and_unknown_owners_are_not_exempted(self):
        self.invoke(r'''
$base=Join-Path $root '.acl-migration/compiler-temp/nested';[void][IO.Directory]::CreateDirectory($base)
$p=Join-Path $base 'cache';[IO.File]::WriteAllText($p,'compiler fixture')
$a=Private;$a.owner='S-1-5-21-999';$script:Acl[$p]=$a
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
$script:Acl.Remove($p)
[void][IO.Directory]::CreateSymbolicLink((Join-Path $base 'outside'),$PSScriptRoot)
Reject {Invoke-Migration $root $sid};Check ($script:Changes.Count -eq 0)
''')
