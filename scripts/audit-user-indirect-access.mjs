import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Source inventory only: no database connection or credentials are loaded.
// Model relations come from the checked-out schema, including intermediate models.
export function auditUserIndirectAccess(root) {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const models = new Map();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = new Map();
    for (const line of match[2].split("\n")) {
      const field = /^\s*(\w+)\s+(\w+)(?:\[\]|\?)?(?:\s|$)/.exec(line);
      if (field) fields.set(field[1], field[2]);
    }
    models.set(match[1], fields);
  }
  const delegates = new Map([...models.keys()].map((model) => [model[0].toLowerCase() + model.slice(1), model]));
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name)) files.push(file);
    }
  }
  walk(path.join(root, "src"));
  files.sort();
  // All application files are roots; do not load node_modules or execute imports.
  const program = ts.createProgram(files, { noResolve: true, target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve });
  const checker = program.getTypeChecker();
  const relations = [];
  const direct = [];
  const rawSql = [];
  const opaqueShapes = [];
  const factoryRelations = [];
  const opaqueFactoryShapes = [];
  const queryMethods = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
  const shapeKeys = new Set(["select", "include", "where", "data", "create", "update", "orderBy", "having", "_count"]);
  const wrappers = new Set(["AND", "OR", "NOT", "is", "isNot", "some", "every", "none", "connect", "disconnect", "connectOrCreate", "set", "delete", "deleteMany", "updateMany", "upsert"]);
  function location(node) {
    const source = node.getSourceFile();
    return { file: path.relative(root, source.fileName), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
  }
  function keyOf(node) {
    if (!node) return null;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    return null;
  }
  function unwrap(node, seen = new Set()) {
    if (!node || seen.has(node)) return node;
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return unwrap(node.expression, seen);
    if (!ts.isIdentifier(node)) return node;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration ?? checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return unwrap(declaration.initializer, seen);
    if (declaration && ts.isImportSpecifier(declaration)) {
      const importNode = declaration.parent.parent.parent;
      const specifier = importNode.moduleSpecifier?.text;
      if (!specifier || (!specifier.startsWith(".") && !specifier.startsWith("@/"))) return node;
      const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(node.getSourceFile().fileName), specifier);
      const imported = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].map((file) => program.getSourceFile(file)).find(Boolean);
      if (!imported) return node;
      const name = declaration.propertyName?.text ?? declaration.name.text;
      for (const statement of imported.statements) {
        if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
        const binding = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
        if (binding?.initializer) return unwrap(binding.initializer, seen);
      }
    }
    return node;
  }
  function properties(node, onOpaque, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) { onOpaque(node); return []; }
    seen.add(node);
    if (ts.isConditionalExpression(node)) return [...properties(node.whenTrue, onOpaque, new Set(seen)), ...properties(node.whenFalse, onOpaque, new Set(seen))];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return properties(node.right, onOpaque, seen);
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(node) && node.text === "undefined")) return [];
    if (!ts.isObjectLiteralExpression(node)) { onOpaque(node); return []; }
    const result = [];
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) result.push(...properties(property.expression, onOpaque, new Set(seen)));
      else if (ts.isPropertyAssignment(property)) result.push({ key: keyOf(property.name), value: property.initializer, node: property });
      else if (ts.isShorthandPropertyAssignment(property)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(property);
        const declaration = symbol?.valueDeclaration;
        result.push({ key: property.name.text, value: declaration?.initializer ?? property.name, node: property });
      } else onOpaque(property);
    }
    return result;
  }
  function scanShape(node, model, trail, call, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return;
    if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return;
    if (ts.isIdentifier(node) && node.text === "undefined") return;
    if (ts.isArrayLiteralExpression(node)) {
      for (const item of node.elements) scanShape(item, model, trail, call, new Set(seen));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      scanShape(node.whenTrue, model, trail, call, new Set(seen));
      scanShape(node.whenFalse, model, trail, call, new Set(seen));
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      scanShape(node.right, model, trail, call, seen);
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNumericLiteral(node)) && trail.at(-1) === "_count") return;
    seen.add(node);
    const warn = (opaque) => opaqueShapes.push({ ...location(opaque ?? node), query: location(call), model, path: trail.join("."), expression: (opaque ?? node).getText().slice(0, 160) });
    for (const property of properties(node, warn)) {
      if (!property.key) { warn(property.node); continue; }
      const nextModel = models.get(model)?.get(property.key);
      const nextTrail = [...trail, property.key];
      if (models.has(nextModel)) {
        if (unwrap(property.value).kind === ts.SyntaxKind.FalseKeyword) continue;
        if (nextModel === "User") {
          const projection = unwrap(property.value);
          const selected = ts.isObjectLiteralExpression(projection) ? properties(projection, () => {}).find(({ key }) => key === "select") : null;
          relations.push({ ...location(property.node), query: location(call), model, path: nextTrail.join("."), fields: selected ? properties(selected.value, () => {}).map(({ key }) => key).sort() : [], fullRow: projection.kind === ts.SyntaxKind.TrueKeyword });
        }
        scanShape(property.value, nextModel, nextTrail, call, new Set(seen));
      } else if (shapeKeys.has(property.key) || wrappers.has(property.key)) {
        // Scalar comparisons are intentionally not traversed: only query containers and model relations.
        scanShape(property.value, model, nextTrail, call, new Set(seen));
      }
    }
  }
  function sqlText(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return "";
    seen.add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => ` ${sqlInterpolation(span.expression, new Set(seen))} ${span.literal.text}`).join("");
    if (ts.isTaggedTemplateExpression(node)) return sqlText(node.template, seen);
    if (ts.isCallExpression(node)) return node.arguments.map((argument) => sqlText(argument, new Set(seen))).join(" ");
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => sqlText(element, new Set(seen))).join(" ");
    if (ts.isConditionalExpression(node)) return `${sqlText(node.whenTrue, new Set(seen))} ${sqlText(node.whenFalse, new Set(seen))}`;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return `${sqlText(node.left, new Set(seen))}${sqlText(node.right, new Set(seen))}`;
    return "";
  }
  function sqlInterpolation(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return "";
    if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql$/.test(node.tag.getText())) return sqlText(node, seen);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "raw") return sqlText(node.arguments[0], seen);
      if (node.expression.name.text === "join") return node.arguments.map((argument) => sqlInterpolation(argument, new Set(seen))).join(" ");
    }
    seen.add(node);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => sqlInterpolation(element, new Set(seen))).join(" ");
    if (ts.isConditionalExpression(node)) return `${sqlInterpolation(node.whenTrue, new Set(seen))} ${sqlInterpolation(node.whenFalse, new Set(seen))}`;
    // Ordinary interpolations are bound data, including literal strings.
    return "";
  }
  for (const file of files) {
    const source = program.getSourceFile(file);
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.type && node.body) {
        const type = /^Prisma\.(\w+?)(?:WhereInput|Select|Include|CreateInput|UpdateInput)$/.exec(node.type.getText());
        if (type && models.has(type[1])) {
          function scanReturns(child) {
            if (child !== node.body && ts.isFunctionLike(child)) return;
            if (ts.isReturnStatement(child) && child.expression) {
              const start = relations.length;
              const opaqueStart = opaqueShapes.length;
              scanShape(child.expression, type[1], ["return"], node);
              factoryRelations.push(...relations.splice(start).map(({ query, ...access }) => ({ ...access, definition: query, function: node.name?.text ?? "anonymous" })));
              opaqueFactoryShapes.push(...opaqueShapes.splice(opaqueStart).map(({ query, ...shape }) => ({ ...shape, definition: query, function: node.name?.text ?? "anonymous" })));
            }
            ts.forEachChild(child, scanReturns);
          }
          scanReturns(node.body);
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const access = node.expression;
        if (queryMethods.has(access.name.text) && ts.isPropertyAccessExpression(access.expression)) {
          const model = delegates.get(access.expression.name.text);
          if (model) {
            if (model === "User") direct.push({ ...location(node), method: access.name.text, receiver: access.expression.expression.getText() });
            if (node.arguments[0]) scanShape(node.arguments[0], model, [], node);
          }
        }
      }
      const raw = ts.isTaggedTemplateExpression(node) ? node.tag : ts.isCallExpression(node) ? node.expression : null;
      if (raw && ts.isPropertyAccessExpression(raw) && /^\$(?:queryRaw|executeRaw)(?:Unsafe)?$/.test(raw.name.text)) {
        const sql = ts.isTaggedTemplateExpression(node) ? sqlText(node.template) : sqlText(node.arguments[0]);
        const stripped = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/'(?:''|[^'])*'/g, "''");
        if (/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+(?:"?public"?\s*\.\s*)?"User"(?!\w)/i.test(stripped)) rawSql.push({ ...location(node), method: raw.name.text });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  function unique(items) { return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]; }
  const relationAccesses = unique(relations);
  return { directCount: direct.length, relationCount: relationAccesses.length, relationFiles: new Set(relationAccesses.map(({ query }) => query.file)).size, rawSqlCount: rawSql.length, rawSqlFiles: new Set(rawSql.map(({ file }) => file)).size, direct, relations: relationAccesses, rawSql, factoryRelations: unique(factoryRelations), opaqueShapes: unique(opaqueShapes), opaqueFactoryShapes: unique(opaqueFactoryShapes), limitations: ["Delegate names identify candidate Prisma operations; receiver types are not proven.", "Imported const objects and local aliases are resolved; query-shape factories are inventoried separately without evaluating caller arguments.", "Unresolved factory calls and computed keys are reported as opaque; their absence of User dependencies is not proven.", "Raw SQL covers static fragments reaching raw calls; arbitrary runtime SQL generators need manual review.", "Migration and installed database function bodies require a separate catalog inventory."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = auditUserIndirectAccess(process.cwd());
  process.stdout.write(`${JSON.stringify(process.argv.includes("--json") ? report : { directCount: report.directCount, relationCount: report.relationCount, relationFiles: report.relationFiles, rawSqlCount: report.rawSqlCount, rawSqlFiles: report.rawSqlFiles, factoryRelationCount: report.factoryRelations.length, opaqueShapeCount: report.opaqueShapes.length, opaqueFactoryShapeCount: report.opaqueFactoryShapes.length, limitations: report.limitations }, null, 2)}\n`);
}
