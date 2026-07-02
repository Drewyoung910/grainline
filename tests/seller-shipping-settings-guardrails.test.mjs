import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sellerSettings = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");

describe("seller shipping settings guardrails", () => {
  it("bounds seller-entered shipping money before persistence", () => {
    assert.match(sellerSettings, /const MAX_SELLER_SHIPPING_MONEY_CENTS = 500_000/);
    assert.match(
      sellerSettings,
      /parseMoneyInputToCents\(formData\.get\("shippingFlatRate"\), \{\s*maxCents: MAX_SELLER_SHIPPING_MONEY_CENTS,\s*\}\)/s,
    );
    assert.match(
      sellerSettings,
      /parseMoneyInputToCents\(formData\.get\("freeShippingOver"\), \{\s*maxCents: MAX_SELLER_SHIPPING_MONEY_CENTS,\s*\}\)/s,
    );
    assert.doesNotMatch(
      sellerSettings,
      /const shippingFlatRateCents = parseMoneyInputToCents\(formData\.get\("shippingFlatRate"\)\);/,
    );
  });

  it("drops negative or extreme package defaults before Prisma writes", () => {
    assert.match(sellerSettings, /const MAX_DEFAULT_PACKAGE_DIMENSION_IN = 240/);
    assert.match(sellerSettings, /const MAX_DEFAULT_PACKAGE_WEIGHT_LB = 500/);
    assert.match(sellerSettings, /max=\{MAX_DEFAULT_PACKAGE_DIMENSION_IN\}/);
    assert.match(sellerSettings, /max=\{MAX_DEFAULT_PACKAGE_WEIGHT_LB\}/);
    assert.match(sellerSettings, /function toBoundedNonNegativeFloat\(v: unknown, max: number\)/);
    assert.match(sellerSettings, /if \(!\/\^\\d\+\(\?:\\\.\\d\+\)\?\$\/\.test\(raw\)\) return null;/);
    assert.match(
      sellerSettings,
      /toBoundedNonNegativeFloat\(formData\.get\("defaultPkgLengthIn"\), MAX_DEFAULT_PACKAGE_DIMENSION_IN\)/,
    );
    assert.match(
      sellerSettings,
      /toBoundedNonNegativeFloat\(formData\.get\("defaultPkgWidthIn"\), MAX_DEFAULT_PACKAGE_DIMENSION_IN\)/,
    );
    assert.match(
      sellerSettings,
      /toBoundedNonNegativeFloat\(formData\.get\("defaultPkgHeightIn"\), MAX_DEFAULT_PACKAGE_DIMENSION_IN\)/,
    );
    assert.match(
      sellerSettings,
      /toBoundedNonNegativeFloat\(formData\.get\("defaultPkgWeightLb"\), MAX_DEFAULT_PACKAGE_WEIGHT_LB\)/,
    );
  });
});
