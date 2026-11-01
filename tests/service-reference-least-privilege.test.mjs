import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
  SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256,
  readServiceReferenceLeastPrivilegeState,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";
import {
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

const inventory = Object.freeze({
  rlsPolicyTables: [],
  rlsEnableTables: [],
  rlsForceTables: [],
  serviceReferenceLeastPrivilegeApplied: true,
});
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceTree(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceTree(path);
      if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) return [];
      return [readFileSync(path, "utf8")];
    })
    .join("\n");
}

function migrationSourcePath() {
  const livePath = join(
    repositoryRoot,
    "prisma/migrations",
    SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
    "migration.sql",
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath =
    process.env.SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && isAbsolute(stagedPath) && existsSync(stagedPath),
    "missing isolated service/reference least-privilege migration",
  );
  return stagedPath;
}

describe("service and reference table least privilege", () => {
  it("pins the migration and changes provisioning only after its exact ledger row", () => {
    const migration = readFileSync(migrationSourcePath());
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256,
    );

    const provisioning = readFileSync(
      join(repositoryRoot, "scripts/provision-runtime-db-role.sql"),
      "utf8",
    );
    assert.match(provisioning, new RegExp(SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION, "u"));
    assert.match(
      provisioning,
      new RegExp(SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256, "u"),
    );
    assert.match(
      provisioning,
      /\\if :grainline_service_reference_least_privilege_applied[\s\S]*REVOKE ALL ON TABLE[\s\S]*\\endif/u,
    );
    assert.match(provisioning, /applied_steps_count IN \(0, 1\)/u);
    assert.equal(
      REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(
        SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
      ),
      SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256,
    );
  });

  it("keeps emergency rollback compatible with a completed Prisma ledger row", () => {
    const rollback = readFileSync(
      join(
        repositoryRoot,
        "docs/rls-drafts/service-reference-least-privilege-rollback.sql",
      ),
      "utf8",
    );
    assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
    assert.match(rollback, /new reviewed forward migration with a new name/u);
  });

  it("changes the recurring audit expectation only after the exact ledger row", async () => {
    const absent = await readServiceReferenceLeastPrivilegeState({
      async query(sql) {
        if (sql.includes("to_regclass")) return { rows: [{ migration_table: "_prisma_migrations" }] };
        return { rows: [] };
      },
    });
    assert.deepEqual(absent, { applied: false, issues: [] });

    const exact = await readServiceReferenceLeastPrivilegeState({
      async query(sql, params) {
        if (sql.includes("to_regclass")) return { rows: [{ migration_table: "_prisma_migrations" }] };
        assert.deepEqual(params, [SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION]);
        return { rows: [{
          migration_name: SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
          checksum: SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256,
          finished_at: new Date(),
          rolled_back_at: null,
          applied_steps_count: 1,
        }] };
      },
    });
    assert.deepEqual(exact, { applied: true, issues: [] });

    const manuallyRecorded = await readServiceReferenceLeastPrivilegeState({
      async query(sql, params) {
        if (sql.includes("to_regclass")) return { rows: [{ migration_table: "_prisma_migrations" }] };
        assert.deepEqual(params, [SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION]);
        return { rows: [{
          migration_name: SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
          checksum: SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_SHA256,
          finished_at: new Date(),
          rolled_back_at: null,
          applied_steps_count: 0,
        }] };
      },
    });
    assert.deepEqual(manuallyRecorded, { applied: true, issues: [] });

    const drifted = await readServiceReferenceLeastPrivilegeState({
      async query(sql) {
        if (sql.includes("to_regclass")) return { rows: [{ migration_table: "_prisma_migrations" }] };
        return { rows: [{
          migration_name: SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION,
          checksum: "drifted",
          finished_at: new Date(),
          rolled_back_at: null,
          applied_steps_count: 1,
        }] };
      },
    });
    assert.equal(drifted.applied, false);
    assert.match(drifted.issues.join("\n"), /migration ledger is partial or drifted/u);
  });

  it("requires only the operations exercised by current application callers", () => {
    assert.deepEqual(
      requiredRuntimeTablePrivileges("SiteConfig", {
        ...inventory,
        serviceReferenceLeastPrivilegeApplied: false,
      }),
      ["SELECT", "INSERT", "UPDATE", "DELETE"],
    );
    assert.deepEqual(requiredRuntimeTablePrivileges("SiteConfig", inventory), ["SELECT"]);
    assert.deepEqual(requiredRuntimeTablePrivileges("SystemAuditLog", inventory), [
      "SELECT",
      "INSERT",
    ]);
    assert.deepEqual(requiredRuntimeTablePrivileges("FoundingMakerGrant", inventory), ["SELECT"]);
    assert.deepEqual(requiredRuntimeTablePrivileges("Metro", inventory), [
      "SELECT",
      "INSERT",
      "UPDATE",
    ]);
    assert.deepEqual(requiredRuntimeTablePrivileges("SiteMetricsSnapshot", inventory), [
      "SELECT",
      "INSERT",
      "UPDATE",
    ]);
    assert.deepEqual(
      requiredRuntimeTablePrivileges("SellerExactMapConsentEvent", inventory),
      [],
    );
  });

  it("keeps application source inside the reviewed operation boundary", () => {
    const source = sourceTree(join(repositoryRoot, "src"));
    assert.doesNotMatch(
      source,
      /\.siteConfig\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u,
    );
    assert.doesNotMatch(
      source,
      /\.systemAuditLog\.(?:update|updateMany|delete|deleteMany|upsert)\s*\(/u,
    );
    assert.doesNotMatch(
      source,
      /\.foundingMakerGrant\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u,
    );
    assert.doesNotMatch(source, /\.metro\.(?:delete|deleteMany)\s*\(/u);
    assert.doesNotMatch(
      source,
      /\.siteMetricsSnapshot\.(?:delete|deleteMany)\s*\(/u,
    );
    assert.doesNotMatch(source, /\.sellerExactMapConsentEvent\./u);
  });
});
