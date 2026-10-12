// Separately bounded provider step. Import is inert: no environment reads,
// private-file reads, network calls, role changes, SQL or deployment effects.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { REVIEWED_PRODUCTION_ACCOUNT_DELETION_IDENTITY } from "./guard-runtime-db-env.mjs";
import {
  ACCOUNT_DELETION_BOOTSTRAP_ROLE,
  validateAccountDeletionBootstrapState,
} from "./account-deletion-worker-role-bootstrap.mjs";
import { accountDeletionBootstrapConnectionConfig } from "./account-deletion-worker-bootstrap-connection.mjs";

const PROJECT_ID = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
const TEAM_ID = "team_wvQeQHZGwCSwinC1uB7xbpjr";
const KEY = "ACCOUNT_DELETION_DATABASE_URL";
const MAX_RESPONSE_BYTES = 128 * 1024;
const ENV_ID = /^[A-Za-z0-9_]{8,128}$/u;
const TOKEN = /^[\x21-\x7e]{8,4096}$/u;
const stopped = () => new Error("account deletion Vercel environment installation stopped; preserve the exact private attempt");
const sha256 = value => createHash("sha256").update(value).digest("hex");

export function buildAccountDeletionDatabaseUrl(rawState, binding) {
  try {
    const state = validateAccountDeletionBootstrapState(rawState, binding);
    assert.equal(state.stage, "role-verified");
    const target = REVIEWED_PRODUCTION_ACCOUNT_DELETION_IDENTITY;
    const url = new URL(`postgresql://${ACCOUNT_DELETION_BOOTSTRAP_ROLE}@${target.endpointId}-pooler.${target.region}.neon.tech:5432/${target.databaseName}`);
    url.password = state.password;
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("channel_binding", "require");
    accountDeletionBootstrapConnectionConfig(url.toString(), ACCOUNT_DELETION_BOOTSTRAP_ROLE, {});
    return url.toString();
  } catch { throw stopped(); }
}

function expectedComment(state, valueSha256) {
  return `Grainline account-deletion worker ${state.attemptId} sha256:${valueSha256}`;
}

function exactEntry(row, comment) {
  return row && typeof row === "object" && ENV_ID.test(row.id ?? "") && row.key === KEY &&
    row.type === "sensitive" && row.gitBranch == null && row.comment === comment &&
    Array.isArray(row.target) && row.target.length === 1 && row.target[0] === "production";
}

async function boundedJson(response, expectedUrl) {
  let reader;
  assert.ok(response && response.ok === true && response.redirected !== true &&
    response.url === expectedUrl.href && response.body &&
    /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""));
  const declared = response.headers.get("content-length");
  if (declared !== null) assert.ok(/^\d+$/u.test(declared) && Number(declared) <= MAX_RESPONSE_BYTES);
  try {
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= MAX_RESPONSE_BYTES);
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value;
  } finally {
    if (reader) { try { await reader.cancel(); } catch { /* Never echo provider errors. */ } }
  }
}

async function request(path, token, fetchImpl, options = {}) {
  assert.ok(TOKEN.test(token) && typeof fetchImpl === "function");
  const url = new URL(path, "https://api.vercel.com");
  assert.equal(url.origin, "https://api.vercel.com");
  url.searchParams.set("teamId", TEAM_ID);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return boundedJson(await fetchImpl(url, {
    method: options.method ?? "GET", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: Object.freeze({ Authorization: `Bearer ${token}`, Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) }),
    body,
  }), url);
}

async function inventory(token, fetchImpl) {
  const payload = await request(`/v10/projects/${PROJECT_ID}/env?decrypt=false`, token, fetchImpl);
  assert.ok(Array.isArray(payload.envs) && payload.envs.length <= 1000);
  return payload.envs.filter(row => row?.key === KEY);
}

function acceptedEvidence(state, valueSha256, rows) {
  const comment = expectedComment(state, valueSha256);
  assert.ok(rows.length === 1 && exactEntry(rows[0], comment));
  return Object.freeze({ status: "installed", key: KEY, environmentId: rows[0].id,
    projectId: PROJECT_ID, teamId: TEAM_ID, target: "production", valueSha256 });
}

// Read-only confirmation for local secret retirement after an older admitted
// installer has written the exact row. It never creates, updates or deletes a
// provider resource.
export async function inspectAccountDeletionDatabaseUrl({ state: rawState, binding,
  vercelToken, fetchImpl = fetch }) {
  try {
    const state = validateAccountDeletionBootstrapState(rawState, binding);
    assert.equal(state.stage, "role-verified");
    const valueSha256 = sha256(buildAccountDeletionDatabaseUrl(state, binding));
    return acceptedEvidence(state, valueSha256, await inventory(vercelToken, fetchImpl));
  } catch { throw stopped(); }
}

// This creates only one sensitive Production variable. Existing conflicting
// rows fail closed. An exact attempt-bound row is accepted on retry, including
// after an ambiguous POST response, without rotating the private credential.
export async function installAccountDeletionDatabaseUrl({ state: rawState, binding, vercelToken, fetchImpl = fetch }) {
  try {
    const state = validateAccountDeletionBootstrapState(rawState, binding);
    assert.equal(state.stage, "role-verified");
    const value = buildAccountDeletionDatabaseUrl(state, binding);
    const valueSha256 = sha256(value);
    const comment = expectedComment(state, valueSha256);
    let rows = await inventory(vercelToken, fetchImpl);
    if (rows.length === 0) {
      try {
        await request(`/v10/projects/${PROJECT_ID}/env`, vercelToken, fetchImpl, {
          method: "POST",
          body: { key: KEY, value, type: "sensitive", target: ["production"], comment },
        });
      } catch {
        // Resolve an ambiguous provider response through independent inventory.
      }
      rows = await inventory(vercelToken, fetchImpl);
    }
    return acceptedEvidence(state, valueSha256, rows);
  } catch { throw stopped(); }
}
