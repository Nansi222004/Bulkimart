# Post-GST financial audit — 29 October 2026

Read-only investigation. Evidence came from raw MongoDB reads of database `bulkimart` (no application startup, jobs, writes or provider calls), the source code in the current working tree, and the test suites. **No code, order, ledger, payout or historical record was changed in this audit.** The uncommitted GST work (including session `bulkimart1-67`'s) was left as is.

## 1. GST implementation — verified, unchanged

- One calculator (`backend/services/productGst.service.js`) is used by cart, basket, both checkout paths, order snapshot validation, settlement (`vendorCommission.service.js`), refunds (`return.service.js`) and reports.
- Product GST is calculated without a commission rule; a missing rule only blocks settlement (`financialSnapshot.lines[].blocker`), while the snapshot still stores taxable value and GST.
- Order snapshots are immutable through the application (`Order.js` hooks).
- Tests now: GST backend 38/38, GST frontend 6/6, frontend production build passes. Last full run: backend `verification` 1084/1084; backend `__tests__` 825 pass, 8 fail — the same 8 that fail on the clean last commit.

## 2. Commission and historical settlement

**How a rule is chosen** (`vendorCommission.service.js`): at order creation the snapshot reads only the *current-rule pointers* in `commission_current_rules` for the order's channel (`salesChannel: wholesale` → wholesale, `type: ecommerce` → ecommerce, else quick), then picks product > category > channel-wide among enabled rules. With no pointer the snapshot is frozen as `held_missing_rule`; nothing later re-applies a current rule (correct).

**Commission records**

| Rule | Scope | Rate | Enabled | Effective (UTC) | Current pointer |
|---|---|---|---|---|---|
| …000001/2/3 | seeded legacy | no method/value | yes | 2026-01-01 | no |
| …c12ccc | general | 10%, commission GST inclusive 0% | **no** | 24 Oct 15:04 | no |
| …f35caa | general | 10%, inclusive 0% | yes | 24 Oct 11:28 | **no** |
| …e7a716 / e7a717 / e7a718 | ecommerce / quick / wholesale | 10%, inclusive 0% | yes | **27 Oct 06:03** | yes |

Finding C1 (configuration gap, confirmed): an enabled 10% general rule (…f35caa) existed from 24 Oct 11:28, but it never had a current pointer, so every order until the pointers were created on 27 Oct 06:03 froze as `held_missing_rule`. This is why the affected seller balances are zero.

**Orders whose seller net cannot be calculated today**

| Order | Status | Seller | Gross | Evidence available |
|---|---|---|---|---|
| ORD-20261015-K2OCHK | delivered | Neelam store | ₹250 | no finance snapshot at all |
| ORD-20261019-CIRFK5 | delivered (COD) | Neelam store | ₹900 | no finance snapshot |
| ORD-20261023-6YWM0M | delivered | Neelam store | ₹900 | no finance snapshot |
| ORD-20261026-QENNXK | delivered | Alwayss | ₹1,300 | held_missing_rule; rule …f35caa was enabled and effective |
| ORD-20261026-N1GLO2 | delivered (COD, disputed) | Alwayss | ₹500 | as above |
| ORD-20261026-9XDA4G | delivered (COD verified) | Alwayss | ₹1,800 | as above |
| ORD-20261026-2P2B39 | delivered | Alwayss | ₹200 | as above |
| ORD-20261027-2GP37A | delivered (COD reported) | Alwayss | ₹500 | as above |

Not delivered but also `held_missing_rule`: ORD-20261027-D649JL (dispatched), ORD-20261027-A2S5UI (preparing). ORD-20261024-ICT6OD was placed at 08:41, *before* …f35caa took effect — no rule evidence. Whether …f35caa was the agreed commission for those orders is a finance decision; the existing *Old orders* review workflow is the place to apply it.

## 3. Return window and settlement release

- Policy: global 7 days (`globalreturnpolicies`), category overrides of 2 and 7 days. The clock starts at each item's `deliveredAt`; the purchased policy is frozen on the item (`items.returnPolicy`, `items.returnEligibleUntil`). Items with `returnEligible: false` have no hold.
- Release (`financeAutomation.service.js`, every 2 minutes, retry after 15 minutes on error): post seller earnings when delivered **and** paid (online: captured; COD: admin-verified receipt) → release each line when its window has passed and no return is open or unreconciled.
- **No order has passed its window yet** (earliest `returnEligibleUntil`: 2 Nov 10:01), so no seller release is due; no early release was found.
- Only one order has posted seller earnings: ORD-20261029-AB6UMU — seller payable ₹1,258.20 held (₹358.20 + ₹900), commission ₹139.80 (10% of ₹398 and ₹1,000); window ends 5 Nov 07:45; two returns open.

Open returns that will hold settlement past the window: QENNXK (APPROVED since 26 Oct, no pickup), 2GP37A (APPROVED), QK0JQL (REFUND_PENDING after a 27 Oct pickup), AB6UMU (REFUND_PENDING + APPROVED), 9KHCXU (REFUNDED, not finance-reconciled because the order is not yet posted).

Delivered COD orders with a commission rule but **no seller posting**, because the admin has not verified cash receipt: ORD-20261027-53Z8C3 (₹520 collected), ORD-20261027-QK0JQL (₹490), ORD-20261029-9KHCXU (₹500). This is the designed rule, but it is the main reason the seller has no posted earnings.

## 4. Confirmed and suspected bugs

**B1 — Rider earnings wait for the seller's return window (confirmed, high).** In `runFinanceAutomationOnce`, the seller release step runs first; while the return window is open it fails and stamps `financeAutomation.lastAttemptAt`. The rider release query uses the same `due()` filter, so the order is skipped in the same run and in every later run until the seller release succeeds. Evidence: ORD-20261029-AB6UMU is online and paid, rider …d900's ₹70 is still `held`, `financeAutomation.lastError: "Delivery evidence, return hold or financial reconciliation has not cleared"` (step `release`). ORD-20261026-QENNXK released in two minutes only because it had no seller posting. Effect: rider pay delayed ≥ 7 days on every order with posted seller earnings. Fix: keep retry state per step (`financeAutomation.release` vs `rider_release`), or exclude rider release from the seller step's back-off.

**B2 — Rider payout destination is not verified (confirmed, medium).** `deliveryPayout.service.js:76` only checks that an account number or UPI ID is present, while the message says "Verified payout destination is required"; completing a rider payout (`:100`) needs a transfer reference and reason only. Seller payouts require reviewed beneficiary-ownership proof for the exact destination (`payoutEvidence.service.js:19`). No rider or seller record has a verified-bank flag set.

**B3 — Commission rule without a pointer is silently ignored (configuration, medium).** See C1. Saving rules should always create or confirm the current pointer, and the admin screen should flag an enabled rule that applies to nothing.

**B4 — Malformed order record (data, low).** `6ac9f9f7b7d1eb9a888b49eb` (10 Oct, cancelled): no `orderNo`, no `paymentMethod`, items without `qty`, `paymentStatus: PENDING_CASH_COLLECTION`. Excluded from every finance calculation; should be reviewed and documented.

**S1 — Order delivered without a delivery record (suspected).** ORD-20261015-K2OCHK (online, Neelam) was created at 19:19 and marked delivered at 19:20 with no `deliveries` record. Needs the status-change audit trail.

**S2 — Rider legacy counter not backed by the ledger (known).** Rider …4ea4 `earnings.pending` ₹256 has no matching eligible ledger entries (previous audit).

## 5. COD cash (blocks seller and rider settlement)

| Order | Expected | Rider recorded collected | Reported handover | Verified | Status |
|---|---|---|---|---|---|
| ORD-20261026-N1GLO2 | ₹420 | ₹266 | ₹2,500 | ₹2,500 | **disputed** — ledger `cod_excess_liability` ₹2,080 |
| ORD-20261026-9XDA4G | ₹1,790 | ₹1,790 | ₹1,790 | ₹1,790 | verified |
| ORD-20261027-2GP37A | ₹440 | ₹200 | ₹100 | — | remittance reported (shortage) |
| ORD-20261027-53Z8C3 | ₹520 | ₹520 | — | — | collected, not handed over |
| ORD-20261027-QK0JQL | ₹490 | ₹490 | — | — | collected, not handed over |
| ORD-20261029-9KHCXU | ₹500 | ₹500 | — | — | collected, not handed over |

The ₹2,500 handover against ₹266 collected on N1GLO2 was accepted by older code; the current `recordCodEvent` refuses a handover above the collected amount. The collected figure is typed by the rider; a shortage stays visible until verified or written off.

## 6. Seller payouts

Flow: eligible balance → request (`sellerPayout.service.js`: approved seller, ≥ ₹500, no negative held balance, no disputed COD / unreconciled adjustments, eligible ≥ amount; reserves funds with an idempotent ledger debit) → admin review → recorded transfer with beneficiary proof. Schedule `on_request`.

Status: **no seller has any eligible balance, and no seller payout has ever been requested** (`seller_payouts` is empty). Alwayss: ₹1,258.20 posted but held (AB6UMU), three COD orders awaiting receipt verification, five delivered orders without a commission rule. Neelam store: three delivered orders without a finance snapshot.

## 7. Rider earnings and payouts

Rider …d900 (ledger and profile counters agree):
- Eligible ₹220: QENNXK ₹60, 9XDA4G ₹40, and three return pickups (QK0JQL, AB6UMU, 9KHCXU) ₹40 each — return-pickup earnings are posted directly as eligible.
- Held ₹290: N1GLO2 ₹60 (COD disputed), 53Z8C3 ₹60 and QK0JQL ₹40 and 9KHCXU ₹60 (COD not verified), AB6UMU ₹70 (bug B1). Parcel earnings ₹17.12 are held in a separate account.
- Cannot request a payout: disputed COD (N1GLO2) and ₹1,510 of collected cash not yet handed over both block it, even though ₹220 ≥ the ₹100 minimum.

Rider …4ea4: held ₹40 (2GP37A, COD shortage reported, not verified), parcel ₹10.20 held, eligible ₹0; legacy counter ₹256 unexplained (S2).

**The ₹40 and ₹60 entries**: ₹40 is rider …4ea4's delivery earning on ORD-20261027-2GP37A, held because the COD cash (₹200 of ₹440) is not verified; ₹60 entries are rider …d900's held earnings on N1GLO2 (disputed COD) and 53Z8C3 / 9KHCXU (cash not handed over). The ₹60 on QENNXK and ₹40 on 9XDA4G were released correctly once paid/verified.

No rider payout has ever been requested (`deliverypayouts` is empty).

## 8. Historical product GST — proposed backfill (not executed)

Re-run of `scripts/productGstHistoricalDryRun.mjs` (read-only, refuses `--apply`) matches the first run exactly.

- **Reconstructable (17)**, rate frozen in the finance snapshot, inclusive by precedent: 0ERUVR (cancelled), QENNXK, N1GLO2, 9XDA4G, SF614G (cancelled), Q40IOT (cancelled), NDVE25 (cancelled), 2GP37A, D649JL, A2S5UI, 53Z8C3, QK0JQL, 8DD6A6 (cancelled), BJGOTK, IH3FEL (cancelled), AB6UMU, 9KHCXU — e.g. ₹500 at 5% inclusive = ₹476.19 taxable + ₹23.81 GST.
- **Needs review (2)**, frozen 0% may be the old fallback: ORD-20261024-ICT6OD (cancelled), ORD-20261026-2P2B39 (delivered).
- **Insufficient evidence (17)**: every order before 24 Oct and the malformed record — leave untouched.

Plan for approval: back up (`scripts/backupBulkimartTarget.mjs` or an Atlas snapshot) → re-run dry run and approve the exact ids (decide whether cancelled orders are included) → reviewed apply script writing only `productTax` / `items.$.productTax`, guarded by `productTax: { $exists: false }` → verify (dry run shows them `complete`; `productTax.grossPaise = round(pricing.subtotal × 100)`) → rollback by unsetting those two fields for the same ids. Details: `docs/product-gst-implementation.md`.

## 9. Test results

| Suite | Result | Baseline? |
|---|---|---|
| Backend verification (46 suites) | 1084/1084 | — |
| Backend `__tests__` | 825 pass, 8 fail | all 8 fail on the clean last commit (order-flow audit ×7, razorpay-webhook load error, seller-first "ready step") |
| GST backend / frontend | 38/38, 6/6 | new |
| Frontend related suites | pass except unified-basket-ui (3), cart-quantity-ui (3), seller-profile-wholesale (1), seller-notifications (1) | all fail with the last-commit versions of the changed files too |
| Frontend production build | passes | — |

Not run: a browser checkout in a sandbox environment (no controlled environment was started in this audit), any real transfer or payment.

## 10. Accounting decisions and external dependencies

1. Was the 10% rule …f35caa the agreed commission for orders between 24 Oct 11:28 and 27 Oct 06:03? What applies to Neelam store's three pre-snapshot orders?
2. N1GLO2: what cash was actually received (₹266, ₹420 or ₹2,500)? Bank / hub evidence is needed before the dispute and the ₹2,080 excess can be resolved.
3. 2GP37A: collect the ₹240 shortage or write it off (policy: Bulkimart absorbs verified shortages).
4. Should rider payouts require the same beneficiary-ownership proof as seller payouts?
5. Product GST questions Q1–Q6 in `docs/product-gst-implementation.md` (place of supply, platform-funded discounts, delivery GST, TCS base, tax invoices, wholesale).

## 11. Prioritized repair plan

1. **Operations (no code):** riders hand over COD cash for 53Z8C3, QK0JQL, 9KHCXU; admin verifies receipts in Finance Center → COD cash; resolve the N1GLO2 dispute and 2GP37A shortage. This unblocks Alwayss's three configured orders and rider …d900's payouts.
2. **Fix B1** (rider release blocked by seller back-off) with a regression test.
3. **Fix B3**: make saving commission rules maintain current pointers; warn on enabled rules with no pointer.
4. **Decide and apply** historical commission for the five delivered `held_missing_rule` orders and Neelam's three orders through the Old orders review workflow, using the evidence above.
5. **Decide B2** (rider beneficiary verification) and implement parity if approved.
6. **Approve and run** the product GST backfill per section 8.
7. Review the malformed order (B4), the instant delivery (S1) and rider …4ea4's legacy counter (S2).
