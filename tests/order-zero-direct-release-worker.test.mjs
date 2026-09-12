import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOrderZeroDirectSourceFence } from "../scripts/order-zero-direct-release-source.mjs";
import { startOrderZeroDirectWorker } from "../scripts/order-zero-direct-release-worker.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const engineCommit = "a".repeat(40);

// Actual processes and Git checkouts; fixture npm/engine/graph deliberately
// exercise the protocol without downloads or production credentials. They do
// not claim native PostgreSQL or real-package preparation acceptance.
function fixture(t, options = {}) {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-worker-test-"));
  const directory = path.join(parent, "checkout"); fs.mkdirSync(directory);
  const control = path.join(parent, "control.json"), events = path.join(parent, "events.jsonl");
  fs.writeFileSync(control, JSON.stringify({ prefix: 0, admission: true, ci: true }));
  const write = (name, text) => { const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const git = args => execFileSync("/usr/bin/git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["remote", "add", "origin", "https://github.com/Drewyoung910/grainline.git"]);
  for (const name of ["order-zero-direct-release-source.mjs", "order-zero-direct-release-worker-child.mjs", "guard-local-disk-headroom.mjs"]) {
    write(`scripts/${name}`, fs.readFileSync(`scripts/${name}`, "utf8"));
  }
  write(".gitignore", "/node_modules\n.env*\n");
  write("package.json", '{"name":"fixture","version":"1.0.0"}');
  write("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: {
    "": { name: "fixture" }, "node_modules/@prisma/engines": { version: "7.9.0", integrity: "fixture-only" },
  } }));
  const helper = `import fs from 'node:fs'; import assert from 'node:assert/strict';
const control=${JSON.stringify(control)}, events=${JSON.stringify(events)};
const state=()=>JSON.parse(fs.readFileSync(control,'utf8'));
const log=value=>fs.appendFileSync(events,JSON.stringify(value)+'\\n');
assert.equal(process.cwd(),${JSON.stringify(directory)});
`;
  write("scripts/order-zero-direct-release-scope.mjs", `${helper}
${options.ancestorImport ? "await import('ancestor-only');" : ""}
log({event:'graph-import',pid:process.pid});
export function createOrderZeroDirectReleaseScope(){ return {
 async readAuditedSnapshot(client){
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try { const s=state(); assert.ok(Number.isInteger(s.prefix)&&s.prefix>=0&&s.prefix<=17&&!s.partial);
     if(s.dropAdmission) fs.writeFileSync(control,JSON.stringify({...s,admission:false}));
     return {ledgerRows:[{prefix:s.prefix}]};
   } finally {await client.query('ROLLBACK');}
 }, assertAuditedSnapshot(){},
 plan(s){return {prefixLength:s.ledgerRows[0].prefix,steps:['reinspect-exact-complete-prefix','converge-reviewed-runtime-grants','migration-status','global-grant-and-RLS-audit','final-read-only-prefix-scope']};}
}; }
`);
  write("scripts/order-zero-direct-release-files.mjs", `${helper}
export function createOrderZeroDirectFileFence(){ const handles=new WeakSet(); return {
stage(rows,parent){const h={remainingMigrations:Array(17-rows[0].prefix).fill('member')};handles.add(h);log({event:'stage',prefix:rows[0].prefix});fs.writeFileSync(parent+'/fixture-artifact','fixed');return h;},
verify(h){assert.ok(handles.has(h));assert.equal(fs.readFileSync(${JSON.stringify(path.join(parent, ".order-release-checkout/artifacts/fixture-artifact"))},'utf8'),'fixed');}
};}
`);
  write("scripts/order-zero-direct-release-ci.mjs", `${helper}
export async function collectOrderZeroDirectCiBinding(){log({event:'ci'});assert.ok(state().ci);if(state().removeClaim)fs.rmdirSync(state().removeClaim);}
`);
  write("scripts/order-zero-direct-release-admission.mjs", `${helper}
export async function observeOrderReleaseAdmission(){log({event:'admission'});assert.ok(state().admission);}
`);
  write("scripts/guard-production-migration-runner.mjs", `${helper}
export function parseProductionMigrationEnvironment(env){log({event:'owner-validation'});assert.equal(env.DIRECT_URL,'postgresql://fixture.invalid/never-connect');return {directUrl:env.DIRECT_URL};}
`);
  write("scripts/postgres-url-safety.mjs", "export const postgresChannelBindingClientOptions=()=>({});\n");
  write("scripts/order-zero-direct-execution-disposable.mjs", `${helper}
export async function runDisposableOrderExecution(options){
assert.equal(options.databaseUrl,'postgresql://ci:ci@127.0.0.1:5432/grainline_ci');
assert.equal(options.githubActions,false);await options.guard();
log({event:'disposable-execution',pid:process.pid});return {productionExecutionAuthorized:false,fixtureOnly:true};
}\n`);
  const fakePg = `${helper}
export default {Client:class {
constructor(options){assert.equal(options.options,'-c default_transaction_read_only=on');}
on(){} async connect(){log({event:'connect',pid:process.pid});}
async query(sql){log({event:'query',sql});return {rows:[]};} async end(){log({event:'disconnect'});}
}};
`;
  const npmRoot = path.join(parent, "npm"), npmCli = path.join(npmRoot, "bin/npm-cli.js");
  if (options.ancestorImport) {
    const ancestor = path.join(parent, "node_modules/ancestor-only"); fs.mkdirSync(ancestor, { recursive: true });
    fs.writeFileSync(path.join(ancestor, "index.js"), "throw new Error('ambient-code-executed');");
  }
  fs.mkdirSync(path.dirname(npmCli), { recursive: true });
  fs.writeFileSync(path.join(npmRoot, "package.json"), '{"name":"npm","version":"10.9.3"}');
  const installed = {
    "@prisma/engines/package.json": JSON.stringify({ name: "@prisma/engines", version: "7.9.0", type: "module", main: "index.js", dependencies: { "@prisma/engines-version": `7.9.0-1.${engineCommit}` } }),
    "@prisma/engines/index.js": `export default {async ensureNeededBinariesExist({download}){await download();}};`,
    "@prisma/fetch-engine/package.json": '{"type":"module","main":"index.js"}',
    "@prisma/fetch-engine/index.js": `import fs from 'node:fs'; export default {async download(){${options.missingEngine ? "" : `fs.writeFileSync('node_modules/@prisma/engines/schema-engine-fixture',${JSON.stringify(`#!/bin/sh\necho schema-engine ${engineCommit}\n`)},{mode:0o700});`}}};`,
    "prisma/build/index.js": `const fs=require('node:fs');fs.mkdirSync('node_modules/.prisma/client',{recursive:true});${options.missingClient ? "" : "fs.writeFileSync('node_modules/.prisma/client/index.js','module.exports={}');fs.writeFileSync('node_modules/.prisma/client/index.d.ts','export {}');"}`,
    "pg/package.json": '{"type":"module"}', "pg/lib/index.js": fakePg,
  };
  fs.writeFileSync(npmCli, `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
assert.equal(process.argv[2],'ci');assert.ok(process.argv.includes('--ignore-scripts')&&process.argv.includes('--include=dev'));
assert.ok(!Object.keys(process.env).some(k=>/^(NODE_OPTIONS|NODE_PATH|DATABASE_URL|DIRECT_URL|GH_TOKEN|HTTPS_PROXY|PRISMA_)/.test(k)));
fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({event:'install',keys:Object.keys(process.env).sort()})+'\\n');
for(const [name,content] of Object.entries(${JSON.stringify(installed)})){const file=path.join('node_modules',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
`);
  git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]);
  const releaseCommit = git(["rev-parse", "HEAD"]);
  const source = createOrderZeroDirectSourceFence(directory, releaseCommit).capture();
  const reviewed = { releaseCommit, sourceCatalogSha256: source.catalogSha256,
    sourceFenceSha256: hash(fs.readFileSync(path.join(directory, "scripts/order-zero-direct-release-source.mjs"))),
    nodeSha256: hash(fs.readFileSync(process.execPath)), nodeVersion: process.version,
    npmCli, npmCliSha256: hash(fs.readFileSync(npmCli)), npmVersion: "10.9.3" };
  const workers = [];
  const runId = String(Math.floor(Math.random() * 10 ** 14) + 1);
  const payload = { admission: { runId, runAttempt: "1", jobId: "123" }, ci: { ciRunId: "456", ciRunAttempt: "1" },
    githubToken: "fixture-token", ownerUrl: "postgresql://fixture.invalid/never-connect", ownerUrlSha256: "b".repeat(64) };
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.close()));
    fs.rmSync(parent, { recursive: true, force: true });
    // The scrubbed child has no inherited TMPDIR; its OS temp root is /tmp.
    fs.rmSync(path.join(fs.realpathSync("/tmp"), `grainline-order-admission-${process.getuid()}-${runId}-1`), { recursive: true, force: true });
  });
  return { directory, reviewed, payload,
    start: async (overrides = {}) => {
      const worker = await startOrderZeroDirectWorker({ directory, reviewed, ...overrides }); workers.push(worker);
      return Object.freeze({ ...worker, installOnly: worker.prepare,
        prepare: async () => { await worker.prepare(); return worker.load({ ci: payload.ci, githubToken: payload.githubToken }); } });
    },
    change: changes => fs.writeFileSync(control, JSON.stringify({ ...JSON.parse(fs.readFileSync(control)), ...changes })),
    events: () => fs.existsSync(events) ? fs.readFileSync(events, "utf8").trim().split("\n").map(JSON.parse) : [],
    artifact: path.join(parent, ".order-release-checkout/artifacts/fixture-artifact"),
    claim: path.join(fs.realpathSync("/tmp"), `grainline-order-admission-${process.getuid()}-${runId}-1`),
  };
}

test("one persistent worker prepares before graph import and excludes ambient credentials and overrides", async t => {
  const f = fixture(t);
  const extra = { NODE_OPTIONS: "--require=/nonexistent", NODE_PATH: "/nonexistent", DIRECT_URL: "secret-fixture", DATABASE_URL: "secret-fixture", GH_TOKEN: "secret-fixture", HTTPS_PROXY: "http://invalid.example", PRISMA_ENGINES_MIRROR: "https://invalid.example" };
  const prior = Object.fromEntries(Object.keys(extra).map(k => [k, process.env[k]]));
  Object.assign(process.env, extra);
  let worker;
  try { worker = await f.start(); await worker.prepare(); }
  finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  const status = await worker.status();
  assert.notEqual(status.workerPid, process.pid); assert.equal(status.workerPid, worker.pid);
  assert.equal(status.state, "prepared"); assert.ok(status.loadedReleaseGraphProven && status.installedToolchainProven);
  assert.equal(status.productionExecutionAuthorized, false);
  assert.deepEqual(f.events().map(row => row.event), ["install", "ci", "graph-import"]);
  assert.equal(f.events()[2].pid, worker.pid);
  assert.ok(!JSON.stringify(f.events()).includes("secret-fixture"));
});

test("inspection and revalidation obtain new connections and post-admission scopes in the same process", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare();
  const inspected = await worker.inspect(f.payload);
  assert.equal(inspected.prefixLength, 0); assert.equal(inspected.remainingMemberCount, 17);
  assert.equal(inspected.productionExecutionAuthorized, false);
  await worker.revalidate(f.payload);
  const events = f.events(); assert.equal(events.filter(row => row.event === "connect").length, 2);
  assert.ok(events.filter(row => row.event === "connect").every(row => row.pid === worker.pid));
  assert.equal(events.filter(row => row.sql === "ROLLBACK").length, 2);
  assert.ok(events.findIndex(row => row.event === "ci") < events.findIndex(row => row.event === "connect"));
  assert.ok(!JSON.stringify(inspected).includes("fixture-token"));
});

test("disposable dispatch stays in the prepared process and cannot be replayed", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare();
  const payload = { databaseUrl: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci", githubActions: false };
  const result = await worker.executeDisposable(payload);
  assert.equal(result.state, "disposable-complete"); assert.equal(result.workerPid, worker.pid);
  assert.equal(result.execution.fixtureOnly, true); assert.equal(result.productionExecutionAuthorized, false);
  assert.deepEqual(f.events().filter(row => row.event === "disposable-execution"), [{ event: "disposable-execution", pid: worker.pid }]);
  await assert.rejects(worker.executeDisposable(payload));
});

test("disposable dispatch rejects credentials before preparation or unsupported production fields", async t => {
  for (const prepared of [false, true]) {
    const f = fixture(t), worker = await f.start(); if (prepared) await worker.prepare();
    await assert.rejects(worker.executeDisposable({ databaseUrl: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci", githubActions: false,
      ...(prepared ? { ownerUrl: "forbidden" } : {}) }));
    assert.ok(!f.events().some(row => row.event === "disposable-execution"));
  }
});

test("completed prefix 17 retains all final convergence and audit obligations", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare(); f.change({ prefix: 17 });
  const result = await worker.inspect(f.payload); assert.equal(result.remainingMemberCount, 0);
  assert.deepEqual(result.steps, ["reinspect-exact-complete-prefix", "converge-reviewed-runtime-grants", "migration-status", "global-grant-and-RLS-audit", "final-read-only-prefix-scope"]);
});

for (const [name, options] of [["engine", { missingEngine: true }], ["client", { missingClient: true }]]) {
  test(`missing prepared ${name} terminates before release graph import`, async t => {
    const f = fixture(t, options), worker = await f.start();
    await assert.rejects(worker.prepare(), /no execution admission/u);
    assert.ok(!f.events().some(row => row.event === "graph-import"));
  });
}

test("ignored existing dependencies and credential files cannot be adopted or overwritten", async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, ".env.local"), "FIXTURE=preserve");
  const worker = await f.start(); await assert.rejects(worker.prepare());
  assert.equal(fs.readFileSync(path.join(f.directory, ".env.local"), "utf8"), "FIXTURE=preserve");
  assert.deepEqual(f.events(), []);
});

test("worker exit invalidates its session and checkout claim cannot be resumed or stolen", async t => {
  const f = fixture(t), first = await f.start(); await first.prepare(); await first.close();
  await assert.rejects(first.status());
  const second = await f.start(); assert.notEqual(second.pid, first.pid);
  await assert.rejects(second.prepare());
  assert.equal(f.events().filter(row => row.event === "install").length, 1);
});

test("competing workers cannot prepare the same checkout", async t => {
  const f = fixture(t), first = await f.start(), second = await f.start();
  const results = await Promise.allSettled([first.prepare(), second.prepare()]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(f.events().filter(row => row.event === "install").length, 1);
});

for (const [name, change] of [
  ["dependency", f => fs.appendFileSync(path.join(f.directory, "node_modules/pg/lib/index.js"), "\n// drift")],
  ["source", f => fs.appendFileSync(path.join(f.directory, "scripts/order-zero-direct-release-scope.mjs"), "\n// drift")],
]) {
  test(`changed ${name} after import invalidates the worker before any scope`, async t => {
    const f = fixture(t), worker = await f.start(); await worker.prepare(); change(f);
    await assert.rejects(worker.inspect(f.payload)); assert.ok(!f.events().some(row => row.event === "connect"));
  });
}

for (const [name, changes] of [["lost admission", { admission: false }], ["failed CI", { ci: false }],
  ["unknown prefix", { prefix: 18 }], ["mid-member 10 failure", { prefix: 9, partial: true }],
  ["admission loss during snapshot", { dropAdmission: true }]]) {
  test(`${name} fails closed without staging or replay`, async t => {
    const f = fixture(t), worker = await f.start(); await worker.prepare(); f.change(changes);
    await assert.rejects(worker.inspect(f.payload)); assert.ok(!f.events().some(row => row.event === "stage"));
  });
}

test("stale scope and changed staged bytes cannot pass immediate revalidation", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare(); await worker.inspect(f.payload);
  f.change({ prefix: 1 }); await assert.rejects(worker.revalidate(f.payload));
});

test("artifact replacement fails immediate revalidation", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare(); await worker.inspect(f.payload);
  fs.writeFileSync(f.artifact, "changed"); await assert.rejects(worker.revalidate(f.payload));
});

test("inspection before preparation and extra executable protocol data are rejected", async t => {
  const f = fixture(t), worker = await f.start();
  await assert.rejects(worker.inspect({ ...f.payload, execute: true })); assert.deepEqual(f.events(), []);
});

test("installation finishes without credentials and failed pre-import CI never loads the graph", async t => {
  const f = fixture(t), worker = await f.start();
  const installed = await worker.installOnly();
  assert.equal(installed.state, "installed"); assert.equal(installed.loadedReleaseGraphProven, false);
  assert.deepEqual(f.events().map(row => row.event), ["install"]);
  f.change({ ci: false });
  await assert.rejects(worker.load({ ci: f.payload.ci, githubToken: f.payload.githubToken }));
  assert.ok(!f.events().some(row => row.event === "graph-import"));
});

test("ancestor node_modules cannot satisfy a release import", async t => {
  const f = fixture(t, { ancestorImport: true }), worker = await f.start();
  await assert.rejects(worker.prepare()); assert.ok(!f.events().some(row => row.event === "graph-import"));
});

test("two prepared checkouts cannot reuse the same live run admission", async t => {
  const first = fixture(t), second = fixture(t), a = await first.start(), b = await second.start();
  await a.prepare(); await b.prepare(); await a.inspect(first.payload);
  await assert.rejects(b.inspect({ ...second.payload, admission: first.payload.admission }));
  assert.ok(!second.events().some(row => row.event === "connect"));
});

test("lost local admission claim is not recreated or accepted", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare(); await worker.inspect(f.payload);
  fs.rmdirSync(f.claim);
  await assert.rejects(worker.revalidate(f.payload)); assert.equal(fs.existsSync(f.claim), false);
});

test("claim lost during awaited CI is rejected before connecting", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare();
  f.change({ removeClaim: f.claim });
  await assert.rejects(worker.inspect(f.payload));
  assert.ok(!f.events().some(row => row.event === "connect"));
});
