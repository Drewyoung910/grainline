import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { readR2GitHubArtifact } from "../scripts/r2-github-artifact-reader.mjs";
import { receiveR2GitHubConsumerProof } from "../scripts/r2-github-consumer-receiver.mjs";
import { makeR2GitHubConsumerTransport, receiveR2GitHubConsumerWithAuthorization } from "../scripts/r2-github-consumer-transport.mjs";
import { makeR2GitHubConsumerEvidence } from "../scripts/r2-application-github-consumer-proof.mjs";

const NOW = Date.parse("2026-09-21T10:00:00Z"), stamp = offset => new Date(NOW + offset).toISOString();
const hash = value => createHash("sha256").update(value).digest("hex");
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(key => "CLOUDFLARE_R2_" + key);
const filename = "r2-application-consumer-30-1.json";
function zip(value, { method = 8, descriptor = false, name = filename } = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const packed = method === 8 ? deflateRawSync(bytes) : bytes, nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(method, 8);
  if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); }
  local.writeUInt16LE(nameBytes.length, 26);
  const desc = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) { desc.writeUInt32LE(0x08074b50); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(packed.length, 8); desc.writeUInt32LE(bytes.length, 12); }
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(descriptor ? 8 : 0, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBytes.length, 12); end.writeUInt32LE(30 + nameBytes.length + packed.length + desc.length, 16);
  return Buffer.concat([local, nameBytes, packed, desc, central, nameBytes, end]);
}
function fixture() {
  const source = Buffer.from("synthetic reviewed source");
  const scope = { repositoryId: 10, workflowId: 20, runId: 30, runAttempt: 1, artifactId: 40, actorId: 50,
    commitSha: "a".repeat(40), workflowSha256: hash(source), scriptSha256: hash(source), nonce: "b".repeat(64),
    snapshotSha256: hash("snapshot"), capturedAt: stamp(-120000), dispatchedAt: stamp(-100000), pairSha256: hash("pair"),
    valueSha256: Object.fromEntries(KEYS.map(key => [key, hash(key)])),
    secretMetadata: Object.fromEntries(KEYS.map(key => [key, { created_at: stamp(-900000), updated_at: stamp(-800000) }])) };
  const run = { id: 30, run_attempt: 1, workflow_id: 20, repository: { id: 10, full_name: "Drewyoung910/grainline" },
    head_repository: { id: 10, full_name: "Drewyoung910/grainline" }, head_sha: scope.commitSha, head_branch: "main",
    path: ".github/workflows/r2-application-consumer-proof.yml", event: "workflow_dispatch", status: "completed", conclusion: "success",
    actor: { id: 50 }, triggering_actor: { id: 50 }, created_at: stamp(-99000), updated_at: stamp(-10000) };
  const jobs = { total_count: 1, jobs: [{ id: 60, run_id: 30, run_attempt: 1, head_sha: scope.commitSha, name: "proof",
    status: "completed", conclusion: "success", started_at: stamp(-90000), completed_at: stamp(-20000),
    steps: ["Compare only application R2 credential fingerprints", "Save only the successful fingerprint comparison"].map(name => ({ name, status: "completed", conclusion: "success" })) }] };
  const evidence = { schemaVersion: 1, operation: "r2-github-configured-consumer", repository: "Drewyoung910/grainline",
    workflowRef: "Drewyoung910/grainline/.github/workflows/r2-application-consumer-proof.yml@refs/heads/main", commitSha: scope.commitSha,
    runId: "30", runAttempt: "1", nonce: scope.nonce, reviewedSnapshotSha256: scope.snapshotSha256, capturedAt: stamp(-60000),
    pairSha256: scope.pairSha256, valueSha256: scope.valueSha256, comparedFields: 5, matchesReviewedSnapshot: true,
    providerRunProvenanceVerified: false, consumerConvergenceProven: false, productionMutationPerformed: false };
  const archive = zip(evidence);
  const artifact = { id: 40, name: "r2-application-consumer-30-1", expired: false, size_in_bytes: archive.length,
    digest: "sha256:" + hash(archive), created_at: stamp(-40000), updated_at: stamp(-30000), expires_at: stamp(900000),
    workflow_run: { id: 30, repository_id: 10, head_repository_id: 10, head_sha: scope.commitSha, head_branch: "main" } };
  const state = { scope, run, jobs, evidence, archive, artifact, calls: [] };
  state.read = async (op, key) => {
    state.calls.push([op, key]);
    if (op === "workflow" || op === "script") return { type: "file", path: op === "workflow" ? run.path : "scripts/r2-application-github-consumer-proof.mjs", encoding: "base64", content: source.toString("base64"), size: source.length };
    if (op === "secret") return { name: key, ...scope.secretMetadata[key] };
    return op === "archive" ? state.archive : structuredClone(state[op]);
  };
  state.execute = () => receiveR2GitHubConsumerProof({ enabled: true, scope, read: state.read, clock: () => NOW });
  state.repack = () => { state.archive = zip(state.evidence); state.artifact.digest = "sha256:" + hash(state.archive); state.artifact.size_in_bytes = state.archive.length; };
  return state;
}

test("verified receipt binds provider run, pinned source, archive and stable repository metadata", async () => {
  const f = fixture(), result = await f.execute();
  assert.equal(result.providerRunProvenanceVerified, true); assert.equal(result.repositorySecretMetadataStable, true);
  assert.equal(result.consumerConvergenceProven, false); assert.equal(result.credentialRotationAccepted, false);
  assert.equal(result.atomicSecretSnapshotProven, false); assert.equal(result.productionMutationPerformed, false);
  assert.equal(result.artifactSha256, hash(f.archive)); assert.ok(Object.isFrozen(result.valueSha256));
  assert.equal(f.calls.filter(([op]) => op === "secret").length, 10); assert.equal(f.calls.filter(([op]) => op === "run").length, 2);
});

const cases = {
  "foreign repository": f => { f.run.repository.id++; }, "fork head": f => { f.run.head_repository.id++; },
  "wrong workflow": f => { f.run.workflow_id++; }, "wrong source": f => { f.run.head_sha = "f".repeat(40); },
  "another attempt": f => { f.run.run_attempt++; }, "pull-request event": f => { f.run.event = "pull_request"; },
  "failed run": f => { f.run.conclusion = "failure"; }, "another actor": f => { f.run.triggering_actor.id++; },
  "pre-dispatch run": f => { f.run.created_at = stamp(-200000); }, "partial jobs": f => { f.jobs.total_count = 2; },
  "skipped proof step": f => { f.jobs.jobs[0].steps[0].conclusion = "skipped"; }, "wrong job attempt": f => { f.jobs.jobs[0].run_attempt++; },
  "wrong artifact": f => { f.artifact.id++; }, "expired artifact": f => { f.artifact.expired = true; },
  "foreign artifact head": f => { f.artifact.workflow_run.head_repository_id++; }, "archive corruption": f => { f.archive[40] ^= 1; },
  "missing digest": f => { delete f.artifact.digest; }, "bad archive length": f => { f.artifact.size_in_bytes++; },
  "wrong nonce": f => { f.evidence.nonce = "f".repeat(64); f.repack(); }, "different field": f => { f.evidence.valueSha256 = { ...f.evidence.valueSha256, [KEYS[0]]: hash("other") }; f.repack(); },
  "forged acceptance": f => { f.evidence.providerRunProvenanceVerified = true; f.repack(); }, "extra artifact data": f => { f.evidence.extra = "secret"; f.repack(); },
  "stale review": f => { f.scope.capturedAt = stamp(-500000); }, "future dispatch": f => { f.scope.dispatchedAt = stamp(1000); },
  "workflow hash drift": f => { f.scope.workflowSha256 = hash("other"); }, "script hash drift": f => { f.scope.scriptSha256 = hash("other"); },
};
for (const [name, change] of Object.entries(cases)) test(`receipt refuses ${name}`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.execute(), error => error.message === "R2 GitHub receipt refused; refresh the reviewed run evidence.");
});
for (const mode of ["secret", "artifact", "run"]) test(`late ${mode} drift withholds receipt`, async () => {
  const f = fixture(), read = f.read; let hits = 0;
  f.read = async (op, key, options) => {
    const value = await read(op, key, options);
    if (op === mode && ++hits > (mode === "secret" ? 5 : 1)) {
      if (mode === "secret") value.updated_at = stamp(-1000);
      else if (mode === "artifact") value.digest = "sha256:" + hash("other");
      else value.run_attempt++;
    }
    return value;
  };
  await assert.rejects(f.execute());
});
test("disabled and pre-aborted verification never call a provider", async () => {
  const f = fixture();
  for (const options of [{ enabled: false }, { enabled: true, signal: AbortSignal.abort() }])
    await assert.rejects(receiveR2GitHubConsumerProof({ ...options, scope: f.scope, read: f.read, clock: () => NOW }));
  assert.equal(f.calls.length, 0);
});

for (const method of [0, 8]) for (const descriptor of [false, true]) test(`single-file ZIP method ${method}, descriptor ${descriptor}`, () => {
  assert.deepEqual(readR2GitHubArtifact(zip({ ok: true }, { method, descriptor }), filename), { ok: true });
});
for (const [name, make] of Object.entries({ traversal: () => zip({}, { name: "../" + filename }),
  "oversized inflated body": () => zip(Buffer.alloc(16385)), "invalid JSON": () => zip(Buffer.from("invalid")),
  "invalid UTF8": () => zip(Buffer.from([0xff])), "multiple entries": () => { const b = zip({}); b.writeUInt16LE(2, b.length - 12); return b; },
  "bad CRC": () => { const b = zip({}); b.writeUInt32LE(0, 14); return b; },
  symlink: () => { const b = zip({}); const c = b.readUInt32LE(b.length - 6); b.writeUInt32LE(0xa0000000, c + 38); return b; },
  "trailing bytes": () => Buffer.concat([zip({}), Buffer.from("x")]),
})) test(`archive refuses ${name}`, () => assert.throws(() => readR2GitHubArtifact(make(), filename)));

test("native archive redirect strips authorization and routes only exact reviewed GETs", async () => {
  const f = fixture(), calls = [];
  const request = (url, options, callback) => {
    calls.push({ url, options }); const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.complete = true; res.headers = {};
      res.destroy = () => {};
      if (url.hostname === "api.github.com" && url.pathname.endsWith("/zip")) { res.statusCode = 302; res.headers.location = "https://fixture.blob.core.windows.net/archive?signature=private"; callback(res); }
      else { res.statusCode = 200; callback(res); res.emit("data", url.hostname === "api.github.com" ? Buffer.from("{}") : f.archive); res.emit("end"); }
    }); return req;
  };
  const read = makeR2GitHubConsumerTransport({ scope: f.scope, token: "synthetic_github_token_12345", request });
  assert.deepEqual(await read("archive"), f.archive);
  assert.ok(calls[0].options.headers.authorization); assert.equal(calls[1].options.headers.authorization, undefined);
  assert.ok(calls.every(call => call.options.method === "GET" && call.options.agent === false));
  await read("jobs"); assert.match(calls[2].url.pathname, /runs\/30\/attempts\/1\/jobs$/);
  for (const args of [["delete"], ["secret", "OTHER_SECRET"], ["run", "foreign"]]) await assert.rejects(read(...args));
  assert.equal(calls.length, 3);
});
for (const location of ["https://evil.example/a", "http://fixture.blob.core.windows.net/a", "https://fixture.blob.core.windows.net.evil.example/a",
  "https://user:pass@fixture.blob.core.windows.net/a", "https://fixture.blob.core.windows.net:444/a"]) {
  test("native transport refuses untrusted storage redirect " + location.split("/")[2], async () => {
    let calls = 0;
    const request = (_url, _options, callback) => {
      calls++; const req = new EventEmitter(); req.end = () => queueMicrotask(() => callback({ statusCode: 302, headers: { location }, destroy() {} })); return req;
    };
    await assert.rejects(makeR2GitHubConsumerTransport({ scope: fixture().scope, token: "synthetic_github_token_12345", request })("archive"));
    assert.equal(calls, 1);
  });
}

test("actual producer evidence travels through the native receiver and authorization postcheck", async () => {
  const f = fixture(), values = ["d".repeat(32), "synthetic_access_12345", "s".repeat(64), "synthetic-public", "https://synthetic.example.test"];
  f.scope.valueSha256 = Object.fromEntries(KEYS.map((key, i) => [key, hash(values[i])]));
  f.scope.pairSha256 = hash(values[1] + "\0" + values[2]);
  const review = Object.fromEntries(["nonce", "commitSha", "snapshotSha256", "capturedAt", "pairSha256", "valueSha256"].map(key => [key, f.scope[key]]));
  f.evidence = makeR2GitHubConsumerEvidence({ checkoutCommit: f.scope.commitSha, now: NOW - 60000, environment: {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/r2-application-consumer-proof.yml@refs/heads/main", GITHUB_JOB: "proof",
    GITHUB_SHA: f.scope.commitSha, GITHUB_WORKFLOW_SHA: f.scope.commitSha, GITHUB_RUN_ID: "30", GITHUB_RUN_ATTEMPT: "1",
    R2_CONSUMER_RELEASE_COMMIT: f.scope.commitSha, R2_CONSUMER_CONFIRM: "prove-reviewed-r2-application-consumer", R2_CONSUMER_REVIEW_JSON: JSON.stringify(review),
    ...Object.fromEntries(KEYS.map((key, i) => [key, values[i]])),
  } });
  f.repack();
  const request = (url, options, callback) => {
    assert.equal(options.method, "GET"); const req = new EventEmitter();
    req.end = () => queueMicrotask(async () => {
      const res = new EventEmitter(); res.complete = true; res.destroy = () => {}; res.headers = {};
      if (url.pathname.endsWith("/zip")) {
        res.statusCode = 302; res.headers.location = "https://fixture.blob.core.windows.net/artifact"; callback(res); return;
      }
      let value;
      if (url.hostname !== "api.github.com") value = f.archive;
      else {
        let op, key;
        if (url.pathname.includes("/contents/")) op = url.pathname.includes("/.github/") ? "workflow" : "script";
        else if (url.pathname.includes("/secrets/")) { op = "secret"; key = url.pathname.split("/").at(-1); }
        else if (url.pathname.endsWith("/jobs")) op = "jobs";
        else if (url.pathname.includes("/artifacts/")) op = "artifact";
        else op = "run";
        value = Buffer.from(JSON.stringify(await f.read(op, key)));
      }
      res.statusCode = 200; callback(res); res.emit("data", value); res.emit("end");
    }); return req;
  };
  const options = { enabled: true, scope: f.scope, clock: () => NOW, request,
    withAuthorization: async callback => { await callback("synthetic_github_token_12345"); } };
  const receipt = await receiveR2GitHubConsumerWithAuthorization(options);
  assert.equal(receipt.pairSha256, f.scope.pairSha256);
  options.withAuthorization = async callback => { await callback("synthetic_github_token_12345"); throw new Error("private authorization detail"); };
  await assert.rejects(receiveR2GitHubConsumerWithAuthorization(options), error => error.message === "R2 GitHub transport refused; no authorization or download URL disclosed.");
});

for (const mode of ["403", "second-redirect", "malformed", "oversized", "truncated", "request-error"]) test(`native transport sanitizes ${mode}`, async () => {
  let calls = 0;
  const request = (_url, _options, callback) => {
    calls++; const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      if (mode === "request-error") { req.emit("error", new Error("secret-token")); return; }
      const res = new EventEmitter(); res.complete = mode !== "truncated"; res.headers = {}; res.destroy = () => {};
      res.statusCode = mode === "403" ? 403 : mode === "second-redirect" ? 302 : 200;
      res.headers.location = "https://fixture.blob.core.windows.net/secret-signed-url";
      callback(res);
      if (mode === "403" || mode === "second-redirect") return;
      res.emit("data", Buffer.from(mode === "oversized" ? "x".repeat(1048577) : "secret-invalid-json"));
      res.emit(mode === "truncated" ? "close" : "end");
    }); return req;
  };
  const read = makeR2GitHubConsumerTransport({ scope: fixture().scope, token: "synthetic_github_token_12345", request });
  await assert.rejects(read(mode === "second-redirect" ? "archive" : "run"), error => error.message === "R2 GitHub transport refused; no authorization or download URL disclosed.");
  assert.equal(calls, mode === "second-redirect" ? 2 : 1);
});
