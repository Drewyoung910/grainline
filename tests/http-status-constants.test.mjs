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
      ["FORBIDDEN", 403],
      ["PAYLOAD_TOO_LARGE", 413],
      ["TOO_MANY_REQUESTS", 429],
      ["INTERNAL_SERVER_ERROR", 500],
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
});
