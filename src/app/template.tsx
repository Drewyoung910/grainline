"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

// Set after the first page has rendered in this browser tab. Only later,
// client-side page changes play the entrance, so the first load is never
// held back by an animation.
let hasRenderedFirstPage = false;

// Page content fades and rises in on navigation while the header (in the
// root layout, outside this template) stays put.
function PageEntrance({ children }: { children: React.ReactNode }) {
  const [animate] = React.useState(() => hasRenderedFirstPage);
  React.useEffect(() => {
    hasRenderedFirstPage = true;
  }, []);
  return <div className={animate ? "page-enter" : undefined}>{children}</div>;
}

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // A root template remounts when the first route segment changes, but not
  // necessarily for deeper navigation within that segment. Keying this small
  // boundary makes those path changes restart the entrance too. Search-param
  // changes keep the same key, so sorting and filtering do not flash.
  return <PageEntrance key={pathname}>{children}</PageEntrance>;
}
