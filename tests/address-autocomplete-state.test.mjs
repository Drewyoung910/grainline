import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const text = readFileSync("src/lib/addressAutocompleteState.ts", "utf8");

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
});
