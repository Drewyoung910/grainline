import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

const common = {
  "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
  "next/navigation": {
    notFound: () => { throw new Error("not found"); },
    redirect: (path) => { throw new Error(`redirect:${path}`); },
  },
  "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
  "@/lib/userIdentityAccess": { userIdByClerkId: async () => ({ id: "user-1" }) },
  "@/lib/sellerProfileOwnerAccess": {
    sellerOwnerCore: async () => ({ sellerProfileId: "seller-1", chargesEnabled: true }),
  },
  "@/lib/sellerOwnerPrivateAccess": {
    sellerOwnerPrivateState: async () => ({ onboardingComplete: false, manualStripeReconciliationNeeded: false }),
  },
};

async function renderSalesList(total, chargesEnabled = false) {
  const page = loadWithStubs("src/app/dashboard/sales/page.tsx", {
    ...common,
    "@/lib/sellerProfileOwnerAccess": {
      sellerOwnerCore: async () => ({ sellerProfileId: "seller-1", chargesEnabled }),
    },
    "@/lib/orderParticipantReadAuthority": {
      countSellerOrders: async () => total,
      readSellerOrderSummaryPage: async () => ({ rows: [] }),
    },
    "@/lib/orderPaymentEventReadAuthority": { sellerRefundOutcomes: async () => new Map() },
    "@/lib/orderHistoryCursor": { parseOrderHistoryCursor: () => null },
  });
  const content = page.default({ searchParams: Promise.resolve({}) }).props.children;
  return renderToStaticMarkup(await content.type(content.props));
}

test("a maker still in setup with no orders sees the setup panel", async () => {
  assert.match(await renderSalesList(0), /Connect Stripe to start accepting orders/);
});

test("a maker still in setup who has an order sees their orders, not the setup panel", async () => {
  assert.doesNotMatch(await renderSalesList(1), /Connect Stripe to start accepting orders/);
});

test("a maker who can take payments is not in setup, wizard or not", async () => {
  assert.doesNotMatch(await renderSalesList(0, true), /to start accepting orders/);
});

test("the order page does not send a maker in setup away from a real order", async () => {
  const page = loadWithStubs("src/app/dashboard/sales/[orderId]/page.tsx", {
    ...common,
    "@/lib/orderParticipantReadAuthority": { readSellerOrderDetail: async () => null },
  });
  await assert.rejects(page.default({ params: Promise.resolve({ orderId: "order-1" }), searchParams: Promise.resolve({}) }), /not found/);
});
