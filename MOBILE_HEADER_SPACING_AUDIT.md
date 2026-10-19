# Appilix mobile header spacing fix

Date: 19 October 2026

## Finding and scope

The website added the reported status-bar inset inside `.header-primary-row` using:

```css
padding-top: max(8px, env(safe-area-inset-top, 0px));
```

In a WebView already fitted below the Android status bar, forwarding a non-zero inset reserves that space a second time. A simulated 48px inset increased the row from 92px to approximately 128.8px and moved its brand to y=48px. The root, body, and customer shell add no duplicate top padding. The header's existing margin compensates the main area's 16px content gutter; it is unchanged.

The user confirmed that the installed app is an Appilix wrapper loading the live website. The screenshot is consistent with its native-fitted, non-fullscreen configuration. Its dashboard settings and installed APK have not been inspected directly, so this native ownership is an explicit integration assumption, not a claim that the installed binary was measured.

Appilix documents its [JavaScript bridge detection](https://appilix.com/docs/javascript-bridge-overview) and [visible system bars by default](https://appilix.com/docs/style-customization). Android documents [native/WebView double-padding and inset ownership](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets).

## Website-side implementation

| File | Change |
| --- | --- |
| `forntend/src/utils/customerHeaderInsets.js` | Selects native top-inset ownership only for Android with the documented Appilix `postMessage` bridge. All other hosts retain web ownership. Rechecks at load and pageshow without sending bridge messages or replacing callbacks. |
| `forntend/src/main.jsx` | Initializes ownership before React mounts. |
| `forntend/src/modules/User/User.css` | Uses `--customer-header-safe-area-top` for the customer header. Native ownership makes only this inset zero; normal 8px internal padding remains. Browser/PWA/iOS retain `env(safe-area-inset-top)`. Adds side-cutout protection for mobile and short landscape touch viewports. Existing desktop and logo dimensions remain unchanged. |

No new negative margins, body offsets, spacer elements, viewport-meta changes, zoom changes, or business-logic changes were introduced. Other portals and customer pages do not use the new header inset variable.

With a 48px reported inset at 390px width:

- Android Appilix native-fitted mode: header top padding is 8px; brand is approximately 9.6px below the content viewport.
- Browser/PWA or edge-to-edge web-owned mode: header top padding remains 48px to protect content under system UI.

Native mode relies on Appilix reserving the top status-bar/cutout area. Side-cutout padding stays protected on the website. Screen rotation updates the CSS inset values without adding JavaScript resize offsets.

## Edge-to-edge Appilix configuration

If Appilix is configured to draw the WebView behind system bars, it must use web ownership instead. Set this before application initialization:

```js
window.BULKIMART_HEADER_INSET_OWNER = 'web';
```

This restores safe-area padding even with an Android Appilix bridge. The default in this project targets the native-fitted app shown in the screenshot. The bridge does not expose its fullscreen/inset settings to this integration; ownership is not inferred from screen-height heuristics. An old Appilix build without the documented bridge safely retains web handling rather than guessing from a generic Android WebView user agent.

If space remains *outside* the HTML viewport, inspect Appilix App Bar, app-only injected CSS/JavaScript, popup padding, and native status-bar settings. Website CSS cannot remove a native toolbar or native view margin.

## Validation

- Production build passed.
- Five inset-ownership unit tests passed: Android Appilix, ordinary browsers/PWAs/WebViews, iOS, edge-to-edge override, and late bridge/page restore behavior.
- All 144 targeted browser assertions passed across both Quick and ShopAll, normal and non-zero top insets, Appilix native/edge modes, browser/PWA/iOS hosts, desktop widths, logo dimensions, and left/right landscape cutouts.
- All 125 existing mobile regression checks passed: 81 customer screens, 4 dialogs, 36 seller screens, and 4 startup states.

The installed APK has not been tested on a physical device. Browser tests simulate its bridge, user agent, and inset values; these are not a substitute for checking the actual Appilix settings and device screen.

QA helpers: `forntend/tests/customer-header-insets.test.mjs`, `forntend/tests/mobile-header-insets.browser.mjs`, and the `--header-insets`, `--header-host`, and `--header-landscape` modes in `forntend/tests/mobile-layout.test.mjs`. The repository's existing ignore rules keep these test directories local-only.

## Deployment and APK rebuild

Deploy the new Vite build to the live website URL used by Appilix, then reload/relaunch the app so it fetches the new HTML and hashed assets. This website-only fix does not itself require rebuilding the APK when the installed Appilix app exposes the documented bridge and retains the current native-fitted layout.

A change to native Appilix configuration, injected overrides packaged in the app, or upgrading an older wrapper without bridge support may require a new Appilix build. Nothing was deployed or changed in the Appilix dashboard during this task.
