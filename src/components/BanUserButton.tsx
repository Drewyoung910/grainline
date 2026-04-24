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
  const { toast } = useToast();

  async function handleToggle() {
    const reason = window.prompt(
      banned
        ? `Reason for unbanning ${userName}:`
        : `Reason for banning ${userName}:`
    );
    if (!reason?.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: banned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setBanned(!banned);
      } else {
        const data = await res.json();
        toast(data.error || "Failed", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`text-xs px-3 py-1 border font-medium transition-colors disabled:opacity-50 ${
        banned
          ? "border-green-300 text-green-700 hover:bg-green-50"
          : "border-red-300 text-red-700 hover:bg-red-50"
      }`}
    >
      {loading ? "..." : banned ? "Unban" : "Ban"}
    </button>
  );
}
