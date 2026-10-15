# Checkout and seller-first fulfilment

Implemented and locally verified on 2026-10-15. No deployment or production data changes were performed.

## Root cause and audit findings

`backend/services/fulfilmentGroups.service.js` marked e-commerce lines with no saved delivery mode as `modeChosen:false`. `createUnifiedOrder` in `backend/controllers/order.controller.js` then rejected the basket with `Choose a delivery option for ...`. The customer screen neither rendered those delivery controls nor used its computed `deliveryChosen` value to disable submission.

That older customer-choice rule conflicted with the existing seller workflow. The seller portal and protected APIs already supported acceptance, preparation and later selection of manual Bulkimart delivery or Shiprocket. Ordinary e-commerce also inherited a premature carrier default, whereas Same-Day and Quick Commerce require different treatment.

The audit traced cart grouping/pricing, single and unified checkout, Order/Cart models, wallet/online/COD payment state, seller ownership and transitions, rejection/cancellation stock and refund handling, rider dispatch/manual assignment, Shiprocket serviceability/creation/AWB/label/pickup, and Quick Commerce finance activation gates.

Two additional correctness issues were reproduced during verification: grouping derived the carrier from cart-line `type` rather than its authoritative channel, and real variant checkout failed because the installed Mongoose version requires `updatePipeline:true` for the inventory projection update. Both are fixed.

## Implemented workflow

1. Customers place regular physical e-commerce orders with the existing delivery fee included in the displayed total. No final carrier selection is required. Orders remain `placed`, vendor decision `pending`, with no `deliveryType` or selected fulfilment method. An optional `fulfillment.assignmentPolicy:seller_after_acceptance` marks the new workflow.
2. The seller accepts or rejects its own order. Rejection still requires a reason and uses the existing stock restoration/refund operation. COD acceptance does not require prepaid funds; wallet/online acceptance requires the existing verified payment state. Online payment itself does not accept an order for the seller.
3. Accepted orders progress `confirmed -> preparing`. The seller then chooses fulfilment. New regular orders cannot jump to dispatch without that selection.
4. Manual selection sets `deliveryType:internal`. On `dispatched` (ready for pickup), the existing rider broadcast and admin assignment paths become available. Rider claimability remains limited to ready orders; checkout and acceptance do not assign riders early.
5. Eligible e-commerce courier orders can use the existing Shiprocket operation after acceptance/preparation. It requires provider configuration, registered pickup location, item weights, valid package dimensions, route serviceability and explicit seller confirmation. Confirmed AWB creation does not automatically mark the parcel dispatched; seller handoff remains a separate action.

Existing endpoints are reused:

| API | Purpose |
| --- | --- |
| `POST /api/orders`, `POST /api/orders/unified` | Single/grouped checkout, without an ordinary customer carrier choice |
| `PATCH /api/sellers/orders/:id/status` | Existing accept, reject, prepare and dispatch transitions |
| `GET /api/sellers/orders/:id/fulfillment-options` | Evaluate available delivery methods and courier estimate |
| `POST /api/sellers/orders/:id/fulfillment/manual` | Select Bulkimart delivery |
| `POST /api/sellers/orders/:id/fulfillment/shiprocket` | Confirm package/quote and create shipment; now includes numeric `quotedCourierCharge` |
| `GET /api/admin/delivery-assignments`, `POST /api/admin/delivery-assignments/:id` | Existing ready-order assignment queue and authorized assignment |

**Quick Commerce remains separate.** It keeps its internal-rider route, distance-based customer fee, seller acceptance/preparation and ready-for-pickup requirements. Customer-selected e-commerce modes are rejected on Quick orders. Quick third-party shipment creation remains disabled under the existing policy/activation gates; no fee-policy approvals or live reconciliation requirements were bypassed.

**Explicit Same-Day remains a promise.** Its eligibility and premium are still rechecked against the actual address at placement. An unavailable request is rejected rather than silently downgraded, and a Same-Day order cannot be switched to standard Shiprocket shipping.

Address/profile completeness, approved/live seller ownership, product/channel visibility, stock, service radius, wallet funds, payment verification and idempotency checks remain authoritative on the backend. Multi-store baskets use grouped checkout so each seller receives its own order and one payment covers the quoted basket. Mixed digital/physical checkout and existing coupon restrictions are retained. Historical orders are not rewritten.

## Charges and provider failures

The existing customer pricing policy remains unchanged: an ordinary order uses the configured delivery charge; Quick/Same-Day retain their existing calculations. The customer sees that fee before checkout. Selecting Shiprocket later never adds another customer charge, edits the frozen order/payment amount, or debits the customer wallet again.

The selected provider estimate is recorded under `fulfillment.quote`: provider, courier charge, currency, quote time, existing customer delivery charge, zero additional customer charge, zero new service fee, and `billingPolicy:checkout_charge_unchanged`. It is an estimate, not a settled carrier invoice. The repository has no approved general e-commerce vendor freight-deduction rule; none was invented. Quick Commerce's draft fee-allocation calculations remain tested but are not activated for live shipping.

The seller reviews the estimate before confirmation. Creation rechecks serviceability and refuses an increased quote beyond the confirmed limit. Invalid courier choices are rejected. Provider payloads carry the already-priced delivery charge once and derive discounts from the locked payable total, avoiding double subtraction of a coupon stored both within aggregate discount and as a component. Existing tips remain part of the payable amount. These calculations are locally tested; the live provider invoice/COD collection outcome still requires staging reconciliation. Request fields were checked against [Shiprocket's official API documentation](https://apidocs.shiprocket.in/?version=latest).

An atomic per-order operation lock covers shipment creation and AWB assignment. A losing request cannot clear the winner's lock. Operation IDs scope progress/error writes to their owner. Manual selection, seller status updates and cancellation predicates cannot overwrite active or uncertain shipment setup. Existing provider references are reused; partial historical references require reconciliation.

If creation/AWB times out or returns an uncertain result, the order remains unshipped in `preparing` with `reconciliation_required`; automatic retries, manual reassignment and cancellation are blocked until an operator establishes the real provider outcome. This intentionally favors avoiding duplicate paid shipments. A process crash can likewise leave a locked operation requiring reconciliation. There is no automated provider-recovery service or new reconciliation UI.

Confirmed AWBs are saved before optional label/pickup calls. Label failures or unconfirmed pickup produce a follow-up message, retain the AWB and do not cause another shipment creation. Pickup is recorded as scheduled only when the provider confirms success. Provider-create calls have a bounded timeout; raw provider error bodies are no longer logged by that operation.

## Files changed

| Path | Purpose |
| --- | --- |
| `backend/constants/enums.js` | Regular carrier remains unassigned; retain Same-Day internal requirement |
| `backend/controllers/order.controller.js` | Remove premature unified choice requirement; align single/grouped snapshots, seller/channel/radius checks and cancellation race guards |
| `backend/controllers/user.controller.js` | Normalize saved-address identity, reuse an existing destination and hide historical duplicate cards without deleting data |
| `backend/controllers/fulfillment.controller.js` | Post-acceptance selection, quote confirmation/snapshot, operation locks, failure safety, Quick/Same-Day restrictions |
| `backend/controllers/seller.controller.js` | Require delivery setup for new regular orders, protect status writes from races and expose shipment state |
| `backend/models/Cart.js` | Document optional regular delivery mode semantics |
| `backend/models/Order.js` | Optional assignment policy, provider operation identity and quote accounting fields |
| `backend/services/fulfilmentGroups.service.js` | Ordinary mode default, authoritative channel-based grouping, seller/radius checks and removal of mandatory customer choice |
| `backend/services/fulfilmentOrders.service.js` | Persist seller-first policy on new grouped regular orders |
| `backend/services/pricing.service.js` | Reuse central carrier rule without changing customer prices |
| `backend/services/inventory.service.js` | Required Mongoose pipeline option for real variant stock projection updates |
| `backend/services/shiprocket.service.js` | Bounded create-request timeout and safe error logging |
| `forntend/src/modules/User/pages/CheckoutPage.jsx` | Explain later delivery assignment; enable valid checkout after server basket validation; show retry errors |
| `forntend/src/modules/User/context/UserContext.jsx` | Select the address returned by add/reuse and preserve checkout idempotency across retries |
| `forntend/src/modules/User/pages/CartPage.jsx` | Label regular delivery without demanding a customer carrier choice |
| `forntend/src/modules/User/hooks/useUnifiedCart.js` | Cancel obsolete quote requests and guard stale results during address/account changes |
| `forntend/src/modules/Seller/components/OrdersTab.jsx` | Explain quote/customer-price boundary and confirm the courier estimate |
| `forntend/src/modules/Seller/context/SellerContext.jsx` | Send the confirmed quote limit with shipment creation |
| `backend/__tests__/api/seller-first-checkout.http.test.js` | 25 new isolated replica-set API regressions |
| `backend/__tests__/api/checkout-workflow.http.test.js` | Existing suite: supply an approved seller fixture to match live validation; retain assertions |
| `forntend/scripts/checkout-ui.test.mjs` | Eight new actual-component/hook regressions |
| `forntend/scripts/service-hookHarness.mjs` | Support `useMemo` in the existing hook harness |
| `forntend/package.json` | Add `npm run test:checkout` |
| `.gitignore`, `backend/.gitignore` | Retain the new regression suite and the previously ignored existing checkout fixture |
| `CHECKOUT_FULFILMENT.md` | This implementation and verification report |

## Actual verification

The new API suite uses genuine JWT/auth/approved-seller middleware, real models, an isolated MongoDB replica set and real checkout transactions, stock and wallet/refund operations. Provider calls, notifications and rider broadcasts use bounded mocks. Online-paid state is simulated for fulfilment tests; no live Razorpay payment is claimed. The frontend tests execute actual components/providers/hooks with Vite SSR and the existing controlled harness; they are not DOM/browser E2E tests.

| Command/scope | Actual result |
| --- | --- |
| Initial focused baseline: lifecycle + Quick Commerce finance | 2 suites, 15 passed, 0 failed |
| Backend `npm test -- --runInBand __tests__/api/seller-first-checkout.http.test.js __tests__/api/checkout-workflow.http.test.js __tests__/services/order-fulfillment-lifecycle.test.js __tests__/services/quick-commerce-finance.test.js --silent` | 4 suites, 52 passed, 0 failed |
| Backend `npm test -- --runInBand` | 49 suites passed; 384 passed, 7 skipped, 0 failed; 391 total |
| Frontend `npm run test:checkout` | 9 passed, 0 failed |
| Frontend `npm run test:auth` | 23 passed, 0 failed |
| Frontend `npm run test:services` | 16 passed, 0 failed |
| Frontend `npm run test:image-search` | 12 passed, 0 failed |
| Backend `npm run build` | Passed; existing `node --check index.js` script |
| Frontend `npm run build` | Passed; existing warning for chunks above 500 kB |
| `git diff --check` | Passed |

Coverage includes both checkout paths, three payment modes, repeated/multi-store submissions, stock and wallet rollback, acceptance/rejection, delivery selection/dispatch gates, ownership, seller service radius, invalid modes and unavailable Same-Day, Quick restrictions, quotes and price increases, discounts/tips, concurrent provider requests, uncertain outcomes, partial IDs and label/pickup failures. Frontend coverage includes no-choice submission, payment independence, loading/retry, stale address quotes and seller quote confirmation.

### Repeated checkout and duplicate-address correction

A rapid second tap could enter `handlePlaceOrder` before React rendered the `isOrdering` state change. Both requests correctly shared an idempotency key, but the losing backend request immediately returned the combined “processing or different details” conflict while the winning request was still committing. Checkout now acquires a synchronous component-level single-flight guard. The backend briefly resolves a concurrent claim and replays the one committed order, while retaining the request-hash check that rejects genuine key reuse with changed details. Stock, payment and order writes still happen once.

Address creation previously appended every request. It now compares normalized address line, area, city, state and pincode, returns/selects the existing address for the same destination, and does not save another embedded record. Address listing also collapses historical duplicates for display while retaining the underlying data; no production cleanup or deletion was performed. Regression coverage includes case/whitespace variants, legacy duplicate display, rapid double taps and concurrent HTTP submissions.

The first expanded full run exposed ten failures in the existing mock checkout suite because its Seller lookup always returned no seller. The fixture now returns an approved seller; the original assertions remain, all 12 tests in that suite pass, and the final full run above is green. The separate real-database tests exposed the inventory pipeline issue before it was fixed. No unresolved failing tests remain. Seven existing skipped backend tests were not executed. Parallel frontend suites emitted harmless Vite HMR-port warnings; all test assertions passed. Neither package has a lint script.

## Rollout and remaining verification

The worktree was clean at the start. Existing Delivery-login, service-management and image-search work was preserved. No reset, cleanup, reformat of unrelated files, production write, credentials change, destructive migration, commit or deployment was performed. The existing checkout test file was already present but ignored; its only fixture change is documented above, and it is now explicitly retained.

Release the matching backend/frontend together: new regular orders use an optional policy marker and shipment creation expects the confirmed quote limit. No new dependency, environment setting or existing-data migration is required. Existing checkout transaction prerequisites remain. Shiprocket still needs its existing credentials, webhook authentication, seller pickup configuration, valid variant weights and package dimensions. Do not enable Quick third-party shipping to bypass its outstanding policy approvals.

No browser automation or code-review-graph tools were available in this session. Staging must verify separate customer/seller/rider accounts, actual payment verification, rider availability/assignment notifications, Shiprocket request totals/COD remittance, real quoted-versus-invoiced freight, AWB creation, label/pickup behavior and signed tracking events. Reconciliation of uncertain remote outcomes needs an authorized operational procedure before rollout. Live Shiprocket behavior, production storage/permissions, backup recovery and production readiness are not established by these local tests.
