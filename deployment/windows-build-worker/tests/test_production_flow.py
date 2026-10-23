"""Whole-flow isolation integration. Actual disposable SSH, mocked Windows native/build APIs."""
import hashlib
import json
from pathlib import Path
import shutil
from server.common import canonical
from test_worker import Fixture
import test_windows_worker as winfixtures
from ssh_harness import LoopbackSsh

ROOT=Path(__file__).resolve().parents[1]

class ProductionFlowTests(Fixture):
    def test_isolated_install_source_transfer_dummy_artifact_and_log_return_over_real_ssh(self):
        self.projects['projects']['worker-smoke']=self.projects['projects'].pop('alpha')
        self.cap['projectId']='worker-smoke'
        self.write_config()
        shutil.copytree(ROOT/'server',self.root/'server',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        shutil.copy2(ROOT/'broker.py',self.root/'broker.py')
        (self.root/'dist').mkdir()
        shutil.copy2(ROOT/'dist/build-worker-windows.zip',self.root/'dist/build-worker-windows.zip')
        config=winfixtures.WindowsWorkerTests.make_config(self)
        config['profiles'][0]['projectId']='worker-smoke'
        (self.base/'client.json').write_bytes(canonical(config))
        legacy=self.base/'BuildWorker';(legacy/'test-fixtures').mkdir(parents=True)
        untouched=self.base/'unrelated-volume';untouched.mkdir()
        (untouched/'preserve.txt').write_text('do not touch')
        (legacy/'test-fixtures/link').symlink_to(untouched,target_is_directory=True)
        (legacy/'settings.json').write_text('{"preserve":true}')
        before=hashlib.sha256((legacy/'settings.json').read_bytes()).hexdigest()
        with self.q() as q:pending=q.submit('worker-smoke','exe','isolated-production-flow')
        production=self.base/'BuildWorker-Production'
        with LoopbackSsh(self.base/'ssh',self.root,'win1') as ssh:
            args=self.base/'transport.json';args.write_bytes(canonical(ssh.command()))
            output=winfixtures.WindowsWorkerTests.run_ps(self,ROOT/'tests/windows/Deployment.Isolation.Tests.ps1',
                '-FixtureRoot',production,'-CodeRoot',ROOT,'-BrokerRoot',self.root,'-TransportFile',args)
        self.assertIn('artifacts-and-logs=verified Windows-native=unverified',output)
        self.assertEqual(hashlib.sha256((legacy/'settings.json').read_bytes()).hexdigest(),before)
        self.assertTrue((legacy/'test-fixtures/link').is_symlink())
        self.assertEqual((untouched/'preserve.txt').read_text(),'do not touch')
        self.assertFalse((production/'tests').exists())
        self.assertFalse((production/'test-export').exists())
        with self.q() as q:
            final=q.status(pending['id'])
            self.assertEqual(final['state'],'succeeded')
            self.assertEqual(final['attempt'],1)
            self.assertEqual((self.root/final['result']['directory']/'0').read_bytes(),b'fixture-artifact')
        self.assertEqual((self.root/'results'/pending['id']/'1/build.log').read_bytes(),b'fixture build log\n')
        state=json.loads((production/'control/state.json').read_bytes())
        self.assertEqual(state['phase'],'idle')
        print('ISOLATED whole-flow: actual loopback SSH + verified runtime manifest/transaction/source/artifact/log; Windows ACL/process APIs mocked')
