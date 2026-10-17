# Seller Products UI and Wholesale offer management

## Cause and implementation

The previous Wholesale branch returned its own listing component before the common Products shell. It duplicated heading/tabs/modal ownership, omitted the main toolbar action, and used a different layout. Its editor reused the retail variant panel, showing editable-looking retail controls ahead of Wholesale terms.

- `forntend/src/modules/Seller/components/ProductsTab.jsx`: one heading, toolbar, selling-mode controls and modal owner for all modes; Wholesale uses **Add Wholesale Offer** in the existing primary-action position. Existing retail filters, upload and create/edit flows remain.
- `forntend/src/modules/Seller/components/SellerWholesaleProducts.jsx`: mode-specific filters, paginated variant rows, eligibility, offer summaries, stock and edit actions inside the shared shell. API errors, loading and empty states remain distinct.
- `forntend/src/modules/Seller/components/WholesaleOfferSelector.jsx`: selects an existing eligible physical product and variant, shows read-only identity/SKU/stock, then opens the existing ProductModal for that variant. It never creates a product.
- `forntend/src/modules/Seller/context/SellerContext.jsx`: carries the selected Wholesale variant into the existing editor; retail callers retain the existing default behavior.
- `forntend/src/modules/Seller/components/ProductModal.jsx`: Wholesale-only presentation with read-only reference data, reused terms fields and save handler, success/error/retry states. Request invalidation includes variant identity. The ordinary retail editor remains available in retail modes.
- `forntend/src/modules/Seller/components/VariantWholesaleFields.jsx`: styled enabled toggle, MOQ, increment, add/remove tier controls and associated inline validation. Starting an empty tier schedule uses the configured MOQ.
- `forntend/src/modules/Seller/utils/wholesaleEligibility.js`: shared frontend access and physical product/variant eligibility checks. Backend checks remain authoritative.
- `forntend/src/modules/Seller/hooks/useSellerDialog.js`: focus containment and restoration for the offer selector and editor.
- `forntend/src/modules/Seller/Seller.css`: common products styling, responsive table, controls and scrollable terms dialog. The new Wholesale overlay sits above the mobile sidebar; screenshot review caught and corrected the original overlay stacking defect.
- `forntend/scripts/seller-profile-wholesale.test.mjs`: expanded component/context regressions.
- `backend/__tests__/api/seller-profile-wholesale.http.test.js`: added quantity and monetary limit rejection/persistence coverage.
- `backend/scripts/verifySellerProfileWholesaleBrowser.mjs`: expanded isolated real Chrome/API workflow and viewport evidence.

No new API, model, dependency or backend production-code change was needed for this UI follow-up. It reuses `PATCH /api/products/:id/wholesale-pricing` and `variants[].wholesalePricing` from the preceding implementation, with server ownership, account/approval, product/category/stock checks and transactional version checks. Earlier seller-profile/backend work and unrelated working-tree changes were preserved.

## Offer rules and isolation

Enabled offers require whole-number MOQ/increment/thresholds from 1 through 100,000, stock meeting MOQ, first threshold at MOQ, unique increasing thresholds aligned to MOQ plus increments, positive unit prices with at most two decimals and the existing maximum of ₹1,00,000, and nonincreasing prices at higher quantities. The backend independently validates these rules (normalizing threshold order). Quotes and money calculations still use the existing server pricing service and integer paise.

Only changed variant Wholesale terms and the product version are sent. Retail price, MRP, unit, weight and stock have no editable controls in the Wholesale-only view. Disabling writes disabled Wholesale terms without deleting a product, changing prices or deducting inventory. Failed saves retain the draft; duplicate saves are locked and obsolete responses are ignored.

## Verification

Commands run from `forntend`:

```powershell
node --test --test-concurrency=1 scripts/seller-profile-wholesale.test.mjs scripts/seller-notifications.test.mjs scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/portal-startup.test.mjs scripts/socket-ui.test.mjs scripts/image-search-ui.test.mjs scripts/service-ui.test.mjs scripts/product-link.test.mjs
npm run build
```

Frontend: **173 passed, 0 failed, 0 skipped**. This includes 19 focused seller-profile/Wholesale tests. Production build passed; Vite reports the existing large-chunk warning.

Commands run from `backend`:

```powershell
npm test -- --runInBand __tests__/api/seller-profile-wholesale.http.test.js __tests__/api/wholesale.http.test.js __tests__/api/seller-product-creation.api.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/retired-notifications.http.test.js __tests__/services/onboarding-regressions.test.js
npm run build
```

Backend: **6 suites passed, 197 tests passed, 0 failed, 0 skipped**. Includes HTTP authorization, foreign-product/variant rejection, digital/inactive/category/stock/account rejection, pending/rejected/suspended access, optimistic concurrency, tier persistence/disable isolation and existing product creation/Wholesale checkout regressions. Backend build passed.

Commands run from repository root:

```powershell
node backend/scripts/verifySellerProfileWholesaleBrowser.mjs
git diff --check
```

Final Chrome run passed. It used the actual compiled frontend, actual HTTP backend and disposable local MongoDB replica set, on isolated dynamically allocated local ports. No API mocks; external providers were in mock mode. It did not test against or modify the existing localhost:4173/5050 instance or its database.

Chrome verified all three active tabs and common heading/toolbar at **1280 × 900** and **390 × 900**, no page horizontal overflow, Add Wholesale Offer product/variant selection with digital products excluded, Wholesale-only editor without retail inputs, scrollable mobile tiers, reachable Save/Close controls, two-tier save/reload persistence, edit/disable, unchanged E-Commerce and Quick Commerce prices/stock, denied unapproved/digital direct API requests, and access suspension refresh. Existing profile and notification browser checks also passed. Full retail/Quick Commerce create/upload journeys were covered by regressions rather than repeated manually in Chrome.

Evidence: `test-artifacts/seller-profile-wholesale/browser.json`, `products-{ECommerce,QuickCommerce,WholesaleBB}-{390,1280}.png`, and `wholesale-editor-{390,1280}.png` (ignored local artifacts).

`git diff --check` passed; Git emitted CRLF conversion notices only. Final diff review preserved pre-existing changes. No supplied screenshot attachments were available for pixel comparison. No live provider, real approval record, customer order, commit, push or deployment was used.
