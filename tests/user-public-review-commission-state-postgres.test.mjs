import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261007020000_prepare_user_public_review_commission_state/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      name varchar(100),
      "imageUrl" varchar(2048)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      city varchar(100),
      state varchar(50)
    );
    CREATE TABLE public."Review" (
      id text PRIMARY KEY,
      "reviewerId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE
    );
    CREATE TABLE public."CommissionRequest" (
      id text PRIMARY KEY,
      "buyerId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT
    );
    INSERT INTO public."User" (id, banned, "deletedAt", name, "imageUrl") VALUES
      ('active', false, NULL, 'Active Buyer', 'https://example.test/active.png'),
      ('banned', true, NULL, 'Banned Buyer', 'https://example.test/banned.png'),
      ('plain', false, NULL, 'Plain Buyer', NULL);
    INSERT INTO public."SellerProfile" (id, "userId", city, state) VALUES
      ('seller-active', 'active', 'Austin', 'TX');
    INSERT INTO public."Review" (id, "reviewerId") VALUES
      ('review-active', 'active'), ('review-banned', 'banned');
    INSERT INTO public."CommissionRequest" (id, "buyerId") VALUES
      ('commission-active', 'active'), ('commission-banned', 'banned');
  `);
  await database.exec(migration);
  return database;
}

async function reviewState(database, id) {
  const result = await database.query(
    `SELECT "reviewerId", "reviewerAccountActive", "reviewerName", "reviewerImageUrl"
       FROM public."Review" WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function commissionState(database, id) {
  const result = await database.query(
    `SELECT "buyerId", "buyerAccountActive", "buyerName", "buyerImageUrl",
            "buyerSellerCity", "buyerSellerState"
       FROM public."CommissionRequest" WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

describe("User public review and commission PostgreSQL proof", () => {
  it("backfills lifecycle, identity, and seller location snapshots", async () => {
    const database = await createDatabase();
    try {
      assert.deepEqual(await reviewState(database, "review-active"), {
        reviewerId: "active",
        reviewerAccountActive: true,
        reviewerName: "Active Buyer",
        reviewerImageUrl: "https://example.test/active.png",
      });
      assert.equal((await reviewState(database, "review-banned")).reviewerAccountActive, false);
      assert.deepEqual(await commissionState(database, "commission-active"), {
        buyerId: "active",
        buyerAccountActive: true,
        buyerName: "Active Buyer",
        buyerImageUrl: "https://example.test/active.png",
        buyerSellerCity: "Austin",
        buyerSellerState: "TX",
      });
      assert.equal((await commissionState(database, "commission-banned")).buyerAccountActive, false);
    } finally {
      await database.close();
    }
  });

  it("synchronizes User and seller changes in the writing transaction", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."User"
           SET banned = true, name = 'Renamed Buyer',
               "imageUrl" = 'https://example.test/renamed.png'
         WHERE id = 'active';
        UPDATE public."SellerProfile"
           SET city = 'Round Rock', state = 'TX'
         WHERE "userId" = 'active';
      `);
      const review = await reviewState(database, "review-active");
      assert.equal(review.reviewerAccountActive, false);
      assert.equal(review.reviewerName, "Renamed Buyer");
      const commission = await commissionState(database, "commission-active");
      assert.equal(commission.buyerAccountActive, false);
      assert.equal(commission.buyerName, "Renamed Buyer");
      assert.equal(commission.buyerSellerCity, "Round Rock");

      await database.exec(`DELETE FROM public."SellerProfile" WHERE "userId" = 'active'`);
      assert.equal((await commissionState(database, "commission-active")).buyerSellerCity, null);
      await database.exec(`INSERT INTO public."SellerProfile" (id, "userId", city, state) VALUES ('seller-new', 'active', 'Dallas', 'TX')`);
      assert.equal((await commissionState(database, "commission-active")).buyerSellerCity, "Dallas");
    } finally {
      await database.close();
    }
  });

  it("overwrites forged snapshots, binds inserts, and rejects actor rebinding", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."Review"
           SET "reviewerAccountActive" = true, "reviewerName" = 'Forged'
         WHERE id = 'review-banned';
        UPDATE public."CommissionRequest"
           SET "buyerAccountActive" = true, "buyerName" = 'Forged',
               "buyerSellerCity" = 'Forged'
         WHERE id = 'commission-banned';
        INSERT INTO public."Review" (id, "reviewerId", "reviewerName")
        VALUES ('review-new', 'plain', 'Forged');
        INSERT INTO public."CommissionRequest" (id, "buyerId", "buyerName")
        VALUES ('commission-new', 'plain', 'Forged');
      `);
      assert.equal((await reviewState(database, "review-banned")).reviewerName, "Banned Buyer");
      assert.equal((await reviewState(database, "review-new")).reviewerName, "Plain Buyer");
      assert.equal((await commissionState(database, "commission-banned")).buyerName, "Banned Buyer");
      assert.equal((await commissionState(database, "commission-banned")).buyerSellerCity, null);
      assert.equal((await commissionState(database, "commission-new")).buyerName, "Plain Buyer");

      await assert.rejects(
        database.exec(`UPDATE public."Review" SET "reviewerId" = 'active' WHERE id = 'review-banned'`),
        /Review reviewer cannot be rebound/,
      );
      await assert.rejects(
        database.exec(`UPDATE public."CommissionRequest" SET "buyerId" = 'active' WHERE id = 'commission-banned'`),
        /Commission buyer cannot be rebound/,
      );
    } finally {
      await database.close();
    }
  });

  it("does not expose any trigger function to PUBLIC", async () => {
    const database = await createDatabase();
    try {
      const privileges = await database.query(`
        SELECT COUNT(*)::int AS public_execute_count
          FROM pg_catalog.pg_proc AS procedure
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) AS acl
         WHERE procedure.oid IN (
           pg_catalog.to_regprocedure('grainline_review_reviewer_public_state_bind()'),
           pg_catalog.to_regprocedure('grainline_commission_buyer_public_state_bind()'),
           pg_catalog.to_regprocedure('grainline_user_public_review_commission_state_sync()'),
           pg_catalog.to_regprocedure('grainline_seller_public_commission_state_sync()')
         )
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      `);
      assert.equal(privileges.rows[0].public_execute_count, 0);
    } finally {
      await database.close();
    }
  });
});
