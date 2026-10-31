// Port of DeliveryPartnerRating.jsx: rate the rider of a delivered order once (server decides eligibility).
import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { request } from '../api/client';
import { useAppTheme } from '../theme/ThemeContext';
import { Text } from './ui';

export default function DeliveryPartnerRating({ orderId, riderName, deliveryRating, onRated }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!deliveryRating?.eligible) return null;
  const close = () => { if (!lock.current) setOpen(false); };
  const submit = async () => {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const { ok, body } = await request(`/api/orders/${orderId}/delivery-rating`, { method: 'POST', body: { rating } });
      if (!ok) throw new Error(body.message || 'Could not submit your rating. Please try again.');
      onRated(body.data.rating); setOpen(false);
    } catch (err) { setError(err.message || 'Could not submit your rating. Please try again.'); } finally { lock.current = false; setSaving(false); }
  };
  return <View style={[styles.card, { borderColor: theme.border }]}>
    <Text style={{ fontWeight: '700' }}>Delivery partner</Text>
    <Text style={{ color: '#64748b', marginBottom: 8 }}>{riderName || 'Your delivery partner'}</Text>
    {deliveryRating.rating ? <Text>You rated your delivery partner {deliveryRating.rating}/5 ★</Text>
      : <Pressable onPress={() => { setError(''); setOpen(true); }} style={[styles.btn, { borderColor: theme.primaryColor }]}><Text style={{ color: theme.primaryColor, fontWeight: '700' }}>Rate delivery partner</Text></Pressable>}
    <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.sheet} accessibilityLabel="Rate delivery partner">
          <Text style={{ fontSize: 18, fontWeight: '800' }}>Rate delivery partner</Text>
          <Text style={{ color: '#64748b', marginVertical: 6 }}>How was your delivery with {riderName || 'your delivery partner'}?</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 10 }} accessibilityLabel="Delivery rating">
            {[1, 2, 3, 4, 5].map(star => <Pressable key={star} disabled={saving} onPress={() => setRating(star)} accessibilityLabel={`Rate delivery ${star} star${star === 1 ? '' : 's'}`} accessibilityState={{ selected: rating === star }}>
              <Text style={{ fontSize: 36, color: star <= rating ? '#f59e0b' : '#cbd5e1' }}>★</Text>
            </Pressable>)}
          </View>
          {error ? <Text style={{ color: '#b91c1c' }} accessibilityRole="alert">{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable disabled={saving} onPress={close} style={[styles.action, { borderWidth: 1.5, borderColor: '#cbd5e1' }]}><Text style={{ fontWeight: '800', color: '#475569' }}>Cancel</Text></Pressable>
            <Pressable disabled={saving} onPress={submit} style={[styles.action, { backgroundColor: saving ? '#94a3b8' : theme.primaryColor }]}><Text style={{ fontWeight: '900', color: '#fff' }}>{saving ? 'Submitting…' : 'Submit rating'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, borderWidth: 1, borderRadius: 16, backgroundColor: '#fff' },
  btn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: 'flex-start' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  action: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
});
