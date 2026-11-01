import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Card from './Card';
import AppButton from './AppButton';
import { InlineNotice } from './StateViews';
import { getCampaignAnalytics } from '../services/advertising.api';
import { colors, radius, spacing, type } from '../theme';

const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Port of frontend/src/components/advertising/AdvertisingMetrics.jsx (seller view).
// Counts come from the server; the click rate is only clicks ÷ views of those counts.
export default function CampaignMetrics({ campaignId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await getCampaignAnalytics(campaignId)); } catch (e) { setError(e.message || 'Could not load views and clicks'); }
    finally { setLoading(false); }
  }, [campaignId]);
  useEffect(() => { load(); }, [load]);

  const count = (mode, kind) => data?.rows.find((r) => r.mode === mode && r.type === kind)?.count || 0;
  const pilotUsed = count('NON_BILLABLE_PILOT', 'IMPRESSION') || count('NON_BILLABLE_PILOT', 'CLICK');
  const modes = pilotUsed ? ['PAID_CATEGORY', 'NON_BILLABLE_PILOT'] : ['PAID_CATEGORY'];

  return (
    <Card title="Views and clicks">
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {loading && !data ? <Text style={type.small}>Loading…</Text> : null}
      {data ? modes.map((mode) => {
        const views = count(mode, 'IMPRESSION');
        const clicks = count(mode, 'CLICK');
        return (
          <View key={mode} style={styles.block}>
            {modes.length > 1 ? <Text style={type.label}>{mode === 'PAID_CATEGORY' ? 'Paid ad' : 'Free trial run'}</Text> : null}
            <View style={styles.tiles}>
              <Tile value={String(views)} label="Views" />
              <Tile value={String(clicks)} label="Clicks" />
              <Tile value={views ? `${((clicks / views) * 100).toFixed(1)}%` : '—'} label="Click rate" />
            </View>
          </View>
        );
      }) : null}
      {data ? (
        <Text style={type.small}>
          {data.started === false
            ? 'Views and clicks are counted once your campaign starts showing.'
            : `Counted ${day(data.from)} – ${day(data.to)}. A view counts when your product is on screen for at least a second.`}
        </Text>
      ) : null}
      <AppButton small variant="outline" title="Refresh" loading={loading} onPress={load} />
    </Card>
  );
}

function Tile({ value, label }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.value}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  value: { fontSize: 20, fontWeight: '800', color: colors.text },
});
