import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");

test("admin broadcasts resolve seller presentation through the isolated staff authority", () => {
  const listStart = page.indexOf(
    "const broadcasts = await prisma.sellerBroadcast.findMany",
  );
  const listEnd = page.indexOf("function buildHref", listStart);
  assert.ok(
    listStart >= 0 && listEnd > listStart,
    "missing reviewed broadcast list",
  );
  const listSource = page.slice(listStart, listEnd);
  assert.doesNotMatch(listSource, /sellerProfile:\s*\{\s*select:/u);
  assert.match(
    listSource,
    /sellerProfileStaffBroadcastTargets\(getOrderStaffReadClient\(\), \{/u,
  );
  assert.match(listSource, /actorId: staff\.id/u);
  assert.match(
    listSource,
    /broadcastIds: broadcasts\.map\(\(broadcast\) => broadcast\.id\)/u,
  );
  assert.match(listSource, /sellerTargetByBroadcastId/u);
});
