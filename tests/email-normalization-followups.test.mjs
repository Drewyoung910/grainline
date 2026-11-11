import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emailServiceLeastPrivilegeMigrationPath } from "./helpers/email-service-least-privilege-migration-path.mjs";

const { emailSuppressionLookupForEmails } = await import("../src/lib/emailAddressNormalization.ts");

const userClerkIdentityMigrationPath =
  process.env.USER_CLERK_IDENTITY_MIGRATION_PATH
  ?? "prisma/migrations/20261007155000_correct_user_clerk_identity_placeholder/migration.sql";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("email normalization follow-ups", () => {
  it("builds reverse Gmail alias lookup keys without changing durable account identity", () => {
    assert.deepEqual(
      emailSuppressionLookupForEmails(["First.Last+tag@gmail.com"]),
      {
        exactEmails: ["first.last+tag@gmail.com", "firstlast@gmail.com"],
        gmailLocalParts: ["firstlast"],
      },
    );

    assert.deepEqual(
      emailSuppressionLookupForEmails(["firstlast@gmail.com"]),
      {
        exactEmails: ["firstlast@gmail.com"],
        gmailLocalParts: ["firstlast"],
      },
    );

    assert.deepEqual(
      emailSuppressionLookupForEmails(["Buyer@Example.com"]),
      {
        exactEmails: ["buyer@example.com"],
        gmailLocalParts: [],
      },
    );
  });

  it("normalizes durable user emails through the suppression helper", () => {
    const ensureUser = source("src/lib/ensureUser.ts");
    const identityAuthority = source(userClerkIdentityMigrationPath);
    const deletion = source("src/lib/accountDeletion.ts");
    const emailServiceAccess = source("src/lib/emailServiceAccess.ts");
    const emailServiceMigration = source(
      emailServiceLeastPrivilegeMigrationPath(),
    );
    const newsletter = source("src/app/api/newsletter/route.ts");
    const unsubscribe = source("src/lib/unsubscribeToken.ts");
    const suppression = source("src/lib/emailSuppression.ts");
    const normalization = source("src/lib/emailAddressNormalization.ts");

    assert.match(ensureUser, /import \{ normalizeEmailAddress \} from "@\/lib\/emailSuppression"/);
    assert.match(ensureUser, /const normalizedEmail = normalizeEmailAddress\(opts\.email\)/);
    assert.match(ensureUser, /if \(normalizedEmail\) identity\.email = normalizedEmail/);
    assert.match(
      identityAuthority,
      /placeholder_email := CASE[\s\S]*p_clerk_id = pg_catalog\.lower\(p_clerk_id\)[\s\S]*pg_catalog\.md5\(p_clerk_id\)[\s\S]*'@placeholder\.invalid'/,
    );
    assert.match(deletion, /applyEmailServiceAccountDeletion\(tx, \{/);
    assert.doesNotMatch(deletion, /tx\.(?:emailOutbox|emailSuppression|emailFailureCount|newsletterSubscriber)\./);
    assert.match(emailServiceAccess, /public\.grainline_email_service_account_deletion_apply/);
    assert.match(emailServiceMigration, /grainline_user_email_fallback_addresses\(\)/);
    assert.match(emailServiceMigration, /grainline_account_deletion_email_key_core\(fallback\.email\)/);
    assert.match(newsletter, /parsed\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(unsubscribe, /email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);

    assert.match(suppression, /from "\.\/emailAddressNormalization\.ts"/);
    assert.match(suppression, /export \{ emailSuppressionAddressKeys, emailSuppressionLookupForEmails, normalizeEmailAddress, normalizeEmailSuppressionAddress \}/);
    assert.match(normalization, /function gmailSuppressionAddress\(email: string\)/);
    assert.match(normalization, /domain === "googlemail\.com" \? "gmail\.com" : domain/);
    assert.match(normalization, /local\.split\("\+"\)\[0\]\?\.replaceAll\("\.", ""\)/);
    assert.match(normalization, /export function normalizeEmailSuppressionAddress/);
    assert.match(normalization, /export function emailSuppressionAddressKeys/);
    assert.match(normalization, /export function emailSuppressionLookupForEmails/);
    assert.match(suppression, /emailSuppressionExistsAuthority\(prisma, \{ email: normalized, mode \}\)/);
    assert.match(suppression, /clearOneClickEmailSuppressionAuthority\(client, normalized\)/);
    assert.match(suppression, /const email = normalizeEmailSuppressionAddress\(opts\.email\)/);
  });
});
