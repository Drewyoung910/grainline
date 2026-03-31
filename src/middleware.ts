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
  "/blog(.*)",            // blog — public viewing; writing/commenting handled in API routes
  "/map(.*)",             // all-sellers map — public
  "/terms",               // Terms of Service — public legal page
  "/privacy",             // Privacy Policy — public legal page
  "/api/clerk/webhook",    // Clerk webhook — called by Clerk servers, no Clerk session
  "/api/stripe/webhook",   // Stripe webhook — called by Stripe servers, no Clerk session
  "/api/uploadthing(.*)",  // UploadThing callback must be public (no Clerk session)
  "/api/whoami",
  "/api/me",
  "/api/reviews(.*)",     // GET/PATCH/POST/DELETE reviews (public read)
  "/api/blog(.*)",        // blog API — public GET; POST auth handled in route
  "/api/search(.*)",      // search suggestions — public
  "/api/follow(.*)",      // GET follow status — auth optional; POST/DELETE handled in route
  "/commission",          // Commission Room board — public
  "/commission/((?!new)[^/]+)", // Commission request detail — public (excludes /new)
]);

const isAdmin = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
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
