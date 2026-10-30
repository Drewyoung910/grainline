import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { displayUsState, formatCityState } = await import("../src/lib/locationDisplay.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public city/state display (#216, #260)", () => {
  it("uppercases two-letter codes and maps full state names to codes", () => {
    assert.equal(formatCityState("Austin", "Tx"), "Austin, TX");
    assert.equal(formatCityState("Yorktown", "TX"), "Yorktown, TX");
    assert.equal(formatCityState("DeWitt County", "Texas"), "DeWitt County, TX");
    assert.equal(formatCityState(" Round Rock ", " texas "), "Round Rock, TX");
    assert.equal(displayUsState("new york"), "NY");
  });

  it("keeps unrecognized state text instead of dropping it", () => {
    assert.equal(formatCityState("Austin", "Tex."), "Austin, Tex.");
    assert.equal(displayUsState("District of Columbia"), "District of Columbia");
  });

  it("drops empty parts", () => {
    assert.equal(formatCityState("Austin", null), "Austin");
    assert.equal(formatCityState(null, "tx"), "TX");
    assert.equal(formatCityState("  ", ""), "");
    assert.equal(formatCityState(undefined, undefined), "");
    assert.equal(displayUsState(null), "");
  });

  it("formats public location lines through the shared helper", () => {
    assert.match(source("src/components/ListingCard.tsx"), /const location = formatCityState\(l\.seller\.city, l\.seller\.state\)/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /const cityState = formatCityState\(seller\.city, seller\.state\)/);
    assert.match(source("src/app/listing/[id]/page.tsx"), /const cityState = formatCityState\(listing\.seller\.city, listing\.seller\.state\)/);
    for (const page of [
      "src/app/browse/[metroSlug]/page.tsx",
      "src/app/browse/[metroSlug]/[category]/page.tsx",
      "src/app/makers/[metroSlug]/page.tsx",
      "src/app/commission/[param]/page.tsx",
    ]) {
      const code = source(page);
      assert.match(code, /formatCityState\(metro\.name, metro\.state\)/, page);
      assert.doesNotMatch(code, /\$\{metro\.name\}, \$\{metro\.state\}/, page);
      assert.doesNotMatch(code, /\{metro\.state\}/, page);
    }
  });
});

describe("maker map source guard (#291)", () => {
  it("does not query the sellers source before the load handler adds it", () => {
    const map = source("src/components/AllSellersMap.tsx");
    assert.match(map, /Boolean\(map\.getSource\("sellers"\)\) && map\.isSourceLoaded\("sellers"\)/);
    // Every isSourceLoaded call is the guarded one inside sellersSourceReady.
    assert.equal(map.match(/map\.isSourceLoaded\(/g)?.length, 1);
    assert.match(map, /if \(!sellersSourceReady\(\)\) return;/);
    assert.match(map, /e\.sourceId === "sellers" && sellersSourceReady\(\)/);
  });
});

describe("pickup location picker touch gestures (#1242)", () => {
  it("uses cooperative gestures on touch so one finger scrolls the page", () => {
    const picker = source("src/components/LocationPicker.tsx");
    assert.match(picker, /matchMedia\("\(hover: none\), \(pointer: coarse\)"\)/);
    assert.match(picker, /cooperativeGestures: touchPrimary/);
    // The pin itself stays draggable with one finger.
    assert.match(picker, /draggable: true/);
    assert.match(picker, /marker\.getElement\(\)\.style\.touchAction = "none"/);
  });
});
