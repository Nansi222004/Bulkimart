# Seller return flow completion

Implemented on 28 October 2026, continuing the interrupted return pickup work.

## Resulting flow

1. New return requests appear in a persistent seller popup. Startup, focus, socket reconnect, and a 30-second reconciliation timer check unread return notifications and pending returns. The returns fallback also works when notification reads fail. Socket and foreground FCM hints authorize the return through the seller detail endpoint before showing it and deduplicate by return ID. Dismissed alerts are remembered per seller for the browser session.
2. `/seller/item-returns` shows return summaries with search and status filters. It loads subsequent result pages so older returns remain accessible. Clicking a card opens a full detail page at `?return=<id>` with the order page's layout, delivery method cards, rider selection, and confirmation styling. Approval/rejection and pickup actions are inside the detail page.
3. The seller reviews and approves or rejects the return. Approval does not book a pickup.
4. After approval, the seller chooses Manual Delivery or Shiprocket. Manual pickup requires selecting an eligible delivery partner and pressing **Request selected delivery partner**. Selecting a method or rider alone sends no pickup request. Shiprocket also requires explicit confirmation.
5. Only the selected rider receives a new manual pickup offer. Assignment occurs when that rider accepts. Decline/expiry clears the request and asks the seller to choose again, without broadcasting to other riders. Cancelling a pending request clears both the selected rider and outstanding offers.
6. Details refresh on return notifications, rider acceptance/stage/release events, focus, reconnect, and polling. The requested rider name is shown while awaiting acceptance; assigned rider contact and vehicle information appear when available. Existing courier tracking, OTP collection, seller receipt, inspection, and refund behavior remain in place.

## Backend contract

- `GET /api/sellers/returns/:returnId/pickup-options` returns seller-authorized pickup options, eligible riders with masked contacts, pickup/drop addresses, and reasons a method is unavailable.
- `POST /api/sellers/returns/:returnId/pickup` with `{ "pickupMethod": "MANUAL", "riderId": "<partner id>" }` requests only that partner. Omitting the rider is rejected.
- The legacy seller `assign-rider` endpoint also requires `riderId`.
- Concurrent seller choices cannot overwrite an outstanding manual request. Other riders cannot see or accept a pickup reserved for the selected rider, including when an obsolete offer exists.
- Active or uncertain courier bookings must be reconciled/cancelled before switching methods.

## Validation

- 58 backend tests passed across `seller-return-pickup-selection`, `seller-return-notifications`, `return-lifecycle`, and `rider-return-history` suites.
- 20 frontend tests passed across `seller-return-flow-ui`, `seller-return-notifications-ui`, and `return-actions-ui` suites.
- Production frontend build passed. Vite retains its bundle-size warning.
- Four isolated browser scenarios passed: list-to-detail and startup-popup-to-detail flows at 390px and 1440px, with no application errors or layout failures. The browser checks assert that selection sends no request and explicit confirmation sends exactly one request with the selected rider ID. Screenshots are under `test-artifacts/seller-returns`.
- Changed tracked files passed `git diff --check`; backend changed JavaScript passed syntax checks.

Browser tests use the production frontend build and mocked APIs; backend integration tests use an isolated MongoDB replica set. No real courier booking, refund, or push to a live device was sent. Restart the local backend to load its new route and controllers, and reload the frontend preview after the build.

The code-review graph tools were unavailable in this session, so the continuation used direct source/diff inspection. Existing unrelated working-tree edits were preserved.
