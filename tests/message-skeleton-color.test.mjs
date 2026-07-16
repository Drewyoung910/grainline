import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("message skeleton colors", () => {
  it("keeps the inbox fallback local so it cannot mask the thread fallback", () => {
    assert.equal(
      existsSync(new URL("../src/app/messages/loading.tsx", import.meta.url)),
      false,
    );

    const inbox = source("src/app/messages/page.tsx");
    assert.match(inbox, /<Suspense fallback={<MessagesInboxSkeleton \/>}>/);
    assert.match(inbox, /async function MessagesInbox/);
  });

  it("matches the warm loaded inbox surface and shared skeleton tone", () => {
    const inbox = source("src/app/messages/page.tsx");
    const thread = source("src/app/messages/[id]/loading.tsx");

    assert.match(
      inbox,
      /divide-y divide-stone-300\/50 overflow-hidden rounded-lg bg-\[#EFEAE0\]/,
    );
    assert.match(inbox, /bg-\[#EFEAE0\] animate-pulse/);
    assert.match(thread, /bg-\[#EFEAE0\] animate-pulse/);
    assert.doesNotMatch(inbox, /bg-\[#E3DCCB\] animate-pulse/);
    assert.doesNotMatch(thread, /bg-\[#E3DCCB\] animate-pulse/);
  });

  it("keeps the thread context and composer hierarchy aligned with the loaded UI", () => {
    const loadedThread = source("src/app/messages/[id]/page.tsx");
    const composer = source("src/components/MessageComposer.tsx");
    const fallback = source("src/app/messages/[id]/loading.tsx");

    assert.match(
      loadedThread,
      /p-3 rounded-lg bg-\[#EFEAE0\] border border-stone-200\/60/,
    );
    assert.match(
      fallback,
      /p-3 rounded-lg bg-\[#EFEAE0\] border border-stone-200\/60/,
    );
    assert.match(composer, /sticky bottom-0[\s\S]*bg-\[#EFEAE0\]/);
    assert.match(fallback, /sticky bottom-0[\s\S]*bg-\[#EFEAE0\]/);
    assert.match(fallback, /h-10 flex-1 rounded-2xl bg-\[#F7F5F0\] animate-pulse/);
    assert.match(fallback, /h-10 w-20 rounded-full bg-\[#2C1F1A\]\/40 animate-pulse/);
    assert.doesNotMatch(fallback, /sticky bottom-0[^\n]*bg-white/);
  });
});
