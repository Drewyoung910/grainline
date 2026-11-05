import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      const filePath = path.join(process.cwd(), "src", relative.endsWith(".ts") ? relative : `${relative}.ts`);
      return nextResolve(pathToFileURL(filePath).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { sellerProfileStaffListingReviewTransition } = await import("../src/lib/sellerProfileStaffAccess.ts");

test("an emoji-heavy rejection reason within 500 characters reaches the database", async () => {
  let reached = false;
  const client = {
    $queryRaw: async () => {
      reached = true;
      return [];
    },
  };
  // 500 characters is what the route truncates to, and 1,000 UTF-16 units here.
  await sellerProfileStaffListingReviewTransition(client, {
    actorId: "actor",
    listingId: "listing",
    operation: "REJECT",
    reason: "😀".repeat(500),
  });
  assert.equal(reached, true);
});

test("a longer one is still refused", async () => {
  await assert.rejects(
    sellerProfileStaffListingReviewTransition({ $queryRaw: async () => [] }, {
      actorId: "actor",
      listingId: "listing",
      operation: "REJECT",
      reason: "x".repeat(501),
    }),
    RangeError,
  );
});
