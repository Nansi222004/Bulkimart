# Pending-payment refresh recovery

Local fix for acceptance finding A01, 17 October 2026 (Asia/Calcutta). No commit, push, deployment, production restart, production data or real payment credentials were used. The pre-existing audit report and audit runners were preserved.

## Root cause and change

The frontend cleared its submission session immediately after order creation. Payment initialization happened afterwards, and its feedback lived only in component state. Refresh lost that state, and the correctly cleared server cart triggered the empty-cart view.

The frontend now saves a separate committed-checkout locator before clearing the submission session for physical single/grouped online checkout. Checkout gives this locator priority over both the normal confirmation and empty-cart views. The review queries the existing owner-authorized APIs and displays pending verification, processing, confirmed payment, conclusive failure, or temporarily unavailable status. It never places orders, generates checkout keys, initializes payments, restores carts or changes financial policy.

Implementation files:

| File | Change |
| --- | --- |
| `forntend/src/utils/committedCheckout.js` | Customer-scoped durable locator collection and explicit resolved-state predicate. |
| `forntend/src/modules/User/context/UserContext.jsx` | Persist online locators before clearing submission keys; reject obsolete customer-session responses before and after background refresh. COD/wallet do not create online recovery locators. |
| `forntend/src/modules/User/pages/CheckoutPage.jsx` | Restore committed review before empty-cart rendering and block another checkout while review exists. |
| `forntend/src/modules/User/components/CommittedCheckoutReview.jsx` | Existing cart/profile layout and controls, bounded status checks, cancellation, stale-session/generation guards, duplicate-click guard, orders link and explicit terminal acknowledgement. Dismissal also clears the old component confirmation state and returns to shopping, preventing an earlier in-memory pending message from reappearing. |
| `forntend/scripts/checkout-ui.test.mjs` | Real provider-hook persistence checks for single/grouped online/COD/wallet; empty-cart precedence and customer switching. |
| `forntend/scripts/committed-checkout-ui.test.mjs` | Recovery lifecycle, ownership isolation, malformed/missing/expired lookup, status errors/deadlines, terminal states, duplicate checks and stale-response tests. |
| `backend/scripts/verifyPendingPaymentRecoveryBrowser.mjs` | New disposable real frontend/backend Chrome regression derived from the existing audited harness. Uses local SDK mocks and existing authenticated reconciliation. |
| `backend/scripts/verifyPendingPaymentRecoveryMatrix.mjs` | Executes all 14 cases sequentially in separate Node/backend/replica-set/Chrome fixtures; aggregates raw case evidence and checks exactly one browser initialization request per case. |
| `PENDING_PAYMENT_RECOVERY_FIX.md` | Implementation, lifecycle, regression results, state counts and limits. |

No backend application/controller/service, model, authorization, stock, cancellation, settlement or refund logic changed. Graph MCP tools were unavailable; targeted source inspection was used after checking tool metadata.

## Reference contract and lifecycle

`localStorage['bulkimart:committed-checkout:<customerId>']` contains a list of `{version:1, customerId, operation, key}`. It contains no token, address, price, payment status, provider identifier or payment secret. Multiple unresolved attempts are retained rather than overwritten. The key is the original checkout idempotency key, and operation is the original server `single` or `unified` operation. Basket/Wholesale UI namespaces map to `unified` on the server.

This collection is separate from `sessionStorage['bulkimart:checkout:…']`, the existing in-flight submission journal. It is written synchronously after a valid committed response and before that submission journal is cleared or payment is initialized. If durable writing fails, the existing submission key is retained and the response follows uncertain-checkout recovery; payment is not automatically initialized by that failed path.

The durable collection survives refresh, tab session loss, navigation and browser reopening where localStorage remains available. It is isolated by authenticated customer ID on logout/switching; it is not deleted on logout, so the original owner can resume after signing in again. Another customer never selects that owner's namespace. A copied locator still cannot bypass server ownership checks. Late network responses are ignored after session changes or unmount.

The review uses these existing APIs, with the customer's current authentication:

1. `POST /api/orders/checkout-status`, original `Idempotency-Key` and `{operation}`. Its owner-scoped completed result yields minimal order references. It is read-only and does not rotate keys.
2. `GET /api/payments/:orderId/status`, only using an order returned by step 1. It verifies ownership and uses the existing payment-status reconciliation behavior; it returns authoritative `method`, `status`, `amount` and `reconciliationRequired`.

The review uses `boundedFetch`'s existing 10-second deadline for each request, aborts on unmount and rejects obsolete responses. There is no automatic polling or initialization. Check Status/Retry Status Check repeats only status requests. A failure, `not_found`, unavailable result or unresolved attempt preserves the locator and shows a retry/My Orders path; it never proves payment failure or permits checkout resubmission.

Locators have no arbitrary time-based expiration. An old key that the server cannot confirm stays in support/retry review instead of silently dropping an unresolved obligation. No order or Payment snapshot is restored from storage.

Deletion requires a successful owner-verified result with no reconciliation required and a resolved status (`paid`, `failed`, `refunded`, `partial_refund`; or an authoritatively non-online payment). The customer must then explicitly acknowledge the rendered final review using Done. Failed status checks, component unmount, timeout, navigation, View My Orders and ambiguous provider results never delete the locator. Refreshing a terminal result before acknowledgement displays that result again.

## Browser regression

All browser calls use a disposable MongoDB replica set, random loopback ports and built frontend with real application HTTP routes. The Razorpay SDK is overridden before backend route import. Its only creation call records a local provider order, waits six seconds and throws a simulated uncertain result. No provider network request occurs.

Each final matrix case starts in a fresh Node process, backend, MongoDB replica set, customer dataset and Chrome profile, with an empty basket and fixture stocks of 100, adds via product UI, submits online once, and waits for real committed Orders/Payment plus an initializing attempt. It refreshes while initialization is still pending, checks the review, waits for `creation_unknown`, repeats status checks, navigates My Orders/Back/Forward, replays the original completed checkout, and verifies blocked reinitialization.

Mocked provider evidence is then made available to the existing admin-only `POST /api/admin/payment-recovery/:paymentId/attempt/reconcile` using a disposable fixture admin. The existing recovery service verifies receipt/order/amount/currency and settles payment. Single-channel cases resolve to failed; mixed cases resolve to captured. The browser checks and refreshes the final result, explicitly dismisses it, and verifies the normal empty-cart state. Captured cases also deliver a duplicate signed mock webhook without another capture or stock change.

The three-channel cases at both widths additionally test a genuine status-request deadline, HTTP 503, sessionStorage loss, logout/account switching, and an original owner's key copied into another user's locator namespace. Failed checks preserve the review and all financial state; the copied locator exposes no original order reference.

| Combination | 390px | 1280px | Authoritative mocked final outcome |
| --- | --- | --- | --- |
| Quick Commerce | Pass | Pass | Failed |
| E-Commerce | Pass | Pass | Failed |
| Wholesale | Pass | Pass | Failed |
| Quick + E-Commerce | Pass | Pass | Paid |
| Quick + Wholesale | Pass | Pass | Paid |
| E-Commerce + Wholesale | Pass | Pass | Paid |
| All three | Pass | Pass | Paid |

The final matrix writes its results to [`browser-isolated-matrix.json`](test-artifacts/pending-payment-recovery/browser-isolated-matrix.json), with raw `isolated/<channels>-<width>/browser.json` for each case. The two triple cases additionally exercise timeout/503, sessionStorage loss, account switching and copied locators. The status 503 and request delay are intentional Chrome transport-proxy fault injections; all successful cart/order/recovery/status responses come from the real local application. Provider behavior is mocked at the SDK boundary.

## Financial evidence

Expected before/after invariant per scenario: orders = selected vendor/fulfilment group count; Payments = 1; initialization calls = 1; journal attempts = 1; captures = 0 throughout uncertainty; purchased cart items = 0. After authoritative captured settlement, captures = 1; after confirmed failure, captures = 0. Orders, Payment, initialization count, cart clearing and stock remain unchanged across status checking and final settlement.

Fixture deductions are Q: 100 → 98 (2 × ₹75); E: 100 → 99 (1 × ₹100); W: 100 → 90 (10 × ₹95). Distinct vendors produce 1 order for singles, 2 for pairs, 3 for triple; each case shares one Payment. The browser evidence records actual snapshots before refresh, after uncertain recovery and after authoritative resolution, including individual variant stocks and provider-call counts. All 14 before/after uncertainty snapshots match exactly. There are 24 fixture orders and 14 fixture Payments across the independent reset scenarios; 8 paid mixed cases have one capture each, and 6 failed single-channel cases have none. Each scenario retains exactly one provider initialization call and one journal attempt throughout.

| Combination | Orders before → after recovery | Payments | Attempts / init calls | Variant stocks after commit and recovery | Captures uncertain → resolved |
| --- | --- | --- | --- | --- | --- |
| Q | 1 → 1 | 1 → 1 | 1 / 1 | Q 98 | 0 → 0 (failed) |
| E | 1 → 1 | 1 → 1 | 1 / 1 | E 99 | 0 → 0 (failed) |
| W | 1 → 1 | 1 → 1 | 1 / 1 | W 90 | 0 → 0 (failed) |
| Q + E | 2 → 2 | 1 → 1 | 1 / 1 | Q 98, E 99 | 0 → 1 (paid) |
| Q + W | 2 → 2 | 1 → 1 | 1 / 1 | Q 98, W 90 | 0 → 1 (paid) |
| E + W | 2 → 2 | 1 → 1 | 1 / 1 | E 99, W 90 | 0 → 1 (paid) |
| Q + E + W | 3 → 3 | 1 → 1 | 1 / 1 | Q 98, E 99, W 90 | 0 → 1 (paid) |

These values match at both widths; purchased cart line count remains zero. Provider-verified capture is the only added financial event on the paid path, and duplicate webhook delivery leaves all counts unchanged.

## Verification commands and artifacts

From `forntend`:

```powershell
node --test --test-concurrency=1 scripts/committed-checkout-ui.test.mjs scripts/checkout-ui.test.mjs scripts/unified-basket-ui.test.mjs scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/portal-startup.test.mjs
npm run build
```

Final frontend test execution: **149 passed, zero failed/skipped** (`frontend-final.log`). Includes the existing digital, benefits, order recovery, retail/Wholesale product and navigation regressions. Initial fixture-token omission and intermediate Vite module-identity invalidation failures were corrected/retested; the final command passed. Logs are retained rather than presenting those initial runs as passes.

From root / backend:

```powershell
node backend/scripts/verifyIsolatedTests.mjs
# Includes relevant checkout, payment, Razorpay, Wholesale, wallet and financial regressions.
node backend/scripts/verifyUnifiedBasketBrowser.mjs
node backend/scripts/verifyPendingPaymentRecoveryMatrix.mjs
# Initial matrix: 13 passed, one DevTools catalog-loading timeout; exit 1.
node backend/scripts/verifyPendingPaymentRecoveryBrowser.mjs --channels=grocery+wholesale --width=390
# Focused fresh-fixture retest: passed; exit 0.
# From backend:
npm run build
# From root:
git -c core.safecrlf=false diff --check
git diff --check
```

The existing unified-basket browser runner passed at both widths, including mixed COD confirmation. The final aggregate contains **14/14 verified passing cases**, including the explicitly recorded focused retest after a DevTools timeout in the initial matrix. Every case made exactly one browser order-submission request and one browser payment-initialization request. The deliberate original-key API replay and blocked initialization probe did not create another order, Payment, attempt, capture or stock deduction. Result: `browser-isolated-matrix.json`; counters and artifact integrity are also validated in `execution-summary.json`. Backend build and the final frontend build passed; both plain and normalized `git diff --check` passed. The existing Vite large-chunk warning remains. The clean final isolated backend run passed: **58 suites, 737 passed tests, 7 existing skipped tests, zero failed suites/tests or timeouts**. This includes the 32 prior acceptance-audit cases now discovered by the runner. `backend-final.json` and `backend-final.log` contain the final result; `backend-first.json` preserves the earlier failed run. The 7 skips remain the existing retired seller-payment/PhonePe coverage, not newly verified payment cases. An initial backend run timed out in the prior audit-only suite under concurrent verification; it is retained as a failed run, not a full-suite pass. Earlier recovery browser executions encountered DevTools navigation timeouts. A subsequent concurrent retest also exposed a harness observation race: the initializing journal can be visible just before the SDK mock records its call. The final harness waits for both the initializing journal and that first recorded SDK call. These earlier executions are not final passes; their logs remain in the evidence directory. A subsequent shared-browser execution also hit a DevTools screenshot timeout after eight passing cases. The final matrix therefore runs every case in its own process/browser/backend/replica set and writes separate `isolated/` artifacts. Its initial execution passed 13 cases and timed out in DevTools during mobile Quick + Wholesale catalog loading, before checkout. That one case was rerun separately with the same assertions and passed (exit 0). `browser-isolated-initial.json` and the initial-failure log preserve the failed execution; the final aggregate explicitly marks the retested case and does not claim the initial matrix command exited successfully. All 14 cases have executed passing assertions against the final application code.

Artifacts: [`test-artifacts/pending-payment-recovery/`](test-artifacts/pending-payment-recovery/). Final logs: `frontend-final.log`, `frontend-build-final.log`, `backend-build.log`, `unified-browser.log`, `browser-isolated-matrix.log`. Browser screenshots are named `isolated/<channels>-<width>/pending-<channels>-<width>.png` and `isolated/<channels>-<width>/resolved-<status>-<channels>-<width>.png`. HTTP metadata contains method/path/status/timing, without tokens or personal/payment payloads. Fixture screenshots contain synthetic data only. Inspected examples: [pending review at 390px](test-artifacts/pending-payment-recovery/isolated/grocery-ecommerce-wholesale-390/pending-grocery-ecommerce-wholesale-390.png), [payment confirmed at 1280px](test-artifacts/pending-payment-recovery/isolated/grocery-ecommerce-wholesale-1280/resolved-paid-grocery-ecommerce-wholesale-1280.png), [confirmed failure at 390px](test-artifacts/pending-payment-recovery/isolated/wholesale-390/resolved-failed-wholesale-390.png).

## Limits

This verifies local application behavior with mocked provider evidence, not live payment capture, widget behavior, refunds, freight, notifications or production infrastructure. LocalStorage recovery depends on browser storage retention; cleared/private storage cannot recover a locator that no longer exists. The existing submission-recovery contract handles uncertain order responses. This change targets the seven physical basket combinations; the separate digital checkout's policy and implementation remain unchanged and its existing regressions pass. No staging readiness or deployment approval is claimed.
