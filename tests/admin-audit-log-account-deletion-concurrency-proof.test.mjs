import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  proofConfig,
} from "../scripts/admin-audit-log-account-deletion-concurrency-proof.mjs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("AdminAuditLog concurrency proof accepts only its disposable loopback database", () => {
  assert.deepEqual(
    proofConfig({
      ADMIN_AUDIT_LOG_CONCURRENCY_PROOF_DATABASE_URL:
        "postgresql://ci:ci@127.0.0.1:5432/grainline_ci",
    }),
    {
      connectionString: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci",
      connectionTimeoutMillis: 5_000,
    },
  );
  for (const value of [
    "postgresql://ci:ci@localhost:5432/grainline_ci",
    "postgresql://ci:ci@127.0.0.1:5432/not_grainline_ci",
    "postgresql://not_ci:ci@127.0.0.1:5432/grainline_ci",
    "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
  ]) {
    assert.throws(
      () => proofConfig({ ADMIN_AUDIT_LOG_CONCURRENCY_PROOF_DATABASE_URL: value }),
      /proof requires|proof rejects/u,
    );
  }
});

test("PostgreSQL 17 CI runs the concurrency proof after the full migrated chain", () => {
  const jobStart = ci.indexOf("production-postgres17:");
  const fullChain = ci.indexOf(
    "Prove full migration chain and behavior on PostgreSQL 17",
    jobStart,
  );
  const concurrency = ci.indexOf(
    "Prove AdminAuditLog account-deletion concurrency on PostgreSQL 17",
    jobStart,
  );
  assert.ok(jobStart >= 0 && fullChain > jobStart && concurrency > fullChain);
  assert.match(
    ci.slice(concurrency),
    /ADMIN_AUDIT_LOG_CONCURRENCY_PROOF_DATABASE_URL: postgresql:\/\/ci:ci@127\.0\.0\.1:5432\/grainline_ci[\s\S]*npm run audit:admin-audit-log-concurrency/u,
  );
  assert.equal(
    packageJson.scripts["audit:admin-audit-log-concurrency"],
    "node scripts/admin-audit-log-account-deletion-concurrency-proof.mjs",
  );
});
