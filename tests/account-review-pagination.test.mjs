import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account review pagination guardrails", () => {
  it("keeps the private review-history page bounded and deterministic", () => {
    const page = source("src/app/account/reviews/page.tsx");

    assert.match(page, /const PAGE_SIZE = 20/);
    assert.match(page, /searchParams: Promise<\{ page\?: string \}>/);
    assert.match(page, /parseBoundedPositiveIntParam\(pageParam, 1, 1000\)/);
    assert.match(page, /prisma\.review\.count\(\{ where: \{ reviewerId: me\.id \} \}\)/);
    assert.match(page, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(page, /skip: \(page - 1\) \* PAGE_SIZE/);
    assert.match(page, /take: PAGE_SIZE/);
    assert.match(page, /\/account\/reviews\?page=\$\{page - 1\}/);
    assert.match(page, /\/account\/reviews\?page=\$\{page \+ 1\}/);
  });
});
