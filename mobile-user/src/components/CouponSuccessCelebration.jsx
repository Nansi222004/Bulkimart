// Port of CouponSuccessCelebration.jsx: a 2.6 s banner with falling confetti when a coupon applies
// (only while the cart or checkout is open). Confetti is hidden with reduced motion, as on the web.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui';
import { useAppTheme } from '../theme/ThemeContext';
import { useReducedMotion } from './Celebration';

function Piece({ index, color }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 1400, delay: index * 30, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [progress, index]);
  const drift = (index - 9) * 8;
  return <Animated.View style={[styles.piece, { left: `${8 + index * 4.7}%`, backgroundColor: color, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [
    { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 95] }) },
    { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '420deg'] }) },
  ] }]} />;
}

export default function CouponSuccessCelebration({ event, active = true }) {
  const [visible, setVisible] = useState(false);
  const playback = useRef(null);
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!event || !active) {
      setVisible(false);
      if (playback.current && playback.current.id === event?.id) playback.current.completed = true;
      return undefined;
    }
    if (playback.current?.id !== event.id) playback.current = { id: event.id, startedAt: Date.now(), completed: false };
    const remaining = 2600 - (Date.now() - playback.current.startedAt);
    if (playback.current.completed || remaining <= 0) { setVisible(false); return undefined; }
    setVisible(true);
    const timer = setTimeout(() => { playback.current.completed = true; setVisible(false); }, remaining);
    return () => clearTimeout(timer);
  }, [event?.id, active]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!event || !active || !visible) return null;
  const accent = theme.accent || '#ffd45a';
  return <View pointerEvents="none" style={[styles.wrap, { top: 16 + insets.top }]} accessibilityLiveRegion="polite">
    {!reduced && <View style={StyleSheet.absoluteFill}>{Array.from({ length: 18 }, (_, i) => <Piece key={i} index={i} color={i % 3 === 0 ? '#e54862' : i % 3 === 1 ? '#fff0b3' : accent} />)}</View>}
    <Text style={[styles.text, { backgroundColor: theme.secondary || '#79000b' }]}>Coupon {event.code} applied! {event.savings > 0 ? `You saved ₹${Number(event.savings).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.` : 'Your benefit is ready.'}</Text>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 1100, elevation: 20, alignSelf: 'center', width: '90%', maxWidth: 350 },
  piece: { position: 'absolute', top: 10, width: 7, height: 12, borderRadius: 2 },
  text: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center', overflow: 'hidden', elevation: 8 },
});
