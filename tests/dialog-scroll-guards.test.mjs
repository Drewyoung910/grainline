import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
  constructor({ parent = null, overflowY = "visible", scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {}) {
    Object.assign(this, { parentElement: parent, overflowY, scrollHeight, clientHeight, scrollTop });
  }
}

class FakeHTMLElement extends FakeElement {}

const handlers = {};
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.HTMLInputElement = class extends FakeHTMLElement {};
globalThis.HTMLTextAreaElement = class extends FakeHTMLElement {};
globalThis.HTMLSelectElement = class extends FakeHTMLElement {};
globalThis.document = {
  body: new FakeHTMLElement(),
  documentElement: new FakeHTMLElement(),
  addEventListener: (type, handler) => { handlers[type] = handler; },
  removeEventListener: () => {},
};
globalThis.window = {
  getComputedStyle: (element) => ({ overflowY: element.overflowY }),
  visualViewport: { scale: 1 },
};

const { installScrollGuards } = await import("../src/lib/dialogFocus.ts");
const removeGuards = installScrollGuards();

function cancelled(type, event) {
  let prevented = false;
  handlers[type]({ ...event, preventDefault: () => { prevented = true; } });
  return prevented;
}

const finger = (x, y) => ({ clientX: x, clientY: y });
const start = (target, x, y) => handlers.touchstart({ target, touches: [finger(x, y)] });

const scrollable = new FakeHTMLElement({ overflowY: "auto", scrollHeight: 900, clientHeight: 300 });
const fixedPanel = new FakeHTMLElement();

test.after(() => removeGuards());

test("holds a vertical drag when the dialog cannot scroll", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(100, 200)] }), true);
});

test("leaves a sideways slider drag alone", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(180, 300)] }), false);
});

test("leaves pinch and trackpad zoom alone", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(80, 280), finger(200, 400)] }), false);
  assert.equal(cancelled("wheel", { target: fixedPanel, deltaY: 40, ctrlKey: true }), false);
});

test("allows a zoomed page to pan", () => {
  window.visualViewport.scale = 2;
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(100, 200)] }), false);
  window.visualViewport.scale = 1;
});

test("finds a scrollable dialog when the gesture begins on an SVG element", () => {
  const icon = new FakeElement({ parent: scrollable });
  assert.equal(cancelled("wheel", { target: icon, deltaY: 40, ctrlKey: false }), false);
  start(icon, 100, 300);
  assert.equal(cancelled("touchmove", { target: icon, touches: [finger(100, 250)] }), false);
});
