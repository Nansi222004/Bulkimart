import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getTaxStatement } from '../../services/seller.api';
import { readTaxStatement } from '../../utils/financeRead';
import { monthName, paiseMoneyLocale } from '../../utils/format';
import { spacing, type } from '../../theme';

// Port of SellerTaxStatement.jsx: monthly TCS/TDS that Bulkimart withheld (server amounts in paise).
export default function TaxStatementScreen() {
  const loader = useCallback(async () => readTaxStatement(await getTaxStatement()), []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  if (loading && !data) return <LoadingView message="Loading tax statement…" />;
  if (!data) return <ErrorView message={error || 'Tax statement unavailable'} onRetry={reload} />;

  const months = data.months.filter((row) => row.grossPaise || row.tcsPaise || row.tdsPaise);
  const missing = [!data.gstin && 'GSTIN', !data.pan && 'PAN'].filter(Boolean);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text style={type.small}>
        TCS (GST, {data.tcsRatePercent}% of your sales excluding GST) and TDS (income tax, {data.tdsRatePercent}% of your sales) are deposited with the government in your name. Claim them when you file your GST return and income-tax return.
      </Text>
      {missing.length ? <InlineNotice tone="warning">Add your {missing.join(' and ')} in your profile so the tax is credited to you.</InlineNotice> : null}
      {!months.length ? <Text style={type.small}>No sales recorded in the last 12 months.</Text> : months.map((row) => (
        <Card key={row.month} title={monthName(row.month)}>
          <View style={styles.rows}>
            <KeyValueRow label="Item sales (incl. GST)" value={paiseMoneyLocale(row.grossPaise)} />
            <KeyValueRow label="Taxable value" value={paiseMoneyLocale(row.taxablePaise)} />
            <KeyValueRow label="TCS" value={paiseMoneyLocale(row.tcsPaise)} />
            <KeyValueRow label="TDS" value={paiseMoneyLocale(row.tdsPaise)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ rows: { gap: spacing.xs } });
