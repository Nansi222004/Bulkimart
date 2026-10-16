# Portal startup, location and admin product details

Implemented and verified locally on 2026-10-16. No deployment, production/Atlas writes, database reset, index changes, credential changes or real payment/provider operations were performed. An unrelated edit to `SELLER_DELIVERY_DETAILS.md` appeared during the   work and was preserved.

## Admin product details

The previous Details button displayed a selected list row in a modal. It did not have a persistent route or independently fetch the latest record. Details now navigate to `/admin/products/:productId`, inside the existing admin history-based routing and authenticated shell. Refresh, a separate tab and browser history restore the route. Back to Products retains the current provider's search/status/storefront filters.

`GET /api/admin/products/:id` uses the existing `protect` and `requireAdmin` middleware. It validates the ID and returns 404 for missing/deleted records. Its explicit metadata serializer includes product images, name, description, seller/store, category, storefront, price, stock, SKU/variants, status, timestamps and e-book author/language/format/file status/size. It never serializes the private PDF identifier, checksum, internal filesystem path, signed link or PDF bytes. The primary details page has no PDF preview/download request. The separate existing authorized moderation-file endpoint remains unchanged.

The list and page share `productView` and the existing approve/take-down/sponsor/delete handlers. Successful moderation refreshes the detail through the API. Delete retains its existing confirmation and backend validation. Obsolete detail requests are cancelled/ignored; obsolete list searches cannot replace newer results. Administrator session/account changes discard the prior provider state.

## Location root cause and policy

The modal's old initial state was `!localStorage.locationAsked`. Successful selection wrote that flag, but dismissal through the overlay or close control did not. Customer session clearing also removed the flag. Therefore dismissal or account switching could cause the same prompt to return after refresh. The old guest GPS coordinates were stored without a timestamp in persistent local storage, while permission, location validity and prompt dismissal were conflated.

The new state has separate responsibilities:

- Browser permission is queried through the Permissions API when supported. This does not request GPS or prompt for permission. Unsupported browsers continue to offer manual selection.
- `bulkimart:location-choice` stores only the prompt outcome/time, including dismissal/denial. Login/logout does not erase it. Old `locationAsked` remains compatible with existing clients.
- `bulkimart:browsing-location` in **session storage** holds the guest browsing label, optional validated coordinates, source and timestamp. Coordinates expire after 24 hours, invalid/future/untimestamped data is rejected, and permission revocation removes guest GPS data. The old permanent guest-coordinate key is retired.
- Authenticated delivery addresses continue using the existing user/address architecture following explicit user selection. A saved delivery address is distinct from live device GPS permission; revoking GPS does not delete an intentionally saved address.

GPS is requested only from Allow Location Access or Use current location. It has native timeout handling plus an application deadline, and late callbacks cannot overwrite a newer selection. Switching to manual entry cancels the pending UI operation. Failed geocoding/address requests have bounded deadlines and actionable errors; unsuccessful address saves are not treated as selected. Account snapshots guard location writes against late responses after switching accounts.

The first prompt is limited to the home entry, can be dismissed, and describes location-dependent availability without claiming unrelated browsing requires GPS. The existing header location button intentionally reopens it. Manual guest text is honestly stored as a label without invented coordinates. The dialog has keyboard dismissal, focus containment/restoration and keyboard-operable selection controls.

## Session persistence and request handling

Existing storage and portal policies remain: customer/delivery use their existing explicit role-aware `userToken` flow; seller and admin credentials remain in their independent stores. No new cookie or credential persistence was introduced.

`portalRequests` keys requests by portal, token and endpoint. It deduplicates pending reads and reuses successful `/api/auth/me` results for up to 60 seconds within the current JavaScript lifecycle, bounded by JWT expiry where available. Decoding expiry is only a cache limit; it never establishes identity or permissions. Every protected backend API continues its own authentication/authorization. Failed results are not retained. Logout/switch invalidates the correct portal, and pending cancellation cannot evict a newer replacement request.

Customer public pages retain the existing nonblocking session gate. Protected content waits for server-verified identity; unsupported roles fail closed. Seller route/context profile calls share a brief one-second result/pending scope to avoid duplicate startup requests; explicit pickup-profile refresh can bypass that result. Customer wallet/address/wishlist startup reads share pending requests without caching financial data. Seller profile generations and token checks prevent late results from replacing newer state.

The admin shell previously mounted based on token presence alone. It now verifies `/api/auth/me` before mounting the protected provider, requires the server's admin identity, and exposes timeout/error/retry states. Delivery bootstrap likewise has bounded session/profile reads and a recoverable failure state. Seller server failures show verification recovery instead of silently presenting a signed-out screen. All retain existing OTP, role, notification/socket and account-switch cleanup behavior.

The new read helpers have ten-second deadlines, including body arrival, and never automatically retry mutations. Admin details use cancellation on route changes; admin list search cancels obsolete reads. Geocoding/address selection use bounded requests and existing response contracts. Payment, checkout idempotency and delivery-provider policies were not rewritten.

## Pending-request evidence and timing limits

No HAR, live request response bodies or server/proxy logs were supplied for the referenced Network screenshot. It is therefore not possible to honestly label those particular entries stuck, queued, CORS-blocked or aborted. The source proves that the location overlay did **not** suspend independent fetches; it obscured content while startup requests continued. Duplicate seller profile reads and repeated successful session checks were source-level issues addressed here.

In automated Chrome startup tests, the public shell rendered in 549 ms for a guest, 184 ms with slow verification, 147 ms with an expired session and 192 ms with a failed session. The latter three use a controlled 1,800 ms intercepted verification delay. Guests made zero verification calls; each session scenario made exactly one. These are local synthetic measurements, not live production latency or real-device timing. The real local integration script also records safe `/api/auth/me` durations in its JSON artifact; it does not log tokens or profile contents.

## Responsive changes and coverage

The shared viewport is now `width=device-width, initial-scale=1, viewport-fit=cover`; pinch zoom remains enabled. Existing customer/seller mobile control-size and safe-area rules were retained. Admin and delivery mobile form controls now receive readable 16px sizing. Admin login uses percentage width instead of viewport width.

The admin sidebar previously began expanded at 240px even on a 320px viewport. It now starts collapsed on mobile, uses an overlay drawer when expanded, has a close backdrop and an accessible expand/collapse control, and no longer compresses the workspace. The workspace has `min-width: 0`, its outer width is percentage based, header controls wrap, and safe-area padding is included. Admin product details use a responsive page with ordinary content flow. Delivery's bottom content clearance includes the safe area. No blanket horizontal clipping or zoom suppression was introduced.

Chrome geometry checks passed for **66 page/viewport combinations**, covering home, customer sign-in, cart, checkout, seller dashboard/orders/details, admin products/details and delivery dashboard/profile at 320, 360, 390, 430, 768 and 1280 CSS pixels. They check document overflow, visible layout bounds, initial scale and mobile input sizes. Intentional component scrolling remains allowed. This is representative coverage; it is not a claim that every rare dialog/status/data combination has been visually inspected on physical devices.

## Files changed for this task

| Files | Responsibility |
| --- | --- |
| `backend/controllers/admin.controller.js`, `backend/routes/admin.routes.js` | Admin-only metadata details API |
| `forntend/src/modules/Admin/components/ProductsTab.jsx`, `context/AdminContext.jsx`, `routes/index.jsx` | Shared list/page presentation, fresh details, moderation refresh, route/history and stale-request protection |
| `forntend/src/modules/Admin/pages/AdminProductDetailsPage.jsx`, `utils/productView.js` | Page entry and shared serializer |
| `forntend/src/components/AdminSessionGate.jsx` | Server-verified admin bootstrap and recovery |
| `forntend/src/utils/portalRequests.js`, `customerSession.js`, `userSession.js`, `portalSession.js`, `adminApi.js` | Bounded reads, portal-scoped request sharing, lifecycle invalidation and API cancellation |
| `forntend/src/utils/locationState.js` | Validated tab-local browsing location and separate prompt preference |
| `forntend/src/modules/User/components/LocationPromptModal.jsx`, `context/UserContext.jsx` | Explicit GPS/manual flow, dismissal, revocation, stale-response and save-failure handling |
| `forntend/src/modules/Seller/routes/index.jsx`, `context/SellerContext.jsx`, `components/PickupSyncCard.jsx` | Shared startup reads, useful failure recovery, profile generations and explicit fresh profile refresh |
| `forntend/src/modules/Delivery/context/DeliveryContext.jsx`, `routes/index.jsx` | Bounded role/profile restoration and retry state |
| `forntend/index.html`, `src/modules/Admin/SuperAdmin.css`, `components/LeftSidebar.jsx`, `pages/AdminLoginPage.jsx`, `src/modules/Delivery/Delivery.css` | Viewport, drawer/workspace, controls and safe-area layout |
| `backend/__tests__/api/seller-first-checkout.http.test.js` | Real-model admin details/authorization/privacy regressions alongside existing checkout tests |
| `forntend/scripts/portal-startup.test.mjs` | New session, request-body timeout, location and admin-page regressions |
| `forntend/scripts/auth-role.test.mjs`, `checkout-ui.test.mjs`, `seller-notifications.test.mjs` | Preserve existing regressions while isolating synthetic app lifecycles from intentional in-memory request reuse |
| `forntend/scripts/mobile-layout.test.mjs` | Four-portal viewport matrix, permission/refresh tests and startup timing |
| `backend/scripts/verifySellerNotificationsBrowser.mjs` | Actual local authenticated admin details/refresh/new-tab check and existing seller/customer workflow |
| `forntend/package.json` | Discoverable `npm run test:startup` command |

## Tests, deployment and remaining limits

| Command / scope | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand` | 53 suites passed; 461 passed, 7 skipped, 0 failed; 468 total |
| Focused seller-first API suite with new admin metadata/privacy tests | 48 passed, 0 failed; included in full backend total |
| `cd forntend; node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs scripts/portal-startup.test.mjs` | 116 passed, 0 failed, 0 skipped |
| `cd backend; npm run build` | Passed |
| `cd forntend; npm run build` | Passed; existing large-chunk warning |
| `cd forntend; node scripts/mobile-layout.test.mjs --portals` | 66 page/viewport checks passed, no browser application errors |
| `cd forntend; node scripts/mobile-layout.test.mjs --location` | Passed denial/dismissal/manual/grant/refresh/revocation scenario with simulated coordinates |
| `cd forntend; node scripts/mobile-layout.test.mjs --startup` | Four scenarios passed, one verification per session and none for guest |
| `node backend/scripts/verifySellerNotificationsBrowser.mjs` | Passed actual local admin details, refresh/new-tab and existing customer/seller/order/rider workflow; providers mocked, Atlas writes zero |
| `git diff --check` | Task files passed. Final whole-worktree check flags trailing whitespace in the unrelated concurrent `SELLER_DELIVERY_DETAILS.md` edit; that edit was preserved. |

Authenticated `/api/auth/me` calls during the final real-local browser run took **4–19 ms** across nine navigations/restorations (17, 8, 7, 8, 8, 5, 15, 4, 19 ms). Those measurements use the isolated local backend and database, not the live API. Public-shell timings above come from the separate delayed-fixture test.

Backend regression tests use isolated MongoDB, real middleware/models and fixture accounts. UI unit tests use the existing component hook harness. Browser layout/startup/permission tests intercept APIs; the separate integration test runs the actual local backend with a disposable replica set and mock providers. Private e-book detail privacy is asserted at the real API/model path.

No real Android Chrome or iOS Safari device was available. Native keyboard behavior, actual GPS accuracy, production proxy/CORS latency, real push transport, Shiprocket and live payment-provider behavior remain unverified. The frontend build retains its existing approximately 1.72 MB main-bundle warning. Neither package defines a lint command. The seven skipped backend tests were not run.

No new environment variables or database migration are required. An approved rollout must deploy backend and frontend together, retain the existing API origin, and serve the SPA entrypoint for `/admin/products/:id`. Smoke-test actual admin permissions, session expiry, permission revocation and mobile keyboards in staging before rollout. No deployment was performed.
