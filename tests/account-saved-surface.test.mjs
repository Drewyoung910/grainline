import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const accountPage = readFileSync(
  new URL("../src/app/account/page.tsx", import.meta.url),
  "utf8",
);

describe("account saved items surface", () => {
  it("keeps the horizontal row transparent while retaining white card details", () => {
    assert.match(accountPage, /<ul className="flex gap-4 overflow-x-auto pb-0">/);
    assert.match(accountPage, /<div className="p-2 bg-white border-t border-neutral-100">/);
  });
});
