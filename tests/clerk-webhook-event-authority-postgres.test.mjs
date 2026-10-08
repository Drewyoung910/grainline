import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = fs.readFileSync(
  "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql",
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
