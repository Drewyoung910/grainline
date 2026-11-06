import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as messageBodies from "../src/lib/messageBodies.ts";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

function renderThread(meId, canCreateCustomListings = true) {
  const { default: ThreadMessages } = loadWithStubs("src/components/ThreadMessages.tsx", {
    "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
    "@/lib/messageBodies": messageBodies,
  });
  return renderToStaticMarkup(React.createElement(ThreadMessages, {
    convoId: "convo-1",
    meId,
    canCreateCustomListings,
    initial: [{
      id: "message-1",
      senderId: "maker-1",
      recipientId: "buyer-1",
      kind: "commission_interest_card",
      isSystemMessage: true,
      createdAt: "2026-11-04T00:00:00.000Z",
      body: JSON.stringify({ commissionId: "commission-1", commissionTitle: "Walnut desk", sellerName: "Oak Shop" }),
    }],
  }));
}

test("the maker in a commission thread can create the private listing the page promises", () => {
  const html = renderThread("maker-1");
  assert.match(html, /\/dashboard\/listings\/custom\?conversationId=convo-1&amp;buyerId=buyer-1/);
});

test("the buyer and a read-only viewer get no create-listing action", () => {
  assert.doesNotMatch(renderThread("buyer-1"), /\/dashboard\/listings\/custom/);
  assert.doesNotMatch(renderThread("maker-1", false), /\/dashboard\/listings\/custom/);
});
