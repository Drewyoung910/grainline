import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { checkoutSessionMetadataReferencesListing } from "../src/lib/checkoutSessionExpiryState.ts";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("checkout session expiry hardening", () => {
  it("matches listing references from direct and reserved-stock session metadata", () => {
    assert.equal(
      checkoutSessionMetadataReferencesListing({ listingId: "listing_1" }, "listing_1"),
      true,
    );
    assert.equal(
      checkoutSessionMetadataReferencesListing({ reservedStock: "listing_1:2,listing_2:1" }, "listing_2"),
      true,
    );
    assert.equal(
      checkoutSessionMetadataReferencesListing({ reservedStock: "listing_10:2" }, "listing_1"),
      false,
    );
    assert.equal(checkoutSessionMetadataReferencesListing(null, "listing_1"), false);
  });

  it("expires seller checkout sessions when vacation mode is enabled", () => {
    const route = source("src/app/api/seller/vacation/route.ts");

    assert.match(route, /expireOpenCheckoutSessionsForSeller/);
    assert.match(route, /if \(vacationMode\)/);
    assert.match(route, /source: "seller_vacation"/);
  });

  it("expires listing checkout sessions when an active listing leaves public availability", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");

    assert.match(shopActions, /source,\s*\}\),/);
    assert.match(shopActions, /"listing_hide"/);
    assert.match(shopActions, /"listing_mark_sold"/);
    assert.match(shopActions, /"listing_archive"/);
    assert.match(shopActions, /"listing_ai_hold"/);

    assert.match(editPage, /"listing_edit_ai_hold"/);
    assert.match(editPage, /"listing_edit_seller_disconnected"/);
    assert.match(editPage, /"listing_edit_ai_error"/);
  });

  it("keeps the Stripe webhook as the final state revalidation backstop", () => {
    const webhookState = source("src/lib/stripeWebhookState.ts");
    const expiry = source("src/lib/checkoutSessionExpiry.ts");

    assert.match(webhookState, /Seller entered vacation mode before payment completion/);
    assert.match(webhookState, /Seller stopped accepting new orders before payment completion/);
    assert.match(webhookState, /Listing was no longer active before payment completion/);
    assert.match(expiry, /restoreUnorderedCheckoutStockOnce/);
    assert.match(expiry, /checkout_session_restore/);
  });
});
