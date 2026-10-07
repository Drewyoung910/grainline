import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("block filter guardrails", () => {
  it("uses the owner-scoped block target authority for reciprocal filters", () => {
    const blocks = source("src/lib/blocks.ts");
    const migration = source("prisma/migrations/20261007030000_prepare_user_block_email_authorities/migration.sql");

    assert.match(blocks, /withDbUserContext\(userId, userBlockTargets\)/);
    assert.match(blocks, /grainline_user_block_targets\(\)/);
    assert.doesNotMatch(blocks, /prisma\.(?:block|user)\./);
    assert.match(migration, /relationship\."blockerId" = request_user_id[\s\S]*relationship\."blockedId" = request_user_id/);
    assert.equal((migration.match(/counterpart\."deletedAt" IS NULL/g) ?? []).length, 1);
  });

  it("returns user and seller ids from one bounded result and isolates the owner page", () => {
    const blocks = source("src/lib/blocks.ts");
    const page = source("src/app/account/blocked/page.tsx");

    assert.match(blocks, /getBlockedSellerProfileIdsFor/);
    assert.match(blocks, /getBlockedIdsFor/);
    assert.match(blocks, /row\.sellerProfileId \? \[row\.sellerProfileId\] : \[\]/);
    assert.match(blocks, /grainline_user_blocked_account_page\(\)/);
    assert.match(page, /getBlockedAccountsFor\(me\.id\)/);
    assert.doesNotMatch(page, /prisma\.block\.findMany/);
  });
});
