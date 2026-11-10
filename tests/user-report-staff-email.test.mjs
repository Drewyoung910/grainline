import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/app/api/users/[id]/report/route.ts";

// Actual route with isolated ports.
async function report(reason, { emailFails = false } = {}) {
  const state = { reports: 0, emails: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/userReportAccess": {
      USER_REPORT_TARGET_TYPES: [
        "LISTING",
        "MESSAGE_THREAD",
        "REVIEW",
        "BLOG_COMMENT",
        "SELLER_PROFILE",
      ],
      createUserReport: async () => {
        state.reports += 1;
        return { reportId: "report" };
      },
    },
    "@/lib/ensureUser": { ensureUser: async () => ({ id: "reporter" }) },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/userRelationshipAccess": { userRelationshipTargetState: async () => ({ deletedAt: null }) },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/textLength": { codePointLength: (text) => [...text].length },
    "@/lib/sanitize": { sanitizeText: (text) => text, truncateText: (text) => text },
    "@/lib/emailBaseUrl": { EMAIL_APP_URL: "https://grainline.test" },
    "@/lib/email": {
      sendRenderedEmail: async (email) => {
        if (emailFails) throw new Error("provider down");
        state.emails.push(email);
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const response = await exports.POST(
    new Request("https://example.test/api/users/reported/report", {
      method: "POST",
      body: JSON.stringify({ reason, details: "private report details" }),
    }),
    { params: Promise.resolve({ id: "reported" }) },
  );
  return { status: response.status, ...state };
}

test("a harassment or inappropriate report emails abuse@ without its details", async () => {
  for (const reason of ["HARASSMENT", "INAPPROPRIATE"]) {
    const result = await report(reason);
    assert.equal(result.status, 200);
    assert.equal(result.reports, 1);
    assert.equal(result.emails.length, 1);
    assert.equal(result.emails[0].to, "abuse@thegrainline.com");
    assert.match(result.emails[0].html, /grainline\.test\/admin\/reports/);
    assert.doesNotMatch(result.emails[0].html, /private report details/);
  }
});

test("other reasons do not send mail", async () => {
  for (const reason of ["SPAM", "FAKE_LISTING", "OTHER"]) {
    const result = await report(reason);
    assert.equal(result.status, 200);
    assert.equal(result.emails.length, 0);
  }
});

test("a failed email does not fail the report", async () => {
  const result = await report("HARASSMENT", { emailFails: true });
  assert.equal(result.status, 200);
  assert.equal(result.reports, 1);
});
