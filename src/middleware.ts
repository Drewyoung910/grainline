// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { ADMIN_PIN_COOKIE_NAME, verifyAdminPinCookieValue } from "@/lib/adminPin";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { normalizeRequestId, requestHeadersWithRequestId, REQUEST_ID_HEADER } from "@/lib/requestId";

const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/browse(.*)",
  "/listing(.*)",
  "/seller(.*)",          // public seller profiles
  "/sellers(.*)",         // sellers directory
  "/makers(.*)",          // city-level makers pages — public
  "/blog(.*)",            // blog — public viewing; writing/commenting handled in API routes
  "/map(.*)",             // all-sellers map — public
  "/terms",               // Terms of Service — public legal page
  "/privacy",             // Privacy Policy — public legal page
  "/legal/data-request",   // Privacy/account data request — public legal page
  "/not-available",       // geo-block landing page — no auth needed
  "/monitoring",          // Sentry client-event tunnel — no Clerk session
  "/about",               // About page — public
  "/support",             // Support request form — no auth needed
  "/unsubscribe",         // Email unsubscribe landing — CAN-SPAM compliance
  "/accessibility",       // Accessibility statement — ADA compliance
  "/api/clerk/webhook",    // Clerk webhook — called by Clerk servers, no Clerk session
  "/api/stripe/webhook",   // Stripe webhook — called by Stripe servers, no Clerk session
  "/api/resend/webhook",   // Resend webhook — called by Resend servers, no Clerk session
  "/api/email/unsubscribe", // One-click email unsubscribe — called by mail providers, no Clerk session
  "/api/me",
  "/api/reviews(.*)",     // GET/PATCH/POST/DELETE reviews (public read)
  "/api/blog(.*)",        // blog API — public GET; POST auth handled in route
  "/api/search(.*)",      // search suggestions + popular tags — public
  "/api/cart",              // cart count — auth handled in route (returns 401)
  "/api/notifications",     // notification count — auth handled in route (returns 401)
  "/api/follow(.*)",      // GET follow status — auth optional; POST/DELETE handled in route
  "/commission",          // Commission Room board — public
  "/commission/((?!new)[^/]+)", // Commission request detail — public (excludes /new)
  "/api/csp-report",           // CSP violation reports — no auth needed
  "/api/newsletter",           // newsletter signup — no auth needed
  "/api/support",              // support request form — no auth needed
  "/api/legal/data-request",   // data/privacy request form — no auth needed
  "/api/listings/([^/]+)/view",   // listing view tracking — fire-and-forget analytics
  "/api/listings/([^/]+)/click",  // listing click tracking — fire-and-forget analytics
  "/api/listings/([^/]+)/similar",       // similar listings — public
  "/api/listings/recently-viewed",    // recently viewed — public (IDs passed as query param)
  "/api/health",                      // health check — public (UptimeRobot monitoring)
  "/api/cron(.*)",                    // Vercel Cron jobs — no Clerk session; auth via CRON_SECRET bearer token
]);

const isAdminPage = createRouteMatcher(["/admin(.*)"]);
const isAdminApi = createRouteMatcher(["/api/admin(.*)"]);
const isAdminPinVerification = createRouteMatcher(["/api/admin/verify-pin"]);
const isSuspendedAccountAllowed = createRouteMatcher([
  "/banned",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/terms",
  "/privacy",
  "/legal/data-request",
  "/accessibility",
  "/unsubscribe",
  "/support",
  "/not-available",
  "/monitoring",
  "/api/clerk/webhook",
  "/api/stripe/webhook",
  "/api/resend/webhook",
  "/api/email/unsubscribe",
  "/api/support",
  "/api/legal/data-request",
  "/api/health",
  "/api/cron(.*)",
]);

function withRequestId<T extends NextResponse>(response: T, requestId: string): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function forbiddenFor(req: Request, requestId: string) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return withRequestId(NextResponse.json({ error: "Forbidden" }, { status: 403 }), requestId);
  }
  return withRequestId(NextResponse.redirect(new URL("/", req.url)), requestId);
}

function isGeoAllowedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/health/deep" ||
    pathname === "/api/csp-report" ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/api/clerk/webhook" ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/resend/webhook" ||
    pathname === "/api/email/unsubscribe" ||
    pathname === "/api/support" ||
    pathname === "/api/legal/data-request"
  );
}

function isGeoAllowedPagePath(pathname: string): boolean {
  return pathname === "/support" || pathname === "/legal/data-request";
}

function isCronPath(pathname: string): boolean {
  return pathname === "/api/cron" || pathname.startsWith("/api/cron/");
}

export default clerkMiddleware(async (auth, req) => {
  const requestId = normalizeRequestId(req.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = requestHeadersWithRequestId(req.headers, requestId);
  Sentry.setTag("requestId", requestId);

  // Geo-blocking — US only. Next 16 no longer exposes request.geo, so use
  // Vercel's country header when present. This header is only trusted behind
  // Vercel's managed ingress; non-Vercel deployments need their own trusted geo source.
  const country = req.headers.get("x-vercel-ip-country") || undefined;
  if (country && country !== "US") {
    const pathname = req.nextUrl.pathname;
    // Allow not-available page, static assets, and API routes needed for the page
    const isAllowed =
      pathname.startsWith("/not-available") ||
      pathname.startsWith("/monitoring") ||
      isGeoAllowedPagePath(pathname) ||
      isGeoAllowedApiPath(pathname) ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon") ||
      pathname.startsWith("/logo") ||
      pathname.startsWith("/icon") ||
      pathname.startsWith("/manifest") ||
      pathname.startsWith("/robots") ||
      pathname.startsWith("/sitemap");
    if (!isAllowed) {
      return withRequestId(NextResponse.redirect(new URL("/not-available", req.url)), requestId);
    }
  }

  if (isCronPath(req.nextUrl.pathname) && !verifyCronRequest(req)) {
    return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
  }

  // Enforce authentication on all non-public routes
  if (!isPublic(req)) {
    await auth.protect();
  }

  const { userId } = await auth();
  Sentry.setUser(userId ? { id: userId } : null);

  if (userId && !isSuspendedAccountAllowed(req)) {
    const account = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { banned: true, deletedAt: true },
    });
    if (account?.banned || account?.deletedAt) {
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return withRequestId(NextResponse.json(
          {
            error: account.deletedAt
              ? "This account has been deleted. Contact support@thegrainline.com"
              : "Your account has been suspended. Contact support@thegrainline.com",
            code: account.deletedAt ? "ACCOUNT_DELETED" : "ACCOUNT_SUSPENDED",
          },
          { status: 403 },
        ), requestId);
      }
      return withRequestId(NextResponse.redirect(new URL("/banned", req.url)), requestId);
    }
  }

  // Enforce EMPLOYEE or ADMIN role for admin pages and APIs.
  if (isAdminPage(req) || isAdminApi(req)) {
    if (!userId) {
      return forbiddenFor(req, requestId);
    }
    let user;
    try {
      user = await ensureUserByClerkId(userId);
    } catch {
      return forbiddenFor(req, requestId);
    }
    if (user.role !== "EMPLOYEE" && user.role !== "ADMIN") {
      return forbiddenFor(req, requestId);
    }

    // Admin pages withhold server-rendered data in their layout until this
    // cookie is valid. Admin APIs and server-action POSTs must enforce it
    // in middleware too because server actions post back to page paths.
    const isAdminServerActionPost =
      isAdminPage(req) && req.method !== "GET" && req.method !== "HEAD";
    if ((isAdminApi(req) && !isAdminPinVerification(req)) || isAdminServerActionPost) {
      const pinVerified = await verifyAdminPinCookieValue(
        req.cookies.get(ADMIN_PIN_COOKIE_NAME)?.value,
        userId,
      );
      if (!pinVerified) {
        return withRequestId(NextResponse.json({ error: "Admin PIN required" }, { status: 403 }), requestId);
      }
    }
  }

  return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }), requestId);
});

export const runtime = "nodejs";

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/", "/(api|trpc)(.*)"],
};
