import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("security disclosure surface", () => {
  it("publishes RFC 9116 security.txt metadata", () => {
    const route = source("src/app/.well-known/security.txt/route.ts");

    assert.match(route, /Contact: mailto:security@thegrainline\.com/);
    assert.match(route, /Policy: https:\/\/thegrainline\.com\/security/);
    assert.match(route, /Preferred-Languages: en/);
    assert.match(route, /Expires: \$\{SECURITY_TXT_EXPIRES\}/);
    assert.match(route, /Canonical: https:\/\/thegrainline\.com\/\.well-known\/security\.txt/);
    assert.match(route, /Content-Type": "text\/plain; charset=utf-8"/);
    assert.match(route, /Cache-Control": "public, max-age=3600"/);
  });

  it("keeps the human security policy public and canonical", () => {
    const page = source("src/app/security/page.tsx");

    assert.match(page, /title: "Security \| Grainline"/);
    assert.match(page, /canonical: "https:\/\/thegrainline\.com\/security"/);
    assert.match(page, /security@thegrainline\.com/);
    assert.match(page, /Safe testing guidelines/);
    assert.match(page, /We do not currently operate a paid bug bounty program/);
    assert.match(page, /\/\.well-known\/security\.txt/);
  });

  it("keeps disclosure routes reachable through middleware gates", () => {
    const middleware = source("src/middleware.ts");

    assert.match(middleware, /"\/security"/);
    assert.match(middleware, /"\/\.well-known\/security\.txt"/);
    assert.match(middleware, /pathname === "\/security"/);
    assert.match(middleware, /pathname === "\/\.well-known\/security\.txt"/);
  });

  it("documents the launch-time mailbox verification requirement", () => {
    assert.match(source("docs/launch-checklist.md"), /security@thegrainline\.com` mailbox routing verified/);
    assert.match(source("docs/security-hardening-plan.md"), /Keep `security@thegrainline\.com` mailbox routing verified before launch/);
    assert.match(source("CLAUDE.md"), /public vulnerability disclosure page and RFC 9116 metadata/);
  });
});
