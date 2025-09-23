// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes (add more if you need)
const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/browse(.*)",
  "/api/whoami", // keep /api/whoami public for debugging
]);

export default clerkMiddleware((_auth, req) => {
  // No auth().protect() here — let pages handle protection themselves.
  // If you later want to auto-protect, we can add a manual redirect.
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

