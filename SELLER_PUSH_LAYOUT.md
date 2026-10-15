# Seller push control layout and registration fix

## Confirmed causes

`DashboardPage.jsx` rendered `.seller-push-control` directly inside the horizontal, full-height `.seller-dashboard-layout`, alongside the sidebar and main content. Default cross-axis stretching made the control full-height. Its own flex layout stretched the unstyled button to match, while taking width away from the Orders page.

`initPushNotifications` returned an immediate `initializing` result to subsequent callers instead of sharing the pending registration result. The UI stored that message without observing completion. The enable button also lacked a busy guard. Service-worker setup and backend token registration had no overall deadline.

## Changes

- `forntend/src/modules/Seller/pages/DashboardPage.jsx`: place notification settings below the header, inside the main content; preserve alerts, notification drawer and order navigation.
- `forntend/src/modules/Seller/components/SellerPushControl.jsx`: compact pending/error/enabled states, disabled busy action, retry after failure, no permission prompt on mount, and no state updates after unmount. Enabled state requires the final successful registration result.
- `forntend/src/modules/Seller/Seller.css`: wrapping, nonstretching settings row; intrinsic-width button with 40px minimum height, hover/focus styles, and compact status badge/text.
- `forntend/src/utils/pushRegistration.js`: share pending results per authenticated session, cache verified success, invalidate work on logout/account change, allow retry after failure, and enforce a 45-second overall setup deadline. Late subscription results cannot register or enable an obsolete attempt. Backend requests use the attempt's abort signal.
- `forntend/src/utils/firebaseMessaging.js`: connect existing Firebase subscription/backend registration flow to the coordinator. Permission and worker activation alone do not count as success. Preserve authenticated token registration, logout removal and foreground message handling.
- `forntend/scripts/seller-notifications.test.mjs`: five new tests covering busy/deduplication, verified success, actionable failures/retry/unmount, timeout/session invalidation and actual token registration with controlled backend responses.
- `forntend/scripts/mobile-layout.test.mjs`: browser geometry assertions enforce compact button height/width, zero flex growth and containment within the main area, preventing the previous sidebar-shaped control.

## Verification in this task

- `npm run test:seller-notifications`: 16 passed, 0 failed, 0 skipped.
- `node --test scripts/auth-role.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs`: 78 passed, 0 failed, 0 skipped.
- `npm run build`: passed; existing large-bundle warning remains (about 1.70 MB minified main JS).
- Headless Chrome against the production build, `node scripts/mobile-layout.test.mjs --seller --width=390` and `--width=1280`: four page checks each, eight total, no application errors. Each width checks seller login, dashboard, Orders and Products. Authenticated pages assert button height between 36 and 48px, width at most 270px, no sidebar overlap and no page overflow.
- Initial sandbox browser attempts timed out before `Page.enable`. The same checks passed when browser launch/debugging was permitted outside the sandbox.
- `cd backend; node scripts/verifySellerNotificationsBrowser.mjs`: passed against a disposable local replica set and real HTTP/Socket.IO backend in headless Chrome at 390x844. Verified automatic popup while on Dashboard, actual socket event, correct detail opening, notification read state, fresh details, same-key notification deduplication, deep-link refresh and buyer denial. The first run timed out in `Runtime.evaluate` before order creation; a fresh retry passed. FCM was mocked; no Atlas writes occurred.
- `git diff --check`: passed (line-ending notices only).

Real Firebase subscription creation, live backend token registration and actual browser push delivery/click-through were **not verified in this task**. Backend registration success/failure was exercised with controlled API responses; this is not live push evidence. Permission denial and missing configuration show actionable states without breaking the portal. No real Android/iOS device testing was performed.

No backend source, checkout, Atlas index, payment credential, environment file or production data was changed. Existing unrelated dirty worktree changes were preserved. No deployment was performed.
