"use client";

import * as React from "react";

// A fresh visit gets one restrained copy entrance. Module state survives
// client navigation, so Back/logo navigation does not replay the whole hero;
// a real reload or new tab intentionally starts a new visit.
let introPlayed = false;

export default function HomeHeroIntro({ children }: { children: React.ReactNode }) {
  // Render the entrance class in the first HTML paint. Adding it after
  // hydration made the already-visible copy blink out on slow phones. The
  // client-only module flag suppresses replays during soft navigation; it is
  // never mutated by the server, so separate requests stay deterministic.
  const [animate] = React.useState(() => !introPlayed);

  React.useEffect(() => {
    introPlayed = true;
  }, []);

  return (
    <div className={`w-full max-w-[630px]${animate ? " home-hero-intro" : ""}`}>
      {children}
    </div>
  );
}
