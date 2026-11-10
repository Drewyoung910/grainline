import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// /messages imports these controls from a Server Component. A function prop on
// a server-rendered element takes the whole page to the error boundary, and
// `next build` does not catch it because the page is dynamic.
const script = `
  const { createRequire } = require("node:module");
  const fs = require("node:fs");
  const req = createRequire(process.cwd() + "/package.json");
  const ts = req("typescript");
  const React = req("next/dist/compiled/react");
  const flight = req("next/dist/compiled/react-server-dom-webpack/server.node");
  const source = fs.readFileSync("src/components/MessageInboxControls.tsx", "utf8");
  const stub = () => null;
  let Controls = stub;
  if (!/^["']use client["']/.test(source)) {
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} };
    new Function("module", "exports", "require", outputText)(module, module.exports, (name) =>
      name === "react" ? React : new Proxy({ __esModule: true }, { get: (target, key) => target[key] ?? stub }));
    Controls = module.exports.default;
  }
  const errors = [];
  const stream = flight.renderToPipeableStream(
    React.createElement(Controls, { tab: "inbox", query: "walnut", unreadTotal: 2, awaitingReplyTotal: 1 }),
    {},
    { onError: (error) => { errors.push(error.message); } },
  );
  stream.pipe(new (require("node:stream").Writable)({
    write(_chunk, _encoding, done) { done(); },
    final(done) { process.stdout.write(JSON.stringify(errors)); done(); },
  }));
`;

test("the inbox controls survive the real React server renderer", () => {
  const output = execFileSync(
    process.execPath,
    ["--conditions=react-server", "-e", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  assert.deepEqual(JSON.parse(output), []);
});
