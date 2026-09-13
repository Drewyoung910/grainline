import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const MODELS = new Set(["case", "caseMessage", "caseMessageAttachment"]);
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

function modelName(name) {
  if (name === "case") return "Case";
  if (name === "caseMessage") return "CaseMessage";
  return "CaseMessageAttachment";
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
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      calls.push({
        file,
        line: position.line + 1,
        model: modelName(node.expression.expression.name.text),
        operation: node.expression.name.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function propertyName(node) {
  if (
    ts.isPropertyAssignment(node)
    || ts.isShorthandPropertyAssignment(node)
    || ts.isMethodDeclaration(node)
  ) {
    const name = node.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      return name.text;
    }
  }
  return null;
}

function collectRelationReferences(file, sourceFile) {
  const references = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && OPERATIONS.has(node.expression.name.text)
      && ts.isPropertyAccessExpression(node.expression.expression)
    ) {
      const rootModel = node.expression.expression.name.text;
      const seenNodes = new Set();
      const inspectArgument = (
        child,
        insideCaseRelation = false,
        insideCaseMessageRelation = false,
      ) => {
        if (seenNodes.has(child)) return;
        seenNodes.add(child);

        const name = propertyName(child);
        const caseRelation =
          name === "case"
          || name === "casesAsBuyer"
          || name === "casesAsSeller"
          || name === "casesResolved";
        const caseMessageRelation =
          name === "caseMessage"
          || name === "caseMessages"
          || (name === "messages" && (rootModel === "case" || insideCaseRelation));
        const caseMessageAttachmentRelation =
          name === "caseMessageAttachments"
          || (
            name === "attachments"
            && (
              rootModel === "caseMessage"
              || insideCaseMessageRelation
            )
          );

        if (
          caseRelation
          || caseMessageRelation
          || caseMessageAttachmentRelation
        ) {
          const position = sourceFile.getLineAndCharacterOfPosition(
            child.getStart(sourceFile),
          );
          references.push({
            file,
            line: position.line + 1,
            model: caseRelation
              ? "Case"
              : caseMessageRelation
                ? "CaseMessage"
                : "CaseMessageAttachment",
            operation: "relation-reference",
          });
        }

        ts.forEachChild(child, (grandchild) => {
          inspectArgument(
            grandchild,
            insideCaseRelation || name === "case",
            insideCaseMessageRelation || caseMessageRelation,
          );
        });
      };

      for (const argument of node.arguments) inspectArgument(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function collectRawSqlReferences(file, sourceFile) {
  const references = [];
  const visit = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(sourceFile);
      if (/(?:\$queryRaw|\$executeRaw|Prisma\.sql)$/.test(tag)) {
        const sql = node.getText(sourceFile);
        for (const model of ["Case", "CaseMessage", "CaseMessageAttachment"]) {
          const pattern = new RegExp(`"${model}"`, "g");
          let match;
          while ((match = pattern.exec(sql)) !== null) {
            const position = sourceFile.getLineAndCharacterOfPosition(
              node.getStart(sourceFile) + match.index,
            );
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

export function collectCaseCaseMessageAccess({ sourceRoot = "src" } = {}) {
  const ormCalls = [];
  const relationReferences = [];
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
    relationReferences.push(...collectRelationReferences(file, sourceFile));
    rawSqlReferences.push(...collectRawSqlReferences(file, sourceFile));
  }

  const compare = (left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.model.localeCompare(right.model)
    || left.operation.localeCompare(right.operation);
  ormCalls.sort(compare);
  relationReferences.sort(compare);
  rawSqlReferences.sort(compare);
  return { ormCalls, relationReferences, rawSqlReferences };
}

export function summarizeCaseCaseMessageAccess(inventory) {
  const summary = {};
  for (const access of [
    ...inventory.ormCalls,
    ...inventory.relationReferences,
    ...inventory.rawSqlReferences,
  ]) {
    summary[access.file] ??= {};
    const key = `${access.model}.${access.operation}`;
    summary[access.file][key] = (summary[access.file][key] ?? 0) + 1;
  }
  return summary;
}

function runCli() {
  const inventory = collectCaseCaseMessageAccess();
  process.stdout.write(`${JSON.stringify({
    ormCallCount: inventory.ormCalls.length,
    relationReferenceCount: inventory.relationReferences.length,
    rawSqlReferenceCount: inventory.rawSqlReferences.length,
    summary: summarizeCaseCaseMessageAccess(inventory),
    callsites: inventory,
  }, null, 2)}\n`);
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli();
}
