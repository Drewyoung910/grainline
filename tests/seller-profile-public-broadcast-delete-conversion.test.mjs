import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");
const deleteAction = page.slice(
  page.indexOf("async function deleteBroadcast"),
  page.indexOf("export default async function AdminBroadcastsPage"),
);

test("broadcast deletion resolves its seller label through the bounded staff authority", () => {
  assert.match(
    deleteAction,
    /sellerProfileStaffReportTargets\(getOrderStaffReadClient\(\), \{/u,
  );
  assert.match(deleteAction, /actorId: user\.id/u);
  assert.match(deleteAction, /sellerProfileIds: \[broadcast\.sellerProfileId\]/u);
  assert.doesNotMatch(deleteAction, /sellerProfile:\s*\{\s*select:/u);
});
