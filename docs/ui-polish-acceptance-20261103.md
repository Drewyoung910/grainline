# UI polish acceptance checklist — 2026-11-03

This is the durable acceptance list for Drew's review of the Claude/Codex UI
stack. An item is checked only when the behavior exists on the branch. Browser,
device, and signed-in acceptance still happens on the completed canary before
Production promotion.

## Preserve

- [x] Preserve the homepage category design. It is the visual reference, not a
  surface to flatten into generic controls.
- [x] Preserve Claude's useful motion, cart, gallery, filter, seller-profile,
  review, and card features while correcting their regressions.
- [x] Preserve every route and user-facing feature from the original UI stack;
  the correction branches remove defective timing and styling, not product
  capabilities.

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
- [x] Hero copy and photo do not replay or lag through an entrance sequence.
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

## Search and browse

- [x] The first search focus warms and displays one stable recommendation set;
  fallback categories no longer flash before live results replace them.
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
- [x] Add to cart draws a confirmation, flies the photo toward the cart, and
  bumps the cart count; row removal collapses continuously.
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

## Final acceptance before Production

- [ ] Run the one consolidated focused test/type/lint/build pass after this UI
  implementation batch is complete.
- [ ] Deploy one fresh canary from the final commit and test current iPhone
  Safari/PWA, desktop Safari, signed-in header/cart, Clerk, and Stripe return.
- [ ] Promote only after the canary checklist passes; Production remains
  unchanged until then.
