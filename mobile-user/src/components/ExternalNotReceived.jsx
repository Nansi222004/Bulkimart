import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { request } from '../api/client';
import { Text, TextInput } from './ui';

/**
 * A Self Delivery parcel the seller marked delivered (own courier): the customer can say it never arrived,
 * until `reportableUntil`. Same rules as the web; the server checks them again.
 */
export default function ExternalNotReceived({ orderId, shipment, onReported, color }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (shipment?.reportStatus === 'open') {
    return <Text style={{ fontSize: 12, color: '#9a3412', marginBottom: 12 }}>You reported that this parcel did not arrive. Our team is checking with the seller.</Text>;
  }
  const until = shipment?.reportableUntil ? new Date(shipment.reportableUntil) : null;
  if (!until || until <= new Date()) return null;

  const submit = async () => {
    if (reason.trim().length < 5) { setMessage('Tell us briefly what happened (at least 5 characters).'); return; }
    setBusy(true); setMessage('');
    try {
      const { ok, body } = await request(`/api/orders/${orderId}/not-received`, { method: 'POST', body: { reason: reason.trim() } });
      if (!ok) { setMessage(body?.message || 'Could not send your report'); return; }
      setOpen(false); onReported?.();
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: color || '#0284c7', textDecorationLine: 'underline' }}>I did not receive this parcel</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ marginBottom: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '800' }}>What happened?</Text>
      <TextInput value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="e.g. Marked delivered but nothing arrived" />
      {message ? <Text accessibilityRole="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{message}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={submit}><Text style={{ fontWeight: '800', color: color || '#0284c7' }}>{busy ? 'Sending…' : 'Send report'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOpen(false)}><Text style={{ fontWeight: '700', color: '#64748b' }}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}
