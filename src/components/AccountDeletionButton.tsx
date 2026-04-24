"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useToast } from "@/components/Toast";

type Blocker = {
  code: string;
  count: number;
  message: string;
};

export function AccountDeletionButton() {
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  async function deleteAccount() {
    if (confirmText !== "DELETE") {
      toast("Type DELETE to confirm account deletion.", "error");
      return;
    }

    setPending(true);
    setBlockers([]);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        warning?: string;
        blockers?: Blocker[];
      };

      if (!res.ok) {
        setBlockers(data.blockers ?? []);
        toast(data.error ?? "Account deletion failed.", "error");
        return;
      }

      toast(data.warning ?? "Account deleted.", data.warning ? "info" : "success");
      await signOut({ redirectUrl: "/" });
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="delete-confirm" className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          autoComplete="off"
        />
      </div>

      {blockers.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Resolve these before deleting your account:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={deleteAccount}
        disabled={pending || confirmText !== "DELETE"}
        className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Deleting..." : "Delete my account"}
      </button>
    </div>
  );
}
