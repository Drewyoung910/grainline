import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE,
  hasReviewedDirectUploadCleanupMemberPosture,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  buildDirectUploadCleanupDatabaseUrl,
  buildAbsentRolePreflightSql,
  buildVersionedReplacementProbeSql,
  buildReplacementSql,
  classifyReviewedPostgresFailure,
  DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
  DIRECT_UPLOAD_CLEANUP_PROVIDER_CREATION_CONFIRMATION,
  isReviewedNeonAccessToken,
  normalizeNeonCredentialExpiry,
  parseProviderRemediationConfig,
  REJECTED_CLEANUP_DATABASE_URL_SHA256,
  REJECTED_DIRECT_UPLOAD_CLEANUP_ROLE,
  validateReviewedNeonTarget,
} from "../scripts/direct-upload-cleanup-role-provider-remediation.mjs";

const PASSWORD = "A".repeat(64);
const COMMIT = "a".repeat(40);

describe("DirectUpload cleanup-role provider remediation", () => {
  it("pins the non-delete versioned creation and protected environment", () => {
    assert.equal(
      DIRECT_UPLOAD_CLEANUP_PROVIDER_CREATION_CONFIRMATION,
      "create-versioned-sql-cleanup-role",
    );
    assert.equal(
      REJECTED_DIRECT_UPLOAD_CLEANUP_ROLE,
      "grainline_direct_upload_cleanup",
    );
    assert.equal(
      DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
      "Production DirectUpload Cleanup",
    );
    assert.equal(
      REJECTED_CLEANUP_DATABASE_URL_SHA256,
      "6096b5b751b15fcb036f835bf60d20fddaeb354f94d5b9d492eed120401f731a",
    );
  });

  it("requires the retired and versioned role names to remain absent", () => {
    const sql = buildAbsentRolePreflightSql();
    assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
    assert.match(sql, /'grainline_direct_upload_cleanup'/);
    assert.match(sql, /'grainline_direct_upload_cleanup_v2'/);
    assert.match(sql, /retired or versioned cleanup role is not absent/);
    assert.match(sql, /ROLLBACK/);
  });

  it("probes then creates only the versioned SQL role with reviewed authority", () => {
    const probe = buildVersionedReplacementProbeSql();
    const replacement = buildReplacementSql();
    for (const sql of [probe, replacement]) {
      assert.match(sql, /SET LOCAL password_encryption = 'scram-sha-256'/);
      assert.match(sql, /CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L/);
      assert.match(sql, /:'replacement_password'/);
      assert.match(sql, /'grainline_direct_upload_cleanup_v2'/);
      assert.doesNotMatch(sql, /ADMIN %I/);
      assert.match(sql, /rolsuper/);
      assert.match(sql, /rolbypassrls/);
      assert.match(sql, /reviewed_member_count > 1/);
      assert.match(sql, /unexpected_member_count <> 0/);
      assert.match(sql, /unexpected_transitive_member_count <> 0/);
      assert.match(sql, /grantor\.rolname = 'cloud_admin'/);
      assert.doesNotMatch(sql, /\bREVOKE\b[\s\S]*\bFROM neondb_owner\b/);
    }
    assert.match(probe, /ROLLBACK/);
    assert.match(replacement, /COMMIT/);
  });

  it("makes every provider delete path unreachable", () => {
    const source = readFileSync(
      "scripts/direct-upload-cleanup-role-provider-remediation.mjs",
      "utf8",
    );
    assert.doesNotMatch(source, /"DELETE"/);
    assert.doesNotMatch(source, /validateDeleteRoleResponse/);
    assert.doesNotMatch(source, /waitForOperations/);
  });

  it("accepts no inbound member or only PostgreSQL 16's exact bootstrap edge", () => {
    assert.equal(hasReviewedDirectUploadCleanupMemberPosture({
      memberRoleEdges: [],
      memberRoles: [],
    }), true);
    assert.equal(hasReviewedDirectUploadCleanupMemberPosture({
      memberRoleEdges: [{ ...DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE }],
      memberRoles: ["neondb_owner"],
    }), true);
    assert.equal(hasReviewedDirectUploadCleanupMemberPosture({
      memberRoleEdges: [{
        ...DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE,
        set_option: true,
      }],
      memberRoles: ["neondb_owner"],
    }), false);
  });

  it("builds only the reviewed non-pooled cleanup connection identity", () => {
    const value = buildDirectUploadCleanupDatabaseUrl(PASSWORD);
    const parsed = new URL(value);
    assert.equal(parsed.username, "grainline_direct_upload_cleanup_v2");
    assert.equal(
      parsed.hostname,
      "ep-plain-river-aaqg8gj4.westus3.azure.neon.tech",
    );
    assert.equal(parsed.pathname, "/neondb");
    assert.equal(parsed.searchParams.get("sslmode"), "verify-full");
    assert.equal(parsed.searchParams.get("channel_binding"), "require");
    assert.throws(() => buildDirectUploadCleanupDatabaseUrl("short"));
  });

  it("accepts only the exact Neon and GitHub provider targets", () => {
    const payloads = {
      project: {
        project: {
          id: "icy-unit-96812898",
          org_id: "org-raspy-frost-18952075",
          region_id: "azure-westus3",
        },
      },
      branch: {
        branch: {
          id: "br-hidden-mouse-aaugn2wr",
          name: "production",
          primary: true,
          default: true,
        },
      },
      endpoints: {
        endpoints: [{
          id: "ep-plain-river-aaqg8gj4",
          branch_id: "br-hidden-mouse-aaugn2wr",
          region_id: "azure-westus3",
          type: "read_write",
          disabled: false,
        }],
      },
      roles: [],
      environment: {
        id: 18_906_676_825,
        name: "Production DirectUpload Cleanup",
      },
    };
    assert.equal(
      validateReviewedNeonTarget(payloads).roleName,
      "grainline_direct_upload_cleanup_v2",
    );
    assert.throws(() => validateReviewedNeonTarget({
      ...payloads,
      environment: { ...payloads.environment, id: 1 },
    }));
    assert.equal(validateReviewedNeonTarget(payloads).rolePresent, false);
    assert.throws(() => validateReviewedNeonTarget({
      ...payloads,
      roles: undefined,
    }));
    for (const name of [
      "grainline_direct_upload_cleanup",
      "grainline_direct_upload_cleanup_v2",
    ]) {
      assert.throws(() => validateReviewedNeonTarget({
        ...payloads,
        roles: [{
          branch_id: "br-hidden-mouse-aaugn2wr",
          name,
          authentication_method: "password",
        }],
      }));
    }
  });

  it("requires exact confirmation, commit and evidence path", () => {
    const cwd = process.cwd();
    const evidencePath = `${cwd}/.codex/evidence/`
      + `direct-upload-cleanup-role-provider-remediation-${COMMIT}.json`;
    const config = parseProviderRemediationConfig({
      DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRM:
        DIRECT_UPLOAD_CLEANUP_PROVIDER_CREATION_CONFIRMATION,
      DIRECT_UPLOAD_CLEANUP_PROVIDER_RELEASE_COMMIT: COMMIT,
      DIRECT_UPLOAD_CLEANUP_PROVIDER_EVIDENCE_PATH: evidencePath,
    });
    assert.equal(config.releaseCommit, COMMIT);
    assert.throws(() => parseProviderRemediationConfig({
      DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRM: "wrong",
      DIRECT_UPLOAD_CLEANUP_PROVIDER_RELEASE_COMMIT: COMMIT,
      DIRECT_UPLOAD_CLEANUP_PROVIDER_EVIDENCE_PATH: evidencePath,
    }));
  });

  it("normalizes current Neon millisecond credential expiry", () => {
    assert.equal(normalizeNeonCredentialExpiry(1_785_277_130_259), 1_785_277_130_259);
    assert.equal(normalizeNeonCredentialExpiry(1_785_277_130), 1_785_277_130_000);
    assert.throws(() => normalizeNeonCredentialExpiry("invalid"));
  });

  it("accepts reviewed opaque Neon access-token shapes without assuming JWT length", () => {
    assert.equal(isReviewedNeonAccessToken("a".repeat(87)), true);
    assert.equal(isReviewedNeonAccessToken("a".repeat(63)), false);
    assert.equal(
      isReviewedNeonAccessToken(`${"a".repeat(70)} secret`),
      false,
    );
  });

  it("reports only bounded PostgreSQL failure classes", () => {
    assert.equal(
      classifyReviewedPostgresFailure(
        "ERROR:  42501: permission denied for role secret-value",
      ),
      "postgres-42501",
    );
    assert.equal(
      classifyReviewedPostgresFailure("ERROR: detail deliberately omitted"),
      "postgres-unclassified",
    );
    assert.equal(
      classifyReviewedPostgresFailure(
        "postgresql://role:password@example.invalid/database",
      ),
      "command-unclassified",
    );
    assert.equal(
      classifyReviewedPostgresFailure(undefined),
      "command-unclassified",
    );
  });

  it("keeps generated credentials off command arguments, output and evidence", () => {
    const source = readFileSync(
      "scripts/direct-upload-cleanup-role-provider-remediation.mjs",
      "utf8",
    );
    assert.doesNotMatch(source, /reveal_password/);
    assert.match(
      source,
      /input: `\\\\set VERBOSITY verbose\\n\$\{secretPrefix\}\$\{sql\}`/,
    );
    assert.match(source, /\\\\set replacement_password/);
    assert.doesNotMatch(source, /"--(?:password|variable)"/);
    assert.match(
      source,
      /spawnSync\("gh"[\s\S]*input: value/,
    );
    assert.doesNotMatch(
      source,
      /proof:\s*\{[\s\S]{0,800}(?:password|connectionString)\s*:/,
    );
    assert.match(
      source,
      /at stage \$\{remediationFailureStage\}/,
    );
    assert.match(source, /SAFE_FAILURE_CLASS_PATTERN/);
    assert.doesNotMatch(source, /stderr\.write\([^)]*error\?\.message/);
    assert.match(source, /create-versioned-sql-cleanup-role/);
    assert.doesNotMatch(source, /waitForCatalogRoleAbsence/);
  });
});
