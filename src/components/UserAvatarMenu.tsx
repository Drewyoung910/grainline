// src/components/UserAvatarMenu.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";

interface Props {
  name: string | null;
  imageUrl: string | null;
  avatarImageUrl: string | null;
  role: string | null;
  hasSeller: boolean;
}

export default function UserAvatarMenu({ name, imageUrl, avatarImageUrl, role, hasSeller }: Props) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { signOut, openUserProfile } = useClerk();
  const { user: clerkUser } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  // Close on navigation
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Click outside to close
  React.useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Escape to close
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const avatarSrc = avatarImageUrl ?? imageUrl ?? clerkUser?.imageUrl ?? null;
  const displayName = name ?? "Account";
  const isAdmin = role === "ADMIN" || role === "EMPLOYEE";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full overflow-hidden h-8 w-8 bg-transparent border-0 p-0 cursor-pointer block"
        aria-label="Account menu"
        aria-expanded={open}
      >
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarSrc} alt={displayName} className="h-8 w-8 rounded-full object-cover block" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-neutral-200 flex items-center justify-center">
            <span className="text-sm font-medium text-neutral-600 select-none">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border bg-white shadow-lg z-50">
          {/* Header — avatar + name */}
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-200 shrink-0 flex items-center justify-center">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt={displayName} className="h-full w-full object-cover rounded-full" />
              ) : (
                <span className="text-sm font-medium text-neutral-600 select-none">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="text-sm font-medium text-neutral-900 truncate">{displayName}</span>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/account"
              className="flex items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
              onClick={() => setOpen(false)}
            >
              My Account
            </Link>
            {hasSeller && (
              <Link
                href="/dashboard"
                className="flex items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                Workshop
              </Link>
            )}
            <Link
              href="/account/feed"
              className="flex items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
              onClick={() => setOpen(false)}
            >
              Your Feed
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="flex items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                Admin
              </Link>
            )}
            <div className="border-t my-1" />

            <button
              type="button"
              onClick={() => { openUserProfile(); setOpen(false); }}
              className="flex w-full items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              Manage Account
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signOut(() => router.push("/"));
              }}
              className="flex w-full items-center px-4 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
