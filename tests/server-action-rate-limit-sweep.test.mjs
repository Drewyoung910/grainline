import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("server-action rate-limit sweep", () => {
  it("rate-limits blocked-user unblocks before current-user lookup", () => {
    const actions = source("src/app/account/blocked/actions.ts");

    assert.match(actions, /blockRatelimit/);
    assert.match(actions, /safeRateLimit\(blockRatelimit, userId\)/);
    assert.ok(
      actions.indexOf("safeRateLimit(blockRatelimit, userId)") <
        actions.indexOf("ensureUserByClerkId(userId)"),
      "unblock server action should rate-limit before local user DB lookup",
    );
  });

  it("rate-limits dashboard blog deletes before author lookup", () => {
    const page = source("src/app/dashboard/blog/page.tsx");

    assert.match(page, /blogCreateRatelimit/);
    assert.match(page, /safeRateLimit\(blogCreateRatelimit, userId\)/);
    assert.ok(
      page.indexOf("safeRateLimit(blogCreateRatelimit, userId)") <
        page.indexOf("prisma.user.findUnique"),
      "blog delete server action should rate-limit before local user lookup",
    );
  });

  it("rate-limits custom listing creation before seller and conversation work", () => {
    const page = source("src/app/dashboard/listings/custom/page.tsx");

    assert.match(page, /listingCreateRatelimit/);
    assert.match(page, /safeRateLimit\(listingCreateRatelimit, userId\)/);
    assert.ok(
      page.indexOf("safeRateLimit(listingCreateRatelimit, userId)") <
        page.indexOf("const { me, seller } = await ensureSeller()"),
      "custom listing creation should rate-limit before seller lookup",
    );
    assert.ok(
      page.indexOf("safeRateLimit(listingCreateRatelimit, userId)") <
        page.indexOf("prisma.conversation.findFirst"),
      "custom listing creation should rate-limit before conversation lookup",
    );
  });

  it("rate-limits listing edit saves before form parsing and ownership lookup", () => {
    const page = source("src/app/dashboard/listings/[id]/edit/page.tsx");

    assert.match(page, /listingMutationRatelimit/);
    assert.match(page, /safeRateLimit\(listingMutationRatelimit, userId\)/);
    assert.ok(
      page.indexOf("safeRateLimit(listingMutationRatelimit, userId)") <
        page.indexOf("const title ="),
      "listing edit should rate-limit before high-cost form parsing",
    );
    assert.ok(
      page.indexOf("safeRateLimit(listingMutationRatelimit, userId)") <
        page.indexOf("prisma.listing.findFirst"),
      "listing edit should rate-limit before ownership lookup",
    );
  });

  it("rate-limits dashboard guild applications before seller and metrics work", () => {
    const page = source("src/app/dashboard/verification/page.tsx");

    assert.match(page, /verificationApplyRatelimit/);
    assert.match(page, /safeRateLimit\(verificationApplyRatelimit, userId\)/);
    assert.ok(
      page.indexOf("safeRateLimit(verificationApplyRatelimit, userId)") <
        page.indexOf("const { seller: s } = await ensureSeller()"),
      "Guild Member application should rate-limit before seller lookup",
    );
    assert.ok(
      page.lastIndexOf("safeRateLimit(verificationApplyRatelimit, userId)") <
        page.lastIndexOf("const { seller: s } = await ensureSeller()"),
      "Guild Master application should rate-limit before seller lookup",
    );
  });
});
