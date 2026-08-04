#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "ORDER_SELLER_KEY_COMPATIBILITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const DRAFT = "docs/rls-drafts/order-seller-key-compatibility.sql";

const ids = Object.freeze({
  buyer: "order-seller-key-proof-buyer",
  sellerAUser: "order-seller-key-proof-seller-a-user",
  sellerBUser: "order-seller-key-proof-seller-b-user",
  sellerA: "order-seller-key-proof-seller-a",
  sellerB: "order-seller-key-proof-seller-b",
  listingA: "order-seller-key-proof-listing-a",
  listingB: "order-seller-key-proof-listing-b",
  legacyOrder: "order-seller-key-proof-legacy-order",
  legacyItem: "order-seller-key-proof-legacy-item",
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderSellerKeyCompatibilityProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Order seller-key compatibility proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Order seller-key compatibility proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Order seller-key compatibility proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export function readOrderSellerKeyDraftBody(path = DRAFT) {
  const sql = fs.readFileSync(path, "utf8").trim();
  assert.match(sql, /\bDRAFT ONLY\b/);
  assert.match(sql, /^--[\s\S]*?\nBEGIN;\s*/);
  assert.match(sql, /\sCOMMIT;\s*$/);
  return sql
    .replace(/^([\s\S]*?\n)BEGIN;\s*/, "$1")
    .replace(/\sCOMMIT;\s*$/, "\n");
}

async function expectPostgresError(client, name, work, pattern) {
  const savepoint = `proof_${name.replace(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  assert.ok(caught, `${name} unexpectedly succeeded`);
  const caughtMessage = safeError(caught);
  assert.match(
    caughtMessage,
    pattern,
    `${name}: unexpected PostgreSQL error: ${caughtMessage}`,
  );
}

async function seedIdentityFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Proof buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Proof seller A', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Proof seller B', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.buyer,
    `clerk-${ids.buyer}`,
    `${ids.buyer}@example.invalid`,
    ids.sellerAUser,
    `clerk-${ids.sellerAUser}`,
    `${ids.sellerAUser}@example.invalid`,
    ids.sellerBUser,
    `clerk-${ids.sellerBUser}`,
    `${ids.sellerBUser}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, 'Proof seller A', 'proof seller a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($3, $4, 'Proof seller B', 'proof seller b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.sellerA, ids.sellerAUser, ids.sellerB, ids.sellerBUser]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, 'Proof listing A', 'Disposable seller-key proof.', 1000,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($3, $4, 'Proof listing B', 'Disposable seller-key proof.', 2000,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.listingA, ids.sellerA, ids.listingB, ids.sellerB]);
}

async function seedLegacyOrder(client, orderId, itemId, listingId) {
  await client.query(
    'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
    [orderId, ids.buyer],
  );
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 1000)
  `, [itemId, orderId, listingId]);
}

async function provePreflightRejects(client, draftBody, mode) {
  await client.query("BEGIN");
  try {
    await seedIdentityFixtures(client);
    if (mode === "zero-item") {
      await client.query(
        'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
        ["order-seller-key-proof-zero-item", ids.buyer],
      );
    } else {
      await seedLegacyOrder(
        client,
        "order-seller-key-proof-multi",
        "order-seller-key-proof-multi-a",
        ids.listingA,
      );
      await client.query(`
        INSERT INTO public."OrderItem" (
          id, "orderId", "listingId", quantity, "priceCents"
        )
        VALUES ($1, $2, $3, 1, 2000)
      `, [
        "order-seller-key-proof-multi-b",
        "order-seller-key-proof-multi",
        ids.listingB,
      ]);
    }
    let caught;
    try {
      await client.query(draftBody);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `${mode} legacy preflight unexpectedly passed`);
    assert.match(
      safeError(caught),
      mode === "zero-item" ? /zero-item order/ : /multi-seller order/,
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

async function proveCatalog(client) {
  const columns = await client.query(`
    SELECT table_name, is_nullable, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('Order', 'OrderItem')
       AND column_name = 'sellerProfileId'
     ORDER BY table_name
  `);
  assert.deepEqual(columns.rows, [
    { table_name: "Order", is_nullable: "YES", data_type: "text" },
    { table_name: "OrderItem", is_nullable: "YES", data_type: "text" },
  ]);

  const catalog = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conname IN (
          'Order_id_sellerProfileId_key',
          'Listing_id_sellerId_key',
          'Order_sellerProfileId_fkey',
          'OrderItem_sellerProfileId_fkey',
          'OrderItem_orderId_sellerProfileId_fkey',
          'OrderItem_listingId_sellerProfileId_fkey'
        )
          AND constraint_state.convalidated) AS constraint_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_indexes AS index_state
        WHERE index_state.schemaname = 'public'
          AND index_state.indexname IN (
            'Order_sellerProfileId_createdAt_id_idx',
            'Order_sellerProfileId_fulfillmentStatus_createdAt_id_idx',
            'OrderItem_sellerProfileId_createdAt_id_idx'
          )) AS index_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'grainline_order_item_seller_key_bind',
            'grainline_order_seller_key_assert',
            'grainline_order_seller_key_complete',
            'grainline_order_item_seller_key_complete'
          )
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          AND NOT pg_catalog.has_function_privilege(
            'grainline_app_runtime', procedure.oid, 'EXECUTE'
          )) AS private_function_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_trigger AS trigger_state
        WHERE trigger_state.tgname IN (
          'grainline_order_item_seller_key_bind',
          'grainline_order_seller_key_complete',
          'grainline_order_item_seller_key_complete'
        )
          AND NOT trigger_state.tgisinternal) AS trigger_count
  `);
  assert.deepEqual(catalog.rows, [{
    constraint_count: 6,
    index_count: 3,
    private_function_count: 4,
    trigger_count: 3,
  }]);
}

async function proveCompatibility(client) {
  const legacy = await client.query(`
    SELECT
      orders."sellerProfileId" AS order_seller,
      item."sellerProfileId" AS item_seller
      FROM public."Order" AS orders
      JOIN public."OrderItem" AS item ON item."orderId" = orders.id
     WHERE orders.id = $1
  `, [ids.legacyOrder]);
  assert.deepEqual(legacy.rows, [{
    order_seller: ids.sellerA,
    item_seller: ids.sellerA,
  }]);

  await client.query(
    'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
    ["order-seller-key-proof-old-app", ids.buyer],
  );
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 1000)
  `, [
    "order-seller-key-proof-old-app-item",
    "order-seller-key-proof-old-app",
    ids.listingA,
  ]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");

  const oldApp = await client.query(`
    SELECT orders."sellerProfileId" AS order_seller,
           item."sellerProfileId" AS item_seller
      FROM public."Order" AS orders
      JOIN public."OrderItem" AS item ON item."orderId" = orders.id
     WHERE orders.id = $1
  `, ["order-seller-key-proof-old-app"]);
  assert.deepEqual(oldApp.rows, [{
    order_seller: ids.sellerA,
    item_seller: ids.sellerA,
  }]);

  await client.query(`
    INSERT INTO public."Order" (id, "buyerId", "sellerProfileId")
    VALUES ($1, $2, $3)
  `, ["order-seller-key-proof-new-app", ids.buyer, ids.sellerA]);
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, $4, 1, 1000)
  `, [
    "order-seller-key-proof-new-app-item",
    "order-seller-key-proof-new-app",
    ids.listingA,
    ids.sellerA,
  ]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");

  await expectPostgresError(
    client,
    "forged_item_seller",
    () => client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, $4, 1, 1000)
    `, [
      "order-seller-key-proof-forged-item",
      "order-seller-key-proof-new-app",
      ids.listingA,
      ids.sellerB,
    ]),
    /does not match Listing seller/,
  );

  await expectPostgresError(
    client,
    "cross_seller_item",
    () => client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 2000)
    `, [
      "order-seller-key-proof-cross-seller-item",
      "order-seller-key-proof-new-app",
      ids.listingB,
    ]),
    /cannot contain items from multiple sellers/,
  );

  await expectPostgresError(
    client,
    "authority_key_rebinding",
    () => client.query(`
      UPDATE public."OrderItem"
         SET "listingId" = $2
       WHERE id = $1
    `, ["order-seller-key-proof-new-app-item", ids.listingB]),
    /authority keys are immutable/,
  );

  await expectPostgresError(
    client,
    "purchased_listing_seller_rebinding",
    () => client.query(`
      UPDATE public."Listing"
         SET "sellerId" = $2
       WHERE id = $1
    `, [ids.listingA, ids.sellerB]),
    /OrderItem_listingId_sellerProfileId_fkey/,
  );

  await expectPostgresError(
    client,
    "zero_item_order",
    async () => {
      await client.query(`
        INSERT INTO public."Order" (id, "buyerId", "sellerProfileId")
        VALUES ($1, $2, $3)
      `, ["order-seller-key-proof-empty", ids.buyer, ids.sellerA]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },
    /durable seller key is incomplete or inconsistent/,
  );

  await expectPostgresError(
    client,
    "delete_last_item",
    async () => {
      await client.query(
        'DELETE FROM public."OrderItem" WHERE id = $1',
        ["order-seller-key-proof-new-app-item"],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },
    /durable seller key is incomplete or inconsistent/,
  );
}

export async function runOrderSellerKeyCompatibilityProof(env = process.env) {
  const { databaseUrl } = parseOrderSellerKeyCompatibilityProofConfig(env);
  const client = new Client({
    application_name: "grainline-order-seller-key-compatibility-proof",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 55_000,
    statement_timeout: 50_000,
  });
  await client.connect();
  let transactionOpen = false;
  try {
    const draftBody = readOrderSellerKeyDraftBody();
    await provePreflightRejects(client, draftBody, "zero-item");
    await provePreflightRejects(client, draftBody, "multi-seller");

    await client.query("BEGIN");
    transactionOpen = true;
    await seedIdentityFixtures(client);
    await seedLegacyOrder(
      client,
      ids.legacyOrder,
      ids.legacyItem,
      ids.listingA,
    );
    await client.query(draftBody);
    await proveCatalog(client);
    await proveCompatibility(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      checks: 12,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-draft-rollback",
      status: "passed",
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runOrderSellerKeyCompatibilityProof()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        message: safeError(error),
        persistentStagingChanged: false,
        productionChanged: false,
        status: "failed",
      })}\n`);
      process.exitCode = 1;
    });
}
