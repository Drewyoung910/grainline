// Credential-free launcher. Daemon imports source only after this fixed inline
// bootstrap attests Node, source-fence bytes and the complete clean checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { FLAGS, FAILURE, validatePlan, contextFromEnvironment, assertPreparationEnvironment,
  directoryGuard, writePrivate, readJson, validateReady } from "./order-handoff-common.mjs";

const BOOTSTRAP = `
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';import {pathToFileURL,fileURLToPath} from 'node:url';import {registerHooks} from 'node:module';
try {
 const input=JSON.parse(process.argv[1]),channel=process.argv[2],root=process.cwd();
 const hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(root,input.directory);assert.equal(fs.realpathSync(root),root);
 assert.equal(process.version,input.reviewed.nodeVersion);assert.equal(hash(fs.readFileSync(process.execPath)),input.reviewed.nodeSha256);
 const file=path.join(root,'scripts/order-zero-direct-release-source.mjs');assert.equal(fs.realpathSync(file),file);
 assert.equal(hash(fs.readFileSync(file)),input.reviewed.sourceFenceSha256);
 const {createOrderZeroDirectSourceFence}=await import(pathToFileURL(file).href);
 const fence=createOrderZeroDirectSourceFence(root,input.reviewed.releaseCommit),source=fence.capture();
 assert.equal(source.catalogSha256,input.reviewed.sourceCatalogSha256);fence.verify(source);
 registerHooks({resolve(s,c,next){const r=next(s,c);if(!r.url.startsWith('node:')){
 assert.ok(r.url.startsWith('file:')&&fs.realpathSync(fileURLToPath(r.url)).startsWith(root+'/'));}return r;}});
 const {runOrderHandoffSupervisor}=await import(pathToFileURL(path.join(root,'scripts/order-handoff-supervisor.mjs')).href);
 await runOrderHandoffSupervisor({input,channel,sourceCheck:()=>fence.verify(source)});
}catch{process.exitCode=1;}
`;

export async function launchOrderSupervisor(input, receipt) {
  assertPreparationEnvironment(); const plan = validatePlan(input);
  assert.deepEqual(plan.context, contextFromEnvironment());
  const channel = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-handoff-")); fs.chmodSync(channel, 0o700);
  const guard = directoryGuard(channel); writePrivate(path.join(channel, "plan.json"), plan);
  const child = spawn(fs.realpathSync(process.execPath), ["--input-type=module", "--eval", BOOTSTRAP, JSON.stringify(plan), channel], {
    cwd: plan.directory, detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C", LC_ALL: "C" },
  });
  let ended = false; child.on("error", () => { ended = true; }); child.on("exit", () => { ended = true; });
  try {
    // Publish only a non-secret locator before preparation, including failures.
    const launch = { version: 1, supervisorPid: child.pid, releaseCommit: plan.context.releaseCommit,
      runId: plan.context.runId, runAttempt: plan.context.runAttempt, ...FLAGS };
    writePrivate(path.join(channel, "launch.json"), launch);
    writePrivate(receipt, { channel, ...launch });
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      guard(); assert.equal(ended, false);
      if (fs.existsSync(path.join(channel, "result.json"))) throw new Error(FAILURE);
      if (fs.existsSync(path.join(channel, "ready.json"))) {
        const ready = validateReady(readJson(path.join(channel, "ready.json")), plan);
        assert.equal(ready.supervisorPid, child.pid); child.unref();
        return { channel, supervisorPid: child.pid, workerPid: ready.workerPid, sessionId: ready.sessionId, ...FLAGS };
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(FAILURE);
  } catch {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    throw new Error(FAILURE);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 4);
    process.stdout.write(JSON.stringify(await launchOrderSupervisor(readJson(fs.realpathSync(process.argv[2])), process.argv[3])) + "\n");
  } catch { process.stderr.write(FAILURE + "\n"); process.exitCode = 1; }
}
