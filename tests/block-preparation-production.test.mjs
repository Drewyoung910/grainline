import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";
import {
  inspectPrivateTablePreparationProduction,
} from "../scripts/private-table-preparation-production-inspect.mjs";

const releaseId = "block_v1";
const release = privateTablePreparation(releaseId);
const verified = verifyPrivateTablePreparationSource(releaseId);

function acceptedMigration() {
  return {
    migration_name: release.migration,
    checksum: release.migrationSha256,
    finished_at: "2026-10-28T05:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function fakeClientClass({ applied }) {
  return class FakeClient {
    async connect() {}
    async end() {}

    async query(statement) {
      const sql = String(statement);
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql.trim())) return { rows: [] };
      if (sql.includes("current_database() AS database_name")) {
        return { rows: [{
          database_name: "grainline",
          current_user_name: "neondb_owner",
          session_user_name: "neondb_owner",
          table_owner_name: "neondb_owner",
          owner_bypasses_rls: true,
          rls_enabled: false,
          rls_forced: false,
          table_acl: "{neondb_owner=arwdDxt/neondb_owner,grainline_app_runtime=arwd/neondb_owner}",
          policy_count: 0,
          runtime_select: true,
          runtime_insert: true,
          runtime_update: true,
          runtime_delete: true,
          staff_select: false,
          public_select: false,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: applied ? [acceptedMigration()] : [] };
      }
      if (sql.includes("AS columns") && sql.includes("AS functions")) {
        return { rows: [{ columns: 0, functions: 0 }] };
      }
      if (sql.includes("pg_catalog.format_type")) return { rows: [] };
      if (sql.includes("procedure.prosrc AS source")) {
        if (!applied) return { rows: [] };
        return { rows: release.functions.map((entry) => ({
          function_name: entry.name,
          identity_arguments: entry.arguments,
          owner_name: "neondb_owner",
          owner_bypasses_rls: true,
          security_definer: true,
          configuration: ["search_path=pg_catalog"],
          source: verified.functionSources.get(entry.name),
          runtime_execute: true,
          staff_execute: false,
          public_execute: false,
        })).sort((left, right) => (
          left.function_name.localeCompare(right.function_name)
          || left.identity_arguments.localeCompare(right.identity_arguments)
        )) };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 100)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    PRIVATE_TABLE_PREPARATION_RELEASE_ID: releaseId,
    PRIVATE_TABLE_PREPARATION_PHASE: phase,
    PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVATE_TABLE_PREPARATION_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
  };
}

test("Block preparation is byte sealed, additive, and release-cataloged", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.equal(verified.functionSources.size, 5);
  assert.deepEqual(release.sourceTests, [
    "tests/block-authority-preparation.test.mjs",
    "tests/notification-block-race-guardrails.test.mjs",
    "tests/order-blocked-pair-checkout.test.mjs",
    "tests/seller-profile-block-follow-cleanup-conversion.test.mjs",
  ]);
});

test("Block preparation inspector proves restart-safe pending and applied states", async () => {
  const directory = mkdtempSync(join(tmpdir(), "block-preparation-"));
  try {
    const pendingEnv = environment(directory, "preflight");
    const pending = await inspectPrivateTablePreparationProduction(
      pendingEnv,
      { Client: fakeClientClass({ applied: false }) },
    );
    assert.equal(pending.state, "pending");
    assert.deepEqual(pending.catalog, { columns: [], functions: [] });

    const appliedPreflightEnv = {
      ...environment(directory, "preflight"),
      PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, "applied.json"),
    };
    const applied = await inspectPrivateTablePreparationProduction(
      appliedPreflightEnv,
      { Client: fakeClientClass({ applied: true }) },
    );
    assert.equal(applied.state, "applied");
    assert.equal(applied.catalog.functions.length, 5);

    const postflight = await inspectPrivateTablePreparationProduction(
      environment(
        directory,
        "postflight",
        appliedPreflightEnv.PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH,
      ),
      { Client: fakeClientClass({ applied: true }) },
    );
    assert.equal(postflight.state, "applied");
    assert.deepEqual(postflight.posture, applied.posture);
    assert.equal(postflight.catalog.functions.length, 5);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
