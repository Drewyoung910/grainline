import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/app/api/account/export/route.ts", "utf8");
const authority = readFileSync("src/lib/orderParticipantExportAuthority.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260901030000_prepare_order_participant_export_authority/migration.sql",
  "utf8",
);
const documentation = readFileSync("docs/order-participant-export-authority.md", "utf8");

describe("Order participant export authority contract", () => {
  it("converts account export away from direct Order and raw quote reads", () => {
    assert.doesNotMatch(route, /prisma\.order\.findMany/u);
    assert.doesNotMatch(route, /shippingRateQuotes|shipmentId|rates:\s*true/u);
    assert.match(route, /exportBuyerOrders\(user\.id\)/u);
    assert.match(route, /exportSellerOrders\(user\.id\)/u);
    assert.doesNotMatch(migration, /OrderShippingRateQuote|stripeChargeId|stripeTransferId|shippoShipmentId/u);
    assert.match(documentation, /raw\s+shipping-quote rows and provider identifiers are excluded/iu);
  });

  it("keeps pages bounded, actor scoped and provider identities out of the shape", () => {
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 2);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 2);
    assert.equal((migration.match(/p_limit NOT BETWEEN 1 AND 25/g) ?? []).length, 2);
    assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
    assert.match(migration, /seller\."userId" = p_actor_user_id/u);
    assert.doesNotMatch(migration, /'sellerRefundId'|'stripe[A-Z]|'shipmentId'|'rates'/u);
    assert.match(authority, /Order export cursor did not advance/u);
    assert.match(authority, /Order export repeated an order id/u);
  });
});
