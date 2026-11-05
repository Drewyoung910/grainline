#!/usr/bin/env node
// Finds functions passed out of a server component, which build fine and then crash
// the page at render ("Event handlers cannot be passed to Client Component props").
// Walks imports from every App Router entry, stopping at "use client".
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ENTRY = /^(page|layout|template|loading|not-found|default|error|global-error)\.tsx$/;
const isServerAction = (node) => /["']use server["']/.test(node.getText());

function parseModule(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const first = source.statements[0];
  const mod = { file, source, isClient: first && ts.isExpressionStatement(first) && first.expression.text === "use client", specs: [], bindings: new Map(), functions: new Map() };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      if (clause?.name || !named || named.some((item) => !item.isTypeOnly)) mod.specs.push(node.moduleSpecifier.text);
      for (const name of [clause?.name, clause?.namedBindings?.name, ...(named ?? []).map((item) => item.name)]) if (name) mod.bindings.set(name.text, node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) mod.specs.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]?.text) mod.specs.push(node.arguments[0].text);
    else if (ts.isFunctionDeclaration(node) && node.name) mod.functions.set(node.name.text, node);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) mod.functions.set(node.name.text, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return mod;
}

export function findServerComponentFunctionProps(root) {
  const modules = new Map();
  const load = (file) => modules.get(file) ?? modules.set(file, parseModule(file)).get(file);
  const resolve = (from, spec) => {
    const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
    return base && [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  };
  const findings = [];
  const check = (mod) => {
    const isFunction = (value) => ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? !isServerAction(value) : ts.isIdentifier(value) && mod.functions.has(value.text) && !isServerAction(mod.functions.get(value.text));
    // An element or a client component cannot take a function. A server component can.
    const crossesToClient = (tagNode) => {
      const tag = tagNode.getText().split(".")[0];
      if (/^[a-z]/.test(tag)) return true;
      const spec = mod.bindings.get(tag);
      if (!spec || mod.functions.has(tag)) return false;
      const target = resolve(mod.file, spec);
      return target ? Boolean(load(target).isClient) : !spec.startsWith("@/") && !spec.startsWith(".");
    };
    const report = (node, tagNode, detail) => findings.push({ file: path.relative(root, mod.file), line: mod.source.getLineAndCharacterOfPosition(node.getStart()).line + 1, tag: tagNode.getText(), detail });
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const tagNode = node.parent.parent.tagName;
        const name = node.name.getText();
        if ((/^[a-z]/.test(tagNode.getText()) && /^on[A-Z]/.test(name)) || (isFunction(node.initializer.expression) && crossesToClient(tagNode))) report(node, tagNode, `prop ${name}`);
      }
      if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent) && isFunction(node.expression) && crossesToClient(node.parent.openingElement.tagName)) report(node, node.parent.openingElement.tagName, "function as children");
      ts.forEachChild(node, visit);
    };
    visit(mod.source);
  };
  const queue = fs.readdirSync(path.join(root, "src/app"), { recursive: true }).filter((rel) => ENTRY.test(path.basename(rel))).map((rel) => path.join(root, "src/app", rel));
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const mod = load(file);
    if (mod.isClient) continue;
    queue.push(...mod.specs.map((spec) => resolve(file, spec)).filter(Boolean));
    if (file.endsWith(".tsx")) check(mod);
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = findServerComponentFunctionProps(process.argv[2] ?? process.cwd());
  for (const item of findings) console.error(`${item.file}:${item.line} <${item.tag}> ${item.detail}: a server component cannot pass a function here`);
  console.log(`${findings.length} function prop(s) crossing out of a server component`);
  process.exitCode = findings.length ? 1 : 0;
}
