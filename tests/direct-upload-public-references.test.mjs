import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("DirectUpload fixed public reference families", () => {
  it("keeps caller-chosen source identity behind runtime-inaccessible cores", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.grainline_direct_upload_sync_public_core\([\s\S]*p_source_type text,[\s\S]*p_source_id text/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_direct_upload_sync_public_core\([\s\S]*FROM PUBLIC, grainline_app_runtime;/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_direct_upload_release_source_core\([\s\S]*FROM PUBLIC, grainline_app_runtime;/,
    );
    assert.match(
      migration,
      /private_core_grant_count <> 0[\s\S]*public-source cores must remain runtime-inaccessible/,
    );
    assert.match(migration, /endpoint\.value IS NULL[\s\S]*public endpoint set is invalid/);
    assert.match(migration, /candidate\.value ~ '\[\[:cntrl:\]\]'/);
    assert.match(
      migration,
      /p_user_id IS NULL[\s\S]*grainline_direct_upload_actor_valid\(p_user_id\)[\s\S]*p_source_type IS NULL/,
    );
  });

  it("derives each runtime family source, owner, endpoints and URLs from durable rows", () => {
    const migration = source(migrationPath);
    const requiredFunctions = [
      "grainline_direct_upload_sync_listing",
      "grainline_direct_upload_sync_seller_profile",
      "grainline_direct_upload_sync_review",
      "grainline_direct_upload_sync_blog_post",
      "grainline_direct_upload_sync_commission_request",
      "grainline_direct_upload_sync_seller_broadcast",
      "grainline_direct_upload_sync_legacy_message",
    ];

    for (const functionName of requiredFunctions) {
      assert.match(
        migration,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`),
        functionName,
      );
      assert.match(
        migration,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION\\s+public\\.${functionName}\\(text, text\\)\\s+TO grainline_app_runtime;`,
        ),
        functionName,
      );
    }

    assert.match(migration, /runtime_grant_count <> 7/);
    assert.match(migration, /public_grant_count <> 0/);
    assert.match(migration, /FROM public\."Listing"[\s\S]*FOR UPDATE OF listing/);
    assert.match(migration, /FROM public\."SellerProfile"[\s\S]*FOR UPDATE/);
    assert.match(migration, /FROM public\."Review"[\s\S]*FOR UPDATE/);
    assert.match(migration, /FROM public\."BlogPost"[\s\S]*FOR UPDATE OF blog/);
    assert.match(migration, /FROM public\."CommissionRequest"[\s\S]*FOR UPDATE/);
    assert.match(migration, /FROM public\."SellerBroadcast"[\s\S]*FOR UPDATE OF broadcast_row/);
    assert.match(migration, /FROM public\."Message" AS message_row[\s\S]*FOR UPDATE/);
    const nullableUnsafeOwnershipChecks = migration.match(
      /(?:owner_id|profile\."userId"|reviewer_id|request\."buyerId"|broadcast\."userId"|message_source\."senderId")\s*<>\s*p_user_id/g,
    );
    assert.equal(nullableUnsafeOwnershipChecks, null);
    assert.equal(
      (
        migration.match(
          /(?:owner_id|profile\."userId"|reviewer_id|request\."buyerId"|broadcast\."userId"|message_source\."senderId")\s+IS DISTINCT FROM\s+p_user_id/g,
        ) ?? []
      ).length,
      6,
    );
  });

  it("handles nullable BlogPost ownership without a three-valued-logic bypass", () => {
    const migration = source(migrationPath);
    const blogStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_blog_post",
    );
    const commissionStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_commission_request",
      blogStart,
    );
    const blogFunction = migration.slice(blogStart, commissionStart);

    assert.match(
      blogFunction,
      /p_user_id IS DISTINCT FROM post\."authorId"/,
    );
    assert.doesNotMatch(blogFunction, /seller_user_id/);
    assert.doesNotMatch(blogFunction, /NOT IN\s*\(/);
  });

  it("takes desired and stale lifecycle locks in one stable order before mutation", () => {
    const migration = source(migrationPath);
    const coreStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_public_core",
    );
    const messageCoreStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_message_url_core",
      coreStart,
    );
    const core = migration.slice(coreStart, messageCoreStart);

    assert.match(core, /SELECT candidate\.id[\s\S]*UNION[\s\S]*reference\."directUploadId"/);
    assert.match(core, /ORDER BY upload\.id[\s\S]*FOR UPDATE OF upload/);
    assert.ok(
      core.indexOf("FOR locked_upload_id IN") <
        core.indexOf("PERFORM public.grainline_direct_upload_reference_core"),
    );
    assert.ok(
      core.indexOf("FOR locked_upload_id IN") <
        core.indexOf("public.grainline_direct_upload_release_core"),
    );
    assert.match(
      core,
      /INTO untracked[\s\S]*IF untracked = 0 THEN[\s\S]*grainline_direct_upload_release_core/,
    );
  });

  it("releases source references on root deletion and never deletes reused R2 objects inline", () => {
    const migration = source(migrationPath);
    const listingEdit = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const review = source("src/app/api/reviews/[id]/route.ts");
    const adminReview = source("src/app/api/admin/reviews/[id]/route.ts");

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.grainline_direct_upload_source_delete_trigger/);
    assert.match(migration, /source_delete_trigger_count <> 7/);
    for (const table of [
      "Listing",
      "SellerProfile",
      "Review",
      "BlogPost",
      "CommissionRequest",
      "SellerBroadcast",
      "Message",
    ]) {
      assert.match(migration, new RegExp(`BEFORE DELETE ON public\\."${table}"`), table);
    }
    assert.doesNotMatch(listingEdit, /deleteR2ObjectByUrl/);
    assert.doesNotMatch(review, /deleteR2ObjectByUrl/);
    assert.doesNotMatch(adminReview, /deleteR2ObjectByUrl/);
  });

  it("removes the generic application claim API and pins every fixed call site", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
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

    assert.doesNotMatch(lifecycle, /claimDirectUploadFor(?:Url|Key)|claimDirectUploadsForUrls/);
    assert.doesNotMatch(lifecycle, /claimedByType|claimedById/);
    for (const [path, helper] of callSites) {
      const text = source(path);
      assert.match(text, new RegExp(helper), path);
      assert.doesNotMatch(text, /claimDirectUploadFor(?:Url|Key)|claimDirectUploadsForUrls/, path);
    }
  });
});
