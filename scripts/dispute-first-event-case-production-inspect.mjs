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
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertReviewedPeerMigrationLedger } from "./order-refund-immutable-event-production-ledger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION = "20261017010000_correct_dispute_first_event_case";
export const MIGRATION_SHA256 =
  "735e84fd9d672426333cd5cf608ba3b60a0613ee6fc162f5bfc3e6beaed1179b";

export const FUNCTION_SPECS = Object.freeze([
  Object.freeze({
    identity: "public.grainline_case_relationship_valid()",
    delimiter: "$grainline_case_relationship_valid$",
    predecessor: "20260730010000_enforce_case_message_invariants/migration.sql",
    runtimeExecute: false,
  }),
  Object.freeze({
    identity: "public.grainline_case_stripe_dispute_apply(text)",
    delimiter: "$grainline_case_stripe_dispute_apply$",
    predecessor: "20260901160000_correct_case_order_invariants/migration.sql",
    runtimeExecute: true,
  }),
  Object.freeze({
    identity:
      "public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)",
    delimiter: "$grainline_order_payment_signed_dispute_apply$",
    predecessor:
      "20261016011000_correct_case_refund_followup_deadends/migration.sql",
    predecessorEnvironment: "CASE_REFUND_FOLLOWUP_MIGRATION_PATH",
    runtimeExecute: true,
  }),
  Object.freeze({
    identity:
      'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
    delimiter: "$grainline_notification_create_core$",
    predecessor:
      "20261013200000_move_final_seller_private_sql_callers/migration.sql",
    predecessorDirectoryEnvironment:
      "SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR",
    runtimeExecute: false,
  }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationPath(relativePath) {
  return path.join(ROOT, "prisma/migrations", relativePath);
}

export function extractFunctionSource(sql, delimiter) {
  const marker = `AS ${delimiter}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing function delimiter ${delimiter}`);
  assert.equal(
    sql.indexOf(marker, start + marker.length),
    -1,
    `ambiguous function delimiter ${delimiter}`,
  );
  const bodyStart = start + marker.length;
  const end = sql.indexOf(`${delimiter};`, bodyStart);
  assert.ok(end > bodyStart, `unterminated function delimiter ${delimiter}`);
  return sql.slice(bodyStart, end);
}

export function reviewedSources() {
  const candidatePath =
    process.env.DISPUTE_FIRST_EVENT_CASE_MIGRATION_PATH?.trim() ||
    migrationPath(`${MIGRATION}/migration.sql`);
  const candidateSql = readFileSync(candidatePath, "utf8");
  assert.equal(sha256(candidateSql), MIGRATION_SHA256);
  return new Map(
    FUNCTION_SPECS.map((spec) => [
      spec.identity,
      Object.freeze({
        before: extractFunctionSource(
          readFileSync(
            (spec.predecessorEnvironment
              ? process.env[spec.predecessorEnvironment]?.trim()
              : "") ||
              (spec.predecessorDirectoryEnvironment
                ? path.join(
                    process.env[spec.predecessorDirectoryEnvironment]?.trim() ||
                      path.join(ROOT, "prisma/migrations"),
                    spec.predecessor,
                  )
                : migrationPath(spec.predecessor)),
            "utf8",
          ),
          spec.delimiter,
        ),
        after: extractFunctionSource(candidateSql, spec.delimiter),
        runtimeExecute: spec.runtimeExecute,
      }),
    ]),
  );
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
  return sha256(readFileSync(migrationPath(`${name}/migration.sql`)));
}

async function readCatalog(client, identities) {
  const functions = await client.query(
    `WITH requested AS (
      SELECT identity, pg_catalog.to_regprocedure(identity) AS oid
        FROM pg_catalog.unnest($1::text[]) AS identity)
    SELECT requested.identity, requested.oid::text AS resolved,
           pg_catalog.pg_get_userbyid(routine.proowner) AS owner,
           routine.prosrc, routine.prosecdef, routine.provolatile,
           routine.proparallel, routine.proconfig,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE') AS runtime_execute,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE') AS staff_execute,
           pg_catalog.has_function_privilege(
             0, routine.oid, 'EXECUTE') AS public_execute
      FROM requested
      LEFT JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
     ORDER BY requested.identity`,
    [identities],
  );
  const acl = await client.query(
    `WITH requested AS (
      SELECT identity, pg_catalog.to_regprocedure(identity) AS oid
        FROM pg_catalog.unnest($1::text[]) AS identity)
    SELECT requested.identity,
           CASE WHEN expanded.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(expanded.grantee) END AS grantee,
           pg_catalog.pg_get_userbyid(expanded.grantor) AS grantor,
           expanded.privilege_type, expanded.is_grantable
      FROM requested
      JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )) AS expanded
     ORDER BY requested.identity, grantee, grantor,
              expanded.privilege_type, expanded.is_grantable`,
    [identities],
  );
  return Object.freeze({ functions: functions.rows, acl: acl.rows });
}

function assertCatalog(functions, sources, state) {
  assert.equal(functions.length, FUNCTION_SPECS.length);
  for (const row of functions) {
    const reviewed = sources.get(row.identity);
    assert.ok(reviewed, `unexpected function ${row.identity}`);
    assert.ok(row.resolved, `missing function ${row.identity}`);
    assert.equal(row.owner, "neondb_owner");
    assert.equal(
      row.prosrc,
      reviewed[state === "applied" ? "after" : "before"],
    );
    assert.equal(row.prosecdef, true);
    assert.equal(row.provolatile, "v");
    assert.equal(row.proparallel, "u");
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.runtime_execute, reviewed.runtimeExecute);
    assert.equal(row.staff_execute, false);
    assert.equal(row.public_execute, false);
  }
}

async function inspectPreflight(client) {
  const directories = migrationDirectories();
  assert.ok(directories.includes(MIGRATION), "candidate migration is missing");
  const ledger = await client.query(
    `SELECT migration_name, checksum, finished_at,
      rolled_back_at, applied_steps_count
    FROM public._prisma_migrations
    WHERE migration_name = ANY($1::text[])
    ORDER BY migration_name`,
    [directories],
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
  const candidateRows = byName.get(MIGRATION) ?? [];
  assert.ok(candidateRows.length <= 1, "candidate ledger is duplicated");
  const candidate = candidateRows[0] ?? null;
  if (candidate) {
    assert.equal(candidate.checksum, MIGRATION_SHA256);
    assert.ok(candidate.finished_at);
    assert.equal(candidate.rolled_back_at, null);
    assert.equal(Number(candidate.applied_steps_count), 1);
  }
  const state = candidate ? "applied" : "pending";
  const sources = reviewedSources();
  const catalog = await readCatalog(client, [...sources.keys()]);
  assertCatalog(catalog.functions, sources, state);
  const recovery = await disputeFirstEventRecoveryCandidateSummary(client);
  if (state === "pending") {
    assert.ok(
      recovery.candidateCount <= 100,
      `recovery candidate cap exceeded before deploy: ${recovery.candidateCount}`,
    );
    assert.equal(
      recovery.unrepairableCount,
      0,
      "unrepairable dispute first-event gap exists before deploy",
    );
  } else {
    assert.equal(
      recovery.candidateCount,
      0,
      "applied dispute first-event migration retains an eligible gap",
    );
  }
  return Object.freeze({ state, catalog, recovery });
}

export async function disputeFirstEventRecoveryCandidateSummary(client) {
  const result = await client.query(`WITH candidates AS (
      SELECT DISTINCT ON (
        payment."orderId",
        payment."stripeObjectId"
      )
        payment.id AS payment_event_id,
        payment."orderId" AS order_id,
        payment."stripeEventId" AS stripe_event_id,
        payment."stripeObjectId" AS dispute_id,
        payment.currency,
        payment.metadata,
        orders."buyerId" AS buyer_user_id,
        orders."stripeChargeId" AS stripe_charge_id,
        order_seller."userId" AS order_seller_user_id,
        retained_seller.seller_count,
        retained_seller.only_seller_user_id,
        EXISTS (
          SELECT 1
            FROM public."Case" AS existing_case
           WHERE existing_case."orderId" = orders.id
             AND existing_case.resolution IN (
               'REFUND_FULL'::public."CaseResolution",
               'REFUND_PARTIAL'::public."CaseResolution"
             )
        ) AS has_refund_resolved_case
      FROM public."OrderPaymentEvent" AS payment
      JOIN public."Order" AS orders
        ON orders.id = payment."orderId"
      LEFT JOIN public."SellerProfile" AS order_seller
        ON order_seller.id = orders."sellerProfileId"
      CROSS JOIN LATERAL (
        SELECT
          pg_catalog.count(DISTINCT item_seller."userId")::integer
            AS seller_count,
          pg_catalog.min(item_seller."userId") AS only_seller_user_id
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing
          ON listing.id = item."listingId"
        JOIN public."SellerProfile" AS item_seller
          ON item_seller.id = listing."sellerId"
        WHERE item."orderId" = payment."orderId"
      ) AS retained_seller
      WHERE payment."eventType" = 'DISPUTE'
        AND payment."stripeObjectType" = 'dispute'
        AND payment."stripeObjectId" IS NOT NULL
        AND payment."stripeEventId" IS NOT NULL
        AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
        AND payment.metadata->>'stripeEventType' IN (
          'charge.dispute.created', 'charge.dispute.updated',
          'charge.dispute.closed', 'charge.dispute.funds_withdrawn',
          'charge.dispute.funds_reinstated'
        )
        AND payment.metadata->>'orderingAction' = 'applied'
        AND payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
        AND pg_catalog.lower(COALESCE(payment.status, '')) NOT IN (
          'won', 'lost', 'prevented', 'warning_closed'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public."CaseStripeDisputeApplication" AS prior_application
            JOIN public."OrderPaymentEvent" AS applied_event
              ON applied_event.id = prior_application."paymentEventId"
           WHERE prior_application."orderId" = payment."orderId"
             AND applied_event."orderId" = payment."orderId"
             AND applied_event."eventType" = 'DISPUTE'
             AND applied_event."stripeObjectType" = 'dispute'
             AND applied_event."stripeObjectId"
                   IS NOT DISTINCT FROM payment."stripeObjectId"
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public."OrderPaymentEvent" AS newer_event
           WHERE newer_event."orderId" = payment."orderId"
             AND newer_event."eventType" = 'DISPUTE'
             AND newer_event."stripeObjectType" = 'dispute'
             AND newer_event."stripeObjectId"
                   IS NOT DISTINCT FROM payment."stripeObjectId"
             AND pg_catalog.jsonb_typeof(newer_event.metadata) = 'object'
             AND newer_event.metadata->>'stripeEventCreated'
                   ~ '^[0-9]{1,12}$'
             AND (
               (newer_event.metadata->>'stripeEventCreated')::bigint
                 > (payment.metadata->>'stripeEventCreated')::bigint
               OR (
                 (newer_event.metadata->>'stripeEventCreated')::bigint
                   = (payment.metadata->>'stripeEventCreated')::bigint
                 AND pg_catalog.lower(COALESCE(newer_event.status, '')) IN (
                   'won', 'lost', 'prevented', 'warning_closed'
                 )
               )
             )
        )
      ORDER BY
        payment."orderId",
        payment."stripeObjectId",
        COALESCE(
          payment."stripeEventCreatedSeconds",
          (payment.metadata->>'stripeEventCreated')::bigint
        ) DESC,
        payment."createdAt" DESC,
        payment.id DESC
    )
    SELECT
      pg_catalog.count(*)::integer AS candidate_count,
      pg_catalog.count(*) FILTER (
        WHERE candidate.buyer_user_id IS NULL
           OR candidate.order_seller_user_id IS NULL
           OR candidate.buyer_user_id = candidate.order_seller_user_id
           OR candidate.stripe_charge_id IS NULL
           OR pg_catalog.btrim(candidate.stripe_charge_id) = ''
           OR candidate.metadata->>'chargeId'
                IS DISTINCT FROM candidate.stripe_charge_id
           OR candidate.metadata->>'disputeId'
                IS DISTINCT FROM candidate.dispute_id
           OR candidate.currency !~ '^[a-z]{3}$'
           OR pg_catalog.btrim(candidate.stripe_event_id) = ''
           OR pg_catalog.char_length(candidate.stripe_event_id) > 191
           OR candidate.seller_count <> 1
           OR candidate.only_seller_user_id IS NULL
           OR candidate.only_seller_user_id
                IS DISTINCT FROM candidate.order_seller_user_id
           OR candidate.has_refund_resolved_case
      )::integer AS unrepairable_count
    FROM candidates AS candidate`);
  assert.equal(result.rows.length, 1);
  return Object.freeze({
    candidateCount: Number(result.rows[0].candidate_count),
    unrepairableCount: Number(result.rows[0].unrepairable_count),
  });
}

async function remainingGapCount(client) {
  const result =
    await client.query(`SELECT pg_catalog.count(*)::integer AS count
    FROM public."OrderPaymentEvent" AS payment
    WHERE payment."eventType" = 'DISPUTE'
      AND payment."stripeObjectType" = 'dispute'
      AND payment."stripeObjectId" IS NOT NULL
      AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
      AND payment.metadata->>'stripeEventType' IN (
        'charge.dispute.created', 'charge.dispute.updated',
        'charge.dispute.closed', 'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated'
      )
      AND payment.metadata->>'orderingAction' = 'applied'
      AND payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
      AND pg_catalog.lower(COALESCE(payment.status, '')) NOT IN (
        'won', 'lost', 'prevented', 'warning_closed'
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public."CaseStripeDisputeApplication" AS application
          JOIN public."OrderPaymentEvent" AS applied_event
            ON applied_event.id = application."paymentEventId"
         WHERE application."orderId" = payment."orderId"
           AND applied_event."orderId" = payment."orderId"
           AND applied_event."eventType" = 'DISPUTE'
           AND applied_event."stripeObjectType" = 'dispute'
           AND applied_event."stripeObjectId"
                 IS NOT DISTINCT FROM payment."stripeObjectId"
      )`);
  return Number(result.rows[0]?.count ?? -1);
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is missing");
  assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  const snapshotPath = path.join(
    process.env.RUNNER_TEMP,
    "dispute-first-event-case-preflight.json",
  );
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (mode === "preflight") {
      const result = await inspectPreflight(client);
      writeFileSync(snapshotPath, JSON.stringify(result), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\n`);
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `candidate_count=${result.recovery.candidateCount}\n`,
      );
    } else {
      const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
      const sources = reviewedSources();
      const catalog = await readCatalog(client, [...sources.keys()]);
      assertCatalog(catalog.functions, sources, "applied");
      assert.deepEqual(
        catalog.functions.map(({ prosrc, ...row }) => row),
        before.catalog.functions.map(({ prosrc, ...row }) => row),
      );
      assert.deepEqual(catalog.acl, before.catalog.acl);
      const ledger = await client.query(
        `SELECT checksum, finished_at,
          rolled_back_at, applied_steps_count
        FROM public._prisma_migrations WHERE migration_name = $1`,
        [MIGRATION],
      );
      assert.equal(ledger.rows.length, 1);
      assert.equal(ledger.rows[0].checksum, MIGRATION_SHA256);
      assert.ok(ledger.rows[0].finished_at);
      assert.equal(ledger.rows[0].rolled_back_at, null);
      assert.equal(Number(ledger.rows[0].applied_steps_count), 1);
      const issueCount = await remainingGapCount(client);
      assert.equal(issueCount, 0);
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, "dispute-first-event-case.json"),
        JSON.stringify(
          {
            status: "passed",
            migration: MIGRATION,
            functionSourceMd5: Object.fromEntries(
              catalog.functions.map((row) => [
                row.identity,
                createHash("md5").update(row.prosrc).digest("hex"),
              ]),
            ),
            preflightCandidateCount: before.recovery.candidateCount,
            preflightUnrepairableCount: before.recovery.unrepairableCount,
            issueCount,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    }
    await client.query("COMMIT");
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
