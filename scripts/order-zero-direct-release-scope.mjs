// Dormant release component: no credential loader, connection constructor,
// production entrypoint, migration writer or mutation executor.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createCorrectionReleasePackage, CORRECTION_RELEASE_LEDGER_QUERY } from "./order-correction-release-package.mjs";
import { readOrderPaymentEventForceMigrationCatalog } from "./verify-order-payment-event-force-production-scope.mjs";
import { assertSellerPayoutEventForceReviewedSuccessorScope } from "./verify-seller-payout-event-force-production-scope.mjs";
import { ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS, ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS } from "./stage-order-zero-direct-compatible-prefix.mjs";
import { assertZeroDirectSchema, readZeroDirectSchema } from "./order-zero-direct-release-schema.mjs";
import { assertZeroDirectRoles, readZeroDirectRoles } from "./order-zero-direct-release-roles.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const exact = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const APPLIED = row => row.finished_at !== null && row.rolled_back_at === null
  && [1, "1"].includes(row.applied_steps_count);
const timestamp = value => value instanceof Date ? Number.isFinite(value.getTime())
  : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
const MODES = Object.freeze({
  production: Object.freeze({ owner: "neondb_owner", database: "neondb" }),
  disposable: Object.freeze({ owner: "ci", database: "grainline_ci" }),
});
const PRIVATE = new Set([
  ...ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS.map(([name]) => name),
  "grainline_order_staff_page_v2", "grainline_order_staff_detail_v2",
  "grainline_blocked_checkout_refund_claim", "grainline_blocked_checkout_refund_record_core",
]);

// Deliberately narrow parser for the fixed, hash-attested migration sources,
// not a general SQL parser. Unsupported declarations fail before planning.
function definitions(sql) {
  const result = [];
  const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS([\s\S]*?)\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\4;/gu;
  for (const match of sql.matchAll(pattern)) {
    const args = match[2].trim() ? match[2].trim().split(",").map(arg => {
      const parsed = arg.trim().match(/^(p_[a-z0-9_]+)\s+(text(?:\[\])?|bigint|integer|boolean|jsonb|timestamp(?:\(3\))? without time zone)$/u);
      assert.ok(parsed, "unsupported fixed prefix argument declaration");
      // PostgreSQL does not retain input typmods in a function identity.
      return { name: parsed[1], type: parsed[2].replace("timestamp(3)", "timestamp") };
    }) : [];
    const header = match[3];
    const language = header.match(/\bLANGUAGE (plpgsql|sql)\b/u)?.[1];
    assert.ok(language, "unsupported fixed prefix language");
    const returns = header.split(/\bLANGUAGE\b/u)[0].trim().replace(/\s+/gu, " ").replaceAll("timestamp(3)", "timestamp");
    const table = returns.match(/^TABLE\s*\((.*)\)$/u);
    const outputs = table ? table[1].trim().split(/,\s*/u).map(arg => {
      const output = arg.match(/^([a-z0-9_]+) (text(?:\[\])?|bigint|integer|boolean|jsonb|double precision|timestamp without time zone)$/u);
      assert.ok(output, "unsupported fixed prefix output declaration");
      return { name: output[1], type: output[2] };
    }) : [];
    if (!table) assert.match(returns, /^(boolean|bigint|integer|jsonb|text|trigger)$/u);
    assert.equal([...header.matchAll(/\bSET\s/gu)].length, 1, "unsupported function configuration");
    result.push({ name: match[1], identity: `public.${match[1]}(${args.map(a => a.type).join(",")})`,
      bodySha256: sha256(match[5]), language, securityDefiner: /\bSECURITY DEFINER\b/u.test(header),
      returnType: table ? `TABLE(${outputs.map(o => `${o.name} ${o.type}`).join(", ")})` : returns,
      returnsSet: Boolean(table), argNames: args.length + outputs.length ? [...args, ...outputs].map(a => a.name) : null,
      argModes: table ? [...args.map(() => "i"), ...outputs.map(() => "t")] : null,
      volatility: /\bIMMUTABLE\b/u.test(header) ? "i" : /\bSTABLE\b/u.test(header) ? "s" : "v",
      parallelSafety: /\bPARALLEL SAFE\b/u.test(header) ? "s" : /\bPARALLEL RESTRICTED\b/u.test(header) ? "r" : "u",
      configuration: /\bSET search_path = pg_catalog\b/u.test(header) ? ["search_path=pg_catalog"] : null,
      definition: match[0] });
  }
  return result;
}

export function createOrderZeroDirectReleaseScope() {
  const correction = createCorrectionReleasePackage(); // validates all 251 fixed files and draft bytes
  const full = correction.manifest.predecessor;
  const members = ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.map(({ migration, sha256: checksum }) => ({ migration_name: migration, checksum }));
  const base = full.slice(0, -members.length);
  exact(full.slice(-members.length), members, "fixed prefix is not the exact correction predecessor suffix");
  assert.equal(base.length, 234); assert.equal(members.length, 17);
  const force = readOrderPaymentEventForceMigrationCatalog();
  const sources = full.map(row => readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, "utf8"));
  const memberDefinitions = sources.slice(base.length).map(definitions);
  const targetNames = [...new Set(memberDefinitions.flat().map(def => def.name))].sort();
  assert.equal(targetNames.length, 36, "fixed prefix function inventory drifted");
  const targetSet = new Set(targetNames);
  const state = new Map();
  // Only parse predecessor statements for the actual target names. Other
  // historical functions have declarations outside this component's grammar.
  for (const source of sources.slice(0, base.length)) {
    const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_[A-Za-z0-9_]+)\s*\([\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gu;
    for (const match of source.matchAll(pattern)) if (targetSet.has(match[1])) {
      const parsed = definitions(match[0]);
      assert.equal(parsed.length, 1, "missing fixed predecessor definition");
      state.set(match[1], parsed[0]);
    }
  }
  const states = [[...state.values()]];
  for (const updates of memberDefinitions) {
    for (const def of updates) state.set(def.name, def);
    states.push([...state.values()]);
  }
  const manifest = freeze({ version: 1, component: "order-zero-direct-compatible-release-scope",
    productionExecutionAuthorized: false, base, members, targetNames,
    sourceCatalogSha256: correction.manifest.predecessorCatalogSha256,
    states: states.map(defs => defs.sort((a, b) => a.name.localeCompare(b.name)).map(def => ({
      ...def, runtimeExecute: !PRIVATE.has(def.name), staffExecute: false,
    }))) });

  function classify(rows, stage) {
    assert.ok(["before", "restart", "after"].includes(stage), "unknown compatible prefix stage");
    assert.ok(Array.isArray(rows) && rows.every(row => typeof row?.migration_name === "string"
      && /^[a-f0-9]{64}$/u.test(row.checksum ?? "") && [0, 1, "0", "1"].includes(row.applied_steps_count)
      && (row.finished_at === null || timestamp(row.finished_at))
      && (row.rolled_back_at === null || timestamp(row.rolled_back_at))), "malformed prefix ledger");
    const cutoff = force.at(-1);
    const history = rows.filter(row => row.migration_name <= cutoff.migration_name);
    assertSellerPayoutEventForceReviewedSuccessorScope(history.filter(row => row.migration_name !== cutoff.migration_name),
      "after-order-payment-event-activation", { forceCatalog: force.slice(0, -15), successors: force.slice(-15, -1) });
    const appliedForce = history.filter(row => row.migration_name === cutoff.migration_name);
    assert.ok(appliedForce.length === 1 && APPLIED(appliedForce[0]) && appliedForce[0].checksum === cutoff.checksum,
      "exact FORCE predecessor missing");
    const suffix = rows.filter(row => row.migration_name > cutoff.migration_name);
    const allowed = new Set(full.slice(force.length).map(row => row.migration_name));
    assert.ok(suffix.every(row => allowed.has(row.migration_name)), "unknown or unselected release row");
    for (const expected of base.slice(force.length)) {
      const matches = suffix.filter(row => row.migration_name === expected.migration_name);
      assert.ok(matches.length === 1 && APPLIED(matches[0]) && matches[0].checksum === expected.checksum,
        "complete compatible predecessor required");
    }
    let prefixLength = 0; let absent = false;
    for (const expected of members) {
      const matches = suffix.filter(row => row.migration_name === expected.migration_name);
      if (!matches.length) { absent = true; continue; }
      assert.ok(!absent && matches.length === 1 && APPLIED(matches[0]) && matches[0].checksum === expected.checksum,
        "zero-direct ledger is not an exact applied prefix");
      prefixLength += 1;
    }
    if (stage !== "restart") assert.equal(prefixLength, stage === "before" ? 0 : 17, "wrong prefix release stage");
    return freeze({ stage, prefixLength, predecessorCount: 234, memberCount: 17,
      remainingMigrations: members.slice(prefixLength), productionExecutionAuthorized: false });
  }

  function assertSnapshot(snapshot, stage, mode = "production") {
    assert.ok(Object.hasOwn(MODES, mode), "unknown scope identity mode");
    const expected = MODES[mode];
    const result = classify(snapshot?.ledgerRows, stage);
    exact(snapshot.identity, { database: expected.database, actor: expected.owner,
      login: expected.owner, read_only: "on", isolation: "repeatable read" }, "scope identity or transaction drifted");
    assertZeroDirectRoles(snapshot.roles, mode);
    const defs = manifest.states[result.prefixLength];
    assert.ok(Array.isArray(snapshot.functions) && snapshot.functions.length === defs.length, "prefix function count drifted");
    for (const def of defs) {
      const matches = snapshot.functions.filter(row => row.name === def.name);
      assert.equal(matches.length, 1, "missing or overloaded prefix function");
      const { body, ...metadata } = matches[0];
      assert.equal(typeof body, "string");
      assert.equal(sha256(body), def.bodySha256, "prefix function body disagrees with ledger");
      exact(metadata, { name: def.name, identity_matches: true, owner: expected.owner,
        language: def.language, security_definer: def.securityDefiner, configuration: def.configuration,
        kind: "f", leakproof: false, strict: false, volatility: def.volatility, parallel_safety: def.parallelSafety,
        return_type: def.returnType, returns_set: def.returnsSet, arg_names: def.argNames,
        arg_modes: def.argModes, argument_defaults: 0, variadic: false,
        runtime_execute: def.runtimeExecute, staff_execute: false, invalid_acl_count: 0 },
      "prefix function authority drifted");
    }
    const expectedTables = [{ name: "CheckoutStockReservation", kind: "r", owner: expected.owner, rls: true, force: true,
      policies: 0, runtime_privileges: [], invalid_acl_count: 0,
      invalid_column_acl_count: 0, runtime_column_extras: 0, staff_access: false },
    { name: "Order", kind: "r", owner: expected.owner, rls: false, force: false,
      policies: 0, runtime_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"], invalid_acl_count: 0,
      invalid_column_acl_count: 0, runtime_column_extras: 0, staff_access: false }];
    for (const [name, introduced] of [["OrderStaffCapability", 10], ["SellerDeauthorizationApplication", 12]]) {
      if (result.prefixLength >= introduced) expectedTables.push({ name, kind: "r", owner: expected.owner, rls: true, force: true,
        policies: 0, runtime_privileges: [], invalid_acl_count: 0, invalid_column_acl_count: 0,
        runtime_column_extras: 0, staff_access: false });
    }
    exact(snapshot.tables, expectedTables, "prefix table posture or authority drifted");
    assertZeroDirectSchema(snapshot.schema, result.prefixLength);
    return freeze({ ...result, mode, targetFunctions: defs.length,
      orderRlsEnabled: false, predecessorCrudRetained: true, staffFunctionsDormant: true,
      completeProductionScope: false, productionExecutionAuthorized: false });
  }

  async function readSnapshot(client, stage, mode = "production") {
    // The caller owns a dedicated, freshly connected client with no active
    // transaction. This component must not be nested inside a caller's work.
    assert.ok(Object.hasOwn(MODES, mode), "unknown scope identity mode");
    assert.ok(["before", "restart", "after"].includes(stage), "unknown compatible prefix stage");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const identity = (await client.query(`SELECT current_database() AS database, CURRENT_USER AS actor, SESSION_USER AS login,
        pg_catalog.current_setting('transaction_read_only') AS read_only,
        pg_catalog.current_setting('transaction_isolation') AS isolation`)).rows[0];
      const expected = MODES[mode];
      exact(identity, { database: expected.database, actor: expected.owner, login: expected.owner,
        read_only: "on", isolation: "repeatable read" }, "scope identity or transaction drifted");
      const roles = await readZeroDirectRoles(client, expected.owner);
      assertZeroDirectRoles(roles, mode);
      const ledgerRows = (await client.query(CORRECTION_RELEASE_LEDGER_QUERY)).rows;
      const state = classify(ledgerRows, stage);
      const defs = manifest.states[state.prefixLength];
      const functions = (await client.query(`WITH expected(name,identity) AS (SELECT * FROM unnest($1::text[],$2::text[]))
        SELECT p.proname AS name, p.oid=pg_catalog.to_regprocedure(e.identity) AS identity_matches,
          pg_catalog.pg_get_userbyid(p.proowner) AS owner, l.lanname AS language, p.prosecdef AS security_definer,
          p.proconfig AS configuration, p.prosrc AS body,
          p.prokind AS kind, p.proleakproof AS leakproof, p.proisstrict AS strict,
          p.provolatile AS volatility, p.proparallel AS parallel_safety,
          pg_catalog.pg_get_function_result(p.oid) AS return_type, p.proretset AS returns_set,
          p.proargnames AS arg_names, p.proargmodes::text[] AS arg_modes,
          p.pronargdefaults::integer AS argument_defaults, p.provariadic<>0 AS variadic,
          pg_catalog.has_function_privilege('grainline_app_runtime',p.oid,'EXECUTE') AS runtime_execute,
          COALESCE(pg_catalog.has_function_privilege((SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_staff_read_runtime'),p.oid,'EXECUTE'),false) AS staff_execute,
          (SELECT count(*)::integer FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
            WHERE a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_app_runtime'))
            OR (a.grantee<>p.proowner AND (a.is_grantable OR a.grantor<>p.proowner))) AS invalid_acl_count
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
        LEFT JOIN expected e ON e.name=p.proname
        WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY($3::text[]) ORDER BY p.proname,p.oid`,
      [defs.map(def => def.name), defs.map(def => def.identity), targetNames])).rows;
      const tables = (await client.query(`SELECT c.relname AS name, c.relkind AS kind, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
        c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
        (SELECT count(*)::integer FROM pg_catalog.pg_policy WHERE polrelid=c.oid) AS policies,
        ARRAY(SELECT privilege FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]) privilege
          WHERE pg_catalog.has_table_privilege('grainline_app_runtime',c.oid,privilege) ORDER BY privilege) AS runtime_privileges,
        (SELECT count(*)::integer FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
          WHERE a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_app_runtime'))
          OR (a.grantee<>c.relowner AND (a.is_grantable OR a.grantor<>c.relowner))) AS invalid_acl_count,
        (SELECT count(*)::integer FROM pg_catalog.pg_attribute attr
          CROSS JOIN LATERAL pg_catalog.aclexplode(attr.attacl) a
          WHERE attr.attrelid=c.oid AND attr.attnum>0 AND NOT attr.attisdropped
          AND (a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_app_runtime'))
            OR (a.grantee<>c.relowner AND (a.is_grantable OR a.grantor<>c.relowner)))) AS invalid_column_acl_count,
        (SELECT count(*)::integer FROM pg_catalog.pg_attribute attr
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']::text[]) privilege
          WHERE attr.attrelid=c.oid AND attr.attnum>0 AND NOT attr.attisdropped
          AND pg_catalog.has_column_privilege('grainline_app_runtime',c.oid,attr.attnum,privilege)
          AND NOT pg_catalog.has_table_privilege('grainline_app_runtime',c.oid,privilege)) AS runtime_column_extras,
        COALESCE(pg_catalog.has_table_privilege((SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_staff_read_runtime'),c.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          OR COALESCE(pg_catalog.has_any_column_privilege((SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_staff_read_runtime'),c.oid,
          'SELECT,INSERT,UPDATE,REFERENCES'),false) AS staff_access
        FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
          AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [["CheckoutStockReservation", "Order", "OrderStaffCapability", "SellerDeauthorizationApplication"]])).rows;
      const schema = await readZeroDirectSchema(client, expected.owner);
      const snapshot = { identity, ledgerRows, functions, tables, schema, roles };
      assertSnapshot(snapshot, stage, mode);
      return snapshot;
    } finally { await client.query("ROLLBACK"); }
  }

  function plan(snapshot, mode = "production") {
    const state = assertSnapshot(snapshot, "restart", mode);
    return freeze({ ...state, selectedBoundary: "order-zero-direct-compatible-prefix",
      steps: [...(state.prefixLength < 17 ? ["apply-only-remaining-prefix"] : []),
        "reinspect-exact-complete-prefix", "converge-reviewed-runtime-grants", "migration-status",
        "global-grant-and-RLS-audit", "final-read-only-prefix-scope"],
      pendingExternalGates: ["exact-main-CI-and-loaded-source", "credential-incident-acceptance",
        "global-authority-and-role-configuration", "serialized-fresh-scope-and-selected-files", "actual-runtime-and-staff-proof"],
      productionExecutionAuthorized: false });
  }
  return Object.freeze({ manifest, classify, assertSnapshot, readSnapshot, plan });
}
