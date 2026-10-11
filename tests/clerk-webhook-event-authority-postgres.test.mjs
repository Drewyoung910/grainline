import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = fs.readFileSync(
  "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql",
  "utf8",
);
const activation = fs.readFileSync(
  "prisma/migrations/20261010160000_enable_clerk_webhook_event_rls/migration.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/clerk-webhook-event-activation-rollback.sql",
  "utf8",
);

async function databaseWithAuthority() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."ClerkWebhookEvent" (
      "svixId" varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(2000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
  `);
  await database.exec(migration);
  return database;
}

async function databaseWithCompatibleAuthority() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."ClerkWebhookEvent" (
      "svixId" varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(2000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE INDEX "ClerkWebhookEvent_type_createdAt_idx"
      ON public."ClerkWebhookEvent" (type, "createdAt");
    CREATE INDEX "ClerkWebhookEvent_processedAt_idx"
      ON public."ClerkWebhookEvent" ("processedAt");
  `);
  await database.exec(migration);
  await database.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."ClerkWebhookEvent" TO grainline_app_runtime;
  `);
  return database;
}

async function begin(database, id, type) {
  const result = await database.query(
    "SELECT action, claim_generation::text FROM public.grainline_clerk_webhook_begin($1, $2)",
    [id, type],
  );
  return result.rows[0];
}

test("disposable PostgreSQL proves Clerk webhook lease, fencing, health, and retention", async () => {
  const database = await databaseWithAuthority();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(await begin(database, "msg_fresh", "user.updated"), {
      action: "process",
      claim_generation: "1",
    });
    assert.deepEqual(await begin(database, "msg_fresh", "user.updated"), {
      action: "in_progress",
      claim_generation: "1",
    });
    await assert.rejects(
      () => begin(database, "msg_fresh", "user.created"),
      /event type is immutable/,
    );
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_fail($1, $2, $3) AS result",
      ["msg_fresh", "1", "x".repeat(900)],
    )).rows[0].result, "failed");
    assert.deepEqual((await database.query(
      "SELECT failed_count::text, released_count::text, stale_count::text, issue_count::text FROM public.grainline_clerk_webhook_health_summary()",
    )).rows[0], {
      failed_count: "1",
      released_count: "1",
      stale_count: "0",
      issue_count: "1",
    });
    assert.deepEqual(await begin(database, "msg_fresh", "user.updated"), {
      action: "process",
      claim_generation: "2",
    });
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_complete($1, $2) AS result",
      ["msg_fresh", "1"],
    )).rows[0].result, "superseded");
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_fail($1, $2, $3) AS result",
      ["msg_fresh", "1", "stale worker"],
    )).rows[0].result, "superseded");
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_complete($1, $2) AS result",
      ["msg_fresh", "2"],
    )).rows[0].result, "completed");
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_complete($1, $2) AS result",
      ["msg_fresh", "2"],
    )).rows[0].result, "already_processed");

    await database.exec("RESET ROLE");
    await database.exec(`
      UPDATE public."ClerkWebhookEvent"
         SET "processedAt" = CURRENT_TIMESTAMP - interval '91 days';
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal((await database.query(
      "SELECT public.grainline_clerk_webhook_prune_batch(100) AS deleted_count",
    )).rows[0].deleted_count, 1);
    await assert.rejects(
      () => database.query('SELECT * FROM public."ClerkWebhookEvent"'),
      /permission denied/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves policyless ENABLE and database-first rollback", async () => {
  const database = await databaseWithCompatibleAuthority();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal((await database.query(
      'SELECT count(*)::integer AS count FROM public."ClerkWebhookEvent"',
    )).rows[0].count, 0);
    await database.exec("RESET ROLE");

    await database.exec(activation);
    assert.deepEqual((await database.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced,
             (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = class.oid) AS policy_count,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', class.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) AS runtime_direct
        FROM pg_catalog.pg_class AS class
       WHERE class.oid = 'public."ClerkWebhookEvent"'::regclass
    `)).rows[0], {
      enabled: true,
      forced: false,
      policy_count: 0,
      runtime_direct: false,
    });

    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(await begin(database, "msg_enabled", "user.updated"), {
      action: "process",
      claim_generation: "1",
    });
    await assert.rejects(
      () => database.query('SELECT * FROM public."ClerkWebhookEvent"'),
      /permission denied/,
    );
    await database.exec("RESET ROLE");

    await database.exec(rollback);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal((await database.query(
      'SELECT count(*)::integer AS count FROM public."ClerkWebhookEvent"',
    )).rows[0].count, 1);
    await database.exec("RESET ROLE");
    assert.deepEqual((await database.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced
        FROM pg_catalog.pg_class AS class
       WHERE class.oid = 'public."ClerkWebhookEvent"'::regclass
    `)).rows[0], { enabled: false, forced: false });
  } finally {
    await database.close();
  }
});
