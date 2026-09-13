// src/app/opengraph-image.tsx
// Auto-generates /opengraph-image.png for the root layout OG image.
// Individual pages with generateMetadata override this automatically.
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Grainline — Handmade Woodworking Marketplace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #FEF3C7 0%, #F7F5F0 50%, #E7E3DC 100%)",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* Decorative grain lines */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.04,
            background:
              "repeating-linear-gradient(0deg, transparent, transparent 3px, #2C1F1A 3px, #2C1F1A 4px)",
          }}
        />

        {/* Logo wordmark */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#2C1F1A",
            letterSpacing: "-0.025em",
            marginBottom: 16,
          }}
        >
          Grainline
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: "#6B5748",
            letterSpacing: "0.02em",
            marginBottom: 40,
          }}
        >
          Handmade Woodworking Marketplace
        </div>

        {/* Divider */}
        <div
          style={{
            width: 80,
            height: 3,
            background: "#D97706",
            marginBottom: 40,
          }}
        />

        {/* Sub-tagline */}
        <div
          style={{
            fontSize: 20,
            color: "#92816D",
          }}
        >
          Discover unique pieces from local artisans
        </div>
      </div>
    ),
    { ...size }
  );
}
