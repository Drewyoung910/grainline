"use client";
import * as React from "react";

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
      if (!res.ok) throw new Error();
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-100 px-6 py-8 text-center space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-neutral-900">
          {heading ?? "Get workshop stories in your inbox"}
        </h3>
        <p className="text-sm text-neutral-600 mt-1">
          {subheading ?? "Maker spotlights, build guides, and new pieces — straight to you."}
        </p>
      </div>

      {status === "success" ? (
        <div className="rounded-xl bg-white border border-green-200 px-4 py-3 text-green-800 font-medium">
          You&apos;re on the list! 🎉
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 flex-1"
          />
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 flex-1"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60 shrink-0"
          >
            {status === "loading" ? "..." : "Subscribe"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
