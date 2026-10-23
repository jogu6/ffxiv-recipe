"""Narrow, byte-preserving update for one explicitly identified worker public key."""
import re
from .common import require

COMMAND = '/usr/bin/python3 -E -s -B /home/ffxivdev/build-worker/broker.py'


def bind_worker_key(original, public_key):
    key = public_key.decode('ascii').strip().split()
    require(len(key) >= 2 and key[0] == 'ssh-ed25519', message='Expected dedicated Ed25519 public key')
    identity = (key[0] + ' ' + key[1]).encode('ascii')
    matches = []
    lines = original.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.lstrip().startswith(b'#'):
            continue
        if re.search(rb'(?<!\S)' + re.escape(identity) + rb'(?:\s|$)', line):
            matches.append(index)
    require(len(matches) == 1, message='Dedicated public key must match exactly one entry')
    index = matches[0]
    line = lines[index]
    prefix = line.split(identity, 1)[0]
    require(re.search(rb'(?:^|,)restrict(?:,|\s)', prefix) is not None,
            message='Dedicated key is missing restrict')
    commands = re.findall(rb'command="([^"\r\n]*)"', prefix)
    require(len(commands) == 1 and commands[0].decode('ascii') in (COMMAND, COMMAND + ' --worker windows-main'),
            message='Unexpected forced command; refusing to replace')
    replacement = ('command="' + COMMAND + ' --worker windows-main"').encode('ascii')
    lines[index] = re.sub(rb'command="[^"\r\n]*"', lambda _: replacement, line, count=1)
    return b''.join(lines)
