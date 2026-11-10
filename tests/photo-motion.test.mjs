import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { fittedPhotoRect, isPlainClick, photoDeltaTransform } = await import("../src/lib/photoMotion.ts");

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

  it("opens a cropped card into the visible bounds of a contained photo", () => {
    assert.deepEqual(
      fittedPhotoRect({ left: 0, top: 0, width: 200, height: 250 }, 4 / 3, "cover"),
      { left: -66.66666666666666, top: 0, width: 333.3333333333333, height: 250 },
    );
    assert.deepEqual(
      fittedPhotoRect({ left: 300, top: 100, width: 600, height: 450 }, 4 / 3, "contain"),
      { left: 300, top: 100, width: 600, height: 450 },
    );
    assert.deepEqual(
      fittedPhotoRect({ left: 300, top: 100, width: 600, height: 450 }, 2 / 3, "contain"),
      { left: 450, top: 100, width: 300, height: 450 },
    );
    assert.equal(
      fittedPhotoRect({ left: 0, top: 0, width: 0, height: 450 }, 4 / 3, "contain"),
      null,
    );
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
    assert.match(motion, /shown\.decode\(\)/);
    assert.match(motion, /discardFlyer\(flyer\)/);
    assert.match(hook, /if \(closingRef\.current\) return/);
    assert.match(hook, /latestRef\.current\.onClosed\(\)/);
    assert.match(card, /if \(!isPlainClick\(event\)\) return/);
    assert.match(card, /startPhotoTravel\(frame\?\.querySelector<HTMLImageElement>\("img\[data-card-photo\]"\) \?\? null, frame, l\.id\)/);
    assert.match(card, /overflow-hidden rounded-xl/);
    assert.match(motion, /const sourceRadius = getComputedStyle\(frame\)\.borderTopLeftRadius/);
    assert.match(gallery, /useDialogFocus\(lightboxOpen, dialogRef, closeViewer\)/);
    assert.match(gallery, /useBodyScrollLock\(lightboxOpen\)/);
    assert.match(gallery, /getSource: \(\) => photoSurfaceRef\.current/);

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
