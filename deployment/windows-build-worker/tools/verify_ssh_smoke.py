"""Run only the registered smoke project over disposable loopback SSH, never a Windows claim."""
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'tests'))
from server.queue import Queue
from server.common import canonical
from ssh_harness import LoopbackSsh


def main():
    os.umask(0o077)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report={'transport':'SSH loopback only','builder':'PowerShell on Ubuntu; Windows NOT verified','jobs':[]}
    with tempfile.TemporaryDirectory(prefix='worker-ssh-smoke-') as scratch:
        scratch=Path(scratch)
        with LoopbackSsh(scratch/'ssh',ROOT,'windows-main') as ssh:
            for profile_id,outcome in [('smoke','succeeded'),('smoke-failure','failed')]:
                with Queue(ROOT) as q:
                    pending=q.submit('worker-smoke',profile_id,'loopback-'+stamp)
                    cap={'projectId':'worker-smoke','profileId':profile_id,'revision':q.policy.revision('worker-smoke',profile_id)}
                    definition=q.policy.profile('worker-smoke',profile_id)
                response,_=ssh.rpc('claim',profiles=[cap]);assert response['ok']
                job=response['result'];assert job['id']==pending['id']
                auth={'jobId':job['id'],'attempt':job['attempt'],'token':job['token']}
                duplicate,_=ssh.rpc('claim',profiles=[cap]);assert not duplicate['ok'] and duplicate['error']=='worker_busy'
                archive=bytearray()
                while len(archive)<job['source']['size']:
                    response,data=ssh.rpc('download',**auth,offset=len(archive),length=1048576)
                    assert response['ok'] and hashlib.sha256(data).hexdigest()==response['result']['chunkSha256']
                    archive.extend(data)
                assert hashlib.sha256(archive).hexdigest()==job['snapshot']
                work=scratch/profile_id;work.mkdir()
                # The only admitted script is the fixed, approved dummy source.
                with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                    members=tar.getmembers();assert len(members)==1 and members[0].name=='build.ps1' and members[0].isreg()
                    content=tar.extractfile(members[0]).read()
                assert hashlib.sha256(content).hexdigest()==job['source']['files'][0]['sha256']
                assert content==(ROOT/'samples/build-smoke.ps1').read_bytes()
                (work/'build.ps1').write_bytes(content)
                response,_=ssh.rpc('start',**auth);assert response['ok']
                step=definition['steps'][0];assert step['tool']=='pwsh' and step['cwd']=='.'
                process=subprocess.run([str(ROOT/'.tools/pwsh/pwsh'),*step['args']],cwd=work,
                    env={'PATH':'/usr/bin:/bin','HOME':str(work),'TMPDIR':str(work),'POWERSHELL_TELEMETRY_OPTOUT':'1'},
                    stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
                assert (process.returncode==0)==(outcome=='succeeded')
                log=process.stdout;assert len(log)<=65536
                logsha=hashlib.sha256(log).hexdigest()
                response,_=ssh.rpc('upload-log',data=log,**auth,offset=0,sha256=logsha,dataLength=len(log));assert response['ok']
                response,_=ssh.rpc('seal-log',**auth,size=len(log),sha256=logsha);assert response['ok']
                log_directory=response['result']['directory']
                if outcome=='succeeded':
                    body=(work/'dist/smoke.txt').read_bytes();sha=hashlib.sha256(body).hexdigest()
                    response,_=ssh.rpc('begin-upload',**auth,manifest=[{'path':'dist/smoke.txt','size':len(body),'sha256':sha}]);assert response['ok']
                    for _ in range(2):
                        replay,_=ssh.rpc('upload-chunk',data=body,**auth,uploadId=response['result']['uploadId'],index=0,offset=0,sha256=sha,dataLength=len(body));assert replay['ok']
                response,_=ssh.rpc('finish',**auth,outcome=outcome,message='');assert response['ok']
                status,_=ssh.rpc('status',jobId=job['id']);assert status['result']['state']==outcome
                report['jobs'].append({'jobId':job['id'],'profile':profile_id,'state':outcome,'logDirectory':log_directory,
                    'artifactDirectory':status['result']['result'].get('directory'),'duplicateClaimRejected':True,'sameChunkReplayVerified':outcome=='succeeded'})
    path=ROOT/'audit'/('ssh-smoke-'+stamp+'.json');path.write_bytes(canonical(report)+b'\n');path.chmod(0o600)
    print(json.dumps(report,indent=2));print('Report:',path)


if __name__=='__main__':main()
