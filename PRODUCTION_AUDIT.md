# Bulkimart production investigation — 2026-10-15

Follow-up: the subsequently supplied `CHECKOUT_DATA_CONFLICT` was traced to two legacy unique indexes using read-only configured-database inspection and isolated replica-set reproduction. See [CHECKOUT_DATA_CONFLICT.md](CHECKOUT_DATA_CONFLICT.md) for the confirmed failure stages, transaction/recovery tests and still-required approved remote index migration. The earlier evidence boundaries below describe the original investigation.

## Outcome and evidence boundaries

Local fixes address confirmed seller-drawer/control sizing, public-page startup blocking, socket client lifecycle/configuration, and misleading order-conflict classification/recovery. The exact production order 409 and intermittent socket 400 remain unconfirmed: the supplied console trace has statuses and a bundle name, but no response JSON or corresponding server logs. No  authenticated production checkout, production order lookup, payment, database write or deployment was performed. The worktree was clean at the start; earlier committed feature work was retained.

The code-review-graph tools were not exposed in this session; ordinary source inspection was used after checking tool availability. Hostinger account, proxy configuration, process topology and server logs were not available. Browser checks used installed headless Chrome; no real Android or iOS device was connected.

## 1. Mobile layout

Confirmed findings:

- Both local and deployed HTML already declare `width=device-width, initial-scale=1.0`, with pinch zoom enabled.
- A local browser baseline at 320/440/1280 px reproduced an open mobile seller drawer/backdrop on every authenticated dashboard/order/product visit. `DashboardPage` initialized `isSidebarCollapsed` to false regardless of width. The drawer covered most of a phone screen. This is a confirmed obstruction, not proof of the reported extreme Android enlargement.
- Seller order search measured 13 px; product search/selects measured 12–13 px. The seller login control already measured 16 px. Small editable controls are an iOS focus-zoom risk.
- Baseline seller pages had scale 1 and no document overflow. No CSS zoom/transform defect causing extreme enlargement was reproduced.

Changes: mobile seller navigation starts closed while desktop retains its expanded sidebar; seller width follows its parent; mobile editable controls use 16 px; mobile grid tracks permit shrinking; headings may wrap; the seller container reserves safe-area insets. No root overflow hiding or zoom prohibition was introduced. Existing table/carousel scrolling remains available.

Local seller checks passed for login, dashboard, orders and products at 320, 360, 375, 390, 412, 440, 768, 1280 and 1440 px (36 checks). The customer run covers the same widths, including checkout, login/registration/OTP, cart and search; shortened layout viewports approximate keyboard space. They do not emulate actual iOS focus zoom or a device keyboard.

Read-only production Chrome measurements covered `/`, `/seller` and `/checkout` as a guest at 360, 440 and 1280 px (9 measurements). All measured document widths equalled their viewport and scale was 1. Guest checkout correctly displayed login. Authenticated production checkout/dashboard layouts could not be inspected. A narrow column in an emulator screenshot is not by itself evidence of a CSS-width defect: the emulator's “Fit to window” scales the entire device canvas on the desktop. At 440 CSS px the measured production layout used that viewport; authenticated local checkout was separately tested.

## 2. Order 409

Confirmed code defect: the `11000` catch in both physical checkout paths treated every database uniqueness error as checkout-key reuse, even when no matching `CheckoutAttempt` existed. This could hide an unrelated data/index conflict behind an idempotency message. The corrected classification returns `CHECKOUT_DATA_CONFLICT` for that case, with order-review guidance. Existing successful idempotent replay and the synchronous double-tap guard remain intact.

The frontend now retains status/code/reference from the response. Conflicts offer “Check My Orders”; ordinary stale-basket conflicts also offer an explicit basket reload. Uncertain idempotency/data-result conflicts do not trigger automatic order resubmission or key rotation. All inventory, seller, serviceability, address, payment and Same-Day checks remain in place. No new payment, delivery-charge, cancellation or refund policy was introduced.

Server-generated `X-Request-ID` is exposed through CORS and included in error metadata. Physical checkout failure logs contain only request reference, HTTP status and a bounded internal classification. Request bodies, tokens, idempotency keys, identities, addresses, payment amounts and raw database/provider errors are excluded from these diagnostics.

New real replica-set regressions create the required unique checkout index explicitly (the production model disables autoIndex), then retry the same successful COD/online request after treating the first response as lost. Both single and grouped checkout return the same persisted order/payment after the cart has been cleared. Existing tests retain seller acceptance/rejection, delivery assignment after acceptance, increased courier quote reconfirmation, uncertain shipment locks/reconciliation and Quick Commerce restrictions. Order HTTP test servers operate independently of Socket.IO.

Not established: which validation returned the user's live 409, whether an earlier request committed an order, which database indexes are installed in production, or whether backend/frontend releases match. A 409 alone cannot settle any of these questions. No production order was created to reproduce the problem.

To finish production correlation: select the failed `/api/orders` request in DevTools Network, inspect Response JSON and `X-Request-ID`, and match the reference against `checkout_failed` server logs after release. For the currently deployed API, use the sanitized response code/message and timestamp. An authorized operator must check existing customer orders/payment references before permitting another attempt. Do not clear idempotency records or bypass a validation based on the console trace.

## 3. Session startup

Confirmed causes: `CustomerSessionGate` wrapped every customer page and withheld all children while `/api/auth/me` ran. A tokenless visitor initially entered its loading state even though no verification was necessary. After verification, `UserProvider` also fetched `/api/users/profile`, duplicating profile retrieval. The customer routes then imposed a separate 680 ms splash plus 180 ms fade, irrespective of readiness.

Public paths now render a guest shell while verification runs. A shared context prevents cached identity, protected startup API calls or buyer socket registration before server verification. Protected routes still wait and fail closed. Completing verification remounts account-specific state. Delivery role redirects, expired/invalid session clearing, cross-tab changes and logout remain tested. Unknown paths default to protected handling.

Only pending verification requests are shared, including StrictMode effect replay; completed authorization is not cached. Requests have a 10-second timeout and explicit retry on failure, without automatic retry loops. The server-verified profile avoids the redundant startup profile fetch. The unconditional splash cover was removed from route rendering. Public content remains available with an optional retry message if verification fails.

Measured evidence:

| Measurement | Result |
| --- | --- |
| Public production HTML GET | HTTP 200, 136 ms |
| Anonymous production `/api/auth/me` GET | HTTP 401, 91 ms, correct storefront CORS |
| Production auth preflight | HTTP 204, 32 ms, correct storefront CORS |
| Local guest shell, production preview | 510 ms from navigation, zero auth GETs |
| Local returning buyer shell with delayed auth fixture | 134 ms, visible before the 1,800 ms response delay elapsed |
| Local expired-session fixture shell | 210 ms, visible before delayed 401 |
| Local failed-session fixture shell | 180 ms, visible before delayed 500 |

These are individual automated samples, not a benchmark or production logged-in timings. Local samples use the built artifact through Vite preview with intercepted APIs. The four browser scenarios verify zero/one auth GET as applicable. An initial count incorrectly included CORS OPTIONS; the fixture was corrected to distinguish preflight from verification. Valid production User/Delivery timing and actual mobile keyboard behavior remain unmeasured.

## 4. Socket.IO

Installed versions: client Socket.IO 4.8.3 / Engine.IO client 6.6.6; server Socket.IO 4.8.4 / Engine.IO 6.6.11. Transport tests use Engine.IO protocol 4 successfully. No incompatible protocol version was identified.

Confirmed client defects:

- Socket host resolution read only `VITE_API_BASE_URL`; HTTP also supported `VITE_API_URL`, including an `/api` suffix. The socket now uses the HTTP origin and its existing `/socket.io` transport path.
- `disconnectSocket` only disconnected fully connected sockets, leaving opening transports active through unmount/logout.
- Room joins were emitted by the initial login helper rather than after every connection; reconnecting could lose membership.

The corrected client avoids repeated connection attempts while opening, cancels opening transports on cleanup, clears old auth/buffers, reconnects before switching identities, and rejoins the correct room on each connection. One event-loop turn of cleanup grace prevents immediate StrictMode replay from reopening the same transport. Existing bounded reconnection policy and polling/WebSocket support remain. Credentialed transport requests support deployments using affinity cookies, but do not create proxy affinity by themselves.

Customer/seller screens display a nonblocking realtime warning on failure. Their existing HTTP operations remain available. Server Engine.IO errors log only numeric code and process ID, excluding URL/SID/auth data; room logging no longer records customer/profile IDs or raw lookup errors. Code 1 is the useful next signal for an unknown polling SID. Do not infer that code from the supplied HTTP 400 alone.

Read-only live transport sample at approximately 06:59:56 UTC:

| Transport | Attempts | Observed result |
| --- | --- | --- |
| Polling only | 3 | Engine opened and namespace POST reached expected authentication rejection; 190–229 ms |
| WebSocket only | 3 | Engine opened and reached expected authentication rejection; 120–126 ms |
| Polling with upgrade enabled | 3 | Engine opened, namespace auth rejection reached; 194–220 ms; one upgrade observed before auth rejection |

These used no token. Authentication rejection is expected and demonstrates transport reachability, not an authenticated realtime session. No 400 occurred in these nine samples. Local tests use the actual server initializer with JWTs and verify polling, WebSocket, upgrade, reconnect and server-selected room ownership; frontend tests separately exercise actual client helper behavior and graceful unavailability.

Unverified deployment factors: number of backend instances, session affinity, restart events, long-lived connections through Hostinger, upstream headers and timeouts, and cross-instance room broadcasts. There is no evidence here to attribute the reported failure to a load balancer or to claim it is fully fixed live.

## Files changed

| Area | Paths and purpose |
| --- | --- |
| Session | `forntend/src/components/CustomerSessionGate.jsx`, new `forntend/src/utils/customerSession.js`, `forntend/src/modules/User/context/UserContext.jsx`, `forntend/src/modules/User/routes/index.jsx`: public rendering, trusted context, bounded/shared verification, remove redundant startup/profile/splash work |
| Layout | `forntend/src/modules/Seller/Seller.css`, `forntend/src/modules/Seller/pages/DashboardPage.jsx`: mobile control sizing, parent width, safe areas and closed mobile drawer |
| Realtime | `forntend/src/utils/socket.js`, new `forntend/src/components/RealtimeNotice.jsx`, `forntend/src/modules/User/pages/LandingPage.jsx`, `forntend/src/modules/Seller/pages/DashboardPage.jsx`, `backend/socket/socket.js`: transport lifecycle, fresh rooms, safe diagnostics and notice |
| Checkout | `backend/controllers/order.controller.js`, `forntend/src/modules/User/context/UserContext.jsx`, `forntend/src/modules/User/pages/CheckoutPage.jsx`: accurate conflict classification, preserve error metadata and explicit recovery |
| Correlation | new `backend/middlewares/requestContext.middleware.js`, `backend/index.js`, `backend/config/cors.js`, `backend/middlewares/error.middleware.js`: safe request references and bounded checkout diagnostics |
| Tests | `backend/__tests__/api/checkout-workflow.http.test.js`, `backend/__tests__/api/seller-first-checkout.http.test.js`, new `backend/__tests__/api/socket-transport.http.test.js`, `forntend/scripts/auth-role.test.mjs`, `forntend/scripts/checkout-ui.test.mjs`, new `forntend/scripts/socket-ui.test.mjs`, `forntend/scripts/mobile-layout.test.mjs`: regressions and browser evidence |
| Tooling | new `forntend/scripts/production-readonly.mjs`, `forntend/package.json`, `.gitignore`, `backend/.gitignore`: public diagnostic runner, socket test command and retain new test |
| Reports | `PRODUCTION_AUDIT.md`, `MOBILE_LAYOUT.md` (link to current verification and updated browser-runner instructions) |

No dependencies, credentials, payment policies or production records were changed. Diagnostic JSON reports are ignored under `test-artifacts/` and contain fixture or public technical measurements.

## Actual verification

| Command | Result |
| --- | --- |
| Backend focused checkout + seller-first + socket suites | 3 suites, 48 passed, 0 failed |
| Backend `npm test -- --runInBand` | 50 suites, 395 passed, 7 skipped, 0 failed (402 total) |
| Frontend `npm run test:auth` | 29 passed, 0 failed |
| Frontend `npm run test:checkout` | 11 passed, 0 failed |
| Frontend `npm run test:socket` | 5 passed, 0 failed |
| Frontend `npm run test:services` | 16 passed, 0 failed |
| Frontend `npm run test:image-search` | 12 passed, 0 failed |
| Backend `npm run build` | Passed; syntax and backend-only service package import checks |
| Frontend `npm run build` | Passed; existing chunk-size warning remains |
| `git diff --check` | Passed |
| `node scripts/mobile-layout.test.mjs` (frontend) | 81 checks passed against production build |
| `node scripts/mobile-layout.test.mjs --seller` | 36 checks passed against production build |
| `node scripts/mobile-layout.test.mjs --dialogs` | 4 checks passed against production build |
| `node scripts/mobile-layout.test.mjs --startup` | 4 scenarios passed against production build |
| `node scripts/mobile-layout.test.mjs --live-public --audit` | 9 guest production measurements; no mutation requests allowed |
| `node scripts/production-readonly.mjs` | Public HTML/assets/auth preflight and 9 anonymous transport samples captured |

The browser command is now `npm run test:mobile`, which rebuilds then runs the four local matrices (125 checks/scenarios). The constituent commands above were run successfully. Three earlier development-server runs stalled with an empty HTML root before React mounted, without an application exception; cache isolation alone did not eliminate it. The runner now serves the actual production artifact, bypassing the development module-loading path. The complete production-artifact matrix and all three additional scopes passed. Earlier stalled runs are not counted as passes, and no production React defect was inferred from them. The exact development-server stall remains unconfirmed.

## Deployment and rollback recommendations — not executed

1. Review and release a matched backend/frontend artifact set to staging first. The live HTML currently references `index-eIwIRiZo.js`; the local verified build generated a different bundle. Do not claim the new changes are live until the deployed HTML references the approved new artifact. Keep hashed assets cacheable; serve HTML with revalidation so it does not pin an obsolete asset manifest. The FCM worker has no application-shell cache handler in this repository; no stale-worker cause was confirmed.
2. Verify the approved MongoDB replica-set/transaction setup and unique `(userId,key)` checkout index using the existing `backend/migrations/checkout-idempotency-index.md` procedure. This audit did not create or change production indexes. Never drop checkout history or rotate keys as a blanket 409 workaround.
3. Obtain the real Hostinger topology and sanitized Engine.IO logs. With multiple instances, polling requires session affinity; room broadcasting also needs a supported shared adapter. Neither is established by this repository. Retain a single backend instance until multi-instance Socket.IO and private-file storage behavior are explicitly provisioned/tested.
4. On the actual reverse proxy, preserve `/socket.io/` polling GET/POST, forward WebSocket `Upgrade`/`Connection` with HTTP/1.1, and use upstream read timeouts longer than the current 25-second ping interval plus 60-second ping timeout (for example 120 seconds). These are requirements to validate with the hosting operator, not proof of this host's current configuration. CORS must allow the exact storefront origin with credentials. Do not force WebSocket-only transport to hide affinity problems.
5. In staging, use separate customer/seller/rider accounts and provider test mode. Confirm the created order and one payment before retrying an interrupted request; accept/reject, prepare, assign internal delivery/eligible Shiprocket, reconfirm increased seller quotes and preserve Quick restrictions. Interrupt and reconnect realtime during the workflow and confirm HTTP ordering still works.
6. Verify real Android Chrome and iOS Safari at the affected seller/dashboard and checkout screens, including initial scale, keyboard open/close, safe areas, drawer toggling and sticky controls. The extreme authenticated Android layout and live logged-in timing remain outstanding evidence.
7. Preserve previous frontend assets and backend release, record environment/config versions without secret values, and back up the approved database/files through the established process. Roll back frontend/backend together to that known release if staging/rollout checks fail. Retain orders, payments, files and idempotency records; this change requires no destructive schema migration. Do not run the repository's existing reset/clean deployment script against a dirty worktree. No deployment script was executed or modified here.

Production readiness is not established by these local tests. Production proxy/session continuity, real-device behavior, storage persistence and recovery retain their independent verification requirements. Quick Commerce third-party shipping policy approvals remain outstanding and were not bypassed.
