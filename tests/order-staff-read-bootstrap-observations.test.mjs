import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectStaffBootstrapObservations, readStaffBootstrapGit } from "../scripts/order-staff-read-bootstrap-observations.mjs";
import { staffReleaseFixture } from "./helpers/staff-bootstrap-release-fixture.mjs";
import { coordinateStaffBootstrap } from "../scripts/order-staff-read-bootstrap-coordinator.mjs";
import { STAFF_BOOTSTRAP_ROLE, staffBootstrapMarker } from "../scripts/order-staff-read-role-bootstrap.mjs";

function fixture() {
  const release = staffReleaseFixture();
  const calls = [];
  let gitReads = 0, tokenReads = 0;
  const rawDeployment = { ...release.deployment, team: { id: release.deployment.teamId }, source: "cli",
    meta: { gitCommitSha: release.reviewed.deployedSourceCommit, unrelatedSensitiveValue: "DO_NOT_RETURN" },
    env: { DO_NOT_RETURN: "provider-private-payload" } };
  const options = { reviewed: release.reviewed, directory: "/unused-fixture", env: {},
    readGit() { gitReads++; return { head: release.reviewed.releaseCommit, status: "", repository: "Drewyoung910/grainline" }; },
    async loadProviderTokens() { tokenReads++; return { github: "fixture-github-token", vercel: "fixture-vercel-token" }; },
    async observeCredentialEpoch() { return { ...release.credentialEpoch, privateField: "DO_NOT_RETURN" }; },
    async fetchImpl(url, config) {
      calls.push({ url: url.href, config });
      assert.equal(config.method, "GET");
      assert.equal(config.redirect, "error");
      assert.equal(config.cache, "no-store");
      assert.equal(config.body, undefined);
      assert.ok(config.signal instanceof AbortSignal);
      let value;
      if (url.hostname === "api.vercel.com") {
        assert.equal(config.headers.Authorization, "Bearer fixture-vercel-token");
        assert.equal(url.pathname, `/v13/deployments/${release.reviewed.deploymentId}`);
        assert.equal(url.searchParams.get("teamId"), release.deployment.teamId);
        assert.ok(!url.searchParams.has("url") || release.deployment.aliases.some(alias => alias.hostname === url.searchParams.get("url")));
        value = rawDeployment;
      } else {
        assert.equal(url.hostname, "api.github.com");
        assert.equal(config.headers.Authorization, "Bearer fixture-github-token");
        assert.equal(url.search, "");
        assert.ok(url.pathname.startsWith("/repos/Drewyoung910/grainline/"));
        const resource = url.pathname.slice("/repos/Drewyoung910/grainline/".length);
        const values = {
          "git/ref/heads/main": { ref: "refs/heads/main", object: { type: "commit", sha: release.reviewed.releaseCommit } },
          [`actions/runs/${release.reviewed.ciRunId}`]: release.ci,
          [`actions/runs/${release.reviewed.tlsProofRunId}`]: release.tlsProofRun,
          [`actions/jobs/${release.reviewed.tlsProofJobId}`]: release.tlsProofJob,
        };
        assert.ok(Object.hasOwn(values, resource));
        value = values[resource];
      }
      return Response.json({ ...value, unnecessaryPayload: "DO_NOT_RETURN" });
    },
  };
  return { release, rawDeployment, calls, options, counts: () => ({ gitReads, tokenReads }) };
}

test("collector independently reads exact GitHub and all four aliases, returning only frozen admission fields", async () => {
  const f = fixture();
  f.rawDeployment.aliases = ["untrusted-provider-array"];
  f.release.ci.run_attempt = { unexpected: "DO_NOT_RETURN" };
  const result = await collectStaffBootstrapObservations(f.options);
  assert.equal(f.calls.length, 10);
  assert.deepEqual(f.counts(), { gitReads: 2, tokenReads: 1 });
  assert.equal(result.git.remoteMain, f.release.reviewed.releaseCommit);
  assert.deepEqual(result.deployment, { ...f.release.deployment,
    aliases: [...f.release.deployment.aliases].sort((a, b) => a.hostname.localeCompare(b.hostname)) });
  assert.equal(result.tlsProofJob.id, f.release.tlsProofJob.id);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN|token|provider-private/u);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.deployment.aliases[0]) && Object.isFrozen(result.tlsProofJob.steps));
  assert.ok(f.calls.every(call => call.config.signal.aborted));
});

test("provider Git deployments require source SHA too, with no conflicting metadata fallback", async () => {
  const f = fixture();
  f.rawDeployment.source = "git";
  f.rawDeployment.gitSource = { sha: f.release.reviewed.deployedSourceCommit };
  assert.equal((await collectStaffBootstrapObservations(f.options)).deployment.sourceCommit, f.release.reviewed.deployedSourceCommit);
  delete f.rawDeployment.gitSource;
  await assert.rejects(collectStaffBootstrapObservations(f.options), /no admission/u);
});

test("both provider tokens are required before requests; no token enters URL or a child process", async () => {
  for (const tokens of [{ github: "fixture-github-token" }, { github: "fixture-github-token", vercel: "header\ninjection" }]) {
    const f = fixture(); f.options.loadProviderTokens = async () => tokens;
    await assert.rejects(collectStaffBootstrapObservations(f.options), /no admission/u);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await collectStaffBootstrapObservations(f.options);
  assert.ok(f.calls.every(({ url }) => !url.includes("token")));
});

test("invalid reviewed inputs, dirty Git and alternate transport trust fail before provider-token loading", async () => {
  for (const mutation of [
    f => { f.release.reviewed.ciRunId = "1/../../secrets"; },
    f => { f.release.reviewed.deploymentId = "https://evil.example"; },
    f => { f.options.readGit = () => { throw new Error("private path"); }; },
    f => { f.options.readGit = () => ({ head: "b".repeat(40) }); },
    ...["NODE_OPTIONS", "node_tls_reject_unauthorized", "HTTPS_PROXY", "NODE_USE_ENV_PROXY", "SSL_CERT_FILE"]
      .map(key => f => { f.options.env = { [key]: "private-value" }; }),
  ]) {
    const f = fixture(); mutation(f);
    await assert.rejects(collectStaffBootstrapObservations(f.options), /observations unavailable/u);
    assert.equal(f.counts().tokenReads, 0);
    assert.equal(f.calls.length, 0);
  }
});

test("provider HTTP, redirect, oversized stream and JSON errors are bounded and secret-free", async () => {
  const badResponses = [
    () => new Response("PRIVATE_SENTINEL", { status: 403 }),
    () => new Response("PRIVATE_SENTINEL", { status: 302, headers: { location: "https://evil.example" } }),
    () => new Response("PRIVATE_SENTINEL", { status: 200, headers: { "content-type": "text/plain" } }),
    () => new Response("PRIVATE_SENTINEL", { headers: { "content-type": "application/json" } }),
    () => Response.json([]),
    () => Response.json({}, { headers: { "content-length": "2097153" } }),
    () => Response.json({ value: "x".repeat(2097153) }),
    () => { throw new Error("PRIVATE_SENTINEL"); },
    () => { const r = Response.json({}); Object.defineProperty(r, "redirected", { value: true }); return r; },
    () => { const r = Response.json({}); Object.defineProperty(r, "url", { value: "https://evil.example" }); return r; },
  ];
  for (const create of badResponses) {
    const f = fixture(); f.options.fetchImpl = async () => create();
    await assert.rejects(collectStaffBootstrapObservations(f.options), error => {
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|token|evil/u);
      return /no admission/u.test(error.message);
    });
  }
});

test("stale or mixed release snapshots cannot be admitted", async () => {
  for (const mutation of [
    f => { f.release.ci.head_sha = "b".repeat(40); },
    f => { f.release.tlsProofJob.run_attempt += 1; },
    f => { f.release.tlsProofJob.steps[1].conclusion = "skipped"; },
    f => { f.rawDeployment.projectId = "other"; },
    f => { f.rawDeployment.team.id = "other"; },
    f => { f.rawDeployment.readyState = "ERROR"; },
    f => { f.rawDeployment.meta.gitCommitSha = "b".repeat(40); },
    f => { f.rawDeployment.gitSource = { sha: "b".repeat(40) }; },
    f => { f.rawDeployment.source = "unknown"; },
    f => { f.options.observeCredentialEpoch = async () => ({ ...f.release.credentialEpoch, currentCredentialsMatch: false }); },
    f => { let n = 0; const original = f.options.readGit; f.options.readGit = () => ({ ...original(), head: ++n === 1 ? f.release.reviewed.releaseCommit : "b".repeat(40) }); },
  ]) {
    const f = fixture(); mutation(f);
    await assert.rejects(collectStaffBootstrapObservations(f.options), /no admission/u);
  }
});

test("each alias and final remote main are resolved independently, not trusted from deployment arrays", async () => {
  for (const badIndex of [5, 6, 7, 8, 9]) {
    const f = fixture(); const original = f.options.fetchImpl;
    f.options.fetchImpl = async (url, config) => {
      const response = await original(url, config);
      if (f.calls.length - 1 !== badIndex) return response;
      const body = await response.json();
      if (badIndex === 9) body.object.sha = "b".repeat(40);
      else body.id = "dpl_wrong";
      return Response.json(body);
    };
    await assert.rejects(collectStaffBootstrapObservations(f.options), /no admission/u);
  }
});

test("in-flight caller mutation cannot replace the reviewed binding", async () => {
  const f = fixture(); const original = f.options.loadProviderTokens;
  f.options.loadProviderTokens = async () => {
    f.release.reviewed.releaseCommit = "b".repeat(40);
    return original();
  };
  await assert.rejects(collectStaffBootstrapObservations(f.options), /no admission/u);
});

test("collector feeds the journal coordinator and refuses an observed alias move before owner SQL", async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-observed-test-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = fixture(); let observations = 0, ownerCalls = 0;
  const options = { reviewed: f.release.reviewed, directory, env: {},
    observeRelease: () => {
      if (++observations === 3) f.rawDeployment.id = "dpl_moved";
      return collectStaffBootstrapObservations(f.options);
    },
    loadOwnerCredential: async () => ({ url: "unused-test-only", epochSha256: f.release.reviewed.credentialEpochSha256 }),
    connectionFactory: ({ state }) => ({
      async executeOwnerTransaction() { ownerCalls++; },
      async proveSeparateLogin() { return { currentUser: STAFF_BOOTSTRAP_ROLE, sessionUser: STAFF_BOOTSTRAP_ROLE,
        database: "neondb", marker: staffBootstrapMarker(state), restrictedRole: true, hasApplicationAuthority: false }; },
    }),
  };
  await assert.rejects(coordinateStaffBootstrap(options), /preserve the exact private attempt/u);
  assert.equal(ownerCalls, 0);
  f.rawDeployment.id = f.release.reviewed.deploymentId;
  assert.equal((await coordinateStaffBootstrap(options)).status, "role-verified");
  assert.equal(ownerCalls, 1);
});

test("local Git collector uses real repository state and refuses dirty, wrong-origin and nested directories", t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-git-test-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = args => execFileSync("/usr/bin/git", args, { cwd: directory, stdio: "pipe",
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).toString();
  git(["init", "-q"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
  git(["remote", "add", "origin", "https://github.com/Drewyoung910/grainline.git"]);
  assert.deepEqual(readStaffBootstrapGit(directory), { head: git(["rev-parse", "HEAD"]).trim(), status: "", repository: "Drewyoung910/grainline" });
  fs.mkdirSync(path.join(directory, "nested"));
  assert.throws(() => readStaffBootstrapGit(path.join(directory, "nested")), /no admission/u);
  fs.writeFileSync(path.join(directory, "untracked.txt"), "fixture");
  assert.throws(() => readStaffBootstrapGit(directory), /no admission/u);
  git(["add", "untracked.txt"]);
  assert.throws(() => readStaffBootstrapGit(directory), /no admission/u);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture file"]);
  for (const flag of ["assume-unchanged", "skip-worktree"]) {
    git(["update-index", `--${flag}`, "untracked.txt"]);
    assert.equal(git(["status", "--porcelain"]), "");
    assert.throws(() => readStaffBootstrapGit(directory), /no admission/u);
    git(["update-index", `--no-${flag}`, "untracked.txt"]);
  }
  git(["remote", "set-url", "origin", "https://github.com/other/grainline.git"]);
  assert.throws(() => readStaffBootstrapGit(directory), /no admission/u);
});
