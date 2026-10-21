import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { listingDeleteDisposition } = await import("../src/lib/listingDeleteState.ts");

function references(overrides = {}) {
  return {
    hasOrderItems: false,
    hasReviews: false,
    hasConversations: false,
    hasMessages: false,
    hasCheckoutReservations: false,
    ...overrides,
  };
}

describe("listing delete lifecycle", () => {
  it("hard-deletes only listings with no retained buyer or conversation history", () => {
    assert.equal(listingDeleteDisposition(null, references()), "delete");
    assert.equal(listingDeleteDisposition("conversation_1", references()), "archive");
    assert.equal(listingDeleteDisposition(null, references({ hasOrderItems: true })), "archive");
    assert.equal(listingDeleteDisposition(null, references({ hasReviews: true })), "archive");
    assert.equal(listingDeleteDisposition(null, references({ hasConversations: true })), "archive");
    assert.equal(listingDeleteDisposition(null, references({ hasMessages: true })), "archive");
    assert.equal(
      listingDeleteDisposition(null, references({ hasCheckoutReservations: true })),
      "blocked_checkout",
    );
  });

  it("keeps the decision and mutation in one serializable transaction and uses the media cleanup ledger", () => {
    const source = readFileSync("src/lib/listingDelete.ts", "utf8");
    const uploadMigration = readFileSync(
      "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql",
      "utf8",
    );

    assert.match(source, /FOR UPDATE OF listing/);
    assert.match(source, /TransactionIsolationLevel\.Serializable/);
    assert.match(source, /sellerOwnerCore\(normalizedActorUserId\)/);
    assert.match(source, /listing\."sellerId" = \$\{owner\.sellerProfileId\}/);
    assert.doesNotMatch(source, /JOIN public\."SellerProfile"/);
    assert.match(source, /grainline_listing_delete_reference_state/);
    assert.match(source, /while a buyer checkout is in progress/);
    assert.doesNotMatch(source, /FROM public\."OrderItem"/);
    assert.match(source, /syncListingDirectUploadReferences/);
    assert.match(source, /requireAllTracked: true/);
    assert.match(source, /tx\.photo\.deleteMany/);
    assert.match(source, /tx\.listing\.deleteMany/);
    assert.match(uploadMigration, /grainline_direct_upload_release_listing_delete/);
    assert.match(uploadMigration, /BEFORE DELETE ON public\."Listing"/);
  });

  it("classifies protected retained-history tables through an owner-bound authority", () => {
    const migration = readFileSync(
      "prisma/migrations/20261013040000_add_listing_archived_at/migration.sql",
      "utf8",
    );

    assert.match(migration, /CREATE FUNCTION public\.grainline_listing_delete_reference_state/);
    assert.match(migration, /SECURITY DEFINER/);
    assert.match(migration, /SET search_path = pg_catalog/);
    assert.match(migration, /seller\."userId" = p_actor_user_id/);
    assert.match(migration, /FROM public\."OrderItem"/);
    assert.match(migration, /FROM public\."Review"/);
    assert.match(migration, /FROM public\."Conversation"/);
    assert.match(migration, /FROM public\."Message"/);
    assert.match(migration, /FROM public\."CheckoutStockReservation"/);
    assert.match(migration, /reservation\.status IN \('RESERVED', 'SESSION_CREATED'\)/);
    assert.match(migration, /reservation\."sourceSnapshot"#>>'\{item,listing,id\}'/);
    assert.match(migration, /reservation\."sourceSnapshot"->'items'/);
    assert.match(migration, /source_item\.value#>>'\{listing,id\}'/);
    assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);

    const orderCatalog = readFileSync("scripts/order-child-authority-catalog.mjs", "utf8");
    const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
    assert.match(orderCatalog, /"grainline_listing_delete_reference_state"/);
    assert.match(provision, /grainline_listing_delete_reference_state/);
  });

  it("uses an explicit archive marker and excludes archived rows from both seller lists", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20261013040000_add_listing_archived_at/migration.sql",
      "utf8",
    );
    const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
    const shop = readFileSync("src/app/seller/[id]/shop/page.tsx", "utf8");

    assert.match(schema, /archivedAt\s+DateTime\?/);
    assert.match(migration, /ADD COLUMN "archivedAt" TIMESTAMP\(3\)/);
    assert.match(migration, /status = 'HIDDEN'[\s\S]*"isPrivate" = true/);
    assert.match(migration, /audit\.action = 'HOLD_LISTING'[\s\S]*NOT audit\.undone/);
    assert.match(dashboard, /where: \{ sellerId: seller\.id, archivedAt: null \}/);
    assert.match(shop, /\{ sellerId, archivedAt: null,/);
  });

  it("enforces archivedAt in stale edit locks and every listing-detail visibility path", () => {
    const stockMutation = readFileSync("src/lib/listingStockMutation.ts", "utf8");
    const visibility = readFileSync("src/lib/listingVisibility.ts", "utf8");
    const listingPage = readFileSync("src/app/listing/[id]/page.tsx", "utf8");

    assert.match(stockMutation, /SELECT[\s\S]*"archivedAt"[\s\S]*FOR UPDATE/);
    assert.match(visibility, /if \(listing\.archivedAt\) return false/);
    assert.match(visibility, /archivedAt: null/);
    assert.match(listingPage, /archivedAt: true/);
  });

  it("isolates the additive migration from historical release guards and restores it for PostgreSQL proof", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    assert.match(workflow, /Verify seller listing Hide\/Delete source package/);
    assert.match(
      workflow,
      /Isolate seller listing lifecycle migration from historical release guards[\s\S]*mv \\\s+prisma\/migrations\/20261013040000_add_listing_archived_at/,
    );
    assert.match(
      workflow,
      /Isolate seller listing lifecycle migration from historical release guards[\s\S]*ORDER_CHILD_CATALOG_LISTING_MIGRATION_ISOLATED=true/,
    );
    assert.match(
      workflow,
      /Restore seller listing Hide\/Delete source package[\s\S]*prisma\/migrations\/20261013040000_add_listing_archived_at/,
    );
    assert.match(
      workflow,
      /Re-verify seller listing Hide\/Delete source package[\s\S]*tests\/listing-hide-delete-production-workflow\.test\.mjs[\s\S]*tests\/db-grant-inventory\.test\.mjs[\s\S]*Apply seller listing Hide\/Delete compatibility migration in disposable PostgreSQL/,
    );
    assert.match(
      workflow,
      /Apply seller listing Hide\/Delete compatibility migration in disposable PostgreSQL[\s\S]*20261013040000_add_listing_archived_at\/migration\.sql/,
    );
    assert.match(workflow, /Verify seller listing Hide\/Delete catalog/);
  });
});
