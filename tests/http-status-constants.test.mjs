import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("HTTP status constants", () => {
  it("defines named statuses used by shared API helpers", () => {
    const helper = source("src/lib/httpStatus.ts");

    for (const [name, code] of [
      ["BAD_REQUEST", 400],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["METHOD_NOT_ALLOWED", 405],
      ["PAYLOAD_TOO_LARGE", 413],
      ["TOO_MANY_REQUESTS", 429],
      ["INTERNAL_SERVER_ERROR", 500],
      ["BAD_GATEWAY", 502],
      ["SERVICE_UNAVAILABLE", 503],
    ]) {
      assert.match(helper, new RegExp(`${name}: ${code}`));
    }
  });

  it("keeps shared request, account, and rate-limit helpers on named statuses", () => {
    for (const path of ["src/lib/requestBody.ts", "src/lib/accountAccessError.ts", "src/lib/ratelimit.ts"]) {
      const text = source(path);
      assert.ok(
        text.includes('import { HTTP_STATUS } from "@/lib/httpStatus"') ||
          text.includes('import { HTTP_STATUS } from "./httpStatus.ts"'),
        `${path} should use HTTP_STATUS`,
      );
    }

    assert.match(source("src/lib/requestBody.ts"), /readonly status = HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/lib/requestBody.ts"), /readonly status = HTTP_STATUS\.BAD_REQUEST/);
    assert.match(source("src/lib/accountAccessError.ts"), /status = HTTP_STATUS\.FORBIDDEN/);
    assert.match(source("src/lib/ratelimit.ts"), /status: HTTP_STATUS\.TOO_MANY_REQUESTS/);
  });

  it("keeps high-signal account and Stripe Connect routes on named statuses", () => {
    for (const path of [
      "src/app/api/account/delete/route.ts",
      "src/app/api/account/export/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/stripe/connect/dashboard/route.ts",
      "src/app/api/stripe/connect/login-link/route.ts",
      "src/app/api/stripe/connect/status/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (400|401|403|404|405|409|413|500|503)\b/,
        `${path} should use named statuses for local responses`,
      );
    }

    assert.match(source("src/app/api/account/export/route.ts"), /HTTP_STATUS\.METHOD_NOT_ALLOWED/);
    assert.match(source("src/app/api/account/delete/route.ts"), /HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(source("src/app/api/account/shipping-address/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/stripe/connect/create/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/stripe/connect/login-link/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/stripe/connect/dashboard/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/stripe/connect/status/route.ts"), /HTTP_STATUS\.CONFLICT/);
  });
});
