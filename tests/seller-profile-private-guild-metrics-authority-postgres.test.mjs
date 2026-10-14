import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014190000_prepare_seller_profile_private_guild_metrics_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    SET TIME ZONE 'UTC';
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TYPE public."VerificationStatus" AS ENUM (
      'PENDING', 'APPROVED', 'REJECTED',
      'GUILD_MASTER_PENDING', 'GUILD_MASTER_APPROVED', 'GUILD_MASTER_REJECTED'
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "guildLevel" public."GuildLevel" NOT NULL,
      "isVerifiedMaker" boolean NOT NULL DEFAULT false,
      "guildMasterApprovedAt" timestamp(3) without time zone,
      "guildMasterAppliedAt" timestamp(3) without time zone,
      "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "lastMetricCheckAt" timestamp(3) without time zone,
      "metricWarningSentAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "guildMasterApprovedAt" timestamp(3) without time zone,
      "guildMasterAppliedAt" timestamp(3) without time zone,
      "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "lastMetricCheckAt" timestamp(3) without time zone,
      "metricWarningSentAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerMetrics" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL UNIQUE REFERENCES public."SellerProfile"(id),
      "calculatedAt" timestamp(3) without time zone NOT NULL,
      "periodMonths" integer NOT NULL DEFAULT 3,
      "averageRating" double precision NOT NULL DEFAULT 0,
      "reviewCount" integer NOT NULL DEFAULT 0,
      "onTimeShippingRate" double precision NOT NULL DEFAULT 0,
      "responseRate" double precision NOT NULL DEFAULT 0,
      "totalSalesCents" bigint NOT NULL DEFAULT 0,
      "completedOrderCount" integer NOT NULL DEFAULT 0,
      "activeCaseCount" integer NOT NULL DEFAULT 0,
      "accountAgeDays" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."MakerVerification" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL UNIQUE REFERENCES public."SellerProfile"(id),
      status public."VerificationStatus" NOT NULL,
      "reviewedAt" timestamp(3) without time zone,
      "reviewNotes" text,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" text NOT NULL,
      "actorId" text,
      action text NOT NULL,
      "targetType" text NOT NULL,
      "targetId" text NOT NULL,
      reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    GRANT SELECT, INSERT, UPDATE ON TABLE public."SellerMetrics"
      TO grainline_app_runtime;

    INSERT INTO public."SellerProfile" (
      id, "userId", "guildLevel", "isVerifiedMaker",
      "guildMasterApprovedAt", "guildMasterAppliedAt", "guildMasterReviewNotes",
      "consecutiveMetricFailures", "metricWarningSentAt"
    ) VALUES
      ('member', 'user_member', 'GUILD_MEMBER', true, NULL, NULL, NULL, 99, '2020-01-01'),
      ('warn', 'user_warn', 'GUILD_MASTER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 77, '2020-01-01'),
      ('recover', 'user_recover', 'GUILD_MASTER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 77, '2020-01-01'),
      ('revoke', 'user_revoke', 'GUILD_MASTER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'clear', 0, NULL),
      ('conflict', 'user_conflict', 'GUILD_MASTER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 0, NULL);

    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "guildMasterApprovedAt", "guildMasterAppliedAt",
      "guildMasterReviewNotes", "consecutiveMetricFailures", "metricWarningSentAt"
    ) VALUES
      ('member', NULL, NULL, NULL, 0, NULL),
      ('warn', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 0, NULL),
      ('recover', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 1, CURRENT_TIMESTAMP - INTERVAL '5 days'),
      ('revoke', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'clear', 1, CURRENT_TIMESTAMP - INTERVAL '31 days'),
      ('conflict', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'keep', 1, CURRENT_TIMESTAMP - INTERVAL '31 days');

    INSERT INTO public."MakerVerification" (id, "sellerProfileId", status) VALUES
      ('v_warn', 'warn', 'GUILD_MASTER_APPROVED'),
      ('v_recover', 'recover', 'GUILD_MASTER_APPROVED'),
      ('v_revoke', 'revoke', 'GUILD_MASTER_APPROVED'),
      ('v_conflict', 'conflict', 'APPROVED');

    INSERT INTO public."SellerMetrics" (
      id, "sellerProfileId", "calculatedAt", "periodMonths", "averageRating",
      "reviewCount", "onTimeShippingRate", "responseRate", "totalSalesCents",
      "completedOrderCount", "activeCaseCount", "accountAgeDays"
    ) VALUES
      ('m_member', 'member', CURRENT_TIMESTAMP, 3, 0, 0, 0, 0, 0, 0, 0, 30),
      ('m_warn', 'warn', CURRENT_TIMESTAMP, 3, 4.4, 24, .94, .89, 99999, 20, 1, 179),
      ('m_recover', 'recover', CURRENT_TIMESTAMP, 3, 4.5, 25, .95, .90, 100000, 20, 0, 180),
      ('m_revoke', 'revoke', CURRENT_TIMESTAMP, 3, 4.4, 24, .94, .89, 99999, 20, 1, 179),
      ('m_conflict', 'conflict', CURRENT_TIMESTAMP, 3, 4.4, 24, .94, .89, 99999, 20, 1, 179);
  `);
  await database.exec(migration);
  return database;
}

async function apply(database, sellerId) {
  return database.query(`
    SELECT *
      FROM public.grainline_seller_guild_metrics_apply(
        '${sellerId}',
        (SELECT "calculatedAt" FROM public."SellerMetrics" WHERE "sellerProfileId" = '${sellerId}')
      )
  `);
}

test("Guild metrics authority derives warning, recovery and revocation atomically", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const member = await apply(database, "member");
    const warned = await apply(database, "warn");
    const recovered = await apply(database, "recover");
    const revoked = await apply(database, "revoke");
    const conflict = await apply(database, "conflict");
    await database.exec("RESET ROLE");

    assert.equal(member.rows[0].action, "MEMBER_CHECKED");
    assert.equal(warned.rows[0].action, "MASTER_WARNED");
    assert.match(warned.rows[0].auditId, /^guild-metrics-warning:/);
    assert.equal(recovered.rows[0].action, "MASTER_RECOVERED");
    assert.equal(revoked.rows[0].action, "MASTER_REVOKED");
    assert.match(revoked.rows[0].auditId, /^guild-metrics-revocation:/);
    assert.equal(conflict.rows[0].action, "NOOP");

    const state = await database.query(`
      SELECT seller.id, seller."guildLevel"::text AS level,
             seller."consecutiveMetricFailures" AS public_failures,
             private."consecutiveMetricFailures" AS private_failures,
             seller."metricWarningSentAt" AS public_warning,
             private."metricWarningSentAt" AS private_warning,
             verification.status::text AS verification_status
        FROM public."SellerProfile" seller
        JOIN public."SellerProfilePrivate" private
          ON private."sellerProfileId" = seller.id
        LEFT JOIN public."MakerVerification" verification
          ON verification."sellerProfileId" = seller.id
       ORDER BY seller.id
    `);
    const byId = Object.fromEntries(state.rows.map((row) => [row.id, row]));
    assert.equal(byId.warn.public_failures, 1);
    assert.equal(byId.warn.private_failures, 1);
    assert.ok(byId.warn.public_warning);
    assert.deepEqual(byId.warn.public_warning, byId.warn.private_warning);
    assert.equal(byId.recover.public_failures, 0);
    assert.equal(byId.recover.private_failures, 0);
    assert.equal(byId.recover.public_warning, null);
    assert.equal(byId.revoke.level, "GUILD_MEMBER");
    assert.equal(byId.revoke.verification_status, "GUILD_MASTER_REJECTED");
    assert.equal(byId.conflict.level, "GUILD_MASTER");
    assert.equal(byId.conflict.verification_status, "APPROVED");

    const audits = await database.query(`
      SELECT action, metadata->>'sellerUserId' AS seller_user_id
        FROM public."SystemAuditLog"
       ORDER BY action
    `);
    assert.deepEqual(audits.rows, [
      { action: "AUTO_REVOKE_GUILD_MASTER", seller_user_id: "user_revoke" },
      { action: "WARN_GUILD_MASTER_METRICS", seller_user_id: "user_warn" },
    ]);
  } finally {
    await database.close();
  }
});

test("Guild metrics authority rejects replaced, stale and malformed snapshots", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT * FROM public.grainline_seller_guild_metrics_apply(
          'warn', TIMESTAMP '2020-01-01'
        )
      `),
      /absent, stale or replaced/,
    );
    await database.exec("RESET ROLE");

    await database.exec(`
      UPDATE public."SellerMetrics"
         SET "averageRating" = 'NaN'::double precision
       WHERE "sellerProfileId" = 'warn'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(apply(database, "warn"), /snapshot is invalid/);
  } finally {
    await database.close();
  }
});

test("Guild metrics authority exposes only the fixed operation to ordinary runtime", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied/,
    );
    await database.exec("RESET ROLE; SET ROLE grainline_untrusted");
    await assert.rejects(apply(database, "warn"), /permission denied/);
  } finally {
    await database.close();
  }
});
