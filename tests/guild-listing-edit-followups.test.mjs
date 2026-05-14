import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("guild and listing-edit audit follow-ups", () => {
  it("keeps dashboard Guild eligibility aligned with the application API", () => {
    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const applyRoute = source("src/app/api/verification/apply/route.ts");

    assert.match(dashboard, /status: "ACTIVE", isPrivate: false/);
    assert.match(applyRoute, /status: "ACTIVE", isPrivate: false/);
    assert.match(applyRoute, /safeRateLimit\(verificationApplyRatelimit, me\.id\)/);
    assert.match(applyRoute, /rateLimitResponse\(reset, "Too many verification applications\."\)/);
  });

  it("keeps listing edit row and variant replacement in one transaction", () => {
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");

    assert.match(editPage, /const updatedListing = await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(editPage, /await tx\.listing\.update\(/);
    assert.match(editPage, /await tx\.listingVariantGroup\.deleteMany/);
    assert.match(editPage, /await tx\.listingVariantGroup\.create/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.deleteMany/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.create/);
  });
});
