import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function functionBody(text, name) {
  const marker = `async function ${name}`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = text.indexOf("\nasync function ", start + marker.length);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("security lifecycle follow-ups", () => {
  it("keeps sensitive Guild restoration and feature actions admin-only", () => {
    const page = source("src/app/admin/verification/page.tsx");

    assert.match(page, /async function requireStaff\(\)/);
    assert.match(page, /async function requireAdminOnly\(\)/);
    assert.match(page, /const me = await requireStaff\(\);[\s\S]*if \(me\.role !== "ADMIN"\) redirect\("\/"\);/);

    for (const action of ["reinstateGuildMember", "featureMaker", "unfeatureMaker"]) {
      assert.match(functionBody(page, action), /const me = await requireAdminOnly\(\)/, `${action} must require ADMIN`);
    }

    assert.match(page, /import \{ activeSellerProfileWhere \} from "@\/lib\/sellerVisibility"/);
    assert.match(functionBody(page, "featureMaker"), /activeSellerProfileWhere\(\{\s*id: sellerProfileId,\s*guildLevel: \{ in: \["GUILD_MEMBER", "GUILD_MASTER"\] \}/s);

    assert.match(functionBody(page, "approveGuildMember"), /const me = await requireStaff\(\)/);
    assert.match(functionBody(page, "approveGuildMaster"), /const me = await requireStaff\(\)/);
  });

  it("keeps Guild Member reinstatement on active accounts and notifies the seller", () => {
    const page = source("src/app/admin/verification/page.tsx");
    const reinstateBody = functionBody(page, "reinstateGuildMember");

    assert.match(reinstateBody, /user: \{ select: \{ banned: true, deletedAt: true \} \}/);
    assert.match(reinstateBody, /seller\.user\.banned \|\| seller\.user\.deletedAt/);
    assert.match(reinstateBody, /user: \{ banned: false, deletedAt: null \}/);
    assert.match(reinstateBody, /title: "Guild Member badge reinstated"/);
    assert.match(reinstateBody, /publicSellerPath\(sellerProfileId, reinstatedSeller\.displayName\)/);
  });

  it("keeps Guild approval writes on active seller accounts", () => {
    const page = source("src/app/admin/verification/page.tsx");

    for (const action of ["approveGuildMember", "approveGuildMaster"]) {
      const body = functionBody(page, action);

      assert.match(body, /user: \{ select: \{[^}]*banned: true, deletedAt: true/s, `${action} must load account state`);
      assert.match(body, /sellerProfile\.user\.banned \|\| verification\.sellerProfile\.user\.deletedAt/, `${action} must block inactive accounts before approval`);
      assert.match(body, /sellerProfile\.updateMany\(\{[\s\S]*user: \{ banned: false, deletedAt: null \}/, `${action} must guard the seller write by active account state`);
      assert.match(body, /assertGuildVerificationTransition\(sellerUpdated\.count, "approve Guild/, `${action} must surface approval races`);
    }
  });

  it("keeps Guild verification notifications scoped to the source action", () => {
    const page = source("src/app/admin/verification/page.tsx");

    for (const [action, scope] of [
      ["approveGuildMember", "guild-member-approve:${verificationId}"],
      ["rejectGuildMember", "guild-member-reject:${verificationId}"],
      ["revokeMember", "guild-member-revoke:${sellerProfileId}"],
      ["approveGuildMaster", "guild-master-approve:${verificationId}"],
      ["rejectGuildMaster", "guild-master-reject:${verificationId}"],
      ["revokeMaster", "guild-master-revoke:${sellerProfileId}"],
      ["reinstateGuildMember", "guild-member-reinstate:${sellerProfileId}"],
    ]) {
      assert.match(
        functionBody(page, action),
        new RegExp(`dedupScope: \`${scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``),
        `${action} must keep verification notifications source/action scoped`,
      );
    }
  });

  it("surfaces stale Guild revoke and reinstatement races to admins", () => {
    const page = source("src/app/admin/verification/page.tsx");

    for (const action of ["revokeMember", "revokeMaster", "reinstateGuildMember"]) {
      const body = functionBody(page, action);
      assert.match(body, /: Promise<ActionState>/, `${action} must return ActionState`);
      assert.match(body, /return \{ ok: false, error:/, `${action} must return visible errors`);
      assert.match(body, /return \{ ok: true \}/, `${action} must report success`);
    }

    assert.match(page, /<ActionForm action=\{revokeMember\}>/);
    assert.match(page, /<ActionForm action=\{revokeMaster\}>/);
    assert.match(page, /<ActionForm action=\{reinstateGuildMember\}>/);
    assert.doesNotMatch(page, /action=\{revokeMember\.bind/);
    assert.doesNotMatch(page, /action=\{revokeMaster\.bind/);
  });

  it("requires and persists report resolution reasons", () => {
    const route = source("src/app/api/admin/reports/[id]/resolve/route.ts");
    const button = source("src/components/admin/ResolveReportButton.tsx");
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260518180000_add_user_report_resolution_note/migration.sql");

    assert.match(schema, /resolutionNote\s+String\?\s+@db\.VarChar\(500\)/);
    assert.match(migration, /ADD COLUMN "resolutionNote" VARCHAR\(500\)/);
    assert.match(route, /const ReportResolveSchema = z\.object\(\{\s*reason: z\.string\(\)\.min\(1\)\.max\(500\),\s*\}\)/s);
    assert.match(route, /readBoundedJson\(req, ADMIN_REPORT_RESOLVE_BODY_MAX_BYTES\)/);
    assert.match(route, /const resolutionNote = truncateText\(sanitizeText\(body\.reason\), 500\)/);
    assert.match(route, /data: \{ resolved: true, resolvedAt: new Date\(\), resolvedById: admin\.id, resolutionNote \}/);
    assert.match(route, /resolutionNoteStored: true/);
    assert.match(route, /resolutionNoteLength: resolutionNote\.length/);
    assert.doesNotMatch(route, /metadata: \{ resolutionNote \}/);
    assert.match(button, /Resolution reason/);
    assert.match(button, /body: JSON\.stringify\(\{ reason: trimmedReason \}\)/);
    assert.match(button, /Add a resolution reason before closing the report/);
  });

  it("clears account-deletion email suppression on same-email re-signup only", () => {
    const webhook = source("src/app/api/clerk/webhook/route.ts");

    assert.match(webhook, /import \{ emailSuppressionAddressKeys \} from "@\/lib\/emailSuppression"/);
    assert.match(webhook, /if \(event\.type === "user\.created"\) \{/);
    assert.match(webhook, /const suppressionEmailKeys = emailSuppressionAddressKeys\(email\)/);
    assert.match(webhook, /emailSuppression\.deleteMany\(\{\s*where: \{ email: \{ in: suppressionEmailKeys \}, source: "account_deletion" \},\s*\}\)/s);
    assert.doesNotMatch(webhook, /emailSuppression\.deleteMany\(\{\s*where: \{ email: \{ in: suppressionEmailKeys \} \}/);
  });

  it("removes seller-derived state and seller-authored replies during account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /sellerMetrics\.deleteMany\(\{\s*where: \{ sellerProfileId: user\.sellerProfile\.id \},\s*\}\)/s);
    assert.match(deletion, /sellerRatingSummary\.deleteMany\(\{\s*where: \{ sellerProfileId: user\.sellerProfile\.id \},\s*\}\)/s);
    assert.match(deletion, /review\.updateMany\(\{\s*where: \{ listing: \{ sellerId: user\.sellerProfile\.id \} \},\s*data: \{ sellerReply: null, sellerReplyAt: null \},\s*\}\)/s);
    assert.match(deletion, /resolutionNote: \{ not: null \}/);
    assert.match(deletion, /Resolution note removed after an involved account was deleted\./);
    assert.match(deletion, /where: \{ reportedId: user\.id, resolved: false \}/);
    assert.match(deletion, /resolutionNote: "Auto-resolved after the reported account was deleted\."/);
  });
});
