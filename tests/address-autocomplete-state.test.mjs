import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const text = readFileSync("src/lib/addressAutocompleteState.ts", "utf8");

describe("address autocomplete state behavior", () => {
  it("extracts city-like fields without ever using county as city", () => {
    assert.match(text, /address\.city/);
    assert.match(text, /address\.town/);
    assert.match(text, /address\.village/);
    assert.match(text, /address\.municipality/);
    assert.match(text, /address\.hamlet/);
    assert.match(text, /address\.suburb/);
    assert.match(text, /address\.neighbourhood/);
    assert.match(text, /address\.city_district/);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.county/s);
  });

  it("uses display-name parsing as the final city fallback and strips county labels", () => {
    assert.match(text, /function cityFromDisplayName/);
    assert.match(text, /slice\(0, -3\)/);
    assert.match(text, /!\/\\bcounty\\b\/i\.test\(part\)/);
    assert.match(text, /streetAddressPattern/);
    assert.match(text, /cityFromDisplayName\(place\.display_name\)/);
    assert.match(text, /filter\(\(part\) => part && !\/\\bcounty\\b\/i\.test\(part\)\)/);
  });
});
