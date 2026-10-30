import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  assertDisposablePostgresTarget,
  createPostgresAdapter,
} from "../tools/database-full-chain/postgres/adapter.mjs";
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
import { proveSellerProfileActorReviewListingTarget } from "../tools/database-full-chain/scenarios/seller-profile-actor-review-listing-target.mjs";
import { proveSellerProfileReportResourceTarget } from "../tools/database-full-chain/scenarios/seller-profile-report-resource-target.mjs";
import { proveSellerProfileParticipantConversationListingTarget } from "../tools/database-full-chain/scenarios/seller-profile-participant-conversation-listing-target.mjs";
import { proveSellerProfileConversationContextListing } from "../tools/database-full-chain/scenarios/seller-profile-conversation-context-listing.mjs";
import { proveSellerProfilePublicFollowerListingTarget } from "../tools/database-full-chain/scenarios/seller-profile-public-follower-listing-target.mjs";
import { proveSellerProfilePublicListingCards } from "../tools/database-full-chain/scenarios/seller-profile-public-listing-cards.mjs";
import { proveSellerProfileListingDetailAuthorities } from "../tools/database-full-chain/scenarios/seller-profile-listing-detail-authorities.mjs";
import { proveSellerProfileSimilarListingCandidates } from "../tools/database-full-chain/scenarios/seller-profile-similar-listing-candidates.mjs";
import { proveSellerProfileQualityScoreAuthorities } from "../tools/database-full-chain/scenarios/seller-profile-quality-score-authorities.mjs";
import { proveSellerProfilePublicVisibilityMirrors } from "../tools/database-full-chain/scenarios/seller-profile-public-visibility-mirrors.mjs";
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
import { proveSellerProfileStaffListingReviewTransition } from "../tools/database-full-chain/scenarios/seller-profile-staff-listing-review-transition.mjs";
import { proveSellerProfileTransactionStates } from "../tools/database-full-chain/scenarios/seller-profile-transaction-states.mjs";
import { proveSellerProfileAccountDeletionMediaAuthority } from "../tools/database-full-chain/scenarios/seller-profile-account-deletion-media.mjs";
import { proveSellerProfileOwnerFeaturedListingToggle } from "../tools/database-full-chain/scenarios/seller-profile-owner-featured-listing-toggle.mjs";
import { proveSellerProfileOwnerAuxiliaryUpdates } from "../tools/database-full-chain/scenarios/seller-profile-owner-auxiliary-updates.mjs";
import { proveSellerProfileOwnerOnboardingState } from "../tools/database-full-chain/scenarios/seller-profile-owner-onboarding-state.mjs";
import { proveSellerProfileOwnerDashboardStates } from "../tools/database-full-chain/scenarios/seller-profile-owner-dashboard-states.mjs";
import { proveSellerProfileOwnerProfileEditor } from "../tools/database-full-chain/scenarios/seller-profile-owner-profile-editor.mjs";
import { proveSellerProfileSavedListingAuthority } from "../tools/database-full-chain/scenarios/seller-profile-saved-listing.mjs";
import {
  proveSellerProfileSavedBlogPostAuthority,
  proveSellerProfileSavedBlogPostRollback,
} from "../tools/database-full-chain/scenarios/seller-profile-saved-blog-post.mjs";
import { proveSellerProfileBlockFollowCleanup } from "../tools/database-full-chain/scenarios/seller-profile-block-follow-cleanup.mjs";
import { proveSellerProfileFoundingMakerGrant } from "../tools/database-full-chain/scenarios/seller-profile-founding-maker-grant.mjs";
import { proveSellerProfileMetricsIdentity } from "../tools/database-full-chain/scenarios/seller-profile-metrics-identity.mjs";
import { proveSellerProfileServiceIdentities } from "../tools/database-full-chain/scenarios/seller-profile-service-identities.mjs";
import { proveSellerProfileRetainedAuthorityGaps } from "../tools/database-full-chain/scenarios/seller-profile-retained-authority-gaps.mjs";
import { proveSellerProfilePolicylessEnable } from "../tools/database-full-chain/scenarios/seller-profile-enable.mjs";
import { proveSupportRequestAuthorities } from "../tools/database-full-chain/scenarios/support-request-authorities.mjs";
import {
  EMAIL_SUPPRESSION_RECOVERY_MIGRATION,
  proveHistoricalResendFailureSuppressionRepair,
  proveStoredResendSuppressionOrdering,
  seedHistoricalResendFailureSuppressions,
} from "../tools/database-full-chain/scenarios/email-suppression-recovery.mjs";
import {
  CART_CARTITEM_RLS_MIGRATION,
  proveCartCartItemPredecessorExposure,
  proveCartCartItemRlsAuthorities,
  seedCartCartItemPredecessorFixture,
} from "../tools/database-full-chain/scenarios/cart-cartitem-rls.mjs";
import { proveEmailServiceDeliveryLedger } from
  "../tools/database-full-chain/scenarios/email-service-delivery-ledger.mjs";
import {
  EMAIL_PROVIDER_DELETION_FENCE_MIGRATION,
  prepareHistoricalEmailProviderDeletionFenceUpgrade,
  proveEmailProviderDeletionFence,
  seedHistoricalEmailProviderDeletionFenceRows,
} from "../tools/database-full-chain/scenarios/email-provider-deletion-fence.mjs";
import { proveEmailProviderEligibilityFence } from
  "../tools/database-full-chain/scenarios/email-provider-eligibility-fence.mjs";
import {
  STOCK_NOTIFICATION_PREPARATION_MIGRATION,
  STOCK_NOTIFICATION_RLS_MIGRATION,
  proveStockNotificationPredecessorBlockGap,
  proveStockNotificationPreparedAuthorities,
  proveStockNotificationRlsAuthorities,
  proveStockNotificationRlsRollback,
  seedStockNotificationPredecessorFixture,
} from "../tools/database-full-chain/scenarios/stock-notification-authorities.mjs";
import {
  BLOCK_PREPARATION_MIGRATION,
  proveBlockPreparedAuthorities,
} from
  "../tools/database-full-chain/scenarios/block-authorities.mjs";
import { inspectSellerProfilePublicPreparationProduction } from "../scripts/seller-profile-public-preparation-production-inspect.mjs";
import { inspectOwnerTableRlsActivationProduction } from "../scripts/owner-table-rls-activation-production-inspect.mjs";
import { inspectPrivateTablePreparationProduction } from "../scripts/private-table-preparation-production-inspect.mjs";
import {
  SELLER_PROFILE_PUBLIC_ENABLE,
  SELLER_PROFILE_PUBLIC_PREPARATIONS,
} from "../scripts/seller-profile-public-preparation-manifest.mjs";
import { SELLER_PROFILE_FORCE } from
  "../scripts/seller-profile-force-production-inspect.mjs";
import { CASE_REFUND_FOLLOWUP_MIGRATION } from "../scripts/build-case-refund-followup-correction.mjs";
import { DISPUTE_FIRST_EVENT_CASE_MIGRATION } from "../scripts/build-dispute-first-event-case-correction.mjs";

const proofDatabaseUrl = process.env.DATABASE_FULL_CHAIN_PROOF_DATABASE_URL;
const expectedPostgresMajor = process.env.DATABASE_FULL_CHAIN_POSTGRES_MAJOR?.trim() || "16";

async function startEmailSuppressionAccountDeletionConcurrencyProof(connectionString) {
  const accountDeletionClient = new pg.Client({ connectionString });
  await accountDeletionClient.connect();
  try {
    await accountDeletionClient.query("BEGIN");
    await accountDeletionClient.query(
      "SET LOCAL statement_timeout = '8s'; SET LOCAL lock_timeout = '6s'; SET LOCAL deadlock_timeout = '100ms'",
    );
    await accountDeletionClient.query(
      'LOCK TABLE public."EmailFailureCount" IN ROW EXCLUSIVE MODE',
    );
  } catch (error) {
    await accountDeletionClient.query("ROLLBACK").catch(() => {});
    await accountDeletionClient.end().catch(() => {});
    throw error;
  }

  const completion = (async () => {
    try {
      let sawRecoveryWaiting = false;
      for (let poll = 0; poll < 200; poll += 1) {
        const waiting = await accountDeletionClient.query(`
          SELECT pg_catalog.count(*)::integer AS count
            FROM pg_catalog.pg_locks
           WHERE locktype = 'relation'
             AND relation = 'public."EmailFailureCount"'::regclass
             AND NOT granted
             AND pid <> pg_catalog.pg_backend_pid()
        `);
        if (Number(waiting.rows[0]?.count ?? 0) > 0) {
          sawRecoveryWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        sawRecoveryWaiting,
        true,
        "C-715 recovery never waited behind the account-deletion first lock",
      );
      await accountDeletionClient.query(
        'LOCK TABLE public."EmailSuppression" IN ROW EXCLUSIVE MODE',
      );
      await accountDeletionClient.query("COMMIT");
      return Object.freeze({
        sawRecoveryWaiting,
        accountDeletionLockOrder: Object.freeze([
          "EmailFailureCount",
          "EmailSuppression",
        ]),
      });
    } catch (error) {
      await accountDeletionClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await accountDeletionClient.end().catch(() => {});
    }
  })();

  return Object.freeze({
    outcome: completion.then(
      (evidence) => Object.freeze({ evidence, error: null }),
      (error) => Object.freeze({ evidence: null, error }),
    ),
  });
}

test(
  `builds the complete migrated schema on PostgreSQL ${expectedPostgresMajor} before seeding current seller-private data`,
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
      assertDisposablePostgresTarget(proofDatabaseUrl, identity.server_version, {
        expectedMajor: expectedPostgresMajor,
      });

      const repositoryRoot = findRepositoryRoot();
      const adapter = createPostgresAdapter(client);
      const roles = createCiRoleScriptCallbacks();
      let fixture;
      let historicalCaseRefundDamage;
      let historicalDisputeFirstEventGap;
      let historicalResendFailureSuppressions;
      let emailSuppressionConcurrencyProof;
      let emailSuppressionInterruptionProof;
      let cartCartItemFixture;
      let cartCartItemPredecessorEvidence;
      let cartCartItemReadyEvidencePath;
      let historicalEmailProviderDeletionFenceRows;
      let stockNotificationFixture;
      let stockNotificationPredecessorEvidence;
      let stockNotificationPreparationPreflightPath;
      let blockPreparationPreflightPath;
      let stockNotificationPreparationPostflightClosed = false;
      let stockNotificationActivationReadyEvidencePath;
      class DisposableOwnerClient extends pg.Client {
        constructor() {
          super({ connectionString: proofDatabaseUrl });
        }
      }
      const summary = await applyFullMigrationChain({
        adapter,
        repositoryRoot,
        engine: "postgresql",
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
            assert.equal(evidence.pendingCount, 71);
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
          if (artifact.name === SELLER_PROFILE_FORCE.name) {
            await proveSellerProfilePolicylessEnable({
              database: adapter,
              forced: false,
            });
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
          if (artifact.name === EMAIL_SUPPRESSION_RECOVERY_MIGRATION) {
            historicalResendFailureSuppressions =
              await seedHistoricalResendFailureSuppressions(adapter);
            emailSuppressionConcurrencyProof =
              await startEmailSuppressionAccountDeletionConcurrencyProof(
                proofDatabaseUrl,
              );
            await adapter.executeMigration(artifact.sql, {
              migrationName: `${artifact.name}-committed-before-ledger`,
            });
            const concurrencyOutcome = await emailSuppressionConcurrencyProof.outcome;
            if (concurrencyOutcome.error) throw concurrencyOutcome.error;
            await proveHistoricalResendFailureSuppressionRepair({
              database: adapter,
              fixture: historicalResendFailureSuppressions,
            });
            const ledgerBeforeResolve = await adapter.query(
              `SELECT pg_catalog.count(*)::integer AS count
                 FROM public."_prisma_migrations"
                WHERE migration_name = $1`,
              [EMAIL_SUPPRESSION_RECOVERY_MIGRATION],
            );
            assert.equal(Number(ledgerBeforeResolve.rows[0]?.count ?? -1), 0);
            emailSuppressionInterruptionProof = Object.freeze({
              sqlCommittedWithoutLedger: true,
              concurrency: concurrencyOutcome.evidence,
            });
          }
          if (artifact.name === CART_CARTITEM_RLS_MIGRATION) {
            assert.ok(fixture, "seller fixture must exist before Cart RLS proof");
            cartCartItemReadyEvidencePath = join(
              preparationEvidenceDirectory,
              "cart-cartitem-owner-table-ready.json",
            );
            const ready = await inspectOwnerTableRlsActivationProduction(
              {
                DIRECT_URL: proofDatabaseUrl,
                OWNER_TABLE_RLS_RELEASE_ID: "cart_cart_item_v1",
                OWNER_TABLE_RLS_PHASE: "preflight",
                OWNER_TABLE_RLS_EVIDENCE_PATH: cartCartItemReadyEvidencePath,
                PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
              },
              { Client: DisposableOwnerClient, rootDir: repositoryRoot },
            );
            assert.equal(ready.state, "ready");
            assert.equal(ready.policies.length, 0);
            assert.equal(ready.serviceFunctions.length, 0);
            cartCartItemFixture = await seedCartCartItemPredecessorFixture({
              database: adapter,
              seller: fixture,
            });
            cartCartItemPredecessorEvidence =
              await proveCartCartItemPredecessorExposure({
                database: adapter,
                fixture: cartCartItemFixture,
              });
          }
          if (artifact.name === EMAIL_PROVIDER_DELETION_FENCE_MIGRATION) {
            assert.ok(fixture, "seller fixture must exist before email fence upgrade proof");
            historicalEmailProviderDeletionFenceRows =
              await seedHistoricalEmailProviderDeletionFenceRows({
                database: adapter,
                seller: fixture,
              });
            await prepareHistoricalEmailProviderDeletionFenceUpgrade({
              database: adapter,
              migrationSql: artifact.sql,
              historical: historicalEmailProviderDeletionFenceRows,
            });
          }
          if (artifact.name === STOCK_NOTIFICATION_PREPARATION_MIGRATION) {
            assert.ok(fixture, "seller fixture must exist before StockNotification proof");
            stockNotificationPreparationPreflightPath = join(
              preparationEvidenceDirectory,
              "stock-notification-preparation-preflight.json",
            );
            const preparationPreflight = await inspectPrivateTablePreparationProduction(
              {
                DIRECT_URL: proofDatabaseUrl,
                PRIVATE_TABLE_PREPARATION_RELEASE_ID: "stock_notification_v1",
                PRIVATE_TABLE_PREPARATION_PHASE: "preflight",
                PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH:
                  stockNotificationPreparationPreflightPath,
                PRODUCTION_MIGRATION_RELEASE_COMMIT: "d".repeat(40),
              },
              { Client: DisposableOwnerClient, rootDir: repositoryRoot },
            );
            assert.equal(preparationPreflight.state, "pending");
            assert.equal(preparationPreflight.catalog.functions.length, 1);
            stockNotificationFixture = await seedStockNotificationPredecessorFixture({
              database: adapter,
              seller: fixture,
            });
            stockNotificationPredecessorEvidence =
              await proveStockNotificationPredecessorBlockGap({
                database: adapter,
                fixture: stockNotificationFixture,
              });
          }
          if (artifact.name === STOCK_NOTIFICATION_RLS_MIGRATION) {
            assert.ok(
              stockNotificationPreparationPreflightPath,
              "StockNotification preparation preflight must precede activation",
            );
            const preparationPostflight =
              await inspectPrivateTablePreparationProduction(
                {
                  DIRECT_URL: proofDatabaseUrl,
                  PRIVATE_TABLE_PREPARATION_RELEASE_ID: "stock_notification_v1",
                  PRIVATE_TABLE_PREPARATION_PHASE: "postflight",
                  PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(
                    preparationEvidenceDirectory,
                    "stock-notification-preparation-postflight.json",
                  ),
                  PRIVATE_TABLE_PREPARATION_PREVIOUS_EVIDENCE_PATH:
                    stockNotificationPreparationPreflightPath,
                  PRODUCTION_MIGRATION_RELEASE_COMMIT: "d".repeat(40),
                },
                { Client: DisposableOwnerClient, rootDir: repositoryRoot },
              );
            assert.equal(preparationPostflight.state, "applied");
            assert.equal(preparationPostflight.catalog.functions.length, 9);
            stockNotificationPreparationPostflightClosed = true;
            stockNotificationActivationReadyEvidencePath = join(
              preparationEvidenceDirectory,
              "stock-notification-activation-ready.json",
            );
            const activationReady = await inspectOwnerTableRlsActivationProduction(
              {
                DIRECT_URL: proofDatabaseUrl,
                OWNER_TABLE_RLS_RELEASE_ID: "stock_notification_v1",
                OWNER_TABLE_RLS_PHASE: "preflight",
                OWNER_TABLE_RLS_EVIDENCE_PATH:
                  stockNotificationActivationReadyEvidencePath,
                PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
              },
              { Client: DisposableOwnerClient, rootDir: repositoryRoot },
            );
            assert.equal(activationReady.state, "ready");
            assert.equal(activationReady.policies.length, 0);
            assert.equal(activationReady.retainedFunctions.length, 10);
          }
          if (artifact.name === BLOCK_PREPARATION_MIGRATION) {
            blockPreparationPreflightPath = join(
              preparationEvidenceDirectory,
              "block-preparation-preflight.json",
            );
            const preparationPreflight = await inspectPrivateTablePreparationProduction(
              {
                DIRECT_URL: proofDatabaseUrl,
                PRIVATE_TABLE_PREPARATION_RELEASE_ID: "block_v1",
                PRIVATE_TABLE_PREPARATION_PHASE: "preflight",
                PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH:
                  blockPreparationPreflightPath,
                PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
              },
              { Client: DisposableOwnerClient, rootDir: repositoryRoot },
            );
            assert.equal(preparationPreflight.state, "pending");
            assert.equal(
              preparationPreflight.catalog.functions.length,
              0,
              "all five Block functions are new and must be absent before preparation",
            );
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

      assert.ok(
        stockNotificationPreparationPreflightPath,
        "StockNotification Production preflight must run before its preparation",
      );
      assert.equal(
        stockNotificationPreparationPostflightClosed,
        true,
        "StockNotification preparation postflight must close before activation",
      );

      await assertSellerProfilePrivateLayout(adapter);
      await proveSellerProfilePolicylessEnable({
        database: adapter,
        forced: true,
      });
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
      await proveSellerProfileActorReviewListingTarget({
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
      await proveSellerProfileListingDetailAuthorities({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileSimilarListingCandidates({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileQualityScoreAuthorities({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfilePublicVisibilityMirrors({
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
      await proveSellerProfileStaffListingReviewTransition({
        database: adapter,
        seller: fixture,
      });
      await proveSellerProfileTransactionStates({
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
        connectionString: proofDatabaseUrl,
      });
      const ownerTableEvidencePath = join(
        preparationEvidenceDirectory,
        "saved-blog-post-owner-table-active.json",
      );
      const ownerTableEvidence = await inspectOwnerTableRlsActivationProduction(
        {
          DIRECT_URL: proofDatabaseUrl,
          OWNER_TABLE_RLS_RELEASE_ID: "saved_blog_post_v1",
          OWNER_TABLE_RLS_PHASE: "preflight",
          OWNER_TABLE_RLS_EVIDENCE_PATH: ownerTableEvidencePath,
          PRODUCTION_MIGRATION_RELEASE_COMMIT: "b".repeat(40),
        },
        { Client: DisposableOwnerClient, rootDir: repositoryRoot },
      );
      assert.equal(ownerTableEvidence.state, "active");
      assert.equal(ownerTableEvidence.policies.length, 3);
      assert.equal(ownerTableEvidence.guard.triggerName, "grainline_saved_blog_post_insert_guard");
      const ownerTablePostflight = await inspectOwnerTableRlsActivationProduction(
        {
          DIRECT_URL: proofDatabaseUrl,
          OWNER_TABLE_RLS_RELEASE_ID: "saved_blog_post_v1",
          OWNER_TABLE_RLS_PHASE: "postflight",
          OWNER_TABLE_RLS_EVIDENCE_PATH: join(
            preparationEvidenceDirectory,
            "saved-blog-post-owner-table-postflight.json",
          ),
          OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH: ownerTableEvidencePath,
          PRODUCTION_MIGRATION_RELEASE_COMMIT: "b".repeat(40),
        },
        { Client: DisposableOwnerClient, rootDir: repositoryRoot },
      );
      assert.equal(ownerTablePostflight.state, "active");
      assert.ok(
        cartCartItemReadyEvidencePath,
        "Cart/CartItem ready evidence must exist before activation",
      );
      const cartCartItemPostflight = await inspectOwnerTableRlsActivationProduction(
        {
          DIRECT_URL: proofDatabaseUrl,
          OWNER_TABLE_RLS_RELEASE_ID: "cart_cart_item_v1",
          OWNER_TABLE_RLS_PHASE: "postflight",
          OWNER_TABLE_RLS_EVIDENCE_PATH: join(
            preparationEvidenceDirectory,
            "cart-cartitem-owner-table-postflight.json",
          ),
          OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH: cartCartItemReadyEvidencePath,
          PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
        },
        { Client: DisposableOwnerClient, rootDir: repositoryRoot },
      );
      assert.equal(cartCartItemPostflight.state, "active");
      assert.equal(cartCartItemPostflight.policies.length, 8);
      assert.equal(cartCartItemPostflight.serviceFunctions.length, 2);
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
      await proveSupportRequestAuthorities({ database: adapter });
      assert.deepEqual(cartCartItemPredecessorEvidence, {
        crossOwnerRead: true,
        crossOwnerWrite: true,
      });
      await proveCartCartItemRlsAuthorities({
        database: adapter,
        fixture: cartCartItemFixture,
        connectionString: proofDatabaseUrl,
      });
      await proveEmailServiceDeliveryLedger({ database: adapter });
      await proveEmailProviderDeletionFence({
        database: adapter,
        connectionString: proofDatabaseUrl,
        seller: fixture,
        historical: historicalEmailProviderDeletionFenceRows,
      });
      await proveEmailProviderEligibilityFence({
        database: adapter,
        connectionString: proofDatabaseUrl,
      });
      assert.deepEqual(stockNotificationPredecessorEvidence, {
        blockedNotificationCreated: true,
      });
      assert.ok(
        stockNotificationFixture,
        "StockNotification predecessor fixture must be seeded before preparation",
      );
      await proveStockNotificationPreparedAuthorities({
        database: adapter,
        connectionString: proofDatabaseUrl,
        fixture: stockNotificationFixture,
      });
      await proveStockNotificationRlsAuthorities({
        database: adapter,
        fixture: stockNotificationFixture,
      });
      assert.ok(
        stockNotificationActivationReadyEvidencePath,
        "StockNotification activation preflight must precede activation",
      );
      const stockNotificationActivationPostflight =
        await inspectOwnerTableRlsActivationProduction(
          {
            DIRECT_URL: proofDatabaseUrl,
            OWNER_TABLE_RLS_RELEASE_ID: "stock_notification_v1",
            OWNER_TABLE_RLS_PHASE: "postflight",
            OWNER_TABLE_RLS_EVIDENCE_PATH: join(
              preparationEvidenceDirectory,
              "stock-notification-activation-postflight.json",
            ),
            OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH:
              stockNotificationActivationReadyEvidencePath,
            PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
          },
          { Client: DisposableOwnerClient, rootDir: repositoryRoot },
        );
      assert.equal(stockNotificationActivationPostflight.state, "active");
      assert.equal(stockNotificationActivationPostflight.policies.length, 2);
      assert.equal(
        stockNotificationActivationPostflight.retainedFunctions.length,
        10,
      );
      await client.query(readFileSync(
        join(
          repositoryRoot,
          "docs/rls-drafts/stock-notification-activation-rollback.sql",
        ),
        "utf8",
      ));
      await proveStockNotificationRlsRollback({
        database: adapter,
        fixture: stockNotificationFixture,
      });
      await client.query(readFileSync(
        join(
          repositoryRoot,
          `prisma/migrations/${STOCK_NOTIFICATION_RLS_MIGRATION}/migration.sql`,
        ),
        "utf8",
      ));
      await proveStockNotificationRlsAuthorities({
        database: adapter,
        fixture: stockNotificationFixture,
      });
      assert.ok(
        blockPreparationPreflightPath,
        "Block Production preflight must run before its preparation",
      );
      const blockPreparationPostflight =
        await inspectPrivateTablePreparationProduction(
          {
            DIRECT_URL: proofDatabaseUrl,
            PRIVATE_TABLE_PREPARATION_RELEASE_ID: "block_v1",
            PRIVATE_TABLE_PREPARATION_PHASE: "postflight",
            PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(
              preparationEvidenceDirectory,
              "block-preparation-postflight.json",
            ),
            PRIVATE_TABLE_PREPARATION_PREVIOUS_EVIDENCE_PATH:
              blockPreparationPreflightPath,
            PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
          },
          { Client: DisposableOwnerClient, rootDir: repositoryRoot },
        );
      assert.equal(blockPreparationPostflight.state, "applied");
      assert.equal(blockPreparationPostflight.catalog.functions.length, 5);
      await proveBlockPreparedAuthorities({ database: adapter });
      await client.query(readFileSync(
        join(repositoryRoot, "docs/rls-drafts/cart-cartitem-activation-rollback.sql"),
        "utf8",
      ));
      const rollbackState = (await client.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_catalog.pg_class
         WHERE oid IN ('public."Cart"'::regclass, 'public."CartItem"'::regclass)
         ORDER BY relname
      `)).rows;
      assert.deepEqual(rollbackState, [
        { relname: "Cart", relrowsecurity: true, relforcerowsecurity: false },
        { relname: "CartItem", relrowsecurity: true, relforcerowsecurity: false },
      ]);
      await client.query(`
        ALTER TABLE public."Cart" FORCE ROW LEVEL SECURITY;
        ALTER TABLE public."CartItem" FORCE ROW LEVEL SECURITY;
      `);
      await proveHistoricalResendFailureSuppressionRepair({
        database: adapter,
        fixture: historicalResendFailureSuppressions,
      });
      assert.ok(
        emailSuppressionInterruptionProof,
        "C-715 SQL-commit/ledger interruption proof must run before replay",
      );
      assert.deepEqual(emailSuppressionInterruptionProof, {
        sqlCommittedWithoutLedger: true,
        concurrency: {
          sawRecoveryWaiting: true,
          accountDeletionLockOrder: ["EmailFailureCount", "EmailSuppression"],
        },
      });
      const resolvedRecoveryLedger = await adapter.query(
        `SELECT checksum, finished_at, rolled_back_at, applied_steps_count
           FROM public."_prisma_migrations"
          WHERE migration_name = $1`,
        [EMAIL_SUPPRESSION_RECOVERY_MIGRATION],
      );
      assert.equal(resolvedRecoveryLedger.rows.length, 1);
      assert.equal(resolvedRecoveryLedger.rows[0].finished_at instanceof Date, true);
      assert.equal(resolvedRecoveryLedger.rows[0].rolled_back_at, null);
      assert.equal(Number(resolvedRecoveryLedger.rows[0].applied_steps_count), 1);
      assert.deepEqual(await proveStoredResendSuppressionOrdering({
        database: adapter,
      }), [
        "complaint:direct-preserved-after-generic",
        "complaint:direct-replaced-generic",
        "bounce:direct-preserved-after-generic",
        "bounce:direct-replaced-generic",
      ]);
      await proveSellerProfileSavedBlogPostRollback({
        database: adapter,
        repositoryRoot,
      });
    } finally {
      await client.end();
      rmSync(preparationEvidenceDirectory, { recursive: true, force: true });
    }
  },
);
