import React, { useCallback, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AppButton from '../../components/AppButton';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getAdvertisingCapabilities, listCampaigns } from '../../services/advertising.api';
import { MODULE_LABEL, adMoney, campaignLabel, fmtDateTime } from '../../utils/advertising';
import { colors, radius, spacing, type } from '../../theme';

// Sponsored-category campaigns (AdvertisingWorkspace.jsx). Campaign states, prices and dates come from the server.
export default function AdvertisingScreen({ navigation }) {
  const loader = useCallback(async () => {
    const [capabilities, campaigns] = await Promise.all([getAdvertisingCapabilities(), listCampaigns()]);
    return { capabilities, campaigns };
  }, []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => { if (firstFocus.current) { firstFocus.current = false; return; } refresh(); }, [refresh]));

  if (loading && !data) return <LoadingView message="Loading advertising…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const cap = data?.capabilities || {};

  const header = (
    <View style={styles.header}>
      <Text style={type.small}>Sponsor your products at the top of a category. Bulkimart reviews each campaign before payment; you pay only after approval.</Text>
      {cap.managementEnabled === false ? <InlineNotice tone="warning">Advertising is turned off on the platform right now.</InlineNotice> : null}
      {!cap.paymentsEnabled ? <InlineNotice tone="info">Campaign payments are not available at the moment. You can still create and submit campaigns for review.</InlineNotice> : null}
      <InlineNotice tone="info">Paying for approved campaigns is done on the Bulkimart seller website; in-app payment is not available yet.</InlineNotice>
      <AppButton title="Create campaign" variant="accent" disabled={cap.managementEnabled === false} onPress={() => navigation.navigate('CampaignBuilder', {})} />
    </View>
  );

  return (
    <FlatList
      data={data?.campaigns || []}
      keyExtractor={(c) => String(c.id)}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListEmptyComponent={<EmptyView title="No campaigns yet" message="Campaigns you create appear here with their review, payment and run status." />}
      renderItem={({ item: c }) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CampaignDetail', { id: c.id, title: c.name })} style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.label} numberOfLines={2}>{c.name}</Text>
            <Text style={type.small}>{MODULE_LABEL[c.module] || c.module}{c.category?.name ? ` · ${c.category.name}` : ''} · {c.products?.length || 0} products</Text>
            {c.terms ? <Text style={type.small}>{c.terms.name} · {c.terms.durationDays} days · {adMoney(c.terms.amountPaise)}</Text> : null}
            <Text style={type.small}>{c.paid?.startAt ? `Runs ${fmtDateTime(c.paid.startAt)} → ${fmtDateTime(c.paid.endAt)}` : `Requested start ${fmtDateTime(c.requestedStartAt)}`}</Text>
          </View>
          <Text style={styles.status}>{campaignLabel(c)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  flex: { flex: 1, gap: 2 },
  status: { maxWidth: 120, fontSize: 11, fontWeight: '800', color: colors.primaryDark, textAlign: 'right' },
});
