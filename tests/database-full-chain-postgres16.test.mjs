import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  assertDisposablePostgres16Target,
  createPostgres16Adapter,
} from "../tools/database-full-chain/postgres16/adapter.mjs";
import { createCiRoleScriptCallbacks } from "../tools/database-full-chain/scenarios/ci-role-scripts.mjs";
import {
  applyFullMigrationChain,
  findRepositoryRoot,
  listMigrationArtifacts,
} from "../tools/database-full-chain/scenarios/migration-chain.mjs";
import {
  assertSellerProfilePrivateLayout,
  seedSellerProfilePrivateFixture,
} from "../tools/database-full-chain/scenarios/seller-profile-private-fixture.mjs";
import {
  proveImmutableRefundRepair,
  proveOrderRefund648Inventory,
} from "../tools/database-full-chain/scenarios/order-refund-immutable-event.mjs";
import { proveBlockedPairPaidCheckoutCompletion } from "../tools/database-full-chain/scenarios/paid-checkout-block-race.mjs";
import { proveBlockedCheckoutRefundRecovery } from "../tools/database-full-chain/scenarios/blocked-checkout-refund-recovery.mjs";
import {
  proveCaseRefundRecoveryFindings,
  seedHistoricalAmbiguousMarkerDamage,
} from "../tools/database-full-chain/scenarios/case-refund-recovery.mjs";
import {
  proveDisputeFirstEventCaseCorrection,
  seedDisputeFirstEventPredecessorGap,
} from "../tools/database-full-chain/scenarios/dispute-first-event-case.mjs";
import { proveSellerProfilePublicMapAuthority } from "../tools/database-full-chain/scenarios/seller-profile-public-map.mjs";
import { proveSellerProfilePublicProfileAuthority } from "../tools/database-full-chain/scenarios/seller-profile-public-profile.mjs";
import { proveSellerProfilePublicFavoriteTarget } from "../tools/database-full-chain/scenarios/seller-profile-public-favorite-target.mjs";
import { proveSellerProfilePublicReviewVoteTarget } from "../tools/database-full-chain/scenarios/seller-profile-public-review-vote-target.mjs";
import { proveSellerProfileReportResourceTarget } from "../tools/database-full-chain/scenarios/seller-profile-report-resource-target.mjs";
import { proveSellerProfileParticipantConversationListingTarget } from "../tools/database-full-chain/scenarios/seller-profile-participant-conversation-listing-target.mjs";
import { proveSellerProfileConversationContextListing } from "../tools/database-full-chain/scenarios/seller-profile-conversation-context-listing.mjs";
import { proveSellerProfilePublicFollowerListingTarget } from "../tools/database-full-chain/scenarios/seller-profile-public-follower-listing-target.mjs";
import { proveSellerProfilePublicListingCards } from "../tools/database-full-chain/scenarios/seller-profile-public-listing-cards.mjs";
import { proveSellerProfilePublicBlogAuthorSitemap } from "../tools/database-full-chain/scenarios/seller-profile-public-blog-author-sitemap.mjs";
import { proveSellerProfileOwnerFollowExport } from "../tools/database-full-chain/scenarios/seller-profile-owner-follow-export.mjs";
import { proveSellerProfilePublicRecentlyViewedListings } from "../tools/database-full-chain/scenarios/seller-profile-public-recently-viewed-listings.mjs";
import { proveSellerProfileOwnerReviewReply } from "../tools/database-full-chain/scenarios/seller-profile-owner-review-reply.mjs";
import { proveSellerProfilePublicCommissionInterestAuthority } from "../tools/database-full-chain/scenarios/seller-profile-public-commission-interest.mjs";
import { proveSellerProfileOwnerGuildApplicationAuthority } from "../tools/database-full-chain/scenarios/seller-profile-owner-guild-application.mjs";
import { proveSellerProfileOwnerBootstrapAuthority } from "../tools/database-full-chain/scenarios/seller-profile-owner-bootstrap.mjs";
import { proveSellerProfileStaffReportTargetsAuthority } from "../tools/database-full-chain/scenarios/seller-profile-staff-report-targets.mjs";
import { proveSellerProfileStaffBroadcastTargets } from "../tools/database-full-chain/scenarios/seller-profile-staff-broadcast-targets.mjs";
import { proveSellerProfileStaffVerificationTarget } from "../tools/database-full-chain/scenarios/seller-profile-staff-verification-target.mjs";
import { proveSellerProfileStaffFeatureTransition } from "../tools/database-full-chain/scenarios/seller-profile-staff-feature-transition.mjs";
import { proveSellerProfileAccountDeletionMediaAuthority } from "../tools/database-full-chain/scenarios/seller-profile-account-deletion-media.mjs";
import { proveSellerProfileOwnerFeaturedListingToggle } from "../tools/database-full-chain/scenarios/seller-profile-owner-featured-listing-toggle.mjs";
import { proveSellerProfileOwnerAuxiliaryUpdates } from "../tools/database-full-chain/scenarios/seller-profile-owner-auxiliary-updates.mjs";
import { proveSellerProfileOwnerOnboardingState } from "../tools/database-full-chain/scenarios/seller-profile-owner-onboarding-state.mjs";
import { proveSellerProfileOwnerDashboardStates } from "../tools/database-full-chain/scenarios/seller-profile-owner-dashboard-states.mjs";
import { proveSellerProfileOwnerProfileEditor } from "../tools/database-full-chain/scenarios/seller-profile-owner-profile-editor.mjs";
import { proveSellerProfileSavedListingAuthority } from "../tools/database-full-chain/scenarios/seller-profile-saved-listing.mjs";
import { proveSellerProfileSavedBlogPostAuthority } from "../tools/database-full-chain/scenarios/seller-profile-saved-blog-post.mjs";
import { proveSellerProfileBlockFollowCleanup } from "../tools/database-full-chain/scenarios/seller-profile-block-follow-cleanup.mjs";
import { proveSellerProfileFoundingMakerGrant } from "../tools/database-full-chain/scenarios/seller-profile-founding-maker-grant.mjs";
import { proveSellerProfileMetricsIdentity } from "../tools/database-full-chain/scenarios/seller-profile-metrics-identity.mjs";
import { proveSellerProfileServiceIdentities } from "../tools/database-full-chain/scenarios/seller-profile-service-identities.mjs";
import { proveSellerProfileRetainedAuthorityGaps } from "../tools/database-full-chain/scenarios/seller-profile-retained-authority-gaps.mjs";
import { proveSellerProfilePolicylessEnable } from "../tools/database-full-chain/scenarios/seller-profile-enable.mjs";
import { inspectSellerProfilePublicPreparationProduction } from "../scripts/seller-profile-public-preparation-production-inspect.mjs";
import {
  SELLER_PROFILE_PUBLIC_ENABLE,
  SELLER_PROFILE_PUBLIC_PREPARATIONS,
} from "../scripts/seller-profile-public-preparation-manifest.mjs";
import { CASE_REFUND_FOLLOWUP_MIGRATION } from "../scripts/build-case-refund-followup-correction.mjs";
import { DISPUTE_FIRST_EVENT_CASE_MIGRATION } from "../scripts/build-dispute-first-event-case-correction.mjs";

const proofDatabaseUrl = process.env.DATABASE_FULL_CHAIN_PROOF_DATABASE_URL;

test(
  "builds the complete migrated schema on PostgreSQL 16 before seeding current seller-private data",
  {
    skip: proofDatabaseUrl ? false : "DATABASE_FULL_CHAIN_PROOF_DATABASE_URL is not set",
    timeout: 120_000,
  },
  async () => {
    const client = new pg.Client({ connectionString: proofDatabaseUrl });
    const preparationEvidenceDirectory = mkdtempSync(
      join(tmpdir(), "seller-profile-public-preparation-full-chain-"),
    );
    await client.connect();
    try {
      const identity = (await client.query(`
        SELECT current_user,
               current_database(),
               current_setting('server_version') AS server_version
      `)).rows[0];
      assert.equal(identity.current_user, "ci");
      assert.equal(identity.current_database, "grainline_ci");
      assertDisposablePostgres16Target(proofDatabaseUrl, identity.server_version);

      const repositoryRoot = findRepositoryRoot();
      const adapter = createPostgres16Adapter(client);
      const roles = createCiRoleScriptCallbacks();
      let fixture;
      let historicalCaseRefundDamage;
      let historicalDisputeFirstEventGap;
      const summary = await applyFullMigrationChain({
        adapter,
        repositoryRoot,
        engine: "postgres16",
        bootstrapRoles: roles.bootstrapRoles,
        convergeRoles: roles.convergeRoles,
        beforeMigration: async ({ artifact }) => {
          if (artifact.name === SELLER_PROFILE_PUBLIC_PREPARATIONS[0].name) {
            const evidence = await inspectSellerProfilePublicPreparationProduction({
              DIRECT_URL: proofDatabaseUrl,
              SELLER_PROFILE_PREPARATION_EXPECTED_STATE: "ready",
              SELLER_PROFILE_PREPARATION_EVIDENCE_PATH: join(
                preparationEvidenceDirectory,
                "ready.json",
              ),
              SELLER_PROFILE_PREPARATION_RELEASE_COMMIT: "a".repeat(40),
            });
            assert.equal(evidence.state, "ready");
            assert.equal(evidence.pendingCount, 64);
          }
          if (artifact.name === SELLER_PROFILE_PUBLIC_ENABLE.name) {
            const evidence = await inspectSellerProfilePublicPreparationProduction({
              DIRECT_URL: proofDatabaseUrl,
              SELLER_PROFILE_PREPARATION_EXPECTED_STATE: "prepared",
              SELLER_PROFILE_PREPARATION_EVIDENCE_PATH: join(
                preparationEvidenceDirectory,
                "prepared.json",
              ),
              SELLER_PROFILE_PREPARATION_RELEASE_COMMIT: "a".repeat(40),
            });
            assert.equal(evidence.state, "prepared");
            assert.equal(evidence.pendingCount, 0);
          }
          if (artifact.name === CASE_REFUND_FOLLOWUP_MIGRATION) {
            fixture = await seedSellerProfilePrivateFixture(adapter);
            historicalCaseRefundDamage =
              await seedHistoricalAmbiguousMarkerDamage({
                database: adapter,
                seller: fixture,
                scenarioNamespace: "migration_chain",
              });
          }
          if (artifact.name === DISPUTE_FIRST_EVENT_CASE_MIGRATION) {
            assert.ok(fixture, "seller fixture must exist before #662 predecessor proof");
            historicalDisputeFirstEventGap =
              await seedDisputeFirstEventPredecessorGap({
                database: adapter,
                seller: fixture,
                scenarioNamespace: "migration_chain",
              });
          }
        },
        onProgress: ({ index, total, name, retried }) => {
          if (index === total || index % 50 === 0 || retried) {
            process.stderr.write(
              `[database-full-chain] ${index}/${total} ${name}${retried ? " (retried after role convergence)" : ""}\n`,
            );
          }
        },
      });

      const artifacts = listMigrationArtifacts(repositoryRoot);
      assert.equal(summary.applied.length, artifacts.length);
      assert.deepEqual(summary.applied, artifacts.map(({ name }) => name));
      assert.equal(summary.applied.at(-1), artifacts.at(-1).name);
      assert.deepEqual(
        summary.roleConvergenceRetries.map(({ migration }) => migration),
        [
          "20260801194000_enable_direct_upload_rls",
          "20260927090000_enable_order_rls",
        ],
      );

      await assertSellerProfilePrivateLayout(adapter);
      await proveSellerProfilePolicylessEnable({ database: adapter });
      assert.ok(fixture, "seller fixture must be seeded before Case follow-up");
      assert.ok(
        historicalCaseRefundDamage,
        "#710 damage must be seeded by the predecessor before Case follow-up",
      );
      const seller = (await adapter.query(
        `SELECT seller.id,
                seller."stripeAccountSupported" AS supported,
                seller_private."stripeAccountId" AS stripe_account_id,
                seller_private."shipFromPhone" AS ship_from_phone
           FROM public."SellerProfile" AS seller
           JOIN public."SellerProfilePrivate" AS seller_private
             ON seller_private."sellerProfileId" = seller.id
          WHERE seller."userId" = $1`,
        [fixture.userId],
      )).rows;
      assert.deepEqual(seller, [{
        id: fixture.sellerProfileId,
        supported: true,
        stripe_account_id: fixture.stripeAccountId,
        ship_from_phone: "+15125550100",
      }]);
      await proveSellerProfilePublicMapAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicProfileAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicFavoriteTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicReviewVoteTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileReportResourceTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileParticipantConversationListingTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileConversationContextListing({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicFollowerListingTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicListingCards({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicBlogAuthorSitemap({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerFollowExport({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicRecentlyViewedListings({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerReviewReply({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerGuildApplicationAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerBootstrapAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileStaffReportTargetsAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileStaffBroadcastTargets({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileStaffVerificationTarget({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileStaffFeatureTransition({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileAccountDeletionMediaAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerFeaturedListingToggle({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerAuxiliaryUpdates({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerOnboardingState({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerDashboardStates({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileOwnerProfileEditor({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileSavedListingAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileSavedBlogPostAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicCommissionInterestAuthority({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileBlockFollowCleanup({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileFoundingMakerGrant({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileMetricsIdentity({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileServiceIdentities({
        database: adapter,
        seller: fixture,
      });
      const retainedAuthorityFixture = await seedSellerProfilePrivateFixture(adapter, {
        suffix: "retained_authority_gaps",
      });
      await proveSellerProfileRetainedAuthorityGaps({
        database: adapter,
        seller: retainedAuthorityFixture,
      });
      await proveImmutableRefundRepair({
        database: adapter,
        repositoryRoot,
        seller: fixture,
      });
      await proveOrderRefund648Inventory({
        database: adapter,
        repositoryRoot,
      });
      await proveBlockedPairPaidCheckoutCompletion({
        database: adapter,
        seller: fixture,
      });
      await proveBlockedCheckoutRefundRecovery({
        database: adapter,
        repositoryRoot,
        seller: fixture,
      });
      await proveCaseRefundRecoveryFindings({
        database: adapter,
        seller: fixture,
        historicalDamage: historicalCaseRefundDamage,
        requireHistoricalDamage: true,
        expectDisputeFirstEventCase: true,
        scenarioNamespace: "migration_chain",
      });
      assert.ok(
        historicalDisputeFirstEventGap,
        "#662 predecessor gap must be seeded before its correction migration",
      );
      await proveDisputeFirstEventCaseCorrection({
        database: adapter,
        seller: fixture,
        historicalGap: historicalDisputeFirstEventGap,
        scenarioNamespace: "migration_chain",
      });
    } finally {
      await client.end();
      rmSync(preparationEvidenceDirectory, { recursive: true, force: true });
    }
  },
);
