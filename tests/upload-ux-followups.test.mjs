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
    assert.equal(rules.UPLOAD_MAX_SIZES.blogImage, 8 * 1024 * 1024);
    assert.equal(rules.uploadMaxSizeMb("bannerImage"), "15");
    assert.equal(rules.uploadMaxSizeMb("listingImage"), "12");
    assert.equal(rules.uploadMaxSizeMb("listingVideo"), "128");
    assert.equal(rules.uploadMaxSizeMb("blogImage"), "8");
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
    assert.match(
      rules.uploadTypeMessage("messageAny", "video/mp4"),
      /Only JPEG, PNG, WebP, and PDF are allowed\. You uploaded video\/mp4\./,
    );
    assert.match(
      rules.uploadTooLargeMessage("blogImage", 9 * 1024 * 1024),
      /Blog image must be under 8 MB/,
    );
    assert.throws(
      () => rules.validateUploadFile("messageAny", { size: 1024, type: "video/mp4" }, 0),
      /Only JPEG, PNG, WebP, and PDF are allowed/,
    );
    assert.throws(
      () => rules.validateUploadFile("messageFile", { size: 1024, type: "video/quicktime" }, 0),
      /Only PDF files are allowed/,
    );
    assert.throws(
      () => rules.validateUploadFile("bannerImage", { size: 16 * 1024 * 1024, type: "image/jpeg" }, 0),
      /Shop banner must be under 15 MB/,
    );

    const sellerHandbook = source("src/app/seller-handbook/page.tsx");
    assert.match(sellerHandbook, /banner photo \(3:1, 15MB max\)/);
    assert.doesNotMatch(sellerHandbook, /~12MB max/);

    assert.match(source("src/components/ImageUploadField.tsx"), /uploadMaxSizeMb\("listingImage"\)/);
    assert.match(source("src/components/VideoUploader.tsx"), /uploadMaxSizeMb\("listingVideo"\)/);
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
    assert.match(imageRoute, /uploadKeyUserSegment\(userId\)/);
    assert.match(imageRoute, /BLOG_AUTHOR_ENDPOINTS/);
    assert.match(imageRoute, /me\.role === "EMPLOYEE" \|\| me\.role === "ADMIN"/);
    assert.doesNotMatch(imageRoute, /File too large/);
    assert.doesNotMatch(imageRoute, /File type not allowed/);
    assert.doesNotMatch(source("src/components/MarkdownToolbar.tsx"), /max 4MB/);
  });

  it("keeps blog image uploads distinct from seller-only gallery uploads", () => {
    const blogForm = source("src/components/BlogPostForm.tsx");
    const markdownToolbar = source("src/components/MarkdownToolbar.tsx");
    const blogInput = source("src/lib/blogInput.ts");
    const deletion = source("src/lib/urlValidation.ts");

    assert.match(blogForm, /endpoint="blogImage"/);
    assert.doesNotMatch(blogForm, /endpoint="galleryImage"/);
    assert.match(markdownToolbar, /validateUploadFile\("blogImage", file, 0\)/);
    assert.match(markdownToolbar, /form\.set\("endpoint", "blogImage"\)/);
    assert.match(blogInput, /\["galleryImage", "blogImage"\]/);
    assert.match(deletion, /"blogImage"/);
  });

  it("keeps direct upload verification cleanup observable", () => {
    const verifyRoute = source("src/app/api/upload/verify/route.ts");

    assert.match(verifyRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(verifyRoute, /logServerError\((error|cleanupError), \{/);
    assert.match(verifyRoute, /source: "upload_verify_cleanup"/);
    assert.match(verifyRoute, /level: "warning"/);
    assert.match(verifyRoute, /tags: \{ endpoint \}/);
    assert.match(verifyRoute, /uploadTelemetryKeyHash\(key\)/);
    assert.doesNotMatch(verifyRoute, /console\.error\("\[upload verify\]/);
    assert.doesNotMatch(verifyRoute, /extra: \{ key \}/);
  });

  it("keeps processed-image public availability diagnostics server-side only", () => {
    const imageRoute = source("src/app/api/upload/image/route.ts");

    assert.match(imageRoute, /source: "upload_image_public_availability"/);
    assert.match(imageRoute, /uploadTelemetryKeyHash\(key\)/);
    assert.match(imageRoute, /error: "Uploaded media is not publicly available yet\."/);
    assert.match(imageRoute, /status: HTTP_STATUS\.BAD_GATEWAY/);
    assert.doesNotMatch(imageRoute, /const message = err instanceof Error \? err\.message/);
    assert.doesNotMatch(imageRoute, /privateJson\(\{ error: message \}/);
  });

  it("keeps direct upload metadata spoofing and file-count churn bounded", () => {
    const presignRoute = source("src/app/api/upload/presign/route.ts");
    const imageRoute = source("src/app/api/upload/image/route.ts");
    const verifyRoute = source("src/app/api/upload/verify/route.ts");

    assert.match(presignRoute, /safeRateLimit\(uploadRatelimit, userId\)/);
    assert.match(presignRoute, /safeRateLimit\(uploadHourlyRatelimit, userId\)/);
    assert.match(imageRoute, /safeRateLimit\(uploadRatelimit, userId\)/);
    assert.match(imageRoute, /safeRateLimit\(uploadHourlyRatelimit, userId\)/);
    assert.match(verifyRoute, /safeRateLimit\(uploadHourlyRatelimit, userId\)/);

    assert.match(presignRoute, /ContentLength: size/);
    assert.match(presignRoute, /expectedSize: size/);
    assert.match(presignRoute, /verificationToken/);
    assert.match(verifyRoute, /new HeadObjectCommand/);
    assert.match(verifyRoute, /actualSize/);
    assert.match(verifyRoute, /uploadedObjectVerificationError\(\{/);
    assert.match(verifyRoute, /actualSize,\s*expectedSize,\s*maxSize/s);
    assert.match(verifyRoute, /deleteObject\(key\)/);

    const persistenceHelper = source("src/lib/uploadPersistenceVerification.ts");
    assert.match(persistenceHelper, /new HeadObjectCommand/);
    assert.match(persistenceHelper, /new GetObjectCommand/);
    assert.match(persistenceHelper, /uploadKeyBelongsToUser\(key, endpoint, clerkUserId\)/);
    assert.match(persistenceHelper, /uploadFileSignatureMatches\(prefixBytes, matchedContentType\)/);

    assert.match(presignRoute, /ALLOWED_EXTENSIONS/);
    assert.match(presignRoute, /allowedExtensions\.includes\(ext\)/);
    assert.match(presignRoute, /uploadExtensionMessage/);

    assert.match(source("src/app/dashboard/listings/new/page.tsx"), /filterFirstPartyMediaUrlsForUser\(imageUrls, 10, userId, \["listingImage"\]\)/);
    assert.match(source("src/app/dashboard/listings/custom/page.tsx"), /filterFirstPartyMediaUrlsForUser\(imageUrls, 10, userId, \["listingImage"\]\)/);
    assert.match(source("src/app/api/reviews/route.ts"), /filterFirstPartyMediaUrlsForUser\(photoUrls \?\? \[\], 6, userId, \["reviewPhoto"\]\)/);
    assert.match(source("src/app/api/commission/route.ts"), /filterFirstPartyMediaUrlsForUser\(referenceImageUrls \?\? \[\], 3, userId, \["messageImage"\]\)/);
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
