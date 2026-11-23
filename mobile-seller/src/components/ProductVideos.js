import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import AppButton from './AppButton';
import UploadProgress from './UploadProgress';
import { InlineNotice } from './StateViews';
import { MediaError, pickVideo } from '../utils/media';
import { uploadProductVideo } from '../services/product.api';
import { colors, radius, spacing, type } from '../theme';

// Port of frontend/src/modules/Seller/components/ProductVideosField.jsx. Each video uploads straight away to
// Bulkimart's server; `value` is the list of saved video links that the product form sends in `videos`.
export const MAX_PRODUCT_VIDEOS = 2;

export default function ProductVideos({ value, onChange, disabled }) {
  const videos = Array.isArray(value) ? value : [];
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const uploading = progress !== null;

  const add = async () => {
    setError('');
    try {
      const video = await pickVideo();
      if (!video) return;
      setProgress(0);
      const data = await uploadProductVideo(video, setProgress);
      onChange([...videos, data.url].slice(0, MAX_PRODUCT_VIDEOS));
    } catch (e) {
      setError(e instanceof MediaError ? e.message : e.message || 'Video upload failed. Please try again.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={type.small}>Optional, up to {MAX_PRODUCT_VIDEOS}. MP4 (H.264), up to 60 seconds, 1080p, 50 MB. Shown after the photos on the product page.</Text>
      {videos.map((url, i) => (
        <View key={url} style={styles.row}>
          <Text style={[styles.flex, styles.name]}>🎬 Video {i + 1} uploaded</Text>
          <AppButton small variant="outline" title="Play" disabled={uploading} onPress={() => Linking.openURL(url)} />
          <AppButton small variant="outline" title="Remove" disabled={disabled || uploading} onPress={() => onChange(videos.filter((_, j) => j !== i))} />
        </View>
      ))}
      {uploading ? <UploadProgress progress={progress} label="Uploading video" /> : null}
      {videos.length < MAX_PRODUCT_VIDEOS ? (
        <AppButton title={videos.length ? 'Add another video' : 'Add product video'} variant="outline" loading={uploading} disabled={disabled} onPress={add} />
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm },
  name: { fontWeight: '700', color: colors.text },
});
