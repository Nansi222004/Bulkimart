import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ChipRow from '../../components/ChipRow';
import OptionPicker from '../../components/OptionPicker';
import { InlineNotice, LoadingView } from '../../components/StateViews';
import { createCampaign, listAdvertisingPackages, listAdvertisingProducts, updateCampaign } from '../../services/advertising.api';
import { MODULE_LABEL, adMoney, istToIso, isoToIstParts } from '../../utils/advertising';
import { colors, radius, spacing, type } from '../../theme';

// Create or edit a sponsored-category campaign draft (CampaignBuilder.jsx). The server re-validates
// products, category, package limits and the start date; the app only pre-checks the same rules.
export default function CampaignBuilderScreen({ route, navigation }) {
  const existing = route.params?.campaign || null;
  const start = isoToIstParts(existing?.requestedStartAt);
  const [module, setModule] = useState(existing?.module || 'ECOMMERCE');
  const [name, setName] = useState(existing?.name || '');
  const [packageId, setPackageId] = useState(existing?.packageId ? String(existing.packageId) : '');
  const [selected, setSelected] = useState(() => (existing?.products || []).map((p) => String(p.id)));
  const [categoryId, setCategoryId] = useState(existing?.category?.id ? String(existing.category.id) : '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time || '09:00');
  const [packages, setPackages] = useState(null);
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(`seller-ad-${uuidv4()}`); // retried saves return the same draft
  useEffect(() => { navigation.setOptions({ title: existing ? 'Edit campaign' : 'New campaign' }); }, [navigation, existing]);

  const loadProducts = useCallback(async (q) => {
    setLoadError('');
    try { setProducts(await listAdvertisingProducts(module, q)); } catch (e) { setProducts([]); setLoadError(e.message || 'Could not load your products'); }
  }, [module]);
  useEffect(() => { listAdvertisingPackages().then(setPackages).catch((e) => { setPackages([]); setLoadError(e.message); }); }, []);
  useEffect(() => { setProducts(null); loadProducts(); }, [loadProducts]);

  const modulePackages = useMemo(() => (packages || []).filter((p) => p.module === module), [packages, module]);
  const pkg = modulePackages.find((p) => String(p.id) === packageId) || null;
  const chosen = useMemo(() => (products || []).filter((p) => selected.includes(String(p.id))), [products, selected]);
  // Categories every selected product can advertise in (server-provided adCategories), limited to the package's categories if it has any.
  const categoryOptions = useMemo(() => {
    if (!chosen.length) return [];
    let common = chosen[0].adCategories || [];
    for (const p of chosen.slice(1)) { const ids = new Set((p.adCategories || []).map((c) => String(c.id))); common = common.filter((c) => ids.has(String(c.id))); }
    if (pkg?.categories?.length) { const allowed = new Set(pkg.categories.map(String)); common = common.filter((c) => allowed.has(String(c.id))); }
    return common.map((c) => ({ value: String(c.id), label: c.parentName ? `${c.parentName} › ${c.name}` : c.name }));
  }, [chosen, pkg]);
  useEffect(() => { if (categoryId && !categoryOptions.some((o) => o.value === categoryId)) setCategoryId(''); }, [categoryOptions, categoryId]);

  const toggle = (p) => {
    if (!p.eligible) return;
    const id = String(p.id);
    if (selected.includes(id)) { setSelected(selected.filter((x) => x !== id)); return; }
    const max = pkg?.maxProducts || 20;
    if (selected.length >= max) { Alert.alert('Products', `This package allows up to ${max} ${max === 1 ? 'product' : 'products'} per ad.`); return; }
    setSelected([...selected, id]);
  };

  const save = async () => {
    setError('');
    const iso = istToIso(date, time);
    const issues = [
      !name.trim() && 'Enter a campaign name.',
      !pkg && 'Choose an advertising package.',
      !selected.length && 'Select at least one product.',
      !categoryId && 'Choose the category to sponsor.',
      !iso && 'Enter the start date (YYYY-MM-DD) and time (HH:MM, IST).',
      iso && new Date(iso) <= new Date() && 'Choose a start date and time in the future.',
    ].filter(Boolean);
    if (issues.length) { setError(issues.join('\n')); return; }
    const input = { name: name.trim(), packageId, categoryId, items: selected.map((productId) => ({ productId })), requestedStartAt: iso };
    setBusy(true);
    try {
      const body = existing
        ? await updateCampaign(existing.id, { ...input, version: existing.version })
        : await createCampaign({ ...input, module, requestKey: requestKey.current });
      ToastAndroid.show(existing ? 'Campaign saved' : 'Draft created', ToastAndroid.SHORT);
      const id = body?.data?.id || existing?.id;
      if (id) navigation.replace('CampaignDetail', { id, title: input.name }); else navigation.goBack();
    } catch (e) { setError(e.status === 409 ? 'This campaign changed elsewhere. Go back and open it again.' : e.message || 'Could not save the campaign'); }
    finally { setBusy(false); }
  };

  if (!packages) return <LoadingView message="Loading advertising packages…" />;

  return (
    <Screen>
      <Card title="Campaign">
        <AppInput label="Campaign name" required maxLength={200} value={name} editable={!busy} onChangeText={setName} />
        {existing ? <Text style={type.small}>Storefront: {MODULE_LABEL[module]}</Text> : (
          <ChipRow value={module} accessibilityLabel="Storefront" options={[{ value: 'ECOMMERCE', label: 'Shop All' }, { value: 'QUICK', label: 'Quick Commerce' }]}
            onChange={(m) => { setModule(m); setPackageId(''); setSelected([]); setCategoryId(''); }} />
        )}
      </Card>

      <Card title="Package">
        {modulePackages.length ? modulePackages.map((p) => {
          const active = String(p.id) === packageId;
          return (
            <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: active }} disabled={busy} onPress={() => setPackageId(String(p.id))}
              style={[styles.option, active && styles.optionOn]}>
              <Text style={type.label}>{p.name}</Text>
              <Text style={type.small}>{p.durationDays} days · up to {p.maxProducts} products · {p.billingQuote ? `${adMoney(p.billingQuote.totalPaise)} incl. GST` : adMoney(p.amountPaise)}</Text>
              {p.description ? <Text style={type.small}>{p.description}</Text> : null}
            </Pressable>
          );
        }) : <InlineNotice tone="warning">No advertising packages are available for {MODULE_LABEL[module]} right now.</InlineNotice>}
        <Text style={type.small}>Run dates and any refund follow the package rules set by Bulkimart.</Text>
      </Card>

      <Card title={`Products (${selected.length}${pkg ? `/${pkg.maxProducts}` : ''})`}>
        <View style={styles.searchRow}>
          <AppInput style={styles.flex} placeholder="Search name or SKU" value={search} onChangeText={setSearch} returnKeyType="search" onSubmitEditing={() => loadProducts(search.trim())} />
          <AppButton small variant="outline" title="Search" onPress={() => loadProducts(search.trim())} />
        </View>
        {loadError ? <InlineNotice tone="error">{loadError}</InlineNotice> : null}
        {!products ? <Text style={type.small}>Loading products…</Text> : products.map((p) => {
          const on = selected.includes(String(p.id));
          return (
            <Pressable key={p.id} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !p.eligible }} onPress={() => toggle(p)}
              style={[styles.product, on && styles.optionOn, !p.eligible && styles.disabled]}>
              {p.image ? <Image source={{ uri: p.image }} style={styles.thumb} /> : <View style={styles.thumb} />}
              <View style={styles.flex}>
                <Text style={type.label} numberOfLines={2}>{p.name}</Text>
                <Text style={type.small}>{p.eligible ? (p.sku || '') : p.reason}</Text>
              </View>
              <Text style={styles.check}>{on ? '✓' : ''}</Text>
            </Pressable>
          );
        })}
      </Card>

      <Card title="Category and start">
        <OptionPicker label="Sponsored category" required value={categoryId} options={categoryOptions} disabled={busy || !categoryOptions.length}
          placeholder={chosen.length ? (categoryOptions.length ? 'Choose a category' : 'The selected products share no category') : 'Select products first'} onChange={setCategoryId} />
        <View style={styles.searchRow}>
          <AppInput style={styles.flex} label="Start date (IST)" placeholder="YYYY-MM-DD" maxLength={10} keyboardType="numbers-and-punctuation" value={date} onChangeText={setDate} />
          <AppInput style={styles.flex} label="Start time" placeholder="HH:MM" maxLength={5} keyboardType="numbers-and-punctuation" value={time} onChangeText={setTime} />
        </View>
        <Text style={type.small}>This is the start you request. Bulkimart sets the actual run after approval and payment.</Text>
      </Card>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title={existing ? 'Save changes' : 'Save draft'} variant="accent" loading={busy} onPress={save} />
      <Text style={type.small}>Saving keeps the campaign as a draft. Submit it for review from the campaign screen.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  optionOn: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  disabled: { opacity: 0.5 },
  product: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface },
  flex: { flex: 1 },
  check: { width: 20, fontWeight: '900', color: colors.primaryDark },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
});
