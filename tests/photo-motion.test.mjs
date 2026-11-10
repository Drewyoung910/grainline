import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { isPlainClick, photoDeltaTransform } = await import("../src/lib/photoMotion.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("photo continuity motion", () => {
  it("centers a source without stretching it past the destination", () => {
    assert.equal(
      photoDeltaTransform(
        { left: 0, top: 0, width: 200, height: 100 },
        { left: 300, top: 200, width: 100, height: 200 },
      ),
      "translate(250px, 250px) scale(0.5)",
    );
    assert.equal(
      photoDeltaTransform(
        { left: 0, top: 0, width: 0, height: 100 },
        { left: 0, top: 0, width: 100, height: 100 },
      ),
      null,
    );
  });

  it("runs card travel only for an unmodified primary click", () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    assert.equal(isPlainClick(plain), true);
    assert.equal(isPlainClick({ ...plain, button: 1 }), false);
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      assert.equal(isPlainClick({ ...plain, [modifier]: true }), false);
    }
  });

  it("keeps motion optional and every viewer's existing safety boundaries intact", () => {
    const motion = source("src/lib/photoMotion.ts");
    const hook = source("src/lib/usePhotoViewerMotion.ts");
    const card = source("src/components/ListingCard.tsx");
    const gallery = source("src/components/ListingGallery.tsx");

    assert.match(motion, /prefers-reduced-motion: reduce/);
    assert.match(motion, /TARGET_WAIT_MS/);
    assert.match(motion, /performance\.now\(\) - startedAt > TARGET_WAIT_MS/);
    assert.match(motion, /if \(from\.bottom < 0 \|\| from\.top > window\.innerHeight\) return/);
    assert.match(motion, /if \(!photo\.isConnected \|\| !source\.isConnected\) return/);
    assert.match(motion, /function discardFlyer/);
    assert.match(hook, /if \(closingRef\.current\) return/);
    assert.match(hook, /latestRef\.current\.onClosed\(\)/);
    assert.match(card, /if \(!isPlainClick\(event\)\) return/);
    assert.match(card, /startPhotoTravel\(frame\?\.querySelector<HTMLImageElement>\("img\[data-card-photo\]"\) \?\? null, frame, l\.id\)/);
    assert.match(card, /overflow-hidden rounded-xl/);
    assert.match(motion, /borderRadius: "12px"/);
    assert.match(gallery, /useDialogFocus\(lightboxOpen, dialogRef, closeViewer\)/);
    assert.match(gallery, /useBodyScrollLock\(lightboxOpen\)/);

    for (const path of [
      "src/components/CoverLightbox.tsx",
      "src/components/ImageLightbox.tsx",
      "src/components/SellerGallery.tsx",
    ]) {
      const viewer = source(path);
      assert.match(viewer, /usePhotoViewerMotion/);
      assert.match(viewer, /useDialogFocus\([^;]*closeViewer\)/);
      assert.match(viewer, /useBodyScrollLock/);
    }
  });
});
