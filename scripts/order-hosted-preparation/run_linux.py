"""Disposable preparation harness. No database, GitHub API, or migration command."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import posixpath
import signal
import stat
import subprocess
import tarfile

ENV = {'PATH': '/usr/bin:/bin', 'TZ': 'UTC', 'LANG': 'C', 'LC_ALL': 'C'}
GIT_ENV = {**ENV, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
    'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
ROOT = Path(__file__).resolve().parent

class Refusal(Exception):
    pass

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def read_file(file, limit):
    file = Path(file)
    assert file.resolve() == file
    with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        before = os.fstat(stream.fileno())
        assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit
        raw = stream.read(limit + 1); assert len(raw) == before.st_size
        after = os.fstat(stream.fileno()); named = file.lstat()
        for key in ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink'):
            assert getattr(before, key) == getattr(after, key) == getattr(named, key)
        return raw

def save(file, value):
    with os.fdopen(os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())

def require_linux():
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise Refusal('linux-x64-runtime-required')
    for name in ['/usr/bin/git', '/usr/bin/df']:
        if not Path(name).is_file() or not os.access(name, os.X_OK):
            raise Refusal('linux-prerequisite-missing')

def validate_bundle(root):
    root = Path(root); assert root.resolve() == root
    manifest = json.loads(read_file(root/'bundle-manifest.json', 32768))
    assert manifest['purpose'] == 'disposable-linux-preparation-only'
    assert manifest['productionExecutionAuthorized'] is False
    names = set()
    for entry in manifest['files']:
        name = entry['name']
        assert name not in names and not name.startswith('/')
        assert all(p not in ('', '.', '..') for p in name.split('/'))
        names.add(name)
        raw = read_file(root/name, 128 * 1024 * 1024)
        assert len(raw) == entry['bytes'] and digest(raw) == entry['sha256']
    assert names == {'run_linux.py', 'prepare_only.mjs', 'prepare_lifecycle.mjs',
        'pins.json', 'npm-vendor-inventory.json', 'payloads/source.bundle',
        'payloads/node-v22.23.2-linux-x64.tar.xz'}
    return manifest

def reviewed_members(archive, prefix):
    members = archive.getmembers(); assert 0 < len(members) <= 20000
    assert sum(m.size for m in members) <= 512 * 1024 * 1024
    seen = {}
    for member in members:
        name = member.name
        if name == prefix:
            assert member.isdir(); continue
        assert name.startswith(prefix + '/')
        assert all(p not in ('', '.', '..') for p in name.split('/'))
        assert name not in seen; seen[name] = member
        assert member.isfile() or member.isdir() or member.issym()
        assert member.mode & 0o7000 == 0
        if member.issym():
            assert not member.linkname.startswith('/')
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
            assert target.startswith(prefix + '/')
    # No member can be installed through another member's symlink.
    for name in seen:
        parent = posixpath.dirname(name)
        while parent in seen:
            assert seen[parent].isdir(); parent = posixpath.dirname(parent)
    return members

def install_archive(file, expected_digest, destination):
    raw = read_file(file, 128 * 1024 * 1024)
    assert digest(raw) == expected_digest
    with tarfile.open(fileobj=io.BytesIO(raw)) as compressed:
        compressed.fileobj.seek(0); expanded = compressed.fileobj.read(512 * 1024 * 1024 + 1)
        assert len(expanded) <= 512 * 1024 * 1024
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
        members = reviewed_members(archive, 'node-v22.23.2-linux-x64')
        Path(destination).mkdir(mode=0o700)
        archive.extractall(destination, members=members, filter='data')
    return Path(destination)/'node-v22.23.2-linux-x64'

def inspect_placement(prefix, pins, inventory):
    assert prefix.resolve() == prefix
    node = prefix/'bin/node'; npm = prefix/'lib/node_modules/npm/bin/npm-cli.js'
    assert digest(read_file(node, 160 * 1024 * 1024)) == pins['nodeSha256']
    assert digest(read_file(npm, 1024 * 1024)) == pins['npmCliSha256']
    package = read_file(prefix/'lib/node_modules/npm/package.json', 1024 * 1024)
    assert digest(package) == pins['npmPackageSha256']
    assert json.loads(package)['version'] == pins['npmVersion']
    actual = []
    for file in sorted((prefix/'lib/node_modules/npm').rglob('*'), key=lambda p: p.relative_to(prefix).as_posix()):
        name = file.relative_to(prefix).as_posix(); info = file.lstat()
        if file.is_symlink():
            assert file.resolve().is_relative_to(prefix)
            actual.append([name, 'symlink', os.readlink(file)])
        elif stat.S_ISREG(info.st_mode):
            raw = read_file(file, 16 * 1024 * 1024)
            actual.append([name, 'file', len(raw), digest(raw)])
        else: assert stat.S_ISDIR(info.st_mode)
    assert actual == inventory
    return node, npm

def git(args, cwd):
    subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
        cwd=cwd, env=GIT_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, check=True, timeout=60)

def run_prepare(args, cwd):
    child = subprocess.Popen(args, cwd=cwd, env=ENV, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        if child.wait(timeout=660) != 0: raise Refusal('worker-preparation-failed')
    except BaseException:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=15)
        # The existing worker fails/closes its own group on parent IPC loss.
        raise

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('new_attempt', type=Path)
    args = parser.parse_args()
    attempt = None
    result = {'purpose': 'disposable-linux-preparation-only', 'outcome': 'failed',
        'linuxExecutionProven': False, 'toolchainPlacementProven': False,
        'workerPreparationProven': False, 'hostedRunnerAcceptanceProven': False,
        'loadedReleaseGraphProven': False, 'productionExecutionAuthorized': False,
        'completeProductionScope': False}
    phase = 'runtime-preflight'
    try:
        require_linux()
        phase = 'bundle-verification'; bundle = validate_bundle(ROOT)
        pins = json.loads(read_file(ROOT/'pins.json', 32768))['toolchain']
        raw_inventory = read_file(ROOT/'npm-vendor-inventory.json', 1024 * 1024)
        assert digest(raw_inventory) == pins['npmInventorySha256']; inventory = json.loads(raw_inventory)
        candidate = args.new_attempt.absolute()
        assert candidate.parent.resolve() == candidate.parent and not candidate.exists()
        assert not candidate.is_relative_to(ROOT)
        candidate.mkdir(mode=0o700); attempt = candidate
        save(attempt/'started.json', {**result, 'phase': 'new-private-attempt'})
        phase = 'toolchain-placement'
        prefix = install_archive(ROOT/'payloads/node-v22.23.2-linux-x64.tar.xz', pins['nodeArchiveSha256'], attempt/'toolchain')
        node, npm = inspect_placement(prefix, pins, inventory)
        result.update(toolchainPlacementProven=True, nodePath=str(node), npmCliPath=str(npm),
            nodeSha256=pins['nodeSha256'], npmCliSha256=pins['npmCliSha256'], npmInventorySha256=pins['npmInventorySha256'])
        phase = 'linux-node-execution'
        version = subprocess.check_output([str(node), '--version'], env=ENV, cwd=attempt, timeout=15, stderr=subprocess.DEVNULL)
        assert version == (pins['nodeVersion']+'\n').encode(); result['linuxExecutionProven'] = True
        phase = 'fixture-checkout'; checkout = attempt/'checkout'
        git(['clone', '--no-checkout', '--no-local', '--', str(ROOT/'payloads/source.bundle'), str(checkout)], attempt)
        git(['remote', 'set-url', 'origin', 'https://github.com/Drewyoung910/grainline.git'], checkout)
        git(['checkout', '--detach', bundle['source']['commit']], checkout)
        assert not (checkout/'node_modules').exists() and not (checkout/'.npmrc').exists()
        reviewed = {'releaseCommit': bundle['source']['commit'], 'sourceCatalogSha256': bundle['source']['catalogSha256'],
            'sourceFenceSha256': bundle['source']['sourceFenceSha256'], 'nodeVersion': pins['nodeVersion'],
            'nodeSha256': pins['nodeSha256'], 'npmCli': str(npm), 'npmCliSha256': pins['npmCliSha256'], 'npmVersion': pins['npmVersion']}
        plan = attempt/'preparation-plan.json'; output = attempt/'worker-preparation.json'
        save(plan, {'purpose': result['purpose'], 'directory': str(checkout), 'reviewed': reviewed})
        phase = 'clean-worker-preparation'
        run_prepare([str(node), str(ROOT/'prepare_only.mjs'), str(plan), str(output)], checkout)
        observed = json.loads(read_file(output, 16384))
        assert observed['purpose'] == result['purpose'] and observed['workerClosed'] is True
        assert observed['state'] == 'installed' and observed['installedToolchainProven'] is True
        for field in ['loadedReleaseGraphProven', 'completeProductionScope', 'productionExecutionAuthorized', 'hostedRunnerAcceptanceProven']:
            assert observed[field] is False
        inspect_placement(prefix, pins, inventory)
        result.update(outcome='passed', workerPreparationProven=True,
            fixtureCommit=bundle['source']['commit'], fixtureSourceCatalogSha256=bundle['source']['catalogSha256'])
        phase = 'closed-and-verified'
    except BaseException as error:
        result['failureCategory'] = str(error) if isinstance(error, Refusal) else 'operation-failed'
    result['phase'] = phase
    if attempt is not None: save(attempt/'result.json', result)
    print(json.dumps(result))
    return 0 if result['outcome'] == 'passed' else 1

if __name__ == '__main__':
    raise SystemExit(main())
