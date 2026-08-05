#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_ORDER_ACTIVE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-order-active-proof";
const OLD_TIME = new Date("2025-01-01T00:00:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  foreignBuyer: `${PREFIX}-foreign-buyer`,
  bannedBuyer: `${PREFIX}-banned-buyer`,
  sellerUser: `${PREFIX}-seller-user`,
  foreignSellerUser: `${PREFIX}-foreign-seller-user`,
  deletedSellerUser: `${PREFIX}-deleted-seller-user`,
  seller: `${PREFIX}-seller`,
  foreignSeller: `${PREFIX}-foreign-seller`,
  deletedSeller: `${PREFIX}-deleted-seller`,
  listing: `${PREFIX}-listing`,
  foreignListing: `${PREFIX}-foreign-listing`,
  deletedListing: `${PREFIX}-deleted-listing`,
  activeOrder: `${PREFIX}-order-active`,
  clearOrder: `${PREFIX}-order-clear`,
  mixedOrder: `${PREFIX}-order-mixed`,
  emptyOrder: `${PREFIX}-order-empty`,
  bannedBuyerOrder: `${PREFIX}-order-banned-buyer`,
  deletedSellerOrder: `${PREFIX}-order-deleted-seller`,
  retentionEligible: `${PREFIX}-order-retention-eligible`,
  retentionHeld: `${PREFIX}-order-retention-held`,
  retentionClosed: `${PREFIX}-order-retention-closed`,
  retentionRecent: `${PREFIX}-order-retention-recent`,
  retentionReview: `${PREFIX}-order-retention-review`,
  retentionRace: `${PREFIX}-order-retention-race`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseOrderActiveProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case-aware Order proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case-aware Order proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

function createClient(databaseUrl, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

async function runtimeQuery(client, sql, params = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function buyerGuard(client, actorId, orderId) {
  const result = await runtimeQuery(
    client,
    `
      SELECT public.grainline_case_order_active_for_buyer(
        $1,
        $2
      ) AS active
    `,
    [actorId, orderId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0].active;
}

async function sellerGuard(client, actorId, orderId) {
  const result = await runtimeQuery(
    client,
    `
      SELECT public.grainline_case_order_active_for_seller(
        $1,
        $2
      ) AS active
    `,
    [actorId, orderId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0].active;
}

async function seedUser(
  client,
  id,
  { banned = false, deletedAt = null } = {},
) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, banned, "deletedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    id,
    `clerk-${id}`,
    `${id}@example.invalid`,
    `Name ${id}`,
    banned,
    deletedAt,
  ]);
}

async function seedOrder(
  client,
  id,
  buyerId,
  {
    fulfillmentStatus = "PENDING",
    deliveredAt = null,
    reviewNeeded = false,
    withPii = false,
  } = {},
) {
  await client.query(`
    INSERT INTO public."Order" (
      id, "buyerId", "fulfillmentStatus", "deliveredAt",
      "reviewNeeded", "buyerEmail", "buyerName", "shipToLine1",
      "quotedToName", "trackingCarrier", "trackingNumber",
      "sellerNotes", "shippoShipmentId", "shippoRateObjectId",
      "shippoTransactionId", "labelUrl", "labelCarrier",
      "labelTrackingNumber", "giftNote"
    )
    VALUES (
      $1, $2, $3::public."FulfillmentStatus", $4,
      $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14,
      $15, $16, $17,
      $18, $19
    )
  `, [
    id,
    buyerId,
    fulfillmentStatus,
    deliveredAt,
    reviewNeeded,
    withPii ? `${id}@example.invalid` : null,
    withPii ? `Buyer ${id}` : null,
    withPii ? "1 Proof Lane" : null,
    withPii ? `Quoted ${id}` : null,
    withPii ? "UPS" : null,
    withPii ? "1ZPROOF" : null,
    withPii ? "Proof seller note" : null,
    withPii ? `shipment-${id}` : null,
    withPii ? `rate-${id}` : null,
    withPii ? `transaction-${id}` : null,
    withPii ? `https://example.invalid/${id}.pdf` : null,
    withPii ? "UPS" : null,
    withPii ? "1ZPROOF" : null,
    withPii ? "Proof gift note" : null,
  ]);
}

async function seedOrderItem(client, orderId, listingId, suffix) {
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 1000)
  `, [`${PREFIX}-item-${suffix}`, orderId, listingId]);
}

async function seedCase(client, orderId, status, suffix) {
  const caseId = `${PREFIX}-case-${suffix}`;
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, resolution, "sellerRespondBy", "resolvedAt",
      "createdAt", "updatedAt"
    )
    SELECT
      $1,
      order_row.id,
      order_row."buyerId",
      $2,
      'DAMAGED'::public."CaseReason",
      'Disposable Case-aware Order authority proof.',
      $3::public."CaseStatus",
      CASE
        WHEN $3::text IN ('RESOLVED', 'CLOSED')
          THEN 'DISMISSED'::public."CaseResolution"
        ELSE NULL
      END,
      CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CASE
        WHEN $3::text IN ('RESOLVED', 'CLOSED')
          THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
      FROM public."Order" AS order_row
     WHERE order_row.id = $4
  `, [
    caseId,
    ids.sellerUser,
    status,
    orderId,
  ]);
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    SELECT
      $1, $2, order_row."buyerId", 'BUYER',
      'Disposable opening evidence for the Case-aware Order proof.',
      CURRENT_TIMESTAMP
      FROM public."Order" AS order_row
     WHERE order_row.id = $3
  `, [`${caseId}-opening-message`, caseId, orderId]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUser(client, ids.buyer);
    await seedUser(client, ids.foreignBuyer);
    await seedUser(client, ids.bannedBuyer, { banned: true });
    await seedUser(client, ids.sellerUser);
    await seedUser(client, ids.foreignSellerUser);
    await seedUser(client, ids.deletedSellerUser, { deletedAt: OLD_TIME });

    for (const [id, userId, name] of [
      [ids.seller, ids.sellerUser, "Proof seller"],
      [ids.foreignSeller, ids.foreignSellerUser, "Foreign proof seller"],
      [ids.deletedSeller, ids.deletedSellerUser, "Deleted proof seller"],
    ]) {
      await client.query(`
        INSERT INTO public."SellerProfile" (
          id, "userId", "displayName", "displayNameNormalized",
          "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [id, userId, name, name.toLowerCase()]);
    }

    for (const [id, sellerId] of [
      [ids.listing, ids.seller],
      [ids.foreignListing, ids.foreignSeller],
      [ids.deletedListing, ids.deletedSeller],
    ]) {
      await client.query(`
        INSERT INTO public."Listing" (
          id, "sellerId", title, description, "priceCents",
          "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, 'Disposable proof listing.', 1000,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [id, sellerId, id]);
    }

    for (const orderId of [
      ids.activeOrder,
      ids.clearOrder,
      ids.mixedOrder,
      ids.emptyOrder,
      ids.deletedSellerOrder,
    ]) {
      await seedOrder(client, orderId, ids.buyer);
    }
    await seedOrder(client, ids.bannedBuyerOrder, ids.bannedBuyer);
    for (const orderId of [
      ids.retentionEligible,
      ids.retentionHeld,
      ids.retentionClosed,
      ids.retentionReview,
      ids.retentionRace,
    ]) {
      await seedOrder(client, orderId, ids.buyer, {
        fulfillmentStatus: "DELIVERED",
        deliveredAt: OLD_TIME,
        reviewNeeded: orderId === ids.retentionReview,
        withPii: true,
      });
    }
    await seedOrder(client, ids.retentionRecent, ids.buyer, {
      fulfillmentStatus: "DELIVERED",
      deliveredAt: new Date(),
      withPii: true,
    });

    let itemIndex = 0;
    for (const orderId of [
      ids.activeOrder,
      ids.clearOrder,
      ids.mixedOrder,
      ids.emptyOrder,
      ids.bannedBuyerOrder,
      ids.retentionEligible,
      ids.retentionHeld,
      ids.retentionClosed,
      ids.retentionRecent,
      ids.retentionReview,
      ids.retentionRace,
    ]) {
      await seedOrderItem(
        client,
        orderId,
        ids.listing,
        String(itemIndex++),
      );
    }
    await seedOrderItem(
      client,
      ids.deletedSellerOrder,
      ids.deletedListing,
      String(itemIndex++),
    );

    await client.query("SAVEPOINT reject_mixed_seller_order");
    let mixedSellerError;
    try {
      await seedOrderItem(
        client,
        ids.mixedOrder,
        ids.foreignListing,
        "mixed-seller-rejected",
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      mixedSellerError = error;
      await client.query("ROLLBACK TO SAVEPOINT reject_mixed_seller_order");
    }
    assert.ok(mixedSellerError, "mixed_seller_order_invariant_rejected");
    assert.match(
      safeError(mixedSellerError),
      /Order cannot contain items from multiple sellers/,
    );
    await client.query("RELEASE SAVEPOINT reject_mixed_seller_order");

    await client.query("SAVEPOINT reject_empty_order");
    let emptyOrderError;
    try {
      await client.query(
        'DELETE FROM public."OrderItem" WHERE "orderId" = $1',
        [ids.emptyOrder],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      emptyOrderError = error;
      await client.query("ROLLBACK TO SAVEPOINT reject_empty_order");
    }
    assert.ok(emptyOrderError, "empty_order_invariant_rejected");
    assert.match(
      safeError(emptyOrderError),
      /Order durable seller key is incomplete or inconsistent/,
    );
    await client.query("RELEASE SAVEPOINT reject_empty_order");

    await seedCase(client, ids.activeOrder, "OPEN", "active");
    await seedCase(client, ids.clearOrder, "CLOSED", "clear");
    await seedCase(client, ids.retentionHeld, "UNDER_REVIEW", "held");
    await seedCase(client, ids.retentionClosed, "CLOSED", "retention-closed");

    for (const [index, orderId] of [
      ids.retentionEligible,
      ids.retentionClosed,
      ids.retentionHeld,
      ids.retentionRace,
    ].entries()) {
      await client.query(`
        INSERT INTO public."OrderShippingRateQuote" (
          id, "orderId", "shipmentId", rates, "expiresAt",
          "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, '[]'::jsonb, CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [
        `${PREFIX}-quote-${index}`,
        orderId,
        `${PREFIX}-shipment-${index}`,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function fixtureCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM public."User" WHERE id LIKE $1) AS users,
      (SELECT pg_catalog.count(*)::integer
         FROM public."SellerProfile" WHERE id LIKE $1) AS sellers,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Listing" WHERE id LIKE $1) AS listings,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Order" WHERE id LIKE $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."OrderItem" WHERE id LIKE $1) AS items,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case" WHERE id LIKE $1) AS cases,
      (SELECT pg_catalog.count(*)::integer
         FROM public."OrderShippingRateQuote" WHERE id LIKE $1) AS quotes
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

async function setProofRls(client) {
  for (const table of [
    "User",
    "SellerProfile",
    "Listing",
    "OrderItem",
    "Case",
  ]) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
  }
}

async function restoreProofRls(client) {
  for (const table of [
    "Case",
    "OrderItem",
    "Listing",
    "SellerProfile",
    "User",
  ]) {
    await client.query(
      `ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`,
    ).catch(() => {});
    await client.query(
      `ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`,
    ).catch(() => {});
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."OrderShippingRateQuote" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."OrderItem" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Listing" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."User" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function expectSqlState(run, sqlState) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, sqlState);
    return true;
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runCaseOrderActiveProof(env = process.env) {
  const { databaseUrl } = parseCaseOrderActiveProofConfig(env);
  const owner = createClient(databaseUrl, `${PREFIX}-owner`);
  const runtime = createClient(databaseUrl, `${PREFIX}-runtime`);
  const contender = createClient(databaseUrl, `${PREFIX}-contender`);
  const checks = [];
  let rlsChanged = false;
  await owner.connect();
  await runtime.connect();
  await contender.connect();
  try {
    assert.deepEqual(
      await fixtureCounts(owner),
      {
        users: 0,
        sellers: 0,
        listings: 0,
        orders: 0,
        items: 0,
        cases: 0,
        quotes: 0,
      },
      "Case-aware Order proof found pre-existing fixtures",
    );
    checks.push("preflight-zero-residue");
    await seedFixtures(owner);
    checks.push("fixtures-seeded");

    const catalog = await owner.query(`
      SELECT
        procedure.proname,
        procedure.prosecdef,
        procedure.provolatile,
        procedure.proparallel,
        procedure.proconfig,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'public',
          procedure.oid,
          'EXECUTE'
        ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid IN (
         'public.grainline_case_order_active_for_buyer(text,text)'::pg_catalog.regprocedure,
         'public.grainline_case_order_active_for_seller(text,text)'::pg_catalog.regprocedure,
         'public.grainline_order_buyer_pii_prune_batch(integer)'::pg_catalog.regprocedure
       )
       ORDER BY procedure.proname
    `);
    assert.deepEqual(
      catalog.rows,
      [
        "grainline_case_order_active_for_buyer",
        "grainline_case_order_active_for_seller",
        "grainline_order_buyer_pii_prune_batch",
      ].map((proname) => ({
        proname,
        prosecdef: true,
        provolatile: "v",
        proparallel: "u",
        proconfig: ["search_path=pg_catalog"],
        runtime_execute: true,
        public_execute: false,
      })),
    );
    checks.push("catalog-and-grants");

    const originalRls = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_catalog.pg_class
       WHERE oid IN (
         'public."User"'::pg_catalog.regclass,
         'public."SellerProfile"'::pg_catalog.regclass,
         'public."Listing"'::pg_catalog.regclass,
         'public."OrderItem"'::pg_catalog.regclass,
         'public."Case"'::pg_catalog.regclass
       )
       ORDER BY relname
    `);
    assert.equal(
      originalRls.rows.every(
        (row) => !row.relrowsecurity && !row.relforcerowsecurity,
      ),
      true,
      "Case-aware Order proof requires the compatible pre-RLS posture",
    );
    rlsChanged = true;
    await setProofRls(owner);
    checks.push("forced-rls-source-posture");

    assert.equal(
      await buyerGuard(runtime, ids.buyer, ids.activeOrder),
      true,
    );
    assert.equal(
      await buyerGuard(runtime, ids.buyer, ids.clearOrder),
      false,
    );
    assert.equal(
      await sellerGuard(runtime, ids.sellerUser, ids.activeOrder),
      true,
    );
    assert.equal(
      await sellerGuard(runtime, ids.sellerUser, ids.clearOrder),
      false,
    );
    checks.push("participant-active-and-terminal-results");

    for (const [actorId, orderId] of [
      [ids.foreignBuyer, ids.activeOrder],
      [ids.bannedBuyer, ids.bannedBuyerOrder],
      [`${PREFIX}-missing`, ids.activeOrder],
    ]) {
      assert.equal(await buyerGuard(runtime, actorId, orderId), null);
    }
    for (const [actorId, orderId] of [
      [ids.foreignSellerUser, ids.activeOrder],
      [ids.deletedSellerUser, ids.deletedSellerOrder],
      [`${PREFIX}-missing`, ids.activeOrder],
    ]) {
      assert.equal(await sellerGuard(runtime, actorId, orderId), null);
    }
    checks.push("foreign-disabled-deleted-and-missing-denial");

    for (const [sql, params] of [
      [
        "SELECT public.grainline_case_order_active_for_buyer($1, $2)",
        ["x".repeat(129), ids.activeOrder],
      ],
      [
        "SELECT public.grainline_case_order_active_for_seller($1, $2)",
        [ids.sellerUser, "x".repeat(129)],
      ],
      [
        "SELECT * FROM public.grainline_order_buyer_pii_prune_batch($1)",
        [0],
      ],
      [
        "SELECT * FROM public.grainline_order_buyer_pii_prune_batch($1)",
        [1001],
      ],
    ]) {
      await expectSqlState(
        () => runtimeQuery(runtime, sql, params),
        "22023",
      );
    }
    checks.push("invalid-input-denial");

    const directCase = await runtimeQuery(
      runtime,
      'SELECT id FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    assert.equal(directCase.rowCount, 0);
    checks.push("function-only-forced-rls-case-read");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const prune = await runtime.query(
      "SELECT * FROM public.grainline_order_buyer_pii_prune_batch($1)",
      [1000],
    );
    assert.equal(prune.rowCount, 1);
    assert.equal(Number(prune.rows[0].purged), 3);
    assert.ok(prune.rows[0].cutoff instanceof Date);
    await runtime.query("RESET ROLE");
    const retained = await runtime.query(`
      SELECT id, "buyerEmail", "buyerDataPurgedAt"
        FROM public."Order"
       WHERE id = ANY($1::text[])
       ORDER BY id
    `, [[
      ids.retentionEligible,
      ids.retentionHeld,
      ids.retentionClosed,
      ids.retentionRecent,
      ids.retentionReview,
      ids.retentionRace,
    ]]);
    const retainedById = new Map(retained.rows.map((row) => [row.id, row]));
    for (const orderId of [
      ids.retentionEligible,
      ids.retentionClosed,
      ids.retentionRace,
    ]) {
      assert.equal(retainedById.get(orderId).buyerEmail, null);
      assert.ok(retainedById.get(orderId).buyerDataPurgedAt instanceof Date);
    }
    for (const orderId of [
      ids.retentionHeld,
      ids.retentionRecent,
      ids.retentionReview,
    ]) {
      assert.notEqual(retainedById.get(orderId).buyerEmail, null);
      assert.equal(retainedById.get(orderId).buyerDataPurgedAt, null);
    }
    const quoteCount = await runtime.query(
      `
        SELECT pg_catalog.count(*)::integer AS count
          FROM public."OrderShippingRateQuote"
         WHERE id LIKE $1
      `,
      [`${PREFIX}%`],
    );
    assert.equal(quoteCount.rows[0].count, 1);
    await runtime.query("ROLLBACK");
    checks.push("fixed-retention-targets-and-rollback");

    await contender.query("BEGIN");
    await contender.query(
      'SELECT id FROM public."Order" WHERE id = $1 FOR UPDATE',
      [ids.retentionRace],
    );
    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const skipLocked = runtime.query(
      "SELECT * FROM public.grainline_order_buyer_pii_prune_batch($1)",
      [1000],
    );
    const skipResult = await Promise.race([
      skipLocked,
      delay(2_000).then(() => null),
    ]);
    assert.notEqual(
      skipResult,
      null,
      "retention prune waited on a concurrently locked Order",
    );
    await runtime.query("ROLLBACK");
    await contender.query("ROLLBACK");
    checks.push("retention-skip-locked-race");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    await runtime.query(
      'SELECT id FROM public."Order" WHERE id = $1 FOR UPDATE',
      [ids.retentionRace],
    );
    const lockedGuard = await runtime.query(
      `
        SELECT public.grainline_case_order_active_for_seller(
          $1,
          $2
        ) AS active
      `,
      [ids.sellerUser, ids.retentionRace],
    );
    assert.equal(lockedGuard.rows[0].active, false);

    await contender.query("BEGIN");
    const competingLock = contender.query(
      'SELECT id FROM public."Order" WHERE id = $1 FOR UPDATE',
      [ids.retentionRace],
    );
    const acquiredEarly = await Promise.race([
      competingLock.then(() => true),
      delay(200).then(() => false),
    ]);
    assert.equal(
      acquiredEarly,
      false,
      "Case opener acquired the Order before the transition released it",
    );
    await runtime.query("COMMIT");
    await competingLock;
    await seedCase(contender, ids.retentionRace, "OPEN", "race");
    await contender.query("COMMIT");
    assert.equal(
      await sellerGuard(runtime, ids.sellerUser, ids.retentionRace),
      true,
    );
    checks.push("order-lock-serializes-case-open");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    await runtime.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [`${PREFIX}-caller-context`],
    );
    const contextGuard = await runtime.query(
      `
        SELECT
          public.grainline_case_order_active_for_buyer($1, $2) AS active,
          pg_catalog.current_setting('app.user_id', true) AS actor
      `,
      [ids.buyer, ids.activeOrder],
    );
    assert.equal(contextGuard.rows[0].active, true);
    assert.equal(
      contextGuard.rows[0].actor,
      `${PREFIX}-caller-context`,
      "Case-aware Order authority changed the caller's RLS context",
    );
    await runtime.query("ROLLBACK");
    checks.push("caller-context-unchanged");

    assert.deepEqual(
      await fixtureCounts(owner),
      {
        users: 6,
        sellers: 3,
        listings: 3,
        orders: 12,
        items: 12,
        cases: 5,
        quotes: 4,
      },
      "Case-aware Order proof changed protected state outside the intended race fixture",
    );
    checks.push("expected-state-before-cleanup");
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await contender.query("ROLLBACK").catch(() => {});
    if (rlsChanged) {
      await restoreProofRls(owner);
    }
    await cleanupFixtures(owner).catch(() => {});
    const residue = await fixtureCounts(owner).catch(() => null);
    await Promise.all([
      owner.end().catch(() => {}),
      runtime.end().catch(() => {}),
      contender.end().catch(() => {}),
    ]);
    assert.deepEqual(
      residue,
      {
        users: 0,
        sellers: 0,
        listings: 0,
        orders: 0,
        items: 0,
        cases: 0,
        quotes: 0,
      },
      "Case-aware Order proof left fixture residue",
    );
  }
  assert.equal(checks.length, 13);
  return Object.freeze({ checks: Object.freeze([...checks]) });
}

const isDirectRun =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCaseOrderActiveProof()
    .then(({ checks }) => {
      process.stdout.write(
        `Case-aware Order PostgreSQL proof passed ${checks.length} checks.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Case-aware Order PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
