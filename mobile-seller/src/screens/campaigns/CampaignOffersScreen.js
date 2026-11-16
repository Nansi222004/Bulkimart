import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { decideCampaignOffer, getCampaignOffer, listCampaignOffers } from '../../services/campaigns.api';
import { dateTime, money } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of the web CampaignOffersTab.jsx. Nothing is discounted until the seller accepts (business rule A).
const STATUS = { PENDING: 'Awaiting your decision', ACCEPTED: 'Accepted', REJECTED: 'Declined', CANCELLED: 'Cancelled' };

export default function CampaignOffersScreen() {
  const loader = useCallback(() => listCampaignOffers(), []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState('');

  const open = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setDetail(null); setSelected({}); setRowError('');
    try { setDetail(await getCampaignOffer(id)); } catch (e) { setRowError(e.message || 'Could not load the campaign'); }
  };
  const ids = (status) => (detail?.products || []).filter((p) => p.status === status && selected[String(p.productId)]).map((p) => String(p.productId));
  const act = async (action, productIds) => {
    setBusy(true); setRowError('');
    try {
      const res = await decideCampaignOffer(openId, action, productIds);
      ToastAndroid.show(res?.message || 'Updated', ToastAndroid.SHORT);
      setSelected({});
      setDetail(await getCampaignOffer(openId));
      await refresh();
    } catch (e) { setRowError(e.message || 'Could not update the campaign'); } finally { setBusy(false); }
  };

  if (loading && !data) return <LoadingView message="Loading campaign offers…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  return (
    <FlatList
      data={data || []}
      keyExtractor={(c) => String(c.campaignId)}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListHeaderComponent={<Text style={type.small}>Bulkimart invites your products into sale campaigns. A product sells at the campaign price only after you accept it, and you can withdraw at any time.</Text>}
      ListEmptyComponent={<EmptyView title="No campaign offers yet" message="Campaign invitations for your products appear here." />}
      renderItem={({ item: c }) => {
        const id = String(c.campaignId);
        return (
          <View style={styles.card}>
            <Text style={type.label}>{c.name} · {c.discountValue}% off</Text>
            <Text style={type.small}>{dateTime(c.startAt)} – {dateTime(c.endAt)}</Text>
            <Text style={type.small}>{c.pending} awaiting · {c.accepted} accepted · {c.rejected} declined</Text>
            <AppButton small variant="outline" title={openId === id ? 'Close' : c.pending ? 'Review' : 'View'} onPress={() => open(id)} />
            {openId === id && (
              <View style={styles.detail}>
                {!detail ? <Text style={type.small}>Loading…</Text> : detail.products.map((p) => {
                  const pid = String(p.productId);
                  const actionable = p.status === 'PENDING' || p.status === 'ACCEPTED';
                  return (
                    <Pressable key={String(p.participationId)} disabled={!actionable} accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!selected[pid], disabled: !actionable }}
                      onPress={() => setSelected((s) => ({ ...s, [pid]: !s[pid] }))} style={[styles.row, selected[pid] && styles.rowSelected]}>
                      <Text style={type.body} numberOfLines={1}>{actionable ? (selected[pid] ? '☑ ' : '☐ ') : ''}{p.name || 'Product'}</Text>
                      <Text style={type.small}>{money(p.currentPrice)} → {money(p.dealPrice)} · {STATUS[p.status] || p.status}</Text>
                    </Pressable>
                  );
                })}
                <Text style={type.small}>Your earning on a campaign sale is calculated from the campaign price.</Text>
                {rowError ? <InlineNotice tone="error">{rowError}</InlineNotice> : null}
                <AppButton small title="Accept selected" loading={busy} disabled={busy || !ids('PENDING').length} onPress={() => act('accept', ids('PENDING'))} />
                <AppButton small variant="outline" title="Decline selected" disabled={busy || !ids('PENDING').length} onPress={() => act('reject', ids('PENDING'))} />
                <AppButton small variant="danger" title="Withdraw selected" disabled={busy || !ids('ACCEPTED').length} onPress={() => act('withdraw', ids('ACCEPTED'))} />
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  detail: { gap: spacing.sm, marginTop: spacing.sm },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  rowSelected: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
});
