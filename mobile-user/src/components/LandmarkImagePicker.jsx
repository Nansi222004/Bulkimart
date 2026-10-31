// Port of LandmarkImagePicker.jsx. "Take Photo" opens the system camera (replacing the web's in-page camera
// preview) and "Choose from Gallery" the photo picker; the photo is resized like the web capture (≤1280 px,
// JPEG 0.85) and uploaded through the existing landmark endpoint. Camera permission is asked only when needed.
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useAppTheme } from '../theme/ThemeContext';
import { mediaUrl } from '../api/client';
import { Text } from './ui';
import { CameraIcon } from './icons';

export async function prepareImage(asset, { maxSide = 1280, compress = 0.85 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(asset.width || maxSide, asset.height || maxSide));
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round((asset.width || maxSide) * scale) });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: saved.uri, width: saved.width, height: saved.height, mimeType: 'image/jpeg', fileName: `${(asset.fileName || 'photo').replace(/\.[^.]*$/, '')}.jpg` };
}

export async function pickImage({ camera = false } = {}) {
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw Object.assign(new Error('Camera permission was denied. Allow camera access in app settings and try again.'), { code: 'denied' });
  }
  const result = camera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0];
}

export default function LandmarkImagePicker({ value, onChange, onUpload, disabled = false, label = 'Landmark Photo (Optional — Helps Delivery Riders)', sublabel = 'Upload a photo of your building entrance, gate, or house front for fast delivery.' }) {
  const theme = useAppTheme();
  const [showOptions, setShowOptions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const choose = async camera => {
    setShowOptions(false);
    try {
      const asset = await pickImage({ camera });
      if (!asset) return;
      setUploading(true); setError(null);
      const prepared = await prepareImage(asset);
      const res = await onUpload(prepared);
      setUploading(false);
      if (res && res.ok && res.imageUrl) onChange(res.imageUrl);
      else setError(res?.message || 'Could not upload landmark photo.');
    } catch (err) {
      setUploading(false);
      setError(err?.message || 'Upload failed.');
    }
  };
  return <View style={[styles.container, { borderColor: theme.border }]}>
    <Text style={styles.label}>📸 {label}</Text>
    {sublabel ? <Text style={styles.sub}>{sublabel}</Text> : null}
    {value ? <View style={styles.preview}>
      <Image source={{ uri: mediaUrl(value) }} style={{ width: '100%', height: 160, borderRadius: 10 }} contentFit="cover" accessibilityLabel="Landmark Preview" />
      <Pressable onPress={() => onChange('')} accessibilityLabel="Remove photo" style={styles.remove}><Text style={{ color: '#fff', fontWeight: '800' }}>✕</Text></Pressable>
    </View> : <Pressable disabled={disabled || uploading} onPress={() => { setError(null); setShowOptions(true); }} style={[styles.trigger, { borderColor: theme.primaryColor, backgroundColor: theme.primaryLight }, (disabled || uploading) && { opacity: 0.6 }]}>
      {uploading ? <Text style={{ color: theme.primaryColor, fontWeight: '700' }}>⏳ Uploading photo to Cloud...</Text>
        : <><CameraIcon size={18} width={2.2} color={theme.primaryColor} /><Text style={{ color: theme.primaryColor, fontWeight: '700', fontSize: 13 }}>Take Photo or Pick from Gallery</Text></>}
    </Pressable>}
    {error && !showOptions ? <Text style={styles.error} accessibilityRole="alert">⚠️ {error}</Text> : null}
    <Modal visible={showOptions} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowOptions(false)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowOptions(false)} />
        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800' }}>Landmark Image Option</Text>
            <Pressable onPress={() => setShowOptions(false)} accessibilityLabel="Close camera options" style={styles.close}><Text>✕</Text></Pressable>
          </View>
          <Text style={styles.sub}>Choose how you want to attach the landmark photo:</Text>
          <Pressable onPress={() => choose(true)} style={[styles.option, { borderColor: theme.border }]}><Text style={{ fontSize: 22 }}>📸</Text><View><Text style={{ fontWeight: '800' }}>Take Photo</Text><Text style={styles.sub}>Use your camera now</Text></View></Pressable>
          <Pressable onPress={() => choose(false)} style={[styles.option, { borderColor: theme.border }]}><Text style={{ fontSize: 22 }}>📁</Text><View><Text style={{ fontWeight: '800' }}>Choose from Gallery</Text><Text style={styles.sub}>Pick an existing photo</Text></View></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  container: { padding: 12, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, gap: 8 },
  label: { fontSize: 12.5, fontWeight: '800' },
  sub: { fontSize: 11.5, color: '#64748b', lineHeight: 16 },
  preview: { position: 'relative' },
  remove: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center' },
  trigger: { minHeight: 46, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 12, color: '#b91c1c', fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 12 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 12 },
});
