"use client";
import { useState } from "react";

export function NotificationToggle({
  type,
  enabled: initialEnabled,
}: {
  type: string;
  enabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const newValue = !enabled;
    setEnabled(newValue); // optimistic
    try {
      await fetch("/api/account/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled: newValue }),
      });
    } catch {
      setEnabled(!newValue); // revert on error
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        enabled ? "bg-neutral-900" : "bg-neutral-200"
      } ${loading ? "opacity-50" : ""}`}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
