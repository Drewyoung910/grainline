// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";

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
  "/not-available",       // geo-block landing page — no auth needed
  "/about",               // About page — public
  "/unsubscribe",         // Email unsubscribe landing — CAN-SPAM compliance
  "/accessibility",       // Accessibility statement — ADA compliance
  "/api/clerk/webhook",    // Clerk webhook — called by Clerk servers, no Clerk session
  "/api/stripe/webhook",   // Stripe webhook — called by Stripe servers, no Clerk session
"/api/whoami",
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
  "/api/listings/(.*)/view",   // listing view tracking — fire-and-forget analytics
  "/api/listings/(.*)/click",  // listing click tracking — fire-and-forget analytics
  "/api/listings/(.*)/similar",       // similar listings — public
  "/api/listings/recently-viewed",    // recently viewed — public (IDs passed as query param)
  "/api/health",                      // health check — public (UptimeRobot monitoring)
  "/api/cron(.*)",                    // Vercel Cron jobs — no Clerk session; auth via CRON_SECRET bearer token
]);

const isAdmin = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  // Geo-blocking — US only
  // request.geo is populated by Vercel in production (undefined in local dev)
  const country = (req as unknown as { geo?: { country?: string } }).geo?.country;
  if (country && country !== "US") {
    const pathname = req.nextUrl.pathname;
    // Allow not-available page, static assets, and API routes needed for the page
    const isAllowed =
      pathname.startsWith("/not-available") ||
      pathname.startsWith("/api") ||          // API routes must never be geo-blocked (Stripe/Clerk webhooks, etc.)
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon") ||
      pathname.startsWith("/logo") ||
      pathname.startsWith("/icon") ||
      pathname.startsWith("/manifest") ||
      pathname.startsWith("/robots") ||
      pathname.startsWith("/sitemap");
    if (!isAllowed) {
      return NextResponse.redirect(new URL("/not-available", req.url));
    }
  }

  // Enforce authentication on all non-public routes
  if (!isPublic(req)) {
    await auth.protect();
  }

  // Enforce EMPLOYEE or ADMIN role for /admin/* routes
  if (isAdmin(req)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const user = await ensureUserByClerkId(userId);
    if (user.role !== "EMPLOYEE" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
});

export const runtime = "nodejs";

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/", "/(api|trpc)(.*)"],
};
