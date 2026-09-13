// Step-two entrypoint: built-ins only until source has been checked. No secret
// value is accepted on argv or written to the handoff directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

export async function handoffOrderCredentials(channel) {
  const hash = x => createHash("sha256").update(x).digest("hex");
  assert.equal(fs.realpathSync(channel), channel);
  const d = fs.lstatSync(channel); assert.ok(d.isDirectory() && d.uid === process.getuid() && (d.mode & 0o7777) === 0o700);
  const raw = path.join(channel, "plan.json"), fd = fs.openSync(raw, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let plan;
  try { const s = fs.fstatSync(fd); assert.ok(s.isFile() && s.uid === process.getuid() && s.nlink === 1 && s.size <= 16384 && (s.mode & 0o7777) === 0o600);
    plan = JSON.parse(fs.readFileSync(fd)); } finally { fs.closeSync(fd); }
  const root = process.cwd(); assert.equal(plan.directory, root); assert.equal(fs.realpathSync(root), root);
  assert.equal(process.version, plan.reviewed.nodeVersion); assert.equal(hash(fs.readFileSync(process.execPath)), plan.reviewed.nodeSha256);
  const fencePath = path.join(root, "scripts/order-zero-direct-release-source.mjs");
  assert.equal(fs.realpathSync(fencePath), fencePath);
  assert.equal(hash(fs.readFileSync(fencePath)), plan.reviewed.sourceFenceSha256);
  const { createOrderZeroDirectSourceFence } = await import(pathToFileURL(fencePath).href);
  const fence = createOrderZeroDirectSourceFence(root, plan.reviewed.releaseCommit), source = fence.capture();
  assert.equal(source.catalogSha256, plan.reviewed.sourceCatalogSha256); fence.verify(source);
  registerHooks({ resolve(s, c, next) { const r = next(s, c); if (!r.url.startsWith("node:")) {
    assert.ok(r.url.startsWith("file:") && fs.realpathSync(fileURLToPath(r.url)).startsWith(root + "/")); } return r; } });
  const common = await import(pathToFileURL(path.join(root, "scripts/order-handoff-common.mjs")).href);
  plan = common.validatePlan(plan); assert.deepEqual(plan.context, common.contextFromEnvironment());
  const guard = common.directoryGuard(channel), pinPlan = common.pinFile(raw);
  const readyPath = path.join(channel, "ready.json"), capPath = path.join(channel, "capability");
  const ready = common.validateReady(common.readJson(readyPath), plan), pinReady = common.pinFile(readyPath), pinCap = common.pinFile(capPath);
  assert.equal(fs.existsSync(path.join(channel, "result.json")), false);
  const nonce = common.readBounded(capPath).toString(); common.sha(nonce); assert.equal(hash(nonce), ready.nonceSha256);
  process.kill(ready.supervisorPid, 0); process.kill(ready.workerPid, 0);
  for (const key of Object.keys(process.env)) assert.ok(!/^(?:NODE_OPTIONS|NODE_PATH|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY|DATABASE_URL|DIRECT_URL|GH_TOKEN|GITHUB_TOKEN)$/iu.test(key));
  const githubToken = process.env.ORDER_HANDOFF_GITHUB_TOKEN, ownerUrl = process.env.ORDER_HANDOFF_OWNER_URL,
    ownerUrlSha256 = process.env.ORDER_HANDOFF_OWNER_URL_SHA256;
  for (const key of ["ORDER_HANDOFF_GITHUB_TOKEN", "ORDER_HANDOFF_OWNER_URL", "ORDER_HANDOFF_OWNER_URL_SHA256"]) delete process.env[key];
  assert.match(githubToken, /^[\x21-\x7e]{8,4096}$/u); common.sha(ownerUrlSha256);
  assert.ok(typeof ownerUrl === "string" && ownerUrl.length <= 8192); assert.equal(hash(ownerUrl), ownerUrlSha256);
  const { discoverOrderHandoffJob } = await import(pathToFileURL(path.join(root, "scripts/order-handoff-github.mjs")).href);
  const admission = await discoverOrderHandoffJob({ context: plan.context, githubToken });
  guard(); pinPlan(); pinReady(); pinCap(); fence.verify(source);
  const socketPath = path.join(channel, "handoff.sock"), original = fs.lstatSync(socketPath);
  assert.ok(original.isSocket() && original.uid === process.getuid() && (original.mode & 0o7777) === 0o600);
  const packet = JSON.stringify({ nonce, sessionId: ready.sessionId, admission, githubToken, ownerUrl, ownerUrlSha256 }) + "\n";
  assert.ok(Buffer.byteLength(packet) <= 32768);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let bytes = Buffer.alloc(0), finished = false;
    const fail = () => { if (finished) return; finished = true; socket.destroy(); reject(new Error(common.FAILURE)); };
    socket.setTimeout(900000, fail); socket.on("error", fail); socket.on("close", fail);
    socket.on("connect", () => { try {
      guard(); pinPlan(); pinReady(); pinCap();
      const current = fs.lstatSync(socketPath);
      for (const key of ["dev", "ino", "mode", "uid", "ctimeMs"]) assert.equal(current[key], original[key]);
      socket.write(packet);
    } catch { fail(); } });
    socket.on("data", part => { try {
      bytes = Buffer.concat([bytes, part]); assert.ok(bytes.length <= 1024);
      if (!bytes.includes(10)) return;
      assert.equal(bytes.indexOf(10), bytes.length - 1);
      const result = JSON.parse(bytes); common.keys(result, ["outcome", ...Object.keys(common.FLAGS)]);
      assert.equal(result.outcome, "passed");
      for (const [key, value] of Object.entries(common.FLAGS)) assert.equal(result[key], value);
      guard(); pinPlan(); pinReady(); pinCap(); finished = true; socket.destroy(); resolve(result);
    } catch { fail(); } });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { assert.equal(process.argv.length, 3); process.stdout.write(JSON.stringify(await handoffOrderCredentials(process.argv[2])) + "\n"); }
  catch { process.stderr.write("Order handoff failed; preserve attempt; no automatic retry\n"); process.exitCode = 1; }
}
