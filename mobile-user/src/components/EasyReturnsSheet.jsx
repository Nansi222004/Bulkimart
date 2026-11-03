import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Sheet, Text, money } from './ui';

/**
 * Purchase popup for products with Easy Returns (backend: services/easyReturns.service.js).
 * Same behaviour as the website's EasyReturnsSheet. Prices are a preview; the server re-prices at checkout.
 */
export const RETURN_OPTION = { EASY: 'EASY_RETURN', NO: 'NO_EASY_RETURN' };
const AQUA = '#08B9E8';
const NAVY = '#0B2D6B';
const ORANGE = '#f97316';
const round2 = n => Math.round(Number(n) * 100) / 100;

export default function EasyReturnsSheet({
  visible, onClose, product, image, variants = [], selectedVariantId, onVariantChange,
  basePrice, mrp, easyReturns, actionLabel = 'Continue', pending = false, error = '', onConfirm,
}) {
  const [option, setOption] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (visible) { setOption(''); setShowDetails(false); setTouched(false); } }, [visible]);
  if (!easyReturns) return null;

  const charge = round2(easyReturns.extraCharge || 0);
  const hasPrice = basePrice != null && Number.isFinite(Number(basePrice));
  const prices = { [RETURN_OPTION.EASY]: hasPrice ? round2(Number(basePrice) + charge) : null, [RETURN_OPTION.NO]: hasPrice ? round2(basePrice) : null };
  const selectedPrice = option ? prices[option] : null;
  const multiple = variants.length > 1;
  const selectedVariant = variants.find(v => String(v.id || v._id) === String(selectedVariantId));
  const outOfStock = selectedVariant && !(Number(selectedVariant.stock) > 0);

  const confirm = () => {
    setTouched(true);
    if (!option || (multiple && !selectedVariantId) || outOfStock) return;
    onConfirm?.(option);
  };

  const card = (value, title, subtitle) => {
    const active = option === value;
    const tint = value === RETURN_OPTION.EASY ? AQUA : ORANGE;
    return (
      <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: active, disabled: pending }} disabled={pending}
        onPress={() => setOption(value)}
        style={[styles.option, active && { borderColor: tint, backgroundColor: value === RETURN_OPTION.EASY ? '#ecfeff' : '#fff7ed' }]}>
        <View style={[styles.radio, active && { backgroundColor: tint, borderColor: tint }]}>{active ? <Text style={styles.tick}>✓</Text> : null}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.muted}>{subtitle}</Text>
        </View>
        <Text style={styles.optionPrice}>{prices[value] != null ? money(prices[value]) : '—'}</Text>
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={() => { if (!pending) onClose?.(); }} dismissable={!pending}>
      <ScrollView style={{ maxHeight: 620 }} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          {image ? <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{product?.name}</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
              <Text style={styles.headPrice}>{selectedPrice != null ? money(selectedPrice) : hasPrice ? money(basePrice) : ''}</Text>
              {mrp && hasPrice && Number(mrp) > Number(selectedPrice ?? basePrice) ? <Text style={styles.mrp}>{money(mrp)}</Text> : null}
            </View>
          </View>
        </View>

        {multiple ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select size / variant</Text>
            <View style={styles.variants} accessibilityRole="radiogroup">
              {variants.map(v => {
                const id = String(v.id || v._id);
                const active = id === String(selectedVariantId);
                const soldOut = !(Number(v.stock) > 0);
                return (
                  <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: active, disabled: pending || soldOut }} disabled={pending || soldOut}
                    onPress={() => onVariantChange?.(id)} style={[styles.variant, active && styles.variantActive, soldOut && { opacity: 0.5 }]}>
                    <Text style={styles.variantText}>{v.name && v.name !== 'Default' ? v.name : [v.weight ? `${v.weight} g` : '', v.unit].filter(Boolean).join(' ') || 'Standard'}</Text>
                    {soldOut ? <Text style={styles.soldOut}>Sold out</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {touched && !selectedVariantId ? <Text style={styles.error}>Choose a variant.</Text> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Easy Returns</Text>
            <Pressable accessibilityRole="button" onPress={() => setShowDetails(v => !v)} hitSlop={8}>
              <Text style={styles.link}>{showDetails ? 'Hide details' : 'View details'}</Text>
            </Pressable>
          </View>
          {showDetails ? (
            <View style={styles.details}>
              <Text style={styles.body}>{easyReturns.policyText}</Text>
              {(easyReturns.conditions || []).map(c => <Text key={c} style={styles.body}>• {c}</Text>)}
              <Text style={styles.muted}>Return window: {easyReturns.windowDays} day{easyReturns.windowDays === 1 ? '' : 's'} after delivery. Without Easy Returns, only a wrong, damaged or defective item can be returned.</Text>
            </View>
          ) : null}
          <View style={{ gap: 10, marginTop: 10 }} accessibilityRole="radiogroup">
            {card(RETURN_OPTION.EASY, 'Yes, I want Easy Returns', `Return for any reason within ${easyReturns.windowDays} days`)}
            {card(RETURN_OPTION.NO, 'No Easy Returns', 'Only wrong, damaged or defective item returns')}
          </View>
          {touched && !option ? <Text style={styles.error}>Choose a return option to continue.</Text> : null}
        </View>

        <View style={styles.breakdown}>
          <View style={styles.row}><Text style={styles.body}>Item price</Text><Text style={styles.body}>{hasPrice ? money(basePrice) : '—'}</Text></View>
          <View style={styles.row}><Text style={styles.body}>Easy Returns charge</Text><Text style={styles.body}>{option === RETURN_OPTION.EASY ? `+ ${money(charge)}` : option ? money(0) : '—'}</Text></View>
          <View style={[styles.row, styles.totalRow]}><Text style={styles.total}>You pay (per unit)</Text><Text style={styles.total}>{selectedPrice != null ? money(selectedPrice) : '—'}</Text></View>
        </View>

        {outOfStock ? <Text style={styles.error}>This variant is out of stock.</Text> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={pending} onPress={confirm} style={[styles.cta, pending && { opacity: 0.7 }]}>
          <Text style={styles.ctaText}>{pending ? 'Please wait…' : actionLabel}</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  name: { fontSize: 15, fontWeight: '700', color: '#172B4D', marginBottom: 4 },
  headPrice: { fontSize: 18, fontWeight: '800', color: NAVY },
  mrp: { fontSize: 13, color: '#94a3b8', textDecorationLine: 'line-through' },
  section: { paddingTop: 14 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#172B4D', marginBottom: 8 },
  link: { color: '#0369a1', fontWeight: '700', fontSize: 13 },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  variant: { minHeight: 40, minWidth: 52, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  variantActive: { borderColor: AQUA, backgroundColor: '#ecfeff' },
  variantText: { fontWeight: '700', fontSize: 13, color: '#172B4D' },
  soldOut: { fontSize: 10, color: '#b91c1c' },
  details: { marginTop: 8, padding: 10, backgroundColor: '#f8fafc', borderRadius: 10, gap: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, backgroundColor: '#fff' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  tick: { color: '#fff', fontSize: 12, fontWeight: '900' },
  optionTitle: { fontSize: 14, fontWeight: '700', color: '#172B4D' },
  optionPrice: { fontSize: 16, fontWeight: '800', color: NAVY },
  muted: { fontSize: 12, color: '#64748b' },
  body: { fontSize: 13, color: '#172B4D', lineHeight: 19 },
  breakdown: { marginTop: 14, marginBottom: 10, padding: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', borderRadius: 10, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 6 },
  total: { fontSize: 14, fontWeight: '800', color: NAVY },
  error: { color: '#b91c1c', fontSize: 12.5, marginTop: 6 },
  cta: { minHeight: 48, borderRadius: 12, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: 8 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
