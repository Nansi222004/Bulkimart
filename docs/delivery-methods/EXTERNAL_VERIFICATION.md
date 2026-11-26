# Delivery methods — questions for Shiprocket and for the accountant

Prepared 2026-11-26 at the close of the Easy Ship / Self Delivery / FBB work. Every feature switch is still off.
Send each section as written. Keep the written answers: several production switches depend on them (see "What each answer unlocks" at the end).

---

## A. Shiprocket support

**Context to paste first**

> We are a marketplace (Bulkimart) using one Shiprocket company account through the API (`/v1/external/...`). Sellers ship either from their own shop (each shop is a separate pickup location in our account) or from our own warehouse (a pickup location we register). Orders are created with `POST /v1/external/orders/create/adhoc`, couriers assigned with `POST /v1/external/courier/assign/awb`, and serviceability checked with `GET /v1/external/courier/serviceability/`. We want written confirmation of the points below before enabling Cash on Delivery shipments.

### A1. COD handling fee as an extra item line

We charge the customer a COD handling fee. We send it as an extra line in `order_items`:

```
{ "name": "Cash on Delivery handling fee", "sku": "BULKIMART-COD-FEE", "units": 1, "selling_price": <fee in rupees> }
```

1. Is a non-physical line like this accepted in `order_items` for a COD order? Does it need an HSN code, and does `tax` / `discount` need to be sent for it?
2. Does this line change the declared shipment value used for courier liability or insurance? If it does, how should we send it instead?
3. Does any courier partner reject, re-weigh or treat differently an order containing a non-physical line?
4. Is there a better supported field for a COD fee, other than an item line?

### A2. COD amount to collect, labels, invoices and taxes

We set `payment_method: "COD"` and expect the courier to collect exactly `sub_total + shipping_charges − total_discount`, which equals our order total including the COD fee line.

5. Please confirm the formula Shiprocket uses for the COD amount printed on the label and collected by the courier. Do `giftwrap_charges`, `transaction_charges` or any tax fields change it?
6. Will the COD fee line appear on the Shiprocket shipping label and on the Shiprocket-generated invoice? Can we suppress the Shiprocket invoice and use our own?
7. If an item line has `tax` set, is that tax added on top of `selling_price`, or treated as already included? (We send prices that already include GST.)
8. If the amount collected differs from the label (partial collection, refusal), how is that shown to us — in the API, the webhook, or only in the remittance report?

### A3. Gross versus net COD remittance

Our books record each COD remittance line per AWB and match it to the full order total.

9. Is COD remitted **gross** (the full amount collected), with freight and COD charges invoiced separately? Or **net** (collected amount minus freight, COD charges and other fees)?
10. If it is net, which deductions are made per AWB, and does the remittance report show gross collected, each deduction and net paid as separate columns per AWB?
11. Is there an API endpoint for remittance batches and per-AWB detail? Or only the dashboard/CSV report? Please name the endpoint or report.
12. What is the remittance cycle (for example D+2 or D+7 after delivery), and does early-COD change gross or net?
13. Can one AWB appear in more than one remittance batch (for example a correction)? How is that shown?

### A4. Courier charge deductions

14. How are freight, COD charges, RTO freight, weight-discrepancy charges and other adjustments billed: deducted from the wallet, from COD remittance, or invoiced?
15. Is the freight quoted by `courier/serviceability` (`rate` / `freight_charge`) the amount actually charged? When does the final charge differ (weight reconciliation, zone change, fuel surcharge)?
16. Is there an API or report giving the final charged amount per AWB, so we can reconcile against our quote?

### A5. Warehouse pickup location

We will register our own warehouse as a pickup location and ship orders for many sellers from it. Each order's seller is a different legal business; the warehouse is ours.

17. Can one pickup location ship orders whose invoices are in different sellers' names? Must the pickup location name, GSTIN or address match the invoice seller?
18. Which fields are required for the pickup location to become usable (`status`, `phone_verified`, address verification)? How long does verification take?
19. Can we add the pickup location through `POST /v1/external/settings/company/addpickup` and verify it through the API, or does it need manual approval?
20. Are there restrictions on the number of pickup locations, or on one location being used for very high order volume?

### A6. Serviceability

We now check serviceability at checkout for warehouse orders: `GET courier/serviceability` with `pickup_postcode` = warehouse pincode, `delivery_postcode` = customer pincode, `weight` in kg and `cod` = 1 or 0. We refuse the order when `available_courier_companies` is empty.

21. Is an empty `available_courier_companies` a reliable "no courier serves this route" answer? Can it also mean a temporary problem?
22. What rate limit applies to the serviceability endpoint? Is it acceptable to call it once per checkout attempt?
23. Does serviceability depend on the pickup location being registered and verified, or only on the pincodes?
24. Are COD serviceability and COD value limits per courier included in this response? Is there a maximum COD amount per shipment?
25. Do dimensions (length, breadth, height) change the answer, or only weight?

### A7. Reverse pickup (returns)

We create return pickups with `POST /v1/external/orders/create/return` and assign AWBs with `assign/awb` and `is_return: 1`.

26. Please confirm that reverse pickup is enabled on our account and which couriers support it.
27. For a return going to our warehouse, must the return destination be a registered pickup location, or is any address accepted?
28. How are reverse pickup charges billed, and are they in the same remittance or charge reports?
29. Is quality check at pickup (QC) available? What is the API field for it?
30. Which webhook statuses (or status codes) mark "picked up", "delivered back to origin" and "cancelled" for a reverse shipment?

### A8. Sandbox or test facilities

31. Is there a separate sandbox environment with its own base URL and test credentials, isolated from live billing and real couriers? Please name the base URL in writing. (The `apidocs` test portal and the standard API origin are not sandboxes.)
32. If there is no sandbox, what is the recommended way to test COD orders, labels and remittance without real shipments or charges (for example, test orders that are cancelled before pickup — are they billed)?
33. Can webhooks be sent to a staging URL for a test account, and can test webhooks be triggered manually?

---

## B. Accountant

**Context to paste first**

> Bulkimart is a marketplace. Sellers sell to customers on our platform; we collect payment, keep commission and pay sellers out. We are adding three delivery methods. (1) Easy Ship: we book the courier through our Shiprocket account. (2) Self Delivery: the seller delivers using our riders or their own courier. (3) Fulfilled by Bulkimart (FBB): the seller sends stock to our warehouse, we store, pack and dispatch it, and we charge the seller service fees. Prices shown to customers include GST. We need your written guidance before switching on the charges and credits below.

### B1. FBB service charges (charged by Bulkimart to the seller)

The charges are:
- **Storage:** a fixed amount per accepted unit, charged once when we receive the stock.
- **Packaging:** per order or per unit, charged when the order is packed.
- **Fulfilment:** per order or per unit, charged when the parcel leaves the warehouse.

They are recorded as amounts the seller owes us. They are recovered by deducting them from the seller's earnings before payout, or the seller pays them in advance online. No GST is added to them today.

1. Are these charges a taxable supply of services by Bulkimart to the seller? Which SAC code(s) and GST rate apply — one rate for all three, or different rates (storage/warehousing versus packing versus logistics)?
2. Should the rates we configure be GST-exclusive (GST added on top) or GST-inclusive?
3. Do we need to issue a tax invoice to the seller for these charges? At what point — per charge, per order, or one monthly invoice? What must it show?
4. When a charge is reversed (an admin correction), do we issue a credit note? Within what time limit?
5. When charges are recovered by deducting them from the seller's payout, is that set-off acceptable, and how should the payout statement show it? Is TDS or TCS relevant here?
6. When a seller pays in advance and we hold an advance credit, is GST due when we receive the advance, or when the service is performed?
7. Storage is charged once at receipt, even though the goods may stay for months. Is that acceptable, or must storage be charged by period?
8. Charges are kept when an order is returned or comes back undelivered (RTO). Any tax issue with keeping them?
9. The seller remains the seller of record (their invoice, their GSTIN) even though goods ship from our warehouse. Does our warehouse need to be added as an additional place of business on each seller's GST registration? Or on ours? What documents must travel with stock sent to the warehouse (delivery challan, e-way bill)?
10. Does our role as e-commerce operator (TCS under section 52) change for FBB orders?

### B2. Self Delivery fee credit (paid by Bulkimart to the seller)

For Self Delivery orders the seller arranges and pays the courier. The customer pays a delivery charge at checkout, which Bulkimart collects. We plan to pass that delivery charge to the seller when the seller hands the parcel to their own courier. The rule is fixed for each order at the moment of hand-off.

11. Who is the supplier of the delivery service to the customer — Bulkimart or the seller? How should the delivery charge appear on the customer's invoice?
12. If the delivery charge is passed to the seller, is it the seller's income (on which the seller pays GST) and our pass-through? Or our income, followed by a separate payment to the seller?
13. Does passing it to the seller change our TCS base or the commission base? Today commission is calculated on goods only.
14. What documentation do we need from the seller (their courier receipt, an invoice from them to us)?

### B3. COD handling fee (charged to the customer)

15. Our COD handling fee is shown to the customer as a separate charge and sent to the courier as an extra line on the shipment. Who is the supplier of this fee, what SAC and rate apply, and must it appear on the seller's invoice or on a separate Bulkimart invoice?

---

## What each answer unlocks

| Answer | Unlocks | Switch / setting |
|---|---|---|
| A1, A2 confirmed | Shiprocket COD for Easy Ship and FBB | `SHIPROCKET_COD_ENABLED=true` |
| A3, A4 | Correct COD remittance reconciliation (the code matches remittance lines to the full order total; "net" would show every line as `partial`) | Code change if net |
| A5 | Registering the warehouse pickup in the Admin → FBB → Warehouses screen | Warehouse `shiprocketPickupLocation` |
| A6 | Keeping or tightening the checkout serviceability rule | `FBB_SERVICEABILITY_STRICT` |
| A7 | FBB returns by courier | none (already built) |
| A8 | Testing anything above without live shipments | `SHIPROCKET_MODE=sandbox` only with a written sandbox URL |
| B1 | Charging FBB fees | `FBB_CHARGES_ENABLED=true` (FBB cannot sell without it) |
| B2 | Self Delivery fee credit | `SELF_DELIVERY_FEE_CREDIT_ENABLED=true` |
| B3 | COD fee on invoices | existing COD charge setting |
