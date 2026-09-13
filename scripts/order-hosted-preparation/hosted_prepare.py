"""Observed GitHub-hosted preparation only; never release admission or execution."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPOSITORY = 'Drewyoung910/grainline'
BRANCH = 'proof/order-hosted-preparation-20260913'
WORKFLOW = '.github/workflows/order-hosted-preparation.yml'
REUSED = {
    'run_linux.py': 'b56c583404ac7ddf5807efab1e9a301e0f745f76304e4e63167236f07e725aa0',
    'prepare_only.mjs': '7b9067c5e2acf4de89ee72348ad615b661be6c1ac6af744a10d0d6be7a44d6b8',
    'prepare_lifecycle.mjs': 'a2eb7b288cb739d18ff6814071a4c0f1fb5288947e838ae1abd6550bdc16ec16',
    'pins.json': '080ec0d3ef0292ab0f323a6a736c14de4974ee407a1acf7b6b94c99613173c57',
    'npm-vendor-inventory.json': '1dfec6dc86674ec3c479c06e05d61a7a92e29173a5f9358243f75b54b5aab551',
}
FLAGS = {'productionExecutionAuthorized': False, 'completeProductionScope': False,
         'loadedReleaseGraphProven': False, 'hostedRunnerAcceptanceProven': False,
         'finalMainCiAccepted': False, 'productionTokenHeadroomProven': False,
         'productionEvidenceDeliveryProven': False}


def load_helpers():
    # Reuse the exact accepted Linux boundary before executing any helper code.
    for name, expected in REUSED.items():
        file = ROOT/name
        assert file.resolve() == file and file.is_file() and file.stat().st_nlink == 1
        assert hashlib.sha256(file.read_bytes()).hexdigest() == expected
    spec = importlib.util.spec_from_file_location('accepted_linux_preparation', ROOT/'run_linux.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hosted_context(env):
    exact = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': REPOSITORY,
             'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/'+BRANCH,
             'GITHUB_WORKFLOW_REF': REPOSITORY+'/'+WORKFLOW+'@refs/heads/'+BRANCH,
             'GITHUB_JOB': 'prepare', 'RUNNER_ENVIRONMENT': 'github-hosted',
             'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24'}
    for key, value in exact.items():
        assert env.get(key) == value
    sha = env.get('GITHUB_SHA', '')
    assert re.fullmatch('[0-9a-f]{40}', sha) and env.get('GITHUB_WORKFLOW_SHA') == sha
    for key in ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']:
        assert re.fullmatch('[1-9][0-9]{0,19}', env.get(key, ''))
    assert re.fullmatch(r'[0-9]{8}\.[0-9]+\.[0-9]+', env.get('ImageVersion', ''))
    return {**exact, **{key: env[key] for key in [
        'GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'ImageVersion']}}


def git_output(args, directory, helpers):
    return subprocess.check_output(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', *args], cwd=directory,
        env={**helpers.GIT_ENV, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_OPTIONAL_LOCKS': '0'},
        stdin=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)


def source_catalog(checkout, sha, helpers):
    assert git_output(['rev-parse', 'HEAD'], checkout, helpers).decode().strip() == sha
    assert git_output(['status', '--porcelain=v1', '--untracked-files=all'], checkout, helpers) == b''
    records = git_output(['ls-tree', '-r', '-z', '--full-tree', sha], checkout, helpers).split(b'\0')[:-1]
    assert 0 < len(records) <= 10000
    catalog, total = [], 0
    for record in records:
        header, relative = record.decode().split('\t', 1)
        mode, kind, oid = header.split(' ')
        assert mode in ['100644', '100755'] and kind == 'blob'
        assert all(part not in ['', '.', '..'] for part in relative.split('/'))
        file = checkout/relative
        raw = helpers.read_file(file, 32*1024*1024)
        assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == oid
        total += len(raw)
        assert total <= 256*1024*1024
        catalog.append([mode, relative, helpers.digest(raw)])
    return {'fileCount': len(records), 'catalogSha256': helpers.digest(
        json.dumps(catalog, ensure_ascii=False, separators=(',', ':')).encode())}


def checked_preparation(receipt):
    assert receipt['purpose'] == 'disposable-linux-preparation-only'
    assert receipt['workerClosed'] is True and receipt['installedToolchainProven'] is True
    assert receipt['state'] == 'installed'
    assert isinstance(receipt['workerPid'], int) and receipt['workerPid'] > 0
    assert re.fullmatch('[a-f0-9-]{36}', receipt['sessionId'])
    for key in ['productionExecutionAuthorized', 'completeProductionScope',
                'loadedReleaseGraphProven', 'hostedRunnerAcceptanceProven']:
        assert receipt[key] is False
    return {key: receipt[key] for key in ['workerPid', 'sessionId', 'state',
        'workerClosed', 'installedToolchainProven']}


def main():
    helpers = load_helpers()
    output = None
    result = {'purpose': 'hosted-worker-preparation-observation', 'outcome': 'failed',
              'workerPreparationProven': False, 'hostedContextObserved': False,
              'linuxExecutionProven': False, 'toolchainPlacementProven': False, **FLAGS}
    phase = 'hosted-preflight'
    try:
        assert len(sys.argv) == 3
        helpers.require_linux()
        context = hosted_context(os.environ)
        workspace = Path(sys.argv[1])
        assert workspace.is_absolute() and workspace.resolve() == workspace
        assert str(workspace) == os.environ['GITHUB_WORKSPACE']
        temporary = Path(os.environ['RUNNER_TEMP'])
        assert temporary.is_absolute() and temporary.resolve() == temporary and temporary.is_dir()
        assert not temporary.is_relative_to(workspace)
        destination = temporary/'order-hosted-evidence'
        destination.mkdir(mode=0o700)
        output = destination
        helpers.save(output/'context.json', {**context, 'providerAuthenticatedExternally': False,
                     'runnerVersionVerifiedExternally': False, **FLAGS})
        result['hostedContextObserved'] = True
        phase = 'installed-toolcache-identity'
        node_path = Path(sys.argv[2]).resolve()
        prefix = node_path.parent.parent
        toolcache = Path(os.environ['RUNNER_TOOL_CACHE']).resolve()
        assert prefix.is_relative_to(toolcache) and node_path == prefix/'bin/node'
        pins = json.loads(helpers.read_file(ROOT/'pins.json', 32768))['toolchain']
        inventory = json.loads(helpers.read_file(ROOT/'npm-vendor-inventory.json', 1024*1024))
        node, npm = helpers.inspect_placement(prefix, pins, inventory)
        result.update(toolchainPlacementProven=True, nodePath=str(node), npmCliPath=str(npm),
                      nodeSha256=pins['nodeSha256'], npmInventorySha256=pins['npmInventorySha256'])
        version = subprocess.check_output([str(node), '--version'], cwd=temporary,
                     env=helpers.ENV, stderr=subprocess.DEVNULL, timeout=15)
        assert version == (pins['nodeVersion']+'\n').encode()
        result['linuxExecutionProven'] = True
        phase = 'clean-source-clone'
        sha = context['GITHUB_SHA']
        assert git_output(['rev-parse', 'HEAD'], workspace, helpers).decode().strip() == sha
        attempt = temporary/('order-hosted-attempt-'+context['GITHUB_RUN_ID']+'-'+context['GITHUB_RUN_ATTEMPT'])
        attempt.mkdir(mode=0o700)
        helpers.save(attempt/'started.json', {'purpose': result['purpose'], 'sourceCommit': sha, **FLAGS})
        checkout = attempt/'checkout'
        helpers.git(['clone', '--no-checkout', '--no-local', '--', str(workspace), str(checkout)], attempt)
        helpers.git(['remote', 'set-url', 'origin', 'https://github.com/'+REPOSITORY+'.git'], checkout)
        helpers.git(['checkout', '--detach', sha], checkout)
        catalog = source_catalog(checkout, sha, helpers)
        for name, expected in REUSED.items():
            assert helpers.digest(helpers.read_file(checkout/'scripts/order-hosted-preparation'/name,
                                                    1024*1024)) == expected
        reviewed = {'releaseCommit': sha, 'sourceCatalogSha256': catalog['catalogSha256'],
            'sourceFenceSha256': helpers.digest(helpers.read_file(
                checkout/'scripts/order-zero-direct-release-source.mjs', 1024*1024)),
            'nodeVersion': pins['nodeVersion'], 'nodeSha256': pins['nodeSha256'],
            'npmCli': str(npm), 'npmCliSha256': pins['npmCliSha256'], 'npmVersion': pins['npmVersion']}
        helpers.save(output/'source-observation.json', {'sourceCommit': sha, **catalog,
            'independentlyReviewedReleaseIdentity': False, **FLAGS})
        plan = attempt/'preparation-plan.json'
        helpers.save(plan, {'purpose': 'disposable-linux-preparation-only',
                           'directory': str(checkout), 'reviewed': reviewed})
        phase = 'clean-worker-preparation'
        worker_output = attempt/'worker-preparation.json'
        helpers.run_prepare([str(node), str(checkout/'scripts/order-hosted-preparation/prepare_only.mjs'),
                             str(plan), str(worker_output)], checkout)
        receipt = json.loads(helpers.read_file(worker_output, 16384))
        worker = checked_preparation(receipt)
        helpers.inspect_placement(prefix, pins, inventory)
        helpers.save(output/'worker-preparation.json', {**worker, **FLAGS})
        result.update(outcome='passed', workerPreparationProven=True, sourceCommit=sha,
                      sourceCatalogSha256=catalog['catalogSha256'])
        phase = 'closed-and-verified'
    except BaseException:
        result['failureCategory'] = 'hosted-preparation-refused-or-failed'
    result['phase'] = phase
    if output is not None and output.is_dir():
        helpers.save(output/'result.json', result)
        files = sorted(output.iterdir())
        assert all(f.name in ['context.json', 'source-observation.json', 'worker-preparation.json',
                              'result.json'] for f in files)
        manifest = ''.join(helpers.digest(helpers.read_file(f, 32768))+'  '+f.name+'\n' for f in files)
        with (output/'SHA256SUMS').open('x') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(manifest)
    print(json.dumps(result))
    return 0 if result['outcome'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
