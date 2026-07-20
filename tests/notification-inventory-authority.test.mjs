import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Notification inventory authority", () => {
  const webhook = source("src/app/api/stripe/webhook/route.ts");
  const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
  const sql = source("docs/rls-drafts/notification-service-authority.sql");
  const plan = source("docs/rls-bucket-b-notification-plan.md");

  it("binds webhook low-stock to one deterministic paid order item source", () => {
    assert.match(webhook, /items: \{\s*select: \{\s*id: true,/);
    assert.match(webhook, /item\.id < current\.orderItemId/);
    assert.match(
      webhook,
      /type: "LOW_STOCK",[\s\S]{0,350}sourceType: NOTIFICATION_SOURCE_TYPES\.CHECKOUT_LOW_STOCK,\s*sourceId: sourceItem\.orderItemId/,
    );
  });

  it("derives checkout low-stock authority, payload, route, and replay source from durable rows", () => {
    assert.match(sql, /p_source_type = 'checkout_low_stock'[\s\S]{0,80}p_type <> 'LOW_STOCK'/);
    assert.match(sql, /FROM public\."OrderItem" AS source_item/);
    assert.match(sql, /JOIN public\."Order" AS source_order/);
    assert.match(sql, /JOIN public\."CheckoutStockReservation" AS source_reservation/);
    assert.match(sql, /source_order\."paidAt" IS NOT NULL/);
    assert.match(sql, /source_reservation\.status = 'COMPLETED'/);
    assert.match(sql, /source_reservation\."reservedItems" @> pg_catalog\.jsonb_build_array/);
    assert.match(sql, /source_seller\."userId" = p_user_id/);
    assert.match(sql, /source_listing\."stockQuantity" > 0[\s\S]{0,100}source_listing\."stockQuantity" <= 2/);
    assert.match(sql, /p_related_user_id IS NULL/);
    assert.match(
      sql,
      /'\/dashboard\/inventory',[\s\S]{0,180}source_listing\.title \|\| ' is running low'[\s\S]{0,180}'Only ' \|\| source_listing\."stockQuantity"::text \|\| ' left in stock'/,
    );
    assert.match(sql, /inventory notification requires a reviewed inventory source/);
  });

  it("writes manual low-stock and restock authority atomically", () => {
    assert.equal((stockRoute.match(/await createNotification\(\{/g) ?? []).length, 1);
    assert.equal((stockRoute.match(/sourceType: NOTIFICATION_SOURCE_TYPES/g) ?? []).length, 1);
    assert.match(stockRoute, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(stockRoute, /action: "MANUAL_LISTING_STOCK_LOW"/);
    assert.match(stockRoute, /client: tx/);
    assert.match(stockRoute, /sourceType: NOTIFICATION_SOURCE_TYPES\.MANUAL_LOW_STOCK/);
    assert.match(stockRoute, /action: "MANUAL_LISTING_RESTOCKED"/);
    assert.match(stockRoute, /claimBackInStockNotification\(\{[\s\S]{0,180}restockAuditId: backInStockAuthoritySourceId,[\s\S]{0,120}stockNotificationId/);
    assert.match(stockRoute, /result\.status === "fulfilled"/);
    assert.match(stockRoute, /source: "stock_back_in_stock_claim"/);
    assert.match(sql, /source_audit\.action = 'MANUAL_LISTING_STOCK_LOW'/);
    assert.match(sql, /source_audit\.metadata ->> 'newQuantity' IN \('1', '2'\)/);
  });

  it("claims, creates, and consumes back-in-stock atomically from durable evidence", () => {
    assert.match(sql, /grainline_notification_claim_back_in_stock/);
    assert.match(sql, /source_audit\.action = 'MANUAL_LISTING_RESTOCKED'/);
    assert.match(sql, /source_audit\.metadata ->> 'previousStatus' = 'SOLD_OUT'/);
    assert.match(sql, /source_audit\.metadata ->> 'newStatus' = 'ACTIVE'/);
    assert.match(sql, /source_subscription\."createdAt" <= source_audit\."createdAt"/);
    assert.match(sql, /FOR UPDATE OF source_subscription/);
    assert.match(sql, /INSERT INTO public\."Notification"[\s\S]{0,1600}DELETE FROM public\."StockNotification"/);
    assert.match(sql, /source_recipient_preferences -> 'BACK_IN_STOCK' = 'false'::jsonb/);
    assert.match(sql, /'manual_restock',[\s\S]{0,80}p_restock_audit_id/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_claim_back_in_stock\(text, text, text\)/);
    assert.doesNotMatch(stockRoute, /DELETE FROM "StockNotification"/);
    assert.match(plan, /atomic restock-audit plus\s+subscription claim\/create\/consume operation/);
  });
});
