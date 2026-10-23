"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { X } from "@/components/icons";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

const ToastContext = createContext<{
  toast: (message: string, type?: ToastType) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_EVENT = "grainline:toast";
const AUTO_DISMISS_MS = 6000;

type ToastTimer = {
  timeout: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
  pausedBy: Set<"focus" | "hover">;
};

export function emitToast(message: string, type: ToastType = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ message: string; type: ToastType }>(TOAST_EVENT, {
      detail: { message, type },
    }),
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ToastTimer>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer?.timeout !== null && timer?.timeout !== undefined) {
      clearTimeout(timer.timeout);
    }
    timers.current.delete(id);
    setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id: number, delayMs: number) => {
    const existing = timers.current.get(id);
    if (existing?.timeout !== null && existing?.timeout !== undefined) {
      clearTimeout(existing.timeout);
    }
    const timeout = setTimeout(() => dismissToast(id), delayMs);
    timers.current.set(id, {
      timeout,
      remainingMs: delayMs,
      startedAt: Date.now(),
      pausedBy: existing?.pausedBy ?? new Set(),
    });
  }, [dismissToast]);

  const pauseDismiss = useCallback((id: number, reason: "focus" | "hover") => {
    const timer = timers.current.get(id);
    if (!timer) return;
    timer.pausedBy.add(reason);
    if (timer.timeout === null) return;
    clearTimeout(timer.timeout);
    timer.timeout = null;
    timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
  }, []);

  const resumeDismiss = useCallback((id: number, reason: "focus" | "hover") => {
    const timer = timers.current.get(id);
    if (!timer) return;
    timer.pausedBy.delete(reason);
    if (timer.pausedBy.size > 0 || timer.timeout !== null) return;
    scheduleDismiss(id, timer.remainingMs);
  }, [scheduleDismiss]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (type !== "error") scheduleDismiss(id, AUTO_DISMISS_MS);
  }, [scheduleDismiss]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) {
        if (timer.timeout !== null) clearTimeout(timer.timeout);
      }
      activeTimers.clear();
    };
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: ToastType }>).detail;
      if (!detail?.message) return;
      toast(detail.message, detail.type ?? "info");
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [toast]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed left-4 right-4 top-[calc(1rem+env(safe-area-inset-top))] z-[9999] space-y-2 pointer-events-none sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:top-auto"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            onMouseEnter={() => pauseDismiss(t.id, "hover")}
            onMouseLeave={() => resumeDismiss(t.id, "hover")}
            onFocus={() => pauseDismiss(t.id, "focus")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) resumeDismiss(t.id, "focus");
            }}
            className={`pointer-events-auto flex animate-slide-down items-center gap-2 rounded-md py-1.5 pl-4 pr-1.5 text-sm font-medium shadow-lg sm:min-w-72 ${
              t.type === "error"
                ? "bg-red-600 text-white"
                : t.type === "success"
                  ? "bg-green-600 text-white"
                  : "bg-neutral-900 text-white"
            }`}
          >
            <span className="min-w-0 flex-1 py-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Dismiss message"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
