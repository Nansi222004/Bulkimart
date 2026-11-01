# Conversion Checklist — Bulkimart Seller

Statuses: **Implemented — not tested** · **Blocked — environment security** · **Missing backend support** · **Verified** (only after testing on a trusted machine).
Nothing is Verified. No install, build, device run or API call has been performed: the development machine is untrusted (PolinRider).
"Not started" marks web features with no native code yet; they stay on the web panel.

## Screens

| Web source | Native screen | Stage | Status | Known differences |
|---|---|---|---|---|
| `routes/index.jsx` gate | `AuthContext` + `RootNavigator` | 1 | Implemented — not tested | A failed background refresh keeps an approved seller in the panel |
| `SellerLoginPage.jsx` | `auth/LoginScreen` | 1 | Implemented — not tested | Terms shown as text |
| "No seller account found" | `auth/NoSellerAccountScreen` | 1 | Implemented — not tested | |
| `SellerStatusGate.jsx` | `auth/StatusGateScreen` | 1 | Implemented — not tested | |
| `OnboardingPage.jsx` + `submitSellerApplication` | `onboarding/OnboardingScreen` | 3 | Implemented — not tested | 7-section wizard; resumes from the failed server step; no simulated "Verify Aadhaar"; typed address instead of GPS pin; no local draft (web saves one) |
| Rejected-application resubmission | — | — | Missing backend support (no web flow) | Web shows the reason only; backend steps accept edits but have no defined resubmit flow or status guard |
| GST assistance fee payment (`GstAssistance`) | — | — | Blocked — environment security | Razorpay; the app only shows the fee text |
| `DashboardTab.jsx` + `SellerSalesChart.jsx` | `dashboard/DashboardScreen` | 1 | Implemented — not tested | Tap instead of hover on chart |
| `OrdersTab.jsx` list | `orders/OrdersScreen` | 1 | Implemented — not tested | |
| `OrdersTab.jsx` detail + `orderDetailSections.jsx` | `orders/OrderDetailScreen` | 1 (+2) | Implemented — not tested | Confirmation before status changes; re-reads on return |
| `OrdersTab.jsx` "Choose delivery method" | `orders/FulfillmentScreen` | 2 | Implemented — not tested | Opened from the server `setup` action |
| ↳ Quick Commerce Shiprocket fee (`ShiprocketFeePayment.jsx`) | — | — | Blocked — environment security | Razorpay payment; needs a test key and approval |
| `TrackOrderTab.jsx` | `orders/TrackOrdersScreen` | 2 | Implemented — not tested | Adds AWB search, tracking link and call button (all from server fields) |
| `OrderInvoices.jsx` (`InvoiceSheet`) | `invoices/InvoicesScreen`, `invoices/InvoiceDetailScreen` | 2 | Implemented — not tested | List = delivered orders (no list endpoint); no print/PDF |
| `OrderFinancialBreakdown.jsx` | `orders/OrderFinanceSection` | 1 | Implemented — not tested | |
| `SalesReportTab.jsx` | `reports/SalesReportScreen` | 2 | Implemented — not tested | Server figures only; the web's browser-side top-products and daily subtotal sums are not reproduced |
| `ProductsTab.jsx` (retail list) | `products/ProductsScreen` | 2 | Implemented — not tested | Status filter chips; SKU search |
| — (row data) | `products/ProductDetailScreen` | 2 | Implemented — not tested | Built from the list row; no seller product-detail endpoint |
| `ProductModal.jsx` (physical retail) | `products/ProductFormScreen` | 2 | Implemented — not tested | Saved variants can't be removed in-app; image "type" labels (display-only on web) omitted |
| `ProductModal.jsx` e-book (digital PDF) | — | — | Not started | Web only |
| `ProductModal.jsx` Wholesale editor, `SellerWholesaleProducts.jsx`, `WholesaleOfferSelector.jsx` | — | — | Not started | Web only |
| `BulkUploadModal.jsx` | — | — | Not started | Web only |
| `StockTab.jsx` | `inventory/StockScreen` | 2 | Implemented — not tested | Server counts; low stock = below 20 (backend rule; web tab uses ≤10); fake product code and client valuation removed |
| Stock history | — | — | Missing backend support | No stock-movement endpoint or model |
| `PickupSyncCard.jsx` | `profile/PickupSyncScreen` | 2 | Implemented — not tested | |
| Shop same-day settings (`saveSameDaySettings`) | `profile/BusinessSettingsScreen` | 3 | Implemented — not tested | Backend contract exists; the web has the function but no screen |
| Sales-channel toggle, Wholesale request (`SellerContext`) | `profile/BusinessSettingsScreen` | 3 | Implemented — not tested | |
| Store logo / banner (`PUT /sellers/profile` files) | `profile/BusinessSettingsScreen` | 3 | Implemented — not tested | Backend-supported; no web screen |
| Bank / GST / PAN / KYC documents (read) | `profile/KycDetailsScreen` | 3 | Implemented — not tested | Account number masked to last 4 |
| Bank / KYC change after approval | — | — | Missing backend support | Only the onboarding steps write these, with no status guard; needs a reviewed backend flow |
| Store location GPS pin | — | — | Not started | Needs a geolocation library + location permission |
| `EarningsTab.jsx` | `finance/EarningsScreen` | 1 | Implemented — not tested | Table → cards |
| `MoneyRequestTab.jsx` | `finance/PayoutRequestScreen` | 1 | Implemented — not tested | Confirmation dialog |
| `PaymentHistoryTab.jsx` | `finance/PayoutHistoryScreen` | 1 | Implemented — not tested | |
| `SellerTaxStatement.jsx` | `finance/TaxStatementScreen` | 1 | Implemented — not tested | |
| `NotificationDrawer.jsx` | `notifications/NotificationsScreen` | 1 (+3) | Implemented — not tested | Stage 3: opens order, return, ticket, earnings, products and dashboard targets; push on/off switch |
| `SellerPushControl.jsx` + `firebaseMessaging.js` | `services/push.js`, `components/PushManager.js`, `index.js` background handler | 3 | Implemented — not tested | FCM; foreground messages shown as an in-app alert |
| Notification preferences (per event) | — | — | Missing backend support | No preferences model or endpoint |
| `ProfileTab.jsx` | `profile/ProfileScreen`, `EditProfileScreen` | 1 | Implemented — not tested | Location pin not built |
| `LeftNav.jsx` | `AppTabs` (Dashboard, Orders, Products, Earnings, More) + `MoreScreen` | 1–2 | Implemented — not tested | |
| `SellerReturnsTab.jsx` (list) | `returns/ReturnsScreen` | 3 | Implemented — not tested | Server status counts |
| `SellerReturnsTab.jsx` (detail + decision), `ReturnPickupPanel.jsx` | `returns/ReturnDetailScreen`, `returns/ReturnPickupSection` | 3 | Implemented — not tested | 20-second refresh instead of socket events; confirmations before pickup actions |
| Exchanges | — | — | Missing backend support | No exchange model, status or endpoint |
| Return pickup OTP (seller side) | — | — | Missing backend support (by design) | The OTP is customer-only; sellers never receive it |
| `SupportTab.jsx` + `useTickets.js` + `TicketDetailModal.jsx` | `support/SupportScreen`, `CreateTicketScreen`, `TicketDetailScreen` | 3 | Implemented — not tested | Helpline shown only when the server provides it (web has a hard-coded fallback) |
| Support chat | — | — | Missing backend support | No chat API; tickets only |
| `FaqsTab.jsx` (product Q&A) | — | — | Not started | |
| `AccountTab.jsx` | — | — | Not ported | Not in the seller nav; contains a "simulated loading state" and browser-side balance sums. Account deletion excluded |
| `AdvertisingWorkspace.jsx`, `ServicesPanel`, `GstAssistance` | — | 4 | Blocked — environment security | Razorpay payments |
| Seller coupons / promotions | — | — | Missing backend support | No seller coupon backend; promotions retired |
| Push notifications device test | — | 3 | Blocked — environment security | Needs `google-services.json` in `android/app` + trusted build |

## API endpoints

| Method | Endpoint | Payload | Response used | Auth | Stage | Status |
|---|---|---|---|---|---|---|
| POST | `/api/auth/seller/send-otp` | `{phone,intent}` | `success, otp?(mock), meta.code` | Public | 1 | Implemented — not tested |
| POST | `/api/auth/seller/verify-otp` | `{phone,otp,intent}` | `token, sessionRole` | Public | 1 | Implemented — not tested |
| GET | `/api/auth/me` | — | `sessionRole, profile._id` | Seller | 1 | Implemented — not tested |
| POST | `/api/auth/logout` | — | — | Seller | 1 | Implemented — not tested |
| GET | `/api/sellers/me` | — | `seller, limits` | Seller | 1 | Implemented — not tested |
| PUT | `/api/sellers/profile` | profile fields + `version` · or pickup draft `{name,email,phone,address,city,state,pincode}` | `success` | Seller | 1–2 | Implemented — not tested |
| GET | `/api/sellers/pickup-sync` | — | `data{status,message,locationName,registeredAt,shippingApproved,nextAttemptAt}` | Seller | 2 | Implemented — not tested |
| POST | `/api/sellers/pickup-sync/retry` | `{}` | — | Seller | 2 | Implemented — not tested |
| GET | `/api/sellers/dashboard[?type=ecommerce\|grocery]` | — | `kpis` (+ `productCount, liveCount, lowStockCount, outOfStockCount`), `byChannel`, `salesPerformance` (30 days) | Approved | 1–2 | Implemented — not tested |
| GET | `/api/sellers/orders?type&status=all&limit=100` | — | `data[]` | Approved | 1 | Implemented — not tested |
| GET | `/api/sellers/orders/:id` | — | `data` incl. `permittedActions, version` | Approved | 1 | Implemented — not tested |
| PATCH | `/api/sellers/orders/:id/status` | `{status,version,reason?,courier?,awb?}` | `message` | Approved | 1 | Implemented — not tested |
| GET | `/api/sellers/orders/:id/fulfillment-options` | — | `data{manual{available,reason,eligibleRiderCount,riders[]},shiprocket{available,reason,quote,packageWeightKg,pickupLinked,verifiedPickup,activation,feeCollection},pickup}` | Approved | 2 | Implemented — not tested |
| POST | `/api/sellers/orders/:id/fulfillment/manual` | `{riderId?}` | `message` | Approved | 2 | Implemented — not tested |
| POST | `/api/sellers/orders/:id/fulfillment/shiprocket` | `{confirm:true,package{length,breadth,height},quotedCourierCharge}` | `message, data` | Approved | 2 | Implemented — not tested (creates a real shipment) |
| GET/POST | `/api/sellers/orders/:id/shiprocket-fee`, `/shiprocket-fees/verify` | — | — | Approved | — | Blocked — environment security (Razorpay) |
| GET | `/api/sellers/orders/:id/invoice` | — | `data{invoiceNumber,issuedAt,document{title,seller,customer,lines,totals,gstSplit,notes}}` (paise) | Approved | 2 | Implemented — not tested |
| GET | `/api/sellers/orders/:id/financial-breakdown` | — | paise breakdown | Approved | 1 | Implemented — not tested |
| GET | `/api/products/seller/mine?type&roleContext=seller` | — | array / `data` | Seller role | 2 | Implemented — not tested |
| GET | `/api/categories/tree?type` | — | tree | Public | 2 | Implemented — not tested |
| GET | `/api/products/category-return-policy?categoryId` | — | `data{eligible,returnWindowDays,source}` | Seller role | 2 | Implemented — not tested |
| POST | `/api/products` | multipart: `roleContext,type,fulfillmentType,name,category,description?,brandName?,gstRate,gstPriceType,variants(JSON),returnable,returnWindowDays,images[1–5]` | `product` | Approved | 2 | Implemented — not tested |
| PUT | `/api/products/:id` | multipart: `name,category,description?,brandName,gstRate,gstPriceType,variants(JSON incl _id),sameDay(JSON, Shop All),returnable,returnWindowDays,images?` (images replace the set) | `product` | Approved | 2 | Implemented — not tested |
| DELETE | `/api/products/:id` | — | — | Seller role | 2 | Implemented — not tested |
| PATCH | `/api/products/:id/stock` | `{delta}` (non-zero integer; first variant) | `stock, product` · 409 on race | Approved | 2 | Implemented — not tested |
| GET | `/api/sellers/finances/summary`, `/ledger?limit=50`, `/tax-statement` | — | see analysis | Approved | 1 | Implemented — not tested |
| POST | `/api/sellers/payouts` | `{amount}` + `Idempotency-Key` | `data{_id,amount,status}` | Approved | 1 | Implemented — not tested |
| GET/PATCH | `/api/notifications`, `/:id/read`, `/read-all` | — | paginated | Seller | 1 | Implemented — not tested |
| POST | `/api/sellers/start` | `{salesChannels}` | `seller` | Seller | 3 | Implemented — not tested |
| PUT | `/api/sellers/step/1` | `{businessName, businessType:'proprietorship', storeDetails{name,description,address,landmark,city,state,pincode,phone,email}}` | `seller` | Seller | 3 | Implemented — not tested |
| PUT | `/api/sellers/step/2` | multipart `aadhaarNumber, aadhaarFront, aadhaarBack` | `seller` | Seller | 3 | Implemented — not tested |
| PUT | `/api/sellers/step/3` | multipart `accountNo, ifsc, holderName, bankName, passbookUrl` | `seller` | Seller | 3 | Implemented — not tested |
| PUT | `/api/sellers/step/4` | multipart `pan, gstChoice, gstin? / gstAssistanceConsent, gstContactName, gstAssistanceMessage, pan_card?, trade_license?` | `seller` | Seller | 3 | Implemented — not tested |
| POST | `/api/sellers/submit` | — | `seller` (status `pending`) | Seller | 3 | Implemented — not tested |
| GET | `/api/sellers/gst-assistance/capabilities` | — | `data.fee` | Seller | 3 | Implemented — not tested |
| GET | `/api/sellers/returns?limit=100&page&status` | — | `data[]`, `meta{pages,statusCounts}` | Approved | 3 | Implemented — not tested |
| GET | `/api/sellers/returns/:id` | — | `data` (return + `order`, `customerName`, `history[]`) | Approved | 3 | Implemented — not tested |
| POST | `/api/sellers/returns/:id/decision` | `{decision:'APPROVED'\|'REJECTED', rejectionReason}` | `data{status}` | Approved | 3 | Implemented — not tested |
| GET | `/api/sellers/returns/:id/pickup-options` | — | `data{stateReady,stateReason,manual,shiprocket,pickup,drop}` | Approved | 3 | Implemented — not tested |
| POST | `/api/sellers/returns/:id/pickup` | `{pickupMethod, riderId?}` | message | Approved | 3 | Implemented — not tested (Shiprocket books a real courier) |
| POST | `/api/sellers/returns/:id/pickup/refresh`, `/pickup/cancel`, `/mark-received` | — | message | Approved | 3 | Implemented — not tested |
| GET | `/api/tickets/categories?role=seller` | — | `data.categories[]` | Seller | 3 | Implemented — not tested |
| GET | `/api/tickets?limit=50&role=seller` | — | `data[]` | Seller | 3 | Implemented — not tested |
| GET | `/api/tickets/:id` | — | `data{ticket,messages[]}` | Seller | 3 | Implemented — not tested |
| POST | `/api/tickets` | multipart `role, category, subject, description, attachments[≤5]` | `data` (ticket) | Seller | 3 | Implemented — not tested |
| POST | `/api/tickets/:id/messages` | multipart `message, attachments[≤5]` | `data` | Seller | 3 | Implemented — not tested |
| POST | `/api/tickets/:id/reopen` | — | `data` | Seller | 3 | Implemented — not tested |
| GET | `/api/helpline` | — | `data.sellerHelplineNumber` | Public | 3 | Implemented — not tested |
| POST | `/api/notifications/tokens` | `{token, platform:'android', deviceId}` | `data.platform` (`app`) | Seller | 3 | Implemented — not tested |
| DELETE | `/api/notifications/tokens/:token` | — | — | Seller | 3 | Implemented — not tested |
| PATCH | `/api/sellers/channels` | `{channels}` | `success` | Approved | 3 | Implemented — not tested |
| POST | `/api/sellers/wholesale-request` | `{}` | `{status, salesChannels}` | Approved | 3 | Implemented — not tested |
| PUT | `/api/sellers/profile` | multipart `sameDay` (JSON `{enabled, cutoffTime, radiusKm, availableDays}`) or `logo`/`banner` files | `seller` | Seller | 3 | Implemented — not tested |
| — | Stock history, invoice list, invoice PDF, sales report date range / top products, exchanges, notification preferences, support chat, approved-seller bank/KYC change | — | — | — | — | Missing backend support |

## Permissions

| Permission | Why | When requested | Stage |
|---|---|---|---|
| `INTERNET` | API | Install time | 1 |
| `CAMERA` | Product photos | Only when the seller taps "Camera" in the photo picker; denial shows a message and the gallery still works | 2 |
| (none) | Gallery | Android system photo picker needs no storage permission | 2 |
| (none) | KYC documents and ticket attachments | System document picker (`@react-native-documents/picker`) needs no storage permission | 3 |
| `POST_NOTIFICATIONS` (Android 13+) | Push notifications | Only when the seller turns on "Push notifications on this phone"; denial keeps the in-app inbox working | 3 |

## Device tests (all pending a trusted machine)

| Check | Status |
|---|---|
| Install, launch, splash, login, session restore, logout, expired token | Blocked — environment security |
| Dashboard / earnings / sales report match web for the same seller | Blocked — environment security |
| Product create/edit with camera and gallery photos, progress, failure/retry | Blocked — environment security |
| Stock adjust including a 409 conflict | Blocked — environment security |
| Delivery setup (manual rider); Shiprocket on a test order only | Blocked — environment security |
| Invoice view for a delivered order | Blocked — environment security |
| Camera permission deny / never-ask-again | Blocked — environment security |
| Onboarding on a staging API (register intent creates production data) incl. a failed-step retry | Blocked — environment security |
| Return approve/reject/pickup on test returns only | Blocked — environment security |
| Ticket create/reply/reopen with attachments | Blocked — environment security |
| Push: permission prompt, token registration, foreground alert, tap from background and from closed app, sign-out removal | Blocked — environment security |
| Business settings saves and the 409 refresh path | Blocked — environment security |
| Back button, keyboard, offline banner, lint | Blocked — environment security |

## Stage 6 (static; security gate failed)

New, Implemented — not tested:
- `products/ProductFaqsScreen` (GET/PATCH `/api/sellers/faqs`)
- `profile/StoreLocationScreen` (GPS → `PUT /sellers/profile {lat,lng}`; `/api/geo/reverse` display only; `ACCESS_FINE_LOCATION` on tap)
- `advertising/AdvertisingScreen`, `CampaignDetailScreen`, `CampaignBuilderScreen` (11 advertising calls; payment excluded)
- Staging/production config, fail-closed
- Notification routing for advertising and FAQs

Added in Stage 7 (2026-11-01, static; gate still failed):
- Wholesale prices per saved variant (`WholesalePricingScreen`, `PATCH /api/products/:id/wholesale-pricing` with product `version`)
- Advertising views and clicks (`CampaignMetrics`, `GET /campaigns/:id/analytics`)

Still open:
- Needs completion: e-books, bulk upload
- Requires payment integration: ad payment, Shiprocket fee, GST fee, services
- Missing backend: seller commission-rules endpoint, invoice PDF, stock history, exchanges, notification preferences, rejected-seller resubmission, bank-change workflow, staging URL

Full inventory: `docs/FINAL_FEATURE_AUDIT.md`. Build status: `docs/FINAL_BUILD_REPORT.md`. APIs: 78 calls, 70 MATCH, 8 UNKNOWN, 0 MISMATCH (`docs/API_INTEGRATION_REPORT.md`). Tests: none run (`docs/ANDROID_TEST_REPORT.md`, `docs/SECURITY_VALIDATION_REPORT.md`). Release: `docs/PRODUCTION_RELEASE_CHECKLIST.md`.

## Stage 4 integration audit (static)

See `docs/STAGE_4_INTEGRATION_AUDIT.md`. 61 API calls checked: 53 MATCH, 8 UNKNOWN (response fields known only from web display code and guarded in the app), 0 MISMATCH. No circular imports; all routes registered; one unused file (`OnboardingRequiredScreen.js`).
Fixes applied in Stage 4: missing dashboard / sales-report / order amounts show '—' instead of ₹0; KYC screen masks PAN and UPI and no longer opens document images; product edit returns to the refreshed list; stock adjust from detail no longer returns to a stale snapshot.
All features remain **Implemented — not tested**.

## Backend risks found during static review (not changed; for the backend owner)

Full report with impact and required changes: `docs/BACKEND_CRITICAL_RISKS.md` (R1–R7). Summary:

1. `PUT /api/sellers/step/1–3` and `POST /api/sellers/submit` do not check `Seller.status`. An approved seller calling `submit` is set back to `pending`, and `step/3` overwrites bank details without review. The app only shows onboarding to `none`/`incomplete` sellers, but the API itself is open.
2. `PUT /api/sellers/step/4` appends uploaded files to `Seller.documents` on every call, so repeating it duplicates entries. The app avoids re-sending a completed step.
3. The web onboarding's "Verify Aadhaar" is simulated (a 1.5-second timer that reports success). No real Aadhaar verification exists.
4. KYC and bank documents are stored at public Cloudinary URLs, and `GET /api/sellers/me` returns the full bank account number, PAN and document URLs.
5. Product delete and the seller product list skip `requireSellerSession` (ownership is still checked).
