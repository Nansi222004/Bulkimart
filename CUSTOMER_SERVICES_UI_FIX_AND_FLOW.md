# Customer services UI fix and workflow

## What caused the screenshots

- Home service actions were anchors with incomplete styling. Browser defaults supplied the underline and purple visited-link color. The disabled parcel action also used the browser's default button appearance.
- The local `backend/.env` sets `NODE_ENV=development` but has no `PARCEL_DELIVERY_*` settings. Parcel flags default to false in `backend/services/parcelPolicy.service.js`.
- The booking page requested capabilities and catalogue concurrently. With catalogue disabled, the server correctly returned HTTP 503, but the UI displayed this expected availability state as a red load error.

## Changes

- Consistent button appearance, 44px minimum height, explicit visited colors, hover styling and visible keyboard focus for home service actions.
- Card title: `Parcel Delivery`; primary action: `Send a Parcel`; secondary action: `Delivery history`.
- The primary action opens the parcel page even when new deliveries are unavailable. It does not create a booking.
- Booking reads capabilities first and requests the catalogue only when booking, dispatch and a payment option are enabled.
- Home discovery and booking now share availability checks. An effective policy with service areas, categories and a usable payment option is required before the form appears.
- Disabled service shows a neutral availability message, a check-availability action and a return-to-shopping action. Genuine network/API failures still show an error and retry action.
- Existing history and tracking reads remain independent of new-booking availability.

## Parcel customer flow

1. Open **Send a Parcel**. Guests sign in; the customer page checks service capabilities.
2. If available, load the effective policy: areas, categories, restricted items, size/weight limits and terms.
3. Enter pickup and recipient addresses, contact details, pincodes and coordinates. Saved addresses can populate these fields. Enter parcel category, description, weight, dimensions and optional pickup instructions; accept restrictions.
4. **Calculate delivery fee** posts to `/api/parcel-delivery/quotes`. The server validates the parcel and both locations against policy, obtains a verified route and calculates the approved fare in paise. A stored, expiring quote captures the policy version.
5. Review the fee and terms. Choose online payment or pay-driver when permitted for that category. Accept terms and confirm.
6. `/api/parcel-delivery/bookings` checks the quote, expiry, policy version, payment method and dispatch prerequisites. An idempotency key prevents duplicate bookings when retrying the same request.
7. Online bookings start at `payment_pending`. Razorpay checkout runs in isolated test mode; server verification is required before driver search. Pay-driver bookings start at `searching_for_driver` with cash due.
8. The customer opens the tracking page using the returned booking ID. **Delivery history** lists only that customer's bookings. Status refresh retrieves the current server state.

## Driver and admin flow

1. Assignment offers a task to an eligible approved driver. Driver capacity and parcel custody are checked. When automatic assignment cannot find a driver, the booking can move to `needs_admin_assignment` for admin fallback.
2. The driver accepts an offer, then advances through `driver_assigned` -> `driver_arriving` -> `arrived_at_pickup`.
3. A pickup code is issued at pickup and verified before `picked_up`.
4. The driver advances through `in_transit` -> `arrived_at_dropoff`. Pay-driver orders require the exact delivery fee to be recorded. Collection remains unreconciled until finance review.
5. Delivery proof is verified before `delivered`. The customer timeline records the progression.
6. Cancellation, exceptions and refunds use review flows. Delivery completion alone does not release driver earnings; financial reconciliation and payout restrictions still apply.

## Why actual booking remains unavailable locally

Update: customer service flags have since been enabled in the local environment. The running API reports no parcel policy yet; see `LOCAL_FEATURE_ENV_AUDIT.md` for the current status and remaining setup. The original flag diagnosis below describes the state before that update.

The UI fix does not change backend feature flags or invent operational pricing. For a configured development/test setup, all of these must be enabled:

```dotenv
PARCEL_DELIVERY_CATALOGUE_ENABLED=true
PARCEL_DELIVERY_BOOKING_ENABLED=true
PARCEL_DELIVERY_AUTO_ASSIGNMENT_ENABLED=true
PARCEL_DELIVERY_ADMIN_FALLBACK_ENABLED=true
PARCEL_DELIVERY_FULFILMENT_ENABLED=true
```

At least one payment flag must also be enabled: `PARCEL_DELIVERY_ONLINE_PAYMENT_ENABLED` or `PARCEL_DELIVERY_PAY_DRIVER_ENABLED`. Pay-driver additionally requires policy permission and eligible categories. Online execution requires `PAYMENT_GATEWAY=razorpay`, `RAZORPAY_MODE=test` and valid test credentials.

An admin with finance permission must save an effective policy through the parcel policy workspace: approved reference, areas with pincodes/coordinates/radii, fare and driver earning rules, categories, restrictions, limits, assignment settings and customer terms. Routing, database transactions and eligible drivers must also work. Restart the backend after changing environment settings.

Production parcel operations are explicitly release-blocked in server code even if flags are enabled. This UI change does not remove that restriction. Parcel payouts also have an explicit release blocker.

## Legal services flow

1. **Browse Legal Services** opens the catalogue. A published service explains its requirements.
2. The customer signs in, completes the required form/documents and submits when submissions are enabled.
3. Admin reviews the request, asks for missing information or rejects it, and assigns an approved provider.
4. Admin confirms a quotation before customer payment becomes available. The customer accepts terms and pays; the backend verifies payment.
5. Admin authorizes work after verified payment and required checks. Providers receive only the documents/answers explicitly shared with them.
6. The provider submits completion; admin verifies completion. Cancellation, refunds and settlement remain separate controlled steps.

Browsing the legal catalogue does not imply submissions, payments or fulfilment are enabled. Those have separate `LEGAL_SERVICES_*` flags and production restrictions.

## Verification

- Frontend production build passed.
- 36 parcel/legal UI regression tests passed, including disabled catalogue, missing policy, unavailable dispatch/payment, retry and history/tracking behavior.
- Headless browser suite passed 35 existing responsive views, both payment paths, admin fallback, driver lifecycle and error recovery.
- Added browser checks at 320px and 1440px for home button styling and disabled-service navigation; no disabled catalogue request was made.
- Browser workflow tests use isolated fixtures and simulated gateway responses. No real payments, deliveries or production operations were performed.
