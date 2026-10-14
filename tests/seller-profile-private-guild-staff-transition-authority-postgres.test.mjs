import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
  "utf8",
);
const hotfix = readFileSync(
  sellerProfilePrivateMigrationPath("20261015000000_correct_seller_profile_private_app_authorities"),
  "utf8",
);

function hotfixFunction(name) {
  const start = hotfix.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const marker = `$${name}$;`;
  const end = hotfix.indexOf(marker, start);
  assert.ok(start >= 0 && end >= start, `${name} hotfix must be present`);
  return hotfix.slice(start, end + marker.length);
}

async function asRole(database, role, operation) {
  await database.exec(`SET SESSION AUTHORIZATION ${role}`);
  try { return await operation(); }
  finally { await database.exec("RESET SESSION AUTHORIZATION"); }
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TYPE public."VerificationStatus" AS ENUM ('PENDING','APPROVED','REJECTED','GUILD_MASTER_PENDING','GUILD_MASTER_APPROVED','GUILD_MASTER_REJECTED');
    CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT','ACTIVE','HIDDEN');
    CREATE TABLE public."User" (id text PRIMARY KEY, role text NOT NULL, banned boolean NOT NULL, "deletedAt" timestamp(3));
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL, "displayName" text NOT NULL,
      "guildLevel" public."GuildLevel" NOT NULL, "ownerAccountActive" boolean NOT NULL,
      "isVerifiedMaker" boolean NOT NULL DEFAULT false, "verifiedAt" timestamp(3),
      "guildMemberApprovedAt" timestamp(3), "guildMasterApprovedAt" timestamp(3),
      "guildMasterAppliedAt" timestamp(3), "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0, "metricWarningSentAt" timestamp(3),
      "listingsBelowThresholdSince" timestamp(3), "lastMetricCheckAt" timestamp(3), "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "guildMemberApprovedAt" timestamp(3), "guildMasterApprovedAt" timestamp(3),
      "guildMasterAppliedAt" timestamp(3), "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0, "metricWarningSentAt" timestamp(3),
      "listingsBelowThresholdSince" timestamp(3), "lastMetricCheckAt" timestamp(3), "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."MakerVerification" (
      id text PRIMARY KEY, "sellerProfileId" text NOT NULL UNIQUE REFERENCES public."SellerProfile"(id),
      status public."VerificationStatus" NOT NULL, "reviewedById" text, "reviewedAt" timestamp(3),
      "reviewNotes" text, "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (id text PRIMARY KEY, "sellerId" text NOT NULL, status public."ListingStatus" NOT NULL, "isPrivate" boolean NOT NULL);
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY, "adminId" text NOT NULL, action text NOT NULL, "targetType" text NOT NULL,
      "targetId" text NOT NULL, reason varchar(1000), metadata jsonb NOT NULL, undone boolean NOT NULL, "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."GuildCaseGuard" ("sellerProfileId" text PRIMARY KEY, blocked boolean NOT NULL);
    CREATE FUNCTION public.grainline_case_guild_unresolved_guard(text) RETURNS TABLE(blocked boolean)
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT guard.blocked FROM public."GuildCaseGuard" guard WHERE guard."sellerProfileId"=$1
    $$;
    CREATE FUNCTION public.test_seller_guild_levels() RETURNS TABLE(id text, level text)
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT seller.id, seller."guildLevel"::text
        FROM public."SellerProfile" AS seller
       ORDER BY seller.id
    $$;
    CREATE FUNCTION public.test_admin_audit_count() RETURNS integer
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT pg_catalog.count(*)::integer FROM public."AdminAuditLog"
    $$;
    CREATE FUNCTION public.test_guild_rejection_lengths(text)
    RETURNS TABLE(review_notes_length integer, audit_reason_length integer)
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT pg_catalog.length(verification."reviewNotes")::integer,
             pg_catalog.length(audit.reason)::integer
        FROM public."MakerVerification" AS verification
        JOIN public."AdminAuditLog" AS audit
          ON audit."targetId" = verification."sellerProfileId"
       WHERE verification.id = $1
    $$;
    REVOKE ALL ON FUNCTION public.test_seller_guild_levels() FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.test_admin_audit_count() FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.test_guild_rejection_lengths(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.test_seller_guild_levels() TO grainline_staff_read_runtime;
    GRANT EXECUTE ON FUNCTION public.test_admin_audit_count() TO grainline_staff_read_runtime;
    GRANT EXECUTE ON FUNCTION public.test_guild_rejection_lengths(text) TO grainline_staff_read_runtime;
    INSERT INTO public."User" VALUES ('employee','EMPLOYEE',false,NULL),('admin','ADMIN',false,NULL),('user','USER',false,NULL);
    INSERT INTO public."SellerProfile" (id,"userId","displayName","guildLevel","ownerAccountActive","isVerifiedMaker","guildMemberApprovedAt") VALUES
      ('approve_member','u1','Approve Member','NONE',true,false,NULL),
      ('reject_member','u2','Reject Member','NONE',true,false,NULL),
      ('revoke_member','u3','Revoke Member','GUILD_MEMBER',true,true,CURRENT_TIMESTAMP),
      ('approve_master','u4','Approve Master','GUILD_MEMBER',true,true,CURRENT_TIMESTAMP),
      ('reject_master','u5','Reject Master','GUILD_MEMBER',true,true,CURRENT_TIMESTAMP),
      ('revoke_master','u6','Revoke Master','GUILD_MASTER',true,true,CURRENT_TIMESTAMP),
      ('reinstate','u7','Reinstate','NONE',true,false,CURRENT_TIMESTAMP);
    INSERT INTO public."SellerProfilePrivate" ("sellerProfileId","guildMemberApprovedAt")
      SELECT id,"guildMemberApprovedAt" FROM public."SellerProfile";
    INSERT INTO public."MakerVerification" (id,"sellerProfileId",status) VALUES
      ('v1','approve_member','PENDING'),('v2','reject_member','PENDING'),('v3','revoke_member','APPROVED'),
      ('v4','approve_master','GUILD_MASTER_PENDING'),('v5','reject_master','GUILD_MASTER_PENDING'),
      ('v6','revoke_master','GUILD_MASTER_APPROVED'),('v7','reinstate','REJECTED');
    INSERT INTO public."GuildCaseGuard" VALUES
      ('approve_member',false),('reject_member',false),('revoke_member',false),('approve_master',false),
      ('reject_master',false),('revoke_master',false),('reinstate',false);
    INSERT INTO public."Listing" SELECT 'listing_'||value, 'reinstate', 'ACTIVE', false FROM generate_series(1,5) value;
  `);
  await database.exec(migration);
  await database.exec(hotfixFunction("grainline_seller_guild_staff_transition"));
  return database;
}

async function transition(database, actor, operation, verificationId, sellerProfileId, notes = null, override = false) {
  const literal = (value) => value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
  return database.query(`SELECT * FROM public.grainline_seller_guild_staff_transition(
    ${literal(actor)}, ${literal(operation)}, ${literal(verificationId)}, ${literal(sellerProfileId)}, ${literal(notes)}, ${override}
  )`);
}

test("Guild staff transition pairs all seven state changes with audits", async () => {
  const database = await createDatabase();
  try {
    const results = await asRole(database, "grainline_staff_read_runtime", async () => {
      const rows = [];
      rows.push(await transition(database,"admin","APPROVE_GUILD_MEMBER","v1",null,null,true));
      rows.push(await transition(database,"employee","REJECT_GUILD_MEMBER","v2",null,"no"));
      rows.push(await transition(database,"employee","REVOKE_GUILD_MEMBER",null,"revoke_member"));
      rows.push(await transition(database,"employee","APPROVE_GUILD_MASTER","v4",null));
      rows.push(await transition(database,"employee","REJECT_GUILD_MASTER","v5",null,"later"));
      rows.push(await transition(database,"employee","REVOKE_GUILD_MASTER",null,"revoke_master"));
      rows.push(await transition(database,"admin","REINSTATE_GUILD_MEMBER",null,"reinstate"));
      const state = await database.query(`SELECT * FROM public.test_seller_guild_levels()`);
      const audits = await database.query(`SELECT public.test_admin_audit_count() AS value`);
      await assert.rejects(
        database.query(`SELECT id FROM public."SellerProfile" LIMIT 1`),
        /permission denied/,
      );
      return { rows, state, audits };
    });
    assert.ok(results.rows.every((result) => result.rows[0].applied === true));
    assert.ok(results.rows.every((result) => typeof result.rows[0].auditId === "string"));
    const levels = Object.fromEntries(results.state.rows.map((row) => [row.id,row.level]));
    assert.equal(levels.approve_member,"GUILD_MEMBER");
    assert.equal(levels.approve_master,"GUILD_MASTER");
    assert.equal(levels.revoke_member,"NONE");
    assert.equal(levels.revoke_master,"GUILD_MEMBER");
    assert.equal(levels.reinstate,"GUILD_MEMBER");
    assert.equal(results.audits.rows[0].value,7);
  } finally { await database.close(); }
});

test("Guild staff transition rejects forged roles and stale transitions", async () => {
  const database = await createDatabase();
  try {
    await asRole(database,"grainline_app_runtime", async () => {
      await assert.rejects(transition(database,"admin","REINSTATE_GUILD_MEMBER",null,"reinstate"),/permission denied/);
    });
    await asRole(database,"grainline_staff_read_runtime", async () => {
      await assert.rejects(transition(database,"employee",null,null,"reinstate"),/input is invalid/);
      await assert.rejects(transition(database,"user","REVOKE_GUILD_MEMBER",null,"revoke_member"),/not authorized/);
      await assert.rejects(transition(database,"employee","REINSTATE_GUILD_MEMBER",null,"reinstate"),/not authorized/);
      await assert.rejects(transition(database,"employee","APPROVE_GUILD_MEMBER","v1",null,null,true),/not authorized/);
      const stale = await transition(database,"employee","APPROVE_GUILD_MEMBER","v3",null);
      assert.equal(stale.rows[0].applied,false);
    });
  } finally { await database.close(); }
});

test("Guild rejection preserves full review notes but bounds the audit reason", async () => {
  const database = await createDatabase();
  try {
    const notes = "x".repeat(2000);
    await asRole(database, "grainline_staff_read_runtime", async () => {
      const result = await transition(database, "employee", "REJECT_GUILD_MEMBER", "v2", null, notes);
      assert.equal(result.rows[0].applied, true);
      const lengths = await database.query(`SELECT * FROM public.test_guild_rejection_lengths('v2')`);
      assert.deepEqual(lengths.rows, [{ review_notes_length: 2000, audit_reason_length: 500 }]);
    });
  } finally { await database.close(); }
});
