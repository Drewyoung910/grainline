import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
  "utf8",
);
const indexMigration = readFileSync(
  "prisma/migrations/20261002160000_add_user_email_suppression_key_index/migration.sql",
  "utf8",
).replaceAll(" INDEX CONCURRENTLY ", " INDEX ");

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email varchar(254) NOT NULL UNIQUE,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."UserEmailAddress" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      email varchar(254) NOT NULL,
      source varchar(80),
      "isCurrent" boolean NOT NULL DEFAULT false,
      "firstSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "currentSinceAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", email)
    );
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."User", public."UserEmailAddress"
      TO grainline_app_runtime;
  `);
  await database.exec(indexMigration);
  await database.exec(migration);
  await database.query(`
    INSERT INTO public."User" (id, email) VALUES
      ('user_1', 'a@example.com'),
      ('user_2', 'other@example.com')
  `);
  return database;
}

async function setRuntime(database) {
  await database.exec("SET ROLE grainline_app_runtime");
}

async function resetOwner(database) {
  await database.exec("RESET ROLE");
  await database.query("SELECT set_config('app.user_id', '', false)");
}

async function sync(database, userId, currentEmail, source = "proof") {
  return (await database.query(`
    SELECT public.grainline_user_email_address_sync(
      $1::text, $2::text, $3::text
    )::integer AS "syncedCount"
  `, [userId, currentEmail, source])).rows[0];
}

test("disposable PostgreSQL proves serialized sync, owner projection, claim checks, and deletion", async () => {
  const database = await createDatabase();
  try {
    await setRuntime(database);
    assert.deepEqual(await sync(database, "user_1", "a@example.com"), { syncedCount: 1 });
    assert.deepEqual(await sync(database, "user_2", "other@example.com"), { syncedCount: 1 });
    await assert.rejects(
      sync(database, "user_1", "forged@example.com"),
      (error) => error?.code === "42501",
    );

    await resetOwner(database);
    await database.query(`
      UPDATE public."UserEmailAddress"
         SET "currentSinceAt" = '2026-01-01 00:00:00'
       WHERE "userId" = 'user_1' AND email = 'a@example.com'
    `);
    await database.query(`UPDATE public."User" SET email = 'b@example.com' WHERE id = 'user_1'`);

    await setRuntime(database);
    assert.deepEqual(
      await sync(database, "user_1", "b@example.com"),
      { syncedCount: 1 },
    );
    await resetOwner(database);
    await database.query(`UPDATE public."User" SET email = 'a@example.com' WHERE id = 'user_1'`);
    await setRuntime(database);
    assert.deepEqual(
      await sync(database, "user_1", "a@example.com"),
      { syncedCount: 1 },
    );

    await database.query("SELECT set_config('app.user_id', 'user_1', false)");
    const ownerRows = (await database.query(`
      SELECT * FROM public.grainline_user_email_address_owner_rows()
    `)).rows;
    assert.deepEqual(ownerRows.map((row) => [row.email, row.isCurrent]), [
      ["a@example.com", true],
      ["b@example.com", false],
    ]);
    assert.ok(ownerRows[0].currentSinceAt > new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(ownerRows.every((row) => row.email !== "other@example.com"));

    assert.deepEqual((await database.query(`
      SELECT public.grainline_user_email_address_newer_current_claim(
        ARRAY['a@example.com']::text[],
        '2000-01-01 00:00:00'::timestamp
      ) AS superseded
    `)).rows, [{ superseded: true }]);
    assert.deepEqual((await database.query(`
      SELECT public.grainline_user_email_address_newer_current_claim(
        ARRAY['a@example.com']::text[],
        '2100-01-01 00:00:00'::timestamp
      ) AS superseded
    `)).rows, [{ superseded: false }]);

    assert.deepEqual((await database.query(`
      SELECT public.grainline_user_email_address_delete_for_current_user()::integer
        AS "deletedCount"
    `)).rows, [{ deletedCount: 2 }]);
    await resetOwner(database);
    assert.deepEqual((await database.query(`
      SELECT "userId", email FROM public."UserEmailAddress" ORDER BY "userId", email
    `)).rows, [{ userId: "user_2", email: "other@example.com" }]);
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves the one-current-row invariant fails closed", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, "isCurrent"
      ) VALUES ('one', 'user_1', 'one@example.com', true)
    `);
    await assert.rejects(
      database.query(`
        INSERT INTO public."UserEmailAddress" (
          id, "userId", email, "isCurrent"
        ) VALUES ('two', 'user_1', 'two@example.com', true)
      `),
      (error) => error?.code === "23505",
    );
    await database.query(`
      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, "isCurrent"
      ) VALUES ('historical', 'user_1', 'historical@example.com', false)
    `);
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves context rejection and exact function privileges", async () => {
  const database = await createDatabase();
  try {
    const catalog = (await database.query(`
      SELECT
        p.proname,
        p.prosecdef AS security_definer,
        p.proconfig AS config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', p.oid, 'EXECUTE'
        ) AS runtime_execute,
        EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
            ) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS p
      INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname LIKE 'grainline_user_email_address_%'
      ORDER BY p.proname
    `)).rows;
    assert.equal(catalog.length, 4);
    for (const row of catalog) {
      assert.equal(row.security_definer, true);
      assert.deepEqual(row.config, ["search_path=pg_catalog"]);
      assert.equal(row.runtime_execute, true);
      assert.equal(row.public_execute, false);
    }

    await setRuntime(database);
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_email_address_owner_rows()"),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query("SELECT public.grainline_user_email_address_delete_for_current_user()"),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.close();
  }
});
