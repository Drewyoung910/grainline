import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public security configuration guardrails", () => {
  it("keeps browser source maps disabled in production config", () => {
    const config = source("next.config.ts");

    assert.match(config, /productionBrowserSourceMaps:\s*false/);
  });

  it("keeps sensitive signed-in routes disallowed in robots.txt", () => {
    const route = source("src/app/robots.txt/route.ts");

    for (const path of ["/dashboard", "/admin", "/account", "/messages", "/cart", "/checkout", "/api"]) {
      assert.match(route, new RegExp(`Disallow: ${path.replace("/", "\\/")}`));
    }
  });

  it("keeps private founder inbox details out of tracked agent docs", () => {
    const docs = source("CLAUDE.md");

    assert.doesNotMatch(docs, /drewyoung910@gmail\.com/);
    assert.doesNotMatch(docs, /258 Roehl Rd/);
  });
});
