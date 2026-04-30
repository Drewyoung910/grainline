"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, CheckCircle } from "@/components/icons";
import { readApiErrorMessage } from "@/lib/apiError";

type TopicOption = {
  value: string;
  label: string;
};

type Receipt = {
  requestId: string | null;
  slaDueAt: string | null;
};

type Props = {
  endpoint: string;
  topics: TopicOption[];
  submitLabel: string;
  successTitle: string;
  successMessage: string;
  includeOrderField?: boolean;
};

function fieldClass() {
  return "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200";
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function SupportRequestForm({
  endpoint,
  topics,
  submitLabel,
  successTitle,
  successMessage,
  includeOrderField = true,
}: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt>({ requestId: null, slaDueAt: null });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("loading");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          topic: formData.get("topic"),
          orderId: formData.get("orderId"),
          message: formData.get("message"),
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Could not submit your request."));
      }

      const body = (await response.json().catch(() => ({}))) as {
        requestId?: unknown;
        slaDueAt?: unknown;
      };
      setReceipt({
        requestId: typeof body.requestId === "string" ? body.requestId : null,
        slaDueAt: typeof body.slaDueAt === "string" ? body.slaDueAt : null,
      });
      form.reset();
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not submit your request.");
    }
  }

  const dueDate = formatDate(receipt.slaDueAt);

  if (status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-5 text-green-900">
        <div className="flex items-start gap-3">
          <CheckCircle size={20} className="mt-0.5 shrink-0" />
          <div className="space-y-2">
            <h2 className="text-base font-semibold">{successTitle}</h2>
            <p className="text-sm leading-6">{successMessage}</p>
            {(receipt.requestId || dueDate) && (
              <dl className="grid gap-1 text-sm">
                {receipt.requestId && (
                  <div>
                    <dt className="inline font-medium">Request ID: </dt>
                    <dd className="inline font-mono text-xs">{receipt.requestId}</dd>
                  </div>
                )}
                {dueDate && (
                  <div>
                    <dt className="inline font-medium">Response deadline: </dt>
                    <dd className="inline">{dueDate}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-neutral-800">
          Name
          <input name="name" type="text" autoComplete="name" maxLength={100} className={fieldClass()} />
        </label>

        <label className="space-y-1.5 text-sm font-medium text-neutral-800">
          Email
          <input name="email" type="email" autoComplete="email" required maxLength={254} className={fieldClass()} />
        </label>

        <label className="space-y-1.5 text-sm font-medium text-neutral-800">
          Topic
          <select name="topic" required className={fieldClass()} defaultValue={topics[0]?.value ?? "other"}>
            {topics.map((topic) => (
              <option key={topic.value} value={topic.value}>
                {topic.label}
              </option>
            ))}
          </select>
        </label>

        {includeOrderField && (
          <label className="space-y-1.5 text-sm font-medium text-neutral-800">
            Order or listing
            <input name="orderId" type="text" maxLength={80} className={fieldClass()} />
          </label>
        )}
      </div>

      <label className="mt-4 block space-y-1.5 text-sm font-medium text-neutral-800">
        Message
        <textarea
          name="message"
          rows={7}
          required
          minLength={10}
          maxLength={4000}
          className={fieldClass()}
        />
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {status === "loading" ? "Submitting..." : submitLabel}
          <ArrowRight size={16} />
        </button>
        {status === "error" && error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
