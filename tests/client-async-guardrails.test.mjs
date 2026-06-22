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
    assert.match(searchBar, /cache: "no-store",\s*signal: controller\.signal/);
    assert.match(searchBar, /signal: controller\.signal/);
    assert.match(searchBar, /requestId !== suggestionsRequestRef\.current/);
    assert.match(searchBar, /suggestionsAbortRef\.current\?\.abort\(\)/);
  });

  it("keeps responsive search combobox ids instance-scoped", () => {
    const searchBar = source("src/components/SearchBar.tsx");

    assert.match(searchBar, /const reactId = React\.useId\(\)/);
    assert.match(searchBar, /const searchListboxId = `\$\{reactId\}-site-search-listbox`/);
    assert.match(searchBar, /aria-controls=\{searchListboxId\}/);
    assert.match(searchBar, /id=\{searchListboxId\}/);
    assert.match(searchBar, /id=\{`\$\{searchListboxId\}-\$\{index\}`\}/);
    assert.doesNotMatch(searchBar, /const SEARCH_LISTBOX_ID/);
  });

  it("keeps blog search suggestions on latest-request-wins semantics", () => {
    const blogSearchBar = source("src/components/BlogSearchBar.tsx");

    assert.match(blogSearchBar, /MAX_BLOG_SEARCH_QUERY_LENGTH = 200/);
    assert.match(blogSearchBar, /suggestionsAbortRef/);
    assert.match(blogSearchBar, /suggestionsRequestRef/);
    assert.match(blogSearchBar, /fetch\(`\/api\/blog\/search\/suggestions\?bq=\$\{encodeURIComponent\(q\)\}`, \{\s*cache: "no-store",\s*signal: controller\.signal,\s*\}\)/);
    assert.match(blogSearchBar, /requestId !== suggestionsRequestRef\.current/);
    assert.match(blogSearchBar, /suggestionsAbortRef\.current\?\.abort\(\)/);
    assert.match(blogSearchBar, /maxLength=\{MAX_BLOG_SEARCH_QUERY_LENGTH\}/);
  });

  it("keeps blog search suggestions keyboard-accessible with instance-scoped ids", () => {
    const blogSearchBar = source("src/components/BlogSearchBar.tsx");

    assert.match(blogSearchBar, /const reactId = React\.useId\(\)/);
    assert.match(blogSearchBar, /const blogSearchListboxId = `\$\{reactId\}-blog-search-listbox`/);
    assert.match(blogSearchBar, /role="combobox"/);
    assert.match(blogSearchBar, /aria-controls=\{blogSearchListboxId\}/);
    assert.match(blogSearchBar, /aria-activedescendant=\{activeOptionId\}/);
    assert.match(blogSearchBar, /id=\{blogSearchListboxId\}/);
    assert.match(blogSearchBar, /role="listbox"/);
    assert.match(blogSearchBar, /role="option"/);
    assert.match(blogSearchBar, /id=\{`\$\{blogSearchListboxId\}-\$\{index\}`\}/);
    assert.match(blogSearchBar, /e\.key === "ArrowDown"/);
    assert.match(blogSearchBar, /e\.key === "ArrowUp"/);
    assert.match(blogSearchBar, /e\.key === "Enter"/);
    assert.match(blogSearchBar, /chooseOption\(activeOption\)/);
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

  it("does not claim a signed-in shipping address was saved when the save request fails", () => {
    const shippingAddressForm = source("src/components/ShippingAddressForm.tsx");

    assert.match(shippingAddressForm, /const \[saveError, setSaveError\]/);
    assert.match(shippingAddressForm, /const res = await fetch\("\/api\/account\/shipping-address"/);
    assert.match(shippingAddressForm, /if \(!res\.ok\) \{/);
    assert.match(shippingAddressForm, /setSaveError\("We couldn't save this address/);
    assert.match(shippingAddressForm, /if \(!res\.ok\) \{[\s\S]*?setSaveError[\s\S]*?return;\s*\}/);
    assert.match(shippingAddressForm, /catch \(err\) \{[\s\S]*?setSaveError[\s\S]*?return;\s*\}/);
    assert.match(shippingAddressForm, /role="alert"/);
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

  it("handles Clerk client actions without clearing local state before failed sign-out", () => {
    const header = source("src/components/Header.tsx");
    const avatarMenu = source("src/components/UserAvatarMenu.tsx");

    for (const text of [header, avatarMenu]) {
      assert.match(text, /handleOpenUserProfile/);
      assert.match(text, /try \{[\s\S]*?openUserProfile/);
      assert.match(text, /catch \(error\) \{[\s\S]*?console\.warn/);
      assert.match(text, /await signOut\(\{ redirectUrl: "\/" \}\);[\s\S]*?clearSignedOutLocalAccountState\(\)/);
    }
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
    assert.match(modal, /keepalive: true/);
    assert.match(modal, /await rollbackCheckoutSessions\(\[nextSessionId\]\)/);
    assert.match(modal, /requestId !== createSessionRequestRef\.current/);
    assert.match(modal, /completedRef\.current = true/);
    assert.match(modal, /if \(!completedRef\.current && currentSessionId\)/);
  });

  it("rolls back cart checkout sessions on pagehide without persisting Stripe secrets", () => {
    const cartPage = source("src/app/cart/page.tsx");

    assert.match(cartPage, /keepalive: true/);
    assert.match(cartPage, /const clientSecretsRef = React\.useRef<ClientSecretEntry\[\]>\(\[\]\)/);
    assert.match(cartPage, /const completedSessionIdsRef = React\.useRef<Set<string>>\(new Set\(\)\)/);
    assert.match(cartPage, /const checkoutCompletedRef = React\.useRef\(false\)/);
    assert.match(cartPage, /const \[completedSessionIds, setCompletedSessionIds\] = React\.useState<Set<string>>\(\(\) => new Set\(\)\)/);
    assert.match(cartPage, /React\.useLayoutEffect\(\(\) => \{\s*completedSessionIdsRef\.current = completedSessionIds;/);
    assert.match(cartPage, /const pendingCheckoutSessionIds = React\.useCallback\(\(entries = clientSecretsRef\.current\) =>/);
    assert.match(cartPage, /const completedIds = completedSessionIdsRef\.current/);
    assert.match(cartPage, /\.filter\(\(sessionId\) => !completedIds\.has\(sessionId\)\)/);
    assert.match(cartPage, /window\.addEventListener\("pagehide", rollbackOpenCheckoutSessions\)/);
    assert.match(cartPage, /const sessionIds = pendingCheckoutSessionIds\(\)/);
    assert.match(cartPage, /void rollbackCheckoutSessions\(sessionIds\)/);
    assert.match(cartPage, /checkoutCompletedRef\.current = true/);
    assert.match(cartPage, /flushSync\(\(\) => \{\s*markCheckoutSessionCompleted\(clientSecrets\[currentPaymentIndex\]\?\.sessionId\)/);
    assert.match(cartPage, /\.filter\(\(sessionId\) => !completedSessionIds\.has\(sessionId\)\)/);
    assert.match(cartPage, /completedSessionIds\.size === 0 \? \(/);
    assert.doesNotMatch(cartPage, /writeCartSessionJson\(CART_CHECKOUTS_KEY/);
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

  it("keeps the admin PIN input out of autocomplete and blocks double-submit while loading", () => {
    const pinGate = source("src/components/AdminPinGate.tsx");

    assert.match(pinGate, /if \(loading \|\| locked \|\| pin\.length < 4\) return/);
    assert.match(pinGate, /autoComplete="off"/);
    assert.match(pinGate, /e\.key === "Enter" && !loading && !locked && pin\.length >= 4/);
    assert.match(pinGate, /void handleVerify\(\)/);
  });

  it("waits for Clerk loading and bounds notification dropdown payloads", () => {
    const bell = source("src/components/NotificationBell.tsx");
    const unread = source("src/components/UnreadBadge.tsx");

    assert.match(bell, /const \{ isLoaded, isSignedIn \} = useUser\(\)/);
    assert.match(bell, /MAX_NOTIFICATION_ITEMS = 20/);
    assert.match(bell, /function normalizeNotificationsResponse/);
    assert.match(bell, /\.filter\(isNotificationItem\)\.slice\(0, MAX_NOTIFICATION_ITEMS\)/);
    assert.match(bell, /if \(!isLoaded \|\| !isSignedIn\) return/);
    assert.match(unread, /const \{ isLoaded, isSignedIn \} = useUser\(\)/);
    assert.match(unread, /if \(!isLoaded \|\| !isSignedIn\) return/);
  });

  it("keeps public case and review form network failures recoverable", () => {
    const openCase = source("src/components/OpenCaseForm.tsx");
    const reviews = source("src/components/ReviewItemClient.tsx");

    assert.match(openCase, /try \{[\s\S]*?await fetch\("\/api\/cases"/);
    assert.match(openCase, /catch \{[\s\S]*?setError\("Failed to open case"\)/);
    assert.match(openCase, /finally \{[\s\S]*?setLoading\(false\)/);
    assert.match(reviews, /catch \{[\s\S]*?toast\("Failed", "error"\)/);
    assert.match(reviews, /catch \{[\s\S]*?toast\("Failed to reply", "error"\)/);
  });

  it("validates dismissible-banner storage before using parsed ids", () => {
    const banner = source("src/components/DismissibleBanner.tsx");

    assert.match(banner, /MAX_DISMISSED_REJECTED_IDS = 500/);
    assert.match(banner, /function normalizeDismissedIds\(ids: string\[\]\): string\[\]/);
    assert.match(banner, /\.slice\(-MAX_DISMISSED_REJECTED_IDS\)/);
    assert.match(banner, /function parseDismissedIds\(stored: string \| null\): string\[\]/);
    assert.match(banner, /const parsed: unknown = JSON\.parse\(stored\)/);
    assert.match(banner, /Array\.isArray\(parsed\)/);
    assert.match(banner, /filter\(\(id\): id is string => typeof id === "string"\)/);
    assert.doesNotMatch(banner, /JSON\.parse\(stored\) as string\[\]/);
  });

  it("aborts account feed loads on unmount and ignores stale responses", () => {
    const feed = source("src/app/account/feed/FeedClient.tsx");

    assert.match(feed, /mountedRef/);
    assert.match(feed, /feedAbortRef/);
    assert.match(feed, /feedRequestRef/);
    assert.match(feed, /const controller = new AbortController\(\)/);
    assert.match(feed, /fetch\(url, \{ cache: "no-store", signal: controller\.signal \}\)/);
    assert.match(feed, /requestId !== feedRequestRef\.current/);
    assert.match(feed, /controller\.signal\.aborted/);
    assert.match(feed, /error instanceof DOMException && error\.name === "AbortError"/);
    assert.match(feed, /feedAbortRef\.current\?\.abort\(\)/);
  });

  it("validates markdown image upload responses before inserting editor images", () => {
    const markdown = source("src/components/MarkdownToolbar.tsx");

    assert.match(markdown, /isFirstPartyMediaUrl/);
    assert.match(markdown, /function markdownUploadImageUrl\(raw: unknown\): string \| null/);
    assert.match(markdown, /typeof raw !== "string"/);
    assert.match(markdown, /!isFirstPartyMediaUrl\(value\)/);
    assert.match(markdown, /throw new Error\("Image upload returned an invalid URL\."\)/);
    assert.doesNotMatch(markdown, /const \{ publicUrl \} = await uploadRes\.json\(\) as \{ publicUrl: string \}/);
  });

  it("keeps toast context value stable between toast list updates", () => {
    const toast = source("src/components/Toast.tsx");

    assert.match(toast, /useMemo/);
    assert.match(toast, /const value = useMemo\(\(\) => \(\{ toast \}\), \[toast\]\)/);
    assert.match(toast, /<ToastContext\.Provider value=\{value\}>/);
    assert.doesNotMatch(toast, /<ToastContext\.Provider value=\{\{ toast \}\}>/);
  });

  it("surfaces commission status update failures to the seller", () => {
    const markStatusButtons = source("src/app/commission/[param]/MarkStatusButtons.tsx");

    assert.match(markStatusButtons, /useToast/);
    assert.match(markStatusButtons, /await res\.json\(\)\.catch\(\(\) => null\)/);
    assert.match(markStatusButtons, /if \(!res\.ok\) \{/);
    assert.match(markStatusButtons, /toast\(data\?\.error \?\? "Could not update commission request\.", "error"\)/);
    assert.match(markStatusButtons, /catch \{[\s\S]*?toast\("Network error\. Please try again\.", "error"\)/);
  });
});
