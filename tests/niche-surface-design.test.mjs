import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

describe("niche surfaces use the shared visual contract", () => {
  it("keeps support and legal utility content on warm pages with white section cards", () => {
    for (const path of ["src/app/support/page.tsx", "src/app/legal/data-request/page.tsx"]) {
      const page = source(path);
      assert.match(page, /bg-\[#F7F5F0\]/);
      assert.match(page, /<section className="card-section px-5 py-4/);
      assert.match(page, /<h2 className="font-display /);
      assert.doesNotMatch(page, /bg-stone-50/);
    }

    assert.match(
      source("src/components/SupportRequestForm.tsx"),
      /min-h-11 items-center gap-2 rounded-md bg-neutral-900/,
    );
  });

  it("keeps error and offline actions on the six-pixel control radius", () => {
    for (const path of [
      "src/app/not-found.tsx",
      "src/app/error.tsx",
      "src/app/browse/error.tsx",
      "src/app/offline/page.tsx",
    ]) {
      const page = source(path);
      assert.doesNotMatch(page, /className="[^"]*rounded-lg[^\"]*(?:px-|py-)/);
      assert.doesNotMatch(page, /className="rounded border/);
    }
  });

  it("limits handbook display typography to second-level headings", () => {
    const handbook = source("src/app/seller-handbook/page.tsx");
    assert.match(handbook, /prose-h2:font-display/);
    assert.doesNotMatch(handbook, /prose-headings:font-display/);
  });
});
