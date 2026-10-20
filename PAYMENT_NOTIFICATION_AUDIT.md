# Payment-gated notifications and overlay audit

Date: 2026-10-21. Local implementation and isolated verification only.
Production has not been deployed or payment-tested from this workspace.

## Confirmed causes

1. `order.controller.js` published seller `new_order` and `ORDER_CREATED`
   immediately after both single and unified checkout committed. It did not
   check the linked Payment. Consequently an online order with pending payment
   reached seller sockets, persistent notifications, badges and FCM.
2. `payment.controller.js` correctly used signed verification/webhooks and
   server-side gateway status, but successful settlement had no corresponding
   seller publication boundary. Removing the creation-time sends alone would
   lose the seller notification after payment.
3. `sellerOrderActions` advertised acceptance without payment readiness, even
   though the status endpoint already rejected unpaid acceptance. Seller pending
   queries/counts and popup reconciliation included unpaid placed orders.
4. Checkout durably saves a recovery locator as soon as an order exists. Its
   render branch mounted `CommittedCheckoutReview` before the in-flight payment
   promise completed. That explains the review/status page behind Razorpay.
   The SDK's own dimmed underlying page and secure sheet are expected provider
   behavior; no Razorpay iframe/backdrop CSS is overridden.
5. The seller alert used `role=dialog` on a fixed aside without a backdrop,
   background lock or focus management. It bypassed the existing shared modal
   layer. This explains the unbacked card over a fully interactive dashboard.
6. The shared seller helper coerced every order-linked notification into a
   marketplace-order URL. Packaging-payment events could therefore point to
   `/seller/orders/<packaging-id>`. Some existing packaging callers pass a seller
   object; the helper now resolves its actual `_id`.

## Implemented lifecycle

- Persisting a pending online order is still allowed. Customer notification text
  says payment is pending, rather than implying the store received paid work.
- Seller eligibility is authoritative: placed physical order; COD or a linked
  Payment with status=paid; approved seller with an active seller User account.
  No browser success boolean can satisfy this condition.
- Single/unified checkout call one publisher. Pending online orders return
  without seller publication. COD and paid wallet orders retain their workflow.
- The common payment settlement path calls that publisher **after** its database
  transaction commits. Browser verification, signed webhooks and status recovery
  therefore converge on the same publication path. Replay paths also reconcile.
- Notification has an optional `dedupeKey` and a unique partial index. A seller
  event key is `seller-order-ready:<orderId>:<sellerId>`. Only the insert winner
  fans out the notification/new_order hint. Duplicate races cannot create another
  logical seller event. Existing rows are retained; no historical data is deleted.
- A bounded, non-overlapping round-robin sweep revisits placed orders using the
  existing order worker. This recovers a crash after the order/payment commit but
  before notification persistence. Reconciliation is scoped to eligible state.
- Seller pending-order queries/counts exclude unpaid work before pagination.
  Other order views can still show persisted pending orders as read-only.
  Admin/customer monitoring continues to show actual persisted payment state.
- Seller status mutations, fulfillment setup, rider broadcast/poll/claim and
  manual admin assignment reject unpaid non-COD work. Existing accepted delivery
  completion, refunds, inventory, wallet, Coins and payment accounting are preserved.
- The seller popup checks fresh authorized order details and payment state.
  Its seen-order cache is versioned so old unpaid popups cannot suppress the
  first eligible paid alert after upgrading.
  Old premature notification rows are excluded from seller history/unread counts
  while their order remains unpaid, without deleting them. This is a compatibility
  guard in addition to fixing the original publishers.
- Checkout shows a neutral payment-in-progress view while the provider operates;
  it does not mount recovery/status polling underneath the active payment window.
  Durable recovery remains after cancellation/failure/refresh, protecting against
  duplicate order placement.
- Razorpay terminal callbacks close the SDK window through its supported API,
  rather than changing the secure interface. Dismissal during verification cannot
  override a trusted paid result. Duplicate handlers are ignored; verification
  uses the existing bounded fetch with no automatic payment retry.
- Seller alerts use ModalPortal: body portal, existing layer ordering, viewport
  sizing, focus trapping/restoration, inert application background, shared scroll
  lock, Escape/backdrop/close dismissal, and mobile bottom positioning.

## Delivery guarantees and audit limits

One logical seller ORDER_CREATED record is guaranteed by the unique database
key. Socket and FCM transports remain best effort; this is not a claim of
exactly-once device delivery. A crash after persisting a notification but before
network delivery can lose that particular push. The persistent record and seller
order/unread reconciliation retain the work; this change does not add a new
external transport outbox or promise provider acknowledgements.

Historical notifications or device pushes emitted by an older build cannot be
retracted. A newly eligible paid order can receive a corrected alert after an old
premature one. The compatibility filter and authorized popup guard prevent pending
work from being presented as actionable by the updated app.

The complete event/source/recipient/channel/prerequisite/dedup/test-reference
inventory is in [NOTIFICATION_EVENT_INVENTORY.md](NOTIFICATION_EVENT_INVENTORY.md).
Additional findings:

- Admin notifications are DB + Socket only. Admin has no existing User device-token
  lifecycle; no new admin FCM mechanism was invented.
- Admin order monitoring retains unpaid orders for investigation. The seller's
  pre-existing revenue KPI is order-line volume, not a cash-settlement report;
  it was not converted into new wallet/escrow accounting by this notification fix.
- Seller acceptance/preparation/shipping reports use the existing customer status
  event. Ready-for-pickup is an operational fulfillment flag, not a separately
  implemented push event. Manual admin assignment currently notifies the assigned
  rider; broader recipient policies were not invented. Reassignment retains its
  existing eligibility/assignment rules, now with the additional payment guard.
- SHG support notifications resolve the requester's User account. No separate
  SHG push service was found.
- Web seller order pushes already use data-only FCM with per-order topic/tagging;
  service-worker display and foreground socket/push hints converge on order-ID
  deduplication and an authorized detail read. Native app platform tokens keep
  the existing FCM notification behavior.
- Non-order support, returns, reverse pickup, refund, packaging, payout and admin
  broadcast flows remain in the existing central service. They retain their
  current business guards and best-effort transport behavior; they were not all
  converted into a new durable event system.
- Broadcast retries use a claim and already-sent recipient records. Refund/wallet
  writes use the existing settlement/ledger idempotency. Payout completion and some
  review transitions still use their existing read/change/save pattern rather than
  a global exactly-once event guarantee. Their monetary logic was not rewritten.
- Metadata has a strict schema and does not persist every ad-hoc field (for example
  payoutId/returnId), although live push payloads retain the supplied data. Existing
  portal routes remain available. A metadata migration is a separate compatibility
  task; this work does not invent new persisted business fields for those events.
- There are no dedicated marketplace payment-pending/success/failure/cancellation,
  exchange, general wallet-topup or courier-webhook push events to enable. Declared
  coin/campaign constants with no active publisher are marked as such in the inventory.
  No retired programs were reactivated and no new notification promises were added.

## Files changed

| File | Purpose |
| --- | --- |
| backend/services/orderPaymentEligibility.service.js | Shared COD/paid-payment predicate and aggregation stages |
| backend/services/sellerOrderNotification.service.js | Authoritative seller publisher, unique key/index, payment replay and bounded recovery sweep |
| backend/models/Notification.js | Optional dedupeKey plus unique partial index; existing rows unchanged |
| backend/services/notification.service.js | Suppress duplicate fan-out; preserve seller-specific routes and normalize seller identity |
| backend/controllers/order.controller.js | Replace unconditional seller sends in both checkouts; honest pending-payment customer message |
| backend/controllers/payment.controller.js | Publish after trusted settlement/commit and reconcile duplicate verified signals |
| backend/services/orderSweeper.service.js | Schedule missed-notification recovery with the existing worker |
| backend/services/sellerOrderActions.service.js | No actionable seller transitions for unpaid non-COD orders |
| backend/controllers/seller.controller.js | Payment-safe pending queries/counts and processing guard |
| backend/controllers/notification.controller.js | Keep legacy unpaid seller alerts out of actionable history/badges |
| backend/controllers/fulfillment.controller.js | Reuse shared payment readiness policy |
| backend/controllers/deliveryPartner.controller.js | Gate rider broadcasts, pending offers and acceptance |
| backend/controllers/deliveryAssignment.controller.js | Gate admin assignment and actionable assignment queue |
| backend/scripts/ensureNotificationDedupeIndex.mjs | Explicit safe index preparation; no document deletion or financial writes |
| backend/verification/payment-notifications.test.js | Isolated MongoDB replica-set + real JWT/checkout/settlement/notification integration regressions |
| backend/package.json | Runnable payment-notification test command |
| forntend/src/modules/User/pages/CheckoutPage.jsx | Keep recovery unmounted while payment is active |
| forntend/src/modules/User/components/CartCheckout.css | Neutral scoped in-progress view |
| forntend/src/utils/razorpayCheckout.js | Terminal SDK close, dismissal/verification race guard, bounded verification |
| forntend/src/modules/Seller/components/SellerOrderAlerts.jsx | Fresh payment gate and shared accessible modal layer |
| forntend/src/modules/Seller/Seller.css | Scoped modal backdrop/card controls and responsive placement |
| forntend/verification/componentHarness.mjs | Portable controlled component test harness; no live API/socket |
| forntend/verification/payment-ui.test.mjs | Checkout background and unpaid/paid seller popup regressions |
| forntend/verification/razorpay-overlay.test.mjs | SDK lifecycle, dismissal race and verification-failure regressions |
| forntend/package.json | Runnable overlay regression command |
| NOTIFICATION_EVENT_INVENTORY.md, PAYMENT_NOTIFICATION_AUDIT.md | Event inventory, findings, verification and rollout record |

Existing ignored local QA fixtures were also updated for current isolated
Shiprocket configuration, payment-gated actions and modal browser checks.

## Verification

All gateway secrets, signatures, users, orders and device tokens in automated
tests are synthetic. Tests use a disposable MongoDB replica set and cryptographic
signature verification; provider status reads and FCM/socket transports are mocked.
No production database or live capture was used.

Commands:

```bash
npm run test:payment-notifications --prefix backend
npm run test:fcm-auth --prefix backend
npm run test:payment-overlays --prefix forntend
npm run build --prefix backend
npm run build --prefix forntend
git diff --check
```

The broader local suites include seller-first-checkout, Razorpay webhook,
seller lifecycle, delivery location/OTP, retired notification visibility,
seller actions, notification push, FCM and frontend checkout/seller/modal layers.
Final counts are recorded below after the final verification run.

| Check | Final result |
| --- | --- |
| Backend verification (JWT/FCM + deployment audit + payment notification integration) | 48 passed |
| Existing backend checkout/webhook/seller/delivery/notification/FCM regressions | 119 passed |
| Existing frontend checkout/seller/modal suites plus Razorpay lifecycle tests | 70 passed |
| Portable committed overlay regression command | 6 passed (overlaps the UI scenarios above) |
| Browser seller alert checks at 320, 390, 768, 1440px | 4 passed |
| Backend build, frontend production build, changed JS syntax, git diff --check | Passed |
| Lint | Neither package defines a lint script |
| Live production lifecycle / OS pushes / app WebView | Not performed |

An initial broader run found a stale Shiprocket test fixture with no explicit
isolated mode and an old unpaid-action expectation. The fixture now declares
mock mode and the expected actions match the payment gate; the complete 119-test
run passed afterwards. Browser setup/capture issues were also corrected before
the final four-width run passed. No remaining failures in the executed checks.

Browser checks use synthetic API data at 320, 390, 768 and 1440px. They assert
card bounds, body scroll locking, root inertness and backdrop dismissal. Actual
Razorpay mobile UI, OS notifications and real app WebViews still require the
production/staging acceptance run. No lint command is defined by either package;
changed JavaScript is syntax-checked and both production builds are run.

## Deployment and production acceptance

Server access, a verified deployed revision and authorized test accounts are not
available in this workspace. The public health route exposes only a generic
message, not a release identifier. It cannot prove the new logic is deployed.

After committing/delivering this release through the normal workflow, run on the
actual backend host as the PM2 owner (from its verified repo checkout):

```bash
git status --short
git pull --ff-only origin main
git rev-parse HEAD
npm ci --prefix backend
npm run build --prefix backend
node backend/scripts/ensureNotificationDedupeIndex.mjs
node backend/scripts/auditJwtDeployment.mjs
read -r -p 'Verified backend PM2 process name: ' PM2_PROCESS_NAME
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
pm2 restart "$PM2_PROCESS_NAME" --update-env
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
```

Match the server SHA to the intended release and verify every load-balanced host.
Do not guess a process name. If hosting is not PM2-managed, use its existing
deployment/restart workflow. Preserve JWT and payment credentials. Ensure the
notification index succeeds before acceptance. Index preparation disables other
automatic index changes and does not purge old records. Check database index
permissions if it fails; do not remove the uniqueness requirement.

Build and publish `forntend/dist` through the existing static-site workflow:

```bash
npm ci --prefix forntend
npm run build --prefix forntend
```

Use separate accounts/sessions for customer, seller and rider. Run Razorpay test
mode and signed test webhooks only on authorized isolated staging/test data, with
production-runtime staging safeguards configured. Do not change live production
keys to test keys or mark a production payment paid directly in the database.
An approved real production smoke transaction requires normal capture/refund
authorization and is not performed here.

Acceptance cases:

| Case | Expected persisted state and notifications |
| --- | --- |
| Online pending | Order saved, Payment pending; customer pending notice only; no seller ORDER_CREATED/new_order/FCM, no actionable pending count or rider offer |
| Online verified | Valid signature + trusted gateway capture; Payment paid, vendor decision still pending; exactly one seller record/event per store; authorized popup opens |
| Webhook first / browser first / repeated webhook | Same paid state, one seller logical event; no duplicate orders, capture settlement, wallet or stock effects |
| Online failed/cancelled | Existing pending/failed/retry/expiry policy; no paid-order seller event or new assignment; recovery remains available |
| COD | Normal validated checkout publishes once without requiring online payment; seller processing and rider flow remain available |
| Overlay | No recovery page underneath an active payment; normal SDK secure sheet/backdrop; seller dialog locks background, focuses controls, dismisses via close/Escape/backdrop and restores focus/scroll |

For each case record only request IDs, order references, payment/order states,
recipient channel results and release SHA. Do not record raw JWTs, FCM tokens,
OTP values, gateway signatures or credentials. Check admin monitoring against
the same persisted state. Confirm actual customer/seller/rider device pushes,
badge counts, notification routing, disconnect/reconnect and app backgrounding.

Production remains **unverified** until these checks pass on the deployed release.
