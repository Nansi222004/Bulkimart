import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { deleteProduct } from '../../services/product.api';
import { isDigital, isWholesaleOnly, productStatus, stockHealth } from '../../utils/productForm';
import { hasWholesaleAccess } from '../../utils/wholesale';
import { useAuth } from '../../context/AuthContext';
import { colors, radius, spacing, type } from '../../theme';

// Read view of one listing, from the row the seller list returned (no separate seller detail endpoint exists).
export default function ProductDetailScreen({ route, navigation }) {
  const { product: p, channel } = route.params;
  const [deleting, setDeleting] = useState(false);
  const { seller } = useAuth();
  const editable = !isDigital(p) && !isWholesaleOnly(p);
  const wholesaleEditable = hasWholesaleAccess(seller) && !isDigital(p) && ['ecommerce', 'grocery'].includes(p.type);
  const status = productStatus(p);
  const health = stockHealth(p.stock);

  const confirmDelete = () => Alert.alert('Delete product', 'Are you sure you want to delete this product from listings?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      setDeleting(true);
      try {
        await deleteProduct(p._id);
        ToastAndroid.show('Product deleted', ToastAndroid.SHORT);
        navigation.goBack();
      } catch (e) {
        Alert.alert('Could not delete', e.message || 'Could not delete this product');
      } finally { setDeleting(false); }
    } },
  ]);

  return (
    <Screen>
      {p.images?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
          {p.images.map((uri, i) => <Image key={uri + i} source={{ uri }} style={styles.image} accessibilityLabel={i === 0 ? 'Cover photo' : `Photo ${i + 1}`} />)}
        </ScrollView>
      ) : <InlineNotice tone="warning">This listing has no photos.</InlineNotice>}

      <Card title={p.name}>
        <KeyValueRow label="Status" value={status} />
        {p.status === 'rejected' && p.rejectionReason ? <InlineNotice tone="error">Rejection reason: {p.rejectionReason}</InlineNotice> : null}
        <KeyValueRow label="Storefront" value={CHANNEL_LABEL[p.type] || p.type || '—'} />
        <KeyValueRow label="Category" value={p.category?.name || '—'} />
        <KeyValueRow label="Brand" value={p.brandName || '—'} />
        <KeyValueRow label="SKU" value={p.sku || '—'} />
        <KeyValueRow label="GST rate (included in price)" value={`${p.gstRate ?? 0}%`} />
        <KeyValueRow label="Returns" value={p.type === 'grocery' ? (p.returnable ? 'Returnable' : 'Non-returnable')
          : p.returnSettings?.enabled === false ? 'Non-returnable' : p.returnSettings?.windowDays ? `${p.returnSettings.windowDays} days` : 'Category default'} />
        {p.sameDay?.enabled ? <KeyValueRow label="Same-day" value={`On · packing ${p.sameDay.processingMinutes} min`} /> : null}
        {p.description ? <Text style={type.body}>{p.description}</Text> : null}
      </Card>

      <Card title={`Variants (${p.variants?.length || 0})`}>
        {(p.variants || []).map((v, i) => (
          <View key={v._id || i} style={styles.variant}>
            <Text style={type.label}>{v.name || `Variant ${i + 1}`}{i === 0 ? ' · main' : ''}</Text>
            <KeyValueRow label="Selling price" value={`₹${v.price}`} />
            <KeyValueRow label="MRP" value={v.mrp != null ? `₹${v.mrp}` : '—'} />
            <KeyValueRow label="Stock" value={`${v.stock ?? '—'} ${v.unit || ''}`} />
            {v.weight != null && v.weight !== '' ? <KeyValueRow label="Weight" value={String(v.weight)} /> : null}
            {v.sku ? <KeyValueRow label="SKU" value={v.sku} /> : null}
            {v.wholesalePricing?.enabled ? (
              <KeyValueRow label="Wholesale" value={`MOQ ${v.wholesalePricing.minimumQuantity} · step ${v.wholesalePricing.quantityIncrement} · ${(v.wholesalePricing.priceTiers || []).map((t) => `${t.minimumQuantity}+ ₹${t.unitPrice}`).join(', ')}`} />
            ) : null}
          </View>
        ))}
        <Text style={[styles.health, health === 'out' ? styles.out : health === 'low' ? styles.low : styles.ok]}>
          {health === 'out' ? 'OUT OF STOCK' : health === 'low' ? 'LOW STOCK' : 'IN STOCK'} · total {p.stock ?? '—'}
        </Text>
      </Card>

      {editable ? (
        <>
          <AppButton title="Edit product" onPress={() => navigation.navigate('ProductForm', { channel: p.type || channel, product: p })} />
          {/* replace(): returning from Stock should not land on this pre-adjustment snapshot. */}
          <AppButton title="Adjust stock" variant="outline" onPress={() => navigation.replace('Stock', { focusId: p._id, channel: p.type || channel })} />
        </>
      ) : (
        <InlineNotice tone="info">{isDigital(p) ? 'E-book listings' : 'Wholesale-only listing details'} are edited on the Bulkimart seller website for now.</InlineNotice>
      )}
      {wholesaleEditable ? (
        <AppButton title="Wholesale prices" variant="outline" onPress={() => navigation.navigate('WholesalePricing', { product: p })} />
      ) : null}
      <AppButton title="Delete product" variant="danger" loading={deleting} onPress={confirmDelete} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  images: { gap: spacing.sm },
  image: { width: 220, height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
  variant: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.sm },
  health: { fontSize: 12, fontWeight: '800', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden', marginTop: spacing.sm },
  out: { backgroundColor: '#fee2e2', color: '#dc2626' },
  low: { backgroundColor: '#fff7ed', color: '#ea580c' },
  ok: { backgroundColor: colors.aquaLight, color: colors.primaryDark },
});
