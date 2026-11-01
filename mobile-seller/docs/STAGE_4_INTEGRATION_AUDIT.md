# Stage 4 — Full Integration Audit (static)

Date: 2026-10-31. Method: reading `mobile-seller/` (99 files) and the matching `backend/` and `frontend/` source.
Nothing was installed, built, run or called. **Conclusion: the app is logically ready for integration testing on a trusted machine against a staging API.** No API contract mismatches were found. Before production, the backend risks in `BACKEND_CRITICAL_RISKS.md` must be resolved, and every item below must pass on a device.

## 1. Inventory

| Area | Count | Files |
|---|---|---|
| Entry | (in root) | `index.js` (random-values polyfill, FCM background handler), `App.js` (SafeArea → ErrorBoundary → AuthProvider → NavigationContainer(ref) → RootNavigator + OfflineBanner) |
| Navigation | 3 | `RootNavigator` (gate → stack), `AppTabs` (Dashboard, Orders, Products, Earnings, More), `navigationRef` |
| Context | 1 | `AuthContext` |
| Services | 13 | `apiClient`, `storage`, `auth.api`, `seller.api`, `notifications.api`, `finance`, `product.api`, `fulfillment.api`, `onboarding.api`, `returns.api`, `support.api`, `settings.api`, `push` |
| Hooks | 2 | `useApiResource`, `useSellerChannel` |
| Components | 19 | Screen, AppButton, AppInput, Card, StateViews, StatusPill, KeyValueRow, ReasonPrompt, SalesChart, ErrorBoundary, OfflineBanner, OptionPicker, ImageManager, ChipRow, SwitchRow, UploadProgress, DocumentField, AttachmentPicker, PushManager |
| Utils | 11 | format, phone, orderAmounts, financeRead, productForm, media, documents, onboardingValidation, returns, tickets, notificationRouting |
| Screens | 36 (35 routed + 1 unused) | auth 5 (one unused), onboarding 1, dashboard 1, orders 5 (incl. `OrderFinanceSection` part), products 3, inventory 1, invoices 2, reports 1, finance 4, notifications 1, returns 3 (incl. `ReturnPickupSection` part), support 3, profile 6 |
| Config / theme | 2 | `config/env.js`, `theme/index.js` |
| Project root | 11 | `App.js`, `index.js`, `package.json`, `app.json`, `babel.config.js`, `metro.config.js`, `.eslintrc.js`, `.gitignore`, README, MEMORY, CHECKLIST |
| Docs | 4 | `SELLER_APP_ANALYSIS`, `STAGE_4_INTEGRATION_AUDIT`, `BACKEND_CRITICAL_RISKS`, `ANDROID_BUILD_READINESS` |
| **Total** | **102** | |

## 2. Architecture findings

| Check | Result |
|---|---|
| Imports resolve / named + default exports exist | ✅ all 99 files (static script) |
| Circular dependencies | ✅ none possible: services, utils, config and theme never import screens, context, components or navigation |
| Navigation targets registered | ✅ every `navigate()` / push target is a registered route |
| Unused files | `screens/auth/OnboardingRequiredScreen.js` (superseded by native onboarding). Kept, documented, harmless |
| Unused exports | Constants and helpers only (`getUnreadCount`, `getDeviceId`, regexes, `pickDocuments`, …). No dead logic |
| Duplicate logic (accepted, not refactored) | multipart axios config (4 services), `requireId` / ObjectId check (5 services), `httpsUrl` (5 screens), focus-refresh "skip first focus" (8 screens). Candidates for a later shared helper; behaviour is identical |
| Naming | Consistent: `*Screen`, `*.api.js`, `use*` hooks. Route names are PascalCase |
| Error handling | One `ApiError` type, network/timeout messages, 401 → sign-out (only for the current token), 409 → refresh paths in stock/orders/settings/returns |
| Network | `OfflineBanner` (NetInfo); every list has loading / empty / error / retry states; uploads have progress and duplicate-create warnings |
| Token persistence | Keychain service `com.Bulkimart.seller.session` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); token is held in memory for requests and never stored in AsyncStorage |
| Isolation from Customer app | ✅ no imports outside `mobile-seller/`; Metro is standalone; storage keys are seller-namespaced; `mobile-user` appears only in documentation as the version reference |

## 3. API compatibility (61 calls)

**MATCH** = method, path and auth verified in backend routes, *and* the request fields verified in the controller or identical to the working web client.
**UNKNOWN** = route verified, but some response fields are known only from the web's display code (the app validates or guards them at runtime).
Totals: **53 MATCH, 8 UNKNOWN, 0 MISMATCH** across 61 calls. The UNKNOWN calls are pickup-sync (2), order financial breakdown, fulfilment options, invoice, finance summary, ledger and tax statement.

| Module | Endpoint | Method | Backend found | Request / response | Status |
|---|---|---|---|---|---|
| Auth | `/api/auth/seller/send-otp` | POST | auth.controller `requestSellerOTP` | `{phone,intent}`; `meta.code` NOT_A_MEMBER/SELLER_NOT_FOUND/SELLER_EXISTS | MATCH |
| Auth | `/api/auth/seller/verify-otp` | POST | `verifySellerOTP` | `{phone,otp,intent}` → `token, sessionRole` | MATCH |
| Auth | `/api/auth/me` | GET | `getMe` | `sessionRole, profile` | MATCH |
| Auth | `/api/auth/logout` | POST | `logout` | — | MATCH |
| Profile | `/api/sellers/me` | GET | `getMySellerProfile` | `{seller, limits}` | MATCH |
| Profile | `/api/sellers/profile` | PUT | `updateStoreProfile` | profile fields + `version` (409 on conflict); pickup draft; `sameDay` JSON in multipart (`asObject` parses strings); `logo`/`banner` files | MATCH |
| Profile | `/api/sellers/pickup-sync` · `/retry` | GET · POST | `getPickupStatus` · `retryPickupSync` | `data{status,message,…}` from web | UNKNOWN |
| Settings | `/api/sellers/channels` | PATCH | `updateSalesChannels` | `{channels}`; wholesale kept by server | MATCH |
| Settings | `/api/sellers/wholesale-request` | POST | `requestWholesaleChannel` | `{}` → `{status, salesChannels}` | MATCH |
| Dashboard | `/api/sellers/dashboard[?type]` | GET | `getDashboard` | `kpis` (+ counts), `byChannel`, `salesPerformance` (30 days) | MATCH |
| Orders | `/api/sellers/orders?type&status&limit` | GET | `getSellerOrders` | `data[]`; `status=all/pending`; limit ≤100 | MATCH |
| Orders | `/api/sellers/orders/:id` | GET | `getSellerOrders` (id) | `data` incl. `version`, `permittedActions` | MATCH |
| Orders | `/api/sellers/orders/:id/status` | PATCH | `updateOrderStatus` | `{status,version,reason?,courier?,awb?}` | MATCH |
| Orders | `/api/sellers/orders/:id/financial-breakdown` | GET | `getSellerOrderFinance` | paise breakdown; shape-validated by `readOrderFinance` | UNKNOWN |
| Fulfilment | `/orders/:id/fulfillment-options` | GET | `getFulfillmentOptions` | `data{manual,shiprocket,pickup}` from web | UNKNOWN |
| Fulfilment | `/orders/:id/fulfillment/manual` | POST | `selectManualFulfillment` | `{riderId?}` (web-identical) | MATCH |
| Fulfilment | `/orders/:id/fulfillment/shiprocket` | POST | `createShiprocketShipment` | `{confirm,package,quotedCourierCharge}` (web-identical) | MATCH |
| Invoice | `/orders/:id/invoice` | GET | taxInvoice `getSellerOrderInvoice` | `ok(data)`; document fields from web `InvoiceSheet`; app checks `document/lines/totals` | UNKNOWN |
| Finance | `/finances/summary`, `/ledger?limit=50` | GET | `getSellerFinanceSummary`, `listSellerLedger` | validated by `readSellerFinances` (exact web port) | UNKNOWN |
| Finance | `/finances/tax-statement` | GET | `getSellerTaxStatement` | `data.months[]` validated | UNKNOWN |
| Finance | `/api/sellers/payouts` | POST | `requestSellerPayout` | `{amount}` + `Idempotency-Key` header → `payoutPublic` (`_id, amount, status`) | MATCH |
| Products | `/api/products/seller/mine?type&roleContext` | GET | `getMyProducts` (`req.query.type`) | array / `data` | MATCH |
| Products | `/api/categories/tree?type` | GET | `getCategoryTree` | tree (public) | MATCH |
| Products | `/api/products/category-return-policy?categoryId` | GET | `getCategoryReturnPolicyForSeller` | `data{eligible,returnWindowDays,source}` | MATCH |
| Products | `/api/products` | POST | `createProduct` (+ `uploadProductImages('images',5)`) | multipart, web-identical fields | MATCH |
| Products | `/api/products/:id` | PUT | `updateProduct` | multipart; images replace the set; `sellingChannels` not sent (server rejects it) | MATCH |
| Products | `/api/products/:id` | DELETE | `deleteProduct` | soft delete, ownership-checked | MATCH |
| Products | `/api/products/:id/stock` | PATCH | `adjustProductStock` | `{delta}` non-zero integer; 409 race; first variant | MATCH |
| Onboarding | `/api/sellers/start` | POST | `startOnboarding` | `{salesChannels}`; 409 if changed after onboarding | MATCH |
| Onboarding | `/api/sellers/step/1` | PUT | `submitStep1` | `{businessName,businessType,storeDetails}`; pincode accepted without GPS | MATCH |
| Onboarding | `/api/sellers/step/2` | PUT | `submitStep2` | multipart `aadhaarNumber, aadhaarFront, aadhaarBack` | MATCH |
| Onboarding | `/api/sellers/step/3` | PUT | `submitStep3` | multipart `accountNo, ifsc, holderName, bankName, passbookUrl` | MATCH |
| Onboarding | `/api/sellers/step/4` | PUT | `submitStep4` + `parseGstChoice` | multipart `pan, gstChoice, gstin / assistance fields, pan_card, trade_license` | MATCH |
| Onboarding | `/api/sellers/submit` | POST | `submitApplication` | → `pending` | MATCH |
| Onboarding | `/api/sellers/gst-assistance/capabilities` | GET | gstAssistance router (public) | `data.fee` | MATCH |
| Returns | `/api/sellers/returns` | GET | `listSellerReturns` | `paginated` + `meta.pages, statusCounts` | MATCH |
| Returns | `/api/sellers/returns/:id` | GET | `getSellerReturn` | `data` + `order`, `customerName`, `history[].timestamp` | MATCH |
| Returns | `/returns/:id/decision` | POST | `sellerDecideReturnCtrl` | `{decision, rejectionReason}` | MATCH |
| Returns | `/returns/:id/pickup-options` | GET | `getReturnPickupOptions` | `data{stateReady,…}` (web) | MATCH |
| Returns | `/returns/:id/pickup`, `/pickup/refresh`, `/pickup/cancel`, `/mark-received` | POST | `selectReturnPickup`, `refreshReturnCourier`, `cancelReturnPickup`, `sellerConfirmReturnReceived` | web-identical | MATCH |
| Support | `/api/tickets/categories?role=seller` | GET | `getTicketCategories` | `data.categories` | MATCH |
| Support | `/api/tickets` | GET · POST | `listMyTickets` · `createTicket` | paginated; multipart `role,category,subject,description,attachments≤5` | MATCH |
| Support | `/api/tickets/:id` | GET | `getTicketDetail` | `data{ticket,messages}` | MATCH |
| Support | `/api/tickets/:id/messages` · `/reopen` | POST | `addRequesterMessage` · `reopenTicket` | `message` + attachments · RESOLVED→REOPENED only | MATCH |
| Support | `/api/helpline` | GET | `getPublicHelpline` | `data.sellerHelplineNumber` (web field) | MATCH |
| Notifications | `/api/notifications?page&limit` | GET | `getMyNotifications` (`visibleNotificationFilter`, seller-scoped) | full rows incl. `route`, `metadata` | MATCH |
| Notifications | `/:id/read`, `/read-all` | PATCH | `markNotificationRead`, `markAllNotificationsRead` | — | MATCH |
| Notifications | `/unread-count` | GET | `getUnreadCount` | defined, not used by screens | MATCH |
| Push | `/api/notifications/tokens` | POST | `saveFcmToken` → `registerPushToken` | `{token, platform:'android', deviceId}` → stored as `app` | MATCH |
| Push | `/api/notifications/tokens/:token` | DELETE | `deleteFcmToken` | — | MATCH |

## 4. Authentication and access audit

| Case | Expected | Code path | Result |
|---|---|---|---|
| No stored token | Login | `AuthContext` start-up → `signedOut` | ✅ |
| OTP login, approved seller | Dashboard | `verify-otp` → Keychain → `/auth/me` (sessionRole seller) → `/sellers/me` (approved) | ✅ |
| Pending / under review | Locked status screen | gate `status` → `StatusGateScreen` | ✅ |
| Rejected | Status screen with reason, **no resubmission** | gate `status` | ✅ (resubmission intentionally blocked, R1) |
| Suspended | Status screen | gate `status` | ✅ |
| Deactivated user | Cannot sign in; an existing session ends | `verify-otp` 403 · `/auth/me` 4xx → `endSession` | ✅ |
| Customer-only account | "No seller account" or sign-out | `send-otp` 404 · `/sellers/me` 403/404 | ✅ |
| Customer-portal token | Rejected | `/auth/me` `sessionRole !== 'seller'` → `endSession` | ✅ |
| Expired token | Back to login | any 401 for the current token → `endSession` | ✅ |
| Logout | Push token removed, server logout, Keychain cleared | `signOut` | ✅ |
| Registration | Onboarding only for `none` / `incomplete` | gate `onboarding` | ✅ |
| Push token after **expiry** (not logout) | — | token can't be deleted with an expired session | ⚠ Known limitation: the device may keep receiving that seller's pushes until the next sign-in re-registers or FCM invalidates the token |

Sensitive data on screens (after the Stage 4 fixes):
- Bank account, PAN and UPI are masked.
- Aadhaar is already masked by the server.
- KYC document images are never opened; they show as "On file".
- No tokens are rendered or logged.
- The onboarding review shows only the last 4 account digits.
- Customer phone and address appear only where the web shows them (order detail, tracking).

## 5. Financial audit

| Screen | Source | Recalculation? | Missing value shows | Result |
|---|---|---|---|---|
| Dashboard | `/sellers/dashboard` | none | '—' / "Pending calculation" | ✅ fixed in Stage 4 (was ₹0) |
| Sales report | `/sellers/dashboard[?type]` | none (the web's browser sums were not ported) | '—' | ✅ fixed in Stage 4 (was ₹0) |
| Earnings / wallet / commission / GST / TCS / TDS per order | `/finances/summary` + `/ledger` | none; shape validated, failure = error, not ₹0 | '—' | ✅ |
| Order earnings | `/orders/:id/financial-breakdown` (paise) | display-only: a line's discount components summed; "customer paid" built from parts **only if** `expectedPaise` is missing (same as web) | '—' | ✅ documented |
| Payout request | `summary.balances.eligible`, `payoutPolicy` | validation only (≤ eligible, ≥ minimum, 2 decimals); the server decides | — | ✅ `Idempotency-Key` per (seller, amount), kept until the server confirms |
| Payout history | `summary.payouts` | none | — | ✅ |
| Tax statement | `/finances/tax-statement` (paise) | none | '—' | ✅ |
| Order list / tracking / fulfilment quote | order rows | none | '—' (fixed in Stage 4, was ₹0) | ✅ |
| Return refunds | `refundAmount` | none, shown verbatim | '—' | ✅ |
| Invoices | server document (paise) | none | '—' | ✅ |

## 6. Workflow audit

| # | Workflow | Result | Notes |
|---|---|---|---|
| 1 | Login → approval → dashboard | ✅ | |
| 2 | Product create → images → list | ✅ | Form → POST multipart → list (focus refresh) |
| 3 | Product edit → image replacement | ✅ fixed | Edit used to return to a stale detail; now returns to the list. "Replace all photos" matches the server behaviour |
| 4 | Stock adjust → conflict | ✅ fixed | 409 → refresh, sheet stays open. Detail → Stock now uses `replace()` so back doesn't show a stale snapshot |
| 5 | Order → permitted action → fulfilment | ✅ | `setup` → FulfillmentScreen → back → order re-reads on focus |
| 6 | Shipment → tracking | ✅ | AWB, courier, https tracking link; ETA only from `promisedBy` |
| 7 | Delivered order → invoice | ✅ | Order detail "View invoice"; Invoices list. No PDF (no backend) |
| 8 | Return → decision → pickup → received | ✅ | Server gates the actions; 20 s refresh |
| 9 | Earnings → payout → history | ✅ | Earnings refreshes on focus after the request |
| 10 | Onboarding → documents → submit → status | ✅ | Resumes from the failed step; `refreshSeller` moves to the status gate |
| 11 | Ticket → reply → resolution | ✅ | Create → replace with detail; reply; reopen if RESOLVED; CLOSED read-only |
| 12 | Push → destination | ✅ (static) | `notificationTarget` maps route/metadata; `PushManager` only in the approved stack. Needs a device test for the cold-start delay |

Incomplete but documented: e-books, Wholesale editor, bulk upload, advertising, services, GST-fee and Shiprocket-fee payments, store GPS pin, product FAQs.

## 7. Changes made during Stage 4 (app only)

1. `utils/format.js`: `kpiMoney` / `orderMoney` show '—' for missing values (not ₹0); added `countText`.
2. `DashboardScreen`, `SalesReportScreen`: pass raw server values; counts use `countText`.
3. `KycDetailsScreen`: masks the PAN and UPI; documents shown as "On file" without public links.
4. `ProductFormScreen`: after saving, returns to the Products list.
5. `ProductDetailScreen`: "Adjust stock" replaces the detail screen.

## 8. Shared workspace and account context

- The Seller app neither references nor writes to `mobile-user/`, `frontend/`, `backend/` or `shared/` (checked statically).
- During Stage 3 the session's account context switched to a different user identity. **The repository owner should confirm independently who has access to this machine and the Claude Code session**, especially given the compromise history. Nobody's account data was investigated.
