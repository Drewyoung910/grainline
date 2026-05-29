import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

type AdminPageRole = "STAFF" | "ADMIN";

export async function requireAdminPageAccess(requiredRole: AdminPageRole = "STAFF") {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) redirect("/");
  if (requiredRole === "ADMIN" && user.role !== "ADMIN") redirect("/");
  if (requiredRole === "STAFF" && user.role !== "EMPLOYEE" && user.role !== "ADMIN") redirect("/");
  return user;
}
