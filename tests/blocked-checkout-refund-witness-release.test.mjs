import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  process.env.BLOCKED_CHECKOUT_REFUND_WITNESS_MIGRATION_PATH ||
  "prisma/migrations/20261015030000_preserve_blocked_checkout_refund_witness/migration.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const as = source.indexOf("AS $", start);
  const firstNewline = source.indexOf("\n", as);
  const delimiter = source.slice(as + 3, firstNewline).trim();
  const end = source.indexOf(`${delimiter};`, firstNewline + 1);
  assert.ok(as > start && firstNewline > as && end > firstNewline);
  return source.slice(firstNewline, end);
}

function bodyMd5(source, name) {
  return crypto.createHash("md5").update(functionBody(source, name)).digest("hex");
}

function readMigration(name) {
  const livePath = path.join("prisma", "migrations", name, "migration.sql");
  if (fs.existsSync(livePath)) return fs.readFileSync(livePath, "utf8");
  const fullChainMigrationsDirectory =
    process.env.DATABASE_FULL_CHAIN_TEST_MIGRATIONS_DIR;
  assert.ok(
    fullChainMigrationsDirectory && path.isAbsolute(fullChainMigrationsDirectory),
    `missing absolute full-chain migration source for ${name}`,
  );
  const stagedPath = path.join(
    fullChainMigrationsDirectory,
    name,
    "migration.sql",
  );
  assert.ok(fs.existsSync(stagedPath), `missing full-chain migration ${name}`);
  return fs.readFileSync(stagedPath, "utf8");
}

function doBlock(name) {
  const delimiter = `$${name}$`;
  const start = migration.indexOf(`DO ${delimiter}`);
  const end = migration.indexOf(`${delimiter};`, start);
  assert.ok(start >= 0 && end > start, `${name} must exist`);
  return migration.slice(start, end + delimiter.length + 1);
}

function migrationSlice(startMarker, endMarker) {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} slice must exist`);
  return migration.slice(start, end);
}

const predecessors = [
  [
    "grainline_stripe_checkout_order_create",
    "20261013200000_move_final_seller_private_sql_callers",
    "40526540c1a893e3a886dc95d42090b5",
  ],
  [
    "grainline_stripe_checkout_order_existing",
    "20260905140000_prepare_order_checkout_existing_authority",
    "ad7e1062ed3590cff2b33c2aa2196bf6",
  ],
  [
    "grainline_stripe_checkout_postpayment",
    "20260905150000_prepare_order_checkout_postpayment_authority",
    "29bf0946a48fe5b42f6ebe9e1a2cadd2",
  ],
  [
    "grainline_order_refund_blocks_fulfillment",
    "20261002010000_allow_partial_refund_fulfillment",
    "5d1e44442aad1df2fdd631243291f912",
  ],
  [
    "grainline_blocked_checkout_refund_record_core",
    "20261015020000_repair_immutable_order_refund_recording",
    "eb55c5fc48cd5e96c6516c134d75df87",
  ],
];

const installed = [
  [
    "grainline_order_blocked_checkout_refund_witness_immutable",
    "32e59879ff050dfeda5bd73ac5b866b2",
  ],
  ["grainline_stripe_checkout_order_create", "1de0b7b0f4ec0871ad5dfceb354ba0b1"],
  ["grainline_stripe_checkout_order_existing", "4bd7580c27318ff118ea9640c3dd72b0"],
  ["grainline_stripe_checkout_postpayment", "b48cadd3f5dd4d2a83d5146282ec12be"],
  ["grainline_order_refund_blocks_fulfillment", "bdbbca2e9595d644e08a310af35bed69"],
  ["grainline_blocked_checkout_refund_record_core", "137aed9785f7db03a0d9980cd2619dac"],
];

test("witness migration binds the exact predecessor and installed function bodies", () => {
  for (const [name, predecessorMigration, expectedMd5] of predecessors) {
    assert.equal(bodyMd5(readMigration(predecessorMigration), name), expectedMd5);
    assert.match(migration, new RegExp(expectedMd5, "u"));
  }
  for (const [name, expectedMd5] of installed) {
    assert.equal(bodyMd5(migration, name), expectedMd5);
    assert.match(migration, new RegExp(expectedMd5, "u"));
  }
});

test("witness preflight refuses an incomplete predecessor catalog", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TABLE public."Order" (id text PRIMARY KEY);
    `);
    await assert.rejects(
      database.exec(doBlock("grainline_blocked_checkout_refund_witness_preflight")),
      /predecessor catalog drifted: accepted=0/u,
    );
  } finally {
    await database.close();
  }
});

test("witness postflight refuses a missing installed catalog", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TABLE public."Order" (id text PRIMARY KEY);
    `);
    await assert.rejects(
      database.exec(doBlock("grainline_blocked_checkout_refund_witness_postflight")),
      /columns drifted: accepted=0/u,
    );
  } finally {
    await database.close();
  }
});

test("timestamp(3) witness columns use PostgreSQL precision typmod 3", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "blockedCheckoutRefundRequiredAt" timestamp(3) without time zone,
        "blockedCheckoutRefundRecordedAt" timestamp(3) without time zone
      );
    `);
    const catalog = await database.query(`
      SELECT attribute.attname, attribute.atttypmod
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
         AND attribute.attname IN (
           'blockedCheckoutRefundRequiredAt',
           'blockedCheckoutRefundRecordedAt'
         )
       ORDER BY attribute.attname
    `);
    assert.deepEqual(catalog.rows, [
      { attname: "blockedCheckoutRefundRecordedAt", atttypmod: 3 },
      { attname: "blockedCheckoutRefundRequiredAt", atttypmod: 3 },
    ]);
  } finally {
    await database.close();
  }
});

test("historical backfill retains blocked-checkout evidence after the mutable note changes", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "createdAt" timestamp(3) without time zone NOT NULL,
        "refundClaimSource" text,
        "reviewNote" text
      );
      CREATE TABLE public."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL,
        "createdAt" timestamp(3) without time zone NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE public."OrderRefundReconciliation" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL,
        "claimSource" text NOT NULL,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY,
        action text NOT NULL,
        "targetType" text NOT NULL,
        "targetId" text NOT NULL,
        reason text,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      INSERT INTO public."Order" (
        id, "createdAt", "refundClaimSource", "reviewNote"
      ) VALUES (
        'audit-only', '2026-01-01', NULL, 'Dispute replaced the checkout note.'
      );
      INSERT INTO public."SystemAuditLog" (
        id, action, "targetType", "targetId", reason, "createdAt"
      ) VALUES (
        'checkout-created', 'STRIPE_CHECKOUT_ORDER_CREATED', 'ORDER',
        'audit-only', 'Seller was blocked before checkout completed.', '2026-01-01'
      );
    `);
    await database.exec(migrationSlice(
      'ALTER TABLE public."Order"\n  ADD COLUMN "blockedCheckoutRefundRequiredAt"',
      'ALTER TABLE public."Order"\n  ADD CONSTRAINT "Order_blockedCheckoutRefundWitness_check"',
    ));
    const order = (await database.query(`
      SELECT "blockedCheckoutRefundRequiredAt" AS required_at
        FROM public."Order"
       WHERE id = 'audit-only'
    `)).rows[0];
    assert.ok(order.required_at instanceof Date);
  } finally {
    await database.close();
  }
});
