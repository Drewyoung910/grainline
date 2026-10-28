import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTsx(path) {
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
    if (specifier === "react-dom") return require("react-dom");
    if (specifier === "@/components/icons") return loadTsx("src/components/icons/index.tsx");
    if (specifier === "next/link") {
      return { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) };
    }
    throw new Error(`Unexpected runtime import: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled)(localRequire, compiledModule.exports, compiledModule);
  return compiledModule.exports;
}

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");

test("LocalDate server render is a readable date without raw ISO or seconds", () => {
  const LocalDate = loadTsx("src/components/LocalDate.tsx").default;
  // 7:45:12 PM Oct 12 in Chicago; Oct 13 in UTC.
  const iso = "2026-10-13T00:45:12.000Z";

  const dateTime = renderToString(React.createElement(LocalDate, { date: iso }));
  assert.doesNotMatch(text(dateTime), /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(text(dateTime), /\d:\d{2}:\d{2}/);
  assert.match(text(dateTime), /^Oct 12, 2026, 7:45\sPM$/u);
  assert.match(dateTime, /dateTime="2026-10-13T00:45:12.000Z"/);

  const dateOnly = renderToString(React.createElement(LocalDate, { date: new Date(iso), dateOnly: true }));
  assert.equal(text(dateOnly), "October 12, 2026");

  const noon = renderToString(React.createElement(LocalDate, { date: "2026-10-20T12:00:00.000Z", dateOnly: true }));
  assert.equal(text(noon), "October 20, 2026");

  assert.equal(renderToString(React.createElement(LocalDate, { date: "not a date" })), "");
});

test("DismissibleBanner keeps dismissible banners out of server HTML and uses a 44px dismiss target", () => {
  const DismissibleBanner = loadTsx("src/components/DismissibleBanner.tsx").default;

  const dismissible = renderToString(
    React.createElement(DismissibleBanner, { rejectedIds: ["listing-1"] }, "Some listings were rejected."),
  );
  assert.equal(dismissible, "");

  const forced = renderToString(React.createElement(DismissibleBanner, { rejectedIds: [] }, "Finish setup"));
  assert.match(forced, /Finish setup/);
  assert.match(forced, /<button type="button"[^>]*class="[^"]*\bh-11\b[^"]*\bw-11\b[^"]*"[^>]*aria-label="Dismiss"/);
  assert.match(forced, /<svg/);
});

test("ActionForm mounts a polite status region and renders errors as an alert after the submit buttons", () => {
  const { default: ActionForm, SubmitButton } = loadTsx("src/components/ActionForm.tsx");
  const html = renderToString(
    React.createElement(
      ActionForm,
      { action: async () => ({ ok: true }), id: "f" },
      React.createElement(SubmitButton, { name: "saveAsDraft", value: "false", pendingLabel: "Publishing…" }, "Publish"),
      React.createElement(SubmitButton, { name: "saveAsDraft", value: "true", pendingLabel: "Saving draft…" }, "Save as Draft"),
    ),
  );
  assert.match(html, /<div role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /Saving draft…|Publishing…/);

  // The error banner belongs inside the form, after the caller's buttons.
  const source = readFileSync("src/components/ActionForm.tsx", "utf8");
  assert.match(source, /\{children\}\s*\{state\?\.error && \(\s*<div\s+ref=\{errorRef\}\s+role="alert"\s+tabIndex=\{-1\}/);
  assert.match(source, /const \{ pending, data \} = useFormStatus\(\)/);
  assert.match(source, /data\.getAll\(name\)\.includes\(value \?\? ""\)/);
});

test("shared action links stay neutral instead of amber", () => {
  const MapFallback = loadTsx("src/components/MapFallback.tsx").default;
  const html = renderToString(
    React.createElement(MapFallback, { lat: 30.2672, lng: -97.7431, links: [{ href: "/seller/a", label: "Maker" }] }),
  );
  assert.doesNotMatch(html, /amber/);
  assert.doesNotMatch(html, /bg-neutral-50/);
  assert.match(html, /bg-white/);

  const expandable = readFileSync("src/components/ExpandableText.tsx", "utf8");
  assert.doesNotMatch(expandable, /text-amber-700/);
  assert.match(expandable, /aria-expanded=\{expanded\}/);
});
