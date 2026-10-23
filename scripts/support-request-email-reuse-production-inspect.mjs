#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { assertReviewedPeerMigrationLedger } from "./order-refund-immutable-event-production-ledger.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION =
  "20261023050000_correct_support_request_email_reuse_privacy";
export const MIGRATION_SHA256 =
  "9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1";
export const REQUIRED_PREDECESSORS = Object.freeze(
  new Map([
    [
      "20261023030000_correct_user_unsubscribe_optional_email_preferences",
      "996378ebae18adffe66dedab3ca9f02f80b0a1907eee162db1f9692d040d65c7",
    ],
    [
      "20261023040000_repair_resend_failed_event_suppressions",
      "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8",
    ],
  ]),
);
export const HELPER_SOURCE_MD5 = "d72916d00bab1c26e1bc689f3d15722c";
export const PREDECESSOR_SOURCE_MD5 = Object.freeze(
  new Map([
    [
      "public.grainline_support_request_owner_export()",
      "17358846ac44086be6591a74a402328c",
    ],
    [
      "public.grainline_support_request_account_deletion_redact_batch(text[],text[])",
      "c8ba331b2b2acaef8074b1b379c07dc1",
    ],
  ]),
);
export const CORRECTED_SOURCE_MD5 = Object.freeze(
  new Map([
    [
      "public.grainline_support_request_owner_export()",
      "0181f0e21eea256d9adcb3d426354dec",
    ],
    [
      "public.grainline_support_request_account_deletion_redact_batch(text[],text[])",
      "60b1f3e40e9e396231d3786bb0a79900",
    ],
  ]),
);
export const HELPER_IDENTITY =
  "public.grainline_user_email_fallback_addresses()";
export const UNCHANGED_SUPPORT_REQUEST_FUNCTIONS = Object.freeze(
  new Map([
    [
      "public.grainline_support_request_submit(text,text,text,text,text,text,text)",
      Object.freeze({
        language: "plpgsql",
        volatility: "v",
        sourceMd5: "9f8037a3c78d5696fa88cc65e8ea6ea9",
      }),
    ],
    [
      "public.grainline_support_request_delivery_record(text,uuid,boolean,text)",
      Object.freeze({
        language: "plpgsql",
        volatility: "v",
        sourceMd5: "8df5419afc017a55e5192c5eda1eb7ce",
      }),
    ],
    [
      "public.grainline_support_request_staff_state(integer,integer,integer)",
      Object.freeze({
        language: "plpgsql",
        volatility: "s",
        sourceMd5: "9ddd34e83db346231eca688557b2616d",
      }),
    ],
    [
      "public.grainline_support_request_staff_transition(text,text,text)",
      Object.freeze({
        language: "plpgsql",
        volatility: "v",
        sourceMd5: "2db010ae88a75ccdd31ffe3fb3442828",
      }),
    ],
    [
      "public.grainline_support_request_provider_deletion_upsert(text)",
      Object.freeze({
        language: "plpgsql",
        volatility: "v",
        sourceMd5: "2b3bd2105b065a2051fae05fd03ac3fb",
      }),
    ],
    [
      "public.grainline_support_request_overdue_count()",
      Object.freeze({
        language: "sql",
        volatility: "s",
        sourceMd5: "086ff266df2a492650fff8a3eb8fd450",
      }),
    ],
    [
      "public.grainline_support_request_retention_delete_batch(integer)",
      Object.freeze({
        language: "plpgsql",
        volatility: "v",
        sourceMd5: "72c98632508fef0ceb08cba069c7466d",
      }),
    ],
  ]),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationPath(name) {
  return path.join(ROOT, "prisma/migrations", name, "migration.sql");
}

function migrationDirectories() {
  return readdirSync(path.join(ROOT, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function repositoryChecksum(name) {
  return sha256(readFileSync(migrationPath(name)));
}

function immutableRows(rows) {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        ...row,
        function_config: Object.freeze([...(row.function_config ?? [])]),
        nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
      }),
    ),
  );
}

export async function readCorrectionCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner_role.rolsuper AS owner_superuser,
           owner_role.rolbypassrls AS owner_bypass_rls,
           runtime_role.rolsuper AS runtime_superuser,
           runtime_role.rolbypassrls AS runtime_bypass_rls,
           runtime_role.rolinherit AS runtime_inherit,
           staff_role.rolsuper AS staff_superuser,
           staff_role.rolbypassrls AS staff_bypass_rls,
           staff_role.rolinherit AS staff_inherit
      FROM pg_catalog.pg_roles AS owner_role
      JOIN pg_catalog.pg_roles AS runtime_role
        ON runtime_role.rolname = 'grainline_app_runtime'
      JOIN pg_catalog.pg_roles AS staff_role
        ON staff_role.rolname = 'grainline_staff_read_runtime'
     WHERE owner_role.rolname = CURRENT_USER
  `);
  assert.equal(
    identity.rows.length,
    1,
    "database roles are missing or ambiguous",
  );

  const table = await client.query(`
    SELECT pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           owner_role.rolsuper AS owner_superuser,
           owner_role.rolbypassrls AS owner_bypass_rls,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
               ) AS acl
              WHERE acl.grantee <> class.relowner
              ORDER BY 1
           ) AS nonowner_table_acl,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s:%s',
               attribute.attname,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.pg_attribute AS attribute
               CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
              WHERE attribute.attrelid = class.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
                AND acl.grantee <> class.relowner
              ORDER BY 1
           ) AS nonowner_column_acl
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname = 'SupportRequest'
       AND class.relkind = 'r'
  `);
  assert.equal(
    table.rows.length,
    1,
    "SupportRequest table is missing or ambiguous",
  );

  const identities = [
    HELPER_IDENTITY,
    ...UNCHANGED_SUPPORT_REQUEST_FUNCTIONS.keys(),
    ...PREDECESSOR_SOURCE_MD5.keys(),
  ];
  const functions = await client.query(
    `
    WITH requested AS (
      SELECT identity, ordinal,
             pg_catalog.to_regprocedure(identity) AS oid
        FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS item(identity, ordinal)
    )
    SELECT requested.identity,
           pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
           owner_role.rolsuper AS owner_superuser,
           owner_role.rolbypassrls AS owner_bypass_rls,
           language.lanname::text AS language_name,
           procedure.prokind AS function_kind,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
             AS contains_dynamic_execute,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee <> procedure.proowner
              ORDER BY 1
           ) AS nonowner_acl
      FROM requested
      JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = requested.oid
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     ORDER BY requested.ordinal
  `,
    [identities],
  );
  assert.equal(
    functions.rows.length,
    identities.length,
    "reviewed functions are missing",
  );

  const overloads = await client.query(
    `
    SELECT procedure.proname, pg_catalog.count(*)::integer AS overload_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($1::text[])
     GROUP BY procedure.proname
     ORDER BY procedure.proname
  `,
    [
      [
        ...new Set(
          identities.map((identity) =>
            identity.slice("public.".length, identity.indexOf("(")),
          ),
        ),
      ],
    ],
  );

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    table: Object.freeze({
      ...table.rows[0],
      nonowner_table_acl: Object.freeze([
        ...(table.rows[0].nonowner_table_acl ?? []),
      ]),
      nonowner_column_acl: Object.freeze([
        ...(table.rows[0].nonowner_column_acl ?? []),
      ]),
    }),
    functions: immutableRows(functions.rows),
    overloads: Object.freeze(overloads.rows.map((row) => Object.freeze(row))),
  });
}

function verifyFunction(functionRow, expected) {
  assert.equal(functionRow.owner_name, expected.owner);
  assert.equal(
    functionRow.owner_superuser || functionRow.owner_bypass_rls,
    true,
    `${functionRow.identity} owner cannot bypass RLS`,
  );
  assert.equal(functionRow.language_name, expected.language ?? "plpgsql");
  assert.equal(functionRow.function_kind, "f");
  assert.equal(functionRow.security_definer, true);
  assert.equal(functionRow.leakproof, false);
  assert.equal(functionRow.volatility, expected.volatility);
  assert.equal(functionRow.parallel_safety, "u");
  assert.deepEqual(functionRow.function_config, ["search_path=pg_catalog"]);
  assert.equal(functionRow.contains_dynamic_execute, false);
  assert.deepEqual(functionRow.nonowner_acl, [
    "grainline_app_runtime:EXECUTE:false",
  ]);
}

export function verifyCorrectionCatalog(catalog, ledgerState) {
  assert.ok(
    ledgerState === "pending" || ledgerState === "applied",
    "ledger state is invalid",
  );
  assert.deepEqual(catalog.identity, {
    current_user: "neondb_owner",
    session_user: "neondb_owner",
    database_name: "neondb",
    read_only: "on",
    isolation: "repeatable read",
    owner_superuser: false,
    owner_bypass_rls: true,
    runtime_superuser: false,
    runtime_bypass_rls: false,
    runtime_inherit: false,
    staff_superuser: false,
    staff_bypass_rls: false,
    staff_inherit: false,
  });
  assert.deepEqual(catalog.table, {
    owner_name: "neondb_owner",
    owner_superuser: false,
    owner_bypass_rls: true,
    rls_enabled: true,
    rls_forced: false,
    policy_count: 0,
    nonowner_table_acl: [],
    nonowner_column_acl: [],
  });
  assert.deepEqual(
    catalog.overloads,
    [
      {
        proname: "grainline_support_request_account_deletion_redact_batch",
        overload_count: 1,
      },
      { proname: "grainline_support_request_owner_export", overload_count: 1 },
      { proname: "grainline_support_request_overdue_count", overload_count: 1 },
      {
        proname: "grainline_support_request_provider_deletion_upsert",
        overload_count: 1,
      },
      {
        proname: "grainline_support_request_retention_delete_batch",
        overload_count: 1,
      },
      { proname: "grainline_support_request_staff_state", overload_count: 1 },
      {
        proname: "grainline_support_request_staff_transition",
        overload_count: 1,
      },
      { proname: "grainline_support_request_submit", overload_count: 1 },
      {
        proname: "grainline_support_request_delivery_record",
        overload_count: 1,
      },
      { proname: "grainline_user_email_fallback_addresses", overload_count: 1 },
    ].sort((left, right) => left.proname.localeCompare(right.proname)),
  );

  const functions = new Map(
    catalog.functions.map((row) => [row.identity, row]),
  );
  assert.equal(functions.size, 10, "reviewed function identity count drifted");
  const helper = functions.get(HELPER_IDENTITY);
  assert.ok(helper, "email fallback helper is absent");
  verifyFunction(helper, { owner: catalog.table.owner_name, volatility: "s" });
  assert.equal(
    helper.source_md5,
    HELPER_SOURCE_MD5,
    "email fallback helper body drifted",
  );

  for (const [identity, expected] of UNCHANGED_SUPPORT_REQUEST_FUNCTIONS) {
    const row = functions.get(identity);
    assert.ok(row, `${identity} is absent`);
    verifyFunction(row, {
      owner: catalog.table.owner_name,
      language: expected.language,
      volatility: expected.volatility,
    });
    assert.equal(
      row.source_md5,
      expected.sourceMd5,
      `${identity} body drifted`,
    );
  }

  const families = new Set();
  for (const [identity, predecessorMd5] of PREDECESSOR_SOURCE_MD5) {
    const row = functions.get(identity);
    assert.ok(row, `${identity} is absent`);
    verifyFunction(row, {
      owner: catalog.table.owner_name,
      volatility: identity.endsWith("(text[],text[])") ? "v" : "s",
    });
    if (row.source_md5 === predecessorMd5) families.add("predecessor");
    else if (row.source_md5 === CORRECTED_SOURCE_MD5.get(identity))
      families.add("corrected");
    else assert.fail(`${identity} body drifted`);
  }
  assert.equal(families.size, 1, "SupportRequest correction bodies are mixed");
  const sourceFamily = [...families][0];
  if (ledgerState === "applied") {
    assert.equal(
      sourceFamily,
      "corrected",
      "applied ledger has predecessor bodies",
    );
  }

  return Object.freeze({
    ledgerState,
    sourceFamily,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    nonownerTableAclCount: 0,
    nonownerColumnAclCount: 0,
    functionCount: 10,
    containsRowData: false,
    productionChanged: false,
  });
}

async function inspectLedger(client) {
  const directories = migrationDirectories();
  assert.ok(directories.includes(MIGRATION), "candidate migration is missing");
  assert.equal(repositoryChecksum(MIGRATION), MIGRATION_SHA256);
  const names = [...new Set([...directories, ...REQUIRED_PREDECESSORS.keys()])];
  const ledger = await client.query(
    `
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at
  `,
    [names],
  );
  const byName = new Map();
  for (const row of ledger.rows) {
    const rows = byName.get(row.migration_name) ?? [];
    rows.push(row);
    byName.set(row.migration_name, rows);
  }
  for (const peer of directories.filter((name) => name !== MIGRATION)) {
    assertReviewedPeerMigrationLedger({
      migrationName: peer,
      repositoryChecksum: repositoryChecksum(peer),
      rows: byName.get(peer) ?? [],
    });
  }
  for (const [predecessor, checksum] of REQUIRED_PREDECESSORS) {
    if (directories.includes(predecessor)) {
      assert.equal(
        repositoryChecksum(predecessor),
        checksum,
        `${predecessor} bytes drifted`,
      );
    }
    assertReviewedPeerMigrationLedger({
      migrationName: predecessor,
      repositoryChecksum: checksum,
      rows: byName.get(predecessor) ?? [],
    });
  }

  const candidateRows = byName.get(MIGRATION) ?? [];
  const successful = candidateRows.filter(
    (row) =>
      row.finished_at !== null &&
      row.rolled_back_at === null &&
      Number(row.applied_steps_count) === 1,
  );
  assert.ok(successful.length <= 1, "candidate has duplicate successful rows");
  if (successful.length === 1) {
    assert.equal(
      successful[0].checksum,
      MIGRATION_SHA256,
      "candidate checksum drifted",
    );
  }
  const otherRows = candidateRows.filter((row) => row !== successful[0]);
  assert.ok(
    otherRows.every(
      (row) =>
        row.finished_at === null &&
        row.rolled_back_at !== null &&
        Number(row.applied_steps_count) === 0,
    ),
    "candidate has an unresolved or partial failed attempt",
  );
  return successful.length === 1 ? "applied" : "pending";
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is missing");
  assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "inspector must run in GitHub Actions",
  );
  assert.equal(
    process.env.GITHUB_EVENT_NAME,
    "workflow_dispatch",
    "inspector requires a manual workflow dispatch",
  );
  assert.match(
    process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT ?? "",
    /^[0-9a-f]{40}$/u,
    "release commit is invalid",
  );
  assert.equal(
    Object.hasOwn(process.env, "DATABASE_URL"),
    false,
    "DATABASE_URL must remain absent from owner inspection",
  );
  const snapshotPath = path.join(
    process.env.RUNNER_TEMP,
    "support-request-email-reuse-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-support-request-email-reuse-release",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const ledgerState = await inspectLedger(client);
    const catalog = await readCorrectionCatalog(client);
    const result = verifyCorrectionCatalog(catalog, ledgerState);
    if (mode === "preflight") {
      writeFileSync(snapshotPath, JSON.stringify({ ledgerState, result }), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${ledgerState}\n`);
    } else {
      assert.equal(ledgerState, "applied", "C-1150 correction is not applied");
      assert.equal(result.sourceFamily, "corrected");
      const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
      assert.ok(
        before.ledgerState === "pending" || before.ledgerState === "applied",
      );
      assert.ok(
        before.result.sourceFamily === "predecessor" ||
          before.result.sourceFamily === "corrected",
      );
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, "support-request-email-reuse.json"),
        JSON.stringify(
          {
            status: "passed",
            migration: MIGRATION,
            migrationSha256: MIGRATION_SHA256,
            releaseCommit: process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT,
            before: before.result,
            after: result,
            containsRowData: false,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
