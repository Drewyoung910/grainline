import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { emailSuppressionLookupForEmails } = await import("../src/lib/emailAddressNormalization.ts");

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
    const deletion = source("src/lib/accountDeletion.ts");
    const newsletter = source("src/app/api/newsletter/route.ts");
    const unsubscribe = source("src/lib/unsubscribeToken.ts");
    const suppression = source("src/lib/emailSuppression.ts");
    const normalization = source("src/lib/emailAddressNormalization.ts");

    assert.match(ensureUser, /import \{ normalizeEmailAddress \} from "@\/lib\/emailSuppression"/);
    assert.match(ensureUser, /const normalizedEmail = normalizeEmailAddress\(opts\.email\)/);
    assert.match(ensureUser, /const email =\s*normalizeEmailAddress\(opts\?\.email\) \?\? `\$\{clerkId\}@placeholder\.invalid`/);
    assert.match(deletion, /normalizeEmailSuppressionAddress\(user\.email\) \?\? user\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(deletion, /const suppressionEmailMatches =\s*accountEmailSuppressionKeys\.length > 0/s);
    assert.match(deletion, /recipientEmail: \{ in: suppressionEmailMatches \}/);
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
    assert.match(suppression, /emailSuppressionLookupForEmails\(\[email\]\)/);
    assert.match(suppression, /function emailSuppressionMatchWhereSql/);
    assert.match(suppression, /lower\(split_part\(\$\{emailColumn\}, '@', 2\)\) IN \('gmail\.com', 'googlemail\.com'\)/);
    assert.match(suppression, /replace\(split_part\(lower\(split_part\(\$\{emailColumn\}, '@', 1\)\), '\+', 1\), '\.', ''\) IN/);
    assert.match(suppression, /WHERE \$\{emailSuppressionMatchWhereSql\(lookup\)\}/);
    assert.match(suppression, /const email = normalizeEmailSuppressionAddress\(opts\.email\)/);
  });
});
