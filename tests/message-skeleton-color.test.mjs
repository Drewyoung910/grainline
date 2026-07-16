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
});
