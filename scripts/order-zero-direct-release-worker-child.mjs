// Imported only after the inline bootstrap has checked the source fence and
// complete tracked checkout. All repository/npm release imports are deferred
// until this process completes its own credential-free clean preparation.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const FAILURE = "Order dormant worker failed closed";
const FLAGS = Object.freeze({ completeProductionScope: false, productionExecutionAuthorized: false });
const PREPARATION_RESOLUTION_GUARD = `
import {registerHooks} from 'node:module';
import fs from 'node:fs'; import {fileURLToPath} from 'node:url';
const root=fs.realpathSync(process.cwd())+'/';
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);
if(!result.url.startsWith('node:')&&(!result.url.startsWith('file:')||!fs.realpathSync(fileURLToPath(result.url)).startsWith(root))) throw new Error('Preparation module fallback denied');
return result;}});
`;

// This is a same-session drift check after a clean lockfile install, not a
// portable installed-directory attestation or a substitute for npm integrity.
function installedIdentities(root) {
  const entries = []; let totalBytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file, { bigint: true });
      assert.ok(entries.length < 150000);
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync(file);
        assert.ok(target.startsWith(`${root}${path.sep}`));
        entries.push([file, fs.readlinkSync(file), String(stat.ino), String(stat.ctimeNs)]);
      } else {
        assert.ok(stat.isDirectory() || (stat.isFile() && stat.nlink === 1n));
        totalBytes += Number(stat.size); assert.ok(totalBytes <= 4 * 1024 ** 3);
        entries.push([file, ...["dev", "ino", "size", "mode", "mtimeNs", "ctimeNs", "nlink"].map(key => String(stat[key]))]);
        if (stat.isDirectory()) visit(file);
      }
    }
  }
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(root) === root);
  visit(root);
  return digest(JSON.stringify(entries));
}

export async function runOrderZeroDirectWorker({ reviewed, fence, source }) {
  const root = process.cwd(), node = fs.realpathSync(process.execPath);
  const allowed = ["LANG", "LC_ALL", "PATH", "TZ"];
  if (process.platform === "darwin" && process.env.__CF_USER_TEXT_ENCODING !== undefined) {
    assert.match(process.env.__CF_USER_TEXT_ENCODING, /^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/iu);
    allowed.push("__CF_USER_TEXT_ENCODING");
  }
  assert.deepEqual(Object.keys(process.env).sort(), allowed.sort());
  assert.ok(process.send && process.connected);
  let state = "unprepared", preparationStage = "none", busy = false, expectedId = 1, session, installed, graph;
  const sourceHandle = source;
  let artifact, activeAdmission, lastScope, client, timer, admissionClaim;
  const sessionId = randomUUID();
  const summary = () => ({ workerPid: process.pid, sessionId, state,
    loadedReleaseGraphProven: Boolean(graph), installedToolchainProven: Boolean(installed), ...FLAGS });
  function checkpoint() {
    if (!session) return;
    // Only bounded status and source identity, never tokens, URLs or snapshots.
    const file = path.join(session, `checkpoint-${expectedId}-${state}-${preparationStage}.json`);
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ ...summary(), preparationStage, releaseCommit: reviewed.releaseCommit })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  function fixedRoot() {
    assert.equal(process.cwd(), root); assert.equal(fs.realpathSync(root), root);
    assert.equal(process.version, reviewed.nodeVersion);
    assert.equal(digest(fs.readFileSync(node)), reviewed.nodeSha256);
  }
  function sourceCheck() { fixedRoot(); fence.verify(sourceHandle); }
  function toolchainCheck() {
    sourceCheck(); assert.ok(installed);
    assert.equal(installedIdentities(path.join(root, "node_modules")), installed);
  }
  async function command(args, restrictModules = true) {
    fixedRoot();
    return new Promise((resolve, reject) => {
      const actualArgs = restrictModules ? ["--import", `data:text/javascript,${encodeURIComponent(PREPARATION_RESOLUTION_GUARD)}`, ...args] : args;
      const child = spawn(node, actualArgs, { cwd: root, stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: `${path.dirname(node)}:/usr/bin:/bin`, HOME: path.join(session, "home"),
          XDG_CACHE_HOME: path.join(session, "cache"), TMPDIR: path.join(session, "tmp"),
          TZ: "UTC", LANG: "C", LC_ALL: "C", CHECKPOINT_DISABLE: "1" } });
      let count = 0;
      const timeout = setTimeout(() => child.kill("SIGKILL"), 480000);
      for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
        count += bytes.length; if (count > 1024 * 1024) child.kill("SIGKILL");
      });
      child.once("error", () => { clearTimeout(timeout); reject(new Error(FAILURE)); });
      child.once("exit", code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(FAILURE)); });
    });
  }
  async function prepare() {
    assert.equal(state, "unprepared"); sourceCheck();
    // Never npm-ci over an existing installation or admit ignored env/config.
    const ignored = execFileSync("/usr/bin/git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
      cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    assert.equal(ignored, "");
    assert.ok(!fs.existsSync(path.join(root, "node_modules")) && !fs.existsSync(path.join(root, ".npmrc")));
    assert.equal(fs.realpathSync(reviewed.npmCli), reviewed.npmCli);
    assert.equal(digest(fs.readFileSync(reviewed.npmCli)), reviewed.npmCliSha256);
    const npmPackage = JSON.parse(fs.readFileSync(path.resolve(reviewed.npmCli, "../../package.json"), "utf8"));
    assert.equal(npmPackage.name, "npm"); assert.equal(npmPackage.version, reviewed.npmVersion);
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!name) continue;
      assert.ok(!entry.link);
      if (entry.resolved) assert.ok(new URL(entry.resolved).origin === "https://registry.npmjs.org");
      assert.ok(entry.integrity || entry.inBundle);
    }
    // mkdir is the exclusive checkout claim. A failed/exited worker's claim is
    // preserved; a successor must use a new clean checkout, never steal it.
    const claim = path.join(path.dirname(root), `.order-release-${path.basename(root)}`);
    fs.mkdirSync(claim, { mode: 0o700 }); session = claim;
    for (const name of ["home", "cache", "tmp", "artifacts"]) fs.mkdirSync(path.join(session, name), { mode: 0o700 });
    for (const name of ["user-npmrc", "global-npmrc"]) fs.closeSync(fs.openSync(path.join(session, name), "wx", 0o600));
    state = "preparing"; preparationStage = "disk-guard"; checkpoint();
    await command(["scripts/guard-local-disk-headroom.mjs"]);
    preparationStage = "install"; checkpoint();
    await command([reviewed.npmCli, "ci", "--ignore-scripts", "--include=dev", "--no-audit", "--no-fund",
      "--registry=https://registry.npmjs.org", `--userconfig=${path.join(session, "user-npmrc")}`, `--globalconfig=${path.join(session, "global-npmrc")}`,
      `--cache=${path.join(session, "cache/npm")}`], false);
    sourceCheck();
    preparationStage = "engine-download"; checkpoint();
    await command(["--input-type=module", "--eval",
      "import engines from '@prisma/engines'; import fetchEngine from '@prisma/fetch-engine'; await engines.ensureNeededBinariesExist({download: fetchEngine.download});"]);
    preparationStage = "client-generation"; checkpoint();
    await command(["node_modules/prisma/build/index.js", "generate"]);
    sourceCheck();
    preparationStage = "generated-identity"; checkpoint();
    // Explicit engine identity and generated client presence are required even
    // if the installer/generator reports success without producing its outputs.
    const engines = JSON.parse(fs.readFileSync("node_modules/@prisma/engines/package.json", "utf8"));
    assert.equal(engines.version, lock.packages["node_modules/@prisma/engines"].version);
    const engineFiles = fs.readdirSync("node_modules/@prisma/engines").filter(name => /^schema-engine-/u.test(name) && !name.endsWith(".sha256"));
    assert.equal(engineFiles.length, 1);
    const engine = path.join(root, "node_modules/@prisma/engines", engineFiles[0]);
    assert.ok(fs.lstatSync(engine).isFile() && fs.lstatSync(engine).nlink === 1);
    const engineVersion = execFileSync(engine, ["--version"], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C", LC_ALL: "C" } });
    const engineCommit = engines.dependencies["@prisma/engines-version"].split(".").at(-1);
    assert.match(engineCommit, /^[a-f0-9]{40}$/u); assert.ok(engineVersion.includes(engineCommit));
    assert.ok(fs.statSync("node_modules/.prisma/client/index.js").size > 0);
    assert.ok(fs.statSync("node_modules/.prisma/client/index.d.ts").size > 0);
    installed = installedIdentities(path.join(root, "node_modules"));
    toolchainCheck(); state = "installed"; preparationStage = "complete"; checkpoint();
    return summary();
  }

  async function loadGraph(payload) {
    assert.equal(state, "installed"); toolchainCheck();
    assert.deepEqual(Object.keys(payload).sort(), ["ci", "githubToken"]);
    assert.deepEqual(Object.keys(payload.ci).sort(), ["ciRunAttempt", "ciRunId"]);
    // The token arrives only after every installation/generation child exited.
    // This fixed collector imports built-ins and the already-verified fence.
    const load = relative => import(pathToFileURL(path.join(root, relative)).href);
    const ciModule = await load("scripts/order-zero-direct-release-ci.mjs");
    await ciModule.collectOrderZeroDirectCiBinding({ directory: root,
      reviewed: { ...payload.ci, releaseCommit: reviewed.releaseCommit, sourceCatalogSha256: reviewed.sourceCatalogSha256 },
      githubToken: payload.githubToken });
    toolchainCheck();
    // Node's ancestor node_modules lookup survives NODE_PATH removal. Both ESM
    // and CommonJS resolution must stay in this checkout (or Node built-ins).
    registerHooks({ resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      if (!result.url.startsWith("node:")) {
        assert.ok(result.url.startsWith("file:"));
        const resolved = fs.realpathSync(fileURLToPath(result.url));
        assert.ok(resolved.startsWith(`${root}${path.sep}`), "ambient module fallback denied");
      }
      return result;
    } });
    preparationStage = "graph-import"; checkpoint();
    // No release graph was imported by this process before clean preparation.
    const scopeModule = await load("scripts/order-zero-direct-release-scope.mjs");
    const filesModule = await load("scripts/order-zero-direct-release-files.mjs");
    const admissionModule = await load("scripts/order-zero-direct-release-admission.mjs");
    const environmentModule = await load("scripts/guard-production-migration-runner.mjs");
    const postgresModule = await load("scripts/postgres-url-safety.mjs");
    const { default: pg } = await import(pathToFileURL(path.join(root, "node_modules/pg/lib/index.js")).href);
    graph = { scope: scopeModule.createOrderZeroDirectReleaseScope(), files: filesModule.createOrderZeroDirectFileFence(),
      ci: ciModule.collectOrderZeroDirectCiBinding, admission: admissionModule.observeOrderReleaseAdmission,
      parseEnvironment: environmentModule.parseProductionMigrationEnvironment,
      channelBinding: postgresModule.postgresChannelBindingClientOptions, Client: pg.Client };
    toolchainCheck(); state = "prepared"; checkpoint();
    return summary();
  }

  async function freshAdmission(payload) {
    assert.ok(graph);
    assert.deepEqual(Object.keys(payload).sort(), ["admission", "ci", "githubToken", "ownerUrl", "ownerUrlSha256"]);
    toolchainCheck();
    assert.deepEqual(Object.keys(payload.ci).sort(), ["ciRunAttempt", "ciRunId"]);
    await graph.admission({ releaseCommit: reviewed.releaseCommit, admission: payload.admission, githubToken: payload.githubToken });
    // GitHub serializes runs globally; this exclusive per-run/attempt host claim
    // rejects two worker processes inside the same admitted job/run. It is not
    // a replacement for GitHub's shared concurrency group. Never steal a claim.
    const claimPath = path.join(fs.realpathSync(os.tmpdir()),
      `grainline-order-admission-${process.getuid()}-${payload.admission.runId}-${payload.admission.runAttempt}`);
    if (!admissionClaim) {
      fs.mkdirSync(claimPath, { mode: 0o700 });
      admissionClaim = { path: claimPath, stat: fs.lstatSync(claimPath, { bigint: true }) };
    }
    assert.equal(claimPath, admissionClaim.path);
    const checkClaim = () => {
      const claimStat = fs.lstatSync(claimPath, { bigint: true });
      assert.ok(claimStat.isDirectory() && !claimStat.isSymbolicLink());
      for (const key of ["dev", "ino", "mode", "uid", "ctimeNs"]) assert.equal(claimStat[key], admissionClaim.stat[key]);
    };
    checkClaim();
    await graph.ci({ directory: root, reviewed: { ...payload.ci, releaseCommit: reviewed.releaseCommit,
      sourceCatalogSha256: reviewed.sourceCatalogSha256 }, githubToken: payload.githubToken });
    await graph.admission({ releaseCommit: reviewed.releaseCommit, admission: payload.admission, githubToken: payload.githubToken });
    checkClaim();
    toolchainCheck();
    const environment = graph.parseEnvironment({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main", GITHUB_SHA: reviewed.releaseCommit,
      PRODUCTION_MIGRATION_RELEASE_COMMIT: reviewed.releaseCommit,
      PRODUCTION_MIGRATION_CONFIRM: "run-reviewed-production-migrations-from-main",
      RUNTIME_DB_ROLE: "grainline_app_runtime", MIGRATION_DB_ROLE: "neondb_owner",
      DIRECT_URL: payload.ownerUrl, PRODUCTION_MIGRATION_DIRECT_URL_SHA256: payload.ownerUrlSha256 });
    return environment.directUrl;
  }
  async function snapshot(payload) {
    const url = await freshAdmission(payload);
    client = new graph.Client({ connectionString: url, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, query_timeout: 35000, application_name: "grainline-order-dormant-scope",
      options: "-c default_transaction_read_only=on", ...graph.channelBinding(new URL(url)) });
    client.on("error", fail);
    try {
      await client.connect();
      const observed = await graph.scope.readAuditedSnapshot(client, "restart");
      graph.scope.assertAuditedSnapshot(observed, "restart");
      // Admission must still exist when asynchronous catalog/inventory work ends.
      await freshAdmission(payload);
      return observed;
    } finally { const ending = client; client = undefined; await ending?.end(); }
  }
  async function inspect(payload) {
    assert.equal(state, "prepared");
    const observed = await snapshot(payload);
    artifact = graph.files.stage(observed.ledgerRows, path.join(session, "artifacts"));
    graph.files.verify(artifact); toolchainCheck();
    lastScope = graph.scope.plan(observed);
    activeAdmission = JSON.stringify(payload.admission);
    state = "inspected"; checkpoint();
    // No credentials, raw catalog, client or transferable artifact handle exits.
    return { ...summary(), prefixLength: lastScope.prefixLength, remainingMemberCount: artifact.remainingMigrations.length,
      steps: lastScope.steps, freshDatabaseScopeObserved: true };
  }
  async function revalidate(payload) {
    assert.equal(state, "inspected"); assert.equal(JSON.stringify(payload.admission), activeAdmission);
    const observed = await snapshot(payload);
    const plan = graph.scope.plan(observed);
    assert.equal(plan.prefixLength, lastScope.prefixLength, "scope changed since staging");
    graph.files.verify(artifact); toolchainCheck();
    return { ...summary(), prefixLength: plan.prefixLength, freshDatabaseScopeObserved: true };
  }
  function fail() {
    state = "failed"; activeAdmission = undefined; artifact = undefined; lastScope = undefined;
    try { checkpoint(); } catch { /* Existing recovery records survive. */ }
    try { process.send?.({ id: expectedId - 1, ok: false }); } catch { /* Parent gone. */ }
    try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); }
  }
  // The parent must keep polling/using this process. Idle admission is discarded
  // with the process; serialized evidence never resumes a dead worker.
  function deadline() { clearTimeout(timer); timer = setTimeout(fail, 600000); }
  process.on("disconnect", fail);
  process.on("message", async message => {
    if (busy || !message || message.id !== expectedId || Buffer.byteLength(JSON.stringify(message)) > 32768) return fail();
    busy = true; expectedId++; deadline();
    try {
      assert.deepEqual(Object.keys(message).sort(), ["command", "id", "payload"]);
      let result;
      if (["ready", "status", "prepare"].includes(message.command)) assert.deepEqual(message.payload, {});
      if (message.command === "ready") { assert.equal(expectedId, 2); result = summary(); }
      else if (message.command === "prepare") result = await prepare();
      else if (message.command === "load") result = await loadGraph(message.payload);
      else if (message.command === "status") { if (installed) toolchainCheck(); else sourceCheck(); result = summary(); }
      else if (message.command === "inspect") result = await inspect(message.payload);
      else if (message.command === "revalidate") result = await revalidate(message.payload);
      else throw new Error(FAILURE); // In particular: no execute/migrate/resolve.
      process.send({ id: message.id, ok: true, result }); busy = false;
    } catch { fail(); }
  });
  deadline();
}
