import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql",
);
const authority = source("src/lib/orderAccountDeletionAuthority.ts");
const deletion = source("src/lib/accountDeletion.ts");

describe("Order account-deletion authority", () => {
  it("binds both operations to the transaction-local actor and durable Order keys", () => {
    assert.match(migration, /current_setting\('app\.user_id', true\)/);
    assert.match(migration, /statement_timestamp\(\) AT TIME ZONE 'UTC'/);
    assert.doesNotMatch(migration, /p_now|epoch_millis|to_timestamp/);
    assert.match(migration, /session_actor_user_id IS DISTINCT FROM p_actor_user_id/);
    assert.match(migration, /source_order\."buyerId" = p_actor_user_id/);
    assert.match(migration, /source_order\."sellerProfileId" = source_seller_profile_id/);
    assert.doesNotMatch(migration, /JOIN public\."(?:OrderItem|Listing)"/);
    assert.match(migration, /FOR UPDATE OF actor/);
    assert.match(migration, /obligations changed after the initial check/);
  });

  it("uses the provider-signed charged total and exact pending-refund sentinel", () => {
    const refundState = source("src/lib/refundLockState.ts");
    assert.match(refundState, /REFUND_LOCK_SENTINEL = "pending"/);
    assert.match(migration, /"sellerRefundId" <> 'pending'/);
    assert.doesNotMatch(migration, /__REFUND_PENDING__/);
    assert.match(
      migration,
      /COALESCE\(\s*source_order\."chargedTotalCents",\s*COALESCE\(source_order\."itemsSubtotalCents", 0\)/s,
    );
  });

  it("keeps the migration additive and the fixed surface least-privileged", () => {
    assert.doesNotMatch(migration, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY/i);
    assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]{0,100}ON TABLE/i);
    assert.doesNotMatch(migration, /UPDATE public\."Order"[\s\S]*BEFORE|DELETE FROM public\."OrderShippingRateQuote"[\s\S]*BEFORE/i);
    for (const identity of [
      "grainline_order_account_deletion_blockers(text)",
      "grainline_order_account_deletion_scrub(text, text[])",
    ]) {
      const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${escaped}\\s+FROM PUBLIC`, "s"));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${escaped}\\s+TO grainline_app_runtime`, "s"));
    }
  });

  it("bounds caller-supplied redaction values and derives current sensitive values", () => {
    assert.match(authority, /values\.length > 128/);
    assert.match(authority, /value\.length < 1 \|\| value\.length > 2048/);
    assert.match(migration, /COALESCE\(pg_catalog\.array_length\(p_additional_sensitive_values, 1\), 0\) > 128/);
    assert.match(migration, /locked_actor\."clerkId"/);
    assert.match(migration, /locked_actor\."shippingLine1"/);
    assert.match(migration, /source_seller\."shipFromLine1"/);
    assert.match(migration, /grainline_account_deletion_redact_text_core/);
  });

  it("moves Order-family deletion work behind the fixed transaction client", () => {
    assert.match(deletion, /getOrderAccountDeletionBlockerCounts\([\s\S]*tx,/);
    assert.match(deletion, /scrubOrderDataForAccountDeletion\([\s\S]*tx,/);
    assert.match(deletion, /getAccountDeletionBlockersInTransaction\(\s*tx,\s*user\.id/);
    assert.ok(
      deletion.indexOf("getAccountDeletionBlockersInTransaction(\n      tx,\n      user.id,\n      now")
        < deletion.indexOf("scrubOrderDataForAccountDeletion("),
    );
    assert.doesNotMatch(deletion, /(?:prisma|tx)\.order\./);
    assert.doesNotMatch(deletion, /(?:prisma|tx)\.orderItem\./);
    assert.doesNotMatch(deletion, /(?:prisma|tx)\.orderShippingRateQuote\./);
    assert.doesNotMatch(deletion, /FROM\s+(?:public\.)?"(?:Order|OrderItem|OrderShippingRateQuote)"/);
    assert.match(
      deletion,
      /isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/,
    );
  });

  it("does not hide a default client or accept malformed database results", () => {
    assert.match(authority, /type OrderAccountDeletionClient = Pick<Prisma\.TransactionClient, "\$queryRaw">/);
    assert.doesNotMatch(authority, /import \{ prisma \}/);
    assert.match(authority, /rows\.length !== 1/);
    assert.match(authority, /Number\.isSafeInteger\(result\) \|\| result < 0/);
    assert.match(authority, /normalizeDbUserContextUserId/);
  });
});
