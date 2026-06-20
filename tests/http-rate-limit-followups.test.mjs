import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("HTTP rate-limit response followups", () => {
  it("uses structured retry metadata on blog search and report limiters", () => {
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    const report = source("src/app/api/users/[id]/report/route.ts");
    const stream = source("src/app/api/messages/[id]/stream/route.ts");

    assert.match(blogSearch, /rateLimitResponse/);
    assert.match(blogSearch, /return rateLimitResponse\(rl\.reset,/);
    assert.doesNotMatch(blogSearch, /status:\s*429/);

    assert.match(blogSuggestions, /rateLimitResponse/);
    assert.match(
      blogSuggestions,
      /return privateResponse\(rateLimitResponse\(rl\.reset, "Too many blog searches\."\)\)/
    );
    assert.doesNotMatch(blogSuggestions, /status:\s*429/);
    assert.match(report, /rateLimitResponse/);
    assert.match(report, /return privateResponse\(rateLimitResponse\(rl\.reset, "Too many reports\."\)\)/);
    assert.doesNotMatch(report, /status:\s*429/);

    assert.match(stream, /const \{ success, reset \} = await safeRateLimit\(messageStreamRatelimit, userId\)/);
    assert.match(stream, /return privateResponse\(rateLimitResponse\(reset, "Too many message update requests\."\)\)/);
    assert.doesNotMatch(stream, /privateJson\(\{ error: "Too many requests" \}, \{ status: 429 \}\)/);
  });

  it("keeps fire-and-forget click telemetry silent under the global limit", () => {
    const click = source("src/app/api/listings/[id]/click/route.ts");
    const view = source("src/app/api/listings/[id]/view/route.ts");
    const sellerView = source("src/app/api/seller/[id]/view/route.ts");

    for (const route of [click, view, sellerView]) {
      assert.match(route, /import \{ privateResponse \} from "@\/lib\/privateResponse"/);
      assert.match(route, /function telemetryJson\(body: Record<string, unknown>\)/);
      assert.match(route, /privateResponse\(NextResponse\.json\(body\)\)/);
    }

    assert.match(click, /if \(!success\) return telemetryJson\(\{ ok: true, skipped: true \}\)/);
    assert.match(view, /if \(!globalOk\) return telemetryJson\(\{ ok: true \}\)/);
    assert.match(sellerView, /if \(!globalOk\) return telemetryJson\(\{ ok: true, skipped: true \}\)/);
    assert.doesNotMatch(click, /status:\s*429/);
  });

  it("lets report and block UI surface retry-aware API error copy", () => {
    const button = source("src/components/BlockReportButton.tsx");

    assert.match(button, /import \{ readApiErrorMessage \} from "@\/lib\/apiError"/);
    assert.match(button, /readApiErrorMessage\(res, "Could not update block settings\."\)/);
    assert.match(button, /readApiErrorMessage\(res, "Could not submit report\."\)/);
    assert.doesNotMatch(button, /await res\.json\(\)\.catch/);
  });
});
