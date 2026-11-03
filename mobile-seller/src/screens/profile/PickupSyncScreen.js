import React, { useCallback, useState } from 'react';
import { ToastAndroid } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { useAuth } from '../../context/AuthContext';
import { getPickupSync, retryPickupSync, savePickupDetails } from '../../services/fulfillment.api';
import { type } from '../../theme';

// Port of frontend/src/modules/Seller/components/PickupSyncCard.jsx (Shiprocket pickup registration).
const FIELDS = [
  ['name', 'Pickup contact/store name', 100], ['email', 'Pickup contact email', 254], ['phone', 'Pickup contact phone', 100],
  ['address', 'Store pickup street address', 80], ['city', 'City', 100], ['state', 'State', 100], ['pincode', 'Postal pincode', 6],
];
const draftFrom = (seller) => ({
  name: seller?.storeDetails?.name || seller?.businessName || '',
  ...Object.fromEntries(['email', 'phone', 'address', 'city', 'state', 'pincode'].map((k) => [k, seller?.storeDetails?.[k] || ''])),
});

function validate(draft) {
  const errors = {};
  FIELDS.forEach(([key, label]) => { if (!String(draft[key] || '').trim()) errors[key] = `${label} is required`; });
  if (draft.address && draft.address.trim().length < 10) errors.address = 'Enter at least 10 characters';
  if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Enter a valid email address';
  if (draft.pincode && !/^[1-9][0-9]{5}$/.test(draft.pincode.trim())) errors.pincode = 'Enter a valid 6-digit pincode';
  return errors;
}

export default function PickupSyncScreen() {
  const { seller, refreshSeller } = useAuth();
  const loader = useCallback(() => getPickupSync(), []);
  const { data: status, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(seller));
  const [errors, setErrors] = useState({});

  if (loading && !status) return <LoadingView message="Checking registration…" />;
  if (!status && error) return <ErrorView message={error} note="Registration status unavailable." onRetry={reload} />;

  const state = status?.status;
  const pending = ['pending', 'syncing'].includes(state);

  const run = async (save) => {
    if (busy) return;
    if (save) { const v = validate(draft); setErrors(v); if (Object.keys(v).length) return; }
    setBusy(true); setActionError('');
    try {
      if (save) { await savePickupDetails(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, String(v).trim()]))); setEditing(false); }
      else await retryPickupSync();
      await refresh();
      await refreshSeller();
      ToastAndroid.show(save ? 'Pickup details saved' : 'Synchronization requested', ToastAndroid.SHORT);
    } catch (e) { setActionError(e.message || 'Could not update pickup registration. Retry after checking your connection.'); }
    finally { setBusy(false); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card title="Shiprocket pickup registration">
        <Text style={type.heading}>{state === 'registered' ? 'Registered' : pending ? 'Pending — automatic synchronization scheduled' : 'Needs attention'}</Text>
        {status?.message ? <Text style={type.body}>{status.message}</Text> : null}
        {status?.locationName ? <KeyValueRow label="Pickup reference" value={status.locationName} /> : null}
        {status?.registeredAt ? <KeyValueRow label="Last confirmed" value={new Date(status.registeredAt).toLocaleString('en-IN')} /> : null}
        {state === 'registered' && !status.shippingApproved ? <InlineNotice tone="info">Pickup is registered. Shiprocket shipping still requires platform approval.</InlineNotice> : null}
        {pending ? <InlineNotice tone="info">Refresh status to check progress. Manual Bulkimart delivery remains available.</InlineNotice> : null}
        {status?.nextAttemptAt && state !== 'registered' ? <KeyValueRow label="Next retry window" value={new Date(status.nextAttemptAt).toLocaleString('en-IN')} /> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {actionError ? <InlineNotice tone="error">{actionError}</InlineNotice> : null}
        <AppButton small variant="outline" title="Refresh pickup status" disabled={busy} onPress={refresh} />
        <AppButton small variant="outline" title={state === 'registered' ? 'Recheck pickup registration' : 'Retry pickup synchronization'}
          disabled={busy || pending} loading={busy && !editing} onPress={() => run(false)} />
        <AppButton small variant="ghost" title={editing ? 'Cancel editing' : 'Correct pickup address/contact'} disabled={busy}
          onPress={() => { if (!editing) setDraft(draftFrom(seller)); setErrors({}); setEditing((v) => !v); }} />
      </Card>
      {editing ? (
        <Card title="Pickup details">
          {FIELDS.map(([key, label, max]) => (
            <AppInput key={key} label={label} required value={draft[key]} maxLength={max} editable={!busy} error={errors[key]}
              keyboardType={key === 'email' ? 'email-address' : key === 'phone' ? 'phone-pad' : key === 'pincode' ? 'number-pad' : 'default'}
              autoCapitalize={key === 'email' ? 'none' : 'sentences'}
              onChangeText={(t) => setDraft((d) => ({ ...d, [key]: t }))} />
          ))}
          <AppButton title={busy ? 'Saving…' : 'Save pickup details and synchronize'} loading={busy} onPress={() => run(true)} />
        </Card>
      ) : null}
    </Screen>
  );
}
