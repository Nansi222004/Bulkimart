// Port of HeroBanner.jsx + FestiveHeader.jsx (mobile layout from Storefront.css).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useStorefront, useStorefrontNow } from '../../context/StorefrontContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { DEFAULT_HEADER, DEFAULT_COUNTDOWN, countdownState, countdownParts, headerDestination } from '../../shared/storefront';
import { boundedFetch } from '../../api/client';
import StorefrontMedia from './StorefrontMedia';
import Celebration, { useReducedMotion } from '../Celebration';
import usePromotionNavigation from '../../hooks/usePromotionNavigation';
import { Text } from '../ui';
import { alpha } from '../../theme';

const defaultBanner = require('../../../assets/images/banner1.webp');

/** A row of dashes (CSS `border-bottom: 5px dashed`). */
export function DashedRule({ color, height = 5, dash = 15, gap = 10 }) {
  const [width, setWidth] = useState(0);
  const count = Math.ceil(width / (dash + gap));
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height, flexDirection: 'row', overflow: 'hidden', gap }}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={{ width: dash, height, backgroundColor: color }} />)}
  </View>;
}

function useReveal(enabled) {
  const value = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => { if (enabled) Animated.timing(value, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [enabled, value]);
  return { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] };
}

function CtaButton({ title, onPress, colors }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cta, { backgroundColor: colors?.bg || theme.highlight, borderRadius: theme.buttonRadius }, pressed && { opacity: 0.85 }]}>
    <Text style={[styles.ctaText, { color: colors?.fg || theme.highlightText }]}>{title}</Text>
  </Pressable>;
}

export default function HeroBanner() {
  const theme = useAppTheme();
  const { banners, loading } = useStorefront();
  const reduced = useReducedMotion();
  const navigate = usePromotionNavigation();
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false);
  const current = index % Math.max(1, banners.length), banner = banners[current];
  const reveal = useReveal(theme.tokens.motion === 'gentle' && !reduced);
  useEffect(() => {
    if (banners.length < 2 || paused || reduced || banner?.video) return undefined;
    const timer = setInterval(() => setIndex(i => i + 1), 6000);
    return () => clearInterval(timer);
  }, [banners.length, paused, reduced, banner?.video]);
  const decoration = theme.tokens.decoration;
  if (!banner) {
    if (loading) return <View style={[styles.skeleton, { backgroundColor: theme.border }]} accessibilityLabel="Loading promotions" />;
    return <Animated.View style={reveal}>
      <Pressable onPress={() => navigate({ type: 'NAV', id: 'categories' })} accessibilityRole="button" accessibilityLabel="Explore products">
        <Image source={defaultBanner} style={{ width: '100%', aspectRatio: 1774 / 887 }} contentFit="contain" accessibilityLabel="Bulkimart — Everyday finds. One smart shop. Discover products from shops and local sellers." />
      </Pressable>
      {decoration === 'confetti' && <DashedRule color={theme.accent} />}
    </Animated.View>;
  }
  const go = () => { boundedFetch(`/api/banners/${banner.id}/click`, { method: 'POST' }).catch(() => {}); navigate(banner.destination); };
  const link = banner.destination.type !== 'NONE';
  const gradient = theme.tokens.gradient === 'none' ? [theme.primary, theme.primary] : [theme.secondary, theme.primary];
  return <Animated.View style={[styles.hero, { borderRadius: 16, borderColor: theme.accent }, reveal]} accessibilityLabel="Featured promotions">
    <Pressable onPress={link ? go : undefined} disabled={!link} style={[styles.heroArt, { backgroundColor: theme.surface }]} accessibilityRole={link ? 'button' : 'image'} accessibilityLabel={banner.title || 'Promotion'}>
      <StorefrontMedia key={banner.id} banner={banner} active={!paused} priority="high" />
      <Celebration effect={paused ? null : banner.animation} />
    </Pressable>
    <LinearGradient colors={gradient} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={styles.heroCopy}>
      {decoration === 'lights' && <View style={styles.lights} pointerEvents="none">{Array.from({ length: 16 }, (_, i) => <View key={i} style={[styles.bulb, { backgroundColor: theme.accent }]} />)}</View>}
      <Text style={styles.eyebrow}>DISCOVER SOMETHING GOOD</Text>
      <Text style={styles.heroTitle}>{banner.title}</Text>
      {banner.subtitle ? <Text style={styles.heroSub}>{banner.subtitle}</Text> : null}
      {link && <CtaButton title={`${banner.cta || 'Explore now'} →`} onPress={go} />}
    </LinearGradient>
    {decoration === 'confetti' && <DashedRule color={theme.accent} />}
    {banners.length > 1 && <View style={[styles.controls, { backgroundColor: theme.surface }]}>
      <Pressable accessibilityLabel="Previous promotion" onPress={() => setIndex(current + banners.length - 1)} style={styles.ctrl}><Text>←</Text></Pressable>
      <Text style={{ fontSize: 11 }}>{current + 1} / {banners.length}</Text>
      <Pressable accessibilityLabel="Next promotion" onPress={() => setIndex(current + 1)} style={styles.ctrl}><Text>→</Text></Pressable>
      <Pressable accessibilityLabel={paused ? 'Resume promotions' : 'Pause promotions'} onPress={() => setPaused(p => !p)} style={styles.ctrl}><Text style={{ fontSize: 11 }}>{paused ? 'Play' : 'Pause'}</Text></Pressable>
    </View>}
  </Animated.View>;
}

// ---- Festive header ----
const pad = n => String(n).padStart(2, '0');
export const normalizeHeader = header => (header ? { ...DEFAULT_HEADER, ...header, countdown: { ...DEFAULT_COUNTDOWN, ...header.countdown } } : null);
export const hasFestiveHeader = theme => { const header = normalizeHeader(theme?.header); return !!(header?.enabled && header.title); };

const Digit = ({ value, background, text }) => <Text style={[styles.digit, { backgroundColor: text, color: background }]}>{value}</Text>;

function FestiveCountdown({ countdown: config, background, text }) {
  const now = useStorefrontNow();
  const state = countdownState(config, now);
  if (state.phase === 'off' || (state.phase === 'after' && !config.expiredText)) return null;
  const box = [styles.festiveCountdown, { backgroundColor: background, borderColor: alpha(text, 0.4) }];
  if (state.phase === 'after') return <Text style={[box, { color: text }]}>{config.expiredText}</Text>;
  if (state.phase === 'live') return <View style={box}><Text style={{ color: text, fontSize: 12, fontWeight: '700' }}>{config.title || 'Sale is live'}</Text></View>;
  const { days, hours, minutes, seconds } = countdownParts(state.remaining), label = state.phase === 'before' ? 'Starts in' : 'Ends in';
  return <View style={box}>
    <Text style={{ color: text, fontSize: 12, fontWeight: '700' }}>{config.title ? `${config.title} · ${label}` : label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {days > 0 && <><Digit value={days} background={background} text={text} /><Text style={{ color: text, fontSize: 15 }}>d </Text></>}
      <Digit value={pad(hours)} background={background} text={text} /><Text style={{ color: text, fontSize: 15 }}>:</Text><Digit value={pad(minutes)} background={background} text={text} /><Text style={{ color: text, fontSize: 15 }}>:</Text><Digit value={pad(seconds)} background={background} text={text} />
    </View>
  </View>;
}

export function StorefrontFestiveHeader() {
  const { theme: published, effect } = useStorefront();
  const theme = useAppTheme();
  const navigate = usePromotionNavigation();
  if (!hasFestiveHeader(published)) return null;
  const header = normalizeHeader(published.header);
  const destination = headerDestination(header);
  return <View style={[styles.festive, { minHeight: header.height, backgroundColor: header.background, borderRadius: 16 }]} accessibilityLabel={header.title || 'Festive offers'}>
    <Celebration effect={effect} />
    <View style={[styles.festiveContent, { minHeight: header.height }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.festiveTitle, { color: header.text, textShadowColor: header.background }]}>{header.title}</Text>
        {header.subtitle ? <Text style={{ marginTop: 8, fontSize: 12.5, lineHeight: 19, color: header.text, textShadowColor: header.background, textShadowRadius: 6 }}>{header.subtitle}</Text> : null}
        <FestiveCountdown countdown={header.countdown} background={header.background} text={header.text} />
        {destination.type !== 'NONE' && header.cta ? <View style={{ marginTop: 14 }}><CtaButton title={`${header.cta} →`} onPress={() => navigate(destination)} colors={{ bg: theme.highlight, fg: theme.highlightText }} /></View> : null}
      </View>
      {header.image ? <Image source={{ uri: header.image }} style={{ width: '32%', height: Math.max(40, header.height - 32) }} contentFit="contain" /> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  skeleton: { height: 180, marginVertical: 12, borderRadius: 20 },
  hero: { overflow: 'hidden', borderWidth: 1, borderBottomWidth: 3, marginBottom: 22 },
  heroArt: { aspectRatio: 1.8, overflow: 'hidden' },
  heroCopy: { paddingTop: 24, paddingHorizontal: 16, paddingBottom: 50 },
  lights: { position: 'absolute', top: 0, left: 0, right: 0, height: 12, flexDirection: 'row', justifyContent: 'space-around' },
  bulb: { width: 6, height: 6, borderRadius: 3, marginTop: 0 },
  eyebrow: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1.6, lineHeight: 15 },
  heroTitle: { color: '#fff', fontSize: 25, lineHeight: 28, letterSpacing: -0.9, marginVertical: 10, fontWeight: '700' },
  heroSub: { color: '#fff', fontSize: 12, lineHeight: 19, marginBottom: 12 },
  cta: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 13, fontWeight: '700' },
  controls: { position: 'absolute', bottom: 10, right: 16, flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: 24, paddingVertical: 2, paddingHorizontal: 4 },
  ctrl: { minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  festive: { overflow: 'hidden', marginBottom: 14 },
  festiveContent: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 38, paddingHorizontal: 16, paddingBottom: 48 },
  festiveTitle: { fontSize: 22, fontWeight: '800', lineHeight: 25, letterSpacing: -0.6, textShadowRadius: 6 },
  festiveCountdown: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 12, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  digit: { minWidth: 26, paddingVertical: 2, paddingHorizontal: 3, borderRadius: 6, textAlign: 'center', fontSize: 15, fontVariant: ['tabular-nums'], overflow: 'hidden' },
});
