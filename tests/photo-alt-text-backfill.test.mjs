import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { planPhotoAltTextBackfill } = await import("../src/lib/photoAltTextBackfillState.ts");

describe("photo alt-text backfill planning", () => {
  it("pairs generated alt text with photos in sort order without overwriting seller text", () => {
    const updates = planPhotoAltTextBackfill(
      [
        { id: "photo_1", altText: null },
        { id: "photo_2", altText: "seller-written alt" },
        { id: "photo_3", altText: "" },
      ],
      ["AI alt one", "AI alt two", "AI alt three"],
    );

    assert.deepEqual(updates, [
      { id: "photo_1", altText: "AI alt one" },
      { id: "photo_3", altText: "AI alt three" },
    ]);
  });

  it("sanitizes and bounds generated text before persistence", () => {
    const dirty = `good\u202Ename ${"<script>".repeat(80)}`;
    const [update] = planPhotoAltTextBackfill([{ id: "photo_1", altText: null }], [dirty]);

    assert.equal(update.id, "photo_1");
    assert.doesNotMatch(update.altText, /[\u202A-\u202E]/);
    assert.ok(Array.from(update.altText).length <= 200);
  });

  it("ignores missing or empty generated alt text", () => {
    assert.deepEqual(planPhotoAltTextBackfill([{ id: "photo_1", altText: null }], null), []);
    assert.deepEqual(planPhotoAltTextBackfill([{ id: "photo_1", altText: null }], [""]), []);
  });
});
