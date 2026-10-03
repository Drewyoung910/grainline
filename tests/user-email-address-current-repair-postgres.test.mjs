import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const repairMigration = readFileSync(
  "prisma/migrations/20261003010000_repair_user_email_address_current_history/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email varchar(254) NOT NULL UNIQUE,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  `);
  return database;
}

test("repair backfills missing active current rows and reactivates exact historical rows", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."User" (id, email, "createdAt") VALUES
        ('missing', 'missing@example.com', '2026-01-01 00:00:00'),
        ('historical', 'historical@example.com', '2026-01-02 00:00:00'),
        ('complete', 'complete@example.com', '2026-01-03 00:00:00'),
        ('deleted', 'deleted@example.com', '2026-01-04 00:00:00');
      UPDATE public."User"
         SET "deletedAt" = '2026-02-01 00:00:00'
       WHERE id = 'deleted';

      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, source, "isCurrent", "firstSeenAt",
        "lastSeenAt", "currentSinceAt"
      ) VALUES
        ('historical-row', 'historical', 'historical@example.com', 'old', false,
         '2026-01-02 00:00:00', '2026-01-10 00:00:00', '2026-01-02 00:00:00'),
        ('complete-row', 'complete', 'complete@example.com', 'existing', true,
         '2026-01-03 00:00:00', '2026-01-03 00:00:00', '2026-01-03 00:00:00');
    `);

    await database.exec(repairMigration);

    const rows = (await database.query(`
      SELECT "userId", email, source, "isCurrent", "firstSeenAt", "currentSinceAt"
        FROM public."UserEmailAddress"
       ORDER BY "userId"
    `)).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => [row.userId, row.email, row.source, row.isCurrent]), [
      ["complete", "complete@example.com", "existing", true],
      ["historical", "historical@example.com", "current_user_email_repair", true],
      ["missing", "missing@example.com", "current_user_email_repair", true],
    ]);
    assert.equal(rows[1].firstSeenAt.getTime(), new Date("2026-01-02T00:00:00").getTime());
    assert.ok(rows[1].currentSinceAt > new Date("2026-01-10T00:00:00.000Z"));
    assert.equal(rows[2].firstSeenAt.getTime(), new Date("2026-01-01T00:00:00").getTime());
    assert.ok(rows[2].currentSinceAt > new Date("2026-01-01T00:00:00.000Z"));

    await database.exec(repairMigration);
    const rerun = (await database.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."UserEmailAddress"
    `)).rows[0];
    assert.deepEqual(rerun, { count: 3 });
  } finally {
    await database.close();
  }
});

test("repair refuses an unmatched current row without changing data", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."User" (id, email) VALUES ('user_1', 'current@example.com');
      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, "isCurrent"
      ) VALUES ('stale', 'user_1', 'stale@example.com', true);
    `);

    await assert.rejects(
      database.exec(repairMigration),
      /UserEmailAddress repair refused unmatched current rows: 1/,
    );
    await database.exec("ROLLBACK");
    assert.deepEqual((await database.query(`
      SELECT email, "isCurrent" FROM public."UserEmailAddress"
    `)).rows, [{ email: "stale@example.com", isCurrent: true }]);
  } finally {
    await database.close();
  }
});

test("repair refuses duplicate current rows without choosing a winner", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."User" (id, email) VALUES ('user_1', 'one@example.com');
      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, "isCurrent"
      ) VALUES
        ('one', 'user_1', 'one@example.com', true),
        ('two', 'user_1', 'two@example.com', true);
    `);

    await assert.rejects(
      database.exec(repairMigration),
      /UserEmailAddress repair refused duplicate current-row groups: 1/,
    );
    await database.exec("ROLLBACK");
    assert.deepEqual((await database.query(`
      SELECT email FROM public."UserEmailAddress"
       WHERE "isCurrent" = true ORDER BY email
    `)).rows, [{ email: "one@example.com" }, { email: "two@example.com" }]);
  } finally {
    await database.close();
  }
});

test("migration source keeps the repair transactional and exact-email scoped", () => {
  assert.match(repairMigration, /^--[\s\S]*\nBEGIN;/);
  assert.match(repairMigration, /SET LOCAL lock_timeout = '5s';/);
  assert.match(repairMigration, /SET LOCAL statement_timeout = '60s';/);
  assert.match(repairMigration, /LOCK TABLE public\."User" IN SHARE ROW EXCLUSIVE MODE;/);
  assert.match(repairMigration, /LOCK TABLE public\."UserEmailAddress" IN SHARE ROW EXCLUSIVE MODE;/);
  assert.match(repairMigration, /address\.email = account_user\.email/);
  assert.doesNotMatch(repairMigration, /gmail\.com|googlemail\.com|suppression_key/);
  assert.match(repairMigration, /ON CONFLICT \("userId", email\) DO UPDATE/);
  assert.match(
    repairMigration,
    /account_user\."createdAt",\s*repair_clock\.repaired_at,\s*repair_clock\.repaired_at/,
  );
  assert.match(
    repairMigration,
    /ELSE EXCLUDED\."currentSinceAt"/,
  );
  assert.match(repairMigration, /COMMIT;\s*$/);
});
