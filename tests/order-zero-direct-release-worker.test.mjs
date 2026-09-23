import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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
  for (const name of ["order-zero-direct-release-source.mjs", "order-zero-direct-release-worker-child.mjs", "guard-local-disk-headroom.mjs", "order-handoff-client.mjs", "order-handoff-common.mjs", "order-handoff-evidence.mjs", "order-handoff-github.mjs", "order-handoff-launch.mjs", "order-handoff-supervisor.mjs", "order-zero-direct-release-worker.mjs"]) {
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
export async function observeOrderReleaseAdmission({mode='inspect'}={}){log({event:'admission',mode});assert.ok(state().admission);}
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
  write("scripts/order-zero-direct-execution-admitted.mjs", `${helper}
import {createOrderExecutionWatch} from './order-zero-direct-execution-watch.mjs';
export function createOrderAdmittedExecutor(capabilities){return async bound=>{
const watch=createOrderExecutionWatch({verify:()=>capabilities.admit(bound),onLost:capabilities.onLost});
try {
await capabilities.admit(bound); await capabilities.readAudited(bound);
const client=await capabilities.connect(bound); await client.end();
await capabilities.prisma(bound,['migrate','status','--config','fixture-config'],()=>capabilities.admit(bound));
log({event:'admitted-fixture',pid:process.pid});return {fixtureOnly:true,status:'passed',initialPrefix:0,finalPrefix:17,appliedMemberCount:17,reviewedFunctionCount:36,migrationStatusVerified:true,globalAuthorityVerified:true,finalReadOnlyScopeVerified:true,completeProductionScope:false,productionExecutionAuthorized:false};
} finally {await watch.close();}
};}
`);
  write("scripts/order-zero-direct-execution-watch.mjs", fs.readFileSync("scripts/order-zero-direct-execution-watch.mjs", "utf8"));
  write("scripts/order-zero-direct-execution-owner.mjs", fs.readFileSync("scripts/order-zero-direct-execution-owner.mjs", "utf8"));
  write("scripts/order-zero-direct-execution-prisma.mjs", `${helper}
import {spawn} from 'node:child_process';
export async function runOrderPrefixPrisma(options){
assert.equal(options.databaseUrl,'postgresql://fixture.invalid/never-connect');
assert.deepEqual(options.args,['migrate','status','--config','fixture-config']);
await options.checkpoint();log({event:'prisma-fixture',pid:process.pid});
if(state().holdCommand){const child=spawn(process.execPath,['--eval','setInterval(()=>{},1000)'],{stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});
log({event:'pending-command',pid:child.pid});await new Promise(()=>{});}
}
`);
  // The unsupported fixture command is distinct from the real execute-prefix
  // transport. Assert unique code anchors so source drift cannot silently omit
  // either fixture injection; capture the fixture commit after both edits.
  if (options.admitted || options.unknownFixtureCommand) {
    const inject = (name, anchor, addition) => {
      const source = fs.readFileSync(name, "utf8");
      assert.equal(source.split(anchor).length - 1, 1, `unique fixture anchor in ${name}`);
      write(name, source.replace(anchor, addition + anchor));
    };
    inject("scripts/order-zero-direct-release-worker.mjs", 'prepare: () => request("prepare"),',
      'executeAdmittedFixture: payload => request("execute-admitted-fixture", payload), ');
    if (options.admitted) inject("scripts/order-zero-direct-release-worker-child.mjs",
      'else if (message.command === "execute-prefix") result = await graph.executeAdmitted(message.payload);',
      'else if (message.command === "execute-admitted-fixture") result = await graph.executeAdmitted(message.payload);\n    ');
  }

  write("scripts/order-handoff-github.mjs", `${helper}
export async function discoverOrderHandoffJob({context}){log({event:'job-discovery'});assert.ok(state().admission);return {runId:context.runId,runAttempt:context.runAttempt,jobId:'123'};}
`);
  if (options.realGithub) {
    const transport = fs.readFileSync("tests/fixtures/order-handoff/github-fetch.mjs.txt", "utf8")
      .replaceAll("__CONTROL__", JSON.stringify(control)).replaceAll("__EVENTS__", JSON.stringify(events));
    for (const name of ["order-handoff-github.mjs", "order-zero-direct-release-ci.mjs", "order-zero-direct-release-admission.mjs"])
      write(`scripts/${name}`, transport + fs.readFileSync(`scripts/${name}`, "utf8"));
    write(".github/workflows/production-migrations.yml", "concurrency:\n  group: production-database-migrations\n  cancel-in-progress: false\n\njobs:\n");
  }
  if (options.workflow) write(".github/workflows/production-migrations.yml", fs.readFileSync(".github/workflows/production-migrations.yml", "utf8"));
  const fakePg = `${helper}
export default {Client:class {
constructor(options){this.mutator=options.application_name==='grainline-order-prefix-grants';assert.equal(options.options,this.mutator?undefined:'-c default_transaction_read_only=on');log({event:'client-kind',mutator:this.mutator});}
on(){} async connect(){log({event:'connect',pid:process.pid});}
async query(sql){log({event:'query',sql});return {rows:this.mutator?[{database:'neondb',actor:state().wrongOwner?'grainline_app_runtime':'neondb_owner',login:'neondb_owner',read_only:'off'}]:[]};} async end(){log({event:'disconnect'});}
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
  fs.writeFileSync(control, JSON.stringify({ ...JSON.parse(fs.readFileSync(control)), releaseCommit, runId }));
  return { directory, reviewed, payload, parent, control,
    start: async (overrides = {}) => {
      const start = options.admitted || options.unknownFixtureCommand
        ? (await import(pathToFileURL(path.join(directory, "scripts/order-zero-direct-release-worker.mjs")).href)).startOrderZeroDirectWorker
        : startOrderZeroDirectWorker;
      const worker = await start({ directory, reviewed, ...overrides }); workers.push(worker);
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

test("internal worker composition binds fresh admission to separate scope and owner clients", async t => {
  const f = fixture(t, { admitted: true }), worker = await f.start({ mode: "execute" }); await worker.prepare();
  const result = await worker.executeAdmittedFixture(f.payload);
  assert.equal(result.state, "admitted-complete"); assert.equal(result.productionExecutionAuthorized, false);
  assert.equal(result.execution.fixtureOnly, true);
  assert.deepEqual(f.events().filter(e => e.event === "client-kind").map(e => e.mutator), [false, true]);
  assert.ok(f.events().filter(e => e.event === "admission").every(e => e.mode === "execute"));
  assert.ok(f.events().some(e => e.event === "prisma-fixture" && e.pid === worker.pid));
  await assert.rejects(worker.executeAdmittedFixture(f.payload));
});
test("internal composition refuses a runtime owner substitute before the command adapter", async t => {
  const f = fixture(t, { admitted: true }), worker = await f.start({ mode: "execute" }); await worker.prepare(); f.change({ wrongOwner: true });
  await assert.rejects(worker.executeAdmittedFixture(f.payload));
  assert.ok(!f.events().some(e => e.event === "prisma-fixture"));
});
test("the actual dispatcher rejects the unsupported test-only command before database access", async t => {
  const f = fixture(t, { unknownFixtureCommand: true }), worker = await f.start(); await worker.prepare();
  await assert.rejects(worker.executeAdmittedFixture(f.payload));
  assert.ok(!f.events().some(e => e.event === "owner-validation" || e.event === "connect" || e.event === "admitted-fixture"));
});
test("lifetime admission, CI and host-claim loss terminate a waiting worker and its child process", async t => {
  for (const reason of ["admission", "ci", "claim"]) {
    const f = fixture(t, { admitted: true }), worker = await f.start({ mode: "execute" }); await worker.prepare(); f.change({ holdCommand: true });
    const running = assert.rejects(worker.executeAdmittedFixture(f.payload));
    let pending;
    const deadline = Date.now() + 15000;
    while (!(pending = f.events().find(e => e.event === "pending-command")) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.ok(pending, "fixture reached its pending subprocess");
    f.change(reason === "claim" ? { removeClaim: f.claim } : { [reason]: false });
    await running; await worker.close();
    // Some hosts briefly retain an orphaned zombie after the group is killed.
    // Neither a missing process nor a zombie can execute the command further.
    let status = "";
    try { status = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pending.pid)], { encoding: "utf8" }).trim(); } catch { /* Exited and reaped. */ }
    assert.ok(status === "" || status.startsWith("Z"));
    assert.ok(!f.events().some(e => e.event === "admitted-fixture"));
  }
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

import { execFile as bridgeExecFile, spawn as bridgeSpawn } from "node:child_process";
import { promisify as bridgePromisify } from "node:util";
import bridgeNet from "node:net";
const bridgeExec = bridgePromisify(bridgeExecFile);
const bridgeDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
function bridgeFixture(t, options = {}) {
  const owned = [];
  t.after(async () => {
    for (const item of owned) {
      for (const pid of [item.supervisorPid, item.workerPid]) { try { process.kill(-pid, "SIGKILL"); } catch { /* Reaped. */ } }
      await bridgeDelay(50); fs.rmSync(item.channel, { recursive: true, force: true });
    }
  });
  const f = fixture(t, options);
  const env = { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C", LC_ALL: "C", GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_JOB: "migrate", GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/production-migrations.yml@refs/heads/main",
    GITHUB_RUN_ID: f.payload.admission.runId, GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: f.reviewed.releaseCommit, RUNNER_NAME: "Fixture runner" };
  const plan = { directory: f.directory, reviewed: f.reviewed, ci: f.payload.ci,
    context: { runId: env.GITHUB_RUN_ID, runAttempt: "1", releaseCommit: env.GITHUB_SHA, runnerName: env.RUNNER_NAME },
    scope: "order-compatible-prefix-17", confirmation: "run-reviewed-production-migrations-from-main" };
  const planPath = path.join(f.parent, "launch-plan.json"); fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  const secretEnv = { ...env, ORDER_HANDOFF_GITHUB_TOKEN: f.payload.githubToken, ORDER_HANDOFF_OWNER_URL: f.payload.ownerUrl,
    ORDER_HANDOFF_OWNER_URL_SHA256: hash(f.payload.ownerUrl) };
  return { ...f, env, plan, planPath, secretEnv,
    launch: async (extra = {}) => {
      const receipt = path.join(f.parent, "launch-receipt.json");
      const result = await bridgeExec(process.execPath, ["scripts/order-handoff-launch.mjs", planPath, receipt], { cwd: f.directory, env: { ...env, ...extra }, timeout: 30000, maxBuffer: 4096 });
      assert.equal(result.stderr, ""); const ready = JSON.parse(result.stdout); owned.push(ready); return ready;
    },
    handoff: (ready, extra = {}) => bridgeExec(process.execPath, ["scripts/order-handoff-client.mjs", ready.channel], {
      cwd: f.directory, env: { ...secretEnv, ...extra }, timeout: 30000, maxBuffer: 4096 }),
  };
}
async function bridgeWaitResult(ready) {
  const file = path.join(ready.channel, "result.json"), until = Date.now() + 10000;
  while (!fs.existsSync(file) && Date.now() < until) await bridgeDelay(25);
  assert.ok(fs.existsSync(file), "bounded supervisor result retained"); return JSON.parse(fs.readFileSync(file));
}
test("bridge process survives launcher exit, prepares without credentials and hands off once to the same worker", async t => {
  const f = bridgeFixture(t), ready = await f.launch();
  assert.ok(ready.supervisorPid !== process.pid && ready.workerPid !== process.pid);
  assert.deepEqual(f.events().map(e => e.event), ["install"]);
  const response = await f.handoff(ready); assert.equal(response.stderr, ""); assert.equal(JSON.parse(response.stdout).outcome, "passed");
  const result = await bridgeWaitResult(ready); assert.equal(result.outcome, "passed");
  assert.equal(result.workerPid, ready.workerPid); assert.equal(result.sessionId, ready.sessionId);
  assert.equal(result.execution.appliedMemberCount, 17); assert.equal(result.evidenceUploadProven, false);
  assert.ok(f.events().filter(e => ["connect", "admitted-fixture"].includes(e.event)).every(e => e.pid === ready.workerPid));
  await assert.rejects(f.handoff(ready));
  for (const name of fs.readdirSync(ready.channel).filter(n => n.endsWith(".json"))) {
    const text = fs.readFileSync(path.join(ready.channel, name), "utf8");
    assert.ok(!text.includes(f.payload.githubToken) && !text.includes(f.payload.ownerUrl));
  }
});
test("bridge process rejects credentials during preparation and foreign handoff context", async t => {
  const f = bridgeFixture(t); await assert.rejects(f.launch({ ORDER_HANDOFF_GITHUB_TOKEN: "fixture-only-secret" }));
  assert.deepEqual(f.events(), []);
  const ready = await f.launch(); await assert.rejects(f.handoff(ready, { GITHUB_RUN_ATTEMPT: "2" }));
  assert.ok(!f.events().some(e => e.event === "owner-validation"));
});
test("bridge process rejects forged or oversized packets without opening a database connection", async t => {
  for (const packet of [JSON.stringify({ nonce: "forged", sql: "SELECT 1" }) + "\n", "x".repeat(32769)]) {
    const f = bridgeFixture(t), ready = await f.launch();
    const socket = bridgeNet.createConnection(path.join(ready.channel, "handoff.sock")); socket.on("error", () => {});
    await new Promise(resolve => socket.once("connect", resolve)); socket.write(packet); socket.resume();
    const result = await bridgeWaitResult(ready); socket.destroy(); assert.equal(result.outcome, "failed");
    assert.ok(!f.events().some(e => e.event === "connect"));
  }
});
test("bridge process preserves failure on worker exit or replaced capability", async t => {
  for (const reason of ["worker", "capability"]) {
    const f = bridgeFixture(t), ready = await f.launch();
    if (reason === "worker") process.kill(-ready.workerPid, "SIGKILL");
    else fs.writeFileSync(path.join(ready.channel, "capability"), "0".repeat(64));
    const result = await bridgeWaitResult(ready); assert.equal(result.outcome, "failed");
    await assert.rejects(f.handoff(ready)); assert.ok(!f.events().some(e => e.event === "connect"));
  }
});
test("bridge process kills in-flight work on client disconnect or duplicate handoff", async t => {
  for (const reason of ["disconnect", "duplicate"]) {
    const f = bridgeFixture(t), ready = await f.launch(); f.change({ holdCommand: true });
    const client = bridgeSpawn(process.execPath, ["scripts/order-handoff-client.mjs", ready.channel], { cwd: f.directory, env: f.secretEnv, stdio: "ignore" });
    const exited = new Promise(resolve => client.once("exit", resolve));
    let pending; const end = Date.now() + 15000;
    while (!(pending = f.events().find(e => e.event === "pending-command")) && Date.now() < end) await bridgeDelay(25);
    assert.ok(pending);
    if (reason === "disconnect") client.kill("SIGKILL");
    else { const duplicate = bridgeNet.createConnection(path.join(ready.channel, "handoff.sock")); duplicate.on("error", () => {}); duplicate.resume(); }
    const result = await bridgeWaitResult(ready); await exited; assert.equal(result.outcome, "failed");
    assert.equal(result.lastActivePhase, "executing");
    let status = ""; try { status = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pending.pid)], { encoding: "utf8" }).trim(); } catch { /* Reaped. */ }
    assert.ok(status === "" || status.startsWith("Z"));
    assert.ok(!f.events().some(e => e.event === "admitted-fixture"));
  }
});
test("historical migration workflow cannot satisfy real Order admission", async t => {
  const f = bridgeFixture(t, { realGithub: true }), ready = await f.launch();
  f.change({ requestDelayMs: 5 });
  await assert.rejects(f.handoff(ready));
  const requests = f.events().filter(e => e.event === "github-get").map(e => e.resource);
  assert.ok(requests[0].endsWith('/attempts/1/jobs'));
  assert.deepEqual(requests.slice(1), [
    'git/ref/heads/main', 'actions/runs/456', 'git/ref/heads/main', 'actions/runs/456',
  ]);
  assert.ok(!f.events().some(e=>e.event==='connect'));
  assert.equal((await bridgeWaitResult(ready)).outcome,'failed');
});
test("bridge process refuses source or endpoint drift and retains exportable evidence after supervisor loss", async t => {
  for (const reason of ["source", "endpoint", "supervisor"]) {
    const f=bridgeFixture(t),ready=await f.launch();
    if(reason==='source')fs.appendFileSync(path.join(f.directory,'scripts/order-handoff-client.mjs'),'\n// fixture drift\n');
    if(reason==='endpoint'){const file=path.join(ready.channel,'handoff.sock');fs.unlinkSync(file);fs.writeFileSync(file,'fixture replacement',{mode:0o600});}
    if(reason==='supervisor')process.kill(-ready.supervisorPid,'SIGKILL');
    await assert.rejects(f.handoff(ready));
    assert.ok(!f.events().some(e=>e.event==='connect'));
    if(reason!=='supervisor')assert.equal((await bridgeWaitResult(ready)).outcome,'failed');
    else {
      await bridgeDelay(500);const output=path.join(f.parent,'evidence');
      let result;try{await bridgeExec(process.execPath,['scripts/order-handoff-evidence.mjs',ready.channel,output],{cwd:f.directory,env:f.env,timeout:30000,maxBuffer:4096});}catch(error){result=error;}
      assert.equal(JSON.parse(result.stdout).outcome,'incomplete');
      assert.equal(fs.existsSync(path.join(ready.channel,'result.json')),false);
      const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));assert.equal(manifest.outcome,'incomplete');
      assert.ok(manifest.files.every(item=>!item.name.includes('capability')&&!item.name.includes('ready')));
    }
  }
});

// Extract the exact inline programs from the candidate workflow at test time;
// no generated copy or external checkpoint is consulted.
const workflowPrograms = Object.fromEntries(
  fs.readFileSync('.github/workflows/production-migrations.yml','utf8').split(/^      - /mu)
    .filter(block => block.includes("<<'NODE'\n"))
    .map(block => {
      const name = /^        id: (prepare|execute|evidence)$/mu.exec(block)?.[1];
      assert.ok(name);assert.equal(block.split("<<'NODE'\n").length,2);
      const indented=block.split("<<'NODE'\n")[1].split('          NODE\n')[0];
      assert.ok(indented.split('\n').every(line=>line===''||line.startsWith('          ')));
      return [name,indented.replace(/^          /gmu,'').replace(/\n$/u,'')];
    })
);
assert.deepEqual(Object.keys(workflowPrograms),['prepare','execute','evidence']);
// Runs the EXACT inline Node programs extracted from the inactive YAML. Models
// Actions metadata/outputs, GitHub HTTP and npm/DB; never dispatches a workflow.
import { verifyRetrievedOrderEvidence } from '../scripts/verify-retrieved-evidence.mjs';
function workflowFixture(t, options={}) {
  const f=fixture(t,{realGithub:true,workflow:true,...options});let owned;
  t.after(async()=>{
    if(owned){for(const pid of [owned.supervisorPid,owned.workerPid])try{process.kill(-pid,'SIGKILL');}catch{}
      await bridgeDelay(100);fs.rmSync(owned.channel,{recursive:true,force:true});}
  });
  const outputs=path.join(f.parent,'github-output');fs.writeFileSync(outputs,'',{mode:0o600});
  const context={PATH:'/usr/bin:/bin',TZ:'UTC',LANG:'C',LC_ALL:'C',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Drewyoung910/grainline',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_JOB:'migrate',GITHUB_WORKFLOW_REF:'Drewyoung910/grainline/.github/workflows/production-migrations.yml@refs/heads/main',
    GITHUB_RUN_ID:f.payload.admission.runId,GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:f.reviewed.releaseCommit,RUNNER_NAME:'Fixture runner',RUNNER_TEMP:f.parent,GITHUB_OUTPUT:outputs};
  const prepareEnv={...context,ORDER_REVIEWED_TOOLCHAIN_JSON:JSON.stringify(f.reviewed),ORDER_REVIEWED_RELEASE_COMMIT:f.reviewed.releaseCommit,
    ORDER_REVIEWED_CI_RUN_ID:f.payload.ci.ciRunId,ORDER_REVIEWED_CI_RUN_ATTEMPT:f.payload.ci.ciRunAttempt,ORDER_REVIEWED_CONFIRMATION:'run-reviewed-production-migrations-from-main'};
  let control;
  async function step(name,extra={}){
    const program=workflowPrograms[name];assert.equal(typeof program,'string');
    const env=name==='prepare'?prepareEnv:{...context,ORDER_HANDOFF_CONTROL:control,
      ...(name==='execute'?{ORDER_HANDOFF_GITHUB_TOKEN:f.payload.githubToken,ORDER_HANDOFF_OWNER_URL:f.payload.ownerUrl,ORDER_HANDOFF_OWNER_URL_SHA256:hash(f.payload.ownerUrl)}:{})};
    let result;const started=Date.now();
    try{const r=await bridgeExec(process.execPath,['--input-type=module','--eval',program],{cwd:f.directory,env:{...env,...extra},timeout:90000,maxBuffer:16384});result={code:0,...r};}
    catch(error){result={code:error.code,stdout:error.stdout,stderr:error.stderr};}
    if(name==='prepare'){
      const match=/^control=([^\n]+)\n$/u.exec(fs.readFileSync(outputs,'utf8'));if(match)control=match[1];
      if(control&&fs.existsSync(path.join(control,'receipt.json'))){const receipt=JSON.parse(fs.readFileSync(path.join(control,'receipt.json')));
        owned={...receipt};const ready=path.join(receipt.channel,'ready.json');if(fs.existsSync(ready))owned.workerPid=JSON.parse(fs.readFileSync(ready)).workerPid;}
    }
    for(const secret of [f.payload.githubToken,f.payload.ownerUrl])assert.ok(!result.stdout.includes(secret)&&!result.stderr.includes(secret));
    return {...result,elapsedMs:Date.now()-started};
  }
  return{...f,step,control:()=>control,ready:()=>owned,
    exported:()=>{const file=path.join(control,'evidence/manifest.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;}};
}
test('historical workflow prepares without secrets but cannot execute Order after admission separation',async t=>{
  const f=workflowFixture(t);assert.equal((await f.step('prepare')).code,0);
  const ready=f.ready();assert.ok(ready.supervisorPid&&ready.workerPid);assert.deepEqual(f.events().map(e=>e.event),['install']);
  assert.notEqual((await f.step('execute')).code,0);
  const result=JSON.parse(fs.readFileSync(path.join(ready.channel,'result.json')));assert.equal(result.outcome,'failed');
  assert.equal(result.workerPid,ready.workerPid);
  assert.ok(!f.events().some(e=>e.event==='connect'));
  assert.notEqual((await f.step('evidence')).code,0);assert.equal(f.exported()?.outcome,'failed');
  t.diagnostic(JSON.stringify({fixtureOnly:true,historicalWorkflowDenied:true,noDatabaseConnection:true}));
});
test('workflow steps retain preparation failure locator and export bounded failed evidence',async t=>{
  const f=workflowFixture(t,{missingEngine:true});const prepare=await f.step('prepare');assert.notEqual(prepare.code,0);assert.ok(f.ready()?.channel);
  const evidence=await f.step('evidence');assert.notEqual(evidence.code,0);assert.equal(f.exported()?.outcome,'failed');
  assert.ok(!f.events().some(e=>e.event==='github-get'||e.event==='connect'));
});
test('workflow steps cancel an unused prepared handoff and preserve a failed bundle',async t=>{
  const f=workflowFixture(t);assert.equal((await f.step('prepare')).code,0);
  const evidence=await f.step('evidence');assert.notEqual(evidence.code,0);assert.equal(f.exported()?.outcome,'failed');
  const result=JSON.parse(fs.readFileSync(path.join(f.ready().channel,'result.json')));assert.equal(result.lastActivePhase,'awaiting-handoff');
  assert.ok(!f.events().some(e=>e.event==='connect'));
  const exportPath=path.join(f.control(),'evidence'),received=path.join(f.parent,'received-copy');
  // Sender receipt is captured separately before the local delivery copy.
  const published=/^manifest_sha256=([a-f0-9]{64})$/mu.exec(fs.readFileSync(path.join(f.parent,'github-output'),'utf8'));assert.ok(published);
  assert.equal(published[1],hash(fs.readFileSync(path.join(exportPath,'manifest.json'))));
  const expected={manifestSha256:published[1],runId:f.payload.admission.runId,runAttempt:'1',releaseCommit:f.reviewed.releaseCommit,sourceCatalogSha256:f.reviewed.sourceCatalogSha256};
  fs.cpSync(exportPath,received,{recursive:true,errorOnExist:true,force:false});
  // A copy/download can reset modes. Receiver owns this NEW private staging
  // directory; establish private modes before the read-only verifier runs.
  function seal(dir){assert.ok(fs.lstatSync(dir).isDirectory());fs.chmodSync(dir,0o700);for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())seal(file);else{assert.ok(entry.isFile());fs.chmodSync(file,0o600);}}}seal(received);
  const receipt=verifyRetrievedOrderEvidence({directory:received,expected});assert.equal(receipt.evidenceOutcome,'failed');assert.equal(receipt.actualOffHostDeliveryProven,false);
  fs.appendFileSync(path.join(received,'binding.json'),' ');assert.throws(()=>verifyRetrievedOrderEvidence({directory:received,expected}),/retrieved evidence rejected/u);
});
test('workflow steps retain a quota-refused pre-handoff attempt for collection',async t=>{
  const f=workflowFixture(t);assert.equal((await f.step('prepare')).code,0);f.change({quotaAfter:0});
  assert.notEqual((await f.step('execute')).code,0);assert.notEqual((await f.step('evidence')).code,0);
  assert.equal(f.exported()?.outcome,'failed');assert.equal(f.events().filter(e=>e.event==='github-get').length,1);
  assert.ok(!f.events().some(e=>e.event==='connect'));
});

// Real transport with a modeled executor; no native or production authority claim.
test("proposed transport uses the prepared worker and cannot replay its completed attempt", async t => {
  const f = fixture(t), worker = await f.start({ mode: "execute" }); await worker.prepare();
  const result = await worker.executePrefix(f.payload);
  assert.equal(result.workerPid, worker.pid); assert.equal(result.state, "admitted-complete");
  assert.equal(result.productionExecutionAuthorized, false); assert.equal(result.execution.fixtureOnly, true);
  assert.deepEqual(f.events().filter(e => e.event === "client-kind").map(e => e.mutator), [false, true]);
  await assert.rejects(worker.executePrefix(f.payload));
  assert.equal(f.events().filter(e => e.event === "admitted-fixture").length, 1);
});
test("proposed transport refuses use before preparation", async t => {
  const f = fixture(t), worker = await f.start({ mode: "execute" });
  await assert.rejects(worker.executePrefix(f.payload)); assert.deepEqual(f.events(), []);
});
test("proposed transport refuses serialized authority and arbitrary execution fields", async t => {
  for (const extra of [{ admitted: true }, { sql: "SELECT 1" }, { args: ["migrate", "resolve"] }, { artifact: "/not-authority" }]) {
    const f = fixture(t), worker = await f.start({ mode: "execute" }); await worker.prepare();
    await assert.rejects(worker.executePrefix({ ...f.payload, ...extra }));
    assert.ok(!f.events().some(e => e.event === "connect" || e.event === "prisma-fixture"));
  }
});
test("proposed transport cannot promote an earlier inspected artifact into execution", async t => {
  const f = fixture(t), worker = await f.start({ mode: "execute" }); await worker.prepare(); await worker.inspect(f.payload);
  const connections = f.events().filter(e => e.event === "connect").length;
  await assert.rejects(worker.executePrefix(f.payload));
  assert.equal(f.events().filter(e => e.event === "connect").length, connections);
  assert.ok(!f.events().some(e => e.event === "prisma-fixture"));
});
test("proposed transport still requires live admission and CI before opening an owner connection", async t => {
  for (const changes of [{ admission: false }, { ci: false }]) {
    const f = fixture(t), worker = await f.start({ mode: "execute" }); await worker.prepare(); f.change(changes);
    await assert.rejects(worker.executePrefix(f.payload));
    assert.ok(!f.events().some(e => e.event === "connect" || e.event === "prisma-fixture"));
  }
});

test("read-only worker mode cannot invoke the production prefix", async t => {
  const f = fixture(t), worker = await f.start(); await worker.prepare();
  await assert.rejects(worker.executePrefix(f.payload));
  assert.ok(!f.events().some(e => e.event === "connect" || e.event === "prisma-fixture"));
});
