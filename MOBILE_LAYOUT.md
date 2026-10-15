# Mobile viewport and form controls

## Findings

The existing `forntend/index.html` already declares `width=device-width, initial-scale=1.0`. It has no restriction on pinch zoom and was left unchanged. The initial headless Chromium audit measured scale 1 and no document overflow on the storefront, cart, checkout and account at 320, 390, 430 and 1280 CSS pixels. The reported initial Android zoom was not reproduced in this environment.

Customer controls were smaller than the usual iOS focus-zoom threshold: login/search CSS used 13.5 px, checkout address controls 14 px, and the checkout coupon input measured 13 px in Chromium. These were concrete focus-zoom triggers in the styles, although actual Safari focus zoom was not tested. Mobile customer controls now use 16 px; the existing 28 px OTP input remains large. Labels, product text and desktop typography retain their previous sizes.

The mobile storefront used a fixed `100vh` shell, including a later tablet override. Authentication also used `100vw`/`100vh` and vertically centered its card without guaranteeing access to the top of an oversized form. These were layout risks when browser chrome or available height changes. Mobile shells now use `100dvh` with a `100vh` fallback. The authentication card centers when there is space and scrolls from its top when there is not. Scrollable flex content may shrink, and bottom navigation reserves the existing safe-area inset. No document-level overflow hiding, zoom restriction or CSS transform was added.

## Changes

| File | Purpose |
| --- | --- |
| `forntend/src/index.css` | Dynamic viewport heights at mobile and tablet breakpoints |
| `forntend/src/modules/User/User.css` | Customer control sizes, OTP exception, flex scrolling, safe-area padding and scrollable authentication layout |
| `forntend/src/modules/User/pages/AuthPage.jsx` | Stable OTP class while retaining validation error styling |
| `forntend/src/modules/User/pages/CheckoutPage.jsx` | Allow coupon input to shrink inside its flex row |
| `forntend/scripts/mobile-layout.test.mjs` | Real headless Chromium layout regression checks using isolated API fixtures |
| `forntend/package.json` | `npm run test:mobile` runner |

The control rule deliberately overrides legacy inline font sizes only within the customer portal at widths up to 768 px. It does not change seller/admin/delivery portal styles or business logic. Existing horizontal carousels remain scrollable. The existing image-search dialog already has bounded height and internal scrolling; the cart message dialog passed the shortened-height checks without a styling change.

## Running browser checks

Run `cd forntend` then `npm run test:mobile`. Requires Node with built-in WebSocket support (verified with Node 24) and Chrome/Chromium/Edge installed. Set `CHROME_BIN` if its location is not detected. This uses the browser's DevTools protocol without adding dependencies. The runner serves Vite on a local ephemeral port and uses a temporary browser profile that is removed afterward. Every `/api/` request is intercepted before network dispatch; external resources are blocked. No real accounts, OTP messages, orders or payments are used.

The main run covers nine states at 320, 360, 375, 390, 412, 430, 768, 1280 and 1440 px: home, search with product cards, cart, checkout, checkout address entry, authenticated account, guest login, registration and OTP. It checks document/container overflow, scale and mobile control sizes. Registration and address forms are also focused after resizing to 420 px high. A second run checks cart-message and image-search dialogs at 320 and 390 px wide, including a 320 px-high viewport. The viewport meta tag is checked for device width, initial scale and accessible zoom settings. Ignored JSON reports are written under `test-artifacts/mobile-layout`.

## Verification and limits

Existing frontend suites: authentication 23 passed, checkout 8 passed, services 16 passed, image search 12 passed; zero failures or skips. Authentication was rerun after the final OTP binding correction. Production build passed after the final application changes; the existing bundle-size warning remains. `git diff --check` and Node syntax checking passed.

Browser commands actually run: `node scripts/mobile-layout.test.mjs` passed 81 page/state checks; `node scripts/mobile-layout.test.mjs --dialogs` passed 4 dialog checks. Both reported zero uncaught application errors. Their combined command is available as `npm run test:mobile`. The initial expanded runs caught OTP binding and selector-specificity mistakes in the new changes; both were corrected before these successful runs.

Layout checks use fixture data rather than a production catalogue. Chromium viewport resizing approximates available space; it does not reproduce a mobile keyboard, Safari's visual/layout viewport behavior, device safe-area hardware, or actual pinch gestures. Android Chrome and iOS Safari were not tested on real devices. The originally reported Android initial zoom remains unconfirmed; verify the deployed build and browser state on the affected device. Live login, payment and order placement were not performed.

The initial worktree was clean. No backend changes, production data writes or deployments were performed.
