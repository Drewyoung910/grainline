import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("blog dashboard action guardrails", () => {
  it("blocks suspended or deleted accounts inside blog server actions", () => {
    for (const path of [
      "src/app/dashboard/blog/new/page.tsx",
      "src/app/dashboard/blog/[id]/edit/page.tsx",
      "src/app/dashboard/blog/page.tsx",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /banned:\s*true/,
        `${path} must select account banned state inside the action/page`,
      );
      assert.match(
        text,
        /deletedAt:\s*true/,
        `${path} must select account deletion state inside the action/page`,
      );
      assert.match(
        text,
        /banned\s*\|\|\s*[^;\n]*deletedAt/,
        `${path} must block suspended or deleted accounts`,
      );
    }
  });

  it("captures follower notification failures instead of silently swallowing them", () => {
    for (const [path, sourceTag] of [
      ["src/app/dashboard/blog/new/page.tsx", "blog_create_follower_notification"],
      ["src/app/dashboard/blog/[id]/edit/page.tsx", "blog_update_follower_notification"],
    ]) {
      const text = source(path);
      assert.match(text, /Sentry\.captureException/);
      assert.match(text, new RegExp(`source: "${sourceTag}"`));
      assert.doesNotMatch(text, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    }
  });
});
