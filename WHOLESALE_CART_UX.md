# Wholesale header and cart UX

The catalog's identity pill rendered `currentUser.name`; it was not a hardcoded name. That redundant customer/avatar control is removed. Authentication, the storefront account control, seller names on product cards, and the shared product detail implementation are preserved.

Wholesale's separate page previously rendered mostly plain HTML without the storefront's cards, button classes, or totals rows. It now uses shared cart presentation with explicit Retail / Wholesale navigation. The two routes and server carts remain separate because their checkout obligations differ.

## Shared presentation and preserved behavior

- `CartIcon`: extracted from the existing customer bottom navigation, reused by the Wholesale header/cart and bottom navigation.
- `CartEmptyState`: extracted from the retail cart; both carts use it with their own browsing destination.
- `CartTotalRow`: extracted from the retail grouped-cart presentation and reused for Wholesale's authoritative totals.
- `CartModeNav`: shared by `/cart` and `/wholesale/cart`; the active checkout mode is explicit. Existing direct Wholesale product purchase links continue to work.
- Existing `profile-header-gradient`, `profile-menu-card`, `pd-add-to-cart-btn`, typography, theme variables, and customer bottom navigation are reused. Wholesale uses responsive cards and radio choices consistent with retail checkout's address/payment presentation.
- The bottom navigation continues to open the original retail cart and use its existing real count. In Wholesale it explicitly says **Retail Cart**. It reaches Wholesale through the shared mode navigation. No fabricated or combined count is introduced; Wholesale's line count and quantities come from its server response.
- Empty Wholesale carts show Browse Wholesale and a disabled place-order action. Delivery/payment/total cards appear only for carts with items. Invalid quotes do not display checkout totals. Invalid lines remain removable.
- Quantity controls display the quoted MOQ, increment, stock and unit price. Changes and removals call only `/api/cart/wholesale/:itemId`, then reload the authoritative quote.
- Wholesale still calls `placeUnifiedOrder(method, 0, { purchaseMode: 'wholesale', quoteHash })`, which uses the existing `/api/orders/unified` contract. Retail retains its original cart and checkout functions/routes. Wholesale's existing lock, separate idempotency key, recovery check and online-payment function remain in place.
- No backend application code, seller approval/eligibility, payment, order, cancellation, refund or inventory rules were changed by this task.

## Files changed by this task

Existing user changes were present before work began; this list covers only files edited or created for this task.

| File | Change |
| --- | --- |
| `forntend/src/modules/User/components/CartUI.jsx` | Shared icon, empty state, mode navigation, card and totals components; navigation helpers. |
| `forntend/src/modules/User/components/CartUI.css` | Shared presentation and responsive Wholesale cart layout. |
| `forntend/src/modules/User/components/BottomNav.jsx` | Reuse cart icon; clarify retail badge/navigation while in Wholesale. |
| `forntend/src/modules/User/components/UnifiedCartGroups.jsx` | Reuse extracted totals row; preserve grouped retail behavior. |
| `forntend/src/modules/User/pages/CartPage.jsx` | Shared empty state and mode navigation; retain original items and checkout. |
| `forntend/src/modules/User/pages/WholesalePage.jsx` | Remove customer identity pill; use shared cart icon/navigation. |
| `forntend/src/modules/User/pages/WholesaleCartPage.jsx` | Storefront cart presentation; useful empty/error/loading states; retain Wholesale operations and recovery; guard late quote responses by customer session. |
| `forntend/scripts/wholesale-ui.test.mjs` | Update header regression; add empty state, authoritative quantity/totals, mutation isolation, refresh and navigation tests. |
| `backend/scripts/verifyWholesaleCartBrowser.mjs` | Chrome regression suite using a disposable database and local built application; adapted from the existing shared-detail browser fixture without modifying it. |
| `WHOLESALE_CART_UX.md` | This report. |

Generated browser evidence is in `test-artifacts/wholesale-cart-ux/`, including `browser.json` and desktop/mobile screenshots. Builds generate the normal ignored frontend `dist` directory.

## Verification commands and results

From `forntend`:

```powershell
node --test --test-concurrency=1 scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/checkout-ui.test.mjs
# 59 passed, 0 failed
npm run build
# Passed; Vite reports the existing large-chunk warning.
```

From `backend`:

```powershell
npm test -- --runInBand __tests__/api/wholesale.http.test.js __tests__/services/wholesalePricing.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/cart.api.test.js
# 4 suites passed; 142 tests passed, 0 failed
npm run build
# Passed: syntax and backend service-package checks.
```

From the repository root:

```powershell
node backend/scripts/verifyWholesaleCartBrowser.mjs
# Passed in genuine headless Google Chrome at 1280px and 390px.
git diff --check
# Passed; Git also emitted line-ending notices for existing working-tree files.
git -c core.safecrlf=false diff --check
# Passed without line-ending notices.
```

The frontend tests cover original retail checkout API calls, Wholesale mode/quote submission, rapid double taps, separate idempotency/recovery state, empty/invalid carts, authoritative totals, MOQ/increment/stock boundaries, stale quote handling, shared product routes and authenticated-session changes. Backend tests verify server enforcement and isolated retail/Wholesale order creation, repricing, retries and transactional behavior.

Chrome verifies the catalog has no customer pill and retains cart access; empty and populated carts; actual API totals; quantity update/removal; retail-cart preservation; mode navigation; reload and Back/Forward; and E-Commerce, Quick Commerce, digital, multi-channel and Wholesale-only product details. The suite checks failed/slow/timed-out quote recovery and 31 successful quote responses. Cart document widths equal their viewports: **1280/1280** and **390/390**, with two desktop columns and one mobile column. No console errors, uncaught browser errors or unexpected failed requests were recorded. Screenshots were visually inspected.

## Limits and environment

Chrome runs the actual built frontend and HTTP backend on disposable loopback ports with a temporary MongoDB replica set, rather than mutating the developer's existing `localhost:4173` session/database. It creates and updates disposable carts but creates no browser orders or payment charges. Checkout/order/payment paths are covered by the isolated automated tests; external payment/provider behavior uses test fixtures. Google Fonts is intentionally blocked in the isolated browser, so screenshots use the available fallback font. The frontend bundle-size warning remains.

The requested graph MCP tools were not available in this session. Targeted filesystem inspection was used as the fallback; `.mcp.json` was left unchanged. Existing user changes, including the shared Wholesale product detail work, were preserved. No commit, push, deployment, production restart or production-data modification was performed.
