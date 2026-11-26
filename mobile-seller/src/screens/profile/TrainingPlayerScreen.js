import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Video from 'react-native-video';
import { WebView } from 'react-native-webview';
import { Text } from '../../components/AppText';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Plays one training video inside the app.
 * Uploaded MP4 (our server): react-native-video with its own controls and full-screen button.
 * YouTube: YouTube's embedded player in a WebView. It is loaded from an HTML page with a real https
 * base URL, because YouTube refuses to play embeds that arrive without an origin ("Video unavailable").
 * Either way, "Open in YouTube / browser" is offered if playback fails on a phone.
 */
const EMBED_ORIGIN = 'https://bulkimart.in';

const youtubePage = (id) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe src="https://www.youtube.com/embed/${id}?playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(EMBED_ORIGIN)}"
allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;

export default function TrainingPlayerScreen({ route }) {
  const video = route.params?.video || {};
  const { width } = useWindowDimensions();
  const height = Math.round((width * 9) / 16);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const youtube = video.source === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(video.youtubeId || '');

  return (
    <View style={styles.page}>
      <View style={[styles.player, { height }]}>
        {failed ? (
          <View style={styles.center}><Text style={styles.failText}>This video could not play here.</Text></View>
        ) : youtube ? (
          <WebView
            source={{ html: youtubePage(video.youtubeId), baseUrl: EMBED_ORIGIN }}
            style={styles.fill}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            // Only YouTube's own player pages load inside; any other link (channel, logo) opens outside the app.
            onShouldStartLoadWithRequest={(req) => {
              const inside = req.url === 'about:blank' || req.url.startsWith(EMBED_ORIGIN) || /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//.test(req.url);
              if (!inside && /^https?:/.test(req.url)) Linking.openURL(req.url).catch(() => {});
              return inside;
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
          />
        ) : video.videoUrl ? (
          <Video
            source={{ uri: video.videoUrl }}
            style={styles.fill}
            controls
            resizeMode="contain"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
          />
        ) : (
          <View style={styles.center}><Text style={styles.failText}>This video is not available.</Text></View>
        )}
        {loading && !failed && (video.videoUrl || youtube) ? <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none"><ActivityIndicator color={colors.white} /></View> : null}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={type.heading}>{video.title}</Text>
        {video.topic ? <Text style={styles.topic}>{video.topic}</Text> : null}
        {video.description ? <Text style={type.body}>{video.description}</Text> : null}
        {video.watchUrl ? (
          <Pressable onPress={() => Linking.openURL(video.watchUrl).catch(() => {})} accessibilityRole="button" style={styles.outside}>
            <Text style={styles.outsideText}>{failed ? 'Watch it ' : 'Not playing? Open '}{youtube ? 'in YouTube' : 'in your browser'} ›</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  player: { width: '100%', backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  failText: { color: colors.white, fontSize: 14 },
  body: { padding: spacing.lg, gap: spacing.sm },
  topic: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  outside: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  outsideText: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
});
