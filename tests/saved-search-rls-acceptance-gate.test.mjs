import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const {
  DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
  assertLiveCleanupConnectionIdentity,
  assertOwnerRpcProjectionCanary,
  buildEvidencePayload,
  buildFixtureIds,
  collectSavedSearchCatalogIssues,
  collectSavedSearchPolicyIssues,
  main,
  normalizeRlsPolicyExpression,
  parseGateConfig,
  parseNeonDatabaseIdentity,
  redactEvidenceText,
  validateFixture,
  writeEvidencePayload,
} = await import("../scripts/saved-search-rls-acceptance-gate.mjs");

const SCRIPT_PATH = "scripts/saved-search-rls-acceptance-gate.mjs";
const OWNER_RPC_MIGRATION_PATH =
  "prisma/migrations/20260717024500_add_saved_search_owner_rpcs/migration.sql";
const OWNER_RPC_PROJECTION_MIGRATION_PATH =
  "prisma/migrations/20260717025000_harden_saved_search_owner_rpc_projection/migration.sql";
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime-secret@ep-grainline-staging-pooler.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require";
const OWNER_URL =
  "postgresql://grainline_migration_owner:owner-secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require";

function source(path = SCRIPT_PATH) {
  return readFileSync(path, "utf8");
}

function exactProjectionCanaryRow(fixture) {
  return {
    category: fixture.projectionCanaryA.category,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    id: fixture.seedSearchAId,
    lat: fixture.projectionCanaryA.lat,
    listingType: fixture.projectionCanaryA.listingType,
    lng: fixture.projectionCanaryA.lng,
    maxPrice: fixture.projectionCanaryA.maxPrice,
    minPrice: fixture.projectionCanaryA.minPrice,
    minRating: fixture.projectionCanaryA.minRating,
    notifyEmail: fixture.projectionCanaryA.notifyEmail,
    query: fixture.seedQueryA,
    radiusMiles: fixture.projectionCanaryA.radiusMiles,
    shipsWithinDays: fixture.projectionCanaryA.shipsWithinDays,
    sort: fixture.projectionCanaryA.sort,
    tags: [...fixture.projectionCanaryA.tags],
    userId: fixture.userA.id,
  };
}

function ownerRpcBody(functionName) {
  const migration = source(
    functionName === "grainline_saved_search_list"
      ? OWNER_RPC_PROJECTION_MIGRATION_PATH
      : OWNER_RPC_MIGRATION_PATH,
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

function baseEnv(overrides = {}) {
  return {
    SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL: OWNER_URL,
    SAVED_SEARCH_RLS_GATE_CONFIRM: "staging-only",
    SAVED_SEARCH_RLS_GATE_DATABASE_URL: RUNTIME_URL,
    SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH: "/private/tmp/saved-search-rls-test.json",
    SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID: "ep-grainline-staging",
    SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME: "grainline_staging",
    SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION: "us-east-2.aws",
    SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID: "ep-grainline-production",
    ...overrides,
  };
}

function exactPolicyRows() {
  const ownerPredicate =
    `(("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text)))`;
  return [
    {
      check_expression: null,
      policy_command: "d",
      policy_name: "saved_search_owner_delete",
      policy_permissive: true,
      policy_roles: [DEFAULT_SAVED_SEARCH_RUNTIME_ROLE],
      rls_enabled: true,
      rls_forced: true,
      using_expression: ownerPredicate,
    },
    {
      check_expression: ownerPredicate,
      policy_command: "a",
      policy_name: "saved_search_owner_insert",
      policy_permissive: true,
      policy_roles: [DEFAULT_SAVED_SEARCH_RUNTIME_ROLE],
      rls_enabled: true,
      rls_forced: true,
      using_expression: null,
    },
    {
      check_expression: null,
      policy_command: "r",
      policy_name: "saved_search_owner_select",
      policy_permissive: true,
      policy_roles: [DEFAULT_SAVED_SEARCH_RUNTIME_ROLE],
      rls_enabled: true,
      rls_forced: true,
      using_expression: ownerPredicate,
    },
  ];
}

function exactCatalogState() {
  return {
    membershipRows: [],
    ownerIdentityRows: [{
      current_user_name: "grainline_migration_owner",
      database_name: "grainline_staging",
      session_user_name: "grainline_migration_owner",
    }],
    ownerRpcRows: [
      {
        function_config: ["search_path=pg_catalog"],
        function_name: "grainline_saved_search_delete_one",
        function_source: ownerRpcBody("grainline_saved_search_delete_one"),
        identity_arguments: "p_user_id text, p_search_id text",
        other_role_grant_option_privileges: [],
        other_role_privileges: [],
        owner_name: "grainline_migration_owner",
        leakproof: false,
        parallel_safety: "u",
        function_kind: "f",
        language_name: "plpgsql",
        public_grant_option_privileges: [],
        public_privileges: [],
        return_contract_valid: true,
        runtime_grant_option_privileges: [],
        runtime_privileges: ["EXECUTE"],
        security_definer: false,
        volatility: "v",
      },
      {
        function_config: ["search_path=pg_catalog"],
        function_name: "grainline_saved_search_list",
        function_source: ownerRpcBody("grainline_saved_search_list"),
        identity_arguments: "p_user_id text, p_take integer, p_search_id text",
        other_role_grant_option_privileges: [],
        other_role_privileges: [],
        owner_name: "grainline_migration_owner",
        leakproof: false,
        parallel_safety: "u",
        function_kind: "f",
        language_name: "plpgsql",
        public_grant_option_privileges: [],
        public_privileges: [],
        return_contract_valid: true,
        runtime_grant_option_privileges: [],
        runtime_privileges: ["EXECUTE"],
        security_definer: false,
        volatility: "v",
      },
    ],
    policyRows: exactPolicyRows(),
    privilegeRows: [{
      delete_priv: true,
      insert_priv: true,
      public_column_grant_option_privileges: [],
      public_column_privileges: [],
      public_grant_option_privileges: [],
      public_privileges: [],
      runtime_column_grant_option_privileges: [],
      runtime_column_privileges: [],
      runtime_grant_option_privileges: [],
      runtime_privileges: ["DELETE", "INSERT", "SELECT"],
      schema_usage: true,
      select_priv: true,
      update_priv: false,
    }],
    runtimeIdentityRows: [{
      current_user_name: DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
      database_name: "grainline_staging",
      session_user_name: DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
    }],
    runtimeRoleRows: [{
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolname: DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
      rolreplication: false,
      rolsuper: false,
    }],
    tableRows: [{ owner_name: "grainline_migration_owner" }],
  };
}

describe("SavedSearch RLS acceptance gate", () => {
  it("requires explicit staging confirmation and isolated runtime/owner Neon URLs", () => {
    assert.throws(
      () => parseGateConfig({}),
      /SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ SAVED_SEARCH_RLS_GATE_CONFIRM: "production" })),
      /staging-only is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ SAVED_SEARCH_RLS_GATE_DATABASE_URL: "" })),
      /SAVED_SEARCH_RLS_GATE_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_DATABASE_URL:
          `${RUNTIME_URL}&options=-c%20app%252Euser_id%253Dpreseeded`,
      })),
      /must not pre-seed app\.user_id through URL query parameters or options/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_DATABASE_URL: `${RUNTIME_URL}&app%2Euser_id=preseeded`,
      })),
      /must not pre-seed app\.user_id through URL query parameters or options/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL: "" })),
      /SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH: "" })),
      /SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID: "",
      })),
      /SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID: "production",
      })),
      /must be a bounded Neon endpoint id/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID: "ep-grainline-staging",
      })),
      /staging endpoint must differ from the independently supplied production endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID: "ep-other",
      })),
      /endpoint id does not match the reviewed staging endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME: "other_db",
      })),
      /database name does not match the reviewed staging database/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION: "westus3.azure",
      })),
      /region does not match the reviewed staging database region/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_DATABASE_URL:
          "postgresql://grainline_app_runtime:secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
      })),
      /must use the pooled Neon runtime endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
          "postgresql://grainline_migration_owner:secret@ep-grainline-staging-pooler.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
      })),
      /must use the direct non-pooler Neon endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_DATABASE_URL:
          "postgresql://wrong_runtime:secret@ep-grainline-staging-pooler.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
      })),
      /runtime URL username must exactly match/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
          "postgresql://grainline_app_runtime:secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
      })),
      /must use different database usernames/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
          "postgresql://grainline_migration_owner:secret@ep-other.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
      })),
      /endpoint id does not match the reviewed staging endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
          "postgresql://grainline_migration_owner:secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/other_db?sslmode=verify-full",
      })),
      /database name does not match the reviewed staging database/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_DATABASE_URL:
          "postgresql://grainline_app_runtime:secret@db.example.invalid:5432/grainline_staging?sslmode=verify-full",
      })),
      /must identify a Neon endpoint/,
    );

    const config = parseGateConfig(baseEnv());
    assert.equal(config.databaseUrl, RUNTIME_URL);
    assert.equal(config.adminDatabaseUrl, OWNER_URL);
    assert.equal(config.runtimeRole, DEFAULT_SAVED_SEARCH_RUNTIME_ROLE);
    assert.equal(config.adminUsername, "grainline_migration_owner");
    assert.equal(config.databaseName, "grainline_staging");
    assert.equal(config.expectedDatabaseEndpointId, "ep-grainline-staging");
    assert.equal(config.expectedDatabaseRegion, "us-east-2.aws");
    assert.equal(config.normalizedEndpoint, "ep-grainline-staging.us-east-2.aws.neon.tech");
    assert.equal(config.productionDatabaseEndpointId, "ep-grainline-production");
    assert.equal(config.evidencePath, "/private/tmp/saved-search-rls-test.json");
    assert.equal(config.allowNoEvidenceForDevelopment, false);
    assert.equal(config.acceptanceEligible, true);
    assert.equal(config.runtimeTransport, "pooled");
  });

  it("allows evidence omission only behind the explicit development override", () => {
    const config = parseGateConfig(baseEnv({
      SAVED_SEARCH_RLS_GATE_ALLOW_NO_EVIDENCE_FOR_DEVELOPMENT: "1",
      SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH: "",
    }));

    assert.equal(config.allowNoEvidenceForDevelopment, true);
    assert.equal(config.acceptanceEligible, false);
    assert.equal(config.evidencePath, undefined);
  });

  it("allows a direct runtime Neon URL only behind the explicit development override", () => {
    const directRuntimeUrl =
      "postgresql://grainline_app_runtime:runtime-secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full";
    const config = parseGateConfig(baseEnv({
      SAVED_SEARCH_RLS_GATE_ALLOW_NON_POOLER: "1",
      SAVED_SEARCH_RLS_GATE_DATABASE_URL: directRuntimeUrl,
    }));

    assert.equal(config.allowNonPooler, true);
    assert.equal(config.acceptanceEligible, false);
    assert.equal(config.databaseUrl, directRuntimeUrl);
    assert.equal(config.runtimeTransport, "direct-development-only");
  });

  it("parses normalized Neon endpoint identity without returning credentials", () => {
    assert.deepEqual(parseNeonDatabaseIdentity(RUNTIME_URL, "runtime URL"), {
      databaseName: "grainline_staging",
      endpointId: "ep-grainline-staging",
      hostname: "ep-grainline-staging-pooler.us-east-2.aws.neon.tech",
      isPooler: true,
      normalizedEndpoint: "ep-grainline-staging.us-east-2.aws.neon.tech",
      region: "us-east-2.aws",
      username: DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
    });
  });

  it("rejects nondeterministic PostgreSQL URLs and ambient client overrides", () => {
    const invalidRuntimeUrls = [
      [` ${RUNTIME_URL}`, /without surrounding whitespace/],
      [`${RUNTIME_URL} `, /without surrounding whitespace/],
      [RUNTIME_URL.replace(":runtime-secret@", "@"), /explicit database host, username, and password/],
      [RUNTIME_URL.replace(":5432", ""), /must use explicit port 5432/],
      [RUNTIME_URL.replace("sslmode=verify-full", "sslmode=require"), /must use sslmode=verify-full/],
      [RUNTIME_URL.replace("sslmode=verify-full", "sslmode=VERIFY-FULL"), /must use sslmode=verify-full/],
      [RUNTIME_URL.replace("sslmode=verify-full", "SSLMODE=verify-full"), /case-variant connection parameters/],
      [`${RUNTIME_URL}&sslmode=verify-full`, /duplicate or case-variant connection parameters/],
      [RUNTIME_URL.replace("channel_binding=require", "channel_binding=prefer"), /channel_binding must be absent or require/],
      [`${RUNTIME_URL}&target_session_attrs=read-write`, /only reviewed sslmode and channel_binding/],
      [`${RUNTIME_URL}#ignored`, /must not contain a URL fragment/],
      [RUNTIME_URL.replace("/grainline_staging?", "/grainline_staging/?"), /one unencoded, bounded database path segment/],
      [RUNTIME_URL.replace("/grainline_staging?", "/grainline_staging/other?"), /one unencoded, bounded database path segment/],
      [RUNTIME_URL.replace("/grainline_staging?", "/grainline_staging%2Fother?"), /one unencoded, bounded database path segment/],
    ];

    for (const [databaseUrl, expected] of invalidRuntimeUrls) {
      assert.throws(
        () => parseGateConfig(baseEnv({ SAVED_SEARCH_RLS_GATE_DATABASE_URL: databaseUrl })),
        expected,
      );
    }
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
          OWNER_URL.replace(":owner-secret@", "@"),
      })),
      /explicit database host, username, and password/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL: `${OWNER_URL} `,
      })),
      /without surrounding whitespace/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL: OWNER_URL.replace(":5432", ""),
      })),
      /must use explicit port 5432/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })),
      /must not disable TLS certificate verification/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ PGOPTIONS: "-c statement_timeout=0" })),
      /must not inherit session settings through PGOPTIONS/,
    );

    const withoutChannelBinding = parseGateConfig(baseEnv({
      SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL:
        OWNER_URL.replace("&channel_binding=require", ""),
      SAVED_SEARCH_RLS_GATE_DATABASE_URL:
        RUNTIME_URL.replace("&channel_binding=require", ""),
    }));
    assert.equal(withoutChannelBinding.acceptanceEligible, true);
  });

  it("passes reviewed channel-binding options through the sole pg Client factory", () => {
    const script = source();
    assert.equal(script.match(/new Client\(/g)?.length, 1);
    assert.match(
      script,
      /\.\.\.postgresChannelBindingClientOptions\(parsed\)/,
    );
  });

  it("rejects a fresh cleanup connection that reaches the wrong live database", async () => {
    const client = {
      async query() {
        return {
          rows: [{
            current_user_name: "grainline_migration_owner",
            database_name: "unexpected_database",
            session_user_name: "grainline_migration_owner",
          }],
        };
      },
    };
    await assert.rejects(
      assertLiveCleanupConnectionIdentity(
        client,
        "grainline_migration_owner",
        "grainline_staging",
        "owner cleanup",
      ),
      (error) => {
        assert.match(error.message, /connection does not match the reviewed role and database/);
        assert.doesNotMatch(error.message, /unexpected_database|grainline_staging/);
        return true;
      },
    );
  });

  it("builds only bounded collision-resistant synthetic fixture identifiers", () => {
    const fixture = buildFixtureIds("0123456789abcdef");

    assert.equal(validateFixture(fixture), fixture);
    assert.equal(fixture.allSearchIds.length, 6);
    assert.equal(new Set(fixture.allSearchIds).size, fixture.allSearchIds.length);
    assert.equal(new Set(fixture.allUserIds).size, fixture.allUserIds.length);
    for (const id of [...fixture.allSearchIds, ...fixture.allUserIds, fixture.wrongUserId]) {
      assert.match(id, /^rls-saved-search-[a-z0-9-]+$/);
      assert.ok(id.length <= 96);
    }
    assert.match(fixture.userA.clerkId, /^rls-saved-search-/);
    assert.match(fixture.userA.email, /^rls-saved-search-.*@example\.invalid$/);
    assert.equal(Object.isFrozen(fixture.projectionCanaryA), true);
    assert.equal(Object.isFrozen(fixture.projectionCanaryA.tags), true);
    assert.throws(() => buildFixtureIds("too-short"), /12 to 24 lowercase hexadecimal/);
    assert.throws(
      () => validateFixture({ ...fixture, allUserIds: ["real-user-id", fixture.userB.id] }),
      /allUserIds must exactly match/,
    );
    assert.throws(
      () => validateFixture({
        ...fixture,
        projectionCanaryA: {
          ...fixture.projectionCanaryA,
          maxPrice: fixture.projectionCanaryA.minPrice,
        },
      }),
      /integer sentinels must be bounded and pairwise distinct/,
    );
    assert.throws(
      () => validateFixture({
        ...fixture,
        projectionCanaryA: {
          ...fixture.projectionCanaryA,
          lng: fixture.projectionCanaryA.lat,
        },
      }),
      /latitude and longitude must be bounded distinct numbers/,
    );
  });

  it("checks every named owner-RPC projection field with non-vacuous canary values", () => {
    const fixture = buildFixtureIds("0123456789abcdef");
    const row = exactProjectionCanaryRow(fixture);

    assert.doesNotThrow(() => {
      assertOwnerRpcProjectionCanary([row], fixture, "projection test");
    });

    const mutations = [
      { id: fixture.seedSearchBId },
      { userId: fixture.userB.id },
      { query: row.sort },
      { category: "KITCHEN" },
      { minPrice: row.maxPrice },
      { maxPrice: row.minPrice },
      { tags: [...row.tags].reverse() },
      { notifyEmail: true },
      { createdAt: "not-a-timestamp" },
      { listingType: "MADE_TO_ORDER" },
      { shipsWithinDays: row.minRating },
      { minRating: row.radiusMiles },
      { lat: row.lng },
      { lng: row.lat },
      { radiusMiles: row.shipsWithinDays },
      { sort: row.query },
    ];
    for (const mutation of mutations) {
      assert.throws(
        () => assertOwnerRpcProjectionCanary(
          [{ ...row, ...mutation }],
          fixture,
          "projection test",
        ),
        /did not match the reviewed projection canary/,
      );
    }
  });

  it("accepts only the exact permissive SELECT, INSERT, and DELETE owner policies", () => {
    assert.equal(
      normalizeRlsPolicyExpression(
        `(("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text)))`,
      ),
      `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
    );
    assert.deepEqual(collectSavedSearchPolicyIssues(exactPolicyRows()), []);

    const drifted = exactPolicyRows();
    drifted[0] = {
      ...drifted[0],
      policy_roles: [DEFAULT_SAVED_SEARCH_RUNTIME_ROLE, "PUBLIC"],
      using_expression: "true",
    };
    drifted[1] = {
      ...drifted[1],
      check_expression: `"userId" = current_setting('app.user_id', true)`,
      policy_command: "w",
    };
    drifted[2] = { ...drifted[2], policy_permissive: false };
    drifted.push({
      ...drifted[2],
      policy_name: "saved_search_public_select",
      policy_roles: ["PUBLIC"],
      using_expression: "true",
    });
    const issues = collectSavedSearchPolicyIssues(drifted).join("\n");

    assert.match(issues, /unexpected policy saved_search_public_select/);
    assert.match(issues, /saved_search_owner_delete has roles/);
    assert.match(issues, /saved_search_owner_delete has an unexpected USING expression/);
    assert.match(issues, /saved_search_owner_insert has command w, expected a/);
    assert.match(issues, /saved_search_owner_insert has an unexpected WITH CHECK expression/);
    assert.match(issues, /saved_search_owner_select must be PERMISSIVE/);
  });

  it("rejects unsafe runtime role, ownership, membership, and RLS catalog state", () => {
    const config = parseGateConfig(baseEnv());
    assert.deepEqual(collectSavedSearchCatalogIssues(exactCatalogState(), config), []);

    const publicCrudMask = exactCatalogState();
    publicCrudMask.privilegeRows[0].runtime_privileges = [];
    publicCrudMask.privilegeRows[0].public_privileges = [
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ];
    const publicCrudIssues = collectSavedSearchCatalogIssues(publicCrudMask, config).join("\n");
    assert.match(
      publicCrudIssues,
      /runtime role is missing direct table privileges: SELECT, INSERT, DELETE/,
    );
    assert.match(
      publicCrudIssues,
      /grants table privileges to PUBLIC: DELETE, INSERT, SELECT, UPDATE/,
    );

    const unsafe = exactCatalogState();
    unsafe.runtimeIdentityRows[0].current_user_name = "unexpected_role";
    unsafe.runtimeIdentityRows[0].session_user_name = "unexpected_role";
    unsafe.runtimeRoleRows[0].rolsuper = true;
    unsafe.runtimeRoleRows[0].rolbypassrls = true;
    unsafe.runtimeRoleRows[0].rolcreatedb = true;
    unsafe.runtimeRoleRows[0].rolcreaterole = true;
    unsafe.runtimeRoleRows[0].rolreplication = true;
    unsafe.runtimeRoleRows[0].rolcanlogin = false;
    unsafe.runtimeRoleRows[0].rolinherit = true;
    unsafe.membershipRows.push({ role_name: "inherited_power" });
    unsafe.privilegeRows[0].update_priv = true;
    unsafe.privilegeRows[0].runtime_privileges.push("UPDATE", "TRUNCATE");
    unsafe.privilegeRows[0].runtime_grant_option_privileges.push("DELETE");
    unsafe.privilegeRows[0].public_privileges.push("SELECT");
    unsafe.privilegeRows[0].public_grant_option_privileges.push("SELECT");
    unsafe.privilegeRows[0].runtime_column_privileges.push("userId:REFERENCES");
    unsafe.privilegeRows[0].runtime_column_grant_option_privileges.push("userId:REFERENCES");
    unsafe.privilegeRows[0].public_column_privileges.push("userId:REFERENCES");
    unsafe.privilegeRows[0].public_column_grant_option_privileges.push("userId:REFERENCES");
    unsafe.tableRows[0].owner_name = DEFAULT_SAVED_SEARCH_RUNTIME_ROLE;
    unsafe.ownerRpcRows[0].public_privileges = ["EXECUTE"];
    unsafe.ownerRpcRows[1].security_definer = true;
    unsafe.policyRows = unsafe.policyRows.slice(1).map((row) => ({
      ...row,
      rls_enabled: false,
      rls_forced: false,
    }));
    const issues = collectSavedSearchCatalogIssues(unsafe, config).join("\n");

    assert.match(issues, /current_user does not match/);
    assert.match(issues, /session_user does not match/);
    assert.match(issues, /is SUPERUSER/);
    assert.match(issues, /has BYPASSRLS/);
    assert.match(issues, /has CREATEDB/);
    assert.match(issues, /has CREATEROLE/);
    assert.match(issues, /has REPLICATION/);
    assert.match(issues, /must have LOGIN/);
    assert.match(issues, /must have NOINHERIT/);
    assert.match(issues, /must be membership-free/);
    assert.match(issues, /must not have UPDATE on public\."SavedSearch" during phase A/);
    assert.match(issues, /public\."SavedSearch" runtime role has unexpected table privileges: TRUNCATE, UPDATE/);
    assert.match(issues, /public\."SavedSearch" runtime role has grant options: DELETE/);
    assert.match(issues, /public\."SavedSearch" grants table privileges to PUBLIC: SELECT/);
    assert.match(issues, /public\."SavedSearch" grants table privileges with grant option to PUBLIC: SELECT/);
    assert.match(issues, /public\."SavedSearch" runtime role has column privileges: userId:REFERENCES/);
    assert.match(issues, /public\."SavedSearch" runtime role has column grant options: userId:REFERENCES/);
    assert.match(issues, /public\."SavedSearch" PUBLIC has column privileges: userId:REFERENCES/);
    assert.match(issues, /public\."SavedSearch" PUBLIC has column grant options: userId:REFERENCES/);
    assert.match(issues, /must not own public\."SavedSearch"/);
    assert.match(issues, /owner must match the direct owner URL username/);
    assert.match(issues, /must revoke all privileges from PUBLIC/);
    assert.match(issues, /must be SECURITY INVOKER/);
    assert.match(issues, /must have ROW LEVEL SECURITY enabled/);
    assert.match(issues, /must have FORCE ROW LEVEL SECURITY enabled/);
    assert.match(issues, /missing policy saved_search_owner_delete/);
  });

  it("emits credential-free evidence and enforces mode 0600", () => {
    const directory = mkdtempSync(join(tmpdir(), "saved-search-rls-gate-"));
    const evidencePath = join(directory, "evidence.json");
    try {
      writeFileSync(evidencePath, "old", { mode: 0o644 });
      const config = parseGateConfig(baseEnv({
        SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH: evidencePath,
      }));
      const payload = buildEvidencePayload(
        config,
        {
          checks: [{
            name: "fixture rls-saved-search-0123456789abcdef-user-a",
            status: "failed",
            summary: "query payload: buyer@example.invalid",
          }],
          cleanupVerified: true,
          issues: [
            `connection postgresql://owner:owner-secret@ep-secret.neon.tech/db failed`,
            "SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL=postgresql://owner:secret@ep-secret.neon.tech/db",
            "password=even-more-secret",
          ],
        },
        {
          finishedAt: "2026-07-16T18:00:01.000Z",
          startedAt: "2026-07-16T18:00:00.000Z",
          status: "failed",
        },
      );

      writeEvidencePayload(evidencePath, payload);
      const serialized = readFileSync(evidencePath, "utf8");
      assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
      assert.equal(payload.target.runtimeRole, DEFAULT_SAVED_SEARCH_RUNTIME_ROLE);
      assert.equal(payload.run.acceptanceEligible, true);
      assert.equal(payload.target.runtimeTransport, "pooled");
      assert.equal(payload.target.forceRlsExpected, true);
      assert.equal(payload.target.schema, "public");
      assert.equal(payload.target.table, "SavedSearch");
      assert.equal(payload.result.cleanupVerified, true);
      assert.match(serialized, /\[redacted-postgres-url\]/);
      assert.match(serialized, /\[redacted-database-url\]/);
      assert.match(serialized, /\[redacted-password\]/);
      assert.match(serialized, /\[redacted-query-payload\]/);
      assert.match(serialized, /\[redacted-fixture-id\]/);
      assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
      assert.doesNotMatch(serialized, /owner-secret|even-more-secret|buyer@example\.invalid/);
      assert.doesNotMatch(serialized, /SAVED_SEARCH_RLS_GATE_(?:DATABASE_URL|ADMIN_DATABASE_URL)/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("cannot label a development transport as passing acceptance evidence", () => {
    const config = parseGateConfig(baseEnv({
      SAVED_SEARCH_RLS_GATE_ALLOW_NON_POOLER: "1",
      SAVED_SEARCH_RLS_GATE_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime-secret@ep-grainline-staging.us-east-2.aws.neon.tech:5432/grainline_staging?sslmode=verify-full",
    }));
    const payload = buildEvidencePayload(
      config,
      { checks: [], cleanupVerified: true, issues: [] },
      {
        finishedAt: "2026-07-16T18:00:01.000Z",
        startedAt: "2026-07-16T18:00:00.000Z",
        status: "passed",
      },
    );

    assert.equal(payload.run.acceptanceEligible, false);
    assert.equal(payload.run.status, "development_only_passed");
    assert.equal(payload.target.runtimeTransport, "direct-development-only");
  });

  it("keeps evidence redaction pure and bounded", () => {
    const redacted = redactEvidenceText(
      "query payload: rls-saved-search-0123456789abcdef-user-a buyer@example.invalid",
    );
    assert.equal(redacted, "[redacted-query-payload]");
  });

  it("contains the complete bounded fixture behavior and unconditional cleanup orchestration", () => {
    const script = source();
    const audit = source("scripts/audit-runtime-db-grants.mjs");
    const mode = statSync(SCRIPT_PATH).mode;
    const ownerFixtureSection = script.slice(
      script.indexOf("async function assertNoUserFixtureCollision"),
      script.indexOf("async function readRuntimeContext"),
    );
    const ownerCleanupSection = script.slice(
      script.indexOf("async function cleanupUsersOnClient"),
      script.indexOf("async function cleanupUsers("),
    );
    const runtimeCleanupSection = script.slice(
      script.indexOf("async function cleanupSavedSearchesOnClient"),
      script.indexOf("async function cleanupSavedSearches("),
    );
    const orchestration = script.slice(
      script.indexOf("export async function runSavedSearchRlsAcceptanceGate"),
      script.indexOf("export function redactEvidenceText"),
    );
    const runtimeConnectIndex = orchestration.indexOf("await runtimeClient.connect()");
    const initialContextPreflightIndex = orchestration.indexOf(
      '"runtime connection initial app.user_id preflight"',
    );
    const initialContextGuardIndex = orchestration.indexOf("if (initialContextClean)");
    const catalogReadIndex = orchestration.indexOf("await readCatalogState(");
    const ownerSeedIndex = orchestration.indexOf("await seedOwnerUsers(");
    const runtimeCleanupIndex = script.lastIndexOf("runtime A/B SavedSearch cleanup zero verification");
    const ownerCleanupIndex = script.lastIndexOf("owner User cleanup zero verification");
    const finalVerificationIndex = script.lastIndexOf("post-user-delete SavedSearch zero verification");

    assert.match(script, /^#!\/usr\/bin\/env node/);
    assert.ok((mode & 0o111) !== 0, "acceptance gate must be executable");
    assert.equal(typeof main, "function");
    assert.match(script, /public\."SavedSearch"/);
    assert.match(script, /public\."User"/);
    assert.match(script, /set_config\('app\.user_id', \$1, true\)/);
    assert.match(script, /current_setting\('app\.user_id', true\)/);
    assert.match(script, /runtime connection starts with app\.user_id already set/);
    assert.match(script, /rolsuper/);
    assert.match(script, /rolbypassrls/);
    assert.match(script, /rolcreatedb/);
    assert.match(script, /rolcreaterole/);
    assert.match(script, /rolreplication/);
    assert.match(script, /rolcanlogin/);
    assert.match(script, /rolinherit/);
    assert.match(script, /pg_auth_members/);
    assert.match(script, /readSavedSearchPolicyState as readAuditedSavedSearchPolicyState/);
    assert.match(audit, /pg_get_expr\(p\.polqual, p\.polrelid\)/);
    assert.match(audit, /pg_get_expr\(p\.polwithcheck, p\.polrelid\)/);
    assert.match(audit, /pg_get_userbyid\(policy_role\.role_oid\)::text/);
    assert.doesNotMatch(ownerFixtureSection, /public\."SavedSearch"/);
    assert.ok(
      ownerCleanupSection.indexOf("assertLiveCleanupConnectionIdentity(")
        < ownerCleanupSection.indexOf("DELETE FROM public.\"User\""),
      "owner cleanup must pin the fresh live role and database before DML",
    );
    assert.ok(
      runtimeCleanupSection.indexOf("assertLiveCleanupConnectionIdentity(")
        < runtimeCleanupSection.indexOf("DELETE FROM public.\"SavedSearch\""),
      "runtime cleanup must pin the fresh live role and database before DML",
    );
    assert.ok(
      runtimeConnectIndex >= 0
      && runtimeConnectIndex < initialContextPreflightIndex
      && initialContextPreflightIndex < initialContextGuardIndex
      && initialContextGuardIndex < catalogReadIndex
      && catalogReadIndex < ownerSeedIndex,
      "the initial runtime-context preflight must guard catalog inspection and all fixture mutation",
    );
    assert.match(script, /runtime A\/B SavedSearch seed transaction/);
    assert.match(script, /SavedSearch list RPC returns only owner rows and resets statement context/);
    assert.match(script, /SavedSearch list RPC supports canary-filtered owner reads/);
    assert.match(script, /assertOwnerRpcProjectionCanary\(\s*canaryRows,\s*fixture,/);
    assert.match(script, /"minPrice"[\s\S]*"maxPrice"[\s\S]*"shipsWithinDays"[\s\S]*"minRating"/);
    assert.match(script, /SavedSearch list RPC rejects missing user context arguments/);
    assert.match(script, /SavedSearch RPC rejects switching a nonempty user context/);
    assert.match(script, /SavedSearch delete RPC affects zero foreign rows and preserves them/);
    assert.match(script, /SavedSearch delete RPC removes one owner row and resets statement context/);
    assert.match(script, /public\.grainline_saved_search_list\(\$1::text, \$2::integer, \$3::text\)/);
    assert.match(script, /public\.grainline_saved_search_delete_one\(\$1::text, \$2::text\)/);
    assert.match(script, /foreign delete affects zero rows and preserves the row/);
    assert.match(script, /foreign delete user B preservation/);
    assert.match(script, /update is denied or affects zero rows and leaves data unchanged/);
    assert.match(script, /update user A unchanged verification/);
    assert.match(script, /finally \{/);
    assert.ok(
      runtimeCleanupIndex >= 0
      && runtimeCleanupIndex < ownerCleanupIndex
      && ownerCleanupIndex < finalVerificationIndex,
    );
    assert.match(script, /verifySavedSearchCleanupOnClient/);
    assert.match(script, /owner User cleanup zero verification/);
    assert.match(script, /post-user-delete SavedSearch zero verification/);
    assert.doesNotMatch(script, /if \(searchesCleaned\)/);
    assert.match(script, /chmodSync\(evidencePath, 0o600\)/);
    assert.doesNotMatch(script, /CREATE\s+POLICY/i);
    assert.doesNotMatch(script, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(script, /process\.env\.DIRECT_URL/);
  });
});
