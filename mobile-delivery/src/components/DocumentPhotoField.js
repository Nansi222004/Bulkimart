import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import AppButton from './AppButton';
import { colors, radius, spacing, type } from '../theme';

// Same limits as backend/middlewares/upload.middleware.js (5 MB; JPEG, PNG, WEBP).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export function checkPickedFile(asset) {
  if (!asset?.uri) return 'No photo was selected.';
  const kind = asset.type || 'image/jpeg';
  if (!ALLOWED.includes(kind)) return 'Use a JPEG, PNG or WEBP photo.';
  if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) return 'This photo is larger than 5 MB. Take it again at a lower resolution.';
  return '';
}

/**
 * Takes or picks one KYC photo. The photo stays on the phone until the step is submitted,
 * and only this preview is shown — uploaded documents are never displayed back from the server.
 */
export default function DocumentPhotoField({ label, value, onChange, alreadyOnFile, required, hint }) {
  const [error, setError] = useState('');
  const handle = (result) => {
    if (result?.didCancel) return;
    if (result?.errorCode) { setError(result.errorCode === 'camera_unavailable' ? 'Camera is not available.' : 'Could not open the camera or gallery. Check app permissions.'); return; }
    const asset = result?.assets?.[0];
    const problem = checkPickedFile(asset);
    if (problem) { setError(problem); return; }
    setError('');
    onChange({ uri: asset.uri, name: asset.fileName || `${label.replace(/\W+/g, '-').toLowerCase()}.jpg`, type: asset.type || 'image/jpeg', size: asset.fileSize });
  };
  const options = { mediaType: 'photo', quality: 0.7, maxWidth: 1600, maxHeight: 1600, includeBase64: false, saveToPhotos: false };

  return (
    <View style={styles.wrap}>
      <Text style={type.label}>{label}{required ? ' *' : ''}</Text>
      {value ? <Image source={{ uri: value.uri }} style={styles.preview} accessibilityLabel={`${label} photo`} />
        : alreadyOnFile ? <Text style={styles.onFile}>✓ Already uploaded. Add a new photo only to replace it.</Text> : null}
      <View style={styles.row}>
        <AppButton small title="Take photo" variant="outline" style={styles.flex} onPress={() => launchCamera({ ...options, cameraType: 'back' }, handle)} />
        <AppButton small title="Choose photo" variant="outline" style={styles.flex} onPress={() => launchImageLibrary({ ...options, selectionLimit: 1 }, handle)} />
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  preview: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.surface, resizeMode: 'contain' },
  onFile: { fontSize: 14, color: colors.success, fontWeight: '600' },
  error: { fontSize: 13, color: colors.error },
});
