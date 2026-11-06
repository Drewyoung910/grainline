"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";

export function BanUserButton({
  userId,
  isBanned,
  userName,
}: {
  userId: string;
  isBanned: boolean;
  userName: string;
}) {
  const [banned, setBanned] = useState(isBanned);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  async function handleToggle() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast(`Add a reason before ${banned ? "unbanning" : "banning"} this user.`, "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: banned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmedReason }),
      });
      if (res.ok) {
        // An unban can succeed while the shop stays offline. Staff must see that.
        const data = await res.json().catch(() => null) as { warning?: string } | null;
        if (data?.warning) toast(data.warning, "info");
        setBanned(!banned);
        setOpen(false);
        setReason("");
      } else {
        const data = await res.json();
        toast(data.error || "Failed", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={loading}
        className={`btn btn-sm ${banned ? "btn-success" : "btn-danger"}`}
      >
        {banned ? "Unban" : "Ban"}
      </button>

      {open && (
        <form
          className={`space-y-2 rounded border p-2 ${
            banned ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
          }`}
          onSubmit={(event) => {
            event.preventDefault();
            void handleToggle();
          }}
        >
          <label
            className={`block text-xs font-medium ${banned ? "text-green-900" : "text-red-900"}`}
            htmlFor={`ban-reason-${userId}`}
          >
            {banned ? `Reason for unbanning ${userName}` : `Reason for banning ${userName}`}
          </label>
          <textarea
            id={`ban-reason-${userId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={3}
            className={`w-full rounded border bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 ${
              banned
                ? "border-green-200 focus:ring-green-200"
                : "border-red-200 focus:ring-red-200"
            }`}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className={`btn btn-sm ${banned ? "btn-success-solid" : "btn-danger-solid"}`}
            >
              {loading ? "..." : banned ? "Confirm unban" : "Confirm ban"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setOpen(false);
                setReason("");
              }}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
