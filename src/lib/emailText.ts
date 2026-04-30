const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "(c)",
  gt: ">",
  hellip: "...",
  laquo: "<<",
  ldquo: '"',
  lsquo: "'",
  lt: "<",
  mdash: "-",
  ndash: "-",
  nbsp: " ",
  quot: '"',
  raquo: ">>",
  rdquo: '"',
  reg: "(r)",
  rsquo: "'",
  trade: "(tm)",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, raw: string) => {
    const name = raw.toLowerCase();
    if (name.startsWith("#x")) {
      const codePoint = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(codePoint) ? safeCodePoint(entity, codePoint) : entity;
    }
    if (name.startsWith("#")) {
      const codePoint = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(codePoint) ? safeCodePoint(entity, codePoint) : entity;
    }
    return ENTITY_MAP[name] ?? entity;
  });
}

function safeCodePoint(fallback: string, codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const lines = decodeHtmlEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(formatPlainTextLine);

  return compactTableWhitespace(lines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatPlainTextLine(line: string): string {
  if (line.includes("\t")) {
    const cells = line
      .split("\t")
      .map(normalizePlainTextSpacing)
      .filter(Boolean);
    return cells.join(" | ");
  }

  return normalizePlainTextSpacing(line);
}

function normalizePlainTextSpacing(text: string): string {
  return text.replace(/[ \t]+/g, " ").trim();
}

function compactTableWhitespace(lines: string[]) {
  return lines.filter((line, index) => {
    if (line !== "") return true;
    const previous = lines[index - 1];
    const next = lines[index + 1];
    return !(isPlainTextTableLine(previous) && isPlainTextTableLine(next));
  });
}

function isPlainTextTableLine(line: string | undefined) {
  return !!line && line.includes(" | ");
}
