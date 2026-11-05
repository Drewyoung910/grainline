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
globalThis.document = {
  body: new FakeHTMLElement(),
  documentElement: new FakeHTMLElement(),
  addEventListener: (type, handler) => { handlers[type] = handler; },
  removeEventListener: () => {},
};
globalThis.window = { getComputedStyle: (element) => ({ overflowY: element.overflowY }), visualViewport: { scale: 1 } };

const { installScrollGuards } = await import("../src/lib/dialogFocus.ts");
installScrollGuards();

function cancelled(type, event) {
  let prevented = false;
  handlers[type]({ ...event, preventDefault: () => { prevented = true; } });
  return prevented;
}
const finger = (x, y) => ({ clientX: x, clientY: y });
const start = (target, x, y) => handlers.touchstart({ target, touches: [finger(x, y)] });

const scrollable = new FakeHTMLElement({ overflowY: "auto", scrollHeight: 900, clientHeight: 300 });
const fixedPanel = new FakeHTMLElement();

test("a vertical drag with nothing to scroll is still held by the lock", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(100, 200)] }), true);
});

test("a sideways drag reaches the crop window's zoom slider", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(180, 300)] }), false);
});

test("a pinch and a trackpad pinch can zoom an open photo", () => {
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(80, 280), finger(200, 400)] }), false);
  assert.equal(cancelled("wheel", { target: fixedPanel, deltaY: 40, ctrlKey: true }), false);
});

test("a zoomed page can pan around the photo", () => {
  window.visualViewport.scale = 2;
  start(fixedPanel, 100, 300);
  assert.equal(cancelled("touchmove", { target: fixedPanel, touches: [finger(100, 200)] }), false);
  window.visualViewport.scale = 1;
});

test("a gesture starting on an icon still scrolls its dialog", () => {
  const icon = new FakeElement({ parent: scrollable });
  assert.equal(cancelled("wheel", { target: icon, deltaY: 40, ctrlKey: false }), false);
  start(icon, 100, 300);
  assert.equal(cancelled("touchmove", { target: icon, touches: [finger(100, 250)] }), false);
});
