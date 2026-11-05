import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

for (const path of ["src/app/api/support/route.ts", "src/app/api/legal/data-request/route.ts"]) {
  test(`${path}: pressing Reply on the intake email reaches the requester`, async () => {
    const state = { sent: [] };
    const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
    const dependencies = {
      "@clerk/nextjs/server": { auth: async () => ({ userId: null }) },
      "@/lib/email": {
        sendRenderedEmail: async (email, options) => state.sent.push({ email, options }),
      },
      "@/lib/ratelimit": {
        getIP: () => "203.0.113.1",
        safeRateLimit: async () => ({ success: true, reset: 0 }),
        rateLimitResponse: () => new Response(null, { status: 429 }),
      },
      "@/lib/requestBody": {
        readBoundedJson: async () => ({}),
        isRequestBodyTooLargeError: () => false,
        isInvalidJsonBodyError: () => false,
      },
      "@/lib/supportRequest": {
        normalizeSupportRequest: () => ({
          ok: true,
          request: { kind: "support", topic: "order", email: "alice@example.com", message: "Help" },
        }),
        supportRequestHtml: () => "<p>Help</p>",
        supportRequestRecipient: () => "support@thegrainline.com",
        supportRequestSubject: () => "Request",
      },
      "@/lib/supportRequestAccess": {
        submitSupportRequest: async () => ({ id: "request", slaDueAt: new Date(0), emailDeliveryToken: "token" }),
        recordSupportRequestDelivery: async () => true,
      },
      "@/lib/privateResponse": {
        privateJson: (json, init) => Response.json(json, init),
        privateResponse: (response) => response,
      },
      "@/lib/httpStatus": { HTTP_STATUS },
      "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    };
    const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    vm.runInNewContext(javascript, {
      exports, Response, Date, console,
      require: (name) => dependencies[name] ?? stub(),
    }, { filename: path });
    const response = await exports.POST(new Request("https://example.test/x", { method: "POST", body: "{}" }));
    assert.equal(response.status, HTTP_STATUS.ACCEPTED);
    assert.equal(state.sent[0].options.replyTo, "alice@example.com");
  });
}
