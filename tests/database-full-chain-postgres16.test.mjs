import assert from "node:assert/strict";
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
import { proveSellerProfileBlockFollowCleanup } from "../tools/database-full-chain/scenarios/seller-profile-block-follow-cleanup.mjs";
import { proveSellerProfileFoundingMakerGrant } from "../tools/database-full-chain/scenarios/seller-profile-founding-maker-grant.mjs";
import { proveSellerProfileMetricsIdentity } from "../tools/database-full-chain/scenarios/seller-profile-metrics-identity.mjs";
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
    }
  },
);
