import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as messageBodies from "../src/lib/messageBodies.ts";

function renderThread(meId, canCreateCustomListings = true) {
  const { outputText } = ts.transpileModule(readFileSync("src/components/ThreadMessages.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  const stub = () => null;
  const modules = {
    react: React,
    "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
    "@/lib/messageBodies": messageBodies,
  };
  const loaded = { exports: {} };
  new Function("module", "exports", "require", outputText)(loaded, loaded.exports, (name) =>
    modules[name] ?? new Proxy({ __esModule: true }, { get: (target, key) => target[key] ?? stub }));
  return renderToStaticMarkup(React.createElement(loaded.exports.default, {
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
