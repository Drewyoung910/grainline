import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildCaseLifecycleCorrection, caseLifecycleDefinitions } from "../scripts/build-case-lifecycle-correction.mjs";
import { caseLifecycleScenarios, runCaseLifecycleScenario } from "../scripts/case-lifecycle-correction-scenarios.mjs";
import { caseLifecycleProofPayload } from "../scripts/case-lifecycle-correction-postgres-proof.mjs";

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE grainline_app_runtime;
    CREATE TYPE "Role" AS ENUM ('USER','EMPLOYEE','ADMIN');
    CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING','SHIPPED','DELIVERED','PICKED_UP');
    CREATE TYPE "LabelStatus" AS ENUM ('PENDING','PURCHASED');
    CREATE TYPE "CaseStatus" AS ENUM ('OPEN','IN_DISCUSSION','PENDING_CLOSE','UNDER_REVIEW','RESOLVED','CLOSED');
    CREATE TYPE "CaseReason" AS ENUM ('NOT_RECEIVED','NOT_AS_DESCRIBED','DAMAGED','WRONG_ITEM','OTHER');
    CREATE TYPE "CaseResolution" AS ENUM ('DISMISSED','REFUND_FULL','REFUND_PARTIAL');
    CREATE TYPE "CaseMessageAuthorKind" AS ENUM ('BUYER','SELLER','STAFF');
    CREATE TYPE "NotificationType" AS ENUM ('CASE_MESSAGE','CASE_RESOLVED');
    CREATE TABLE "User" (id text PRIMARY KEY,"clerkId" text,email text,name text,
      role "Role" NOT NULL DEFAULT 'USER',banned boolean NOT NULL DEFAULT false,"deletedAt" timestamp,
      "createdAt" timestamp,"updatedAt" timestamp);
    CREATE TABLE "SellerProfile" (id text PRIMARY KEY,"userId" text,"displayName" text,
      "displayNameNormalized" text,"createdAt" timestamp,"updatedAt" timestamp);
    CREATE TABLE "Listing" (id text PRIMARY KEY,"sellerId" text,title text,description text,
      "priceCents" integer,"createdAt" timestamp,"updatedAt" timestamp);
    CREATE TABLE "Order" (id text PRIMARY KEY,"buyerId" text,"stripeChargeId" text,
      "itemsSubtotalCents" integer,"shippingAmountCents" integer,"taxAmountCents" integer,
      "paidAt" timestamp,"fulfillmentStatus" "FulfillmentStatus","labelStatus" "LabelStatus",
      "estimatedDeliveryDate" timestamp,"deliveredAt" timestamp,"pickedUpAt" timestamp,
      "reviewNeeded" boolean NOT NULL DEFAULT false,"sellerRefundId" text,
      "sellerRefundLockedAt" timestamp,"caseResolutionClaimId" text);
    CREATE TABLE "OrderItem" (id text PRIMARY KEY,"orderId" text,"listingId" text,quantity integer,"priceCents" integer);
    CREATE TABLE "OrderPaymentEvent" (id text,"orderId" text,"eventType" text,status text);
    CREATE TABLE "Case" (id text PRIMARY KEY,"orderId" text UNIQUE,"buyerId" text,"sellerId" text,
      reason "CaseReason",description text,status "CaseStatus",resolution "CaseResolution",
      "refundAmountCents" integer,"stripeRefundId" text,"sellerRespondBy" timestamp,
      "discussionStartedAt" timestamp,"escalateUnlocksAt" timestamp,
      "buyerMarkedResolved" boolean DEFAULT false,"sellerMarkedResolved" boolean DEFAULT false,
      "resolvedAt" timestamp,"resolvedById" text,"openedByPaymentEventId" text,
      "createdAt" timestamp,"updatedAt" timestamp);
    CREATE TABLE "CaseMessage" (id text PRIMARY KEY,"caseId" text,"authorId" text,
      "authorKind" "CaseMessageAuthorKind",body text,"createdAt" timestamp);
    CREATE TABLE "CaseOpenApplication" ("orderId" text PRIMARY KEY,"caseId" text,
      "buyerUserId" text,"sellerUserId" text,"openingMessageId" text,reason "CaseReason",
      "descriptionSha256" text,"auditLogId" text,"createdAt" timestamp);
    CREATE TABLE "AdminAuditLog" (id text PRIMARY KEY,"adminId" text,action text,"targetType" text,
      "targetId" text,reason text,metadata jsonb,undone boolean,"undoneAt" timestamp,
      "undoneBy" text,"undoneReason" text,"createdAt" timestamp);
    CREATE TABLE "SystemAuditLog" (id text PRIMARY KEY,"actorType" text,"actorId" text,action text,
      "targetType" text,"targetId" text,reason text,metadata jsonb,"createdAt" timestamp);
  `);
  for (const { before, name, args } of caseLifecycleDefinitions()) {
    await db.exec(before);
    await db.exec(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO grainline_app_runtime;`);
  }
  const cron = readFileSync("prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql", "utf8");
  const name = "grainline_case_cron_transition_batch";
  await db.exec(cron.slice(cron.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
    cron.indexOf(`$${name}$;`) + name.length + 3));
  await db.exec(`REVOKE ALL ON FUNCTION public.${name}(text,integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.${name}(text,integer) TO grainline_app_runtime;`);
  await db.exec(buildCaseLifecycleCorrection());
  await db.exec("BEGIN");
});
after(async () => { if (db) { await db.exec("ROLLBACK"); await db.close(); } });

for (const scenario of caseLifecycleScenarios) {
  test(scenario.name, () => runCaseLifecycleScenario(db, scenario));
}

test("draft changes exactly two attested bodies and preserves sealed migrations", () => {
  const sql = buildCaseLifecycleCorrection();
  assert.equal(sql.trimEnd(), readFileSync("docs/rls-drafts/case-lifecycle-correction.sql", "utf8").trimEnd());
  assert.equal(caseLifecycleDefinitions().length, 2);
  assert.doesNotMatch(sql, /(?:GRANT|REVOKE|ALTER TABLE|CREATE POLICY) /);
  assert.match(sql, /Case lifecycle before authority drifted/);
  assert.match(sql, /Case lifecycle after authority drifted/);
});

test("draft rejects changed predecessor bodies or PUBLIC execute without partially applying", async () => {
  for (const drift of ["body", "grant"]) {
    await db.query("SAVEPOINT drift_control");
    try {
      for (const { before } of caseLifecycleDefinitions()) await db.exec(before);
      if (drift === "body") {
        const { before } = caseLifecycleDefinitions()[0];
        await db.exec(before.replace("Case-open input is invalid", "Changed predecessor input error"));
      } else await db.exec("GRANT EXECUTE ON FUNCTION public.grainline_case_open(text,text,text,text) TO PUBLIC");
      await assert.rejects(() => db.exec(caseLifecycleProofPayload()), /Case lifecycle before authority drifted/);
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT drift_control");
      await db.query("RELEASE SAVEPOINT drift_control");
    }
  }
});
