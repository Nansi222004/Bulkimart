# Customer services manual testing

Parcel and legal-service capabilities are always enabled in code. The old
`PARCEL_DELIVERY_*_ENABLED` and `LEGAL_SERVICES_*_ENABLED` values have no effect.
Published services, approved pricing policies, user permissions and valid
workflow states still determine which actions are available.

## Current local readiness

Checked on 23 October 2026 against the database configured in `backend/.env`:

| Check | Result |
| --- | --- |
| Local development runtime | Ready |
| MongoDB transactions | Supported |
| Razorpay test configuration | Present; external credentials not exercised |
| Legal submission/provider indexes | Prepared and verified |
| Published customer legal services | 1 |
| Effective parcel policy | Saved: Bengaluru test area, pincode 560001 |
| Approved legal providers | 0: register/review a provider in Admin |
| Effective legal finance policies | 0: record a policy in Admin |
| Parcel map routing | Mock mode; simulated 5.2 km route |

Restart the backend to load the code changes. Use separate browser profiles for
the customer, delivery driver, admin and legal provider to keep sessions separate.
Use local test data and Razorpay test checkout for this walkthrough.

Run a fresh read-only check from `backend`:

```powershell
node scripts/checkCustomerServicesReadiness.mjs
```

The check reads configuration, policy counts and indexes. It does not create
requests, send notifications or call the payment gateway. For another local
database, the additive index preparation command is:

```powershell
node scripts/prepareCustomerServicesIndexes.mjs
node scripts/prepareCustomerServicesIndexes.mjs --apply
```

The first command previews the two indexes; the second creates them after
duplicate checks. Neither rewrites customer records.

## Parcel flow

Admin monetary fields now use rupees: entering `100` means ₹100. Tax is entered
as a percentage: entering `18` means 18%. Existing saved policies are converted
for display automatically.

For the earlier local example, enter these values in the pricing form:

| Field | Rupees to enter |
| --- | --- |
| Base fee | 10 |
| Fee per kilometre | 2 |
| Minimum fare | 10 |
| Maximum fare | 100 |
| Driver base earning | 5 |
| Driver earning per kilometre | 1 |

Use tax `0` for this test fixture. The simulated 5.2 km route gives a ₹20.40
customer fee and ₹10.20 driver earning with these values.

These parcel test settings have been saved using the Admin policy save handler,
including its version history. Open **Fare and driver settings** to review them.
Existing effective settings are preserved if setup is run again.

The time settings now use minutes and include explanations:

| Field | Saved test value | Meaning |
| --- | --- | --- |
| Keep the quoted price valid for | 5 minutes | Time for the customer to confirm the quoted fare |
| Give each driver this long to accept | 2 minutes | Time for each driver to respond to an offer |
| Driver location must be updated within | 5 minutes | Only drivers with a location update in the last 5 minutes receive offers |
| Look for drivers within | 5 km | Search distance around the pickup |
| Number of drivers to try | 3 | Offers attempted before admin assignment is needed |

The driver needs to be on duty, in the configured area, and sharing a fresh
location. A location-age limit is not the delivery deadline or GPS update interval.

1. Open `/admin/parcel-delivery` as a super admin, or an admin with the relevant
   order and finance permissions. Choose **Fare and driver settings**.
2. Save an effective policy covering your test pickup/drop-off pincodes. Use
   **Find the centre of this service area** to search an area/landmark and choose
   **Use this location**, or choose **Use current location** while in that area.
   Set the service radius; no latitude/longitude entry is needed. Complete the categories, prohibited items, parcel size/weight,
   fare, tax, driver earnings, assignment limits, proof timeouts and terms.
   In **Policy note**, enter a plain description such as `Local parcel delivery test`;
   no special approval code is needed. Set **Start using these settings from** to
   a past date/time for immediate testing and click **Save parcel settings**.
   Enable pay-driver in this policy if you want to test cash collection. These
   are business settings stored in the database, rather than environment flags.
3. Sign in as an approved delivery partner, go on duty and update location. The
   driver needs a matching service zone, a fresh location, and no existing parcel
   or conflicting shopping/return task. Keep this session ready at
   `/delivery/parcels`.
4. As a customer, open `/services` → **Send a Parcel**, or go directly to
   `/parcel-delivery/book`. Select each pickup/drop-off location using address search, **Use current
   location**, or a saved address. Fill contact details, street/house details,
   pincodes, parcel category, description, weight and dimensions. Accept the
   restrictions, request a quote, and review the fare and terms.
5. Confirm using **Pay driver** or **Online**. With online payment, complete
   Razorpay test checkout; dispatch must wait for server-verified payment.
   Refresh the booking to check that it persists without duplicate charges.
6. The driver accepts the offer. If no driver qualifies, open the Admin
   **Unassigned queue**, load eligible drivers, and offer the parcel to one of
   them. Manual assignment also checks driver eligibility.
7. In the driver session, advance through **Driver arriving** → **Arrived at
   pickup** → **Request pickup code**. Read the code from the customer's tracking
   page and enter it in the driver session. Successful proof marks it picked up.
8. Advance to **In transit** → **Arrived at dropoff**. For pay-driver bookings,
   record the exact cash fee first. Request the delivery code, get it from the
   customer's tracking page, and verify it. The booking becomes **Delivered**.
9. Check `/parcel-delivery/history`, customer tracking, driver tasks and Admin.
   The driver reservation should clear and the timeline/finance entries should
   persist. Admin cash reconciliation requires evidence of the deposited cash;
   online bank reconciliation is a separate step from payment capture.

Also test a separate cancellation, an expired/rejected offer, an invalid code,
an out-of-area address and a failed payment. None should silently complete a
delivery. Admin reviews cancellation/refund obligations; online refund execution
is a separate operation under **Gateway recovery and approved refunds**. Cash
refunds need their own evidence. Use the actual operation keys shown in the audit.

## Legal-services flow

1. Open `/admin/services` → **Catalogue and vendor applications**. Verify the
   service is **Published**, has the **customer** audience and has the intended
   form fields/instructions. A published vendor-only service is not a customer
   legal service.
2. Choose **Customer legal requests and providers**. In the provider area,
   register an existing active user, select the service IDs they may fulfil,
   record the required review evidence, and approve the provider.
3. In the finance-policy area, record an effective commission/tax/refund policy
   with terms and a settlement hold period. Use explicit test policy values for
   local testing. No active business policy is invented by enabling the feature.
4. As a customer, open `/legal-services`, choose a service, fill the form and
   upload any required documents. Submit, then open **My requests** at
   `/legal-services/requests` and confirm the request persists.
5. In Admin, open the request and apply **Begin review** → **Assign reviewed
   provider** → **Confirm quotation**. Enter the scope and service amount in INR;
   the backend calculates tax and commission. Grant provider access only to the
   documents/answers required for that assignment.
6. In the customer request, review the quotation, accept the terms and complete
   Razorpay test checkout. Expect **Payment verified** only after server-side
   verification. A catalogue starting price alone does not authorize payment.
7. In Admin, apply **Authorize paid work**. Sign in as the assigned provider at
   `/legal-provider`, open the assignment, and submit progress/completion evidence.
8. In Admin, apply **Verify provider completion**. For the settlement test,
   record bank/gateway reconciliation evidence and wait for the configured hold
   period before **Release eligible provider payable**. This changes ledger
   eligibility; it does not transfer money to the provider's bank account.

Also test missing required fields, a customer information request and response,
an unpaid cancellation, a financial hold, and a separate partial/full refund.
**Approve refund obligation** records the approval; **Execute approved test
refund** performs the gateway operation. Refresh/reconcile uncertain outcomes
instead of creating a second refund. Another customer or unassigned provider
must not be able to read the request or download its private files.

## Verification and limits

- 144 backend tests passed across legal services, parcel delivery/routing and
  shopping/parcel driver-capacity concurrency.
- 36 component/UI tests passed.
- Browser checks passed for 35 parcel views and 25 legal-service views, including
  simulated parcel payment, manual assignment, driver progression and recovery.
- Backend build/package checks passed.

Automated tests use isolated databases and simulated gateway/browser responses.
The configured database was checked for readiness, but no real customer booking,
payment or notification was created as part of verification.

Production mutations remain release-blocked. Real map directions and external
parcel-driver/legal-provider payouts are not implemented. Local mock maps return
a simulated route; posted/eligible earnings and verified payment capture must not
be mistaken for an external bank payout or bank settlement.
