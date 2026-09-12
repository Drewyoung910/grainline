// CI-only exact-prefix application. Uses the same execution core/adapter as the
// persistent worker; CI source/toolchain observations are not production pins.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createOrderZeroDirectSourceFence } from "./order-zero-direct-release-source.mjs";
import { createOrderZeroDirectReleaseScope } from "./order-zero-direct-release-scope.mjs";
import { createOrderZeroDirectFileFence } from "./order-zero-direct-release-files.mjs";
import { runDisposableOrderExecution } from "./order-zero-direct-execution-disposable.mjs";
import { startOrderZeroDirectWorker } from "./order-zero-direct-release-worker.mjs";
import { createOrderRecoveryFixture, proveOrderGrantGuardLoss } from "./order-zero-direct-execution-recovery-postgres-proof.mjs";

async function applyThroughWorker(sourceRoot, parent, env, scenario = "apply", recovery) {
  assert.ok(["apply", "pre-command-crash", "in-flight", "refuse-incomplete"].includes(scenario));
  const crashBeforeDeploy = scenario === "pre-command-crash";
  const directory = path.join(parent, "checkout");
  const git = (args, cwd = sourceRoot) => execFileSync("/usr/bin/git", args, { cwd, encoding: "utf8", timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  // A local fixture snapshot shares immutable Git objects, never installed
  // packages. Only its CI transport is modeled, explicitly inside fixture pins.
  git(["clone", "--quiet", "--shared", sourceRoot, directory]);
  git(["remote", "set-url", "origin", "https://github.com/Drewyoung910/grainline.git"], directory);
  fs.writeFileSync(path.join(directory, "scripts/order-zero-direct-release-ci.mjs"),
    "// DISPOSABLE FIXTURE ONLY: no authenticated CI or production admission.\nexport async function collectOrderZeroDirectCiBinding(){return {fixtureOnly:true};}\n");
  if (crashBeforeDeploy || scenario === "in-flight") {
    // Failure injection lives only in this private, separately pinned fixture.
    // The real executor has no fault knob or alternate migration command.
    const file = path.join(directory, "scripts/order-zero-direct-execution.mjs"), bytes = fs.readFileSync(file, "utf8");
    const boundary = 'await prisma(["migrate", "deploy", "--config", prepared.config], checkpoint);';
    assert.equal(bytes.split(boundary).length, 2);
    const injection = crashBeforeDeploy ? 'process.kill(process.pid, "SIGKILL");' : `
      const {ORDER_EXECUTOR_PAUSE_MEMBER_TEN_SQL}=await import('./order-zero-direct-execution-recovery-postgres-proof.mjs');
      const fixtureClient=await connect();
      try { await fixtureClient.query(ORDER_EXECUTOR_PAUSE_MEMBER_TEN_SQL); } finally { await fixtureClient.end(); }
    `;
    fs.writeFileSync(file, bytes.replace(boundary, `${injection}\n      ${boundary}`));
    git(["add", "scripts/order-zero-direct-execution.mjs"], directory);
  }
  git(["add", "scripts/order-zero-direct-release-ci.mjs"], directory);
  git(["-c", "user.name=Disposable fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Disposable execution transport fixture"], directory);
  const releaseCommit = git(["rev-parse", "HEAD"], directory);
  const handle = createOrderZeroDirectSourceFence(directory, releaseCommit).capture();
  const npmCli = fs.realpathSync(execFileSync("/usr/bin/which", ["npm"], { encoding: "utf8" }).trim());
  const npmVersion = JSON.parse(fs.readFileSync(path.resolve(npmCli, "../../package.json"))).version;
  const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const worker = await startOrderZeroDirectWorker({ directory, reviewed: { releaseCommit, sourceCatalogSha256: handle.catalogSha256,
    sourceFenceSha256: hash(path.join(directory, "scripts/order-zero-direct-release-source.mjs")),
    nodeSha256: hash(process.execPath), nodeVersion: process.version, npmCli, npmCliSha256: hash(npmCli), npmVersion } });
  try {
    process.stdout.write(`Disposable ${scenario} fixture: preparing clean worker.\n`);
    await worker.prepare();
    process.stdout.write("Disposable fixture: loading actual release graph with modeled CI transport.\n");
    await worker.load({ ci: { ciRunId: "1", ciRunAttempt: "1" }, githubToken: "disposable-transport-fixture" });
    process.stdout.write("Disposable fixture: executing bounded prefix protocol.\n");
    const payload = { databaseUrl: env.ORDER_ZERO_DIRECT_EXECUTION_PROOF_DATABASE_URL, githubActions: env.GITHUB_ACTIONS === "true" };
    if (crashBeforeDeploy || scenario === "in-flight" || scenario === "refuse-incomplete") {
      if (scenario === "in-flight") await recovery.interrupt(() => worker.executeDisposable(payload), () => worker.close());
      else await assert.rejects(worker.executeDisposable(payload));
      await worker.close();
      const artifacts = path.join(parent, ".order-release-checkout", "artifacts");
      if (scenario === "refuse-incomplete") {
        assert.deepEqual(fs.readdirSync(artifacts), []);
        return { incompleteStateRefusedBeforeStaging: true };
      }
      const journals = fs.readdirSync(artifacts).filter(name => name.startsWith("execution-journal-")); assert.equal(journals.length, 1);
      const directory = path.join(artifacts, journals[0]);
      const saved = JSON.parse(fs.readFileSync(path.join(directory, "execution.json")));
      assert.equal(saved.stage, "apply-intent"); assert.equal(saved.initialPrefix, 0);
      assert.equal(saved.releaseCommit, releaseCommit); assert.equal(saved.productionExecutionAuthorized, false);
      assert.equal(fs.statSync(path.join(directory, "execution.lock")).mode & 0o777, 0o600);
      return { crashBeforeDeployPreserved: crashBeforeDeploy, inFlightIntentPreserved: scenario === "in-flight" };
    }
    const result = await worker.executeDisposable(payload);
    assert.equal(result.workerPid, worker.pid); assert.equal(result.state, "disposable-complete");
    return result.execution;
  } finally { await worker.close(); }
}

export async function proveOrderExecution(env = process.env) {
  const sourceRoot = fs.realpathSync(process.cwd());
  // CI checkout may spell this exact repository URL without its .git suffix.
  // Normalize only that equivalent CI-fixture spelling; the real fence remains
  // unchanged and foreign origins are never converted into accepted authority.
  const origin = execFileSync("/usr/bin/git", ["remote", "get-url", "origin"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  if (env.GITHUB_ACTIONS === "true" && origin === "https://github.com/Drewyoung910/grainline") {
    execFileSync("/usr/bin/git", ["remote", "set-url", "origin", "https://github.com/Drewyoung910/grainline.git"], { cwd: sourceRoot, stdio: "pipe" });
  }
  const releaseCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  const source = createOrderZeroDirectSourceFence(sourceRoot, releaseCommit);
  const handle = source.capture();
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-execution-native-")); fs.chmodSync(parent, 0o700);
  const scope = createOrderZeroDirectReleaseScope(), files = createOrderZeroDirectFileFence();
  const options = { sourceRoot, scope, files, parent,
    binding: { releaseCommit, sourceCatalogSha256: handle.catalogSha256 },
    databaseUrl: env.ORDER_ZERO_DIRECT_EXECUTION_PROOF_DATABASE_URL,
    githubActions: env.GITHUB_ACTIONS === "true", guard: async () => { source.verify(handle); } };
  const crashParent = fs.mkdtempSync(path.join(parent, "crash-attempt-")); fs.chmodSync(crashParent, 0o700);
  const crashed = await applyThroughWorker(sourceRoot, crashParent, env, "pre-command-crash");
  assert.equal(crashed.crashBeforeDeployPreserved, true); source.verify(handle);
  const recoveryParent = fs.mkdtempSync(path.join(parent, "recovery-")); fs.chmodSync(recoveryParent, 0o700);
  const recovery = await createOrderRecoveryFixture({ ...options, parent: recoveryParent, manifest: scope.manifest });
  let incomplete;
  try {
    const failedParent = fs.mkdtempSync(path.join(parent, "inflight-attempt-")); fs.chmodSync(failedParent, 0o700);
    const failed = await applyThroughWorker(sourceRoot, failedParent, env, "in-flight", recovery);
    assert.equal(failed.inFlightIntentPreserved, true);
    incomplete = await recovery.inspectFailure();
    const refusedParent = fs.mkdtempSync(path.join(parent, "refused-attempt-")); fs.chmodSync(refusedParent, 0o700);
    const refused = await applyThroughWorker(sourceRoot, refusedParent, env, "refuse-incomplete");
    assert.equal(refused.incompleteStateRefusedBeforeStaging, true);
    await recovery.restoreBaseline(); source.verify(handle);
  } finally { await recovery.close(); }
  // A distinct fixture attempt performs its own fresh native prefix-zero
  // inspection. The failed worker and its journal are never resumed or removed.
  const applyParent = fs.mkdtempSync(path.join(parent, "apply-attempt-")); fs.chmodSync(applyParent, 0o700);
  const applied = await applyThroughWorker(sourceRoot, applyParent, env);
  assert.equal(applied.initialPrefix, 0); assert.equal(applied.appliedMemberCount, 17);
  const grantParent = fs.mkdtempSync(path.join(parent, "grant-loss-")); fs.chmodSync(grantParent, 0o700);
  const grantLoss = await proveOrderGrantGuardLoss({ ...options, parent: grantParent });
  assert.equal(grantLoss.nativeGrantTransactionAborted, true);
  // Already-complete entry still performs convergence, status and final audits.
  const complete = await runDisposableOrderExecution(options);
  assert.equal(complete.initialPrefix, 17); assert.equal(complete.appliedMemberCount, 0);
  return { status: "passed", appliedMembers: 17, completePrefixReinspection: true,
    productionChanged: false, productionExecutionAuthorized: false, completeProductionScope: false,
    sourceFixtureOnly: true, ciTransportModeled: true, persistentWorkerAppliedPrefix: true,
    crashBeforeDeployPreserved: true, historicalLedgerModeled: true,
    nativeInFlightInterruptionProven: true, nativeIncompleteLedgerRefused: true,
    failedDatabasePreserved: true, nativeFailureSnapshotPreserved: true, nativePartialDdlRemained: incomplete.nativePartialDdlRemained,
    partialDdlFixtureModeled: incomplete.partialDdlFixtureModeled,
    nativeGrantTransactionAborted: true, mutationPhaseGuardLossModeled: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(await proveOrderExecution())}\n`); }
  catch (error) {
    const phase = ["initial-scope", "prefix-deploy", "prefix-reinspection", "grant-convergence", "migration-status", "global-audit", "final-scope"].includes(error.executionPhase)
      ? error.executionPhase : "preparation";
    process.stderr.write(`Disposable Order execution proof failed at ${phase}; preserve private journal/artifact.\n`); process.exitCode = 1;
  }
}
