import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { maplibreSupported } = await import("../src/lib/mapSupport.ts");

describe("map support helper", () => {
  it("allows slower WebGL devices instead of rejecting major performance caveats", () => {
    let options = null;
    const supported = maplibreSupported({
      supported(received) {
        options = received;
        return true;
      },
    });

    assert.equal(supported, true);
    assert.deepEqual(options, { failIfMajorPerformanceCaveat: false });
  });

  it("keeps a fallback path for unsupported or throwing MapLibre probes", () => {
    assert.equal(maplibreSupported({ supported: () => false }), false);
    assert.equal(maplibreSupported({ supported: () => { throw new Error("webgl probe failed"); } }), false);
    assert.equal(maplibreSupported({}), true);
  });

  it("documents the lower-friction performance-caveat policy in source", () => {
    const source = readFileSync("src/lib/mapSupport.ts", "utf8");
    assert.match(source, /failIfMajorPerformanceCaveat: false/);
    assert.doesNotMatch(source, /failIfMajorPerformanceCaveat: true/);
  });
});
