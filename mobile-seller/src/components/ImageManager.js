import React from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MediaError, pickPhotos, takePhoto } from '../utils/media';
import { colors, radius, spacing, type } from '../theme';

/**
 * Up to `max` new photos with preview, remove, make-cover and reorder.
 * The first photo is the cover (the backend and every product card treat images[0] as the cover).
 * images: [{ uri, name, type }]
 */
export default function ImageManager({ images, onChange, max = 5, disabled }) {
  const remaining = max - images.length;

  const add = async (source) => {
    try {
      const picked = source === 'camera' ? await takePhoto() : await pickPhotos(remaining);
      if (!picked.length) return;
      onChange([...images, ...picked].slice(0, max));
      if (images.length + picked.length > max) Alert.alert('Photo limit', `Only ${max} photos can be added. Extra photos were left out.`);
    } catch (e) {
      Alert.alert('Photos', e instanceof MediaError ? e.message : 'Could not add the photo. Please try again.');
    }
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const makeCover = (index) => { const next = [...images]; const [item] = next.splice(index, 1); onChange([item, ...next]); };
  const remove = (index) => onChange(images.filter((_, i) => i !== index));

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {images.map((image, index) => (
          <View key={`${image.uri}:${index}`} style={styles.tile}>
            <Image source={{ uri: image.uri }} style={styles.image} accessibilityLabel={index === 0 ? 'Cover photo' : `Photo ${index + 1}`} />
            {index === 0 ? <Text style={styles.cover}>COVER</Text> : null}
            <View style={styles.tools}>
              <Tool label="◀" a11y="Move left" onPress={() => move(index, -1)} disabled={disabled || index === 0} />
              {index !== 0 ? <Tool label="★" a11y="Make cover" onPress={() => makeCover(index)} disabled={disabled} /> : null}
              <Tool label="▶" a11y="Move right" onPress={() => move(index, 1)} disabled={disabled || index === images.length - 1} />
              <Tool label="✕" a11y="Remove photo" onPress={() => remove(index)} disabled={disabled} danger />
            </View>
          </View>
        ))}
        {remaining > 0 ? (
          <View style={[styles.tile, styles.addTile]}>
            <Text style={type.small}>{images.length ? 'Add more' : 'Add cover photo *'}</Text>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => add('camera')} style={styles.addButton}><Text style={styles.addText}>📷 Camera</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => add('gallery')} style={styles.addButton}><Text style={styles.addText}>🖼 Gallery</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
      <Text style={type.small}>{images.length}/{max} photos · JPG, PNG or WEBP, up to 5 MB each. The first photo is the cover.</Text>
    </View>
  );
}

function Tool({ label, a11y, onPress, disabled, danger }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={onPress}
      hitSlop={6} style={[styles.tool, disabled && styles.toolDisabled]}>
      <Text style={[styles.toolText, danger && { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

const TILE = 132;
const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { gap: spacing.sm },
  tile: { width: TILE, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden' },
  image: { width: TILE, height: TILE, backgroundColor: colors.surface },
  cover: { position: 'absolute', top: 6, left: 6, backgroundColor: colors.orange, color: colors.white, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tools: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },
  tool: { minWidth: 28, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  toolDisabled: { opacity: 0.3 },
  toolText: { fontSize: 15, color: colors.deepBlue, fontWeight: '700' },
  addTile: { height: TILE + 40, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderStyle: 'dashed', padding: spacing.sm },
  addButton: { alignSelf: 'stretch', minHeight: 38, borderRadius: radius.sm, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
});
