import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("admin audit durability", () => {
  it("keeps best-effort audit logging distinct from strict transactional audit logging", () => {
    const audit = source("src/lib/audit.ts");

    assert.match(audit, /export class AdminAuditLogError extends Error/);
    assert.match(audit, /export async function logAdminAction\(input: AdminAuditLogInput\): Promise<string \| null>/);
    assert.match(audit, /export async function logAdminActionOrThrow/);
    assert.match(audit, /throw new AdminAuditLogError\(\)/);
    assert.match(audit, /import \{ sanitizeEmailOutboxError \} from '\.\/emailOutboxSanitize'/);
    assert.match(audit, /console\.error\('Audit log failed:', sanitizeEmailOutboxError\(error\)\)/);
    assert.doesNotMatch(audit, /console\.error\('Audit log failed:', error\)/);
    assert.match(audit, /Sentry\.captureException\(error, \{\s*tags: \{ source: 'audit_log', action \}/);
    assert.match(audit, /extra: \{ adminId, targetType, targetId \}/);
    assert.doesNotMatch(audit, /return ''/);
    assert.match(audit, /Cannot automatically undo this ban because its audit metadata is incomplete/);
    assert.match(audit, /source: 'admin_undo_stripe_account_verify'/);
  });

  it("co-commits high-risk admin mutations with their audit rows", () => {
    for (const path of [
      "src/app/admin/actions.ts",
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/support/actions.ts",
      "src/app/admin/verification/page.tsx",
      "src/app/api/admin/listings/[id]/route.ts",
      "src/app/api/admin/listings/[id]/review/route.ts",
      "src/app/api/admin/reports/[id]/resolve/route.ts",
      "src/app/api/admin/reviews/[id]/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /logAdminActionOrThrow/, `${path} must use strict audit logging`);
      assert.match(text, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*client: tx/s, `${path} must audit inside the mutation transaction`);
    }
  });
});
