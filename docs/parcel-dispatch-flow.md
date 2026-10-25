# Parcel offers and acceptance

Cash bookings begin dispatch at booking. Online bookings dispatch immediately
after verified payment. The durable worker checks every 30 seconds for retries.

Automatic dispatch broadcasts one offer round to every eligible nearby rider.
Eligibility requires an approved, active, available rider, fresh live location,
pickup distance within both coverage radii, matching zones, and no conflicting
shopping, return or parcel reservation. Offers contain area and fare information;
private addresses, contact numbers and proof codes stay hidden until assignment.

Receiving an offer does not reserve the rider. Acceptance checks eligibility
again and reserves the rider in the same MongoDB transaction that assigns the
booking. Concurrent acceptances can produce only one winner. All other recipients
lose access to the offer and receive a parcel update notification. A rider cannot
accept two parcels or accept a parcel alongside conflicting shopping/return work.

Rejecting removes only that rider. Other recipients can still accept their
original offer, even if its displayed booking version predates a rejection.
Authorization, batch token, expiry, booking state and payment readiness are checked
on every response. Expired or withdrawn offers cannot be accepted.

`acceptanceSeconds` controls the broadcast window. `maxAttempts` now counts offer
rounds rather than individual riders. Timed-out rounds can be rebroadcast to
currently eligible riders; riders who explicitly rejected are excluded. Exhaustion
or no eligible riders sends the booking to admin fallback. Manual assignment
still offers only to the selected eligible rider. Existing single-rider offers
remain supported until accepted, rejected or expired.

The rider parcel screen reloads on parcel notifications and socket reconnection,
with a 10-second polling fallback. When another rider wins, an open withdrawn
offer returns to the list. Accept/reject conflicts clear stale action buttons.

Parcel requests also appear on the rider's duty dashboard, with accept/decline
actions and a link to pickup details. This inbox uses notifications plus 10-second
polling, including when live socket updates are unavailable. While approved and
on duty, the rider app asks the device for a fresh GPS fix each minute and sends
it to `/api/delivery/presence`. This changes only live coordinates, never the base
address, zones or duty. A failed or denied GPS request does not refresh an old fix.

New online bookings open Razorpay immediately over a simple payment screen. The
pending record remains internal for idempotency and payment reconciliation;
customer confirmation is shown only after server verification. Cancellation and
failed initialization retain the same booking for retry. Tracking uses plain
status messages, a payment receipt, separate pickup/drop cards and expandable
reference/history details. Customer tracking also polls when sockets are absent.

For an already-paid booking whose offer timed out and reached admin fallback,
refresh the intended rider's location, then open the existing booking in Admin
Parcel Deliveries. Choose **Load eligible drivers**, select the eligible rider,
enter a reason and choose **Offer to selected driver**. This reuses the payment
and booking; it does not charge the customer again. The test suite covers this
recovery after timeout and stale location. Historical admin queue entries are
not silently restarted by these UI changes.

Verification: `npm run test:parcel` in `backend` covers broadcast, privacy,
acceptance/rejection, timeout, payment/custody and capacity races against an
isolated MongoDB replica set. The same command in `forntend` includes notification,
withdrawal, conflict and fallback polling UI tests. These tests do not verify
actual device push delivery. Existing production parcel release blocks remain
in force; this change does not enable production operations.
