"""Host-only contract tests. No Linux preparation, network, token or DB access."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hosted_proof',
    ROOT/'scripts/order-hosted-preparation/hosted_prepare.py')
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)
download_spec = importlib.util.spec_from_file_location('download_proof',
    ROOT/'scripts/order-hosted-preparation/verify_download.py')
download = importlib.util.module_from_spec(download_spec)
download_spec.loader.exec_module(download)


def artifact_fixture(change=None):
    flags = {key: False for key in download.FALSE_FIELDS}
    objects = {
        'context.json': {**valid_context(), **flags},
        'source-observation.json': {'sourceCommit': 'a'*40, 'catalogSha256': 'b'*64,
                                   'independentlyReviewedReleaseIdentity': False, **flags},
        'worker-preparation.json': {'workerClosed': True, 'installedToolchainProven': True,
                                    'state': 'installed', **flags},
        'result.json': {'outcome': 'passed', 'phase': 'closed-and-verified',
            'sourceCommit': 'a'*40, 'sourceCatalogSha256': 'b'*64, 'workerPreparationProven': True,
            'linuxExecutionProven': True, 'toolchainPlacementProven': True,
            'hostedContextObserved': True, **flags},
    }
    if change: change(objects)
    data = {name: json.dumps(value).encode() for name, value in objects.items()}
    sums = ''.join(hashlib.sha256(raw).hexdigest()+'  '+name+'\n' for name, raw in sorted(data.items()))
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for name, raw in data.items(): archive.writestr(name, raw)
        archive.writestr('SHA256SUMS', sums)
    raw = stream.getvalue()
    metadata = {'runnerVersion': '2.327.1', 'run': {'id': 123, 'run_attempt': 1,
        'head_sha': 'a'*40, 'head_branch': proof.BRANCH, 'event': 'push',
        'path': proof.WORKFLOW, 'status': 'completed', 'conclusion': 'success'},
        'artifact': {'id': 456, 'name': 'order-hosted-preparation-123-1', 'expired': False,
            'digest': 'sha256:'+hashlib.sha256(raw).hexdigest(),
            'workflow_run': {'id': 123, 'head_sha': 'a'*40}}}
    return raw, metadata


def valid_context():
    return {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': proof.REPOSITORY,
        'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/'+proof.BRANCH,
        'GITHUB_WORKFLOW_REF': proof.REPOSITORY+'/'+proof.WORKFLOW+'@refs/heads/'+proof.BRANCH,
        'GITHUB_JOB': 'prepare', 'RUNNER_ENVIRONMENT': 'github-hosted',
        'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
        'ImageVersion': '20260907.1.0', 'GITHUB_SHA': 'a'*40,
        'GITHUB_WORKFLOW_SHA': 'a'*40, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}


class HostedPreparationTests(unittest.TestCase):
    def test_artifact_consistency_never_becomes_authenticated_acceptance(self):
        raw, metadata = artifact_fixture()
        result = download.verify(raw, metadata, 'a'*40)
        self.assertTrue(result['offlineConsistencyVerified'])
        self.assertFalse(result['providerMetadataAuthenticatedByThisVerifier'])
        self.assertFalse(result['hostedRunnerAcceptanceProven'])

    def test_artifact_rejects_stale_run_digest_version_and_authority(self):
        raw, metadata = artifact_fixture()
        with self.assertRaises(AssertionError): download.verify(raw+b'changed', metadata, 'a'*40)
        with self.assertRaises(AssertionError): download.verify(raw, metadata, 'c'*40)
        metadata['runnerVersion'] = '2.326.0'
        with self.assertRaises(AssertionError): download.verify(raw, metadata, 'a'*40)
        raw, metadata = artifact_fixture(lambda objects: objects['result.json'].update(productionExecutionAuthorized=True))
        with self.assertRaises(AssertionError): download.verify(raw, metadata, 'a'*40)

    def test_artifact_rejects_extra_path_even_with_matching_provider_digest(self):
        raw, metadata = artifact_fixture()
        stream = io.BytesIO(raw)
        with zipfile.ZipFile(stream, 'a') as archive: archive.writestr('../private-cache', 'unwanted')
        changed = stream.getvalue()
        metadata['artifact']['digest'] = 'sha256:'+hashlib.sha256(changed).hexdigest()
        with self.assertRaises(AssertionError): download.verify(changed, metadata, 'a'*40)

    def test_self_hosted_wrong_source_workflow_event_or_image_refused(self):
        for key, bad in {'RUNNER_ENVIRONMENT': 'self-hosted', 'GITHUB_EVENT_NAME': 'pull_request_target',
            'GITHUB_SHA': 'b'*40, 'GITHUB_WORKFLOW_SHA': 'b'*40, 'GITHUB_REPOSITORY': 'foreign/repo',
            'GITHUB_REF': 'refs/heads/main', 'ImageOS': 'ubuntu22', 'RUNNER_ARCH': 'ARM64',
            'GITHUB_JOB': 'production', 'GITHUB_WORKFLOW_REF': 'other', 'GITHUB_RUN_ID': '../secret',
            'GITHUB_RUN_ATTEMPT': '0', 'ImageVersion': 'unbounded\nmetadata'}.items():
            with self.subTest(key=key), self.assertRaises(AssertionError):
                proof.hosted_context({**valid_context(), key: bad})

    def test_context_never_exports_ambient_credentials(self):
        context = proof.hosted_context({**valid_context(), 'DATABASE_URL': 'secret-marker',
            'GITHUB_TOKEN': 'secret-marker', 'NODE_OPTIONS': '--import=secret-marker',
            'SSL_CERT_FILE': 'secret-marker'})
        self.assertNotIn('secret-marker', json.dumps(context))
        self.assertFalse(proof.FLAGS['hostedRunnerAcceptanceProven'])

    def test_reused_helpers_exact_and_environment_constant(self):
        helpers = proof.load_helpers()
        self.assertEqual(helpers.ENV, {'PATH': '/usr/bin:/bin', 'TZ': 'UTC', 'LANG': 'C', 'LC_ALL': 'C'})
        self.assertNotIn('DATABASE_URL', helpers.GIT_ENV)

    def test_corrupted_helper_rejected_before_import(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            for name in proof.REUSED:
                (root/name).write_bytes((proof.ROOT/name).read_bytes())
            (root/'run_linux.py').write_text("raise RuntimeError('must not execute')\n")
            with patch.object(proof, 'ROOT', root), self.assertRaises(AssertionError):
                proof.load_helpers()

    def test_receipt_cannot_claim_graph_or_production_authority(self):
        receipt = {'purpose': 'disposable-linux-preparation-only', 'workerClosed': True,
            'installedToolchainProven': True, 'state': 'installed', 'workerPid': 123,
            'sessionId': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
            'productionExecutionAuthorized': False, 'completeProductionScope': False,
            'loadedReleaseGraphProven': False, 'hostedRunnerAcceptanceProven': False}
        self.assertTrue(proof.checked_preparation(receipt)['workerClosed'])
        for key in ['productionExecutionAuthorized', 'completeProductionScope',
                    'loadedReleaseGraphProven', 'hostedRunnerAcceptanceProven']:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                proof.checked_preparation({**receipt, key: True})
        for key in ['workerClosed', 'installedToolchainProven']:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                proof.checked_preparation({**receipt, key: False})

    def test_existing_evidence_directory_is_preserved(self):
        helpers = proof.load_helpers()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            workspace = root/'workspace'; workspace.mkdir()
            temporary = root/'temporary'; temporary.mkdir()
            evidence = temporary/'order-hosted-evidence'; evidence.mkdir()
            marker = evidence/'retained.txt'; marker.write_text('prior failed evidence')
            context = {**valid_context(), 'GITHUB_WORKSPACE': str(workspace), 'RUNNER_TEMP': str(temporary)}
            with patch.object(proof, 'load_helpers', return_value=helpers), \
                 patch.object(helpers, 'require_linux'), patch.dict(os.environ, context, clear=True), \
                 patch.object(sys, 'argv', ['hosted_prepare.py', str(workspace), '/unused/node']), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(proof.main(), 1)
            self.assertEqual(list(evidence.iterdir()), [marker])
            self.assertEqual(marker.read_text(), 'prior failed evidence')

    def test_actual_git_catalog_binds_bytes_and_rejects_drift(self):
        helpers = proof.load_helpers()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            def git(*args):
                return subprocess.check_output(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                    *args], cwd=root, env=helpers.GIT_ENV, stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q')
            (root/'example.txt').write_text('accepted fixture\n')
            git('add', 'example.txt')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            sha = git('rev-parse', 'HEAD')
            observed = proof.source_catalog(root, sha, helpers)
            expected = [['100644', 'example.txt', hashlib.sha256(b'accepted fixture\n').hexdigest()]]
            self.assertEqual(observed['catalogSha256'], hashlib.sha256(
                json.dumps(expected, separators=(',', ':')).encode()).hexdigest())
            (root/'example.txt').write_text('drift\n')
            with self.assertRaises(AssertionError): proof.source_catalog(root, sha, helpers)

    def test_workflow_confines_trigger_and_upload(self):
        workflow = (ROOT/proof.WORKFLOW).read_text()
        self.assertIn('branches: ['+proof.BRANCH+']', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('contents: read', workflow)
        self.assertIn('timeout-minutes: 20', workflow)
        self.assertIn('retention-days: 14', workflow)
        self.assertIn('path: ${{ runner.temp }}/order-hosted-evidence/', workflow)
        for forbidden in ['secrets.', 'environment:', 'workflow_dispatch:', 'pull_request:',
                          'pull_request_target:', 'id-token:', 'services:', 'npm ci', 'migrate',
                          'continue-on-error:', 'cancel-in-progress: true']:
            self.assertNotIn(forbidden, workflow)
        vercel = json.loads((ROOT/'vercel.json').read_text())
        self.assertIs(vercel['git']['deploymentEnabled'][proof.BRANCH], False)
        self.assertIs(vercel['git']['deploymentEnabled']['main'], False)


if __name__ == '__main__':
    unittest.main(verbosity=2)
