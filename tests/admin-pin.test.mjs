import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  assertAdminPinCookieSecretConfigured,
  createAdminPinSessionCookieValue,
  verifyAdminPinCookieValue,
} = await import("../src/lib/adminPin.ts");
const {
  ADMIN_PIN_SHA256_BY_CLERK_ID_ENV,
  adminPinDigestMatches,
  adminPinSha256Hex,
  resolveAdminPinDigestForUser,
} = await import("../src/lib/adminPinChallenge.ts");

describe("admin PIN cookie secret configuration", () => {
  it("allows production when a dedicated cookie secret is configured", () => {
    assert.doesNotThrow(() =>
      assertAdminPinCookieSecretConfigured({
        NODE_ENV: "production",
        ADMIN_PIN_COOKIE_SECRET: "test-cookie-secret",
      }),
    );
  });

  it("fails production startup when the cookie secret is missing", () => {
    assert.throws(
      () => assertAdminPinCookieSecretConfigured({ NODE_ENV: "production" }),
      /ADMIN_PIN_COOKIE_SECRET is required in production/,
    );
  });

  it("allows local development without a persistent cookie secret", () => {
    assert.doesNotThrow(() => assertAdminPinCookieSecretConfigured({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => assertAdminPinCookieSecretConfigured({}));
  });

  it("uses an ephemeral per-process local fallback when no dev cookie secret is configured", () => {
    const source = readFileSync("src/lib/adminPin.ts", "utf8");

    assert.match(source, /ADMIN_PIN_COOKIE_SECRET_DEV/);
    assert.match(source, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(source, /process\.env\.ADMIN_PIN_COOKIE_SECRET_DEV \|\| "grainline-local-dev-admin-pin-cookie-secret"/);
  });

  it("allows Next production builds to collect page data before runtime env injection", () => {
    assert.doesNotThrow(() =>
      assertAdminPinCookieSecretConfigured({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    );
  });

  it("sets admin PIN cookies with strict same-site semantics", () => {
    const route = readFileSync("src/app/api/admin/verify-pin/route.ts", "utf8");

    assert.match(route, /sameSite: "strict"/);
    assert.doesNotMatch(route, /sameSite: "lax"/);
  });

  it("keeps raw source IPs and Clerk ids out of permanent admin PIN audit metadata", () => {
    const route = readFileSync("src/app/api/admin/verify-pin/route.ts", "utf8");
    const helperStart = route.indexOf("async function logAdminPinAttempt");
    const helper = route.slice(helperStart, route.indexOf("export async function POST", helperStart));

    assert.match(route, /hashIdentifierForTelemetry\(ip\)/);
    assert.match(route, /hashIdentifierForTelemetry\(userId\)/);
    assert.match(helper, /ipHash/);
    assert.match(helper, /clerkUserIdHash/);
    assert.doesNotMatch(helper, /\bip,\s*\n/);
    assert.doesNotMatch(helper, /clerkUserId,\s*\n/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*\bip,\s*/s);
    assert.match(route, /user: \{ id: user\.id \}/);
  });

  it("keeps production ADMIN_PIN env requirements aligned across docs and examples", () => {
    const route = readFileSync("src/app/api/admin/verify-pin/route.ts", "utf8");
    const claude = readFileSync("CLAUDE.md", "utf8");
    const launch = readFileSync("docs/launch-checklist.md", "utf8");
    const runbook = readFileSync("docs/runbook.md", "utf8");
    const envExample = readFileSync(".env.example", "utf8");
    const requiredEnvStart = claude.indexOf("### Production environment variables");
    const requiredEnv = claude.slice(requiredEnvStart, claude.indexOf("### Remaining architectural risks", requiredEnvStart));

    assert.match(route, /resolveAdminPinDigestForUser/);
    assert.match(route, /process\.env\.ADMIN_PIN/);
    assert.match(route, /process\.env\[ADMIN_PIN_SHA256_BY_CLERK_ID_ENV\]/);
    assert.match(route, /Admin PIN is not configured/);
    assert.match(requiredEnv, /`ADMIN_PIN`/);
    assert.match(requiredEnv, /`ADMIN_PIN_SHA256_BY_CLERK_ID`/);
    assert.match(requiredEnv, /`OPENAI_API_KEY`/);
    assert.match(requiredEnv, /`CRON_SECRET_PREVIOUS`/);
    assert.match(requiredEnv, /`UNSUBSCRIBE_SECRET` or legacy alias `EMAIL_UNSUBSCRIBE_SECRET`/);
    assert.match(requiredEnv, /`R2_PUBLIC_URL`/);
    assert.match(requiredEnv, /`NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL`/);
    assert.match(requiredEnv, /`NEXT_PUBLIC_R2_PUBLIC_URL`/);
    assert.match(requiredEnv, /`CLOUDFLARE_R2_PUBLIC_URLS`/);
    assert.match(requiredEnv, /`ALLOWED_R2_PUBLIC_URLS`/);
    assert.match(requiredEnv, /explicit handler guard that fails closed in production/);
    assert.match(launch, /- `ADMIN_PIN`/);
    assert.match(launch, /- `ADMIN_PIN_SHA256_BY_CLERK_ID`/);
    assert.match(runbook, /`ADMIN_PIN`/);
    assert.match(runbook, /`ADMIN_PIN_SHA256_BY_CLERK_ID`/);
    assert.match(runbook, /`ADMIN_PIN_COOKIE_SECRET`/);
    assert.match(envExample, /^ADMIN_PIN=change-me/m);
    assert.match(envExample, /^# ADMIN_PIN_SHA256_BY_CLERK_ID=/m);
  });

  it("supports per-Clerk-user admin PIN digests without falling back to the shared PIN", () => {
    const pinDigest = adminPinSha256Hex("123456");
    const resolved = resolveAdminPinDigestForUser({
      clerkUserId: "user_1",
      perUserPinDigestsJson: JSON.stringify({ user_1: pinDigest }),
      sharedPin: "999999",
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "per-user");
    assert.equal(adminPinDigestMatches("123456", resolved.digest), true);
    assert.equal(adminPinDigestMatches("999999", resolved.digest), false);
  });

  it("fails closed when a per-user admin PIN map is configured but the staff user is absent", () => {
    const resolved = resolveAdminPinDigestForUser({
      clerkUserId: "missing_user",
      perUserPinDigestsJson: JSON.stringify({ user_1: adminPinSha256Hex("123456") }),
      sharedPin: "999999",
    });

    assert.deepEqual(resolved, { ok: false, reason: "missing_user" });
  });

  it("rejects malformed per-user admin PIN digest maps", () => {
    assert.deepEqual(
      resolveAdminPinDigestForUser({
        clerkUserId: "user_1",
        perUserPinDigestsJson: JSON.stringify({ user_1: "123456" }),
        sharedPin: "999999",
      }),
      { ok: false, reason: "invalid" },
    );
    assert.deepEqual(
      resolveAdminPinDigestForUser({
        clerkUserId: "user_1",
        perUserPinDigestsJson: "[1,2,3]",
        sharedPin: "999999",
      }),
      { ok: false, reason: "invalid" },
    );
  });

  it("keeps the legacy shared admin PIN as the fallback when no per-user map is configured", () => {
    const resolved = resolveAdminPinDigestForUser({
      clerkUserId: "user_1",
      sharedPin: "999999",
    });

    assert.equal(ADMIN_PIN_SHA256_BY_CLERK_ID_ENV, "ADMIN_PIN_SHA256_BY_CLERK_ID");
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "shared");
    assert.equal(adminPinDigestMatches("999999", resolved.digest), true);
  });

  it("binds admin PIN cookies to the active Clerk session", async () => {
    const now = Date.parse("2026-05-29T00:00:00Z");
    const cookie = await createAdminPinSessionCookieValue("user_1", "sess_1", now);

    assert.ok(cookie?.startsWith("v2."));
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", "sess_1", now), true);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", "sess_2", now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_2", "sess_1", now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", null, now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie?.replace(/^v2\./, "v1."), "user_1", "sess_1", now), false);
  });

  it("requires the session-bound admin PIN for staff-only public case APIs", () => {
    const helper = readFileSync("src/lib/adminPinApi.ts", "utf8");
    const resolve = readFileSync("src/app/api/cases/[id]/resolve/route.ts", "utf8");
    const escalate = readFileSync("src/app/api/cases/[id]/escalate/route.ts", "utf8");
    const messages = readFileSync("src/app/api/cases/[id]/messages/route.ts", "utf8");

    assert.match(helper, /ADMIN_PIN_COOKIE_NAME/);
    assert.match(helper, /verifyAdminPinCookieValue\(/);
    assert.match(helper, /request\.headers\.get\("cookie"\)/);
    assert.match(helper, /Admin PIN required/);
    assert.match(helper, /status: HTTP_STATUS\.FORBIDDEN/);

    assert.match(resolve, /import \{ requireStaffAdminPinForApi \} from "@\/lib\/adminPinApi"/);
    assert.match(resolve, /const \{ userId, sessionId \} = await auth\(\)/);
    assert.match(resolve, /const pinResponse = await requireStaffAdminPinForApi\(req, userId, sessionId\)/);
    assert.ok(
      resolve.indexOf('me.role !== "EMPLOYEE"') <
        resolve.indexOf("requireStaffAdminPinForApi(req, userId, sessionId)") &&
        resolve.indexOf("requireStaffAdminPinForApi(req, userId, sessionId)") <
          resolve.indexOf("safeRateLimit(refundRatelimit"),
      "staff case resolution should require admin PIN before rate limit and refund mutation",
    );

    assert.match(escalate, /import \{ requireStaffAdminPinForApi \} from "@\/lib\/adminPinApi"/);
    assert.match(escalate, /const \{ userId, sessionId \} = await auth\(\)/);
    assert.match(escalate, /verifyCronRequest\(req\)/);
    assert.match(escalate, /if \(me\.role === "EMPLOYEE" \|\| me\.role === "ADMIN"\) \{/);
    assert.match(escalate, /requireStaffAdminPinForApi\(req, userId, sessionId\)/);
    assert.ok(
      escalate.indexOf("if (!validCron)") <
        escalate.indexOf("requireStaffAdminPinForApi(req, userId, sessionId)"),
      "cron escalation should not require a Clerk admin PIN cookie",
    );

    assert.match(messages, /import \{ requireStaffAdminPinForApi \} from "@\/lib\/adminPinApi"/);
    assert.match(messages, /const \{ userId, sessionId \} = await auth\(\)/);
    assert.match(messages, /if \(!isParty && isStaff\) \{/);
    assert.match(messages, /requireStaffAdminPinForApi\(req, userId, sessionId\)/);
    assert.ok(
      messages.indexOf("if (!isParty && !isStaff)") <
        messages.indexOf("if (!isParty && isStaff)") &&
        messages.indexOf("if (!isParty && isStaff)") <
          messages.indexOf("if (!canCreateCaseMessageForStatus"),
      "only staff non-party case messages should require the admin PIN before message creation",
    );
  });
});
