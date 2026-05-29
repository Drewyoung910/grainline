import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("launch readiness follow-ups", () => {
  it("keeps privacy export copy aligned with the implemented account export and legal-request flow", () => {
    const privacy = source("src/app/privacy/page.tsx");

    assert.match(privacy, /automated\s+account\s+export/);
    assert.match(privacy, /privacy request process/);
    assert.doesNotMatch(privacy, /Data export requests are processed manually and\s+fulfilled within 30 days/);
    assert.doesNotMatch(privacy, /We will respond within 30 days \(or within the timeframe required by applicable law\)/);
  });

  it("discloses audit-log identifier retention for deleted administrator accounts", () => {
    const privacy = source("src/app/privacy/page.tsx");

    assert.match(privacy, /Administrative action logs/);
    assert.match(privacy, /administrator account is later deleted/);
    assert.match(privacy, /internal administrator\s+identifier/);
    assert.match(privacy, /moderation, trust and safety, legal, and undo records remain\s+auditable/);
    assert.match(privacy, /profile and contact metadata is anonymized or redacted/);
  });

  it("discloses moderation and trust-and-safety record retention without promising a fixed purge job", () => {
    const privacy = source("src/app/privacy/page.tsx");

    assert.match(privacy, /Moderation and trust-and-safety records/);
    assert.match(privacy, /User reports, block records,\s+report-resolution notes/);
    assert.match(privacy, /safety, fraud-prevention, legal, and marketplace-integrity purposes/);
    assert.match(privacy, /Account deletion\s+removes or anonymizes personal data/);
    assert.doesNotMatch(privacy, /Moderation records: kept for 3 years/);
  });

  it("documents the crawler-facing sitemap index and env-backed Search Console verification", () => {
    const layout = source("src/app/layout.tsx");
    const envExample = source(".env.example");
    const docs = source("CLAUDE.md");

    assert.match(layout, /verification:\s*\{/);
    assert.match(layout, /NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION/);
    assert.match(envExample, /NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION/);
    assert.match(source("src/app/robots.txt/route.ts"), /Sitemap: https:\/\/thegrainline\.com\/sitemap_index\.xml/);
    assert.match(docs, /https:\/\/thegrainline\.com\/sitemap_index\.xml/);
    assert.doesNotMatch(docs, /submit `https:\/\/thegrainline\.com\/sitemap\.xml`/);
  });
});
