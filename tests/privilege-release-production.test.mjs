import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  privilegeRelease,
  verifyPrivilegeReleaseSource,
} from "../scripts/privilege-release-catalog.mjs";
import {
  inspectPrivilegeReleaseProduction,
} from "../scripts/privilege-release-production-inspect.mjs";

const releaseId = "service_reference_v1";
const release = privilegeRelease(releaseId);
const rootDir = join(import.meta.dirname, "..");
const stagedMigrationPath =
  process.env.SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_PATH?.trim() ?? "";
const migrationPath = stagedMigrationPath !== ""
  ? stagedMigrationPath
  : join(rootDir, "prisma", "migrations", release.migration, "migration.sql");
const workflowPath = join(
  rootDir,
  ".github",
  "workflows",
  "privilege-release-production.yml",
);

function tableRows(posture, partial = false) {
  return Object.entries(release.tables)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, successor], index) => ({
      table_name: table,
      database_name: "grainline",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
      table_owner_name: "neondb_owner",
      owner_bypasses_rls: true,
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_privileges: posture === "predecessor" || (partial && index === 0)
        ? ["DELETE", "INSERT", "SELECT", "UPDATE"]
        : successor,
      public_privileges: [],
      runtime_grant_options: [],
      runtime_column_privileges: [],
    }));
}

function fakeClientClass({ posture, recorded = false, partial = false }) {
  return class FakeClient {
    async connect() {}
    async end() {}

    async query(statement, parameters) {
      const sql = String(statement).trim();
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql)) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_class AS target")) {
        assert.deepEqual(parameters, [Object.keys(release.tables).sort()]);
        return { rows: tableRows(posture, partial) };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        assert.deepEqual(parameters, [release.migration]);
        return { rows: recorded ? [{
          migration_name: release.migration,
          checksum: release.migrationSha256,
          finished_at: new Date("2026-11-01T12:00:00.000Z"),
          rolled_back_at: null,
          applied_steps_count: 0,
        }] : [] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://owner:password@example.invalid:5432/grainline?sslmode=verify-full&channel_binding=require",
    PRIVILEGE_RELEASE_ID: releaseId,
    PRIVILEGE_RELEASE_PHASE: phase,
    PRIVILEGE_RELEASE_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVILEGE_RELEASE_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
  };
}

async function inspect(directory, phase, clientOptions, previousPath) {
  return inspectPrivilegeReleaseProduction(
    environment(directory, phase, previousPath),
    {
      Client: fakeClientClass(clientOptions),
      rootDir,
      migrationPath,
    },
  );
}

test("catalog byte-seals the reviewed reusable privilege release", () => {
  assert.ok(isAbsolute(migrationPath));
  const verified = verifyPrivilegeReleaseSource(releaseId, rootDir, migrationPath);
  assert.equal(verified.digest, release.migrationSha256);
  assert.deepEqual(release.sourceTests, [
    "tests/service-reference-least-privilege.test.mjs",
  ]);
  assert.equal(
    release.minimumCompatibleAppCommit,
    "b56e226d327347fe155aa07ded0bde999ca929be",
  );
  assert.deepEqual(release.tables, {
    FoundingMakerGrant: ["SELECT"],
    Metro: ["INSERT", "SELECT", "UPDATE"],
    SiteConfig: ["SELECT"],
    SiteMetricsSnapshot: ["INSERT", "SELECT", "UPDATE"],
    SystemAuditLog: ["INSERT", "SELECT"],
  });
  assert.throws(() => privilegeRelease("unreviewed"), /release id is not reviewed/u);
});

test("production inspector recognizes all three restart-safe release states", async () => {
  const directory = mkdtempSync(join(tmpdir(), "grainline-privilege-release-"));
  try {
    const pending = await inspect(directory, "preflight", {
      posture: "predecessor",
    });
    assert.equal(pending.state, "pending");
    assert.equal(pending.catalog.posture, "predecessor");
    assert.equal(statSync(join(directory, "preflight.json")).mode & 0o777, 0o600);

    rmSync(join(directory, "preflight.json"));
    const unrecorded = await inspect(directory, "preflight", {
      posture: "successor",
    });
    assert.equal(unrecorded.state, "applied_unrecorded");

    rmSync(join(directory, "preflight.json"));
    const applied = await inspect(directory, "preflight", {
      posture: "successor",
      recorded: true,
    });
    assert.equal(applied.state, "applied");
    const postflight = await inspect(
      directory,
      "postflight",
      { posture: "successor", recorded: true },
      join(directory, "preflight.json"),
    );
    assert.equal(postflight.state, "applied");
    const evidence = JSON.parse(readFileSync(join(directory, "postflight.json"), "utf8"));
    assert.equal(evidence.containsRowData, false);
    assert.equal(evidence.productionChanged, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production inspector rejects partial privileges and false ledger claims", async () => {
  const partialDirectory = mkdtempSync(join(tmpdir(), "grainline-privilege-partial-"));
  const ledgerDirectory = mkdtempSync(join(tmpdir(), "grainline-privilege-ledger-"));
  try {
    await assert.rejects(
      inspect(partialDirectory, "preflight", {
        posture: "successor",
        partial: true,
      }),
      /privilege release is partially applied/u,
    );
    await assert.rejects(
      inspect(ledgerDirectory, "preflight", {
        posture: "predecessor",
        recorded: true,
      }),
      /applied release posture drifted/u,
    );
  } finally {
    rmSync(partialDirectory, { recursive: true, force: true });
    rmSync(ledgerDirectory, { recursive: true, force: true });
  }
});

test("workflow is exact-main, serialized, restart-safe, and evidence preserving", () => {
  const source = readFileSync(workflowPath, "utf8");
  const parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.deepEqual(
    parsed.on.workflow_dispatch.inputs.release_id.options,
    [releaseId],
  );
  assert.match(source, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /main\.commit\.sha !== sha/u);
  assert.match(source, /Exact-main push workflows are not all green/u);
  assert.match(source, /compatible_app_commit:/u);
  assert.match(source, /production_deployment_id:/u);
  assert.match(source, /superseded_app_deployment_id:/u);
  assert.match(source, /superseded_app_commit:/u);
  assert.match(source, /Compatible app predates the reviewed privilege minimum/u);
  assert.match(source, /Compatible app commit is not an ancestor of privilege release/u);
  assert.match(source, /Compatible app does not succeed the reviewed predecessor/u);
  assert.match(source, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(source, /guard-production-migration-runner\.mjs/u);
  assert.match(source, /assert-reviewed-pending-migrations\.mjs/u);
  assert.match(source, /steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(source, /steps\.preflight\.outputs\.state != 'applied'/u);
  assert.match(source, /prisma migrate resolve --applied/u);
  assert.match(source, /audit:db-grants -- --require-direct-url/u);
  assert.match(source, /if: always\(\)[\s\S]*if-no-files-found: error/u);
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)) {
    assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u);
  }
});
