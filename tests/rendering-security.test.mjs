import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { safeJsonLd } from "../src/lib/json-ld.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

function sourceFiles() {
  return execFileSync("find", ["src", "-type", "f", "(", "-name", "*.tsx", "-o", "-name", "*.ts", ")"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
}

describe("rendering security guardrails", () => {
  it("escapes JSON-LD script breakouts", () => {
    const serialized = safeJsonLd({
      name: "</script><script>alert(1)</script>",
      commentStart: "<!--",
      cdataEnd: "]]>",
      bidi: "safe\u202Egpj.exe",
    });
    assert.doesNotMatch(serialized, /<\/script/i);
    assert.match(serialized, /\\u003c\/script/);
    assert.match(serialized, /\\u003c!--/);
    assert.match(serialized, /]]>/);
    assert.match(serialized, /safe\\u202egpj\.exe/i);
  });

  it("keeps blog markdown behind sanitize-html with narrow schemes and image filtering", () => {
    const markdown = source("src/lib/blogMarkdown.ts");

    assert.match(markdown, /sanitizeHtml\(rawHtml/);
    assert.match(markdown, /allowedSchemes: \["https", "mailto"\]/);
    assert.match(markdown, /exclusiveFilter/);
    assert.match(markdown, /frame\.tag !== "img"/);
    assert.match(markdown, /return !isR2PublicUrl\(src\)/);
    assert.doesNotMatch(markdown, /allowedSchemes:\s*\[[^\]]*"javascript"/);
    assert.doesNotMatch(markdown, /allowedTags:[\s\S]{0,500}"script"/);
    assert.doesNotMatch(markdown, /allowedTags:[\s\S]{0,500}"iframe"/);
  });

  it("keeps target-blank links on noopener noreferrer", () => {
    for (const path of sourceFiles()) {
      const text = source(path);
      if (!text.includes('target="_blank"')) continue;
      assert.doesNotMatch(text, /target="_blank"(?:(?!rel="noopener noreferrer")[\s\S]){0,160}>/, `${path} has target=_blank without rel="noopener noreferrer" nearby`);
      assert.doesNotMatch(text, /rel="noreferrer"/, `${path} should use rel="noopener noreferrer"`);
    }
  });

  it("keeps message-body media rendering behind trusted media origins", () => {
    const thread = source("src/components/ThreadMessages.tsx");

    assert.match(thread, /import \{ isTrustedMediaUrl \} from "@\/lib\/urlValidation"/);
    assert.match(thread, /const isTrustedImageUrl = \(s: string\) => isTrustedMediaUrl\(s\) && hasImageExtension\(s\)/);
    assert.match(thread, /const isTrustedPdfUrl = \(s: string\) => isTrustedMediaUrl\(s\) && hasPdfExtension\(s\)/);
    assert.match(thread, /const fileUrlTrusted = file \? isTrustedMediaUrl\(file\.url\) : false/);
    assert.doesNotMatch(thread, /const isImageUrl/);
    assert.doesNotMatch(thread, /const isPdfUrl/);
  });
});
