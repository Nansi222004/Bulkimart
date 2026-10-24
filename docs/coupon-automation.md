# Coupon automation and threshold progress

Active coupons are evaluated automatically for the current customer and cart. When an existing coupon satisfies its configured eligibility rules, it can be automatically selected and applied. No separate admin auto-apply setting is required.

The existing `Coupon` model and `evaluateCoupon` service remain authoritative for activity, dates, total/per-customer usage, first-order eligibility, channel, product, seller and category scope, minimum spend, discount caps and free-delivery eligibility. All active coupons participate in automatic evaluation. Existing offer visibility (`isPublic`) still controls the manual offers/progress UI, not automatic eligibility; unlisted codes can still be entered manually. No evaluator, pricing, order transaction or payment rule was changed.

`GET /api/coupons/available` reads the reconciled live cart without redeeming a coupon. It evaluates active offers before ranking them: eligible offers first, highest backend-quoted saving, lower minimum spend, then coupon code. The client preserves that order and applies one eligible coupon. There is no database-result-order selection or stacking. Existing documents may retain the retired `autoApply` field; it is ignored and omitted from API responses. No data cleanup or migration is required.

Customers can continue viewing offers, entering codes, selecting a different coupon manually and removing an applied coupon. Automatic selection does not replace an already applied valid coupon. Removing a coupon suppresses immediate reapplication to the unchanged cart; a later cart change can trigger evaluation again.

Cart changes (including quantity, variant, price, product/category/seller, fulfilment or delivery-mode changes), opening Cart, and opening Checkout refresh backend offers. Identical cart-summary responses and overlapping page requests do not discard an evaluation. An eligible candidate is validated again and the backend reprices the cart before the code, totals or celebration are confirmed. A failed validation or reprice produces no application celebration.

A newly confirmed application queues one celebration with the saving returned by the priced cart. If application happens while browsing, it waits until Cart or Checkout is visible. Re-renders, repeated cart reads, offer refreshes and returning to a page do not replay it. Confetti is hidden for `prefers-reduced-motion`; the savings message remains available.

Threshold progress is separate from eligibility to apply. A coupon below its minimum gets progress only if it passes every other existing evaluator check. The current engine uses the **whole cart subtotal** for the minimum; scope determines which items receive the discount. For a ₹500 minimum and ₹340 subtotal, the API returns ₹160 remaining and 68% progress. The UI describes the configured percentage (including its cap), fixed saving or free delivery. Free-delivery wording appears only for a real `free_shipping` coupon. At ₹500, the backend reevaluates; application and confetti still wait for validation and repriced confirmation.

Automatic application requires one eligible retail delivery group. Grouped and wholesale checkout retain their existing rejection of coupons; this convenience flow does not change multi-vendor calculations or invent coupon-adjusted grouped quotes. Checkout independently revalidates the selected code against live products and prices. Redemption rechecks coupon validity and usage limits inside the existing order transaction; discovery, progress and quotes never consume a use. The Razorpay cancellation fix, COD, Coins, commissions, refunds and settlement logic are unchanged.

The existing `cdsMembersOnly` field still has no verified membership check in the authoritative evaluator. Those offers are explicitly excluded from automatic selection and threshold advertising. Manual evaluator behavior is unchanged; membership eligibility remains an existing limitation, not a rule bypassed by automatic selection.

Verification uses disposable local MongoDB records and frontend/provider fixtures. No production database, deployment or configuration change is required or performed.

Fresh verification on 24 October 2026:

| Suite | Passed |
| --- | ---: |
| Backend coupon automation | 24 |
| Backend transactional coupon redemption | 2 |
| Backend financial workflow | 107 |
| Backend finance permission/discount policy | 12 |
| Backend payment notifications and Razorpay cancellation | 23 |
| Backend storefront | 56 |
| **Backend total** | **224** |
| Frontend coupon automation | 18 |
| Frontend Razorpay overlay | 4 |
| Frontend payment UI | 7 |
| Frontend checkout | 38 |
| Frontend storefront | 32 |
| Frontend financial workflow | 46 |
| **Frontend total** | **145** |

The backend suites ran together using `node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand --runTestsByPath` with `verification/coupon-automation.test.js`, `coupon-redemption.test.js`, `financial-workflow.test.js`, `finance-permission-policy.test.js`, `payment-notifications.test.js`, and `storefront.test.js` (all paths under `verification/`).

The frontend suites ran together using `node --test` with `verification/coupon-automation-ui.test.mjs`, `verification/razorpay-overlay.test.mjs`, `verification/payment-ui.test.mjs`, `tests/checkout-ui.test.mjs`, `verification/storefront-ui.test.mjs`, and `verification/financial-workflow-ui.test.mjs`. The storefront suite was also rerun after extending its existing unlisted-offer assertion; all 32 tests passed, without adding them again to the total above.

Both `npm run build` commands passed. The frontend retains its existing large-chunk warning. No lint script exists in either package. The coupon-related `git diff --check` passed; `docs/storefront-studio.md` was not edited. These are focused regression results, not a claim that the complete repository test suite was run.
