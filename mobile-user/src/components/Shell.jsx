// Screen chrome shared by the customer pages:
// - BottomNav (BottomNav.jsx) — hidden while the keyboard is open (web useTypingFocus) and on checkout;
// - FloatingCartBar (LandingPage.jsx) on Home and Categories;
// - RealtimeNotice (components/RealtimeNotice.jsx);
// - CustomerPage: status bar + safe areas + bottom nav, and the sign-in gate for account-only pages
//   (web LandingPage `protectedNavItems` → AuthPage; CustomerSessionGate "Verifying your session…").
import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useUser } from '../context/UserContext';
import { useSession } from '../context/SessionContext';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { socket } from '../lib/socket';
import { Text, Button } from './ui';
import { ChevronRight, GridIcon, HomeIcon, OrdersIcon, UserIcon } from './icons';
import AuthPage from '../screens/AuthPage';
import ErrorBoundary from './ErrorBoundary';

export const BOTTOM_NAV_HEIGHT = 64;

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

/** Light status-bar icons on a dark background, dark icons on a light one. */
export function isDark(hex) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return false;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

const NAV = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'categories', label: 'Categories', Icon: GridIcon },
  { id: 'orders', label: 'Orders', Icon: OrdersIcon },
  { id: 'account', label: 'Profile', Icon: UserIcon },
];

export function BottomNav() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const typing = useKeyboardVisible();
  const { activeNav, setActiveNav } = useUser();
  if (typing) return null;
  return <View style={[styles.bottomNav, { backgroundColor: theme.navSurface, borderTopColor: theme.border, paddingBottom: 10 + insets.bottom }]} accessibilityRole="tablist" accessibilityLabel="Customer navigation">
    {NAV.map(({ id, label, Icon }) => {
      const active = activeNav === id;
      const color = active ? theme.navActive : theme.navText;
      return <Pressable key={id} onPress={() => setActiveNav(id)} style={styles.navItem} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label}>
        <View style={[styles.navIcon, active && { backgroundColor: alpha(theme.navActive, 0.09) }]}><Icon size={23} color={color} filled={active} /></View>
        <Text style={[styles.navLabel, { color, fontWeight: active ? '800' : '600' }]}>{label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function FloatingCartBar() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { getCartCount, getCartSubtotal, activeNav, setActiveNav } = useUser();
  const typing = useKeyboardVisible();
  const count = getCartCount();
  if (count <= 0 || !['home', 'categories'].includes(activeNav) || typing) return null;
  return <Pressable onPress={() => setActiveNav('cart')} accessibilityRole="button" accessibilityLabel={`View cart, ${count} items`}
    style={[styles.cartBar, { bottom: BOTTOM_NAV_HEIGHT + insets.bottom + 10, backgroundColor: theme.primaryColor, shadowColor: theme.primary }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ fontSize: 18 }}>🛒</Text>
      <View>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{count} {count === 1 ? 'item' : 'items'} in cart</Text>
        <Text style={{ color: '#fff', fontSize: 11, opacity: 0.9 }}>From local collectives & shops</Text>
      </View>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>View Cart • ₹{getCartSubtotal()}</Text>
      <ChevronRight size={14} color="#fff" width={3} />
    </View>
  </Pressable>;
}

const SIGN_IN_ERRORS = ['Authentication required', 'Invalid or expired token'];
export function RealtimeNotice({ graceMs = 8000 }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let timer = null;
    const offline = reason => {
      if (SIGN_IN_ERRORS.includes(reason?.message)) { clearTimeout(timer); timer = null; setState('signin'); return; }
      if (reason === 'io client disconnect' || timer || socket.connected) return;
      timer = setTimeout(() => { timer = null; if (!socket.connected) setState('offline'); }, graceMs);
    };
    const online = () => { clearTimeout(timer); timer = null; setState(null); };
    socket.on('connect_error', offline); socket.on('disconnect', offline); socket.on('connect', online);
    return () => { clearTimeout(timer); socket.off('connect_error', offline); socket.off('disconnect', offline); socket.off('connect', online); };
  }, [graceMs]);
  if (!state) return null;
  return <View accessibilityLiveRegion="polite" style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff7ed' }}>
    <Text style={{ color: '#7c2d12', fontSize: 14 }}>{state === 'signin' ? 'Your session has expired. Please log out and sign in again to get live order updates.' : 'Live updates are unavailable. You can still place orders. Refresh your orders to check the latest status.'}</Text>
  </View>;
}

/** Session verification failed (offline at launch): banner with Retry, as the web gate shows. */
function SessionNotice() {
  const session = useSession();
  if (!session.error) return null;
  return <View accessibilityRole="alert" style={{ padding: 10, backgroundColor: '#fff1f2', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <Text style={{ flex: 1, color: '#991b1b', fontSize: 13 }}>{session.error}</Text>
    <Button title="Retry" variant="secondary" onPress={session.retry} style={{ minHeight: 36 }} />
  </View>;
}

/**
 * One customer page. `headerColor` paints the area behind the status bar (the header colour on header pages).
 * `protectedPage` shows the sign-in page to guests, and "Verifying your session…" while a stored session is checked.
 */
export function CustomerPage({ children, protectedPage = false, nav = true, cartBar = false, headerColor, background, edges = true }) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { currentUser } = useUser();
  const session = useSession();
  const top = headerColor || background || theme.pageBackground;
  if (protectedPage && !currentUser) {
    if (session.loading) return <View style={[styles.fill, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.pageBackground }]}><StatusBar style="dark" /><Text accessibilityLiveRegion="polite">Verifying your session…</Text></View>;
    return <View style={styles.fill}><StatusBar style="dark" /><SessionNotice /><AuthPage /></View>;
  }
  return <View style={[styles.fill, { backgroundColor: background || theme.pageBackground }]}>
    <StatusBar style={isDark(top) ? 'light' : 'dark'} />
    {edges && <View style={{ height: insets.top, backgroundColor: top }} />}
    <SessionNotice />
    {currentUser && <RealtimeNotice />}
    <View style={styles.fill}><ErrorBoundary>{children}</ErrorBoundary></View>
    {cartBar && <FloatingCartBar />}
    {nav && <BottomNav />}
  </View>;
}

/** Bottom padding so content clears the bottom nav (web: padding-bottom 90px + safe area). */
export function useNavPadding(extra = 26) {
  const insets = useSafeAreaInsets();
  return BOTTOM_NAV_HEIGHT + insets.bottom + extra;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottomNav: { flexDirection: 'row', paddingTop: 10, paddingHorizontal: 4, borderTopWidth: 1, elevation: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: -5 } },
  navItem: { flex: 1, alignItems: 'center', gap: 4, padding: 4 },
  navIcon: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 10 },
  cartBar: { position: 'absolute', left: 16, right: 16, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 10, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, zIndex: 90 },
});
