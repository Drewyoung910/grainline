import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("DirectUpload RLS audit contracts", () => {
  it("pins converted fixed-operation surfaces while compatible table grants remain", () => {
    const convertedPaths = [
      ["src/lib/accountDeletion.ts", /releaseDirectUploadsForAccount/],
      ["src/lib/uploadPersistenceVerification.ts", /findOwnedDirectUploadForKey/],
      ["src/lib/caseEvidence.ts", /findOwnedDirectUploadForKey/],
      ["src/app/api/account/export/route.ts", /exportOwnedDirectUploads/],
      [
        "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts",
        /readDirectUploadCaseAttachment/,
      ],
      [
        "src/app/api/cases/[id]/messages/route.ts",
        /referenceDirectUploadCaseAttachment/,
      ],
    ];

    for (const [path, pattern] of convertedPaths) {
      assert.match(source(path), pattern, path);
      assert.doesNotMatch(source(path), /prisma\.directUpload|tx\.directUpload/, path);
    }

    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    assert.doesNotMatch(lifecycle, /claimDirectUploadFor(?:Url|Key)|claimDirectUploadsForUrls/);
    assert.doesNotMatch(lifecycle, /client\.directUpload\./);
    const grants = source("scripts/provision-runtime-db-role.sql");
    assert.match(
      grants,
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*public\."DirectUpload"/,
    );
  });

  it("pins every current durable-reference claim family", () => {
    const callSites = [
      ["src/app/dashboard/listings/new/page.tsx", "syncListingDirectUploadReferences"],
      ["src/app/dashboard/listings/custom/page.tsx", "syncListingDirectUploadReferences"],
      ["src/app/dashboard/listings/[id]/edit/page.tsx", "syncListingDirectUploadReferences"],
      ["src/app/dashboard/onboarding/actions.ts", "syncSellerProfileDirectUploadReferences"],
      ["src/app/dashboard/profile/page.tsx", "syncSellerProfileDirectUploadReferences"],
      ["src/app/api/reviews/route.ts", "syncReviewDirectUploadReferences"],
      ["src/app/api/reviews/[id]/route.ts", "syncReviewDirectUploadReferences"],
      ["src/app/dashboard/blog/new/page.tsx", "syncBlogPostDirectUploadReferences"],
      ["src/app/dashboard/blog/[id]/edit/page.tsx", "syncBlogPostDirectUploadReferences"],
      ["src/app/api/commission/route.ts", "syncCommissionRequestDirectUploadReferences"],
      ["src/app/api/seller/broadcast/route.ts", "syncSellerBroadcastDirectUploadReferences"],
      ["src/app/messages/[id]/page.tsx", "syncLegacyMessageDirectUploadReference"],
    ];

    for (const [path, syncHelper] of callSites) {
      const text = source(path);
      assert.match(text, new RegExp(syncHelper), path);
      assert.doesNotMatch(text, /claimedByType|claimedById/, path);
    }
    assert.match(
      source("src/app/api/cases/[id]/messages/route.ts"),
      /referenceDirectUploadCaseAttachment/,
    );
  });

  it("removes generic caller-controlled claims and supports validated public reuse", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const broadcast = source("src/app/api/seller/broadcast/route.ts");
    const blogInput = source("src/lib/blogInput.ts");
    const migration = source(
      "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql",
    );
    const audit = source("docs/direct-upload-rls-audit.md");

    assert.doesNotMatch(lifecycle, /claimedByType|claimedById/);
    assert.match(
      broadcast,
      /allowedEndpoints: \[[\s\S]*"listingImage"[\s\S]*"bannerImage"[\s\S]*"galleryImage"/,
    );
    assert.match(blogInput, /allowedEndpoints: \["galleryImage", "blogImage"\]/);
    assert.match(
      migration,
      /grainline_direct_upload_sync_seller_broadcast[\s\S]*ARRAY\['listingImage', 'bannerImage', 'galleryImage'\]/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_sync_blog_post[\s\S]*ARRAY\['galleryImage', 'blogImage'\]/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_sync_public_core[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.match(audit, /one claim conflicts with valid public reuse/i);
    assert.match(audit, /multiple active references for PUBLIC[\s\S]*exactly one for PRIVATE/);
  });

  it("pins the closed export, deletion and cleanup-fence gaps", () => {
    const accountExport = source("src/app/api/account/export/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const review = source("src/app/api/reviews/[id]/route.ts");
    const listingEdit = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const migration = source(
      "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql",
    );
    const audit = source("docs/direct-upload-rls-audit.md");

    assert.match(accountExport, /exportOwnedDirectUploads\(user\.id\)/);
    assert.match(deletion, /releaseDirectUploadsForAccount/);
    assert.doesNotMatch(deletion, /tx\.directUpload\.deleteMany/);
    assert.doesNotMatch(review, /deleteR2ObjectByUrl/);
    assert.doesNotMatch(listingEdit, /deleteR2ObjectByUrl/);
    assert.match(migration, /grainline_direct_upload_release_source_core/);
    assert.match(migration, /grainline_direct_upload_source_delete_trigger/);
    assert.match(migration, /grainline_direct_upload_release_review_delete/);
    assert.match(migration, /grainline_direct_upload_release_listing_delete/);
    assert.match(lifecycle, /grainline_direct_upload_cleanup_complete/);
    assert.match(lifecycle, /grainline_direct_upload_cleanup_fail/);
    assert.match(audit, /must omit key, URL, internal target ids and raw\s+provider error text/);
    assert.match(audit, /attempt\/lease token/);
  });

  it("requires service-only FORCE RLS and a separate compatible release", () => {
    const audit = source("docs/direct-upload-rls-audit.md");
    const matrix = source("docs/rls-coverage-matrix.md");
    const strategy = source("STRATEGY.md");

    assert.match(audit, /ENABLE plus FORCE RLS with no runtime table\s+policy or direct table grant/);
    assert.match(audit, /Add `DirectUploadReference`/);
    assert.match(audit, /unique foreign key to the exact\s+`DirectUpload` row/);
    assert.match(audit, /stolen `grainline_app_runtime` credential can impersonate/);
    assert.match(audit, /dedicated NOBYPASSRLS worker role and connection/);
    assert.match(audit, /Ordinary `grainline_app_runtime` must lose EXECUTE on all three/);
    assert.match(audit, /record_private_message` grant must also be absent/);
    assert.match(audit, /Aggregate legacy inspection/);
    assert.match(audit, /Keep Extra High through the cleanup-worker authority review/);
    assert.match(audit, /explicit approval is required for each merge/);
    assert.match(matrix, /\| `DirectUpload` \| `PLANNED_RLS` \|/);
    assert.match(matrix, /dedicated NOBYPASSRLS worker role/);
    assert.match(strategy, /CM-A21 execution contract/);
    assert.match(strategy, /run `30225445722`/);
    assert.match(strategy, /Withhold the unused future\s+private-message recorder/);
  });
});
