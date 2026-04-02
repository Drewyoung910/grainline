import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires 'unsafe-inline' for hydration scripts; 'unsafe-eval' retained for Sentry/source-map support
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.thegrainline.com https://unpkg.com",
      // script-src-elem overrides script-src for <script> elements — list all external script hosts here
      "script-src-elem 'self' 'unsafe-inline' https://clerk.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk.thegrainline.com https://js.stripe.com https://cdnjs.cloudflare.com https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://clerk.thegrainline.com https://unpkg.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      // Drop plain http: — all legitimate image sources use HTTPS; blob:/data: retained for canvas/uploader
      "img-src 'self' data: blob: https:",
      // All XHR/fetch/WebSocket targets: Clerk, Stripe, UploadThing, Sentry, Upstash, OpenStreetMap
      "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com https://clerk.thegrainline.com https://accounts.thegrainline.com https://api.stripe.com https://hooks.stripe.com https://*.uploadthing.com https://utfs.io https://*.sentry.io https://*.ingest.sentry.io https://major-toad-67912.upstash.io https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org wss://*.clerk.accounts.dev wss://*.clerk.com wss://clerk.thegrainline.com https://unpkg.com",
      // Stripe payment iframe + Clerk account modal iframe
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com https://clerk.thegrainline.com https://accounts.thegrainline.com",
      "worker-src 'self' blob:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      // Clerk sign-in/up forms may POST to clerk domains
      "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.com",
      // Prevent this site from being embedded in foreign frames (CSP equivalent of X-Frame-Options: SAMEORIGIN)
      "frame-ancestors 'self'",
      "report-uri /api/csp-report",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
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

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

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
