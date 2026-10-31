// Port of modules/User/pages/WriteReviewPage.jsx (route /review/[id]). Up to 4 JPG/PNG/WEBP photos (≤5 MB each
// when picked); each upload is resized to ≤192 KB like utils/reviewPhoto.js so four photos stay under 1 MiB.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { mediaUrl, request, getToken } from '../api/client';
import { useAppTheme } from '../theme/ThemeContext';
import { useFeedback } from '../lib/feedback';
import { Text } from '../components/ui';

const RATING_LABELS = { 5: 'Loved It!', 4: 'Good!', 3: 'Average', 2: 'Fair', 1: 'Poor' };
const REVIEW_PHOTO_UPLOAD_BYTES = 192 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const typeOf = asset => asset.mimeType || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[String(asset.fileName || asset.uri).split('.').pop().toLowerCase()];
const sizeOf = uri => { try { return new File(uri).size || 0; } catch { return 0; } };

/** Same steps as prepareReviewPhoto: ≤1280 px, JPEG 0.8, shrink by 0.75 until it fits. */
async function prepareReviewPhoto(photo) {
  const name = `${String(photo.name || 'photo').replace(/\.[^.]*$/, '')}.jpg`;
  if (photo.size && photo.size <= REVIEW_PHOTO_UPLOAD_BYTES) return { uri: photo.uri, name: photo.name, type: photo.type };
  const scale = Math.min(1, 1280 / Math.max(photo.width || 1280, photo.height || 1280));
  let width = Math.max(1, Math.round((photo.width || 1280) * scale));
  while (true) {
    const context = ImageManipulator.manipulate(photo.uri);
    context.resize({ width });
    const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    if (sizeOf(saved.uri) <= REVIEW_PHOTO_UPLOAD_BYTES) return { uri: saved.uri, name, type: 'image/jpeg' };
    if (width === 1) throw new Error('Could not resize a review photo. Please choose another image.');
    width = Math.max(1, Math.floor(width * 0.75));
  }
}

export default function WriteReviewScreen() {
  const { id: productId } = useLocalSearchParams();
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const ui = useFeedback();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState([]);
  const submissionLock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const onBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;
    setLoading(true);
    request(`/api/products/${productId}`, { auth: false }).then(({ body }) => {
      if (!cancelled) { setProduct(body.product || body); setLoading(false); }
    }).catch(err => { if (!cancelled) { setError(err.message || 'Could not load product details'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [productId]);

  const handlePhotoUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - photos.length, quality: 1 });
      if (result.canceled) return;
      const files = result.assets.map(asset => ({ uri: asset.uri, name: asset.fileName || 'photo.jpg', type: typeOf(asset), size: asset.fileSize || sizeOf(asset.uri), width: asset.width, height: asset.height }));
      if (files.length + photos.length > 4) { setError('You can upload up to 4 review photos.'); return; }
      if (files.some(file => !TYPES.includes(file.type))) { setError('Review photos must be JPG, PNG or WEBP images.'); return; }
      if (files.some(file => file.size > 5 * 1024 * 1024)) { setError('Each review photo must be 5 MB or smaller.'); return; }
      setError('');
      setPhotos(prev => [...prev, ...files]);
    } catch { setError('Could not open your photos. Please try again.'); }
  };

  const handleSubmit = async () => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true); setError('');
    try {
      if (!getToken()) throw new Error('Please sign in to leave a review.');
      const form = new FormData();
      form.append('rating', String(rating));
      form.append('comment', comment.trim());
      // One at a time so four camera photos are never decoded together.
      for (const photo of photos) form.append('images', await prepareReviewPhoto(photo));
      const { ok, status, body } = await request(`/api/products/${productId}/reviews`, { method: 'POST', form, timeoutMs: 60000 });
      if (!ok) throw new Error(status === 413 ? 'The review photos are too large. Please use smaller photos and try again.' : body.message || 'Failed to submit review');
      ui.notify('Review published. You can see it under Ratings & Reviews on the product page.', { type: 'success' });
      onBack();
    } catch (err) { setError(err.message || 'Error submitting review'); } finally { submissionLock.current = false; setSubmitting(false); }
  };

  if (loading) return <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center' }]}><StatusBar style="dark" /><Text style={{ color: '#64748b', fontSize: 13 }}>Loading product details...</Text></View>;
  if (error && !product) return <View style={[styles.fill, { padding: 24, paddingTop: insets.top + 24, alignItems: 'center' }]}>
    <StatusBar style="dark" />
    <Pressable onPress={onBack} style={{ marginBottom: 20 }}><Text style={{ fontSize: 20 }}>← Back</Text></Pressable>
    <Text style={{ color: '#ef4444', fontSize: 14, textAlign: 'center' }}>{error}</Text>
  </View>;

  const image = product?.image || product?.images?.[0];
  return <KeyboardAvoidingView behavior="height" style={styles.fill}>
    <StatusBar style="dark" />
    <View style={{ height: insets.top, backgroundColor: '#fff' }} />
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={10}><Text style={{ fontSize: 22, color: '#0f172a' }}>←</Text></Pressable>
      <Text style={{ fontSize: 17, fontWeight: '800', color: '#0f172a', fontFamily: 'Outfit' }}>Write a Review</Text>
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { flexDirection: 'row', gap: 14, alignItems: 'center' }]}>
        {image ? <Image source={{ uri: mediaUrl(image) }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: '#f8fafc' }} contentFit="cover" accessibilityLabel={product?.name} /> : <View style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: '#f8fafc' }} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{product?.brandName || product?.sellerName || 'PRODUCT'}</Text>
          <Text style={{ marginTop: 2, marginBottom: 6, fontSize: 13.5, fontWeight: '700', color: '#1e293b', lineHeight: 18 }}>{product?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map(star => <Pressable key={star} onPress={() => setRating(star)} accessibilityRole="button" accessibilityLabel={`Rate ${star} star`} hitSlop={4}>
              <Text style={{ fontSize: 24, color: star <= rating ? '#f43f5e' : '#e2e8f0' }}>★</Text>
            </Pressable>)}
          </View>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 4 }}>{RATING_LABELS[rating]}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.h4}>Add Photos</Text>
        <Text style={{ marginBottom: 14, fontSize: 12, color: '#64748b' }}>Add up to 4 JPG, PNG or WEBP photos, up to 5 MB each.</Text>
        {photos.length < 4 && <Pressable onPress={handlePhotoUpload} disabled={submitting} style={styles.addPhotos}>
          <Text style={{ fontSize: 20 }}>📷</Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#4f46e5' }}>Add photos ({photos.length}/4)</Text>
        </Pressable>}
        {photos.length > 0 && <ScrollView horizontal contentContainerStyle={{ gap: 10, marginTop: 12, paddingTop: 6, paddingRight: 6 }}>
          {photos.map((photo, idx) => <View key={`${photo.uri}:${idx}`}>
            <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }} contentFit="cover" accessibilityLabel={`Review photo ${idx + 1} preview`} />
            <Pressable disabled={submitting} accessibilityLabel={`Remove review photo ${idx + 1}`} onPress={() => setPhotos(prev => prev.filter((_, i) => i !== idx))} style={styles.remove}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>✕</Text>
            </Pressable>
          </View>)}
        </ScrollView>}
      </View>

      <View style={styles.card}>
        <Text style={styles.h4}>Write a Review</Text>
        <Text style={{ marginBottom: 12, fontSize: 12, color: '#64748b' }}>Add description about the product</Text>
        <TextInput value={comment} onChangeText={setComment} multiline numberOfLines={4} textAlignVertical="top" placeholderTextColor="#94a3b8"
          placeholder="Help other buyers by sharing your thoughts on fit, quality, material, colour or comfort..." style={styles.textarea} />
        <Text style={{ marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 15 }}>💡 Help other buyers by sharing your thoughts on fit, quality, material, colour or comfort. Avoid delivery/packaging details.</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ fontSize: 12.5, color: '#ef4444', textAlign: 'center', fontWeight: '600' }}>{error}</Text> : null}
    </ScrollView>
    <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
      <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.submit, { backgroundColor: submitting ? '#94a3b8' : theme.primaryColor }]}>
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{submitting ? 'Submitting...' : 'Submit →'}</Text>
      </Pressable>
      <Text style={{ marginTop: 8, fontSize: 10, color: '#94a3b8', lineHeight: 13, textAlign: 'center' }}>By submitting this review, you give us consent to publish and process personal information in accordance with TERMS OF USE and Privacy Policy.</Text>
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  h4: { marginBottom: 4, fontSize: 15, fontWeight: '800', color: '#0f172a' },
  addPhotos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#818cf8', borderRadius: 12, backgroundColor: '#f5f3ff' },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  textarea: { minHeight: 96, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', fontSize: 13, color: '#0f172a' },
  footer: { backgroundColor: '#fff', paddingTop: 12, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center' },
  submit: { width: '100%', padding: 14, borderRadius: 30, alignItems: 'center' },
});
