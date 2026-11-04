"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import ConversationRail from "@/components/ConversationRail";

function isThreadPath(pathname: string): boolean {
  return /^\/messages\/(?!new(\/|$))[^/]+/.test(pathname);
}

// A thread sits beside the conversation list on desktop. On phones, opening a
// conversation from the inbox slides the thread over it. Only that one step
// animates: a reload or coming back to a thread appears at once.
export default function MessagesShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isThread = isThreadPath(pathname);
  const previousPathRef = React.useRef(pathname);
  const threadRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const cameFromInbox = previousPathRef.current === "/messages" && isThread;
    previousPathRef.current = pathname;
    const element = threadRef.current;
    if (
      !cameFromInbox
      || !element?.animate
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || window.matchMedia("(min-width: 1024px)").matches
    ) {
      return;
    }
    element.animate(
      [{ transform: "translateX(28px)", opacity: 0.4 }, { transform: "none", opacity: 1 }],
      { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [isThread, pathname]);

  if (!isThread) return <>{children}</>;
  return (
    <div className="mx-auto w-full max-w-[1280px] overflow-x-clip lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-6">
      <ConversationRail />
      <div ref={threadRef} className="min-w-0">{children}</div>
    </div>
  );
}
