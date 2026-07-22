import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const MODELS = new Set(["conversation", "message"]);
const OPERATIONS = new Set([
  "aggregate",
  "count",
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
  "update",
  "updateMany",
  "upsert",
]);

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

function normalizePath(file) {
  return file.split(path.sep).join("/");
}

function collectOrmCalls(file, sourceFile) {
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && OPERATIONS.has(node.expression.name.text)
      && ts.isPropertyAccessExpression(node.expression.expression)
      && MODELS.has(node.expression.expression.name.text)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      calls.push({
        file,
        line: position.line + 1,
        model: node.expression.expression.name.text === "conversation" ? "Conversation" : "Message",
        operation: node.expression.name.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function collectRawSqlReferences(file, sourceFile) {
  const references = [];
  const visit = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(sourceFile);
      if (/(?:\$queryRaw|\$executeRaw|Prisma\.sql)$/.test(tag)) {
        const sql = node.getText(sourceFile);
        for (const model of ["Conversation", "Message"]) {
          const pattern = new RegExp(`"${model}"`, "g");
          let match;
          while ((match = pattern.exec(sql)) !== null) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile) + match.index);
            references.push({
              file,
              line: position.line + 1,
              model,
              operation: "raw-sql-reference",
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

export function collectConversationMessageAccess({ sourceRoot = "src" } = {}) {
  const ormCalls = [];
  const rawSqlReferences = [];

  for (const absoluteFile of sourceFiles(sourceRoot)) {
    const file = normalizePath(absoluteFile);
    const text = fs.readFileSync(absoluteFile, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    ormCalls.push(...collectOrmCalls(file, sourceFile));
    rawSqlReferences.push(...collectRawSqlReferences(file, sourceFile));
  }

  const compare = (left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.model.localeCompare(right.model)
    || left.operation.localeCompare(right.operation);
  ormCalls.sort(compare);
  rawSqlReferences.sort(compare);
  return { ormCalls, rawSqlReferences };
}

export function summarizeConversationMessageAccess(inventory) {
  const summary = {};
  for (const access of [...inventory.ormCalls, ...inventory.rawSqlReferences]) {
    summary[access.file] ??= {};
    const key = `${access.model}.${access.operation}`;
    summary[access.file][key] = (summary[access.file][key] ?? 0) + 1;
  }
  return summary;
}

function runCli() {
  const inventory = collectConversationMessageAccess();
  process.stdout.write(`${JSON.stringify({
    ormCallCount: inventory.ormCalls.length,
    rawSqlReferenceCount: inventory.rawSqlReferences.length,
    summary: summarizeConversationMessageAccess(inventory),
    callsites: inventory,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
