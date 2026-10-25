# Managing parcel bookings

Open **Admin → Parcel Deliveries**. The page shows a short booking number, sender
and recipient pincodes, delivery status and payment amount. Use **Find a booking**
to paste the full booking number, then choose **Search bookings**. Open a card for
the addresses, contacts and delivery requests.

## Send a pickup request

1. Choose **Needs a delivery partner** and open the booking.
2. Choose **Find available partners**. Partners are listed by name, vehicle and
   distance from pickup.
3. Choose a partner, review the note for your team, then choose **Send pickup request**.
4. The delivery partner accepts from their duty dashboard or Parcel Deliveries.
   Check **Delivery requests** to see whether they accepted, declined or did not
   reply in time.

If nobody is listed, ask the intended partner to go on duty, allow location access
and check that their delivery pincodes include pickup and delivery. Then refresh
the available partners. A paid booking reuses its payment; the customer does not
need to pay again.

The page also lists **Why other delivery partners are unavailable**, including
the partner's name, pickup distance and how old their last location update is.
An on-duty switch does not prove a fresh location. For example, a booking that
requires a location within five minutes excludes a rider whose location is
nineteen minutes old even when their account and pincodes are correct. Ask the
rider to open their duty dashboard, choose **Update location** and allow access,
then choose **Refresh available partners** in Admin. Do not increase coverage or
override the location rule to fix a stale device location.

| Message | Meaning |
| --- | --- |
| Needs a delivery partner | Choose an available partner and send a pickup request |
| Finding a delivery partner | A pickup request is waiting for acceptance |
| Partner assigned | Someone accepted responsibility for pickup and delivery |
| No reply in time | That pickup request expired without acceptance |
| Paid online | The customer's online payment was verified |
| Cash to collect | The selected sender or recipient still needs to pay the delivery fee |

**Payment summary** explains the fee, cash collection and partner earning.
**Help with this booking** shows applicable cancellation, delivery-problem and
payment actions. Each action explains what it does and asks only for the details
it needs. Payment access is still checked by the server.

**Booking activity** and **Payment records** replace the old raw data display.
**Payment troubleshooting** is collapsed by default and lets staff select a
payment or approved refund without copying internal keys. Checking a payment
does not charge the customer. Refunds are sent only through the explicit approved
refund action, with the existing backend checks.

Prices and coverage are under **Prices & service areas**. Editing this page's
presentation does not change existing bookings, eligibility rules or payment
permissions.
