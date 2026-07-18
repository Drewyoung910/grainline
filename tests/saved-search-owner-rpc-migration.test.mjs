import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  SAVED_SEARCH_OWNER_RPC_FUNCTIONS,
  collectSavedSearchOwnerRpcIssues,
} = await import("../scripts/audit-runtime-db-grants.mjs");

const migrationPath =
  "prisma/migrations/20260717024500_add_saved_search_owner_rpcs/migration.sql";
const projectionMigrationPath =
  "prisma/migrations/20260717025000_harden_saved_search_owner_rpc_projection/migration.sql";
const rlsMigrationPath =
  "prisma/migrations/20260717030000_enable_saved_search_rls/migration.sql";

function source(path) {
  return readFileSync(path, "utf8");
}

function rpcBody(functionName) {
  const migration = source(
    functionName === "grainline_saved_search_list"
      ? projectionMigrationPath
      : migrationPath,
  );
  const delimiter = `$${functionName}$`;
  assert.equal(
    migration.split(delimiter).length - 1,
    2,
    `expected exactly one ${functionName} body`,
  );
  const start = migration.indexOf(`AS ${delimiter}`);
  assert.notEqual(start, -1, `missing ${functionName} body start`);
  const bodyStart = start + `AS ${delimiter}`.length;
  const end = migration.indexOf(`${delimiter};`, bodyStart);
  assert.notEqual(end, -1, `missing ${functionName} body end`);
  return migration.slice(bodyStart, end);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactRpcRows() {
  const shared = {
    owner_name: "grainline_migration_owner",
    security_definer: false,
    leakproof: false,
    volatility: "v",
    parallel_safety: "u",
    function_kind: "f",
    language_name: "plpgsql",
    function_config: ["search_path=pg_catalog"],
    return_contract_valid: true,
    runtime_privileges: ["EXECUTE"],
    runtime_grant_option_privileges: [],
    public_privileges: [],
    public_grant_option_privileges: [],
    other_role_privileges: [],
    other_role_grant_option_privileges: [],
  };
  return [
    {
      ...shared,
      function_name: "grainline_saved_search_list",
      identity_arguments: "p_user_id text, p_take integer, p_search_id text",
      function_source: rpcBody("grainline_saved_search_list"),
    },
    {
      ...shared,
      function_name: "grainline_saved_search_delete_one",
      identity_arguments: "p_user_id text, p_search_id text",
      function_source: rpcBody("grainline_saved_search_delete_one"),
    },
  ];
}

describe("SavedSearch owner RPC pre-RLS migration", () => {
  it("keeps the narrow RPC migration before the optional separately gated RLS migration", () => {
    assert.ok(migrationPath < rlsMigrationPath);
    assert.ok(migrationPath < projectionMigrationPath);
    assert.ok(projectionMigrationPath < rlsMigrationPath);
    assert.equal(existsSync(migrationPath), true);
    assert.equal(existsSync(projectionMigrationPath), true);
    assert.doesNotThrow(() => source(migrationPath));
    assert.doesNotThrow(() => source(projectionMigrationPath));
    if (existsSync(rlsMigrationPath)) {
      assert.doesNotThrow(() => source(rlsMigrationPath));
    }
  });

  it("creates only invoker owner-filtered list/read and delete-one operations", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /CREATE FUNCTION public\.grainline_saved_search_list\(\s*p_user_id text,\s*p_take integer DEFAULT NULL,\s*p_search_id text DEFAULT NULL\s*\)/,
    );
    assert.match(
      migration,
      /RETURNS SETOF public\."SavedSearch"/,
    );
    assert.match(
      migration,
      /CREATE FUNCTION public\.grainline_saved_search_delete_one\(\s*p_user_id text,\s*p_search_id text\s*\)[\s\S]*?RETURNS integer/,
    );
    assert.equal((migration.match(/^SECURITY INVOKER$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^VOLATILE$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^PARALLEL UNSAFE$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 2);
    assert.doesNotMatch(migration, /SECURITY DEFINER/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY/i);

    assert.match(
      migration,
      /FROM public\."SavedSearch" AS saved_search[\s\S]*?saved_search\."userId" = p_user_id[\s\S]*?saved_search\.id = p_search_id/,
    );
  });

  it("replaces the list RPC with an explicit fail-closed column projection", () => {
    const migration = source(projectionMigrationPath);

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.grainline_saved_search_list/);
    assert.doesNotMatch(migration, /SELECT\s+saved_search\.\*/);
    const returnQuery = migration.match(
      /RETURN QUERY\s+SELECT([\s\S]*?)\s+FROM public\."SavedSearch" AS saved_search/,
    );
    assert.ok(returnQuery, "missing explicit SavedSearch return query");
    const projectedColumns = [
      ...returnQuery[1].matchAll(/saved_search\.("[^"]+"|[A-Za-z][A-Za-z0-9]*)/g),
    ].map((match) => match[1]);
    assert.deepEqual(projectedColumns, [
      "id",
      '"userId"',
      "query",
      "category",
      '"minPrice"',
      '"maxPrice"',
      "tags",
      '"notifyEmail"',
      '"createdAt"',
      '"listingType"',
      '"shipsWithinDays"',
      '"minRating"',
      "lat",
      "lng",
      '"radiusMiles"',
      "sort",
    ], "SETOF SavedSearch columns must remain in PostgreSQL physical attnum order");
    assert.match(migration, /FROM public\."SavedSearch" AS saved_search/);
    assert.match(migration, /saved_search\."userId" = p_user_id/);
    assert.match(migration, /saved_search\.id = p_search_id/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_saved_search_list/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_saved_search_list/);
  });

  it("keeps owner filters on the original delete RPC", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /DELETE FROM public\."SavedSearch" AS saved_search[\s\S]*?saved_search\."userId" = p_user_id[\s\S]*?saved_search\.id = p_search_id/,
    );
    assert.doesNotMatch(migration, /(?<!public\.)"SavedSearch"/);
  });

  it("matches the bounded server-side user-context validation without rejecting arbitrary search ids", () => {
    const migration = source(migrationPath);

    assert.equal((migration.match(/p_user_id <> pg_catalog\.btrim\(p_user_id\)/g) ?? []).length, 2);
    assert.equal((migration.match(/pg_catalog\.char_length\(p_user_id\) > 128/g) ?? []).length, 2);
    assert.equal((migration.match(/p_user_id !~ '\^\[A-Za-z0-9\._:-\]\+\$'/g) ?? []).length, 2);
    assert.equal((migration.match(/prior_user_id <> p_user_id/g) ?? []).length, 2);
    assert.equal(
      (migration.match(/pg_catalog\.set_config\('app\.user_id', p_user_id, true\)/g) ?? []).length,
      2,
    );
    assert.equal(
      (migration.match(/pg_catalog\.current_setting\('app\.user_id', true\) IS DISTINCT FROM p_user_id/g) ?? []).length,
      2,
    );
    assert.match(migration, /refusing to switch SavedSearch user context/);
    assert.doesNotMatch(migration, /btrim\(p_search_id\)|SavedSearch id must be nonempty/);
  });

  it("revokes PUBLIC and grants non-grantable execution only to the runtime role", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.grainline_saved_search_list\(text, integer, text\)\s+FROM PUBLIC/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.grainline_saved_search_delete_one\(text, text\)\s+FROM PUBLIC/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.grainline_saved_search_list\(text, integer, text\)\s+FROM grainline_app_runtime/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.grainline_saved_search_delete_one\(text, text\)\s+FROM grainline_app_runtime/,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.grainline_saved_search_list\(text, integer, text\)\s+TO grainline_app_runtime/,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.grainline_saved_search_delete_one\(text, text\)\s+TO grainline_app_runtime/,
    );
    assert.doesNotMatch(migration, /WITH GRANT OPTION/);
    assert.match(migration, /rpc\.proowner <> migration_oid/);
    assert.match(migration, /rpc\.prosecdef/);
    assert.match(migration, /rpc\.proleakproof/);
    assert.match(migration, /rpc\.provolatile <> 'v'/);
    assert.match(migration, /rpc\.proparallel <> 'u'/);
    assert.match(migration, /rpc\.prokind <> 'f'/);
    assert.match(migration, /rpc\.prolang <> \(/);
    assert.match(migration, /language\.lanname = 'plpgsql'/);
    assert.match(migration, /rpc\.proconfig IS DISTINCT FROM ARRAY\['search_path=pg_catalog'\]::text\[\]/);
    assert.match(migration, /acl\.grantee = runtime_oid[\s\S]*?acl\.is_grantable/);
    assert.match(migration, /acl\.grantee = 0[\s\S]*?acl\.grantee NOT IN \(runtime_oid, migration_oid\)/);
  });

  it("defines the exact source-derived RPC signature inventory", () => {
    assert.deepEqual(SAVED_SEARCH_OWNER_RPC_FUNCTIONS, {
      grainline_saved_search_list: {
        identityArguments: "p_user_id text, p_take integer, p_search_id text",
        sourceSha256: "8fb745049da3f57fe116392124c13b7e55bb669d087a88a89a8126bad6b28d19",
      },
      grainline_saved_search_delete_one: {
        identityArguments: "p_user_id text, p_search_id text",
        sourceSha256: "d34ee291a4ca9338b341f9e128249902e9d63b4330461e3fbed1dddce4ca3424",
      },
    });
    for (const [functionName, expected] of Object.entries(SAVED_SEARCH_OWNER_RPC_FUNCTIONS)) {
      assert.equal(sha256(rpcBody(functionName)), expected.sourceSha256);
    }
  });

  it("centralizes exact live catalog posture reads in the grant audit", () => {
    const audit = source("scripts/audit-runtime-db-grants.mjs");

    assert.match(audit, /export async function readSavedSearchOwnerRpcState/);
    assert.match(audit, /pg_get_function_identity_arguments\(p\.oid\) AS identity_arguments/);
    assert.match(audit, /p\.prosecdef AS security_definer/);
    assert.match(audit, /p\.proleakproof AS leakproof/);
    assert.match(audit, /p\.provolatile AS volatility/);
    assert.match(audit, /p\.proparallel AS parallel_safety/);
    assert.match(audit, /p\.prokind AS function_kind/);
    assert.match(audit, /l\.lanname AS language_name/);
    assert.match(audit, /p\.proconfig AS function_config/);
    assert.match(audit, /p\.prosrc AS function_source/);
    assert.match(audit, /p\.prorettype = 'public\."SavedSearch"'::regtype/);
    assert.match(audit, /p\.prorettype = 'pg_catalog\.int4'::regtype/);
    assert.match(audit, /AS runtime_grant_option_privileges/);
    assert.match(audit, /AS public_privileges/);
    assert.match(audit, /AS other_role_privileges/);
    assert.match(
      audit,
      /await readSavedSearchOwnerRpcState\(client, runtimeRole\)/,
    );
  });

  it("accepts only the exact least-privilege live catalog posture", () => {
    assert.deepEqual(
      collectSavedSearchOwnerRpcIssues(
        exactRpcRows(),
        "grainline_app_runtime",
        "grainline_migration_owner",
      ),
      [],
    );
  });

  it("reports signature, execution, ownership, and routine posture drift", () => {
    const rows = exactRpcRows();
    rows[0] = {
      ...rows[0],
      owner_name: "grainline_app_runtime",
      security_definer: true,
      leakproof: true,
      volatility: "s",
      parallel_safety: "s",
      function_kind: "p",
      language_name: "sql",
      function_config: ["search_path=public"],
      return_contract_valid: false,
      function_source: `${rows[0].function_source}\n-- drift`,
      runtime_privileges: [],
      runtime_grant_option_privileges: ["EXECUTE"],
      public_privileges: ["EXECUTE"],
      public_grant_option_privileges: ["EXECUTE"],
      other_role_privileges: ["unexpected_role:EXECUTE"],
      other_role_grant_option_privileges: ["unexpected_role:EXECUTE"],
    };
    rows.push({
      ...rows[0],
      identity_arguments: "p_user_id text",
    });
    rows.splice(1, 1);

    const issues = collectSavedSearchOwnerRpcIssues(
      rows,
      "grainline_app_runtime",
      "grainline_migration_owner",
    ).join("\n");

    assert.match(issues, /runtime role owns SavedSearch owner RPC/);
    assert.match(issues, /must be SECURITY INVOKER/);
    assert.match(issues, /must not be LEAKPROOF/);
    assert.match(issues, /must be VOLATILE/);
    assert.match(issues, /must be PARALLEL UNSAFE/);
    assert.match(issues, /must be an ordinary function/);
    assert.match(issues, /must use PL\/pgSQL/);
    assert.match(issues, /must set only search_path=pg_catalog/);
    assert.match(issues, /unexpected return contract/);
    assert.match(issues, /body fingerprint changed/);
    assert.match(issues, /runtime role must have exactly direct EXECUTE/);
    assert.match(issues, /runtime EXECUTE must not be grantable/);
    assert.match(issues, /must revoke all privileges from PUBLIC/);
    assert.match(issues, /PUBLIC privileges must not be grantable/);
    assert.match(issues, /grants privileges to an unexpected role/);
    assert.match(issues, /grants grant-option privileges to an unexpected role/);
    assert.match(issues, /unexpected overload/);
    assert.match(issues, /missing expected SavedSearch owner RPC grainline_saved_search_delete_one/);
  });

  it("fails closed when a live RPC body cannot be read", () => {
    const rows = exactRpcRows();
    rows[0] = { ...rows[0], function_source: null };

    assert.match(
      collectSavedSearchOwnerRpcIssues(
        rows,
        "grainline_app_runtime",
        "grainline_migration_owner",
      ).join("\n"),
      /function body source could not be read/,
    );
  });
});
