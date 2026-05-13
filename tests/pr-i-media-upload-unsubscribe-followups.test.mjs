import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("PR I media, upload, and unsubscribe follow-ups", () => {
  it("uses first-party media validation for new write paths while preserving legacy display validation", () => {
    const writePathFiles = [
      "src/app/api/seller/broadcast/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/reviews/[id]/route.ts",
      "src/app/api/commission/route.ts",
      "src/app/messages/[id]/page.tsx",
      "src/app/dashboard/listings/new/page.tsx",
      "src/app/dashboard/listings/custom/page.tsx",
      "src/app/dashboard/profile/page.tsx",
      "src/app/dashboard/onboarding/actions.ts",
      "src/lib/blogInput.ts",
      "src/actions/listings.ts",
    ];

    for (const path of writePathFiles) {
      const text = source(path);
      assert.match(text, /isFirstPartyMediaUrl|filterFirstPartyMediaUrls/, path);
      assert.doesNotMatch(text, /isR2PublicUrl|filterR2PublicUrls/, path);
    }

    const urlValidation = source("src/lib/urlValidation.ts");
    assert.match(urlValidation, /export function isFirstPartyMediaUrl/);
    assert.match(urlValidation, /LEGACY_MEDIA_ORIGINS/);
    assert.match(source("src/lib/email.ts"), /isR2PublicUrl/);
    assert.match(source("src/lib/ai-review.ts"), /isR2PublicUrl/);
  });

  it("deletes processed image uploads when public availability verification fails", () => {
    const route = source("src/app/api/upload/image/route.ts");
    assert.match(route, /DeleteObjectCommand/);
    assert.match(route, /deleteUploadedImageObject\(key\)/);
    assert.match(route, /source: "upload_image_cleanup"/);
    assert.match(route, /assertPublicMediaAvailable\(publicUrl\)/);
  });

  it("keeps GET unsubscribe non-mutating and requires POST for state changes", () => {
    const route = source("src/app/api/email/unsubscribe/route.ts");
    const getHandler = route.slice(route.indexOf("export async function GET"));
    const postHandler = route.slice(route.indexOf("async function handlePost"), route.indexOf("export async function POST"));

    assert.match(getHandler, /confirmationResponse/);
    assert.doesNotMatch(getHandler, /unsubscribeEmail/);
    assert.match(postHandler, /unsubscribeEmail\(email\)/);
    assert.match(route, /List-Unsubscribe=One-Click|response=html|Confirm unsubscribe/);
  });
});
