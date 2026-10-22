# Legal Services implementation baseline

22 October 2026 — prepared before implementation. Current worktree was clean at inspection. The existing customer integration audit and SERVICE_MANAGEMENT.md were read. The code-review graph tools are unavailable; targeted source inspection is the fallback.

## Existing ownership and lifecycle

Service is admin-managed, with published definitions available only to approved seller applicants. ServiceApplication.vendor is the applicant, not a provider. Its six-state workflow, private files, snapshots and vendor/key uniqueness must remain compatible. CustomerSessionGate actually lives in src/components; customerSession.js lives in src/utils. Customer navigation is manual pathname/context state, not React Router.

## Reuse and extension map

- Reuse Service, ServiceApplication, form validation, private service storage and upload controls. Add explicit audience, customer legal workflow state, user-scoped retry identity and separate provider assignment. Legacy vendor workflow remains in serviceWorkflow.service.js.
- Reuse Payment and razorpay.service.js order/signature/status/refund primitives. Existing payment.controller.js is product-order oriented; dispatch legal events before product settlement. No fake Order/cart entries.
- Reuse Commission for separately scoped, append-only legal percentage rules. Existing vendorCommission calculation uses integer paise and explicit tax treatment. Legal quotation requires an approved policy rather than borrowing product tax/refund assumptions.
- Reuse SellerLedgerEntry/postLedgerEntry and financialTransaction. Add legal provider, application and account references. WalletLedger updates customer wallet balances and is unsuitable for provider obligations. No parallel financial ledger.
- Existing SellerPayout belongs to Seller and is not an external-professional payout. Provider execution is release-blocked; record an auditable reservation/approval and independently evidenced manual payout, never simulate a gateway transfer. No escrow or linked-account payout capability is established by Razorpay order capture.
- Existing reconciliation scans product orders; add legal reconciliation in the service admin workspace with shared ledger entries. Existing product payouts must not consume provider balances.

## Required surfaces

Models: additive Service/ServiceApplication/Payment/Commission/SellerLedgerEntry extensions plus minimal LegalProvider identity/review model. APIs: customer-services, legal-provider, and protected customer workflow under admin/services. UI: homepage/account entry, catalogue/request/quote/payment/history, admin workflow alongside existing ServicesPanel, assigned-provider workspace. Tests: isolated replica-set integration with gateway mocked; existing vendor, checkout, payment and finance suites; SSR UI and build checks.

## Risks and release boundaries

- Retain vendor/submissionKey index; use a distinct sparse customer key with owner binding, no production index mutations. Disable auto-index on newly extended service models; document explicit index preparation and require readiness before enabling writes.
- Admin permission currently allows ordinary role=admin without manage_services despite documentation. Align to superAdmin or explicit permission and test both cases.
- Full financial writes require transactions; never use standalone fallback for money. Freeze quote and commission/policy snapshots, use compensating entries, serialized request state, stable ledger/payment references.
- No tax, commission percentage, deductions, cancellation/refund percentage, settlement delay, professional credentials or offerings are approved numerically in this request. Require auditable explicit policy configuration; no active defaults. Actual refunds and payouts remain disabled without policy/release approval; no live gateway operations permitted by this implementation.
- Production flags remain off; test-mode gateway guard rejects live keys and production environments. Existing private storage is local filesystem with operational persistence/ACL/backup unknown; release remains blocked until verified. No public Cloudinary legal files.
- Provider identity should not require seller/admin privileges. Existing active User plus explicit approved LegalProvider record, reviewed service eligibility and evidence reference is the minimum model; no automatic verification.

## Safe verification

Never start backend/index.js (database initialization/background work). Jest setup clears real DB URLs; tests create their own MongoMemoryReplSet and private temporary directory and mock Razorpay and notification transport. Run focused service/vendor tests, then checkout/payment/finance regressions. Frontend tests use Vite SSR/harnesses; build writes only local dist. Report actual commands/results separately. No production data, indexes, credentials, payments, refunds, transfers or deployment are authorized.
