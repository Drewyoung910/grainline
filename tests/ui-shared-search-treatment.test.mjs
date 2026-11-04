import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

describe("shared search treatment", () => {
  it("gives blog search the same deliberate field and full-row result treatment", () => {
    const blog = source("src/components/BlogSearchBar.tsx");
    assert.match(blog, /rounded-full border border-\[#2C1F1A\]\/20 bg-white/);
    assert.match(blog, /rounded-lg bg-white\/95 p-1\.5/);
    assert.match(blog, /w-full rounded-md px-3 py-2 text-left/);
    assert.doesNotMatch(blog, /focus-within:ring-2 focus-within:ring-neutral-900\/10/);
  });
});
