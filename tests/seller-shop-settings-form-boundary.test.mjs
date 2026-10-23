import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const page = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");
const picker = readFileSync("src/components/LocationPicker.tsx", "utf8");
const require = createRequire(import.meta.url);

function loadTsxDefault(path) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "react") return React;
    if (specifier === "react/jsx-runtime") return require("react/jsx-runtime");
    throw new Error(`Unexpected runtime import: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled)(
    localRequire,
    compiledModule.exports,
    compiledModule,
  );
  return compiledModule.exports.default;
}

test("shop settings preserve unsaved edits and pass only address defaults to the client", () => {
  assert.match(page, /<ActionForm action=\{updateSellerProfile\}[^>]*preserveOnError/u);
  assert.doesNotMatch(page, /SellerShipFromAddressFields defaults=\{currentRow/u);
  assert.match(page, /<SellerShipFromAddressFields\s+defaults=\{\{/u);
  assert.match(page, /shipFromPhone: currentRow\?\.shipFromPhone/u);
});

test("the visual map center is never submitted as an unsaved seller location", () => {
  assert.match(picker, /const \[pos, setPos\] = useState<\[number, number\] \| null>/u);
  assert.match(picker, /name="lat" value=\{pos\?\.\[0\] \?\? ""\}/u);
  assert.match(picker, /name="lng" value=\{pos\?\.\[1\] \?\? ""\}/u);
  assert.match(picker, /name="radiusMeters" value=\{pos \? meters : ""\}/u);
});

test("location search does not render a nested form inside shop settings", () => {
  const SellerLocationSearch = loadTsxDefault(
    "src/components/SellerLocationSearch.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(
      "form",
      null,
      React.createElement(SellerLocationSearch, { onSelect() {} }),
    ),
  );
  assert.equal((html.match(/<form(?:\s|>)/gu) ?? []).length, 1);
  assert.match(html, /role="search"/u);
  assert.match(html, /type="button"/u);
});
