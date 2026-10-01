#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_ITEM_DIRECT_FUNCTIONS = Object.freeze([
  "grainline_blocked_checkout_refund_record_core",
  "grainline_case_open",
  "grainline_case_order_active_for_seller",
  "grainline_case_relationship_valid",
  "grainline_case_seller_refund_apply",
  "grainline_case_staff_resolution_finalize",
  "grainline_case_staff_resolution_prepare",
  "grainline_case_stripe_dispute_apply",
  "grainline_listing_order_archive_blocked",
  "grainline_notification_create_core",
  "grainline_order_buyer_detail",
  "grainline_order_buyer_detail_v3",
  "grainline_order_buyer_export_page",
  "grainline_order_public_listing_counts",
  "grainline_order_public_marketplace_listing_metrics",
  "grainline_order_public_seller_stats",
  "grainline_order_review_eligibility_lock",
  "grainline_order_seller_analytics_buckets",
  "grainline_order_seller_analytics_summary",
  "grainline_order_seller_analytics_top_listings",
  "grainline_order_seller_detail",
  "grainline_order_seller_detail_v3",
  "grainline_order_seller_export_page",
  "grainline_order_seller_key_assert",
  "grainline_order_seller_label_preflight",
  "grainline_order_seller_metrics_facts",
  "grainline_order_seller_recent_sales",
  "grainline_order_seller_verification_sales",
  "grainline_order_staff_detail",
  "grainline_order_staff_page",
  "grainline_order_summary_items",
  "grainline_seller_refund_record",
  "grainline_stripe_checkout_order_create",
  "grainline_stripe_checkout_postpayment",
].sort());

export const ORDER_QUOTE_DIRECT_FUNCTIONS = Object.freeze([
  "grainline_order_account_deletion_scrub",
  "grainline_order_buyer_pii_prune_batch",
  "grainline_order_seller_label_claim",
  "grainline_order_seller_label_quote_replace",
].sort());

export const ORDER_ITEM_TRIGGER_FUNCTIONS = Object.freeze([
  "grainline_order_item_seller_key_bind",
  "grainline_order_item_seller_key_complete",
].sort());

export const ORDER_ITEM_TRIGGER_SOURCE_MD5 = Object.freeze({
  grainline_order_item_seller_key_bind: "34c8dab8a6d39ca9951ee049f9f2a7ea",
  grainline_order_item_seller_key_complete: "878a575c4b0a823fa9acf6c379f5199b",
});

const EXPECTED_TABLES = Object.freeze([
  Object.freeze({ table_name: "Order", rls_enabled: true, rls_forced: true }),
  Object.freeze({ table_name: "OrderItem", rls_enabled: false, rls_forced: false }),
  Object.freeze({ table_name: "OrderShippingRateQuote", rls_enabled: false, rls_forced: false }),
]);

export function orderChildExpectedPostureFromEnvironment(environment = process.env) {
  const requiredBoolean = (name) => {
    const value = environment[name];
    assert.ok(value === "true" || value === "false", `${name} must be true or false`);
    return value === "true";
  };
  return Object.freeze({
    orderItemRlsEnabled: requiredBoolean("EXPECTED_ORDER_ITEM_RLS_ENABLED"),
    orderItemRlsForced: requiredBoolean("EXPECTED_ORDER_ITEM_RLS_FORCED"),
    quoteRlsEnabled: requiredBoolean("EXPECTED_ORDER_QUOTE_RLS_ENABLED"),
    quoteRlsForced: requiredBoolean("EXPECTED_ORDER_QUOTE_RLS_FORCED"),
  });
}

const ALLOWED_EXECUTE_ROLES = new Set([
  "grainline_app_runtime",
  "grainline_staff_read_runtime",
]);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readCreatedFunction(sql, match) {
  const argumentsStart = match.index + match[0].length;
  let cursor = argumentsStart;
  let depth = 1;
  let quote = null;
  while (cursor < sql.length && depth > 0) {
    const character = sql[cursor];
    if (quote !== null) {
      if (character === quote && sql[cursor - 1] !== "\\") quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    }
    cursor += 1;
  }
  if (depth !== 0) throw new Error(`unterminated function arguments for ${match[1] ?? match[2]}`);
  const declaration = sql.slice(cursor);
  const bodyOpening = declaration.match(/\bAS\s+(\$[A-Za-z0-9_]*\$)/imu);
  if (!bodyOpening) throw new Error(`function body missing for ${match[1] ?? match[2]}`);
  const bodyStart = cursor + bodyOpening.index + bodyOpening[0].length;
  const bodyEnd = sql.indexOf(bodyOpening[1], bodyStart);
  if (bodyEnd < 0) throw new Error(`unterminated function body for ${match[1] ?? match[2]}`);
  return Object.freeze({
    name: match[1] ?? match[2],
    argumentsSource: sql.slice(argumentsStart, cursor - 1).trim(),
    body: sql.slice(bodyStart, bodyEnd),
    declaration: declaration.slice(0, bodyOpening.index),
    end: bodyEnd + bodyOpening[1].length,
  });
}

function splitArguments(source) {
  const argumentsList = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      argumentsList.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (source.trim() !== "") argumentsList.push(source.slice(start).trim());
  return argumentsList;
}

function identityArguments(source) {
  return splitArguments(source).map((argument) => {
    const withoutMode = argument.replace(/^(?:INOUT|IN|VARIADIC)\s+/iu, "");
    const type = withoutMode.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+/u, "")
      .replace(/\s+(?:DEFAULT|=)[\s\S]*$/iu, "")
      .replace(/timestamp\(\d+\)\s+without\s+time\s+zone/iu, "timestamp without time zone")
      .replace(/\bpublic\./gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (type === "") throw new Error(`could not resolve function argument: ${argument}`);
    return type;
  }).join(",");
}

function functionDeclarationMetadata(declaration) {
  const language = declaration.match(/\bLANGUAGE\s+([A-Za-z_][A-Za-z0-9_]*)/iu)?.[1]
    ?.toLowerCase();
  assert.ok(language, "function language is missing");
  return Object.freeze({
    languageName: language,
    volatility: /\bIMMUTABLE\b/iu.test(declaration)
      ? "i"
      : /\bSTABLE\b/iu.test(declaration) ? "s" : "v",
    parallelSafety: /\bPARALLEL\s+SAFE\b/iu.test(declaration)
      ? "s"
      : /\bPARALLEL\s+RESTRICTED\b/iu.test(declaration) ? "r" : "u",
    securityDefiner: /\bSECURITY\s+DEFINER\b/iu.test(declaration),
    leakproof: /\bLEAKPROOF\b/iu.test(declaration)
      && !/\bNOT\s+LEAKPROOF\b/iu.test(declaration),
  });
}

export function orderChildSourceFunctionCatalog(rootDirectory = process.cwd()) {
  const migrationRoot = path.join(rootDirectory, "prisma/migrations");
  const definitions = new Map();
  const eventPattern = /(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\(|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\()/gimu;
  for (const directory of fs.readdirSync(migrationRoot).sort()) {
    const file = path.join(migrationRoot, directory, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    eventPattern.lastIndex = 0;
    let match;
    while ((match = eventPattern.exec(sql))) {
      if (match[3] !== undefined || match[4] !== undefined) {
        definitions.delete(match[3] ?? match[4]);
        continue;
      }
      const definition = readCreatedFunction(sql, match);
      definitions.set(definition.name, Object.freeze({
        ...definition,
        migration: directory,
      }));
      eventPattern.lastIndex = definition.end;
    }
  }
  return Object.freeze([...definitions.values()].filter((entry) =>
    entry.body.includes('"OrderItem"')
      || entry.body.includes('"OrderShippingRateQuote"')
  ).map((entry) => Object.freeze({
    name: entry.name,
    identity: `${entry.name}(${identityArguments(entry.argumentsSource)})`,
    sourceMd5: createHash("md5").update(entry.body).digest("hex"),
    ...functionDeclarationMetadata(entry.declaration),
    touchesOrderItem: entry.body.includes('"OrderItem"'),
    touchesQuote: entry.body.includes('"OrderShippingRateQuote"'),
  })).sort((left, right) => left.identity.localeCompare(right.identity)));
}

export function orderChildSourceCatalog(rootDirectory = process.cwd()) {
  return Object.freeze(orderChildSourceFunctionCatalog(rootDirectory)
    .map((entry) => entry.name).sort());
}

export async function readOrderChildAuthorityCatalog(client) {
  const identity = await client.query(`
    SELECT
      CURRENT_USER::text AS actor,
      SESSION_USER::text AS login,
      pg_catalog.current_database()::text AS database_name,
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      pg_catalog.current_setting('transaction_read_only') AS read_only,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `);
  const tables = await client.query(`
    SELECT
      class.relname AS table_name,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )) AS nonowner_table_acl_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee <> class.relowner
          AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES'))
        AS nonowner_column_acl_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = ANY($1::text[])
      AND class.relkind = 'r'
    ORDER BY class.relname
  `, [EXPECTED_TABLES.map((entry) => entry.table_name)]);

  const functions = await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      language.lanname AS language_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_safety,
      procedure.proconfig AS function_config,
      pg_catalog.md5(procedure.prosrc) AS source_md5,
      pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
        AS contains_dynamic_execute,
      pg_catalog.strpos(procedure.prosrc, '"OrderItem"') > 0
        AS touches_order_item,
      pg_catalog.strpos(procedure.prosrc, '"OrderShippingRateQuote"') > 0
        AS touches_quote,
      ARRAY(
        SELECT pg_catalog.format(
          '%s:%s:%s',
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
          acl.privilege_type,
          CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
        )
        FROM pg_catalog.aclexplode(
          COALESCE(procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner))
        ) AS acl
        WHERE acl.grantee <> procedure.proowner
        ORDER BY 1
      ) AS nonowner_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND (
        pg_catalog.strpos(procedure.prosrc, '"OrderItem"') > 0
        OR pg_catalog.strpos(
          procedure.prosrc, '"OrderShippingRateQuote"'
        ) > 0
      )
    ORDER BY procedure.proname, identity_arguments
  `);

  const triggers = await client.query(`
    SELECT
      class.relname AS table_name,
      trigger_row.tgname AS trigger_name,
      procedure.proname AS function_name,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      trigger_row.tgenabled AS enabled,
      trigger_row.tgdeferrable AS deferrable,
      trigger_row.tginitdeferred AS initially_deferred,
      language.lanname AS language_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.proconfig AS function_config,
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
          COALESCE(procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner))
        ) AS acl
        WHERE acl.grantee <> procedure.proowner
        ORDER BY 1
      ) AS nonowner_acl
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS class ON class.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE class.oid = ANY(ARRAY[
      'public."OrderItem"'::pg_catalog.regclass,
      'public."OrderShippingRateQuote"'::pg_catalog.regclass
    ])
      AND NOT trigger_row.tgisinternal
    ORDER BY class.relname, trigger_row.tgname
  `);

  const structure = await client.query(`
    SELECT 'constraint'::text AS object_type,
           class.relname AS table_name,
           constraint_row.conname AS object_name,
           constraint_row.convalidated AS valid
      FROM pg_catalog.pg_constraint AS constraint_row
      JOIN pg_catalog.pg_class AS class ON class.oid = constraint_row.conrelid
     WHERE class.oid = ANY(ARRAY[
       'public."OrderItem"'::pg_catalog.regclass,
       'public."OrderShippingRateQuote"'::pg_catalog.regclass
     ])
    UNION ALL
    SELECT 'index', class.relname, index_class.relname,
           index_row.indisvalid AND index_row.indisready AND index_row.indislive
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS class ON class.oid = index_row.indrelid
      JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
     WHERE class.oid = ANY(ARRAY[
       'public."OrderItem"'::pg_catalog.regclass,
       'public."OrderShippingRateQuote"'::pg_catalog.regclass
     ])
    ORDER BY table_name, object_type, object_name
  `);

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: Object.freeze(tables.rows),
    functions: Object.freeze(functions.rows),
    triggers: Object.freeze(triggers.rows),
    structure: Object.freeze(structure.rows),
  });
}

export function verifyOrderChildAuthorityCatalog(
  catalog,
  rootDirectory = process.cwd(),
  expectedPosture = {},
) {
  assert.ok(catalog.identity, "database identity is missing");
  assert.equal(catalog.identity.actor, catalog.identity.login);
  assert.equal(catalog.identity.isolation, "repeatable read");
  assert.equal(catalog.identity.read_only, "on");
  assert.equal(catalog.identity.rolcanlogin, true);
  const productionOwner = catalog.identity.actor === "neondb_owner"
    && catalog.identity.database_name === "neondb"
    && catalog.identity.rolsuper === false
    && catalog.identity.rolbypassrls === true;
  const disposableOwner = catalog.identity.actor === "ci"
    && catalog.identity.database_name === "grainline_ci"
    && catalog.identity.rolsuper === true;
  assert.ok(productionOwner || disposableOwner, "unreviewed database owner boundary");
  const expectedTables = Object.freeze(EXPECTED_TABLES.map((entry) => {
    if (entry.table_name === "OrderItem") {
      return Object.freeze({
        ...entry,
        rls_enabled: expectedPosture.orderItemRlsEnabled ?? entry.rls_enabled,
        rls_forced: expectedPosture.orderItemRlsForced ?? entry.rls_forced,
      });
    }
    if (entry.table_name === "OrderShippingRateQuote") {
      return Object.freeze({
        ...entry,
        rls_enabled: expectedPosture.quoteRlsEnabled ?? entry.rls_enabled,
        rls_forced: expectedPosture.quoteRlsForced ?? entry.rls_forced,
      });
    }
    return entry;
  }));
  assert.equal(catalog.tables.length, expectedTables.length);
  const ownerNames = new Set();
  for (const expected of expectedTables) {
    const actual = catalog.tables.find(
      (entry) => entry.table_name === expected.table_name,
    );
    assert.ok(actual, `missing ${expected.table_name} table`);
    assert.equal(actual.rls_enabled, expected.rls_enabled);
    assert.equal(actual.rls_forced, expected.rls_forced);
    assert.equal(Number(actual.policy_count), 0);
    assert.equal(Number(actual.nonowner_table_acl_count), 0);
    assert.equal(Number(actual.nonowner_column_acl_count), 0);
    ownerNames.add(actual.owner_name);
  }
  assert.equal(ownerNames.size, 1, "Order child table owners drifted");
  const [tableOwner] = ownerNames;

  const sourceCatalog = orderChildSourceFunctionCatalog(rootDirectory);
  const expectedByIdentity = new Map(sourceCatalog.map((entry) => [entry.identity, entry]));
  const actualIdentities = catalog.functions.map((entry) =>
    `${entry.function_name}(${String(entry.identity_arguments).replaceAll(", ", ",")})`
  );
  assert.deepEqual(sorted(actualIdentities), sorted(expectedByIdentity.keys()));
  const orderItemFunctions = sourceCatalog.filter((entry) => entry.touchesOrderItem)
    .map((entry) => entry.name);
  const quoteFunctions = sourceCatalog.filter((entry) => entry.touchesQuote)
    .map((entry) => entry.name);
  assert.deepEqual(sorted(orderItemFunctions), ORDER_ITEM_DIRECT_FUNCTIONS);
  assert.deepEqual(sorted(quoteFunctions), ORDER_QUOTE_DIRECT_FUNCTIONS);
  assert.equal(
    new Set(catalog.functions.map((entry) => entry.function_name)).size,
    catalog.functions.length,
    "reviewed child-table function names gained an overload",
  );

  for (const entry of catalog.functions) {
    const identity = `${entry.function_name}(${String(entry.identity_arguments).replaceAll(", ", ",")})`;
    assert.equal(
      entry.source_md5,
      expectedByIdentity.get(identity)?.sourceMd5,
      `${identity} body drifted`,
    );
    assert.equal(entry.owner_name, tableOwner, `${entry.function_name} owner drifted`);
    const expected = expectedByIdentity.get(identity);
    assert.equal(entry.language_name, expected?.languageName, `${entry.function_name} language drifted`);
    assert.equal(entry.function_kind, "f", `${entry.function_name} kind drifted`);
    assert.equal(entry.volatility, expected?.volatility, `${entry.function_name} volatility drifted`);
    assert.equal(
      entry.parallel_safety,
      expected?.parallelSafety,
      `${entry.function_name} parallel safety drifted`,
    );
    assert.equal(expected?.securityDefiner, true, `${entry.function_name} source is not SECURITY DEFINER`);
    assert.equal(entry.security_definer, true, `${entry.function_name} is not SECURITY DEFINER`);
    assert.equal(expected?.leakproof, false, `${entry.function_name} source became leakproof`);
    assert.equal(entry.leakproof, false, `${entry.function_name} became leakproof`);
    assert.equal(entry.function_config?.length, 1, `${entry.function_name} config drifted`);
    assert.equal(entry.function_config?.[0], "search_path=pg_catalog");
    assert.equal(entry.contains_dynamic_execute, false, `${entry.function_name} contains dynamic EXECUTE`);
    for (const acl of entry.nonowner_acl ?? []) {
      const [role, privilege, grantable] = acl.split(":");
      assert.ok(ALLOWED_EXECUTE_ROLES.has(role), `${entry.function_name} granted to ${role}`);
      assert.equal(privilege, "EXECUTE");
      assert.equal(grantable, "false");
    }
  }

  assert.deepEqual(
    catalog.triggers.map((entry) => entry.function_name).sort(),
    ORDER_ITEM_TRIGGER_FUNCTIONS,
  );
  assert.ok(catalog.triggers.every((entry) => entry.table_name === "OrderItem"));
  for (const entry of catalog.triggers) {
    const isCompletionTrigger = entry.function_name === "grainline_order_item_seller_key_complete";
    assert.equal(entry.trigger_name, entry.function_name);
    assert.equal(entry.owner_name, tableOwner);
    assert.equal(entry.enabled, "O");
    assert.equal(entry.deferrable, isCompletionTrigger);
    assert.equal(entry.initially_deferred, isCompletionTrigger);
    assert.equal(entry.language_name, "plpgsql");
    assert.equal(entry.function_kind, "f");
    assert.equal(entry.security_definer, true);
    assert.equal(entry.leakproof, false);
    assert.deepEqual(entry.function_config, ["search_path=pg_catalog"]);
    assert.equal(entry.source_md5, ORDER_ITEM_TRIGGER_SOURCE_MD5[entry.function_name]);
    assert.equal(entry.contains_dynamic_execute, false);
    assert.deepEqual(entry.nonowner_acl, []);
  }
  assert.ok(catalog.structure.length > 0);

  return Object.freeze({
    databaseMode: productionOwner ? "production-read-only" : "disposable-read-only",
    tableOwner,
    orderItemDirectFunctionCount: ORDER_ITEM_DIRECT_FUNCTIONS.length,
    quoteDirectFunctionCount: ORDER_QUOTE_DIRECT_FUNCTIONS.length,
    orderItemTriggerCount: ORDER_ITEM_TRIGGER_FUNCTIONS.length,
    rowDataRead: false,
    productionChanged: false,
  });
}

async function main() {
  const { default: pg } = await import("pg");
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is required");
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const catalog = await readOrderChildAuthorityCatalog(client);
    const result = verifyOrderChildAuthorityCatalog(
      catalog,
      process.cwd(),
      orderChildExpectedPostureFromEnvironment(),
    );
    process.stdout.write(`${JSON.stringify({ result, catalog })}\n`);
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
