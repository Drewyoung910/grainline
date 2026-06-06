import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { isDeletedAccountEmail, sellerFacingUserLabel } = await import("../src/lib/sellerFacingUser.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller-facing user labels", () => {
  it("hides internal deleted-account email placeholders", () => {
    assert.equal(isDeletedAccountEmail("deleted+user_123@deleted.thegrainline.local"), true);
    assert.equal(isDeletedAccountEmail("buyer@example.com"), false);
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "deleted+user_123@deleted.thegrainline.local" }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: "Buyer Name", email: "deleted+user_123@deleted.thegrainline.local" }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "buyer@example.com", deletedAt: new Date() }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "buyer@example.com", deletedAt: null }, "Deleted user"),
      "buyer@example.com",
    );
  });

  it("uses the helper on seller-facing buyer labels", () => {
    const sales = source("src/app/dashboard/sales/page.tsx");
    const saleDetail = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");

    for (const text of [sales, saleDetail, customListing]) {
      assert.match(text, /import \{ sellerFacingUserLabel \} from "@\/lib\/sellerFacingUser"/);
      assert.match(text, /deletedAt: true/);
      assert.doesNotMatch(text, /\?\.name \?\? [^.]+\.buyer\?\.email/);
      assert.doesNotMatch(text, /buyer\?\.name \|\| buyer\?\.email/);
    }

    assert.match(sales, /sellerFacingUserLabel\(o\.buyer, "Deleted user"\)/);
    assert.match(saleDetail, /sellerFacingUserLabel\(order\.buyer, "Deleted user"\)/);
    assert.match(customListing, /sellerFacingUserLabel\(buyer, "the buyer"\)/);
  });
});
