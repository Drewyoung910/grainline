import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const authorityMigration = readFileSync(
  "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
  "utf8",
);
const enableMigration = readFileSync(
  "prisma/migrations/20261003020000_enable_user_email_address_rls/migration.sql",
  "utf8",
);
const supportingIndexes = [
  "prisma/migrations/20261002160000_add_user_email_suppression_key_index/migration.sql",
  "prisma/migrations/20261002161000_add_user_email_address_suppression_key_index/migration.sql",
  "prisma/migrations/20261002162000_add_user_email_address_current_unique_index/migration.sql",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n")
  .replaceAll(" INDEX CONCURRENTLY ", " INDEX ");

const productionFunctionHashes = Object.freeze({
  grainline_case_account_deletion_redact: "b9e24ec8efa43b689b357f4965f8e722",
  grainline_message_redact_for_account_deletion:
    "e19c1b6b5b3adf968df8e2acab8851df",
  grainline_user_email_address_delete_for_current_user:
    "d570b850599eafe3629aa8240fe8c6d7",
  grainline_user_email_address_newer_current_claim:
    "873863dc1595a6fa738c9f5f31e5cb0b",
  grainline_user_email_address_owner_rows: "d8c04787918ab4aafa1b630757cca39c",
  grainline_user_email_address_sync: "04d09b22c99b0ce62ef2acdc16167c20",
});

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function createPreparedDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email varchar(254) NOT NULL UNIQUE,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."UserEmailAddress" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL
        REFERENCES public."User"(id) ON DELETE CASCADE,
      email varchar(254) NOT NULL,
      source varchar(80),
      "isCurrent" boolean NOT NULL DEFAULT false,
      "firstSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "currentSinceAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", email)
    );
    CREATE INDEX "UserEmailAddress_userId_isCurrent_idx"
      ON public."UserEmailAddress" ("userId", "isCurrent");
    CREATE INDEX "UserEmailAddress_email_idx"
      ON public."UserEmailAddress" (email);
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."User", public."UserEmailAddress"
      TO grainline_app_runtime;
    INSERT INTO public."User" (id, email) VALUES
      ('user_1', 'owner@example.com'),
      ('user_2', 'other@example.com');
  `);
  await database.exec(supportingIndexes);
  await database.exec(authorityMigration);
  await database.exec(`
    CREATE OR REPLACE FUNCTION public.grainline_message_redact_for_account_deletion(
      p_actor_id text
    )
    RETURNS TABLE ("sentRedacted" integer, "receivedRedacted" integer)
    LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
    SET search_path = pg_catalog
    AS $proof$
    BEGIN
      PERFORM 1 FROM public."UserEmailAddress" WHERE "userId" = p_actor_id;
      RETURN QUERY SELECT 0, 0;
    END
    $proof$;
    CREATE OR REPLACE FUNCTION public.grainline_case_account_deletion_redact(
      p_account_deletion_side_effect_id text
    )
    RETURNS TABLE (
      "sideEffectId" text,
      "userId" text,
      "authoredMessagesRedacted" integer,
      "quotedMessagesRedacted" integer,
      "buyerDescriptionsRedacted" integer,
      "participantDescriptionsRedacted" integer
    )
    LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
    SET search_path = pg_catalog
    AS $proof$
    BEGIN
      PERFORM 1 FROM public."UserEmailAddress"
       WHERE id = p_account_deletion_side_effect_id;
      RETURN QUERY SELECT p_account_deletion_side_effect_id, ''::text, 0, 0, 0, 0;
    END
    $proof$;
    REVOKE ALL ON FUNCTION
      public.grainline_message_redact_for_account_deletion(text)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_message_redact_for_account_deletion(text)
      TO grainline_app_runtime;
    REVOKE ALL ON FUNCTION
      public.grainline_case_account_deletion_redact(text)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_case_account_deletion_redact(text)
      TO grainline_app_runtime;
    SELECT public.grainline_user_email_address_sync(
      'user_1', 'owner@example.com', 'proof'
    );
    SELECT public.grainline_user_email_address_sync(
      'user_2', 'other@example.com', 'proof'
    );
  `);
  return database;
}

async function activationForDisposableDatabase(database) {
  const identity = (
    await database.query(`
    SELECT current_user AS "currentUser", current_database() AS "databaseName"
  `)
  ).rows[0];
  const functions = (
    await database.query(`
    SELECT procedure.proname AS name, pg_catalog.md5(procedure.prosrc) AS hash
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_case_account_deletion_redact',
         'grainline_message_redact_for_account_deletion',
         'grainline_user_email_address_delete_for_current_user',
         'grainline_user_email_address_newer_current_claim',
         'grainline_user_email_address_owner_rows',
         'grainline_user_email_address_sync'
       )
     ORDER BY procedure.proname
  `)
  ).rows;
  assert.equal(functions.length, 6);

  let disposableMigration = enableMigration
    .replace(
      "current_user = 'ci'",
      `current_user = ${quoteLiteral(identity.currentUser)}`,
    )
    .replace(
      "pg_catalog.current_database() = 'grainline_ci'",
      `pg_catalog.current_database() = ${quoteLiteral(identity.databaseName)}`,
    );
  for (const entry of functions) {
    const productionHash = productionFunctionHashes[entry.name];
    assert.ok(productionHash, `unexpected proof function ${entry.name}`);
    if (entry.name.startsWith("grainline_user_email_address_")) {
      assert.equal(
        entry.hash,
        productionHash,
        `${entry.name} source differs from the Production-pinned definition`,
      );
    } else {
      disposableMigration = disposableMigration.replace(
        productionHash,
        entry.hash,
      );
    }
  }
  return disposableMigration;
}

test("actual ENABLE migration reaches policyless zero-direct authority and preserves functions", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(await activationForDisposableDatabase(database));

    const posture = (
      await database.query(`
      SELECT
        class.relrowsecurity AS "rlsEnabled",
        class.relforcerowsecurity AS "rlsForced",
        (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid) AS "policyCount",
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
        ) AS "runtimeCrud"
      FROM pg_catalog.pg_class AS class
      WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
    `)
    ).rows[0];
    assert.deepEqual(posture, {
      rlsEnabled: true,
      rlsForced: false,
      policyCount: 0,
      runtimeCrud: false,
    });

    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query('SELECT * FROM public."UserEmailAddress"'),
      (error) => error?.code === "42501",
    );
    assert.deepEqual(
      (
        await database.query(`
      SELECT public.grainline_user_email_address_sync(
        'user_1', 'owner@example.com', 'after-enable'
      )::integer AS "syncedCount"
    `)
      ).rows,
      [{ syncedCount: 1 }],
    );
    await database.query("SELECT set_config('app.user_id', 'user_1', false)");
    assert.deepEqual(
      (
        await database.query(`
      SELECT email, "isCurrent"
        FROM public.grainline_user_email_address_owner_rows()
    `)
      ).rows,
      [{ email: "owner@example.com", isCurrent: true }],
    );
    assert.deepEqual(
      (
        await database.query(`
      SELECT public.grainline_user_email_address_newer_current_claim(
        ARRAY['owner@example.com']::text[],
        '2000-01-01 00:00:00'::timestamp
      ) AS superseded
    `)
      ).rows,
      [{ superseded: true }],
    );
    await database.query("SELECT set_config('app.user_id', 'user_2', false)");
    assert.deepEqual(
      (
        await database.query(`
      SELECT public.grainline_user_email_address_delete_for_current_user()
        AS "deletedCount"
    `)
      ).rows,
      [{ deletedCount: 1 }],
    );
    assert.deepEqual(
      (
        await database.query(`
      SELECT email
        FROM public.grainline_user_email_address_owner_rows()
    `)
      ).rows,
      [],
    );
  } finally {
    await database.close();
  }
});

test("ENABLE preflight rejects drift atomically", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(`
      UPDATE public."User"
         SET email = 'changed@example.com'
       WHERE id = 'user_1'
    `);
    const disposableMigration = await activationForDisposableDatabase(database);
    await assert.rejects(
      database.exec(disposableMigration),
      /UserEmailAddress ENABLE data posture drifted/u,
    );
    await database.exec("ROLLBACK");
    const posture = (
      await database.query(`
      SELECT
        class.relrowsecurity AS "rlsEnabled",
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
        ) AS "runtimeCrud"
      FROM pg_catalog.pg_class AS class
      WHERE class.oid = 'public."UserEmailAddress"'::pg_catalog.regclass
    `)
    ).rows[0];
    assert.deepEqual(posture, { rlsEnabled: false, runtimeCrud: true });
  } finally {
    await database.close();
  }
});
