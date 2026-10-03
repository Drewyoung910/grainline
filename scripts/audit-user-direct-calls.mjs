import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const sourceFiles = [];
const callPattern = /\b(prisma|tx)\.user\.(findUnique|findFirst|findMany|count|create|update|updateMany|delete|deleteMany|upsert)\s*\(/g;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      sourceFiles.push(absolutePath);
    }
  }
}

function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipSpace(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function topLevelProperties(objectText) {
  const properties = [];
  if (!objectText.startsWith("{")) return properties;
  let index = 1;
  while (index < objectText.length - 1) {
    index = skipSpace(objectText, index);
    if (objectText[index] === ",") {
      index += 1;
      continue;
    }
    if (objectText.slice(index, index + 3) === "...") {
      const end = objectText.indexOf(",", index);
      properties.push({ key: objectText.slice(index, end < 0 ? -1 : end).trim(), value: "" });
      index = end < 0 ? objectText.length : end + 1;
      continue;
    }
    const keyMatch = /^(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')/.exec(objectText.slice(index));
    if (!keyMatch) {
      index += 1;
      continue;
    }
    const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
    index += keyMatch[0].length;
    index = skipSpace(objectText, index);
    if (objectText[index] !== ":") {
      properties.push({ key, value: "" });
      const comma = objectText.indexOf(",", index);
      index = comma < 0 ? objectText.length : comma + 1;
      continue;
    }
    index = skipSpace(objectText, index + 1);
    const valueStart = index;
    const open = objectText[index];
    const close = open === "{" ? "}" : open === "[" ? "]" : open === "(" ? ")" : null;
    if (close) {
      const end = matchingDelimiter(objectText, index, open, close);
      const valueEnd = end < 0 ? objectText.length : end + 1;
      properties.push({ key, value: objectText.slice(valueStart, valueEnd) });
      index = valueEnd;
    } else {
      let end = index;
      while (end < objectText.length && objectText[end] !== "," && objectText[end] !== "}") end += 1;
      properties.push({ key, value: objectText.slice(valueStart, end).trim() });
      index = end;
    }
  }
  return properties;
}

function nestedKeys(argumentText, propertyName) {
  const property = topLevelProperties(argumentText).find(({ key }) => key === propertyName);
  if (!property?.value.startsWith("{")) return [];
  return topLevelProperties(property.value).map(({ key }) => key);
}

walk(sourceRoot);
const calls = [];
for (const absolutePath of sourceFiles) {
  const source = fs.readFileSync(absolutePath, "utf8");
  let match;
  while ((match = callPattern.exec(source))) {
    const openParenthesis = callPattern.lastIndex - 1;
    const closeParenthesis = matchingDelimiter(source, openParenthesis, "(", ")");
    if (closeParenthesis < 0) throw new Error(`Unclosed User call in ${absolutePath}`);
    const argumentStart = skipSpace(source, openParenthesis + 1);
    let argumentText = "";
    if (source[argumentStart] === "{") {
      const argumentEnd = matchingDelimiter(source, argumentStart, "{", "}");
      if (argumentEnd < 0) throw new Error(`Unclosed User argument in ${absolutePath}`);
      argumentText = source.slice(argumentStart, argumentEnd + 1);
    }
    calls.push({
      file: path.relative(root, absolutePath),
      line: source.slice(0, match.index).split("\n").length,
      client: match[1],
      method: match[2],
      where: nestedKeys(argumentText, "where"),
      select: nestedKeys(argumentText, "select"),
      include: nestedKeys(argumentText, "include"),
      data: nestedKeys(argumentText, "data"),
    });
    callPattern.lastIndex = closeParenthesis + 1;
  }
}

calls.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
const methods = [...new Set(calls.map(({ method }) => method))].sort();
const report = {
  count: calls.length,
  files: new Set(calls.map(({ file }) => file)).size,
  byMethod: Object.fromEntries(methods.map((method) => [method, calls.filter((call) => call.method === method).length])),
  calls,
};

process.stdout.write(`${JSON.stringify(
  process.argv.includes("--json") ? report : { count: report.count, files: report.files, byMethod: report.byMethod },
  null,
  2,
)}\n`);
