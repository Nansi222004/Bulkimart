import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import AppButton from './AppButton';
import { colors, spacing, type } from '../theme';

// List footer for usePagedSellerOrders: how many orders are loaded, and a button for older ones.
export default function LoadOlderOrders({ paged, note }) {
  if (!paged.hasMore) return null;
  return (
    <View style={styles.footer}>
      <Text style={type.small}>Loaded {paged.list.length} of {paged.total} orders{note ? ` ${note}` : ''}.</Text>
      {paged.moreError ? <Text style={[type.small, styles.error]}>{paged.moreError}</Text> : null}
      <AppButton small variant="outline" title={paged.loadingMore ? 'Loading…' : 'Load older orders'} loading={paged.loadingMore} onPress={paged.loadMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.md },
  error: { color: colors.error },
});
