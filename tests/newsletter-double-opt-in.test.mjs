import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("newsletter double opt-in guardrails", () => {
  it("stores public newsletter signups as inactive pending confirmations", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260530190000_newsletter_double_opt_in/migration.sql");
    const route = source("src/app/api/newsletter/route.ts");
    const component = source("src/components/NewsletterSignup.tsx");

    assert.match(schema, /active\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /confirmedAt\s+DateTime\?/);
    assert.match(schema, /confirmationTokenHash\s+String\?\s+@db\.VarChar\(64\)/);
    assert.match(schema, /confirmationExpiresAt\s+DateTime\?/);
    assert.match(schema, /confirmationSentAt\s+DateTime\?/);
    assert.match(migration, /SET "confirmedAt" = "subscribedAt"/);
    assert.match(migration, /ALTER COLUMN "active" SET DEFAULT false/);

    assert.match(route, /sendNewsletterConfirmationEmail\(\{ email, confirmationUrl \}, \{ throwOnFailure: true \}\)/);
    assert.match(route, /active: false/);
    assert.match(route, /NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS/);
    assert.match(route, /const reservedSentAt = new Date\(\)/);
    assert.match(route, /confirmationSentAt: \{ lte: resendCutoff \}/);
    assert.match(route, /confirmationTokenHash: tokenHash/);
    assert.match(route, /confirmationSentAt: reservedSentAt/);
    assert.match(route, /confirmationRequired: true/);
    assert.match(route, /isUniqueConstraintError/);
    assert.match(route, /clearReservedNewsletterConfirmation\(email, tokenHash, emailHash\)/);
    assert.doesNotMatch(route, /newsletterSubscriber\.upsert/);
    assert.doesNotMatch(route, /create: \{ email, name, active: true \}/);
    assert.doesNotMatch(route, /update: \{ name: name \?\? undefined, active: true \}/);
    assert.match(component, /Check your email to confirm your subscription\./);
  });

  it("confirms subscriptions only through POST and clears pending tokens", () => {
    const route = source("src/app/api/newsletter/confirm/route.ts");
    const getHandler = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST"),
    );

    assert.match(route, /export async function GET\(req: NextRequest\)/);
    assert.match(getHandler, /return confirmationResponse\(validated\.token\)/);
    assert.doesNotMatch(getHandler, /active: true/);
    assert.match(route, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(route, /safeRateLimit\(newsletterRatelimit, `newsletter-confirm:\$\{getIP\(req\)\}`\)/);
    assert.match(route, /readBoundedText\(req, NEWSLETTER_CONFIRM_FORM_BODY_MAX_BYTES\)/);
    assert.match(route, /new URLSearchParams\(await readBoundedText\(req, NEWSLETTER_CONFIRM_FORM_BODY_MAX_BYTES\)\)/);
    assert.doesNotMatch(route, /await req\.formData\(\)/);
    assert.match(route, /import \{ clearOneClickEmailSuppression \} from "@\/lib\/emailSuppression"/);
    assert.match(route, /select: \{ id: true, email: true, confirmationTokenHash: true \}/);
    assert.match(route, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(route, /updateMany\(\{[\s\S]*?active: true,[\s\S]*?confirmedAt: now,[\s\S]*?confirmationTokenHash: null,[\s\S]*?confirmationExpiresAt: null,[\s\S]*?confirmationSentAt: null,/);
    assert.match(route, /clearOneClickEmailSuppression\(subscriber\.email, tx\)/);
    assert.doesNotMatch(route, /token:\s*validated\.token/);
  });

  it("clears pending newsletter confirmation tokens on unsubscribe or suppression", () => {
    const unsubscribe = source("src/lib/unsubscribe.ts");
    const suppression = source("src/lib/emailSuppression.ts");
    const exportRoute = source("src/app/api/account/export/route.ts");

    for (const text of [unsubscribe, suppression]) {
      assert.match(text, /active: false/);
      assert.match(text, /confirmationTokenHash: null/);
      assert.match(text, /confirmationExpiresAt: null/);
      assert.match(text, /confirmationSentAt: null/);
    }

    assert.match(exportRoute, /confirmedAt: true/);
    assert.match(exportRoute, /confirmationSentAt: true/);
    assert.doesNotMatch(exportRoute, /confirmationTokenHash: true/);
  });
});
