import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import OptionPicker from '../../components/OptionPicker';
import SwitchRow from '../../components/SwitchRow';
import ImageManager from '../../components/ImageManager';
import CategoryField from '../../components/CategoryField';
import CategoryUploadField from '../../components/CategoryUploadField';
import UploadProgress from '../../components/UploadProgress';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { createProduct, getCategoryFields, getCategoryReturnPolicy, getCategoryTree, updateProduct } from '../../services/product.api';
import {
  GST_RATES, defaultEasyReturnsPolicy, MAX_PRODUCT_IMAGES, UNITS, blankVariant, buildCreateFormData, buildUpdateFormData,
  effectiveCategory, emptyForm, formFromProduct, picksForCategory, validateCategoryFields, validateProductForm,
} from '../../utils/productForm';
import { colors, radius, spacing, type } from '../../theme';

// Native port of ProductModal.jsx for physical retail listings (Shop All / Quick Commerce).
export default function ProductFormScreen({ route, navigation }) {
  const { channel, product } = route.params;
  const isEditing = Boolean(product);
  const { seller, limits } = useAuth();
  const [form, setForm] = useState(() => (product ? formFromProduct(product) : emptyForm()));
  const [images, setImages] = useState([]);
  const [replacePhotos, setReplacePhotos] = useState(!isEditing);
  const [tree, setTree] = useState([]);
  const [treeState, setTreeState] = useState('loading');
  const [picks, setPicks] = useState({ l1: '', l2: '', l3: '' });
  const [policy, setPolicy] = useState(null);
  const [policyState, setPolicyState] = useState('idle');
  const [policyAttempt, setPolicyAttempt] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showEasyPolicy, setShowEasyPolicy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);

  useEffect(() => { navigation.setOptions({ title: isEditing ? 'Edit product' : `New ${CHANNEL_LABEL[channel]} product` }); }, [navigation, isEditing, channel]);

  // Category tree for this storefront.
  const loadTree = React.useCallback(async () => {
    setTreeState('loading');
    try {
      const rows = await getCategoryTree(channel);
      setTree(rows);
      setTreeState('ready');
      if (product) setPicks(picksForCategory(rows, product.category?._id || product.category));
    } catch { setTree([]); setTreeState('error'); }
  }, [channel, product]);
  useEffect(() => { loadTree(); }, [loadTree]);

  const category = useMemo(() => effectiveCategory(tree, picks), [tree, picks]);
  useEffect(() => { setForm((f) => (f.categoryId === category.id ? f : { ...f, categoryId: category.id })); }, [category.id]);

  // Admin return-window limit for the chosen category. Sellers can shorten it but not widen it.
  useEffect(() => {
    setPolicy(null);
    if (!category.id) { setPolicyState('idle'); return undefined; }
    let cancelled = false;
    setPolicyState('loading');
    getCategoryReturnPolicy(category.id)
      .then((data) => { if (!cancelled) { setPolicy(data); setPolicyState('ready'); } })
      .catch(() => { if (!cancelled) setPolicyState('error'); });
    return () => { cancelled = true; };
  }, [category.id, policyAttempt]);

  // The details this category asks for (Admin-configured; subcategories inherit their parents' fields).
  const [fields, setFields] = useState([]);
  const [fieldsState, setFieldsState] = useState('idle');
  const [fieldsAttempt, setFieldsAttempt] = useState(0);
  useEffect(() => {
    setFields([]);
    if (!category.id) { setFieldsState('idle'); return undefined; }
    let cancelled = false;
    setFieldsState('loading');
    getCategoryFields(category.id)
      .then((list) => { if (!cancelled) { setFields(list); setFieldsState('ready'); } })
      .catch(() => { if (!cancelled) setFieldsState('error'); });
    return () => { cancelled = true; };
  }, [category.id, fieldsAttempt]);
  const productFields = fields.filter((f) => !f.isVariant);
  const variantFields = fields.filter((f) => f.isVariant);
  const groups = productFields.reduce((acc, f) => { (acc[f.group] = acc[f.group] || []).push(f); return acc; }, {});
  const setSpec = (code, value) => setForm((f) => ({ ...f, specs: { ...(f.specs || {}), [code]: value } }));
  const setVariantOption = (index, code, value) => setForm((f) => ({
    ...f, variants: f.variants.map((v, i) => (i === index ? { ...v, options: { ...(v.options || {}), [code]: value } } : v)),
  }));

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setVariant = (index, key, value) => setForm((f) => ({ ...f, variants: f.variants.map((v, i) => (i === index ? { ...v, [key]: value } : v)) }));
  const addVariant = () => setForm((f) => ({ ...f, variants: [...f.variants, blankVariant()] }));
  const removeVariant = (index) => setForm((f) => ({ ...f, variants: f.variants.filter((_, i) => i !== index) }));

  const sameDayMax = Number(limits?.sameDayMaxProcessingMinutes);
  const errors = validateProductForm(form, {
    channel, isEditing, hasCategory: Boolean(category.id), categoryMessage: category.message,
    photoCount: replacePhotos ? images.length : 0, existingPhotoCount: product?.images?.length || 0,
    returnPolicy: policy, returnPolicyState: policyState, sameDayMax,
  });
  // Checked here once the fields have loaded; if they could not load, saving still works and the server
  // answers with the exact list of missing details.
  const detailErrors = fieldsState === 'ready' ? validateCategoryFields(form, fields) : [];
  const allErrors = [...Object.values(errors).flat(), ...detailErrors];

  // A draft may leave photos and category details for later; the basics (name, category, price, stock) still apply.
  const isDraft = Boolean(product?.isDraft);
  const draftErrors = [...errors.general, ...errors.category, ...errors.variants];

  // mode: 'publish' (create live / publish a draft), 'save' (edit a live product), 'draft' (save or keep as draft)
  const submit = async (mode = isEditing ? (isDraft ? 'draft' : 'save') : 'publish') => {
    setShowErrors(true); setSaveError('');
    const blocking = mode === 'draft' ? draftErrors : allErrors;
    if (blocking.length || savingRef.current) {
      if (blocking.length) Alert.alert('Check the form', blocking.slice(0, 6).join('\n'));
      return;
    }
    savingRef.current = true; setSaving(true); setProgress(0);
    const files = replacePhotos ? images : [];
    try {
      if (isEditing) {
        const fd = buildUpdateFormData(form, channel, files);
        if (isDraft && mode === 'publish') fd.append('publish', 'true');
        const res = await updateProduct(product._id, fd, setProgress);
        ToastAndroid.show(res?.product?.isDraft ? 'Draft saved. Customers cannot see it yet.'
          : res?.product?.status === 'pending' ? (isDraft ? 'Sent for admin review. It goes live once approved.' : 'Product updated. Waiting for admin review before customers see it.')
            : isDraft ? 'Product published.' : 'Product updated.', ToastAndroid.LONG);
      } else {
        const fd = buildCreateFormData(form, channel, files);
        if (mode === 'draft') fd.append('saveAsDraft', 'true');
        const res = await createProduct(fd, setProgress);
        ToastAndroid.show(res?.product?.isDraft ? 'Draft saved. Customers cannot see it until you publish it.'
          : res?.product?.status === 'pending' ? 'Sent for admin review. It goes live once approved.' : 'Product published.', ToastAndroid.LONG);
      }
      // Back to the list (which re-reads from the server), not to a detail screen holding the pre-edit row.
      navigation.navigate('Tabs', { screen: 'Products' });
    } catch (e) {
      // A dropped connection after the upload finished may still have saved the listing.
      setSaveError(!isEditing && (e.code === 'NETWORK' || e.code === 'TIMEOUT')
        ? `${e.message} The product may already have been saved. Check your product list before trying again, so you don't create a duplicate.`
        : e.message || 'Could not save the product');
    } finally { savingRef.current = false; setSaving(false); setProgress(null); }
  };

  // Window Easy Returns will use: the product window, capped by the category/global limit (the server resolves the same).
  const easyDays = policy?.eligible ? Math.min(Number(form.returnWindowDays) || policy.returnWindowDays, policy.returnWindowDays) : null;
  const errorText = (list) => (showErrors && list.length ? list.join(' · ') : '');
  const l1Options = tree.map((c) => ({ value: String(c._id), label: c.name }));

  return (
    <Screen>
      {/* Step 1: category first, as on Amazon / Flipkart, so the form below matches the product. */}
      <Card title={`Category · ${CHANNEL_LABEL[channel]} catalogue`}>
        {treeState === 'error' ? (
          <><InlineNotice tone="error">Categories could not be loaded.</InlineNotice><AppButton small variant="outline" title="Retry" onPress={loadTree} /></>
        ) : (
          <>
            <OptionPicker label="Header category" required disabled={saving || treeState !== 'ready'} value={picks.l1} options={l1Options}
              placeholder={treeState === 'loading' ? 'Loading categories…' : 'Select header category'}
              onChange={(v) => setPicks({ l1: v, l2: '', l3: '' })} />
            {category.l2List.length ? (
              <OptionPicker label="Main category" required disabled={saving} value={picks.l2}
                options={category.l2List.map((c) => ({ value: String(c._id), label: c.name }))}
                onChange={(v) => setPicks((p) => ({ ...p, l2: v, l3: '' }))} />
            ) : null}
            {category.l3List.length ? (
              <OptionPicker label="Sub-category" required disabled={saving} value={picks.l3}
                options={category.l3List.map((c) => ({ value: String(c._id), label: c.name }))}
                onChange={(v) => setPicks((p) => ({ ...p, l3: v }))} />
            ) : null}
            {category.id ? <Text style={type.small}>Listing category: {category.breadcrumb}</Text> : null}
          </>
        )}
        {showErrors && errors.category.length ? <InlineNotice tone="error">{errorText(errors.category)}</InlineNotice> : null}
      </Card>
      {/* Step 2: the details this category needs (e.g. Fabric and Sleeve for T-shirts, RAM and Storage for phones). */}
      {category.id ? (
        <Card title="Product details" right={fieldsState === 'error' ? <AppButton small variant="ghost" title="Retry" onPress={() => setFieldsAttempt((n) => n + 1)} /> : null}>
          <Text style={type.small}>For {category.breadcrumb}. Fields marked * are required for this category.</Text>
          {fieldsState === 'loading' ? <Text style={type.small}>Loading the fields for this category…</Text> : null}
          {fieldsState === 'error' ? <InlineNotice tone="error">The fields for this category could not be loaded.</InlineNotice> : null}
          {fieldsState === 'ready' && !fields.length ? <Text style={type.small}>No extra details are needed for this category.</Text> : null}
          {Object.entries(groups).map(([group, list]) => (
            <View key={group} style={styles.group}>
              {Object.keys(groups).length > 1 ? <Text style={styles.groupTitle}>{group}</Text> : null}
              {list.map((f) => <CategoryField key={f.code} field={f} value={form.specs?.[f.code]} disabled={saving} onChange={(v) => setSpec(f.code, v)} />)}
            </View>
          ))}
          {variantFields.length ? <Text style={type.small}>{variantFields.map((f) => f.label).join(', ')} {variantFields.length === 1 ? 'is' : 'are'} set on each variant below.</Text> : null}
          {showErrors && detailErrors.length ? <InlineNotice tone="error">{detailErrors.join(' · ')}</InlineNotice> : null}
        </Card>
      ) : null}

      <Card title="General info">
        <AppInput label="Product title" required value={form.name} maxLength={200} editable={!saving} onChangeText={(t) => set('name', t)} />
        {productFields.some((f) => f.code === 'brand') ? null : <AppInput label="Brand" value={form.brandName} maxLength={100} editable={!saving} onChangeText={(t) => set('brandName', t)} />}
        <AppInput label="Description" value={form.desc} multiline editable={!saving} onChangeText={(t) => set('desc', t)} />
        <Text style={type.label}>GST rate (prices include GST) *</Text>
        <View style={styles.gstRow} accessibilityRole="radiogroup">
          {GST_RATES.map((rate) => {
            const active = Number(form.gstRate) === rate;
            return (
              <Pressable key={rate} accessibilityRole="radio" accessibilityState={{ checked: active }} disabled={saving}
                onPress={() => set('gstRate', rate)} style={[styles.gst, active && styles.gstActive]}>
                <Text style={[styles.gstText, active && styles.gstTextActive]}>{rate}%</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.box}>
          <SwitchRow label="↩️ Allow returns" value={form.returnable} disabled={saving} onValueChange={(v) => set('returnable', v)}
            hint={!category.id ? 'Pick a category to see its return window.'
              : policyState === 'loading' ? 'Checking the category return window…'
                : policyState === 'error' ? 'Category return policy could not be checked.'
                  : policy?.eligible ? `${policy.source === 'global' ? 'Global' : 'Category'} limit: ${policy.returnWindowDays} days.`
                    : 'No return window is available. Admin can set a category policy or enable the global default.'} />
          {policyState === 'error' ? <AppButton small variant="outline" title="Retry return policy" onPress={() => setPolicyAttempt((n) => n + 1)} /> : null}
          {form.returnable ? (
            <AppInput label="Return window (days after delivery)" keyboardType="number-pad" value={String(form.returnWindowDays ?? '')}
              editable={!saving && policyState === 'ready' && !!policy?.eligible}
              placeholder={policy?.eligible ? `Use ${policy.source === 'global' ? 'global' : 'category'} default (${policy.returnWindowDays} days)` : 'Set an active category or global window first'}
              onChangeText={(t) => set('returnWindowDays', t.replace(/\D/g, ''))} />
          ) : null}
          <Text style={type.small}>
            {!form.returnable ? 'Customers will see: Non-Returnable.'
              : policy?.eligible ? `Customers will see: ${Math.min(Number(form.returnWindowDays) || policy.returnWindowDays, policy.returnWindowDays)}-day returns.` : ''}
          </Text>

          {/* Easy Returns lives inside Allow Returns and reuses its window. Only the extra charge is needed. */}
          {form.returnable ? (
            <View style={styles.easyBox}>
              <SwitchRow label="🔁 Also offer Easy Returns (paid option)" value={form.easyReturnsEnabled} disabled={saving} onValueChange={(v) => set('easyReturnsEnabled', v)}
                hint="Customers who pay a little extra can return for any reason. Others pay the normal price and can return only a wrong, damaged or defective item." />
              {form.easyReturnsEnabled ? (
                <>
                  <AppInput label="Easy Returns extra charge (₹ per unit)" keyboardType="decimal-pad" placeholder="e.g. 40" editable={!saving}
                    value={String(form.easyReturnsExtraCharge ?? '')} onChangeText={(t) => set('easyReturnsExtraCharge', t.replace(/[^0-9.]/g, ''))} />
                  <View style={styles.priceRow}>
                    <View style={[styles.priceCard, styles.priceEasy]}>
                      <Text style={type.small}>With Easy Returns</Text>
                      <Text style={type.label}>{Number(form.variants?.[0]?.price) > 0 ? `₹${(Number(form.variants[0].price) + (Number(form.easyReturnsExtraCharge) || 0)).toLocaleString('en-IN')}` : `Price + ₹${Number(form.easyReturnsExtraCharge) || 0}`}</Text>
                      <Text style={type.small}>Any reason{easyDays ? ` · ${easyDays} days` : ''}</Text>
                    </View>
                    <View style={[styles.priceCard, styles.priceNo]}>
                      <Text style={type.small}>Without Easy Returns</Text>
                      <Text style={type.label}>{Number(form.variants?.[0]?.price) > 0 ? `₹${Number(form.variants[0].price).toLocaleString('en-IN')}` : 'Normal price'}</Text>
                      <Text style={type.small}>Wrong, damaged, defective</Text>
                    </View>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => setShowEasyPolicy((v) => !v)} style={styles.linkRow}>
                    <Text style={styles.link}>{showEasyPolicy ? '▾' : '▸'} Customize policy text (optional)</Text>
                  </Pressable>
                  {showEasyPolicy ? (
                    <>
                      <AppInput label="Policy shown to customers" multiline numberOfLines={3} maxLength={1000} editable={!saving}
                        placeholder={defaultEasyReturnsPolicy(easyDays || 7)} value={form.easyReturnsPolicyText} onChangeText={(t) => set('easyReturnsPolicyText', t)} />
                      <AppInput label="Return conditions (one per line)" multiline numberOfLines={2} editable={!saving}
                        placeholder="Unused, with original tags" value={form.easyReturnsConditions} onChangeText={(t) => set('easyReturnsConditions', t)} />
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        {isEditing && channel === 'ecommerce' ? (
          <View style={styles.box}>
            <SwitchRow label="⚡ Offer same-day delivery" value={form.sameDayEnabled} disabled={saving} onValueChange={(v) => set('sameDayEnabled', v)} />
            {form.sameDayEnabled ? (
              <>
                <AppInput label="Packing time (minutes)" required keyboardType="number-pad" placeholder="30" value={String(form.processingMinutes ?? '')}
                  editable={!saving} onChangeText={(t) => set('processingMinutes', t.replace(/\D/g, ''))}
                  hint={Number.isFinite(sameDayMax) ? `Up to ${sameDayMax} minutes` : undefined} />
                {!seller?.sameDay?.enabled ? <InlineNotice tone="warning">Your shop has not switched same-day on yet. Set it up on the seller website first.</InlineNotice> : null}
              </>
            ) : null}
          </View>
        ) : null}
        {showErrors && errors.general.length ? <InlineNotice tone="error">{errorText(errors.general)}</InlineNotice> : null}
      </Card>


      <Card title="Item variants" right={<AppButton small variant="ghost" title="＋ Add" disabled={saving} onPress={addVariant} />}>
        <Text style={type.small}>{variantFields.length
          ? `Each variant is one ${variantFields.map((f) => f.label).join(' + ')} combination with its own price and stock.`
          : 'Selling price, MRP, stock, unit and weight are set per variant.'}</Text>
        {form.variants.map((v, i) => (
          <View key={v._id || `new-${i}`} style={styles.variant}>
            <View style={styles.variantHead}>
              <Text style={type.label}>Variant {i + 1}{v.sku ? ` · ${v.sku}` : ''}</Text>
              {form.variants.length > 1 && !v._id ? <AppButton small variant="ghost" title="Remove" disabled={saving} onPress={() => removeVariant(i)} /> : null}
            </View>
            <AppInput label="Name" required value={String(v.name ?? '')} editable={!saving} onChangeText={(t) => setVariant(i, 'name', t)}
              hint={variantFields.length ? `e.g. ${variantFields.map((f) => f.options?.[0]?.label || f.label).join(' / ')}` : undefined} />
            {variantFields.map((f) => (
              <CategoryField key={f.code} field={f} value={v.options?.[f.code]} disabled={saving} onChange={(val) => setVariantOption(i, f.code, val)} />
            ))}
            {variantFields.length ? (
              <CategoryUploadField label="Variant photo (optional)" hint="e.g. this colour. The product photos are used when empty." kind="image"
                value={v.images?.[0] || ''} disabled={saving} onChange={(url) => setVariant(i, 'images', url ? [url] : [])} />
            ) : null}
            <View style={styles.pair}>
              <AppInput style={styles.half} label="Selling price (₹)" required keyboardType="decimal-pad" value={String(v.price ?? '')} editable={!saving} onChangeText={(t) => setVariant(i, 'price', t.replace(/[^0-9.]/g, ''))} />
              <AppInput style={styles.half} label="MRP (₹)" keyboardType="decimal-pad" value={String(v.mrp ?? '')} editable={!saving} onChangeText={(t) => setVariant(i, 'mrp', t.replace(/[^0-9.]/g, ''))} />
            </View>
            <View style={styles.pair}>
              <AppInput style={styles.half} label="Stock" required keyboardType="number-pad" value={String(v.stock ?? '')} editable={!saving} onChangeText={(t) => setVariant(i, 'stock', t.replace(/\D/g, ''))} />
              <AppInput style={styles.half} label="Weight" keyboardType="decimal-pad" value={String(v.weight ?? '')} editable={!saving} onChangeText={(t) => setVariant(i, 'weight', t.replace(/[^0-9.]/g, ''))} />
            </View>
            <OptionPicker label="Unit" value={v.unit || 'piece'} disabled={saving} options={UNITS.map((u) => ({ value: u, label: u }))} onChange={(u) => setVariant(i, 'unit', u)} />
          </View>
        ))}
        {showErrors && errors.variants.length ? <InlineNotice tone="error">{errorText(errors.variants)}</InlineNotice> : null}
      </Card>

      <Card title="Tax & shipping">
        <View style={styles.pair}>
          <AppInput style={styles.half} label="HSN code" keyboardType="number-pad" maxLength={8} placeholder="e.g. 6109" value={String(form.hsnCode ?? '')}
            editable={!saving} onChangeText={(t) => set('hsnCode', t.replace(/\D/g, ''))} />
          <AppInput style={styles.half} label="Barcode / GTIN" keyboardType="number-pad" maxLength={14} value={String(form.barcode ?? '')}
            editable={!saving} onChangeText={(t) => set('barcode', t.replace(/\D/g, ''))} />
        </View>
        <View style={styles.pair}>
          <AppInput style={styles.half} label="Country of origin" maxLength={60} placeholder="India" value={form.countryOfOrigin ?? ''}
            editable={!saving} onChangeText={(t) => set('countryOfOrigin', t)} />
          <AppInput style={styles.half} label="Dispatch in (days)" keyboardType="number-pad" maxLength={2} placeholder="e.g. 1" value={String(form.dispatchDays ?? '')}
            editable={!saving} onChangeText={(t) => set('dispatchDays', t.replace(/\D/g, ''))} />
        </View>
      </Card>

      <Card title="Photos">
        {isEditing && product.images?.length ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.existing}>
              {product.images.map((uri, i) => <Image key={uri + i} source={{ uri }} style={[styles.existingImage, replacePhotos && styles.faded]} />)}
            </ScrollView>
            <SwitchRow label="Replace all photos" value={replacePhotos} disabled={saving}
              hint="Adding any new photo replaces the entire photo set. Leave this off to keep the current photos."
              onValueChange={(v) => { setReplacePhotos(v); if (!v) setImages([]); }} />
          </>
        ) : null}
        {replacePhotos ? <ImageManager images={images} onChange={setImages} max={MAX_PRODUCT_IMAGES} disabled={saving} /> : null}
        {showErrors && errors.photos.length ? <InlineNotice tone="error">{errorText(errors.photos)}</InlineNotice> : null}
      </Card>

      {saving ? <UploadProgress progress={progress} label={replacePhotos && images.length ? 'Uploading photos' : 'Saving'} /> : null}
      {saveError ? <InlineNotice tone="error">{saveError}</InlineNotice> : null}
      {isDraft ? <InlineNotice tone="info">This is a draft. Customers cannot see it until you publish it.</InlineNotice> : null}
      <AppButton title={!isEditing || isDraft ? 'Publish product' : 'Save changes'} variant="accent" loading={saving} onPress={() => submit(!isEditing || isDraft ? 'publish' : 'save')} />
      {!isEditing || isDraft ? (
        <AppButton title={isDraft ? 'Save draft' : 'Save as draft'} variant="outline" disabled={saving} onPress={() => submit('draft')} />
      ) : null}
      {!isEditing ? <Text style={type.small}>Same-day delivery can be switched on from Edit once the product is saved.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  easyBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border, gap: spacing.sm },
  linkRow: { minHeight: 40, justifyContent: 'center' },
  link: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  priceRow: { flexDirection: 'row', gap: spacing.sm },
  priceCard: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  priceEasy: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  priceNo: { borderColor: '#f97316', backgroundColor: '#fff7ed' },
  gstRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gst: { minWidth: 56, minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  gstActive: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  gstText: { fontWeight: '700', color: colors.textSecondary },
  gstTextActive: { color: colors.primaryDark },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  variant: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.md, gap: spacing.sm },
  variantHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pair: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  existing: { gap: spacing.sm },
  group: { gap: spacing.sm },
  groupTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  existingImage: { width: 88, height: 88, borderRadius: radius.sm, backgroundColor: colors.surface },
  faded: { opacity: 0.35 },
});
