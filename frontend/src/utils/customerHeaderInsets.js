/**
 * Native-fitted Android Appilix is this app's default integration mode.
 * Reserving that inset again inside the customer header creates a blank strip.
 * Other hosts keep CSS safe-area handling. An edge-to-edge Appilix build must
 * explicitly set window.BULKIMART_HEADER_INSET_OWNER = 'web' before app startup.
 */
export function customerHeaderInsetOwner({ userAgent = '', bridge, override } = {}) {
  if (override === 'web') return 'web';
  const androidAppilix = /Android/i.test(userAgent) && typeof bridge?.postMessage === 'function';
  return androidAppilix ? 'native' : 'web';
}

export function initCustomerHeaderInsets(host = window) {
  const update = () => {
    host.document.documentElement.dataset.customerHeaderInsetOwner = customerHeaderInsetOwner({
      userAgent: host.navigator.userAgent,
      bridge: host.appilix,
      override: host.BULKIMART_HEADER_INSET_OWNER,
    });
  };
  update();
  // Recheck after the wrapper/page finishes loading and on back-forward restore.
  host.addEventListener('load', update);
  host.addEventListener('pageshow', update);
}
