import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

class ManualClock {
  now = 0;
  nextId = 1;
  tasks = new Map();

  setTimeout = (callback, delay = 0) => {
    const id = this.nextId++;
    this.tasks.set(id, { callback, dueAt: this.now + Number(delay) });
    return id;
  };

  clearTimeout = (id) => {
    this.tasks.delete(id);
  };

  advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.now = task.dueAt;
      task.callback();
    }
    this.now = target;
  }
}

class FixtureWindow {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
}

class FixtureCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function dependenciesEqual(left, right) {
  return Boolean(left && right && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index])));
}

function createHookRuntime() {
  const hooks = [];
  let cursor = 0;
  let rerender = () => {};
  let queuedEffects = [];

  const useState = (initialValue) => {
    const index = cursor++;
    if (!(index in hooks)) {
      hooks[index] = {
        kind: "state",
        value: typeof initialValue === "function" ? initialValue() : initialValue,
      };
    }
    const setValue = (nextValue) => {
      const previous = hooks[index].value;
      hooks[index].value = typeof nextValue === "function" ? nextValue(previous) : nextValue;
      rerender();
    };
    return [hooks[index].value, setValue];
  };

  const useRef = (initialValue) => {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { kind: "ref", value: { current: initialValue } };
    return hooks[index].value;
  };

  const memoHook = (factory, dependencies) => {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || !dependenciesEqual(previous.dependencies, dependencies)) {
      hooks[index] = { kind: "memo", value: factory(), dependencies };
    }
    return hooks[index].value;
  };

  const callbackHook = (callback, dependencies) => memoHook(() => callback, dependencies);

  const useEffect = (create, dependencies) => {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || !dependenciesEqual(previous.dependencies, dependencies)) {
      queuedEffects.push({ index, create, previousCleanup: previous?.cleanup });
      hooks[index] = { kind: "effect", dependencies, cleanup: undefined };
    }
  };

  const react = {
    createContext: (defaultValue) => ({ Provider: Symbol("ContextProvider"), defaultValue }),
    useContext: (context) => context.defaultValue,
    useState,
    useRef,
    useMemo: memoHook,
    useCallback: callbackHook,
    useEffect,
  };

  return {
    react,
    beginRender(onRerender) {
      cursor = 0;
      queuedEffects = [];
      rerender = onRerender;
    },
    flushEffects() {
      for (const effect of queuedEffects) {
        effect.previousCleanup?.();
        hooks[effect.index].cleanup = effect.create();
      }
      queuedEffects = [];
    },
    unmount() {
      for (const hook of hooks) {
        if (hook?.kind === "effect") hook.cleanup?.();
      }
    },
  };
}

function loadToastFixture() {
  const clock = new ManualClock();
  const fixtureWindow = new FixtureWindow();
  const runtime = createHookRuntime();
  const jsxRuntime = {
    Fragment: Symbol("Fragment"),
    jsx: (type, props, key) => ({ type, key, props: props ?? {} }),
    jsxs: (type, props, key) => ({ type, key, props: props ?? {} }),
  };
  const compiled = ts.transpileModule(readFileSync("src/components/Toast.tsx", "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "src/components/Toast.tsx",
  }).outputText;
  const compiledModule = { exports: {} };
  const FixtureDate = class extends Date {
    static now() {
      return clock.now;
    }
  };
  const localRequire = (specifier) => {
    if (specifier === "react") return runtime.react;
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    if (specifier === "@/components/icons") return { X: () => null };
    throw new Error(`Unexpected runtime import: ${specifier}`);
  };
  new Function(
    "require",
    "module",
    "exports",
    "setTimeout",
    "clearTimeout",
    "Date",
    "window",
    "CustomEvent",
    compiled,
  )(
    localRequire,
    compiledModule,
    compiledModule.exports,
    clock.setTimeout,
    clock.clearTimeout,
    FixtureDate,
    fixtureWindow,
    FixtureCustomEvent,
  );

  let tree;
  const render = () => {
    runtime.beginRender(render);
    tree = compiledModule.exports.ToastProvider({ children: "page" });
    runtime.flushEffects();
  };
  render();
  return {
    clock,
    fixtureWindow,
    get tree() { return tree; },
    get toast() { return tree.props.value.toast; },
    emitToast: compiledModule.exports.emitToast,
    unmount: () => runtime.unmount(),
  };
}

function findAll(node, predicate, results = []) {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, results);
    return results;
  }
  if (!node || typeof node !== "object") return results;
  if (predicate(node)) results.push(node);
  findAll(node.props?.children, predicate, results);
  return results;
}

function notifications(fixture) {
  return findAll(fixture.tree, (node) => node.props?.role === "alert" || node.props?.role === "status");
}

function dismissButtons(fixture) {
  return findAll(fixture.tree, (node) => node.type === "button" && node.props?.["aria-label"] === "Dismiss message");
}

test("error toasts remain until the user dismisses the exact message", () => {
  const fixture = loadToastFixture();
  fixture.toast("Account deletion is blocked by an open order.", "error");
  fixture.toast("Account deletion is blocked by an open case.", "error");

  assert.deepEqual(notifications(fixture).map((node) => node.props.role), ["alert", "alert"]);
  assert.equal(dismissButtons(fixture).length, 2);
  assert.ok(dismissButtons(fixture).every((button) => button.props.type === "button"));
  fixture.clock.advance(60_000);
  assert.equal(notifications(fixture).length, 2, "errors must not expire while the user is reading them");

  dismissButtons(fixture)[0].props.onClick();
  assert.equal(notifications(fixture).length, 1);
  assert.match(String(notifications(fixture)[0].props.children[0].props.children), /open case/u);
  fixture.unmount();
  assert.equal(fixture.clock.tasks.size, 0);
});

test("timed toasts stay paused until both pointer and keyboard focus leave", () => {
  const fixture = loadToastFixture();
  fixture.toast("Saved.", "success");
  const toast = notifications(fixture)[0];
  assert.equal(toast.props.role, "status");

  fixture.clock.advance(4_000);
  toast.props.onMouseEnter();
  toast.props.onFocus();
  toast.props.onMouseLeave();
  fixture.clock.advance(30_000);
  assert.equal(notifications(fixture).length, 1, "focus keeps the timer paused after hover ends");

  toast.props.onBlur({
    currentTarget: { contains: () => true },
    relatedTarget: {},
  });
  fixture.clock.advance(30_000);
  assert.equal(notifications(fixture).length, 1, "focus moving inside the toast does not resume it");

  toast.props.onBlur({
    currentTarget: { contains: () => false },
    relatedTarget: null,
  });
  fixture.clock.advance(1_999);
  assert.equal(notifications(fixture).length, 1);
  fixture.clock.advance(1);
  assert.equal(notifications(fixture).length, 0);
  fixture.unmount();
});

test("focus pauses timed toasts and external toast events use the same behavior", () => {
  const fixture = loadToastFixture();
  fixture.emitToast("Link copied.", "info");
  const toast = notifications(fixture)[0];
  toast.props.onFocus();
  fixture.clock.advance(30_000);
  assert.equal(notifications(fixture).length, 1);

  toast.props.onBlur({
    currentTarget: { contains: () => false },
    relatedTarget: null,
  });
  fixture.clock.advance(5_999);
  assert.equal(notifications(fixture).length, 1);
  fixture.clock.advance(1);
  assert.equal(notifications(fixture).length, 0);
  fixture.unmount();
});

test("manual dismissal clears timed work and duplicate messages remain independently dismissible", () => {
  const fixture = loadToastFixture();
  fixture.toast("Saved.", "success");
  fixture.toast("Saved.", "success");
  assert.equal(notifications(fixture).length, 2);
  assert.notEqual(notifications(fixture)[0].key, notifications(fixture)[1].key);
  assert.equal(fixture.clock.tasks.size, 2);

  dismissButtons(fixture)[1].props.onClick();
  assert.equal(notifications(fixture).length, 1);
  assert.equal(fixture.clock.tasks.size, 1);
  fixture.unmount();
  assert.equal(fixture.clock.tasks.size, 0, "unmount clears every remaining timer");
});
