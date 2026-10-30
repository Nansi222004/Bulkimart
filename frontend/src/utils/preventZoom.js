/**
 * Locks zoom levels across User, Seller, and Delivery web applications
 * to enforce a native mobile app-like experience (preventing pinch-to-zoom,
 * double-tap zoom, gesture zoom, trackpad pinch, and zoom key combinations).
 */
export function initAppZoomPrevention() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const preventDefault = (e) => {
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  // 1. Block iOS Safari gesture events (gesturestart, gesturechange, gestureend)
  document.addEventListener('gesturestart', preventDefault, { passive: false });
  document.addEventListener('gesturechange', preventDefault, { passive: false });
  document.addEventListener('gestureend', preventDefault, { passive: false });

  // 2. Block multi-touch pinch gestures (2 or more touches)
  const handleMultiTouch = (e) => {
    if (e.touches && e.touches.length > 1 && e.cancelable) {
      e.preventDefault();
    }
  };

  document.addEventListener('touchstart', handleMultiTouch, { passive: false });
  document.addEventListener('touchmove', handleMultiTouch, { passive: false });

  // 3. Block trackpad / desktop Ctrl + wheel zooming
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // 4. Block keyboard zoom shortcuts (Ctrl/Cmd + '+' / '-' / '0' / '=')
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  });
}
