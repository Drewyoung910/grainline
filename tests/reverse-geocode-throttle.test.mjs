import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/lib/reverse-geocode.ts", "utf8");

describe("reverse geocode throttle guardrails", () => {
  it("fails closed when the shared Nominatim throttle is unavailable or contended", () => {
    assert.match(source, /redis\.set\("reverse-geocode:nominatim:lock", "1", \{ nx: true, px: 1100 \}\)/);
    assert.match(source, /for \(let attempt = 0; attempt < 8; attempt\+\+\)/);
    assert.match(source, /Sentry\.captureException\(error, \{ tags: \{ source: "reverse_geocode_throttle" \} \}\)/);
    assert.match(source, /Reverse geocode shared throttle contention exceeded/);
    assert.doesNotMatch(source, /waitForLocalThrottle/);
  });

  it("keeps Nominatim requests identifiable and US-only", () => {
    assert.match(source, /"User-Agent": "Grainline\/1\.0 \(thegrainline\.com\)"/);
    assert.match(source, /if \(addr\.country_code !== "us"\) return null/);
  });

  it("uses bounded Nominatim locality coordinates for auto-created metros", () => {
    assert.match(source, /async function lookupLocalityCentroid\(city: string, state: string\)/);
    assert.match(source, /q: `\$\{city\}, \$\{state\}, United States`/);
    assert.match(source, /const first = Array\.isArray\(data\) \? data\[0\] : null/);
    assert.match(source, /const latitude = Number\(first\?\.lat\)/);
    assert.match(source, /const longitude = Number\(first\?\.lon\)/);
    assert.match(source, /roundedPublicMetroCoordinate\(latitude\)/);
    assert.match(source, /roundedPublicMetroCoordinate\(longitude\)/);
    assert.match(source, /const centroid = await lookupLocalityCentroid\(city, stateName\)/);
  });
});
