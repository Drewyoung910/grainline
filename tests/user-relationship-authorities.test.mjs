import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261006030000_prepare_user_relationship_authorities/migration.sql";

async function databaseFixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      name text,
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3),
      "imageUrl" text,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "acceptsCustomOrders" boolean NOT NULL DEFAULT false,
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "stripeAccountId" text,
      "stripeAccountVersion" text,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "displayName" text NOT NULL
    );
    CREATE TABLE public."Conversation" (
      id text PRIMARY KEY,
      "userAId" text NOT NULL REFERENCES public."User"(id),
      "userBId" text NOT NULL REFERENCES public."User"(id)
    );
    CREATE TABLE public."UserReport" (
      id text PRIMARY KEY,
      "targetType" text,
      "targetId" text,
      resolved boolean NOT NULL DEFAULT false
    );
  `);
  await database.exec(readFileSync(migrationPath, "utf8"));
  await database.exec(`
    INSERT INTO public."User" (
      id, name, role, banned, "deletedAt", "imageUrl", "notificationPreferences"
    ) VALUES
      ('actor', 'Actor', 'USER', false, NULL, 'actor.jpg', '{"EMAIL_NEW_MESSAGE":false}'),
      ('target', 'Target', 'USER', false, NULL, 'target.jpg', '{}'),
      ('deleted_target', 'Deleted', 'USER', true, CURRENT_TIMESTAMP, NULL, '{}'),
      ('outsider', 'Outsider', 'USER', false, NULL, NULL, '{}'),
      ('staff', 'Staff', 'ADMIN', false, NULL, NULL, '{}');
    INSERT INTO public."SellerProfile" (
      id, "userId", "acceptsCustomOrders", "acceptingNewOrders",
      "stripeAccountId", "stripeAccountVersion", "chargesEnabled",
      "vacationMode", "displayName"
    ) VALUES (
      'seller_target', 'target', true, true, 'acct_target', 'v2', true,
      false, 'Target Shop'
    );
    INSERT INTO public."Conversation" (id, "userAId", "userBId")
    VALUES ('conversation_one', 'actor', 'target');
  `);
  return database;
}

test("relationship projections remain actor- and conversation-bound", async () => {
  const database = await databaseFixture();
  try {
    const target = await database.query(`
      SELECT * FROM public.grainline_user_relationship_target_state('actor', 'target')
    `);
    assert.deepEqual(target.rows, [{
      id: "target",
      name: "Target",
      banned: false,
      deletedAt: null,
    }]);

    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_user_relationship_target_state('actor', 'actor')",
      ),
      /User relationship target input is invalid/,
    );

    const participants = await database.query(`
      SELECT * FROM public.grainline_user_conversation_participants(
        'actor', 'conversation_one'
      )
    `);
    assert.deepEqual(participants.rows.map((row) => row.id), ["actor", "target"]);
    await assert.rejects(
      database.query(`
        SELECT * FROM public.grainline_user_conversation_participants(
          'outsider', 'conversation_one'
        )
      `),
      /User conversation participants are unavailable/,
    );

    await database.exec(`
      INSERT INTO public."UserReport" (id, "targetType", "targetId", resolved)
      VALUES ('report_one', 'MESSAGE_THREAD', 'conversation_one', false)
    `);
    const staffParticipants = await database.query(`
      SELECT * FROM public.grainline_user_conversation_participants(
        'staff', 'conversation_one'
      )
    `);
    assert.deepEqual(staffParticipants.rows.map((row) => row.id), ["actor", "target"]);
  } finally {
    await database.close();
  }
});

test("custom-order and owner projections return only their bounded fields", async () => {
  const database = await databaseFixture();
  try {
    const seller = await database.query(`
      SELECT * FROM public.grainline_user_custom_order_seller_state(
        'actor', 'target'
      )
    `);
    assert.equal(seller.rows.length, 1);
    assert.deepEqual(seller.rows[0], {
      userId: "target",
      banned: false,
      deletedAt: null,
      sellerProfileId: "seller_target",
      acceptsCustomOrders: true,
      acceptingNewOrders: true,
      stripeAccountId: "acct_target",
      stripeAccountVersion: "v2",
      chargesEnabled: true,
      vacationMode: false,
      displayName: "Target Shop",
    });
    const unavailableBuyer = await database.query(`
      SELECT * FROM public.grainline_user_custom_order_seller_state(
        'deleted_target', 'target'
      )
    `);
    assert.deepEqual(unavailableBuyer.rows, []);

    const preferences = await database.query(`
      SELECT public.grainline_user_owner_notification_preferences('actor') AS value
    `);
    assert.deepEqual(preferences.rows, [{ value: { EMAIL_NEW_MESSAGE: false } }]);
    const deletedPreferences = await database.query(`
      SELECT public.grainline_user_owner_notification_preferences('deleted_target') AS value
    `);
    assert.deepEqual(deletedPreferences.rows, [{ value: null }]);
  } finally {
    await database.close();
  }
});

test("User source closes direct calls and provisions every relationship authority", () => {
  const inventory = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/audit-user-direct-calls.mjs", "--json"],
      { encoding: "utf8" },
    ),
  );
  const scannerTest = readFileSync("tests/user-identity-source-inventory.test.mjs", "utf8");
  const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
  const migration = readFileSync(migrationPath, "utf8");

  assert.deepEqual(inventory, { count: 0, files: 0, byMethod: {}, calls: [] });
  assert.match(scannerTest, /assert\.equal\(report\.count, 0\)/);
  assert.match(scannerTest, /assert\.equal\(report\.files, 0\)/);
  for (const functionName of [
    "grainline_user_relationship_target_state",
    "grainline_user_conversation_participants",
    "grainline_user_custom_order_seller_state",
    "grainline_user_owner_notification_preferences",
  ]) {
    assert.match(provision, new RegExp(`public\\."${functionName}"\\(`));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}`));
  }
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
});
