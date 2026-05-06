import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R56-R67 small audit follow-up guardrails", () => {
  it("keeps markSoldAction atomic against stale listing status", () => {
    const text = source("src/app/seller/[id]/shop/actions.ts");
    const start = text.indexOf("export async function markSoldAction");
    const end = text.indexOf("export async function deleteListingAction");
    const body = text.slice(start, end);

    assert.match(body, /prisma\.listing\.updateMany/);
    assert.match(body, /sellerId: listing\.sellerId/);
    assert.match(body, /status: \{ in: \[ListingStatus\.ACTIVE, ListingStatus\.SOLD_OUT\] \}/);
    assert.doesNotMatch(body, /prisma\.listing\.update\(\{ where: \{ id: listingId \}/);
  });

  it("keeps review submission single-flight and review photo removal touch-friendly", () => {
    const text = source("src/components/ReviewComposer.tsx");

    assert.match(text, /const \[submitting, setSubmitting\] = React\.useState\(false\)/);
    assert.match(text, /if \(submitting\) return/);
    assert.match(text, /disabled=\{submitting \|\| \(editing && existing\?\.locked\)\}/);
    assert.match(text, /h-11 w-11/);
    assert.doesNotMatch(text, /h-6 w-6 rounded-full bg-black\/80/);
  });

  it("handles client fetch lifecycle failures without silent stuck UI", () => {
    assert.match(source("src/components/CaseReplyBox.tsx"), /catch \{\s*setError\("Failed to send\. Check your connection and try again\."\);\s*setLoading\(false\);/s);
    assert.match(source("src/components/BroadcastComposer.tsx"), /const controller = new AbortController\(\)/);
    assert.match(source("src/components/BroadcastComposer.tsx"), /return \(\) => controller\.abort\(\)/);
    assert.match(source("src/components/ThreadMessages.tsx"), /pollController\?\.abort\(\)/);
    assert.match(source("src/components/EditPhotoGrid.tsx"), /reorderAbortRef\.current\?\.abort\(\)/);
  });

  it("keeps minor UI and config cleanup from drifting back", () => {
    assert.doesNotMatch(source("src/components/BuyNowCheckoutModal.tsx"), /bg-stone-50/);
    assert.match(source("src/components/BlogCopyLinkButton.tsx"), /Could not copy the link/);
    assert.match(source(".env.example"), /# CRON_SECRET_PREVIOUS=old-random-cron-secret/);
  });

  it("removes the unused packing helper and react-email render dependency", () => {
    assert.equal(existsSync("src/lib/packing.ts"), false);
    assert.doesNotMatch(source("package.json"), /"@react-email\/render"/);
  });
});
