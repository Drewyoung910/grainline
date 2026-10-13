import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const activation = readFileSync(
  "prisma/migrations/20261011180000_enable_account_deletion_side_effect_rls/migration.sql",
  "utf8",
);
const preparation = readFileSync(
  "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql",
  "utf8",
);
const mediaKeyFence = readFileSync(
  "prisma/migrations/20261011173000_prepare_account_deletion_media_key_fence/migration.sql",
  "utf8",
);
const force = readFileSync(
  "prisma/migrations/20261012120000_force_account_deletion_side_effect_rls/migration.sql",
  "utf8",
);
const activationChecksum =
  "86b511f8fec0104c4ef3c1fbc7b2017d40847b286ac92bf26cdafc12518c5b3b";

const legacyFunctions = [
  ["grainline_user_account_deletion_preflight", "text"],
  ["grainline_user_account_deletion_snapshot", "text"],
  ["grainline_user_account_deletion_finalize", "text"],
  ["grainline_case_account_deletion_redact", "text"],
  ["grainline_message_redact_for_account_deletion", "text"],
  ["grainline_order_account_deletion_scrub", "text, text[]"],
];

async function predecessorFixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE grainline_account_deletion_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE TABLE public."User" (
      id varchar(191) PRIMARY KEY,
      "clerkId" varchar(191) NOT NULL UNIQUE
    );
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL,
      kind varchar(40) NOT NULL,
      "dedupKey" varchar(300) NOT NULL UNIQUE,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      attempts integer NOT NULL DEFAULT 0,
      "nextAttemptAt" timestamp(3) DEFAULT now(),
      "processedAt" timestamp(3),
      "lastError" varchar(1000),
      "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT now()
    );
    CREATE INDEX "AccountDeletionSideEffect_status_nextAttemptAt_idx"
      ON public."AccountDeletionSideEffect"(status, "nextAttemptAt");
    CREATE INDEX "AccountDeletionSideEffect_status_processedAt_idx"
      ON public."AccountDeletionSideEffect"(status, "processedAt");
    CREATE INDEX "AccountDeletionSideEffect_userId_kind_idx"
      ON public."AccountDeletionSideEffect"("userId", kind);
    GRANT USAGE ON SCHEMA public TO grainline_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."AccountDeletionSideEffect" TO grainline_app_runtime;
  `);
  for (const [name, args] of legacyFunctions) {
    await database.exec(`
      CREATE FUNCTION public.${name}(${args}) RETURNS text
      LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$ BEGIN RETURN 'ok'; END $function$;
      REVOKE ALL ON FUNCTION public.${name}(${args})
        FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO grainline_app_runtime;
    `);
  }
  return database;
}

async function forceForDisposableDatabase(database) {
  const identity = (
    await database.query(`
      SELECT current_user AS "currentUser",
             current_database() AS "databaseName"
    `)
  ).rows[0];
  return force
    .replace(
      "current_user = 'ci'",
      `current_user = '${identity.currentUser.replaceAll("'", "''")}'`,
    )
    .replace(
      "pg_catalog.current_database() = 'grainline_ci'",
      `pg_catalog.current_database() = '${identity.databaseName.replaceAll("'", "''")}'`,
    );
}

test("preparation preserves old callers while making the dedicated worker deployable", async () => {
  const database = await predecessorFixture();
  try {
    await database.exec(preparation);
    await database.exec(mediaKeyFence);
    const posture = (await database.query(`
      SELECT
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', 'public."AccountDeletionSideEffect"',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "runtimeCrud",
        pg_catalog.has_table_privilege(
          'grainline_account_deletion_runtime',
          'public."AccountDeletionSideEffect"',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "workerCrud",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_user_account_deletion_preflight(text)',
          'EXECUTE'
        ) AS "legacyRuntimeExecute",
        pg_catalog.has_function_privilege(
          'grainline_account_deletion_runtime',
          'public.grainline_user_account_deletion_preflight(text)',
          'EXECUTE'
        ) AS "legacyWorkerExecute",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_side_effect_claim(text)',
          'EXECUTE'
        ) AS "runtimeClaimExecute",
        pg_catalog.has_function_privilege(
          'grainline_account_deletion_runtime',
          'public.grainline_account_deletion_side_effect_claim(text)',
          'EXECUTE'
        ) AS "workerClaimExecute",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_media_enqueue_claimed(text,bigint,uuid,text[])',
          'EXECUTE'
        ) AS "legacyMediaRuntimeExecute",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_media_key_enqueue_claimed(text,bigint,uuid,text[])',
          'EXECUTE'
        ) AS "keyMediaRuntimeExecute"
    `)).rows[0];
    assert.deepEqual(posture, {
      runtimeCrud: true,
      workerCrud: true,
      legacyRuntimeExecute: true,
      legacyWorkerExecute: false,
      runtimeClaimExecute: true,
      workerClaimExecute: true,
      legacyMediaRuntimeExecute: true,
      keyMediaRuntimeExecute: true,
    });
  } finally {
    await database.close();
  }
});

test("Phase A activation denies forged ordinary-runtime rows and preserves worker CRUD", async () => {
  const database = await predecessorFixture();
  try {
    await database.exec(preparation);
    await database.exec(mediaKeyFence);
    const prepared = (await database.query(`
      SELECT
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', 'public."AccountDeletionSideEffect"',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "runtimeCrud",
        pg_catalog.has_table_privilege(
          'grainline_account_deletion_runtime',
          'public."AccountDeletionSideEffect"',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "workerCrud",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_user_account_deletion_preflight(text)',
          'EXECUTE'
        ) AS "legacyRuntimeExecute",
        pg_catalog.has_function_privilege(
          'grainline_account_deletion_runtime',
          'public.grainline_account_deletion_side_effect_claim(text)',
          'EXECUTE'
        ) AS "workerClaimExecute"
    `)).rows[0];
    assert.deepEqual(prepared, {
      runtimeCrud: true,
      workerCrud: true,
      legacyRuntimeExecute: true,
      workerClaimExecute: true,
    });

    await database.exec(activation);

    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    await assert.rejects(
      database.exec(`
        INSERT INTO public."AccountDeletionSideEffect"
          (id, "userId", kind, "dedupKey")
        VALUES ('forged', 'victim', 'LOCAL_ANONYMIZE', 'account-delete:local:victim')
      `),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query('SELECT * FROM public."AccountDeletionSideEffect"'),
      (error) => error?.code === "42501",
    );
    await database.exec("RESET SESSION AUTHORIZATION");

    await database.exec("SET SESSION AUTHORIZATION grainline_account_deletion_runtime");
    await database.exec(`
      INSERT INTO public."AccountDeletionSideEffect"
        (id, "userId", kind, "dedupKey")
      VALUES ('trusted', 'user-1', 'LOCAL_ANONYMIZE', 'account-delete:local:user-1')
    `);
    const rows = await database.query(
      'SELECT id FROM public."AccountDeletionSideEffect" ORDER BY id',
    );
    assert.deepEqual(rows.rows, [{ id: "trusted" }]);
    await database.exec("RESET SESSION AUTHORIZATION");

    const posture = (await database.query(`
      SELECT class.relrowsecurity AS "rlsEnabled",
             class.relforcerowsecurity AS "rlsForced",
             (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = class.oid) AS "policyCount",
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', class.oid,
               'SELECT,INSERT,UPDATE,DELETE'
             ) AS "runtimeCrud",
             pg_catalog.has_table_privilege(
               'grainline_account_deletion_runtime', class.oid,
               'SELECT,INSERT,UPDATE,DELETE'
             ) AS "workerCrud"
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."AccountDeletionSideEffect"'::pg_catalog.regclass
    `)).rows[0];
    assert.deepEqual(posture, {
      rlsEnabled: true,
      rlsForced: false,
      policyCount: 1,
      runtimeCrud: false,
      workerCrud: true,
    });

    for (const [name, args] of legacyFunctions) {
      const privileges = (await database.query(`
        SELECT
          pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            'public.${name}(${args})',
            'EXECUTE'
          ) AS "runtimeExecute",
          pg_catalog.has_function_privilege(
            'grainline_account_deletion_runtime',
            'public.${name}(${args})',
            'EXECUTE'
          ) AS "workerExecute"
      `)).rows[0];
      assert.deepEqual(privileges, {
        runtimeExecute: false,
        workerExecute: false,
      });
    }
    const mediaPosture = (await database.query(`
      SELECT
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_media_enqueue_claimed(text,bigint,uuid,text[])',
          'EXECUTE'
        ) AS "legacyRuntimeExecute",
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_media_key_enqueue_claimed(text,bigint,uuid,text[])',
          'EXECUTE'
        ) AS "keyRuntimeExecute"
    `)).rows[0];
    assert.deepEqual(mediaPosture, {
      legacyRuntimeExecute: false,
      keyRuntimeExecute: true,
    });
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
    await database.close();
  }
});

test("Phase B FORCE is posture-only and preserves the dedicated worker boundary", async () => {
  const database = await predecessorFixture();
  try {
    await database.exec(preparation);
    await database.exec(mediaKeyFence);
    await database.exec(activation);
    await database.exec(`
      CREATE TABLE public._prisma_migrations (
        migration_name text NOT NULL,
        checksum text NOT NULL,
        finished_at timestamp with time zone,
        rolled_back_at timestamp with time zone,
        applied_steps_count integer NOT NULL
      );
      INSERT INTO public._prisma_migrations (
        migration_name, checksum, finished_at, rolled_back_at,
        applied_steps_count
      ) VALUES (
        '20261011180000_enable_account_deletion_side_effect_rls',
        '${activationChecksum}', now(), NULL, 1
      );
    `);

    await database.exec(await forceForDisposableDatabase(database));

    const posture = (await database.query(`
      SELECT class.relrowsecurity AS "rlsEnabled",
             class.relforcerowsecurity AS "rlsForced",
             (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = class.oid) AS "policyCount",
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', class.oid,
               'SELECT,INSERT,UPDATE,DELETE'
             ) AS "runtimeCrud",
             pg_catalog.has_table_privilege(
               'grainline_account_deletion_runtime', class.oid,
               'SELECT,INSERT,UPDATE,DELETE'
             ) AS "workerCrud"
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."AccountDeletionSideEffect"'::pg_catalog.regclass
    `)).rows[0];
    assert.deepEqual(posture, {
      rlsEnabled: true,
      rlsForced: true,
      policyCount: 1,
      runtimeCrud: false,
      workerCrud: true,
    });

    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    await assert.rejects(
      database.query('SELECT * FROM public."AccountDeletionSideEffect"'),
      (error) => error?.code === "42501",
    );
    await database.exec("RESET SESSION AUTHORIZATION");

    await database.exec(
      "SET SESSION AUTHORIZATION grainline_account_deletion_runtime",
    );
    await database.exec(`
      INSERT INTO public."AccountDeletionSideEffect"
        (id, "userId", kind, "dedupKey")
      VALUES (
        'forced-worker', 'user-2', 'LOCAL_ANONYMIZE',
        'account-delete:local:user-2'
      )
    `);
    assert.deepEqual(
      (
        await database.query(`
          SELECT id FROM public."AccountDeletionSideEffect"
          WHERE id = 'forced-worker'
        `)
      ).rows,
      [{ id: "forced-worker" }],
    );
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
    await database.close();
  }
});

test("media-key enqueue accepts only canonical keys scoped to the claimed Clerk user", async () => {
  const database = await predecessorFixture();
  const claimToken = "11111111-1111-4111-8111-111111111111";
  try {
    await database.exec(preparation);
    await database.exec(mediaKeyFence);
    await database.exec(`
      INSERT INTO public."User" (id, "clerkId") VALUES ('user-1', 'user_123');
      INSERT INTO public."AccountDeletionSideEffect" (
        id, "userId", kind, "dedupKey", payload, status,
        "claimGeneration", "claimToken", "processingStartedAt"
      ) VALUES (
        'local-1', 'user-1', 'LOCAL_ANONYMIZE',
        'account-delete:local:user-1', '{}'::jsonb, 'PROCESSING',
        3, '${claimToken}'::uuid, now()
      );
    `);
    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    const accepted = await database.query(`
      SELECT public.grainline_account_deletion_media_key_enqueue_claimed(
        'local-1', 3, '${claimToken}'::uuid,
        ARRAY['listingImage/user_123/owned.jpg']::text[]
      ) AS count
    `);
    assert.equal(String(accepted.rows[0].count), "1");
    for (const key of [
      "listingImage/user_456/victim.jpg",
      "unknown/user_123/file.jpg",
      "listingImage/user_123/../victim.jpg",
      "listingImage/user_123/",
      "listingImage/user_123/control\n.jpg",
    ]) {
      await assert.rejects(
        database.query(
          `SELECT public.grainline_account_deletion_media_key_enqueue_claimed($1, $2, $3::uuid, ARRAY[$4]::text[])`,
          ["local-1", 3, claimToken, key],
        ),
        (error) => error?.code === "42501",
      );
    }
    await assert.rejects(
      database.query(
        `SELECT public.grainline_account_deletion_media_key_enqueue_claimed($1, $2, $3::uuid, ARRAY[$4]::text[])`,
        ["local-1", 4, claimToken, "listingImage/user_123/owned.jpg"],
      ),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
    await database.close();
  }
});

test("activation waits for every unfinished legacy URL media row to drain", async () => {
  const database = await predecessorFixture();
  try {
    await database.exec(preparation);
    await database.exec(mediaKeyFence);
    await database.exec(`
      INSERT INTO public."AccountDeletionSideEffect" (
        id, "userId", kind, "dedupKey", payload, status
      ) VALUES (
        'legacy-media-1', 'user-1', 'MEDIA_DELETE',
        'account-delete:media:user-1:legacy',
        '{"url":"https://cdn.thegrainline.com/listingImage/user_123/owned.jpg"}'::jsonb,
        'PENDING'
      );
    `);

    await assert.rejects(
      database.exec(activation),
      /AccountDeletionSideEffect activation found invalid rows/u,
    );
    await database.exec("ROLLBACK");

    await database.exec(`
      UPDATE public."AccountDeletionSideEffect"
         SET status = 'DONE', "processedAt" = now()
       WHERE id = 'legacy-media-1'
    `);
    await database.exec(activation);
    const posture = (await database.query(`
      SELECT
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_account_deletion_media_enqueue_claimed(text,bigint,uuid,text[])',
          'EXECUTE'
        ) AS "legacyRuntimeExecute"
    `)).rows[0];
    assert.deepEqual(posture, { legacyRuntimeExecute: false });
  } finally {
    await database.close();
  }
});
