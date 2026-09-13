import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { caseEscalationAvailable } from "../src/lib/caseActionState.ts";

function renderActualActionPanel(path, actor, ownMark, unavailable) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const panels = [];
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const text = node.getText(source);
      if (text.includes("<CaseMarkResolvedButton ") && text.includes("<CaseEscalateButton ")) panels.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const panel = panels.sort((a, b) => a.getWidth(source) - b.getWidth(source))[0];
  assert.ok(panel, "real action panel is absent");
  const activeCase = { id: "case", status: "PENDING_CLOSE",
    buyerMarkedResolved: actor === "buyer" ? ownMark : !ownMark,
    sellerMarkedResolved: actor === "seller" ? ownMark : !ownMark };
  const escalateAvailable = caseEscalationAvailable(activeCase.status, null, new Date(), unavailable);
  const compiled = ts.transpileModule(`function panel() { return (${panel.getText(source)}); }`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const html = new Function("React", "activeCase", "escalateAvailable", "waitingForBuyer",
    "CaseMarkResolvedButton", "CaseEscalateButton", `${compiled}; return panel();`)(
    React, activeCase, escalateAvailable, ownMark,
    () => React.createElement("button", { "data-mark": true }, "Mark resolved"),
    () => React.createElement("button", { "data-escalate": true }, "Escalate"),
  );
  return renderToStaticMarkup(html);
}
for (const [actor, path] of [["buyer", "src/app/dashboard/orders/[id]/page.tsx"],
  ["seller", "src/app/dashboard/sales/[orderId]/page.tsx"]]) {
  test(`${actor} real action panel preserves escalation even after own resolution mark`, () => {
    for (const ownMark of [true, false]) {
      assert.match(renderActualActionPanel(path, actor, ownMark, true), /data-escalate/);
      assert.doesNotMatch(renderActualActionPanel(path, actor, ownMark, false), /data-escalate/);
    }
    assert.doesNotMatch(renderActualActionPanel(path, actor, true, true), /data-mark/);
    assert.match(renderActualActionPanel(path, actor, false, false), /data-mark/);
  });
}
