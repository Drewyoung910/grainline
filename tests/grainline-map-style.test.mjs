import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyGrainlineMapColors, grainlineLayerPaint } from "../src/lib/grainlineMapStyle.ts";

describe("Grainline map colors", () => {
  const paint = (id, type) => grainlineLayerPaint({ id, type }).map((change) => change.property);

  it("paints land, water, roads and labels without replacing map content", () => {
    assert.deepEqual(paint("background", "background"), ["background-color"]);
    assert.deepEqual(paint("water", "fill"), ["fill-color"]);
    assert.deepEqual(paint("waterway_river", "line"), ["line-color"]);
    assert.deepEqual(paint("road_motorway", "line"), ["line-color"]);
    assert.deepEqual(paint("road_motorway_casing", "line"), ["line-color"]);
    assert.deepEqual(paint("building-3d", "fill-extrusion"), ["fill-extrusion-color"]);
    assert.deepEqual(paint("label_city", "symbol"), ["text-color", "text-halo-color"]);
  });

  it("leaves photos, rail, shields and place icons as drawn", () => {
    assert.deepEqual(paint("natural_earth", "raster"), []);
    assert.deepEqual(paint("road_major_rail", "line"), []);
    assert.deepEqual(paint("highway-shield-us-interstate", "symbol"), []);
    assert.deepEqual(paint("poi_r1", "symbol"), []);
  });

  it("never lets a decorative paint failure break the map", () => {
    const painted = [];
    applyGrainlineMapColors({
      getStyle: () => ({ layers: [{ id: "background", type: "background" }, { id: "water", type: "fill" }] }),
      setPaintProperty: (id) => {
        if (id === "background") throw new Error("gone");
        painted.push(id);
      },
    });
    assert.deepEqual(painted, ["water"]);
    assert.doesNotThrow(() => applyGrainlineMapColors({
      getStyle: () => {
        throw new Error("style not ready");
      },
      setPaintProperty: () => undefined,
    }));
  });
});
