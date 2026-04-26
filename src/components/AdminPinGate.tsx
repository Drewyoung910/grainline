"use client";

import { useEffect, useState } from "react";

export default function AdminPinGate({
  children,
  initialVerified = false,
}: {
  children?: React.ReactNode;
  initialVerified?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [verified, setVerified] = useState(initialVerified);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);

  const locked = Boolean(lockoutUntil && Date.now() < lockoutUntil);
  const lockoutSeconds = lockoutUntil ? Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000)) : 0;
  const lockoutMinutes = Math.max(1, Math.ceil(lockoutSeconds / 60));

  useEffect(() => {
    if (!lockoutUntil) return;
    const id = window.setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
        setAttempts(0);
        setError(null);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  if (verified) return <>{children}</>;

  async function handleVerify() {
    if (locked) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setVerified(true);
        window.location.reload();
      } else if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const until = Number.isFinite(retryAfter) && retryAfter > 0
          ? Date.now() + retryAfter * 1000
          : Date.now() + 15 * 60 * 1000;
        setLockoutUntil(until);
        setError(`Too many attempts. Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 60000))} minutes.`);
      } else if (res.status === 503) {
        setError("Admin PIN is not configured.");
      } else {
        setAttempts((a) => a + 1);
        setError("Incorrect PIN");
        setPin("");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5F0]">
      <div className="card-section p-8 max-w-sm w-full space-y-4">
        <h1 className="text-lg font-semibold text-center font-display">Admin Access</h1>
        <p className="text-sm text-neutral-500 text-center">
          Enter your admin PIN to continue
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pin.length >= 4) handleVerify();
          }}
          placeholder="------"
          disabled={locked}
          className="w-full border border-neutral-200 rounded-md px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono disabled:opacity-50"
          autoFocus
        />
        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}
        {locked && (
          <p className="text-sm text-red-600 text-center">
            Too many incorrect attempts. Try again in {lockoutMinutes} minute{lockoutMinutes === 1 ? "" : "s"}.
          </p>
        )}
        <button
          onClick={handleVerify}
          disabled={pin.length < 4 || locked || loading}
          className="w-full rounded-md bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
        <p className="text-xs text-neutral-400 text-center">
          {locked ? "Locked by server rate limit" : `${Math.max(0, 5 - attempts)} attempts remaining`}
        </p>
      </div>
    </div>
  );
}
