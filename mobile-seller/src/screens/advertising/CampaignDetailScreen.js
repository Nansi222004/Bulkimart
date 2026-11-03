import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import ReasonPrompt from '../../components/ReasonPrompt';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import CampaignMetrics from '../../components/CampaignMetrics';
import { cancelPaidCampaign, cancelUnpaidCampaign, getCampaign, getCampaignBilling, listAdvertisingPackages, submitCampaign } from '../../services/advertising.api';
import { MODULE_LABEL, adMoney, campaignLabel, canCancelPaid, canCancelUnpaid, fmtDateTime, isEditable, plainStatus } from '../../utils/advertising';
import { spacing, type } from '../../theme';

// Campaign detail: review / payment / delivery states, the accepted package snapshot (terms), server-provided run dates,
// the server billing quote and refund progress. Nothing is calculated here.
export default function CampaignDetailScreen({ route, navigation }) {
  const { id, title } = route.params;
  const [campaign, setCampaign] = useState(null);
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { navigation.setOptions({ title: title || 'Campaign' }); }, [navigation, title]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const c = await getCampaign(id);
      setCampaign(c);
      setBilling(await getCampaignBilling(id).catch(() => null));
    } catch (e) { setError(e.message || 'Could not load the campaign'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !campaign) return <LoadingView message="Loading campaign…" />;
  if (!campaign) return <ErrorView message={error || 'Campaign unavailable'} onRetry={load} />;
  const c = campaign;
  const terms = c.terms;
  const quote = billing?.quote;
  const refund = billing?.refund;

  // The seller confirms the package they are accepting (name, duration, server price). Its `version` is sent so
  // the server can refuse with 409 if the package changed since it was shown.
  const submit = async () => {
    setBusy(true);
    let pkg;
    try {
      pkg = (await listAdvertisingPackages()).find((p) => String(p.id) === String(c.packageId));
    } catch (e) { setBusy(false); Alert.alert('Submit campaign', e.message || 'Could not load the package'); return; }
    setBusy(false);
    if (!pkg) { Alert.alert('Submit campaign', 'Select a current enabled advertising package (Edit campaign).'); return; }
    const price = pkg.billingQuote ? adMoney(pkg.billingQuote.totalPaise) : adMoney(pkg.amountPaise);
    Alert.alert('Submit for review', `Package "${pkg.name}": ${pkg.durationDays} days, ${price}. These terms are fixed when you submit. You pay only after Bulkimart approves.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Submit', onPress: async () => {
        setBusy(true);
        try {
          await submitCampaign(c.id, c.version, pkg.version);
          ToastAndroid.show('Campaign submitted for review', ToastAndroid.SHORT);
          await load();
        } catch (e) { Alert.alert('Submit campaign', e.message || 'Could not submit'); if (e.status === 409) await load(); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const cancel = async ({ reason }) => {
    setBusy(true);
    try {
      if (canCancelUnpaid(c)) await cancelUnpaidCampaign(c.id, c.version, reason);
      else await cancelPaidCampaign(c.id, c.version, reason);
      ToastAndroid.show('Campaign cancelled', ToastAndroid.SHORT);
      setCancelling(false);
      await load();
    } catch (e) { Alert.alert('Cancel campaign', e.message || 'Could not cancel'); if (e.status === 409) await load(); }
    finally { setBusy(false); }
  };

  return (
    <Screen onRefresh={load} refreshing={false}>
      <Card title={c.name}>
        <Text style={styles.label}>{campaignLabel(c)}</Text>
        <KeyValueRow label="Storefront" value={MODULE_LABEL[c.module] || c.module} />
        <KeyValueRow label="Category" value={c.category ? `${c.category.parentName ? `${c.category.parentName} › ` : ''}${c.category.name}` : '—'} />
        <KeyValueRow label="Review" value={plainStatus('review', c.review)} />
        <KeyValueRow label="Payment" value={plainStatus('funding', c.funding)} />
        <KeyValueRow label="Ad" value={plainStatus('delivery', c.delivery)} />
      </Card>

      <Card title="Schedule">
        <KeyValueRow label="Requested start" value={fmtDateTime(c.requestedStartAt)} />
        {c.paid?.startAt ? <KeyValueRow label="Paid run" value={`${fmtDateTime(c.paid.startAt)} → ${fmtDateTime(c.paid.endAt)}`} /> : null}
        {c.pilot?.enabled ? <KeyValueRow label="Pilot run (not billed)" value={`${fmtDateTime(c.pilot.startAt)} → ${fmtDateTime(c.pilot.endAt)}`} /> : null}
        {!c.paid?.startAt && !c.pilot?.enabled ? <Text style={type.small}>The run dates are set by Bulkimart after approval and payment, from the package duration.</Text> : null}
      </Card>

      <Card title="Package">
        {terms ? (
          <>
            <KeyValueRow label="Package" value={terms.name} />
            <KeyValueRow label="Duration" value={`${terms.durationDays} days`} />
            <KeyValueRow label="Products per ad" value={String(terms.maxProducts)} />
            {terms.description ? <Text style={type.small}>{terms.description}</Text> : null}
            <Text style={type.small}>This is the package you accepted when submitting; later package changes don't affect it.</Text>
          </>
        ) : <Text style={type.small}>The package terms are fixed when you submit the campaign.</Text>}
        {quote ? (
          <>
            <KeyValueRow label="Price" value={adMoney(quote.basePaise)} />
            <KeyValueRow label="GST" value={adMoney(quote.taxPaise)} />
            <KeyValueRow strong label="Total" value={adMoney(quote.totalPaise)} />
          </>
        ) : null}
      </Card>

      <Card title={`Products (${c.products?.length || 0})`}>
        {(c.products || []).map((p) => <Text key={`${p.id}:${p.variant}`} style={type.body}>• {p.name}{p.variant ? ` (${p.variant})` : ''}</Text>)}
      </Card>

      <CampaignMetrics campaignId={c.id} />

      {refund ? (
        <Card title="Refund">
          <KeyValueRow label="Paid" value={adMoney(refund.paidPaise)} />
          <KeyValueRow label="Refund limit" value={adMoney(refund.limitPaise)} />
          <KeyValueRow label="Refunded so far" value={adMoney(refund.refundedPaise)} />
          <KeyValueRow label="Remaining under review" value={adMoney(refund.remainingPaise)} />
          <Text style={type.small}>Bulkimart reviews the refund and pays it to your original payment method. The limit follows the package's refund rules.</Text>
        </Card>
      ) : null}

      {c.review === 'APPROVED' && ['UNPAID', 'PAYMENT_FAILED'].includes(c.funding) ? (
        <InlineNotice tone="info">This campaign is approved and waiting for payment. Pay on the Bulkimart seller website; in-app payment is not available yet.</InlineNotice>
      ) : null}

      {isEditable(c) ? (
        <>
          <AppButton title="Edit campaign" variant="outline" disabled={busy} onPress={() => navigation.navigate('CampaignBuilder', { campaign: c })} />
          <AppButton title="Submit for review" loading={busy} onPress={submit} />
        </>
      ) : null}
      {canCancelUnpaid(c) || canCancelPaid(c) ? (
        <AppButton title="Cancel campaign" variant="danger" disabled={busy} onPress={() => setCancelling(true)} />
      ) : null}

      {c.history?.length ? (
        <Card title="History">
          {[...c.history].reverse().map((h, i) => (
            <View key={i} style={styles.step}>
              <Text style={type.label}>{String(h.action).replaceAll('-', ' ')} · {h.actorType === 'admin' ? 'Bulkimart' : 'You'}</Text>
              <Text style={type.small}>{fmtDateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <ReasonPrompt visible={cancelling} busy={busy} title="Cancel campaign"
        message={canCancelUnpaid(c) ? 'This campaign has not been paid, so nothing is charged.' : 'A paid campaign stops, and Bulkimart reviews any refund under the package refund rules.'}
        fields={[{ key: 'reason', label: 'Reason', multiline: true }]} confirmLabel="Cancel campaign"
        onCancel={() => setCancelling(false)} onSubmit={cancel} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '800', color: '#078ccb' },
  step: { borderLeftWidth: 2, borderLeftColor: '#cde9ed', paddingLeft: spacing.md, paddingVertical: 4 },
});
