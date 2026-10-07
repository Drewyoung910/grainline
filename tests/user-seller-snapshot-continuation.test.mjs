import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditUserIndirectAccess } from "../scripts/audit-user-indirect-access.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

test("remaining seller preflight callers reuse durable owner identity and activity", () => {
  const messages = source("src/app/messages/new/page.tsx");
  const commission = source("src/app/api/commission/[id]/route.ts");
  const expire = source("src/app/api/cron/commission-expire/route.ts");
  const broadcast = source("src/app/api/seller/broadcast/route.ts");
  const mirror = source("src/lib/stripeWebhookMirror.ts");
  const edit = source("src/app/dashboard/listings/[id]/edit/page.tsx");

  assert.match(messages, /seller:\s*\{[\s\S]*?userId: true,[\s\S]*?ownerAccountActive: true/);
  assert.doesNotMatch(messages, /seller:\s*\{[\s\S]*?user:\s*\{\s*select:\s*\{\s*id: true, banned: true, deletedAt: true/);

  for (const candidate of [commission, expire]) {
    assert.match(candidate, /sellerProfile:\s*\{\s*ownerAccountActive: true/);
    assert.doesNotMatch(candidate, /sellerProfile:\s*\{\s*user:\s*\{\s*banned: false, deletedAt: null/);
  }

  assert.match(broadcast, /ownerAccountActive: true/);
  assert.match(broadcast, /sellerProfile\.ownerAccountActive !== true/);
  assert.doesNotMatch(broadcast, /currentBroadcast\.sellerProfile\.user\.(?:banned|deletedAt)/);

  assert.match(mirror, /userId: true,[\s\S]*ownerAccountActive: true/);
  assert.match(mirror, /localAccountActive = seller\.ownerAccountActive === true/);
  assert.doesNotMatch(mirror, /seller\.user\.(?:id|banned|deletedAt)/);

  assert.match(edit, /import \{ userClerkGate \} from "@\/lib\/userIdentityAccess"/);
  assert.equal((edit.match(/seller:\s*\{ userId: actor\.id \}/g) ?? []).length, 2);
  assert.doesNotMatch(edit, /seller:\s*\{ user:\s*\{ clerkId: userId \} \}/);
  assert.ok(
    edit.indexOf("safeRateLimit(listingMutationRatelimit, userId)")
      < edit.indexOf("userClerkGate(prisma, userId)"),
    "listing updates should rate-limit before resolving the durable local actor",
  );
});

test("seller and public-blog snapshot continuations reduce the User relation frontier", () => {
  const report = auditUserIndirectAccess(process.cwd());
  assert.equal(report.directCount, 0);
  assert.equal(report.relationCount, 46);
  assert.equal(report.relationFiles, 22);
  assert.equal(report.rawSqlCount, 5);
  assert.equal(report.rawSqlFiles, 4);
  assert.equal(report.factoryRelations.length, 1);

  const removedFiles = new Set([
    "src/app/dashboard/listings/[id]/edit/page.tsx",
    "src/app/messages/new/page.tsx",
    "src/app/api/cron/commission-expire/route.ts",
    "src/lib/stripeWebhookMirror.ts",
  ]);
  assert.deepEqual(
    report.relations.filter((edge) => removedFiles.has(edge.query.file)),
    [],
  );
});
