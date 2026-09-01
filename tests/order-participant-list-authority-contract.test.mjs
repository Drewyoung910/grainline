import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260831233000_prepare_order_participant_list_authority/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const authority = readFileSync("src/lib/orderParticipantReadAuthority.ts", "utf8");
const record = readFileSync("docs/order-participant-list-authority.md", "utf8");

const identities = [
  "grainline_order_buyer_count",
  "grainline_order_buyer_page",
  "grainline_order_seller_count",
  "grainline_order_seller_page",
];

describe("Order participant list authority contract", () => {
  it("keeps the preparation additive and fixed-scope", () => {
    for (const name of identities) {
      assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}\\(`), name);
    }
    assert.equal((migration.match(/^SECURITY DEFINER$/gm) ?? []).length, 4);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 4);
    assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 4);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 4);
    assert.doesNotMatch(migration, /EXECUTE\s+format|ALTER TABLE|CREATE POLICY|DROP POLICY/i);
    assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/i);
  });

  it("binds buyer and durable seller authority in PostgreSQL", () => {
    assert.match(migration, /source_order\."buyerId" = p_actor_user_id/g);
    assert.match(migration, /seller\."userId" = p_actor_user_id/g);
    assert.match(migration, /seller\.id = source_order\."sellerProfileId"/g);
    assert.doesNotMatch(migration, /JOIN public\."Listing"/);
    assert.doesNotMatch(migration, /JOIN public\."OrderItem"/);
  });

  it("uses bounded stable keyset cursors and UTC timestamp boundaries", () => {
    assert.match(migration, /p_limit NOT BETWEEN 1 AND 100/g);
    assert.match(migration, /\(source_order\."createdAt", source_order\.id\) </g);
    assert.match(migration, /AT TIME ZONE 'UTC'/g);
    assert.doesNotMatch(migration, /OFFSET|p_sort|p_where/i);
  });

  it("routes application calls through named projections and validates results", () => {
    for (const name of identities) assert.match(authority, new RegExp(name), name);
    assert.match(authority, /normalizeDbUserContextUserId/g);
    assert.match(authority, /buyerOrderListPageFromRows/);
    assert.match(authority, /sellerOrderListPageFromRows/);
  });

  it("records honest release and threat boundaries", () => {
    assert.match(record, /has not been merged or\s+applied/);
    assert.match(record, /Order` RLS remains off/);
    assert.match(record, /does not cryptographically authenticate a\s+Clerk session inside PostgreSQL/);
    assert.match(record, /Application pages are not switched/);
    assert.match(record, /not a readiness claim/);
  });
});
