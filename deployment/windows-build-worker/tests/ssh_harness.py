"""Disposable loopback-only sshd. Does not edit system sshd or authorized_keys."""
import getpass
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
import tempfile
from server.common import canonical


class LoopbackSsh:
    def __init__(self, directory, broker_root, worker):
        self.directory=Path(directory);self.broker_root=Path(broker_root);self.worker=worker
        self.process=None

    def __enter__(self):
        # sshd StrictModes rejects world-writable /tmp ancestors even for private fixtures.
        # Keep only ephemeral SSH material in a private temporary directory under this worker.
        parent=Path(__file__).resolve().parents[1]/'.ssh-test-runtime'
        parent.mkdir(mode=0o700,exist_ok=True)
        if parent.is_symlink() or parent.stat().st_mode & 0o077:raise RuntimeError('Unsafe SSH test parent')
        self.temporary=tempfile.TemporaryDirectory(prefix='session-',dir=parent)
        self.directory=Path(self.temporary.name)
        for name in ('host','client'):
            subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-f',str(self.directory/name)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        with socket.socket() as s:
            s.bind(('127.0.0.1',0));self.port=s.getsockname()[1]
        forced=f'/usr/bin/python3 -E -s -B {self.broker_root}/broker.py --worker {self.worker}'
        public=(self.directory/'client.pub').read_text().split()
        (self.directory/'authorized_keys').write_text(f'restrict,command="{forced}" {public[0]} {public[1]}\n')
        (self.directory/'authorized_keys').chmod(0o600)
        host=(self.directory/'host.pub').read_text().split()
        (self.directory/'known_hosts').write_text(f'[127.0.0.1]:{self.port} {host[0]} {host[1]}\n')
        config='\n'.join([f'Port {self.port}','ListenAddress 127.0.0.1',f'HostKey {self.directory}/host',
            f'PidFile {self.directory}/sshd.pid',f'AuthorizedKeysFile {self.directory}/authorized_keys',
            'UsePAM no','PasswordAuthentication no','KbdInteractiveAuthentication no','PubkeyAuthentication yes',
            'AuthenticationMethods publickey','StrictModes yes','PermitRootLogin no','UseDNS no','PrintMotd no',
            'AllowAgentForwarding no','AllowTcpForwarding no','X11Forwarding no','PermitTTY no',
            f'AllowUsers {getpass.getuser()}','LogLevel ERROR',''])
        path=self.directory/'sshd_config';path.write_text(config)
        self.errors=(self.directory/'sshd.stderr').open('wb')
        self.process=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(path)],stdout=subprocess.DEVNULL,stderr=self.errors)
        for _ in range(100):
            if self.process.poll() is not None:
                self.__exit__(None,None,None)
                raise RuntimeError('Disposable sshd failed to start; inspect private test diagnostics')
            try:
                with socket.create_connection(('127.0.0.1',self.port),timeout=.1):return self
            except OSError:time.sleep(.05)
        self.__exit__(None,None,None)
        raise RuntimeError('Disposable sshd timed out')

    def __exit__(self,*args):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=5)
        if hasattr(self,'errors'):self.errors.close()
        if hasattr(self,'temporary'):self.temporary.cleanup()

    def command(self):
        return ['/usr/bin/ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
                '-o','UpdateHostKeys=no','-o','IdentitiesOnly=yes','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
                '-o',f'UserKnownHostsFile={self.directory}/known_hosts','-o','GlobalKnownHostsFile=/dev/null',
                '-i',str(self.directory/'client'),'-p',str(self.port),f'{getpass.getuser()}@127.0.0.1','build-worker-v1']

    def rpc(self, op, data=b'', **fields):
        raw=canonical(dict(fields,version=1,op=op))
        result=subprocess.run(self.command(),input=struct.pack('!I',len(raw))+raw+data,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
        if len(result.stdout)<4:raise RuntimeError(f'SSH exchange failed (exit {result.returncode}); no sensitive diagnostics printed')
        size=struct.unpack('!I',result.stdout[:4])[0]
        header=json.loads(result.stdout[4:4+size]);binary=result.stdout[4+size:]
        if len(binary)!=header['dataLength']:raise RuntimeError('SSH frame length mismatch')
        if result.returncode!=(0 if header['ok'] else 2):raise RuntimeError('SSH exit status mismatch')
        return header,binary
