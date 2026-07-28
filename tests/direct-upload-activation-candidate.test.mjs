import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_ACK,
  DIRECT_UPLOAD_ACTIVATION_MIGRATION,
  buildDirectUploadActivationCandidate,
} from "../scripts/stage-direct-upload-activation-migration.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("DirectUpload activation candidate", () => {
  it("keeps the candidate unapplied and loopback-only", () => {
    assert.equal(
      DIRECT_UPLOAD_ACTIVATION_MIGRATION,
      "20260726190500_enable_direct_upload_rls",
    );
    assert.equal(
      DIRECT_UPLOAD_ACTIVATION_ACK,
      "I_ACKNOWLEDGE_LOOPBACK_DIRECT_UPLOAD_ACTIVATION_STAGING",
    );
    assert.throws(
      () => readFileSync(
        `prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_MIGRATION}/migration.sql`,
        "utf8",
      ),
      /ENOENT/,
    );
    const script = source(
      "scripts/stage-direct-upload-activation-migration.mjs",
    );
    assert.match(script, /localhost/);
    assert.match(script, /127\.0\.0\.1/);
    assert.match(script, /grainline_ci/);
  });

  it("partitions all 35 exact function identities without overlap", () => {
    assert.equal(DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length, 35);
    assert.equal(DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.length, 17);
    assert.equal(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length, 3);
    assert.equal(DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES.length, 15);
    assert.equal(
      new Set(DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => entry.name))
        .size,
      35,
    );
    for (const entry of DIRECT_UPLOAD_ACTIVATION_FUNCTIONS) {
      assert.equal(typeof entry.identityArguments, "string");
      assert.equal(
        entry.runtimeExecute,
        DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.includes(entry.name),
      );
      assert.equal(
        entry.cleanupExecute,
        DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.includes(entry.name),
      );
      assert.equal(entry.runtimeExecute && entry.cleanupExecute, false);
    }
  });

  it("requires the exact roles, retired key, constraints, and predecessor ACLs", () => {
    const { migration } = buildDirectUploadActivationCandidate();

    assert.ok(
      migration.indexOf("LOCK TABLE")
        < migration.indexOf(
          "DO $grainline_direct_upload_activation_role_preflight$",
        ),
      "activation must lock before inspecting mutable table posture",
    );
    assert.match(
      migration,
      /grainline_app_runtime role posture is not DirectUpload-safe/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_cleanup_v2 posture is not DirectUpload-safe/,
    );
    assert.match(
      migration,
      /CaseMessageAttachment\.objectKey must be retired before activation/,
    );
    assert.match(
      migration,
      /DirectUpload constraints must all exist and be validated before activation/,
    );
    assert.match(
      migration,
      /DirectUpload predecessor table authority is not exact/,
    );
    assert.match(
      migration,
      /member\.rolname IN[\s\S]*granted_role\.rolname IN/,
    );
    assert.match(migration, /actual\.prokind IS DISTINCT FROM 'f'/);
    assert.match(
      migration,
      /pg_catalog\.md5\(actual\.prosrc\) IS DISTINCT FROM expected\.source_md5/,
    );
  });

  it("activates both service tables with zero policies and zero direct authority", () => {
    const { migration } = buildDirectUploadActivationCandidate();

    assert.equal(
      (migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length,
      2,
    );
    assert.equal(
      (migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length,
      2,
    );
    assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
    assert.match(
      migration,
      /REVOKE ALL ON TABLE[\s\S]*"DirectUpload"[\s\S]*"DirectUploadReference"[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2/,
    );
    assert.match(
      migration,
      /DirectUpload activation retained effective table authority/,
    );
    assert.match(
      migration,
      /DirectUpload activation retained column authority/,
    );
    assert.match(
      migration,
      /'TRIGGER'\n\s+\)\n\s+\)\n\s+OR EXISTS \(\n\s+SELECT 1\n\s+FROM pg_catalog\.pg_class AS class/,
    );
  });

  it("grants runtime 17 functions, worker 3, and withholds risky operations", () => {
    const { migration } = buildDirectUploadActivationCandidate();
    const grantStatements =
      migration.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?\n  TO [^;]+;/g)
      ?? [];
    const runtimeGrants = grantStatements.filter((statement) =>
      statement.endsWith("TO grainline_app_runtime;"));
    const cleanupGrants = grantStatements.filter((statement) =>
      statement.endsWith("TO grainline_direct_upload_cleanup_v2;"));

    assert.equal(runtimeGrants.length, 17);
    assert.equal(cleanupGrants.length, 3);
    assert.ok(
      cleanupGrants.every((statement) =>
        DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.some((name) =>
          statement.includes(name))),
    );
    const runtimeGrantText = runtimeGrants.join("\n");
    assert.doesNotMatch(
      runtimeGrantText,
      /grainline_direct_upload_cleanup_(?:lease|complete|fail)/,
    );
    assert.doesNotMatch(
      runtimeGrantText,
      /grainline_direct_upload_record_private_message/,
    );
  });

  it("keeps provisioning and the global audit convergent after activation", () => {
    const provision = source("scripts/provision-runtime-db-role.sql");
    const audit = source("scripts/audit-runtime-db-grants.mjs");

    assert.match(
      provision,
      /DirectUpload RLS is partially or unexpectedly configured/,
    );
    assert.match(
      provision,
      /\\if :direct_upload_rls_active[\s\S]*REVOKE ALL ON TABLE public\."DirectUpload"/,
    );
    assert.match(
      provision,
      /\\if :direct_upload_rls_active[\s\S]*grainline_direct_upload_record_private_message[\s\S]*grainline_direct_upload_cleanup_lease/,
    );
    assert.match(audit, /directUploadRlsActivationExpected/);
    assert.match(
      audit,
      /tableName === "DirectUpload"[\s\S]*directUploadRlsActivationExpected/,
    );
  });
});
