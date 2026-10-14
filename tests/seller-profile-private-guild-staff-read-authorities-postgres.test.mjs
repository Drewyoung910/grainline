import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014210000_prepare_seller_profile_private_guild_staff_read_authorities/migration.sql",
  "utf8",
);

async function asRole(database, role, operation) {
  await database.exec(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await operation();
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
  }
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TYPE public."VerificationStatus" AS ENUM (
      'PENDING', 'APPROVED', 'REJECTED',
      'GUILD_MASTER_PENDING', 'GUILD_MASTER_APPROVED', 'GUILD_MASTER_REJECTED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY, role text NOT NULL, banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "displayName" text NOT NULL,
      "guildLevel" public."GuildLevel" NOT NULL,
      "featuredUntil" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "guildMemberApprovedAt" timestamp(3) without time zone,
      "guildMasterApprovedAt" timestamp(3) without time zone,
      "guildMasterAppliedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."MakerVerification" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "craftDescription" text NOT NULL,
      "guildMasterCraftBusiness" text,
      "yearsExperience" integer NOT NULL,
      "portfolioUrl" text,
      status public."VerificationStatus" NOT NULL,
      "appliedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."SellerMetrics" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "calculatedAt" timestamp(3) without time zone NOT NULL,
      "periodMonths" integer NOT NULL,
      "averageRating" double precision NOT NULL,
      "reviewCount" integer NOT NULL,
      "onTimeShippingRate" double precision NOT NULL,
      "responseRate" double precision NOT NULL,
      "totalSalesCents" bigint NOT NULL,
      "completedOrderCount" integer NOT NULL,
      "activeCaseCount" integer NOT NULL,
      "accountAgeDays" integer NOT NULL
    );
    INSERT INTO public."User" (id, role, banned) VALUES
      ('staff', 'EMPLOYEE', false), ('admin', 'ADMIN', false),
      ('banned_staff', 'EMPLOYEE', true), ('user', 'USER', false);
    INSERT INTO public."SellerProfile" (id, "displayName", "guildLevel", "featuredUntil") VALUES
      ('member_old', 'Member Old', 'GUILD_MEMBER', NULL),
      ('member_new', 'Member New', 'GUILD_MEMBER', CURRENT_TIMESTAMP + INTERVAL '1 day'),
      ('master', 'Master', 'GUILD_MASTER', NULL),
      ('revoked', 'Revoked', 'NONE', NULL),
      ('never_member', 'Never Member', 'NONE', NULL),
      ('pending', 'Pending Master', 'GUILD_MEMBER', NULL);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "guildMemberApprovedAt", "guildMasterApprovedAt", "guildMasterAppliedAt"
    ) VALUES
      ('member_old', CURRENT_TIMESTAMP - INTERVAL '2 days', NULL, NULL),
      ('member_new', CURRENT_TIMESTAMP - INTERVAL '1 day', NULL, NULL),
      ('master', CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '1 day', NULL),
      ('revoked', CURRENT_TIMESTAMP - INTERVAL '3 days', NULL, NULL),
      ('never_member', NULL, NULL, NULL),
      ('pending', CURRENT_TIMESTAMP - INTERVAL '4 days', NULL, CURRENT_TIMESTAMP - INTERVAL '1 hour');
    INSERT INTO public."MakerVerification" (
      id, "sellerProfileId", "craftDescription", "guildMasterCraftBusiness",
      "yearsExperience", "portfolioUrl", status, "appliedAt"
    ) VALUES (
      'verification', 'pending', 'craft', 'business', 8, 'https://example.com',
      'GUILD_MASTER_PENDING', CURRENT_TIMESTAMP - INTERVAL '1 hour'
    );
    INSERT INTO public."SellerMetrics" VALUES (
      'pending', CURRENT_TIMESTAMP, 3, 4.9, 30, .98, .97, 200000, 25, 0, 900
    );
  `);
  await database.exec(migration);
  return database;
}

test("Guild staff projections return bounded private lifecycle data", async () => {
  const database = await createDatabase();
  try {
    await asRole(database, "grainline_staff_read_runtime", async () => {
      const members = await database.query(`
        SELECT id, "guildMemberApprovedAt" IS NOT NULL AS approved
          FROM public.grainline_seller_guild_staff_roster('staff', 'GUILD_MEMBER')
      `);
      assert.deepEqual(members.rows, [
        { id: "member_new", approved: true },
        { id: "member_old", approved: true },
        { id: "pending", approved: true },
      ]);
      const revoked = await database.query(`
        SELECT id FROM public.grainline_seller_guild_staff_roster('admin', 'REVOKED_MEMBER')
      `);
      assert.deepEqual(revoked.rows, [{ id: "revoked" }]);
      const pending = await database.query(`
        SELECT id, "sellerProfileId", "guildMasterAppliedAt" IS NOT NULL AS applied,
               "metricsTotalSalesCents" AS sales
          FROM public.grainline_seller_guild_staff_master_pending('staff')
      `);
      assert.deepEqual(pending.rows, [{
        id: "verification",
        sellerProfileId: "pending",
        applied: true,
        sales: 200000,
      }]);
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_seller_guild_staff_roster('banned_staff', 'GUILD_MEMBER')`),
        /not authorized/,
      );
    });
  } finally {
    await database.close();
  }
});

test("Guild staff projections deny the ordinary runtime and direct private reads", async () => {
  const database = await createDatabase();
  try {
    await asRole(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_seller_guild_staff_roster('staff', 'GUILD_MEMBER')`),
        /permission denied/,
      );
    });
    await asRole(database, "grainline_staff_read_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public."SellerProfilePrivate"`),
        /permission denied/,
      );
    });
  } finally {
    await database.close();
  }
});
