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

    assert.match(ensureUser, /import \{ normalizeEmailAddress \} from "@\/lib\/emailSuppression"/);
    assert.match(ensureUser, /const normalizedEmail = normalizeEmailAddress\(opts\.email\)/);
    assert.match(ensureUser, /const email = normalizeEmailAddress\(opts\?\.email\) \?\? `\$\{clerkId\}@placeholder\.invalid`/);
    assert.match(deletion, /const suppressionEmail = normalizeEmailAddress\(user\.email\) \?\? user\.email\.trim\(\)\.toLowerCase\(\)/);
    assert.match(newsletter, /parsed\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(unsubscribe, /email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
  });
});
