// Port of ProductWholesaleOffer.jsx: retail/wholesale switch, tiers table, quantity stepper and live quote.
import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';
import { Text } from './ui';

const formatCurrency = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function Btn({ title, onPress, disabled, pressed, style }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: pressed, disabled }}
    style={[styles.btn, pressed && styles.btnPressed, disabled && { opacity: 0.5 }, style]}>
    <Text style={[styles.btnText, pressed && { color: '#fff' }]}>{title}</Text>
  </Pressable>;
}

export default function ProductWholesaleOffer({ wholesale: w }) {
  const theme = useAppTheme();
  const quote = w.shownQuote || w.quote;
  const changingQuantity = Boolean(quote && quote.quantity !== w.quantity);
  const offer = w.offer;
  const nextTier = offer?.priceTiers.find(tier => tier.minimumQuantity > (quote?.quantity ?? w.quantity));
  const step = direction => {
    if (!offer) return;
    const current = Number.isSafeInteger(w.quantity) && w.quantity >= offer.minimumQuantity ? w.quantity : offer.minimumQuantity;
    w.setQuantity(Math.min(offer.maxQuantity, Math.max(offer.minimumQuantity, current + direction * offer.quantityIncrement)));
  };
  return <View style={{ marginTop: 12 }}>
    {w.mode === 'wholesale' && <Text style={[styles.modePill, { backgroundColor: theme.highlight, color: theme.highlightText }]}>Wholesale (B2B)</Text>}
    {w.available && <>
      {w.mode !== 'wholesale' && <Btn title="Wholesale available — View bulk prices" onPress={() => w.chooseMode('wholesale')} style={{ alignItems: 'flex-start' }} />}
      <View style={styles.selector} accessibilityLabel="Purchase channel">
        {(w.retailAvailable === false ? ['wholesale'] : ['retail', 'wholesale']).map(mode => <Btn key={mode} title={mode === 'retail' ? 'Retail' : 'Wholesale'} pressed={w.mode === mode} disabled={w.pending} onPress={() => w.chooseMode(mode)} style={{ flex: 1, minHeight: 44 }} />)}
      </View>
    </>}
    {w.loading && <Text style={styles.p}>Checking wholesale availability…</Text>}
    {w.catalogError ? <Text accessibilityRole="alert" style={styles.p}>{w.catalogError} <Text onPress={w.refresh} style={styles.link}>Retry</Text></Text> : null}
    {w.mode === 'wholesale' && <View accessibilityLabel="Wholesale purchase">
      {!w.available && !w.loading && <>
        {!w.catalogError && !w.error && <Text style={styles.p}>Wholesale is currently unavailable for this product.</Text>}
        {w.retailAvailable !== false && <Btn title="Return to Retail" onPress={() => w.chooseMode('retail')} style={{ alignSelf: 'flex-start' }} />}
      </>}
      {w.available && !offer && <Text style={styles.p}>This variant has no available wholesale offer. {w.retailAvailable === false ? 'Choose another available variant.' : 'Choose another variant or Retail.'}</Text>}
      {offer && <>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <Text style={{ fontSize: 24, fontWeight: '900', color: '#0f172a' }}>From {formatCurrency(offer.startingPrice ?? Math.min(...offer.priceTiers.map(t => t.unitPrice)))}</Text>
          <Text>per {offer.unit || 'unit'}</Text>
        </View>
        <View style={styles.terms} accessibilityLabel="Order terms">
          <Text style={styles.term}>Min order <Text style={styles.b}>{offer.minimumQuantity}</Text></Text>
          {offer.quantityIncrement > 1 && <Text style={styles.term}>Steps of <Text style={styles.b}>{offer.quantityIncrement}</Text></Text>}
          <Text style={styles.term}><Text style={styles.b}>{offer.availableStock}</Text> in stock</Text>
          <Text style={styles.term}>Max <Text style={styles.b}>{offer.maxQuantity}</Text></Text>
        </View>
        <View style={{ marginVertical: 12 }}>
          <Text style={[styles.b, { marginBottom: 8 }]}>Seller’s quantity prices</Text>
          <View style={styles.row}><Text style={[styles.cell, styles.b]}>Quantity</Text><Text style={[styles.cell, styles.b]}>Per unit</Text></View>
          {offer.priceTiers.map((tier, index, tiers) => {
            const applied = !changingQuantity && quote?.tierMinimumQuantity === tier.minimumQuantity;
            return <View key={tier.minimumQuantity} style={[styles.row, applied && { backgroundColor: '#dcfce7' }]}>
              <Text style={[styles.cell, applied && styles.b]}>{tier.minimumQuantity}{index + 1 < tiers.length ? `–${tiers[index + 1].minimumQuantity - 1}` : '+'}{applied ? ' · Applied' : ''}</Text>
              <Text style={[styles.cell, applied && styles.b]}>{formatCurrency(tier.unitPrice)}</Text>
            </View>;
          })}
        </View>
        <Text style={{ marginBottom: 6 }}>Wholesale quantity</Text>
        <View style={styles.stepper}>
          <Btn title="−" onPress={() => step(-1)} disabled={w.pending || !(w.quantity > offer.minimumQuantity)} style={{ width: 48 }} />
          <TextInput keyboardType="number-pad" value={w.quantity ? String(w.quantity) : ''} editable={!w.pending} onChangeText={value => w.setQuantity(Number(value.replace(/\D/g, '')))} accessibilityLabel="Wholesale quantity" style={styles.input} />
          <Btn title="+" onPress={() => step(1)} disabled={w.pending || !(w.quantity < offer.maxQuantity)} style={{ width: 48 }} />
        </View>
        {!w.validQuantity && <Text accessibilityRole="alert" style={styles.p}>Order at least {offer.minimumQuantity}{offer.quantityIncrement > 1 ? `, in steps of ${offer.quantityIncrement}` : ''}, up to {offer.maxQuantity}.</Text>}
        <Text style={[styles.p, { opacity: w.quoteLoading ? 1 : 0 }]}>Checking current price and stock…</Text>
        {(quote || w.quoteLoading || w.error) ? <View style={styles.total} accessibilityLiveRegion="polite">
          {quote && !changingQuantity ? <View>
            <Text style={{ fontSize: 12 }}>Item subtotal</Text>
            <Text style={styles.b}>{quote.quantity} units × {formatCurrency(quote.unitPrice)} = {formatCurrency(quote.subtotal)}</Text>
            <Text style={styles.small}>Estimated item subtotal. Delivery and final totals are confirmed in the Wholesale cart.</Text>
            {quote.savings > 0 && <Text style={[styles.small, { color: '#166534', fontWeight: '700' }]}>Save {formatCurrency(quote.savings)} compared with {formatCurrency(quote.retailUnitPrice)} per unit in Retail for this variant.</Text>}
            {nextTier && <Text style={styles.small}>Next price tier starts at {nextTier.minimumQuantity} units.</Text>}
          </View> : <Text style={styles.small}>{!w.validQuantity ? 'Enter a valid quantity to check the item subtotal.' : w.error ? 'The current item subtotal could not be checked. Please retry.' : `Updating item subtotal for ${w.quantity} units…`}</Text>}
        </View> : null}
      </>}
      {w.error ? <Text accessibilityRole="alert" style={styles.p}>{w.error} <Text onPress={w.refresh} style={styles.link}>Refresh offer</Text></Text> : null}
      {w.available && <Btn title="View Cart" onPress={w.openCart} disabled={w.pending} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  modePill: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, fontWeight: '800', overflow: 'hidden' },
  btn: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnPressed: { backgroundColor: '#166534', borderColor: '#166534' },
  btnText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  selector: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  p: { fontSize: 13, color: '#334155', marginVertical: 4, lineHeight: 19 },
  link: { fontWeight: '700', textDecorationLine: 'underline' },
  terms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 4 },
  term: { fontSize: 12, backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, overflow: 'hidden', color: '#334155' },
  b: { fontWeight: '700' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  cell: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 13 },
  stepper: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, padding: 10, fontSize: 16, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 8, textAlign: 'center', color: '#0f172a' },
  total: { marginTop: 12, backgroundColor: '#f0fdf4', padding: 12, borderRadius: 8 },
  small: { fontSize: 12, lineHeight: 18, marginTop: 4, color: '#334155' },
});
