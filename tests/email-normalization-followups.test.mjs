import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("email normalization follow-ups", () => {
  it("normalizes durable user emails through the suppression helper", () => {
    const ensureUser = source("src/lib/ensureUser.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const newsletter = source("src/app/api/newsletter/route.ts");
    const unsubscribe = source("src/lib/unsubscribeToken.ts");
    const suppression = source("src/lib/emailSuppression.ts");

    assert.match(ensureUser, /import \{ normalizeEmailAddress \} from "@\/lib\/emailSuppression"/);
    assert.match(ensureUser, /const normalizedEmail = normalizeEmailAddress\(opts\.email\)/);
    assert.match(ensureUser, /const email = normalizeEmailAddress\(opts\?\.email\) \?\? `\$\{clerkId\}@placeholder\.invalid`/);
    assert.match(deletion, /normalizeEmailSuppressionAddress\(user\.email\) \?\? user\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(deletion, /const suppressionEmailKeys = emailSuppressionAddressKeys\(user\.email\)/);
    assert.match(deletion, /recipientEmail: \{ in: suppressionEmailMatches \}/);
    assert.match(newsletter, /parsed\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(unsubscribe, /email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);

    assert.match(suppression, /function gmailSuppressionAddress\(email: string\)/);
    assert.match(suppression, /domain === "googlemail\.com" \? "gmail\.com" : domain/);
    assert.match(suppression, /local\.split\("\+"\)\[0\]\?\.replaceAll\("\.", ""\)/);
    assert.match(suppression, /export function normalizeEmailSuppressionAddress/);
    assert.match(suppression, /export function emailSuppressionAddressKeys/);
    assert.match(suppression, /where: \{ email: \{ in: emails \} \}/);
    assert.match(suppression, /const email = normalizeEmailSuppressionAddress\(opts\.email\)/);
  });
});
