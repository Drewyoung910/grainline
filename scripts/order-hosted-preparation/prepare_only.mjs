// Built-in bootstrap for a disposable Linux preparation attempt, never a release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { observePreparation } from './prepare_lifecycle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let worker;
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  assert.equal(process.argv.length, 4);
  assert.deepEqual(Object.keys(process.env).sort(), ['LANG', 'LC_ALL', 'PATH', 'TZ']);
  const planFile = fs.realpathSync(process.argv[2]), output = process.argv[3];
  const stat = fs.lstatSync(planFile);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < 16384 && (stat.mode & 0o777) === 0o600);
  const plan = JSON.parse(fs.readFileSync(planFile));
  assert.deepEqual(Object.keys(plan).sort(), ['directory', 'purpose', 'reviewed']);
  assert.equal(plan.purpose, 'disposable-linux-preparation-only');
  assert.equal(fs.realpathSync(process.cwd()), plan.directory);
  assert.equal(process.version, plan.reviewed.nodeVersion);
  assert.equal(hash(fs.readFileSync(process.execPath)), plan.reviewed.nodeSha256);
  const fencePath = path.join(plan.directory, 'scripts/order-zero-direct-release-source.mjs');
  assert.equal(fs.realpathSync(fencePath), fencePath);
  assert.equal(hash(fs.readFileSync(fencePath)), plan.reviewed.sourceFenceSha256);
  const { createOrderZeroDirectSourceFence } = await import(pathToFileURL(fencePath).href);
  const fence = createOrderZeroDirectSourceFence(plan.directory, plan.reviewed.releaseCommit);
  const captured = fence.capture(); assert.equal(captured.catalogSha256, plan.reviewed.sourceCatalogSha256);
  fence.verify(captured);
  const { startOrderZeroDirectWorker } = await import(pathToFileURL(path.join(plan.directory, 'scripts/order-zero-direct-release-worker.mjs')).href);
  worker = await startOrderZeroDirectWorker({ directory: plan.directory, reviewed: plan.reviewed });
  const observed = await observePreparation(worker); worker = undefined;
  const fd = fs.openSync(output, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ purpose: plan.purpose, ...observed,
      workerClosed: true, hostedRunnerAcceptanceProven: false }) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
} catch {
  if (worker) await worker.close().catch(() => {});
  process.stderr.write('Disposable Linux preparation failed; retain attempt; no retry\n');
  process.exitCode = 1;
}
