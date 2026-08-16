import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  sellerPayoutEventApplyFromRows,
  sellerPayoutExportRowsFromRows,
  sellerPayoutLatestFailureFromRows,
} from "../src/lib/sellerPayoutEventState.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("SellerPayoutEvent application authority", () => {
  it("parses every exact writer result and rejects malformed authority output", () => {
    for (const action of [
      "inserted",
      "updated",
      "already_applied",
      "legacy_converged",
      "stale_ignored",
    ]) {
      assert.deepEqual(
        sellerPayoutEventApplyFromRows([{
          action,
          payout_event_id: "payout-event-1",
          seller_user_id: "user-1",
        }]),
        {
          action,
          payoutEventId: "payout-event-1",
          sellerUserId: "user-1",
        },
      );
    }
    assert.deepEqual(
      sellerPayoutEventApplyFromRows([{
        action: "ignored_unknown_account",
        payout_event_id: null,
        seller_user_id: null,
      }]),
      {
        action: "ignored_unknown_account",
        payoutEventId: null,
        sellerUserId: null,
      },
    );
    assert.throws(() => sellerPayoutEventApplyFromRows([]), /row count/);
    assert.throws(
      () => sellerPayoutEventApplyFromRows([{
        action: "inserted",
        payout_event_id: null,
        seller_user_id: "user-1",
      }]),
      /incomplete/,
    );
    assert.throws(
      () => sellerPayoutEventApplyFromRows([{
        action: "ignored_unknown_account",
        payout_event_id: "forged",
        seller_user_id: null,
      }]),
      /ignored result/,
    );
    assert.throws(
      () => sellerPayoutEventApplyFromRows([{
        action: "unexpected",
        payout_event_id: "payout-event-1",
        seller_user_id: "user-1",
      }]),
      /invalid apply action/,
    );
  });

  it("parses the bounded latest projection and event-time timestamp", () => {
    assert.equal(sellerPayoutLatestFailureFromRows([]), null);
    const row = sellerPayoutLatestFailureFromRows([{
      payout_event_id: "payout-event-1",
      event_created_seconds: 1_700_000_000n,
      failure_message: "Bank account closed",
      amount_cents: 100,
      currency: "usd",
    }]);
    assert.equal(row?.id, "payout-event-1");
    assert.equal(row?.createdAt.toISOString(), "2023-11-14T22:13:20.000Z");
    assert.equal(row?.amountCents, 100);
    assert.throws(
      () => sellerPayoutLatestFailureFromRows([{
        payout_event_id: "payout-event-1",
        event_created_seconds: 0,
        failure_message: null,
        amount_cents: null,
        currency: "USD",
      }]),
      /event time/,
    );
  });

  it("parses only bounded complete seller export rows", () => {
    const rows = sellerPayoutExportRowsFromRows([{
      payout_event_id: "payout-event-1",
      seller_profile_id: "seller-1",
      stripe_payout_id: "po_1",
      status: "failed",
      amount_cents: null,
      currency: "usd",
      failure_code: null,
      failure_message: null,
      stripe_event_id: "evt_1",
      event_created_seconds: "1700000000",
      created_at: new Date("2023-11-14T22:13:20.000Z"),
      updated_at: new Date("2023-11-14T22:13:20.000Z"),
    }]);
    assert.equal(rows[0]?.eventCreatedSeconds, 1_700_000_000);
    assert.equal(rows[0]?.status, "failed");
    assert.throws(
      () => sellerPayoutExportRowsFromRows(Array.from({ length: 501 }, () => ({}))),
      /oversized/,
    );
    assert.throws(
      () => sellerPayoutExportRowsFromRows([{ ...rows[0], status: "paid" }]),
      /invalid status/,
    );
  });

  it("removes all direct application table access and binds each consumer", () => {
    const authority = source("src/lib/sellerPayoutEventAuthority.ts");
    const handler = source("src/lib/stripePayoutWebhook.ts");
    const connect = source("src/app/api/stripe/webhook/connect/route.ts");
    const platform = source("src/app/api/stripe/webhook/route.ts");
    const dashboard = source("src/app/dashboard/seller/page.tsx");
    const accountExport = source("src/app/api/account/export/route.ts");

    assert.match(authority, /grainline_seller_payout_event_apply/);
    assert.match(authority, /grainline_seller_payout_latest_failure/);
    assert.match(authority, /grainline_seller_payout_export_page/);
    assert.match(connect, /processStripePayoutFailedEvent\(event, claimGeneration\)/);
    assert.match(platform, /processStripePayoutFailedEvent\(event, claimGeneration\)/);
    assert.match(handler, /eventCreatedSeconds: BigInt\(event\.created\)/);
    assert.match(handler, /result\.action === "ignored_unknown_account"/);
    assert.match(handler, /result\.action === "stale_ignored"/);
    assert.match(handler, /sourceId: result\.payoutEventId/);
    assert.match(dashboard, /latestSellerPayoutFailure\(me\.id\)/);
    assert.match(accountExport, /exportSellerPayoutEvents\(user\.id\)/);

    for (const applicationSource of [handler, dashboard, accountExport]) {
      assert.doesNotMatch(applicationSource, /prisma\.sellerPayoutEvent/);
    }
  });
});
