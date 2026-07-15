// src/components/UserAvatarMenu.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { clearSignedOutLocalAccountState } from "@/lib/localAccountState";
import { avatarInitial } from "@/lib/avatarInitials";
import IconHoverTip from "@/components/IconHoverTip";

interface Props {
  name: string | null;
  imageUrl: string | null;
  avatarImageUrl: string | null;
  role: string | null;
  hasSeller: boolean;
  dropDirection?: "down" | "up"; // default "down"
  overlay?: boolean;
}

export default function UserAvatarMenu({
  name,
  imageUrl,
  avatarImageUrl,
  role,
  hasSeller,
  dropDirection = "down",
  overlay = false,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  // Animated close, matching the bell + mobile menu popovers.
  const closeTimerRef = React.useRef<number | null>(null);
  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const closeMenu = React.useCallback(() => {
    if (!open) return;
    setClosing((alreadyClosing) => {
      if (alreadyClosing) return alreadyClosing;
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
        closeTimerRef.current = null;
      }, 160);
      return true;
    });
  }, [open]);
  const openMenu = React.useCallback(() => {
    clearCloseTimer();
    setClosing(false);
    setOpen(true);
  }, [clearCloseTimer]);
  React.useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);
  const popoverId = React.useId();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { signOut, openUserProfile } = useClerk();
  const pathname = usePathname();

  // Close on navigation
  React.useEffect(() => {
    clearCloseTimer();
    setOpen(false);
    setClosing(false);
  }, [pathname, clearCloseTimer]);

  // Click outside to close
  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, closeMenu]);

  // Escape to close
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeMenu]);

  React.useEffect(() => {
    if (!open) return;
    function onFocusIn(e: FocusEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, closeMenu]);

  const handleOpenUserProfile = React.useCallback(() => {
    try {
      openUserProfile({
        appearance: {
          elements: { rootBox: "cl-rootBox", card: "cl-card" },
          variables: { colorBackground: "#ffffff" },
        },
      });
      closeMenu();
    } catch (error) {
      console.warn("[user-avatar-menu] open user profile failed", error);
    }
  }, [openUserProfile, closeMenu]);

  const handleSignOut = React.useCallback(async () => {
    closeMenu();
    try {
      await signOut({ redirectUrl: "/" });
      clearSignedOutLocalAccountState();
    } catch (error) {
      console.warn("[user-avatar-menu] sign out failed", error);
    }
  }, [signOut, closeMenu]);

  const avatarSrc = avatarImageUrl ?? imageUrl ?? null;
  const displayName = name ?? "Account";
  const isAdmin = role === "ADMIN" || role === "EMPLOYEE";
  const accountSurfaceClass = overlay
    ? "border border-white/30 bg-[#F7F5F0]/58 ring-1 ring-white/20 backdrop-blur-xl"
    : "ring-1 ring-black/5 bg-white";
  const accountHeaderClass = overlay
    ? "border-b border-[#2C1F1A]/[0.12] bg-[#EFEAE0]/30"
    : "bg-[#EFEAE0] border-b border-stone-200/60";
  const accountItemHoverClass = overlay
    ? "hover:bg-white/20"
    : "hover:bg-neutral-50";
  const accountSeparatorClass = overlay
    ? "border-[#2C1F1A]/10"
    : "border-neutral-100";

  return (
    <div ref={menuRef} className="relative group">
      {!open && <IconHoverTip label="Account" />}
      <button
        onClick={() => (open ? closeMenu() : openMenu())}
        className="block h-8 w-8 cursor-pointer overflow-hidden rounded-full bg-transparent p-0 ring-1 ring-black/10 hover:ring-2 hover:ring-black/20 shadow-sm hover:shadow-md transition-all"
        style={{ borderRadius: "9999px" }}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
      >
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarSrc} alt={displayName} className="block h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200">
            <span className="text-sm font-medium text-neutral-600 select-none">
              {avatarInitial(displayName)}
            </span>
          </div>
        )}
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Account"
          data-home-account-surface={overlay ? "true" : undefined}
          className={`absolute right-0 z-[200] w-52 overflow-hidden rounded-2xl text-neutral-900 shadow-2xl motion-reduce:animate-none ${accountSurfaceClass} ${closing ? "animate-menu-out pointer-events-none" : "animate-menu-in"} ${dropDirection === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {/* Header — avatar + name */}
          <div className={`flex items-center gap-3 px-4 py-3 ${accountHeaderClass}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 ring-1 ring-neutral-200 shadow-sm">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt={displayName} className="h-full w-full object-cover rounded-full" />
              ) : (
                <span className="text-sm font-medium text-neutral-600 select-none">
                  {avatarInitial(displayName)}
                </span>
              )}
            </div>
            <span className="text-sm font-medium text-neutral-900 truncate">{displayName}</span>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {!hasSeller && (
              <Link
                href="/dashboard"
                className={`flex items-center px-4 py-2.5 text-sm font-medium text-neutral-900 ${accountItemHoverClass}`}
                onClick={closeMenu}
              >
                Start Selling
              </Link>
            )}
            <Link
              href="/account"
              className={`flex items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
              onClick={closeMenu}
            >
              My Account
            </Link>
            {hasSeller && (
              <Link
                href="/dashboard"
                className={`flex items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
                onClick={closeMenu}
              >
                Workshop
              </Link>
            )}
            <Link
              href="/account/feed"
              className={`flex items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
              onClick={closeMenu}
            >
              Your Feed
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className={`flex items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
                onClick={closeMenu}
              >
                Admin
              </Link>
            )}
            <div className={`my-1 border-t ${accountSeparatorClass}`} />

            <button
              type="button"
              onClick={handleOpenUserProfile}
              className={`flex w-full items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
            >
              Manage Account
            </button>

            <button
              type="button"
              onClick={() => {
                void handleSignOut();
              }}
              className={`flex w-full items-center px-4 py-2.5 text-sm text-neutral-800 ${accountItemHoverClass}`}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
