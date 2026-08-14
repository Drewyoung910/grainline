import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  checkoutStockReservationRepairAction,
} = await import("../src/lib/checkoutStockReservationRepairState.ts");

function source(path) {
  return fs.readFileSync(path, "utf8");
}

const authoritySql = source("docs/rls-drafts/checkout-stock-reservation-authority.sql");
const authorityClient = source("src/lib/checkoutStockReservationAuthority.ts");

describe("durable checkout stock reservation guardrails", () => {
  it("preserves the predecessor schema and adds draft-only repair invariants", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260529190000_add_checkout_stock_reservation/migration.sql");
    const groupMigration = source("prisma/migrations/20260706003000_add_checkout_group_id_to_reservations/migration.sql");

    assert.match(schema, /model CheckoutStockReservation/);
    assert.match(schema, /checkoutGroupId\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(schema, /stripeSessionId\s+String\?\s+@unique/);
    assert.match(schema, /@@index\(\[buyerId, checkoutGroupId\]\)/);
    assert.match(schema, /@@index\(\[status, expiresAt\]\)/);
    assert.match(migration, /CREATE TABLE "CheckoutStockReservation"/);
    assert.match(groupMigration, /ADD COLUMN "checkoutGroupId" VARCHAR\(100\)/);
    for (const column of [
      "repairGeneration",
      "repairClaimedAt",
      "repairClaimKind",
      "lastRepairError",
      "lastRepairAttemptAt",
    ]) {
      assert.match(authoritySql, new RegExp(`ADD COLUMN "${column}"`));
    }
    assert.match(authoritySql, /CheckoutStockReservation_active_lock_key/);
    assert.match(
      authoritySql,
      /CREATE TRIGGER "CheckoutStockReservation_normalize_write"[\s\S]*grainline_checkout_reservation_normalize_write\(\)/,
    );
    assert.match(
      authoritySql,
      /grainline_checkout_reservation_normalize_write[\s\S]*grainline_checkout_reservation_items_valid/,
    );
    assert.doesNotMatch(
      authoritySql,
      /CHECK \(public\.grainline_checkout_reservation_items_valid/,
    );
  });

  it("creates source-derived reservations before Stripe and aborts only unbound failures", () => {
    const routes = [
      {
        path: "src/app/api/cart/checkout/single/route.ts",
        create: /createSingleCheckoutStockReservation\(\{/,
      },
      {
        path: "src/app/api/cart/checkout-seller/route.ts",
        create: /createCartCheckoutStockReservation\(\{/,
      },
    ];

    for (const { path, create } of routes) {
      const route = source(path);
      assert.match(route, create);
      assert.match(route, /checkoutStockReservationMetadata\(checkoutReservationId/);
      assert.match(route, /bindCheckoutStockReservationSession\(\{/);
      assert.match(route, /abortCheckoutStockReservation\(\{[\s\S]*buyerId:[\s\S]*payloadHash:/);
      assert.doesNotMatch(route, /(?:prisma|tx)\.checkoutStockReservation\./);
      assert.doesNotMatch(route, /SET "stockQuantity" = "stockQuantity" \+ \$\{reserved/);
    }

    assert.match(authoritySql, /grainline_checkout_reservation_create_cart[\s\S]*FROM public\."CartItem"[\s\S]*JOIN public\."Listing"/);
    assert.match(authoritySql, /grainline_checkout_reservation_create_single[\s\S]*FROM public\."Listing"/);
    assert.match(authoritySql, /grainline_checkout_reservation_checkout_abort[\s\S]*source_reservation\."stripeSessionId" IS NOT NULL[\s\S]*'retained'/);
  });

  it("rejects a priced source that changed before the database stock lock", () => {
    for (const routePath of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ]) {
      const route = source(routePath);
      const sourceMatch = route.indexOf("checkoutReservationSourceMatches(");
      const stripeCreate = route.indexOf("stripe.checkout.sessions.create(");

      assert.match(route, /checkoutReservationSourceMatches\(/);
      assert.match(route, /abortCheckoutStockReservation\(\{/);
      assert.match(route, /status: HTTP_STATUS\.CONFLICT/);
      assert.notEqual(sourceMatch, -1);
      assert.notEqual(stripeCreate, -1);
      assert.ok(sourceMatch < stripeCreate, `${routePath} must compare the locked source before Stripe creation`);
    }
  });

  it("never restores or releases a checkout lock while a created Stripe session may remain payable", () => {
    for (const routePath of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ]) {
      const route = source(routePath);
      const outerCatch = route.slice(route.lastIndexOf("} catch (err: unknown)"));
      const expireIndex = outerCatch.indexOf("stripe.checkout.sessions.expire(createdCheckoutSessionId)");
      const safetyDecisionIndex = outerCatch.indexOf("const reservationCanBeRestored");
      const buyerRestoreIndex = outerCatch.indexOf("restoreBuyerExpiredCheckoutStockOnce({");

      assert.match(route, /createdCheckoutSessionId = session\.id/);
      assert.match(route, /checkoutReservationSessionBound = true/);
      assert.notEqual(expireIndex, -1, `${routePath} must expire a created session in the outer catch`);
      assert.ok(expireIndex < safetyDecisionIndex, `${routePath} must attempt expiry before restoration`);
      assert.ok(safetyDecisionIndex < buyerRestoreIndex, `${routePath} must decide safety before bound restore`);
      assert.match(
        outerCatch,
        /reservationCanBeRestored &&\s*checkoutReservationSessionBound &&\s*createdCheckoutSessionId &&\s*checkoutBuyerId[\s\S]*restoreBuyerExpiredCheckoutStockOnce/,
      );
      assert.match(
        outerCatch,
        /else if \([\s\S]*reservationCanBeRestored[\s\S]*abortCheckoutStockReservation/,
      );
      assert.match(
        outerCatch,
        /if \(checkoutLockAcquired && reservationCanBeRestored && databaseReservationReleased\)/,
      );
      assert.doesNotMatch(route, /releaseCheckoutLock\(checkoutLockKeyValue\s*\)/);
      assert.match(
        outerCatch,
        /releaseCheckoutLock\(checkoutLockKeyValue, createdCheckoutSessionId\)/,
      );
      assert.match(
        outerCatch,
        /releasePreparingCheckoutLock\(checkoutLockKeyValue, checkoutLockOwnerToken\)/,
      );
    }
  });

  it("threads cart checkout group ids through metadata and database-derived creation", () => {
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");

    assert.match(sellerCheckout, /checkoutGroupId: z\.string\(\)\.uuid\(\)/);
    assert.match(sellerCheckout, /checkoutGroupId: body\.checkoutGroupId/);
    assert.match(sellerCheckout, /checkoutStockReservationMetadata\(checkoutReservationId, body\.checkoutGroupId\)/);
    assert.match(authoritySql, /grainline_checkout_reservation_create_cart\([\s\S]*p_checkout_group_id text/);
    assert.match(authoritySql, /"checkoutGroupId"[\s\S]*p_checkout_group_id/);
    const cartCreate = authoritySql.slice(
      authoritySql.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_create_cart("),
      authoritySql.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_create_single("),
    );
    const singleCreate = authoritySql.slice(
      authoritySql.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_create_single("),
      authoritySql.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_bind_session("),
    );
    assert.doesNotMatch(cartCreate, /p_reserved_items|p_checkout_lock_key/);
    assert.doesNotMatch(singleCreate, /p_reserved_items|p_checkout_lock_key|p_seller_id/);
  });

  it("binds Stripe source objects before source-bound completion or restoration", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const connectWebhook = source("src/app/api/stripe/webhook/connect/route.ts");
    const stripeEvents = source("src/lib/stripeWebhookEvents.ts");
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.match(webhook, /beginStripeWebhookEvent\([\s\S]*event\.id,[\s\S]*event\.type,[\s\S]*sourceObjectId/);
    for (const route of [webhook, connectWebhook]) {
      assert.match(route, /if \(typeof sourceObjectId !== "string" \|\| sourceObjectId\.length === 0\)/);
      assert.match(route, /beginStripeWebhookEvent\([\s\S]*sourceObjectId/);
    }
    assert.match(stripeEvents, /grainline_stripe_webhook_begin\(\$\{id\}, \$\{type\}, \$\{sourceObjectId\}\)/);
    assert.doesNotMatch(stripeEvents, /grainline_stripe_webhook_bind_source/);
    assert.match(authoritySql, /grainline_stripe_webhook_begin\([\s\S]*p_source_object_id text[\s\S]*grainline_stripe_webhook_bind_source/);
    assert.match(authoritySql, /source_event\."sourceObjectId" IS DISTINCT FROM p_source_object_id/);
    assert.match(authoritySql, /event\."sourceObjectId" = p_session_id/g);
    assert.match(webhook, /markCheckoutStockReservationCompleted\(tx, \{[\s\S]*eventId: event\.id[\s\S]*claimGeneration/);
    assert.match(restore, /restoreCheckoutStockReservationFromWebhook\(\{[\s\S]*eventId: input\.eventId[\s\S]*claimGeneration: input\.claimGeneration/);
  });

  it("serializes every session-bound restore against paid completion", () => {
    for (const functionName of [
      "grainline_checkout_reservation_webhook_restore",
      "grainline_checkout_reservation_buyer_expired_restore",
      "grainline_checkout_reservation_seller_expired_restore",
    ]) {
      const start = authoritySql.indexOf(`CREATE FUNCTION public.${functionName}(`);
      const end = authoritySql.indexOf("CREATE FUNCTION public.", start + 20);
      const block = authoritySql.slice(start, end === -1 ? authoritySql.length : end);
      const lockIndex = block.indexOf("pg_advisory_xact_lock(913337");
      const reservationIndex = block.indexOf('FROM public."CheckoutStockReservation"');
      const orderIndex = block.indexOf('FROM public."Order"');
      const restoreIndex = block.indexOf("grainline_checkout_reservation_restore_items");

      assert.notEqual(start, -1, functionName);
      assert.notEqual(lockIndex, -1, `${functionName} must take the session advisory lock`);
      assert.ok(lockIndex < reservationIndex, `${functionName} must lock before reading the reservation`);
      assert.ok(lockIndex < orderIndex, `${functionName} must lock before checking Order`);
      assert.ok(orderIndex < restoreIndex, `${functionName} must check Order before restoring stock`);
    }
  });

  it("registers bounded generation-fenced repair and database-selected pruning", () => {
    const vercel = source("vercel.json");
    const cronRoute = source("src/app/api/cron/checkout-stock-reservations/route.ts");
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.match(vercel, /"path": "\/api\/cron\/checkout-stock-reservations"/);
    assert.match(vercel, /"schedule": "\*\/15 \* \* \* \*"/);
    assert.match(cronRoute, /verifyCronRequest/);
    assert.match(cronRoute, /restoreStaleCheckoutStockReservations/);
    assert.match(cronRoute, /pruneTerminalCheckoutStockReservations/);
    assert.match(restore, /claimStaleCheckoutStockReservations\(take\)/);
    assert.match(restore, /finalizeCheckoutStockReservationRepair\(\{/);
    assert.match(restore, /pruneCheckoutStockReservationBatch\(take\)/);
    assert.doesNotMatch(restore, /(?:prisma|tx)\.checkoutStockReservation\./);
    assert.match(authoritySql, /grainline_checkout_reservation_repair_claim_batch[\s\S]*LEAST\(p_limit, 50\)[\s\S]*FOR UPDATE SKIP LOCKED/);
    assert.match(authoritySql, /grainline_checkout_reservation_prune_batch[\s\S]*LEAST\(p_limit, 100\)[\s\S]*FOR UPDATE SKIP LOCKED/);
  });

  it("repairs only reviewed provider states and stores transient failures outside terminal evidence", () => {
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.equal(checkoutStockReservationRepairAction({ status: "expired", payment_status: "unpaid" }), "restore");
    assert.equal(checkoutStockReservationRepairAction({ status: "open", payment_status: "unpaid" }), "expire_and_restore");
    assert.equal(checkoutStockReservationRepairAction({ status: "complete", payment_status: "unpaid" }), "skip_paid_or_complete");
    assert.equal(checkoutStockReservationRepairAction({ status: "expired", payment_status: "paid" }), "skip_paid_or_complete");
    assert.equal(checkoutStockReservationRepairAction({ status: "unknown", payment_status: "unpaid" }), "skip_unrecognized");

    for (const outcome of [
      "RETRIEVE_FAILED",
      "PAID_OR_COMPLETE",
      "UNRECOGNIZED",
      "EXPIRE_FAILED",
      "SESSION_EXPIRED_RESTORE",
    ]) {
      assert.match(restore, new RegExp(`"${outcome}"`));
    }
    assert.match(authoritySql, /"lastRepairError" = CASE p_outcome/);
    assert.match(authoritySql, /"lastRepairAttemptAt" = source_now/);
    assert.match(authoritySql, /NEW\."restoreReason" := NULL/);
    assert.doesNotMatch(restore, /restoreReason:\s*(?:reason|"session_)/);
  });

  it("retains stock when a completion event is not yet paid", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const branchStart = webhook.indexOf('if (s.payment_status !== "paid")');
    const branchEnd = webhook.indexOf("// Stripe snapshots", branchStart);
    const unpaidBranch = webhook.slice(branchStart, branchEnd);

    assert.notEqual(branchStart, -1);
    assert.notEqual(branchEnd, -1);
    assert.match(unpaidBranch, /stripe_checkout_completion_unpaid/);
    assert.doesNotMatch(unpaidBranch, /restoreUnorderedCheckoutStockOnce/);
  });

  it("exposes only fixed reservation operations through the application authority module", () => {
    for (const operation of [
      "createCartCheckoutStockReservation",
      "createSingleCheckoutStockReservation",
      "bindCheckoutStockReservationSession",
      "completeCheckoutStockReservation",
      "abortCheckoutStockReservation",
      "restoreCheckoutStockReservationFromWebhook",
      "restoreBuyerExpiredCheckoutStockReservation",
      "restoreSellerExpiredCheckoutStockReservation",
      "claimStaleCheckoutStockReservations",
      "claimAccountCheckoutStockReservations",
      "finalizeCheckoutStockReservationRepair",
      "pruneCheckoutStockReservationBatch",
      "resumeCheckoutStockReservations",
      "exportCheckoutStockReservations",
      "scrubCheckoutStockReservationsForAccount",
    ]) {
      assert.match(authorityClient, new RegExp(`export async function ${operation}\\(`));
    }
    assert.doesNotMatch(authorityClient, /reservedItems:\s*input|checkoutLockKey:\s*input/);
  });
});
