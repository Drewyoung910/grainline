// Read-only, dormant collectors. No CLI, token/file loader, database access or
// provider mutations. Raw provider payloads and credentials never leave here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertStaffBootstrapRelease, assertStaffBootstrapReviewedBinding } from "./order-staff-read-bootstrap-release.mjs";

const REPO = "Drewyoung910/grainline";
const TEAM = "team_wvQeQHZGwCSwinC1uB7xbpjr";
const PROJECT = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
const ALIASES = Object.freeze(["grainline-drew-youngs-projects.vercel.app", "grainline.vercel.app", "thegrainline.com", "www.thegrainline.com"]);
const MAX_BYTES = 2 * 1024 * 1024;
const failed = () => new Error("staff bootstrap observations unavailable or mismatched; no admission");
const deepFreeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

export function readStaffBootstrapGit(directory, run = execFileSync) {
  try {
    assert.ok(path.isAbsolute(directory) && path.resolve(directory) === directory && fs.realpathSync(directory) === directory);
    const git = args => run("/usr/bin/git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory, encoding: "utf8", timeout: 10000, maxBuffer: MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    assert.equal(fs.realpathSync(git(["rev-parse", "--show-toplevel"]).trim()), directory);
    assert.ok([`https://github.com/${REPO}.git`, `git@github.com:${REPO}.git`].includes(git(["remote", "get-url", "origin"]).trim()));
    // A clean status alone ignores assume-unchanged/skip-worktree files. Refuse
    // those index flags instead of accepting an edited executable as exact HEAD.
    assert.ok(git(["ls-files", "-v", "-z"]).split("\0").filter(Boolean).every(entry => entry.startsWith("H ")));
    const head = git(["rev-parse", "--verify", "HEAD"]).trim();
    const status = git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]);
    assert.ok(/^[0-9a-f]{40}$/u.test(head) && status === "");
    return Object.freeze({ head, status, repository: REPO });
  } catch { throw failed(); }
}

function checkTransportEnvironment(env) {
  // Fail closed rather than silently inheriting alternate TLS trust, loaders or
  // proxies. Same-user process compromise is outside this local operator model.
  assert.ok(env && typeof env === "object" && !Object.keys(env).some(key =>
    /^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY)$/iu.test(key)));
}

function checkToken(token) { assert.ok(typeof token === "string" && /^[\x21-\x7e]{8,4096}$/u.test(token)); }

async function readJson(url, token, fetchImpl) {
  let reader;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    assert.ok(["https://api.github.com", "https://api.vercel.com"].includes(url.origin));
    checkToken(token);
    const response = await fetchImpl(url, { method: "GET", redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    assert.ok(response.status === 200 && !response.redirected && response.body &&
      /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""));
    if (response.url) assert.equal(response.url, url.href);
    const declared = response.headers.get("content-length");
    if (declared !== null) assert.ok(/^\d+$/u.test(declared) && Number(declared) <= MAX_BYTES);
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= MAX_BYTES);
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    return parsed;
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) { try { await reader.cancel(); } catch { /* Never echo provider errors. */ } }
  }
}

function runFields(raw, includeAttempt = false) {
  return { id: raw.id, ...(includeAttempt ? { run_attempt: raw.run_attempt } : {}), repository: { full_name: raw.repository?.full_name },
    head_sha: raw.head_sha, head_branch: raw.head_branch, path: raw.path, event: raw.event,
    status: raw.status, conclusion: raw.conclusion };
}
function deploymentFields(raw, reviewed) {
  assert.ok(raw.id === reviewed.deploymentId && raw.projectId === PROJECT && raw.team?.id === TEAM &&
    raw.target === "production" && raw.readyState === "READY");
  // CLI releases have no gitSource. Their source label is checked against the
  // independently reviewed exact deployment binding, never used to generate
  // that binding. This metadata is NOT a proof of uploaded build bytes.
  assert.ok(raw.source === "cli" || raw.source === "git");
  const sourceCommit = raw.source === "cli" ? raw.meta?.gitCommitSha : raw.gitSource?.sha;
  assert.equal(sourceCommit, reviewed.deployedSourceCommit);
  for (const sha of [raw.gitSource?.sha, raw.meta?.gitCommitSha, raw.meta?.githubCommitSha]) {
    if (sha !== undefined) assert.equal(sha, reviewed.deployedSourceCommit);
  }
  return { id: raw.id, projectId: raw.projectId, teamId: raw.team.id,
    target: raw.target, readyState: raw.readyState, sourceCommit };
}

export async function collectStaffBootstrapObservations({ reviewed: input, directory, loadProviderTokens,
  observeCredentialEpoch, fetchImpl = fetch, readGit = readStaffBootstrapGit, env = process.env }) {
  try {
    const reviewed = assertStaffBootstrapReviewedBinding(input);
    checkTransportEnvironment({ ...env });
    assert.ok(typeof loadProviderTokens === "function" && typeof observeCredentialEpoch === "function");
    const before = readGit(directory);
    assert.ok(before.head === reviewed.releaseCommit && before.status === "" && before.repository === REPO);
    const tokens = await loadProviderTokens();
    // Snapshot primitives so an awaited callback cannot change token selection.
    const githubToken = tokens?.github, vercelToken = tokens?.vercel;
    checkToken(githubToken); checkToken(vercelToken);
    const github = resource => readJson(new URL(`https://api.github.com/repos/${REPO}/${resource}`), githubToken, fetchImpl);
    const vercel = async alias => {
      const url = new URL(`https://api.vercel.com/v13/deployments/${reviewed.deploymentId}`);
      url.searchParams.set("teamId", TEAM);
      if (alias) url.searchParams.set("url", alias);
      return deploymentFields(await readJson(url, vercelToken, fetchImpl), reviewed);
    };
    const remote = await github("git/ref/heads/main");
    assert.ok(remote.ref === "refs/heads/main" && remote.object?.type === "commit" && remote.object.sha === reviewed.releaseCommit);
    const ci = runFields(await github(`actions/runs/${reviewed.ciRunId}`));
    const tlsProofRun = runFields(await github(`actions/runs/${reviewed.tlsProofRunId}`), true);
    const rawJob = await github(`actions/jobs/${reviewed.tlsProofJobId}`);
    assert.ok(Array.isArray(rawJob.steps) && rawJob.steps.length <= 100);
    assert.ok(rawJob.steps.every(step => typeof step.name === "string" && step.name.length <= 200));
    const tlsProofJob = { id: rawJob.id, run_id: rawJob.run_id, run_attempt: rawJob.run_attempt, head_sha: rawJob.head_sha,
      name: rawJob.name, status: rawJob.status, conclusion: rawJob.conclusion,
      steps: rawJob.steps.map(({ name, status, conclusion }) => ({ name, status, conclusion })) };
    const deployment = await vercel();
    deployment.aliases = [];
    for (const hostname of ALIASES) deployment.aliases.push({ hostname, deploymentId: (await vercel(hostname)).id });
    const epoch = await observeCredentialEpoch();
    const credentialEpoch = { evidenceSha256: epoch?.evidenceSha256, status: epoch?.status,
      currentCredentialsMatch: epoch?.currentCredentialsMatch };
    const after = readGit(directory);
    assert.deepEqual(after, before);
    const finalRemote = await github("git/ref/heads/main");
    assert.ok(finalRemote.ref === remote.ref && finalRemote.object?.type === "commit" && finalRemote.object.sha === remote.object.sha);
    const observations = { git: { ...after, remoteMain: remote.object.sha }, ci, tlsProofRun, tlsProofJob, deployment, credentialEpoch };
    assertStaffBootstrapRelease({ reviewed, ...observations });
    return deepFreeze(observations);
  } catch { throw failed(); }
}
