import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const text = readFileSync("src/lib/addressAutocompleteState.ts", "utf8");
const component = readFileSync("src/components/AddressAutocomplete.tsx", "utf8");
const route = readFileSync("src/app/api/address/autocomplete/route.ts", "utf8");
const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");

describe("address autocomplete state behavior", () => {
  it("extracts official locality fields without using neighborhood or county as city", () => {
    assert.match(text, /address\.city/);
    assert.match(text, /address\.town/);
    assert.match(text, /address\.village/);
    assert.match(text, /address\.municipality/);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.county/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.suburb/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.neighbourhood/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.city_district/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.hamlet/s);
  });

  it("formats labels from display names without using display-name chunks as checkout city", () => {
    assert.doesNotMatch(text, /function cityFromDisplayName/);
    assert.doesNotMatch(text, /cityFromDisplayName\(place\.display_name/);
    assert.match(text, /filter\(\(part\) => part && !\/\\bcounty\\b\/i\.test\(part\)\)/);
  });

  it("never promotes sublocalities into the checkout city field", () => {
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.suburb/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.neighbourhood/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.city_district/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.hamlet/s);
  });

  it("keeps official locality fields for non-city municipalities", () => {
    assert.match(
      text,
      /firstNonEmpty\(address\.city, address\.town, address\.village, address\.municipality\)/,
    );
  });

  it("normalizes address lookup queries before proxying upstream", () => {
    assert.match(text, /function normalizeAddressAutocompleteQuery/);
    assert.match(text, /replace\(\/\\s\+\/g, " "\)\.trim\(\)\.slice\(0, 120\)/);
  });

  it("uses a first-party address proxy instead of browser-to-Nominatim requests", () => {
    assert.match(component, /fetch\(`\/api\/address\/autocomplete\?q=\$\{encodeURIComponent\(trimmed\)\}`/);
    assert.doesNotMatch(component, /nominatim\.openstreetmap\.org/);
  });

  it("keeps address autocomplete rate limited, private, and globally throttled before Nominatim", () => {
    assert.match(route, /safeRateLimit\(searchRatelimit, `address-autocomplete:\$\{ip\}`\)/);
    assert.match(route, /privateJson\(\{ results: \[\] \}/);
    assert.match(route, /NOMINATIM_SHARED_THROTTLE_KEY = "reverse-geocode:nominatim:lock"/);
    assert.match(route, /redis\.set\(NOMINATIM_SHARED_THROTTLE_KEY, "1", \{ nx: true, px: 1100 \}\)/);
    assert.match(route, /"User-Agent": NOMINATIM_USER_AGENT/);
  });

  it("discloses proxied address autocomplete use of Nominatim", () => {
    assert.match(privacy, /Address search and reverse geocoding/);
    assert.match(privacy, /address search text may be sent from Grainline/);
    assert.match(privacy, /proxied by Grainline rather than\s+sent directly from your browser to Nominatim/);
  });
});
