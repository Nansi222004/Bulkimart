# Shared customer product detail implementation

## Inspection and data flow (before editing)

- `forntend/src/modules/User/pages/LandingPage.jsx` owns the `.product-detail-overlay` and mounts `ProductDetailPage` when `UserContext.selectedProduct` is available. It already has inline product-link loading/error/retry states.
- `UserContext.jsx` restores `?product=...&variant=...` from the public product endpoint, with request cancellation, timeouts and stale-route protection. `setSelectedProduct` currently removes the purchase mode and variant. `/wholesale/:id` is not restored by this path.
- `ProductDetailPage.jsx` contains the existing gallery, title, seller, retail price, variants, descriptions/specifications, related products, reviews/Q&A, digital details and sticky purchase actions. It already calls `useProductWholesale` and `ProductWholesaleOffer`.
- `WholesalePage.jsx` independently renders `/wholesale/:id` using a second detail layout and client-computed tier subtotals. Catalog filters/page state are local to this component.
- `useProductWholesale.js` obtains authenticated availability from `/api/products/wholesale/catalog?productId=...`, quotes with `POST /api/products/wholesale/quote`, and adds intent through `POST /api/cart/wholesale`. Buy Now enters `wholesale/cart`, whose existing checkout uses the unified order endpoint in Wholesale mode. Quote/cart fetches currently have no timeout and cart response identity does not include quantity/mode.
- Backend `wholesaleCatalog.service.js` returns eligible physical variant offers through an authenticated, allowlisted serializer, but lacks some common product metadata. Public product responses correctly deny Wholesale-only products and hide tiers. Existing `sellingChannels`, seller/account/category approval and shared stock checks remain authoritative.

The implementation will route both URL forms through the existing context and detail overlay, remove the independent Wholesale detail markup, retain the catalog, and extend only the authenticated serializer with safe shared-page metadata. No public access, pricing, inventory, order or payment policy needs to be widened.

## Result and root cause

The inconsistency came from two render paths: the storefront mounted `ProductDetailPage` through `LandingPage`/`UserContext`, while `/wholesale/:id` rendered independent, reduced detail markup inside `WholesalePage`. That path also calculated a tier subtotal locally. The context restored only public retail detail links, which cannot load Wholesale-only products. Finally, Wholesale cart routing listened to `popstate` without the application's programmatic `app:locationchange` event.

Both product URL conventions now mount the existing detail overlay and `ProductDetailPage`. The shared gallery, seller, description, information, approved reviews/Q&A, recommendations, digital metadata and sticky actions remain in that component. Wholesale changes pricing, eligible variants, quantity and purchase controls. Quote and cart operations continue to use the established authenticated endpoints and existing cart/checkout.

## Files changed for this task

| File | Purpose |
| --- | --- |
| `forntend/src/modules/User/utils/productRoute.js` | Shared query/path parsing, Wholesale catalog navigation, authenticated-detail adapter and sign-in return intent. |
| `forntend/src/modules/User/context/UserContext.jsx` | Restore product/variant/mode/session from both URL conventions; select the appropriate existing API; validate responses; cancel/ignore obsolete requests; preserve retry and sign-in return. |
| `forntend/src/modules/User/pages/LandingPage.jsx` | Mount the same keyed detail component; preserve guest Wholesale intent and provide authentication recovery. |
| `forntend/src/modules/User/pages/WholesalePage.jsx` | Remove the separate detail implementation; open shared details; preserve catalog filters/pagination; handle programmatic cart/history navigation. |
| `forntend/src/modules/User/pages/ProductDetailPage.jsx` | Reuse all core sections for Wholesale, safe metadata and relevant recommendations; preserve history/mode; show Wholesale actions; prevent retail actions on Wholesale-only data; accessible missing-image fallback. |
| `forntend/src/modules/User/hooks/useProductWholesale.js` | Mode/history restoration, quote/cart deadlines, response identity checks, quantity/mode/session cancellation guards and authoritative quote validation. |
| `forntend/src/modules/User/hooks/useWholesaleRecommendations.js` | Obtain eligible recommendations through the authenticated catalog with cancellation and identity guards. |
| `forntend/src/modules/User/hooks/useProducts.js` | Carry supported detail metadata and optionally avoid irrelevant public recommendation requests. |
| `forntend/src/modules/User/components/ProductWholesaleOffer.jsx` | Wholesale identity, saved starting price, MOQ/increment/tiers, quote totals and recoverable errors; disallow Retail for Wholesale-only products. |
| `forntend/src/modules/User/User.css` | Scoped Wholesale layout, responsive controls/sticky actions and image fallback. |
| `backend/services/wholesaleCatalog.service.js` | Extend the existing authenticated allowlist with brand, SKU, channel availability, variant weight, approved review summaries and answered FAQs needed by the shared layout. |
| `forntend/scripts/product-wholesale.test.mjs` | Component/provider regressions for restored links, shared layout, digital metadata, authorization return, stale/invalid/timeout quotes and stale cart responses. |
| `forntend/scripts/wholesale-ui.test.mjs` | Shared catalog navigation and actual programmatic cart rendering; existing cart/provider regressions retained. |
| `backend/__tests__/api/wholesale-product-creation.http.test.js` | Extend existing disposable HTTP tests with authenticated safe detail metadata, private-field exclusion and public Wholesale-only isolation. |
| `backend/scripts/verifySharedProductDetailBrowser.mjs` | Reproducible Chrome verification against the built frontend, real local HTTP backend and disposable replica set. |
| `WHOLESALE_SHARED_DETAIL.md` | Inspection, implementation and verification report. |

Several listed files already contained earlier local work. This task preserves those changes; the remaining dirty seller/admin/order/payment/channel-creation files belong to earlier work and were not overwritten.

## Backend compatibility and isolation

No new model or endpoint was needed. Wholesale detail data comes from authenticated `GET /api/products/wholesale/catalog?productId=...`; quotes use `POST /api/products/wholesale/quote`; cart additions send only product ID, variant ID and quantity to `POST /api/cart/wholesale`. Buy Wholesale Now renders the existing Wholesale cart. The shared detail adapter never copies tier prices into retail prices.

The metadata extension is restricted to the existing authenticated catalog serializer. Only approved review data and answered FAQs are exposed, with explicit fields and no reviewer user IDs. Existing customer authorization, seller/product eligibility, channel isolation, stock and pricing validations remain authoritative. Public direct detail requests still reject Wholesale-only products. No checkout, order, payment, cancellation, refund or inventory semantics were changed for this task.

## Automated verification

Frontend commands run from `forntend`:

```powershell
node --test --test-concurrency=1 scripts/seller-profile-wholesale.test.mjs scripts/seller-notifications.test.mjs scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/portal-startup.test.mjs scripts/socket-ui.test.mjs scripts/image-search-ui.test.mjs scripts/service-ui.test.mjs scripts/product-link.test.mjs
# 187 passed, 0 failed, 0 skipped.

node --test --test-concurrency=1 scripts/product-wholesale.test.mjs scripts/wholesale-ui.test.mjs scripts/product-link.test.mjs
# Final focused rerun: 44 passed, 0 failed, 0 skipped.

npm run build
# Passed. Existing large-chunk warning remains.
```

Backend commands run from `backend`:

```powershell
npm test -- --runInBand __tests__/api/wholesale-product-creation.http.test.js __tests__/api/seller-profile-wholesale.http.test.js __tests__/api/wholesale.http.test.js __tests__/api/seller-product-creation.api.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/seller-payment.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/api/image-search.http.test.js __tests__/api/cart.api.test.js __tests__/services/inventory.service.test.js __tests__/services/onboarding-regressions.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/retired-notifications.http.test.js
# 14 suites passed; 345 tests passed, 0 failed, 5 skipped (350 total).
# Skips are existing retired mocked PhonePe cases.

npm run build
# Passed.
```

Repository command `git diff --check` passed. Git reports existing LF/CRLF conversion notices, not whitespace errors. No dependency or lockfile changes were needed.

## Actual browser verification

Command from repository root:

```powershell
node backend/scripts/verifySharedProductDetailBrowser.mjs
```

Headless Chrome runs the actual built application against normal backend HTTP routes and an isolated disposable MongoDB replica set on dynamically allocated local ports. This does not use or verify the existing databases behind ports 4173/5050. Product/catalog/quote/cart responses are real, not component mocks. External providers use test mode; external Google Fonts are blocked. Deliberate slow, failed and timed-out quote responses are injected to exercise recovery.

At both 1280x900 and 390x900, the workflow verifies retail physical, Wholesale-only physical, multi-channel physical, Quick Commerce and digital products; shared gallery/details; SKU/attributes; actual saved-tier quotes; quantity/variant changes; invalid MOQ/increment/stock boundaries; refresh; Back/Forward; catalog-return filters; switching Retail/Wholesale; quote failure/recovery; and Buy Wholesale Now actually mounting the existing Wholesale cart. The mobile workflow also waits through the real quote deadline and retries. Screens have no horizontal overflow and purchase actions remain reachable. Browser console errors and unexpected failed requests are checked.

Evidence is written locally to `test-artifacts/shared-product-detail/browser.json` and desktop/mobile screenshots in that directory. These generated artifacts are ignored by Git. The harness checks that it creates no customer orders or payment records.

Final browser result: both viewport workflows passed; 31 actual quote responses checked; zero console errors, unexpected failed requests, customer orders or real-data changes. One preceding rerun failed during isolated backend startup before any browser assertions; the harness startup allowance was increased from 15 to 60 seconds and the final rerun passed. Intentional quote faults remain explicitly classified separately from unexpected failures.

## Limits and safety

Component/provider tests mock transport to target races and failure cases; HTTP persistence/security tests and the browser workflow use disposable databases. Retail/Quick Commerce/digital purchase paths and Wholesale checkout are protected by the listed regression suites. Browser checks exercise digital metadata, not delivery of purchased ebook bytes. Live payment providers and real customer purchases are intentionally not exercised.

No commit, staging, push, deployment, production restart or production-data modification was performed. All browser data is disposable; existing unrelated working-tree changes remain intact.
