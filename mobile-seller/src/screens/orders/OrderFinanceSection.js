import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getOrderFinancialBreakdown } from '../../services/seller.api';
import { readOrderFinance, validProductTax } from '../../utils/financeRead';
import { paiseMoney } from '../../utils/format';
import { colors, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/OrderFinancialBreakdown.jsx + ProductGstBreakdown.jsx.
// The server sends amounts in paise and they are shown as-is. The only arithmetic is the same
// display totals the web shows (sum of a line's allocated discounts; the order-paid fallback total).

const POSTING = { held: 'Earned — on hold until the return window ends', eligible: 'Available to withdraw', reversed: 'Refunded to customer' };
const BUCKET = { held: 'on hold', eligible: 'available', reserved: 'requested for payout', settled: 'paid out' };

function ProductGst({ tax }) {
  if (tax == null) return <Text style={type.small}>Product GST was not recorded for this older order.</Text>;
  if (!validProductTax(tax)) return <Text style={type.small}>Product GST breakdown unavailable.</Text>;
  return (
    <View>
      <KeyValueRow label="Taxable product value (before platform discounts)" value={paiseMoney(tax.taxableValuePaise)} />
      {tax.rates.map((rate) => (
        <KeyValueRow key={`${rate.gstRate}:${rate.gstPriceType}`}
          label={`${rate.gstPriceType === 'inclusive' ? 'Included GST' : 'GST added'} (${rate.gstRate}%)${rate.gstPriceType === 'exclusive' ? ' · included in subtotal' : ''}`}
          value={paiseMoney(rate.gstPaise)} />
      ))}
      {tax.discountPaise > 0 ? <Text style={type.small}>Coupons are funded by Bulkimart; they reduce what you pay.</Text> : null}
    </View>
  );
}

export default function OrderFinanceSection({ orderId }) {
  const loader = useCallback(async () => readOrderFinance(await getOrderFinancialBreakdown(orderId)), [orderId]);
  const { data: record, error, loading, reload } = useApiResource(loader, [loader]);

  return (
    <Card title="Your earnings from this order">
      {error ? (
        <><InlineNotice tone="error">{error}</InlineNotice><AppButton small variant="outline" title="Retry" onPress={reload} /></>
      ) : loading || !record ? (
        <Text style={type.small}>Loading financial records…</Text>
      ) : (
        <View style={styles.gap}>
          <ProductGst tax={record.productTax} />
          {record.merchandise ? (
            <>
              <Text style={type.body}>Status: {POSTING[record.financialPosting] || 'Not added yet — added once the order is delivered and payment is confirmed'}</Text>
              {record.merchandise.lines.map((line) => {
                const discount = Object.values(line.allocatedDiscounts).reduce((sum, value) => sum + (Number.isSafeInteger(value) ? value : 0), 0);
                const funded = record.merchandise.discountFunding === 'platform';
                const rate = line.rule && (line.rule.method === 'fixed' ? `₹${line.rule.value} per item` : `${line.rule.value}%`);
                return (
                  <View key={line.itemId} style={styles.line}>
                    <Text style={type.label}>{line.itemName || 'Product'}{line.qty ? ` × ${line.qty}` : ''}</Text>
                    <KeyValueRow label="Item price" value={paiseMoney(line.grossPaise)} />
                    {discount > 0 ? <Text style={type.small}>Customer discount: {paiseMoney(discount)}{funded ? ' — paid by Bulkimart, not cut from your earnings' : ''}. Customer paid {paiseMoney(line.eligiblePaise)} for this item.</Text> : null}
                    {line.blocker ? <InlineNotice tone="warning">On hold: {line.blocker}. Nothing has been deducted from you.</InlineNotice> : null}
                    {line.rule ? (
                      <>
                        <KeyValueRow label={`Bulkimart commission (${rate})`} value={`−${paiseMoney(line.commissionPaise)}`} />
                        {line.taxPaise > 0 ? <KeyValueRow label="GST on commission" value={`−${paiseMoney(line.taxPaise)}`} /> : null}
                        {line.tcsPaise > 0 ? <KeyValueRow label="TCS withheld (claim in your GST return)" value={`−${paiseMoney(line.tcsPaise)}`} /> : null}
                        {line.tdsPaise > 0 ? <KeyValueRow label="TDS withheld (claim in your income-tax return)" value={`−${paiseMoney(line.tdsPaise)}`} /> : null}
                        <KeyValueRow strong label="You get" value={paiseMoney(line.netPaise)} valueColor={colors.success} />
                      </>
                    ) : <Text style={type.small}>On hold: commission for this item is still being confirmed. Nothing has been deducted from you.</Text>}
                  </View>
                );
              })}
              <OrderPaid record={record} />
            </>
          ) : <Text style={type.small}>This is an older order, so a per-item earnings breakdown is not available. Nothing has been recalculated or deducted.</Text>}
          {record.snapshot ? (
            <Text style={type.small}>
              Courier charge {paiseMoney(record.snapshot.quotedCourierFreight * 100)} · Your share of courier charge {paiseMoney(record.snapshot.vendorFreightShare * 100)} · Shipping service fee {paiseMoney(record.snapshot.serviceFee?.amount * 100)} · Tax on fee {paiseMoney(record.snapshot.serviceFee?.taxAmount * 100)}
            </Text>
          ) : null}
          {record.entries?.length ? (
            <View style={styles.gap}>
              <Text style={type.label}>Transaction history</Text>
              {record.entries.map((entry) => (
                <Text key={entry._id} style={type.small}>
                  {entry.description} · {entry.direction === 'credit' ? '+' : '−'}₹{entry.amount.toFixed(2)} · {BUCKET[entry.bucket] || entry.bucket} · Ref {entry.reference || entry.entryNo}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

// Same as the web: prefer the server's expectedPaise; otherwise show the sum of the server-provided parts.
function OrderPaid({ record }) {
  const c = record.merchandise.components;
  const merchandisePaise = c.merchandisePaise ?? record.merchandise.lines.reduce((sum, line) => sum + line.eligiblePaise, 0);
  const customerDeliveryPaise = (c.deliveryPaise ?? 0) + (c.sellerIncentivePaise ?? 0);
  const tipPaise = c.tipPaise ?? 0;
  const totalPaise = Number.isSafeInteger(record.merchandise.expectedPaise) ? record.merchandise.expectedPaise : merchandisePaise + customerDeliveryPaise + tipPaise;
  return (
    <Text style={type.body}>
      <Text style={styles.bold}>Customer paid for the whole order: {paiseMoney(totalPaise)}</Text>
      {` = items ${paiseMoney(merchandisePaise)} + delivery ${paiseMoney(customerDeliveryPaise)}${tipPaise ? ` + rider tip ${paiseMoney(tipPaise)}` : ''}. Your item earnings above are worked out on the items only.`}
    </Text>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  line: { borderTopWidth: 1, borderTopColor: '#cde9ed', paddingTop: spacing.sm, gap: 2 },
  bold: { fontWeight: '800' },
});
