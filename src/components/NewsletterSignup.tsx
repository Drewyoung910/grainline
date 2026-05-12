"use client";
import * as React from "react";
import { readApiErrorMessage } from "@/lib/apiError";

export default function NewsletterSignup({ heading, subheading }: { heading?: string; subheading?: string }) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, name: name.trim() || undefined }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Something went wrong. Please try again."));
      }
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="rounded-2xl bg-[#EFEAE0] px-6 py-10 sm:px-10 sm:py-12 text-center space-y-5">
      <div>
        <h3 className="text-xl sm:text-2xl font-semibold text-neutral-900">
          {heading ?? "Get workshop stories in your inbox"}
        </h3>
        <p className="text-sm text-neutral-600 mt-2 max-w-md mx-auto">
          {subheading ?? "Maker spotlights, build guides, and new pieces — straight to you."}
        </p>
      </div>

      {status === "success" ? (
        <div className="rounded-md border border-green-200 bg-white px-4 py-3 text-green-800 font-medium">
          You&apos;re on the list!
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-neutral-200 bg-[#F7F5F0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1 rounded-md border border-neutral-200 bg-[#F7F5F0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {status === "loading" ? "..." : "Subscribe"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
