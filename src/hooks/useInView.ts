// src/hooks/useInView.ts
"use client";
import { useEffect, useRef, useState } from "react";

export function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasObserved, setHasObserved] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setHasObserved(true);
      setInView(true);
      return;
    }
    let firstReport = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setHasObserved(true);
        // A section already peeking in when the page appears counts as seen;
        // otherwise a strip under the threshold fades out and sinks after load.
        if (entry.isIntersecting || (firstReport && entry.intersectionRatio > 0)) {
          setInView(true);
          observer.disconnect();
        }
        firstReport = false;
      },
      { threshold: 0.08, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, hasObserved, inView };
}
