import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("seller refund route source-order guardrails", () => {
  it("releases stale refund locks only after seller item ownership is established", () => {
    const source = readFileSync("src/app/api/orders/[id]/refund/route.ts", "utf8");

    const ownershipCheck = 'if (myItems.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });';
    const lockRelease = "const staleLocksReleased = await releaseStaleRefundLocks(orderId);";
    const disputeCheck = "const latestDispute = await prisma.orderPaymentEvent.findFirst";

    assert.notEqual(source.indexOf(ownershipCheck), -1);
    assert.notEqual(source.indexOf(lockRelease), -1);
    assert.notEqual(source.indexOf(disputeCheck), -1);
    assert.ok(
      source.indexOf(ownershipCheck) < source.indexOf(lockRelease),
      "refund lock cleanup must not run before order item ownership is verified",
    );
    assert.ok(
      source.indexOf(lockRelease) < source.indexOf(disputeCheck),
      "stale lock cleanup should still run before refund conflict/dispute checks",
    );
  });
});
