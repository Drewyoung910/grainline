import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as money from "../src/lib/money.ts";
import * as paymentPresentation from "../src/lib/orderPaymentPresentation.ts";
import { orderTotalCents } from "../src/lib/orderTotals.ts";

// Renders the real JSX/logic slices of the buyer order pages (#1256, #1257,
// #1260) so the displayed status, receipt and case guidance are exercised,
// not just matched as source text.

const ACCOUNT_PAGE = "src/app/account/page.tsx";
const ACCOUNT_ORDERS_PAGE = "src/app/account/orders/page.tsx";
const BUYER_ORDER_PAGE = "src/app/dashboard/orders/[id]/page.tsx";
const ORDER_TIMELINE = "src/components/OrderTimeline.tsx";

function parse(path) {
  const text = readFileSync(path, "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function smallest(sf, predicate, label) {
  let best = null;
  const visit = (node) => {
    if (predicate(node) && (!best || node.getWidth(sf) < best.getWidth(sf))) best = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(best, `${label} is absent`);
  return best.getText(sf);
}

function compile(code) {
  return ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function run(code, scope) {
  const names = Object.keys(scope);
  return new Function("React", ...names, `${compile(code)}; return __result;`)(
    React,
    ...names.map((name) => scope[name]),
  );
}

const Link = ({ href, className, children }) =>
  React.createElement("a", { href, className }, children);
const LocalDate = ({ date }) =>
  React.createElement("time", null, new Date(date).toISOString().slice(0, 10));
const fmtMoney = (cents, currency = money.DEFAULT_CURRENCY) =>
  money.formatCurrencyCents(cents, currency);

function summaryOrder(overrides = {}) {
  return {
    id: "order_1",
    createdAt: new Date("2026-10-01T12:00:00Z"),
    paidAt: new Date("2026-10-01T12:00:00Z"),
    currency: "usd",
    itemsSubtotalCents: 9000,
    shippingTitle: null,
    shippingAmountCents: 1000,
    taxAmountCents: 0,
    giftWrappingPriceCents: null,
    sellerRefundAmountCents: null,
    fulfillmentStatus: "PENDING",
    labelCarrier: null,
    labelTrackingNumber: null,
    itemCount: 1,
    items: [{
      id: "item_1",
      listingId: "listing_1",
      priceCents: 9000,
      quantity: 1,
      title: "Walnut tray",
      imageUrl: null,
      sellerName: "Maker",
    }],
    ...overrides,
  };
}

function orderRowRenderer(path) {
  const sf = parse(path);
  const formatStatus = smallest(
    sf,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "formatStatus",
    "formatStatus",
  );
  const statusColor = smallest(
    sf,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "statusColor",
    "statusColor",
  );
  const row = smallest(
    sf,
    (node) => ts.isArrowFunction(node) && node.getText(sf).includes("formatStatus(order.fulfillmentStatus)"),
    "order row renderer",
  );
  return (order) => renderToStaticMarkup(run(
    `${formatStatus}\n${statusColor}\nconst __result = (${row})(__order);`,
    {
      __order: order,
      Link,
      LocalDate,
      publicListingPath: (id) => `/listing/${id}`,
      refundOutcomes: new Map(),
      orderTotalCents,
      formatCurrencyCents: money.formatCurrencyCents,
      ...paymentPresentation,
    },
  ));
}

function statusBadge(html) {
  const match = html.match(/<span class="[^"]*rounded-full[^"]*">([^<]+)<\/span>/);
  assert.ok(match, "status badge is absent");
  return match[1];
}

describe("My Account recent-order status (#1256)", () => {
  const myAccountRow = orderRowRenderer(ACCOUNT_PAGE);
  const accountOrdersRow = orderRowRenderer(ACCOUNT_ORDERS_PAGE);

  it("labels a fully refunded, unfulfilled order as refunded instead of Processing", () => {
    const html = myAccountRow(summaryOrder({ sellerRefundAmountCents: 10000 }));
    assert.equal(statusBadge(html), "Fully refunded");
    assert.doesNotMatch(html, /Processing/);
  });

  it("matches /account/orders for every refund and fulfillment combination it can see", () => {
    const fixtures = [
      summaryOrder(),
      summaryOrder({ sellerRefundAmountCents: 10000 }),
      summaryOrder({ sellerRefundAmountCents: 2500 }),
      summaryOrder({ sellerRefundAmountCents: 10000, fulfillmentStatus: "SHIPPED" }),
      summaryOrder({ sellerRefundAmountCents: 10000, fulfillmentStatus: "DELIVERED" }),
      summaryOrder({ sellerRefundAmountCents: 10000, fulfillmentStatus: "PICKED_UP" }),
      summaryOrder({ sellerRefundAmountCents: 10000, fulfillmentStatus: "READY_FOR_PICKUP" }),
      summaryOrder({ fulfillmentStatus: "SHIPPED" }),
    ];
    for (const order of fixtures) {
      assert.equal(
        statusBadge(myAccountRow(order)),
        statusBadge(accountOrdersRow(order)),
        `${order.fulfillmentStatus} / refund ${order.sellerRefundAmountCents}`,
      );
    }
  });
});

describe("My Account long email wrapping (#1260)", () => {
  it("lets every rendered email wrap inside a shrinkable column", () => {
    const sf = parse(ACCOUNT_PAGE);
    const emailElements = [];
    const visit = (node) => {
      if (ts.isJsxElement(node) && node.children.some(
        (child) => ts.isJsxExpression(child) && child.expression?.getText(sf) === "me.email",
      )) {
        emailElements.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    assert.equal(emailElements.length, 2);
    for (const element of emailElements) {
      assert.match(element.openingElement.getText(sf), /className="[^"]*\bbreak-all\b/);
    }
    const header = smallest(
      sf,
      (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "div"
        && node.getText(sf).includes("My Account</h1>"),
      "account header text column",
    );
    assert.match(header, /^<div className="[^"]*\bmin-w-0\b/);
  });
});

describe("buyer order detail refund presentation (#1257)", () => {
  const sf = parse(BUYER_ORDER_PAGE);
  const receiptSummary = smallest(
    sf,
    (node) => ts.isJsxElement(node) && node.getText(sf).includes("Items subtotal")
      && node.getText(sf).includes("Net total"),
    "receipt summary",
  );
  const renderReceipt = (refundPending) => renderToStaticMarkup(run(
    `const __result = (${receiptSummary});`,
    {
      fmtMoney,
      itemsSubtotal: 9000,
      order: { shippingTitle: null, shippingCarrier: null, shippingService: null },
      shipping: 1000,
      tax: 0,
      giftWrapping: 0,
      hasRefund: true,
      refundCents: 4000,
      currency: "usd",
      total: 10000,
      refundPending,
    },
  ));

  it("shows a provider-pending refund as pending without reducing the total", () => {
    const html = renderReceipt(true);
    assert.match(html, /Refund pending/);
    assert.doesNotMatch(html, /Refund issued/);
    assert.doesNotMatch(html, /Net total/);
    assert.doesNotMatch(html, /\$60\.00/);
    assert.match(html, />Total<\/div><div class="font-semibold">\$100\.00</);
  });

  it("shows a completed refund in the site's refund red with the net total", () => {
    const html = renderReceipt(false);
    assert.match(html, /<div class="flex items-center justify-between text-red-600"><div>Refund issued/);
    assert.match(html, /−\$40\.00/);
    assert.match(html, /Net total<\/div><div class="font-semibold">\$60\.00/);
    assert.doesNotMatch(html, /text-green-700/);
  });

  it("does not promise a case after delivery once the order has a refund", () => {
    const guidance = smallest(
      sf,
      (node) => ts.isConditionalExpression(node) && node.getText(sf).includes("You can open a case")
        && node.getText(sf).includes("contact the maker directly"),
      "case guidance",
    );
    const renderGuidance = (hasRefund) => renderToStaticMarkup(run(
      `const __result = (${guidance});`,
      {
        deliveryInFuture: true,
        hasRefund,
        messageHref: "/messages/convo_1",
        order: { estimatedDeliveryDate: new Date("2026-11-20T12:00:00Z") },
        Link,
        LocalDate,
      },
    ));
    const refunded = renderGuidance(true);
    assert.doesNotMatch(refunded, /You can open a case/);
    assert.match(refunded, /contact the maker directly via messages/);
    assert.match(renderGuidance(false), /You can open a case/);
  });
});

describe("order timeline processing window wording (#1257)", () => {
  const compiled = ts.transpileModule(readFileSync(ORDER_TIMELINE, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const timelineModule = { exports: {} };
  new Function("require", "module", "exports", "React", compiled)(
    (specifier) => {
      assert.equal(specifier, "@/lib/money");
      return money;
    },
    timelineModule,
    timelineModule.exports,
    React,
  );
  const OrderTimeline = timelineModule.exports.default;
  const render = (fulfillmentMethod) => renderToStaticMarkup(React.createElement(OrderTimeline, {
    placedAt: new Date("2026-10-01T12:00:00Z"),
    fulfillmentMethod,
    fulfillmentStatus: "PENDING",
    processingTimeMinDays: 3,
    processingTimeMaxDays: 5,
  }));

  it("uses pickup wording for pickup orders", () => {
    const html = render("PICKUP");
    assert.match(html, /Ready for pickup in 3-5 days/);
    assert.doesNotMatch(html, /Ships/);
  });

  it("keeps shipping wording for shipped orders", () => {
    assert.match(render("SHIPPING"), /Ships in 3-5 days/);
  });
});
