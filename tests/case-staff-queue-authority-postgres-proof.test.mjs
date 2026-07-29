import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseCaseStaffQueueProofConfig,
} from "../scripts/case-staff-queue-authority-postgres-proof.mjs";

const proof = fs.readFileSync(
  "scripts/case-staff-queue-authority-postgres-proof.mjs",
  "utf8",
);
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Case staff queue proof refuses persistent database targets", () => {
  assert.throws(
    () => parseCaseStaffQueueProofConfig({
      CASE_STAFF_QUEUE_PROOF_DATABASE_URL:
        "postgresql://user:secret@example.invalid/grainline_ci",
    }),
    /non-loopback/,
  );
  assert.throws(
    () => parseCaseStaffQueueProofConfig({
      CASE_STAFF_QUEUE_PROOF_DATABASE_URL:
        "postgresql://user:secret@127.0.0.1/production",
    }),
    /grainline_ci/,
  );
  assert.deepEqual(
    parseCaseStaffQueueProofConfig({
      CASE_STAFF_QUEUE_PROOF_DATABASE_URL:
        "postgresql://user:secret@127.0.0.1/grainline_ci",
    }),
    {
      databaseUrl:
        "postgresql://user:secret@127.0.0.1/grainline_ci",
    },
  );
});

test("Case staff queue proof exercises the authority and privacy boundary", () => {
  for (const pattern of [
    /catalog-and-grants/,
    /forced-rls-test-posture/,
    /staff-admin-equivalence/,
    /page-clamp-order-and-derived-count/,
    /status-filter-and-minimal-contact/,
    /empty-filter-result/,
    /unauthorized-actor-denial/,
    /invalid-input-denial/,
    /function-only-forced-rls-read/,
    /transaction-local-context/,
    /read-only-state/,
    /preflight-zero-residue/,
  ]) {
    assert.match(proof, pattern);
  }
  assert.match(proof, /ALTER TABLE public\."\$\{table\}" FORCE ROW LEVEL SECURITY/);
  assert.match(proof, /Case staff queue proof changed protected state/);
  assert.match(proof, /Case staff queue proof left fixture residue/);
});

test("Case staff queue proof is credential-safe and restores RLS", () => {
  assert.match(proof, /safeError/);
  assert.match(proof, /\[redacted-postgres-url\]/);
  assert.match(proof, /restoreProofRls/);
  assert.match(proof, /NO FORCE ROW LEVEL SECURITY/);
  assert.match(proof, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(proof, /console\.log\([^)]*(?:databaseUrl|connectionString)/);
});

test("CI runs the Case staff queue proof after migrations and grant convergence", () => {
  assert.equal(
    packageJson.scripts["audit:rls-case-staff-queue"],
    "node scripts/case-staff-queue-authority-postgres-proof.mjs",
  );
  const migrationIndex = workflow.indexOf("npx prisma migrate deploy");
  const grantIndex = workflow.indexOf("Converge production-style runtime grants");
  const proofIndex = workflow.indexOf("audit:rls-case-staff-queue");
  assert.ok(migrationIndex >= 0);
  assert.ok(grantIndex > migrationIndex);
  assert.ok(proofIndex > grantIndex);
});
