import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './AppText';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors, radius, spacing, type } from '../theme';

// Native port of frontend/src/modules/Seller/components/SellerSalesChart.jsx.
// It plots the server's daily `salesPerformance` values as returned; no aggregation.
const chartMoney = (amount) => `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function SalesChart({ data = [] }) {
  const [range, setRange] = useState(30);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(260, screenWidth - spacing.lg * 4);
  const height = 140;

  const points = useMemo(() => data.slice(-range), [data, range]);
  const maximum = Math.max(1, ...points.map((point) => point.revenue));
  const step = (width - 30) / Math.max(1, points.length - 1);
  const x = (index) => 15 + index * step;
  const y = (revenue) => height - 15 - (revenue * (height - 35)) / maximum;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.revenue)}`).join(' ');
  const selected = selectedIndex === null ? null : points[selectedIndex];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>SALES PERFORMANCE</Text>
        <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Sales period">
          {[30, 7].map((days) => (
            <Pressable key={days} accessibilityRole="radio" accessibilityState={{ checked: range === days }}
              onPress={() => { setRange(days); setSelectedIndex(null); }}
              style={[styles.toggleButton, range === days && styles.toggleActive]}>
              <Text style={[styles.toggleText, range === days && styles.toggleTextActive]}>{days} Days</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={type.small} accessibilityLiveRegion="polite">
        {selected
          ? `${new Date(`${selected.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}: ${chartMoney(selected.revenue)}`
          : 'Tap a day to see completed sales'}
      </Text>
      {points.length ? (
        <Svg width={width} height={height}>
          <Line x1="15" y1={height - 15} x2={width - 15} y2={height - 15} stroke={colors.border} />
          <Path d={path} fill="none" stroke={colors.chart} strokeWidth="3" />
          {selected ? (
            <>
              <Line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="10" y2={height - 15} stroke={colors.textSecondary} strokeDasharray="3 3" />
              <Circle cx={x(selectedIndex)} cy={y(selected.revenue)} r="4" fill={colors.white} stroke={colors.chart} strokeWidth="2" />
            </>
          ) : null}
          {points.map((point, index) => (
            <Rect key={point.date} x={x(index) - step / 2} y="0" width={step} height={height} fill="transparent"
              onPress={() => setSelectedIndex(index)} />
          ))}
        </Svg>
      ) : null}
      {!points.length ? <Text style={type.small}>No completed sales data available.</Text> : null}
      {!!points.length && !points.some((point) => point.revenue > 0) ? <Text style={type.small}>No completed sales in this period.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5 },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  toggleButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, minHeight: 32, justifyContent: 'center' },
  toggleActive: { backgroundColor: colors.white },
  toggleText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  toggleTextActive: { color: colors.primaryDark },
});
