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
    ];

    for (const path of writePathFiles) {
      const text = source(path);
      assert.match(text, /isFirstPartyMediaUrl|filterFirstPartyMediaUrls/, path);
      assert.doesNotMatch(text, /isR2PublicUrl|filterR2PublicUrls/, path);
    }

    const urlValidation = source("src/lib/urlValidation.ts");
    assert.match(urlValidation, /export function isFirstPartyMediaUrl/);
    assert.match(urlValidation, /LEGACY_MEDIA_ORIGINS/);
    assert.match(source("src/lib/email.ts"), /isFirstPartyMediaUrl/);
    assert.doesNotMatch(source("src/lib/email.ts"), /isR2PublicUrl/);
    assert.match(source("src/lib/ai-review.ts"), /isR2PublicUrl/);
  });

  it("scopes newly submitted first-party media URLs to the current uploader", () => {
    const currentUserWritePaths = [
      "src/app/messages/[id]/page.tsx",
      "src/app/dashboard/listings/new/page.tsx",
      "src/app/dashboard/listings/custom/page.tsx",
      "src/app/dashboard/onboarding/actions.ts",
      "src/app/api/commission/route.ts",
      "src/app/api/reviews/route.ts",
      "src/lib/blogInput.ts",
    ];

    for (const path of currentUserWritePaths) {
      assert.match(source(path), /isFirstPartyMediaUrlForUser|filterFirstPartyMediaUrlsForUser/, path);
    }

    const listingEdit = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    assert.match(listingEdit, /isExistingUrl/);
    assert.match(listingEdit, /isFirstPartyMediaUrlForUser\(url, clerkUserId, \["listingImage"\]\)/);

    const profile = source("src/app/dashboard/profile/page.tsx");
    assert.match(profile, /normalizeOwnedImageUrl/);
    assert.match(profile, /isFirstPartyMediaUrlForUser\(raw, clerkUserId, \[endpoint\]\)/);
    assert.match(profile, /existingGalleryUrls\.has\(url\)/);

    const commissionRoute = source("src/app/api/commission/route.ts");
    const commissionPage = source("src/app/commission/new/page.tsx");
    assert.match(commissionRoute, /isFirstPartyMediaUrlForUser|filterFirstPartyMediaUrlsForUser/);
    assert.match(commissionRoute, /filterFirstPartyMediaUrlsForUser\(referenceImageUrls \?\? \[\], 3, userId, \["messageImage"\]\)/);
    assert.match(commissionPage, /endpoint="messageImage"/);
    assert.doesNotMatch(commissionPage, /endpoint="listingImage"/);
  });

  it("deletes processed image uploads when public availability verification fails", () => {
    const route = source("src/app/api/upload/image/route.ts");
    assert.match(route, /DeleteObjectCommand/);
    assert.match(route, /deleteUploadedImageObject\(key\)/);
    assert.match(route, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(route, /logServerError\(deleteError, \{/);
    assert.match(route, /source: "upload_image_cleanup"/);
    assert.doesNotMatch(route, /console\.error\("\[upload image\]/);
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

  it("rate-limits unsubscribe POST by signed email as well as IP", () => {
    const route = source("src/app/api/email/unsubscribe/route.ts");
    const ratelimit = source("src/lib/ratelimit.ts");
    const postHandler = route.slice(route.indexOf("async function handlePost"), route.indexOf("export async function POST"));

    assert.match(ratelimit, /export const unsubscribeEmailRatelimit/);
    assert.match(ratelimit, /prefix: "rl:unsubscribe-email"/);
    assert.match(postHandler, /hashEmailForTelemetry\(email\) \?\? email/);
    assert.match(postHandler, /safeRateLimit\(unsubscribeEmailRatelimit, emailRateKey\)/);
    assert.ok(
      postHandler.indexOf("safeRateLimit(unsubscribeEmailRatelimit, emailRateKey)") <
        postHandler.indexOf("await unsubscribeEmail(email)"),
      "per-email unsubscribe limit should run before mutation",
    );
  });

  it("rejects explicit cross-origin unsubscribe POSTs while preserving one-click providers", () => {
    const route = source("src/app/api/email/unsubscribe/route.ts");
    const security = source("src/lib/security.ts");
    const postHandler = route.slice(route.indexOf("async function handlePost"), route.indexOf("export async function POST"));

    assert.match(route, /function getExplicitCrossOriginPostRejection/);
    assert.match(route, /req\.headers\.get\("origin"\)/);
    assert.match(route, /req\.headers\.get\("referer"\)/);
    assert.match(route, /if \(!originHeader && !refererHeader\) return null/);
    assert.match(postHandler, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(postHandler, /logSecurityEvent\("origin_rejected"/);
    assert.match(postHandler, /status: 403/);
    assert.match(security, /origin_rejected/);
  });
});
