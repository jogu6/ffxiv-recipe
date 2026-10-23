import hashlib
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
import zipfile
from server.policy import Policy

ROOT=Path(__file__).resolve().parents[1]


class DeploymentTests(unittest.TestCase):
    def test_disabled_dummy_configuration_matches_server(self):
        config=json.loads((ROOT/'deployment/worker.windows-main.json').read_bytes())
        self.assertFalse(config['enabled'])
        self.assertEqual(config['workerId'],'windows-main')
        policy=Policy(ROOT)
        for profile in config['profiles']:
            self.assertEqual(profile['projectId'],'worker-smoke')
            self.assertEqual(profile['definition'],policy.profile(profile['projectId'],profile['profileId']))
            self.assertEqual(profile['revision'],policy.revision(profile['projectId'],profile['profileId']))
        if 'ffxiv-recipe' in policy.projects:
            self.assertIn('pipeline/gui',policy.projects['ffxiv-recipe']['include'])
            self.assertNotIn('pipeline/cache',policy.projects['ffxiv-recipe']['include'])

    def test_task_is_disabled_and_uses_fixed_least_privilege_launcher(self):
        ns={'t':'http://schemas.microsoft.com/windows/2004/02/mit/task'}
        task=ET.parse(ROOT/'deployment/BuildWorker.task.xml')
        self.assertEqual(task.find('.//t:Settings/t:Enabled',ns).text,'false')
        self.assertEqual(task.find('.//t:MultipleInstancesPolicy',ns).text,'IgnoreNew')
        self.assertEqual(task.find('.//t:RunLevel',ns).text,'LeastPrivilege')
        self.assertIn('C:\\BuildWorker-Production\\windows\\Start-Worker.cmd',task.find('.//t:Arguments',ns).text)
        prepare=(ROOT/'deployment/Prepare-Windows.ps1').read_text()
        self.assertNotIn('Register-ScheduledTask',prepare)
        self.assertNotIn('Enable-ScheduledTask',prepare)

    def test_bundle_hashes_and_excludes_operational_data_and_secrets(self):
        with zipfile.ZipFile(ROOT/'dist/build-worker-windows.zip') as archive:
            names=archive.namelist()
            self.assertIn('deployment/Bootstrap-Windows.ps1',names)
            self.assertNotIn('config/projects.json',names)
            for name in names:
                self.assertFalse(name.startswith(('audit/','artifacts/','results/','staging/','.tools/')))
                self.assertNotIn('jobs.sqlite3',name)
                self.assertNotIn('authorized_keys',name)
                self.assertNotIn('buildworker_ed25519',name)
            manifest=json.loads(archive.read('deployment/package-manifest.json'))
            self.assertEqual(set(names),{'deployment/package-manifest.json'}|{f['path'] for f in manifest['files']})
            for item in manifest['files']:
                self.assertEqual(hashlib.sha256(archive.read(item['path'])).hexdigest(),item['sha256'])
                self.assertEqual(archive.read(item['path']),(ROOT/item['path']).read_bytes())

    def test_ffxiv_candidate_keeps_existing_commands_and_excludes_operational_data(self):
        candidate=json.loads((ROOT/'deployment/ffxiv-recipe.candidate.json').read_bytes())
        self.assertNotIn('pipeline',candidate['include'])
        self.assertIn('pipeline/gui',candidate['include'])
        self.assertIn('src-tauri/target',candidate['exclude'])
        exe=candidate['profiles']['windows-exe'];nsis=candidate['profiles']['windows-nsis']
        self.assertIn(['run','pipeline:gui:build:exe'],[s['args'] for s in exe['steps']])
        self.assertIn(['run','pipeline:gui:build'],[s['args'] for s in nsis['steps']])

    def test_package_allowlist_excludes_unrelated_files_and_rejects_links(self):
        import tempfile
        from tools.prepare_windows_bundle import PACKAGE_PATHS,package_files
        with tempfile.TemporaryDirectory(prefix='package-audit-') as directory:
            root=Path(directory)
            for name in PACKAGE_PATHS:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
            (root/'windows/private-key').write_bytes(b'not a real key')
            (root/'deployment/unrelated.ps1').write_bytes(b'not shipped')
            self.assertEqual({p.relative_to(root).as_posix() for p in package_files(root)},set(PACKAGE_PATHS))
            source=root/'windows/WorkerCore.cs';source.unlink();source.symlink_to(root/'windows/private-key')
            with self.assertRaises(ValueError):package_files(root)

    def test_package_key_validation_rejects_untrusted_template_text(self):
        from tools.prepare_windows_bundle import ed25519_public
        self.assertEqual(ed25519_public((ROOT/'worker-key.pub').read_text())[0],'ssh-ed25519')
        for text in ("ssh-ed25519 'injected'",'ssh-rsa AAAA','ssh-ed25519 AAAA'):
            with self.assertRaises(ValueError):ed25519_public(text)
