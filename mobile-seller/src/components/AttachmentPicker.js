import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { MediaError } from '../utils/media';
import { pickDocument } from '../utils/documents';
import { colors, radius, spacing, type } from '../theme';

/** Up to `max` attachments (images or PDF). files: [{ uri, name, type }] */
export default function AttachmentPicker({ files, onChange, max = 5, disabled }) {
  const remaining = max - files.length;
  const add = async (source) => {
    try {
      const picked = await pickDocument(source, { multiple: true, limit: remaining });
      if (!picked.length) return;
      if (files.length + picked.length > max) Alert.alert('Attachments', `You can attach at most ${max} files. Extra files were left out.`);
      onChange([...files, ...picked].slice(0, max));
    } catch (e) {
      Alert.alert('Attachments', e instanceof MediaError ? e.message : 'Could not attach the file.');
    }
  };
  return (
    <View style={styles.wrap}>
      {files.map((f, i) => (
        <View key={`${f.uri}:${i}`} style={styles.file}>
          <Text style={[type.small, styles.flex]} numberOfLines={1}>{f.type === 'application/pdf' ? '📄' : '🖼'} {f.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} disabled={disabled} onPress={() => onChange(files.filter((_, j) => j !== i))} hitSlop={8}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {remaining > 0 ? (
        <View style={styles.sources}>
          {[['camera', '📷 Camera'], ['gallery', '🖼 Gallery'], ['files', '📄 Files']].map(([source, title]) => (
            <Pressable key={source} accessibilityRole="button" disabled={disabled} onPress={() => add(source)} style={styles.source}>
              <Text style={styles.sourceText}>{title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={type.small}>{files.length}/{max} attachments · JPG, PNG, WEBP or PDF, up to 5 MB each</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm },
  flex: { flex: 1 },
  remove: { color: colors.error, fontWeight: '700', fontSize: 12 },
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: { flex: 1, minHeight: 38, borderRadius: radius.sm, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  sourceText: { color: colors.primaryDark, fontWeight: '700', fontSize: 12 },
});
