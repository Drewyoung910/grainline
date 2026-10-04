import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004030000_prepare_user_email_delivery_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      name text,
      email text NOT NULL UNIQUE,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "notificationPreferences" jsonb
    );
    REVOKE ALL ON TABLE public."User" FROM PUBLIC, grainline_app_runtime;
    INSERT INTO public."User" (
      id, name, email, banned, "deletedAt", "notificationPreferences"
    ) VALUES
      ('active_default', 'Active', 'active@example.com', false, NULL, '{}'),
      ('opted_out', 'Opted out', 'out@example.com', false, NULL,
        '{"EMAIL_NEW_MESSAGE":false}'),
      ('malformed_pref', 'Malformed', 'malformed@example.com', false, NULL,
        '{"EMAIL_NEW_MESSAGE":"false"}'),
      ('broadcast_on', 'Broadcast', 'broadcast@example.com', false, NULL,
        '{"EMAIL_SELLER_BROADCAST":true}'),
      ('broadcast_off', 'Broadcast off', 'broadcast-off@example.com', false, NULL,
        '{}'),
      ('banned_user', 'Banned', 'banned@example.com', true, NULL, '{}'),
      ('deleted_user', 'Deleted', 'deleted@example.com', false, '2026-10-04', '{}'),
      ('invalid_email', 'Invalid', 'not-an-email', false, NULL, '{}');
  `);
  await database.exec(migration);
  return database;
}

test("runtime recipient authorities preserve active and preference semantics", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT * FROM public.grainline_user_email_recipient(
        'active_default', 'EMAIL_NEW_MESSAGE'
      )
    `)).rows;
    assert.deepEqual(rows, [{ userId: "active_default", name: "Active", email: "active@example.com" }]);

    for (const id of ["opted_out", "banned_user", "deleted_user", "invalid_email"] ) {
      const denied = (await database.query(`
        SELECT * FROM public.grainline_user_email_recipient(
          '${id}', 'EMAIL_NEW_MESSAGE'
        )
      `)).rows;
      assert.deepEqual(denied, [], id);
    }
    const malformed = (await database.query(`
      SELECT * FROM public.grainline_user_email_recipient(
        'malformed_pref', 'EMAIL_NEW_MESSAGE'
      )
    `)).rows;
    assert.equal(malformed.length, 1);
    const broadcastOn = (await database.query(`
      SELECT * FROM public.grainline_user_email_recipient(
        'broadcast_on', 'EMAIL_SELLER_BROADCAST'
      )
    `)).rows;
    const broadcastOff = (await database.query(`
      SELECT * FROM public.grainline_user_email_recipient(
        'broadcast_off', 'EMAIL_SELLER_BROADCAST'
      )
    `)).rows;
    assert.equal(broadcastOn.length, 1);
    assert.deepEqual(broadcastOff, []);
    await assert.rejects(
      database.query(`SELECT * FROM public."User"`),
      /permission denied for table User/,
    );
  } finally {
    await database.close();
  }
});

test("runtime batch authority is bounded, deduplicated, and first-input ordered", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT * FROM public.grainline_user_email_recipient_batch(
        ARRAY['broadcast_on', 'active_default', 'broadcast_on', 'opted_out']::text[],
        'EMAIL_NEW_MESSAGE'
      )
    `)).rows;
    assert.deepEqual(rows.map((row) => row.userId), ["broadcast_on", "active_default"]);
    await assert.rejects(
      database.query(`
        SELECT * FROM public.grainline_user_email_recipient_batch(
          pg_catalog.array_fill('active_default'::text, ARRAY[501]),
          'EMAIL_NEW_MESSAGE'
        )
      `),
      /User email recipient batch input is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("runtime account-state authorities bind queued email continuity", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    for (const [id, email, expected] of [
      ["active_default", "active@example.com", "active"],
      ["active_default", "prior@example.com", "email_changed"],
      ["banned_user", "banned@example.com", "banned"],
      ["deleted_user", "deleted@example.com", "deleted"],
      ["missing_user", "missing@example.com", "missing"],
    ]) {
      const row = (await database.query(`
        SELECT public.grainline_user_email_account_state_by_id(
          '${id}', '${email}'
        ) AS state
      `)).rows[0];
      assert.deepEqual(row, { state: expected }, id);
    }
    for (const [email, expected] of [
      ["active@example.com", "active"],
      ["banned@example.com", "banned"],
      ["deleted@example.com", "deleted"],
      ["missing@example.com", "missing"],
    ]) {
      const row = (await database.query(`
        SELECT public.grainline_user_email_account_state_by_email('${email}') AS state
      `)).rows[0];
      assert.deepEqual(row, { state: expected }, email);
    }
  } finally {
    await database.close();
  }
});

test("invalid and untrusted recipient calls fail closed", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_user_email_recipient('active_default', 'NOT_A_KEY')`),
      /User email recipient input is invalid/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_user_email_account_state_by_email(' Mixed@example.com')`),
      /User email account-state input is invalid/,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    for (const sql of [
      `SELECT * FROM public.grainline_user_email_recipient('active_default', NULL)`,
      `SELECT * FROM public.grainline_user_email_recipient_batch(ARRAY['active_default']::text[], 'EMAIL_NEW_MESSAGE')`,
      `SELECT public.grainline_user_email_account_state_by_id('active_default', 'active@example.com')`,
      `SELECT public.grainline_user_email_account_state_by_email('active@example.com')`,
    ]) {
      await assert.rejects(database.query(sql), /permission denied for function/);
    }
  } finally {
    await database.close();
  }
});
