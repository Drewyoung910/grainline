"use client";

import * as React from "react";

// A fresh visit gets one restrained copy entrance. Module state survives
// client navigation, so Back/logo navigation does not replay the whole hero;
// a real reload or new tab intentionally starts a new visit.
let introPlayed = false;

export default function HomeHeroIntro({ children }: { children: React.ReactNode }) {
  // Keep server markup deterministic. A module-scoped flag on the server can
  // outlive one request and would otherwise make the entrance disappear for
  // later visitors handled by the same warm process.
  const [animate, setAnimate] = React.useState(false);

  React.useLayoutEffect(() => {
    if (introPlayed) return;
    introPlayed = true;
    setAnimate(true);
  }, []);

  return (
    <div className={`w-full max-w-[630px]${animate ? " home-hero-intro" : ""}`}>
      {children}
    </div>
  );
}
