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
        className={`text-xs px-3 py-1 border font-medium transition-colors disabled:opacity-50 ${
          banned
            ? "border-green-300 text-green-700 hover:bg-green-50"
            : "border-red-300 text-red-700 hover:bg-red-50"
        }`}
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
              className={`text-xs px-3 py-1.5 text-white disabled:opacity-50 ${
                banned ? "bg-green-700 hover:bg-green-800" : "bg-red-700 hover:bg-red-800"
              }`}
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
              className="text-xs px-3 py-1.5 border border-neutral-300 text-neutral-700 hover:bg-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
