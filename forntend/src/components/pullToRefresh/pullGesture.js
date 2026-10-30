export const THRESHOLD = 64;   // pull distance (after resistance) a release must reach to refresh
export const MAX_PULL = 110;
const RESISTANCE = 0.5;

// A pull that starts inside one of these belongs to that element (maps, sliders, text areas...).
const OWN_GESTURE = '[data-no-pull], input[type=range], textarea, .leaflet-container, .gm-style, [data-map]';

/**
 * Pull-down gesture on a scroll element. Only starts at the very top, only for a mostly vertical downward
 * drag, and otherwise leaves the browser's scrolling alone.
 *
 * onProgress(px)  called while pulling (0 when the pull is abandoned).
 * onRelease(px)   called when the finger lifts after a pull; return true to take over (start refreshing).
 * isDisabled()    checked at the start of each touch.
 */
export function attachPullGesture(el, { onProgress, onRelease, isDisabled = () => false }) {
  const s = { active: false, pulling: false, startX: 0, startY: 0, pull: 0 };
  const onStart = event => {
    if (isDisabled() || event.touches.length !== 1 || el.scrollTop > 0 || event.target?.closest?.(OWN_GESTURE)) { s.active = false; return; }
    s.active = true; s.pulling = false; s.pull = 0;
    s.startX = event.touches[0].clientX; s.startY = event.touches[0].clientY;
  };
  const onMove = event => {
    if (!s.active) return;
    const dx = event.touches[0].clientX - s.startX, dy = event.touches[0].clientY - s.startY;
    if (!s.pulling) {
      if (el.scrollTop > 0 || dy < -4) { s.active = false; return; }
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) return;
      s.pulling = true;
    }
    if (event.cancelable) event.preventDefault(); // keeps the browser's own reload / overscroll glow out of the way
    s.pull = Math.min(MAX_PULL, dy * RESISTANCE);
    onProgress(s.pull);
  };
  const onEnd = () => {
    if (!s.active) return;
    const wasPulling = s.pulling, pulled = wasPulling && s.pull >= THRESHOLD, amount = s.pull;
    s.active = false; s.pulling = false; s.pull = 0;
    if (!pulled) { if (wasPulling) onProgress(0); return; }
    if (!onRelease(amount)) onProgress(0);
  };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd, { passive: true });
  el.addEventListener('touchcancel', onEnd, { passive: true });
  return () => {
    el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd);
  };
}
