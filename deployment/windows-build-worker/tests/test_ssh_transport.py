import hashlib
import shutil
from test_worker import Fixture
from ssh_harness import LoopbackSsh


class SshTransportTests(Fixture):
    def test_real_ssh_ownership_duplicate_and_result_log_return(self):
        from pathlib import Path
        root=Path(__file__).resolve().parents[1]
        shutil.copytree(root/'server',self.root/'server');shutil.copy2(root/'broker.py',self.root/'broker.py')
        (self.root/'dist').mkdir(mode=0o700)
        (self.root/'dist/build-worker-windows.zip').write_bytes(b'fixed test package')
        with self.q() as q:pending=self.submit(q)
        with LoopbackSsh(self.base/'ssh',self.root,'win1') as ssh:
            info,_=ssh.rpc('package-info');self.assertTrue(info['ok'])
            package,data=ssh.rpc('download-package',offset=0,length=1024)
            self.assertEqual(data,b'fixed test package')
            self.assertEqual(hashlib.sha256(data).hexdigest(),info['result']['sha256'])
            response,_=ssh.rpc('claim',profiles=[self.cap]);self.assertTrue(response['ok']);job=response['result']
            auth={'jobId':job['id'],'attempt':job['attempt'],'token':job['token']}
            self.assertEqual(job['id'],pending['id'])
            duplicate,_=ssh.rpc('claim',profiles=[self.cap]);self.assertFalse(duplicate['ok'])
            wrong,_=ssh.rpc('heartbeat',**dict(auth,token='x'*40));self.assertFalse(wrong['ok'])
            status,_=ssh.rpc('status',jobId=job['id']);self.assertEqual(status['result']['state'],'claimed')
            ssh.rpc('start',**auth)
            body=b'fixture artifact';sha=hashlib.sha256(body).hexdigest()
            upload,_=ssh.rpc('begin-upload',**auth,manifest=[{'path':'dist/app.exe','size':len(body),'sha256':sha}])
            for _ in range(2):
                chunk,_=ssh.rpc('upload-chunk',data=body,**auth,uploadId=upload['result']['uploadId'],index=0,offset=0,sha256=sha,dataLength=len(body))
                self.assertTrue(chunk['ok'])
            log=b'fixture log\n';logsha=hashlib.sha256(log).hexdigest()
            ssh.rpc('upload-log',data=log,**auth,offset=0,sha256=logsha,dataLength=len(log))
            sealed,_=ssh.rpc('seal-log',**auth,size=len(log),sha256=logsha);self.assertTrue(sealed['ok'])
            result,_=ssh.rpc('finish',**auth,outcome='succeeded',message='');self.assertTrue(result['ok'])
        with self.q() as q:
            self.assertEqual(q.latest('alpha','exe')['id'],pending['id'])
            path=self.root/sealed['result']['directory']/'build.log';self.assertEqual(path.read_bytes(),log)
