import React from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { MediaError } from '../utils/media';
import { pickDocument } from '../utils/documents';
import { colors, radius, spacing, type } from '../theme';

/** One document slot: camera, gallery or file (PDF), with preview and remove. value: { uri, name, type } | null */
export default function DocumentField({ label, hint, required, value, onChange, disabled, error }) {
  const choose = async (source) => {
    try {
      const [doc] = await pickDocument(source);
      if (doc) onChange(doc);
    } catch (e) {
      Alert.alert(label, e instanceof MediaError ? e.message : 'Could not attach the file. Please try again.');
    }
  };
  const isImage = value?.type?.startsWith('image/');
  return (
    <View style={[styles.box, error && styles.boxError]}>
      <Text style={type.label}>{label}{required ? ' *' : ''}{hint ? <Text style={type.small}>  {hint}</Text> : null}</Text>
      {value ? (
        <View style={styles.row}>
          {isImage ? <Image source={{ uri: value.uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.pdf]}><Text style={styles.pdfText}>PDF</Text></View>}
          <Text style={[type.small, styles.flex]} numberOfLines={2}>{value.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} disabled={disabled} onPress={() => onChange(null)} hitSlop={8}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.sources}>
          {[['camera', '📷 Camera'], ['gallery', '🖼 Gallery'], ['files', '📄 PDF / file']].map(([source, title]) => (
            <Pressable key={source} accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} disabled={disabled}
              onPress={() => choose(source)} style={styles.source}>
              <Text style={styles.sourceText}>{title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.white },
  boxError: { borderColor: colors.error },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surface },
  pdf: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.errorLight },
  pdfText: { color: colors.error, fontWeight: '800', fontSize: 12 },
  flex: { flex: 1 },
  remove: { color: colors.error, fontWeight: '700' },
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: { flex: 1, minHeight: 40, borderRadius: radius.sm, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  sourceText: { color: colors.primaryDark, fontWeight: '700', fontSize: 12 },
  error: { fontSize: 12, color: colors.error },
});
