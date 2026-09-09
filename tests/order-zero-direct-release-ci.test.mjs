import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOrderZeroDirectSourceFence } from "../scripts/order-zero-direct-release-source.mjs";
import { collectOrderZeroDirectCiBinding } from "../scripts/order-zero-direct-release-ci.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-ci-binding-test-"));
  const git = args => execFileSync("/usr/bin/git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["remote", "add", "origin", "https://github.com/Drewyoung910/grainline.git"]);
  fs.writeFileSync(path.join(directory, "source.mjs"), "export const value = 1;\n");
  git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]);
  const releaseCommit = git(["rev-parse", "HEAD"]);
  const source = createOrderZeroDirectSourceFence(directory, releaseCommit).capture();
  const reviewed = { releaseCommit, ciRunId: "12345", ciRunAttempt: "2", sourceCatalogSha256: source.catalogSha256 };
  const main = { ref: "refs/heads/main", object: { type: "commit", sha: releaseCommit } };
  const run = { id: 12345, run_attempt: 2, repository: { full_name: "Drewyoung910/grainline" },
    head_repository: { full_name: "Drewyoung910/grainline" }, head_sha: releaseCommit, head_branch: "main",
    path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success" };
  const calls = [];
  let replies = [main, run, main, run];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options }); const value = replies.shift();
    return value instanceof Response ? value : Response.json(value);
  });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, reviewed, main, run, calls, setReplies: value => { replies = value; },
    collect: override => collectOrderZeroDirectCiBinding({ directory, reviewed, githubToken: "fixture-token-not-real", ...override }) };
}

test("exact-main/run-attempt observations are read twice, sanitized and never execution authority", async t => {
  const f = fixture(t); const result = await f.collect();
  assert.equal(result.exactMainCiObserved, true); assert.ok(Object.isFrozen(result));
  assert.equal(f.calls.length, 4);
  for (const call of f.calls) {
    assert.ok(call.url.startsWith("https://api.github.com/repos/Drewyoung910/grainline/"));
    assert.equal(call.options.method, "GET"); assert.equal(call.options.redirect, "error");
  }
  assert.ok(!JSON.stringify(result).includes("fixture-token"));
  for (const key of ["loadedSourceProven", "installedToolchainProven", "freshDatabaseScopeProven", "completeProductionScope", "productionExecutionAuthorized"]) assert.equal(result[key], false);
});

test("wrong repository, workflow, event, SHA, attempt and unsuccessful runs fail closed", async t => {
  const f = fixture(t);
  const changes = { id: 54321, run_attempt: 3, repository: { full_name: "other/repo" }, head_repository: { full_name: "other/repo" },
    head_sha: "0".repeat(40), head_branch: "branch", path: ".github/workflows/other.yml", event: "pull_request", status: "in_progress", conclusion: "failure" };
  for (const [key, value] of Object.entries(changes)) {
    f.setReplies([f.main, { ...f.run, [key]: value }]); await assert.rejects(f.collect(), /no admission/u);
  }
});

test("moving main, restarted CI and checkout drift during the request sequence fail", async t => {
  const f = fixture(t);
  f.setReplies([f.main, f.run, { ...f.main, object: { type: "commit", sha: "0".repeat(40) } }]);
  await assert.rejects(f.collect());
  f.setReplies([f.main, f.run, f.main, { ...f.run, run_attempt: 3 }]); await assert.rejects(f.collect());
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count += 1; if (count === 4) fs.appendFileSync(path.join(f.directory, "source.mjs"), "// drift");
    return Response.json(count % 2 ? f.main : f.run);
  });
  await assert.rejects(f.collect());
});

test("bad binding or source digest is rejected before any network request", async t => {
  const f = fixture(t);
  for (const reviewed of [null, { ...f.reviewed, extra: true }, { ...f.reviewed, ciRunId: "../123" },
    { ...f.reviewed, sourceCatalogSha256: "0".repeat(64) }]) await assert.rejects(f.collect({ reviewed }));
  assert.equal(f.calls.length, 0);
});

test("alternate TLS/proxy environment and invalid tokens are rejected without network access", async t => {
  const f = fixture(t);
  for (const key of ["NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY"]) {
    const before = process.env[key]; process.env[key] = "fixture";
    try { await assert.rejects(f.collect()); }
    finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
  }
  for (const githubToken of [null, "short", "has whitespace", "x".repeat(4097)]) await assert.rejects(f.collect({ githubToken }));
  assert.equal(f.calls.length, 0);
});

test("transport failures and oversized or non-JSON responses never leak provider payloads", async t => {
  const f = fixture(t);
  for (const response of [new Response("secret-provider-error", { status: 403 }),
    new Response("secret-provider-error", { headers: { "content-type": "text/html" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "1048577" } }),
    new Response("x".repeat(1048577), { headers: { "content-type": "application/json" } }), Response.json([])]) {
    f.setReplies([response]); await assert.rejects(f.collect(), error => !error.message.includes("secret") && /no admission/u.test(error.message));
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret-token"); });
  await assert.rejects(f.collect(), error => !error.message.includes("secret"));
});
