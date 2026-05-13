import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");

describe("user report target access guardrails", () => {
  it("requires reporter access before accepting private report targets", () => {
    assert.match(source, /let reporterCanAccess = false/);
    assert.match(source, /!exists \|\| !reporterCanAccess/);

    assert.match(
      source,
      /buyerId: me\.id/,
      "order reports must require the reporter to be the buyer or seller",
    );
    assert.match(
      source,
      /conversation: \{ OR: \[\{ userAId: me\.id \}, \{ userBId: me\.id \}\] \}/,
      "message reports must require the reporter to be in the conversation",
    );
    assert.match(
      source,
      /AND: \[\{ OR: \[\{ userAId: me\.id \}, \{ userBId: me\.id \}\] \}\]/,
      "thread reports must require the reporter to be in the conversation",
    );
    assert.match(
      source,
      /canViewListingDetail\(listing, \{ dbUserId: me\.id \}\)/,
      "listing reports must require public or reserved listing access",
    );
    assert.match(
      source,
      /post: publicBlogPostWhere\(\)/,
      "blog comment reports must be limited to comments on public posts",
    );
  });
});
