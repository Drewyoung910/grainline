import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
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
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SOLD', 'HIDDEN', 'REJECTED'
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "guildLevel" public."GuildLevel" NOT NULL,
      "isVerifiedMaker" boolean NOT NULL DEFAULT false,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "metricWarningSentAt" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "metricWarningSentAt" timestamp(3) without time zone,
      "listingsBelowThresholdSince" timestamp(3) without time zone,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false
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
    CREATE TABLE public."GuildCaseGuard" (
      "sellerProfileId" text PRIMARY KEY,
      blocked boolean NOT NULL
    );
    CREATE FUNCTION public.grainline_case_guild_unresolved_guard(text)
    RETURNS TABLE(blocked boolean)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
      SELECT guard.blocked
        FROM public."GuildCaseGuard" guard
       WHERE guard."sellerProfileId" = $1
    $$;

    INSERT INTO public."SellerProfile" (
      id, "userId", "guildLevel", "isVerifiedMaker",
      "consecutiveMetricFailures", "metricWarningSentAt"
    ) VALUES
      ('case', 'user_case', 'GUILD_MEMBER', true, 3, CURRENT_TIMESTAMP),
      ('listing', 'user_listing', 'GUILD_MEMBER', true, 2, CURRENT_TIMESTAMP),
      ('restored', 'user_restored', 'GUILD_MEMBER', true, 0, NULL),
      ('recent', 'user_recent', 'GUILD_MEMBER', true, 0, NULL),
      ('conflict', 'user_conflict', 'GUILD_MEMBER', true, 0, NULL),
      ('none', 'user_none', 'NONE', false, 0, NULL);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "consecutiveMetricFailures", "metricWarningSentAt",
      "listingsBelowThresholdSince"
    ) VALUES
      ('case', 3, CURRENT_TIMESTAMP, NULL),
      ('listing', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '31 days'),
      ('restored', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '31 days'),
      ('recent', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '29 days'),
      ('conflict', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '31 days'),
      ('none', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '31 days');
    INSERT INTO public."MakerVerification" (id, "sellerProfileId", status) VALUES
      ('v_case', 'case', 'GUILD_MASTER_REJECTED'),
      ('v_listing', 'listing', 'APPROVED'),
      ('v_restored', 'restored', 'APPROVED'),
      ('v_recent', 'recent', 'APPROVED'),
      ('v_conflict', 'conflict', 'PENDING'),
      ('v_none', 'none', 'APPROVED');
    INSERT INTO public."GuildCaseGuard" ("sellerProfileId", blocked) VALUES
      ('case', true), ('listing', false), ('restored', false),
      ('recent', false), ('conflict', false), ('none', true);
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate")
    SELECT 'restored_' || value::text, 'restored', 'ACTIVE', false
      FROM pg_catalog.generate_series(1, 5) value;
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate") VALUES
      ('listing_private', 'listing', 'ACTIVE', true),
      ('listing_draft', 'listing', 'DRAFT', false);
  `);
  await database.exec(migration);
  return database;
}

async function revoke(database, sellerId) {
  return database.query(`
    SELECT *
      FROM public.grainline_seller_guild_member_revoke('${sellerId}')
  `);
}

test("Guild Member authority derives case and listing revocations atomically", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const caseResult = await revoke(database, "case");
    const listingResult = await revoke(database, "listing");
    const restoredResult = await revoke(database, "restored");
    const recentResult = await revoke(database, "recent");
    const conflictResult = await revoke(database, "conflict");
    const noneResult = await revoke(database, "none");
    await database.exec("RESET ROLE");

    assert.equal(caseResult.rows[0].applied, true);
    assert.equal(caseResult.rows[0].guardKind, "unresolved_case");
    assert.match(caseResult.rows[0].auditId, /^guild-member-revocation:/);
    assert.match(caseResult.rows[0].reason, /unresolved dispute/);
    assert.equal(listingResult.rows[0].applied, true);
    assert.equal(listingResult.rows[0].guardKind, "listing_threshold");
    assert.match(listingResult.rows[0].reason, /fewer than 5 active listings/);
    assert.equal(restoredResult.rows[0].applied, false);
    assert.equal(recentResult.rows[0].applied, false);
    assert.equal(conflictResult.rows[0].applied, false);
    assert.equal(noneResult.rows[0].applied, false);

    const state = await database.query(`
      SELECT seller.id, seller."guildLevel"::text AS level,
             seller."isVerifiedMaker" AS verified,
             seller."consecutiveMetricFailures" AS public_failures,
             private."consecutiveMetricFailures" AS private_failures,
             verification.status::text AS verification_status
        FROM public."SellerProfile" seller
        JOIN public."SellerProfilePrivate" private
          ON private."sellerProfileId" = seller.id
        JOIN public."MakerVerification" verification
          ON verification."sellerProfileId" = seller.id
       ORDER BY seller.id
    `);
    const byId = Object.fromEntries(state.rows.map((row) => [row.id, row]));
    for (const sellerId of ["case", "listing"]) {
      assert.equal(byId[sellerId].level, "NONE");
      assert.equal(byId[sellerId].verified, false);
      assert.equal(byId[sellerId].public_failures, 0);
      assert.equal(byId[sellerId].private_failures, 0);
      assert.equal(byId[sellerId].verification_status, "REJECTED");
    }
    assert.equal(byId.restored.level, "GUILD_MEMBER");
    assert.equal(byId.recent.level, "GUILD_MEMBER");
    assert.equal(byId.conflict.level, "GUILD_MEMBER");

    const audits = await database.query(`
      SELECT "targetId" AS target_id, metadata->>'guardKind' AS guard_kind
        FROM public."SystemAuditLog"
       ORDER BY "targetId"
    `);
    assert.deepEqual(audits.rows, [
      { target_id: "case", guard_kind: "unresolved_case" },
      { target_id: "listing", guard_kind: "listing_threshold" },
    ]);
  } finally {
    await database.close();
  }
});

test("Guild Member authority exposes only the fixed operation to runtime", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied/,
    );
    await database.exec("RESET ROLE; SET ROLE grainline_untrusted");
    await assert.rejects(revoke(database, "case"), /permission denied/);
  } finally {
    await database.close();
  }
});
