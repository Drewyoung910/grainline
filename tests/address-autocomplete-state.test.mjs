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
    assert.match(text, /address\.hamlet/);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.county/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.suburb/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.neighbourhood/s);
    assert.doesNotMatch(text, /address\.city \?\?.*address\.city_district/s);
  });

  it("uses display-name parsing as the final city fallback and strips county labels", () => {
    assert.match(text, /function cityFromDisplayName/);
    assert.match(text, /slice\(0, -3\)/);
    assert.match(text, /!\/\\bcounty\\b\/i\.test\(part\)/);
    assert.match(text, /streetAddressPattern/);
    assert.match(text, /cityFromDisplayName\(place\.display_name, \[address\.suburb, address\.neighbourhood, address\.city_district\]\)/);
    assert.match(text, /filter\(\(part\) => part && !\/\\bcounty\\b\/i\.test\(part\)\)/);
  });

  it("rejects known sublocalities and street fragments during display-name parsing", () => {
    assert.match(text, /rejectedLocalities\.map\(normalizeLocality\)\.filter\(Boolean\)\.includes\(normalizedCandidate\)/);
    assert.match(text, /return "";/);
    assert.match(text, /cityCandidates\.length === 1 && \(\/\\d\/\.test\(candidate\) \|\| streetAddressPattern\.test\(candidate\)\)/);
  });

  it("passes suburb, neighbourhood, and city district only as rejected display-name candidates", () => {
    assert.match(
      text,
      /cityFromDisplayName\(place\.display_name, \[address\.suburb, address\.neighbourhood, address\.city_district\]\)/,
    );
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.suburb/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.neighbourhood/s);
    assert.doesNotMatch(text, /firstNonEmpty\([^)]*address\.city_district/s);
  });

  it("keeps official locality fields for non-city municipalities", () => {
    assert.match(
      text,
      /firstNonEmpty\(address\.city, address\.town, address\.village, address\.municipality, address\.hamlet\)/,
    );
  });
});
