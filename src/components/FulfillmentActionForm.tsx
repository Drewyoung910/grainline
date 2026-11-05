"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readApiErrorMessage } from "@/lib/apiError";

// Posts with fetch so a refusal (an open case or dispute, a bad tracking
// number) shows here on the order page instead of a raw JSON page.
export default function FulfillmentActionForm({
  orderId,
  action,
}: {
  orderId: string;
  action: "shipped" | "ready_for_pickup";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Success answers 303 back to this page; don't follow it.
        redirect: "manual",
        body: JSON.stringify({
          action,
          trackingCarrier: form.get("trackingCarrier") ?? undefined,
          trackingNumber: form.get("trackingNumber") ?? undefined,
        }),
      });
      if (res.type !== "opaqueredirect" && !res.ok) {
        setError(await readApiErrorMessage(res, "This order could not be updated."));
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {action === "shipped" ? (
        <div className="flex flex-wrap gap-2">
          <select
            name="trackingCarrier"
            required
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="" disabled>Carrier</option>
            <option value="UPS">UPS</option>
            <option value="USPS">USPS</option>
            <option value="FedEx">FedEx</option>
            <option value="DHL">DHL</option>
            <option value="Other">Other</option>
          </select>
          <input
            name="trackingNumber"
            placeholder="Tracking number"
            required
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
          <button className="btn btn-secondary btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Mark shipped"}
          </button>
        </div>
      ) : (
        <button className="btn btn-secondary btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Mark ready for pickup"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      )}
    </form>
  );
}
