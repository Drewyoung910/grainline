import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { planPhotoAltTextBackfill } = await import("../src/lib/photoAltTextBackfillState.ts");

describe("photo alt-text backfill planning", () => {
  it("pairs generated alt text with photos in sort order without overwriting seller text", () => {
    const updates = planPhotoAltTextBackfill(
      [
        { id: "photo_1", url: "https://media.test/1.jpg", altText: null },
        { id: "photo_2", url: "https://media.test/2.jpg", altText: "seller-written alt" },
        { id: "photo_3", url: "https://media.test/3.jpg", altText: "" },
      ],
      ["AI alt one", "AI alt two", "AI alt three"],
      [
        "https://media.test/1.jpg",
        "https://media.test/2.jpg",
        "https://media.test/3.jpg",
      ],
    );

    assert.deepEqual(updates, [
      { id: "photo_1", url: "https://media.test/1.jpg", altText: "AI alt one" },
      { id: "photo_3", url: "https://media.test/3.jpg", altText: "AI alt three" },
    ]);
  });

  it("sanitizes and bounds generated text before persistence", () => {
    const dirty = `good\u202Ename ${"<script>".repeat(80)}`;
    const [update] = planPhotoAltTextBackfill(
      [{ id: "photo_1", url: "https://media.test/1.jpg", altText: null }],
      [dirty],
      ["https://media.test/1.jpg"],
    );

    assert.equal(update.id, "photo_1");
    assert.doesNotMatch(update.altText, /[\u202A-\u202E]/);
    assert.ok(Array.from(update.altText).length <= 200);
  });

  it("ignores missing or empty generated alt text", () => {
    const photos = [{ id: "photo_1", url: "https://media.test/1.jpg", altText: null }];
    const reviewed = ["https://media.test/1.jpg"];
    assert.deepEqual(planPhotoAltTextBackfill(photos, null, reviewed), []);
    assert.deepEqual(planPhotoAltTextBackfill(photos, [""], reviewed), []);
  });

  it("refuses to attach generated text to a changed photo sequence", () => {
    assert.deepEqual(
      planPhotoAltTextBackfill(
        [{ id: "photo_1", url: "https://media.test/new.jpg", altText: null }],
        ["AI alt"],
        ["https://media.test/reviewed.jpg"],
      ),
      [],
    );
  });
});
