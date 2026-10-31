// Port of StorefrontMedia.jsx: a banner's image, or its video when the admin set one.
// Video autoplay is always muted; a video that fails (or stalls 10 s) falls back to the poster image; reduced
// motion shows the image; video pauses when its banner is paused or the app is in the background.
import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { mediaUrl } from '../../api/client';
import { Text } from '../ui';
import { useReducedMotion } from '../Celebration';
import { useAppTheme } from '../../theme/ThemeContext';

export function useMediaReady(src, maxWait = 4000) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!src) return undefined;
    let done = false;
    const finish = () => { if (!done) { done = true; setLoaded(src); } };
    Image.prefetch(mediaUrl(src)).then(finish, finish);
    const timer = setTimeout(finish, maxWait);
    return () => { done = true; clearTimeout(timer); };
  }, [src, maxWait]);
  return !src || loaded === src;
}

function BannerVideo({ uri, poster, banner, active, onFail, fit }) {
  const player = useVideoPlayer({ uri }, p => {
    p.muted = banner.autoplay !== false || banner.muted !== false;
    p.loop = banner.loop !== false;
    if (banner.autoplay !== false && active) p.play();
  });
  useEffect(() => {
    let ready = false;
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'readyToPlay') ready = true;
      if (next === 'error') onFail();
    });
    const timeout = setTimeout(() => { if (!ready && player.status !== 'readyToPlay') onFail(); }, 10000);
    return () => { status.remove(); clearTimeout(timeout); };
  }, [player, onFail]);
  useEffect(() => {
    const sync = () => {
      try {
        if (active && AppState.currentState === 'active' && banner.autoplay !== false) { player.muted = true; player.play(); } else player.pause();
      } catch { /* player released */ }
    };
    sync();
    const sub = AppState.addEventListener('change', sync);
    return () => sub.remove();
  }, [active, player, banner.autoplay]);
  return <View style={StyleSheet.absoluteFill}>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={fit} /> : null}
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls fullscreenOptions={{ enable: false }} accessibilityLabel={banner.title || 'Promotion'} />
  </View>;
}

/** Fills its parent. `fit`: 'contain' (hero, section) or 'cover' (splash). */
export default function StorefrontMedia({ banner, active = true, fit = 'contain', priority = 'normal' }) {
  const reduced = useReducedMotion();
  const theme = useAppTheme();
  const [failedVideo, setFailedVideo] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const image = banner.mobileImage || banner.image;
  const source = banner.mediaType === 'image' ? '' : banner.mobileVideo || banner.video;
  useEffect(() => { setFailedVideo(false); setFailedImage(false); }, [banner.id, source, image]);
  if (source && !reduced && !failedVideo) {
    return <BannerVideo key={source} uri={mediaUrl(source)} poster={image ? mediaUrl(image) : ''} banner={banner} active={active} fit={fit} onFail={() => setFailedVideo(true)} />;
  }
  if (failedImage || !image) {
    return <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: theme.primary }]} accessibilityRole="image" accessibilityLabel="Promotional image unavailable">
      <Text style={styles.fallbackText}>{banner.title || 'Discover Bulkimart'}</Text>
    </View>;
  }
  return <Image source={{ uri: mediaUrl(image) }} style={StyleSheet.absoluteFill} contentFit={fit} priority={priority}
    accessibilityLabel={banner.title || 'Bulkimart promotion'} onError={() => setFailedImage(true)} transition={0} />;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  fallbackText: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center' },
});
