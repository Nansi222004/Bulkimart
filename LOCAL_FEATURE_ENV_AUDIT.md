# Local functionality settings

Checked on 23 October 2026. API keys and other credentials were not changed.

## Customer services enabled persistently

These settings are saved in `backend/.env`, so they remain enabled after backend restarts:

```dotenv
PARCEL_DELIVERY_CATALOGUE_ENABLED=true
PARCEL_DELIVERY_BOOKING_ENABLED=true
PARCEL_DELIVERY_ONLINE_PAYMENT_ENABLED=true
PARCEL_DELIVERY_PAY_DRIVER_ENABLED=true
PARCEL_DELIVERY_AUTO_ASSIGNMENT_ENABLED=true
PARCEL_DELIVERY_ADMIN_FALLBACK_ENABLED=true
PARCEL_DELIVERY_FULFILMENT_ENABLED=true
PARCEL_DELIVERY_REFUNDS_ENABLED=true
LEGAL_SERVICES_SUBMISSIONS_ENABLED=true
LEGAL_SERVICES_FULFILMENT_ENABLED=true
LEGAL_SERVICES_PAYMENTS_ENABLED=true
LEGAL_SERVICES_REFUNDS_ENABLED=true
```

The running local backend confirmed all eight parcel capabilities are true, `productionBlocked` is false, and legal submissions are enabled. Environment validation and parcel/legal gateway mode checks passed. An entry-file timestamp update triggered the running development server to reload; its source contents were unchanged.

## Required parcel setup before manual booking

`GET /api/parcel-delivery/catalogue` now returns HTTP 200, but `data` is null: there is no saved parcel policy. This is independent of the feature flags.

Open **Admin -> Parcel Deliveries -> Fare and assignment policy** and save a policy with your testing service area, pincodes, map coordinates/radius, categories, restrictions, weight/size limits, fares, driver earnings, assignment settings and terms. Make its effective time current or earlier. Enable pay-driver in the policy and select eligible categories if testing that option.

Then refresh the customer parcel page. Use pickup and drop-off coordinates and pincodes within that policy. An approved available driver in the configured area is required to complete the delivery flow; admin fallback can offer a task to an eligible driver. Transactional writes require a MongoDB replica set or supported sharded deployment; topology was not verified in this audit.

No prices, service areas or approval references were invented, and no database policy was written.

## Additional features enabled after the audit

The user subsequently authorized enabling image search, advertising, finance operations, payouts and Shiprocket seller-fee collection for local testing. The following flags are now saved as `true` in `backend/.env`:

```dotenv
IMAGE_SEARCH_ENABLED=true
ADVERTISING_MANAGEMENT_ENABLED=true
ADVERTISING_CATEGORY_PILOT_ENABLED=true
ADVERTISING_BILLING_ENABLED=true
ADVERTISING_PAID_DELIVERY_ENABLED=true
ADVERTISING_TELEMETRY_ENABLED=true
ADVERTISING_REFUNDS_ENABLED=true
FINANCE_SNAPSHOTS_ENABLED=true
FINANCE_OPERATIONS_ENABLED=true
FINANCE_PAYOUTS_ENABLED=true
LEGAL_SERVICES_PAYOUTS_ENABLED=true
QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED=true
```

Advertising telemetry now has a generated local signing secret and a 30-day event retention setting. Existing credentials were preserved. `ADVERTISING_PRODUCTION_ENABLED` was not enabled: this request is for local testing. `GST_ASSISTANCE_ENABLED` also remains unset, outside the additional features requested.

Verification after reloading the development server:

- Runtime environment validation passed.
- The running image-search configuration endpoint returned HTTP 200 with `enabled: true`.
- Catalogue image indexing completed: four products queued, three jobs processed by the command, zero pending jobs at completion. The running worker can also consume queued jobs.
- Advertising capability checks report management, pilot, payments, paid category delivery, refunds and telemetry enabled, with no environment blockers. Campaigns still require their own policy, eligibility and payment setup; sponsored search remains unsupported.
- Finance snapshot, operation and payout flags are true. Actual operations and payouts still fail the existing approval gate because `FINANCE_POLICY_APPROVAL_REFERENCE` and `FINANCE_E2E_APPROVAL_REFERENCE` are absent. Those references were not fabricated. Existing order balances and payout eligibility are unchanged by these flags.
- The Shiprocket seller-collection flag is true. The provider remains in mock mode and reports `quickCommerce: false`, so Quick Commerce seller collection is not activation-ready. Configuring fees/policies and the required provider capability is separate from the flag.
- Legal payout flag is true; existing settlement and legal workflow checks remain in force.

No payment, payout or seller-fee collection was executed to verify these settings.

## Feature controls and remaining setup

| Feature | Environment controls | Additional requirements |
| --- | --- | --- |
| Image search | `IMAGE_SEARCH_ENABLED` | Catalogue image index |
| GST assistance | `GST_ASSISTANCE_ENABLED` | Supported non-production environment |
| Finance snapshots | `FINANCE_SNAPSHOTS_ENABLED` | Snapshot/policy configuration |
| Finance operations | `FINANCE_OPERATIONS_ENABLED` | Policy and E2E approval references |
| Finance payouts | `FINANCE_PAYOUTS_ENABLED` | Policy and E2E approval references and applicable settlement checks |
| Legal payouts | `LEGAL_SERVICES_PAYOUTS_ENABLED` | Applicable legal fulfilment, settlement and financial checks |
| Advertising management | `ADVERTISING_MANAGEMENT_ENABLED` | Advertising configuration |
| Advertising category pilot | `ADVERTISING_CATEGORY_PILOT_ENABLED` | Management enabled and deployment restrictions |
| Advertising billing | `ADVERTISING_BILLING_ENABLED` | Management enabled and gateway mode matching deployment |
| Advertising delivery | `ADVERTISING_PAID_DELIVERY_ENABLED` | Billing enabled and paid-ad eligibility |
| Advertising telemetry | `ADVERTISING_TELEMETRY_ENABLED` | Management enabled and telemetry eligibility |
| Advertising refunds | `ADVERTISING_REFUNDS_ENABLED` | Applicable gateway and production approval checks |
| Advertising production | `ADVERTISING_PRODUCTION_ENABLED` | Explicit production release configuration |
| Shiprocket seller-fee collection | `QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED` | Approved policies, provider and reconciliation checks |

## Integration modes affecting manual testing

| Setting | Current value | Effect |
| --- | --- | --- |
| `NODE_ENV` | `development` | Local development runtime |
| `PAYMENT_GATEWAY` / `RAZORPAY_MODE` | `razorpay` / `test` | Payment flow uses Razorpay test mode |
| `OTP_MODE` | `mock` | Mock OTP verification |
| `MAPS_MODE` | `mock` | Routes use a fixed test distance of 5.2 km and duration of 18 minutes |
| `SHIPROCKET_MODE` | `mock` | Simulated shipping-provider behavior |
| `FCM_MODE` | `live` | Live push integration mode |
| `DELIVERY_BROADCAST_REQUIRE_VERIFIED` | `true` | Delivery broadcasts require verification eligibility |
| `REDIS_DISABLED` | `false` | Redis is not disabled by this flag |

`USE_REAL_SMS=false` is also present. OTP behavior should be interpreted through `OTP_MODE`; these settings were not changed. No frontend functionality-mode or boolean feature switches were found in `forntend/.env`.

Parcel and legal production restrictions in server code remain in force. Turning environment flags on does not remove release checks, provider eligibility or financial reconciliation requirements.

To disable an individual capability later, set its flag to `false` and restart the backend. To stop new parcel bookings while preserving history, set `PARCEL_DELIVERY_BOOKING_ENABLED=false`. The local `.env` file is ignored by Git; another machine or deployment needs its own settings.
