# Seller Paid Ads — billing, delivery and telemetry release

This phase implements the fixed-duration sponsored-category billing path, authoritative Razorpay verification, refunds, isolated accounting, paid delivery, durable telemetry and portal controls. It preserves the separate free pilot and retired legacy promotion endpoints.

**Release assessment: implemented and verified with mocked gateway transport and disposable databases; real Razorpay test order creation/fetch verified. A real Checkout payment/capture/refund and remotely delivered provider webhook have NOT been exercised. Production readiness is not established.** No business tax/refund policy has been assumed or approved by this work.

## Baseline and safety

Read `SELLER_PAID_ADS_IMPLEMENTATION_REPORT.md` and `SPONSORED_CATEGORY_PILOT_REPORT.md`, then inspected the dirty working tree, category/card/navigation/serviceability flows, v2 management and pilot, Payment, Razorpay SDK/service/controller, refund recovery, ledger, permissions and test launchers. Graph MCP tools were unavailable; targeted source inspection was used.

Existing parcel, GST, seller lifecycle, notification and other working-copy changes were preserved. Historical reports describe earlier releases and were not rewritten. No package installation, deployment, production configuration change, live service restart, production database access, production migration, live payment, live refund or notification occurred. Tests used synthetic identities and disposable MongoDB replica sets. Application bootstrap was not started. Builds generated local frontend assets only.

One explicitly test-mode-only provider probe created and fetched a synthetic INR 1 order using existing secure server configuration. No payment was captured and no refund was issued by that probe. Its initial sandbox network attempts failed; the authorized network-enabled invocation succeeded. No credential values or gateway transaction identifiers are printed in this report.

## Implemented behavior

### Seller to paid placement

1. Configuration administrator creates an active category package with dynamic price, duration, eligible module/categories, product limits and a complete structured billing policy. No commercial values are seeded.
2. Seller chooses eligible owned products/variants, confirms the current package version and its displayed base/tax/total, duration and policies, then submits. Existing immutable commercial snapshot behavior remains.
3. Review administrator approves the current revision. A separate finance permission authorizes its accepted policy and records an external invoice reference if required.
4. Seller initiates Checkout. The backend calculates integer paise from accepted terms, checks current eligibility, delivery/refund capability and unique indexes, and prepares one dedicated advertising Payment in a transaction.
5. Shared Razorpay client creates the provider order outside the transaction. Checkout receives only the public key and fixed verification path. The frontend submits neither an amount nor a seller identity.
6. Checkout HMAC verification is followed by an authoritative gateway payment fetch. Signed webhooks use the same settlement path. Only a matching captured payment funds the approved revision.
7. Service starts at the later of authoritative verification and the accepted requested start. End is start plus accepted duration. No pre-payment waiting period consumes service time.
8. Customer category serving checks paid authorization, Payment, revision, schedule, active package, current seller/account/product/variant/channel/category and serviceability. The separate pilot still requires its own non-billable authorization and gates.
9. Customer cards retain Sponsored disclosure, organic exclusions, existing product normalization/navigation, selected variant, wishlist and cart behavior. Organic ordering/counts/pagination remain independent. Advertising/telemetry failure does not block organic browsing or navigation.
10. Seller sees backend billing/service/refund status and retained impression/click counts. Admin finance has a pre-payment authorization queue, payments, refunds, journal, webhook receipts/incidents and reconciliation discrepancies.

The existing category implementations in `CategoriesPage.jsx` and `DynamicCategorySection.jsx` already share `SponsoredCategoryBlock.jsx`; no separate search or organic-ranking implementation was added. Cross-channel products whose primary purchase channel differs are blocked from paid funding. Existing service-radius behavior is reused.

### State rules

Existing independent fields are retained; there is no replacement monolithic campaign status:

| Dimension | Implemented transitions |
| --- | --- |
| Review | Existing DRAFT → PENDING_REVIEW → APPROVED / CHANGES_REQUESTED / REJECTED |
| Funding | UNPAID → PAYMENT_PENDING → FUNDED; PAYMENT_FAILED can retry the same issued order; uncertain captures → REFUND_PENDING / RECONCILIATION_REQUIRED |
| Delivery | NOT_SCHEDULED → SCHEDULED / ACTIVE → COMPLETED; cancellation, admin suspension or lost eligibility stops service |
| Refund | DISPATCHING → PENDING / UNKNOWN → PROCESSED / FAILED; campaign PARTIALLY_REFUNDED / REFUNDED only after authoritative processing |
| Checkout | INITIALIZING → ISSUED / UNKNOWN; explicit expiry is returned as `checkoutExpired`; expiry cannot create another payable campaign record |

Failed checkout may reuse its existing unexpired order. Concurrent initialization never blindly creates another provider order. Unknown creation requires an administrator to bind an authoritatively fetched matching order. Delayed capture after cancellation, expiry, suspension or eligibility loss is recorded as held money requiring review, without delivery. A payment already refunded at the provider cannot activate service while waiting for its refund webhook.

Any processed refund stops delivery, including a partial refund. No automatic resumption, paused-duration extension, renewal, package extension or replacement of paid history is implemented. Those operations remain rejected. A new service purchase requires a new campaign and approval/payment history. `SELLER_PAUSED` remains an existing reserved schema value, not an operational pause feature.

`refreshAdvertisingLifecycle` records eligibility interruptions as UNAVAILABLE/REFUND_PENDING without issuing refunds. The existing 30-second worker calls a bounded round-robin advertising sweep; request-time serving independently suppresses ineligible or expired campaigns. Completion is elapsed schedule, not proof of actual delivery; recognition additionally requires explicit finance evidence. Availability loss discovered only after it has recovered cannot be reconstructed without additional availability history. Large installations need worker-capacity/load validation.

## Payment verification, durability and recovery

`Payment.advertising` is the dedicated purpose. The Payment ID equals the campaign ID, enforcing one financial record per campaign using MongoDB's built-in `_id` uniqueness. It stores accepted revision/seller, stable internal reference, integer expected/base/tax amounts, currency, gateway mode/order/captures, creation/checkout/reconciliation states, financial counters and authorized refund attempts. No card data or CVV is stored.

Two partial unique Payment indexes additionally prevent advertising gateway-order and capture reuse. Checkout fails closed if either is absent. Index creation was tested only in disposable databases; production provisioning remains a release prerequisite.

Payment/campaign/accounting changes use the existing `financialTransaction` replica-set transaction helper. External order/refund calls occur outside transactions. Unknown provider results remain durable and block blind retries. Full provider results are never logged. Capture retries converge on stored capture IDs; signed webhook delivery IDs use durable `AdWebhookReceipt` uniqueness. Receipt insertion and payment settlement share a transaction. Failed verification/reconciliation and signed orphan advertising events create immutable incident receipts. Incidents remain historical even if a later recovery succeeds.

The common webhook controller verifies raw-body signatures first, then dispatches by stored advertising purpose or signed advertising order notes. Unrelated purposes retain their existing handlers. Refund receipts are deduplicated independently, and authoritative refund fetching makes replay safe even if a process stops before recording the webhook receipt. Unknown or mismatched refunds hold service and stay unresolved rather than importing an unauthorized financial decision.

Administrator reconciliation fetches provider order/payment/refund data, recovers uncertain order association, settles missing captures idempotently, checks refund totals where supplied, and compares cash/tax/liability/revenue journal balances. Provider history at the bounded pagination limit remains blocked for manual review. Successful recovery is audited. Orphaned internal records, incident webhooks, extra captures, uncertain creation/refunds and ledger discrepancies are visible. Unknown provider payments without an internal association or webhook require provider-statement investigation; no exhaustive account-wide bank reconciliation/import is claimed.

## Financial policy and accounting boundaries

Structured policy requires every supported field explicitly: approval reference, issuer, NONE/INCLUSIVE/EXCLUSIVE tax treatment and basis-point rate, tax timing, invoice/credit-note modes, start condition, interruption behavior, all four refund ceilings and recognition rule. Missing or unsupported policy blocks authorization/funding. Package changes never rewrite accepted snapshots. Old approved campaigns without an accepted structured policy cannot be retrospectively repriced or silently opted in; create and approve a new campaign.

The implemented policy vocabulary supports tax liability ON_RECEIPT, start VERIFIED_PAYMENT_OR_REQUESTED_START, interruption STOP_AND_REVIEW and recognition MANUAL_AFTER_COMPLETION. Refund percentages are configured maximum limits requiring an authorized decision and reason, not automatic entitlements. Business/legal approval of these choices must precede operational configuration. Different required rules need an additional implementation; free-text drafts alone do not enable them.

Invoice and credit-note modes are NOT_REQUIRED or EXTERNAL_REFERENCE. Required references block authorization/refund until supplied and are displayed to the seller. This does **not** generate statutory invoice PDFs, invoice numbering, place-of-supply allocation, CGST/SGST/IGST split, electronic invoicing or tax filing. Existing merchandise/service GST workflows were not repurposed for a different issuer or purpose. If those capabilities are required by approved policy, billing remains blocked until a suitable issuer integration is provided; do not select NOT_REQUIRED to bypass a legal requirement.

Advertising uses isolated `SellerLedgerEntry` accounts: advertising_cash, advertising_liability, advertising_tax and advertising_revenue. References use `advertiserSellerId`, never seller-payable `sellerId`, order, payout, delivery or escrow references. Model validation rejects mixed purposes; generic recovery and settlement reject advertising records. General seller/merchandise finance screens exclude advertising entries, which require dedicated advertising permissions.

Captured gross is recorded as cash collection, base as service liability and configured tax as liability. Capture never recognizes advertising revenue. Manual recognition transfers base liability to revenue only after completed, funded, reconciled service and finance review evidence. Processed refunds reverse cash, proportionate configured tax and remaining liability; refunds after recognition reverse recognized revenue as necessary. Immutable postings use unique idempotency keys. Extra captures are separate held obligations, never another service period.

Gateway fee/tax fields, when provided by authoritative reconciliation data, are observations. No estimated fee, fee-expense recognition, bank deposit or net settlement is invented. Provider-statement reconciliation and an approved fee-expense/bank-posting policy remain necessary for full general-ledger/bank closure.

Refund request, reconcile and finance permissions are separate. Refund calls use stable receipts, durable attempts and verified provider results. UNKNOWN/PENDING attempts prevent a new refund dispatch; reconciliation finds an uncertain result by authorized receipt. Full/partial refunds enforce accepted reason-specific ceilings, captured amounts and required credit-note reference. Failed refunds remain obligations and do not post returned money. The independent refund gate preserves authorized refund access when new management/billing/delivery are shut down.

## Telemetry and customer privacy

An impression is submitted only after an actual card is at least 50% visible continuously for 1 second in a visible document. Leaving view/hiding the document clears its timer. Cleanup disconnects observers. Browsers lacking IntersectionObserver do not fabricate impressions. Merely returning an API result creates no event.

A random serving token is HMAC signed and bound to campaign revision, selected product/variant, CATEGORY_SPONSORED placement, paid/pilot mode and expiry (at most 120 seconds or service end). Server validation checks signature, strict event type, expiry, membership and current eligibility. Events are append-only `AdEvent` records. `_id = SHA256(serving nonce + event type)` provides durable, concurrent retry deduplication independently for IMPRESSION and CLICK. Tokens are never stored in event records or logs.

Clicks are sent when product navigation is activated. The existing selected-product action runs immediately; telemetry uses bounded, best-effort keepalive requests without authentication/customer credentials. Cart and wishlist behavior is unchanged. Telemetry never invokes payment, refund, funding or ledger mutation.

Stored events contain campaign/revision/product, placement/mode/type, timestamps and expiry; no customer, seller, payment, email, phone, raw IP or token fields. Explicit retention configuration creates TTL expiry. Reports exclude expired events even before MongoDB's asynchronous TTL deletion runs. Reporting is retention-bounded; the default report range is the last 30 days, not an attribution window. Impressions/clicks are separated by pilot/paid mode; there are no conversions, attributed sales or ROAS.

Controls include bounded placement candidates/results, short signed tokens, allowed payload fields, token/body size bounds and rate limiting. Current rate limiting is process-local and not a distributed bot defense. Repeated views after a fresh serving token can count again; these are served-view counts, not unique people or guaranteed human traffic. A script that obtains legitimate serving tokens may report events; signed linkage is not proof of human viewability. No event is billable. Production-scale abuse defense, distributed rate limits and operational metrics infrastructure require separate validation.

## Portals and permissions

Seller uses existing portal credentials, live approval/ownership checks and shared Razorpay Checkout. UI shows approved terms, tax/total, pending verification, payment/refund/reconciliation state, paid service dates, invoice/credit-note references and bounded counts. It never sets funding based on browser success.

Admin permissions: `advertising_configure`, `advertising_review`, `advertising_finance`, `advertising_reconcile`, `advertising_refund`; existing explicit superAdmin bypass remains. Configuration/review do not authorize financial actions. Backend checks every endpoint. Finance-only actors can find unpaid approved campaigns through the authorization queue and open the financial workspace. Financial evidence/reconciliation and separately gated refunds remain accessible after management shutdown. Suspended sellers require administrator handling; their blocked portal identity does not bypass the existing seller gate.

New operational routes (existing management, approval and pilot endpoints remain):

| Scope | Route | Purpose |
| --- | --- | --- |
| Seller | POST `/api/sellers/advertising/campaigns/:id/payment-attempts` | Owned current-revision backend order creation/reuse |
| Seller | POST `/api/sellers/advertising/payment-verification` | Dedicated shared Checkout verification; campaign-specific verification also supported |
| Seller/Admin | GET `.../campaigns/:id/billing`, `.../analytics` | Owned/authorized billing and event evidence |
| Seller/Admin | POST `.../campaigns/:id/cancel` | Versioned cancellation and financial review |
| Admin | POST `/api/admin/advertising/campaigns/:id/billing-authorize` | Finance authorization and required invoice reference |
| Admin | POST `.../reconcile`, `.../refund-reconcile` | Authoritative recovery under reconciliation permission |
| Admin | POST `.../refund`, `.../recognize` | Separate refund/finance permissions |
| Admin | GET `/api/admin/advertising/finance`, `/reconciliation` | Paginated payment/authorization/webhook/discrepancy evidence |
| Public | POST `/api/advertising/events` | Signed, bounded non-billable event ingestion |

Category serving remains GET `/api/advertising/placements`. The common signed provider webhook remains `/api/payments/razorpay/webhook`. No historical 410 endpoint was reopened.

## Exact files for this phase

Paths below identify this phase, not every pre-existing dirty file.

New files:

```text
backend/models/advertisingBilling.schema.js
backend/models/AdEvent.js
backend/models/AdWebhookReceipt.js
backend/services/advertisingBillingPolicy.service.js
backend/services/advertisingBilling.service.js
backend/services/advertisingPaidEligibility.service.js
backend/services/advertisingTelemetry.service.js
backend/verification/advertising-billing.test.js
backend/verification/advertising-razorpay-probe.mjs
forntend/src/components/advertising/AdvertisingBillingPanel.jsx
forntend/src/components/advertising/AdvertisingBillingPolicyEditor.jsx
forntend/src/components/advertising/AdvertisingFinancePanel.jsx
forntend/src/components/advertising/AdvertisingMetrics.jsx
forntend/src/components/advertising/advertisingTelemetry.js
forntend/verification/advertising-billing-ui.test.mjs
forntend/verification/advertising-billing-browser-entry.jsx
SELLER_PAID_ADS_BILLING_REPORT.md
```

Existing working-tree files changed further:

```text
backend/config/advertising.env.example
backend/models/advertising.schema.js
backend/models/Payment.js
backend/models/SellerLedgerEntry.js
backend/services/advertising.service.js
backend/services/advertisingPolicy.service.js
backend/services/advertisingServing.service.js
backend/services/sellerLedger.service.js
backend/services/paymentRecovery.service.js
backend/services/razorpay.service.js
backend/services/orderSweeper.service.js
backend/controllers/payment.controller.js
backend/controllers/adminSellerFinance.controller.js
backend/controllers/financeWorkflow.controller.js
backend/routes/advertising.routes.js
backend/routes/advertisingPublic.routes.js
forntend/src/components/advertising/AdvertisingWorkspace.jsx
forntend/src/components/advertising/SponsoredCategoryBlock.jsx
forntend/src/components/advertising/useAdvertisingNavigation.js
forntend/src/utils/razorpayCheckout.js
forntend/verification/sponsored-category-browser.mjs
forntend/tests/service-hookHarness.mjs
backend/__tests__/api/checkout-workflow.http.test.js
```

The last two are existing ignored test/harness paths under the repository's current ignore rules; their edits are present locally even though ordinary `git status` does not list them. Include those intended changes explicitly in any later review/commit. No original test assertions were removed or weakened. Existing LandingPage source was not changed by this phase.

## Verification

Tests never inherit application database or provider credentials: backend commands use the existing sanitized launcher. New billing tests mock gateway transport only, exercise real Checkout/webhook HMACs, real Express routes, models, transactions, indexes, ledger and durable events against disposable MongoDB 7.0.14 replica sets. Synthetic tax/refund amounts in fixtures are test inputs, not business defaults.

Final relevant test results:

| Verification | Result |
| --- | --- |
| Backend verification suites: advertising billing, management/pilot, GST, parcel routing, financial workflow, payment notifications | **182 passed, 6 suites** |
| Existing backend merchandise regression suites listed below | **117 passed, 11 suites** |
| Product-link plus advertising management/pilot/billing UI tests | **32 passed** |
| Existing auth/startup/seller-notification/checkout/payment-overlay frontend regressions | **121 passed** |
| Latest focused billing backend rerun | **32 passed** |
| Latest focused billing frontend rerun | **8 passed** (included in the 32 above) |
| Real-component browser fixtures | Passed all four widths, 4 keyboard/cart checks, 3 organic-fallback scenarios, 4 paid viewability/click scenarios, offscreen suppression, telemetry-failure navigation, 4 billing/policy layouts |
| Backend `npm run build` | Passed |
| Frontend `npm run build` | Passed; existing large-bundle warning, main JS approximately 1.89 MB minified |
| `git diff --check` | Passed; Windows line-ending warnings only |
| Real Razorpay test-only transport probe | Passed order creation and authoritative fetch; no capture/refund |

Counts describe the listed commands, not separate additive totals for repeated runs. Final focused tests follow the last billing changes. Full repository suites were not run. Existing frontend notification timeout warnings appeared despite passing fixtures.

From `backend`:

```text
node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising-billing.test.js verification/advertising.test.js verification/gst-assistance.test.js verification/parcel-routing.test.js verification/financial-workflow.test.js verification/payment-notifications.test.js --silent --noStackTrace

node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/seller-order-lifecycle.http.test.js __tests__/services/order-fulfillment-lifecycle.test.js __tests__/api/seller-marketing-retirement.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/services/razorpay.service.test.js __tests__/services/account-lifecycle.test.js __tests__/services/financial-integrity.test.js __tests__/services/inventory.service.test.js __tests__/api/cart.api.test.js --silent --noStackTrace

node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising-billing.test.js --silent --noStackTrace
npm run build
node verification/advertising-razorpay-probe.mjs --create-test-order
```

From `forntend`:

```text
node --test --test-concurrency=1 tests/product-link.test.mjs verification/advertising-billing-ui.test.mjs verification/advertising-ui.test.mjs verification/sponsored-category-ui.test.mjs

node --test --test-concurrency=1 tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/seller-notifications.test.mjs tests/checkout-ui.test.mjs verification/razorpay-overlay.test.mjs verification/payment-ui.test.mjs

node --test --test-concurrency=1 verification/advertising-billing-ui.test.mjs
node verification/sponsored-category-browser.mjs
npm run build
```

From the repository root: `git diff --check`. The browser fixture blocks non-local network calls and uses synthetic SDK/API responses. The separate Razorpay probe is the only successful external gateway operation performed.

The `product-link.test.mjs` document failure was a missing browser-effect fixture: the hook harness executes effects unlike SSR. It now supplies a minimal absent-meta document when none exists and restores it on close. All existing product-link assertions pass. Three checkout notification failures were another stale fixture: the actual durable publisher required an approved seller lookup and notification index/dedupe persistence. Adding those synthetic boundaries made all 13 existing assertions pass without changing checkout or notification production code. The initial webhook regression caused by eagerly importing advertising for every payment purpose was fixed by dispatching before import; the unchanged merchandise webhook suite passes.

## Local configuration and exercising the feature

No `.env` was edited. `backend/config/advertising.env.example` documents all gates. Use an isolated local/staging replica set and the approved local configuration mechanism:

```text
ADVERTISING_MANAGEMENT_ENABLED=true
ADVERTISING_BILLING_ENABLED=true
ADVERTISING_PAID_DELIVERY_ENABLED=true
ADVERTISING_REFUNDS_ENABLED=true
ADVERTISING_PRODUCTION_ENABLED=false
ADVERTISING_CATEGORY_PILOT_ENABLED=false   # optional independent local free pilot
PAYMENT_GATEWAY=razorpay
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=<existing secure test public key>
RAZORPAY_KEY_SECRET=<existing secure server test secret>
RAZORPAY_WEBHOOK_SECRET=<matching secure server webhook secret>
ADVERTISING_CHECKOUT_TTL_SECONDS=<explicit approved operational integer 60..86400>
ADVERTISING_TELEMETRY_ENABLED=true
ADVERTISING_EVENT_RETENTION_DAYS=<explicit approved retention integer 1..365>
ADVERTISING_TOKEN_SECRET=<dedicated random server secret at least 32 characters>
```

These placeholders are deliberate: no commercial price, tax rate, refund entitlement, issuer, duration or retention decision is invented. Configure an active package through Admin with all structured billing fields and confirmed policy approval reference, then submit/approve/financially authorize a **new** campaign. Existing approved records lacking that accepted policy snapshot remain blocked.

Before checkout, provision/verify Payment indexes `advertising_gateway_order_unique` and `advertising_capture_unique` through the controlled release procedure. Telemetry requires its built-in event uniqueness, TTL and reporting indexes; webhook receipts require `_id` uniqueness; journal idempotency uses the existing ledger index. No production index procedure was executed. Mongo standalone topology intentionally fails financial operations. Existing bootstrap has seed/index-repair writes; do not start it against production to test this feature.

For remotely delivered webhooks, configure an approved reachable local/staging callback with the matching test webhook secret and captured/order/failed/refund events. This task did not change Razorpay Dashboard configuration or expose a tunnel. Backend raw-body capture must remain intact.

Optional transport check from `backend`: `node verification/advertising-razorpay-probe.mjs --create-test-order`. It explicitly rejects live credentials, loads only required Razorpay fields, creates one synthetic INR 1 test order and fetches it, prints sanitized booleans/status only, and never connects to a database or captures/refunds. It requires network access.

Production aliases reject test mode and the free pilot. Production billing/refunds additionally require explicit production and operation gates with matching live credentials. No live activation is authorized by this report. Keep financial schema/evidence and authorized recovery available during rollback; do not delete paid records or remove schema support.

## Remaining acceptance work and decisions

- Real Checkout capture, authoritative verification of that real test capture, actual provider webhook delivery and real test refund remain unexercised. The full application flow is verified with gateway mocks, not declared externally operational.
- Business approval must provide applicable issuer/tax treatment and rate, tax liability timing, invoice/credit-note obligations, refund ceilings for each reason, interruption handling and recognition evidence standard. Existing saved draft text is not approval. Only the implemented rule vocabulary is currently supported.
- Statutory invoice generation/allocation, provider fee expense/bank settlement posting and unknown externally initiated refund resolution are not implemented. Such discrepancies stay held and require an approved recovery design; no manual “mark successful” override exists.
- Provision indexes/topology in isolated staging and run the complete real-provider acceptance flow. No complete repository-wide suite, production load test, distributed worker/abuse test, physical-device audit, native-app SDK test or full authenticated application browser E2E was performed. Browser checks use real components with synthetic context/API/SDK fixtures.
- CPC/CPM, search/banner ads, conversion attribution, ROAS, automatic pause/resume/extension/renewal, automatic refunds and revenue recognition remain excluded. Fixed-duration paid category placement is the implemented commercial mode.

## IMPLEMENTATION READINESS

| Area | Classification | Evidence / remaining condition |
| --- | --- | --- |
| Dynamic packages, accepted snapshots, ownership, moderation, legacy retirement | Confirmed and reusable | Existing v2 models/management, existing regression tests |
| Dedicated order/verification/webhook/payment recovery | Confirmed and reusable in isolated automated tests | `advertisingBilling.service.js`, Payment, durable receipts; actual test capture/webhook acceptance still required |
| Paid category eligibility and free-pilot isolation | Confirmed and reusable | `advertisingPaidEligibility.service.js`, serving, lifecycle and regression tests |
| Signed durable impression/click telemetry | Confirmed and reusable | `AdEvent`, telemetry service, observer, concurrency and real-component browser tests; distributed abuse/load checks pending |
| Refunds and isolated advertising journal | Confirmed and reusable in isolated automated tests | Configured-policy refunds, verified reversal/idempotency; external test refund still required |
| Financial reconciliation | Partially reusable | Provider-order/payment/refund recovery and journal checks implemented; external account/bank closure and unapproved-refund import deliberately absent |
| Tax/legal policy and invoice production | Blocked pending clarification where required | Explicit configuration/authorization and external references supported; actual policy approval and suitable issuer capability required |
| Fee expense / bank settlement accounting | Missing and requiring design | Authoritative fee observations only; no guessed postings |
| Seller/Admin/customer responsive web UI | Confirmed for component scope | Automated components and responsive fixtures; full authenticated real-provider browser flow remains unverified |
| Complete externally operational / production release | Blocked pending acceptance and configuration | Real capture/webhook/refund acceptance, approved policies, indexes/topology and deployment decision |
