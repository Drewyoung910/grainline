// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

const route = readFileSync("src/app/api/internal/rls-context-gate/route.ts", "utf8");
const middleware = readFileSync("src/middleware.ts", "utf8");
const RUNNER_PATH = "/api/internal/rls-context-gate";
const GATE_MODULE_SPECIFIER =
  "../../../../../scripts/rls-context-acceptance-gate.mjs";
const REVIEWED_IMPORTS = new Map([
  ["node:crypto", ["createHash", "timingSafeEqual"]],
  ["zod", ["z"]],
  [GATE_MODULE_SPECIFIER, [
    "buildEvidencePayload",
    "claimProviderRuntimeRunSlot",
    "completeProviderRuntimeRunSlot",
    "parseGateConfig",
    "runAcceptanceGate",
  ]],
  ["@/lib/requestBody", [
    "isInvalidJsonBodyError",
    "isRequestBodyTooLargeError",
    "readBoundedJson",
  ]],
]);

function parseTypeScript(fileName, source) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(sourceFile.parseDiagnostics.length, 0, `${fileName} must parse`);
  return sourceFile;
}

function readReviewedStaticImports(source) {
  const sourceFile = parseTypeScript("route.ts", source);
  const imports = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isImportEqualsDeclaration(statement) || ts.isExportDeclaration(statement)) {
      assert.fail("runner route must not use import-equals or re-export declarations");
    }
    if (!ts.isImportDeclaration(statement)) continue;
    assert.ok(
      ts.isStringLiteralLike(statement.moduleSpecifier),
      "runner route imports must use static string module specifiers",
    );
    const importClause = statement.importClause;
    assert.ok(importClause, "runner route imports must have an import clause");
    assert.equal(importClause.isTypeOnly, false, "runner route imports must be runtime imports");
    assert.equal(importClause.name, undefined, "runner route must not use default imports");
    assert.ok(
      importClause.namedBindings && ts.isNamedImports(importClause.namedBindings),
      "runner route must not use namespace imports",
    );
    assert.equal(
      imports.has(statement.moduleSpecifier.text),
      false,
      "runner route must keep one import declaration per reviewed module",
    );
    imports.set(
      statement.moduleSpecifier.text,
      importClause.namedBindings.elements.map((element) => {
        assert.equal(element.isTypeOnly, false, "runner route must not use type-only import specifiers");
        assert.equal(element.propertyName, undefined, "runner route must not alias imported names");
        return element.name.text;
      }).sort(),
    );
  }

  return imports;
}

function orchestrationCallSites(source, calleeName) {
  const sourceFile = parseTypeScript("route.ts", source);
  const directImports = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportEqualsDeclaration(statement)
      || (
        ts.isExportDeclaration(statement)
        && statement.moduleSpecifier
        && ts.isStringLiteralLike(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === GATE_MODULE_SPECIFIER
      )
    ) {
      assert.fail("runner route must not import-equals or re-export the gate module");
    }
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== GATE_MODULE_SPECIFIER
    ) {
      continue;
    }

    const importClause = statement.importClause;
    assert.ok(importClause, "gate-module imports must have an import clause");
    assert.equal(importClause.isTypeOnly, false, "gate-module imports must be runtime named imports");
    assert.equal(importClause.name, undefined, "gate module must not use a default import");
    assert.ok(
      importClause.namedBindings && ts.isNamedImports(importClause.namedBindings),
      "gate module must not use a namespace import",
    );

    for (const element of importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName !== calleeName) continue;
      assert.equal(element.isTypeOnly, false, `${calleeName} must be a runtime import`);
      assert.equal(element.propertyName, undefined, `${calleeName} must not use an import alias`);
      assert.equal(element.name.text, calleeName, `${calleeName} must keep its exact imported name`);
      directImports.push(element);
    }
  }

  assert.equal(
    directImports.length,
    1,
    `${calleeName} must have exactly one non-aliased named import from the gate module`,
  );

  const post = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === "POST",
  );
  assert.ok(post?.body, "runner route must export POST with a function body");

  const runtimeReferences = [];
  const visit = (node, ancestors) => {
    if (
      ts.isCallExpression(node)
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      assert.fail("runner route must not use dynamic import or CommonJS require");
    }
    if (
      ts.isIdentifier(node)
      && node.text === calleeName
      && !ts.isImportSpecifier(node.parent)
    ) {
      runtimeReferences.push({ ancestors, node });
    }
    ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
  };
  visit(sourceFile, []);

  assert.equal(
    runtimeReferences.length,
    1,
    `${calleeName} must have exactly one runtime reference in the entire runner route`,
  );

  const sites = runtimeReferences.map(({ ancestors, node }) => {
      const call = node.parent;
      assert.ok(
        ts.isCallExpression(call) && call.expression === node,
        `${calleeName}'s sole runtime reference must be a direct call`,
      );
      let statement = call;
      while (statement && !ts.isStatement(statement)) {
        statement = statement.parent;
      }
      const statementBlock = statement?.parent;
      const tryStatement = statementBlock?.parent;
      return {
        orchestrationBlockRange: ts.isBlock(statementBlock)
          ? [statementBlock.pos, statementBlock.end]
          : null,
        directPostTryStatement:
          Boolean(statement)
          && ts.isBlock(statementBlock)
          && ts.isTryStatement(tryStatement)
          && tryStatement.tryBlock === statementBlock
          && tryStatement.parent === post.body,
        nestedInCallback: ancestors.some(
          (ancestor) => ts.isFunctionLike(ancestor) && ancestor !== post,
        ),
        nestedInIteration: ancestors.some(
          (ancestor) => ts.isIterationStatement(ancestor, false),
        ),
        statement,
      };
  });
  return sites;
}

function constantStringValue(node, bindings, seen = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node)
  ) {
    return constantStringValue(node.expression, bindings, seen);
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantStringValue(node.left, bindings, seen);
    const right = constantStringValue(node.right, bindings, seen);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantStringValue(span.expression, bindings, seen);
      if (expression === null) return null;
      value += `${expression}${span.literal.text}`;
    }
    return value;
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const initializer = bindings.get(node.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return constantStringValue(initializer, bindings, nextSeen);
  }
  return null;
}

function routeMatcherPatterns(source) {
  const sourceFile = parseTypeScript("middleware.ts", source);
  const bindings = new Map();
  const collectBindings = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  const patterns = [];
  const resolveArgument = (node, seen = new Set()) => {
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) resolveArgument(element, seen);
      return;
    }
    if (ts.isIdentifier(node) && bindings.has(node.text)) {
      if (seen.has(node.text)) {
        assert.fail(`cyclic createRouteMatcher binding: ${node.text}`);
      }
      const nextSeen = new Set(seen);
      nextSeen.add(node.text);
      resolveArgument(bindings.get(node.text), nextSeen);
      return;
    }
    const value = constantStringValue(node, bindings);
    assert.notEqual(
      value,
      null,
      "createRouteMatcher entries must be statically resolvable",
    );
    patterns.push(value);
  };
  const inspect = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "createRouteMatcher"
    ) {
      for (const argument of node.arguments) resolveArgument(argument);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return patterns;
}

describe("RLS context provider-runtime runner", () => {
  it("pins the complete static import surface so aliases and barrels cannot hide orchestration", () => {
    assert.deepEqual(
      readReviewedStaticImports(route),
      new Map(
        [...REVIEWED_IMPORTS.entries()].map(([moduleSpecifier, importedNames]) => [
          moduleSpecifier,
          [...importedNames].sort(),
        ]),
      ),
    );
  });

  it("is fail-closed outside Preview and requires a bounded timing-safe token", () => {
    assert.match(route, /process\.env\.VERCEL_ENV !== ["']preview["']/);
    assert.match(route, /RLS_CONTEXT_GATE_TRIGGER_SECRET/);
    assert.match(route, /timingSafeEqual\(digest\(provided\), digest\(expected!\)\)/);
    assert.match(route, /readBoundedJson\(request, BODY_MAX_BYTES\)/);
    assert.match(route, /runSlot: z\.union\(\[z\.literal\(1\), z\.literal\(2\)\]\)/);
    assert.match(route, /export const maxDuration = 300/);
    assert.match(
      route,
      /NODE_TLS_REJECT_UNAUTHORIZED: process\.env\.NODE_TLS_REJECT_UNAUTHORIZED/,
    );
    assert.match(route, /PGOPTIONS: process\.env\.PGOPTIONS/);
  });

  it("is repeat-only, commit-pinned, and atomically consumes each of two durable run slots", () => {
    assert.match(route, /RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA/);
    assert.match(route, /allowedCommitSha === process\.env\.VERCEL_GIT_COMMIT_SHA/);
    assert.match(route, /RLS_CONTEXT_GATE_RUN_ID/);
    assert.match(route, /process\.env\.DATABASE_URL/);
    assert.match(route, /process\.env\.RLS_CONTEXT_GATE_DATABASE_URL/);
    assert.match(route, /timingSafeEqual\(digest\(applicationUrl!\), digest\(gateUrl!\)\)/);
    assert.ok(
      route.indexOf("if (!providerDatabaseUrlsMatch())")
        < route.indexOf("claimProviderRuntimeRunSlot(config"),
      "the app/gate database equality check must run before a slot is claimed",
    );
    const gate = readFileSync("scripts/rls-context-acceptance-gate.mjs", "utf8");
    assert.match(
      gate,
      /provider-runtime slot connection does not match the reviewed runtime role and database/,
    );
    assert.match(route, /claimProviderRuntimeRunSlot/);
    assert.match(route, /completeProviderRuntimeRunSlot/);
    assert.match(route, /Run slot already consumed/);
    assert.match(gate, /AND deployment_id = \$3[\s\S]*AND commit_sha = \$4/);
    assert.match(gate, /AND deployment_id = \$4[\s\S]*AND commit_sha = \$5/);
    assert.doesNotMatch(route, /ADMIN_DATABASE_URL|DIRECT_URL|EVIDENCE_PATH/);
    assert.doesNotMatch(route, /RLS_CONTEXT_GATE_PREPARE|RLS_CONTEXT_GATE_ROLLBACK_PROBE/);
  });

  it("claims and executes once, never silently retrying a consumed slot", () => {
    const claimSites = orchestrationCallSites(route, "claimProviderRuntimeRunSlot");
    const runSites = orchestrationCallSites(route, "runAcceptanceGate");
    for (const [name, sites] of [
      ["claimProviderRuntimeRunSlot", claimSites],
      ["runAcceptanceGate", runSites],
    ]) {
      assert.equal(sites.length, 1, `${name} must have exactly one runtime call`);
      assert.equal(sites[0].nestedInIteration, false, `${name} must not run in a loop`);
      assert.equal(sites[0].nestedInCallback, false, `${name} must not run in a callback`);
      assert.equal(
        sites[0].directPostTryStatement,
        true,
        `${name} must remain a direct statement in POST's orchestration try block`,
      );
    }
    assert.deepEqual(
      claimSites[0].orchestrationBlockRange,
      runSites[0].orchestrationBlockRange,
      "claim and acceptance run must remain in the same orchestration block",
    );
    assert.doesNotMatch(route, /(?:retry|replay)ProviderRuntimeRunSlot/i);

    const loopProbe = `import { claimProviderRuntimeRunSlot } from "${GATE_MODULE_SPECIFIER}";
    export async function POST() {
      for (const attempt of [1, 2]) {
        await claimProviderRuntimeRunSlot(config, input);
      }
    }`;
    assert.equal(
      orchestrationCallSites(loopProbe, "claimProviderRuntimeRunSlot")[0].nestedInIteration,
      true,
      "the regression check must detect a single syntactic call executed by a loop",
    );
    const callbackProbe = `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
    export async function POST() {
      await Promise.all([1, 2].map(async () => runAcceptanceGate(config)));
    }`;
    assert.equal(
      orchestrationCallSites(callbackProbe, "runAcceptanceGate")[0].nestedInCallback,
      true,
      "the regression check must detect a call hidden inside a callback",
    );

    const evasionProbes = [
      `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           const again = runAcceptanceGate;
           await again(config);
         } catch {}
       }`,
      `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           await runAcceptanceGate.call(undefined, config);
         } catch {}
       }`,
      `import {
         runAcceptanceGate,
         runAcceptanceGate as runAgain,
       } from "${GATE_MODULE_SPECIFIER}";
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           await runAgain(config);
         } catch {}
       }`,
      `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
       import * as gate from "${GATE_MODULE_SPECIFIER}";
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           await gate.runAcceptanceGate(config);
         } catch {}
       }`,
      `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
       import * as gate from "${GATE_MODULE_SPECIFIER}";
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           await gate["runAcceptanceGate"](config);
         } catch {}
       }`,
      `import { runAcceptanceGate } from "${GATE_MODULE_SPECIFIER}";
       async function rerun(config) { return runAcceptanceGate(config); }
       export async function POST() {
         try {
           await runAcceptanceGate(config);
           await rerun(config);
         } catch {}
       }`,
    ];
    for (const probe of evasionProbes) {
      assert.throws(
        () => orchestrationCallSites(probe, "runAcceptanceGate"),
        /exactly one|import alias|namespace import|sole runtime reference|direct call/,
        "the regression check must reject alternate or additional gate invocations",
      );
    }
  });

  it("returns only sanitized candidate evidence plus a non-secret run-id digest", () => {
    assert.match(route, /buildEvidencePayload/);
    assert.match(route, /completeProviderRuntimeRunSlot\(config, \{\s*evidence,/);
    assert.match(route, /runIdSha256: digest\(runId\)\.toString\(["']hex["']\)/);
    assert.doesNotMatch(route, /databaseUrl|adminDatabaseUrl|connectionString/);
  });

  it("returns a constant sanitized 500 when no evidence is available", () => {
    const failureHandler = route.slice(route.lastIndexOf("  } catch {"));

    assert.match(
      failureHandler,
      /return privateJson\(\{ error: ["']RLS context gate failed before sanitized evidence was available["'] \}, 500\)/,
    );
    assert.doesNotMatch(failureHandler, /catch\s*\([^)]*\)/);
    assert.doesNotMatch(failureHandler, /String\(|\.message|\.stack|\.cause|JSON\.stringify/);
  });

  it("exempts only the exact runner path from Clerk session middleware", () => {
    const internalPatterns = routeMatcherPatterns(middleware).filter(
      (pattern) => pattern.includes("/api/internal"),
    );
    assert.deepEqual(internalPatterns, [RUNNER_PATH]);

    for (const broadMatcher of [
      "const isPublic = createRouteMatcher([`/api/internal(.*)`]);",
      'const prefix = "/api/"; const broad = prefix + "internal(.*)"; const patterns = [broad]; const isPublic = createRouteMatcher(patterns);',
    ]) {
      assert.deepEqual(
        routeMatcherPatterns(broadMatcher).filter(
          (pattern) => pattern.includes("/api/internal"),
        ),
        ["/api/internal(.*)"],
        "the regression check must resolve template and concatenated broad matchers",
      );
    }
    assert.throws(
      () => routeMatcherPatterns(
        "const internal = loadInternalMatcher(); const isPublic = createRouteMatcher([internal]);",
      ),
      /statically resolvable/,
      "dynamic internal matchers must fail closed instead of evading the exact-path check",
    );
  });
});
