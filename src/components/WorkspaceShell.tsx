"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { workspaceKindForPath } from "@/lib/workspaceNav";

// The two-column frame around Workshop and My account pages. Those pages keep
// their own <main>; the frame supplies the side gutters, so it lines each page
// up with the column instead of centering it inside.
export default function WorkspaceShell({
  workshopSidebar,
  accountSidebar,
  children,
}: {
  workshopSidebar?: React.ReactNode;
  accountSidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const kind = workspaceKindForPath(usePathname());
  if (!kind) return <>{children}</>;
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10 lg:px-8">
      <div className="min-w-0">{kind === "workshop" ? workshopSidebar : accountSidebar}</div>
      <div className="min-w-0 [&>main]:mx-0 [&>main]:px-0 [&>main]:pb-12 [&>main]:pt-6 lg:[&>main]:pt-8">
        {children}
      </div>
    </div>
  );
}
