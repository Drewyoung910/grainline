import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004000000_prepare_user_clerk_provider_lifecycle/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "welcomeEmailSentAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT current_timestamp
    );
    INSERT INTO public."User" (id, "clerkId", email, banned, "deletedAt")
    VALUES ('user_active', 'user_clerk_active', 'active@example.com', false, NULL),
           ('user_other', 'user_clerk_other', 'other@example.com', false, NULL),
           ('user_banned', 'user_clerk_banned', 'banned@example.com', true, NULL),
           ('user_deleted', 'user_clerk_deleted', 'deleted@example.com', false, current_timestamp);
  `);
  await database.exec(migration);
  return database;
}

test("runtime reads only the bounded lifecycle snapshot and reserves once", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const state = (await database.query(`
      SELECT * FROM public.grainline_user_clerk_lifecycle_state('user_clerk_active')
    `)).rows[0];
    assert.deepEqual(state, {
      id: "user_active",
      email: "active@example.com",
      banned: false,
      deletedAt: null,
    });

    const first = (await database.query(`
      SELECT public.grainline_user_clerk_welcome_reserve(
        'user_clerk_active',
        'user_active'
      ) AS reserved
    `)).rows[0];
    const second = (await database.query(`
      SELECT public.grainline_user_clerk_welcome_reserve(
        'user_clerk_active',
        'user_active'
      ) AS reserved
    `)).rows[0];
    assert.deepEqual(first, { reserved: true });
    assert.deepEqual(second, { reserved: false });

    for (const [clerkId, userId] of [
      ["user_clerk_banned", "user_banned"],
      ["user_clerk_deleted", "user_deleted"],
      ["user_clerk_other", "user_active"],
    ]) {
      const outcome = (await database.query(`
        SELECT public.grainline_user_clerk_welcome_reserve(
          '${clerkId}',
          '${userId}'
        ) AS reserved
      `)).rows[0];
      assert.deepEqual(outcome, { reserved: false });
    }

    const blockedStates = await database.query(`
      SELECT * FROM public.grainline_user_clerk_lifecycle_state('user_clerk_banned')
      UNION ALL
      SELECT * FROM public.grainline_user_clerk_lifecycle_state('user_clerk_deleted')
      ORDER BY id
    `);
    assert.equal(blockedStates.rows.length, 2);
    assert.ok(blockedStates.rows.every((row) => row.email === null));
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_clerk_lifecycle_state('invalid clerk id')"),
      /Clerk provider lifecycle identifier is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("untrusted callers cannot execute the provider lifecycle functions", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_clerk_lifecycle_state('user_clerk_active')"),
      /permission denied for function grainline_user_clerk_lifecycle_state/,
    );
    await assert.rejects(
      database.query("SELECT public.grainline_user_clerk_welcome_reserve('user_clerk_active', 'user_active')"),
      /permission denied for function grainline_user_clerk_welcome_reserve/,
    );
  } finally {
    await database.close();
  }
});
