import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Runs src/hooks/useInView.ts with a stand-in React (state cells, effects run
// once) and a stand-in IntersectionObserver that the test drives.
function loadHook() {
  const source = readFileSync(new URL("../src/hooks/useInView.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const state = [];
  let cursor = 0;
  const react = {
    useRef: () => ({ current: {} }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useEffect: (effect) => { effect(); },
  };
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const cjs = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => (name === "react" ? react : {}),
    cjs,
    cjs.exports,
  );
  cjs.exports.useInView({ threshold: 0.08 });
  return {
    report: (entry) => observers[0].callback([entry]),
    hasObserved: () => state[0],
    inView: () => state[1],
  };
}

test("a section already peeking in when the page appears is revealed, not hidden", () => {
  const hook = loadHook();
  hook.report({ isIntersecting: false, intersectionRatio: 0.03 });
  assert.equal(hook.hasObserved(), true);
  assert.equal(hook.inView(), true);
});

test("a section below the fold stays hidden until it scrolls in", () => {
  const hook = loadHook();
  hook.report({ isIntersecting: false, intersectionRatio: 0 });
  assert.equal(hook.inView(), false);
  hook.report({ isIntersecting: false, intersectionRatio: 0.03 });
  assert.equal(hook.inView(), false, "after the first report only the threshold reveals it");
  hook.report({ isIntersecting: true, intersectionRatio: 0.1 });
  assert.equal(hook.inView(), true);
});
