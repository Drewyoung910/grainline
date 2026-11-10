import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");
const deleteAction = page.slice(
  page.indexOf("async function deleteBroadcast"),
  page.indexOf("export default async function AdminBroadcastsPage"),
);

test("broadcast deletion no longer reconstructs an email subject from seller profile data", () => {
  assert.match(deleteAction, /const staffClient = getOrderStaffReadClient\(\)/u);
  assert.match(deleteAction, /deleteStaffSellerBroadcast\(staffClient, \{/u);
  assert.match(deleteAction, /actorId: user\.id/u);
  assert.match(deleteAction, /broadcastId: id/u);
  assert.doesNotMatch(deleteAction, /sellerProfileStaffReportTargets/u);
  assert.doesNotMatch(deleteAction, /sellerBroadcastEmailSubject/u);
  assert.doesNotMatch(deleteAction, /sellerProfile:\s*\{\s*select:/u);
  assert.doesNotMatch(deleteAction, /prisma\.sellerBroadcast\.|tx\.sellerBroadcast\./u);
});
