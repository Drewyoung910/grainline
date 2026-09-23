// Imported only by the pre-import source-verified bootstrap. Inactive proposal.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { FLAGS, FAILURE, hash, keys, id, sha, directoryGuard, pinFile, writePrivate, validatePlan } from "./order-handoff-common.mjs";

export async function runOrderHandoffSupervisor({ input, channel, sourceCheck }) {
  const plan = validatePlan(input), checkDirectory = directoryGuard(channel);
  const checkPlan = pinFile(path.join(channel, "plan.json"));
  let worker, server, socket, timer, idle, idleCheck, expiry, stage = "preparing", stopped = false, accepted = false, sequence = 0;
  let workerSession, socketIdentity, checkReady, checkCapability, operation = "worker-start", failureCode = null, requestedJobId = null;
  const socketPath = path.join(channel, "handoff.sock");
  assert.ok(Buffer.byteLength(socketPath) <= 100);
  const publicState = () => ({ version: 1, phase: stage, supervisorPid: process.pid,
    workerPid: worker?.pid ?? null, sessionId: workerSession ?? null,
    releaseCommit: plan.context.releaseCommit, runId: plan.context.runId, runAttempt: plan.context.runAttempt, ...FLAGS });
  const record = () => { checkDirectory(); checkPlan(); writePrivate(path.join(channel, `phase-${sequence++}.json`), publicState()); };
  function channelCheck() {
    checkDirectory(); checkPlan(); checkReady?.(); checkCapability?.();
    if (socketIdentity) {
      const current = fs.lstatSync(socketPath);
      assert.ok(current.isSocket());
      for (const k of ["dev", "ino", "uid", "mode", "ctimeMs"]) assert.equal(current[k], socketIdentity[k]);
    }
  }
  async function stop(success = false, execution) {
    if (stopped) return; stopped = true;
    clearInterval(timer); clearInterval(idle); clearTimeout(expiry);
    const lastActivePhase = stage;
    try { await worker?.close(); } catch { success = false; }
    try { channelCheck(); } catch { success = false; }
    stage = success ? "complete" : "failed";
    try {
      record();
      writePrivate(path.join(channel, "result.json"), { ...publicState(), outcome: success ? "passed" : "failed",
        ...(success && execution ? { execution } : {}), lastActivePhase, operation, failureCode, requestedJobId,
        evidenceUploadProven: false, hostLossDurabilityProven: false });
    } catch { success = false; }
    socket?.end(JSON.stringify({ outcome: success ? "passed" : "failed", ...FLAGS }) + "\n", () => socket.destroy());
    server?.close();
    process.exitCode = success ? 0 : 1;
  }
  const fail = () => { stop().catch(() => { process.exitCode = 1; }); };
  process.once("SIGTERM", fail); process.once("SIGINT", fail);
  process.once("uncaughtException", fail); process.once("unhandledRejection", fail);
  record();
  try {
    sourceCheck();
    const { startOrderZeroDirectWorker } = await import(pathToFileURL(path.join(plan.directory, "scripts/order-zero-direct-release-worker.mjs")).href);
    worker = await startOrderZeroDirectWorker({ directory: plan.directory, reviewed: plan.reviewed });
    operation = "worker-prepare";
    const prepared = await worker.prepare(); sourceCheck(); channelCheck();
    operation = "prepared-identity";
    assert.equal(prepared.state, "installed"); assert.equal(prepared.installedToolchainProven, true);
    assert.equal(prepared.loadedReleaseGraphProven, false); assert.equal(prepared.workerPid, worker.pid);
    workerSession = prepared.sessionId;
    const nonce = randomBytes(32).toString("hex");
    server = net.createServer(connection => {
      if (accepted || stopped) { connection.destroy(); fail(); return; }
      accepted = true; socket = connection; clearTimeout(expiry); clearInterval(idle);
      let bytes = Buffer.alloc(0), decoded = false;
      connection.setTimeout(5000, fail); connection.on("error", fail);
      connection.on("close", () => { if (!stopped) fail(); });
      connection.on("data", async part => {
        try {
          assert.equal(decoded, false); bytes = Buffer.concat([bytes, part]); assert.ok(bytes.length <= 32768);
          if (!bytes.includes(10)) return;
          assert.equal(bytes.indexOf(10), bytes.length - 1); decoded = true; connection.setTimeout(0);
          channelCheck(); const packet = JSON.parse(bytes.toString()); bytes = Buffer.alloc(0);
          keys(packet, ["nonce", "sessionId", "admission", "githubToken", "ownerUrl", "ownerUrlSha256"]);
          assert.equal(packet.nonce, nonce); assert.equal(packet.sessionId, workerSession);
          keys(packet.admission, ["runId", "runAttempt", "jobId"]); Object.values(packet.admission).forEach(id);
          assert.equal(packet.admission.runId, plan.context.runId); assert.equal(packet.admission.runAttempt, plan.context.runAttempt);
          requestedJobId = packet.admission.jobId;
          assert.match(packet.githubToken, /^[\x21-\x7e]{8,4096}$/u); sha(packet.ownerUrlSha256);
          assert.ok(typeof packet.ownerUrl === "string" && packet.ownerUrl.length <= 8192);
          assert.equal(hash(packet.ownerUrl), packet.ownerUrlSha256);
          await idleCheck; channelCheck(); sourceCheck();
          const status = await worker.status(); assert.equal(status.state, "installed"); assert.equal(status.sessionId, workerSession);
          stage = "loading"; record();
          const loaded = await worker.load({ ci: plan.ci, githubToken: packet.githubToken });
          assert.equal(loaded.state, "prepared"); channelCheck(); sourceCheck();
          stage = "executing"; record();
          const result = await worker.executePrefix({ admission: packet.admission, ci: plan.ci,
            githubToken: packet.githubToken, ownerUrl: packet.ownerUrl, ownerUrlSha256: packet.ownerUrlSha256 });
          channelCheck(); sourceCheck(); assert.equal(result.workerPid, worker.pid); assert.equal(result.sessionId, workerSession);
          assert.equal(result.state, "admitted-complete");
          const e = result.execution;
          assert.equal(e.status, "passed"); assert.equal(e.finalPrefix, 17);
          assert.ok(Number.isInteger(e.initialPrefix) && e.initialPrefix >= 0 && e.initialPrefix <= 17);
          assert.equal(e.appliedMemberCount, 17 - e.initialPrefix); assert.equal(e.reviewedFunctionCount, 36);
          for (const key of ["migrationStatusVerified", "globalAuthorityVerified", "finalReadOnlyScopeVerified"]) assert.equal(e[key], true);
          for (const [key, value] of Object.entries(FLAGS)) assert.equal(e[key], value);
          const execution = { status: "passed", initialPrefix: e.initialPrefix, finalPrefix: 17,
            appliedMemberCount: e.appliedMemberCount, reviewedFunctionCount: 36, migrationStatusVerified: true,
            globalAuthorityVerified: true, finalReadOnlyScopeVerified: true, ...FLAGS };
          await stop(true, execution);
        } catch { fail(); }
      });
    });
    server.on("error", fail);
    operation = "socket-listen";
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600); socketIdentity = fs.lstatSync(socketPath);
    writePrivate(path.join(channel, "capability"), nonce); checkCapability = pinFile(path.join(channel, "capability"));
    stage = "awaiting-handoff"; operation = "handoff";
    writePrivate(path.join(channel, "ready.json"), { ...publicState(), nonceSha256: hash(nonce) });
    checkReady = pinFile(path.join(channel, "ready.json")); record();
    timer = setInterval(() => { try { channelCheck(); } catch { fail(); } }, 250);
    idle = setInterval(() => {
      if (idleCheck || accepted || stopped) return;
      idleCheck = worker.status().then(s => { assert.equal(s.state, "installed"); assert.equal(s.sessionId, workerSession); })
        .catch(fail).finally(() => { idleCheck = undefined; });
    }, 1000);
    expiry = setTimeout(fail, 120000);
  } catch (error) {
    failureCode = ["EPERM", "EACCES", "EADDRINUSE", "ENOENT"].includes(error.code) ? error.code : null;
    await stop(); throw new Error(FAILURE);
  }
}
