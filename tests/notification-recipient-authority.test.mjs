import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("Notification recipient RLS authority candidate", () => {
  const sql = fs.readFileSync(
    "docs/rls-drafts/notification-recipient-access.sql",
    "utf8",
  );
  const ownerAccess = fs.readFileSync("src/lib/notificationOwnerAccess.ts", "utf8");
  const transactionCandidate = fs.readFileSync(
    "src/lib/notificationOwnerAccessTransactionCandidate.ts",
    "utf8",
  );
  const runtimeGuard = fs.readFileSync("scripts/guard-runtime-db-env.mjs", "utf8");
  const plan = fs.readFileSync("docs/rls-bucket-b-notification-plan.md", "utf8");

  const functions = [
    "grainline_notification_unread_count",
    "grainline_notification_bell",
    "grainline_notification_page",
    "grainline_notification_mark_one_read",
    "grainline_notification_mark_many_read",
    "grainline_notification_mark_conversation_read",
    "grainline_notification_export",
    "grainline_notification_recent_low_stock",
  ];

  it("uses recipient SELECT/UPDATE policies and only the read-column grant", () => {
    assert.match(sql, /ALTER TABLE public\."Notification" ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ALTER TABLE public\."Notification" NO FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /CREATE POLICY grainline_notification_recipient_select[\s\S]{0,180}FOR SELECT[\s\S]{0,80}TO grainline_app_runtime/);
    assert.match(sql, /CREATE POLICY grainline_notification_recipient_update[\s\S]{0,180}FOR UPDATE[\s\S]{0,80}TO grainline_app_runtime/);
    assert.equal((sql.match(/pg_catalog\.current_setting\('app\.user_id', true\)/g) ?? []).length, 3);
    assert.match(sql, /WITH CHECK \([\s\S]{0,180}"userId" = NULLIF/);
    assert.match(sql, /REVOKE ALL ON TABLE public\."Notification" FROM PUBLIC, grainline_app_runtime/);
    assert.match(sql, /GRANT SELECT ON TABLE public\."Notification" TO grainline_app_runtime/);
    assert.match(sql, /GRANT UPDATE \(read\) ON TABLE public\."Notification" TO grainline_app_runtime/);
    assert.doesNotMatch(sql, /GRANT (?:INSERT|DELETE|UPDATE ON TABLE)/);
  });

  it("keeps all eight fixed recipient functions invoker-scoped and local-context safe", () => {
    for (const functionName of functions) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]{0,180}FROM PUBLIC;`));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]{0,180}TO grainline_app_runtime;`));
    }
    assert.equal((sql.match(/SECURITY INVOKER/g) ?? []).length, 9);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, 8);
    assert.equal((sql.match(/pg_catalog\.set_config\('app\.user_id', p_user_id, true\)/g) ?? []).length, 8);
    assert.equal((sql.match(/^VOLATILE$/gm) ?? []).length, 8);
    assert.doesNotMatch(sql, /SECURITY DEFINER|\bEXECUTE\s+(?:format|p_)/i);
  });

  it("bounds hot reads and writes and preserves exact conversation ownership semantics", () => {
    assert.match(sql, /LEAST\(COALESCE\(p_limit, 20\), 50\)/);
    assert.match(sql, /LEAST\(COALESCE\(p_page_size, 20\), 100\)/);
    assert.match(sql, /pg_catalog\.cardinality\(p_notification_ids\) > 100/);
    assert.match(sql, /notification\.id = ANY \(p_notification_ids\)/);
    assert.match(sql, /notification\.link = '\/messages\/' \|\| p_conversation_id/);
    assert.doesNotMatch(sql, /notification\.link (?:LIKE|ILIKE)/);
    assert.match(sql, /ORDER BY notification\."createdAt" DESC, notification\.id DESC/);
    assert.match(sql, /LEFT JOIN recent ON true/);
    assert.match(sql, /LEFT JOIN page_rows ON true/);
  });

  it("wires each application operation to one RPC statement without direct Prisma table access", () => {
    for (const functionName of functions) {
      assert.match(ownerAccess, new RegExp(`public\\.${functionName}\\(`));
    }
    assert.equal((ownerAccess.match(/prisma\.\$queryRaw/g) ?? []).length, 8);
    assert.doesNotMatch(ownerAccess, /withDbUserContext|prisma\.notification\./);
    assert.match(ownerAccess, /ARRAY\[\$\{Prisma\.join\(notificationIds\)\}\]::text\[\]/);
    assert.match(ownerAccess, /Number\.isSafeInteger\(count\)/);
    assert.match(runtimeGuard, /notification-recipient-access\.sql/);
  });

  it("retains the rejected transaction candidate as a historical comparison", () => {
    assert.match(transactionCandidate, /withDbUserContext\(userId, async \(db\) =>/);
    assert.match(transactionCandidate, /transactionCandidateNotificationBellData/);
    assert.match(transactionCandidate, /transactionCandidateNotificationPageData/);
    assert.doesNotMatch(transactionCandidate, /Promise\.all/);
    assert.match(plan, /transaction wrapper is a\s+rejected historical control, not a fallback/);
  });

  it("keeps live proof blocking promotion after provider direction selection", () => {
    assert.match(plan, /recipient-access\.sql/);
    assert.match(plan, /one database round trip/);
    assert.match(plan, /selects the one-statement `SECURITY INVOKER` recipient\s+RPC direction/);
    assert.match(plan, /does \*\*not\*\* satisfy the existing two-pass generic provider gate/);
    assert.match(plan, /prove the\s+real Notification functions/);
    assert.match(plan, /PostgreSQL parse\/apply/);
    assert.match(plan, /real-table candidate-aligned provider and route evidence/);
  });
});
