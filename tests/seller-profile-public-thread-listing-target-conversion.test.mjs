import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/messages/[id]/page.tsx", "utf8");

test("message-thread composer resolves listing context through participant authority", () => {
  assert.doesNotMatch(page, /canAttachConversationContextListing/u);
  assert.match(
    page,
    /sellerParticipantConversationListingTarget\(\s*me\.id,\s*other\.id,\s*requestedListingId,?\s*\)/u,
  );
  assert.doesNotMatch(
    page,
    /requestedListingId[\s\S]{0,500}prisma\.listing\.findUnique/u,
  );
});
