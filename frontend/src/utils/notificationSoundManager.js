// notificationSoundManager.js — foreground urgent-alert audio, shared by
// every "ring" surface (rider offers, seller new-order/subscription pings).
//
// FOREGROUND (this file): a real <audio> element, looped, while the tab is
// open and the browser's autoplay policy allows it (the first play() call
// generally needs to have happened after some user gesture on the page —
// this module does not and cannot bypass that; it just avoids fighting it).
//
// BACKGROUND/CLOSED: this cannot run at all — a closed or fully backgrounded
// tab does not execute JS. That case is handled separately, by the FCM
// service worker showing a native OS/browser notification (with whatever
// sound the OS assigns), not by anything in this file.
import ringAsset from '../assets/rider_ping_ring.wav';

let audioEl = null;
let activeKey = null;

const getAudio = () => {
  if (!audioEl) {
    audioEl = new Audio(ringAsset);
    audioEl.loop = true;
    audioEl.preload = 'auto';
  }
  return audioEl;
};

/**
 * Starts looping the ring for `key` (any stable string identifying what's
 * ringing, e.g. an order id). Calling this again with the SAME key while
 * already playing is a no-op — prevents a duplicate/overlapping instance if
 * the same event fires twice. Calling it with a DIFFERENT key restarts from
 * the top, since that means a new, different alert has started.
 */
export const startRing = (key) => {
  if (!key) return;
  const audio = getAudio();
  if (activeKey === key && !audio.paused) return; // already ringing for this alert
  activeKey = key;
  audio.currentTime = 0;
  // Autoplay can still be refused by the browser if this fires with no prior
  // user gesture anywhere on the page (e.g. the very first ping of a fresh
  // load). That is a browser policy, not a bug here — the caller's visual
  // modal is what actually carries the alert in that case, same as today.
  audio.play().catch(() => {});
};

/** Stops the ring only if it is currently ringing for `key` (or unconditionally if no key given). */
export const stopRing = (key) => {
  if (key && activeKey !== key) return;
  if (audioEl) {
    audioEl.pause();
    audioEl.currentTime = 0;
  }
  activeKey = null;
};

/** Hard stop + release, for unmount. */
export const cleanupRing = () => {
  if (audioEl) {
    audioEl.pause();
    audioEl.src = '';
  }
  audioEl = null;
  activeKey = null;
};

/**
 * A single, non-looping "ding" for a NORMAL notification (order updates,
 * admin broadcasts, etc.) — deliberately a SEPARATE `Audio` instance from
 * `audioEl` above, never the same object: `audioEl` is the urgent, looping
 * rider_ping/return_pickup_ping alarm, and this must never pause, rewind or
 * otherwise interfere with it if both happen to fire close together. Same
 * asset, reused rather than shipping a second sound file, just played once
 * at a lower volume so it reads as a notice, not an alarm.
 */
let dingEl = null;
export const playNotificationDing = () => {
  try {
    if (!dingEl) {
      dingEl = new Audio(ringAsset);
      dingEl.volume = 0.35;
    }
    dingEl.currentTime = 0;
    // Same autoplay-policy reality as startRing above: a browser that has
    // seen no prior user gesture on the page may refuse this, silently.
    dingEl.play().catch(() => {});
  } catch { /* never let a sound failure break the notification itself */ }
};
