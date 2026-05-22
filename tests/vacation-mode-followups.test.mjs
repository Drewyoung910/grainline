import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("vacation mode follow-up guardrails", () => {
  it("accepts native date-input values and sanitizes buyer-facing vacation messages", () => {
    const route = source("src/app/api/seller/vacation/route.ts");

    assert.match(route, /vacationReturnDate: z\.string\(\)\.max\(40\)\.optional\(\)\.nullable\(\)/);
    assert.match(route, /new Date\(`\$\{trimmed\}T12:00:00\.000Z`\)/);
    assert.match(route, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
    assert.match(route, /truncateText\(sanitizeText\(vacParsed\.vacationMessage\), 200\)/);
    assert.doesNotMatch(route, /vacationMessage = vacParsed\.vacationMessage\?\.trim\(\)/);
  });

  it("lets sellers cancel pending vacation enablement from the switch itself", () => {
    const form = source("src/app/dashboard/seller/VacationModeForm.tsx");

    assert.match(form, /checked=\{enabled \|\| pendingEnable\}/);
    assert.match(form, /if \(showWarning\) \{\s*if \(!checked\) cancelEnable\(\);\s*return;\s*\}/s);
    assert.match(form, /disabled=\{isPending \|\| showWarning\}/);
  });
});
