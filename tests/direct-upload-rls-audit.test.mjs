import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("DirectUpload RLS audit contracts", () => {
  it("pins the remaining legacy direct claims and converted fixed-operation surfaces", () => {
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
    assert.match(lifecycle, /export async function claimDirectUploadForKey/);
    assert.match(lifecycle, /client\.directUpload\./);
    const grants = source("scripts/provision-runtime-db-role.sql");
    assert.match(
      grants,
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*public\."DirectUpload"/,
    );
  });

  it("pins every current durable-reference claim family", () => {
    const callSites = [
      ["src/app/dashboard/listings/new/page.tsx", "Listing"],
      ["src/app/dashboard/listings/custom/page.tsx", "Listing"],
      ["src/app/dashboard/listings/[id]/edit/page.tsx", "Listing"],
      ["src/app/dashboard/onboarding/actions.ts", "SellerProfile"],
      ["src/app/dashboard/profile/page.tsx", "SellerProfile"],
      ["src/app/api/reviews/route.ts", "Review"],
      ["src/app/api/reviews/[id]/route.ts", "Review"],
      ["src/app/dashboard/blog/new/page.tsx", "BlogPost"],
      ["src/app/dashboard/blog/[id]/edit/page.tsx", "BlogPost"],
      ["src/app/api/commission/route.ts", "CommissionRequest"],
      ["src/app/api/seller/broadcast/route.ts", "SellerBroadcast"],
      ["src/app/messages/[id]/page.tsx", "Message"],
    ];

    for (const [path, claimType] of callSites) {
      const text = source(path);
      assert.match(text, /claimDirectUpload(?:sForUrls|ForUrl|ForKey)/, path);
      assert.match(
        text,
        new RegExp(`claimedByType: "${claimType}"`),
        path,
      );
    }
    assert.match(
      source("src/app/api/cases/[id]/messages/route.ts"),
      /referenceDirectUploadCaseAttachment/,
    );
  });

  it("pins generic caller-controlled claims and public reuse conflicts", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const broadcast = source("src/app/api/seller/broadcast/route.ts");
    const blogInput = source("src/lib/blogInput.ts");
    const audit = source("docs/direct-upload-rls-audit.md");

    assert.match(
      lifecycle,
      /claimDirectUploadForKey\(\{[\s\S]*claimedByType,[\s\S]*claimedById/,
    );
    assert.match(
      lifecycle,
      /existing\.claimedByType !== claimedByType[\s\S]*existing\.claimedById !== claimedById/,
    );
    assert.match(
      broadcast,
      /allowedEndpoints: \[[\s\S]*"listingImage"[\s\S]*"bannerImage"[\s\S]*"galleryImage"/,
    );
    assert.match(blogInput, /allowedEndpoints: \["galleryImage", "blogImage"\]/);
    assert.match(audit, /one claim conflicts with valid public reuse/i);
    assert.match(audit, /multiple active references for PUBLIC[\s\S]*exactly one for PRIVATE/);
  });

  it("pins the closed export, deletion and cleanup-fence gaps", () => {
    const accountExport = source("src/app/api/account/export/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const review = source("src/app/api/reviews/[id]/route.ts");
    const audit = source("docs/direct-upload-rls-audit.md");

    assert.match(accountExport, /exportOwnedDirectUploads\(user\.id\)/);
    assert.match(deletion, /releaseDirectUploadsForAccount/);
    assert.doesNotMatch(deletion, /tx\.directUpload\.deleteMany/);
    assert.match(review, /deleteR2ObjectByUrl\(photo\.url\)/);
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
    assert.match(audit, /Aggregate legacy inspection/);
    assert.match(audit, /Switch to Extra High\s+before editing schema/);
    assert.match(matrix, /\| `DirectUpload` \| `PLANNED_RLS` \|/);
    assert.match(strategy, /CM-A21 execution contract/);
  });
});
