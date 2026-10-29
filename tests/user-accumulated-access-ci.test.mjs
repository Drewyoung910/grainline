import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { deriveGrantInventory } from "../scripts/audit-runtime-db-grants.mjs";
import { USER_AUTHORITY_GROUPS } from "../scripts/user-authority-catalog.mjs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrations = [
  "20261006010000_prepare_user_staff_ban_authorities",
  "20261006020000_prepare_user_account_deletion_authorities",
  "20261006030000_prepare_user_relationship_authorities",
  "20261007155000_correct_user_clerk_identity_placeholder",
  "20261007160000_converge_user_cross_domain_authorities",
];
const enableMigration = "20261008010000_enable_user_rls";
const forceMigration = "20261008020000_force_user_rls";
const heldMigrations = [...migrations, enableMigration, forceMigration];
const heldTests = [
  "db-grant-inventory.test.mjs",
  "user-staff-ban-authorities.test.mjs",
  "user-account-deletion-authorities.test.mjs",
  "user-relationship-authorities.test.mjs",
  "user-cross-domain-authority-convergence.test.mjs",
  "user-cross-domain-convergence-production-workflow.test.mjs",
  "email-normalization-followups.test.mjs",
  "user-rls-enable-postgres-proof.test.mjs",
  "user-rls-enable-production-inspect.test.mjs",
  "user-rls-enable-production-workflow.test.mjs",
  "user-rls-enable-release.test.mjs",
  "user-rls-force-postgres-proof.test.mjs",
  "user-rls-force-production-workflow.test.mjs",
  "user-rls-force-release.test.mjs",
  "user-authority-catalog.test.mjs",
  "user-accumulated-access-ci.test.mjs",
  "order-ban-review-authority.test.mjs",
  "order-staff-read-role-provision.test.mjs",
  "order-staff-read-role-catalog-postgres.test.mjs",
  "account-deletion-blocker-refund-state.test.mjs",
  "account-deletion-timeout-fix.test.mjs",
  "round9-account-deletion-pii-guardrails.test.mjs",
  "conversation-message-pre-rls-audit.test.mjs",
  "conversation-message-recipient-rls.test.mjs",
];
const packageOwnedTests = [
  "user-clerk-identity-authority-postgres.test.mjs",
  "user-email-address-history.test.mjs",
];
const accountDeletionSuccessorTests = [
  "account-deletion-side-effect-ci.test.mjs",
  "account-deletion-side-effect-activation-postgres.test.mjs",
  "account-deletion-side-effect-database-contract.test.mjs",
  "account-deletion-side-effect-production-inspect.test.mjs",
  "account-deletion-side-effect-production-workflows.test.mjs",
  "account-deletion-side-effects.test.mjs",
];
const accountDeletionSuccessorMigrations = [
  "20261011170000_prepare_account_deletion_side_effect_claim_fence",
  "20261011173000_prepare_account_deletion_media_key_fence",
  "20261011180000_enable_account_deletion_side_effect_rls",
  "20261012120000_force_account_deletion_side_effect_rls",
];
const accountDeletionPostRetirementRepair =
  "20261015013000_repair_account_deletion_after_seller_profile_retirement";
const blockedCheckoutRefundWitness =
  "20261015030000_preserve_blocked_checkout_refund_witness";
const supportRequestPreparationMigration =
  "20261023010000_prepare_support_request_authorities";
const supportRequestEnableMigration =
  "20261023020000_enable_support_request_rls";
const supportRequestEmailReuseCorrectionMigration =
  "20261023050000_correct_support_request_email_reuse_privacy";
const supportRequestForceMigration =
  "20261023060000_force_support_request_rls";
const supportRequestCandidateMigrations = [
  supportRequestPreparationMigration,
  supportRequestEnableMigration,
  supportRequestEmailReuseCorrectionMigration,
  supportRequestForceMigration,
];
const supportRequestCandidateTests = [
  "private-table-enable-production.test.mjs",
  "private-table-force-production.test.mjs",
  "private-table-preparation-production.test.mjs",
  "support-request-email-reuse-privacy-production-workflow.test.mjs",
];
const ownerTableCandidateMigrations = [
  "20261023070000_activate_saved_blog_post_rls",
  "20261023080000_activate_cart_cart_item_rls",
  "20261027040000_activate_stock_notification_rls",
];
const ownerTableCandidateTests = [
  "owner-table-rls-activation-production.test.mjs",
  "seller-profile-owner-saved-blog-post-authority-postgres.test.mjs",
  "stock-notification-rls-activation-production.test.mjs",
];
const emailDeliveryLedgerCandidateMigration =
  "20261025010000_prepare_email_delivery_ledger";
const emailDeliveryLedgerCandidateTests = [
  "email-service-delivery-ledger-postgres-proof.test.mjs",
];
const emailProviderDeletionFenceMigration =
  "20261025020000_fence_email_provider_and_account_deletion";
const emailProviderEligibilityFenceMigration =
  "20261025030000_fence_email_provider_and_eligibility_changes";
const emailOutboxContractCorrectionMigration =
  "20261027020000_correct_email_outbox_contracts";
const emailEligibilityLockOrderCorrectionMigration =
  "20261027030000_correct_email_eligibility_lock_order";
const stockNotificationPreparationMigration =
  "20261026010000_prepare_stock_notification_authorities";
const favoritePreparationMigration =
  "20261028010000_prepare_favorite_authorities";
const followPreparationMigration =
  "20261028020000_prepare_follow_authorities";
const reviewVotePreparationMigration =
  "20261028030000_prepare_review_vote_authorities";
const makerVerificationPreparationMigration =
  "20261028040000_prepare_maker_verification_authorities";
const makerVerificationActivationMigration =
  "20261028080000_activate_maker_verification_rls";
const favoriteActivationMigration =
  "20261028050000_activate_favorite_rls";
const followActivationMigration =
  "20261028060000_activate_follow_rls";
const sellerProfilePrivateBoundaryMigrations = [
  "20261013120000_prepare_seller_profile_private_boundary",
  "20261013130000_move_seller_supported_snapshot_sql_callers",
  "20261013140000_move_checkout_seller_private_sql_callers",
  "20261013150000_move_custom_order_seller_private_sql_callers",
  "20261013160000_move_case_guild_seller_private_sql_caller",
  "20261013170000_move_order_label_seller_private_sql_caller",
  "20261013180000_move_provider_identity_seller_private_sql_callers",
  "20261013190000_move_reconciliation_seller_private_sql_callers",
  "20261013200000_move_final_seller_private_sql_callers",
  "20261013210000_move_account_deletion_seller_private_sql_callers",
];
const admittedTests = [...heldTests, ...packageOwnedTests];
const staffScript = "scripts/provision-order-staff-read-role.sql";
const grantAuditScript = "scripts/audit-runtime-db-grants.mjs";
const runtimeProvisionScript = "scripts/provision-runtime-db-role.sql";
const historicalBase = "66746f47e87a73a6efce2ee6833542be5a86cc57";
const historicalStaffBlob = "46fd8e1bfa086cb097adf194eb193389122ee9d9";
const historicalStaffCatalogBlob = "6d0a46c02fa040e7651b675696cec67ad1b2fdd3";
const sellerProfilePredecessor = "0b10fab0e0072cb6dfba83119e3881c7cc0afa27";
const sellerProfilePredecessorStaffBlob = "abffb4dce9351bdd64e63b3d846e8abd27e98e9f";
const sellerProfilePredecessorGrantAuditBlob = "38bd25785a96b50b3148843608f1a927b7d867ac";
const sellerProfilePredecessorRuntimeProvisionBlob = "6824b5ecb9a7e9f4bc6e2d440d22f6b6a2a38e5a";

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
}

function bashBody(name) {
  return step(name).split("        run: |\n")[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

function accountDeletionSuccessorTestPath(file) {
  const livePath = path.join("tests", file);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "account-deletion-side-effect-claim-fence",
    file,
  );
  assert.ok(existsSync(stagedPath), `missing isolated AccountDeletionSideEffect test ${file}`);
  return stagedPath;
}

function accumulatedUserTestPath(file) {
  const livePath = path.join("tests", file);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "seller-profile-public-candidate",
    "tests",
    file,
  );
  assert.ok(
    existsSync(stagedPath),
    `missing isolated accumulated User test ${file}`,
  );
  return stagedPath;
}

function accountDeletionSuccessorMigrationPath(migration) {
  const livePath = path.join("prisma", "migrations", migration);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "account-deletion-side-effect-claim-fence",
    migration,
  );
  assert.ok(existsSync(stagedPath), `missing isolated AccountDeletionSideEffect migration ${migration}`);
  return stagedPath;
}

function accountDeletionPostRetirementRepairPath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    accountDeletionPostRetirementRepair,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "account-deletion-post-retirement-repair",
    accountDeletionPostRetirementRepair,
  );
  assert.ok(existsSync(stagedPath), "missing isolated account-deletion post-retirement repair");
  return stagedPath;
}

function blockedCheckoutRefundWitnessSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    blockedCheckoutRefundWitness,
  );
  if (existsSync(livePath)) return livePath;
  const isolatedMigrationPath =
    process.env.BLOCKED_CHECKOUT_REFUND_WITNESS_MIGRATION_PATH;
  assert.ok(
    isolatedMigrationPath && path.isAbsolute(isolatedMigrationPath),
    "missing absolute isolated blocked-checkout refund witness migration path",
  );
  assert.ok(
    existsSync(isolatedMigrationPath),
    "missing isolated blocked-checkout refund witness migration",
  );
  return path.dirname(isolatedMigrationPath);
}

function supportRequestCandidateMigrationPath(migration) {
  const livePath = path.join(
    "prisma",
    "migrations",
    migration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "support-request-candidate",
    "migrations",
    migration,
  );
  assert.ok(existsSync(stagedPath), `missing isolated SupportRequest migration ${migration}`);
  return stagedPath;
}

function supportRequestPreparationTestPath(file) {
  const livePath = path.join("tests", file);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "support-request-candidate",
    "tests",
    file,
  );
  assert.ok(existsSync(stagedPath), `missing isolated SupportRequest preparation test ${file}`);
  return stagedPath;
}

function ownerTableCandidateMigrationPath(migration) {
  const livePath = path.join("prisma", "migrations", migration);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "saved-blog-post-rls-candidate",
    "migrations",
    migration,
  );
  assert.ok(existsSync(stagedPath), `missing isolated owner-table migration ${migration}`);
  return stagedPath;
}

function ownerTableCandidateTestPath(file) {
  const livePath = path.join("tests", file);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "saved-blog-post-rls-candidate",
    "tests",
    file,
  );
  assert.ok(existsSync(stagedPath), `missing isolated owner-table test ${file}`);
  return stagedPath;
}

function emailDeliveryLedgerCandidateMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    emailDeliveryLedgerCandidateMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "email-delivery-ledger-candidate",
    "migrations",
    emailDeliveryLedgerCandidateMigration,
  );
  assert.ok(existsSync(stagedPath), "missing isolated email delivery-ledger migration");
  return stagedPath;
}

function emailDeliveryLedgerCandidateTestPath(file) {
  const livePath = path.join("tests", file);
  if (existsSync(livePath)) return livePath;
  const stagedPath = path.join(
    process.env.RUNNER_TEMP ?? "",
    "email-delivery-ledger-candidate",
    "tests",
    file,
  );
  assert.ok(existsSync(stagedPath), `missing isolated email delivery-ledger test ${file}`);
  return stagedPath;
}

function emailProviderDeletionFenceMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    emailProviderDeletionFenceMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    "missing isolated email provider/account-deletion fence migration",
  );
  return stagedPath;
}

function emailProviderEligibilityFenceMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    emailProviderEligibilityFenceMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    "missing isolated email provider/eligibility fence migration",
  );
  return stagedPath;
}

function emailOutboxContractCorrectionMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    emailOutboxContractCorrectionMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath =
    process.env.EMAIL_OUTBOX_CONTRACT_CORRECTION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && path.isAbsolute(stagedPath) && existsSync(stagedPath),
    "missing isolated email outbox contract correction migration",
  );
  return stagedPath;
}

function emailEligibilityLockOrderCorrectionMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    emailEligibilityLockOrderCorrectionMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath =
    process.env.EMAIL_ELIGIBILITY_LOCK_ORDER_CORRECTION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && path.isAbsolute(stagedPath) && existsSync(stagedPath),
    "missing isolated email eligibility lock-order correction migration",
  );
  return stagedPath;
}

function stockNotificationPreparationMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    stockNotificationPreparationMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.STOCK_NOTIFICATION_PREPARATION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    "missing isolated StockNotification preparation migration",
  );
  return stagedPath;
}

function favoritePreparationMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    favoritePreparationMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.FAVORITE_PREPARATION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    "missing isolated Favorite preparation migration",
  );
  return stagedPath;
}

function followCandidateMigrationSourcePath(migration) {
  const livePath = path.join(
    "prisma",
    "migrations",
    migration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.FOLLOW_PREPARATION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    `missing isolated Follow source package for ${migration}`,
  );
  const stagedMigrations = path.dirname(stagedPath);
  const candidatePath = path.join(stagedMigrations, migration);
  assert.ok(
    existsSync(candidatePath),
    `missing isolated Follow migration ${migration}`,
  );
  return candidatePath;
}

function reviewVotePreparationMigrationSourcePath() {
  const livePath = path.join(
    "prisma",
    "migrations",
    reviewVotePreparationMigration,
  );
  if (existsSync(livePath)) return livePath;
  const stagedPath = process.env.REVIEW_VOTE_PREPARATION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    "missing isolated ReviewVote preparation migration",
  );
  return path.dirname(stagedPath);
}

function makerVerificationMigrationSourcePath(migration) {
  const livePath = path.join("prisma", "migrations", migration);
  if (existsSync(livePath)) return livePath;
  const stagedPath = migration === makerVerificationPreparationMigration
    ? process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH ?? ""
    : process.env.MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH ?? "";
  assert.ok(
    stagedPath && existsSync(stagedPath),
    `missing isolated MakerVerification migration ${migration}`,
  );
  return path.dirname(stagedPath);
}

function favoriteActivationMigrationSourcePath() {
  return path.join(
    "prisma",
    "migrations",
    favoriteActivationMigration,
  );
}

test("every test with a literal held-migration dependency is admitted before replay isolation", () => {
  const omitted = [];
  for (const file of readdirSync("tests").filter((name) => name.endsWith(".test.mjs"))) {
    const parsed = ts.createSourceFile(file, readFileSync(path.join("tests", file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && migrations.some((migration) => node.text.startsWith("prisma/migrations/" + migration + "/"))
        && !admittedTests.includes(file)) omitted.push(file);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
  assert.deepEqual([...new Set(omitted)], []);
});

test("new User families are proved then isolated until historical prerequisites finish", () => {
  const verify = "Verify accumulated User access source package";
  const isolate = "Isolate accumulated User access until its predecessors pass";
  const restore = "Restore accumulated User access source package";
  const restoreEnable = "Restore User policyless ENABLE source package";
  const restoreForce = "Restore User policyless FORCE source package";
  const apply = "Apply accumulated User access in disposable PostgreSQL";
  const audit = "Audit runtime grants after accumulated User access";
  const converge = "Converge accumulated User and Order isolated runtime and staff grants";
  const restoreCurrentGrantSources =
    "Restore SellerProfile private-boundary migration after all predecessors";
  const reconvergeCurrent =
    "Reconverge current runtime grants after restored money corrections";
  const auditCurrent = "Audit runtime grants after Case refund recovery";
  const isolateWitness =
    "Isolate blocked-checkout refund witness until immutable refund repair passes";
  const restoreWitness =
    "Restore blocked-checkout refund witness after immutable refund repair";
  const applyWitness =
    "Apply blocked-checkout refund witness after immutable refund repair";
  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf("Isolate User public-identity first package"));
  assert.ok(workflow.indexOf(restore) > workflow.indexOf("Audit runtime grants after User public seller-state snapshot"));
  assert.ok(workflow.indexOf(restore) < workflow.indexOf(apply));
  assert.ok(workflow.indexOf(apply) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(apply) < workflow.indexOf(converge));
  assert.ok(workflow.indexOf(converge) < workflow.indexOf(audit));
  assert.match(step(converge), /--file=scripts\/provision-runtime-db-role\.sql/);
  assert.match(step(converge), /--file=scripts\/provision-order-staff-read-role\.sql/);
  assert.ok(workflow.indexOf(restoreCurrentGrantSources) < workflow.indexOf(reconvergeCurrent));
  assert.ok(workflow.indexOf(reconvergeCurrent) < workflow.indexOf(auditCurrent));
  assert.match(step(reconvergeCurrent), /--file=scripts\/provision-runtime-db-role\.sql/);
  assert.ok(workflow.indexOf(audit) < workflow.indexOf("Production build"));
  assert.ok(workflow.indexOf(isolateWitness) < workflow.indexOf(
    "Isolate immutable Order refund-event repair until current Production predecessors pass",
  ));
  assert.ok(workflow.indexOf(isolateWitness) < workflow.indexOf(restore));
  assert.ok(workflow.indexOf(restoreWitness) > workflow.indexOf(
    "Apply immutable Order refund-event repair after current Production predecessors",
  ));
  assert.ok(workflow.indexOf(restoreWitness) < workflow.indexOf(applyWitness));
  assert.ok(step(isolateWitness).includes(blockedCheckoutRefundWitness));
  assert.match(
    step(isolateWitness),
    /BLOCKED_CHECKOUT_REFUND_WITNESS_MIGRATION_PATH=\$holding\/\$migration\/migration\.sql/,
  );
  assert.ok(step(restoreWitness).includes(blockedCheckoutRefundWitness));
  assert.ok(step(applyWitness).includes(blockedCheckoutRefundWitness));
  for (const migration of migrations) {
    for (const name of [isolate, restore, apply]) assert.ok(step(name).includes(migration), `${name}: ${migration}`);
  }
  assert.ok(step(isolate).includes(enableMigration));
  assert.ok(step(restoreEnable).includes(enableMigration));
  assert.ok(step(isolate).includes(forceMigration));
  assert.ok(step(restoreForce).includes(forceMigration));
  assert.ok(workflow.indexOf(restoreEnable) > workflow.indexOf(restore));
  assert.ok(workflow.indexOf(restoreEnable) < workflow.indexOf("Re-verify User policyless ENABLE source package"));
  assert.ok(workflow.indexOf(restoreForce) > workflow.indexOf("Audit runtime grants after User policyless ENABLE"));
  assert.ok(workflow.indexOf(restoreForce) < workflow.indexOf("Re-verify User policyless FORCE source package"));
  for (const file of heldTests) {
    assert.ok(step(verify).includes(file), file);
    assert.ok(step(isolate).includes(file), file);
  }
  assert.match(step(apply), /psql "\$DIRECT_URL" --set=ON_ERROR_STOP=on/);
  assert.match(step(apply), /--file="prisma\/migrations\/\$migration\/migration\.sql"/);
  assert.doesNotMatch(step(apply), /gh |vercel|workflow_dispatch|environment: Production/);
  assert.ok(step(isolate).includes(historicalBase));
  assert.ok(step(isolate).includes(historicalStaffBlob));
  assert.ok(step(isolate).includes(staffScript));
  assert.ok(step(restore).includes(staffScript));
  assert.ok(step(restore).includes(sellerProfilePredecessor));
  assert.ok(step(restore).includes(sellerProfilePredecessorStaffBlob));
  assert.ok(step(restore).includes(sellerProfilePredecessorGrantAuditBlob));
  assert.ok(step(restore).includes(sellerProfilePredecessorRuntimeProvisionBlob));
  assert.match(step(restore), /"\$seller_holding\/provision-order-staff-read-role\.sql"/);
  assert.match(step(restore), /"\$seller_holding\/audit-runtime-db-grants\.mjs"/);
  assert.match(step(restore), /"\$seller_holding\/provision-runtime-db-role\.sql"/);
  assert.match(step(converge), /--set=staff_role=grainline_staff_read_runtime/);
  assert.match(step(converge), /--set=migration_role=ci/);
  assert.match(step(converge), /--file=scripts\/provision-order-staff-read-role\.sql/);
  for (const auditStep of [
    audit,
    "Audit runtime grants after User block-email authorities",
    "Audit runtime grants after User follower authorities",
    "Audit runtime grants after User staff admin-label authority",
    "Audit runtime grants after User policyless ENABLE",
    "Audit runtime grants after User policyless FORCE",
    "Audit runtime grants after Clerk webhook event authority",
    "Audit runtime grants after AccountDeletionSideEffect FORCE",
  ]) {
    assert.match(
      step(auditStep),
      /--allow-loopback-ci --staff-read-stage=order-user-combined/u,
      auditStep,
    );
  }
});

test("package-owned tests remain available for their later isolation steps", () => {
  const accumulated = step("Isolate accumulated User access until its predecessors pass");
  const clerkIdentity = step("Isolate User Clerk identity authority until historical release guards pass");
  const clerkIdentityReplay = step("Re-verify User Clerk identity authority source package");
  const emailAddress = step("Isolate UserEmailAddress authority until historical release guards pass");
  assert.doesNotMatch(accumulated, /user-clerk-identity-authority-postgres\.test\.mjs/);
  assert.doesNotMatch(accumulated, /user-email-address-history\.test\.mjs/);
  assert.match(clerkIdentity, /user-clerk-identity-authority-postgres\.test\.mjs/);
  assert.match(
    clerkIdentityReplay,
    /USER_CLERK_IDENTITY_PLACEHOLDER_CORRECTION_MIGRATION_PATH: \$\{\{ runner\.temp \}\}\/user-accumulated-access\/20261007155000_correct_user_clerk_identity_placeholder\/migration\.sql/,
  );
  assert.match(emailAddress, /user-email-address-history\.test\.mjs/);
});

test("SupportRequest candidate is isolated before exact-latest historical release guards", () => {
  const verify = "Verify SupportRequest preparation, ENABLE, and FORCE source package";
  const isolate = "Isolate SupportRequest candidate until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restore = "Restore SupportRequest candidate after historical release guards";
  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restore));
});

test("owner-table candidates are isolated before exact-latest historical release guards", () => {
  const isolateName = "Isolate SavedBlogPost RLS candidate until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore SavedBlogPost RLS candidate after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  for (const migration of [
    "20261023070000_activate_saved_blog_post_rls",
    "20261023080000_activate_cart_cart_item_rls",
  ]) {
    assert.match(isolate, new RegExp(migration));
    assert.match(restore, new RegExp(migration));
  }
  assert.match(isolate, /mv "prisma\/migrations\/\$migration"/);
  assert.match(restore, /mv "\$holding\/migrations\/\$migration" "prisma\/migrations\/\$migration"/);
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("MakerVerification candidates are proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify MakerVerification preparation source package";
  const isolateName = "Isolate MakerVerification candidates until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore MakerVerification candidates after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(makerVerificationPreparationMigration));
  assert.match(isolate, new RegExp(makerVerificationActivationMigration));
  assert.match(restore, new RegExp(makerVerificationPreparationMigration));
  assert.match(restore, new RegExp(makerVerificationActivationMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("email delivery-ledger preparation is proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify email delivery-ledger preparation source package";
  const isolateName = "Isolate email delivery-ledger preparation until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore email delivery-ledger preparation after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(emailDeliveryLedgerCandidateMigration));
  assert.match(isolate, /email-service-delivery-ledger-postgres-proof\.test\.mjs/u);
  assert.match(restore, new RegExp(emailDeliveryLedgerCandidateMigration));
  assert.match(restore, /email-service-delivery-ledger-postgres-proof\.test\.mjs/u);
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("email provider/account-deletion fence is proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify email provider/account-deletion fence source package";
  const isolateName = "Isolate email provider/account-deletion fence until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore email provider/account-deletion fence after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(emailProviderDeletionFenceMigration));
  assert.match(restore, new RegExp(emailProviderDeletionFenceMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("email provider/eligibility fence is proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify email provider/eligibility fence source package";
  const isolateName = "Isolate email provider/eligibility fence until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreDeletion = "Restore email provider/account-deletion fence after historical release guards";
  const restoreName = "Restore email provider/eligibility fence after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(emailProviderEligibilityFenceMigration));
  assert.match(restore, new RegExp(emailProviderEligibilityFenceMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreDeletion));
  assert.ok(workflow.indexOf(restoreDeletion) < workflow.indexOf(restoreName));
});

test("StockNotification preparation is proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify StockNotification preparation source package";
  const isolateName = "Isolate StockNotification preparation until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore StockNotification preparation after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(stockNotificationPreparationMigration));
  assert.match(restore, new RegExp(stockNotificationPreparationMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("Favorite preparation and activation are proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify Favorite source packages";
  const isolateName = "Isolate Favorite source packages until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore Favorite source packages after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(favoritePreparationMigration));
  assert.match(isolate, new RegExp(favoriteActivationMigration));
  assert.match(restore, new RegExp(favoritePreparationMigration));
  assert.match(restore, new RegExp(favoriteActivationMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("Follow preparation and activation are proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify Follow source packages";
  const isolateName = "Isolate Follow source packages until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore Follow source packages after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(followPreparationMigration));
  assert.match(isolate, new RegExp(followActivationMigration));
  assert.match(restore, new RegExp(followPreparationMigration));
  assert.match(restore, new RegExp(followActivationMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("ReviewVote preparation is proved, isolated, and restored around historical guards", () => {
  const verifyName = "Verify ReviewVote preparation source package";
  const isolateName = "Isolate ReviewVote preparation until historical release guards pass";
  const checkoutReceipt = "Verify compatible Order checkout receipt authority release";
  const restoreName = "Restore ReviewVote preparation after historical release guards";
  const isolate = step(isolateName);
  const restore = step(restoreName);
  assert.match(isolate, new RegExp(reviewVotePreparationMigration));
  assert.match(restore, new RegExp(reviewVotePreparationMigration));
  assert.ok(workflow.indexOf(verifyName) < workflow.indexOf(isolateName));
  assert.ok(workflow.indexOf(isolateName) < workflow.indexOf(checkoutReceipt));
  assert.ok(workflow.indexOf(checkoutReceipt) < workflow.indexOf(restoreName));
});

test("actual isolation and restoration scripts preserve source bytes while staging the follower catalog", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "grainline-user-ci-staging-"));
  const root = path.join(temporary, "checkout");
  const holding = path.join(temporary, "runner");
  try {
    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", process.cwd(), root], { env: { PATH: process.env.PATH } });
    mkdirSync(holding);
    mkdirSync(path.join(root, "tests"));
    mkdirSync(path.join(root, "docs"));
    cpSync("scripts", path.join(root, "scripts"), { recursive: true });
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"), "dir");
    cpSync("prisma", path.join(root, "prisma"), { recursive: true });
    for (const file of [
      "db-defense-in-depth-plan.md",
      "rls-feasibility-plan.md",
      "runbook.md",
      "launch-checklist.md",
    ]) {
      cpSync(`docs/${file}`, path.join(root, "docs", file));
    }
    cpSync(".env.example", path.join(root, ".env.example"));
    cpSync("package.json", path.join(root, "package.json"));
    for (const migration of accountDeletionSuccessorMigrations) {
      const target = path.join(root, "prisma", "migrations", migration);
      if (!existsSync(target)) {
        cpSync(accountDeletionSuccessorMigrationPath(migration), target, { recursive: true });
      }
    }
    const repairTarget = path.join(
      root,
      "prisma",
      "migrations",
      accountDeletionPostRetirementRepair,
    );
    if (!existsSync(repairTarget)) {
      cpSync(accountDeletionPostRetirementRepairPath(), repairTarget, { recursive: true });
    }
    const blockedCheckoutRefundWitnessTarget = path.join(
      root,
      "prisma",
      "migrations",
      blockedCheckoutRefundWitness,
    );
    if (!existsSync(blockedCheckoutRefundWitnessTarget)) {
      cpSync(
        blockedCheckoutRefundWitnessSourcePath(),
        blockedCheckoutRefundWitnessTarget,
        { recursive: true },
      );
    }
    for (const migration of supportRequestCandidateMigrations) {
      const target = path.join(root, "prisma", "migrations", migration);
      if (!existsSync(target)) {
        cpSync(supportRequestCandidateMigrationPath(migration), target, { recursive: true });
      }
    }
    for (const file of heldTests) {
      cpSync(accumulatedUserTestPath(file), path.join(root, "tests", file));
    }
    for (const file of accountDeletionSuccessorTests) {
      cpSync(accountDeletionSuccessorTestPath(file), path.join(root, "tests", file));
    }
    for (const file of supportRequestCandidateTests) {
      cpSync(supportRequestPreparationTestPath(file), path.join(root, "tests", file));
    }
    for (const migration of ownerTableCandidateMigrations) {
      cpSync(
        ownerTableCandidateMigrationPath(migration),
        path.join(root, "prisma", "migrations", migration),
        { recursive: true },
      );
    }
    for (const file of ownerTableCandidateTests) {
      cpSync(ownerTableCandidateTestPath(file), path.join(root, "tests", file));
    }
    const emailDeliveryLedgerTarget = path.join(
      root,
      "prisma",
      "migrations",
      emailDeliveryLedgerCandidateMigration,
    );
    if (!existsSync(emailDeliveryLedgerTarget)) {
      cpSync(
        emailDeliveryLedgerCandidateMigrationSourcePath(),
        emailDeliveryLedgerTarget,
        { recursive: true },
      );
    }
    for (const file of emailDeliveryLedgerCandidateTests) {
      cpSync(
        emailDeliveryLedgerCandidateTestPath(file),
        path.join(root, "tests", file),
      );
    }
    const emailProviderDeletionFenceTarget = path.join(
      root,
      "prisma",
      "migrations",
      emailProviderDeletionFenceMigration,
    );
    if (!existsSync(emailProviderDeletionFenceTarget)) {
      cpSync(
        emailProviderDeletionFenceMigrationSourcePath(),
        emailProviderDeletionFenceTarget,
        { recursive: true },
      );
    }
    const emailProviderEligibilityFenceTarget = path.join(
      root,
      "prisma",
      "migrations",
      emailProviderEligibilityFenceMigration,
    );
    if (!existsSync(emailProviderEligibilityFenceTarget)) {
      cpSync(
        emailProviderEligibilityFenceMigrationSourcePath(),
        emailProviderEligibilityFenceTarget,
        { recursive: true },
      );
    }
    const emailOutboxContractCorrectionTarget = path.join(
      root,
      "prisma",
      "migrations",
      emailOutboxContractCorrectionMigration,
    );
    if (!existsSync(emailOutboxContractCorrectionTarget)) {
      cpSync(
        emailOutboxContractCorrectionMigrationSourcePath(),
        emailOutboxContractCorrectionTarget,
        { recursive: true },
      );
    }
    const emailEligibilityLockOrderCorrectionTarget = path.join(
      root,
      "prisma",
      "migrations",
      emailEligibilityLockOrderCorrectionMigration,
    );
    if (!existsSync(emailEligibilityLockOrderCorrectionTarget)) {
      cpSync(
        emailEligibilityLockOrderCorrectionMigrationSourcePath(),
        emailEligibilityLockOrderCorrectionTarget,
        { recursive: true },
      );
    }
    const stockNotificationPreparationTarget = path.join(
      root,
      "prisma",
      "migrations",
      stockNotificationPreparationMigration,
    );
    if (!existsSync(stockNotificationPreparationTarget)) {
      cpSync(
        stockNotificationPreparationMigrationSourcePath(),
        stockNotificationPreparationTarget,
        { recursive: true },
      );
    }
    const favoritePreparationTarget = path.join(
      root,
      "prisma",
      "migrations",
      favoritePreparationMigration,
    );
    if (!existsSync(favoritePreparationTarget)) {
      cpSync(
        favoritePreparationMigrationSourcePath(),
        favoritePreparationTarget,
        { recursive: true },
      );
    }
    const followPreparationTarget = path.join(
      root,
      "prisma",
      "migrations",
      followPreparationMigration,
    );
    if (!existsSync(followPreparationTarget)) {
      cpSync(
        followCandidateMigrationSourcePath(followPreparationMigration),
        followPreparationTarget,
        { recursive: true },
      );
    }
    const reviewVotePreparationTarget = path.join(
      root,
      "prisma",
      "migrations",
      reviewVotePreparationMigration,
    );
    if (!existsSync(reviewVotePreparationTarget)) {
      cpSync(
        reviewVotePreparationMigrationSourcePath(),
        reviewVotePreparationTarget,
        { recursive: true },
      );
    }
    for (const migration of [
      makerVerificationPreparationMigration,
      makerVerificationActivationMigration,
    ]) {
      const target = path.join(root, "prisma", "migrations", migration);
      if (!existsSync(target)) {
        cpSync(
          makerVerificationMigrationSourcePath(migration),
          target,
          { recursive: true },
        );
      }
    }
    const favoriteActivationTarget = path.join(
      root,
      "prisma",
      "migrations",
      favoriteActivationMigration,
    );
    if (!existsSync(favoriteActivationTarget)) {
      cpSync(
        favoriteActivationMigrationSourcePath(),
        favoriteActivationTarget,
        { recursive: true },
      );
    }
    const followActivationTarget = path.join(
      root,
      "prisma",
      "migrations",
      followActivationMigration,
    );
    if (!existsSync(followActivationTarget)) {
      cpSync(
        followCandidateMigrationSourcePath(followActivationMigration),
        followActivationTarget,
        { recursive: true },
      );
    }
    const heldPaths = [...heldMigrations.map((migration) => `prisma/migrations/${migration}/migration.sql`), ...heldTests.map((file) => `tests/${file}`)];
    const sellerProfilePrivateBoundaryPaths = sellerProfilePrivateBoundaryMigrations.map(
      (migration) => `prisma/migrations/${migration}/migration.sql`,
    );
    const postRetirementRepairPath =
      `prisma/migrations/${accountDeletionPostRetirementRepair}/migration.sql`;
    const blockedCheckoutRefundWitnessPath =
      `prisma/migrations/${blockedCheckoutRefundWitness}/migration.sql`;
    const supportRequestCandidatePaths = supportRequestCandidateMigrations.map(
      (migration) => `prisma/migrations/${migration}/migration.sql`,
    );
    const ownerTableCandidatePaths = ownerTableCandidateMigrations.map(
      (migration) => `prisma/migrations/${migration}/migration.sql`,
    );
    const emailDeliveryLedgerCandidatePath =
      `prisma/migrations/${emailDeliveryLedgerCandidateMigration}/migration.sql`;
    const emailProviderDeletionFencePath =
      `prisma/migrations/${emailProviderDeletionFenceMigration}/migration.sql`;
    const emailProviderEligibilityFencePath =
      `prisma/migrations/${emailProviderEligibilityFenceMigration}/migration.sql`;
    const emailOutboxContractCorrectionPath =
      `prisma/migrations/${emailOutboxContractCorrectionMigration}/migration.sql`;
    const emailEligibilityLockOrderCorrectionPath =
      `prisma/migrations/${emailEligibilityLockOrderCorrectionMigration}/migration.sql`;
    const stockNotificationPreparationPath =
      `prisma/migrations/${stockNotificationPreparationMigration}/migration.sql`;
    const favoritePreparationPath =
      `prisma/migrations/${favoritePreparationMigration}/migration.sql`;
    const followPreparationPath =
      `prisma/migrations/${followPreparationMigration}/migration.sql`;
    const reviewVotePreparationPath =
      `prisma/migrations/${reviewVotePreparationMigration}/migration.sql`;
    const makerVerificationCandidatePaths = [
      makerVerificationPreparationMigration,
      makerVerificationActivationMigration,
    ].map((migration) => `prisma/migrations/${migration}/migration.sql`);
    const favoriteActivationPath =
      `prisma/migrations/${favoriteActivationMigration}/migration.sql`;
    const followActivationPath =
      `prisma/migrations/${followActivationMigration}/migration.sql`;
    const trackedPaths = [
      ...heldPaths,
      ...sellerProfilePrivateBoundaryPaths,
      postRetirementRepairPath,
      blockedCheckoutRefundWitnessPath,
      ...supportRequestCandidatePaths,
      ...supportRequestCandidateTests.map((file) => `tests/${file}`),
      ...ownerTableCandidatePaths,
      ...ownerTableCandidateTests.map((file) => `tests/${file}`),
      emailDeliveryLedgerCandidatePath,
      ...emailDeliveryLedgerCandidateTests.map((file) => `tests/${file}`),
      emailProviderDeletionFencePath,
      emailProviderEligibilityFencePath,
      emailOutboxContractCorrectionPath,
      emailEligibilityLockOrderCorrectionPath,
      stockNotificationPreparationPath,
      favoritePreparationPath,
      followPreparationPath,
      reviewVotePreparationPath,
      ...makerVerificationCandidatePaths,
      favoriteActivationPath,
      followActivationPath,
      "prisma/schema.prisma",
      staffScript,
      grantAuditScript,
      runtimeProvisionScript,
    ];
    const hash = (relative) => createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
    const original = trackedPaths.map(hash);
    const catalogPath = "tests/user-authority-catalog.test.mjs";
    const catalogIndex = trackedPaths.indexOf(catalogPath);
    const scriptEnv = {
      PATH: process.env.PATH,
      RUNNER_TEMP: holding,
      GITHUB_ENV: path.join(holding, "github-env"),
    };
    const sellerPublicTestHolding = path.join(
      holding,
      "seller-profile-public-candidate",
      "tests",
    );
    mkdirSync(sellerPublicTestHolding, { recursive: true });
    cpSync(
      path.join(root, "tests", "db-grant-inventory.test.mjs"),
      path.join(sellerPublicTestHolding, "db-grant-inventory.test.mjs"),
    );
    rmSync(path.join(root, "tests", "db-grant-inventory.test.mjs"));
    execFileSync("bash", ["-c", bashBody("Isolate email eligibility lock-order correction until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate email outbox contract correction until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate email provider/eligibility fence until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate email provider/account-deletion fence until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate SavedBlogPost RLS candidate until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate email delivery-ledger preparation until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate SupportRequest candidate until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate StockNotification preparation until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate Favorite source packages until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate Follow source packages until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate ReviewVote preparation until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate MakerVerification candidates until historical release guards pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate AccountDeletionSideEffect claim-fence until its predecessors pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate post-retirement account-deletion repair until all predecessors pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate accumulated User access until its predecessors pass")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate SellerProfile private-boundary migration from historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Isolate blocked-checkout refund witness until immutable refund repair passes")], { cwd: root, env: scriptEnv });
    assert.ok(heldPaths.every((relative) => !existsSync(path.join(root, relative))));
    assert.ok(sellerProfilePrivateBoundaryPaths.every((relative) => !existsSync(path.join(root, relative))));
    assert.equal(existsSync(path.join(root, postRetirementRepairPath)), false);
    assert.equal(existsSync(path.join(root, blockedCheckoutRefundWitnessPath)), false);
    assert.ok(supportRequestCandidatePaths.every(
      (relative) => !existsSync(path.join(root, relative)),
    ));
    assert.ok(supportRequestCandidateTests.every(
      (file) => !existsSync(path.join(root, "tests", file)),
    ));
    assert.ok(ownerTableCandidatePaths.every(
      (relative) => !existsSync(path.join(root, relative)),
    ));
    assert.ok(ownerTableCandidateTests.every(
      (file) => !existsSync(path.join(root, "tests", file)),
    ));
    assert.equal(existsSync(path.join(root, emailDeliveryLedgerCandidatePath)), false);
    assert.equal(existsSync(path.join(root, emailProviderDeletionFencePath)), false);
    assert.equal(existsSync(path.join(root, emailProviderEligibilityFencePath)), false);
    assert.equal(existsSync(path.join(root, emailOutboxContractCorrectionPath)), false);
    assert.equal(existsSync(path.join(root, emailEligibilityLockOrderCorrectionPath)), false);
    assert.equal(existsSync(path.join(root, stockNotificationPreparationPath)), false);
    assert.equal(existsSync(path.join(root, favoritePreparationPath)), false);
    assert.equal(existsSync(path.join(root, followPreparationPath)), false);
    assert.equal(existsSync(path.join(root, reviewVotePreparationPath)), false);
    assert.ok(makerVerificationCandidatePaths.every(
      (relative) => !existsSync(path.join(root, relative)),
    ));
    assert.equal(existsSync(path.join(root, favoriteActivationPath)), false);
    assert.equal(existsSync(path.join(root, followActivationPath)), false);
    assert.ok(emailDeliveryLedgerCandidateTests.every(
      (file) => !existsSync(path.join(root, "tests", file)),
    ));
    const historicalStaff = readFileSync(path.join(root, staffScript), "utf8");
    assert.doesNotMatch(historicalStaff, /grainline_user_staff_/);
    assert.equal(execFileSync("git", ["hash-object", staffScript], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(), historicalStaffBlob);
    const heldFunctions = USER_AUTHORITY_GROUPS
      .filter(({ migration }) => migrations.includes(migration) &&
        migration !== "20261007155000_correct_user_clerk_identity_placeholder")
      .flatMap(({ functions }) => functions.map(({ name }) => name));
    const historical = deriveGrantInventory(root);
    assert.deepEqual(
      heldFunctions.filter((name) => historical.functions.includes(name)),
      [],
    );
    mkdirSync(path.join(holding, "user-staff-admin-labels"));
    mkdirSync(path.join(holding, "user-follower-authority"));
    execFileSync("bash", ["-c", bashBody("Prepare SellerProfile public predecessor schema for historical audit replay")], { cwd: root, env: scriptEnv });
    execFileSync(
      path.join(holding, "seller-profile-public-candidate", "with-predecessor-schema.sh"),
      [
        "bash",
        "-c",
        'test "$(git hash-object prisma/schema.prisma)" = 8a28e26d614771b9ce0a2febf8bc8a717b3ed1b9',
      ],
      { cwd: root, env: scriptEnv },
    );
    assert.equal(hash("prisma/schema.prisma"), original[trackedPaths.indexOf("prisma/schema.prisma")]);
    execFileSync("bash", ["-c", bashBody("Restore accumulated User access source package")], { cwd: root, env: scriptEnv });
    assert.equal(
      execFileSync("git", ["hash-object", staffScript], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      sellerProfilePredecessorStaffBlob,
    );
    assert.equal(
      execFileSync("git", ["hash-object", grantAuditScript], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      sellerProfilePredecessorGrantAuditBlob,
    );
    assert.equal(
      execFileSync("git", ["hash-object", runtimeProvisionScript], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      sellerProfilePredecessorRuntimeProvisionBlob,
    );
    assert.ok(existsSync(path.join(holding, "seller-profile-private-boundary", "provision-order-staff-read-role.sql")));
    assert.ok(existsSync(path.join(holding, "seller-profile-private-boundary", "audit-runtime-db-grants.mjs")));
    assert.ok(existsSync(path.join(holding, "seller-profile-private-boundary", "provision-runtime-db-role.sql")));
    assert.equal(existsSync(path.join(root, `prisma/migrations/${enableMigration}`)), false);
    assert.equal(existsSync(path.join(root, `prisma/migrations/${forceMigration}`)), false);
    execFileSync("bash", ["-c", bashBody("Restore User policyless ENABLE source package")], { cwd: root, env: scriptEnv });
    assert.equal(existsSync(path.join(root, `prisma/migrations/${forceMigration}`)), false);
    execFileSync(process.execPath, ["--test", "tests/db-grant-inventory.test.mjs"], {
      cwd: root,
      env: { PATH: process.env.PATH },
      stdio: "pipe",
    });
    execFileSync("bash", ["-c", bashBody("Restore User policyless FORCE source package")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore SellerProfile private-boundary migration after all predecessors")], { cwd: root, env: scriptEnv });
    assert.equal(existsSync(path.join(root, postRetirementRepairPath)), false);
    execFileSync("bash", ["-c", bashBody("Restore post-retirement account-deletion repair after all predecessors")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore blocked-checkout refund witness after immutable refund repair")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore SupportRequest candidate after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore StockNotification preparation after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore Favorite source packages after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore Follow source packages after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore ReviewVote preparation after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore MakerVerification candidates after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore SavedBlogPost RLS candidate after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore email delivery-ledger preparation after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore email provider/account-deletion fence after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore email provider/eligibility fence after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore email outbox contract correction after historical release guards")], { cwd: root, env: scriptEnv });
    execFileSync("bash", ["-c", bashBody("Restore email eligibility lock-order correction after historical release guards")], { cwd: root, env: scriptEnv });
    for (const [index, relative] of trackedPaths.entries()) {
      if (relative !== catalogPath) assert.equal(hash(relative), original[index], relative);
    }
    assert.equal(
      execFileSync("git", ["hash-object", catalogPath], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      "ac17d95ad53501515550b2bb967eb5a149f094d9",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(path.join(holding, "user-staff-admin-labels", "user-authority-catalog-test"))).digest("hex"),
      original[catalogIndex],
    );
    assert.equal(
      execFileSync("git", ["hash-object", path.join(holding, "user-follower-authority", "user-authority-catalog-test")], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      historicalStaffCatalogBlob,
    );
    assert.match(readFileSync(path.join(root, staffScript), "utf8"), /grainline_user_staff_directory_page/);
    const restored = deriveGrantInventory(root);
    assert.ok(heldFunctions.every((name) => restored.functions.includes(name)));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
