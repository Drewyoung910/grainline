import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

describe("Bucket B Notification RLS inventory", () => {
  it("pins the current cross-user creation and direct-access surfaces", () => {
    const files = sourceFiles("src");
    const createCallers = [];
    const directAccess = [];
    let createInvocationCount = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const calls = source.match(/createNotification\(\{/g) ?? [];
      const callerCount = file === "src/lib/notifications.ts" ? calls.length - 1 : calls.length;
      if (callerCount > 0) createCallers.push(file);
      createInvocationCount += callerCount;
      if (
        /\b(?:prisma|tx|db)\.notification\.(?:find|count|create|update|delete|upsert)/.test(source)
        || /(?:FROM|DELETE FROM) "Notification"/.test(source)
      ) {
        directAccess.push(file);
      }
    }

    assert.equal(createInvocationCount, 51);
    assert.equal(createCallers.length, 28);
    assert.deepEqual(directAccess.sort(), [
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/api/cron/notification-prune/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/notificationOwnerAccess.ts",
      "src/lib/notifications.ts",
    ]);
  });

  it("keeps asymmetric writes, staged activation, and blockers explicit", () => {
    const plan = fs.readFileSync("docs/rls-bucket-b-notification-plan.md", "utf8");
    assert.match(plan, /Bucket B means `Notification` only/);
    assert.match(plan, /51 `createNotification/);
    assert.match(plan, /column-level `UPDATE \(read\)` only/);
    assert.match(plan, /Do not grant direct `INSERT` or `DELETE`/);
    assert.match(plan, /legacy account-deletion text scan\/redaction/);
    assert.match(plan, /generic provider wrapper\/performance gate/);
    assert.match(plan, /explicit `NO FORCE` plus `ENABLE ROW LEVEL SECURITY`/);
    assert.match(plan, /separate `FORCE ROW LEVEL SECURITY` release/);
    assert.match(plan, /prohibit[\s\S]{0,80}production Notification RLS activation/i);
  });
});
