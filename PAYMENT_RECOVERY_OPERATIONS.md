# Payment recovery and refund operations

Implemented locally on 2026-10-16. No deployment, application database/index change, or live provider operation was performed. Integration tests use disposable MongoDB replica sets and mocked Razorpay SDK calls. Merchant limits and staging infrastructure still require separate verification.

## Authorization and APIs

Use the existing authenticated Admin session and approved operational environment. Customer, seller and delivery sessions cannot operate these endpoints. Payment recovery detail/process/reconcile requests share a 30/admin/minute limiter; queues use bounded pagination (page 1–1000, limit 1–100, default 24) and a two-second database budget. No background worker is introduced.

| Method and path | Input / result |
| --- | --- |
| GET `/api/admin/payment-refund-obligations` | Default pending/processing/failed/reconciliation_required queue; `status=processed` or `status=all` includes verified completed outcomes; page/limit supported |
| GET `/api/admin/payment-attempt-recovery` | Unresolved initializing/creation_unknown attempts, receipts, original orders, paise, currency and history; page/limit supported |
| GET `/api/admin/payment-recovery/:paymentId` | Original order/group, amount, captures, all attempts, obligations, verified results and histories; internal claim tokens excluded |
| POST `/api/admin/payment-recovery/:paymentId/refund/process` | JSON `{ "key": "CANCEL:<orderId>" }`, `CAPTURE:<gatewayPaymentId>` or `RETURN:<returnId>`; no caller-supplied amount, currency or eligibility |
| POST `/api/admin/payment-recovery/:paymentId/refund/reconcile` | JSON `{ "key": "..." }`; optional `providerRefundId` is a lookup hint, independently fetched and verified |
| POST `/api/admin/payment-recovery/:paymentId/attempt/reconcile` | JSON `{ "key": "<attemptId>" }`; optional `gatewayOrderId` is a lookup hint, independently fetched and verified |

The process endpoint may send a refund request in the configured authorized environment. Reconcile endpoints only read provider evidence and persist verified local results; they never dispatch another refund or create a gateway order. Local/non-production recovery requires Razorpay test mode. Do not use these APIs against live credentials during development or tests.

## Refund procedure and states

1. Inspect the queue and Payment detail. Use the obligation key as the debt identity, not a legacy refund projection as an independent instruction. Confirm order, capture, amount and prior history.
2. For pending or confirmed failed obligations, explicitly request process. An atomic Payment-level claim admits one operator/worker. Before dispatch, the service fetches the captured payment and bounded refund history, checks outstanding paise, and reconciles matching historical Return/payment refund references. Conflicting allocations remain blocked. Another unresolved dispatched obligation on the same Payment blocks new processing too.
3. Dispatch intent and its receipt are saved before the provider POST. The response alone does not mark completion: the service fetches the refund independently and verifies its ID, parent payment, exact amount, receipt/notes and status. INR is verified on the captured parent payment; a refund response's currency, when present, must also be INR.
4. `processed` means a fetched provider result verified success. `processing` means a verified pending provider refund. `failed` means a verified failed refund or explicit provider request rejection. Timeout, malformed/mismatched evidence, missing IDs and ambiguous outcomes become `reconciliation_required`.
5. For processing/uncertain obligations, request reconcile, not process. Provider-confirmed completion closes the obligation; provider-confirmed failure permits an explicit later process after history/outstanding checks. Missing history after dispatch is **not** proof of failure or absence and stays blocked. If no dispatch was ever recorded, successful reconciliation can return the debt to pending.
6. Signed refund webhooks are matched to the obligation ID/receipt and original captured payment, then independently checked against provider refund evidence. Replays do not add money or repeat settlement. Historical Return webhooks retain their readers with additional parent-payment/amount verification.

Normal claims are never automatically stolen to send another request. A crashed claim becomes eligible for **reconcile only** after five minutes. A stale process must still match its claim at dispatch. Histories retain actors, timestamps, receipts, verified provider IDs and results. A returned provider ID remains recorded even if the following verification read fails. Processed outcomes cannot be downgraded by delayed failure responses.

Razorpay receipt/notes are correlation references in this implementation; they are **not assumed to provide provider-side idempotency**. A confirmed-failed retry has a distinct receipt so an older failure cannot resolve a newer uncertain request. Request exceptions are considered definite rejection only for the SDK's explicit HTTP 400 BAD_REQUEST_ERROR response. Other errors stay uncertain. Provider history scans stop after 1,000 rows; incomplete history requires manual investigation rather than a guessed retry.

If reconciliation remains uncertain, retain the obligation and involve the merchant's authorized payments operator/provider support. Obtain the actual provider refund ID or matching order/capture evidence, then use the reconcile API. Do not clear the state manually, issue a dashboard refund followed by another process request, or treat an empty query as proof that money did not move. There is intentionally no force-complete, force-unblock, or manual financial-record override endpoint.

## Existing Returns and projections

Razorpay Return refunds now create/reuse RETURN:<id> obligations and use the same Payment claim and provider verification. Existing Return status, notification and allocated-Coins completion code remains the completion path. Wallet, COD and historical PhonePe Return handling retain their existing paths.

Matching verified historical Return refunds or single-order Payment.refund references can be adopted without sending a second refund. A conflicting/incomplete Return refund blocks a cancellation obligation. Cancellation projections retain their history and receive processed status/provider ID when verified; they are not deleted. The shared Payment refund total reflects verified refunds on the original settled capture. Refunding an extra capture does not incorrectly mark the original obligation refunded or repeat fulfilment/inventory changes.

## Uncertain initialization procedure

Initializing and creation_unknown journal rows atomically block another initialization. This includes an SDK request still in flight and a process interruption before the current gateway projection was stored. The queue exposes these attempts to operators. SDK-confirmed creation rejection is recorded as creation_rejected and permits a later normal initialization; a timeout is not a rejection.

Reconciliation searches bounded provider order history by the persisted receipt, or fetches the supplied order ID. It verifies the provider order ID, receipt, original merchantOrderId and originating order notes, amount and currency. Exactly one verified result is linked as issued. Captured funds then use the existing settlement policy: first valid capture settles once, cancelled orders remain cancelled with refund debt, failed-attempt/extra captures require refund and never fulfil twice. A signed late capture can also recover an unknown attempt by fetching and verifying provider order evidence first.

An empty or ambiguous order lookup cannot conclusively establish that an earlier timed-out creation never happened. The SDK interfaces used here provide no definitive negative attestation for that request. Such an attempt remains blocked, even if an operator believes it absent. Escalate for provider evidence; do not invent a safe absence result. An explicit original provider validation rejection is the supported confirmed-no-creation outcome. A verified existing order is resolved/tracked, so subsequent ordinary initialization does not lose any legitimate reference.

## Deployment and rollback

Schema fields are additive; historical records are not rewritten. No new index or migration is required for these changes. Deploy compatible journal/recovery/Return/webhook handlers together through a separately approved process. Required MongoDB transaction support, MongoDB 5.2+ catalog compatibility, and checkout uniqueness remain independent prerequisites.

Rollback must retain journal-aware capture and refund reconciliation. Disable new payment/refund entry if necessary and retain compatible readers while preparing a forward fix. Never delete attempts, captures, obligations, Return records, or financial history. An older handler can neither reconcile these uncertain outcomes nor safely retry them.

## Local verification

The initial focused reproduction had two failing tests: uncertain initialization returned 200 rather than 409, and refund processing returned 404. After implementation, 30 recovery regressions pass. Deterministic barriers cover concurrent administrators/workers, in-flight initialization, stale claims, and a webhook winning before dispatch. Fixtures cover timeouts, explicit rejections, verified failures/retries, mismatched evidence, Return adoption/completion/interrupted finalization, extra captures, cancelled orders, and operator authorization.

Commands from backend:

```text
npm test -- --runInBand --no-cache __tests__/api/wholesale.http.test.js -t recovery:
30 passed, 83 filtered out, 0 failed

npm test -- --runInBand --no-cache __tests__/api/wholesale.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/seller-marketing-retirement.http.test.js __tests__/services/return-compatibility.test.js
6 suites passed, 188 passed, 0 failed

npm test -- --runInBand --no-cache
55 suites passed, 580 passed, 7 existing skipped, 0 failed; 587 total

npm run build
Passed (syntax and disposable backend-only service-package check)
```

Razorpay order creation, order/payment/refund reads, refund history and refund POSTs were mocked. Database writes/indexes were confined to disposable MongoMemory replica sets. No live provider, staging/production, physical shipment or browser integration result is claimed. Frontend source was unchanged and frontend tests were not rerun. An accidental repository-root npm run build ran an up-to-date frontend npm install check and a successful Vite build (existing large-chunk warning); no manifest or lockfile diff resulted. Git diff --check passed with line-ending warnings only. No commit, reset, cleanup or deployment was performed.
