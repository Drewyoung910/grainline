import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { maplibreSupported } = await import("../src/lib/mapSupport.ts");

function mockDocument(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
}

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
    assert.equal(maplibreSupported({}), false);
  });

  it("documents the lower-friction performance-caveat policy in source", () => {
    const source = readFileSync("src/lib/mapSupport.ts", "utf8");
    assert.match(source, /failIfMajorPerformanceCaveat: false/);
    assert.doesNotMatch(source, /failIfMajorPerformanceCaveat: true/);
  });

  it("probes WebGL 2 for MapLibre 6 and releases the temporary context", (t) => {
    const calls = [];
    const context = { getExtension: (name) => {
      calls.push(name);
      return { loseContext: () => calls.push("released") };
    } };
    mockDocument(t, {
      createElement: (tag) => {
        assert.equal(tag, "canvas");
        return { getContext: (type, options) => {
          assert.equal(type, "webgl2");
          assert.deepEqual(options, { failIfMajorPerformanceCaveat: false });
          return context;
        } };
      },
    });
    assert.equal(maplibreSupported({}), true);
    assert.deepEqual(calls, ["WEBGL_lose_context", "released"]);
  });

  it("falls back when WebGL 2 is absent or its creation throws", (t) => {
    mockDocument(t, {
      createElement: () => ({ getContext: () => null }),
    });
    assert.equal(maplibreSupported({}), false);
    globalThis.document.createElement = () => { throw new Error("GPU unavailable"); };
    assert.equal(maplibreSupported({}), false);
  });
});
