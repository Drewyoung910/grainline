"use client";

import { useState, useEffect } from "react";

export default function AdminPinGate({ children }: { children: React.ReactNode }) {
  const [pin, setPin] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState(0);

  // Check if already verified this session
  useEffect(() => {
    const v = sessionStorage.getItem("admin-pin-verified");
    if (v === "1") setVerified(true);
    setLoading(false);
  }, []);

  if (loading) return null;
  if (verified) return <>{children}</>;

  const locked = attempts >= 5;

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
        sessionStorage.setItem("admin-pin-verified", "1");
        setVerified(true);
      } else if (res.status === 429) {
        setError("Too many attempts. Try again later.");
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
            Too many incorrect attempts. Refresh and try again.
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
          {5 - attempts} attempts remaining
        </p>
      </div>
    </div>
  );
}
