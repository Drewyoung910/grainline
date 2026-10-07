import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import AdminPinGate from "@/components/AdminPinGate";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { BanUserButton } from "@/components/BanUserButton";
import { AdminEmailForm } from "@/components/admin/AdminEmailForm";
import Link from "next/link";
import type { Metadata } from "next";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { truncateText } from "@/lib/sanitize";
import {
  userStaffDirectoryCount,
  userStaffDirectoryPage,
  userStaffExactEmailTarget,
} from "@/lib/userStaffAccess";

export const metadata: Metadata = { title: "Users — Admin" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; email?: string }>;
}) {
  const staff = await requireAdminPageAccess("ADMIN");
  if (!staff) return <AdminPinGate />;

  const { q: qParam, page: pageStr, email: emailParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageStr, 1, 1000);
  const q = truncateText((qParam ?? "").trim(), 200);
  const email = truncateText((emailParam ?? "").trim(), 254);
  const perPage = 30;
  const staffClient = getOrderStaffReadClient();

  const total = await userStaffDirectoryCount(staffClient, { actorId: staff.id, query: q });
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(requestedPage, totalPages);

  const users = await userStaffDirectoryPage(staffClient, { actorId: staff.id, query: q, page });

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/admin/users${qs ? `?${qs}` : ""}`;
  }

  // If ?email= is present, look up user for standalone email form
  let emailTarget: { id: string; name: string | null; email: string } | null = null;
  if (email) {
    emailTarget = await userStaffExactEmailTarget(staffClient, {
      actorId: staff.id,
      email: email.toLowerCase(),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <span className="text-sm text-neutral-500">{total} total</span>
      </div>

      {/* Standalone email form when ?email= param is present */}
      {email && (
        <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
          {emailTarget ? (
            <AdminEmailForm
              userId={emailTarget.id}
              userName={emailTarget.name ?? emailTarget.email}
              defaultOpen
            />
          ) : (
            <p className="text-sm text-neutral-700">
              No Grainline user exists for <span className="font-medium">{email}</span>. Use the
              support mailbox for external replies.
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          maxLength={200}
          placeholder="Search by email or name..."
          className="flex-1 border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
        <button
          type="submit"
          className="border border-neutral-900 bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Search
        </button>
        {q && (
          <a
            href="/admin/users"
            className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Clear
          </a>
        )}
      </form>

      {/* Users table */}
      <div className="border border-neutral-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Admin user management list</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th scope="col" className="text-left px-4 py-3 font-medium text-neutral-500">User</th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-neutral-500">Role</th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-neutral-500">Joined</th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-neutral-500">Status</th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-neutral-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {users.map((u) => (
              <tr key={u.id} className={u.banned ? "bg-red-50" : "hover:bg-neutral-50"}>
                <td className="px-4 py-3">
                  <div className="font-medium">{u.name ?? "—"}</div>
                  <div className="text-neutral-500 text-xs">{u.email}</div>
                  {u.sellerDisplayName && (
                    <div className="text-xs text-neutral-500">Shop: {u.sellerDisplayName}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    u.role === "ADMIN"
                      ? "bg-purple-100 text-purple-800"
                      : u.role === "EMPLOYEE"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-neutral-100 text-neutral-700"
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-500 text-xs">
                  {new Date(u.createdAt).toLocaleDateString("en-US")}
                </td>
                <td className="px-4 py-3">
                  {u.banned ? (
                    <div>
                      <span className="text-xs text-red-700 font-medium">Banned</span>
                      {u.bannedAt && (
                        <div className="text-xs text-neutral-500">
                          {new Date(u.bannedAt).toLocaleDateString("en-US")}
                        </div>
                      )}
                      {u.banReason && (
                        <div className="text-xs text-neutral-500 max-w-xs truncate">{u.banReason}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-green-700 font-medium">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 space-y-1">
                  {u.role !== "ADMIN" && (
                    <BanUserButton
                      userId={u.id}
                      isBanned={u.banned}
                      userName={u.name ?? u.email}
                    />
                  )}
                  <Link
                    href={`/admin/users?email=${encodeURIComponent(u.email)}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Email
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
