"""Export the same isolated fixtures consumed by Run-Tests.ps1; no tests/builds/network."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))

from test_windows_worker import WindowsWorkerTests


def export_fixtures(destination, replace=False):
    destination = Path(os.path.abspath(destination))
    allowed = ROOT / 'test-export'
    if not destination.is_relative_to(allowed) or destination == allowed:
        raise ValueError('Output must be a child directory of build-worker/test-export')
    # Never traverse a symlink or overwrite unrelated files, even with --replace.
    current = ROOT
    for part in destination.relative_to(ROOT).parts:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise ValueError('Output path contains a link or non-directory')
    case = WindowsWorkerTests('test_powershell_core_unit_tests_and_static_parser')
    try:
        case.setUp()
        fixture = case.create_core_fixtures()
        names = ['fixtures.json'] + sorted(v['archive'] for v in fixture['archives'].values())
        if len(set(names)) != len(names) or any(Path(n).name != n for n in names):
            raise ValueError('Unexpected fixture filenames')
        if destination.exists():
            entries = list(destination.iterdir())
            if entries and not replace:
                raise ValueError('Output exists; use --replace to regenerate known fixture files')
            if any(p.is_symlink() or not p.is_file() or p.name not in names for p in entries):
                raise ValueError('Output contains unrelated files; nothing will be replaced')
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.windows-fixtures-', dir=destination.parent) as scratch:
            staging = Path(scratch)
            for name in names:
                source = case.base / name
                if name.endswith('.tar'):
                    description = next(v['source'] for v in fixture['archives'].values() if v['archive'] == name)
                    with source.open('rb') as f:
                        actual = hashlib.file_digest(f, 'sha256').hexdigest()
                    if actual != description['sha256'] or source.stat().st_size != description['size']:
                        raise ValueError('Generated archive does not match fixture descriptor')
                shutil.copyfile(source, staging / name)
                (staging / name).chmod(0o600)
            destination.mkdir(mode=0o700, exist_ok=True)
            # JSON is published last. Do not consume the directory while regenerating.
            for name in [n for n in names if n != 'fixtures.json'] + ['fixtures.json']:
                os.replace(staging / name, destination / name)
        return [(name, (destination / name).stat().st_size) for name in sorted(names)]
    finally:
        case.doCleanups()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-export/windows-fixtures')
    parser.add_argument('--replace', action='store_true', help='Replace only known fixture files; refuse unrelated content')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        files = export_fixtures(args.output, args.replace)
    except (ValueError, OSError) as exc:
        parser.exit(2, str(exc) + '\n')
    for name, size in files:
        print(f'{name}\t{size} bytes')
    print(f'Total: {len(files)} files, {sum(size for _, size in files)} bytes')


if __name__ == '__main__':
    main()
