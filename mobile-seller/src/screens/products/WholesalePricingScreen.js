import React, { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import SwitchRow from '../../components/SwitchRow';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { saveWholesalePricing } from '../../services/product.api';
import { editableOffer, eligibleWholesaleProduct, hasWholesaleAccess, offerPayload, validateWholesaleOffer } from '../../utils/wholesale';
import { spacing, type } from '../../theme';

// Port of the Wholesale section of ProductModal.jsx + VariantWholesaleFields.jsx.
// Edits only the Wholesale offer (MOQ, increment, quantity price tiers) of saved variants.
// Retail price and the shared stock are unchanged; the server re-checks every rule.
export default function WholesalePricingScreen({ route, navigation }) {
  const { product } = route.params;
  const { seller } = useAuth();
  const access = hasWholesaleAccess(seller);
  const eligible = eligibleWholesaleProduct(product);
  const saved = useMemo(() => (product.variants || []).filter((v) => v._id), [product]);
  const baseline = useMemo(() => Object.fromEntries(saved.map((v) => [String(v._id), JSON.stringify(editableOffer(v.wholesalePricing))])), [saved]);
  const [offers, setOffers] = useState(() => Object.fromEntries(saved.map((v) => [String(v._id), editableOffer(v.wholesalePricing)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const changed = saved.filter((v) => JSON.stringify(offers[String(v._id)]) !== baseline[String(v._id)]);
  const errorsFor = (v) => validateWholesaleOffer(offers[String(v._id)], v.stock);
  const invalid = changed.some((v) => Object.keys(errorsFor(v)).length);

  const update = (id, updater) => { setError(''); setOffers((o) => ({ ...o, [id]: updater(o[id]) })); };

  const toggle = (v, enabled) => update(String(v._id), (current) => (enabled
    ? {
      enabled: true,
      minimumQuantity: current.minimumQuantity || '1',
      quantityIncrement: current.quantityIncrement || '1',
      priceTiers: current.priceTiers?.length ? current.priceTiers : [{ minimumQuantity: current.minimumQuantity || '1', unitPrice: '' }],
    }
    : { ...current, enabled: false }));

  const save = async () => {
    if (lock.current || !changed.length) return;
    if (invalid) { setError('Correct the Wholesale fields shown for each variant.'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      const variants = changed.map((v) => ({ variantId: v._id, wholesalePricing: offerPayload(offers[String(v._id)]) }));
      await saveWholesalePricing(product._id, variants, product.__v ?? 0);
      ToastAndroid.show('Wholesale terms saved', ToastAndroid.SHORT);
      // The product version changed on the server; reopen from a fresh list.
      navigation.navigate('Tabs', { screen: 'Products' });
    } catch (e) {
      if (e.status === 409) {
        Alert.alert('Product changed', e.message || 'This product changed after it was loaded. Reopen it from the product list and try again.', [
          { text: 'Back to products', onPress: () => navigation.navigate('Tabs', { screen: 'Products' }) },
        ]);
      } else setError(e.message || 'Could not save Wholesale terms');
    } finally { lock.current = false; setSaving(false); }
  };

  if (!access) {
    return (
      <Screen>
        <InlineNotice tone="info">Wholesale pricing needs an approved Wholesale channel. Request Wholesale access in Business settings; Bulkimart reviews it.</InlineNotice>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={type.small}>{product.name}</Text>
      <Text style={type.small}>Set a minimum order, quantity step and per-unit prices for bulk buyers. Retail prices and the shared stock stay as they are.</Text>
      {!eligible ? <InlineNotice tone="warning">An approved, active physical product in an active category is required to turn on new offers. You can still turn existing offers off.</InlineNotice> : null}
      {!saved.length ? <InlineNotice tone="warning">Save this product's variants first.</InlineNotice> : null}

      {saved.map((v, index) => {
        const id = String(v._id);
        const pricing = offers[id];
        const errors = errorsFor(v);
        const tiers = pricing.priceTiers || [];
        const setTier = (i, key, value) => update(id, (c) => ({ ...c, priceTiers: c.priceTiers.map((t, j) => (j === i ? { ...t, [key]: value } : t)) }));
        return (
          <Card key={id} title={v.name || `Variant ${index + 1}`}>
            <SwitchRow label="Wholesale offer" hint={`Shared stock: ${v.stock ?? '—'}`} value={pricing.enabled}
              disabled={saving || (!eligible && !pricing.enabled)} onValueChange={(on) => toggle(v, on)} />
            {pricing.enabled ? (
              <View style={styles.fields}>
                <AppInput label="Minimum order quantity" keyboardType="number-pad" value={pricing.minimumQuantity} editable={!saving} error={errors.minimumQuantity}
                  onChangeText={(t) => update(id, (c) => ({ ...c, minimumQuantity: t, priceTiers: (c.priceTiers || []).map((tier, i) => (i === 0 ? { ...tier, minimumQuantity: t } : tier)) }))} />
                <AppInput label="Quantity increment" keyboardType="number-pad" value={pricing.quantityIncrement} editable={!saving} error={errors.quantityIncrement}
                  hint="Buyers order the MOQ plus multiples of this number."
                  onChangeText={(t) => update(id, (c) => ({ ...c, quantityIncrement: t }))} />
                <Text style={type.label}>Quantity price tiers</Text>
                {tiers.map((tier, i) => (
                  <View key={i} style={styles.tier}>
                    <AppInput label={`Tier ${i + 1}: from quantity`} keyboardType="number-pad" value={tier.minimumQuantity}
                      editable={!saving && i !== 0} hint={i === 0 ? 'Starts at the MOQ' : undefined} error={errors[`tier.${i}.quantity`]}
                      onChangeText={(t) => setTier(i, 'minimumQuantity', t)} />
                    <AppInput label="Unit price (₹)" keyboardType="decimal-pad" value={tier.unitPrice} editable={!saving}
                      error={errors[`tier.${i}.price`]} onChangeText={(t) => setTier(i, 'unitPrice', t)} />
                    {tiers.length > 1 ? (
                      <AppButton small variant="outline" title={`Remove tier ${i + 1}`} disabled={saving}
                        onPress={() => update(id, (c) => ({ ...c, priceTiers: c.priceTiers.filter((_, j) => j !== i) }))} />
                    ) : null}
                  </View>
                ))}
                {errors.priceTiers ? <InlineNotice tone="error">{errors.priceTiers}</InlineNotice> : null}
                <AppButton small variant="outline" title="Add quantity tier" disabled={saving}
                  onPress={() => update(id, (c) => {
                    const last = c.priceTiers?.[c.priceTiers.length - 1];
                    const next = last ? Number(last.minimumQuantity) + Number(c.quantityIncrement || 1) : Number(c.minimumQuantity);
                    return { ...c, priceTiers: [...(c.priceTiers || []), { minimumQuantity: Number.isFinite(next) ? String(next) : '', unitPrice: '' }] };
                  })} />
              </View>
            ) : <Text style={type.small}>Turning an offer off keeps the product and its retail stock available.</Text>}
          </Card>
        );
      })}

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title={changed.length ? `Save Wholesale terms (${changed.length})` : 'No changes to save'} loading={saving}
        disabled={!changed.length || saving} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md, marginTop: spacing.sm },
  tier: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.sm },
});
