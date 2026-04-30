import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UndoActionButton } from "@/components/UndoActionButton";
import { isUndoableAdminAction } from "@/lib/audit";
import { truncateText } from "@/lib/sanitize";
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
  MARK_ORDER_REVIEWED: "bg-blue-100 text-blue-800",
  APPEND_ORDER_NOTE: "bg-blue-100 text-blue-800",
  DELETE_BROADCAST: "bg-red-100 text-red-800",
  APPROVE_BLOG_COMMENT: "bg-green-100 text-green-800",
  DELETE_BLOG_COMMENT: "bg-red-100 text-red-800",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || admin.role !== "ADMIN") redirect("/");

  const { page: pageStr, action: actionParam } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10));
  const perPage = 30;
  const actionFilter = actionParam ? truncateText(actionParam.trim(), 80) : "";
  const where = actionFilter ? { action: actionFilter } : {};

  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    params.set("page", String(nextPage));
    return `/admin/audit?${params.toString()}`;
  };

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        admin: { select: { name: true, email: true } },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  const now = Date.now();
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <span className="text-sm text-neutral-500">{total} entries</span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3">
        <div>
          <label htmlFor="action" className="block text-xs font-medium text-neutral-500 mb-1">
            Action
          </label>
          <select
            id="action"
            name="action"
            defaultValue={actionFilter}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All actions</option>
            {Object.keys(ACTION_COLORS).sort().map((action) => (
              <option key={action} value={action}>
                {action.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filter
        </button>
        {actionFilter && (
          <a href="/admin/audit" className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-800 hover:underline">
            Clear
          </a>
        )}
      </form>

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
              const undoable = isUndoableAdminAction(log.action);
              const canUndo =
                undoable &&
                !log.undone &&
                hoursAgo <= 24;

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
                      <div className="text-xs text-neutral-500 mt-0.5">Undone</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{log.admin.name ?? "—"}</div>
                    <div className="text-xs text-neutral-500">{log.admin.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-neutral-500">{log.targetType}</div>
                    <div className="text-xs font-mono text-neutral-500 truncate max-w-[120px]">
                      {log.targetId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 max-w-[200px] truncate">
                    {log.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3">
                    {undoable ? (
                      <UndoActionButton logId={log.id} canUndo={canUndo} />
                    ) : (
                      <span className="text-xs text-neutral-500">Not undoable</span>
                    )}
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
              href={pageHref(page - 1)}
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
              href={pageHref(page + 1)}
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
