import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { ResolveReportButton } from "@/components/admin/ResolveReportButton";

export const metadata: Metadata = { title: "Reports — Admin" };

export default async function AdminReportsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const reports = await prisma.userReport.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
    include: {
      reporter: { select: { name: true, email: true } },
      reported: { select: { name: true, email: true } },
    },
  });

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold font-display mb-6">User Reports ({reports.length} open)</h1>
      <div className="space-y-3">
        {reports.map((r) => (
          <div key={r.id} className="border border-neutral-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="font-medium">{r.reporter.name ?? r.reporter.email ?? "Unknown"}</span>
                  <span className="text-neutral-400"> reported </span>
                  <Link href={`/admin/users?q=${encodeURIComponent(r.reported.email ?? r.reported.name ?? "")}`} className="font-medium hover:underline">{r.reported.name ?? r.reported.email ?? "Unknown"}</Link>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                    {r.reason}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.details && (
                  <p className="text-sm text-neutral-600">{r.details}</p>
                )}
              </div>
              <ResolveReportButton reportId={r.id} />
            </div>
          </div>
        ))}
        {reports.length === 0 && (
          <p className="text-neutral-500 text-sm">No open reports.</p>
        )}
      </div>
    </main>
  );
}
