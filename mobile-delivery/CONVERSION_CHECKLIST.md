# Conversion Checklist — Delivery web portal → Android

Legend: [x] done (static) · [ ] open. Runtime verification is open for every item until tests run on a clean machine.

## Phases
- [x] 1 Security verification (result: FAIL — static work only)
- [x] 2 Web portal audit (9 pages, 7 components, context, parcels)
- [x] 3 Documentation review (DELIVERY_LOGIN.md, financial docs, seller conversion docs)
- [x] 4 Screen and API inventory (docs/API_INTEGRATION_REPORT.md)
- [x] 5 React Native CLI project + android/
- [x] 6 UI and navigation
- [x] 7 Backend integration (client side; backend unchanged)
- [x] 8 Delivery workflow (offer → pickup → OTP → completion)
- [x] 9 OTP and amount rounding (exact server amount)
- [x] 10 COD and wallet screens
- [x] 11 GPS and external navigation
- [x] 12 Push notifications + inbox
- [x] 13 Return pickups (exchanges: no backend)
- [x] 14 Android native configuration
- [x] 15 Unit tests written
- [ ] 15b Unit tests run
- [ ] 16 Android device testing
- [x] 17 Bug fixing (web W1, W2, W7; app avoids W3–W6)
- [ ] 18 APK generation
- [ ] 19 APK verification
- [x] 20 Documentation and final report

## Blockers
- [ ] Clean machine
- [ ] Staging URL
- [ ] Owner decisions S1–S5 (backend)
- [ ] Base branch for `mobile/delivery-app-conversion`
