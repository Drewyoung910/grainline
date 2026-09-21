import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeR2GitHubCliAuthorization } from "../scripts/r2-github-cli-authorization.mjs";

const TOKEN = "synthetic_authorization_not_a_real_credential";
const FAIL = "R2 GitHub authorization refused; no CLI credential or diagnostic disclosed.";
function fixture(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "r2-gh-auth-test-"))), executable = join(home, "gh");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bytes = Buffer.from("synthetic executable; never launched"); writeFileSync(executable, bytes, { mode: 0o700 });
  const f = { home, executable, calls: [], buffers: [], token: TOKEN };
  f.options = { home, configDirectory: home, executable, executableSha256: createHash("sha256").update(bytes).digest("hex"),
    execute(path, args, options, callback) {
      f.calls.push({ path, args, options }); const out = Buffer.from(f.token + "\n"), err = Buffer.from("suppressed diagnostic");
      f.buffers.push(out, err); callback(null, out, err);
    } };
  f.run = (callback = async token => { assert.equal(token, TOKEN); return "safe result"; }, options) => makeR2GitHubCliAuthorization(f.options)(callback, options);
  return f;
}

test("pinned CLI supplies one callback, rechecks token, drops inherited environment and erases buffers", async t => {
  const f = fixture(t); assert.equal(await f.run(), "safe result"); assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.path, f.executable); assert.deepEqual(call.args, ["auth", "token", "--hostname", "github.com"]);
    assert.deepEqual(Object.keys(call.options.env).sort(), ["HOME", "PATH", "GH_CONFIG_DIR", "GH_HOST", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "GH_PAGER"].sort());
    assert.equal(call.options.env.PATH, "/usr/bin:/bin"); assert.equal(call.options.env.GH_CONFIG_DIR, f.home);
    assert.equal(call.options.encoding, "buffer"); assert.equal(call.options.maxBuffer, 4096); assert.equal(call.options.timeout, 10000);
  }
  assert.ok(f.buffers.every(buffer => buffer.every(byte => byte === 0)));
});
for (const kind of ["wrong hash", "group writable", "symlink", "not executable", "noncanonical home"]) test(`authorization refuses ${kind} before running CLI`, async t => {
  const f = fixture(t);
  if (kind === "wrong hash") f.options.executableSha256 = "a".repeat(64);
  if (kind === "group writable") chmodSync(f.executable, 0o770);
  if (kind === "not executable") chmodSync(f.executable, 0o600);
  if (kind === "noncanonical home") f.options.home += "/.";
  if (kind === "symlink") { const path = join(f.home, "link"); symlinkSync(f.executable, path); f.options.executable = path; }
  await assert.rejects(f.run(), { message: FAIL }); assert.equal(f.calls.length, 0);
});
test("changed authorization withholds callback result", async t => {
  const f = fixture(t); await assert.rejects(f.run(async () => { f.token = "different_synthetic_authorization"; return "receipt"; }), { message: FAIL });
  assert.equal(f.calls.length, 2); assert.ok(f.buffers.every(buffer => buffer.every(byte => byte === 0)));
});
test("changed CLI after callback refuses before second execution", async t => {
  const f = fixture(t); await assert.rejects(f.run(async () => { writeFileSync(f.executable, "changed"); }), { message: FAIL });
  assert.equal(f.calls.length, 1);
});
test("CLI errors are sanitized and captured output erased", async t => {
  const f = fixture(t), out = Buffer.from(TOKEN), err = Buffer.from(TOKEN);
  f.options.execute = (path, args, options, callback) => callback(new Error(TOKEN), out, err);
  await assert.rejects(f.run(), { message: FAIL }); assert.ok(out.every(byte => byte === 0) && err.every(byte => byte === 0));
});
test("malformed CLI token never reaches callback", async t => {
  const f = fixture(t); f.token = "bad\ntoken"; let entered = false;
  await assert.rejects(f.run(async () => { entered = true; }), { message: FAIL }); assert.equal(entered, false);
});
test("aborted authorization never launches CLI", async t => {
  const f = fixture(t); await assert.rejects(f.run(undefined, { signal: AbortSignal.abort() }), { message: FAIL }); assert.equal(f.calls.length, 0);
});
test("callback error cannot leak its credential in diagnostics", async t => {
  const f = fixture(t); await assert.rejects(f.run(async token => { throw new Error(token); }), { message: FAIL });
  assert.ok(f.buffers.every(buffer => buffer.every(byte => byte === 0)));
});
