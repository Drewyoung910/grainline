import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildDirectUploadCleanupDatabaseUrl,
  buildRejectedRolePreflightSql,
  buildReplacementProbeSql,
  buildReplacementSql,
  DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
  DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRMATION,
  makeScramVerifier,
  normalizeNeonCredentialExpiry,
  parseProviderRemediationConfig,
  REJECTED_CLEANUP_DATABASE_URL_SHA256,
  validateDeleteRoleResponse,
  validateReviewedNeonTarget,
} from "../scripts/direct-upload-cleanup-role-provider-remediation.mjs";

const PASSWORD = "A".repeat(64);
const COMMIT = "a".repeat(40);

describe("DirectUpload cleanup-role provider remediation", () => {
  it("pins the explicit destructive confirmation and protected environment", () => {
    assert.equal(
      DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRMATION,
      "replace-rejected-neon-api-cleanup-role",
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

  it("builds a valid SCRAM verifier without embedding the password", () => {
    const verifier = makeScramVerifier(PASSWORD, Buffer.alloc(16, 7));
    assert.match(
      verifier,
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    assert.ok(!verifier.includes(PASSWORD));
    assert.throws(() => makeScramVerifier("short", Buffer.alloc(16)));
  });

  it("requires the exact rejected provider posture before deletion", () => {
    const sql = buildRejectedRolePreflightSql();
    assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
    assert.match(sql, /NOT rejected\.rolcreatedb/);
    assert.match(sql, /NOT rejected\.rolcreaterole/);
    assert.match(sql, /NOT rejected\.rolreplication/);
    assert.match(sql, /NOT rejected\.rolbypassrls/);
    assert.match(sql, /direct_parent IS DISTINCT FROM 'neon_superuser'/);
    assert.match(sql, /pg_catalog\.pg_stat_activity/);
    assert.match(sql, /ROLLBACK/);
  });

  it("probes then creates the SQL role with no final memberships", () => {
    const verifier = makeScramVerifier(PASSWORD, Buffer.alloc(16, 9));
    const probe = buildReplacementProbeSql(verifier);
    const replacement = buildReplacementSql(verifier);
    for (const sql of [probe, replacement]) {
      assert.match(sql, /CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L ADMIN %I/);
      assert.match(sql, /rolsuper/);
      assert.match(sql, /rolbypassrls/);
      assert.match(sql, /parent_count <> 0 OR member_count <> 0/);
    }
    assert.match(
      probe,
      /REVOKE grainline_direct_upload_cleanup_replacement_probe FROM neondb_owner/,
    );
    assert.match(probe, /ROLLBACK/);
    assert.match(
      replacement,
      /REVOKE grainline_direct_upload_cleanup FROM neondb_owner/,
    );
    assert.match(replacement, /COMMIT/);
    assert.ok(!probe.includes(PASSWORD));
    assert.ok(!replacement.includes(PASSWORD));
  });

  it("builds only the reviewed non-pooled cleanup connection identity", () => {
    const value = buildDirectUploadCleanupDatabaseUrl(PASSWORD);
    const parsed = new URL(value);
    assert.equal(parsed.username, "grainline_direct_upload_cleanup");
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
      role: {
        role: {
          branch_id: "br-hidden-mouse-aaugn2wr",
          name: "grainline_direct_upload_cleanup",
          authentication_method: "password",
        },
      },
      environment: {
        id: 18_906_676_825,
        name: "Production DirectUpload Cleanup",
      },
    };
    assert.equal(
      validateReviewedNeonTarget(payloads).roleName,
      "grainline_direct_upload_cleanup",
    );
    assert.throws(() => validateReviewedNeonTarget({
      ...payloads,
      environment: { ...payloads.environment, id: 1 },
    }));
  });

  it("validates exact non-idempotent delete response metadata", () => {
    const result = validateDeleteRoleResponse({
      role: {
        branch_id: "br-hidden-mouse-aaugn2wr",
        name: "grainline_direct_upload_cleanup",
      },
      operations: [{
        id: "operation-1234",
        project_id: "icy-unit-96812898",
        branch_id: "br-hidden-mouse-aaugn2wr",
        status: "running",
      }],
    });
    assert.equal(result.roleName, "grainline_direct_upload_cleanup");
    assert.throws(() => validateDeleteRoleResponse({
      role: {
        branch_id: "wrong",
        name: "grainline_direct_upload_cleanup",
      },
      operations: [],
    }));
  });

  it("requires exact confirmation, commit and evidence path", () => {
    const cwd = process.cwd();
    const evidencePath = `${cwd}/.codex/evidence/`
      + `direct-upload-cleanup-role-provider-remediation-${COMMIT}.json`;
    const config = parseProviderRemediationConfig({
      DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRM:
        DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRMATION,
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

  it("keeps generated credentials off command arguments, output and evidence", () => {
    const source = readFileSync(
      "scripts/direct-upload-cleanup-role-provider-remediation.mjs",
      "utf8",
    );
    assert.doesNotMatch(source, /reveal_password/);
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
      /DirectUpload cleanup-role provider remediation failed closed/,
    );
  });
});
