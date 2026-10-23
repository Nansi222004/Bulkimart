# Advertising staging acceptance checklist

This checklist continues `SELLER_PAID_ADS_BILLING_REPORT.md`. It does not authorize production activation. A check passes only with the evidence specified; local gateway mocks cannot satisfy a provider check.

## Reproducible automated acceptance

Use the existing installed dependencies. No package install or application bootstrap is needed.

From `backend`:

```text
node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising-database-acceptance.test.js verification/advertising-billing.test.js verification/advertising.test.js verification/financial-workflow.test.js --silent --noStackTrace
```

From `forntend`:

```text
node verification/advertising-acceptance-browser.mjs
node --test --test-concurrency=1 verification/advertising-ui.test.mjs verification/advertising-billing-ui.test.mjs verification/sponsored-category-ui.test.mjs tests/product-link.test.mjs
```

The database suite creates its own MongoDB 7.0.14 replica set and a separate standalone instance. It inspects the actual database index catalog, exercises uniqueness concurrently, verifies transaction commit/rollback, checks real TTL deletion and rejects standalone financial writes. The accelerated TTL monitor is confined to its disposable instance.

The new browser runner launches only loopback servers, a disposable replica set and a temporary browser profile. It sanitizes the backend environment, generates synthetic signed sessions, and uses real `protect` / admin / approved-seller middleware and real advertising routers/services/models. It does not mock advertising API responses. It drives these actual workspace controls:

1. Admin: Packages and policies → Create package → configure complete synthetic policy → Save package version.
2. Seller: Create campaign → owned product/variant → category → schedule/package → save draft → Review submission terms → Confirm terms and submit.
3. Admin: View campaign → decision reason → approve.
4. Admin finance: required external invoice reference and action reason → Authorize accepted billing policy.
5. Seller: verify the payment button is disabled at the explicit provider gate; an unauthorized attempt to bypass the button returns 503.
6. Another synthetic seller receives 404 for the campaign.
7. Admin: separately authorize a non-billable pilot; customer sees the actual Sponsored block and activates its product link.
8. Real browser viewability/click submissions persist in MongoDB; concurrent retries remain one event per token/type.
9. Admin stops the pilot; customer organic content remains available and the optional block disappears.
10. Finance remains at zero Payment records/collections/recognized revenue. Actual Seller workspace layouts are checked at 320, 390, 768 and 1280 pixels.

**Scope:** actual advertising workspace interfaces and authenticated local APIs, with synthetic catalog/sessions and a synthetic customer navigation adapter. Login/OTP, complete portal shells, merchandise checkout and external Checkout are not exercised by this runner. It blocks all non-local browser requests and provider billing/delivery/refunds. Synthetic prices, tax rules, invoice references and refund limits are test fixtures, never approved business configuration.

The existing `node verification/sponsored-category-browser.mjs` checks paid-card/Checkout display using synthetic API/SDK responses. Keep its result separate from the new real-API runner and provider acceptance.

## Boundary before external acceptance

Do not proceed beyond this boundary until all of these exist:

- An identified isolated staging database and application origin, with explicit confirmation that neither is production. Do not reuse the developer `.env` database URL merely because test gateway credentials exist.
- Approved package/policy reference: price/duration, issuer, tax treatment/rate/timing, invoice and credit-note obligations, refund ceilings and reasons, interruption rule and recognition evidence standard. The configured policy must fit the currently implemented vocabulary. Test-fixture approval strings do not qualify.
- Operational checkout timeout and telemetry retention decisions, dedicated token secret, secure existing Razorpay **test** credentials, and separate advertising operation gates. No `VITE_*` server secrets.
- A public HTTPS callback accepted by Razorpay and operator access to the correct merchant Dashboard in **Test mode**. Nothing in this task installed a tunnel, created a callback or changed the Dashboard.
- An operator able to complete the real test Checkout/bank interaction. No session tokens, gateway secrets or full provider payloads should be copied into this report.

Razorpay documents that remote webhook delivery needs a public URL and that some tunneling/interceptor domains are blocked; a loopback-only fixture cannot receive it. Use an approved staging callback rather than assuming a particular tunnel is acceptable. [Razorpay webhook validation/testing](https://razorpay.com/docs/webhooks/validate-test/).

## Staging setup and read-only database verification

1. Record the non-secret staging identifier and policy approval reference in restricted acceptance evidence. Confirm test/live separation before signing in.
2. Verify transaction topology using `hello` and the actual application driver. A replica-set name, primary and sessions are useful checks; commit and intentional rollback on a disposable probe collection are the behavioral proof. Run writes only on the explicitly isolated test database. Standalone must fail closed with 503.
3. Read index metadata for `payments`, `adevents`, `adwebhookreceipts` and `seller_ledger_entries`; use the actual Mongoose collection names if database naming differs. Do not use `syncIndexes`, delete indexes or repair production schema from this checklist.
4. Compare **key definitions, uniqueness, partial filters and TTL options**, not just index names:

| Collection | Required index / semantics |
| --- | --- |
| payments | Built-in `_id` uniqueness; an advertising Payment `_id` equals its campaign ID |
| payments | `advertising_gateway_order_unique`: unique `{ "gateway.orderId": 1 }`; partial filter requires advertising.campaignId objectId AND gateway.orderId string |
| payments | `advertising_capture_unique`: unique `{ "captures.gatewayPaymentId": 1 }`; partial filter requires advertising.campaignId objectId AND captures.gatewayPaymentId string |
| adevents | Built-in `_id` uniqueness for hashed serving nonce + type |
| adevents | `{ expiresAt: 1 }`, `expireAfterSeconds: 0` |
| adevents | `{ campaignId: 1, revision: 1, mode: 1, type: 1, at: 1 }` |
| adwebhookreceipts | Built-in `_id` uniqueness for hashed provider delivery ID |
| seller_ledger_entries | Unique `{ idempotencyKey: 1 }` and unique `{ entryNo: 1 }` |

5. Record metadata assertions without the connection string. Provision missing staging indexes only through its separately approved staging setup procedure. This task provisions only test-owned disposable databases.
6. Configure only the isolated process using the gates documented in `backend/config/advertising.env.example`: management, billing, paid category delivery and refunds explicitly enabled; production remains disabled; free pilot independently configured. Require test mode and `rzp_test_` public key, matching server/webhook secrets, explicit timeout/retention and token secret. Preserve existing raw-body middleware. Application startup performs existing seed/index maintenance; use only the identified isolated database.

## External Checkout and provider delivery — operator steps

1. **Dashboard boundary:** in the existing merchant's Test mode, an authorized operator adds/confirms `<approved-public-staging-origin>/api/payments/razorpay/webhook`. Configure its matching secret through the secure staging mechanism and subscribe to `payment.captured`, `order.paid`, `payment.failed`, `refund.processed` and `refund.failed`. Preserve other integrations and their callback settings. Verify endpoint reachability and raw-body signature handling. Dashboard changes were not executed by this task.
2. Inspect the test account's capture setting. An authorization is not a capture. If the account needs a capture-setting change or manual capture, stop for the operator to take the approved test-mode action. Do not mark paid to work around it. Razorpay's documented order/payment states distinguish authorized from captured. [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).
3. Sign in through the **actual staging Admin login** as a permitted configuration actor. Create a package using the approved terms. Save its policy version and retain its approval reference. Do not use the local browser fixture package for a real provider acceptance transaction.
4. Sign in through the **actual staging Seller login** as an approved synthetic seller with an approved available product/variant in an active category/module. Create a campaign, pick a future start and the package, save, review the displayed base/tax/total and policies, and confirm/submit its current package version.
5. Review actor approves the current campaign revision. Finance actor independently authorizes the accepted terms, supplying the required external invoice reference. Missing policy/reference must block this step.
6. Record pre-payment finance state: no new advertising cash/revenue and no changes to merchandise escrow, seller payable/payout reservations, delivery wallets or order totals. Use restricted identifiers or hashes in shared evidence; do not export customer records.
7. Seller chooses **Pay accepted campaign amount**. Confirm amount/currency match the accepted quote and a single internal Payment/provider order is recorded. The shared Checkout must use the dedicated advertising verification route.
8. **User-interaction boundary:** complete real Razorpay Test Checkout with a provider-documented test payment instrument/mock bank flow. Follow the current provider test instructions; do not use real customer/card data. Retain only sanitized outcome evidence. The test-order transport probe alone does not satisfy this step. [Razorpay test integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/#2-test-integration).
9. Verify backend signature verification and authoritative provider fetch. Require provider state **captured**, exact amount/currency/order association, one matching stored capture and FUNDED campaign. A browser success or authorized payment is insufficient. Refresh Seller billing; pending must remain pending until verified.
10. Confirm a **remotely delivered** signed provider event reached the callback, produced a processed receipt and received a successful response. Correlate with Dashboard delivery evidence and the matching internal capture. A locally generated HMAC POST or a synthetic receipt is not remote-delivery evidence.
11. Replay/retry the same test delivery via supported Dashboard retry controls if available. Require unchanged receipt/capture counts and ledger amounts. If that action is unavailable, mark external replay not tested; do not substitute a local replay without labeling it separately.
12. Before the accepted start, no paid placement should appear. At/after start, check the real category with a serviceable synthetic customer and an organic exclusion that allows the selected product to appear. Verify Paid versus Pilot status, Sponsored labels, product/variant navigation and unchanged organic totals/pagination.
13. Keep the card at least half visible for one continuous second; require one durable impression, then one click after actual activation. Retrying the same valid serving-token/type must not increase counts. Do not record API responses as impressions. No event may change Payment or ledger state.
14. Wait for a genuinely approved short test schedule to expire; do not mutate an approved paid snapshot or overwrite service dates. Require suppression and COMPLETED state, while revenue remains unrecognized until separate approved finance review. If a short duration is not approved/supported, record real-time expiry as not tested and retain deterministic automated expiry evidence separately.

## Provider test refund and failure acceptance

1. Use a dedicated paid test campaign and its accepted policy. Seller/admin cancels or review actor suspends service as appropriate. Refund actor enters an allowed amount, capture, decision reason and required external credit-note reference through the advertising financial workspace. Do not issue an unrelated Dashboard refund as a substitute for the application workflow.
2. Keep refund gate enabled independently from new billing. Submit once. Confirm durable DISPATCHING/PENDING state before treating money as returned; ambiguous results must remain UNKNOWN and block a second dispatch.
3. Fetch the authoritative refund through application reconciliation, and confirm its ID/receipt/capture/amount/currency match the authorized request. Require **processed** before refund accounting and PARTIALLY_REFUNDED/REFUNDED state. No provider request acceptance alone counts as a completed refund. [Razorpay normal refund API](https://razorpay.com/docs/api/refunds/create-normal/).
4. Verify refund webhook delivery separately, then reconcile/replay without new financial postings. Require stopped delivery and cash/tax/liability or prior-recognition reversals confined to advertising accounts. Preserve original policy, invoice reference, credit-note reference and moderation history.
5. Validate interrupted requests/unknown order or refund results only with controlled staging fault injection, never by restarting live services. Restore connectivity and use reconciliation; do not initiate a new refund to resolve an unknown result.
6. Use separate test campaigns for Checkout dismissal/failure, different concurrent initiation keys, payment success after cancellation, invalid signatures and amount mismatch. Do not fabricate a provider amount mismatch or tamper with real gateway data. Local signed/provider-mock fault tests already cover these cases; list separately which are reproduced externally.
7. If an unexpected external refund, orphan payment or discrepancy appears, retain RECONCILIATION_REQUIRED / incident evidence. No manual “paid/successful” override is acceptable. Stop and obtain an approved recovery decision.

## Evidence record and release gate

For every case record: run ID, UTC timestamp, code revision/working-tree identity, environment identifier, policy/package/campaign revision reference, expected/actual outcome, evidence scope, pass/fail/blocked/not-tested and a restricted evidence reference. Shared reports should use hashes/aliases for provider identifiers, never full responses, secrets, tokens or customer details. A saved HAR can contain credentials; it is not an appropriate shared report artifact.

Keep these confirmations separate:

| Provider acceptance | Required evidence |
| --- | --- |
| Order created | Authoritative provider order fetch with matching test order/amount/currency |
| Real test capture | Actual Checkout completion plus fetched captured payment bound to accepted campaign |
| Remote webhook | Provider Dashboard delivery evidence plus authenticated server receipt and matching transaction |
| Provider test refund | Application-authorized provider refund fetched as processed and matching isolated accounting reversals |

Production remains blocked until approved policies/issuer capability, isolated external acceptance evidence, target index/topology verification and a separate release decision exist. Statutory invoice generation, fee expense and bank settlement posting are still gaps, not enabled by this checklist. No production flags or live credentials are needed to execute any step here.
