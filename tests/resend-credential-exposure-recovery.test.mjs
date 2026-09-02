import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertExactGitState,
  normalizeAliasTargets,
  normalizeCreatedKey,
  normalizeDeployment,
  normalizeJournalRebind,
  normalizeProviderInventory,
  normalizeRejectedCredential,
  normalizeResolvedSecretSha256,
  normalizeVercelVariableInventory,
  sanitizedEvidence,
  validateState,
} from "../scripts/resend-credential-exposure-recovery.mjs";

const COMMIT = "a".repeat(40);
const OLD_ID = "4c666da1-7a62-4ad4-8014-0c646a8da911";
const OLD_TOKEN = `re_${"o".repeat(32)}`;
const NEW_TOKEN = `re_${"n".repeat(32)}`;

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: "resend-credential-exposure-recovery",
    stage: "provider-created",
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
    predecessorDeploymentId: "dpl_AmW64aR14Yk47HK54kwiMSiKwkJD",
    replacementDeploymentId: null,
    replacementDeploymentUrl: null,
    oldKeyId: OLD_ID,
    oldToken: OLD_TOKEN,
    oldTokenSha256: null,
    newKeyId: "new-key-id",
    newToken: NEW_TOKEN,
    newTokenSha256: null,
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:01.000Z",
    ...overrides,
  };
}

test("requires exact clean operator and deploy-source Git state", () => {
  assert.equal(assertExactGitState({ head: COMMIT, status: "" }, COMMIT), true);
  assert.throws(() => assertExactGitState({ head: "b".repeat(40), status: "" }, COMMIT));
  assert.throws(() => assertExactGitState({ head: COMMIT, status: " M file" }, COMMIT));
});

test("accepts only the exact reviewed old Resend key and at most one named replacement", () => {
  const base = {
    error: null,
    data: {
      object: "list",
      has_more: false,
      data: [{ id: OLD_ID, name: "grainline-production" }],
    },
  };
  assert.equal(normalizeProviderInventory(base).replacement, null);
  const replacement = {
    ...base,
    data: {
      ...base.data,
      data: [
        ...base.data.data,
        { id: "replacement", name: "grainline-production-recovery-20260902" },
      ],
    },
  };
  assert.equal(normalizeProviderInventory(replacement).replacement.id, "replacement");
  assert.throws(() => normalizeProviderInventory({
    ...base,
    data: { ...base.data, has_more: true },
  }));
  assert.throws(() => normalizeProviderInventory({
    ...base,
    data: { ...base.data, data: [...base.data.data, { id: "unknown", name: "unknown" }] },
  }));
});

test("validates the one-time replacement credential response", () => {
  assert.deepEqual(normalizeCreatedKey({ data: { id: "replacement", token: NEW_TOKEN }, error: null }), {
    id: "replacement",
    token: NEW_TOKEN,
  });
  assert.throws(() => normalizeCreatedKey({ data: { id: "replacement", token: "wrong" } }));
});

test("accepts only recognized revoked-key responses from Resend", () => {
  assert.equal(normalizeRejectedCredential({ statusCode: 401 }), true);
  assert.equal(normalizeRejectedCredential({ statusCode: 403 }), true);
  assert.equal(normalizeRejectedCredential({
    statusCode: 400,
    name: "validation_error",
    message: "API key is invalid",
  }), true);
  assert.throws(() => normalizeRejectedCredential(undefined));
  assert.throws(() => normalizeRejectedCredential({ statusCode: 200 }));
  assert.throws(() => normalizeRejectedCredential({
    statusCode: 400,
    name: "validation_error",
    message: "another validation failure",
  }));
});

test("extracts one marked Resend hash from Vercel CLI progress output", () => {
  const digest = "a".repeat(64);
  const output = [
    "Vercel CLI 58.11.0 (Node.js 22.19.0)",
    "Retrieving project…",
    "Downloading `production` environment variables",
    "Loaded env from /private/path/.env.local",
    `GRAINLINE_RESEND_SECRET_SHA256:${digest}`,
  ].join("\n");
  assert.equal(normalizeResolvedSecretSha256(output), digest);
  assert.throws(() => normalizeResolvedSecretSha256(output.replace(digest, "not-a-hash")));
  assert.throws(() => normalizeResolvedSecretSha256("Vercel CLI 58.11.0"));
  assert.throws(() => normalizeResolvedSecretSha256(`${output}\nGRAINLINE_RESEND_SECRET_SHA256:${digest}`));
});

test("pins the exact legacy all-target Vercel Resend variable", () => {
  const variable = {
    id: "WkZNrlD569APACUw",
    key: "RESEND_API_KEY",
    type: "encrypted",
    target: ["development", "preview", "production"],
    gitBranch: null,
  };
  assert.deepEqual(normalizeVercelVariableInventory({ envs: [variable] }), {
    id: variable.id,
    key: variable.key,
    type: variable.type,
    target: variable.target,
  });
  assert.throws(() => normalizeVercelVariableInventory({ envs: [{ ...variable, id: "wrong" }] }));
  assert.throws(() => normalizeVercelVariableInventory({ envs: [{ ...variable, type: "sensitive" }] }));
  assert.throws(() => normalizeVercelVariableInventory({ envs: [{ ...variable, target: ["production"] }] }));
  assert.throws(() => normalizeVercelVariableInventory({ envs: [variable, { ...variable, id: "duplicate" }] }));
});

test("rebinds only the exact journaled provider-created release boundary", () => {
  const stopped = {
    stage: "github-updated",
    operatorCommit: "4b703f9fd0cc7e8a94c745866b401a1ed781dd3f",
    operatorCiRunId: 33644395842,
    oldKeyId: OLD_ID,
    newKeyId: "new-key-id",
  };
  const config = {
    operatorCommit: COMMIT,
    operatorCiRunId: 456,
    rebindFromOperatorCommit: stopped.operatorCommit,
    rebindFromOperatorCiRunId: stopped.operatorCiRunId,
  };
  const inventory = { old: { id: OLD_ID }, replacement: { id: "new-key-id" } };
  assert.deepEqual(normalizeJournalRebind(stopped, config, inventory), {
    operatorCommit: COMMIT,
    operatorCiRunId: 456,
  });
  assert.throws(() => normalizeJournalRebind({ ...stopped, stage: "provider-created" }, config, inventory));
  assert.throws(() => normalizeJournalRebind(stopped, { ...config, rebindFromOperatorCiRunId: 1 }, inventory));
  assert.throws(() => normalizeJournalRebind(stopped, config, { ...inventory, replacement: { id: "wrong" } }));
});

test("private state binds token digests and later deployment fields", async () => {
  const crypto = await import("node:crypto");
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const valid = state({ oldTokenSha256: hash(OLD_TOKEN), newTokenSha256: hash(NEW_TOKEN) });
  assert.equal(validateState(valid).stage, "provider-created");
  assert.throws(() => validateState({ ...valid, newTokenSha256: "0".repeat(64) }));
  const deployed = {
    ...valid,
    stage: "deployment-ready",
    replacementDeploymentId: "dpl_Replacement123",
    replacementDeploymentUrl: "grainline-replacement.vercel.app",
  };
  assert.equal(validateState(deployed).replacementDeploymentId, "dpl_Replacement123");
  assert.throws(() => validateState({ ...deployed, replacementDeploymentId: null }));
});

test("replacement deployment and canonical aliases are exact", () => {
  const marker = "marker";
  const deployment = normalizeDeployment({
    id: "dpl_Replacement123",
    url: "grainline-replacement.vercel.app",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
    marker,
  }, marker);
  const targets = ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"].map((alias) => ({
    alias,
    deployment: {
      id: deployment.id,
      projectId: deployment.projectId,
      readyState: "READY",
      target: "production",
    },
  }));
  assert.equal(normalizeAliasTargets(targets, deployment.id), true);
  assert.throws(() => normalizeAliasTargets(targets.slice(1), deployment.id));
});

test("sanitized evidence retains hashes and excludes credentials", async () => {
  const crypto = await import("node:crypto");
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const valid = state({
    stage: "provider-revoked",
    oldTokenSha256: hash(OLD_TOKEN),
    newTokenSha256: hash(NEW_TOKEN),
    replacementDeploymentId: "dpl_Replacement123",
    replacementDeploymentUrl: "grainline-replacement.vercel.app",
  });
  const evidence = sanitizedEvidence(
    { operatorCommit: COMMIT, operatorCiRunId: 123 },
    valid,
    [{ route: "/", status: 200, contentType: "text/html" }, { route: "/api/health", status: 200, contentType: "application/json" }],
  );
  const encoded = JSON.stringify(evidence);
  assert.equal(evidence.status, "passed");
  assert.doesNotMatch(encoded, /re_[on]+/);
  assert.deepEqual(evidence.migrationsApplied, []);
});

test("operator has no migration or secret-printing command", () => {
  const source = readFileSync(new URL("../scripts/resend-credential-exposure-recovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /prisma\s+migrate|migrate\s+deploy|Production Migrations/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:oldToken|newToken|RESEND_API_KEY)/);
  assert.match(source, /\/v9\/projects\/\$\{PROJECT\.id\}\/env\/\$\{VERCEL_VARIABLE\.id\}/);
  assert.match(source, /"--input", "-", "--silent"/);
  assert.doesNotMatch(source, /"--value"/);
  assert.match(source, /oldCredentialRejected: true/);
});
