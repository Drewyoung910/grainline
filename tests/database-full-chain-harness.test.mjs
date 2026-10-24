import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyFullMigrationChain,
  containsConcurrentIndex,
  findRepositoryRoot,
  listMigrationArtifacts,
  prepareMigrationSql,
  splitSqlStatements,
} from "../tools/database-full-chain/scenarios/migration-chain.mjs";
import { applyDisposableCiMigrationChain } from "../tools/database-full-chain/apply-ci-chain.mjs";
import {
  SELLER_PROFILE_PRIVATE_COLUMNS,
  assertSellerProfilePrivateLayout,
  seedSellerProfilePrivateFixture,
} from "../tools/database-full-chain/scenarios/seller-profile-private-fixture.mjs";
import { runPsqlScript } from "../tools/database-full-chain/scenarios/psql-script.mjs";
import { assertDisposablePostgres16Target } from "../tools/database-full-chain/postgres16/adapter.mjs";
import { assertDisposablePostgresTarget } from "../tools/database-full-chain/postgres/adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = findRepositoryRoot(here);
const harnessRoot = path.join(root, "tools", "database-full-chain");
const migrationRoot = path.resolve(
  process.env.DATABASE_FULL_CHAIN_TEST_MIGRATIONS_DIR ??
    path.join(root, "prisma", "migrations"),
);
const migrationOptions = { migrationRoot };

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  });
}

test("tracked harness source contains no scratch paths, URLs with credentials, or static passwords", () => {
  for (const file of allFiles(harnessRoot)) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\/private\/tmp\/claude-|\/Users\/drewyoung/iu, file);
    assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/iu, file);
    assert.doesNotMatch(source, /(?:password|passwd)\s*[:=]\s*["'][^"']+["']/iu, file);
    assert.doesNotMatch(source, /node_modules|embedded-postgres/iu, file);
  }
});

test("chain-only CI runner rejects a non-disposable target before connecting", async () => {
  let constructed = false;
  class UnexpectedClient {
    constructor() {
      constructed = true;
    }
  }
  await assert.rejects(
    applyDisposableCiMigrationChain(
      { DATABASE_FULL_CHAIN_PROOF_DATABASE_URL: "postgresql://ci@example.com/grainline_ci" },
      { Client: UnexpectedClient, log: () => {} },
    ),
    /loopback targets only/u,
  );
  assert.equal(constructed, false);
});

test("migration plan covers current main and pins the reviewed CI deviations", () => {
  const artifacts = listMigrationArtifacts(root, migrationOptions);
  assert.ok(artifacts.length > 300);
  assert.ok(
    artifacts.some(
      ({ name }) => name === "20261015010000_retire_seller_profile_private_predecessor",
    ),
  );
  const ownerArtifact = artifacts.find(
    ({ name }) => name === "20260905180000_correct_order_banned_buyer_completion",
  );
  const preparedOwner = prepareMigrationSql(ownerArtifact, "postgres16");
  assert.equal(preparedOwner.deviations[0].kind, "ci-owner-literal");
  assert.equal(preparedOwner.deviations[0].count, 4);
  assert.doesNotMatch(preparedOwner.sql, /'neondb_owner'/u);

  const concurrentArtifact = artifacts.find(({ sql }) => containsConcurrentIndex(sql));
  assert.ok(concurrentArtifact);
  assert.match(prepareMigrationSql(concurrentArtifact, "postgres16").sql, /CONCURRENTLY/iu);
  assert.throws(() => prepareMigrationSql(concurrentArtifact, "pglite"), /unsupported/u);
});

test("repository schema and retirement migration retain the post-retirement seller layout", () => {
  const schema = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
  const publicModel = schema.match(/model SellerProfile \{([\s\S]*?)\n\}/u)?.[1];
  const privateModel = schema.match(/model SellerProfilePrivate \{([\s\S]*?)\n\}/u)?.[1];
  assert.ok(publicModel);
  assert.ok(privateModel);
  for (const column of SELLER_PROFILE_PRIVATE_COLUMNS) {
    assert.doesNotMatch(publicModel, new RegExp(`^\\s*${column}\\s`, "mu"), column);
    assert.match(privateModel, new RegExp(`^\\s*${column}\\s`, "mu"), column);
  }
  const retirement = fs.readFileSync(
    path.join(
      migrationRoot,
      "20261015010000_retire_seller_profile_private_predecessor",
      "migration.sql",
    ),
    "utf8",
  );
  assert.match(retirement, /CREATE TRIGGER "SellerProfile_private_initialize"/u);
  assert.match(retirement, /INSERT INTO public\."SellerProfilePrivate"/u);
});

test("main CI proves the full chain before recreating the disposable database", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const generatedClient = workflow.indexOf(
    "      - name: Generate Prisma client for full-chain behavior proof\n",
  );
  const proof = workflow.indexOf(
    "      - name: Prove full migration chain on PostgreSQL 16 compatibility\n",
  );
  const reset = workflow.indexOf("      - name: Reset disposable database after full-chain proof\n");
  const preserve = workflow.indexOf("      - name: Preserve full-chain sources for post-isolation tests\n");
  const existingSuite = workflow.indexOf(
    "      - name: Generate Prisma client for candidate behavior tests\n",
    preserve,
  );
  assert.ok(generatedClient >= 0);
  assert.ok(proof > generatedClient);
  assert.ok(reset > proof);
  assert.ok(preserve > reset);
  assert.ok(existingSuite > preserve);
  assert.match(
    workflow.slice(proof, reset),
    /DATABASE_FULL_CHAIN_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/u,
  );
  assert.match(workflow.slice(reset, existingSuite), /dropdb[\s\S]*createdb/u);
  assert.match(
    workflow,
    /DATABASE_FULL_CHAIN_TEST_MIGRATIONS_DIR: \$\{\{ runner\.temp \}\}\/database-full-chain-source\/migrations/u,
  );
  assert.match(
    workflow,
    /production-postgres17:[\s\S]*image: postgres:17[\s\S]*DATABASE_FULL_CHAIN_POSTGRES_MAJOR: "17"[\s\S]*npm run test:database-full-chain/u,
  );
});

test("full-chain runner retries only reviewed historical role convergence refusals", async () => {
  const artifacts = listMigrationArtifacts(root, migrationOptions);
  const events = [];
  const injectedFailures = new Set();
  const adapter = {
    query: async (sql, params = []) => {
      events.push({ kind: "query", sql, params });
      return { rows: [] };
    },
    executeMigration: async (sql, { migrationName }) => {
      events.push({ kind: "migration", sql });
      if (
        migrationName === "20260801194000_enable_direct_upload_rls" &&
        !injectedFailures.has("direct-upload")
      ) {
        injectedFailures.add("direct-upload");
        throw Object.assign(
          new Error(
            "DirectUpload function source, mode, owner or ACL drifted: " +
              "grainline_direct_upload_cleanup_lease",
          ),
          { code: "P0001" },
        );
      }
      if (
        migrationName === "20260927090000_enable_order_rls" &&
        !injectedFailures.has("order")
      ) {
        injectedFailures.add("order");
        throw Object.assign(
          new Error("Core Order activation staff-function authority drifted"),
          { code: "P0001" },
        );
      }
    },
    resetOwner: async () => events.push({ kind: "reset" }),
  };
  const callbacks = [];
  const summary = await applyFullMigrationChain({
    adapter,
    repositoryRoot: root,
    migrationRoot,
    engine: "postgres16",
    bootstrapRoles: async () => callbacks.push("bootstrap"),
    convergeRoles: async (_adapter, _root, context) =>
      callbacks.push(context.migration ?? "final"),
  });
  assert.equal(summary.applied.length, artifacts.length);
  assert.equal(summary.applied[0], artifacts[0].name);
  assert.equal(summary.applied.at(-1), artifacts.at(-1).name);
  assert.deepEqual(callbacks, [
    "bootstrap",
    "20260801194000_enable_direct_upload_rls",
    "20260927090000_enable_order_rls",
    "final",
  ]);
  assert.deepEqual(
    summary.roleConvergenceRetries.map(({ migration }) => migration),
    [
      "20260801194000_enable_direct_upload_rls",
      "20260927090000_enable_order_rls",
    ],
  );
  assert.equal(
    events.filter(({ kind }) => kind === "migration").length,
    artifacts.length + 2,
  );
});

test("full-chain runner does not retry an unexpected migration failure", async () => {
  let attempts = 0;
  const adapter = {
    query: async () => ({ rows: [] }),
    executeMigration: async () => {
      attempts += 1;
      throw Object.assign(new Error("unexpected migration defect"), { code: "42601" });
    },
    resetOwner: async () => {},
  };
  const callbacks = [];
  await assert.rejects(
    applyFullMigrationChain({
      adapter,
      repositoryRoot: root,
      migrationRoot,
      engine: "postgres16",
      bootstrapRoles: async () => callbacks.push("bootstrap"),
      convergeRoles: async () => callbacks.push("converge"),
    }),
    /unexpected migration defect/u,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(callbacks, ["bootstrap"]);
});

test("SQL splitting keeps function bodies intact while isolating concurrent statements", () => {
  const statements = splitSqlStatements(`
    CREATE FUNCTION public.example() RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM 1;
    END
    $$;
    CREATE INDEX CONCURRENTLY example_idx ON public.example_table(id);
  `);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /PERFORM 1;/u);
  assert.match(statements[1], /INDEX CONCURRENTLY/u);
});

test("ported psql subset evaluates Grainline role-script conditionals without shell state", async () => {
  const statements = [];
  const database = {
    query: async (sql) => {
      statements.push(sql.trim());
      if (sql.includes("AS ready")) {
        return { rows: [{ ready: true }], fields: [{ name: "ready" }] };
      }
      return { rows: [], fields: [] };
    },
  };
  const result = await runPsqlScript(
    database,
    String.raw`\set ON_ERROR_STOP on
SELECT TRUE AS ready;
\gset
\if :ready
SELECT :'runtime_role' AS selected;
\else
SELECT 'wrong branch';
\endif`,
    { runtime_role: "grainline_app_runtime" },
  );
  assert.equal(result.vars.ready, "t");
  assert.ok(statements.some((sql) => sql.includes("'grainline_app_runtime'")));
  assert.ok(statements.every((sql) => !sql.includes("wrong branch")));
});

test("PostgreSQL 16 adapter rejects non-disposable targets and other server majors", () => {
  assert.doesNotThrow(() =>
    assertDisposablePostgres16Target(
      "postgresql://ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
      "16.10",
    ),
  );
  assert.throws(
    () => assertDisposablePostgres16Target("postgresql://ci@db.example.test/grainline_ci", "16.10"),
    /loopback/u,
  );
  assert.throws(
    () => assertDisposablePostgres16Target("postgresql://ci@127.0.0.1/other", "16.10"),
    /grainline_ci/u,
  );
  assert.throws(
    () => assertDisposablePostgres16Target("postgresql://ci@127.0.0.1/grainline_ci", "17.5"),
    /PostgreSQL 16/u,
  );
});

test("version-neutral PostgreSQL adapter binds the requested production major", () => {
  const target = "postgresql://ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
  assert.doesNotThrow(() =>
    assertDisposablePostgresTarget(target, "17.11", { expectedMajor: "17" }),
  );
  assert.throws(
    () => assertDisposablePostgresTarget(target, "16.10", { expectedMajor: "17" }),
    /PostgreSQL 17/u,
  );
  assert.throws(
    () => assertDisposablePostgresTarget(target, "17.11", { expectedMajor: "latest" }),
    /expectedMajor/u,
  );
});

test("current seller fixture requires the private layout and writes private values only there", async () => {
  const columns = [
    ...["id", "userId", "displayName", "displayNameNormalized", "stripeAccountSupported"].map(
      (column_name) => ({ table_name: "SellerProfile", column_name }),
    ),
    { table_name: "SellerProfilePrivate", column_name: "sellerProfileId" },
    ...SELLER_PROFILE_PRIVATE_COLUMNS.map((column_name) => ({
      table_name: "SellerProfilePrivate",
      column_name,
    })),
  ];
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("pg_catalog.pg_attribute")) return { rows: columns };
      if (sql.includes('FROM public."SellerProfile" AS seller')) {
        return {
          rows: [
            {
              id: params[0],
              userId: "full_chain_seller_user_default",
              stripeAccountSupported: true,
              stripeAccountId: "acct_full_chain_default",
              shipFromPhone: "+15125550100",
              onboardingComplete: true,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await assertSellerProfilePrivateLayout(database);
  await seedSellerProfilePrivateFixture(database);
  const publicInsert = calls.find((call) =>
    call.sql.includes('INSERT INTO public."SellerProfile"'),
  ).sql;
  const privateUpdate = calls.find((call) =>
    call.sql.includes('UPDATE public."SellerProfilePrivate"'),
  ).sql;
  for (const column of SELLER_PROFILE_PRIVATE_COLUMNS) {
    assert.doesNotMatch(publicInsert, new RegExp(`"${column}"`, "u"), column);
  }
  assert.match(privateUpdate, /"stripeAccountId"/u);
  assert.match(privateUpdate, /"shipFromPhone"/u);
});
