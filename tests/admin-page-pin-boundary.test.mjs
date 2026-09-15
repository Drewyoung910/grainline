import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  ADMIN_PIN_COOKIE_NAME, ADMIN_PIN_MAX_AGE_SECONDS,
  createAdminPinSessionCookieValue, verifyAdminPinCookieValue,
} from "../src/lib/adminPin.ts";

// Execute the actual TypeScript modules with isolated framework/database ports.
// No application server, credentials, external provider or database is used.
function loadSubject(path, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: path,
  });
  const fixtureModule = { exports: {} };
  const require = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    // Unused imports may load, but using any unmodeled dependency fails loudly.
    return new Proxy({ __esModule: true }, { get(target, key) {
      if (key === "__esModule") return true;
      return () => { throw new Error(`Unexpected dependency: ${name}.${String(key)}`); };
    } });
  };
  new Function("require", "module", "exports", outputText)(require, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

const identity = { userId: "staff-page-proof", sessionId: "staff-session-proof" };
const staff = { id: "local-staff-proof", role: "EMPLOYEE", banned: false, deletedAt: null };
function helperFixture({ cookie, login = identity, user = staff } = {}) {
  const calls = [];
  const guard = loadSubject("src/lib/adminPageAccess.ts", {
    "@clerk/nextjs/server": { auth: async () => { calls.push("auth"); return login; } },
    "next/navigation": { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ get: (name) => {
      assert.equal(name, ADMIN_PIN_COOKIE_NAME);
      calls.push("cookie"); return cookie === undefined ? undefined : { value: cookie };
    } }) },
    "@/lib/db": { prisma: { user: { findUnique: async (query) => {
      assert.equal(query.where.clerkId, login.userId);
      calls.push("current-user"); return user;
    } } } },
    "@/lib/adminPin": { ADMIN_PIN_COOKIE_NAME, verifyAdminPinCookieValue },
  });
  return { guard: guard.requireAdminPageAccess, calls };
}

test("page access requires a current, session-bound PIN independently of layouts", async () => {
  const valid = await createAdminPinSessionCookieValue(identity.userId, identity.sessionId);
  const wrongUser = await createAdminPinSessionCookieValue("another-staff", identity.sessionId);
  const wrongSession = await createAdminPinSessionCookieValue(identity.userId, "another-session");
  const expired = await createAdminPinSessionCookieValue(identity.userId, identity.sessionId,
    Date.now() - ADMIN_PIN_MAX_AGE_SECONDS * 1000 - 10_000);
  for (const cookie of [undefined, "", "malformed", "v1.9999999999999.invalid", wrongUser, wrongSession, expired]) {
    assert.equal(await helperFixture({ cookie }).guard(), null);
  }
  assert.equal(await helperFixture({ cookie: valid, login: { ...identity, sessionId: null } }).guard(), null);
  assert.deepEqual(await helperFixture({ cookie: valid }).guard(), staff);
  const admin = { ...staff, role: "ADMIN" };
  assert.deepEqual(await helperFixture({ cookie: valid, user: admin }).guard("ADMIN"), admin);
});

test("PIN possession never replaces authentication, current account posture or required role", async () => {
  const cookie = await createAdminPinSessionCookieValue(identity.userId, identity.sessionId);
  for (const options of [
    { login: { userId: null, sessionId: null } }, { user: null },
    { user: { ...staff, banned: true } }, { user: { ...staff, deletedAt: new Date() } },
    { user: { ...staff, role: "USER" } },
  ]) await assert.rejects(helperFixture({ ...options, cookie }).guard(), /redirect:\//);
  await assert.rejects(helperFixture({ cookie }).guard("ADMIN"), /redirect:\//);
});

const pages = [
  ["orders/page.tsx", "readStaffOrderPage("],
  ["orders/[id]/page.tsx", "readStaffOrderDetail("],
  ["flagged/page.tsx", "readStaffOrderPage("],
  ["cases/page.tsx", "getStaffCaseQueue("],
  ["cases/[id]/page.tsx", "getVisibleCaseById("],
  ["blog/page.tsx", "prisma.blogPost.findMany("],
  ["broadcasts/page.tsx", "prisma.sellerBroadcast.count("],
  ["verification/page.tsx", "prisma.makerVerification.findMany("],
  ["audit/page.tsx", "prisma.adminAuditLog.count("],
  ["users/page.tsx", "prisma.user.count("],
  ["reviews/page.tsx", "prisma.review.count("],
  ["review/page.tsx", "prisma.listing.count("],
  ["reports/page.tsx", "prisma.userReport.findMany("],
  ["support/page.tsx", "prisma.supportRequest."],
];

test("every sensitive admin page returns the existing challenge before its data queries", async () => {
  const PinGate = () => null;
  const inventory = readdirSync("src/app/admin", { recursive: true })
    .filter((path) => path === "page.tsx" || path.endsWith("/page.tsx")).sort();
  assert.deepEqual(inventory, ["page.tsx", ...pages.map(([path]) => path)].sort(),
    "new admin pages must have an explicitly classified data/PIN boundary");
  for (const [relative, query] of pages) {
    const path = `src/app/admin/${relative}`;
    const source = readFileSync(path, "utf8");
    const body = source.slice(source.indexOf("export default async function"));
    assert.match(body, /const staff = await requireAdminPageAccess\((?:"ADMIN")?\);/u, path);
    const challenge = body.indexOf("if (!staff) return <AdminPinGate />;");
    assert.ok(challenge >= 0 && challenge < body.indexOf(query), `${path}: challenge precedes data`);
    let guarded = 0;
    const Page = loadSubject(path, {
      "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      "@/lib/adminPageAccess": { requireAdminPageAccess: async (role) => {
        assert.equal(role, ["audit/page.tsx", "users/page.tsx"].includes(relative) ? "ADMIN" : undefined);
        guarded++; return null;
      } },
      "@/components/AdminPinGate": { __esModule: true, default: PinGate },
    }).default;
    const result = await Page({ params: Promise.resolve({ id: "order-proof" }), searchParams: Promise.resolve({}) });
    assert.equal(guarded, 1, path);
    assert.equal(result.type, PinGate, path);
  }
});

test("verified staff still reach the same Order authorities with the local actor and staff client", async () => {
  const cookie = await createAdminPinSessionCookieValue(identity.userId, identity.sessionId);
  const client = {};
  for (const relative of ["orders/page.tsx", "flagged/page.tsx", "orders/[id]/page.tsx"]) {
    const calls = [];
    const Page = loadSubject(`src/app/admin/${relative}`, {
      "@/lib/adminPageAccess": { requireAdminPageAccess: helperFixture({ cookie }).guard },
      "@/lib/orderStaffReadDb": { getOrderStaffReadClient: () => client },
      "@/lib/queryParams": { parseBoundedPositiveIntParam: () => 1 },
      "@/lib/orderStaffReadAuthority": {
        readStaffOrderPage: async (...args) => { calls.push(args); return null; },
        readStaffOrderDetail: async (...args) => { calls.push(args); return null; },
      },
      "next/navigation": { notFound: () => { throw new Error("controlled-order-not-found"); } },
    }).default;
    await assert.rejects(Page({ params: Promise.resolve({ id: "order-proof" }), searchParams: Promise.resolve({}) }),
      /controlled-order-not-found/u);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], staff.id);
    assert.equal(calls[0].at(-1), client);
    assert.equal(calls[0][1], relative === "orders/[id]/page.tsx" ? "order-proof"
      : relative === "flagged/page.tsx" ? "REVIEW_NEEDED" : "ALL");
  }
});
