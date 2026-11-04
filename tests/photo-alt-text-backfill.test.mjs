import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { planPhotoAltTextBackfill } = await import("../src/lib/photoAltTextBackfillState.ts");

describe("photo alt-text backfill planning", () => {
  it("pairs generated alt text with photos in sort order without overwriting seller text", () => {
    const updates = planPhotoAltTextBackfill(
      [
        { id: "photo_1", url: "https://media.example/one", altText: null },
        { id: "photo_2", url: "https://media.example/two", altText: "seller-written alt" },
        { id: "photo_3", url: "https://media.example/three", altText: "" },
      ],
      ["AI alt one", "AI alt two", "AI alt three"],
      [
        "https://media.example/one",
        "https://media.example/two",
        "https://media.example/three",
      ],
    );

    assert.deepEqual(updates, [
      { id: "photo_1", url: "https://media.example/one", altText: "AI alt one" },
      { id: "photo_3", url: "https://media.example/three", altText: "AI alt three" },
    ]);
  });

  it("refuses stale AI text when the reviewed photo sequence changed", () => {
    const updates = planPhotoAltTextBackfill(
      [
        { id: "replacement", url: "https://media.example/replacement", altText: null },
        { id: "photo_2", url: "https://media.example/two", altText: null },
      ],
      ["Old first photo", "Old second photo"],
      ["https://media.example/one", "https://media.example/two"],
    );

    assert.deepEqual(updates, []);
  });

  it("sanitizes and bounds generated text before persistence", () => {
    const dirty = `good\u202Ename ${"<script>".repeat(80)}`;
    const [update] = planPhotoAltTextBackfill(
      [{ id: "photo_1", url: "https://media.example/one", altText: null }],
      [dirty],
      ["https://media.example/one"],
    );

    assert.equal(update.id, "photo_1");
    assert.doesNotMatch(update.altText, /[\u202A-\u202E]/);
    assert.ok(Array.from(update.altText).length <= 200);
  });

  it("ignores missing or empty generated alt text", () => {
    const photos = [{ id: "photo_1", url: "https://media.example/one", altText: null }];
    const reviewed = ["https://media.example/one"];
    assert.deepEqual(planPhotoAltTextBackfill(photos, null, reviewed), []);
    assert.deepEqual(planPhotoAltTextBackfill(photos, [""], reviewed), []);
  });
});
