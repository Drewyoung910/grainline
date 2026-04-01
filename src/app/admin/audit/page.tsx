import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UndoActionButton } from "@/components/UndoActionButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit Log — Admin" };

const ACTION_COLORS: Record<string, string> = {
  BAN_USER: "bg-red-100 text-red-800",
  UNBAN_USER: "bg-green-100 text-green-800",
  APPROVE_LISTING: "bg-green-100 text-green-800",
  REJECT_LISTING: "bg-red-100 text-red-800",
  REMOVE_LISTING: "bg-red-100 text-red-800",
  HOLD_LISTING: "bg-amber-100 text-amber-800",
  AI_HOLD_LISTING: "bg-amber-100 text-amber-800",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || admin.role !== "ADMIN") redirect("/");

  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10));
  const perPage = 30;

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        admin: { select: { name: true, email: true } },
      },
    }),
    prisma.adminAuditLog.count(),
  ]);

  const now = Date.now();
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <span className="text-sm text-neutral-500">{total} entries</span>
      </div>

      <div className="border border-neutral-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Action</th>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Admin</th>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Target</th>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Reason</th>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Time</th>
              <th className="text-left px-4 py-3 font-medium text-neutral-500">Undo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {logs.map((log) => {
              const hoursAgo = (now - new Date(log.createdAt).getTime()) / 3600000;
              const canUndo =
                !log.undone &&
                hoursAgo <= 24 &&
                ["BAN_USER", "REMOVE_LISTING", "HOLD_LISTING"].includes(log.action);

              return (
                <tr key={log.id} className={log.undone ? "opacity-50" : "hover:bg-neutral-50"}>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        ACTION_COLORS[log.action] ?? "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {log.action.replace(/_/g, " ")}
                    </span>
                    {log.undone && (
                      <div className="text-xs text-neutral-400 mt-0.5">Undone</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{log.admin.name ?? "—"}</div>
                    <div className="text-xs text-neutral-400">{log.admin.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-neutral-500">{log.targetType}</div>
                    <div className="text-xs font-mono text-neutral-400 truncate max-w-[120px]">
                      {log.targetId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 max-w-[200px] truncate">
                    {log.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <UndoActionButton logId={log.id} canUndo={canUndo} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 items-center justify-center">
          {page > 1 && (
            <a
              href={`/admin/audit?page=${page - 1}`}
              className="border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              ← Prev
            </a>
          )}
          <span className="text-sm text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/admin/audit?page=${page + 1}`}
              className="border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
