# Legal Services implementation and release report

22 October 2026. Production activation remains disabled. This report describes the implementation in this working tree, its verified local behavior, and release dependencies. The earlier analysis-only audit is retained unchanged.

## 1. Baseline and architecture

`LEGAL_SERVICES_IMPLEMENTATION_BASELINE.md` was written before application changes. The existing audit, `AGENTS.md`, `SERVICE_MANAGEMENT.md`, payment controllers, Razorpay helpers, commission calculations, wallet, seller ledger, payout eligibility, reconciliation and customer/admin routing were inspected. Code-review-graph tools were unavailable, so targeted source searches were used.

The original feature is an admin-managed catalogue for approved vendor applicants. A vendor application is not a provider listing. Customer requests now use the same Service and ServiceApplication collections with explicit customer eligibility and applicant type; the original vendor lifecycle stays separate. No products, carts, delivery orders, digital entitlements, wallet balances or seller payouts are created for legal requests.

Reusable financial components are `Payment`, `Commission`, `SellerLedgerEntry`, `postLedgerEntry`, `financialTransaction`, `razorpay.service.js` and `paymentRecovery.service.js`. WalletLedger represents actual customer wallet balances and was deliberately not used for provider obligations. No parallel legal ledger or payment collection was introduced.

External professionals have a separate, minimal `LegalProvider` identity linked to an existing active User. Approval records an administrator's explicit identity/credential/service-eligibility attestation and evidence reference. It does not invent or publish a professional credential, automatically verify someone, or grant seller/admin privileges.

## 2. Files and responsibilities

| Added files | Purpose |
| --- | --- |
| `backend/models/LegalProvider.js` | Active-user association, eligible services, reviewed approval/suspension, review evidence and history |
| `backend/services/legalPolicy.service.js` | Server flags/test-only gateway gates, service/finance permissions, explicit versioned policy validation, quotation math, expiry and settlement blockers |
| `backend/services/legalWorkflow.service.js` | Transactional request actions, provider checks/fences, audit events, notifications, capture allocation and shared-ledger reconciliation |
| `backend/services/legalPayment.service.js` | Request/quote-bound payment attempts, independent signature/status verification, webhook dispatch, shared refund execution/recovery and compensating postings |
| `backend/controllers/legalServices.controller.js` | Catalogue/customer/provider DTOs, ownership, submission/idempotency, private uploads/downloads, admin provider/policy/actions |
| `backend/routes/legalServices.routes.js` | Dedicated customer/admin/provider endpoints and permission/upload/privacy gates |
| `forntend/src/components/services/LegalServices.jsx` | Homepage discovery, catalogue, details, review/submit intake, account request views, quotation/payment controls, private files, provider workspace |
| `forntend/src/components/services/LegalAdminWorkspace.jsx` | Existing service panel wrapper with customer request, provider review and policy tabs; quotation, assignment, completion and financial controls |
| `forntend/src/components/services/legalServices.css` | Responsive light-theme forms/cards, errors, focus and small-screen wrapping |
| `backend/verification/legal-services.test.js` | Isolated replica-set request, payment, permissions, documents, commission, refund, dispute and ledger tests with SDK/transport mocks |
| `backend/verification/checkout-head-baseline.mjs` | Reproduces local checkout tests against HEAD in an isolated temporary source copy; never edits working source |
| `forntend/verification/legal-services-ui.test.mjs` | Actual component SSR/hook tests for privacy, display, loading/error/history and payment eligibility |
| `forntend/verification/legal-services-browser.mjs`, `legal-browser-entry.jsx` | Synthetic local browser fixture harness; no backend/gateway operations; external URLs and API writes blocked |
| Baseline and this report | Architecture, migration plan, test evidence and release boundaries |

| Changed files | Why |
| --- | --- |
| `backend/models/Service.js`, `ServiceApplication.js` | Explicit audience; additive customer ownership/provider/legal workflow fields, extended statuses and event actors; retain vendor key index |
| `backend/models/Payment.js` | ServiceApplication and quotation-version references on existing payment model |
| `backend/models/Commission.js` | Separately scoped legal percentage policy and immutable policy version data |
| `backend/models/SellerLedgerEntry.js`, `backend/services/sellerLedger.service.js` | Provider/request references, legal collection/provider accounts, replay payload checks; existing append-only controls retained |
| `backend/services/serviceForms.service.js` | Validate/save explicit audience and optional legal category alongside existing forms |
| `backend/controllers/serviceManagement.controller.js` | Preserve vendor-only catalogue/application semantics, including legacy missing audience/type; export private cleanup helper |
| `backend/routes/serviceManagement.routes.js` | Align permission with documented superAdmin-or-manage_services rule |
| `backend/routes/index.js` | Mount dedicated namespaces before generic service routes |
| `backend/controllers/payment.controller.js` | Dispatch verified legal events before product settlement, including recovered order creation |
| `backend/services/paymentRecovery.service.js` | Reuse refund recovery with legal release gates; verify legal request/quote association when recovering unknown gateway creation |
| `backend/controllers/financeWorkflow.controller.js` | Keep legal policies out of product commission configuration editing |
| `backend/services/financialReconciliation.service.js` | Include provider identity when grouping shared-ledger negative balances |
| `forntend/src/App.jsx` | Minimal provider workspace route; backend still enforces provider identity |
| `forntend/src/modules/User/pages/LandingPage.jsx`, `context/UserContext.jsx`, `pages/ProfilePage.jsx` | Customer discovery, dedicated legal paths, and My Legal Service Requests account entry |
| `forntend/src/utils/customerSession.js` | Explicit public catalogue/detail path classification; request history remains protected |
| `forntend/src/modules/Admin/routes/index.jsx` | Render shared service management wrapper with legal workflow tab |
| `forntend/src/components/services/ServicesPanel.jsx` | Explicit customer/vendor audience selection and optional category in existing admin editor |
| `forntend/src/modules/Admin/utils/serviceNotifications.js`, customer `NotificationDrawer.jsx` | Allowlisted legal-request deep links and authorized detail fetches |
| `forntend/src/utils/razorpayCheckout.js` | Allowlist legal verification endpoint; retain backend-confirmed success requirement |

## 3. Model and index compatibility plan

- Service.audiences defaults to `['vendor']`. Legacy database records missing the field remain vendor-only through explicit query predicates. Customer visibility requires `status: published` AND `audiences: customer`; neither service name nor price infers eligibility. The optional legalCategory is administrator-authored metadata, not seeded/inferred content.
- ServiceApplication.applicantType defaults to vendor. `vendor` remains the vendor applicant and is required for that type; customer records use authenticated `user`, separate `provider`, `responsibleAdmin`, immutable-by-workflow submission snapshot and versioned legal quotation history. Original vendor responses, processing and documents still use their existing routes/service.
- The unique `(vendor, submissionKey)` index is retained. Customer submissionKey is server-prefixed with customer identity; a separate unique sparse `customerKey` binds retries to authenticated owner. Canonical payload hashing detects changed answers/files under the same key. Concurrent retries produce one application.
- New provider index: unique `LegalProvider.user` named `legal_provider_user_unique`. Customer index: unique sparse `ServiceApplication.customerKey` named `legal_customer_key_unique`.
- Customer submit and provider registration fail closed if their named indexes have not been prepared. Transactional application updates serialize creation of the request's Payment; no duplicate order or Payment collection is required.
- Service/ServiceApplication automatic index initialization is enabled only under NODE_ENV=test. LegalProvider and Commission do not auto-create indexes. No migration or index command was run against any configured/live database. Existing unrelated startup behavior is not a deployment migration strategy.

Future approved migration procedure (not executed): back up first; inventory existing indexes and duplicate identities in a staging copy; verify legacy applications have vendor references and no incompatible customerKey values; verify new unique/sparse keys with a dry-run data report; explicitly create only the two named indexes and confirm existing vendor/slug/ledger idempotency indexes; verify rollback-compatible reads and vendor workflows; retain old fields/indexes and leave legacy services vendor-only. Do not run syncIndexes, drop the old vendor key, backfill providers, invent credentials, or bulk-enable customer audiences. Enabling customer submissions before index verification is prohibited by the application guard.

## 4. Routes and contracts

All JSON uses `{success,data,meta}` or the existing normalized failure envelope. Lists are paginated with validated page/limit. Customer/provider responses are allowlisted; private responses use `Cache-Control: private, no-store`. IDs are references, never authorization.

### Customer: `/api/customer-services`

| Method/path | Contract |
| --- | --- |
| GET `/capabilities` | Public catalogue/submission flags only |
| GET `/` | Published/customer-eligible list; bounded escaped name/description `q`, optional category, page/limit |
| GET `/catalogue/:id` | Safe definition, required dynamic fields, explicit form/service versions, optional accurate starting-price information; no internal admin/provider attribution |
| POST `/catalogue/:id/applications` | Active buyer session; multipart answers JSON, formVersion, serviceVersion, field-ID documents and Idempotency-Key; 201 new or 200 identical replay |
| GET `/applications`, `/applications/:id` | Exact current-customer/type ownership; state/history, public quotation, receipt and refund status |
| GET `/applications/:id/files/:fileId` | Owner-only attachment; no public URL |
| POST `/applications/:id/respond` | Owner-only information response, multipart version/message/files; preserves original answers/history |
| POST `/applications/:id/cancellation` | Version and reason; records review request/financial hold, not automatic cancellation/refund |
| POST `/applications/:id/payment` | Accepted current quotationVersion/terms plus payment idempotency key; server amount only |
| POST `/payments/verify` | Request orderId and Razorpay signed callback references; signature plus independent provider evidence |
| POST `/applications/:id/payment-status` | Owner-bound authoritative status/recovery check; failed attempts permit explicit new-key retry, abandoned issued orders are reused |

Frontend paths: `/legal-services`, `/legal-services/:serviceId`, `/legal-services/requests`, `/legal-services/requests/:id`. History stays separate from product orders. No physical address/GPS is required unless an explicitly configured intake field needs it. Sensitive form drafts/files are not persisted in browser storage; only retry keys are kept in sessionStorage.

### Admin: `/api/admin/services/legal`

Requires an active admin and superAdmin or manage_services. Finance actions additionally require superAdmin or manage_finance. Ordinary role=admin alone no longer grants service management.

| Method/path | Contract |
| --- | --- |
| GET `/requests`, `/requests/:id`, `/requests/:id/files/:fileId` | Customer requests separately from legacy vendor applications; authorized private details/files and reconciliation |
| POST `/requests/:id/actions` | Exact version, action, required reason and action-specific fields; server-enforced transitions |
| GET/POST `/providers` | Reviewed existing-user identity, explicit service eligibility, approval/suspension, evidence and version |
| GET/POST `/policies` | Finance permission; new immutable approved policy version, no active defaults |
| POST `/requests/:id/recover-payment` | Finance permission; existing recovery service verifies request/quote/receipt/amount/currency before binding uncertain creation |
| POST `/requests/:id/refund` | Finance permission; approved obligation key, optional reconciliation/evidence; test-only execution gate |
| POST `/requests/:id/payout` | Always blocked with 503 pending an approved payout product and banking verification; never simulates a transfer |

Admin actions: review, information, reject, assign, share_documents (explicit fileIds/fieldIds), provider_message, quote, start, verify_completion, cancel unpaid, deny_cancellation, approve_refund, hold, resolve_hold, bank_reconciled and release. Finance-sensitive actions require the separate finance permission. Quotation amount, scope and optional expiry are admin inputs; commission/taxes/provider amounts/total are calculated by the backend.

### Provider: `/api/legal-provider`

The provider workspace is `/legal-provider`. Authentication is an active User plus an approved LegalProvider; it does not require or grant seller/admin membership. GET `/` lists assigned/eligible requests; GET `/:id` and `/:id/files/:fileId` enforce assignment and reviewed service eligibility. POST `/:id/progress` accepts only defined multipart updates/version.

Provider intake answers/files are hidden by default. Admin explicitly grants the minimum field/file access. Providers can acknowledge/request information through admin before work begins; progress, deliverables and completion submission require in_progress, without financial holds. Providers cannot change quote, price, commission, payment, completion verification, refunds, ledger or settlement. Admin/provider messages are separate from customer-visible request information.

## 5. Request lifecycle

Normal flow: submitted → under_review → awaiting_payment → payment_verified → in_progress → completed_pending_admin_verification → completed.

Information loop: admin can request information from review or active fulfilment; customer response returns to the recorded prior review/work state without resetting payment/quotation. Provider information requests are routed through admin.

- Only admin confirms scope, quotation, assignment and work start.
- Provider completion is only a submission; admin evidence/reason and verification are required for completed.
- Rejection applies before quotation. Unpaid cancellation is controlled; once a payment was initiated it cannot silently erase that obligation.
- Customer cancellation requests capture the stage (before payment, after initiation/capture, during/after work) and block work/settlement pending review. There is no universal cancellation fee or refund percentage.
- Refund approval creates an obligation and refund_processing. Independently verified full refund produces refunded; a partial refund restores the tracked prior workflow state with partial_refund payment status and proportional compensating postings. A pending/failed/unknown refund remains a settlement blocker.
- Disputed/late/additional captures create explicit holds. Signed gateway dispute events hold the request; even closure does not automatically release money. Admin must resolve with evidence and reconciliation.
- Events record actor/type, time, prior/new state, action and bounded reason. Application writes use exact version plus optimistic concurrency inside transactions. No endpoint edits/deletes historical events or original submission answers.

## 6. Quotation, commission and accounting

Every policy requires explicit approved rate, effective date, reference, commission base, service/commission tax treatment/rate, gateway-fee treatment, provider-deduction policy, refund allocation policy, customer terms and settlement hold hours. No live business policy or percentage was seeded. The 10%/₹5,000 example appears only in synthetic tests.

Current explicitly supported policy choices are: percentage on service amount excluding service tax; gateway fees absorbed by platform; no other provider deduction; explicit exempt/exclusive service tax; explicit exempt/inclusive/exclusive commission tax; proportional total refund allocation. Unsupported policies are rejected rather than silently guessed. Business approval of these exact choices is required before configuring an effective version.

Quotation snapshots freeze request/service, scope, INR amount in integer paise, service tax, total, commission rule/version/rate/policy, calculated commission and commission tax, provider obligation, quote version, confirming admin/time and optional expiry. Existing calculation helpers use integer/BigInt rounding. Quotation totals are capped by the existing gateway adapter's MAX_CHECKOUT_PAISE (currently ₹1 lakh), rather than inventing a separate limit. Commission tax treatment can reduce provider net only through the explicitly approved snapshot. Provider + commission + taxes reconcile to total. No quote revision is allowed after any payment initiation, including an uncertain initiation.

On verified accepted capture, shared SellerLedgerEntry posts stable `LEGAL:<request>:<event>` keys for:

- legal_collections credit/pending: gross captured amount;
- legal_provider_payable credit/held: provider obligation;
- commission_revenue credit/pending: platform commission allocation;
- tax_liability credit/pending: service plus commission tax allocation.

Zero entries are omitted. Collection, obligations, commission and taxes are separate account concepts; this extends the repository's append-only allocation ledger, **not a new general-ledger/escrow/bank-account product**. The collection posting is not proof of bank settlement. Existing seller/rider payout balance queries cannot consume the new provider account.

Admin-verified completion, full original capture, supported refund/dispute status, bank/gateway settlement evidence, provider approval, expiry of the configured completion hold, and reconciled ledger balances are required for release. Release appends held debit/eligible credit for the remaining provider amount; repeat release is rejected. It never makes a bank transfer. No automatic payout integration or provider banking verification exists; payout execution is explicitly blocked instead of using SellerPayout with the wrong legal identity.

## 7. Payment, refund and dispute safeguards

Legal payment uses the existing Razorpay SDK adapter and Payment attempt/capture journal. Attempts are bound to one request and immutable quotation version. The request transaction serializes attempt claims; an already-issued order is reused, and unknown creation blocks new dispatch until existing recovery verifies evidence. The client cannot supply total/tax/commission/provider amounts.

Callback verification checks customer ownership, signature, gateway order/payment relationship, exact amount/currency/quote version and attempt association. The shared webhook verifies raw-body HMAC before dispatch; legal handling independently fetches provider evidence and never routes a service Payment into product Order settlement. A frontend callback is never sufficient. Failed/pending attempts cannot start work. Replayed capture IDs do not duplicate postings; late/extra captures are held, not fulfilled twice.

Refund approval is distinct from execution and confirmed completion. Existing processRefundObligation/reconcileRefundEvent supplies claim leases, captured-payment checks, refund-history inspection, receipt binding, pending/failed/unknown handling and bounded cumulative amount checks. Legal guards also apply when these shared helpers are reached through existing finance routes.

Confirmed refunds append compensating entries, never rewrite originals. Cumulative integer targets allocate service/commission taxes first, then commission/provider remainder, avoiding independent-rounding over-allocation. Outstanding or unknown refund obligations block provider release; refund allocations cannot exceed captured total. Uncertain gateway outcomes block blind retry. Payout-created or extra-capture cases are blocked for separate reconciliation rather than guessing a recovery allocation.

Reconciliation displays payment attempts/captures, shared entries/balances, original-minus-refund expected amounts, explicit exceptions and settlement blockers. Actual bank settlement is recorded only as an authorized admin evidence attestation; automated Razorpay settlement/bank reconciliation is **not implemented or claimed**. No marketplace escrow or split-settlement arrangement was discovered.

## 8. Private documents and notifications

Existing private service filesystem storage and upload limits are reused, including generated UUID keys, extension/MIME/signature checks, sanitized display filenames, checksums, size validation, authenticated attachment-only downloads, sandbox/nosniff/no-store headers, upload byte/rate/concurrency budgets and ownership preflight. Confidential legal uploads never go to Cloudinary or public URLs.

Customer ownership includes applicant type. Provider access also requires live approval, assigned request, reviewed service eligibility and explicit per-file sharing. File additions and state changes are transactional with conservative reference-aware cleanup. No automatic document deletion/retention job was added. Signature validation is not antivirus/content disarm. Actual durable private volume, Windows ACLs, encryption, cross-replica storage, backup/restore and retention requirements remain release dependencies; they cannot be verified from source.

Notifications use existing SYSTEM events and opaque request references, without legal answers/document contents. Best-effort delivery failures do not roll back commits or duplicate financial postings. Customer/admin legal routes are allowlisted and fetch authorized records. No new scheduling worker was added for proactive quotation-expiry reminders; expiry is enforced synchronously at payment acceptance, and the expiry time is displayed.

## 9. Feature defaults and production blockers

The following server variables are all false unless explicitly set to `true`: LEGAL_SERVICES_CATALOGUE_ENABLED, LEGAL_SERVICES_SUBMISSIONS_ENABLED, LEGAL_SERVICES_FULFILMENT_ENABLED, LEGAL_SERVICES_PAYMENTS_ENABLED, LEGAL_SERVICES_REFUNDS_ENABLED, LEGAL_SERVICES_PAYOUTS_ENABLED. No environment file was enabled or live credential added.

All legal financial execution requires RAZORPAY_MODE=test and an rzp_test_ key. Production/deployment-production non-catalogue capabilities and new admin mutations are unconditionally release-blocked even if a flag is mistakenly set. Provider payout execution remains blocked even in test mode because a payout/banking contract is absent. Production activation requires a separately reviewed code/release change; changing a UI flag is insufficient.

Outstanding release approvals/dependencies:

1. Approved actual offerings, categories, provider onboarding/evidence requirements and limited document-access roles; no catalogue/provider records were seeded.
2. Approved percentage/base/tax/gateway-fee/deduction/refund/cancellation/settlement policy and customer terms, recorded explicitly by authorized admins.
3. Approved migration/index plan and staging compatibility verification before enabling submissions.
4. Verified private-storage persistence, permissions, backup/restore, retention and incident handling.
5. Actual Razorpay test-account end-to-end verification, webhook delivery and refund reconciliation. Automated tests mock SDK/transport and do not establish real provider connectivity.
6. Verified bank/settlement evidence procedure and an approved external-provider payout product/onboarding/banking model. No automatic or real manual transfer was implemented or simulated.
7. Access-control/financial-invariant review and explicit production release authorization.

## 10. Verification results

Results and remaining limitations are recorded below after local verification. Tests do not load developer dotenv files; backend integration uses its own MongoMemoryReplSet and temporary private directory with synthetic identities. No configured production database is used. Existing test files were not weakened or deleted.

Initial verified results:

| Command (run from relevant package) | Actual result |
| --- | --- |
| backend: `npm test -- --runInBand __tests__/api/service-management.http.test.js` | 33 passed, 0 failed; original vendor behavior verified |
| frontend: `npm run test:services` | 16 passed, 0 failed |
| backend: legal-services + financial-workflow verification (before final added cases) | 82 passed, 0 failed (26 legal + 56 existing finance) |
| frontend: serial legal UI + auth-role + portal-startup + checkout-ui + Razorpay overlay/payment tests | 101 passed, 0 failed; serial mode avoided concurrent Vite cache/port collisions |
| backend: existing checkout/webhook/Razorpay/upload group, first run | 27 passed, 5 failed. Two webhook compatibility failures were corrected; three checkout notification failures remain baseline failures |
| backend: `npm test -- --runInBand __tests__/api/razorpay-webhook.http.test.js` after dispatch correction | 4 passed, 0 failed |
| backend: `node verification/checkout-head-baseline.mjs` | Unchanged HEAD f372d0b reproduced exactly 10 passed, 3 failed in the checkout suite: grocery notification, ecommerce notification, duplicate-checkout notification expectations. Mock persistence does not establish the seller-notification index/approval lookups; tests were left intact |
| backend: `npm run build` | Passed syntax and backend-only service packaging checks |
| frontend: initial `npm run build` | Passed; existing large-bundle warning, approximately 1.81 MB JS |

Earlier local iterations included one stale-provider test fixture failure and one whitespace-only UI test assertion failure, both corrected. Browser startup initially failed with Chrome exit/Edge renderer timeouts; the isolated harness now uses a test-only browser sandbox override and overrides Vite's API base to its local fixture origin. No real legal data, credentials or gateway calls are used by that harness. Final results are appended after the concluding checks; no missing result is represented as passing.

### Final checks

| Exact command / scope | Final result |
| --- | --- |
| backend: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand --runTestsByPath verification/legal-services.test.js verification/financial-workflow.test.js --json --outputFile=verification/legal-services-results.json` | 2 suites, 89 passed, 0 failed, 0 skipped: 33 legal-service tests and 56 existing finance tests |
| backend: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand --runTestsByPath verification/legal-services.test.js` after final provider fence, gateway-order evidence binding and quotation-limit checks | 33 passed, 0 failed, 0 skipped |
| frontend: `node --test --test-concurrency=1 verification/legal-services-ui.test.mjs tests/service-ui.test.mjs` | 25 passed, 0 failed, 0 skipped after final provider UI changes |
| frontend: `node --test --test-concurrency=1 verification/legal-services-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/checkout-ui.test.mjs verification/razorpay-overlay.test.mjs verification/payment-ui.test.mjs` | 101 passed, 0 failed, 0 skipped; this overlaps the focused test group and is not an additional unique-test total |
| frontend: `$env:CHROME_BIN='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; node verification/legal-services-browser.mjs` | 25 actual browser page/viewport checks passed, 0 failed, zero real backend/gateway calls and zero mutation requests; 320/375/430/768/1440px catalogue, details, customer request, provider list and admin request views. Uses isolated component mounting, not deployed full-portal E2E |
| backend/frontend `npm run build` | Both passed. Final frontend JS approximately 1.813 MB; Vite large-chunk warning remains |
| `node --check` on new policy/payment/workflow/controller/router files | Passed |
| `git diff --check` | Passed; Git emitted existing LF-to-CRLF conversion notices, not whitespace failures |

The latest raw JSON artifact at `backend/verification/legal-services-results.json` was refreshed by the focused legal rerun and therefore contains the 33-test result rather than the earlier combined 89-test run. No suites were marked skipped to hide failures. The three unchanged-HEAD checkout notification failures remain explicitly unresolved. Full production E2E, real Razorpay test-account traffic, real private-volume restart/restore, automated bank settlement ingestion and provider payout product testing were not performed.

The HEAD comparison used the existing local checkout test file against tracked backend source from commit f372d0b. Its temporary tree was removed after the comparison; the user's worktree was never replaced. These baseline failures concern mocked seller notification expectations, not a passing end-to-end checkout guarantee.

## 11. Completion boundary

The repository contains the customer/admin/provider workflow and disabled financial integration described above. Existing vendor application regression tests pass. A real provider payout adapter, automated bank settlement ingestion, deployed storage verification, and real Razorpay test-account E2E are not established and remain explicit release blockers; they are not simulated successes. Production acceptance must not be declared from mocked tests alone.

No production database records/indexes, live charges, real refunds, provider transfers, migrations or deployments were initiated. No existing worktree changes were reset or overwritten; the implementation started from a clean worktree. The earlier analysis-only audit remains unchanged.
