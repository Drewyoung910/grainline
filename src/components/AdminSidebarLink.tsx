// src/components/AdminSidebarLink.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAdminNavItemActive } from "@/lib/adminNavState";

// Desktop admin sidebar link. The admin layout is a server component without
// the pathname, so this small client wrapper marks the current section with
// the same matching rule as the mobile tab strip.
export default function AdminSidebarLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = isAdminNavItemActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${className} ${
        active ? "bg-[#2C1F1A] text-white" : "text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {children}
    </Link>
  );
}
