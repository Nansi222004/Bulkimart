# Dashboard financial figures — 26 October 2026

The configured database was audited read-only. Five commission rules exist. No financial records were changed, no provider transactions were initiated, and this patch has not been deployed.

## Confirmed causes

The revenue API always returned `status: unavailable` and `amountPaise: null`, regardless of posted income. The frontend validator also required revenue to be unavailable, and the chart repeated that message. Configuring commission rates could not enable the card.

Collections returned an incomplete status if any receipt lacked sufficient evidence, and the card then hid even the verified subtotal. The current data has two paid payments without a settled capture journal and one delivered COD order without cash verification. The two missing captures are payment-level issues; they do not mean that all three completed orders lack an online receipt.

All three completed orders lack their commission snapshots/postings:

| Order | Completed value | Recorded evidence |
| --- | ---: | --- |
| ORD-20261015-K2OCHK | ₹250.00 | Online payment marked paid; no settled capture recorded; no frozen commission snapshot or posting |
| ORD-20261019-CIRFK5 | ₹920.00 | COD payment pending; cash verification missing; no frozen commission snapshot or posting |
| ORD-20261023-6YWM0M | ₹940.00 | One settled capture for ₹940.00; no frozen commission snapshot or posting |

Commission settings define applicable rates. They do not establish the historical agreement or create earned-income ledger postings for an old order. Reading the dashboard must not recalculate historical earnings using today's rates.

## Result of the repaired calculation

The final read-only calculation against the configured database returned:

| Figure | Amount | Coverage |
| --- | ---: | --- |
| Completed order value | ₹2,110.00 | Complete |
| Verified external order collections | ₹2,800.00 | Verified subtotal; two missing captures and one unverified COD receipt remain |
| Posted platform income | ₹10.20 | Verified parcel income; commission evidence for three completed orders remains unresolved |

Order collections cover captured payments across fulfilment statuses, while completed order value covers delivered orders. These figures measure different things. Order collections exclude internal wallet transfers and are not bank settlement. Posted revenue includes supported order-commission entries, earned parcel revenue and recognized advertising revenue, net of corresponding ledger reversals. It excludes taxes, seller/rider payables, pending legal commissions and other fees outside this consolidation.

The cards now display verified amounts with an explicit **Verified subtotal · reconciliation pending** label when coverage is incomplete. Final totals remain null in the API until evidence is complete. Explanations include grouped issue reasons, resolutions, a revenue breakdown and an Open Finance Center action. Complete revenue returns an actual amount, including a genuine zero.

The calculation accepts reviewed historical commission postings and stops flagging a historical order once all its items have reviewed merchandise evidence. Pending/failed online checkouts with no captured receipt are excluded rather than reported as collection failures. The existing capture, refund, cash and immutable-history checks remain enforced.

## Completing reconciliation

1. Verify the two missing online captures against the original provider receipts and reconcile the durable payment journals. A `paid` flag alone does not establish collection.
2. Reconcile the ₹920 COD remittance and independent cash verification against the original evidence. This old order lacks the modern cash/snapshot records; its delivery status alone cannot establish verified cash.
3. In **Finance Center → Reports → Old orders**, review the three historical orders with their original commission agreements, payment/cash proof and refund/payout checks. Prepare, independently approve and apply the supported historical batch. Current rates are not a substitute for the original agreement. Historical seller entitlement review and external cash verification are separate checks.
4. Deploy the frontend/backend patch and refresh the dashboard. A read-only audit can be repeated from `backend` using `npm run audit:dashboard` against the explicitly intended `MONGO_URI`.

The audit disables model auto-indexing and collection creation. It returns order references, evidence flags and monetary summaries, without customer contacts or gateway credentials. Its order detail listing is capped at 1,000; aggregate metrics cover the full database. It does not perform reconciliation or create payouts/refunds.

## Verification

- Backend dashboard integration/unit tests: **29 passed**, using a disposable MongoDB replica set. Includes HTTP authorization, read-only behavior, captures/refunds, COD evidence, available revenue, parcel/advertising consolidation, reversals, historical review and incomplete subtotals.
- Frontend dashboard/card/chart tests: **17 passed**, using actual components with controlled hooks and an isolated Vite configuration. Includes complete revenue, partial amounts and labels, issue explanations, Finance Center navigation, contract validation and stale-request protection.
- Frontend production bundle passed through Vite's programmatic API with an explicit React plugin and `configFile: false`; the normal large-chunk warning remains. The default config bootstrap was not used. Output: `test-artifacts/dashboard-metrics/build`.
- `git diff --check` passed.
