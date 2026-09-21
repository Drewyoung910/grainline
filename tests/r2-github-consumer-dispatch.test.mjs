import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, chmodSync, existsSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, linkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchR2GitHubConsumer, makeR2GitHubDispatchTransport, recoverR2GitHubConsumerDispatch } from "../scripts/r2-github-consumer-dispatch.mjs";
import { withR2GitHubDispatchJournal } from "../scripts/r2-github-dispatch-journal.mjs";

const NOW = Date.parse("2026-09-21T10:00:00Z"), stamp = offset => new Date(NOW + offset).toISOString();
const hash = value => createHash("sha256").update(value).digest("hex");
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(key => "CLOUDFLARE_R2_" + key);
const REPO = "Drewyoung910/grainline", PREFIX = `/repos/${REPO}`;
const WORKFLOW = ".github/workflows/r2-application-consumer-proof.yml", SCRIPT = "scripts/r2-application-github-consumer-proof.mjs";
const TOKEN = "synthetic_authorization_not_a_real_credential";
const FAIL = "R2 GitHub dispatch refused; inspect the saved intent before any further dispatch.";

// Minimal stored ZIP for end-to-end native transport/receiver testing.
function archive(value) {
  const bytes = Buffer.from(JSON.stringify(value)), name = Buffer.from("r2-application-consumer-30-1.json");
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "r2-dispatch-test-"))); chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = Buffer.from("synthetic reviewed source"), sha = hash(source);
  const review = { repositoryId: 10, workflowId: 20, actorId: 50, commitSha: "a".repeat(40), workflowSha256: sha, scriptSha256: sha,
    nonce: "b".repeat(64), snapshotSha256: hash("snapshot"), capturedAt: stamp(-60000), pairSha256: hash("pair"),
    valueSha256: Object.fromEntries(KEYS.map(key => [key, hash(key)])) };
  const metadata = { created_at: stamp(-900000), updated_at: stamp(-800000) };
  const routes = new Map([
    [PREFIX, { id: 10, full_name: REPO, default_branch: "main", archived: false }],
    ["/user", { id: 50 }], [PREFIX + "/actions/workflows/20", { id: 20, path: WORKFLOW, state: "active" }],
    [PREFIX + "/git/ref/heads/main", { ref: "refs/heads/main", object: { type: "commit", sha: review.commitSha } }],
  ]);
  for (const path of [WORKFLOW, SCRIPT]) routes.set(`${PREFIX}/contents/${path}?ref=${review.commitSha}`,
    { type: "file", path, size: source.length, encoding: "base64", content: source.toString("base64") });
  for (const key of KEYS) routes.set(PREFIX + "/actions/secrets/" + key, { name: key, ...metadata });
  const run = { id: 30, run_attempt: 1, workflow_id: 20, repository: { id: 10, full_name: REPO }, head_repository: { id: 10, full_name: REPO },
    head_sha: review.commitSha, head_branch: "main", path: WORKFLOW, event: "workflow_dispatch", status: "completed", conclusion: "success",
    actor: { id: 50 }, triggering_actor: { id: 50 }, created_at: stamp(1000), updated_at: stamp(10000) };
  routes.set(PREFIX + "/actions/runs/30", run);
  routes.set(PREFIX + "/actions/runs/30/attempts/1/jobs?per_page=100", { total_count: 1, jobs: [{ id: 60, run_id: 30, run_attempt: 1,
    head_sha: review.commitSha, name: "proof", status: "completed", conclusion: "success", started_at: stamp(2000), completed_at: stamp(9000),
    steps: ["Compare only application R2 credential fingerprints", "Save only the successful fingerprint comparison"]
      .map(name => ({ name, status: "completed", conclusion: "success" })) }] });
  const evidence = { schemaVersion: 1, operation: "r2-github-configured-consumer", repository: REPO,
    workflowRef: `${REPO}/${WORKFLOW}@refs/heads/main`, commitSha: review.commitSha, runId: "30", runAttempt: "1", nonce: review.nonce,
    reviewedSnapshotSha256: review.snapshotSha256, capturedAt: stamp(3000), pairSha256: review.pairSha256, valueSha256: review.valueSha256,
    comparedFields: 5, matchesReviewedSnapshot: true, providerRunProvenanceVerified: false, consumerConvergenceProven: false, productionMutationPerformed: false };
  const f = { directory, review, routes, calls: [], evidence, now: NOW, postStatus: 200, lost: false, change: null,
    postValue: { workflow_run_id: 30, run_url: `https://api.github.com${PREFIX}/actions/runs/30`, html_url: `https://github.com/${REPO}/actions/runs/30` } };
  f.repack = () => {
    f.zip = archive(evidence);
    routes.set(PREFIX + "/actions/artifacts/40", { id: 40, name: "r2-application-consumer-30-1", expired: false,
      size_in_bytes: f.zip.length, digest: "sha256:" + hash(f.zip), created_at: stamp(4000), updated_at: stamp(5000), expires_at: stamp(900000),
      workflow_run: { id: 30, repository_id: 10, head_repository_id: 10, head_sha: review.commitSha, head_branch: "main" } });
  };
  f.repack();
  f.request = (url, options, callback) => {
    const req = new EventEmitter();
    req.end = body => queueMicrotask(() => {
      const path = url.pathname + url.search;
      f.calls.push({ url: url.href, path, options, body });
      const response = new EventEmitter(); response.headers = {}; response.complete = true; response.destroy = () => {};
      let bytes;
      if (options.method === "POST") {
        assert.equal(path, PREFIX + "/actions/workflows/20/dispatches");
        assert.ok(existsSync(join(directory, "intent.json")), "durable intent exists before POST");
        if (f.lost) { req.emit("error", new Error(TOKEN)); return; }
        response.statusCode = f.postStatus; bytes = Buffer.from(f.postStatus === 204 ? "" : JSON.stringify(f.postValue));
      } else if (url.hostname === "example.blob.core.windows.net") {
        assert.equal(options.headers.authorization, undefined); response.statusCode = 200; bytes = f.zip;
      } else if (path.endsWith("/zip")) {
        response.statusCode = 302; response.headers.location = "https://example.blob.core.windows.net/test"; bytes = Buffer.alloc(0);
      } else {
        assert.ok(routes.has(path), "closed GET destination: " + path);
        response.statusCode = 200; bytes = Buffer.from(JSON.stringify(routes.get(path)));
      }
      if (f.change) bytes = f.change({ path, options, response, bytes }) ?? bytes;
      callback(response); response.emit("data", bytes); response.emit("end"); response.emit("close");
    });
    return req;
  };
  f.auth = async callback => { await callback(TOKEN); };
  f.dispatch = options => dispatchR2GitHubConsumer({ enabled: true, directory, review, withAuthorization: f.auth, request: f.request, clock: () => f.now, ...options });
  f.recover = options => recoverR2GitHubConsumerDispatch({ enabled: true, directory, runId: 30, artifactId: 40, withAuthorization: f.auth,
    request: f.request, clock: () => f.now, ...options });
  f.read = name => JSON.parse(readFileSync(join(directory, name + ".json"), "utf8"));
  f.posts = () => f.calls.filter(call => call.options.method === "POST");
  return f;
}

test("dispatch journals intent before one POST, then binds native receipt without another POST", async t => {
  const f = fixture(t), ack = await f.dispatch();
  assert.equal(ack.runId, 30); assert.equal(ack.providerRunProvenanceVerified, false); assert.equal(f.posts().length, 1);
  assert.deepEqual(f.read("intent").review, f.review); assert.deepEqual(f.read("acknowledgement"), ack);
  const body = JSON.parse(f.posts()[0].body);
  assert.equal(body.ref, "main"); assert.equal(body.return_run_details, true);
  assert.equal(body.inputs.release_commit, f.review.commitSha); assert.equal(JSON.parse(body.inputs.review_json).nonce, f.review.nonce);
  assert.equal(f.posts()[0].options.headers["x-github-api-version"], "2022-11-28");
  f.now += 20000; const receipt = await f.recover();
  assert.equal(receipt.providerRunProvenanceVerified, true); assert.equal(receipt.credentialRotationAccepted, false);
  assert.equal(receipt.consumerConvergenceProven, false); assert.deepEqual(f.read("receipt"), receipt);
  assert.equal(f.posts().length, 1);
  for (const name of ["intent", "acknowledgement", "receipt"]) {
    assert.equal(statSync(join(f.directory, name + ".json")).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(f.directory, name + ".json"), "utf8").includes(TOKEN), false);
  }
  await assert.rejects(f.dispatch(), { message: FAIL }); await assert.rejects(f.recover(), { message: FAIL });
  assert.equal(f.posts().length, 1);
});

for (const status of ["lost", 204, 403, "malformed", "auth-postcheck"]) test(`${status} preserves intent and never redispatches; native recovery can establish the run`, async t => {
  const f = fixture(t);
  if (status === "lost") f.lost = true;
  else if (status === "malformed") f.postValue.run_url = "https://other.invalid/run";
  else if (status === "auth-postcheck") f.auth = async callback => { await callback(TOKEN); throw new Error(TOKEN); };
  else f.postStatus = status;
  if (status === 204) { const ack = await f.dispatch(); assert.equal(ack.runId, null); }
  else { await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(existsSync(join(f.directory, "acknowledgement.json")), false); }
  assert.equal(f.posts().length, 1); assert.ok(f.read("intent"));
  await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(f.posts().length, 1);
  f.auth = async callback => { await callback(TOKEN); }; f.now += 20000;
  assert.equal((await f.recover()).providerRunProvenanceVerified, true); assert.equal(f.posts().length, 1);
});

const preflightFailures = {
  "main drift": f => { f.routes.get(PREFIX + "/git/ref/heads/main").object.sha = "c".repeat(40); },
  "different actor": f => { f.routes.get("/user").id++; },
  "foreign repository": f => { f.routes.get(PREFIX).id++; },
  "archived repository": f => { f.routes.get(PREFIX).archived = true; },
  "wrong workflow": f => { f.routes.get(PREFIX + "/actions/workflows/20").path = "other.yml"; },
  "disabled workflow": f => { f.routes.get(PREFIX + "/actions/workflows/20").state = "disabled_manually"; },
  "source hash drift": f => { f.review.scriptSha256 = "c".repeat(64); },
  "missing repository secret": f => { f.routes.get(PREFIX + "/actions/secrets/" + KEYS[0]).name = "other"; },
  "future secret revision": f => { f.routes.get(PREFIX + "/actions/secrets/" + KEYS[0]).updated_at = stamp(60000); },
  "stale snapshot": f => { f.review.capturedAt = stamp(-300001); },
  "future snapshot": f => { f.review.capturedAt = stamp(1); },
  "extra review field": f => { f.review.token = TOKEN; },
  "missing hash": f => { delete f.review.valueSha256[KEYS[0]]; },
  "deadline elapsed": f => { f.change = () => { f.now += 50000; }; },
};
for (const [name, change] of Object.entries(preflightFailures)) test(`preflight refuses ${name} without dispatch intent or POST`, async t => {
  const f = fixture(t); change(f); await assert.rejects(f.dispatch(), { message: FAIL });
  assert.equal(f.posts().length, 0); assert.equal(existsSync(join(f.directory, "intent.json")), false);
});

test("disabled, aborted and authorization-not-entered calls have no effects", async t => {
  const f = fixture(t);
  await assert.rejects(f.dispatch({ enabled: false }), { message: FAIL });
  await assert.rejects(f.dispatch({ signal: AbortSignal.abort() }), { message: FAIL });
  f.auth = async () => {}; await assert.rejects(f.dispatch(), { message: FAIL });
  assert.equal(f.calls.length, 0); assert.equal(existsSync(join(f.directory, "intent.json")), false);
});
test("authorization callback cannot dispatch twice", async t => {
  const f = fixture(t); f.auth = async callback => { await callback(TOKEN); await callback(TOKEN); };
  await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(f.posts().length, 1);
  assert.equal(existsSync(join(f.directory, "acknowledgement.json")), false);
});
test("changed caller review cannot change the captured dispatch inputs", async t => {
  const f = fixture(t), sha = f.review.commitSha;
  f.auth = async callback => { f.review.commitSha = "c".repeat(40); await callback(TOKEN); };
  await f.dispatch(); assert.equal(JSON.parse(f.posts()[0].body).inputs.release_commit, sha);
});
test("successful acknowledgement forbids switching to a different run", async t => {
  const f = fixture(t); await f.dispatch(); f.calls.length = 0; f.now += 20000;
  await assert.rejects(f.recover({ runId: 31 }), { message: FAIL }); assert.equal(f.calls.length, 0);
});
test("recovery refuses wrong artifact nonce and can retry GETs after correcting the candidate", async t => {
  const f = fixture(t); f.lost = true; await assert.rejects(f.dispatch()); f.now += 20000;
  f.evidence.nonce = "c".repeat(64); f.repack(); await assert.rejects(f.recover(), { message: FAIL });
  assert.equal(existsSync(join(f.directory, "receipt.json")), false);
  f.evidence.nonce = f.review.nonce; f.repack(); assert.equal((await f.recover()).providerRunProvenanceVerified, true);
  assert.equal(f.posts().length, 1);
});
test("recovery authorization postcheck failure cannot persist a receipt", async t => {
  const f = fixture(t); await f.dispatch(); f.now += 20000;
  f.auth = async callback => { await callback(TOKEN); throw new Error(TOKEN); };
  await assert.rejects(f.recover(), { message: FAIL }); assert.equal(existsSync(join(f.directory, "receipt.json")), false);
});
test("stale recovery never replays the POST", async t => {
  const f = fixture(t); await f.dispatch(); f.now += 900001;
  await assert.rejects(f.recover(), { message: FAIL }); assert.equal(f.posts().length, 1);
});

for (const attack of ["redirect", "oversize", "truncated", "invalid JSON"]) test(`native dispatch transport refuses ${attack}`, async t => {
  const f = fixture(t);
  f.change = ({ response, bytes }) => {
    if (attack === "redirect") { response.statusCode = 302; response.headers.location = "https://other.invalid"; }
    if (attack === "oversize") return Buffer.alloc(131073);
    if (attack === "truncated") response.complete = false;
    if (attack === "invalid JSON") return Buffer.from("not json");
    return bytes;
  };
  await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(f.posts().length, 0);
});
test("transport refuses unknown operations or arbitrary secret names", async t => {
  const f = fixture(t), call = makeR2GitHubDispatchTransport({ review: f.review, token: TOKEN, request: f.request });
  await assert.rejects(call("delete")); await assert.rejects(call("secret", "DATABASE_URL"));
  await assert.rejects(call("main", "other")); assert.equal(f.calls.length, 0);
});

test("journal lock prevents a concurrent dispatcher and is removed after normal completion", async t => {
  const f = fixture(t);
  await withR2GitHubDispatchJournal(f.directory, async () => {
    await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(f.calls.length, 0);
  });
  assert.equal(existsSync(join(f.directory, "dispatch.lock")), false); await f.dispatch();
});
for (const attack of ["retained lock", "partial intent", "symlink", "hardlink", "directory mode", "file mode"]) test(`journal refuses ${attack}`, async t => {
  const f = fixture(t), filename = join(f.directory, "intent.json");
  if (attack === "retained lock") writeFileSync(join(f.directory, "dispatch.lock"), "crashed", { mode: 0o600 });
  else if (attack === "directory mode") chmodSync(f.directory, 0o755);
  else if (attack === "symlink") symlinkSync("absent.json", filename);
  else {
    writeFileSync(filename, attack === "partial intent" ? "{" : "{}\n", { mode: 0o600 });
    if (attack === "hardlink") linkSync(filename, join(f.directory, "other.json"));
    if (attack === "file mode") chmodSync(filename, 0o644);
  }
  await assert.rejects(f.dispatch(), { message: FAIL }); assert.equal(f.calls.length, 0);
});
test("journal detects edits during callback and never overwrites an existing record", async t => {
  const f = fixture(t);
  await assert.rejects(withR2GitHubDispatchJournal(f.directory, async journal => {
    journal.write("intent", { first: true });
    assert.throws(() => journal.write("intent", { first: false }));
    writeFileSync(join(f.directory, "intent.json"), '{"other":true}\n');
  }));
  assert.deepEqual(f.read("intent"), { other: true });
});
