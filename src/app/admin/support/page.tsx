import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Prisma, type SupportRequestStatus } from "@prisma/client";
import type { Metadata } from "next";
import InlineActionButton from "@/components/InlineActionButton";
import { prisma } from "@/lib/db";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import {
  SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS,
  SUPPORT_REQUEST_CLOSURE_EVIDENCE_MIN_CHARS,
  supportRequestEmailNotificationState,
} from "@/lib/supportRequest";
import { setSupportRequestStatus } from "./actions";

export const metadata: Metadata = { title: "Support Requests — Admin" };

const ACTIVE_PAGE_SIZE = 50;

const SUPPORT_REQUEST_ROW_SELECT = {
  id: true,
  kind: true,
  status: true,
  name: true,
  email: true,
  topic: true,
  orderId: true,
  listingId: true,
  message: true,
  slaDueAt: true,
  emailSentAt: true,
  emailLastError: true,
  closureEvidence: true,
  closureEvidenceAt: true,
  closureEvidenceBy: { select: { email: true } },
  createdAt: true,
} satisfies Prisma.SupportRequestSelect;

type SupportRequestRow = Prisma.SupportRequestGetPayload<{ select: typeof SUPPORT_REQUEST_ROW_SELECT }>;

function formatDate(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusClass(status: string) {
  if (status === "CLOSED") return "border-green-200 bg-green-50 text-green-700";
  if (status === "IN_PROGRESS") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function kindLabel(kind: string) {
  return kind === "DATA_REQUEST" ? "Data request" : "Support";
}

function RequestCard({ request }: { request: SupportRequestRow }) {
  const overdue = request.status !== "CLOSED" && request.slaDueAt.getTime() < Date.now();
  const emailState = supportRequestEmailNotificationState(request);
  const emailMessageClass =
    emailState.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const needsDataRequestClosureEvidence = request.kind === "DATA_REQUEST" && request.status !== "CLOSED";

  return (
    <article className={`rounded-lg border bg-white p-4 ${overdue ? "border-red-200" : "border-neutral-200"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-950">{kindLabel(request.kind)}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(request.status)}`}>
              {request.status.replace("_", " ").toLowerCase()}
            </span>
            {overdue && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                overdue
              </span>
            )}
            <span className="text-xs text-neutral-500">#{request.id}</span>
          </div>

          <dl className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-neutral-500">From</dt>
              <dd>{request.name ? `${request.name} <${request.email}>` : request.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-neutral-500">Topic</dt>
              <dd>{request.topic}</dd>
            </div>
            {request.orderId && (
              <div>
                <dt className="text-xs font-medium uppercase text-neutral-500">Order ID</dt>
                <dd className="font-mono text-xs">{request.orderId}</dd>
              </div>
            )}
            {request.listingId && (
              <div>
                <dt className="text-xs font-medium uppercase text-neutral-500">Listing ID</dt>
                <dd className="font-mono text-xs">{request.listingId}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase text-neutral-500">SLA due</dt>
              <dd>{formatDate(request.slaDueAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-neutral-500">Submitted</dt>
              <dd>{formatDate(request.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-neutral-500">Email notification</dt>
              <dd>{emailState.label}</dd>
            </div>
          </dl>

          {emailState.message && (
            <p className={`rounded-md border px-3 py-2 text-xs ${emailMessageClass}`}>
              {emailState.message}
            </p>
          )}

          <p className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 text-sm leading-6 text-neutral-800">
            {request.message}
          </p>

          {request.kind === "DATA_REQUEST" && request.closureEvidence && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
              <div className="mb-1 text-xs font-medium uppercase text-neutral-500">Closure evidence</div>
              <p className="whitespace-pre-wrap leading-6">{request.closureEvidence}</p>
              <p className="mt-2 text-xs text-neutral-500">
                Recorded {request.closureEvidenceAt ? formatDate(request.closureEvidenceAt) : "date unavailable"}
                {request.closureEvidenceBy?.email ? ` by ${request.closureEvidenceBy.email}` : ""}
              </p>
            </div>
          )}
        </div>

        <div className={`flex shrink-0 flex-wrap gap-2 lg:flex-col ${needsDataRequestClosureEvidence ? "lg:w-72" : "lg:w-40"}`}>
          {request.status === "OPEN" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "IN_PROGRESS")}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              pendingLabel="Saving..."
            >
              In progress
            </InlineActionButton>
          )}
          {request.status === "IN_PROGRESS" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "OPEN")}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              pendingLabel="Saving..."
            >
              Reopen
            </InlineActionButton>
          )}
          {request.status !== "CLOSED" && request.kind === "DATA_REQUEST" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "CLOSED")}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-medium text-green-800 hover:bg-green-100"
              pendingLabel="Closing..."
              fields={
                <label className="w-full text-xs font-medium text-neutral-700">
                  Closure evidence
                  <textarea
                    name="closureEvidence"
                    required
                    minLength={SUPPORT_REQUEST_CLOSURE_EVIDENCE_MIN_CHARS}
                    maxLength={SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS}
                    rows={5}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-900"
                    placeholder="Record local action, provider action or exception, requester response, owner, completion date, and provider ticket or evidence URL."
                  />
                </label>
              }
            >
              Close data request
            </InlineActionButton>
          )}
          {request.status !== "CLOSED" && request.kind !== "DATA_REQUEST" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "CLOSED")}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-medium text-green-800 hover:bg-green-100"
              pendingLabel="Saving..."
            >
              Close
            </InlineActionButton>
          )}
        </div>
      </div>
    </article>
  );
}

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);
  const activeStatuses: SupportRequestStatus[] = ["OPEN", "IN_PROGRESS"];
  const activeWhere = { status: { in: activeStatuses } } satisfies Prisma.SupportRequestWhereInput;
  const activeCount = await prisma.supportRequest.count({ where: activeWhere });
  const totalPages = Math.max(1, Math.ceil(activeCount / ACTIVE_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const [activeRequests, recentlyClosed] = await Promise.all([
    prisma.supportRequest.findMany({
      where: activeWhere,
      orderBy: [{ slaDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * ACTIVE_PAGE_SIZE,
      take: ACTIVE_PAGE_SIZE,
      select: SUPPORT_REQUEST_ROW_SELECT,
    }),
    prisma.supportRequest.findMany({
      where: { status: "CLOSED" },
      orderBy: [{ closedAt: "desc" }, { id: "desc" }],
      take: 20,
      select: SUPPORT_REQUEST_ROW_SELECT,
    }),
  ]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Support Requests ({activeCount} open)</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Public support and legal data requests with 45-day SLA tracking.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        {activeRequests.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
        {activeRequests.length === 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-8 text-sm text-neutral-500">
            No open support requests.
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="Open support request pagination">
          {page > 1 ? (
            <Link
              href={page === 2 ? "/admin/support" : `/admin/support?page=${page - 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-neutral-500">← Previous</span>
          )}
          <span className="text-neutral-500">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link
              href={`/admin/support?page=${page + 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 hover:bg-neutral-50"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-neutral-500">Next →</span>
          )}
        </nav>
      )}

      {recentlyClosed.length > 0 && (
        <section className="mt-8 space-y-3">
          <h2 className="text-lg font-semibold text-neutral-950">Recently closed</h2>
          {recentlyClosed.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </section>
      )}
    </main>
  );
}
