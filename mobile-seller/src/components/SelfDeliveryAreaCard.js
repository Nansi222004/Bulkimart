import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from './AppText';
import Card from './Card';
import AppInput from './AppInput';
import AppButton from './AppButton';
import { InlineNotice } from './StateViews';
import { getDeliveryMethodOptions } from '../services/product.api';
import { getSelfDeliveryArea, saveSelfDeliveryArea } from '../services/settings.api';
import { colors, radius, spacing, type } from '../theme';

/**
 * Where the seller delivers Self Delivery products: whole states and/or pincodes. Customers outside
 * this area cannot buy Self Delivery items. Same rules as the web profile card; the server validates.
 * Hidden while delivery methods are switched off.
 */
export default function SelfDeliveryAreaCard() {
  const [area, setArea] = useState(null);
  const [states, setStates] = useState([]);
  const [pincodes, setPincodes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const config = await getDeliveryMethodOptions();
      if (!config?.enabled) return;
      const data = await getSelfDeliveryArea().catch(() => null);
      if (!live || !data) return;
      setArea(data); setStates(data.states || []); setPincodes((data.pincodes || []).join(', '));
    })();
    return () => { live = false; };
  }, []);

  if (!area) return null;
  const toggle = (name) => setStates((list) => (list.includes(name) ? list.filter((s) => s !== name) : [...list, name]));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const data = await saveSelfDeliveryArea({ states, pincodes });
      setArea(data); setPincodes((data.pincodes || []).join(', '));
      ToastAndroid.show('Self Delivery area saved', ToastAndroid.SHORT);
    } catch (e) { setError(e.message || 'Could not save the delivery area'); }
    finally { setSaving(false); }
  };

  return (
    <Card title="Self Delivery area">
      <Text style={type.small}>Customers can buy your Self Delivery products only at these places. Choose whole states, or list pincodes, or both.</Text>
      <View style={styles.chips}>
        {area.stateOptions.map((name) => {
          const on = states.includes(name);
          return (
            <Pressable key={name} accessibilityRole="checkbox" accessibilityState={{ checked: on }} disabled={saving} onPress={() => toggle(name)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <AppInput label="Pincodes (comma separated)" value={pincodes} multiline keyboardType="numbers-and-punctuation" editable={!saving} onChangeText={setPincodes} />
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title="Save delivery area" loading={saving} onPress={save} />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  chipText: { fontSize: 12, color: colors.textSecondary },
  chipTextOn: { color: colors.primaryDark, fontWeight: '700' },
});
