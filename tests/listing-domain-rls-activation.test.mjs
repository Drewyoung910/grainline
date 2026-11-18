import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  process.env.LISTING_DOMAIN_RLS_ACTIVATION_MIGRATION_PATH ??
    "prisma/migrations/20261102060000_activate_listing_domain_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/listing-domain-activation-rollback.sql",
  "utf8",
);

const TABLES = [
  "Listing",
  "Photo",
  "ListingVariantGroup",
  "ListingVariantOption",
];

const POLICIES = [
  "listing_public_select",
  "photo_public_select",
  "listing_variant_group_public_select",
  "listing_variant_option_public_select",
];

test("Listing activation is one atomic four-table public-read boundary", () => {
  assert.match(migration, /^BEGIN;/mu);
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(
    migration,
    /LOCK TABLE public\."Listing", public\."Photo", public\."ListingVariantGroup", public\."ListingVariantOption"\s+IN ACCESS EXCLUSIVE MODE/u,
  );
  for (const table of TABLES) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" FORCE ROW LEVEL SECURITY`, "u"),
    );
  }
  for (const policy of POLICIES) {
    assert.match(migration, new RegExp(`CREATE POLICY ${policy}`, "u"));
  }
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 4);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});
test("Listing activation pins active-public visibility and reservation safety", () => {
  const publicPredicate = [
    /status = 'ACTIVE'::public\."ListingStatus"/u,
    /"isPrivate" = false/u,
    /"archivedAt" IS NULL/u,
    /"sellerPubliclyOrderable" = true/u,
  ];
  for (const predicate of publicPredicate) assert.match(migration, predicate);
  assert.match(
    migration,
    /NOT constraint_state\.convalidated[\s\S]*pg_get_constraintdef[\s\S]*Listing public reservation routing preparation guard drifted/u,
  );
  assert.doesNotMatch(
    migration,
    /ADD CONSTRAINT "Listing_public_reservation_routing_chk"/u,
    "activation must validate the preparation guard instead of trying to recreate it",
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "Listing_public_reservation_routing_chk"/u,
  );
});

test("Listing activation grants only the reviewed public columns", () => {
  assert.match(
    migration,
    /GRANT SELECT \([\s\S]*"archivedAt"[\s\S]*"sellerPubliclyOrderable"[\s\S]*\) ON TABLE public\."Listing" TO grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT SELECT \("id", "listingId", "url", "altText", "sortOrder", "createdAt"\)\s+ON TABLE public\."Photo" TO grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT SELECT \("id", "listingId", "name", "sortOrder"\)\s+ON TABLE public\."ListingVariantGroup" TO grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT SELECT \("id", "groupId", "label", "priceAdjustCents", "sortOrder", "inStock"\)\s+ON TABLE public\."ListingVariantOption" TO grainline_app_runtime/u,
  );
  for (const restricted of [
    "priceVersion",
    "packagedWeightGrams",
    "reservedForUserId",
    "customOrderConversationId",
    "aiReviewFlags",
    "reviewedByAdmin",
    "rejectionReason",
    "originalUrl",
  ]) {
    assert.doesNotMatch(
      migration.match(/GRANT SELECT[\s\S]*?grainline_app_runtime/gu)?.join("\n") ?? "",
      new RegExp(`"${restricted}"`, "u"),
    );
  }
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)/iu,
  );
});

test("Listing rollback restores predecessor CRUD without changing schema", () => {
  for (const table of TABLES) {
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" NO FORCE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" DISABLE ROW LEVEL SECURITY`, "u"),
    );
  }
  for (const policy of POLICIES) {
    assert.match(rollback, new RegExp(`DROP POLICY ${policy}`, "u"));
  }
  assert.match(
    rollback,
    /DROP CONSTRAINT "Listing_public_reservation_routing_chk"[\s\S]*ADD CONSTRAINT "Listing_public_reservation_routing_chk"[\s\S]*NOT VALID/u,
  );
  assert.match(
    rollback,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO grainline_app_runtime/u,
  );
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});
