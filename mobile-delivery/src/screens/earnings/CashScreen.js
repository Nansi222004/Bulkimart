import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import { InlineNotice, LoadingView } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import * as deliveryApi from '../../services/delivery.api';
import { codReportLimitPaise, formatPaise, rupeesToPaise } from '../../utils/money';
import { CASH_LABEL, CASH_TONE, LEDGER_BUCKET } from '../../utils/status';
import { colors, spacing, type } from '../../theme';

/**
 * COD cash and verified earnings (web DeliveryFinancePanel). Rider-scoped by the server.
 *   GET  /finances/cod, /finances/ledger, /finances/deliveries   (paginated)
 *   POST /orders/:id/cod/collect | remit { amount, method:'cash', reference, reason }
 * A report is a claim; Bulkimart verifies it. Cash stays "with you" until an admin confirms receipt.
 */
export default function CashScreen() {
  const { refreshProfile } = useAuth();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', cod: [], ledger: [], balances: [], trips: [], pages: 1, enabled: false });
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ amount: '', reference: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const generation = useRef(0);

  const load = useCallback(async (p) => {
    const g = ++generation.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [cod, ledger, trips] = await Promise.all([deliveryApi.getCodOrders(p), deliveryApi.getLedger(p), deliveryApi.getDeliveryFinance(p)]);
      if (g !== generation.current) return;
      const l = ledger.data || {};
      const flags = l.flags || {};
      setState({
        loading: false, error: '', cod: cod.data || [], ledger: l.rows || [], balances: l.balances || [], trips: trips.data || [],
        pages: Math.max(1, cod.meta?.pages || 1, trips.meta?.pages || 1, Math.ceil((l.total || 0) / (l.limit || 1))),
        enabled: Boolean(flags.operations && flags.policyApproved && flags.testsApproved),
      });
    } catch (e) {
      if (g === generation.current) setState((s) => ({ ...s, loading: false, error: e.message || 'Financial records unavailable' }));
    }
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  const isHandover = selected?.cash?.status === 'collected';
  const limitPaise = selected ? codReportLimitPaise(selected.cash) : 0;
  const amountPaise = rupeesToPaise(form.amount);
  const overLimit = form.amount !== '' && amountPaise !== null && amountPaise > limitPaise;
  const invalidAmount = form.amount !== '' && (amountPaise === null || amountPaise <= 0);
  const canSubmit = selected && amountPaise > 0 && !overLimit && form.reference.trim().length >= 4 && form.reason.trim().length >= 5;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setNotice(null);
    const order = selected;
    try {
      await deliveryApi.reportCod(order._id, isHandover ? 'remit' : 'collect', { amount: amountPaise / 100, reference: form.reference.trim(), reason: form.reason.trim() });
      setSelected(null);
      setNotice({ tone: 'success', text: isHandover
        ? `Handover of ${formatPaise(amountPaise)} for ${order.orderNo} sent to Bulkimart. You will be notified once they confirm receipt.`
        : `Collection of ${formatPaise(amountPaise)} for ${order.orderNo} recorded. Hand the cash over and report it next.` });
      await Promise.allSettled([load(page), refreshProfile()]);
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || 'Could not submit the report.' });
    } finally { setBusy(false); }
  };

  const outstanding = state.cod.reduce((sum, row) => sum + (Number(row.cash?.outstandingPaise) || 0), 0);

  return (
    <Screen refreshing={state.loading && !state.cod.length} onRefresh={() => load(page)}>
      <InlineNotice>COD cash belongs to Bulkimart until you hand it over; it is not your earning. After an OTP delivery, report what the customer paid, then hand the cash over and report the deposit or receipt reference. You can withdraw earnings only when you hold no COD cash.</InlineNotice>
      {!state.enabled && !state.loading && !state.error ? <InlineNotice tone="warning">Cash reporting is awaiting policy approval. Contact operations for existing cash obligations.</InlineNotice> : null}
      {state.error ? <InlineNotice tone="error">{state.error}</InlineNotice> : null}
      {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}

      <Card title="Cash with you (this page)">
        <Text style={styles.big}>{formatPaise(outstanding)}</Text>
        {state.balances.map((b) => (
          <Text key={b._id?.bucket} style={type.body}>{LEDGER_BUCKET[b._id?.bucket] || b._id?.bucket}: {formatPaise(Math.round(Number(b.amount) * 100))}</Text>
        ))}
      </Card>

      {state.loading && !state.cod.length ? <LoadingView message="Loading COD records…" /> : null}

      {selected ? (
        <Card title={`${selected.orderNo} · ${isHandover ? 'Handover report' : 'Collection report'}`}>
          <AppInput label="Amount (₹)" value={form.amount} keyboardType="decimal-pad" onChangeText={(t) => setForm((f) => ({ ...f, amount: t.replace(/[^\d.]/g, '') }))}
            error={overLimit ? `Cannot be more than ${formatPaise(limitPaise)} — the ${isHandover ? 'cash you collected' : 'order amount'}.` : invalidAmount ? 'Enter an amount with at most two decimals.' : ''}
            hint={isHandover ? `The cash you are handing over (you collected ${formatPaise(selected.cash.collectedPaise)}).` : `The exact cash collected from the customer (${formatPaise(selected.cash.duePaise ?? selected.cash.expectedPaise)}).`} />
          <AppInput label="Evidence reference" value={form.reference} maxLength={200} onChangeText={(t) => setForm((f) => ({ ...f, reference: t }))}
            hint={isHandover ? 'Bank deposit slip number, UPI transaction ID or hub receipt number.' : 'A note that identifies this payment, e.g. the order number or OTP time.'} />
          <AppInput label="Details" value={form.reason} maxLength={1000} multiline onChangeText={(t) => setForm((f) => ({ ...f, reason: t }))}
            hint={isHandover ? 'Where and to whom you handed it over.' : 'Anything unusual about this payment.'} />
          <View style={styles.row}>
            <AppButton title="Submit report" style={styles.flex} loading={busy} disabled={!canSubmit} onPress={submit} />
            <AppButton title="Cancel" variant="outline" style={styles.flex} disabled={busy} onPress={() => setSelected(null)} />
          </View>
        </Card>
      ) : null}

      {state.cod.map((row) => (
        <Card key={row._id} title={row.orderNo} right={<StatusPill tone={CASH_TONE[row.cash?.status] || 'neutral'} label={CASH_LABEL[row.cash?.status] || row.cash?.status} />}>
          <Text style={type.small}>Order amount {formatPaise(row.cash?.expectedPaise)}{row.cash?.duePaise !== undefined ? ` · cash due ${formatPaise(row.cash.duePaise)}` : ''}</Text>
          <Text style={type.small}>You collected {formatPaise(row.cash?.collectedPaise)} · You handed over {formatPaise(row.cash?.reportedPaise)}</Text>
          <Text style={type.small}>Bulkimart received {formatPaise(row.cash?.verifiedPaise)} · Still with you {formatPaise(row.cash?.outstandingPaise)}</Text>
          {row.status === 'delivered' && ['expected', 'collected'].includes(row.cash?.status) ? (
            <AppButton small variant="outline" disabled={busy || !state.enabled} title={row.cash.status === 'collected' ? 'Report cash handover' : 'Report cash collection'}
              onPress={() => { setSelected(row); setNotice(null); setForm({ amount: '', reference: '', reason: '' }); }} />
          ) : null}
        </Card>
      ))}
      {!state.loading && !state.cod.length && !state.error ? <Text style={type.small}>No COD orders on this page.</Text> : null}

      <Card title="Earning and payout history">
        {state.ledger.length ? state.ledger.map((e) => (
          <Text key={e._id} style={type.small}>{e.description} · {LEDGER_BUCKET[e.bucket] || e.bucket} · {e.direction === 'credit' ? '+' : '−'}{formatPaise(Math.round(Number(e.amount) * 100))} · {e.reference || e.entryNo}</Text>
        )) : <Text style={type.small}>No ledger entries on this page.</Text>}
      </Card>

      <Card title="Delivery earning calculations">
        {state.trips.length ? state.trips.map((t) => (
          <View key={t._id} style={styles.trip}>
            <Text style={type.label}>{t.status} · {t.financialEarningStatus || 'Historical record; reconciliation required'}</Text>
            {t.ratesUsed?.rateId ? (
              <Text style={type.small}>
                Base {formatPaise(Math.round(t.ratesUsed.base * 100))} · {formatPaise(Math.round(t.ratesUsed.perKm * 100))}/km · Distance {Number.isFinite(t.route?.distanceKm) ? `${t.route.distanceKm.toFixed(2)} km` : 'awaiting verification'} · Earned {Number.isFinite(t.partnerEarnings) ? formatPaise(Math.round(t.partnerEarnings * 100)) : 'awaiting calculation'}
              </Text>
            ) : <Text style={type.small}>Rate evidence requires reconciliation. No amount is inferred.</Text>}
          </View>
        )) : <Text style={type.small}>No delivery records on this page.</Text>}
      </Card>

      <View style={styles.row}>
        <AppButton small variant="outline" style={styles.flex} title="Previous" disabled={state.loading || page <= 1} onPress={() => setPage((p) => p - 1)} />
        <Text style={[type.body, styles.pageText]}>Page {page} of {state.pages}</Text>
        <AppButton small variant="outline" style={styles.flex} title="Next" disabled={state.loading || page >= state.pages} onPress={() => setPage((p) => p + 1)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  pageText: { textAlign: 'center', minWidth: 110 },
  big: { fontSize: 28, fontWeight: '800', color: colors.orangeDark },
  trip: { paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
});
