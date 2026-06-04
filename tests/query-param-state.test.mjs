import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  parseBoundedDecimalParam,
  parseBoundedPositiveIntParam,
  parseTimestampMsParam,
} = await import("../src/lib/queryParams.ts");

describe("query parameter parsing helpers", () => {
  it("parses bounded positive integers without accepting malformed numbers", () => {
    assert.equal(parseBoundedPositiveIntParam("25", 10, 50), 25);
    assert.equal(parseBoundedPositiveIntParam("5000", 10, 50), 50);
    assert.equal(parseBoundedPositiveIntParam("0", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("-1", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("12abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("1.5", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam(null, 10, 50), 10);
  });

  it("accepts only finite valid millisecond timestamps", () => {
    assert.equal(parseTimestampMsParam("0"), 0);
    assert.equal(parseTimestampMsParam("1710000000000"), 1710000000000);
    assert.equal(parseTimestampMsParam(""), null);
    assert.equal(parseTimestampMsParam("-1"), null);
    assert.equal(parseTimestampMsParam("abc"), null);
    assert.equal(parseTimestampMsParam("Infinity"), null);
    assert.equal(parseTimestampMsParam("1e309"), null);
    assert.equal(parseTimestampMsParam("999999999999999999999"), null);
  });

  it("parses bounded decimals without accepting malformed or out-of-range values", () => {
    assert.equal(parseBoundedDecimalParam(" 29.7604 ", -90, 90), 29.7604);
    assert.equal(parseBoundedDecimalParam("-95.3698", -180, 180), -95.3698);
    assert.equal(parseBoundedDecimalParam(".5", 0, 1), 0.5);
    assert.equal(parseBoundedDecimalParam("1e2", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("Infinity", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("1e309", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("12abc", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("91", -90, 90), null);
    assert.equal(parseBoundedDecimalParam("-181", -180, 180), null);
    assert.equal(parseBoundedDecimalParam("501", 1, 500), null);
  });

  it("keeps public browse and seller pagination bounded before Prisma skip", () => {
    for (const routePath of [
      "src/app/browse/page.tsx",
      "src/app/seller/[id]/shop/page.tsx",
      "src/app/seller/[id]/customer-photos/page.tsx",
    ]) {
      const source = readFileSync(routePath, "utf8");

      assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
      assert.match(source, /parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
      assert.doesNotMatch(source, /Math\.max\(1,\s*Number\(sp\.page/);
      assert.doesNotMatch(source, /Number\(sp\.page/);
      assert.doesNotMatch(source, /Number\.parseInt\(sp\.page/);
    }
  });

  it("bounds browse location and shipping filters before query construction", () => {
    const browse = readFileSync("src/app/browse/page.tsx", "utf8");
    const filters = readFileSync("src/components/FilterSidebar.tsx", "utf8");

    assert.match(browse, /const MAX_SHIPS_WITHIN_DAYS = 365/);
    assert.match(browse, /const MAX_BROWSE_RADIUS_MILES = 500/);
    assert.match(browse, /parseBoundedPositiveIntParam\(sp\.ships, 0, MAX_SHIPS_WITHIN_DAYS\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.lat, -90, 90\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.lng, -180, 180\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.radius, 1, MAX_BROWSE_RADIUS_MILES\)/);
    assert.doesNotMatch(browse, /Number\(sp\.lat/);
    assert.doesNotMatch(browse, /Number\(sp\.lng/);
    assert.doesNotMatch(browse, /Number\(sp\.radius/);
    assert.match(filters, /name="ships"[\s\S]*max="365"/);
    assert.match(filters, /name="radius"[\s\S]*max="500"/);
  });
});
