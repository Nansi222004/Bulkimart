# Delivery methods — local / staging test guide

How to test Easy Ship, Self Delivery and Fulfilled by Bulkimart (FBB) end to end, on a local machine or an isolated staging server, without touching live data, live money or live shipments.
Written 2026-11-26 against the code in this repository.

---

## 0. Safety rules (read first)

1. **Mobile apps talk to the LIVE API by default.**
   - `mobile-seller/src/config/env.js` and `mobile-delivery/src/config/env.js` use `https://api.bulkimart.in` unless `STAGING_API_URL` is set. It is used only in debug builds (`__DEV__`) and must be HTTPS.
   - The customer app reads `extra.apiBaseUrl` in `mobile-user/app.json`.
   - Point all three at staging before logging in. Never log in to a debug build that still points at production.
2. **Separate database.** `MONGO_URI` must point to a staging/local database, never production. MongoDB must be a **replica set** (Atlas, or a local single-node replica set), because checkout, warehouse stock and ledgers use transactions.
3. **No live integrations.**
   - `SHIPROCKET_MODE=mock` (Shiprocket has no confirmed sandbox; see `EXTERNAL_VERIFICATION.md` A8).
   - `RAZORPAY_MODE=test` with `rzp_test_` keys only.
   - `OTP_MODE=mock`, `SMS_USE_LIVE=false`.
   - `FCM_MODE=mock` and `MAPS_MODE=mock` unless you have staging Firebase/Maps projects.
4. **Production refuses to boot with mocks** unless it is an authorised staging deployment: `NODE_ENV=production` + any mock needs `DEPLOYMENT_ENV=staging`, `ALLOW_MOCK_SERVICES=true` and `STAGING_DATA_ISOLATED=true` (`backend/config/runtime.js`). Never set these on `api.bulkimart.in`.
5. **Never enable delivery-method switches on production** until the deployment is approved (see the closure report).

---

## 1. Backend

```powershell
Set-Location D:\Appzeto_Projects\Bulkimart1\backend
npm install --ignore-scripts      # this machine: always --ignore-scripts
npm run dev                       # nodemon index.js; or: npm start
```

The server listens on `PORT` (default **5050**). Check `GET http://localhost:5050/api/health`. All routes are under `/api`.

### Environment (backend `.env` for local, or the staging host's environment)

Copy `backend/.env.example` and set at least:

| Variable | Local / staging value |
|---|---|
| `NODE_ENV` | `development` locally; `production` on a staging host (then also the three staging guards below) |
| `MONGO_URI` | staging/local replica-set URI |
| `JWT_SECRET` | any long random string (not production's) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | seeds one **Super Admin** on first start (`backend/config/db.js`) |
| `CORS_ORIGINS` | e.g. `http://localhost:5173` (staging: the staging web origin) |
| `OTP_MODE` / `SMS_USE_LIVE` | `mock` / `false` |
| `SHIPROCKET_MODE` | `mock` |
| `PAYMENT_GATEWAY` | `razorpay` |
| `RAZORPAY_MODE` | `test` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Razorpay **test** dashboard values (`rzp_test_…`) |
| `FCM_MODE`, `MAPS_MODE` | `mock` (or staging projects) |
| `CLOUDINARY_*` | a staging Cloudinary account (product images) |
| Staging host only | `DEPLOYMENT_ENV=staging`, `ALLOW_MOCK_SERVICES=true`, `STAGING_DATA_ISOLATED=true`, `PUBLIC_API_URL=https://<staging api>` |

Delivery-method switches. All are off when absent; only the exact text `true` turns one on. See §5 for the order.

| Variable | Effect |
|---|---|
| `DELIVERY_METHODS_ENABLED` | Sellers may choose Self Delivery (and FBB, with the switches below) |
| `FBB_ENABLED` | FBB may be chosen and sold |
| `FBB_CHARGES_ENABLED` | FBB charges are booked; **FBB cannot be sold or receive stock without it** |
| `WAREHOUSE_OPERATIONS_ENABLED` | Admin may receive stock and approve adjustments |
| `FBB_ALL_SELLERS_ENABLED` | Opens FBB to every seller. Leave **off** for the pilot; use Admin → FBB → Pilot sellers instead |
| `FBB_SERVICEABILITY_STRICT` | Refuse FBB checkout when courier coverage cannot be confirmed (default: refuse only on a definite "no") |
| `SHIPROCKET_COD_ENABLED` | COD parcels may be booked with Shiprocket. **Off** until Shiprocket answers A1–A3 |
| `SELF_DELIVERY_FEE_CREDIT_ENABLED` | Customer delivery charge is credited to the seller on own-courier hand-off. **Off** until the accountant answers B2 |

---

## 2. Web frontend (customer site, seller panel, admin panel)

```powershell
Set-Location D:\Appzeto_Projects\Bulkimart1\frontend
npm install --ignore-scripts
npm run dev          # vite --host, http://localhost:5173
```

Point it at your backend with `VITE_API_BASE_URL` (for local work, `http://localhost:5050`). The keys are listed in `frontend/.env.staging.example`; a staging build uses `npm run build` with those values.
Customer site: `/`. Seller panel: `/seller`. Admin panel: `/admin`. Admin FBB workspace: sidebar **FBB Warehouse & Orders**.

## 3. Mobile apps (native CLI, real phones only)

For each app:
1. Set the staging URL: `STAGING_API_URL = 'https://<staging api>'` in `mobile-seller/src/config/env.js` and `mobile-delivery/src/config/env.js`, and `extra.apiBaseUrl` in `mobile-user/app.json`.
2. Run:

```powershell
Set-Location D:\Appzeto_Projects\Bulkimart1\mobile-seller   # or mobile-user / mobile-delivery
npm start            # Metro
npm run android      # second terminal; debug build on a connected phone
```

Gradle on this machine: `$env:GRADLE_USER_HOME='D:\build-cache\gradle-home'`.
**Revert the staging URLs before any release build.**

---

## 4. Database and test data

1. **Super Admin:** start the backend once with `ADMIN_EMAIL` / `ADMIN_PASSWORD` set. The Super Admin passes every permission check.
2. **Restricted admins** (to test permission separation). There is no admin-management screen, so create them in `mongosh` on the **staging** database, reusing the Super Admin's password hash:

   ```js
   const sa = db.admins.findOne({ role: 'superAdmin' });
   const base = { password: sa.password, role: 'admin', isActive: true, createdAt: new Date(), updatedAt: new Date() };
   db.admins.insertMany([
     { ...base, name: 'Warehouse Ops', email: 'warehouse@staging.test', permissions: ['manage_warehouse'] },
     { ...base, name: 'Finance', email: 'finance@staging.test', permissions: ['manage_finance'] },
     { ...base, name: 'Catalogue only', email: 'catalogue@staging.test', permissions: ['manage_products'] },
   ]);
   ```

   - `manage_warehouse`: warehouses, receiving, stock, adjustments, FBB orders and returns, pilot sellers.
   - `manage_finance`: FBB rates, charges, billing and settlement; COD charge; commissions; COD remittances.
3. **Sellers:** register three test sellers through the seller app or web (OTP is mocked), complete onboarding and approve them in Admin. Suggested roles:
   - **Seller A:** Easy Ship. Has a store address with pincode and coordinates, and a linked Shiprocket pickup (mock).
   - **Seller B:** Self Delivery. Save a **Self Delivery area** (Store profile → Self Delivery area): one state or a few pincodes.
   - **Seller C:** the FBB pilot seller. Seller D: any other approved seller, to prove FBB stays closed to them.
4. **Finance configuration (Finance admin):**
   - a commission version for E-commerce (Admin → Finance → Commissions);
   - the COD charge (Admin → COD charge).
   - FBB rates come later, in §6.
5. **Products:** for each seller, physical Shop All products with variants, a weight (grams) and stock.
6. **Customers:** two test customers with addresses.
   - Address 1 inside Seller B's Self Delivery area.
   - Address 2 outside it.
   - Use real 6-digit pincodes; FBB checkout sends them to the courier check.
7. **Riders:** register one or two riders in the delivery app, approve them, and put them on duty near the test stores and warehouse.

---

## 5. Switch-on order (staging only)

Turn switches on in this order, restarting the backend after each step. Run the related workflow before the next step.

| Step | Set | Then test |
|---|---|---|
| 0 | none | Baseline: everything behaves as before; the product form offers only Easy Ship; Quick Commerce is unchanged |
| 1 | `DELIVERY_METHODS_ENABLED=true` | Easy Ship + Self Delivery (§7, §8) |
| 2 | `WAREHOUSE_OPERATIONS_ENABLED=true` | Warehouse set-up (§6); receipts can be counted but **not posted** yet |
| 3 | `FBB_ENABLED=true`, `FBB_CHARGES_ENABLED=true` | FBB for the pilot seller only (§9) |
| 4 | optional `FBB_SERVICEABILITY_STRICT=true` | Repeat the FBB checkout tests |
| 5 | only after the external answers: `SHIPROCKET_COD_ENABLED`, `SELF_DELIVERY_FEE_CREDIT_ENABLED` | COD courier bookings; own-courier fee credit |
| 6 | switch-off drill: turn FBB/charges off again | §12 |

`FBB_ALL_SELLERS_ENABLED` stays off throughout the pilot.

---

## 6. Warehouse initialisation (Admin → FBB Warehouse & Orders)

1. **Warehouses → Add warehouse** (manage_warehouse).
   - Enter code, name, 10-digit phone, address, pincode, latitude and longitude.
   - Shiprocket pickup location name: in mock mode use any name, e.g. `BKM-STAGING`.
   - In live use, the location must first be registered and verified in Shiprocket (A5).
2. **Charges & billing → new rate version** (manage_finance): storage per unit, packaging and fulfilment (per order or per unit), and a reason. Use small test amounts, e.g. ₹1 / ₹4 / ₹2.
3. **Overview** should now show *Ready for sellers: Yes* (needs step 3 switches, an active warehouse and a rate version).
4. **Pilot sellers:** search Seller C, enter a reason and click *Add to pilot*. Leave Seller D out.

---

## 7. Easy Ship workflow (Seller A)

1. Customer buys an Easy Ship item (web and customer app), once **online (Razorpay test)** and once **COD**.
2. Seller accepts → start preparing → ready for pickup. On *Arrange delivery*, check:
   - *Bulkimart rider*: on-duty riders near the shop are listed.
   - *Shiprocket*: available for the prepaid order (mock courier quote). For COD it is shown as unavailable while `SHIPROCKET_COD_ENABLED` is off.
3. Book Shiprocket on the prepaid order. The label/AWB come back in mock mode. Hand off and deliver (mock tracking or admin).
4. Cancel a third order before dispatch: stock returns to the seller.
5. Expect: no FBB fields on these orders, and no courier check at checkout. Easy Ship checkout is unchanged.

## 8. Self Delivery workflow (Seller B)

1. Seller B switches a product to Self Delivery. Without a Self Delivery area this is refused (`SELF_DELIVERY_AREA_REQUIRED`).
2. Customer at **Address 2** (outside the area): checkout refused (`SELF_DELIVERY_NOT_SERVICEABLE`).
3. Customer at **Address 1**:
   - COD is not offered: the basket shows the Self Delivery reason, and the API refuses `COD_UNAVAILABLE_SELF_DELIVERY`.
   - Pay online (Razorpay test).
4. A mixed basket (Easy Ship + Self Delivery) splits into two orders. COD is unavailable for the whole basket.
5. Seller accepts and prepares, then:
   - **either** *Bulkimart rider*: the rider app receives the offer and completes pickup and delivery OTPs;
   - **or** *Own courier*: enter courier name, AWB, an `https://` tracking link and the dispatch date. Admin → Self Delivery issues shows disputes; the customer can report "not received".
6. Fee credit:
   - With `SELF_DELIVERY_FEE_CREDIT_ENABLED` off, the order records `deliveryFeePayee: platform`.
   - With it on, it records `seller`. This is fixed at hand-off.

## 9. FBB workflow (Seller C = pilot, Seller D = not in pilot)

1. **Pilot gate.**
   - Seller D's product form shows FBB as *Coming soon*.
   - Calling `POST /api/products/<id>/fbb-conversion` for Seller D returns **403 `FBB_SELLER_NOT_ENABLED`**.
   - Admin receiving for Seller D is refused.
2. **Conversion (Seller C).**
   - Seller panel or app: *Convert to Fulfilled by Bulkimart*. It shows the current rates and needs explicit confirmation.
   - The product shows 0 stock until received. Seller-held stock is recorded as set aside.
3. **Receiving** (Warehouse Ops admin):
   - Receiving → count accepted / damaged / rejected → **Post**.
   - Stock becomes sellable and storage is charged per accepted unit. Check the seller's FBB tab and Charges & billing.
4. **Checkout.**
   - The customer buys the FBB item: online, COD, a single-seller basket and a mixed basket.
   - The order shows the "Fulfilled by Bulkimart" badge; the shop radius does not apply.
   - Courier check, mock mode: always serviceable. With live/sandbox Shiprocket, try a pincode Shiprocket does not serve → **409 `FBB_NOT_SERVICEABLE`**, with no order, payment or reserved stock.
   - COD is not checked with Shiprocket while `SHIPROCKET_COD_ENABLED` is off (rider only).
5. **Fulfilment** (Admin → FBB → Orders):
   - accept → pick → pack: the packaging charge is booked at the rate frozen on the order;
   - *Delivery*: **Bulkimart rider** (the rider app gets a warehouse pickup) or **Shiprocket** (pickup = warehouse location);
   - hand-off: rider pickup OTP, courier scan, or admin *Confirm hand-off*. Stock leaves the warehouse and the fulfilment charge is booked, each once.
6. **The seller only views:** Seller C cannot change status, book couriers or edit stock for FBB orders, but sees orders, stock, receipts, charges and what they owe.
7. **Returns / RTO.**
   - Customer return → Admin → FBB → Returns decides and arranges pickup to the warehouse.
   - An RTO parcel goes to **quarantine** and is inspected once (sellable or damaged).
   - Charges already booked stay.
8. **Cancellation before hand-off:** reserved stock goes back to sellable. A packaging charge already booked stays.
9. **Paying FBB charges.**
   - From earnings: deducted automatically before payouts (or Admin → Charges & billing → Settle).
   - In advance: seller FBB tab → Pay (Razorpay test).

## 10. Customer, seller, admin and rider app checks

| App | Check |
|---|---|
| Customer (web + `mobile-user`) | Method badge on product and order. COD hidden/refused for Self Delivery. Clear message for an unserviceable FBB address. Own-courier tracking link. "Not received" report. Returns |
| Seller (web + `mobile-seller`) | Delivery-method selector. Self Delivery area card. FBB tab (stock, receipts, charges, pay). Bulk upload column "Delivery Method". FBB orders are view-only |
| Admin (web) | FBB workspace (overview switches, pilot sellers, warehouses, receiving, stock, adjustments, orders, returns, charges). Self Delivery issues. COD charge. Commissions. COD remittances |
| Rider (`mobile-delivery`) | Offers for Easy Ship / Self Delivery / FBB. The FBB pickup shows the **warehouse** address. Return pickups to the warehouse. Order alert sound |

## 11. Razorpay test mode

- Use the Razorpay **test** dashboard keys (`rzp_test_…`). The backend refuses a key whose prefix does not match `RAZORPAY_MODE`.
- Test cards/UPI: use the success and failure methods listed in Razorpay's test-mode documentation. Test both a successful payment and a failed or abandoned one: the order stays unpaid, then expires and its stock is released.
- Webhook: in the Razorpay test dashboard point it to `https://<staging api>/api/payments/razorpay/webhook` with `RAZORPAY_WEBHOOK_SECRET`. Locally, the client-side verify call settles payments without the webhook.
- Refunds: cancel a paid order and check the refund obligation in Admin → Finance (test mode only).

## 12. Inventory and financial reconciliation

Run these after each workflow and after the switch-off drill.

| Check | Where | Expected |
|---|---|---|
| Warehouse stock vs product mirror | Admin → FBB → Stock; `GET /api/admin/fbb/reconciliation` | No mismatches; *Resync* only for a reported row |
| Stock history | Admin → FBB → Stock movements | Every reserve, release, dispatch, receipt, inspection and adjustment is listed once |
| FBB charges vs ledger | `GET /api/admin/fbb/finance/charges/reconciliation` | `problems: []` |
| Seller FBB obligation | Seller FBB tab; Admin → Charges & billing | charged − reversed − paid − settled = outstanding |
| Order finance | Admin → order → financial breakdown | Commission on goods only; FBB charges never change it |
| COD remittance (Easy Ship / FBB via Shiprocket) | Admin → Finance → COD remittances (record from the Shiprocket report) | Lines `applied`. A line marked `partial` means a net remittance (see A3) |

**Switch-off drill (step 6).** With FBB orders at different stages (placed, packed, handed over, RTO pending), turn `FBB_ENABLED` and `FBB_CHARGES_ENABLED` off and remove Seller C from the pilot. Then confirm:

- new FBB checkouts are refused;
- placed orders still pack (packaging charged), hand over (fulfilment charged), cancel (stock released) and inspect RTO;
- receipts are paused (drafts kept);
- obligations still show and settle;
- the seller keeps their FBB tab.

## 13. Automated regression tests

Backend (PowerShell, from `backend`):

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --config __tests__/jest.config.js
node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand
# just the delivery-method suites:
node --experimental-vm-modules node_modules/jest/bin/jest.js --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/fbb.http.test.js __tests__/api/fbb-closure.http.test.js __tests__/api/self-delivery.http.test.js __tests__/api/delivery-method.http.test.js __tests__/api/shiprocket-cod.http.test.js
```

Seller app: `Set-Location mobile-seller; npm test`.
Frontend harness tests: run from **PowerShell** with `Set-Location D:\Appzeto_Projects\Bulkimart1\frontend`. Git Bash loads React twice.
