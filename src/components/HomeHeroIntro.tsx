"use client";

import * as React from "react";

// A fresh visit gets one restrained copy entrance. Module state survives
// client navigation, so Back/logo navigation does not replay the whole hero;
// a real reload or new tab intentionally starts a new visit.
let introPlayed = false;

export default function HomeHeroIntro({ children }: { children: React.ReactNode }) {
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
