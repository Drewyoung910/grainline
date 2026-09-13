import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertClerkLegalProvenanceGitState,
  buildClerkLegalProvenanceInspectionSql,
  normalizeClerkLegalProvenanceCounts,
  parseClerkLegalProvenanceInspectionConfig,
  writeClerkLegalProvenanceEvidence,
} from "../scripts/clerk-legal-provenance-inspect.mjs";
import { parseClerkLegalProvenanceProofConfig } from "../scripts/clerk-legal-provenance-inspection-postgres-proof.mjs";

const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const COMMIT = "a".repeat(40);
const RUNNER_TEMP = "/private/tmp/clerk-legal-provenance-test";

function configEnv() {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256")
      .update(DIRECT_URL)
      .digest("hex"),
    CLERK_LEGAL_PROVENANCE_INSPECT_RELEASE_COMMIT: COMMIT,
    CLERK_LEGAL_PROVENANCE_INSPECT_CONFIRM:
      "inspect-clerk-legal-acceptance-provenance",
    RUNNER_TEMP,
    CLERK_LEGAL_PROVENANCE_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/clerk-legal-provenance-inspection-${COMMIT}.json`,
  };
}

describe("Clerk legal acceptance provenance inspection", () => {
  const source = fs.readFileSync(
    "scripts/clerk-legal-provenance-inspect.mjs",
    "utf8",
  );
  const proof = fs.readFileSync(
    "scripts/clerk-legal-provenance-inspection-postgres-proof.mjs",
    "utf8",
  );
  const workflow = fs.readFileSync(
    ".github/workflows/clerk-legal-provenance-inspection.yml",
    "utf8",
  );
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const recovery = fs.readFileSync(
    "docs/clerk-webhook-secret-credential-recovery.md",
    "utf8",
  );
  const terms = fs.readFileSync("src/lib/termsAcceptance.ts", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  it("requires exact clean manual-main source and the reviewed owner target", () => {
    assert.equal(
      parseClerkLegalProvenanceInspectionConfig(configEnv()).mode,
      "inspect",
    );
    for (const drift of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_SHA: "b".repeat(40) },
      { CLERK_LEGAL_PROVENANCE_INSPECT_CONFIRM: "yes" },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
      { MIGRATION_DB_ROLE: "grainline_app_runtime" },
    ]) {
      assert.throws(() =>
        parseClerkLegalProvenanceInspectionConfig({
          ...configEnv(),
          ...drift,
        }));
    }
    const poolerUrl = DIRECT_URL.replace(".westus3", "-pooler.westus3");
    assert.throws(() =>
      parseClerkLegalProvenanceInspectionConfig({
        ...configEnv(),
        DIRECT_URL: poolerUrl,
        PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256")
          .update(poolerUrl)
          .digest("hex"),
      }));
    assert.deepEqual(
      assertClerkLegalProvenanceGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { head: COMMIT, clean: true },
    );
    assert.throws(() =>
      assertClerkLegalProvenanceGitState(
        { head: COMMIT, status: "?? unexpected" },
        COMMIT,
      ));
  });

  it("pins the current terms contract and counts only trusted route evidence", () => {
    const sql = buildClerkLegalProvenanceInspectionSql();
    assert.match(terms, /CURRENT_TERMS_VERSION = "2026-06-14"/);
    assert.match(sql, /audit\."adminId" = subject\.id/);
    assert.match(sql, /audit\."targetId" = subject\.id/);
    assert.match(
      sql,
      /subject\."termsVersion" IS NOT DISTINCT FROM '2026-06-14'/,
    );
    assert.match(sql, /audit\.metadata->>'actorKind' = 'user'/);
    assert.match(sql, /audit\.metadata->>'route' = '\/api\/account\/accept-terms'/);
    assert.match(sql, /audit\.metadata->>'termsVersion' = '2026-06-14'/);
    assert.match(sql, /audit\.undone = false/);
    assert.throws(
      () =>
        buildClerkLegalProvenanceInspectionSql({
          user: 'public."User"; DELETE FROM public."User"',
          audit: 'public."AdminAuditLog"',
        }),
      /relations are not reviewed/,
    );
  });

  it("normalizes a complete aggregate partition and rejects inconsistent evidence", () => {
    const row = {
      total_user_count: "5",
      active_user_count: "4",
      deleted_user_count: "1",
      active_current_accepted_count: "2",
      active_trusted_current_accepted_count: "1",
      active_untrusted_current_accepted_count: "1",
      active_partial_or_stale_legal_state_count: "1",
      active_no_legal_state_count: "1",
      deleted_current_accepted_count: "1",
    };
    assert.deepEqual(normalizeClerkLegalProvenanceCounts(row), {
      totalUsers: 5,
      activeUsers: 4,
      deletedUsers: 1,
      activeCurrentAccepted: 2,
      activeTrustedCurrentAccepted: 1,
      activeUntrustedCurrentAccepted: 1,
      activePartialOrStaleLegalState: 1,
      activeNoLegalState: 1,
      deletedCurrentAccepted: 1,
    });
    assert.throws(
      () =>
        normalizeClerkLegalProvenanceCounts({
          ...row,
          active_untrusted_current_accepted_count: "2",
        }),
      /acceptance partition is inconsistent/,
    );
    assert.throws(
      () => normalizeClerkLegalProvenanceCounts({ ...row, total_user_count: "NaN" }),
      /invalid counts/,
    );
    assert.throws(
      () => normalizeClerkLegalProvenanceCounts({ ...row, total_user_count: null }),
      /invalid counts/,
    );
  });

  it("is engine-read-only, aggregate-only, and writes private sanitized evidence", () => {
    assert.match(
      source,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(source, /transaction_read_only/);
    assert.match(source, /await client\.query\("ROLLBACK"\)/);
    assert.doesNotMatch(
      source,
      /(?:DELETE FROM|UPDATE|INSERT INTO|TRUNCATE|ALTER TABLE) public\."(?:User|AdminAuditLog)"|\bCOMMIT\b/,
    );
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "clerk-legal-provenance-evidence-"),
    );
    const evidencePath = path.join(directory, "evidence.json");
    writeClerkLegalProvenanceEvidence(evidencePath, {
      status: "passed",
      counts: { activeUntrustedCurrentAccepted: 0 },
      retained: { aggregateCountsOnly: true },
    });
    const stat = fs.lstatSync(evidencePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o077, 0);
    assert.throws(
      () =>
        writeClerkLegalProvenanceEvidence(path.join(directory, "bad.json"), {
          email: "private@example.com",
        }),
      /contains private data/,
    );
  });

  it("proves the classification query under PostgreSQL read-only semantics in CI", () => {
    assert.throws(
      () => parseClerkLegalProvenanceProofConfig({}),
      /PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseClerkLegalProvenanceProofConfig({
          CLERK_LEGAL_PROVENANCE_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.deepEqual(
      parseClerkLegalProvenanceProofConfig({
        CLERK_LEGAL_PROVENANCE_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      { databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci" },
    );
    assert.match(proof, /CLERK_LEGAL_PROVENANCE_PROOF_SQL/);
    assert.match(
      proof,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(proof, /activeUntrustedCurrentAccepted: 1/);
    assert.match(
      ci,
      /Prove Clerk legal acceptance provenance inspection in ephemeral PostgreSQL/,
    );
    assert.match(
      ci,
      /CLERK_LEGAL_PROVENANCE_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
    assert.equal(
      packageJson.scripts[
        "audit:clerk-legal-provenance-inspection-postgres"
      ],
      "node scripts/clerk-legal-provenance-inspection-postgres-proof.mjs",
    );
  });

  it("uses a serialized protected workflow and exports no production credential", () => {
    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
    assert.equal(
      packageJson.scripts["ops:clerk-legal-provenance-inspect"],
      "node scripts/clerk-legal-provenance-inspect.mjs",
    );
  });

  it("deploys and drains unsafe writers before any provenance cleanup", () => {
    const normalized = recovery.replace(/\s+/g, " ");
    const deploy = normalized.indexOf("Merge and deploy the application hardening");
    const drain = normalized.indexOf(
      "Drain every callable predecessor application deployment",
    );
    const inspect = normalized.indexOf(
      "Run the aggregate-only legal-acceptance provenance inspection",
    );
    assert.ok(deploy >= 0 && deploy < drain);
    assert.ok(drain < inspect);
    assert.match(
      normalized,
      /rerun the same inspection and require zero untrusted active rows/,
    );
    assert.match(normalized, /operational canary is not exempt/);
  });

  it("records the accepted safe writer and legal-provenance cleanup without overstating rotation", () => {
    const strategy = fs.readFileSync("STRATEGY.md", "utf8");
    const audit = fs.readFileSync("docs/security-audit-log.md", "utf8");
    const combined = `${recovery}\n${strategy}\n${audit}`;

    assert.match(combined, /d7859d5d1aaab5fbfbd77e973bf196a063493a62/);
    assert.match(combined, /dpl_HHLuG4Snq6vqitPjxUdabLqXfFSF/);
    assert.match(combined, /dpl_X6b4qkf9c7Y8xkPctFWgY1zJD41V/);
    assert.match(
      combined,
      /2f561ea9034d5ac70b587248e76b22aff74077c57cd590725d2e0a6ab9c433ca/,
    );
    assert.match(recovery, /33895038513/);
    assert.match(recovery, /33895463860/);
    assert.match(recovery, /zero untrusted current acceptances/);
    assert.match(recovery, /Provider signing-secret rotation\s+remains pending/);
    assert.match(
      recovery.replace(/\s+/g, " "),
      /does not accept historical legal provenance or rotate/,
    );
    assert.match(audit, /The audit was not weakened or bypassed/);
  });
});
