# UI polish acceptance checklist — 2026-11-03

This is the durable acceptance list for Drew's review of the Claude/Codex UI
stack. An item is checked only when the behavior exists on the branch. Browser,
device, and signed-in acceptance still happens on the completed canary before
Production promotion.

## Preserve

- [x] Preserve the homepage category design. It is the visual reference, not a
  surface to flatten into generic controls.
- [x] Keep small prelaunch catalog counts out of the category tiles and keep
  marketplace statistics hidden until their existing trust thresholds.
- [x] The homepage commission callout uses truthful copy and keeps both phone
  actions compact, equal-width, and on one row.
- [x] Preserve Claude's useful motion, cart, gallery, filter, seller-profile,
  review, and card features while correcting their regressions.
- [x] Preserve every route and user-facing feature from the original UI stack;
  the correction branches remove defective timing and styling, not product
  capabilities.
- [x] Signed-in and staff actions share the pill geometry without flattening
  meaning: warning, success, and destructive actions retain distinct tones.

## Header, hero, and mobile browser chrome

- [x] Homepage image begins at the page's top edge behind the fixed header.
- [x] PWA metadata uses `viewport-fit=cover` and a translucent iOS status bar.
- [x] Homepage header is clear only at the true top and frosts as soon as the
  page starts scrolling; it does not wait for the hero to end.
- [x] Header padding and icon positions stay fixed during that transition.
- [x] Header frost changes promptly instead of taking half a second.
- [x] Search, cart, and menu use the same centered 44 px control geometry.
- [x] Pointer use does not leave a persistent focus halo/background on header
  controls; keyboard Escape still restores an accessible focus target.
- [x] A fresh visit gives hero copy one short, restrained entrance; the photo
  and header stay still, and client-side Back/logo navigation does not replay
  the sequence.
- [x] Marketplace stats stay hidden until the numbers are credible.
- [x] Hero overlay remains attached to the hero during elastic overscroll.
- [ ] Accept the physical safe-area result in current Safari and a newly
  installed PWA. Browser chrome itself cannot be controlled by page CSS.

## Homepage discovery

- [x] Find-shops buttons are a compact two-column row on phones.
- [x] The homepage map has a real phone/tablet height and keeps page scrolling
  available over the embedded map.
- [x] Cluster expansion lands beyond the boundary so individual pins do not
  temporarily disappear.
- [x] Maker cards reserve their final height and use a short opacity entrance,
  not a glitchy spring/reflow.
- [x] Horizontal homepage rows retain touch/trackpad scrolling without visible
  arrow controls or a platform scrollbar. Gallery arrows belong on listing
  photos, not card carousels.
- [x] Listing and story save controls reveal over the photo only on pointer
  hover, stay visible on touch, and retain a shadow/ring over white images.
- [x] Hovering card text does not swap the photo or reveal the save control.
- [x] Listing-card photo hover uses a stationary soft-shadow response; it does
  not lift the card, draw a brown keyline, or move the hit area.
- [x] Listing click analytics count actual listing navigation, not favorite,
  maker-name, Guild-badge, or other controls inside the card.
- [x] Compact followed-maker listing and story cards use that same photo-only
  response; hovering their title or metadata does not raise the whole card.

## Search and browse

- [x] The first search focus warms and displays one stable recommendation set;
  fallback categories no longer flash before live results replace them.
- [x] Search can show device-local recent searches, a few newly added pieces,
  and richer piece/story rows without exposing history across account changes.
- [x] Plain-language price and availability searches get an explicit smart
  filter choice; ordinary text searches keep their literal destination.
- [x] The `/` shortcut focuses the visible search box without stealing keys
  from fields, editors, browser shortcuts, or open dialogs.
- [x] Search result rows use a full-size quiet hover surface rather than small
  boxed labels.
- [x] Search, category, chip, and popover scroll regions hide platform
  scrollbars while retaining scrolling.
- [x] Desktop Category is a compact animated menu with real links, not the
  oversized list or an unstyled native select.
- [x] Category selection has spacing, a quiet selected state, and an arrow that
  rotates only while the menu is actually open.
- [x] Availability, shipping speed, and rating all paint the new choice before
  navigation settles.
- [x] Existing visible results glide to their new positions after a sort,
  filter, or Grid/List change; first load, resizing, off-screen rows, and
  reduced-motion visitors remain still.
- [x] Pointer selection does not leave a dark focus line; keyboard focus stays
  visible.
- [x] Near location appears before lower-priority commercial filters.
- [x] The filter column scrolls with the listing page and has no independent
  tall gray scrollbar or unreachable bottom.
- [x] Sort, Save search, Grid/List, Previous, and Next share the button system;
  Save search sits next to Sort and appears only for a meaningful query/filter.
- [x] Save search retains its text label and animates the bookmark without
  dropping focus while saving.
- [x] Text fields use one quiet stone focus border and soft halo, not a thin
  dark brown keyline.
- [x] Radius follows a semantic system on the reviewed surfaces: pills for
  choices/actions, rounded-xl for fields and compact controls, and rounded-2xl
  for floating cards/popovers. One-off radii are not used as decoration.

## Listing cards, listing page, and cart

- [x] Card hearts are centered and stable; the white circle does not jiggle.
- [x] Main listing photos use `object-contain` and a viewport-bounded height so
  the complete photo and thumbnail row fit without an unnecessary tall frame;
  the phone frame is capped at 26rem and the desktop frame at 32rem.
- [x] Main-photo arrows are confined to the photo and appear on desktop hover
  or keyboard focus, not permanently on touch layouts.
- [x] Expand and favorite controls use matching corner cells and circle sizes.
- [x] The selected thumbnail outline slides to the next image.
- [x] Lightbox close controls have no faint painted rounded box.
- [x] Plain card clicks carry the photo into the listing gallery, and full-screen
  viewers grow from and return to their source photo. Modified clicks,
  reduced-motion visitors, missing images, and abandoned navigation retain the
  ordinary non-animated behavior.
- [x] Add to cart draws a confirmation, flies the photo toward the cart, and
  bumps the cart count; row removal collapses continuously.
- [x] Cart quantity uses a focus-preserving minus/plus stepper: every press is
  visible immediately, rapid presses collapse into serialized saves, and a
  rejected save returns to the server-confirmed quantity.
- [x] Checkout progress uses a restrained moving underline rather than a white
  pill nested inside another pill.
- [ ] Accept real signed-in cart, Clerk, and Stripe interactions on the canary.

## Seller profiles, commissions, and reviews

- [x] Seller banner is edge-to-edge on phones and contained on larger screens.
- [x] Founding Maker/Guild credentials sit below the shop name, not below the
  listing gallery; badge icon and label share one press motion.
- [x] Seller tabs have a true edge-to-edge background and a sliding underline.
- [x] Featured and all-listing cards use compact multi-column widths instead of
  filling the viewport with one huge card.
- [x] Commission categories are one compact horizontally scrolling chip row.
- [x] The phone Post request button remains one line and compact.
- [x] Reviews include an aggregate, five rating-distribution bars (even when
  only one review exists), sort pills, verified-purchase styling, photo
  lightboxes, and a clearer maker-reply card.
- [x] The buyer's own My review card displays the maker reply.
- [ ] Add durable buyer notification when a maker replies to a review.
- [ ] Add the separately reviewed database/app authority for a maker to correct
  a reply during the approved time window.

## Signed-in workspaces and messaging

- [x] Workshop and My account have responsive navigation without removing any
  previous destination; focused edit/onboarding forms keep their full-width
  layout.
- [x] Workshop and My account top-level page headings share one responsive
  scale, while existing page names, destinations, forms, and actions remain.
- [x] Workshop listing actions retain the original ownership, moderation,
  archive, checkout-expiry, cache, and Guild-threshold behavior on the new
  Listings page.
- [x] Workshop attention counts do not claim completeness when the bounded
  order window may hide older work, and onboarding-incomplete shops are not
  labeled open.
- [x] Desktop Messages keeps the conversation rail beside the active thread;
  phones load only the thread and use a short reduced-motion-safe entrance.
- [x] Message snippets name structured attachments and custom-order events
  instead of exposing their stored payload.
- [x] Signed-in commission entry points open the shared request form in a
  discard-safe dialog while retaining a real `/commission/new` link for direct
  visits, signed-out visitors, and new tabs.
- [x] The nearby commission choice is described as discovery priority rather
  than falsely promising nationwide requests are hidden from distant makers.
- [x] All interactive maps retain their existing data and controls while using
  the Grainline land, water, road, and label palette; a missing upstream layer
  or paint failure leaves the stock map working.

## Final acceptance before Production

- [ ] Run the one consolidated focused test/type/lint/build pass after this UI
  implementation batch is complete.
- [ ] Deploy one fresh canary from the final commit and test current iPhone
  Safari/PWA, desktop Safari, signed-in header/cart, Clerk, and Stripe return.
- [ ] Promote only after the canary checklist passes; Production remains
  unchanged until then.
