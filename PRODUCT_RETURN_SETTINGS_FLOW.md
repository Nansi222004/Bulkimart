# Seller product return settings

Physical retail products now have return controls for both Quick Commerce and Shop All.

## Seller steps

1. Open **Seller -> Products**, choose the appropriate storefront, then create or edit the product.
2. In **General Info**, find **Allow Returns**.
3. Turn it off to make the product non-returnable. Turn it on to enable returns within its category or global policy.
4. Enter **Return window (days after delivery)**, or leave it blank to use the displayed default.
5. Save the listing. The editor previews the resulting customer label.

The seller chooses the product's actual window within the applicable admin maximum. For example, a limit of 7 days permits a product window of 1 through 7 days. A seller cannot override a category marked non-returnable or widen its maximum. Category lookup failures have a separate retry state.

## Global default and category precedence

Under **Admin -> Return Window Settings**, the admin can enable, disable or change the global return window. The configured development database was initialized to an active **7-day** global window; this is stored in the database and can be changed from the panel.

- A category with no policy inherits the global limit. Sellers must opt in per product; the global setting does not automatically make existing Shop All products returnable.
- An explicit category policy overrides the global setting. Inactive and zero-day category policies block returns.
- Missing or invalid category records never acquire return eligibility through the global fallback.
- Global changes apply to future retail purchases. Existing orders retain their saved terms. Wholesale keeps its previous category-policy behavior.
- Global saves use version checks to prevent one admin silently overwriting another admin's newer change.

## Customer and order behavior

- Product details show **N Days Return Available** or **Non-Returnable**, resolved by the backend from the saved seller setting and current category rule.
- The customer product shown in the original screenshot had `type: grocery` and `returnable: false`, explaining its non-returnable label. The seller screenshot was a new Shop All listing, where the control previously did not exist.
- The selected window and eligibility are recorded on each new retail order item. Delivery completion uses that recorded window to calculate the return deadline.
- Later product/category/global changes affect future purchases; existing orders retain their original terms.
- Existing Shop All products without an override retain their previous behavior where a category policy exists. A global fallback requires explicit seller opt-in. Existing Quick Commerce products retain their original opt-in flag. No product data was migrated or switched on automatically.
- Digital products do not acquire physical return eligibility. Wholesale retains its existing policy behavior.

## Implementation and verification

`Product.returnSettings` records the physical retail override and optional seller-selected days. The existing Quick Commerce `returnable` flag remains compatible. One policy helper is used for live product display and new-order snapshots. Server validation rejects non-whole, non-positive or above-limit seller windows, independently of browser checks. `GlobalReturnPolicy` stores the global window, version and change history; global-sourced order snapshots retain their source.

Global-default verification passed: 17 product-return API/checkout tests, 7 frontend tests, 18 existing return/product compatibility checks, and frontend/backend builds. Coverage includes seller opt-in, category precedence, disabled/zero-day restrictions, blank and stale admin saves, seller limits, and persisted order snapshots remaining unchanged after global edits. No live customer product policy was changed during testing.
