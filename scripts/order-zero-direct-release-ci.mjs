// Dormant read-only collector. The caller supplies a reviewed release binding
// and an already-held token. No token loader, CLI, workflow dispatch or runner.
import assert from "node:assert/strict";
import { createOrderZeroDirectSourceFence } from "./order-zero-direct-release-source.mjs";

const REPOSITORY = "Drewyoung910/grainline";
const API = `https://api.github.com/repos/${REPOSITORY}/`;
const fail = () => new Error("Order exact-main CI binding unavailable or mismatched; no admission");
const KEYS = ["ciRunAttempt", "ciRunId", "releaseCommit", "sourceCatalogSha256"];

function binding(input) {
  const value = structuredClone(input);
  assert.deepEqual(Object.keys(value).sort(), KEYS);
  assert.ok(typeof value.releaseCommit === "string" && /^[a-f0-9]{40}$/u.test(value.releaseCommit));
  assert.ok(typeof value.sourceCatalogSha256 === "string" && /^[a-f0-9]{64}$/u.test(value.sourceCatalogSha256));
  for (const key of ["ciRunId", "ciRunAttempt"]) assert.ok(typeof value[key] === "string" && /^[1-9][0-9]{0,15}$/u.test(value[key]) && Number.isSafeInteger(Number(value[key])));
  return Object.freeze(value);
}

async function read(resource, token) {
  const url = `${API}${resource}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetch(url, { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    assert.ok(response.status === 200 && !response.redirected && response.body);
    if (response.url) assert.equal(response.url, url);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/iu);
    const declared = response.headers.get("content-length");
    assert.ok(declared === null || (/^\d+$/u.test(declared) && Number(declared) <= 1024 * 1024));
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; assert.ok(size <= 1024 * 1024); chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value;
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) { try { await reader.cancel(); } catch { /* No provider payloads in errors. */ } }
  }
}

export async function collectOrderZeroDirectCiBinding({ directory, reviewed: input, githubToken }) {
  try {
    const reviewed = binding(input);
    assert.ok(!Object.keys(process.env).some(key => /^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY)$/iu.test(key)));
    assert.ok(typeof githubToken === "string" && /^[\x21-\x7e]{8,4096}$/u.test(githubToken));
    const fence = createOrderZeroDirectSourceFence(directory, reviewed.releaseCommit);
    const source = fence.capture();
    assert.equal(source.catalogSha256, reviewed.sourceCatalogSha256);
    const checkMain = raw => assert.ok(raw.ref === "refs/heads/main" && raw.object?.type === "commit" && raw.object.sha === reviewed.releaseCommit);
    const checkRun = raw => {
      assert.ok(Number.isSafeInteger(raw.id) && String(raw.id) === reviewed.ciRunId &&
        Number.isSafeInteger(raw.run_attempt) && String(raw.run_attempt) === reviewed.ciRunAttempt &&
        raw.repository?.full_name === REPOSITORY && raw.head_repository?.full_name === REPOSITORY &&
        raw.head_sha === reviewed.releaseCommit && raw.head_branch === "main" &&
        raw.path === ".github/workflows/ci.yml" && raw.event === "push" &&
        raw.status === "completed" && raw.conclusion === "success");
    };
    checkMain(await read("git/ref/heads/main", githubToken));
    checkRun(await read(`actions/runs/${reviewed.ciRunId}`, githubToken));
    // Refuse a moved branch or restarted run while observations are collected.
    checkMain(await read("git/ref/heads/main", githubToken));
    checkRun(await read(`actions/runs/${reviewed.ciRunId}`, githubToken));
    fence.verify(source);
    return Object.freeze({ ...reviewed, repository: REPOSITORY, exactMainCiObserved: true,
      trackedFileCount: source.fileCount, loadedSourceProven: false, installedToolchainProven: false,
      freshDatabaseScopeProven: false, completeProductionScope: false, productionExecutionAuthorized: false });
  } catch { throw fail(); }
}
