// Port of PromotionalSplash.jsx + SplashCard.jsx — the admin-managed promotional splash (Admin → Marketing & CMS →
// Storefront Studio). Nothing promotional is bundled: the splash, its media, schedule, frequency, duration,
// countdown and destination all come from the published storefront experience.
//
// Rules kept from the web:
// - shown only for a launch that opens on Home (not when the app opens on another screen, e.g. a notification);
// - eligibility: published and inside startAt/endAt; frequency 'launch' | 'session' | 'daily' | 'version';
//   once per launch even if the customer signs in/out;
// - the configured duration counts from when the artwork is on screen; a Skip button appears when the duration
//   is longer than SPLASH_SKIP_AFTER (15 s); the Android back button also closes it;
// - a republished splash (new revision) replaces the open one instead of closing it;
// - an expired or unpublished splash is never shown, even from cache.
// The native launch screen stays up only while that decision is made (bounded: ≤3 s storefront request).
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStorefront, useStorefrontNow, eligibleSplash, markSplash, countdown } from '../../context/StorefrontContext';
import { useUser } from '../../context/UserContext';
import { splashSeconds, SPLASH_SKIP_AFTER } from '../../shared/storefront';
import StorefrontMedia, { useMediaReady } from './StorefrontMedia';
import Celebration from '../Celebration';
import usePromotionNavigation from '../../hooks/usePromotionNavigation';
import { Text } from '../ui';
import { useAppTheme } from '../../theme/ThemeContext';

// "Once per launch" outlives sign-in/out: the module lives exactly as long as one app launch.
const shownThisLaunch = new Set();
const splashKey = splash => `${splash.id}:${splash.revision}`;
let launchScreenHidden = false;
// Other launch dialogs (location prompt, voice search) wait while the splash is on screen (web: useLaunchSplash).
const visibilityListeners = new Set();
let splashVisible = false;
const setSplashVisible = value => { if (splashVisible !== value) { splashVisible = value; visibilityListeners.forEach(fn => fn(value)); } };
export function useLaunchSplash() {
  const [visible, setVisible] = useState(splashVisible);
  useEffect(() => { visibilityListeners.add(setVisible); setVisible(splashVisible); return () => { visibilityListeners.delete(setVisible); }; }, []);
  return visible;
}
const hideLaunchScreen = () => { if (!launchScreenHidden) { launchScreenHidden = true; SplashScreen.hideAsync().catch(() => {}); } };

function SplashCard({ banner, endAt, showCountdown, onNavigate, onSkip }) {
  const now = useStorefrontNow();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const hasDestination = banner.destination?.type && banner.destination.type !== 'NONE';
  return <View style={StyleSheet.absoluteFill}>
    <StorefrontMedia banner={banner} fit="cover" priority="high" />
    <Celebration effect={banner.animation} />
    {onSkip && <Pressable accessibilityRole="button" onPress={onSkip} style={[styles.skip, { top: 14 + insets.top, right: 14 + insets.right }]}><Text style={styles.skipText}>Skip</Text></Pressable>}
    {((showCountdown && endAt) || hasDestination) && <View pointerEvents="box-none" style={[styles.actions, { bottom: 20 + insets.bottom }]}>
      {showCountdown && endAt ? <Text style={styles.countdown}>Ends in {countdown(endAt, now)}</Text> : null}
      {hasDestination && <Pressable accessibilityRole="button" onPress={() => onNavigate(banner.destination)} style={({ pressed }) => [styles.cta, { backgroundColor: theme.action, borderRadius: theme.buttonRadius }, pressed && { opacity: 0.85 }]}>
        <Text style={[styles.ctaText, { color: theme.actionText }]}>{banner.cta || 'Explore now'} →</Text>
      </Pressable>}
    </View>}
  </View>;
}

export default function PromotionalSplash() {
  const { splash, theme, loading, version } = useStorefront();
  const now = useStorefrontNow();
  const { activeNav } = useUser();
  const navigate = usePromotionNavigation();
  const homeLaunch = activeNav === 'home';
  const consumed = useRef(false);
  const [open, setOpen] = useState(null);
  const [launchChecked, setLaunchChecked] = useState(false);

  useEffect(() => {
    if (launchChecked) return;
    // Decide once storefront data is known (a fresh cached copy counts), else after the bounded request.
    if (homeLaunch && loading && !version) return;
    if (homeLaunch && splash && !shownThisLaunch.has(splashKey(splash)) && eligibleSplash(splash, { now, consumed: consumed.current })) {
      consumed.current = true;
      shownThisLaunch.add(splashKey(splash));
      markSplash(splash, now);
      setOpen(splash);
    }
    setLaunchChecked(true);
  }, [splash, now, homeLaunch, launchChecked, loading, version]);

  // Never hold the native launch screen longer than the web holds its first paint.
  useEffect(() => { const timer = setTimeout(hideLaunchScreen, 3500); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (launchChecked) hideLaunchScreen(); }, [launchChecked]);

  useEffect(() => {
    if (!open || splash?.id !== open.id || splash.revision === open.revision) return;
    shownThisLaunch.add(splashKey(splash)); setOpen(splash);
  }, [splash, open]);

  const art = open && (open.banner.mobileImage || open.banner.image);
  const artReady = useMediaReady(art);
  useEffect(() => {
    if (!open || !artReady) return undefined;
    const timer = setTimeout(() => setOpen(null), splashSeconds(open.config.duration) * 1000);
    return () => clearTimeout(timer);
  }, [open, artReady]);

  const visible = Boolean(open && open.id === splash?.id && (!open.endAt || Date.parse(open.endAt) > now) && homeLaunch);
  useEffect(() => { setSplashVisible(visible); }, [visible]);
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setOpen(null); return true; });
    return () => sub.remove();
  }, [visible]);

  if (!visible) return null;
  return <View style={[StyleSheet.absoluteFill, styles.splash, { backgroundColor: theme.tokens?.header || '#79000B' }]} accessibilityViewIsModal accessibilityLabel={open.banner.title || 'Promotion'}>
    <StatusBar style="light" translucent />
    <SplashCard banner={open.banner} endAt={open.endAt} showCountdown={open.config.countdown}
      onNavigate={destination => { setOpen(null); navigate(destination); }}
      onSkip={splashSeconds(open.config.duration) > SPLASH_SKIP_AFTER ? () => setOpen(null) : undefined} />
  </View>;
}

const styles = StyleSheet.create({
  splash: { zIndex: 1000, elevation: 1000, overflow: 'hidden' },
  skip: { position: 'absolute', zIndex: 2, minHeight: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.73)', justifyContent: 'center' },
  skipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  actions: { position: 'absolute', zIndex: 1, left: 16, right: 16, alignItems: 'center', gap: 10 },
  countdown: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.73)', color: '#fff', fontSize: 13, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  cta: { minHeight: 44, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: '#D91430', alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
