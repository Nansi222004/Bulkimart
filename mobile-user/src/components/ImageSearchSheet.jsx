// Port of ImageSearchSheet.jsx + utils/imageSearch.js. "Take Photo" uses the camera, "Upload Image" the gallery;
// each permission is asked only when that button is tapped. Same file-type and size limits as the web.
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { request } from '../api/client';
import { Text } from './ui';
import { CameraIcon } from './icons';
import { useAppTheme } from '../theme/ThemeContext';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function validateSearchImage(asset, maxBytes = 5 * 1024 * 1024) {
  if (!asset) throw new Error('Choose a JPG, JPEG, PNG or WEBP image.');
  const name = asset.fileName || asset.uri.split('/').pop() || '';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const type = asset.mimeType || TYPES[ext];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Choose a JPG, JPEG, PNG or WEBP image.');
  if (TYPES[ext] && TYPES[ext] !== type) throw new Error('The image filename and file type do not match.');
  if (asset.fileSize !== undefined && (!asset.fileSize || asset.fileSize > maxBytes)) throw new Error(`Choose an image smaller than ${(maxBytes / 1024 / 1024).toFixed(1)} MiB.`);
}

export async function searchProductsByImage(asset, { type, page = 1 }) {
  const name = asset.fileName || `search.${(asset.mimeType || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg')}`;
  const form = new FormData();
  form.append('image', { uri: asset.uri, name, type: asset.mimeType || TYPES[(name.split('.').pop() || '').toLowerCase()] || 'image/jpeg' });
  const { ok, status, body } = await request(`/api/products/search-by-image?type=${encodeURIComponent(type)}&page=${page}&limit=20`, { method: 'POST', form });
  if (status === 503) throw new Error('Image search is not available right now. Please search by name or try again later.');
  if (!ok) throw new Error(body.message || 'Image search failed. Please try again.');
  return body;
}

export function ImageSearchButton({ onPress, size = 34 }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Search by image" hitSlop={4}
    style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.highlight, alignItems: 'center', justifyContent: 'center' }}>
    <CameraIcon size={19} color={theme.actionHover} />
  </Pressable>;
}

export default function ImageSearchSheet({ open, onClose, onSearch, loading, maxBytes = 5 * 1024 * 1024 }) {
  const theme = useAppTheme();
  const [asset, setAsset] = useState(null), [error, setError] = useState('');
  useEffect(() => { if (!open) { setAsset(null); setError(''); } }, [open]);
  const pick = async camera => {
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
      if (!permission.granted) { setError('Camera access is needed to take a photo. You can upload an image instead.'); return; }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const selected = result.assets[0];
      validateSearchImage(selected, maxBytes); setAsset(selected); setError('');
    } catch (failure) { setAsset(null); setError(failure.message || 'This image cannot be used. Choose another image.'); }
  };
  const search = async () => {
    try { validateSearchImage(asset, maxBytes); setError(''); if (await onSearch(asset)) onClose(); }
    catch (failure) { setError(failure.message || 'Unable to search. Please try again.'); }
  };
  const btn = [styles.btn, { backgroundColor: theme.highlight, borderColor: theme.borderColor }];
  const btnText = { color: theme.actionHover, fontSize: 15 };
  return <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>Search by image</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close image search" style={btn}><Text style={btnText}>×</Text></Pressable>
        </View>
        <Text style={{ fontSize: 14, marginVertical: 14 }}>Find similar product photos. Use a clear, well-lit picture.</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginVertical: 18 }}>
          <Pressable disabled={loading} onPress={() => pick(true)} style={[btn, { flex: 1, minHeight: 48 }, loading && { opacity: 0.55 }]}><Text style={btnText}>Take Photo</Text></Pressable>
          <Pressable disabled={loading} onPress={() => pick(false)} style={[btn, { flex: 1, minHeight: 48 }, loading && { opacity: 0.55 }]}><Text style={btnText}>Upload Image</Text></Pressable>
        </View>
        <Text style={{ fontSize: 12, color: '#64748b' }}>JPG, JPEG, PNG or WEBP · up to {(maxBytes / 1024 / 1024).toFixed(1)} MiB. Camera capture depends on your device.</Text>
        {asset && <View style={{ alignItems: 'center', gap: 10, marginVertical: 18 }}>
          <Image source={{ uri: asset.uri }} style={{ width: '100%', height: 200, borderRadius: 12 }} contentFit="contain" accessibilityLabel="Selected product image" />
          <Pressable disabled={loading} onPress={() => { setAsset(null); setError(''); }} style={btn}><Text style={btnText}>Remove image</Text></Pressable>
        </View>}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <Text accessibilityLiveRegion="polite" style={{ marginTop: 10 }}>Finding similar products…</Text> : null}
        <Pressable disabled={!asset || loading} onPress={search} style={[styles.submit, (!asset || loading) && { opacity: 0.55 }]}><Text style={{ color: '#fff', fontSize: 15 }}>{loading ? 'Searching…' : 'Search image'}</Text></Pressable>
      </ScrollView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,43,77,0.4)', justifyContent: 'flex-end', padding: 12 },
  sheet: { flexGrow: 0, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 22 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  btn: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#b42318', backgroundColor: '#fff1ee', borderRadius: 8, padding: 10, overflow: 'hidden', marginTop: 10 },
  submit: { marginTop: 20, backgroundColor: '#ff8500', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
