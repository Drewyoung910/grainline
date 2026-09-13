"""Offline consistency check of a bounded artifact and separately fetched metadata.

This does not authenticate metadata or grant production/release authority.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import zipfile

FILES = {'context.json', 'source-observation.json', 'worker-preparation.json', 'result.json', 'SHA256SUMS'}
FALSE_FIELDS = ['productionExecutionAuthorized', 'completeProductionScope',
                'loadedReleaseGraphProven', 'hostedRunnerAcceptanceProven',
                'finalMainCiAccepted', 'productionTokenHeadroomProven', 'productionEvidenceDeliveryProven']
BRANCH = 'proof/order-hosted-preparation-20260913'


def verify(raw, metadata, expected_sha):
    assert len(raw) <= 256*1024 and re.fullmatch('[0-9a-f]{40}', expected_sha)
    run, artifact = metadata['run'], metadata['artifact']
    assert run['head_sha'] == expected_sha and run['head_branch'] == BRANCH
    assert run['event'] == 'push' and run['status'] == 'completed' and run['conclusion'] == 'success'
    assert run['path'] == '.github/workflows/order-hosted-preparation.yml'
    assert str(run['id']).isdigit() and str(run['run_attempt']).isdigit()
    assert artifact['workflow_run']['id'] == run['id']
    assert artifact['workflow_run']['head_sha'] == expected_sha and artifact['expired'] is False
    assert artifact['name'] == f"order-hosted-preparation-{run['id']}-{run['run_attempt']}"
    assert artifact['digest'] == 'sha256:'+hashlib.sha256(raw).hexdigest()
    version = metadata['runnerVersion']
    assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version)
    assert tuple(map(int, version.split('.'))) >= (2, 327, 1)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        assert len(entries) == len(FILES) and {e.filename for e in entries} == FILES
        assert sum(e.file_size for e in entries) <= 128*1024
        for entry in entries:
            assert entry.file_size <= 32768 and not entry.flag_bits & 1
            assert stat.S_IFMT(entry.external_attr >> 16) in [0, stat.S_IFREG]
        data = {e.filename: archive.read(e) for e in entries}
    sums = data.pop('SHA256SUMS').decode().splitlines()
    assert len(sums) == 4
    found = set()
    for line in sums:
        digest, name = line.split('  ', 1)
        assert name in data and name not in found
        assert hashlib.sha256(data[name]).hexdigest() == digest
        found.add(name)
    objects = {name: json.loads(raw) for name, raw in data.items()}
    for value in objects.values():
        for key in FALSE_FIELDS: assert value[key] is False
    context, source, worker, result = [objects[name] for name in
        ['context.json', 'source-observation.json', 'worker-preparation.json', 'result.json']]
    assert context['GITHUB_SHA'] == context['GITHUB_WORKFLOW_SHA'] == expected_sha
    assert context['GITHUB_RUN_ID'] == str(run['id']) and context['GITHUB_RUN_ATTEMPT'] == str(run['run_attempt'])
    assert context['GITHUB_REPOSITORY'] == 'Drewyoung910/grainline'
    assert context['GITHUB_EVENT_NAME'] == 'push' and context['GITHUB_REF'] == 'refs/heads/'+BRANCH
    assert context['GITHUB_WORKFLOW_REF'] == 'Drewyoung910/grainline/.github/workflows/order-hosted-preparation.yml@refs/heads/'+BRANCH
    assert context['RUNNER_ENVIRONMENT'] == 'github-hosted'
    assert context['RUNNER_OS'] == 'Linux' and context['RUNNER_ARCH'] == 'X64' and context['ImageOS'] == 'ubuntu24'
    assert source['sourceCommit'] == result['sourceCommit'] == expected_sha
    assert source['catalogSha256'] == result['sourceCatalogSha256']
    assert re.fullmatch('[0-9a-f]{64}', source['catalogSha256'])
    assert source['independentlyReviewedReleaseIdentity'] is False
    assert result['outcome'] == 'passed' and result['phase'] == 'closed-and-verified'
    for field in ['workerPreparationProven', 'linuxExecutionProven', 'toolchainPlacementProven', 'hostedContextObserved']:
        assert result[field] is True
    assert worker['workerClosed'] is True and worker['installedToolchainProven'] is True and worker['state'] == 'installed'
    return {'offlineConsistencyVerified': True, 'sourceCommit': expected_sha,
            'runId': run['id'], 'runAttempt': run['run_attempt'],
            'artifactId': artifact['id'], 'artifactDigest': artifact['digest'],
            'providerMetadataAuthenticatedByThisVerifier': False,
            **{field: False for field in FALSE_FIELDS}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('metadata', type=Path)
    parser.add_argument('expected_sha')
    args = parser.parse_args()
    try:
        assert args.archive.stat().st_size <= 256*1024 and args.metadata.stat().st_size <= 32768
        print(json.dumps(verify(args.archive.read_bytes(), json.loads(args.metadata.read_bytes()), args.expected_sha)))
    except Exception:
        raise SystemExit('Hosted artifact verification failed; retain evidence; no acceptance') from None
