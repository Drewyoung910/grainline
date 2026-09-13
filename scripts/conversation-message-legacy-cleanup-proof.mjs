#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  CONVERSATION_MESSAGE_LEGACY_COUNTS_SQL,
  normalizeConversationMessageLegacyCounts,
} from "./conversation-message-legacy-inspect.mjs";

const { Client } = pg;

const databaseUrl =
  process.env.CONVERSATION_MESSAGE_LEGACY_CLEANUP_PROOF_DATABASE_URL;
const migrationSql = readFileSync(
  "prisma/migrations/20260726013500_repair_legacy_custom_order_link_context/migration.sql",
  "utf8",
);

const pairs = Object.freeze([
  Object.freeze({
    buyerId: "cm-cleanup-a-buyer",
    sellerId: "cm-cleanup-a-seller",
    sellerProfileId: "cm-cleanup-a-profile",
    conversationId: "cm-cleanup-a-conversation",
    listingId: "cm-cleanup-a-listing",
    messageId: "cm-cleanup-a-message",
  }),
  Object.freeze({
    buyerId: "cm-cleanup-b-buyer",
    sellerId: "cm-cleanup-b-seller",
    sellerProfileId: "cm-cleanup-b-profile",
    conversationId: "cm-cleanup-b-conversation",
    listingId: "cm-cleanup-b-listing",
    messageId: "cm-cleanup-b-message",
  }),
]);
const completedChecks = [];

function record(check) {
  completedChecks.push(check);
}

function validateTarget(rawUrl) {
  assert.ok(
    rawUrl,
    "CONVERSATION_MESSAGE_LEGACY_CLEANUP_PROOF_DATABASE_URL is required",
  );
  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1",
    "Conversation/Message legacy cleanup proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "Conversation/Message legacy cleanup proof requires grainline_ci",
  );
}

async function cleanFixtures(client) {
  await client.query(
    'DELETE FROM public."Message" WHERE id = ANY($1::text[])',
    [pairs.map((pair) => pair.messageId)],
  );
  await client.query(
    'DELETE FROM public."Listing" WHERE id = ANY($1::text[])',
    [pairs.map((pair) => pair.listingId)],
  );
  await client.query(
    'DELETE FROM public."Conversation" WHERE id = ANY($1::text[])',
    [pairs.map((pair) => pair.conversationId)],
  );
  await client.query(
    'DELETE FROM public."SellerProfile" WHERE id = ANY($1::text[])',
    [pairs.map((pair) => pair.sellerProfileId)],
  );
  await client.query(
    'DELETE FROM public."User" WHERE id = ANY($1::text[])',
    [pairs.flatMap((pair) => [pair.buyerId, pair.sellerId])],
  );
}

async function seedPair(client, pair, { malformed = false } = {}) {
  await client.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, "updatedAt"
     ) VALUES
       ($1, $2, $3, 'Cleanup Buyer', pg_catalog.clock_timestamp()),
       ($4, $5, $6, 'Cleanup Seller', pg_catalog.clock_timestamp())`,
    [
      pair.buyerId,
      `clerk_${pair.buyerId}`,
      `${pair.buyerId}@example.invalid`,
      pair.sellerId,
      `clerk_${pair.sellerId}`,
      `${pair.sellerId}@example.invalid`,
    ],
  );
  await client.query(
    `INSERT INTO public."Conversation" (
       id, "userAId", "userBId", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3,
       '2026-01-01T00:00:00Z',
       '2026-01-01T00:00:00Z'
     )`,
    [pair.conversationId, pair.buyerId, pair.sellerId],
  );
  await client.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "updatedAt"
     ) VALUES (
       $1, $2, 'Cleanup Workshop', 'cleanup workshop',
       pg_catalog.clock_timestamp()
     )`,
    [pair.sellerProfileId, pair.sellerId],
  );
  await client.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents", currency,
       status, "isPrivate", "reservedForUserId",
       "customOrderConversationId", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Cleanup Listing', 'Disposable cleanup proof listing',
       25000, 'usd', 'ACTIVE', true, $3, $4,
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [
      pair.listingId,
      pair.sellerProfileId,
      pair.buyerId,
      pair.conversationId,
    ],
  );
  await client.query(
    `INSERT INTO public."Message" (
       id, "conversationId", "senderId", "recipientId",
       "contextListingId", body, kind, "isSystemMessage", "createdAt"
     ) VALUES (
       $1, $2, $3, $4, NULL, $5, 'custom_order_link', true,
       '2026-01-02T00:00:00Z'
     )`,
    [
      pair.messageId,
      pair.conversationId,
      pair.sellerId,
      pair.buyerId,
      malformed ? "not-json" : JSON.stringify({ listingId: pair.listingId }),
    ],
  );
}

async function readCounts(client) {
  const result = await client.query(CONVERSATION_MESSAGE_LEGACY_COUNTS_SQL);
  return normalizeConversationMessageLegacyCounts(result.rows[0]);
}

async function expectMigrationFailure(client, label) {
  try {
    await client.query(migrationSql);
  } catch (error) {
    assert.equal(error?.code, "P0001", `${label} used an unexpected error code`);
    await client.query("ROLLBACK").catch(() => {});
    return;
  }
  assert.fail(`${label} unexpectedly succeeded`);
}

async function proveExactRepair(client) {
  await seedPair(client, pairs[0]);
  const before = await readCounts(client);
  assert.equal(before.customLinkMissingContextCount, 1);
  assert.equal(before.repairableCustomLinkMissingContextCount, 1);
  assert.equal(before.unrepairableCustomLinkMissingContextCount, 0);

  await client.query(migrationSql);
  const repaired = await client.query(
    `SELECT "contextListingId"
       FROM public."Message"
      WHERE id = $1`,
    [pairs[0].messageId],
  );
  assert.deepEqual(repaired.rows, [{
    contextListingId: pairs[0].listingId,
  }]);
  const after = await readCounts(client);
  assert.equal(after.customLinkMissingContextCount, 0);
  assert.equal(after.repairableCustomLinkMissingContextCount, 0);
  assert.equal(after.unrepairableCustomLinkMissingContextCount, 0);
  assert.equal(after.invalidCustomLinkSourceCount, 0);
  assert.equal(after.duplicateCustomLinkSourceGroupCount, 0);

  await client.query(migrationSql);
  const repeated = await readCounts(client);
  assert.equal(repeated.customLinkMissingContextCount, 0);
  assert.equal(repeated.invalidCustomLinkSourceCount, 0);
  record("exact_migration_repairs_one_validated_source_and_is_idempotent");
}

async function proveMalformedFailsClosed(client) {
  await cleanFixtures(client);
  await seedPair(client, pairs[0], { malformed: true });
  await expectMigrationFailure(client, "malformed legacy source");
  const row = await client.query(
    `SELECT "contextListingId"
       FROM public."Message"
      WHERE id = $1`,
    [pairs[0].messageId],
  );
  assert.deepEqual(row.rows, [{ contextListingId: null }]);
  const counts = await readCounts(client);
  assert.equal(counts.repairableCustomLinkMissingContextCount, 0);
  assert.equal(counts.unrepairableCustomLinkMissingContextCount, 1);
  record("malformed_source_fails_closed_without_mutation");
}

async function proveTwoRowsFailClosed(client) {
  await cleanFixtures(client);
  await seedPair(client, pairs[0]);
  await seedPair(client, pairs[1]);
  await expectMigrationFailure(client, "two-row legacy scope");
  const rows = await client.query(
    `SELECT "contextListingId"
       FROM public."Message"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [pairs.map((pair) => pair.messageId)],
  );
  assert.deepEqual(rows.rows, [
    { contextListingId: null },
    { contextListingId: null },
  ]);
  const counts = await readCounts(client);
  assert.equal(counts.repairableCustomLinkMissingContextCount, 2);
  assert.equal(counts.unrepairableCustomLinkMissingContextCount, 0);
  record("more_than_one_repairable_source_fails_closed_without_mutation");
}

async function main() {
  validateTarget(databaseUrl);
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "grainline-conversation-message-legacy-cleanup-proof",
  });
  await client.connect();
  try {
    await cleanFixtures(client);
    await proveExactRepair(client);
    await proveMalformedFailsClosed(client);
    await proveTwoRowsFailClosed(client);
  } finally {
    await cleanFixtures(client).catch(() => {});
    await client.end();
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    completedChecks,
    migrationBytesExecuted: true,
    productionChanged: false,
    persistentStagingChanged: false,
  })}\n`);
}

await main();
