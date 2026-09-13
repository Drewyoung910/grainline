import * as Sentry from "@sentry/nextjs";

export function captureProfanityFlag({
  source,
  matchCount,
  extra,
}: {
  source: string;
  matchCount: number;
  extra?: Record<string, string | number | boolean | null | undefined>;
}) {
  Sentry.captureMessage("Profanity filter flagged submitted content", {
    level: "info",
    tags: { source, moderation: "profanity" },
    extra: {
      matchCount,
      ...extra,
    },
  });
}
