"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { X } from "@/components/icons";

type ToastType = "success" | "error" | "info";

// An optional single action shown inside the toast ("View cart", "Undo").
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = { action?: ToastAction };

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
  // Set while the toast slides back down before it is removed.
  leaving?: boolean;
};

const ToastContext = createContext<{
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void;
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

export function emitToast(message: string, type: ToastType = "info", options?: ToastOptions) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ message: string; type: ToastType; action?: ToastAction }>(TOAST_EVENT, {
      detail: { message, type, action: options?.action },
    }),
  );
}

// Without motion (reduced-motion users, or no matchMedia) a dismissed toast
// is removed at once; otherwise it plays its exit and is removed when that
// animation ends, so no timer outlives the toast.
function exitAnimates() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ToastTimer>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id));
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer?.timeout !== null && timer?.timeout !== undefined) {
      clearTimeout(timer.timeout);
    }
    timers.current.delete(id);
    if (!exitAnimates()) {
      removeToast(id);
      return;
    }
    setToasts((prev) => prev.map((toastItem) => (toastItem.id === id ? { ...toastItem, leaving: true } : toastItem)));
  }, [removeToast]);

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

  const toast = useCallback((message: string, type: ToastType = "info", options?: ToastOptions) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type, action: options?.action }]);
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
      const detail = (event as CustomEvent<{ message?: string; type?: ToastType; action?: ToastAction }>).detail;
      if (!detail?.message) return;
      toast(detail.message, detail.type ?? "info", detail.action ? { action: detail.action } : undefined);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [toast]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Espresso pills that spring up at the bottom centre, newest nearest
          the edge. Errors stay until dismissed and carry a red marker. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[9999] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) =>
          t.leaving ? (
            <div
              key={t.id}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) removeToast(t.id);
              }}
              className="toast-pill toast-pill-leaving pointer-events-none flex max-w-full items-center gap-1 rounded-full bg-[#2C1F1A] py-[3px] pl-[18px] pr-[3px] text-[15px] text-[#FBF8F3]"
            >
              <span className="min-w-0 flex-1 py-[9px]">{t.message}</span>
              <span className="h-11 w-11 shrink-0" />
            </div>
          ) : (
            <div
              key={t.id}
              role={t.type === "error" ? "alert" : "status"}
              onMouseEnter={() => pauseDismiss(t.id, "hover")}
              onMouseLeave={() => resumeDismiss(t.id, "hover")}
              onFocus={() => pauseDismiss(t.id, "focus")}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) resumeDismiss(t.id, "focus");
              }}
              className="toast-pill pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-[#2C1F1A] py-[3px] pl-[18px] pr-[3px] text-[15px] text-[#FBF8F3]"
            >
              <span
                className={`min-w-0 flex-1 py-[9px] ${
                  t.type === "error"
                    ? "before:mr-2 before:inline-block before:h-2 before:w-2 before:rounded-full before:bg-[#F08A73] before:align-middle before:content-['']"
                    : ""
                }`}
              >
                {t.message}
              </span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismissToast(t.id);
                  }}
                  className="group/toast-action inline-flex h-11 shrink-0 items-center px-0.5 focus-visible:outline-none"
                >
                  <span className="inline-flex h-[30px] items-center rounded-full bg-white/[0.14] px-3 text-sm font-medium transition-colors group-hover/toast-action:bg-white/25 group-focus-visible/toast-action:outline-2 group-focus-visible/toast-action:outline-offset-2 group-focus-visible/toast-action:outline-[#FBF8F3]">
                    {t.action.label}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="group/toast-close grid h-11 w-11 shrink-0 place-items-center focus-visible:outline-none"
                aria-label="Dismiss message"
              >
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/10 text-[#FBF8F3]/85 transition-colors group-hover/toast-close:bg-white/20 group-hover/toast-close:text-[#FBF8F3] group-focus-visible/toast-close:outline-2 group-focus-visible/toast-close:outline-offset-2 group-focus-visible/toast-close:outline-[#FBF8F3]">
                  <X size={14} />
                </span>
              </button>
            </div>
          ),
        )}
      </div>
    </ToastContext.Provider>
  );
}
