# Service application payment and submission fixes

Local changes, 2026-10-28. The attached previous-agent notes were reviewed; existing Reports and Storefront changes were preserved. The requested code graph tools were not exposed in this session, so targeted source inspection was used. No deployment, real application updates, gateway calls or live charges were performed.

## Causes

- Vendor service applications stored the fixed price but had no payment-request transition, checkout, verification endpoint or receipt handling. A paid service could move directly from review to work/completion.
- Customer Legal Services already used confirmed quotations, but an unconditional production block and a test-only gateway check prevented the workflow from operating with live configuration.
- Customer submission changed the URL before clearing the service definition. The request view briefly rendered that definition as an application and dereferenced missing answers. Vendor/application detail views also assumed optional answers and collections always existed.
- Mongoose minimized empty `answers` objects out of saved applications, so later reads/updates could have missing answers. Defaults and `minimize: false` now preserve empty submissions and make legacy missing-answer records readable without a backfill.

## Resulting flow

**Vendor:** submit → admin begins review → admin selects **Request payment**, entering payment/cancellation/refund terms → applicant opens My applications, refreshes and accepts the displayed fee/terms → Razorpay checkout → server verifies the signature and independently fetches captured payment evidence → Payment verified → admin can begin work and complete it.

The fee uses the original application pricing snapshot in INR; changing the catalogue price does not reprice an existing request. Fee/terms versions cannot change after checkout starts. Free services retain their existing workflow. Historical completed applications are not automatically charged; an admin can request the missing fee for an existing paid service still in review/progress.

**Customer Legal Services:** submit → review, approved provider assignment and confirmed quotation under the existing approved policy → applicant opens My requests and selects **Refresh request** → accepts the quotation/terms and selects **Pay confirmed amount**. A generic information message is not a payment request. Expired quotations and financial holds do not permit payment.

Submission/navigation now clears the old detail before rendering the next route. Customer, vendor, provider and admin answer displays tolerate omitted optional answers. Vendor status displays also tolerate unfamiliar legacy statuses.

## Payment boundaries

- Added owner-scoped vendor initiation, verification and status endpoints under `/api/services`; all still require an approved seller. Request bodies cannot override the frozen amount or fee version.
- Vendor payments use the existing Payment journal with `serviceApplicationId`, `servicePaymentKind: vendor_service` and the gateway mode. Their webhook/recovery handling is separated from customer Legal Services and shopping payments.
- Checkout uses `/api/services/payments/verify`, which is explicitly allowed by the shared frontend checkout helper.
- Only provider-confirmed captures mark a fee paid. Authorized/pending payments, callback success without verification, cancellations and invalid signatures do not authorize work.
- Duplicate verification/webhooks produce one collection posting. Extra/late captures create refund obligations and require review. Verified refunds post compensating entries and block work pending review.
- Vendor collections remain in the held `service_collections` ledger account. This is not automatic revenue recognition, a seller earnings credit or a provider payout.
- Unknown checkout creation is recovered against the provider's stored receipt, application reference, fee version, amount and currency before retry. The test suite exercises recovery of an existing provider order rather than creating a second order.
- Customer Legal Services now accepts correctly configured live Razorpay in production and test Razorpay locally. Missing/mismatched keys are rejected. Stored test payments cannot be reused as live payments. Existing policy, provider eligibility, finance permissions, refund obligations and disabled external provider payouts remain enforced.
- Admin vendor updates now notify the seller audience through `notifySeller`.

## Verification

All backend tests use isolated MongoDB instances and an in-process Razorpay SDK substitute. The browser test intercepts external origins, uses local fixtures and a synthetic Checkout class, and contacts no real backend or payment gateway.

- Frontend: `node --test --test-concurrency=1 verification/service-payments-ui.test.mjs tests/service-ui.test.mjs verification/legal-services-ui.test.mjs verification/razorpay-overlay.test.mjs verification/customer-services-ui.test.mjs` — **63 passed**.
- Browser: `node verification/legal-services-browser.mjs` — **29 passed**, including customer and vendor submit → request payment → verified payment at 390px and 1440px; existing views also checked at 320, 375, 430, 768 and 1440px. Zero runtime exceptions and zero real backend/gateway calls.
- Backend vendor API suite: `node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --silent --runTestsByPath __tests__/api/service-management.http.test.js` — **33 passed**, including the expanded lifecycle matrix.
- Backend service payment, Legal Services and GST suites: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/service-payments.test.js verification/legal-services.test.js verification/gst-assistance.test.js` — **85 passed**.
- Final regression including the shared financial workflow: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/financial-workflow.test.js verification/service-payments.test.js verification/legal-services.test.js verification/gst-assistance.test.js` — **197 passed**. This includes the 85 tests above; the counts are not additive.
- Frontend and backend `npm run build` passed. The frontend retains its existing large-bundle warning.
- Scoped whitespace checks passed. A whole-tree check also reported an unrelated pre-existing extra blank line in `backend/verification/admin-reports.test.js`; that ongoing Reports change was preserved.

## Manual acceptance and deployment

Deploy backend and frontend together. Payment operations require a MongoDB replica set/sharded transaction topology and correctly configured Razorpay keys, mode and webhook secret. Do not reuse an earlier test-mode payment after switching environments; use a new application for live acceptance.

1. Submit a new application with an optional answer left blank. Confirm the request/application detail appears without a white screen; reload it too.
2. For a vendor fixed-price service, begin admin review, choose Request payment and enter the terms. Open that application's detail in the seller account, refresh, accept terms and pay. Confirm verified payment appears before the admin can start paid work.
3. For a customer Legal Services request, use the existing reviewed provider and approved policy to confirm a quotation. Open My requests → the request → Refresh request, accept the quotation and pay.
4. Check cancellation, provider failure, pending verification and retries. These must not display a paid result until the backend confirms capture.

Live Checkout, the deployed webhook URL, banking reconciliation and real payment-provider acceptance remain deployment checks. No historical financial records were repaired or backfilled by this task.
