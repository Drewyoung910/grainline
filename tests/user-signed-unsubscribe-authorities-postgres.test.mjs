import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004020000_prepare_user_signed_unsubscribe_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email text NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL,
      "deletedAt" timestamp(3) without time zone,
      "notificationPreferences" jsonb,
      "emailPreferenceOptInAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    REVOKE ALL ON TABLE public."User" FROM PUBLIC, grainline_app_runtime;
    INSERT INTO public."User" (
      id, email, "createdAt", "deletedAt", "notificationPreferences",
      "emailPreferenceOptInAt", "updatedAt"
    ) VALUES
      ('old_exact', 'old@example.com', '2026-10-01', NULL,
        '{"EMAIL_NEW_MESSAGE":true,"NEW_MESSAGE":true,"UNKNOWN":true}', NULL, '2026-10-01'),
      ('new_exact', 'new@example.com', '2026-10-03', NULL,
        '{"EMAIL_NEW_ORDER":true,"NEW_ORDER":true}', NULL, '2026-10-03'),
      ('deleted_new', 'deleted@example.com', '2026-10-03', '2026-10-03',
        '{"EMAIL_CASE_OPENED":true}', NULL, '2026-10-03'),
      ('new_opt_in', 'opt@example.com', '2026-10-01', '2026-10-03',
        '{"EMAIL_NEW_REVIEW":true}', '2026-10-03', '2026-10-03'),
      ('gmail_one', 'Drew.You+market@GoogleMail.com', '2026-10-01', NULL,
        '{"EMAIL_SELLER_BROADCAST":true,"SELLER_BROADCAST":true}', NULL, '2026-10-01'),
      ('gmail_two', 'd.r.e.w.y.o.u@gmail.com', '2026-10-01', NULL,
        '{"EMAIL_NEW_MESSAGE":true,"CUSTOM":42}', NULL, '2026-10-01');
  `);
  await database.exec(migration);
  return database;
}

test("runtime supersession authority preserves creation, deletion, opt-in, and Gmail semantics", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    for (const [key, expected] of [
      ["old@example.com", false],
      ["new@example.com", true],
      ["deleted@example.com", false],
      ["opt@example.com", true],
      ["drewyou@gmail.com", false],
    ]) {
      const row = (await database.query(`
        SELECT public.grainline_user_unsubscribe_token_superseded(
          ARRAY['${key}']::text[], '2026-10-02'::timestamp
        ) AS superseded
      `)).rows[0];
      assert.deepEqual(row, { superseded: expected }, key);
    }
    await assert.rejects(
      database.query(`SELECT * FROM public."User"`),
      /permission denied for table User/,
    );
  } finally {
    await database.close();
  }
});

test("runtime unsubscribe disables every matching email preference and preserves other keys", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const row = (await database.query(`
      SELECT public.grainline_user_unsubscribe_preferences_disable(
        ARRAY['drewyou@gmail.com']::text[]
      ) AS updated
    `)).rows[0];
    assert.deepEqual(row, { updated: 2 });
    await database.exec("RESET ROLE");
    const users = (await database.query(`
      SELECT id, "notificationPreferences" AS preferences
        FROM public."User"
       WHERE id IN ('gmail_one', 'gmail_two')
       ORDER BY id
    `)).rows;
    assert.equal(users.length, 2);
    for (const user of users) {
      for (const [key, enabled] of Object.entries(user.preferences)) {
        if (key.startsWith("EMAIL_")) assert.equal(enabled, false, `${user.id}:${key}`);
      }
    }
    assert.equal(users[0].preferences.SELLER_BROADCAST, true);
    assert.equal(users[1].preferences.CUSTOM, 42);
  } finally {
    await database.close();
  }
});

test("invalid and untrusted unsubscribe calls fail closed", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT public.grainline_user_unsubscribe_preferences_disable(ARRAY[' Mixed@example.com']::text[])`),
      /User unsubscribe suppression key is invalid/,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`SELECT public.grainline_user_unsubscribe_token_superseded(ARRAY['old@example.com']::text[], '2026-10-02'::timestamp)`),
      /permission denied for function grainline_user_unsubscribe_token_superseded/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_unsubscribe_preferences_disable(ARRAY['old@example.com']::text[])`),
      /permission denied for function grainline_user_unsubscribe_preferences_disable/,
    );
  } finally {
    await database.close();
  }
});
