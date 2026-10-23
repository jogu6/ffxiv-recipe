"""ACL policy and offline initialization tested with mocked Windows ACL APIs and real temp files."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PWSH=ROOT/'.tools/pwsh/pwsh'
PRELUDE=r'''
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Check($condition) { if (-not $condition) { throw 'ACL test assertion failed' } }
function Reject([scriptblock]$action) { $rejected=$false; try { & $action | Out-Null } catch { $rejected=$true }; Check $rejected }
$sid='S-1-5-21-100-200-300-1001'
$root=Join-Path $PSScriptRoot 'worker'
[void][IO.Directory]::CreateDirectory($root)
function Broad { @{owner=$sid;rules=@(@{sid='S-1-5-32-545';type='Allow';inherited=$true;rights='ReadAndExecute'})} }
function Private { @{owner=$sid;rules=@(@{sid=$sid;type='Allow';inherited=$false;rights='FullControl'})} }
'''
MOCKS=r'''
# Mock only Windows ACL access; enumeration, hashes, journaling and layout guards are real.
$script:AclMap=@{}
$script:Writes=@()
$script:FailPath=''
function Mock-Sddl($path) {
    if ($script:AclMap.ContainsKey($path)) { return $script:AclMap[$path] }
    $parent=[IO.Path]::GetDirectoryName($path)
    if ($parent -and $script:AclMap.ContainsKey($parent) -and $script:AclMap[$parent] -ceq 'PRIVATE') { return 'PRIVATE' }
    return ('ORIGINAL:'+[IO.Path]::GetFileName($path))
}
function Get-BAclView([string]$Path) { if ((Mock-Sddl $Path) -ceq 'PRIVATE') { return (Private) }; return (Broad) }
function New-BPrivateAcl([bool]$Directory,[string]$OwnerSid,[string]$CurrentSid) { return [pscustomobject]@{Sddl='PRIVATE'} }
function Get-Acl([string]$LiteralPath) {
    $acl=[pscustomobject]@{Sddl=(Mock-Sddl $LiteralPath)}
    $acl | Add-Member -MemberType ScriptMethod -Name GetSecurityDescriptorSddlForm -Value { param($sections) return $this.Sddl }
    $acl | Add-Member -MemberType ScriptMethod -Name SetSecurityDescriptorSddlForm -Value { param($text,$sections) $this.Sddl=$text }
    return $acl
}
function Set-Acl([string]$LiteralPath,$AclObject) {
    $script:Writes+=@{path=$LiteralPath;sddl=$AclObject.Sddl}
    if ($LiteralPath -ceq $script:FailPath) { $script:FailPath=''; throw 'Injected ACL write failure' }
    $script:AclMap[$LiteralPath]=$AclObject.Sddl
}
'''

class BootstrapAclTests(unittest.TestCase):
    def invoke(self, body, mocks=False):
        with tempfile.TemporaryDirectory(prefix='bootstrap-acl-') as directory:
            script=Path(directory)/'case.ps1'
            script.write_text(PRELUDE+"\n. '"+str(ROOT/'deployment/Bootstrap-Acl.ps1')+"'\n"+(MOCKS if mocks else '')+body)
            result=subprocess.run([str(PWSH),'-NoLogo','-NoProfile','-NonInteractive','-File',str(script)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_private_rule_stays_strict_and_diagnostic_identifies_inherited_read(self):
        self.invoke(r'''
Check ($null -eq (Get-BAclIssue (Private) $sid))
$issue=Get-BAclIssue (Broad) $sid
Check ($issue.Contains('S-1-5-32-545')); Check ($issue.Contains('inherited=True')); Check ($issue.Contains('ReadAndExecute'))
$bad=Private; $bad.owner='S-1-5-21-9'; Check ((Get-BAclIssue $bad $sid).StartsWith('owner='))
Assert-BInitialRules (Broad) $sid
$bad=Broad; $bad.rules[0].inherited=$false; Reject { Assert-BInitialRules $bad $sid }
$bad=Broad; $bad.rules[0].sid='S-1-5-21-999'; Reject { Assert-BInitialRules $bad $sid }
$bad=Broad; $bad.rules[0].type='Deny'; Reject { Assert-BInitialRules $bad $sid }
''')

    def test_only_empty_or_single_bootstrap_root_qualifies(self):
        self.invoke(r'''
Check ((Get-BLayout $root) -ceq 'initial')
[IO.File]::WriteAllText((Join-Path $root 'Bootstrap-Windows.ps1'),'trusted transferred script')
Check ((Get-BLayout $root) -ceq 'initial')
[void][IO.Directory]::CreateDirectory((Join-Path $root 'control'))
Check ((Get-BLayout $root) -ceq 'managed-or-partial')
''')

    def test_unknown_file_and_reparse_root_content_are_refused(self):
        self.invoke(r'''
[IO.File]::WriteAllText((Join-Path $root 'keep.txt'),'untouched')
Check ((Get-BLayout $root) -ceq 'unknown')
Reject { Initialize-BPrivateRoot $root $sid }
Check ($script:Writes.Count -eq 0)
[IO.File]::Delete((Join-Path $root 'keep.txt'))
[void][IO.Directory]::CreateSymbolicLink((Join-Path $root 'link'),$PSScriptRoot)
Reject { Get-BLayout $root }
''',mocks=True)

    def test_opt_in_initialization_and_offline_restore_preserve_script_bytes(self):
        self.invoke(r'''
$bootstrap=Join-Path $root 'Bootstrap-Windows.ps1'; [IO.File]::WriteAllText($bootstrap,'unchanged')
Initialize-BPrivateRoot $root $sid | Out-Null
Check ((Mock-Sddl $root) -ceq 'PRIVATE'); Check ((Mock-Sddl $bootstrap) -ceq 'PRIVATE')
Check ([IO.File]::ReadAllText($bootstrap) -ceq 'unchanged')
$directory=@(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
$j=Get-Content -LiteralPath (Join-Path $directory 'initial-acl.json') -Raw | ConvertFrom-Json -AsHashtable
Check ($j.status -ceq 'initialized'); Check ($j.entries.Count -eq 2)
Assert-BNoPendingAcl $root
Restore-BInitialAcl $root $directory $sid | Out-Null
Check ((Mock-Sddl $root) -ceq 'ORIGINAL:worker'); Check ((Mock-Sddl $bootstrap) -ceq 'ORIGINAL:Bootstrap-Windows.ps1')
Check ((Mock-Sddl $directory) -ceq 'PRIVATE')
''',mocks=True)

    def test_partial_acl_failure_restores_both_original_descriptors(self):
        self.invoke(r'''
$bootstrap=Join-Path $root 'Bootstrap-Windows.ps1'; [IO.File]::WriteAllText($bootstrap,'unchanged')
$script:FailPath=$bootstrap
Reject { Initialize-BPrivateRoot $root $sid }
Check ((Mock-Sddl $root) -ceq 'ORIGINAL:worker'); Check ((Mock-Sddl $bootstrap) -ceq 'ORIGINAL:Bootstrap-Windows.ps1')
$directory=@(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
$j=Get-Content -LiteralPath (Join-Path $directory 'initial-acl.json') -Raw | ConvertFrom-Json -AsHashtable
Check ($j.status -ceq 'restored')
Check ([IO.File]::ReadAllText($bootstrap) -ceq 'unchanged')
''',mocks=True)

    def test_restore_refuses_installed_data_and_modified_script(self):
        self.invoke(r'''
$bootstrap=Join-Path $root 'Bootstrap-Windows.ps1'; [IO.File]::WriteAllText($bootstrap,'original')
Initialize-BPrivateRoot $root $sid | Out-Null
$directory=@(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
[IO.File]::WriteAllText($bootstrap,'operator edit'); Reject { Restore-BInitialAcl $root $directory $sid }
[IO.File]::WriteAllText($bootstrap,'original')
[void][IO.Directory]::CreateDirectory((Join-Path $root 'data'))
[IO.File]::WriteAllText((Join-Path $root 'data/latest.exe'),'keep-success')
Reject { Restore-BInitialAcl $root $directory $sid }
Check ([IO.File]::ReadAllText((Join-Path $root 'data/latest.exe')) -ceq 'keep-success')
Check ((Mock-Sddl $root) -ceq 'PRIVATE')
''',mocks=True)

    def test_pending_initialization_prevents_download_or_new_deployment(self):
        self.invoke(r'''
Initialize-BPrivateRoot $root $sid | Out-Null
$directory=@(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
$path=Join-Path $directory 'initial-acl.json'; $j=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable
$j.status='pending'; Save-BAclJournal $directory $j
Reject { Assert-BNoPendingAcl $root }
Restore-BInitialAcl $root $directory $sid | Out-Null
Assert-BNoPendingAcl $root
''',mocks=True)

    def test_standalone_bootstrap_embeds_helpers_and_acl_mode_returns_before_ssh(self):
        template=(ROOT/'deployment/Bootstrap-Windows.template.ps1').read_text()
        generated=(ROOT/'deployment/Bootstrap-Windows.ps1').read_text()
        self.assertIn((ROOT/'deployment/Bootstrap-Acl.ps1').read_text(),generated)
        # Helpers remain available to isolated native tests, but direct legacy adoption is retired.
        start=template.index('    if ($RestoreInitialAcl -or $InitializePrivateRoot)')
        self.assertLess(start,template.index("$downloadRoot = Normal"))
        self.assertNotIn('Initialize-BPrivateRoot $workerRoot',template)
        self.assertNotIn('Set-Acl',template)
        self.assertIn("$area.role -cne 'production'",template)
        self.assertIn('Assert-BNoPendingAcl $workerRoot',template)
        self.assertNotIn('Set-Acl', (ROOT/'deployment/Prepare-Windows.ps1').read_text())

    def test_acl_inspection_returns_before_state_checks_mutation_or_mutex(self):
        template=(ROOT/'deployment/Bootstrap-Windows.template.ps1').read_text()
        start=template.index('if ($InspectAcl) {')
        end=template.index("foreach ($relative in @('control/state.json'",start)
        block=template[start:end]
        self.assertIn('return',block)
        for forbidden in ('Set-Acl','CreateDirectory','Rpc ','WriteAllText','Process','WaitOne'):
            self.assertNotIn(forbidden,block)

    def test_retry_keeps_prior_acl_backups_instead_of_deleting_them(self):
        self.invoke(r'''
Initialize-BPrivateRoot $root $sid | Out-Null
$first=@(Get-ChildItem -LiteralPath $root -Directory -Force)[0].FullName
Restore-BInitialAcl $root $first $sid | Out-Null
Initialize-BPrivateRoot $root $sid | Out-Null
Check (@(Get-ChildItem -LiteralPath $root -Directory -Force).Count -eq 2)
Check ([IO.File]::Exists((Join-Path $first 'initial-acl.json')))
''',mocks=True)

    def test_already_private_initial_root_is_not_rewritten(self):
        self.invoke(r'''
$script:AclMap[$root]='PRIVATE'
Initialize-BPrivateRoot $root $sid | Out-Null
Check ($script:Writes.Count -eq 0)
Check (@(Get-ChildItem -LiteralPath $root -Force).Count -eq 0)
''',mocks=True)

    def test_hard_link_to_outside_file_is_refused_without_acl_changes(self):
        self.invoke(r'''
$outside=Join-Path $PSScriptRoot 'outside.txt'; [IO.File]::WriteAllText($outside,'do not change')
[void](New-Item -ItemType HardLink -Path (Join-Path $root 'Bootstrap-Windows.ps1') -Target $outside)
Reject { Initialize-BPrivateRoot $root $sid }
Check ($script:Writes.Count -eq 0)
Check ([IO.File]::ReadAllText($outside) -ceq 'do not change')
''',mocks=True)
