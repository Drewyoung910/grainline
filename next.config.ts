import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

function cspOriginsFromEnv(values: Array<string | undefined>): string {
  const origins = new Set<string>();
  for (const value of values.filter(Boolean)) {
    for (const part of value!.split(",")) {
      try {
        origins.add(new URL(part.trim()).origin);
      } catch {
        // Ignore malformed optional env values.
      }
    }
  }
  return [...origins].join(" ");
}

const r2PublicOrigins = cspOriginsFromEnv([
  process.env.CLOUDFLARE_R2_PUBLIC_URL,
  process.env.R2_PUBLIC_URL,
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL,
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
  process.env.CLOUDFLARE_R2_PUBLIC_URLS,
  process.env.ALLOWED_R2_PUBLIC_URLS,
  "https://cdn.thegrainline.com",
]);
const r2ApiOrigin = process.env.CLOUDFLARE_R2_ACCOUNT_ID
  ? `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : "";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires 'unsafe-inline' for hydration scripts; 'unsafe-eval' retained for Sentry/source-map support
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.thegrainline.com",
      // script-src-elem overrides script-src for <script> elements — list all external script hosts here
      "script-src-elem 'self' 'unsafe-inline' https://clerk.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk.thegrainline.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://clerk.thegrainline.com",
      "font-src 'self' data:",
      // Image sources are limited to first-party assets, R2/CDN media, Clerk avatars, Stripe, and map tiles.
      `img-src 'self' data: blob: ${r2PublicOrigins} https://utfs.io https://ufs.sh https://*.ufs.sh https://i.postimg.cc https://img.clerk.com https://images.clerk.dev https://*.clerk.com https://*.clerk.accounts.dev https://q.stripe.com https://*.tile.openstreetmap.org https://tiles.openfreemap.org`,
      // All XHR/fetch/WebSocket targets: Clerk, Stripe, R2, Sentry, Upstash, OpenStreetMap, Maplibre tiles
      `connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com https://clerk.thegrainline.com https://accounts.thegrainline.com https://api.stripe.com https://hooks.stripe.com https://checkout.stripe.com ${r2PublicOrigins} ${r2ApiOrigin} https://*.sentry.io https://*.ingest.sentry.io https://major-toad-67912.upstash.io https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openfreemap.org wss://*.clerk.accounts.dev wss://*.clerk.com wss://clerk.thegrainline.com`,
      // Stripe payment iframe + Clerk account modal iframe + YouTube/Vimeo embeds on blog posts
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com https://clerk.thegrainline.com https://accounts.thegrainline.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "worker-src 'self' blob:",
      `media-src 'self' ${r2PublicOrigins} ${r2ApiOrigin} https://utfs.io https://ufs.sh https://*.ufs.sh`,
      "object-src 'none'",
      "base-uri 'self'",
      // Clerk sign-in/up forms may POST to clerk domains
      "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.com",
      // Prevent this site from being embedded in foreign frames (CSP equivalent of X-Frame-Options: SAMEORIGIN)
      "frame-ancestors 'self'",
      "report-to csp-endpoint",
      "report-uri /api/csp-report",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "grainline",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to reduce
  // ad-blocker loss. `/monitoring` is public in middleware.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
