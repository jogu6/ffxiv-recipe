import hashlib
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest
from test_worker import Fixture
from server import job_logs
from server.common import Rejected
from server.ssh_keys import bind_worker_key, COMMAND


class LogTests(Fixture):
    def test_resume_replay_seal_and_terminal_upload(self):
        with self.q() as q:
            self.submit(q); job=self.claim(q); auth=self.auth(job)
            data=b'safe build output\n'; sha=hashlib.sha256(data).hexdigest()
            self.assertEqual(job_logs.status(q,*auth)['offset'],0)
            for _ in range(2):self.assertEqual(job_logs.append(q,*auth,0,sha,data)['offset'],len(data))
            q.finish(*auth,'failed','intentional failure')
        with self.q() as q:
            self.assertEqual(job_logs.status(q,*auth)['offset'],len(data))
            result=job_logs.seal(q,*auth,len(data),sha)
            self.assertEqual(job_logs.seal(q,*auth,len(data),sha),result)
            self.assertTrue(job_logs.status(q,*auth)['sealed'])
            self.assertEqual((self.root/result['directory']/'build.log').read_bytes(),data)
            with self.assertRaises(Rejected):job_logs.append(q,*auth,0,sha,data)

    def test_invalid_ownership_hash_paths_and_limits(self):
        with self.q() as q:
            self.submit(q);job=self.claim(q);auth=self.auth(job)
            with self.assertRaises(Rejected):job_logs.status(q,'win2',*auth[1:])
            with self.assertRaises(Rejected):job_logs.append(q,*auth,0,'0'*64,b'x')
            with self.assertRaises(Rejected):job_logs.append(q,*auth,job_logs.LIMIT,hashlib.sha256(b'x').hexdigest(),b'x')
            with self.assertRaises(Rejected):job_logs.status(q,auth[0],'../x',*auth[2:])
            job_logs.append(q,*auth,0,hashlib.sha256(b'x').hexdigest(),b'x')
            with self.assertRaises(Rejected):job_logs.seal(q,*auth,1,'0'*64)

    def test_broker_log_binary_frames(self):
        with self.q() as q:
            self.submit(q);job=self.claim(q)
            request={'jobId':job['id'],'attempt':1,'token':job['token']}
            data=b'fixture log\n';sha=hashlib.sha256(data).hexdigest()
            code,response,_=self.wire(q,dict(request,op='upload-log',offset=0,sha256=sha,dataLength=len(data)),data)
            self.assertEqual(code,0)
            code,response,_=self.wire(q,dict(request,op='seal-log',size=len(data),sha256=sha))
            self.assertEqual(code,0);self.assertTrue(response['result']['sealed'])


class SshKeyTests(unittest.TestCase):
    def test_narrow_update_and_idempotence_preserve_login_keys(self):
        login=b'ssh-ed25519 AAAALOGIN login\r\n'
        worker=('restrict,command="'+COMMAND+'" ssh-ed25519 AAAAWORKER worker\n').encode()
        original=login+worker+b'# keep comment\n'
        updated=bind_worker_key(original,b'ssh-ed25519 AAAAWORKER worker\n')
        self.assertTrue(updated.startswith(login));self.assertTrue(updated.endswith(b'# keep comment\n'))
        self.assertIn(b' --worker windows-main"',updated)
        self.assertEqual(updated,bind_worker_key(updated,b'ssh-ed25519 AAAAWORKER'))

    def test_unknown_command_duplicate_and_missing_restriction_refused(self):
        for line in [b'ssh-ed25519 AAAAWORKER\n',b'restrict,command="other" ssh-ed25519 AAAAWORKER\n',
                     ('restrict,command="'+COMMAND+'" ssh-ed25519 AAAAWORKER\n').encode()*2]:
            with self.assertRaises(Rejected):bind_worker_key(line,b'ssh-ed25519 AAAAWORKER')
