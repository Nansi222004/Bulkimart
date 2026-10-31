// Ports of CartUI.jsx, BasketGroups.jsx, CouponThresholdProgress.jsx and finance/ProductGstBreakdown.jsx.
// Every amount shown is the server's; nothing here computes a price or tax.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useAppTheme } from '../../theme/ThemeContext';
import { mediaUrl } from '../../api/client';
import { paymentSummary } from '../../lib/paymentSummary';
import { Text } from '../ui';
import { CartIcon } from '../icons';

export const channelLabel = group => (group.salesChannel === 'wholesale' ? 'Wholesale (B2B)' : group.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce');
export const basketMoney = value => (value == null ? 'Unavailable' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

export function validProductTax(tax) {
  return tax?.version === 'product-gst-v1' && ['sellingPricePaise', 'grossPaise', 'taxableValuePaise', 'gstPaise', 'addedGstPaise', 'includedGstPaise'].every(key => Number.isSafeInteger(tax[key]) && tax[key] >= 0)
    && tax.taxableValuePaise + tax.gstPaise === tax.grossPaise
    && tax.sellingPricePaise + tax.addedGstPaise === tax.grossPaise
    && Array.isArray(tax.rates) && tax.rates.every(row => Number.isFinite(row.gstRate) && ['inclusive', 'exclusive'].includes(row.gstPriceType) && Number.isSafeInteger(row.gstPaise) && Number.isSafeInteger(row.taxableValuePaise))
    && tax.rates.reduce((n, row) => n + row.gstPaise, 0) === tax.gstPaise;
}

export function ProductGstBreakdown({ tax, subtotalIncludesAddedGst = true, pending = false, whenMissing }) {
  if (tax == null && whenMissing && !pending) return <Text style={styles.gstNote}>{whenMissing}</Text>;
  if (!validProductTax(tax)) return <Text style={styles.gstNote}>{pending ? 'Loading product GST breakdown…' : 'Product GST breakdown unavailable.'}</Text>;
  const money = value => `₹${(value / 100).toFixed(2)}`;
  const row = (label, amount, key) => <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, marginVertical: 6 }}><Text style={{ fontSize: 13, flex: 1 }}>{label}</Text><Text style={{ fontSize: 13 }}>{money(amount)}</Text></View>;
  return <View accessibilityLabel="Product GST breakdown">
    {row('Taxable product value (before platform discounts)', tax.taxableValuePaise, 'base')}
    {tax.rates.map(rate => row(`${rate.gstPriceType === 'inclusive' ? 'Included GST' : 'GST added'} (${rate.gstRate}%)${rate.gstPriceType === 'exclusive' && subtotalIncludesAddedGst ? ' · included in subtotal' : ''}`, rate.gstPaise, `${rate.gstRate}:${rate.gstPriceType}`))}
    {tax.discountPaise > 0 && <Text style={{ fontSize: 11, color: '#64748b' }}>Coupons are funded by Bulkimart; they reduce what you pay.</Text>}
  </View>;
}

export function CartSection({ title, children, style }) {
  const theme = useAppTheme();
  return <View style={[styles.section, { borderColor: theme.border }, style]}>
    {title ? <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text> : null}
    {children}
  </View>;
}

export function CartTotalRow({ label, value, strong }) {
  const theme = useAppTheme();
  return <View style={[styles.totalRow, strong && [styles.totalGrand, { borderTopColor: theme.border }]]}>
    <Text style={{ fontSize: strong ? 18 : 14, fontWeight: strong ? '800' : '600', color: strong ? theme.text : theme.textSecondary, flexShrink: 1 }}>{label}</Text>
    {typeof value === 'string' || typeof value === 'number' ? <Text style={{ fontSize: strong ? 18 : 14, fontWeight: strong ? '800' : '600', color: strong ? theme.text : theme.textSecondary }}>{value}</Text> : value}
  </View>;
}

export function CartEmptyState({ wholesale = false, onBrowse }) {
  const theme = useAppTheme();
  return <View style={[styles.empty, { borderColor: theme.border }]}>
    <View style={[styles.emptyIcon, { backgroundColor: theme.highlight }]}><CartIcon size={44} color={theme.action} /></View>
    <Text style={{ fontSize: 22, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' }}>{wholesale ? 'Your Wholesale cart is empty.' : 'Your Cart is Empty'}</Text>
    <Text style={{ fontSize: 14, maxWidth: 340, lineHeight: 21, color: theme.textSecondary, textAlign: 'center' }}>{wholesale ? 'Explore bulk offers and quantity-based prices from approved sellers.' : 'Explore local products, fresh groceries, organic items, and traditional handicrafts.'}</Text>
    <PrimaryButton title={wholesale ? 'Browse Wholesale' : 'Continue shopping'} onPress={onBrowse} style={{ alignSelf: 'center', paddingHorizontal: 28, marginTop: 12 }} />
  </View>;
}

export function PrimaryButton({ title, onPress, disabled, style }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
    style={[styles.primaryBtn, { backgroundColor: theme.action }, disabled && { opacity: 0.5 }, style]}>
    <Text style={{ color: theme.actionText, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

export function SecondaryButton({ title, onPress, disabled, pressed, style, textStyle }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!pressed }}
    style={[styles.secondaryBtn, { borderColor: pressed ? theme.primaryColor : theme.border, backgroundColor: pressed ? theme.primaryLight : '#fff' }, disabled && { opacity: 0.5 }, style]}>
    <Text style={[{ color: pressed ? theme.primaryColor : theme.action, fontSize: 13, fontWeight: '700', textAlign: 'center' }, textStyle]}>{title}</Text>
  </Pressable>;
}

function QuantityInput({ item, minimum, maximum, increment, busy, onCommit }) {
  const theme = useAppTheme();
  const [value, setValue] = useState(String(item.qty));
  const [invalid, setInvalid] = useState('');
  useEffect(() => { setValue(String(item.qty)); }, [item.qty]);
  const commit = () => {
    const quantity = Number(value);
    const valid = Number.isSafeInteger(quantity) && quantity >= minimum && quantity <= maximum && (quantity - minimum) % increment === 0;
    setValue(String(item.qty));
    if (valid && quantity !== item.qty) { setInvalid(''); onCommit(quantity); }
    else if (!valid) setInvalid(`Choose ${minimum} to ${maximum} units in increments of ${increment}.`);
  };
  return <View>
    <TextInput value={value} onChangeText={v => { setValue(v.replace(/\D/g, '')); setInvalid(''); }} onBlur={commit} onSubmitEditing={commit} editable={!busy} keyboardType="number-pad"
      accessibilityLabel={`Quantity for ${item.name}`} style={[styles.qtyInput, { color: theme.text }]} />
    {invalid ? <Text style={{ color: '#b91c1c', fontSize: 11 }}>{invalid}</Text> : null}
  </View>;
}

export function BasketItem({ item, group, busy, onQuantity, onRemove, onMessage, onWishlist, showStock = true, compact = false }) {
  const theme = useAppTheme();
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState(item.additionalMessage || '');
  const wholesale = group.salesChannel === 'wholesale';
  const minimum = wholesale ? item.wholesaleSnapshot?.minimumQuantity : 1;
  const increment = wholesale ? item.wholesaleSnapshot?.quantityIncrement : 1;
  const maximum = Math.min(item.stock ?? 0, wholesale ? 100000 : 20);
  const editable = onQuantity && item.available !== false && minimum && increment && item.fulfillmentType !== 'digital';
  const image = item.image ? (typeof item.image === 'string' ? item.image : item.image.url) : '';
  const terms = wholesale && item.wholesaleSnapshot ? [minimum > 1 && `Min order ${minimum}`, increment > 1 && `Steps of ${increment}`, item.wholesaleSnapshot.tierMinimumQuantity > minimum && `Bulk price from ${item.wholesaleSnapshot.tierMinimumQuantity} units`].filter(Boolean) : [];
  const size = compact ? 56 : 80;
  return <View style={[styles.item, { borderTopColor: theme.border }]}>
    <View style={[styles.itemImage, { width: size, height: size, backgroundColor: theme.background, borderRadius: compact ? 8 : 12 }]}>
      {image ? <Image source={{ uri: mediaUrl(image) }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <CartIcon size={28} color="#8192a9" />}
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[styles.itemName, compact && { fontSize: 14 }]}>{item.name}</Text>
      {item.variantName || item.variantAttributes?.length ? <Text style={styles.itemP}>{item.variantName}{item.variantAttributes?.map(attr => ` · ${attr.name}: ${attr.value}`).join('')}</Text> : null}
      {!compact && <Text style={styles.itemP}>{group.seller?.name || 'Vendor unavailable'} · {channelLabel(group)}</Text>}
      <Text style={styles.itemP}>{basketMoney(item.price)} per {item.unitSnapshot || 'unit'} · {item.qty} units</Text>
      {item.fulfillmentType === 'digital' ? <Text style={styles.itemP}>Digital delivery · one licence</Text> : item.available === false ? <Text style={styles.itemP}>Unavailable — review or remove this item</Text> : showStock ? <Text style={styles.itemP}>Stock: {item.stock}</Text> : null}
      {item.priceChanged && <Text style={styles.itemP} accessibilityLiveRegion="polite">Price changed. Review the current price before checkout.</Text>}
      {terms.length ? <Text style={styles.itemP}>{terms.join(' · ')}</Text> : null}
      {editable && <View style={[styles.qty, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable accessibilityLabel={`Decrease ${item.name}`} disabled={busy || item.qty - increment < minimum} onPress={() => onQuantity(item, group, item.qty - increment)} style={[styles.qtyBtn, (busy || item.qty - increment < minimum) && { opacity: 0.5 }]}><Text style={[styles.qtyBtnText, { color: theme.primaryColor }]}>−</Text></Pressable>
        <QuantityInput item={item} minimum={minimum} maximum={maximum} increment={increment} busy={busy} onCommit={quantity => onQuantity(item, group, quantity)} />
        <Pressable accessibilityLabel={`Increase ${item.name}`} disabled={busy || item.qty + increment > maximum} onPress={() => onQuantity(item, group, item.qty + increment)} style={[styles.qtyBtn, (busy || item.qty + increment > maximum) && { opacity: 0.5 }]}><Text style={[styles.qtyBtnText, { color: theme.primaryColor }]}>+</Text></Pressable>
      </View>}
      {onMessage && !wholesale && <View>
        <Pressable onPress={() => setShowMessage(v => !v)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ fontSize: 13, color: theme.primaryColor }}>{showMessage ? '▾' : '▸'} Seller instructions</Text></Pressable>
        {showMessage && <TextInput value={message} onChangeText={setMessage} maxLength={500} editable={!busy} multiline accessibilityLabel={`Instructions for ${item.name}`}
          onBlur={() => { if (message !== (item.additionalMessage || '')) onMessage(item, message); }} style={[styles.message, { borderColor: theme.border }]} />}
      </View>}
      {onWishlist && !wholesale && <Pressable disabled={busy} onPress={() => onWishlist(item, group)} style={{ minHeight: 44, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: theme.primaryColor, fontSize: 13, fontWeight: '600' }}>Move to Wishlist</Text></Pressable>}
    </View>
    <View style={{ alignItems: 'flex-end', gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{basketMoney(item.lineTotal)}</Text>
      {onRemove && <SecondaryButton title="Remove" onPress={() => onRemove(item, group)} disabled={busy} />}
    </View>
  </View>;
}

export function BasketGroups({ groups, busy, onMode, showTotals = true, compact = false, ...actions }) {
  return <View style={{ gap: compact ? 0 : 16 }}>{groups.map(group => <CartSection key={group.key} title={`${channelLabel(group)} · ${group.seller?.name || 'Vendor unavailable'}`} style={compact ? styles.compactSection : null}>
    <Text style={styles.note}>{group.fulfillmentType === 'digital' ? 'Digital delivery' : group.channel === 'grocery' ? 'Quick Commerce delivery' : group.deliveryMode === 'same_day' ? 'Same-Day delivery' : 'Regular delivery'}{group.salesChannel === 'wholesale' ? ' · Wholesale prices' : ''}</Text>
    {group.items.map(item => <BasketItem key={item.itemId} item={item} group={group} busy={busy} compact={compact} {...actions} />)}
    {onMode && group.salesChannel !== 'wholesale' && group.fulfillmentType !== 'digital' && group.channel === 'ecommerce' && group.sameDayOption?.available && <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityLabel={`Delivery for ${group.seller?.name}`}>
      {['scheduled', 'same_day'].map(mode => <SecondaryButton key={mode} title={mode === 'same_day' ? 'Same-Day' : 'Scheduled'} pressed={group.deliveryMode === mode} disabled={busy} onPress={() => onMode(group, mode)} />)}
    </View>}
    {showTotals && group.total != null && <View style={styles.groupTotals}>
      <CartTotalRow label="Items" value={basketMoney(group.subtotal)} />
      <CartTotalRow label="Delivery" value={basketMoney(group.deliveryCharge)} />
      <CartTotalRow label="Group total" value={basketMoney(group.total)} strong />
    </View>}
  </CartSection>)}</View>;
}

export function BasketSummary({ data }) {
  const summary = paymentSummary(data?.totals);
  return <CartSection title="Order summary">{data?.totals ? <>
    <CartTotalRow label="Items Subtotal" value={basketMoney(summary.subtotal)} />
    <ProductGstBreakdown tax={summary.productTax} subtotalIncludesAddedGst={false} />
    <CartTotalRow label="Delivery Charges" value={summary.deliveryCharge === 0 ? <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 14 }}>FREE</Text> : basketMoney(summary.deliveryCharge)} />
    {summary.sameDayPremium > 0 && <CartTotalRow label="Same-Day Delivery Premium" value={basketMoney(summary.sameDayPremium)} />}
    {summary.couponDiscount > 0 && <CartTotalRow label="Coupon Discount" value={`−${basketMoney(summary.couponDiscount)}`} />}
    <CartTotalRow label="Grand Total" value={basketMoney(summary.totalAmount)} strong />
  </> : <Text style={styles.note}>Please resolve unavailable items before checkout.</Text>}</CartSection>;
}

const couponMoney = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const benefit = offer => {
  if (offer.discountType === 'free_shipping') return 'free delivery';
  if (offer.discountType === 'percentage') return `${offer.value}% off${offer.maxDiscount > 0 ? ` (up to ${couponMoney(offer.maxDiscount)})` : ''}`;
  if (offer.discountType === 'fixed') return `${couponMoney(offer.value)} off`;
  return null;
};
export function CouponThresholdProgress({ offers = [], onShopMore, appliedCode }) {
  const theme = useAppTheme();
  if (appliedCode) return null;
  const offer = offers.find(item => item.threshold && benefit(item));
  if (!offer) return null;
  const { minimumOrderValue, eligibleOrderValue, remainingAmount, progressPercentage } = offer.threshold;
  if (!(minimumOrderValue > 0) || !Number.isFinite(progressPercentage)) return null;
  const unlocked = remainingAmount <= 0;
  return <View style={[styles.threshold, { borderColor: theme.border, backgroundColor: theme.surface }]} accessibilityLabel={`${offer.code} coupon progress`}>
    <Text style={{ fontWeight: '700', lineHeight: 18, fontSize: 13 }}>{unlocked ? `You've unlocked ${benefit(offer)}!` : `Add ${couponMoney(remainingAmount)} more to unlock ${benefit(offer)}.`}</Text>
    <View style={[styles.track, { backgroundColor: theme.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: minimumOrderValue, now: Math.min(eligibleOrderValue, minimumOrderValue) }}>
      <View style={{ width: `${progressPercentage}%`, height: '100%', borderRadius: 999, backgroundColor: theme.primary }} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ fontSize: 11, color: theme.muted, flexShrink: 1 }}>{couponMoney(eligibleOrderValue)} of {couponMoney(minimumOrderValue)} · {offer.code}</Text>
      {!unlocked && <Pressable onPress={() => onShopMore?.(offer)}><Text style={{ color: theme.primary, fontWeight: '700', fontSize: 13 }}>Shop More →</Text></Pressable>}
    </View>
  </View>;
}

export function AppliedCoupon({ code, detail, onRemove }) {
  const theme = useAppTheme();
  return <View style={[styles.applied, { borderColor: theme.border, backgroundColor: theme.surface }]}>
    <Text style={{ fontWeight: '700', fontSize: 12 }}>{code} applied</Text>
    <Text style={{ flex: 1, minWidth: 90, fontSize: 12 }}>{detail}</Text>
    <Pressable onPress={onRemove}><Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>Remove</Text></Pressable>
  </View>;
}

export function CartAlert({ children, action }) {
  return <View style={styles.alert} accessibilityRole="alert"><Text style={{ color: '#92400e', fontSize: 13 }}>{children}</Text>{action}</View>;
}

const styles = StyleSheet.create({
  gstNote: { fontSize: 12, color: '#64748b', marginVertical: 4 },
  section: { padding: 18, borderWidth: 1, borderRadius: 16, backgroundColor: '#fff', elevation: 1, shadowColor: '#0b2d6b', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  compactSection: { borderWidth: 0, borderRadius: 0, elevation: 0, padding: 16 },
  sectionTitle: { marginBottom: 14, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  totalGrand: { borderTopWidth: 1, paddingTop: 14, marginTop: 14 },
  empty: { paddingVertical: 64, paddingHorizontal: 20, alignItems: 'center', gap: 16, backgroundColor: '#fff', borderWidth: 1, borderRadius: 18 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { borderRadius: 12, minHeight: 48, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryBtn: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', gap: 12, paddingVertical: 20, borderTopWidth: 1, alignItems: 'flex-start' },
  itemImage: { borderWidth: 1, borderColor: '#e7edf5', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 15, lineHeight: 21, fontWeight: '700', marginBottom: 5 },
  itemP: { fontSize: 13, lineHeight: 20, marginVertical: 3, color: '#64748b' },
  qty: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, marginTop: 12, marginBottom: 6 },
  qtyBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 20, fontWeight: '800' },
  qtyInput: { width: 48, height: 40, textAlign: 'center', fontSize: 16, padding: 4 },
  message: { width: '100%', minHeight: 70, marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, fontSize: 16, textAlignVertical: 'top' },
  note: { fontSize: 12, marginBottom: 12, lineHeight: 18, color: '#64748b' },
  groupTotals: { marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: '#f7f9fc' },
  threshold: { paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderRadius: 14 },
  track: { height: 8, marginTop: 11, marginBottom: 8, overflow: 'hidden', borderRadius: 999 },
  applied: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1, borderRadius: 12 },
  alert: { borderWidth: 1, borderColor: '#fcd34d', backgroundColor: '#fffbeb', padding: 12, borderRadius: 10, gap: 8 },
});
