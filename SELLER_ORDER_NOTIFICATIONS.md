# Seller new-order notifications — implementation and verification

## Result and evidence boundaries

Clicking an order notification now opens the latest seller-authorized order in the existing Orders details modal. A portal-wide new-order alert appears on other seller pages and offers View order and Dismiss. Both behaviors were verified in headless Chrome against the real backend, Socket.IO and isolated MongoDB replica-set fixtures. The browser test explicitly observed a `new_order` WebSocket frame; it did not inject an application event or mock an API response.

The existing Firebase browser-push implementation has been repaired and retained. **Genuine background push delivery and operating-system notification click-through are not verified.** An opt-in attempt found the existing Firebase Admin credentials, complete web config and VAPID public key configured; permission was granted and the service worker activated, but the headless browser did not register a push subscription within 20 seconds. An earlier attempt returned browser DOMException code 20 during subscription. No browser token was registered and no real FCM notification was delivered to the fixture. These results do not establish whether a normal interactive deployed browser can subscribe. Service-worker display/click routing was separately exercised with a deterministic worker harness; that is not proof of real push delivery.

No `.env` files, checkout index migration, Atlas documents, production data or business policies were changed. No deployment was performed. Existing worktree changes were inspected and preserved. Graph tools were not available, so source inspection used normal searches after checking tool availability.

## Root causes

- The seller drawer transformed notification records without retaining their order reference; its click handler only marked a record read. It had no route/order-opening action and used a mouse-only clickable div.
- Orders details used component-local state, so notification handlers, deep links and other tabs could not select a detail. There was no seller-scoped single-order read endpoint; the seller list can omit the requested order because of channel/status filters or pagination.
- The existing `new_order` ring and shared `notification_new` toast were separate paths without a common authorized read/dedup flow. The Quick-only list fallback did not cover all seller pages/channels. Socket events could carry an entire shared order rather than seller-filtered items.
- Push initialization could request permission from mount/login effects; background display combined Firebase notification payload auto-display with manual `showNotification`, risking duplicate OS alerts. Click handling was installed after Firebase and accepted an unrestricted route, while seller order notifications pointed at the customer `/orders` route.

## Implemented behavior

`GET /api/sellers/orders/:id` reuses the list's approved-seller authorization and seller-specific response shaping. Its database filter includes both order ID and the authenticated seller's item ownership. Other-seller and nonexistent orders return the same 404; malformed IDs return 400. Shared orders expose only this seller's items/subtotal, the existing operational delivery address, latest status/payment status, delivery configuration and timeline. Full basket totals and another seller's item details remain private.

The seller context deduplicates simultaneous detail requests, checks the current token before applying responses, and uses a generation guard for navigation/unmount/account changes. Opening an order selects its server-returned channel and navigates to `/seller/orders?order=<opaque ObjectId>`. An optional `notification` reference is used only with the protected mark-read endpoint. Direct routes and refresh fetch the authorized record again. Missing/inaccessible references show a generic unavailable message. Status and fulfillment mutations refresh the selected detail. Existing acceptance, rejection, preparation, carrier selection and dispatch controls remain available; setup dialogs are not hidden underneath the details modal.

The notification drawer uses native buttons with hover/focus styles. Dismiss and image-preview controls are sibling buttons, not nested actions. A successful order open marks the existing notification read. Non-order notifications retain supported seller navigation, read actions and broadcast media preview. Shared read/unread handling refreshes authoritative counts and refetches the drawer when reopened, avoiding the prior double decrement/stale list behavior.

`SellerOrderAlerts` is mounted above all seller tabs only in the approved portal. It listens to existing `new_order`, `notification_new` and foreground FCM messages, treats payloads as references, and fetches authorized detail before displaying anything sensitive. Duplicate hints are coalesced. If that order is already open, the detail is updated instead of another alert. Pending alerts are queued; dismiss does not delete an order or notification. A seller-specific per-tab session history retains the last 500 presented order IDs across portal remounts/refreshes. A very high-volume session exceeding that retention can present an old pending order again; durable notification/order history remains authoritative.

On connection/reconnection, window focus and every 30 seconds, paginated unread ORDER_CREATED notifications and actual pending seller orders are reconciled across channels. The order fallback covers a process stopping after checkout commit but before notification persistence. Listeners, timers and foreground subscriptions are removed on unmount/account change. Token changes invalidate old detail responses and clear selected state; logout disconnects the seller socket and unregisters the device token. Existing server room joining derives the seller from the signed user identity and approval record, ignoring supplied seller IDs. Adversarial tests verify a forged room ID cannot receive another seller's order event.

Both ordinary and unified checkout continue to emit/notify only after successful commit. Their socket payloads now carry order references/channel/time rather than whole shared-order documents. `notifySeller` attaches a validated seller order link and seller ownership context. Same-key checkout replay does not issue a second new-order notification. Notification failures remain best effort and cannot fail a committed checkout. No transactional outbox, distributed push retry or new notification platform was introduced; FCM delivery is not guaranteed while offline indefinitely or when permission/subscription is unavailable.

## Browser push design and required setup

The existing Firebase/FCM stack is reused. No new VAPID key generator, Web Push server or external notification platform was added.

- The portal exposes **Enable order notifications**, the only path that requests permission. Mount/login effects only restore an already-granted subscription. Denial/unsupported/configuration failures are nonfatal; permission is never repeatedly prompted automatically.
- Token registration uses the authenticated existing notification-token endpoint. A late registration cannot persist against a newly switched session; device reassignment/removal retains existing server behavior. Pending initialization is not reported as successful registration. Token acquisition is bounded to 20 seconds with a retryable failure.
- Seller web ORDER_CREATED messages use data-only FCM payloads, a safe order/notification reference, `New Bulkimart Order`, a concise order summary and a stable Web Push topic. Duplicate device tokens are removed before sends. Native-app tokens retain notification payload behavior; unrelated broadcasts retain their supported media display.
- The service worker displays data-only messages with an order-specific tag and `renotify: false`; it leaves notification-payload auto-display to Firebase. Click handling is registered before Firebase imports. It validates same-origin routes/opaque IDs, prefers an existing seller tab, focuses/navigates it, or opens a new tab. The destination still fetches authorized details; URLs and OS notification text contain no customer address, phone, documents or credentials.
- Foreground FCM and Socket.IO share the in-app dedup path. Push click routing handles Firebase's SDK-wrapped notification data as well as data-only notifications.

These worker choices follow [Firebase's receive-message guidance](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), including installing a custom click handler before Firebase imports.

Required existing frontend build settings: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_VAPID_KEY` (public Web Push certificate key). Required backend settings: `FCM_MODE=live`, `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT`, and matching `FIREBASE_PROJECT_ID` where required by runtime validation. Keep private service-account keys backend-only; no values are included here.

Before claiming real push readiness, verify in an interactive supported browser on HTTPS (localhost is allowed for development):

1. Deploy the built worker and `/notification-routing.js` at the site root, with valid JavaScript content types and permitted Firebase CDN/network access. Verify matching Firebase projects, enabled FCM registration APIs and the VAPID public key; configure allowed web origins/API-key restrictions for the actual environment.
2. Sign in as an isolated approved seller and click Enable order notifications. Confirm the worker is active, the browser subscription completes, and the authenticated token endpoint succeeds. Do not print the token.
3. Keep the app tab backgrounded; create one staging test order. Confirm one OS notification arrives and clicking it focuses an existing tab and opens the correct fresh details. Repeat with no open app tab. Repeat denied permission, logout/account switching and reconnect cases.
4. Investigate browser subscription abort/network errors in DevTools if registration fails. The available headless session did not provide a usable subscription; a real push or native click must not be claimed from its in-app test result.

No deployment was authorized or performed by this task. Without a valid browser subscription/permission, only persisted notification history, sockets and HTTP reconciliation operate.

## Files changed

| Area | Paths and purpose |
| --- | --- |
| Backend order detail | `backend/controllers/seller.controller.js`, `backend/routes/seller.routes.js`: validated, owner-filtered single-order reads using existing response shaping |
| Backend notifications | `backend/controllers/notification.controller.js`: bounded event filtering for reconciliation; `backend/models/Notification.js`: seller metadata; `backend/services/notification.service.js`: seller deep links, web/app token groups, safe logs and deduplication |
| Backend transport payload | `backend/controllers/order.controller.js`: minimize post-commit socket payloads; `backend/services/fcm.service.js`: seller web data-only payload/topic without changing native-app notification format |
| Seller state and UI | `forntend/src/modules/Seller/context/SellerContext.jsx`: fresh details, deep links, session guards; `components/OrdersTab.jsx`: reuse details/actions; `components/NotificationDrawer.jsx`: accessible clickable notifications; `components/SellerOrderAlerts.jsx` (new): portal-wide reconciled alerts; `pages/DashboardPage.jsx`: integration and permission control; `Seller.css`: responsive notification styles |
| Shared frontend | `forntend/src/components/NotificationPopup.jsx`: avoid duplicate seller order toast and retain notification-aware navigation; `forntend/src/utils/useNotifications.js`: correct read counts/reopening; `forntend/src/utils/firebaseMessaging.js`: explicit permission, session-safe registration, retry/timeout handling |
| Worker | `forntend/public/firebase-messaging-sw.js`, `forntend/public/notification-routing.js` (new): nonduplicated display and validated existing/new-tab navigation |
| Backend regression tests | `backend/__tests__/api/seller-first-checkout.http.test.js`, `backend/__tests__/api/socket-transport.http.test.js`, `backend/__tests__/api/retired-notifications.http.test.js`, `backend/__tests__/services/fcm.service.test.js`, `backend/__tests__/services/notification-push.test.js` |
| Frontend regression tests | `forntend/scripts/seller-notifications.test.mjs` (new), `forntend/package.json` (`test:seller-notifications`) |
| Browser verification | `backend/scripts/verifySellerNotificationsBrowser.mjs` (new): isolated normal backend/replica set and disposable production frontend build with both HTTP/socket origins pinned to the fixture; sanitized results in ignored `test-artifacts/seller-notifications/` |
| Test retention/docs | `.gitignore`, `backend/.gitignore`: retain relevant existing/new tests; `SELLER_ORDER_NOTIFICATIONS.md`: this report |

The three previously ignored notification test files already existed locally. Their original tests were preserved, regressions added, and explicit ignore exceptions retain them in the deliverable. No repository reset, database cleanup, migration, environment overwrite, payment change or deployment occurred.

## Verification actually run

| Command / scope | Result |
| --- | --- |
| `cd backend; npm test -- --runInBand __tests__/api/seller-first-checkout.http.test.js __tests__/api/socket-transport.http.test.js` | 2 suites, 45 passed, 0 failed |
| `cd backend; npm test -- --runInBand __tests__/services/notification-push.test.js __tests__/services/fcm.service.test.js __tests__/api/retired-notifications.http.test.js` | 3 suites, 11 passed, 0 failed |
| `cd backend; npm test -- --runInBand` | 50 suites passed; 408 passed, 7 skipped, 0 failed (415 total) |
| `cd forntend; npm run test:seller-notifications` | 11 passed, 0 failed |
| `cd forntend; node --test --test-concurrency=1 scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs scripts/socket-ui.test.mjs scripts/seller-notifications.test.mjs` | 89 passed, 0 failed, 0 skipped |
| Backend `npm run build`; worker/routing/browser-script `node --check` | Passed |
| Frontend `npm run build` | Passed; existing main-bundle size warning (~1.70 MB) |
| `git diff --check` | Passed; Windows line-ending advisories only |
| `cd backend; node scripts/verifySellerNotificationsBrowser.mjs` | Passed in real headless Chrome, genuine socket frame and authorized HTTP/database operations |
| Same browser command with `--push-smoke` | In-app/socket/detail checks passed; permission granted and worker active, but push subscription unavailable/incomplete, so actual push delivery/native click NOT passed |

Backend tests include seller A/B isolation, malformed IDs, fresh status/payment detail, seller-specific item filtering, failed/rolled-back checkout with no seller notification, one notification on same-key replay, multivendor recipients, post-commit notification failure without failed checkout, forged socket room denial, token dedup/web-vs-app payloads, and existing seller/delivery/payment workflows. Frontend tests cover popup off Orders, duplicates/reconnects, missed persisted-notification fallback, dismissal across remount, already-open refresh, listener cleanup, drawer actions, direct links/channel selection, account-switch stale response denial, permission denial and worker display/click routing. The worker test runs its actual script with a controlled environment; it is not a delivered OS push.

An initial backend regression run caught a missing Mongoose import in the new ID validator. It was fixed before the passing results above. The seven skipped tests were not executed. Neither package defines a lint/typecheck script. Android/iOS physical devices, deployed proxies, native OS push clicks and live delivery providers were not tested.
