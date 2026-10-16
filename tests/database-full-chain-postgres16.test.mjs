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
      const summary = await applyFullMigrationChain({
        adapter,
        repositoryRoot,
        engine: "postgres16",
        bootstrapRoles: roles.bootstrapRoles,
        convergeRoles: roles.convergeRoles,
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
      const fixture = await seedSellerProfilePrivateFixture(adapter);
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
      await proveImmutableRefundRepair({
        database: adapter,
        repositoryRoot,
        seller: fixture,
      });
      await proveOrderRefund648Inventory({
        database: adapter,
        repositoryRoot,
      });
    } finally {
      await client.end();
    }
  },
);
