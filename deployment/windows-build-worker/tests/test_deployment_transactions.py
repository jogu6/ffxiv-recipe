"""Deployment recovery tests run only in disposable directories, without Windows connections."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PWSH=ROOT/'.tools/pwsh/pwsh'

class DeploymentTransactionTests(unittest.TestCase):
    def invoke(self, body):
        with tempfile.TemporaryDirectory(prefix='deployment-audit-') as directory:
            script=Path(directory)/'test.ps1'
            script.write_text("$ErrorActionPreference='Stop'\nSet-StrictMode -Version Latest\n"
                + ". '"+str(ROOT/"deployment/Deployment-Transaction.ps1")+"'\n"
                + "$root=Join-Path $PSScriptRoot 'worker'\n[void][IO.Directory]::CreateDirectory($root)\n"
                + "function Check($condition) { if (-not $condition) { throw 'Test assertion failed' } }\n"
                + "function Reject([scriptblock]$Action) { $rejected=$false; try { & $Action } catch { $rejected=$true }; Check $rejected }\n"
                + "function Put($name,$text) { $p=Join-Path $root $name; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)); [IO.File]::WriteAllText($p,$text) }\n"
                + "function Read($name) { [IO.File]::ReadAllText((Join-Path $root $name)) }\n"+body)
            result=subprocess.run([str(PWSH),'-NoLogo','-NoProfile','-NonInteractive','-File',str(script)],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=25)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_partial_install_restores_program_config_and_preserves_state_artifacts(self):
        self.invoke("""
Put 'windows/old.ps1' 'old'; Put 'control/worker.json' 'config-old'
Put 'control/state.json' '{"phase":"idle"}'; Put 'data/latest.exe' 'last-success'
$t=New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/old.ps1','windows/new.ps1','control/worker.json')
Set-DText $t 'windows/old.ps1' 'new'; Set-DText $t 'windows/new.ps1' 'added'; Set-DText $t 'control/worker.json' 'config-new'
# Simulate failure in preparation after program and configuration writes.
try { throw 'injected failure' } catch { Undo-DTransaction $t }
Check ((Read 'windows/old.ps1') -ceq 'old'); Check ((Read 'control/worker.json') -ceq 'config-old')
Check (-not [IO.File]::Exists((Join-Path $root 'windows/new.ps1')))
Check ((Read 'data/latest.exe') -ceq 'last-success'); Check ((Read 'control/state.json') -ceq '{"phase":"idle"}')
Undo-DTransaction $t # idempotent recovery
""")

    def test_crash_journal_reloads_and_blocks_superseding_deployment(self):
        self.invoke("""
Put 'windows/app.ps1' 'before'
$t=New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/app.ps1')
Set-DText $t 'windows/app.ps1' 'after'
Reject { Assert-DNoPending $root }
$loaded=Get-Content -LiteralPath (Join-Path $t.directory 'deployment-transaction.json') -Raw | ConvertFrom-Json -AsHashtable
Undo-DTransaction $loaded; Assert-DNoPending $root
Check ((Read 'windows/app.ps1') -ceq 'before')
""")

    def test_corrupted_backup_preflights_all_files_before_restoring(self):
        self.invoke("""
Put 'windows/a' 'old-a'; Put 'windows/b' 'old-b'
$t=New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/a','windows/b')
Set-DText $t 'windows/a' 'new-a'; Set-DText $t 'windows/b' 'new-b'
[IO.File]::WriteAllText((Join-Path $t.directory 'previous-files/windows/b'),'corrupt')
Reject { Undo-DTransaction $t }; Check ((Read 'windows/a') -ceq 'new-a')
""")

    def test_changes_after_deployment_are_never_overwritten(self):
        self.invoke("""
Put 'windows/a' 'old'
$t=New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/a')
Set-DText $t 'windows/a' 'installed'; Put 'windows/a' 'operator-change'
Reject { Undo-DTransaction $t }; Check ((Read 'windows/a') -ceq 'operator-change')
""")

    def test_rejects_protected_paths_unplanned_writes_and_committed_rollback(self):
        self.invoke("""
foreach ($name in @('control/state.json','data/latest.exe','windows/../control/state.json','windows\\bad','/etc/passwd')) {
    Reject { Get-DPath $root $name }
}
$t=New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/a')
Reject { Set-DText $t 'windows/b' 'unplanned' }
$t.status='committed'; Save-DJournal $t; Reject { Undo-DTransaction $t }
""")

    def test_idle_guard_checks_state_without_configuration(self):
        self.invoke("""
Put 'control/state.json' '{"phase":"building"}'
Reject { Assert-DIdle $root }
Put 'control/state.json' '{"phase":"idle"}'; Assert-DIdle $root
Put 'control/worker.json' '{"enabled":true}'; Reject { Assert-DIdle $root }
""")

    def test_symlink_destinations_and_backup_paths_are_rejected(self):
        self.invoke("""
$outside=Join-Path $PSScriptRoot 'outside'; [void][IO.Directory]::CreateDirectory($outside)
[void][IO.Directory]::CreateSymbolicLink((Join-Path $root 'windows'),$outside)
Reject { New-DTransaction $root (Join-Path $root 'control/packages/test') @('windows/app') }
Check (-not [IO.File]::Exists((Join-Path $outside 'app')))
""")

    def test_preparation_is_locked_offline_by_default_and_uses_transaction(self):
        prepare=(ROOT/'deployment/Prepare-Windows.ps1').read_text()
        bootstrap=(ROOT/'deployment/Bootstrap-Windows.template.ps1').read_text()
        self.assertLess(prepare.index('Assert-DIdle $workerRoot'),prepare.index('[void][IO.Directory]::CreateDirectory($path)'))
        self.assertIn('Assert-DNoPending $workerRoot',prepare)
        self.assertNotIn('Set-Acl',prepare)
        self.assertIn("Set-DText $transaction 'control/worker.json'",prepare)
        self.assertIn('-DeploymentTransaction $transaction',bootstrap)
        self.assertLess(bootstrap.index("$transaction.status = 'committed'"),bootstrap.index('if ($VerifyDummy -and -not $PrepareOnly)'))
        for text in (prepare,bootstrap,(ROOT/'deployment/Restore-Windows.ps1').read_text()):
            for forbidden in ('Register-ScheduledTask','Enable-ScheduledTask','schtasks','Remove-Item'):
                self.assertNotIn(forbidden,text)

    def test_existing_settings_preserved_and_mismatched_ssh_refused(self):
        self.invoke(r"""
$packaged=@{enabled=$false;workerId='windows-main';ssh=@{executable='C:\Windows\System32\OpenSSH\ssh.exe';host='vps';user='user';port=22;knownHosts='control/known_hosts';identityPublicKey='control/worker-key.pub'}}
$existing=@{enabled=$false;workerId='windows-main';ssh=$packaged.ssh.Clone();tools=@{pwsh=@{executable='C:\custom\pwsh.exe'}};pathEntries=@();storage=@{maxWorkspaceBytes=12345}}
$selected=Select-DExistingConfiguration $packaged $existing
Check ([object]::ReferenceEquals($selected,$existing)); Check ($selected.storage.maxWorkspaceBytes -eq 12345)
$existing.ssh.host='different'; Reject { Select-DExistingConfiguration $packaged $existing }
$existing.ssh.host='vps'; $existing.tools.pwsh.executable='D:\tools\pwsh.exe'; Reject { Select-DExistingConfiguration $packaged $existing }
""")
