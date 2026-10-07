import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261006020000_prepare_user_account_deletion_authorities/migration.sql";

async function databaseFixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" text NOT NULL UNIQUE,
      email text NOT NULL,
      name text,
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "bannedAt" timestamp(3),
      "banReason" text,
      "bannedBy" text,
      "deletedAt" timestamp(3),
      "imageUrl" text,
      "shippingName" text,
      "shippingLine1" text,
      "shippingLine2" text,
      "shippingCity" text,
      "shippingState" text,
      "shippingPostalCode" text,
      "shippingPhone" text,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" text NOT NULL,
      city text,
      state text,
      "stripeAccountId" text,
      "stripeAccountVersion" text,
      "stripeControllerType" text,
      "shipFromName" text,
      "shipFromLine1" text,
      "shipFromLine2" text,
      "shipFromCity" text,
      "shipFromState" text,
      "shipFromPostal" text,
      "shipFromPhone" text,
      tagline text,
      "bannerImageUrl" text,
      "avatarImageUrl" text,
      "workshopImageUrl" text,
      "instagramUrl" text,
      "facebookUrl" text,
      "pinterestUrl" text,
      "tiktokUrl" text,
      "websiteUrl" text
    );
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY,
      "userId" text NOT NULL,
      kind text NOT NULL,
      "dedupKey" text NOT NULL UNIQUE,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'PENDING'
    );
  `);
  await database.exec(readFileSync(migrationPath, "utf8"));
  return database;
}

test("User account-deletion authorities bind lifecycle access to exact durable sources", async () => {
  const database = await databaseFixture();
  try {
    await database.exec(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, "shippingLine1", "shippingCity"
      ) VALUES (
        'user_delete', 'clerk_delete', 'owner@example.com', 'Owner', '1 Main St', 'Austin'
      );
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "stripeAccountId", "shipFromPhone", "websiteUrl"
      ) VALUES (
        'seller_delete', 'user_delete', 'Owner Shop', 'acct_test', '+15125550100',
        'https://example.test/shop'
      );
      INSERT INTO public."AccountDeletionSideEffect" (
        id, "userId", kind, "dedupKey", payload, status
      ) VALUES (
        'effect_delete', 'user_delete', 'LOCAL_ANONYMIZE',
        'account-delete:local:user_delete', '{}'::jsonb, 'PENDING'
      );
    `);

    const preflight = await database.query(`
      SELECT * FROM public.grainline_user_account_deletion_preflight('effect_delete')
    `);
    assert.deepEqual(preflight.rows, [{
      userId: "user_delete",
      clerkId: "clerk_delete",
      deletedAt: null,
      sellerProfileId: "seller_delete",
      stripeAccountId: "acct_test",
      stripeAccountVersion: null,
      stripeControllerType: null,
    }]);

    await database.exec("BEGIN");
    const snapshot = await database.query(`
      SELECT * FROM public.grainline_user_account_deletion_snapshot('effect_delete')
    `);
    assert.equal(snapshot.rows[0].userId, "user_delete");
    assert.equal(snapshot.rows[0].sellerShipFromPhone, "+15125550100");
    assert.equal(snapshot.rows[0].sellerWebsiteUrl, "https://example.test/shop");
    const finalized = await database.query(`
      SELECT * FROM public.grainline_user_account_deletion_finalize('effect_delete')
    `);
    await database.exec("COMMIT");
    assert.equal(finalized.rows[0].userId, "user_delete");
    assert.match(finalized.rows[0].clerkId, /^deleted:user_delete:[0-9]+$/);
    assert.equal(finalized.rows[0].email, "deleted+user_delete@deleted.thegrainline.local");
    assert.ok(finalized.rows[0].deletedAt instanceof Date);

    const stored = await database.query(`
      SELECT role::text, banned, "deletedAt", name, "shippingLine1"
        FROM public."User" WHERE id = 'user_delete'
    `);
    assert.deepEqual(stored.rows[0], {
      role: "USER",
      banned: true,
      deletedAt: finalized.rows[0].deletedAt,
      name: null,
      shippingLine1: null,
    });

    await database.exec(`
      INSERT INTO public."AccountDeletionSideEffect" (
        id, "userId", kind, "dedupKey", payload, status
      ) VALUES (
        'effect_forged', 'user_delete', 'LOCAL_ANONYMIZE',
        'account-delete:local:user_delete', '{"caller":"chosen"}'::jsonb, 'PENDING'
      ) ON CONFLICT ("dedupKey") DO UPDATE SET id = 'effect_forged', payload = '{"caller":"chosen"}'::jsonb
    `);
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_user_account_deletion_preflight('effect_forged')`),
      /Account-deletion source is not authorized/,
    );
  } finally {
    await database.close();
  }
});

test("provider-deleted deferral derives and mutates only the exact Clerk account", async () => {
  const database = await databaseFixture();
  try {
    await database.exec(`
      INSERT INTO public."User" (id, "clerkId", email, name)
      VALUES
        ('provider_target', 'clerk_provider_target', 'target@example.com', 'Target'),
        ('provider_other', 'clerk_provider_other', 'other@example.com', 'Other')
    `);
    const deferred = await database.query(`
      SELECT * FROM public.grainline_user_provider_deleted_defer('clerk_provider_target')
    `);
    assert.deepEqual(deferred.rows, [{
      id: "provider_target",
      email: "target@example.com",
      name: "Target",
    }]);
    const states = await database.query(`
      SELECT id, banned, "banReason" FROM public."User" ORDER BY id
    `);
    assert.equal(states.rows[0].id, "provider_other");
    assert.equal(states.rows[0].banned, false);
    assert.equal(states.rows[1].id, "provider_target");
    assert.equal(states.rows[1].banned, true);
    assert.match(states.rows[1].banReason, /Clerk account deleted/);
  } finally {
    await database.close();
  }
});

test("User account-deletion source uses only fixed authorities", () => {
  const source = readFileSync("src/lib/accountDeletion.ts", "utf8");
  const sideEffects = readFileSync("src/lib/accountDeletionSideEffects.ts", "utf8");
  const route = readFileSync("src/app/api/account/delete/route.ts", "utf8");
  const migration = readFileSync(migrationPath, "utf8");
  const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

  assert.doesNotMatch(source, /(?:prisma|tx)\.user\./);
  assert.doesNotMatch(source, /FROM\s+"User"/);
  assert.match(source, /deferProviderDeletedUserAccount\(tx/);
  assert.match(source, /getUserAccountDeletionPreflight/);
  assert.match(source, /getUserAccountDeletionSnapshot/);
  assert.match(source, /finalizeUserAccountDeletion/);
  assert.match(sideEffects, /sideEffectId: effect\.id/);
  assert.match(route, /sideEffectId,/);
  assert.match(migration, /status NOT IN \('PENDING', 'PROCESSING', 'FAILED'\)/);
  assert.match(migration, /payload IS DISTINCT FROM '\{}'::jsonb/);
  assert.match(migration, /FOR UPDATE/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  for (const functionName of [
    "grainline_user_provider_deleted_defer",
    "grainline_user_account_deletion_preflight",
    "grainline_user_account_deletion_snapshot",
    "grainline_user_account_deletion_finalize",
  ]) {
    assert.match(provision, new RegExp(`public\\."${functionName}"\\(text\\)`));
  }
  assert.match(
    provision,
    /WITH user_account_deletion_runtime[\s\S]*REVOKE ALL ON FUNCTION[\s\S]*WITH user_account_deletion_runtime[\s\S]*GRANT EXECUTE ON FUNCTION/,
  );
});
