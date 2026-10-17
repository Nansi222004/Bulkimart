# Unified customer basket — implementation and verification

Local implementation for Quick Commerce (`grocery`), E-Commerce (`ecommerce`) and Wholesale. This supersedes the separate-cart design described in the earlier `WHOLESALE_CART_UX.md` report.

## Read-only findings, reported before implementation

1. Retail carts live in separate `Cart` documents for grocery and ecommerce. The product's actual type selects its cart. Per-channel reads reconcile snapshots against products, campaigns and inventory; historically these reads could remove unavailable lines. Retail quantity mutations retain the existing 20-unit maximum. The per-channel checkout owns eligible coupons and Coins.
2. Wholesale lives in a third document with `channel: wholesale`, using the same unique `(userId, channel)` index. Its mutation controller validates buyer/seller eligibility, MOQ, quantity increments, tiers and stock, and uses version predicates/retries. Its read recomputes a live quote and hashes the seller, products, variants, quantities, terms, prices and delivery amounts. Wholesale checkout clears only that document.
3. `/api/cart/unified` and `/api/orders/unified` initially selected either retail carts or Wholesale, never both. Fulfilment groups used channel, actual seller and delivery mode. Orders retain the underlying grocery/ecommerce fulfilment type and a separate retail/wholesale sales channel.
4. The existing order builder already creates all vendor/fulfilment orders, one Payment and group reference, inventory deductions, wallet debit where applicable, cart clearing and a durable CheckoutAttempt in a single MongoDB transaction. The endpoint could not safely accept all three channels unchanged: selection, grouping identities, sales-channel snapshots, quote validation and cart clearing assumed the retail/Wholesale boundary.
5. Seller IDs come from live products. Checkout resolves an owned saved address or validates the submitted shipping address, reprices each group and validates stock. Conditional inventory writes and transactional seller/account fences protect competing stock and eligibility changes. CheckoutAttempt's unique customer/key index and request digest protect retries; recovery is authenticated, owner-scoped and read-only.
6. Online payment starts after order commit using the existing payment controller. The shared Payment's amount covers every order under its group reference. Existing attempt journals, signature/capture validation, reconciliation and per-order refund obligations handle uncertain initialization, repeated capture and cancellation. Wallet debits are transactional. These existing services can support a mixed basket without another payment implementation.
7. The badge initially summed retail summary counts, excluding Wholesale. Bottom navigation and separate cart-mode navigation exposed two cart experiences. Wholesale product actions already sent only product/variant/quantity to their own API.
8. Existing protections were found in `checkout-workflow.http`, `seller-first-checkout.http`, `wholesale.http`, cart API, inventory, financial-integrity, Razorpay/webhook, Quick Commerce finance, return compatibility and order/seller lifecycle tests, plus frontend checkout/product/auth/service tests. Digital purchases use a separate online-only contract; grouped coupons/Coins are unsupported and must not be silently accepted.

Decision: preserve the documents, index, legacy APIs and financial services. Aggregate the three documents into one logical basket at the existing API boundary. Add an explicit `basket` checkout mode using the existing transactional builder, with both a combined review hash and the original Wholesale quote hash. Use one cart shell and the existing address/payment checkout. No approval, eligibility or inventory policy was broadened.

The graph MCP tools were unavailable; targeted source/dependency inspection was used. No files were modified before the read-only findings were reported in chat.

## Storage, API and financial design

- **Storage:** no migration, new cart record or schema change. The grocery, ecommerce and wholesale documents remain canonical. The existing compound unique index stays intact.
- **Read:** authenticated `GET /api/cart/unified?purchaseMode=basket&lat=...&lng=...` calls the existing retail and Wholesale composers. Each retains its own pricing logic. The response has channel/vendor groups, authoritative totals, warnings, `quoteHash` for exactly the Wholesale portion and `basketHash` for the complete reviewed composition. Invalid lines remain visible/removable and do not produce a checkout-ready total. Coordinates are validated.
- **Compatibility read:** the existing per-channel GET supports `preserveUnavailable=true`; cart/checkout use this so background context reads cannot silently delete unavailable items from the shared basket. Other legacy per-channel callers retain their reconciliation behavior.
- **Mutations:** retail quantity/removal/instructions retain their existing endpoints; Wholesale quantity/removal use only `/api/cart/wholesale/:itemId`. The server determines ownership and channel. Every successful edit reloads the server quote and refreshes the aggregate badge. Shared-variant demand across retail and Wholesale is checked together as well as protected by transactional inventory writes.
- **Grouping:** each existing composer still groups by actual seller, fulfilment channel and mode. The combined composer prefixes group identities with retail/wholesale so different financial obligations cannot merge accidentally. Compatible same-vendor items share a group; one vendor can still have multiple groups. An Order stores `salesChannel: retail` or `wholesale`, never `basket`.
- **Checkout:** `POST /api/orders/unified` with `purchaseMode: basket`, `basketHash`, and `quoteHash` recomputes the entire composition before and inside the transaction. It rejects changed prices, terms, quantities, delivery promises or stock. Wholesale sellers receive the existing stricter Wholesale eligibility fence; retail sellers retain their own fence. The browser never submits authoritative prices, totals, vendor groups or trusted seller IDs.
- **Commit:** the existing builder creates all orders and one shared Payment, deducts stock and clears only the server-read cart IDs with their version predicates, in the same transaction as CheckoutAttempt. A failed group/write aborts everything. A competing cart update either causes transaction retry/revalidation or fails its cart-clear predicate; it cannot be silently cleared. New/unpurchased documents are not blanket-cleared.
- **Benefits:** retail campaigns still use the existing campaign service. Eligible single retail checkout retains its original endpoint, coupon/Coins controls and server pricing. Grouped checkout continues to reject coupons; basket mode also rejects Coins and channel overrides. A retained retail coupon must be removed explicitly before grouped checkout. Tips are allowed only when retail deliveries exist and attach once to a retail order, never Wholesale. Wholesale-only tips are refused.
- **Payments:** no new gateway, settlement, refund or wallet implementation. COD, wallet and mocked online payment are verified for all seven combinations. Online initialization remains an existing recoverable stage after atomic order creation. If initialization is uncertain, the UI shows “Orders created · Review status” and the pending-payment message, rather than reporting payment success or resubmitting orders. Committed orders retain their payment obligation; the basket is not recreated after an order commit.
- **Recovery:** a customer-specific `basket` session key maps to the original server `unified` recovery operation. Reload restores the pending-checkout gate. Recovery does not submit an order or expose addresses/payment internals; completed recovery navigates to the existing order history. Confirmation displays the shared Payment amount and links every order group.
- **Digital:** aggregate reads show digital items with zero shipping. Digital-only checkout retains the existing digital flow. Digital/physical mixed checkout is blocked; no digital item enters the physical grouped order builder.

## Customer interface and navigation

`/cart` shows all channel/vendor groups, variant details, stock/availability, server unit/line prices, permitted quantity controls, retail seller instructions, removal and group delivery breakdowns. It uses shared `BasketGroups`, `BasketItem`, `BasketSummary`, cart cards, buttons, icon and empty state. The existing checkout owns addresses, wallet, COD, Razorpay initiation, eligible retail benefits and confirmation.

There is one bottom-navigation **Cart** item. Its badge sums quantities from all three real cart documents once, including separate retail and Wholesale lines for the same product. No fabricated counts or averaged delivery fees are introduced. On empty/invalid/loading baskets checkout is absent or disabled.

`/wholesale/cart` is a backward-compatible adapter to the same component, with Wholesale scrolled into view. Channel links move within the page. The redundant retail/Wholesale navigation tabs and the catalog's hidden cart button were removed. Wholesale Buy Now still submits the selected product, variant and quantity to the Wholesale API and then opens `/cart`. Catalog/product/order routes remain intact.

## Scenario matrix

“Pass” below identifies executed evidence; it does not imply live-provider testing. Mixed HTTP tests use actual routers/models and disposable replica-set transactions with the Razorpay SDK mocked.

| # | Scenario | Result and evidence |
| --- | --- | --- |
| 1 | Quick Commerce only | Pass — COD/wallet/online HTTP matrix; cart browser at both widths; original retail checkout regressions. |
| 2 | E-Commerce only | Pass — same payment matrix and browser; original single-retail pricing/checkout regressions. |
| 3 | Wholesale only | Pass — same payment matrix and browser; Wholesale pricing/snapshot/idempotency tests. |
| 4 | Quick + E-Commerce | Pass — three-method matrix; both-width combined cart, badge and total checks. |
| 5 | Quick + Wholesale | Pass — three-method matrix; both-width combined cart, badge and total checks. |
| 6 | E-Commerce + Wholesale | Pass — three-method matrix; both-width combined cart, badge and total checks. |
| 7 | All three, distinct vendors | Pass — three-method HTTP matrix; actual browser mixed COD creates three vendor orders and one Payment at each width. Stock, clearing, replay and settlement are asserted. |
| 8 | Same vendor, multiple products in one channel | Pass — compatible items share one group/order in the mixed grouping test. |
| 9 | Multiple vendors in one channel | Pass — separate groups/orders and summed delivery charges. |
| 10 | Same vendor across channels | Pass — one vendor retains three fulfilment/financial groups; the same product/variant in retail and Wholesale retains separate unit prices. |
| 11 | Different fulfilment groups/fees | Pass — API sums actual group charges; browser fixture shows Quick charge 15, E-Commerce 40 and Wholesale 40 rather than one averaged fee. Existing explicit Same-Day/serviceability regressions pass. |
| 12 | Wholesale quote/terms change | Pass — changed tier price or forged hash aborts the complete basket without writes; original MOQ/tier tests pass. Existing hashes have no time-based TTL; live terms are revalidated. |
| 13 | Retail/Quick stock changes | Pass — before-checkout and in-transaction stock-change tests; shared retail/Wholesale demand cannot oversell one variant. |
| 14 | Seller inactive during checkout | Pass — external seller-account deactivation races a paused real transaction; no order/payment commits. |
| 15 | Payment initialization timeout | Pass — mixed mocked-provider timeout retains `creation_unknown`; another initialization is blocked; checkout replay creates no extra orders/captures. UI shows review/pending feedback. |
| 16 | Same checkout retried | Pass — all combinations replay the key; competing identical mixed requests create one Payment and one set of orders. |
| 17 | One group invalid | Pass — invalid stock/seller/terms block the whole basket; unrelated cart lines remain stored. |
| 18 | Concurrent quantity update | Pass — real Wholesale update races mixed checkout; transaction aborts/revalidates and preserves the updated basket. Existing concurrent cart-add tests also pass. |
| 19 | Refresh/history during checkout | Pass — Chrome Back/Forward before submit; frontend reload reconstructs uncertain mixed recovery and blocks another submit; backend recovery returns the committed group without resubmitting. |
| 20 | Failure after partial preparation | Pass — injected Payment write, second Order write and cart-clear failures roll back orders, payment, stock and CheckoutAttempt; same-key retry succeeds. |
| 21 | Chrome 390/1280 | Pass — both widths, no horizontal overflow in cart or checkout; screenshots inspected. |
| 22 | Aggregate badge | Pass — summary/provider tests and browser counts for all seven combinations; triple count 13, then 18 after Wholesale quantity increases. |
| 23 | `/cart` and legacy refresh | Pass — direct navigation and reload of both routes, legacy Wholesale focus and Back/Forward. |
| 24 | Retail benefits/options/instructions | Pass — existing retail coupon, coin, tip, campaign, delivery and financial tests; original checkout regression tests; browser instructions are persisted into the mixed retail order. Grouped benefits are explicitly refused. |
| 25 | Wholesale MOQ/tier/quote | Pass — existing Wholesale pricing/HTTP tests, mixed stale-quote tests and shared quantity-control tests. |
| 26 | Digital and catalog restrictions | Pass — digital preview/physical-mix guards, product/auth/service regressions, Wholesale-only public visibility guard, and real Chrome digital/Quick/Wholesale Buy Now checks. |
| 27 | Orders/seller/cancellation/refunds | Pass — existing seller/order lifecycle, payment/return compatibility suites and mixed per-order cancellation/refund-obligation test; browser confirms all created groups. This is not a separate manual browser audit of every seller/order screen. |

## Exact commands and final evidence

From `backend`:

```powershell
node scripts/verifyIsolatedTests.mjs
# 57 suites passed; 705 tests passed; 7 existing tests skipped.
npm run build
# Passed: index syntax and backend service-package import/limits checks.
```

The runner executes every discovered `__tests__/**/*.test.js` file in its own Node/Jest process with:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath <file> --json --outputFile=<report>
```

The 7 existing skips are in the seller-payment API/HTTP suites. The new combined-basket block has 43 passing tests within the 160-test Wholesale HTTP suite. Reports and per-suite logs are in `test-artifacts/unified-basket/backend-suites/`; aggregate results are in `backend-isolated.json`.

An earlier `npm test -- --runInBand` monolithic run was interrupted after a seller-profile setup-hook timeout; that suite passed separately (45 tests), and all 57 suites subsequently passed using process isolation. The final result does not claim the monolithic command passed. The existing minimal-data recovery/privacy regression was retained and passes.

From `forntend`:

```powershell
node --test --test-concurrency=1 scripts/unified-basket-ui.test.mjs scripts/wholesale-ui.test.mjs scripts/checkout-ui.test.mjs scripts/product-wholesale.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/portal-startup.test.mjs
# 128 tests passed; no failures or skips.
npm run build
# Passed; existing Vite large-chunk warning remains.
```

From the repository root:

```powershell
node backend/scripts/verifyUnifiedBasketBrowser.mjs
# Passed: genuine headless Google Chrome, actual built frontend/HTTP backend,
# disposable MongoDB replica set, 390px and 1280px.
git -c core.safecrlf=false diff --check
# Passed. Plain git diff --check was also run; line-ending notices may appear.
```

Chrome verifies 14 channel-combination views, quantity and badge updates, seller instructions, direct/legacy reload, Back/Forward, mixed COD confirmation and relevant product details. Six disposable vendor orders are created in total, with no online charges or production changes. Cart document widths equal their viewport widths (390/390 and 1280/1280); checkout width checks also pass. There are no uncaught application errors, console errors or unexpected failed requests. Google Fonts is deliberately blocked in this offline fixture.

Evidence: `test-artifacts/unified-basket/browser.json`, `triple-390.png`, `triple-1280.png`, `legacy-390.png`, `legacy-1280.png`, `checkout-390.png`, `checkout-1280.png`, `confirmation-390.png`, `confirmation-1280.png`, `empty-390.png`, `empty-1280.png` and digital screenshots. Frontend test/build logs are in the same directory. Browser/API mocks are distinguished: cart/order HTTP routes are real; external provider behavior is mocked or not invoked.

## Files changed in this task

Pre-existing working-tree modifications were preserved. This list covers this task's edits/additions, including files that were already modified or untracked beforehand.

| File | Purpose |
| --- | --- |
| `backend/services/customerBasket.service.js` | New read/checkout composition of the existing documents, mixed review hash, Wholesale hash, invalid-line preservation and shared-variant demand check. |
| `backend/services/fulfilmentGroups.service.js` | Additive digital-preview support and live item/price-change metadata; preserve original pricing functions and default checkout restrictions. |
| `backend/services/fulfilmentOrders.service.js` | Persist each group's sales channel, attach tips only to retail, and transactionally clear exact cart snapshots in basket mode. |
| `backend/controllers/cart.controller.js` | Explicit basket read, coordinate validation, Wholesale badge counts, optional non-destructive compatibility read. |
| `backend/controllers/order.controller.js` | Explicit mixed mode, both-hash verification before/inside transaction, appropriate seller fences, exact snapshot clearing and Wholesale-only tip guard. |
| `backend/__tests__/api/wholesale.http.test.js` | Real mixed combination/payment, vendor, race, rollback, quote, recovery, digital and preservation tests. |
| `backend/scripts/verifyUnifiedBasketBrowser.mjs` | Disposable Chrome integration/evidence runner, adapted without modifying the existing browser scripts. |
| `backend/scripts/verifyIsolatedTests.mjs` | Reproducible process-isolated execution and reporting of all backend suites. |
| `forntend/src/modules/User/components/BasketGroups.jsx` | Shared channel/vendor/item/summary rendering, quantity rules, instructions, delivery options and availability. |
| `forntend/src/modules/User/components/BasketGroups.css` | Responsive shared cart/group layout. |
| `forntend/src/modules/User/components/CartUI.jsx` | Retain shared primitives, remove separate-cart mode tabs, point the helper at the common cart. |
| `forntend/src/modules/User/components/CartUI.css` | Retain shared controls/cards; remove obsolete separate Wholesale-cart styles. |
| `forntend/src/modules/User/components/BottomNav.jsx` | One Cart label and correct active state on the legacy route. |
| `forntend/src/modules/User/components/ProductWholesaleOffer.jsx` | Common View Cart label. |
| `forntend/src/modules/User/context/UserContext.jsx` | Aggregate badge refresh, session guards, non-destructive neutral reads, basket payload/idempotency namespace and recovery mapping. |
| `forntend/src/modules/User/hooks/useUnifiedCart.js` | Explicit basket read option, session changes and per-item sales-channel metadata. |
| `forntend/src/modules/User/hooks/useProductWholesale.js` | Common basket wording and count-refresh notification; original Wholesale add contract retained. |
| `forntend/src/modules/User/pages/CartPage.jsx` | One customer basket shell with channel-aware mutations, in-page links and legacy Wholesale focus. |
| `forntend/src/modules/User/pages/WholesaleCartPage.jsx` | Legacy adapter to the common CartPage. |
| `forntend/src/modules/User/pages/WholesalePage.jsx` | Remove hidden redundant cart navigation; retain catalog and shared detail behavior. |
| `forntend/src/modules/User/pages/ProductDetailPage.jsx` | Wholesale Buy Now opens common cart; selected item/variant/quantity submission unchanged. |
| `forntend/src/modules/User/pages/CheckoutPage.jsx` | Combined group review through existing checkout, benefit guards, persisted recovery gate, pending-payment feedback and authoritative shared confirmation amount. |
| `forntend/scripts/unified-basket-ui.test.mjs` | New seven-combination cart, mutation, quantity, empty/error and navigation tests. |
| `forntend/scripts/checkout-ui.test.mjs` | Mixed quote submission, recovery, benefit/digital guards, count, confirmation and pending-payment tests. |
| `forntend/scripts/wholesale-ui.test.mjs` | Replace obsolete standalone-cart expectations; retain catalog/header/auth and legacy recovery coverage. |
| `forntend/scripts/product-wholesale.test.mjs` | Update common-cart navigation/wording expectation; retain all original purchase contract checks. |
| `UNIFIED_CUSTOMER_BASKET.md` | Findings, decisions, matrix, commands, file inventory and limits. |

`LandingPage.jsx`, Cart/Order/Payment schemas, payment/settlement/refund services and route authorization middleware were inspected and needed no changes. Existing landing routes already mount the common cart and legacy adapter correctly.

## Limits and production prerequisites

- No production deployment, commit, push, production restart, production data or live payment was used. Browser runs use disposable loopback ports rather than the developer's existing data at port 4173. External gateway/freight integrations were not exercised live.
- MongoDB transaction support and the existing Cart and CheckoutAttempt unique indexes remain required. No new environment variable or migration is introduced. Existing gateway credentials, signed-webhook setup, payment reconciliation and refund-obligation operations remain operational prerequisites.
- Coupons/Coins remain unsupported for grouped checkout; digital/physical orders remain separate. No new Wholesale freight tariff or Same-Day eligibility policy was invented: the existing calculators are reused.
- Online payment initiation cannot share a MongoDB transaction with an external provider. The existing durable payment-attempt/reconciliation flow remains the boundary after atomic vendor-order creation. An initialization timeout retains recoverable orders/payment instead of recreating a basket and risking duplicate orders.
- Invalid Wholesale terms without a valid authoritative quote require removing/re-adding the affected line; cached terms are not used to enable checkout. Existing time-based quote expiration is not added; hashes are checked against live composition/terms on every submission.
- Seven legacy tests remain skipped; no skipped scenario is represented as a newly executed payment verification. The large frontend bundle warning remains. The process-isolated backend runner is the verified full-suite command.
