import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import InlineActionButton from "@/components/InlineActionButton";
import { prisma } from "@/lib/db";
import { setSupportRequestStatus } from "./actions";

export const metadata: Metadata = { title: "Support Requests — Admin" };

type SupportRequestRow = {
  id: string;
  kind: string;
  status: string;
  name: string | null;
  email: string;
  topic: string;
  orderId: string | null;
  message: string;
  slaDueAt: Date;
  emailSentAt: Date | null;
  emailLastError: string | null;
  createdAt: Date;
};

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
                <dt className="text-xs font-medium uppercase text-neutral-500">Order/listing</dt>
                <dd className="font-mono text-xs">{request.orderId}</dd>
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
              <dd>{request.emailSentAt ? "Sent" : request.emailLastError ? "Failed" : "Pending"}</dd>
            </div>
          </dl>

          {request.emailLastError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Email error: {request.emailLastError}
            </p>
          )}

          <p className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 text-sm leading-6 text-neutral-800">
            {request.message}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:w-40 lg:flex-col">
          {request.status !== "IN_PROGRESS" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "IN_PROGRESS")}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              pendingLabel="Saving..."
            >
              In progress
            </InlineActionButton>
          )}
          {request.status !== "OPEN" && (
            <InlineActionButton
              action={setSupportRequestStatus.bind(null, request.id, "OPEN")}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              pendingLabel="Saving..."
            >
              Reopen
            </InlineActionButton>
          )}
          {request.status !== "CLOSED" && (
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

export default async function AdminSupportPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const [activeRequests, recentlyClosed] = await Promise.all([
    prisma.supportRequest.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: [{ slaDueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    }),
    prisma.supportRequest.findMany({
      where: { status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Support Requests ({activeRequests.length} open)</h1>
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
