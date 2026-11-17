// Port of HeroBanner.jsx + FestiveHeader.jsx (mobile layout from Storefront.css).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { useStorefront, useStorefrontNow } from '../../context/StorefrontContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { DEFAULT_HEADER, DEFAULT_COUNTDOWN, countdownState, countdownParts, headerDestination } from '../../shared/storefront';
import { boundedFetch, mediaUrl } from '../../api/client';
import StorefrontMedia from './StorefrontMedia';
import Celebration, { useReducedMotion } from '../Celebration';
import { resolveSubheaderEffect } from '../../shared/celebration';
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

/**
 * Christmas snow-cap (theme decoration 'snow'): a scalloped drift of snow resting on the top edge of
 * its host (web: `[data-decoration="snow"] .sf-hero-art::after`). Static, decorative, never blocks taps.
 */
export function SnowCap({ small: compact = false }) {
  const [width, setWidth] = useState(0);
  // `small` is the drift on category tiles (web: `.category-circle-wrapper::after`).
  const big = compact ? 16 : 24, small = compact ? 0 : 12, base = compact ? 4 : 6, height = compact ? 11 : 18;
  let d = `M0 0H${width}V${base}`;
  for (let x = width; x > 0; x -= big) { const r = Math.min(big / 2, x / 2); d += `A${r} ${r * 0.85} 0 0 1 ${x - 2 * r} ${base}`; }
  d += 'Z';
  // Smaller drifts where two scallops meet.
  const bumps = small ? Array.from({ length: Math.ceil(width / big) + 1 }, (_, i) => width - i * big) : [];
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.snowCap, { height }]} onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))}>
    {width > 0 && <Svg width={width} height={height}>
      <Path d={d} fill="#000000" opacity={0.08} transform="translate(0 1.5)" />
      <Path d={d} fill="#FFFFFF" />
      {bumps.map(x => <Circle key={x} cx={x} cy={4} r={small / 2} fill="#FFFFFF" />)}
    </Svg>}
  </View>;
}
export const isSnowTheme = theme => theme?.tokens?.decoration === 'snow';
/** A snowflake before a section title (web: `.section-title::before`). Nest inside the title's <Text>. */
export function Snowflake({ theme }) {
  return isSnowTheme(theme) ? <Text style={{ color: theme.primary, fontSize: 13 }}>{'❄  '}</Text> : null;
}

function useReveal(enabled) {
  const value = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => { if (enabled) Animated.timing(value, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [enabled, value]);
  return { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] };
}

function CtaButton({ title, onPress, colors, small = false }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cta, small && styles.ctaSmall, { backgroundColor: colors?.bg || theme.highlight, borderRadius: theme.buttonRadius }, pressed && { opacity: 0.85 }]}>
    <Text style={[styles.ctaText, small && { fontSize: 11.5 }, { color: colors?.fg || theme.highlightText }]}>{title}</Text>
  </Pressable>;
}

/**
 * `showDefault`: whether to show the built-in "Everyday finds" picture when Storefront Studio has no banner.
 * Category tabs pass false so the bundled picture does not fill the screen above a category's products;
 * banners published in Studio (including category-targeted ones) always show.
 */
export default function HeroBanner({ showDefault = true }) {
  const theme = useAppTheme();
  const { banners, loading } = useStorefront();
  const navigate = usePromotionNavigation();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0), paused = false;
  const current = index % Math.max(1, banners.length), banner = banners[current];
  const reveal = useReveal(theme.tokens.motion === 'gentle' && !reduced);
  useEffect(() => {
    if (banners.length < 2 || paused || reduced || banner?.video) return undefined;
    const timer = setInterval(() => setIndex(i => i + 1), 6000);
    return () => clearInterval(timer);
  }, [banners.length, paused, reduced, banner?.video]);
  const decoration = theme.tokens.decoration;
  if (!banner) {
    if (!showDefault) return null;
    if (loading) return <View style={[styles.skeleton, { backgroundColor: theme.border }]} accessibilityLabel="Loading promotions" />;
    return <Animated.View style={reveal}>
      <Pressable onPress={() => navigate({ type: 'NAV', id: 'categories' })} accessibilityRole="button" accessibilityLabel="Explore products">
        <Image source={defaultBanner} style={{ width: '100%', aspectRatio: 1774 / 887 }} contentFit="contain" accessibilityLabel="Bulkimart — Everyday finds. One smart shop. Discover products from shops and local sellers." />
        {decoration === 'snow' && <SnowCap />}
      </Pressable>
      {decoration === 'confetti' && <DashedRule color={theme.accent} />}
    </Animated.View>;
  }
  const go = () => { boundedFetch(`/api/banners/${banner.id}/click`, { method: 'POST' }).catch(() => {}); navigate(banner.destination); };
  const link = banner.destination.type !== 'NONE';
  return <Animated.View style={[styles.hero, reveal]} accessibilityLabel="Featured promotions">
    <Pressable onPress={link ? go : undefined} disabled={!link} style={[styles.heroArt, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole={link ? 'button' : 'image'} accessibilityLabel={banner.title || 'Promotion'}>
      <StorefrontMedia key={banner.id} banner={banner} active={!paused} priority="high" />
      <Celebration effect={paused ? null : banner.animation} />
      {decoration === 'snow' && <SnowCap />}
      {banners.length > 1 && (
        <View style={styles.dotsContainer}>
          {banners.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === current && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}
      {/* Title, subtitle and button sit on the lower part of the picture. */}
      {banner.showText && (banner.title || banner.subtitle || link) ? <LinearGradient colors={['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.78)']} locations={[0, 0.45, 1]} style={styles.heroCopy}>
        {banner.title ? <Text style={styles.heroTitle} numberOfLines={2}>{banner.title}</Text> : null}
        {banner.subtitle ? <Text style={styles.heroSub} numberOfLines={2}>{banner.subtitle}</Text> : null}
        {link && <CtaButton title={`${banner.cta || 'Explore now'} →`} onPress={go} small />}
      </LinearGradient> : null}
    </Pressable>
    {decoration === 'confetti' && <DashedRule color={theme.accent} />}
  </Animated.View>;
}

// ---- Festive header ----
const pad = n => String(n).padStart(2, '0');
export const normalizeHeader = header => (header ? { ...DEFAULT_HEADER, ...header, countdown: { ...DEFAULT_COUNTDOWN, ...header.countdown } } : null);
export const hasFestiveHeader = theme => { const header = normalizeHeader(theme?.header); return !!(header?.enabled && header.title); };

const Digit = ({ value, unit, text }) => <View style={[styles.digit, { backgroundColor: alpha(text, 0.15), borderColor: alpha(text, 0.32) }]}>
  <Text style={[styles.digitValue, { color: text }]}>{value}</Text>
  <Text style={[styles.digitUnit, { color: alpha(text, 0.8) }]}>{unit}</Text>
</View>;
const Colon = ({ text }) => <Text style={[styles.digitColon, { color: alpha(text, 0.55) }]}>:</Text>;

function FestiveButton({ title, onPress, bg, fg }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.festiveButton, { backgroundColor: bg }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
    <Text style={[styles.festiveButtonText, { color: fg }]} numberOfLines={1}>{title}</Text>
    <View style={[styles.festiveButtonArrow, { backgroundColor: fg }]}><Text style={{ color: bg, fontSize: 15, fontWeight: '800' }}>→</Text></View>
  </Pressable>;
}

function FestiveCountdown({ countdown: config, background, text }) {
  const now = useStorefrontNow();
  const state = countdownState(config, now);
  if (state.phase === 'off' || (state.phase === 'after' && !config.expiredText)) return null;
  const box = [styles.festiveCountdownPill, { backgroundColor: alpha(text, 0.14), borderColor: alpha(text, 0.3) }];
  if (state.phase === 'after') return <Text style={[box, { color: text }]}>{config.expiredText}</Text>;
  if (state.phase === 'live') return <View style={box}><Text style={{ color: text, fontSize: 12, fontWeight: '700' }}>{config.title || 'Sale is live'}</Text></View>;
  const { days, hours, minutes, seconds } = countdownParts(state.remaining), label = state.phase === 'before' ? 'Starts in' : 'Ends in';
  return <View style={styles.festiveCountdown} accessible accessibilityLabel={`${config.title ? `${config.title}, ` : ''}${label} ${days > 0 ? `${days} days ` : ''}${hours} hours ${minutes} minutes ${seconds} seconds`}>
    <Text style={[styles.countdownLabel, { color: text, textShadowColor: background }]}>{(config.title ? `${config.title} · ${label}` : label).toUpperCase()}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
      {days > 0 && <Digit value={days} unit={days === 1 ? 'DAY' : 'DAYS'} text={text} />}
      <Digit value={pad(hours)} unit="HRS" text={text} /><Colon text={text} /><Digit value={pad(minutes)} unit="MIN" text={text} /><Colon text={text} /><Digit value={pad(seconds)} unit="SEC" text={text} />
    </View>
  </View>;
}

function FestiveVideo({ uri, poster, style, onFail }) {
  const player = useVideoPlayer({ uri }, p => { p.muted = true; p.loop = true; p.play(); });
  useEffect(() => {
    const status = player.addListener('statusChange', ({ status: next }) => { if (next === 'error') onFail(); });
    const sync = () => { try { if (AppState.currentState === 'active') player.play(); else player.pause(); } catch { /* player released */ } };
    const app = AppState.addEventListener('change', sync);
    return () => { status.remove(); app.remove(); };
  }, [player, onFail]);
  return <View style={style}>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} fullscreenOptions={{ enable: false }} />
  </View>;
}

// Sub-header artwork fills the whole strip: muted looping video (image as poster), or the image alone.
function FestiveArt({ image, video }) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [video]);
  const style = [StyleSheet.absoluteFill, { pointerEvents: 'none' }];
  if (video && !reduced && !failed) return <FestiveVideo key={video} uri={mediaUrl(video)} poster={image ? mediaUrl(image) : ''} style={style} onFail={() => setFailed(true)} />;
  return image ? <Image source={{ uri: mediaUrl(image) }} style={style} contentFit="cover" /> : null;
}

export function StorefrontFestiveHeader() {
  const { theme: published, effect } = useStorefront();
  const theme = useAppTheme();
  const navigate = usePromotionNavigation();
  if (!hasFestiveHeader(published)) return null;
  const header = normalizeHeader(published.header);
  const destination = headerDestination(header);
  const subheaderEffect = resolveSubheaderEffect(header, effect);
  return <View style={[styles.festive, { minHeight: header.height, backgroundColor: header.background, borderRadius: 16 }]} accessibilityLabel={header.title || 'Festive offers'}>
    <FestiveArt image={header.image} video={header.video} />
    {header.image || header.video ? <LinearGradient pointerEvents="none" colors={[alpha(header.background, 0.8), alpha(header.background, 0.35), 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} /> : null}
    <Celebration effect={subheaderEffect} />
    {isSnowTheme(theme) && <SnowCap />}
    <View style={[styles.festiveContent, { minHeight: header.height }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.festiveTitle, { color: header.text, textShadowColor: header.background }]}>{header.title}</Text>
        {header.subtitle ? <Text style={{ marginTop: 8, fontSize: 12.5, lineHeight: 19, color: header.text, textShadowColor: header.background, textShadowRadius: 6 }}>{header.subtitle}</Text> : null}
        <View style={styles.festiveActions}>
          <FestiveCountdown countdown={header.countdown} background={header.background} text={header.text} />
          {destination.type !== 'NONE' && header.cta ? <FestiveButton title={header.cta} onPress={() => navigate(destination)} bg={theme.highlight} fg={theme.highlightText} /> : null}
        </View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  snowCap: { position: 'absolute', top: 0, left: 0, right: 0, height: 18, zIndex: 1 },
  skeleton: { height: 180, marginVertical: 12, borderRadius: 20 },
  hero: { marginBottom: 22, gap: 12 },
  heroArt: { aspectRatio: 1.8, overflow: 'hidden', borderRadius: 16, borderWidth: 1 },
  heroCopy: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, paddingTop: 32, paddingHorizontal: 14, paddingBottom: 12 },
  ctaSmall: { minHeight: 32, paddingVertical: 6, paddingHorizontal: 12 },
  lights: { position: 'absolute', top: 0, left: 0, right: 0, height: 12, flexDirection: 'row', justifyContent: 'space-around' },
  bulb: { width: 6, height: 6, borderRadius: 3, marginTop: 0 },
  eyebrow: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1.6, lineHeight: 15 },
  heroTitle: { color: '#fff', fontSize: 18, lineHeight: 22, letterSpacing: -0.5, marginBottom: 2, fontWeight: '700', maxWidth: '85%', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  heroSub: { color: '#fff', fontSize: 11.5, lineHeight: 16, marginBottom: 8, maxWidth: '85%', opacity: 0.92 },
  cta: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 13, fontWeight: '700' },
  dotsContainer: { position: 'absolute', top: 10, right: 10, zIndex: 3, flexDirection: 'row', gap: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { width: 16, backgroundColor: '#ffffff' },
  festive: { overflow: 'hidden', marginBottom: 14 },
  festiveContent: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 38, paddingHorizontal: 16, paddingBottom: 48 },
  festiveTitle: { fontSize: 22, fontWeight: '800', lineHeight: 25, letterSpacing: -0.6, textShadowRadius: 6 },
  festiveActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginTop: 14 },
  festiveCountdown: { alignSelf: 'flex-start', gap: 6 },
  festiveCountdownPill: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, overflow: 'hidden', fontSize: 12.5, fontWeight: '700' },
  countdownLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, textShadowRadius: 4 },
  digit: { minWidth: 42, paddingTop: 6, paddingBottom: 5, paddingHorizontal: 4, borderRadius: 11, borderWidth: 1, alignItems: 'center' },
  digitValue: { fontSize: 18, fontWeight: '800', lineHeight: 20, fontVariant: ['tabular-nums'] },
  digitUnit: { marginTop: 3, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  digitColon: { fontSize: 16, fontWeight: '800', lineHeight: 32 },
  festiveButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 12, paddingLeft: 18, paddingRight: 6, paddingVertical: 6, borderRadius: 999, elevation: 6, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  festiveButtonText: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  festiveButtonArrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
