// Parent transport only. The release graph and all admission state live in the
// child. No CLI, credential loader, workflow dispatch or mutation command.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FAILURE = "Order dormant worker unavailable; no execution admission";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const BOOTSTRAP = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
try {
  const reviewed = JSON.parse(process.argv[1]);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(process.version, reviewed.nodeVersion);
  assert.equal(digest(fs.readFileSync(process.execPath)), reviewed.nodeSha256);
  const root = process.cwd();
  assert.equal(fs.realpathSync(root), root);
  const read = relative => {
    const file = path.join(root, relative);
    assert.equal(fs.realpathSync(file), file);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024);
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  };
  assert.equal(digest(read('scripts/order-zero-direct-release-source.mjs')), reviewed.sourceFenceSha256);
  const {createOrderZeroDirectSourceFence} = await import(pathToFileURL(path.join(root, 'scripts/order-zero-direct-release-source.mjs')).href);
  const fence = createOrderZeroDirectSourceFence(root, reviewed.releaseCommit);
  const source = fence.capture();
  assert.equal(source.catalogSha256, reviewed.sourceCatalogSha256);
  fence.verify(source);
  const {runOrderZeroDirectWorker} = await import(pathToFileURL(path.join(root, 'scripts/order-zero-direct-release-worker-child.mjs')).href);
  await runOrderZeroDirectWorker({reviewed, fence, source});
} catch { process.stderr.write('${FAILURE}'); process.exit(1); }
`;

// The supplied directory must be a separate clean checkout with NO existing
// node_modules. Pins are reviewed inputs, never derived here from installed code.
export async function startOrderZeroDirectWorker({ directory, reviewed: input }) {
  let child;
  try {
    const reviewed = structuredClone(input);
    assert.deepEqual(Object.keys(reviewed).sort(), ["nodeSha256", "nodeVersion", "npmCli", "npmCliSha256", "npmVersion", "releaseCommit", "sourceCatalogSha256", "sourceFenceSha256"]);
    for (const key of ["nodeSha256", "npmCliSha256", "sourceCatalogSha256", "sourceFenceSha256"]) assert.match(reviewed[key], /^[a-f0-9]{64}$/u);
    assert.match(reviewed.releaseCommit, /^[a-f0-9]{40}$/u);
    assert.match(reviewed.nodeVersion, /^v22\.\d+\.\d+$/u);
    assert.match(reviewed.npmVersion, /^\d+\.\d+\.\d+$/u);
    assert.equal(process.version, reviewed.nodeVersion);
    assert.equal(path.resolve(directory), directory);
    assert.equal(fs.realpathSync(directory), directory);
    assert.equal(fs.realpathSync(reviewed.npmCli), reviewed.npmCli);
    assert.equal(path.basename(reviewed.npmCli), "npm-cli.js");
    const node = fs.realpathSync(process.execPath);
    assert.equal(hash(fs.readFileSync(node)), reviewed.nodeSha256);
    child = spawn(node, ["--input-type=module", "--eval", BOOTSTRAP, JSON.stringify(reviewed)], {
      cwd: directory, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C", LC_ALL: "C" },
    });
    let closed = false, pending, sequence = 0, outputBytes = 0;
    let resolveExit;
    const exited = new Promise(resolve => { resolveExit = resolve; });
    const invalidate = () => {
      if (closed) return;
      closed = true;
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(FAILURE)); pending = undefined; }
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    };
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 16384) invalidate(); // Never relay subprocess output.
    });
    child.on("error", invalidate);
    child.on("exit", () => { invalidate(); resolveExit(); });
    child.on("message", message => {
      if (!pending || !message || message.id !== pending.id || typeof message.ok !== "boolean"
        || Buffer.byteLength(JSON.stringify(message)) > 16384) return invalidate();
      const current = pending; pending = undefined; clearTimeout(current.timer);
      if (!message.ok) { current.reject(new Error(FAILURE)); invalidate(); }
      else current.resolve(Object.freeze(message.result));
    });
    const request = (command, payload = {}) => {
      if (closed || pending) return Promise.reject(new Error(FAILURE));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(invalidate, command === "prepare" ? 600000 : 180000);
        pending = { id, resolve, reject, timer };
        child.send({ id, command, payload }, error => { if (error) invalidate(); });
      });
    };
    // Readiness is an IPC handshake; this is the same child that will prepare,
    // import, observe admission and retain the opaque file-fence handle.
    const ready = await request("ready");
    return Object.freeze({ pid: ready.workerPid,
      prepare: () => request("prepare"), status: () => request("status"),
      load: payload => request("load", payload),
      inspect: payload => request("inspect", payload),
      revalidate: payload => request("revalidate", payload),
      close: async () => { invalidate(); await exited; },
    });
  } catch { child?.kill("SIGKILL"); throw new Error(FAILURE); }
}
