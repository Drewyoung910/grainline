import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  functionSourceFromMigration,
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";
import {
  inspectPrivateTablePreparationProduction,
} from "../scripts/private-table-preparation-production-inspect.mjs";
import {
  sellerProfilePrivateMigrationPath,
} from "./helpers/seller-profile-private-migration-path.mjs";

const releaseId = "stock_notification_v1";
const release = privateTablePreparation(releaseId);
const isolatedMigrationDirectory =
  process.env.STOCK_NOTIFICATION_PREPARATION_MIGRATION_PATH?.trim();
const verified = verifyPrivateTablePreparationSource(
  releaseId,
  process.cwd(),
  isolatedMigrationDirectory
    ? join(isolatedMigrationDirectory, "migration.sql")
    : undefined,
);
const predecessorEntry = release.functions.find(
  (entry) => entry.predecessorSourceSha256 !== undefined,
);
const predecessorSql = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013130000_move_seller_supported_snapshot_sql_callers",
  ),
  "utf8",
);
const predecessorSource = functionSourceFromMigration(
  predecessorSql,
  predecessorEntry.name,
);

function acceptedMigration() {
  return {
    migration_name: release.migration,
    checksum: release.migrationSha256,
    finished_at: "2026-10-26T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function functionRow(entry, source) {
  return {
    function_name: entry.name,
    identity_arguments: entry.arguments,
    owner_name: "neondb_owner",
    owner_bypasses_rls: true,
    security_definer: true,
    configuration: ["search_path=pg_catalog"],
    source,
    runtime_execute: true,
    staff_execute: false,
    public_execute: false,
  };
}

function fakeClientClass({ applied, predecessorBody = predecessorSource }) {
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
        const entries = applied ? release.functions : [predecessorEntry];
        return { rows: entries
          .map((entry) => functionRow(
            entry,
            applied ? verified.functionSources.get(entry.name) : predecessorBody,
          ))
          .sort((left, right) => (
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
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "a".repeat(40),
  };
}

test("StockNotification preparation is byte sealed with an exact predecessor function", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.equal(verified.functionSources.size, 9);
  assert.deepEqual(release.sourceTests, [
    "tests/stock-notification-route.test.mjs",
    "tests/stock-notification-state.test.mjs",
  ]);
  assert.equal(
    createHash("sha256").update(predecessorSource, "utf8").digest("hex"),
    predecessorEntry.predecessorSourceSha256,
  );
});

test("StockNotification preflight admits only the reviewed predecessor claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stock-notification-preparation-"));
  try {
    const env = environment(directory, "preflight");
    const evidence = await inspectPrivateTablePreparationProduction(
      env,
      {
        Client: fakeClientClass({ applied: false }),
        migrationPath: verified.migrationPath,
      },
    );
    assert.equal(evidence.state, "pending");
    assert.deepEqual(evidence.catalog.columns, []);
    assert.equal(evidence.catalog.functions.length, 1);
    assert.equal(evidence.catalog.functions[0].name, predecessorEntry.name);
    assert.equal(
      evidence.catalog.functions[0].sourceSha256,
      predecessorEntry.predecessorSourceSha256,
    );

    const driftEnv = {
      ...environment(directory, "preflight"),
      PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, "drift.json"),
    };
    await assert.rejects(
      inspectPrivateTablePreparationProduction(
        driftEnv,
        {
          Client: fakeClientClass({ applied: false, predecessorBody: "drifted" }),
          migrationPath: verified.migrationPath,
        },
      ),
      /predecessor body drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("StockNotification postflight reads back every reviewed function", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stock-notification-preparation-"));
  try {
    const preEnv = environment(directory, "preflight");
    const pre = await inspectPrivateTablePreparationProduction(
      preEnv,
      {
        Client: fakeClientClass({ applied: true }),
        migrationPath: verified.migrationPath,
      },
    );
    assert.equal(pre.state, "applied");
    assert.equal(pre.catalog.functions.length, release.functions.length);

    const postEnv = environment(
      directory,
      "postflight",
      preEnv.PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH,
    );
    const post = await inspectPrivateTablePreparationProduction(
      postEnv,
      {
        Client: fakeClientClass({ applied: true }),
        migrationPath: verified.migrationPath,
      },
    );
    assert.equal(post.state, "applied");
    assert.deepEqual(post.posture, pre.posture);
    assert.equal(post.catalog.functions.length, 9);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
