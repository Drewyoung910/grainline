import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("upload UX follow-ups", () => {
  it("keeps upload limits and user-facing validation messages centralized", async () => {
    const rules = await import("../src/lib/uploadRules.ts");

    assert.equal(rules.UPLOAD_MAX_SIZES.bannerImage, 15 * 1024 * 1024);
    assert.equal(rules.uploadMaxSizeMb("bannerImage"), "15");
    assert.match(
      rules.uploadTooLargeMessage("bannerImage", 12.4 * 1024 * 1024),
      /Shop banner must be under 15 MB\. Your file is 12\.4 MB/,
    );
    assert.match(
      rules.uploadTypeMessage("bannerImage", "image/heic"),
      /Only JPEG, PNG, and WebP images are allowed\. You uploaded image\/heic\./,
    );
    assert.match(
      rules.uploadExtensionMessage("video/quicktime", ["mov", "qt"]),
      /Use \.mov, \.qt\./,
    );
    assert.throws(
      () => rules.validateUploadFile("bannerImage", { size: 16 * 1024 * 1024, type: "image/jpeg" }, 0),
      /Shop banner must be under 15 MB/,
    );
  });

  it("uses the shared upload rules on client and server upload paths", () => {
    for (const path of [
      "src/app/api/upload/image/route.ts",
      "src/app/api/upload/presign/route.ts",
      "src/app/api/upload/verify/route.ts",
      "src/hooks/useR2Upload.ts",
      "src/components/MarkdownToolbar.tsx",
    ]) {
      assert.match(source(path), /uploadRules|validateUploadFile|UPLOAD_MAX_SIZES/, path);
    }

    const imageRoute = source("src/app/api/upload/image/route.ts");
    assert.match(imageRoute, /uploadTooLargeMessage/);
    assert.match(imageRoute, /uploadTypeMessage/);
    assert.match(imageRoute, /uploadTooManyFilesMessage/);
    assert.doesNotMatch(imageRoute, /File too large/);
    assert.doesNotMatch(imageRoute, /File type not allowed/);
    assert.doesNotMatch(source("src/components/MarkdownToolbar.tsx"), /max 4MB/);
  });

  it("prevalidates before upload and reports progress with XMLHttpRequest", () => {
    const hook = source("src/hooks/useR2Upload.ts");
    const button = source("src/components/R2UploadButton.tsx");

    assert.match(hook, /validateUploadFile\(endpoint, originalFile, i\)/);
    assert.match(hook, /xhr\.upload\.onprogress/);
    assert.match(hook, /shrinkLargeImageForRouteUpload/);
    assert.match(button, /validateUploadFile\(endpoint, file, index\)/);
    assert.match(button, /Uploading \$\{progress > 0 \? `\$\{progress\}%` : "…"\}/);
    assert.match(button, /animate-spin/);
  });

  it("opens crop UI for banner and avatar uploads, leaves listing photos at original aspect", () => {
    const modal = source("src/components/ImageCropModal.tsx");
    assert.match(modal, /MAX_OUTPUT_LONG_EDGE = 2400/);
    assert.match(modal, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.95\)/);
    assert.match(modal, /setProcessing\(false\)/);
    assert.match(modal, /setZoom\(1\)/);
    assert.match(modal, /setOffset\(\{ x: 0, y: 0 \}\)/);
    assert.match(source("src/components/R2UploadButton.tsx"), /ImageCropModal/);
    // Banner and avatar always store cropped (the thumbnail IS the only view).
    assert.match(source("src/components/ProfileBannerUploader.tsx"), /cropAspect=\{3 \/ 1\}/);
    assert.match(source("src/components/ProfileAvatarUploader.tsx"), /cropAspect=\{1\}/);
    // Listing photos no longer force a crop on upload — original aspect is
    // preserved so the lightbox shows the full image. Cards use object-cover at
    // aspect-[4/5] to give a consistent grid look.
    assert.doesNotMatch(source("src/app/dashboard/listings/[id]/edit/page.tsx"), /AddPhotosButton/);
    // PhotoManager keeps cropAspect on the re-crop button so sellers can opt
    // into 4:5 framing for an existing photo, but does NOT force it on the
    // initial UploadButton — endpoint is immediately followed by `appearance`,
    // not by `cropAspect`.
    const photoManager = source("src/components/PhotoManager.tsx");
    assert.match(photoManager, /<UploadButton\s+endpoint="listingImage"\s+appearance/);
    assert.match(photoManager, /<ImageRecropButton[\s\S]*?cropAspect=\{4 \/ 5\}/);
  });

  it("keeps crop ratios aligned with public display surfaces", () => {
    assert.match(source("src/app/seller/[id]/page.tsx"), /aspect-\[3\/1\]/);
    assert.match(source("src/components/ProfileBannerUploader.tsx"), /aspect-\[3\/1\]/);
    assert.match(source("src/components/SellerGallery.tsx"), /aspect-\[3\/2\]/);
    assert.match(source("src/components/ProfileWorkshopUploader.tsx"), /cropAspect=\{3 \/ 2\}/);
    assert.match(source("src/components/ProfileWorkshopUploader.tsx"), /aspect-\[3\/2\]/);
    assert.match(source("src/components/GalleryUploader.tsx"), /cropAspect=\{3 \/ 2\}/);
    assert.match(source("src/components/GalleryUploader.tsx"), /aspect-\[3\/2\]/);
    assert.match(source("src/components/ListingCard.tsx"), /aspect-\[4\/5\]/);
    assert.match(source("src/components/ListingGallery.tsx"), /aspect-\[4\/5\]/);
    assert.match(source("src/components/EditPhotoGrid.tsx"), /aspect-\[4\/5\]/);
    assert.match(source("src/components/PhotoManager.tsx"), /aspect-\[4\/5\]/);
  });

  it("keeps single-slot uploaders single-file and adds re-crop controls", () => {
    assert.match(source("src/components/R2UploadButton.tsx"), /allowMultiple/);
    assert.match(source("src/components/ProfileBannerUploader.tsx"), /allowMultiple=\{false\}/);
    assert.match(source("src/components/ProfileAvatarUploader.tsx"), /allowMultiple=\{false\}/);
    assert.match(source("src/components/ProfileWorkshopUploader.tsx"), /allowMultiple=\{false\}/);
    assert.match(source("src/components/BlogPostForm.tsx"), /allowMultiple=\{false\}/);
    assert.match(source("src/components/ImageUploadField.tsx"), /allowMultiple=\{false\}/);
    assert.match(source("src/components/ImageRecropButton.tsx"), /fileFromUrl/);
    assert.match(source("src/components/EditPhotoGrid.tsx"), /label="Re-crop"/);
    assert.match(source("src/components/PhotoManager.tsx"), /label="Re-crop"/);
    assert.match(source("src/app/dashboard/listings/[id]/edit/page.tsx"), /photoManifestJson/);
  });

  it("does not swallow uploader errors at known upload call sites", () => {
    const checked = [
      "src/components/ProfileBannerUploader.tsx",
      "src/components/ProfileAvatarUploader.tsx",
      "src/components/ProfileWorkshopUploader.tsx",
      "src/components/GalleryUploader.tsx",
      "src/components/PhotoManager.tsx",
      "src/components/EditPhotoGrid.tsx",
      "src/components/ReviewComposer.tsx",
      "src/components/MessageComposer.tsx",
      "src/components/BlogPostForm.tsx",
      "src/components/ImageUploadField.tsx",
      "src/components/VideoUploader.tsx",
      "src/app/commission/new/page.tsx",
    ];

    for (const path of checked) {
      const text = source(path);
      assert.match(text, /onUploadError=/, path);
      assert.doesNotMatch(text, /onUploadError=\{\(\) => \{\}\}/, path);
    }
  });
});
