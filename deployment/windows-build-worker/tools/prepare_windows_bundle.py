"""Build a disabled, dummy-only Windows deployment package. Never includes private keys or DBs."""
import hashlib
import base64
import ipaddress
import json
import os
from pathlib import Path
import shutil
import sys
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server.common import canonical,digest
from server.policy import Policy



# Explicit release inventory: unrelated files/keys placed beside source are never packaged.
PACKAGE_PATHS = (
    'deployment/Deployment-Preflight.ps1', 'deployment/Migrate-WindowsAcl.ps1', 'deployment/Bootstrap-Acl.ps1', 'deployment/Bootstrap-Windows.ps1', 'deployment/BuildWorker.task.xml',
    'deployment/Deployment-Transaction.ps1', 'deployment/Prepare-Windows.ps1', 'deployment/Restore-Windows.ps1',
    'deployment/ffxiv-artifacts-exe.json', 'deployment/ffxiv-artifacts-nsis.json',
    'deployment/ffxiv-recipe.candidate.json', 'deployment/server-capabilities.json',
    'deployment/vps-known_hosts', 'deployment/worker.windows-main.json',
    'windows/JobObject.cs', 'windows/LogSupport.cs', 'windows/Stage-Artifacts.ps1',
    'windows/Start-Worker.cmd', 'windows/Worker.ps1', 'windows/Worker.psm1',
    'windows/CacheCleanup.psm1', 'windows/Start-ApprovedWorker.ps1',
    'windows/WorkerCore.cs', 'windows/worker.example.json', 'worker-key.pub',
)

VALIDATION_PATHS = ('tests/windows/Migration.Native.Tests.ps1', 'tests/windows/Run-Tests.ps1',
    'tests/windows/Static.Tests.ps1') + tuple('test-export/windows-fixtures/' + name for name in (
    'absolute.tar','case.tar','checksum.tar','duplicate.tar','filehash.tar','fixtures.json',
    'hardlink.tar','missing.tar','pax.tar','reserved.tar','size.tar','symlink.tar','trailing.tar',
    'traversal.tar','unlisted.tar','valid.tar'))

def validation_payload(root):
    files=[]
    for name in VALIDATION_PATHS:
        path=root/name
        if any(p.is_symlink() for p in (path,*path.parents)) or not path.is_file():
            raise ValueError('Validation source missing or linked')
        data=path.read_bytes()
        if len(data)>2097152:raise ValueError('Validation source oversized')
        target=('fixtures/'+path.name) if name.startswith('test-export/') else name
        files.append(dict(path=target,sha256=hashlib.sha256(data).hexdigest(),data=base64.b64encode(data).decode()))
    return canonical(dict(schemaVersion=1,files=files))



def package_files(root):
    files=[]
    total=0
    for name in sorted(PACKAGE_PATHS):
        path=root/name
        if any(parent.is_symlink() for parent in (path,*path.parents)):
            raise ValueError('Package source link rejected')
        if not path.is_file() or path.stat().st_size>2097152:
            raise ValueError('Package source missing or oversized')
        total+=path.stat().st_size
        if total>16700000:raise ValueError('Package exceeds bootstrap expanded limit')
        files.append(path)
    return files


def ed25519_public(text):
    parts=text.split()
    if len(parts)<2 or parts[0]!='ssh-ed25519':raise ValueError('Expected ed25519 public key')
    raw=base64.b64decode(parts[1],validate=True)
    if len(raw)!=51 or raw[:19]!=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20':
        raise ValueError('Invalid ed25519 public key')
    return parts[:2]


def main():
    os.umask(0o077)
    policy=Policy(ROOT);caps=[cap for cap in policy.worker('windows-main')['profiles'] if cap['projectId']=='worker-smoke']
    config=json.loads((ROOT/'windows/worker.example.json').read_bytes())
    host=os.environ.get('SSH_CONNECTION','').split()
    address=host[2] if len(host)==4 else '133.18.122.162'
    ipaddress.ip_address(address)
    config['ssh']['host']=address;config['tools']={'pwsh':{'executable':'C:\\Program Files\\PowerShell\\7\\pwsh.exe','prefixArgs':[]}}
    config['profiles']=[dict(cap,definition=policy.profile(cap['projectId'],cap['profileId'])) for cap in caps]
    assert not config['enabled'] and all(p['projectId']=='worker-smoke' for p in config['profiles'])
    (ROOT/'deployment/worker.windows-main.json').write_bytes(canonical(config)+b'\n')
    (ROOT/'deployment/server-capabilities.json').write_bytes(canonical(caps)+b'\n')
    pinned_name=os.environ.get('BUILD_WORKER_PINNED_HOST_FILE')
    if pinned_name:
        pinned=Path(pinned_name).resolve()
        pinned.relative_to(ROOT)
        parts=pinned.read_text().split()
        if len(parts)!=3 or parts[0]!=address:raise ValueError('Pinned host does not match package host')
        hostkey=ed25519_public(' '.join(parts[1:]))
    else:
        hostkey=ed25519_public(Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text())
    (ROOT/'deployment/vps-known_hosts').write_text(address+' '+hostkey[0]+' '+hostkey[1]+'\n')
    public=ed25519_public((ROOT/'worker-key.pub').read_text())
    helper=(ROOT/'deployment/Deployment-Preflight.ps1').read_text()
    def embed(text):
        start='# BEGIN EMBEDDED PREFLIGHT'
        end='# END EMBEDDED PREFLIGHT'
        if start not in text:raise ValueError('Missing preflight embedding marker')
        a=text.index(start);b=text.index(end,a)+len(end)
        return text[:a]+start+'\n'+helper+'\n'+end+text[b:]
    for name in ('Migrate-WindowsAcl.ps1','Prepare-Windows.ps1','Restore-Windows.ps1','Deployment-Transaction.ps1','Bootstrap-Acl.ps1'):
        path=ROOT/'deployment'/name
        path.write_text(embed(path.read_text()))
    bootstrap=(ROOT/'deployment/Bootstrap-Windows.template.ps1').read_text()
    bootstrap=bootstrap.replace('# __BOOTSTRAP_ACL__',(ROOT/'deployment/Bootstrap-Acl.ps1').read_text())
    bootstrap=bootstrap.replace('__HOST__',address).replace('__PUBLIC_KEY__',public[0]+' '+public[1]).replace('__HOST_KEY__',address+' '+hostkey[0]+' '+hostkey[1])
    (ROOT/'deployment/Bootstrap-Windows.ps1').write_text(bootstrap)
    migration=(ROOT/'deployment/Migrate-WindowsAcl.ps1').read_text()
    library=migration[migration.index('function '):migration.index('# Dot-sourcing defines')]
    validation=validation_payload(ROOT)
    setup=(ROOT/'deployment/Setup-Windows.template.ps1').read_text()
    setup=setup.replace('__VALIDATION_PAYLOAD__',base64.b64encode(validation).decode()).replace('__VALIDATION_SHA256__',hashlib.sha256(validation).hexdigest())
    setup=setup.replace('__MIGRATION_LIBRARY__',base64.b64encode(library.encode()).decode()).replace('__BOOTSTRAP_SCRIPT__',base64.b64encode(bootstrap.encode()).decode()).replace('__PUBLIC_KEY__',public[0]+' '+public[1]).replace('__HOST__',address).replace('__HOST_KEY__',address+' '+hostkey[0]+' '+hostkey[1])
    (ROOT/'deployment/Setup-Windows.ps1').write_text(setup)

    # Inactive first-project candidate: existing npm commands, no actual registration/snapshot.
    def definition(mode):
        artifact=[{'path':'worker-output/makeRecipe.exe','maxBytes':268435456}]
        if mode=='nsis':artifact.append({'path':'worker-output/setup.exe','maxBytes':536870912})
        return {'steps':[{'tool':'npm','args':['ci','--no-audit','--no-fund'],'cwd':'.'},
          {'tool':'npm','args':['run','pipeline:gui:build:exe' if mode=='exe' else 'pipeline:gui:build'],'cwd':'.'},
          {'tool':'pwsh','args':['-NoLogo','-NoProfile','-NonInteractive','-File','C:\\BuildWorker-Production\\windows\\Stage-Artifacts.ps1',
             '-RulesFile',f'C:\\BuildWorker-Production\\deployment\\ffxiv-artifacts-{mode}.json'],'cwd':'.'}],
          'artifacts':artifact,'timeoutSeconds':3600}
    candidate={'sourceRoot':'/home/ffxivdev/workspace/ffxiv-recipe',
       'include':['src-tauri','pipeline/gui','tools/run-tauri-build.mjs','package.json','package-lock.json','.cargo'],
       'extraFiles':[],'exclude':['src-tauri/target','worker-output'],
       'limits':{'maxFiles':20000,'maxFileBytes':134217728,'maxSourceBytes':1073741824},
       'profiles':{'windows-exe':definition('exe'),'windows-nsis':definition('nsis')}}
    (ROOT/'deployment/ffxiv-recipe.candidate.json').write_bytes(canonical(candidate)+b'\n')
    for mode in ('exe','nsis'):
        rules=[{'root':'target','kind':'file','from':'release/makeRecipe.exe','to':'worker-output/makeRecipe.exe'}]
        if mode=='nsis':rules.append({'root':'target','kind':'single-exe-directory','from':'release/bundle/nsis','to':'worker-output/setup.exe'})
        (ROOT/f'deployment/ffxiv-artifacts-{mode}.json').write_bytes(canonical(rules)+b'\n')
    files=package_files(ROOT)
    manifest={'schemaVersion':1,'files':[{'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (ROOT/'deployment/package-manifest.json').write_bytes(canonical(manifest)+b'\n')
    output=ROOT/'dist';output.mkdir(mode=0o700,exist_ok=True)
    archive=output/'build-worker-windows.zip'
    with zipfile.ZipFile(archive.with_suffix('.tmp'),'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as package:
        for p in files+[ROOT/'deployment/package-manifest.json']:package.write(p,p.relative_to(ROOT).as_posix())
    os.replace(archive.with_suffix('.tmp'),archive)
    sha=hashlib.sha256(archive.read_bytes()).hexdigest()
    (output/'build-worker-windows.zip.sha256').write_text(sha+'  build-worker-windows.zip\n')
    print('Prepared disabled dummy-only package:',archive)
    print('Files:',len(files)+1,'Bytes:',archive.stat().st_size,'SHA-256:',sha)


if __name__=='__main__':main()
