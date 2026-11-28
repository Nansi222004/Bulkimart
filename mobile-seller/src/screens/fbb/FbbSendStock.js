import React, { useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import OptionPicker from '../../components/OptionPicker';
import { InlineNotice } from '../../components/StateViews';
import { cancelFbbShipment, sendFbbShipment } from '../../services/fbb.api';
import { colors, radius, spacing, type } from '../../theme';

// Native port of the "How to send stock" part of frontend/src/modules/Seller/components/FbbTab.jsx.
// Data: GET /api/sellers/fbb → products (stage, variantOptions), warehouses (where to ship), shipments, sellerName.
const STAGES = {
  waiting_for_stock: ['Waiting for stock', colors.orangeLight, '#b45309', 'Not received yet. Send it to the warehouse, then tap “I’ve sent stock”.'],
  on_the_way: ['On the way', colors.infoLight, '#1e40af', ''],
  being_checked: ['Being checked', colors.infoLight, '#1e40af', 'The warehouse received it and is counting it.'],
  on_sale: ['On sale', colors.successLight, '#166534', ''],
  out_of_stock: ['Out of stock', colors.errorLight, '#991b1b', 'Everything sold. Send more stock.'],
};
const SHIPMENT_STATUS = { in_transit: ['On the way', colors.infoLight, '#1e40af'], received: ['Received', colors.successLight, '#166534'], cancelled: ['Cancelled', colors.errorLight, '#991b1b'] };
const STEPS = [
  ['Choose FBB', 'Add a product with “Fulfilled by Bulkimart” (or switch an existing product to it).'],
  ['Pack and send', 'Send the stock to the warehouse below with an invoice or challan listing each product and quantity.'],
  ['Tell Bulkimart', 'Tap “I’ve sent stock” and enter what you sent, the courier and the tracking number.'],
  ['Warehouse checks', 'Bulkimart counts what arrived. You get a notification and see it under Receipts.'],
  ['On sale', 'Accepted units go on sale. Bulkimart packs and ships every order for you.'],
];
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const newKey = () => `shp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const lineText = (l) => `${l.qty} × ${l.productName}${l.variantName && l.variantName !== 'Default' ? ` (${l.variantName})` : ''}`;

const Pill = ({ label, bg, fg }) => (
  <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: fg }]}>{label}</Text></View>
);

/** "I've sent stock" form. Information only: stock still comes from the warehouse count. */
function SentStockForm({ products, warehouses, onDone, onClose }) {
  const blank = () => ({ productId: '', variantId: '', qty: '' });
  const [form, setForm] = useState(() => ({ key: newKey(), warehouseId: warehouses[0]?._id || '', courier: '', trackingNo: '', invoiceNo: '', note: '', lines: [blank()] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i, k, v) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l, j) => {
      if (j !== i) return l;
      if (k !== 'productId') return { ...l, [k]: v };
      const options = products.find((p) => String(p._id) === v)?.variantOptions || [];
      return { ...l, productId: v, variantId: options.length === 1 ? String(options[0]._id) : '' };
    }),
  }));
  const ready = form.warehouseId && form.lines.every((l) => l.productId && l.variantId && /^\d+$/.test(l.qty) && Number(l.qty) > 0);
  // Variant ids come from the server (variantOptions). An older server does not send them, so nothing can be sent yet.
  const serverOutdated = products.some((p) => !Array.isArray(p.variantOptions));
  const missing = serverOutdated ? null : !form.warehouseId ? 'Choose the warehouse you sent it to.'
    : form.lines.some((l) => !l.productId) ? 'Choose the product.'
      : form.lines.some((l) => !l.variantId) ? 'Choose the variant.'
        : form.lines.some((l) => !(/^\d+$/.test(l.qty) && Number(l.qty) > 0)) ? 'Enter the quantity you sent (1 or more).' : null;
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await sendFbbShipment({ idempotencyKey: form.key, warehouseId: form.warehouseId, courier: form.courier, trackingNo: form.trackingNo, invoiceNo: form.invoiceNo, note: form.note,
        lines: form.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: Number(l.qty) })) });
      await onDone();
    } catch (e) { setError(e.message || 'Could not send. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Card title="What did you send?">
      <View style={styles.form}>
        {warehouses.length > 1 ? (
          <OptionPicker label="Sent to" required value={form.warehouseId} disabled={busy} onChange={(v) => set('warehouseId', v)}
            options={warehouses.map((w) => ({ value: String(w._id), label: w.name }))} />
        ) : null}
        {form.lines.map((l, i) => {
          const product = products.find((p) => String(p._id) === l.productId);
          return (
            <View key={i} style={styles.line}>
              <OptionPicker label={`Product ${form.lines.length > 1 ? i + 1 : ''}`.trim()} required value={l.productId} disabled={busy} onChange={(v) => setLine(i, 'productId', v)}
                options={products.map((p) => ({ value: String(p._id), label: p.name }))} />
              {(product?.variantOptions?.length || 0) > 1 ? (
                <OptionPicker label="Variant" required value={l.variantId} disabled={busy} onChange={(v) => setLine(i, 'variantId', v)}
                  options={product.variantOptions.map((v) => ({ value: String(v._id), label: v.name }))} />
              ) : null}
              <AppInput label="Quantity sent" required keyboardType="number-pad" placeholder="50" value={l.qty} editable={!busy} onChangeText={(t) => setLine(i, 'qty', t.replace(/\D/g, ''))} />
              {form.lines.length > 1 ? <AppButton title="Remove product" variant="outline" small disabled={busy} onPress={() => set('lines', form.lines.filter((_, j) => j !== i))} /> : null}
            </View>
          );
        })}
        {form.lines.length < products.length ? <AppButton title="+ Add another product" variant="outline" small disabled={busy} onPress={() => set('lines', [...form.lines, blank()])} /> : null}
        <Text style={type.small}>Delivery details are optional, but help the warehouse find your boxes.</Text>
        <AppInput label="Courier" placeholder="e.g. DTDC, own vehicle" value={form.courier} maxLength={80} editable={!busy} onChangeText={(t) => set('courier', t)} />
        <AppInput label="Tracking / LR number" value={form.trackingNo} maxLength={80} editable={!busy} onChangeText={(t) => set('trackingNo', t)} />
        <AppInput label="Invoice / challan number" value={form.invoiceNo} maxLength={80} editable={!busy} onChangeText={(t) => set('invoiceNo', t)} />
        <AppInput label="Note" placeholder="e.g. 3 boxes" value={form.note} maxLength={300} editable={!busy} onChangeText={(t) => set('note', t)} />
        {serverOutdated ? <InlineNotice tone="warning">Bulkimart is updating this feature. Please try again later or tell Bulkimart support what you sent.</InlineNotice> : null}
        {!serverOutdated && missing ? <Text style={type.small}>To continue: {missing}</Text> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <AppButton title={busy ? 'Sending…' : 'Tell Bulkimart'} loading={busy} disabled={busy || !ready || serverOutdated} onPress={submit} />
        <AppButton title="Cancel" variant="outline" disabled={busy} onPress={onClose} />
      </View>
    </Card>
  );
}

export default function FbbSendStock({ data, onChanged }) {
  const products = data?.products || [];
  const warehouses = data?.warehouses || [];
  const shipments = data?.shipments || [];
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const needStock = products.filter((p) => p.stage === 'waiting_for_stock' || p.stage === 'out_of_stock').length;
  const canSend = data?.available && products.length > 0 && warehouses.length > 0;

  const cancel = (s) => Alert.alert('Cancel shipment', `Cancel ${s.shipmentNo}? Only do this if you did not send it.`, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Cancel shipment', style: 'destructive', onPress: async () => {
      setBusyId(s._id); setNotice('');
      try { await cancelFbbShipment(s._id); setNotice('Shipment cancelled.'); await onChanged?.(); }
      catch (e) { setNotice(e.message || 'Could not cancel'); } finally { setBusyId(''); }
    } },
  ]);

  return (
    <>
      <Card title="How to send stock">
        {STEPS.map(([title, text], i) => (
          <View key={title} style={styles.step}>
            <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
            <View style={styles.flex}><Text style={type.label}>{title}</Text><Text style={type.small}>{text}</Text></View>
          </View>
        ))}
      </Card>

      <Card title="Send your stock to">
        {!warehouses.length ? <Text style={type.small}>No Bulkimart warehouse is open right now. Contact Bulkimart support before sending stock.</Text> : warehouses.map((w) => (
          <View key={w._id} style={styles.warehouse}>
            <Text style={type.label}>{w.name}</Text>
            <Text style={type.body}>{[w.address?.line1, w.address?.line2, w.address?.city, w.address?.state, w.address?.pincode].filter(Boolean).join(', ')}</Text>
            {w.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${w.phone}`)} accessibilityRole="link">
                <Text style={styles.link}>Call {w.phone}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>Write “{data?.sellerName || 'your store name'}” and warehouse code {w.code} on every box, and put the invoice or challan inside.</Text>
          </View>
        ))}
        {canSend && !open ? <AppButton title="📦 I’ve sent stock" onPress={() => { setOpen(true); setNotice(''); }} /> : null}
      </Card>

      {open ? (
        <SentStockForm products={products} warehouses={warehouses} onClose={() => setOpen(false)}
          onDone={async () => { setOpen(false); setNotice('Bulkimart has been told your stock is on the way.'); await onChanged?.(); }} />
      ) : null}
      {notice ? <InlineNotice tone="success">{notice}</InlineNotice> : null}

      {shipments.length ? (
        <Card title="Your shipments">
          {shipments.map((s) => {
            const [label, bg, fg] = SHIPMENT_STATUS[s.status] || [s.status, colors.surface, colors.textSecondary];
            return (
              <View key={s._id} style={styles.product}>
                <View style={styles.flex}>
                  <Text style={type.label}>{s.shipmentNo}</Text>
                  <Text style={type.small}>{s.lines.map(lineText).join(', ')}</Text>
                  <Text style={type.small}>Sent {day(s.createdAt)}{s.courier ? ` · ${s.courier}` : ''}{s.trackingNo ? ` ${s.trackingNo}` : ''}{s.status === 'received' && s.receivedAt ? ` · received ${day(s.receivedAt)}` : ''}</Text>
                  {s.status === 'in_transit' ? (
                    <Pressable onPress={() => cancel(s)} disabled={busyId === s._id} accessibilityRole="button"><Text style={styles.cancel}>Cancel shipment</Text></Pressable>
                  ) : null}
                </View>
                <Pill label={label} bg={bg} fg={fg} />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card title={needStock ? `Your FBB products · ${needStock} need stock` : 'Your FBB products'}>
        {!products.length ? <Text style={type.small}>You have no FBB products yet. Add a product and choose “Fulfilled by Bulkimart” as the delivery method.</Text> : products.map((p) => {
          const [label, bg, fg, help] = STAGES[p.stage] || [p.stage, colors.surface, colors.textSecondary, ''];
          const detail = p.stage === 'on_sale' ? `${p.forSale} for sale${p.reserved ? ` · ${p.reserved} in orders` : ''}${p.onTheWay ? ` · ${p.onTheWay} on the way` : ''}`
            : p.stage === 'on_the_way' ? `${p.onTheWay} units on the way to the warehouse` : help;
          return (
            <View key={p._id} style={styles.product}>
              {p.image ? <Image source={{ uri: p.image }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Text>📦</Text></View>}
              <View style={styles.flex}>
                <Text style={type.label} numberOfLines={2}>{p.name}</Text>
                <Text style={type.small}>{(p.variants || []).join(', ') || 'Single variant'} · added {day(p.addedAt)}{p.listing === 'pending' ? ' · awaiting approval' : p.listing === 'draft' ? ' · draft' : ''}</Text>
                {detail ? <Text style={type.small}>{detail}</Text> : null}
              </View>
              <Pill label={label} bg={bg} fg={fg} />
            </View>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  form: { gap: spacing.md },
  line: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.xs },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  numText: { color: colors.white, fontWeight: '800', fontSize: 13 },
  warehouse: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.aquaLight, borderWidth: 1, borderColor: '#bae6fd', marginBottom: spacing.sm },
  link: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#0369a1', marginTop: 4 },
  cancel: { color: colors.error, fontWeight: '700', fontSize: 13, marginTop: 4 },
  product: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  thumb: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
