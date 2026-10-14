import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014180000_prepare_seller_profile_private_guild_cron_batch_authorities"),
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "vacationMode" boolean NOT NULL DEFAULT false,
      "listingsBelowThresholdSince" timestamp(3) without time zone,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "metricWarningSentAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "listingsBelowThresholdSince" timestamp(3) without time zone,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "metricWarningSentAt" timestamp(3) without time zone
    );

    INSERT INTO public."SellerProfile" (
      id, "userId", "guildLevel", "vacationMode",
      "listingsBelowThresholdSince", "consecutiveMetricFailures", "metricWarningSentAt"
    ) VALUES
      ('a_member', 'user_a', 'GUILD_MEMBER', false, '2020-01-01', 99, '2020-01-01'),
      ('b_master', 'user_b', 'GUILD_MASTER', false, '2020-01-01', 99, '2020-01-01'),
      ('c_vacation', 'user_c', 'GUILD_MEMBER', true, '2020-01-01', 99, '2020-01-01'),
      ('d_none', 'user_d', 'NONE', false, '2020-01-01', 99, '2020-01-01');
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "listingsBelowThresholdSince",
      "consecutiveMetricFailures", "metricWarningSentAt"
    ) VALUES
      ('a_member', '2026-10-01', 1, '2026-10-02'),
      ('b_master', NULL, 2, '2026-10-03'),
      ('c_vacation', '2026-10-04', 3, '2026-10-04'),
      ('d_none', NULL, 4, '2026-10-05');

    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("Guild cron batches are bounded, cursor-ordered, and private-authoritative", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const memberRows = (await database.query(`
      SELECT * FROM public.grainline_seller_guild_member_cron_batch(NULL, 100)
    `)).rows;
    assert.deepEqual(memberRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      guildLevel: row.guildLevel,
      thresholdYear: row.listingsBelowThresholdSince?.getFullYear(),
    })), [{
      id: "a_member",
      userId: "user_a",
      guildLevel: "GUILD_MEMBER",
      thresholdYear: 2026,
    }]);

    const metricsRows = (await database.query(`
      SELECT * FROM public.grainline_seller_guild_metrics_cron_batch('a_member', 1)
    `)).rows;
    assert.deepEqual(metricsRows.map((row) => ({
      id: row.id,
      guildLevel: row.guildLevel,
      consecutiveMetricFailures: row.consecutiveMetricFailures,
      warningYear: row.metricWarningSentAt?.getFullYear(),
    })), [{
      id: "b_master",
      guildLevel: "GUILD_MASTER",
      consecutiveMetricFailures: 2,
      warningYear: 2026,
    }]);

    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );
  } finally {
    await database.close();
  }
});

test("Guild cron batches reject invalid bounds and untrusted callers", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    for (const statement of [
      "SELECT * FROM public.grainline_seller_guild_member_cron_batch(NULL, 0)",
      "SELECT * FROM public.grainline_seller_guild_metrics_cron_batch(NULL, 101)",
      "SELECT * FROM public.grainline_seller_guild_member_cron_batch('bad cursor', 10)",
    ]) {
      await assert.rejects(database.query(statement), /cron-batch input is invalid/i);
    }

    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_seller_guild_member_cron_batch(NULL, 10)`),
      /permission denied for function/,
    );
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_seller_guild_metrics_cron_batch(NULL, 10)`),
      /permission denied for function/,
    );
  } finally {
    await database.close();
  }
});
