import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cleanupKeyIdentity } from "../scripts/r2-cleanup-key-identity.mjs";

const hash = v => createHash("sha256").update(v).digest("hex"), SHA = "a".repeat(40);
const fixture = () => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_REPOSITORY_ID: "1062688469",
  GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/r2-cleanup-key-identity.yml@refs/heads/main",
  R2_CLEANUP_IDENTITY_CONFIRM: "compare-protected-r2-cleanup-key", R2_CLEANUP_IDENTITY_COMMIT: SHA, GITHUB_SHA: SHA,
  R2_CLEANUP_IDENTITY_OPERATION: "12345678-1234-4123-8123-123456789abc", GITHUB_RUN_ID: "12345678", GITHUB_RUN_ATTEMPT: "1",
  DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID: "b".repeat(32), DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET: "synthetic-public-bucket",
  DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET: "synthetic-private-bucket", DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID: "c".repeat(32),
  DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY: "d".repeat(64) });

test("identity contains separate token-id and paired-value fingerprints, with no raw credentials or bucket names", () => {
  const env = fixture(), result = cleanupKeyIdentity(env, { head: SHA, clean: true });
  assert.equal(result.accessKeyIdSha256, hash(env.DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID));
  assert.equal(result.credentialPairSha256, hash(env.DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID + "\0" + env.DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY));
  assert.equal(result.rotationAccepted, false); assert.equal(result.objectOperationsPerformed, false); assert.equal(Object.isFrozen(result), true);
  for (const [k, v] of Object.entries(env)) if (k.startsWith("DIRECT_UPLOAD_CLEANUP_R2_")) assert.equal(JSON.stringify(result).includes(v), false);
});

test("a changed secret with the same token id cannot look like an independent token", () => {
  const before = fixture(), after = { ...before, DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY: "e".repeat(64) };
  const a = cleanupKeyIdentity(before, { head: SHA, clean: true }), b = cleanupKeyIdentity(after, { head: SHA, clean: true });
  assert.equal(a.accessKeyIdSha256, b.accessKeyIdSha256); assert.notEqual(a.credentialPairSha256, b.credentialPairSha256);
});

for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "false", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/other",
  GITHUB_REPOSITORY: "other/grainline", GITHUB_REPOSITORY_ID: "1", GITHUB_WORKFLOW_REF: "other", R2_CLEANUP_IDENTITY_CONFIRM: "other",
  R2_CLEANUP_IDENTITY_COMMIT: "f".repeat(40), R2_CLEANUP_IDENTITY_OPERATION: "old", GITHUB_RUN_ATTEMPT: "2", GITHUB_RUN_ID: "0",
  DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID: "invalid", DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID: "", DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY: "\ncredential" }))
  test(`refuses invalid ${key} with a sanitized error`, () => {
    assert.throws(() => cleanupKeyIdentity({ ...fixture(), [key]: value }, { head: SHA, clean: true }), e => e.message.startsWith("Protected R2 identity check refused"));
  });

for (const key of ["DATABASE_URL", "DIRECT_UPLOAD_CLEANUP_DATABASE_URL", "PRODUCTION_MIGRATION_DIRECT_URL", "AWS_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"])
  test(`refuses unrelated shared credential ${key}, even when empty`, () => {
    assert.throws(() => cleanupKeyIdentity({ ...fixture(), [key]: "" }, { head: SHA, clean: true }));
  });

test("requires exact clean source and distinct buckets", () => {
  for (const git of [{ head: "f".repeat(40), clean: true }, { head: SHA, clean: false }]) assert.throws(() => cleanupKeyIdentity(fixture(), git));
  const env = fixture(); env.DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET = env.DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET;
  assert.throws(() => cleanupKeyIdentity(env, { head: SHA, clean: true }));
});
