import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("client async guardrails", () => {
  it("keeps search suggestions on latest-request-wins semantics", () => {
    const searchBar = source("src/components/SearchBar.tsx");

    assert.match(searchBar, /suggestionsAbortRef/);
    assert.match(searchBar, /suggestionsRequestRef/);
    assert.match(searchBar, /signal: controller\.signal/);
    assert.match(searchBar, /requestId !== suggestionsRequestRef\.current/);
    assert.match(searchBar, /suggestionsAbortRef\.current\?\.abort\(\)/);
  });

  it("aborts recently viewed and saved-address loads on cleanup", () => {
    const recentlyViewed = source("src/components/RecentlyViewed.tsx");
    const shippingAddressForm = source("src/components/ShippingAddressForm.tsx");

    assert.match(recentlyViewed, /const controller = new AbortController\(\)/);
    assert.match(recentlyViewed, /signal: controller\.signal/);
    assert.match(recentlyViewed, /controller\.abort\(\)/);
    assert.match(recentlyViewed, /error instanceof DOMException && error\.name === "AbortError"/);

    assert.match(shippingAddressForm, /loadSavedAddress = useCallback\(async \(signal: AbortSignal\)/);
    assert.match(shippingAddressForm, /cache: "no-store", signal/);
    assert.match(shippingAddressForm, /return \(\) => controller\.abort\(\)/);
    assert.match(shippingAddressForm, /if \(!signal\.aborted\) setLoading\(false\)/);
  });

  it("prevents stale header count and identity fetches from winning", () => {
    const header = source("src/components/Header.tsx");

    for (const token of ["cartCountRequestRef", "notifCountRequestRef", "loadAllRequestRef"]) {
      assert.match(header, new RegExp(token));
    }
    assert.match(header, /fetch\("\/api\/cart", \{ cache: "no-store", signal: controller\.signal \}\)/);
    assert.match(header, /fetch\("\/api\/notifications", \{ cache: "no-store", signal: controller\.signal \}\)/);
    assert.match(header, /fetch\("\/api\/me", \{ cache: "no-store", signal: controller\.signal \}\)/);
    assert.match(header, /requestId !== cartCountRequestRef\.current/);
    assert.match(header, /requestId !== notifCountRequestRef\.current/);
    assert.match(header, /requestId !== loadAllRequestRef\.current/);
  });

  it("keeps Buy Now mounted after first open and rolls back late checkout sessions", () => {
    const button = source("src/components/BuyNowButton.tsx");
    const modal = source("src/components/BuyNowCheckoutModal.tsx");

    assert.match(button, /const \[hasOpened, setHasOpened\]/);
    assert.match(button, /\{hasOpened && \(/);
    assert.doesNotMatch(button, /\{isOpen && \(\s*<BuyNowCheckoutModal/);

    assert.match(modal, /createSessionRequestRef/);
    assert.match(modal, /sessionIdRef/);
    assert.match(modal, /mountedRef/);
    assert.match(modal, /resetCheckoutState\(\{ rollback: true \}\)/);
    assert.match(modal, /await rollbackCheckoutSessions\(\[nextSessionId\]\)/);
    assert.match(modal, /requestId !== createSessionRequestRef\.current/);
    assert.match(modal, /completedRef\.current = true/);
    assert.match(modal, /if \(!completedRef\.current && currentSessionId\)/);
  });

  it("scopes action-form success events to the message composer form", () => {
    const actionForm = source("src/components/ActionForm.tsx");
    const page = source("src/app/messages/[id]/page.tsx");
    const composer = source("src/components/MessageComposer.tsx");
    const threadMessages = source("src/components/ThreadMessages.tsx");

    assert.match(actionForm, /detail: \{ formId \}/);
    assert.match(page, /const messageComposerFormId = `message-composer-\$\{convo\.id\}`/);
    assert.match(page, /<ActionForm id=\{messageComposerFormId\} action=\{sendMessage\}>/);
    assert.match(page, /<MessageComposer successEventFormId=\{messageComposerFormId\}/);
    assert.match(page, /refreshEventFormId=\{messageComposerFormId\}/);

    assert.match(composer, /successEventFormId/);
    assert.match(composer, /if \(formId !== successEventFormId\) return/);
    assert.match(threadMessages, /refreshEventFormId/);
    assert.match(threadMessages, /if \(formId !== refreshEventFormId\) return/);
  });
});
