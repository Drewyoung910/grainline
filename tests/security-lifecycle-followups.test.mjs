import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

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
    const featureAuthority = source(
      "prisma/migrations/20261020140000_prepare_seller_profile_staff_feature_transition/migration.sql",
    );

    assert.match(page, /async function requireStaff\(\)/);
    assert.match(page, /async function requireAdminOnly\(\)/);
    assert.match(page, /const me = await requireStaff\(\);[\s\S]*if \(me\.role !== "ADMIN"\) redirect\("\/"\);/);

    for (const action of ["reinstateGuildMember", "featureMaker", "unfeatureMaker"]) {
      assert.match(functionBody(page, action), /const me = await requireAdminOnly\(\)/, `${action} must require ADMIN`);
    }

    assert.match(functionBody(page, "featureMaker"), /applySellerStaffFeatureTransition\(getOrderStaffReadClient\(\), \{/s);
    assert.match(functionBody(page, "featureMaker"), /operation: "FEATURE"/s);
    assert.match(functionBody(page, "unfeatureMaker"), /operation: "UNFEATURE"/s);
    assert.match(featureAuthority, /actor\.role::text = 'ADMIN'/u);
    assert.match(featureAuthority, /source_seller\."userId" = p_actor_id/u);
    assert.match(featureAuthority, /source_seller\."guildLevel" NOT IN/u);
    assert.match(featureAuthority, /source_seller\."chargesEnabled"/u);
    assert.match(featureAuthority, /source_seller\."stripeAccountSupported"/u);
    assert.match(featureAuthority, /source_seller\."vacationMode"/u);
    assert.match(featureAuthority, /INSERT INTO public\."AdminAuditLog"/u);

    assert.match(functionBody(page, "approveGuildMember"), /const me = await requireStaff\(\)/);
    assert.match(functionBody(page, "approveGuildMember"), /const adminOverride = me\.role === "ADMIN"/);
    assert.match(functionBody(page, "approveGuildMaster"), /const me = await requireStaff\(\)/);
    assert.match(page, /staff\.role === "ADMIN" && \(/);
  });

  it("keeps Guild Member reinstatement on active accounts and notifies the seller", () => {
    const page = source("src/app/admin/verification/page.tsx");
    const staffGuildAccess = source("src/lib/sellerGuildStaffPrivateAccess.ts");
    const transitionAuthority = source(sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"));
    const reinstateBody = functionBody(page, "reinstateGuildMember");

    assert.match(reinstateBody, /applySellerGuildStaffTransition\(getOrderStaffReadClient\(\), \{/);
    assert.match(reinstateBody, /operation: "REINSTATE_GUILD_MEMBER"/);
    assert.match(staffGuildAccess, /export async function applySellerGuildStaffTransition/);
    assert.match(transitionAuthority, /source_seller\."ownerAccountActive"/);
    assert.match(transitionAuthority, /active_listing_count < 5/);
    assert.match(transitionAuthority, /grainline_case_guild_unresolved_guard/);
    assert.match(transitionAuthority, /source_actor_role <> 'ADMIN'/);
    assert.match(reinstateBody, /title: "Guild Member badge reinstated"/);
    assert.match(reinstateBody, /publicSellerPath\(sellerProfileId, reinstatement\.sellerDisplayName\)/);
  });

  it("keeps Guild approval writes on active seller accounts", () => {
    const page = source("src/app/admin/verification/page.tsx");
    const staffGuildAccess = source("src/lib/sellerGuildStaffPrivateAccess.ts");
    const verificationAuthority = source(
      "prisma/migrations/20261020235980_prepare_seller_profile_staff_verification_target/migration.sql",
    );
    const transitionAuthority = source(sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"));

    for (const [action, operation] of [
      ["approveGuildMember", "APPROVE_GUILD_MEMBER"],
      ["approveGuildMaster", "APPROVE_GUILD_MASTER"],
    ]) {
      const body = functionBody(page, action);

      assert.match(body, /sellerProfileStaffVerificationTarget\(getOrderStaffReadClient\(\), \{/, `${action} must load account state through the isolated target`);
      assert.match(body, /!verification\.sellerProfile\.ownerAccountActive/, `${action} must block inactive accounts before approval`);
      assert.match(body, /applySellerGuildStaffTransition\(getOrderStaffReadClient\(\), \{/, `${action} must use the isolated staff boundary`);
      assert.match(body, new RegExp(`operation: "${operation}"`), `${action} must select the fixed transition`);
    }
    const memberBody = functionBody(page, "approveGuildMember");
    assert.match(memberBody, /userStaffAdminLabels\(getOrderStaffReadClient\(\), \{/, "approveGuildMember must load the current owner account label");
    assert.match(memberBody, /sellerAccount\.deletedAt/, "approveGuildMember must block deleted owner accounts before approval");
    assert.match(verificationAuthority, /seller\."ownerAccountActive",/);
    assert.match(staffGuildAccess, /grainline_seller_guild_staff_transition/);
    assert.match(transitionAuthority, /NOT source_seller\."ownerAccountActive"/);
    assert.match(transitionAuthority, /RETURN QUERY SELECT false/);
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
    assert.match(schema, /internalResolutionNote\s+String\?\s+@db\.VarChar\(1000\)/);
    assert.match(migration, /ADD COLUMN "resolutionNote" VARCHAR\(500\)/);
    assert.match(route, /participantRationale: z\.string\(\)[\s\S]*codePointLength\(value\) <= 500/);
    assert.match(route, /internalNote: z\.string\(\)[\s\S]*codePointLength\(value\) <= 1000/);
    assert.match(route, /readBoundedJson\(req, ADMIN_REPORT_RESOLVE_BODY_MAX_BYTES\)/);
    assert.match(route, /const participantRationale = truncateText\(sanitizeText\(body\.participantRationale\), 500\)/);
    assert.match(route, /resolveUserReport\(getOrderStaffReadClient\(\), \{/);
    assert.match(button, /Resolution explanation shown to both people/);
    assert.match(button, /Internal staff note \(optional\)/);
    assert.match(button, /participantRationale: trimmedRationale/);
    assert.match(button, /internalNote: internalNote\.trim\(\) \|\| undefined/);
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
    assert.match(deletion, /redactUserReportsForAccountDeletion\(tx, \{/);
    assert.match(deletion, /sideEffectId: localAnonymizeSideEffectId/);
    assert.match(deletion, /claimGeneration: localClaimGeneration/);
    assert.match(deletion, /claimToken: localClaimToken/);
  });
});
