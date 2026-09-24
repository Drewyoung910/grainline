import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRODUCTION_ORIGIN,
  REQUIRED_ALIASES,
  REVIEWED_PROJECT,
  STAGED_PROJECT_ALIAS,
  assertReleaseBinding,
  assertStagedBypass,
  createInitialState,
  createRouteRequest,
  assertFulfillmentRedirect,
  assertReceiptRedirect,
  parseVercelAliasInspection,
  parseVercelDeployment,
  validateRestartState,
  verifyDeploymentBoundary,
} from "../scripts/order-authenticated-route-smoke.mjs";
import { loadStagedReleaseBinding } from "../scripts/order-authenticated-route-smoke-staged.mjs";

const bypass = "synthetic-staged-bypass-value-for-tests-only";
const binding = Object.freeze({
  commit: "a".repeat(40),
  ciRunId: 123456,
  deploymentId: `dpl_${"A".repeat(24)}`,
  origin: PRODUCTION_ORIGIN,
  targetOrigin: "https://grainline-candidate-abc.vercel.app",
  predecessorDeploymentId: `dpl_${"B".repeat(24)}`,
  bypassSha256: createHash("sha256").update(bypass).digest("hex"),
});
const candidate = {
  id: binding.deploymentId,
  target: "production",
  readyState: "READY",
  url: new URL(binding.targetOrigin).hostname,
  aliases: [],
  meta: { githubCommitSha: binding.commit },
  project: { id: REVIEWED_PROJECT.projectId },
  team: { id: REVIEWED_PROJECT.orgId },
};

test("staged binding pins immutable host, predecessor, and bypass digest", () => {
  assert.deepEqual(assertReleaseBinding(binding), binding);
  for (const change of [
    { targetOrigin: "https://grainline-candidate-abc.vercel.app.evil.test" },
    { targetOrigin: "http://grainline-candidate-abc.vercel.app" },
    { targetOrigin: "https://grainline-candidate-abc.vercel.app/path" },
    { targetOrigin: `https://${REQUIRED_ALIASES[1]}` },
    { predecessorDeploymentId: binding.deploymentId },
    { bypassSha256: "invalid" },
    { stagedAttachedAlias: REQUIRED_ALIASES[0] },
  ]) assert.throws(() => assertReleaseBinding({ ...binding, ...change }));
  assert.equal(assertStagedBypass(binding, bypass), bypass);
  assert.throws(() => assertStagedBypass(binding, "wrong-synthetic-bypass-value"));
  assert.throws(() => assertStagedBypass(binding));
});

test("staged deployment requires exact READY source and unpromoted aliases", () => {
  assert.equal(parseVercelDeployment(candidate, binding).sourceCommit, binding.commit);
  for (const change of [
    { url: "grainline-other.vercel.app" },
    { aliases: [REQUIRED_ALIASES[0]] },
    { aliases: ["unexpected-public-alias.example"] },
    { meta: { githubCommitSha: "b".repeat(40) } },
    { readyState: "BUILDING" },
  ]) assert.throws(() => parseVercelDeployment({ ...candidate, ...change }, binding));
  for (const alias of REQUIRED_ALIASES) {
    assert.deepEqual(parseVercelAliasInspection({ id: binding.predecessorDeploymentId,
      target: "production", readyState: "READY" }, alias, binding),
    { alias, deploymentId: binding.predecessorDeploymentId, ready: true });
    assert.throws(() => parseVercelAliasInspection({ id: binding.deploymentId,
      target: "production", readyState: "READY" }, alias, binding));
  }
});

test("staged deployment binds Vercel's observed project alias move exactly", () => {
  const attached = { ...binding, stagedAttachedAlias: STAGED_PROJECT_ALIAS };
  const withAlias = { ...candidate, aliases: [STAGED_PROJECT_ALIAS] };
  assert.equal(parseVercelDeployment(withAlias, attached).deploymentId, binding.deploymentId);
  assert.throws(() => parseVercelDeployment(candidate, attached));
  assert.throws(() => parseVercelDeployment(withAlias, binding));
  assert.throws(() => parseVercelDeployment({ ...withAlias,
    aliases: [STAGED_PROJECT_ALIAS, REQUIRED_ALIASES[0]] }, attached));
  assert.throws(() => parseVercelDeployment({ ...withAlias,
    aliases: [STAGED_PROJECT_ALIAS, "unexpected-public-alias.example"] }, attached));
  for (const alias of REQUIRED_ALIASES) {
    const expected = alias === STAGED_PROJECT_ALIAS
      ? binding.deploymentId : binding.predecessorDeploymentId;
    assert.equal(parseVercelAliasInspection({ id: expected, target: "production",
      readyState: "READY" }, alias, attached).deploymentId, expected);
    const wrong = alias === STAGED_PROJECT_ALIAS
      ? binding.predecessorDeploymentId : binding.deploymentId;
    assert.throws(() => parseVercelAliasInspection({ id: wrong,
      target: "production", readyState: "READY" }, alias, attached));
  }
  const config = { operatorCommit: "c".repeat(40), operatorCiRunId: 9999, release: attached };
  const canary = { id: "synthetic-canary", clerkUserId: "user_synthetic", role: "USER",
    termsAcceptedAt: null, termsVersion: null, ageAttestedAt: null,
    notificationPreferences: {}, emailPreferenceOptInAt: null };
  const seller = { id: "synthetic-seller", userId: "synthetic-user", stripeAccountId: "acct_synthetic" };
  const state = createInitialState(config, canary, seller);
  assert.equal(state.stagedAttachedAlias, STAGED_PROJECT_ALIAS);
  assert.deepEqual(validateRestartState(state, config, attached,
    { allowLegacyCleanupRecovery: false }), state);
  assert.throws(() => validateRestartState({ ...state, stagedAttachedAlias: undefined },
    config, attached, { allowLegacyCleanupRecovery: false }));
});

test("staged health and route requests stay on exact immutable host with bypass", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, headers: options.headers, redirect: options.redirect });
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true }));
    if (url === binding.targetOrigin) return new Response(`<div>dpl=${binding.deploymentId}</div>`);
    return new Response(JSON.stringify({ rates: [] }));
  };
  assert.deepEqual(await verifyDeploymentBoundary(binding, request, bypass),
    { stagedDeploymentMarker: true, healthStatus: 200 });
  const route = createRouteRequest(binding, bypass, request);
  await route("/api/shipping/quote", "synthetic-jwt", { method: "POST", body: { mode: "single" } });
  assert.deepEqual(calls.map(x => x.url), [
    `${binding.targetOrigin}/api/health`, binding.targetOrigin,
    `${binding.targetOrigin}/api/shipping/quote`,
  ]);
  assert.ok(calls.every(x => x.headers["x-vercel-protection-bypass"] === bypass));
  assert.ok(calls.every(x => x.redirect === "manual"));
  assert.equal(calls[2].headers.origin, binding.targetOrigin);
  assert.throws(() => createRouteRequest(binding, "wrong-synthetic-bypass-value", request));
});

test("staged API redirects retain the configured canonical site URL", () => {
  assert.deepEqual(assertFulfillmentRedirect({ location: `${PRODUCTION_ORIGIN}/dashboard/sales/ord_1`,
    orderId: "ord_1", status: 303 }), { orderId: "ord_1", status: 303 });
  assert.deepEqual(assertReceiptRedirect({ location: `${PRODUCTION_ORIGIN}/dashboard/orders/ord_1`,
    orderId: "ord_1", status: 303 }), { orderId: "ord_1", status: 303 });
  assert.throws(() => assertFulfillmentRedirect({ location: `${binding.targetOrigin}/dashboard/sales/ord_1`,
    orderId: "ord_1", status: 303 }));
});

test("staged restart cannot switch host or bypass digest at the same deployment", () => {
  const config = { operatorCommit: "c".repeat(40), operatorCiRunId: 9999, release: binding };
  const canary = { id: "synthetic-canary", clerkUserId: "user_synthetic", role: "USER",
    termsAcceptedAt: null, termsVersion: null, ageAttestedAt: null,
    notificationPreferences: {}, emailPreferenceOptInAt: null };
  const seller = { id: "synthetic-seller", userId: "synthetic-user", stripeAccountId: "acct_synthetic" };
  const state = createInitialState(config, canary, seller);
  assert.equal(state.targetOrigin, binding.targetOrigin);
  assert.equal(state.bypassSha256, binding.bypassSha256);
  assert.deepEqual(validateRestartState(state, config, binding,
    { allowLegacyCleanupRecovery: false }), state);
  assert.throws(() => validateRestartState({ ...state, targetOrigin: "https://other.vercel.app" },
    config, binding, { allowLegacyCleanupRecovery: false }));
  assert.throws(() => validateRestartState({ ...state, bypassSha256: "b".repeat(64) },
    config, binding, { allowLegacyCleanupRecovery: false }));
});

test("staged wrapper reads only a mode-0600 absolute binding file", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "grainline-order-staged-binding-"));
  try {
    const file = path.join(directory, "binding.json");
    writeFileSync(file, JSON.stringify(binding), { mode: 0o600 });
    assert.deepEqual(loadStagedReleaseBinding(file), binding);
    assert.throws(() => loadStagedReleaseBinding("binding.json"));
    writeFileSync(file, JSON.stringify({ ...binding, targetOrigin: PRODUCTION_ORIGIN }), { mode: 0o644 });
    chmodSync(file, 0o644);
    assert.throws(() => loadStagedReleaseBinding(file));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
