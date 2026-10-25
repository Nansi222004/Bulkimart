# Editing rider coverage after registration

Open the rider account at `/delivery/profile`. Under **Vehicle & zone details**,
choose **Edit service area**. The editor preloads the saved delivery pincodes.
Add or remove comma-separated six-digit pincodes, then choose **Save service
area**. Cancel discards the draft. Saving changes coverage immediately for new
offers and preserves approval, duty, active parcel reservations, location, pickup
radius, vehicle documents and payout details.

For Ritik's screenshot, to keep the existing zones and add the two new ones, use:

    456001, 452015, 452001, 452006

The base-location pincode is separate from delivery pincodes. **Use Current
Location** updates his location; it does not add delivery zones. Existing identity,
vehicle and bank registration fields remain subject to their approval workflow.

## Parcel service-area settings for the Indore route

Open **Admin → Parcel Deliveries → Fare and driver settings → Where we deliver**.
Edit the existing Indore area, or add an area if the existing circle does not
cover this route. Preserve existing approved pincodes that are still served.

| Field | What to enter |
| --- | --- |
| Area name | `Indore` (or a descriptive name for the actual coverage) |
| Pincodes | `452015, 452001, 452006` to preserve the earlier Indore coverage and add pickup/drop |
| Centre | Search for the centre of the intended Indore coverage on the map, select the result, then confirm **Use this location** |
| Radius (km) | The actual area the service covers. For a local test, start with `10` and verify that both pickup and drop pins are inside the circle; adjust the centre/radius to match the intended coverage |
| Policy note | For example, `Add Indore pickup 452001 and drop 452006 coverage` |
| Start using settings from | Current local date/time or the intended activation time |

Choose **Save parcel settings**. A name or pincode alone does not approve a
location: each endpoint must have an allowed pincode and coordinates inside an
approved coverage circle. Area radius is separate from **Look for drivers within
(km)**, which limits how far the rider can be from pickup.

Then keep Ritik on duty, update his live location near pickup, and open
`/delivery/parcels`. Cash bookings start dispatch at confirmation; online bookings
need verified payment and are picked up by the 30-second dispatch worker. Another
eligible rider can accept first. Existing bookings already in admin fallback
require admin review/assignment; editing zones does not automatically restart them.

## Implementation and checks

`PUT /api/delivery/service-area` accepts only `zones` and the displayed profile
`version`, updates only the authenticated user's rider profile, validates 1–50
unique six-digit pincodes, and increments its version atomically. Concurrent or
stale saves return 409 and require the rider to reload and review the saved values.
The UI retains drafts on request failures and prevents duplicate submissions.

Run `npm run test:rider-service-area` in `backend` and `forntend` for API and UI
coverage. Tests use isolated data; no shared rider or parcel policy is changed.
