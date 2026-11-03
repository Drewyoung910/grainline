"use client";

import * as React from "react";

// A quantity stepper shows each press at once. The first press saves right away
// and presses during that save collapse into one more, so a quick +++ counts all
// three without racing the server. A failed save drops the draft, which puts the
// saved quantity back on screen; `save` reports why.
export function useQuantitySteps(save: (itemId: string, quantity: number) => Promise<boolean>) {
  const [drafts, setDrafts] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const draftsRef = React.useRef(new Map<string, number>());
  const savingRef = React.useRef(new Set<string>());
  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  });

  const step = React.useCallback(async (itemId: string, quantity: number) => {
    draftsRef.current.set(itemId, quantity);
    setDrafts(new Map(draftsRef.current));
    if (savingRef.current.has(itemId)) return;
    savingRef.current.add(itemId);
    let saved: number | null = null;
    let ok = true;
    while (ok && draftsRef.current.get(itemId) !== saved) {
      saved = draftsRef.current.get(itemId) as number;
      ok = await saveRef.current(itemId, saved);
    }
    savingRef.current.delete(itemId);
    draftsRef.current.delete(itemId);
    setDrafts(new Map(draftsRef.current));
  }, []);

  return { drafts, step };
}
