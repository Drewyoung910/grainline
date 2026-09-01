import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("seller refund route source-order guardrails", () => {
  it("releases stale refund locks only after durable Order ownership is established", () => {
    const source = readFileSync("src/app/api/orders/[id]/refund/route.ts", "utf8");

    const ownershipCheck = source.search(
      /findFirst\(\{\s*where: \{ id: orderId, sellerProfileId: seller\.id \}/s,
    );
    const lockRelease = "const staleLocksReleased = await releaseStaleRefundLocks(orderId);";
    const disputeCheck = "if (order.paymentOpenDisputeBlocked)";

    assert.match(source, /findFirst\(\{\s*where: \{ id: orderId, sellerProfileId: seller\.id \}/s);
    assert.doesNotMatch(source, /order\.items\.(?:some|every)\(\(it\) => it\.listing\.sellerId === seller\.id\)/);
    assert.notEqual(ownershipCheck, -1);
    assert.notEqual(source.indexOf(lockRelease), -1);
    assert.notEqual(source.indexOf(disputeCheck), -1);
    assert.ok(
      ownershipCheck < source.indexOf(lockRelease),
      "refund lock cleanup must not run before durable Order ownership is verified",
    );
    assert.ok(
      source.indexOf(lockRelease) < source.indexOf(disputeCheck),
      "stale lock cleanup should still run before the database-maintained dispute check",
    );
  });
});
