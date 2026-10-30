"use client";

import * as React from "react";

export type SectionTab = { id: string; label: string };

// Sticky in-page section bar (Etsy-style shop navigation): every section stays
// on one page, the bar sits under the pinned header, its underline slides to
// the section being read, and tapping a tab glides to that section.
export default function SectionTabs({
  sections,
  label,
}: {
  sections: SectionTab[];
  label: string;
}) {
  const sectionKey = sections.map((section) => section.id).join("|");
  const [activeId, setActiveId] = React.useState(sections[0]?.id ?? "");
  const navRef = React.useRef<HTMLElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef(new Map<string, HTMLAnchorElement>());
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);
  // While a tab click is gliding the page, the scroll spy would flicker the
  // underline across every section it passes; hold it until the glide ends.
  const spyPausedUntilRef = React.useRef(0);

  React.useEffect(() => {
    const ids = sectionKey ? sectionKey.split("|") : [];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < spyPausedUntilRef.current) return;
      // Only a page that actually scrolled to its end lights the last tab;
      // a page too short to scroll keeps the first.
      const atBottom =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActiveId(ids[ids.length - 1]);
        return;
      }
      // The section whose top has passed a reading line just under the
      // pinned header and this bar.
      const barBottom = navRef.current?.getBoundingClientRect().bottom ?? 0;
      const readingLine = Math.max(barBottom + 24, window.innerHeight * 0.25);
      let current = ids[0];
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= readingLine) current = element.id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [sectionKey]);

  // Move the underline to the active tab and keep that tab in view when the
  // bar scrolls sideways on phones.
  React.useEffect(() => {
    const measure = () => {
      const tab = tabRefs.current.get(activeId);
      const list = listRef.current;
      if (!tab || !list) return;
      setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
      const tabStart = tab.offsetLeft;
      const tabEnd = tabStart + tab.offsetWidth;
      if (tabStart < list.scrollLeft || tabEnd > list.scrollLeft + list.clientWidth) {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        list.scrollTo({ left: Math.max(0, tabStart - 16), behavior: reduceMotion ? "auto" : "smooth" });
      }
    };
    measure();
    // Re-measure once the web font has loaded and changed the tab widths.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
    };
  }, [activeId, sectionKey]);

  const goTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    spyPausedUntilRef.current = Date.now() + (reduceMotion ? 0 : 900);
    setActiveId(id);
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // Move keyboard and screen-reader position into the section too. (The
    // URL hash is left alone: updating it re-syncs Next's router state.)
    target.focus({ preventScroll: true });
  };

  if (sections.length < 2) return null;

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className="sticky top-[var(--site-header-h)] z-30 -mx-2 border-b border-stone-200/70 bg-[#F7F5F0]/90 backdrop-blur-xl sm:-mx-4"
    >
      <div
        ref={listRef}
        className="relative flex gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:gap-2 sm:px-4 [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => (
          <a
            key={section.id}
            ref={(element) => {
              if (element) tabRefs.current.set(section.id, element);
              else tabRefs.current.delete(section.id);
            }}
            href={`#${section.id}`}
            aria-current={activeId === section.id ? "location" : undefined}
            onClick={(event) => goTo(event, section.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-3 text-[15px] font-medium transition-colors duration-200 focus-visible:outline-offset-[-3px] ${
              activeId === section.id ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            {section.label}
          </a>
        ))}
        {indicator && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-[#2C1F1A] transition-[translate,width] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
            style={{ width: indicator.width, translate: `${indicator.left}px 0` }}
          />
        )}
      </div>
    </nav>
  );
}
