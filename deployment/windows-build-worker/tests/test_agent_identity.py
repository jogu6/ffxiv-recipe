"""Actual public-key selector authentication using a disposable Agent/loopback sshd."""
import os
from pathlib import Path
import shutil
import struct
import subprocess
import time
from server.common import canonical
from test_worker import Fixture
from ssh_harness import LoopbackSsh

class AgentIdentityTests(Fixture):
    def test_public_identity_selects_agent_key_without_local_private_file(self):
        root=Path(__file__).resolve().parents[1]
        shutil.copytree(root/'server',self.root/'server');shutil.copy2(root/'broker.py',self.root/'broker.py')
        with LoopbackSsh(self.base/'ssh',self.root,'win1') as ssh:
            sock=ssh.directory/'agent.sock'
            agent=subprocess.Popen(['/usr/bin/ssh-agent','-D','-a',str(sock)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if sock.exists():break
                    if agent.poll() is not None:self.fail('Disposable Agent failed')
                    time.sleep(.02)
                env=dict(os.environ,SSH_AUTH_SOCK=str(sock));env.pop('SSH_AGENT_PID',None)
                added=subprocess.run(['/usr/bin/ssh-add',str(ssh.directory/'client')],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
                self.assertEqual(added.returncode,0,'Disposable key could not be loaded')
                (ssh.directory/'client').unlink() # Only this test's disposable private key.
                cmd=ssh.command();cmd[cmd.index('-i')+1]=str(ssh.directory/'client.pub')
                cmd[1:1]=['-o','PreferredAuthentications=publickey','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no']
                payload=canonical(dict(version=1,op='status',jobId='00000000-0000-4000-8000-000000000000'))
                result=subprocess.run(cmd,input=struct.pack('!I',len(payload))+payload,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
                # A structured broker refusal proves authentication/forced-command execution succeeded.
                self.assertGreaterEqual(len(result.stdout),4,'Agent/public selector authentication failed')
                self.assertEqual(result.returncode,2)
                cleared=subprocess.run(['/usr/bin/ssh-add','-D'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
                self.assertEqual(cleared.returncode,0)
                rejected=subprocess.run(cmd,input=b'',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
                self.assertEqual(rejected.returncode,255);self.assertEqual(rejected.stdout,b'')
            finally:
                agent.terminate()
                try:agent.wait(timeout=5)
                except subprocess.TimeoutExpired:agent.kill();agent.wait(timeout=5)
