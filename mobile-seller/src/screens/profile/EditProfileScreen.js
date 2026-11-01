import React, { useState } from 'react';
import { ToastAndroid } from 'react-native';
import Screen from '../../components/Screen';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { updateSellerProfile } from '../../services/seller.api';

// Port of SellerProfileEditor (ProfileTab.jsx): same fields, length limits and validation.
// Sent as PUT /api/sellers/profile with the profile version for optimistic concurrency.
const FIELDS = [
  ['name', 'Store name', 160], ['phone', 'Alternate mobile number', 16], ['email', 'Store email', 254],
  ['description', 'Store description', 2000], ['address', 'Address', 500], ['city', 'City / district', 100],
  ['state', 'State', 100], ['pincode', 'Pincode', 6],
];

export function validateProfile(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Store name is required';
  if (form.phone && !/^(?:\+91)?[6-9]\d{9}$/.test(form.phone.trim())) errors.phone = 'Enter a valid 10-digit mobile number';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
  if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode.trim())) errors.pincode = 'Enter a valid 6-digit pincode';
  return errors;
}

export default function EditProfileScreen({ navigation }) {
  const { seller, refreshSeller } = useAuth();
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([key]) => [key, seller?.storeDetails?.[key] || ''])));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const validation = validateProfile(form);
    setErrors(validation);
    if (Object.keys(validation).length || saving) return;
    setSaving(true); setError('');
    try {
      await updateSellerProfile(form, seller?.__v);
      await refreshSeller();
      ToastAndroid.show('Profile saved.', ToastAndroid.SHORT);
      navigation.goBack();
    } catch (e) {
      setError(e.status === 409 ? 'Your profile changed elsewhere. Go back, review it, and edit again.' : e.message || 'Could not save profile');
    } finally { setSaving(false); }
  };

  return (
    <Screen>
      <InlineNotice tone="info">Update your store contact and business details. Account identity, verification and approval are managed separately.</InlineNotice>
      <AppInput label="Seller ID" value={String(seller?._id || seller?.id || '')} editable={false} />
      {FIELDS.map(([key, label, max]) => (
        <AppInput key={key} label={label} required={key === 'name'} value={form[key]} maxLength={max}
          editable={!saving} error={errors[key]} multiline={key === 'description' || key === 'address'}
          keyboardType={key === 'email' ? 'email-address' : key === 'phone' ? 'phone-pad' : key === 'pincode' ? 'number-pad' : 'default'}
          autoCapitalize={key === 'email' ? 'none' : 'sentences'}
          onChangeText={(text) => setForm((current) => ({ ...current, [key]: text }))} />
      ))}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title={saving ? 'Saving…' : 'Save profile'} onPress={save} loading={saving} />
    </Screen>
  );
}
