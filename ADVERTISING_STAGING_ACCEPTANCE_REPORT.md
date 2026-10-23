# Advertising staging acceptance and release readiness

Run evidence recorded 2026-10-22 20:33 UTC (2026-10-23 local time). Base HEAD: `72ffe10`, with the existing uncommitted implementation and unrelated work preserved. This report supersedes no historical test results; it records this acceptance phase only.

**Production readiness: BLOCKED. A real Razorpay test order was created and fetched. No real Checkout test capture, remotely delivered provider webhook or provider test refund occurred.**

## Environment and scope

Read `SELLER_PAID_ADS_BILLING_REPORT.md`, working-tree status, repository instructions, package/test scripts, advertising models/routes/services, raw-body webhook dispatch, gateway client, ledger and financial policy handling. The requested graph tools are unavailable; targeted source inspection was used.

Sanitized configuration inspection confirmed development environment, Razorpay Test mode, a test-prefixed key and server/webhook secrets present. Advertising operation flags are unset in the developer configuration. No explicit advertising staging origin, staging database reference or policy approval reference was found in the inspected environment files. Dedicated backend/frontend `.env.staging` and `.env.test` files are absent. The frontend has an API base configured, but it was not treated as an approved staging target or contacted. The absence of an environment approval reference does not establish what records might exist in an uninspected database; no such database was opened.

No developer/production database URI was used. All database verification and browser API writes used newly created, loopback-only disposable MongoDB instances. The browser backend starts only the actual advertising routers, not application bootstrap, seeds, notifications or background production workers. Generated synthetic sessions are checked by the real authentication/authorization/approved-seller middleware. Customer context/navigation is a synthetic adapter around the actual Sponsored component. Actual login/OTP and full portal shells remain outside this browser fixture's scope.

Existing secure test gateway configuration was used only by the existing test-only order transport probe. It created/fetched one synthetic INR 1 order, with no Payment/campaign database mutation, capture or refund. No secrets, full provider responses or gateway identifiers were printed or retained in this report.

## Database evidence

`backend/verification/advertising-database-acceptance.test.js` passed **7/7 tests** against MongoDB 7.0.14. This is actual database behavior, not mocked schema inspection:

| Check | Observed result |
| --- | --- |
| Replica-set `hello` | Writable primary, replica-set name and logical session support asserted |
| Financial transaction commit | Probe record committed |
| Intentional transaction failure | Probe record rolled back; no nontransactional fallback |
| Standalone topology | Financial operation rejected with actionable 503; no probe write committed |
| Advertising Payment index definitions | Actual keys, uniqueness and both exact partial-filter definitions asserted |
| Advertising Payment uniqueness | Duplicate gateway order/capture rejected with 11000; merchandise records unaffected by partial indexes |
| AdEvent indexes | Actual `_id`, reporting compound index and expiresAt TTL with expireAfterSeconds 0 asserted |
| Actual TTL deletion | Expired event deleted by MongoDB's TTL monitor; reports already exclude it before deletion |
| Webhook receipt deduplication | Actual `_id` index and concurrent duplicate rejection asserted |
| Ledger idempotency | Actual unique idempotencyKey and entryNo indexes; concurrent duplicate rejection asserted |

The test's accelerated TTL monitor runs only in its disposable instance. No target-hosted staging or production index was created, repaired, synchronized or removed. Target staging index/topology acceptance remains untested until an explicitly identified isolated staging target is provided. See `ADVERTISING_STAGING_ACCEPTANCE_CHECKLIST.md` for exact index definitions and the controlled setup boundary.

## Actual interfaces and browser evidence

The new `forntend/verification/advertising-acceptance-browser.mjs` passed **13 named checks**. It drives real React advertising workspace forms against real local Express/Mongoose APIs and a disposable replica set. No advertising API responses or gateway success were mocked in this runner.

- Admin package creation/configuration, including complete synthetic structured policy and external invoice/credit-note modes.
- Seller's four-step owned-product/variant wizard, draft save, current package-version confirmation and submission.
- Admin review and current-revision approval.
- Separate financial authorization and required invoice reference.
- Disabled Checkout button and backend 503 if a client attempts to bypass the explicit external billing gate.
- Real ownership isolation: a second signed seller receives 404.
- Explicit non-billable pilot authorization through Admin.
- Actual browser viewability and click events persisted by the real telemetry API.
- Concurrent browser retries of both valid event types deduplicated in the actual database.
- Stopping the pilot removes its optional customer placement.
- Advertising transport failure leaves organic content available.
- Pilot workflow produces zero advertising Payment records, cash or recognized revenue.
- Actual Seller workspace responsive layouts at 320, 390, 768 and 1280 pixels.

Synthetic package prices, durations, tax/refund fields and invoice references are isolated test fixtures, not business approvals. Billing/paid delivery/refund gates remain false in this fixture and all external browser requests are blocked. The runner explicitly reports providerCalls 0 and providerCheckout blocked, not simulated. Passing it does not imply an externally paid campaign ran.

The existing sponsored-category browser runner also passed four widths, four keyboard/cart cases, three organic-fallback cases, four paid viewability/click cases, offscreen impression suppression, telemetry-failure navigation and four billing/policy-editor layouts. Its paid/Checkout scenarios use synthetic API/SDK responses and remain classified accordingly.

## Defects found and narrow fixes

1. **Standalone topology error mapping:** six database checks passed initially; the seventh correctly prevented a financial write but surfaced the driver's unsupported-retryable-writes error instead of the intended 503. `financeSafety.service.js` now recognizes that explicit unsupported-topology error. The rerun passed all seven, including no committed standalone write. Transaction semantics and permissions were not changed.
2. **Stale billing panel after moderation:** real browser approval updated the parent campaign detail but left billing data from the pre-approval version. Finance authorization did not appear until a reload. `AdvertisingWorkspace.jsx` now keys the existing billing panel by campaign ID **and document version**, reloading it after a moderation/financial version change. The real-API browser workflow and an added component regression both pass.

The first browser draft also needed its driver to await enabled controls during asynchronous UI updates. That fixture correction did not change application behavior or weaken an assertion. No billing, telemetry or campaign-serving architecture was rewritten.

## Financial and failure-path acceptance

The existing disposable integration suite plus four added cases passed **36/36 billing tests**. Real routes, HMAC checking, database transactions, ledger and durable event/receipt storage are exercised; gateway transport and its authoritative responses are mocked.

Verified in that scope: concurrent checkout with identical and different keys; immutable server-calculated amount/currency; invalid signatures; signed webhook amount mismatch; retries after authoritative correction; duplicate/out-of-order/delayed webhooks; failed and expired checkout; unknown order creation and verified recovery; capture after cancellation; extra captures; interrupted/uncertain refund recovery without duplicate dispatch; failed/partial/full refunds; externally initiated refund discrepancy holds; invoice/credit-note reference enforcement; expiry and worker completion without automatic revenue; seller/product/package eligibility; pilot/paid separation; event expiry/signature/type/product/revision validation and concurrency deduplication.

Financial isolation assertions confirm exclusive advertising Payment purpose/accounts/references, no seller_payable entries or merchandise links, no generic settlement/recovery processing of advertising payments, separate financial permissions, and exclusion from general merchandise finance endpoints. Existing cart, checkout, inventory, order lifecycle, Razorpay and financial integrity regressions also passed. These are local automated guarantees; they do not claim observed real-provider settlement or bank reconciliation.

## External acceptance boundary and remaining policy gaps

The existing transport probe was run successfully using the authorized test credentials. Its sanitized result was:

```json
{"ok":true,"mode":"test","orderCreatedAndFetched":true,"amountPaise":100,"paymentCaptured":false,"refundIssued":false}
```

Stopped before real Checkout/capture/webhook/refund because an approved staging application origin/database, approved commercial policy/package reference, a configured public Test-mode callback and operator Checkout interaction were not supplied or verifiable. No attempt was made to open a configured application's unknown API host, infer production safety from its name, expose a tunnel, change Dashboard settings, or turn synthetic policy text into approval.

The exact operator sequence is in `ADVERTISING_STAGING_ACCEPTANCE_CHECKLIST.md`: verify isolated topology/indexes; configure approved policy and gates; confirm the Test-mode Dashboard callback at `/api/payments/razorpay/webhook`; inspect the provider capture setting; sign in via actual staging Seller/Admin logins; submit/review/authorize; complete real Checkout; verify captured status authoritatively; correlate actual provider delivery evidence and server receipt; then issue/reconcile the allowed test refund through the application with required credit-note reference. Provider delivery needs a public URL; localhost alone is insufficient. [Razorpay webhook validation/testing](https://razorpay.com/docs/webhooks/validate-test/).

Reviewed `advertisingBillingPolicy.service.js`, `advertisingBilling.schema.js`, `advertisingBilling.service.js`, existing financial safety/ledger and GST assistance. No approved legal/business document or suitable advertising statutory issuer integration was supplied. GST assistance is an intake/review workflow, not proof of an advertising invoice issuer capability. Accordingly:

- Tax treatment, rate/timing, issuer, invoice and credit-note obligations, refund limits, interruption terms and recognition evidence still require business approval. Existing snapshots/configuration validation and external references remain supported and tested.
- Statutory invoice numbering/PDFs, CGST/SGST/IGST allocation, place-of-supply/e-invoice filing are not implemented or approved by this phase.
- Gateway fee/tax values remain provider observations; fee expense and bank settlement posting/reconciliation require approved semantics and evidence. No new financial posting, tax rate, refund entitlement or recognition rule was introduced.
- Native-app SDK, physical devices, actual staging login/OTP, real-time expiry over an approved package duration, distributed workers/abuse defense and hosted staging infrastructure remain untested.

## Exact changes in this phase

New:

```text
backend/verification/advertising-database-acceptance.test.js
backend/verification/advertising-acceptance-server.mjs
forntend/verification/advertising-acceptance-browser.mjs
forntend/verification/advertising-acceptance-entry.jsx
ADVERTISING_STAGING_ACCEPTANCE_CHECKLIST.md
ADVERTISING_STAGING_ACCEPTANCE_REPORT.md
```

Existing working-tree files changed further:

```text
backend/services/financeSafety.service.js
backend/verification/advertising-billing.test.js
forntend/src/components/advertising/AdvertisingWorkspace.jsx
forntend/verification/advertising-ui.test.mjs
```

Historical reports, environment files, gateway integration/financial rules, retirement guards and unrelated dirty work were preserved. Local builds generated ignored frontend assets. Nothing was committed, deployed or enabled in production.

## Commands and results

Final backend verification: **193 passed, 0 failed, 7 suites**. Includes seven new database checks, 36 billing tests and existing management/pilot, finance, notification, GST and parcel routing coverage.

From `backend`:

```text
node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising-database-acceptance.test.js verification/advertising-billing.test.js verification/advertising.test.js verification/gst-assistance.test.js verification/parcel-routing.test.js verification/financial-workflow.test.js verification/payment-notifications.test.js --silent --noStackTrace
```

Final existing backend regression: **117 passed, 0 failed, 11 suites**:

```text
node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/seller-order-lifecycle.http.test.js __tests__/services/order-fulfillment-lifecycle.test.js __tests__/api/seller-marketing-retirement.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/services/razorpay.service.test.js __tests__/services/account-lifecycle.test.js __tests__/services/financial-integrity.test.js __tests__/services/inventory.service.test.js __tests__/api/cart.api.test.js --silent --noStackTrace
```

Focused runs, subsequently included in the final runs: database suite **7 passed** after its initial **6 passed / 1 failed** diagnostic; expanded billing suite **36 passed**; advertising component suite **11 passed**. The final runs include these tests, so do not add repeated counts together.

Final frontend component/regression command: **154 passed, 0 failed**, from `forntend`:

```text
node --test --test-concurrency=1 tests/product-link.test.mjs verification/advertising-billing-ui.test.mjs verification/advertising-ui.test.mjs verification/sponsored-category-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/seller-notifications.test.mjs tests/checkout-ui.test.mjs verification/razorpay-overlay.test.mjs verification/payment-ui.test.mjs
```

Browser and build commands:

```text
# forntend
node verification/advertising-acceptance-browser.mjs
node verification/sponsored-category-browser.mjs
npm run build

# backend
npm run build
node verification/advertising-razorpay-probe.mjs --create-test-order

# repository root
git diff --check
```

Both browser runners passed. Backend build passed. Frontend build passed with the existing large-bundle warning (main JS approximately 1.89 MB minified); one run also emitted Vite plugin timing diagnostics. `git diff --check` passed with Windows line-ending warnings only. Existing frontend notification fixtures emitted timeout warnings despite passing. No tests/assertions were disabled. Full repository suites, hosted staging deployment or production tests were not run. The provider probe required authorized network access; its result was an external Test-mode order, not a mock.

No production deployment, production configuration/index change, live service restart, live credentials, real-money charge, live refund or production advertising activation occurred. No provider capture/refund occurred in either mode. Test-owned loopback processes were started and stopped only for isolated verification.

## ACCEPTANCE MATRIX

Statuses apply only to the scope in each row; blocked/not-tested rows are not passes. There are no unresolved failing automated cases after the two fixes.

| Requirement / case | Status | Evidence or exact boundary |
| --- | --- | --- |
| 1. Working tree, report, scripts, configuration inspected; unrelated changes preserved | passed | Targeted inspection and sanitized environment metadata; no configured database opened |
| 2. Payment index definitions and uniqueness | passed | Actual disposable MongoDB index catalog and duplicate enforcement |
| 2. AdEvent reporting/TTL indexes, immediate report exclusion and actual TTL deletion | passed | Seven-test database suite |
| 2. Webhook receipt and ledger deduplication indexes | passed | Actual catalog and concurrent unique-key enforcement |
| 2. Transaction commit/rollback and unsupported standalone handling | passed | Disposable replica set plus standalone, no fallback writes |
| 2. Target-hosted staging index/topology verification | not tested | No explicitly identified isolated hosted target |
| 3. Reproducible checklist and actual workspace browser automation | passed | Checklist plus 13 real-API browser checks; synthetic sessions/catalog |
| 3/7. Actual staging login/OTP and full application/portal-shell E2E | not tested | Local fixture mounts actual workspaces, not the entire application |
| 4. Real Razorpay Test-mode order creation/fetch | passed | Existing authorized credentials, one INR 1 test order |
| 4. Real Checkout completion and authoritative real test capture | blocked | Approved staging/policy target and operator interaction required; did not occur |
| 4/5. Remotely delivered signed provider webhook | blocked | No approved public callback/Dashboard setup; did not occur |
| 4. Provider test refund and authoritative processed result | blocked | No real captured test campaign, policy/callback/operator prerequisite; did not occur |
| 5. Stop at external configuration boundary and document operator actions | passed | Explicit checklist; no Dashboard change or tunnel |
| 6. Invalid/duplicate/delayed/out-of-order webhooks, signed amount mismatch and recovery | passed | Real HTTP/HMAC/database handling with mocked gateway transport |
| 6. Duplicate checkout, uncertain order/refund, interruption and late capture after cancellation | passed | 36-test integration suite; provider transport mocked |
| 6. Same fault cases reproduced against real provider | not tested | External Checkout acceptance blocked; no fabricated provider result |
| 6. Merchandise escrow/payout isolation | passed | Dedicated purpose/ledger assertions plus 117 merchandise regressions |
| 7. Paid schedule/start/expiry, approval/payment eligibility | passed | Deterministic disposable integration tests with controlled fixture dates and mocked captures |
| 7. Paid placements funded by real test capture in the actual staging app | blocked | No real capture or identified approved staging application |
| 7. Free-pilot isolation, real durable telemetry deduplication and organic fallback | passed | Actual local authenticated advertising APIs/browser and database; synthetic customer context |
| 7. Responsive advertising workspaces/customer cards | passed | Four widths; actual workspace/local API and separate component fixtures |
| 7. Native SDK, physical-device and long-duration/real-time paid expiry | not tested | No native/device or approved real-provider schedule acceptance |
| 8. Existing policy/issuer/fee/bank capabilities inspected; no invented rules | passed | Existing interfaces preserved; required external references tested |
| 8. Business tax/invoice/credit-note/refund/recognition approvals | blocked | No approved references/issuer capability supplied; fixture values do not qualify |
| 8. Statutory document generation, fee-expense and bank settlement closure | blocked | Missing approved policy/issuer/accounting capability; not implemented here |
| 9. Focused tests, relevant regressions and builds | passed | 193 backend verification + 117 backend regression + 154 frontend tests; browser runners/builds passed |
| 9. Whitespace check | passed | `git diff --check`, line-ending warnings only |
| 10. No prohibited production/live operation | passed | All writes local disposable or one provider Test-mode order; no captures/refunds/deployment |
| Complete external Razorpay acceptance | blocked | Real capture, remote webhook and provider refund all remain outstanding |
| Production readiness | blocked | Policy/issuer approvals, target verification, complete external acceptance evidence and separate release decision required |
