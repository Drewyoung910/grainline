import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/app/api/newsletter/route.ts";

// The real route with its ports stubbed. Nothing here exercises the database.
function fixture({ addressLimitOk = true } = {}) {
  const state = { sent: [], reads: 0, limited: [], reservations: [] };
  const limiters = { ip: "ip", address: "address" };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const NextResponse = {
    json: (body, init) => Response.json(body, init),
  };
  const dependencies = {
    zod: require("zod"),
    "next/server": { NextResponse, NextRequest: Request },
    "@/lib/db": {
      prisma: {
        newsletterSubscriber: {
          findUnique: async () => {
            state.reads += 1;
            return null;
          },
          create: async () => ({}),
        },
      },
    },
    "@/lib/email": {
      sendNewsletterConfirmationEmail: async (input) => state.sent.push(input),
    },
    "@/lib/ratelimit": {
      getIP: () => "203.0.113.1",
      newsletterRatelimit: limiters.ip,
      newsletterAddressRatelimit: limiters.address,
      rateLimitResponse: () => new Response(null, { status: 429 }),
      safeRateLimit: async (limiter, key) => {
        state.limited.push([limiter, key]);
        return { success: limiter === limiters.address ? addressLimitOk : true, reset: 0 };
      },
    },
    "@/lib/emailSuppression": {
      normalizeEmailAddress: (email) => email,
      normalizeEmailSuppressionAddress: (email) => email.replace("+tag", ""),
    },
    "@/lib/emailServiceAccess": {
      reserveNewsletterSignup: async (_client, input) => {
        state.reservations.push(input);
        return "reserved";
      },
      releaseNewsletterSignup: async () => "released",
    },
    "@/lib/newsletterConfirmation": {
      buildNewsletterConfirmationUrl: () => "https://example.test/confirm",
      canSendNewsletterConfirmation: () => true,
      createNewsletterConfirmationToken: () => "token",
      hashNewsletterConfirmationToken: () => "hash",
      NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS: 1,
      newsletterConfirmationExpiresAt: () => new Date(0),
    },
    "@/lib/sanitize": { sanitizeUserName: (name) => name },
    "@/lib/privacyTelemetry": { hashEmailForTelemetry: () => "hash" },
    "@/lib/serverErrorLogger": { logServerError: () => {} },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: (error) => error instanceof SyntaxError,
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, SyntaxError, Date, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    post: (email) => exports.POST(new Request("https://example.test/api/newsletter", {
      method: "POST",
      body: JSON.stringify({ email }),
    })),
  };
}

test("a control character in the address is a 400, not a database error", async () => {
  const subject = fixture();
  const response = await subject.post("victim\u0000@example.com");
  assert.equal(response.status, 400);
  assert.equal(subject.state.reads, 0);
});

test("the per-address daily cap stops the mail and keeps the same answer", async () => {
  const subject = fixture({ addressLimitOk: false });
  const response = await subject.post("victim+tag@example.com");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { subscribed: true, confirmationRequired: true });
  assert.equal(subject.state.sent.length, 0);
  // Gmail-style aliases share one budget.
  assert.deepEqual(subject.state.limited.at(-1), ["address", "victim@example.com"]);
});

test("an address under the cap still gets its confirmation", async () => {
  const subject = fixture();
  assert.equal((await subject.post("buyer@example.com")).status, 200);
  assert.equal(subject.state.reservations.length, 1);
  assert.equal(subject.state.sent.length, 1);
});
