import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { correctionCompositionBundle } from "./order-correction-composition-manifest.mjs";
import { readOrderPaymentEventForceMigrationCatalog } from "./verify-order-payment-event-force-production-scope.mjs";
import { assertSellerPayoutEventForceReviewedSuccessorScope } from "./verify-seller-payout-event-force-production-scope.mjs";
import { ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS } from "./order-compatible-production-catalog.mjs";
import { CASE_CORRECTNESS_MIGRATION, CASE_CORRECTNESS_MIGRATION_SHA256 } from "./build-case-correctness-migration.mjs";
import { ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS } from "./stage-order-zero-direct-compatible-prefix.mjs";

// Source-only release preparation. No connection, migration writer, dispatcher,
// credential reader or deployment command. These proposed names are NOT staged.
export const CORRECTION_PREDECESSOR_CATALOG_SHA256 =
  "61e62d787b12ab1438b299762b6d2655600e4cd2542fdaa846121eb86bac25d9";
export const CORRECTION_RELEASE_MIGRATIONS = Object.freeze([
  "20260908090000_correct_order_label_outcome_inputs",
  "20260908090100_correct_order_refund_reconciliation_inputs",
  "20260908090200_correct_order_receipt_notification_type",
  "20260908090300_correct_order_label_clawback_clock",
  "20260908091000_correct_case_lifecycle",
  "20260908092000_correct_checkout_reservation_repair_outcome",
]);
export const CORRECTION_RELEASE_BOUNDARIES = Object.freeze([
  "order-compatible", "case-reader-first", "reservation-integrity-separate",
]);
export const CORRECTION_RELEASE_LEDGER_QUERY = `SELECT migration_name, checksum,
  finished_at, rolled_back_at, applied_steps_count FROM public._prisma_migrations
  ORDER BY migration_name, started_at, id`;
const digest = (value) => createHash("sha256").update(value).digest("hex");
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function exact(actual, expected, label) {
  assert.ok(isDeepStrictEqual(actual, expected), label); // bounded, no catalog dump
}
function applied(row, checksum) {
  return row?.checksum === checksum && row.finished_at != null
    && row.rolled_back_at === null && [1, "1"].includes(row.applied_steps_count);
}
function timestamp(value) {
  return value instanceof Date ? Number.isFinite(value.getTime())
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value)
      && Number.isFinite(Date.parse(value));
}

export function createCorrectionReleasePackage() {
  // Historical readers and exceptions are reused without modifying their pins.
  const force = readOrderPaymentEventForceMigrationCatalog();
  const predecessor = [
    ...force,
    ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(({ name, checksum }) => ({ migration_name: name, checksum })),
    { migration_name: CASE_CORRECTNESS_MIGRATION, checksum: CASE_CORRECTNESS_MIGRATION_SHA256 },
    ...ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.map(({ migration, sha256 }) => ({ migration_name: migration, checksum: sha256 })),
  ];
  assert.equal(predecessor.length, 251);
  assert.equal(digest(JSON.stringify(predecessor)), CORRECTION_PREDECESSOR_CATALOG_SHA256,
    "correction release predecessor catalog drifted");
  const migrationEntries = readdirSync("prisma/migrations", { withFileTypes: true });
  assert.ok(migrationEntries.every((e) => !e.isSymbolicLink()), "migration directory contains a symlink");
  exact(migrationEntries.filter((e) => e.isDirectory())
    .map((e) => e.name).sort(), predecessor.map((e) => e.migration_name).sort(), "unreviewed migration tree member");
  for (const entry of predecessor) {
    const path = `prisma/migrations/${entry.migration_name}/migration.sql`;
    assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), "migration is not a regular file");
    assert.equal(digest(readFileSync(path)), entry.checksum, "predecessor migration bytes drifted");
  }
  const bundle = correctionCompositionBundle();
  const packages = bundle.map((entry, index) => ({
    migration_name: CORRECTION_RELEASE_MIGRATIONS[index], checksum: entry.sha256,
    source: `docs/rls-drafts/${entry.name}.sql`, boundary: entry.boundary,
    functions: entry.definitions.map((def) => {
      const header = def.before.match(/\(\n([\s\S]+?)\n\)\nRETURNS (.+)\n/u);
      assert.ok(header, "function header is not the reviewed representation");
      const inputNames = header[1].split(",\n").map((arg) => arg.trim().split(/\s+/u)[0]);
      const outputs = header[2].startsWith("TABLE(")
        ? header[2].slice(6, -1).split(", ").map((arg) => arg.split(" ")[0]) : [];
      return { name: def.name, identity: `public.${def.name}(${def.args})`,
        returnType: header[2], argNames: [...inputNames, ...outputs],
        argModes: outputs.length ? [...inputNames.map(() => "i"), ...outputs.map(() => "t")] : null,
        returnsSet: outputs.length > 0, runtimeExecute: def.runtimeExecute,
        beforeBodySha256: digest(def.before.split(def.tag)[1]), afterBodySha256: digest(def.after.split(def.tag)[1]) };
    }),
  }));
  const manifest = freeze({ version: 1, productionExecutionAuthorized: false,
    acceptedCompositionCommit: "99f6e8cb9057d0daad5a7968765de2dc2e770c8f",
    acceptedCompositionCi: "34203109385", predecessor, predecessorCatalogSha256: CORRECTION_PREDECESSOR_CATALOG_SHA256,
    packages, requiredExternalGates: ["credential-incident-acceptance", "complete-owner-role-table-grant-scope",
      "exact-source-and-CI-binding", "Case-readers-before-lifecycle-SQL", "label-clock-before-automatic-retry",
      "composed-runtime-staff-and-authenticated-provider-acceptance"] });

  function classify(ledgerRows, request) {
    assert.ok(Array.isArray(ledgerRows), "missing complete migration ledger");
    assert.ok(ledgerRows.every((r) => typeof r?.migration_name === "string"
      && /^[a-f0-9]{64}$/u.test(r.checksum ?? "")
      && [0, 1, "0", "1"].includes(r.applied_steps_count)
      && (r.finished_at === null || timestamp(r.finished_at))
      && (r.rolled_back_at === null || timestamp(r.rolled_back_at))), "malformed migration ledger row");
    exact(Object.keys(request ?? {}).sort(), ["boundary", "companions", "stage"], "release request fields drifted");
    assert.ok(CORRECTION_RELEASE_BOUNDARIES.includes(request.boundary), "unknown release boundary");
    assert.ok(["before", "restart", "after"].includes(request.stage), "unknown release stage");
    exact(Object.keys(request.companions ?? {}).sort(), CORRECTION_RELEASE_BOUNDARIES
      .filter((b) => b !== request.boundary).sort(), "companion release states must be explicit");
    const correctionNames = new Set(packages.map((p) => p.migration_name));
    const historicalRows = ledgerRows.filter((r) => r.migration_name <= force.at(-1).migration_name);
    const priorForceRows = historicalRows.filter((r) => r.migration_name !== force.at(-1).migration_name);
    assertSellerPayoutEventForceReviewedSuccessorScope(priorForceRows, "after-order-payment-event-activation", {
      forceCatalog: force.slice(0, -15), successors: force.slice(-15, -1),
    });
    const forceRows = historicalRows.filter((r) => r.migration_name === force.at(-1).migration_name);
    assert.ok(forceRows.length === 1 && applied(forceRows[0], force.at(-1).checksum), "exact FORCE predecessor missing");
    const suffix = predecessor.slice(force.length);
    const suffixRows = ledgerRows.filter((r) => r.migration_name > force.at(-1).migration_name
      && !correctionNames.has(r.migration_name));
    assert.equal(suffixRows.length, suffix.length, "compatible predecessor ledger is incomplete or unknown");
    for (const entry of suffix) {
      const rows = suffixRows.filter((r) => r.migration_name === entry.migration_name);
      assert.ok(rows.length === 1 && applied(rows[0], entry.checksum), "compatible predecessor ledger drifted");
    }
    const counts = {};
    for (const boundary of CORRECTION_RELEASE_BOUNDARIES) {
      let absent = false; let count = 0;
      const members = packages.filter((p) => p.boundary === boundary);
      for (const member of members) {
        const rows = ledgerRows.filter((r) => r.migration_name === member.migration_name);
        if (rows.length === 0) { absent = true; continue; }
        assert.ok(!absent && rows.length === 1 && applied(rows[0], member.checksum), "correction ledger is not an exact applied prefix");
        count += 1;
      }
      counts[boundary] = count;
      if (boundary !== request.boundary) {
        assert.ok([0, members.length].includes(request.companions[boundary]), "companion state must be a complete boundary");
        assert.equal(count, request.companions[boundary], "unrequested companion release state changed");
      } else if (request.stage !== "restart") {
        assert.equal(count, request.stage === "before" ? 0 : members.length, "wrong release stage");
      }
    }
    return freeze({ boundary: request.boundary, stage: request.stage, appliedCounts: counts,
      remainingMigrations: packages.filter((p) => p.boundary === request.boundary)
        .slice(counts[request.boundary]).map((p) => p.migration_name),
      productionExecutionAuthorized: false, scopeChecksOnly: true });
  }

  function assertSnapshot(snapshot, request) {
    const state = classify(snapshot?.ledgerRows, request);
    const rows = snapshot?.functionRows;
    assert.ok(Array.isArray(rows) && rows.length === 9, "correction function inventory drifted");
    const seen = {};
    for (const pkg of packages) {
      const appliedCount = seen[pkg.boundary] ?? 0;
      const corrected = appliedCount < state.appliedCounts[pkg.boundary];
      seen[pkg.boundary] = appliedCount + 1;
      for (const def of pkg.functions) {
        const matches = rows.filter((r) => r.name === def.name);
        assert.equal(matches.length, 1, "missing or overloaded correction function");
        const { body, ...row } = matches[0];
        assert.equal(typeof body, "string", "missing function body");
        assert.equal(digest(body), corrected ? def.afterBodySha256 : def.beforeBodySha256,
          "function body disagrees with migration ledger");
        exact(row, { name: def.name, identity_matches: true, owner_name: "neondb_owner",
          language: "plpgsql", kind: "f", security_definer: true, leakproof: false, strict: false,
          volatility: "v", parallel_safety: "u", configuration: ["search_path=pg_catalog"],
          return_type: def.returnType, returns_set: def.returnsSet, arg_names: def.argNames, arg_modes: def.argModes,
          argument_defaults: 0, variadic: false, runtime_execute: def.runtimeExecute, invalid_acl_count: 0 },
        "correction function identity or authority drifted");
      }
    }
    return state;
  }

  async function readTargets(client) {
    const definitions = packages.flatMap((p) => p.functions);
    // Select every overload by name; only the exact schema-qualified typed
    // signature may match. No rendering-dependent identity comparison.
    const result = await client.query(`WITH expected(name, identity) AS (
      SELECT * FROM unnest($1::text[], $2::text[]))
      SELECT p.proname AS name, p.oid=pg_catalog.to_regprocedure(e.identity) AS identity_matches,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner_name, l.lanname AS language,
        p.prokind AS kind, p.prosecdef AS security_definer, p.proleakproof AS leakproof,
        p.proisstrict AS strict, p.provolatile AS volatility, p.proparallel AS parallel_safety,
        p.proconfig AS configuration, pg_catalog.pg_get_function_result(p.oid) AS return_type,
        p.proretset AS returns_set, p.proargnames AS arg_names, p.proargmodes AS arg_modes,
        p.pronargdefaults::integer AS argument_defaults, p.provariadic<>0 AS variadic,
        pg_catalog.has_function_privilege('grainline_app_runtime',p.oid,'EXECUTE') AS runtime_execute,
        (SELECT count(*)::integer FROM pg_catalog.aclexplode(COALESCE(p.proacl,
          pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='grainline_app_runtime'))
          OR (a.grantee<>p.proowner AND (a.is_grantable OR a.grantor<>p.proowner))) AS invalid_acl_count,
        p.prosrc AS body FROM expected e JOIN pg_catalog.pg_proc p ON p.proname=e.name
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang
        WHERE p.pronamespace='public'::regnamespace ORDER BY p.proname,p.oid`,
    [definitions.map((d) => d.name), definitions.map((d) => d.identity)]);
    return result.rows;
  }
  return Object.freeze({ manifest, classify, assertSnapshot, readTargets });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(createCorrectionReleasePackage().manifest, null, 2)}\n`);
}
