import React from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import { colors, radius, spacing, type } from '../../theme';

// Native port of the "How to send stock" part of frontend/src/modules/Seller/components/FbbTab.jsx.
// Data: GET /api/sellers/fbb → products (with stage), warehouses (active, where to ship), sellerName.
const STAGES = {
  waiting_for_stock: ['Send stock', colors.orangeLight, '#b45309', 'Not received yet. Send it to the warehouse below.'],
  being_checked: ['Being checked', colors.infoLight, '#1e40af', 'The warehouse received it and is counting it.'],
  on_sale: ['On sale', colors.successLight, '#166534', ''],
  out_of_stock: ['Out of stock', colors.errorLight, '#991b1b', 'Everything sold. Send more stock.'],
};
const STEPS = [
  ['Choose FBB', 'Add a product with “Fulfilled by Bulkimart” (or switch an existing product to it).'],
  ['Pack and send', 'Send the stock to the warehouse below with an invoice or challan listing each product and quantity.'],
  ['Warehouse checks', 'Bulkimart counts what arrived. You get a notification and see it under Receipts.'],
  ['On sale', 'Accepted units go on sale. Bulkimart packs and ships every order for you.'],
];
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

const Pill = ({ label, bg, fg }) => (
  <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: fg }]}>{label}</Text></View>
);

export default function FbbSendStock({ data }) {
  const products = data?.products || [];
  const warehouses = data?.warehouses || [];
  const needStock = products.filter((p) => p.stage === 'waiting_for_stock' || p.stage === 'out_of_stock').length;
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
      </Card>

      <Card title={needStock ? `Your FBB products · ${needStock} need stock` : 'Your FBB products'}>
        {!products.length ? <Text style={type.small}>You have no FBB products yet. Add a product and choose “Fulfilled by Bulkimart” as the delivery method.</Text> : products.map((p) => {
          const [label, bg, fg, help] = STAGES[p.stage] || [p.stage, colors.surface, colors.textSecondary, ''];
          return (
            <View key={p._id} style={styles.product}>
              {p.image ? <Image source={{ uri: p.image }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Text>📦</Text></View>}
              <View style={styles.flex}>
                <Text style={type.label} numberOfLines={2}>{p.name}</Text>
                <Text style={type.small}>{(p.variants || []).join(', ') || 'Single variant'} · added {day(p.addedAt)}{p.listing === 'pending' ? ' · awaiting approval' : p.listing === 'draft' ? ' · draft' : ''}</Text>
                <Text style={type.small}>{p.stage === 'on_sale' ? `${p.forSale} for sale${p.reserved ? ` · ${p.reserved} in orders` : ''}` : help}</Text>
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
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.xs },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  numText: { color: colors.white, fontWeight: '800', fontSize: 13 },
  warehouse: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.aquaLight, borderWidth: 1, borderColor: '#bae6fd', marginBottom: spacing.sm },
  link: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#0369a1', marginTop: 4 },
  product: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  thumb: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
