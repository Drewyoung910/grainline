import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { ADMIN_PIN_COOKIE_NAME, verifyAdminPinCookieValue } from "@/lib/adminPin";

type AdminPageRole = "STAFF" | "ADMIN";

export async function requireAdminPageAccess(requiredRole: AdminPageRole = "STAFF") {
  const { userId, sessionId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) redirect("/");
  if (requiredRole === "ADMIN" && user.role !== "ADMIN") redirect("/");
  if (requiredRole === "STAFF" && user.role !== "EMPLOYEE" && user.role !== "ADMIN") redirect("/");
  // Layouts are presentation, not authorization for independently rendered pages.
  // Return the existing challenge on this page, before any sensitive data query.
  const cookieStore = await cookies();
  const verified = await verifyAdminPinCookieValue(
    cookieStore.get(ADMIN_PIN_COOKIE_NAME)?.value,
    userId,
    sessionId,
  );
  if (!verified) return null;
  return user;
}
