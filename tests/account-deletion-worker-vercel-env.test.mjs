import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { newAccountDeletionBootstrapState } from "../scripts/account-deletion-worker-role-bootstrap.mjs";
import {
  buildAccountDeletionDatabaseUrl,
  installAccountDeletionDatabaseUrl,
} from "../scripts/account-deletion-worker-vercel-env.mjs";

const binding = { releaseCommit: "a".repeat(40), ciRunId: "38165775454" };
const token = "fixture-vercel-token";
const id = "env_account_deletion_fixture";
const verified = () => ({ ...newAccountDeletionBootstrapState(binding), stage: "role-verified" });
const hash = value => createHash("sha256").update(value).digest("hex");

function response(value, url = "https://api.vercel.com/v10/projects/project/env") {
  const text = JSON.stringify(value);
  const result = new Response(text, { headers: { "content-length": String(Buffer.byteLength(text)),
    "content-type": "application/json" } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function exactRow(state) {
  const value = buildAccountDeletionDatabaseUrl(state, binding);
  return { id, key: "ACCOUNT_DELETION_DATABASE_URL", type: "sensitive", target: ["production"],
    gitBranch: null, comment: `Grainline account-deletion worker ${state.attemptId} sha256:${hash(value)}` };
}

test("worker URL is same-database pooled, strict TLS and exact dedicated role", () => {
  const state = verified();
  const value = buildAccountDeletionDatabaseUrl(state, binding);
  const url = new URL(value);
  assert.equal(url.username, "grainline_account_deletion_runtime");
  assert.ok(url.password === state.password);
  assert.equal(url.hostname, "ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech");
  assert.equal(url.pathname, "/neondb");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("channel_binding"), "require");
  assert.throws(() => buildAccountDeletionDatabaseUrl({ ...state, stage: "create-pending" }, binding));
});

test("installer creates only the sensitive Production row and returns sanitized evidence", async () => {
  const state = verified();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    if (calls.length === 1) return response({ envs: [] }, url.toString());
    if (calls.length === 2) {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ["comment", "key", "target", "type", "value"]);
      assert.equal(body.key, "ACCOUNT_DELETION_DATABASE_URL");
      assert.equal(body.type, "sensitive");
      assert.deepEqual(body.target, ["production"]);
      assert.ok(body.value === buildAccountDeletionDatabaseUrl(state, binding));
      return response(exactRow(state), url.toString());
    }
    return response({ envs: [exactRow(state)] }, url.toString());
  };
  const result = await installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token, fetchImpl });
  assert.equal(result.status, "installed");
  assert.equal(result.key, "ACCOUNT_DELETION_DATABASE_URL");
  assert.equal(result.environmentId, id);
  assert.ok(!JSON.stringify(result).includes(state.password));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.includes("teamId=team_wvQeQHZGwCSwinC1uB7xbpjr")));
  assert.ok(calls.every(call => call.options.redirect === "error"));
});

test("exact retry and ambiguous create response converge without credential rotation", async () => {
  for (const mode of ["already-installed", "ambiguous-post"]) {
    const state = verified();
    let reads = 0;
    const fetchImpl = async (url, options) => {
      if ((options.method ?? "GET") === "POST") throw new Error(state.password);
      reads++;
      const present = mode === "already-installed" || reads > 1;
      return response({ envs: present ? [exactRow(state)] : [] }, url.toString());
    };
    const result = await installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token, fetchImpl });
    assert.equal(result.valueSha256, hash(buildAccountDeletionDatabaseUrl(state, binding)));
  }
});

test("conflicting rows, metadata drift, transport drift and oversized responses fail closed", async () => {
  const state = verified();
  const badRows = [
    [{ ...exactRow(state), type: "plain" }],
    [{ ...exactRow(state), target: ["preview"] }],
    [{ ...exactRow(state), comment: "another attempt" }],
    [exactRow(state), { ...exactRow(state), id: "env_duplicate_fixture" }],
  ];
  for (const envs of badRows) {
    await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token,
      fetchImpl: async (url) => response({ envs }, url.toString()) }), /installation stopped/u);
  }
  await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token,
    fetchImpl: async () => response({ envs: [] }, "https://evil.invalid/") }), /installation stopped/u);
  await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token,
    fetchImpl: async (url) => {
      const result = response({ envs: [] }, url.toString());
      Object.defineProperty(result, "headers", { value: new Headers({ "content-length": "999999", "content-type": "application/json" }) });
      return result;
    } }), /installation stopped/u);
  await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token,
    fetchImpl: async (url) => {
      const result = response({ envs: [] }, url.toString());
      Object.defineProperty(result, "headers", { value: new Headers({ "content-type": "text/plain" }) });
      return result;
    } }), /installation stopped/u);
  await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: "bad token", fetchImpl: fetch }), /installation stopped/u);
});

test("streamed provider responses are stopped at the byte cap without a content length", async () => {
  const state = verified();
  let pulls = 0;
  let cancelled = false;
  const fetchImpl = async (url) => {
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(70_000).fill(0x20));
      },
      cancel() { cancelled = true; },
    });
    const result = new Response(body, { headers: { "content-type": "application/json" } });
    Object.defineProperty(result, "url", { value: url.toString() });
    return result;
  };
  await assert.rejects(installAccountDeletionDatabaseUrl({ state, binding, vercelToken: token, fetchImpl }),
    /installation stopped/u);
  assert.ok(pulls <= 3);
  assert.equal(cancelled, true);
});
