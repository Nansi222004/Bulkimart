# API Integration Report — Bulkimart Delivery app

Date: 2026-11-01. Every call goes through `src/services/apiClient.js` (one axios instance: base URL per build type,
fail-closed when unconfigured, Bearer token from memory, `ApiError {status, message, code}`, 401 → sign-out, no automatic
write retries). Endpoints are wrapped in `src/services/delivery.api.js`, `notifications.api.js`, `support.api.js`, `push.js`.

Classification: **MATCH** = route, controller, request and response shape confirmed in backend source and used the same way
by the web portal. Runtime status of every row: **NOT RUN** (no server was called; security gate).

Auth column: P = public, U = any signed-in user (`protect`), A = approved partner (`protect` + `requireApprovedPartner`),
D = approved driver with delivery session (parcel router).

| # | Method & path | Auth | Request | Response used | Controller | Status |
|---|---|---|---|---|---|---|
| 1 | POST /api/auth/delivery/send-otp | P (otpLimiter) | phone, intent | message, otp (mock mode only, shown in debug builds only) | auth.requestDeliveryOTP | MATCH |
| 2 | POST /api/auth/delivery/verify-otp | P (authLimiter) | phone, otp, intent | token, user, sessionRole, deliveryState | auth.verifyDeliveryOTP | MATCH |
| 3 | GET /api/auth/me | U | — | userType, sessionRole | auth | MATCH |
| 4 | POST /api/delivery/start | U | name? | partner (status, onboardingStep) | startOnboarding | MATCH |
| 5 | GET /api/delivery/me | U | — | partner + isLicenseExpired, finance, name, phone | getMyProfile | MATCH |
| 6 | PUT /api/delivery/step/1 | U | multipart vehicleType, vehicleNo, licenseNo, licenseExpiry, license | data.onboardingStep | submitStep1 | MATCH |
| 7 | PUT /api/delivery/step/2 | U | multipart aadhaarNumber, aadhaarFront, aadhaarBack | data | submitStep2 | MATCH |
| 8 | PUT /api/delivery/step/3 | U | multipart zones, deliveryRadiusKm, bank fields, passbook, flattened location | data | submitStep3 | MATCH |
| 9 | POST /api/delivery/submit | U | — | status | submitApplication | MATCH |
| 10 | PUT /api/delivery/location | U | lat,lng,accuracy,source,address,city,state,pincode | — | updateLocation | MATCH |
| 11 | PUT /api/delivery/service-area | U | zones[], version | zones, version; 409 on stale version | updateServiceArea | MATCH |
| 12 | PUT /api/delivery/presence | U (approved checked inside) | lat,lng,source | — | updatePresence | MATCH |
| 13 | GET /api/geo/reverse | U | lat,lng,accuracy | address,city,state,pincode | geo | MATCH |
| 14 | DELETE /api/delivery/account | U | — | message; 409 when active work/earnings | accountManagement | MATCH |
| 15 | PUT /api/delivery/availability | A | isAvailable, lat?, lng? | isAvailable | toggleAvailability | MATCH |
| 16 | GET /api/delivery/orders/pending | A | — | offer[] | getPendingDeliveryOrders | MATCH |
| 17 | GET /api/delivery/orders/active | A | — | active delivery or null (no OTP) | getActiveDelivery | MATCH |
| 18 | POST /orders/:id/accept | A | — | — (app re-reads #17) | acceptOrder | MATCH |
| 19 | POST /orders/:id/decline | A | — | — | declineOrder | MATCH |
| 20 | POST /orders/:id/expire | A | — | — | expireOrder | MATCH |
| 21 | POST /orders/:id/cancel | A | — | message | cancelDelivery | MATCH |
| 22 | PATCH /orders/:id/status | A | status ∈ arrived_at_store, picked_up, arrived_at_customer | status | updateDeliveryStatus | MATCH |
| 23 | PUT /orders/:id/location | A | lat,lng,accuracy,source | — | updateDeliveryLocation | MATCH |
| 24 | POST /orders/:id/generate-otp | A | — | sent (never the code) | generateDeliveryOtp | MATCH |
| 25 | POST /orders/:id/verify-otp | A | otp, codCollected (COD) | earnings, tip, earningStatus, codCollection | verifyDeliveryOtp | MATCH |
| 26 | GET /orders/history | A | type?, page | paginated items | getRiderHistory | MATCH |
| 27 | GET /earnings/summary | A | — | daily, weekly, parcels | getEarningsSummary | MATCH |
| 28 | POST /payouts | A | amount, idempotencyKey (+ header) | 201 reservation | requestPayout | MATCH |
| 29 | GET /payouts | A | page | paginated payouts | getMyPayouts | MATCH |
| 30 | GET /finances/cod | A | page | orders with cash.* paise | listFinanceOrders (rider-scoped) | MATCH |
| 31 | GET /finances/ledger | A | page | rows, balances, total, limit, flags | listFinanceLedger | MATCH |
| 32 | GET /finances/deliveries | A | page | delivery calc rows | getDeliveryFinance | MATCH |
| 33 | POST /orders/:id/cod/collect, /cod/remit | A | amount, method 'cash', reference, reason | — | collectCod / reportCodRemittance | MATCH |
| 34 | GET /return-pickups | A | — | pending, active, history | listReturnPickups | MATCH |
| 35 | POST /return-pickups/:id/accept, decline, expire | A | reason? | — | returnDelivery.* | MATCH |
| 36 | PUT /return-pickups/:id/location | A | lat,lng | — | updateReturnPickupLocationCtrl | MATCH |
| 37 | POST /return-pickups/:id/generate-otp, verify-otp | A | otp | — | returnDelivery.* | MATCH |
| 38 | GET /api/delivery/parcels/bookings, /:id | D | page, limit | bookings / booking | parcelDelivery.list/detail | MATCH |
| 39 | POST /api/delivery/parcels/bookings/:id/offer | D | action, token, version | — ; 409 stale | parcelDelivery.respond | MATCH |
| 40 | POST /api/delivery/parcels/bookings/:id/actions | D | action, version, code/amountPaise/reason | — | parcelDelivery.driverAction | MATCH |
| 41 | GET /api/notifications, /unread-count; PATCH /:id/read, /read-all | U | page, limit | paginated | notification.controller | MATCH |
| 42 | POST /api/notifications/tokens; DELETE /tokens/:token | U | token, platform 'android', deviceId | — | saveFcmToken / deleteFcmToken | MATCH |
| 43 | GET /api/tickets/categories, GET/POST /api/tickets, GET /:id, POST /:id/messages, POST /:id/reopen | U | role 'delivery', multipart attachments ≤5, relatedOrder | ticket, messages | ticket.controller | MATCH |
| 44 | GET /api/helpline | P | — | sosEmergencyNumber | helpline | MATCH |
| — | Socket.IO `join_rider`; events rider_ping, ping_cancelled, delivery_assigned, return_pickup_ping, notification_new, rider_rating_updated | handshake JWT | — | — | socket/socket.js (room resolved server-side from the token) | MATCH |

Totals: 44 REST entries (≈60 individual calls) + socket. 0 mismatches, 0 invented endpoints, 0 fake success responses.

## Requested features with no backend endpoint (not built)

| Feature | Missing backend |
|---|---|
| Delivery failure / customer unavailable for forward orders | Endpoint to move a Delivery to `failed` with reason, release/return the order, settle COD |
| Pickup OTP for forward orders | Seller-side pickup code generation + rider verify endpoint |
| Dashboard counters (assigned/pending/cancelled today) and date filters | Aggregate endpoint; `orders/history` date range params |
| Rider bank-change / document re-upload after approval | Request workflow (currently locked by `assertEditable`; support ticket used) |
| Exchanges (rider leg) | No exchange pickup/delivery model for riders |
| Pickup / delivery proof photos | No upload endpoint for proof |

## Mismatches fixed

None in the API contract. The web-portal bugs fixed are listed in FINAL_FEATURE_AUDIT.md §3.
