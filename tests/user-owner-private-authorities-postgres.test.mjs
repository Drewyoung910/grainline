import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004010000_prepare_user_owner_private_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "shippingName" varchar(100),
      "shippingLine1" varchar(200),
      "shippingLine2" varchar(200),
      "shippingCity" varchar(100),
      "shippingState" varchar(50),
      "shippingPostalCode" varchar(20),
      "shippingPhone" varchar(30),
      "termsAcceptedAt" timestamp(3) without time zone,
      "termsVersion" varchar(50),
      "ageAttestedAt" timestamp(3) without time zone,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "emailPreferenceOptInAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT current_timestamp
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('user_active', false, NULL),
      ('user_banned', true, NULL),
      ('user_deleted', false, current_timestamp);
  `);
  await database.exec(migration);
  return database;
}

test("runtime owner-private operations mutate only the active matching user", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const shipping = (await database.query(`
      SELECT public.grainline_user_owner_shipping_address_update(
        'user_active', 'Ada Lovelace', '123 Main St', NULL,
        'Madison', 'WI', '53703', '608-555-0100'
      ) AS updated
    `)).rows[0];
    assert.deepEqual(shipping, { updated: true });
    const blockedShipping = (await database.query(`
      SELECT public.grainline_user_owner_shipping_address_update(
        'user_banned', 'Blocked', '1 Main St', NULL,
        'Madison', 'WI', '53703', NULL
      ) AS updated
    `)).rows[0];
    assert.deepEqual(blockedShipping, { updated: false });

    const legal = (await database.query(`
      SELECT * FROM public.grainline_user_owner_legal_acceptance(
        'user_active', '2026-06-14'
      )
    `)).rows[0];
    assert.ok(legal.termsAcceptedAt instanceof Date);
    assert.equal(legal.termsVersion, "2026-06-14");
    assert.ok(legal.ageAttestedAt instanceof Date);
    const repeated = (await database.query(`
      SELECT * FROM public.grainline_user_owner_legal_acceptance(
        'user_active', '2026-06-14'
      )
    `)).rows[0];
    assert.deepEqual(repeated, legal);

    const inApp = (await database.query(`
      SELECT public.grainline_user_owner_notification_preference_update(
        'user_active', 'NEW_MESSAGE', false
      ) AS updated
    `)).rows[0];
    assert.deepEqual(inApp, { updated: true });
    await database.exec("RESET ROLE");
    const beforeEmailOptIn = (await database.query(`
      SELECT "notificationPreferences", "emailPreferenceOptInAt"
        FROM public."User" WHERE id = 'user_active'
    `)).rows[0];
    assert.deepEqual(beforeEmailOptIn.notificationPreferences, { NEW_MESSAGE: false });
    assert.equal(beforeEmailOptIn.emailPreferenceOptInAt, null);

    await database.exec("SET ROLE grainline_app_runtime");
    await database.query(`
      SELECT public.grainline_user_owner_notification_preference_update(
        'user_active', 'EMAIL_NEW_MESSAGE', true
      )
    `);
    await database.exec("RESET ROLE");
    const afterEmailOptIn = (await database.query(`
      SELECT "notificationPreferences", "emailPreferenceOptInAt"
        FROM public."User" WHERE id = 'user_active'
    `)).rows[0];
    assert.deepEqual(afterEmailOptIn.notificationPreferences, {
      EMAIL_NEW_MESSAGE: true,
      NEW_MESSAGE: false,
    });
    assert.ok(afterEmailOptIn.emailPreferenceOptInAt instanceof Date);

    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_legal_acceptance('user_active', 'stale')`),
      /Owner legal acceptance input is invalid/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_notification_preference_update('user_active', 'UNKNOWN', true)`),
      /Owner notification preference input is invalid/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_shipping_address_update(
        'user_active', 'Ada', 'Main', NULL, 'Madison', 'XX', '53703', NULL
      )`),
      /Owner shipping address input is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("untrusted callers cannot execute owner-private functions", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_legal_acceptance('user_active', '2026-06-14')`),
      /permission denied for function grainline_user_owner_legal_acceptance/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_notification_preference_update('user_active', 'NEW_MESSAGE', true)`),
      /permission denied for function grainline_user_owner_notification_preference_update/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_owner_shipping_address_update(
        'user_active', 'Ada', 'Main', NULL, 'Madison', 'WI', '53703', NULL
      )`),
      /permission denied for function grainline_user_owner_shipping_address_update/,
    );
  } finally {
    await database.close();
  }
});
