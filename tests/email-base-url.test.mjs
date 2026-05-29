import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { resolveEmailAppUrl } = await import("../src/lib/emailBaseUrl.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("email app URL resolution", () => {
  it("uses the configured app URL after trimming trailing slashes", () => {
    assert.equal(
      resolveEmailAppUrl({
        NEXT_PUBLIC_APP_URL: " https://staging.thegrainline.example/ ",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Grainline <hello@example.com>",
      }),
      "https://staging.thegrainline.example",
    );
  });

  it("refuses live email sending without an explicit app URL", () => {
    assert.throws(
      () =>
        resolveEmailAppUrl({
          RESEND_API_KEY: "re_test",
          EMAIL_FROM: "Grainline <hello@example.com>",
          NODE_ENV: "development",
        }),
      /NEXT_PUBLIC_APP_URL env var is required when live email sending is enabled/,
    );
  });

  it("requires an explicit app URL in production and uses localhost only for non-sending local renders", () => {
    assert.throws(
      () => resolveEmailAppUrl({ NODE_ENV: "production" }),
      /NEXT_PUBLIC_APP_URL env var is required in production/,
    );
    assert.equal(resolveEmailAppUrl({ NODE_ENV: "test" }), "http://localhost:3000");
  });

  it("keeps email render paths off production fallback literals", () => {
    const email = source("src/lib/email.ts");
    const followerFanout = source("src/lib/followerListingNotifications.ts");

    assert.match(email, /import \{ EMAIL_APP_URL \} from "@\/lib\/emailBaseUrl"/);
    assert.match(followerFanout, /import \{ EMAIL_APP_URL \} from "@\/lib\/emailBaseUrl"/);
    assert.doesNotMatch(email, /NEXT_PUBLIC_APP_URL\s*\|\|\s*"https:\/\/thegrainline\.com"/);
    assert.doesNotMatch(followerFanout, /NEXT_PUBLIC_APP_URL\s*\|\|\s*"https:\/\/thegrainline\.com"/);
  });
});
