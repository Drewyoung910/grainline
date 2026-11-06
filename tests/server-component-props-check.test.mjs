import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findServerComponentFunctionProps as find } from "../scripts/check-server-component-props.mjs";

function count(head, body, components = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-props-"));
  fs.mkdirSync(path.join(root, "src/app"), { recursive: true });
  fs.mkdirSync(path.join(root, "src/components"));
  fs.writeFileSync(path.join(root, "src/app/page.tsx"), `${head}\nexport default function Page() { return ${body}; }`);
  for (const [name, text] of Object.entries(components)) fs.writeFileSync(path.join(root, `src/components/${name}.tsx`), text);
  return find(root).length;
}
const importC = `import { C } from "@/components/C";`;
const clientC = { C: `"use client"; export function C() { return null; }` };

test("the current source passes no function out of a server component", () => {
  assert.deepEqual(find(path.resolve(import.meta.dirname, "..")), []);
});

test("flags an event handler on an element in a server page", () => {
  assert.equal(count("", `<button onClick={() => 1}>x</button>`), 1);
});

test("flags a component reached from a server page only when it lacks use client", () => {
  const tracker = `export function C() { const go = () => 1; return <li onClick={go} />; }`;
  assert.equal(count(importC, `<C />`, { C: tracker }), 1);
  assert.equal(count(importC, `<C />`, { C: `"use client";\n${tracker}` }), 0);
});

test("flags a function sent to a client component as a prop or as children", () => {
  assert.equal(count(importC, `<C render={() => 1} />`, clientC), 1);
  assert.equal(count(importC, `<C>{() => 1}</C>`, clientC), 1);
});

test("allows server actions and functions given to another server component", () => {
  const head = `${importC} async function save() { "use server"; }`;
  assert.equal(count(head, `<form action={save}><C render={() => 1} /></form>`, { C: `export function C({ render }) { return render(); }` }), 0);
});
