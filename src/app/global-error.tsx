"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Replaces the root layout when it fails, so the site CSS may not be loaded.
// Everything here is inline-styled with the design tokens (cream page,
// Georgia heading, espresso action) and links home with a plain <a>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | Grainline</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F5F0",
          color: "#171717",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "2rem",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "28rem" }}>
          <h1
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              letterSpacing: "-0.025em",
              fontSize: "1.875rem",
              lineHeight: 1.2,
              fontWeight: 600,
              margin: "0 0 0.5rem",
            }}
          >
            Something splintered.
          </h1>
          <p style={{ color: "#737373", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
            Something went wrong on our end. Try again, or head back to the homepage.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                border: "1px solid #e5e5e5",
                background: "#ffffff",
                color: "#171717",
                fontSize: "0.875rem",
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* Plain anchor: a full page load rebuilds the failed root layout. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                boxSizing: "border-box",
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                background: "#2C1F1A",
                color: "#ffffff",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
