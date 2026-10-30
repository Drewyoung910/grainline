"use client";

import * as React from "react";

// Set after the first page has rendered in this browser tab. Only later,
// client-side page changes play the entrance, so the first load is never
// held back by an animation.
let hasRenderedFirstPage = false;

// Page content fades and rises in on navigation while the header (in the
// root layout, outside this template) stays put.
export default function Template({ children }: { children: React.ReactNode }) {
  const [animate] = React.useState(() => hasRenderedFirstPage);
  React.useEffect(() => {
    hasRenderedFirstPage = true;
  }, []);
  return <div className={animate ? "page-enter" : undefined}>{children}</div>;
}
