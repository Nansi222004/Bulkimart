import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { MediaError } from '../utils/media';
import { pickDocument } from '../utils/documents';
import { uploadCatalogFile } from '../services/product.api';
import { colors, radius, spacing, type } from '../theme';

/**
 * Image / file category field (size chart, hallmark certificate …) and variant photos: picks a photo or PDF,
 * uploads it at once and stores the returned link as the field value. `kind`: 'image' (photos only) or 'file'.
 */
export default function CategoryUploadField({ label, required, hint, kind = 'image', value, onChange, disabled }) {
  const [busy, setBusy] = useState(false);
  const choose = async (source) => {
    try {
      const [doc] = await pickDocument(source);
      if (!doc) return;
      if (kind === 'image' && doc.type === 'application/pdf') { Alert.alert(label, 'This field needs a photo, not a PDF.'); return; }
      setBusy(true);
      onChange(await uploadCatalogFile(doc, kind));
    } catch (e) {
      Alert.alert(label, e instanceof MediaError ? e.message : e?.message || 'Could not upload the file. Please try again.');
    } finally { setBusy(false); }
  };
  const isImageLink = typeof value === 'string' && /^https:\/\//i.test(value) && !/\.pdf($|\?)/i.test(value);
  const sources = kind === 'image' ? [['camera', '📷 Camera'], ['gallery', '🖼 Gallery']] : [['camera', '📷 Camera'], ['gallery', '🖼 Gallery'], ['files', '📄 PDF / file']];
  return (
    <View style={styles.box}>
      <Text style={type.label}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={type.small}>{hint}</Text> : null}
      {busy ? <View style={styles.row}><ActivityIndicator color={colors.primaryDark} /><Text style={type.small}>Uploading…</Text></View>
        : value ? (
          <View style={styles.row}>
            {isImageLink ? <Image source={{ uri: value }} style={styles.thumb} /> : <View style={[styles.thumb, styles.doc]}><Text style={styles.docText}>FILE</Text></View>}
            <Text style={[type.small, styles.flex]}>Uploaded ✓</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} disabled={disabled} onPress={() => onChange('')} hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sources}>
            {sources.map(([source, title]) => (
              <Pressable key={source} accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} disabled={disabled} onPress={() => choose(source)} style={styles.source}>
                <Text style={styles.sourceText}>{title}</Text>
              </Pressable>
            ))}
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface },
  doc: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.aquaLight },
  docText: { fontSize: 11, fontWeight: '800', color: colors.primaryDark },
  remove: { color: colors.error, fontWeight: '700' },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  source: { minHeight: 40, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  sourceText: { fontWeight: '700', color: colors.primaryDark, fontSize: 13 },
});
