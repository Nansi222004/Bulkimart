import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { getTrainingVideos } from '../../services/training.api';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Menu → Training videos: how-to videos an admin publishes for sellers (admin panel → Training & Coaching
 * Videos), grouped by topic. Optional. Videos play inside the app (TrainingPlayerScreen).
 * Watched videos are remembered on this phone.
 */
const WATCHED_KEY = 'bulkimart.seller.trainingWatched';
const length = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');

export default function TrainingScreen({ navigation }) {
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [watched, setWatched] = useState({});

  const load = useCallback(async () => {
    setError('');
    try { setVideos((await getTrainingVideos()) || []); }
    catch (e) { setError(e.message || 'Could not load training videos.'); }
  }, []);
  useEffect(() => {
    load();
    AsyncStorage.getItem(WATCHED_KEY).then((v) => { if (v) setWatched(JSON.parse(v) || {}); }).catch(() => {});
  }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const open = (v) => {
    navigation.navigate('TrainingPlayer', { video: v });
    setWatched((w) => {
      const next = { ...w, [v._id]: true };
      AsyncStorage.setItem(WATCHED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  if (error && !videos) return <ErrorView message={error} onRetry={load} />;
  if (!videos) return <LoadingView message="Loading training videos…" />;
  if (!videos.length) return <EmptyView title="No training videos yet" message="Videos on how to use the app will appear here." />;

  const topics = [...new Set(videos.map((v) => v.topic || 'General'))];
  const done = videos.filter((v) => watched[v._id]).length;
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.intro}>
        <Text style={type.heading}>Learn the app</Text>
        <Text style={type.small}>Short videos on listing products, handling orders, payouts and more. {done} of {videos.length} watched.</Text>
      </View>
      {topics.map((topic) => (
        <View key={topic} style={styles.section}>
          <Text style={styles.topic}>{topic}</Text>
          {videos.filter((v) => (v.topic || 'General') === topic).map((v) => (
            <Pressable key={v._id} onPress={() => open(v)} accessibilityRole="button" accessibilityLabel={`Play ${v.title}`}
              android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
              <View style={styles.thumb}>
                {v.thumbnailUrl ? <Image source={{ uri: v.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                <View style={styles.play}><Text style={styles.playIcon}>▶</Text></View>
                {v.durationSec ? <Text style={styles.duration}>{length(v.durationSec)}</Text> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={2}>{v.title}</Text>
                {v.description ? <Text style={type.small} numberOfLines={2}>{v.description}</Text> : null}
                {watched[v._id] ? <Text style={styles.watched}>✓ Watched</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.xs, marginBottom: spacing.md },
  section: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  topic: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  thumb: { width: 112, height: 63, borderRadius: radius.sm, backgroundColor: colors.deepBlue, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  play: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: colors.white, fontSize: 14, marginLeft: 2 },
  duration: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.7)', color: colors.white, fontSize: 11, fontWeight: '700', paddingHorizontal: 4, borderRadius: 4 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  watched: { fontSize: 12, fontWeight: '700', color: colors.success, marginTop: 2 },
});
