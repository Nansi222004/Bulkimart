# Return repair audit — 2026-10-25

Baseline: clean Git working tree. The code-review-graph tools are not exposed in this session; repository searches are the fallback. No production connection, migration, refund, payout or pickup is authorized.

| Severity | Location | Confirmed issue / repair |
|---|---|---|
| Critical | `order.controller.js::requestReturn` | Legacy route changes order status without an item Return. Deprecate with an actionable canonical endpoint response. |
| High | `order.controller.js` single checkout | Product settings ignored; reuse `applyProductReturnSettings` from grouped checkout. |
| High | `return.service.js::transitionReturnStatus` | Receipt and QC can be bypassed. Require seller receipt and explicit inspection before stock/refund. |
| Critical | `return.service.js::processReturnRefund` | COD requires offline settlement; wallet credit/payment projection are separate writes. Commit wallet evidence and payment totals transactionally, recover Return finalization by durable credit. |
| High | `return.service.js::completeRefund` | Coin restoration errors swallowed before terminal success. Make restoration and Return finalization transactional. |
| High | `orderFinance.service.js::releaseOrderFinance` | Whole-order hold blocks unrelated lines. Release each eligible financial line once, preserve the existing order posting enum. |
| High | `sellerSettlementEligibility.service.js` | Any active return blocks all seller payouts. Permit unrelated funds when the affected line is still held; retain controls for already released funds and disputes. |
| Critical | `paymentRecovery.service.js::processRefundObligation` | A competing same-value return can be adopted as proof for another return. Restrict legacy adoption to cancellation compatibility; enforce original capture and obligation identity. |
| High | `returnPickup.service.js` | No explicit method, no inter-city guard, offer acceptance lacks positive offer check, receipt/earnings writes can partially commit. Add method and ownership guards and atomic receipt. |
| High | Return / Shiprocket integration | Placeholder courier fields only. Extend existing provider client with documented reverse operation, durable dispatch, reconciliation, cancellation and verified tracking. |
| Medium | Returns UI | Stale refund/inventory copy, manual-only pickup. Expose explicit methods and actual refund destination/status. |

Accounting finding: `financeReports.service.js::accountPair` already maps `rider_payable/delivery_earning` to debit Delivery cost / credit Rider payable. Do not add an arbitrary duplicate expense entry.

Follow-up finding: coin restoration passed `RETURN` while `COIN_REFERENCE_TYPE` omitted that value; the old finalization swallowed the resulting error. Added the valid reference and made coin restoration/finalization transactional. Dispute events previously lacked a merchandise settlement hold; signed event recording and shared release/payout gates now enforce one.

Implementation and actual final verification results: [return-repair-results.md](return-repair-results.md).

Baseline executed: focused Jest 20 passed / 2 failed (Razorpay webhook HTTP mocks); financial-workflow, seller-refund-integration, product-returns 126 passed. Frontend build fails before changes with outbound EACCES. Full backend build invokes obfuscated `backend/api.js`; it was inspected but not executed. Direct `node --check backend/index.js` and `checkServicePackage.mjs` passed. Logs are in `test-artifacts/return-repair`.

Provider references: https://apidocs.shiprocket.in/?version=latest and https://apidocs-test.shiprocket.in/guides/returns-workflow/ . API credentials operate on real account data; documentation hosts are not sandbox hosts. Only mocked transports may be used here. Delivery-fee refunds have no approved item allocation policy; existing exclusion is retained and must be decided separately by the business.
