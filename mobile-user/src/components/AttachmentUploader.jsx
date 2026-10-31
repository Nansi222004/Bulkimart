// Port of components/common/AttachmentPreview.jsx (AttachmentUploader): PNG, JPG, WEBP or PDF, up to maxFiles.
// "Tap to attach" offers Camera, Photos or Files (the web file input). Each permission is asked only when used.
// Files are kept as { uri, name, type, size } and appended to FormData by the caller.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { Sheet, Text } from './ui';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const extType = name => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' })[(String(name).split('.').pop() || '').toLowerCase()];

export const toUploadFile = (asset, fallbackName) => {
  const name = asset.fileName || asset.name || fallbackName || asset.uri.split('/').pop() || 'attachment';
  return { uri: asset.uri, name, type: asset.mimeType || extType(name) || 'application/octet-stream', size: asset.fileSize ?? asset.size };
};

export default function AttachmentUploader({ files = [], onAddFiles, onRemoveFile, maxFiles = 5, maxBytes = 10 * 1024 * 1024 }) {
  const [choose, setChoose] = useState(false);
  const [error, setError] = useState('');
  const isFull = files.length >= maxFiles;
  const accept = list => {
    const valid = [], rejected = [];
    for (const file of list) (ALLOWED.includes(file.type) && (!file.size || file.size <= maxBytes) ? valid : rejected).push(file);
    setError(rejected.length ? 'Some files were skipped. Use PNG, JPG, WEBP or PDF files.' : '');
    if (valid.length) onAddFiles(valid.slice(0, maxFiles - files.length));
  };
  const pick = async source => {
    setChoose(false);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError('Camera access was denied. Choose a photo or file instead.'); return; }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
        if (!result.canceled) accept(result.assets.map(a => toUploadFile(a, 'photo.jpg')));
      } else if (source === 'photos') {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: maxFiles - files.length });
        if (!result.canceled) accept(result.assets.map(a => toUploadFile(a)));
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ALLOWED, multiple: true, copyToCacheDirectory: true });
        if (!result.canceled) accept(result.assets.map(a => toUploadFile(a)));
      }
    } catch { setError('Could not attach that file. Please try again.'); }
  };
  return <View style={{ marginTop: 6, marginBottom: 8 }}>
    <Pressable disabled={isFull} onPress={() => setChoose(true)} accessibilityRole="button" style={[styles.drop, isFull && { backgroundColor: '#f8fafc' }]}>
      <View style={[styles.icon, { backgroundColor: isFull ? '#f1f5f9' : '#e8f5e9' }]}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={isFull ? '#94a3b8' : '#16a34a'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="17 8 12 3 7 8" /><Line x1="12" y1="3" x2="12" y2="15" /></Svg>
      </View>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: isFull ? '#94a3b8' : '#1e293b', textAlign: 'center' }}>{isFull ? 'Maximum files limit reached' : 'Tap to attach files'}</Text>
      <Text style={{ fontSize: 11.5, color: '#64748b', textAlign: 'center' }}>PNG, JPG, WEBP, or PDF (Up to {maxFiles} files)</Text>
      <Text style={styles.counter}>{files.length} / {maxFiles}</Text>
    </Pressable>
    {error ? <Text style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{error}</Text> : null}
    {files.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {files.map((file, index) => <View key={`${file.uri}:${index}`} style={styles.thumb}>
        {file.type?.startsWith('image/') ? <Image source={{ uri: file.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={{ fontSize: 10, textAlign: 'center', padding: 4 }} numberOfLines={3}>📄 {file.name}</Text>}
        <Pressable onPress={() => onRemoveFile(index)} accessibilityLabel={`Remove ${file.name}`} style={styles.remove}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✕</Text></Pressable>
      </View>)}
    </View>}
    <Sheet visible={choose} onClose={() => setChoose(false)}>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: '700' }}>Attach files</Text>
        {[['camera', '📸 Take Photo'], ['photos', '🖼️ Choose Photos'], ['files', '📁 Choose Files (PDF or image)']].map(([key, label]) => <Pressable key={key} onPress={() => pick(key)} style={styles.option}><Text style={{ fontSize: 14, fontWeight: '600' }}>{label}</Text></Pressable>)}
      </View>
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#cbd5e1', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, backgroundColor: '#fff', alignItems: 'center', gap: 8 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  counter: { fontSize: 11, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#f1f5f9', color: '#475569', overflow: 'hidden' },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  remove: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(15,23,42,0.75)', alignItems: 'center', justifyContent: 'center' },
  option: { padding: 14, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10 },
});
