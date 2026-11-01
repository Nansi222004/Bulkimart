# Final Feature Audit — Bulkimart Delivery (web portal → Android)

Date: 2026-11-01. Source of truth: `frontend/src/modules/Delivery/**`, `frontend/src/components/parcels/**`,
`backend/routes/delivery.routes.js`, `backend/controllers/deliveryPartner.controller.js`, `returnDelivery.controller.js`,
`financeWorkflow.controller.js`, `parcelDelivery.routes.js`.

Status words: **PASS**, **FAIL**, **BLOCKED**, **NOT IMPLEMENTED**, **NOT RUN**.
"Implemented" means the code is written and statically checked. Nothing has been executed (security gate failed),
so every runtime result is **NOT RUN**.

## 1. Screen inventory and conversion

| Web portal | Android screen | Status |
|---|---|---|
| DeliveryAuthPage (sign in / register, phone + OTP, 30 s resend) | `screens/auth/LoginScreen.js` | Implemented — NOT RUN |
| Session bootstrap / "Retry verification" | `SessionScreens.js` (Splash, SessionError) | Implemented — NOT RUN |
| DeliveryOnboardingPage (3 steps + submit) | `screens/onboarding/OnboardingScreen.js` | Implemented — NOT RUN |
| Pending / rejected / suspended view | `ApplicationStatusScreen` | Implemented — NOT RUN |
| DeliveryDashboardPage (duty toggle, presence, COD card, KPIs, rating, parcel inbox) | `screens/duty/DutyScreen.js` | Implemented — NOT RUN |
| OrderPingModal (60 s offer, accept/decline/expire) | `components/OfferModal.js` `OrderOfferModal` | Implemented — NOT RUN |
| ReturnPickupPingModal | `ReturnOfferModal` | Implemented — NOT RUN |
| ActiveDeliveryPage (pickup checklist, stages, OTP, COD, cancel, call, support) | `screens/active/ActiveDeliveryView.js` | Implemented — NOT RUN |
| EarningsPage (payout balance, cash-out, history, today/week/lifetime) | `screens/earnings/EarningsScreen.js` | Implemented — NOT RUN |
| DeliveryFinancePanel (COD records, collect/remit reports, ledger, trip calculations) | `screens/earnings/CashScreen.js` | Implemented — NOT RUN |
| RiderHistoryPage (type filter, paging) | `screens/history/HistoryScreen.js` | Implemented — NOT RUN |
| ReturnPickupsPage + detail | `screens/returns/ReturnPickupsScreens.js` | Implemented — NOT RUN |
| ParcelRiderInbox + ParcelDriverOperations | `screens/parcels/ParcelScreens.js` | Implemented — NOT RUN |
| DeliveryProfilePage (details, service area editor, base location, bank, SOS, delete account, logout) | `screens/profile/ProfileScreen.js` | Implemented — NOT RUN |
| DeliveryNotifications (inbox, mark read, routing) | `screens/notifications/NotificationsScreen.js` | Implemented — NOT RUN |
| DeliverySupportPage + TicketDetailModal | `screens/support/SupportScreens.js` | Implemented — NOT RUN |
| DepositModal (points to COD records) | Dashboard cash card → Cash screen | Implemented — NOT RUN |

16 routed screens + 2 modals. All web rider features have a counterpart.

## 2. Workflows

### Authentication and account state
- OTP sign-in/register via `/api/auth/delivery/*`; the response is validated exactly like the web `saveDeliverySession`. — Implemented
- JWT stored in Android Keystore (react-native-keychain, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never AsyncStorage. — Implemented
- Session restore checks `/api/auth/me` (`sessionRole === 'delivery'`) then `/api/delivery/me`. 401/403/404 → signed out; network/5xx → retry screen (no silent logout). — Implemented
- Token expiry: any 401 for the current token ends the session. — Implemented
- Approval comes only from the server. Incomplete → onboarding (same-session only, as the web does); pending/rejected/suspended → status screen; only `approved` reaches duty screens. Rejected riders can fix and resubmit (server allows it). — Implemented
- Suspended/unapproved riders cannot reach offers; the server also gates every rider route with `requireApprovedPartner`. — Implemented (server-enforced)
- Forgot/reset password: **not applicable** — riders sign in with OTP only; no password exists.

### Dashboard
- Duty toggle shows only what the server confirmed (`/availability` response). Blocked locally when the licence is expired or COD custody ≥ ₹2,000 (same as web); the server decides finally. — Implemented
- Today's earnings and trips (`/earnings/summary`), lifetime (`/me`), COD custody (`finance.reportedCodOutstanding`), rating. A dash is shown when a figure is unavailable, never ₹0. — Implemented
- Requested-but-unsupported statistics: "pending deliveries / accepted / pickups pending / cancelled today" counters and date filters on the dashboard. **NOT IMPLEMENTED** — the backend exposes no such aggregate; history has type filters but no date filter. Inventing counts client-side was rejected.

### Assignment
- Server assignment (`$near` / 2dsphere / workload / timeout in `broadcastNewOrderToRiders`) is unchanged. The app receives offers by socket (`rider_ping`) and reconciles every 10 s against `/orders/pending`, dropping offers the server no longer lists. — Implemented
- Accept / decline / expire map to the three server endpoints; a refused accept removes the stale offer; network failure keeps it. Double taps are ignored (in-flight guard). — Implemented
- Distances and payout come from the server; none are computed. — Implemented
- Countdown: the same fixed 60 s client window as the web (the server sends no expiry for forward offers). — Implemented

### Pickup
- Store name, address, Navigate. Item checklist must be fully ticked before "Confirm pickup" (as web). "Reached store" → `arrived_at_store`; pickup → `picked_up`. Each step is a server call; the screen re-reads `/orders/active` afterwards. — Implemented
- Pickup OTP: **not supported by the backend for forward orders** (there is no pickup code; the item checklist is the web portal's verification). Not invented.
- Store phone: not returned by `/orders/active` → only Navigate is offered for the store.
- Pickup proof upload: not supported by the backend → not added.
- Cancel before pickup → `/cancel`; server refuses after pickup.

### Delivery and OTP
- Reached customer → `arrived_at_customer`; Send code → `/generate-otp` (code goes only to the customer); 4-digit code → `/verify-otp`. Completion is idempotent server-side; network failure re-reads the active delivery instead of guessing. — Implemented
- "Send a new code" is offered after the first code (the web portal has no resend path after 5 wrong tries). Confirmation warns that the old code stops working. — Implemented
- Customer unavailable / failed delivery: **NOT IMPLEMENTED** — no forward-order endpoint exists (`Delivery.status 'failed'` is never written by the backend). Riders use Delivery support (ticket linked to the order). Backend requirement listed in `PRODUCTION_RELEASE_CHECKLIST.md`.

### COD and amount rounding
- Canonical rule: `codCashDuePaise = round(expectedPaise / 100) × 100` (`backend/utils/financeMoney.js`). Server sends `codAmount = Math.round(pricing.totalAmount)` on offer, active delivery and earnings breakdown — the same figure.
- App: displays `codAmount` as received (no per-screen rounding); `codDueRupees` refuses a non-integer amount instead of re-rounding.
- Completion requires typed cash **exactly equal** to `codAmount`, whole rupees, plus a confirmation dialog. Less → refused (as web); more → refused (the backend recorder rejects anything above `max(expected, due)` and would leave the cash unrecorded).
- Server response `codCollection.recorded === false` is shown prominently with the instruction to report on the Cash screen.
- Order pricing and GST are untouched. Order value, COD due, collected, reported and verified amounts are shown separately on the Cash screen.
- Cash screen: collect/remit reports limited exactly as the web (`max(expected, due)` / collected), amounts in paise, reference and details required.
- Edge cases covered by unit tests: whole, .20, .49, .50, .99, ₹0.49, ₹0.50, paise entry, over/under, missing amount. Discounts/GST/delivery fees/multiple items all arrive pre-summed in `pricing.totalAmount`; the app never recomputes them. Partial payments: not supported by the backend for COD orders.
- **Gap (backend, not changed):** `/verify-otp` marks the order delivered first and records cash afterwards, so a direct API call with a wrong or missing amount still completes the delivery (existing test "a failed cash record never undoes the delivery" asserts this on purpose). The app blocks it; the server does not. Owner decision required — see `SECURITY_VALIDATION_REPORT.md` S2.

### Wallet and earnings
- Withdrawable = `finance.verifiedPayable` (ledger); button enabled only when `finance.payoutActionsEnabled`; blockers listed as the server sends them; balances on hold / requested / paid; legacy unverified earnings flagged. — Implemented
- Payout request sends one idempotency key per amount (body + `Idempotency-Key` header); a timeout keeps the key so a retry cannot create a second request. — Implemented
- Payout history with status, reference, rejection reason; bank shown masked. — Implemented
- Incentives/same-day incentives: shown only inside server ledger entries (no separate rider endpoint). Deductions/adjustments: ledger entries. — Implemented as ledger listing.

### GPS and maps
- Foreground permission requested with an explanation when going on duty, starting a trip, or tapping "Use current location". Denied / unavailable / timeout each have a message and a retry. — Implemented
- Presence heartbeat every 60 s while on duty; trip location every ≥5 s (and ≥10 m) during an active forward delivery or return pickup; all stop in the background. On-screen notice while sharing. — Implemented
- Navigation: Google Maps turn-by-turn intent, else a maps web link (coordinates or address). Invalid/0,0 coordinates fall back to address text. No API key in the app. — Implemented
- In-app map with route drawing (web `DeliveryMap` uses a Google Maps JS key): **NOT IMPLEMENTED** — needs a Maps SDK key for Android and `react-native-maps`; external navigation covers the workflow. Configuration listed in the release checklist.
- Background tracking with a foreground service: **not added** — the web portal only tracks while the page is open; the app matches that.

### Notifications
- FCM token registered for approved riders (`POST /api/notifications/tokens`, platform `android`, stable device id); removed on sign-out (`DELETE …/tokens/:token`) and Firebase token deleted. Token refresh re-registers. Android 13 permission requested. — Implemented
- Foreground message → toast + immediate re-read; tap (background/closed) → routed by the `/delivery/*` allow-list; duplicates by message id ignored. — Implemented
- In-app inbox with mark read / mark all. — Implemented

### Returns
- Quick Commerce reverse pickup (customer → rider → seller) fully supported by the backend: list, accept/decline/expire, location, send code, verify code. Implemented the same flow. Drop at seller is confirmed by the seller (no rider endpoint). — Implemented
- Exchanges: **no rider-side exchange workflow exists in the backend** — not built.
- Product verification checklist for returns: not in backend or web → not added.

### Parcels
- Inbox, offer accept/decline (token + version), stage actions, 6-digit pickup/delivery codes, cash fee collection, problem report. Production parcel mutations are release-blocked server-side; the server message is shown. — Implemented

### Profile and documents
- Profile, vehicle, licence (number + expiry), Aadhaar (masked as stored), documents "on file" (never displayed), service pincodes (versioned save with 409 handling), base location, bank (masked), payout cycle, SOS number from `/api/helpline` (fallback 112, as web), delete account, sign out (goes offline first). — Implemented
- Document re-upload after approval / bank-change workflow: **locked by the server** (`assertEditable`). App routes these to a support ticket. Rejected applicants can re-upload through onboarding. — Implemented as support route.
- PAN: **not collected by the backend for riders** — not added.

## 3. Bugs found and fixed

| # | Where | Bug | Fix |
|---|---|---|---|
| W1 | `frontend/.../DeliveryContext.jsx:893` | `useMemo` used but not imported → `ReferenceError` on render; the whole web delivery portal crashes (introduced in 0e0c301) | Import added |
| W2 | `frontend/.../DeliveryDashboardPage.jsx` | Toggle showed "You are now Online" even when the server refused | Extra toast removed; the server's message is shown |
| W3 | ActiveDeliveryPage | 10-minute "QUICK SLA TIMER" restarts on every load; not server data | Not carried into the app (no invented ETA) |
| W4 | ActiveDeliveryPage | No way to request a new code after 5 wrong attempts once `otpSent` is true | App adds "Send a new code" |
| W5 | ProfilePage | Fake fallback partner ID `NHC-DEL-40122` when the profile has no id | App shows "—" |
| W7 | `DeliveryContext.refreshRiderStatus` | Only ever set `isOnboarded` to true, so a rider suspended mid-session kept the duty dashboard until a reload | Fixed in web (sets false for non-approved); app re-routes on every profile refresh |
| W6 | Logout (web) | Rider stays `isAvailable` on the server after logout and keeps receiving offers | App goes offline before sign-out |

Backend findings were not changed (see SECURITY_VALIDATION_REPORT.md).
