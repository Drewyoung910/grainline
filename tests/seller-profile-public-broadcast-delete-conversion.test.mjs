import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emailServiceLeastPrivilegeMigrationPath } from "./helpers/email-service-least-privilege-migration-path.mjs";

const page = readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");
const emailServiceAccess = readFileSync("src/lib/emailServiceAccess.ts", "utf8");
const emailServiceMigration = readFileSync(
  emailServiceLeastPrivilegeMigrationPath(),
  "utf8",
);
const deleteAction = page.slice(
  page.indexOf("async function deleteBroadcast"),
  page.indexOf("export default async function AdminBroadcastsPage"),
);

test("broadcast deletion no longer reconstructs an email subject from seller profile data", () => {
  assert.match(deleteAction, /cancelSellerBroadcastEmails\(tx, broadcast\.id\)/u);
  assert.match(
    emailServiceAccess,
    /function cancelSellerBroadcastEmails[\s\S]*grainline_email_outbox_cancel_seller_broadcast/u,
  );
  assert.match(
    emailServiceMigration,
    /FUNCTION public\.grainline_email_outbox_cancel_seller_broadcast\(text\)/u,
  );
  assert.doesNotMatch(deleteAction, /sellerProfileStaffReportTargets/u);
  assert.doesNotMatch(deleteAction, /sellerBroadcastEmailSubject/u);
  assert.doesNotMatch(deleteAction, /sellerProfile:\s*\{\s*select:/u);
});
