import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getOrderInvoice } from '../../services/fulfillment.api';
import { colors, spacing, type } from '../../theme';

// Native port of InvoiceSheet (frontend/src/components/finance/OrderInvoices.jsx).
// It formats the server-built invoice only and never calculates tax. Amounts are in paise.
const money = (paise) => (Number.isSafeInteger(paise) ? `₹${(paise / 100).toFixed(2)}` : '—');
const date = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function InvoiceDetailScreen({ route, navigation }) {
  const { orderId, orderNo } = route.params;
  useEffect(() => { navigation.setOptions({ title: orderNo ? `Invoice · ${orderNo}` : 'Invoice' }); }, [navigation, orderNo]);
  const loader = useCallback(() => getOrderInvoice(orderId), [orderId]);
  const { data: invoice, error, loading, reload } = useApiResource(loader, [loader]);

  if (loading && !invoice) return <LoadingView message="Loading invoice…" />;
  if (!invoice) return <ErrorView message={error || 'Could not load the invoice'} onRetry={reload} />;

  const doc = invoice.document;
  if (!doc || !Array.isArray(doc.lines) || !doc.totals) return <ErrorView message="The invoice is incomplete. Please retry." onRetry={reload} />;
  const gst = Boolean(doc.seller?.gstin);
  const split = doc.gstSplit;
  const taxColumns = !gst ? [] : split === 'cgst_sgst' ? [['CGST', 'cgstPaise'], ['SGST', 'sgstPaise']] : split === 'igst' ? [['IGST', 'igstPaise']] : [['GST', 'gstPaise']];

  return (
    <Screen>
      <Card title={doc.title}>
        <KeyValueRow label="Invoice no." value={invoice.invoiceNumber} />
        <KeyValueRow label="Date" value={date(invoice.issuedAt)} />
        <KeyValueRow label="Order" value={doc.orderNo || doc.orderId} />
        {doc.deliveredAt ? <KeyValueRow label="Delivered" value={date(doc.deliveredAt)} /> : null}
      </Card>

      <Card title="Sold by">
        <Text style={type.body}>{doc.seller?.name}{doc.seller?.storeName && doc.seller.storeName !== doc.seller.name ? ` (${doc.seller.storeName})` : ''}</Text>
        {doc.seller?.address ? <Text style={type.small}>{doc.seller.address}</Text> : null}
        {gst ? <Text style={type.small}>GSTIN {doc.seller.gstin}</Text> : null}
      </Card>

      <Card title="Billed to">
        <Text style={type.body}>{doc.customer?.name || 'Customer'}</Text>
        {doc.customer?.address ? <Text style={type.small}>{doc.customer.address}</Text> : null}
        {doc.placeOfSupply ? <Text style={type.small}>Place of supply: {doc.placeOfSupply}</Text> : null}
      </Card>

      <Card title="Items">
        {doc.lines.map((line, index) => (
          <View key={index} style={styles.line}>
            <Text style={type.label}>{line.description}</Text>
            <KeyValueRow label="Qty × price" value={`${line.qty} × ${money(line.unitPricePaise)}`} />
            {gst ? <KeyValueRow label={`Taxable value (GST ${line.gstRate}%)`} value={money(line.taxableValuePaise)} /> : null}
            {taxColumns.map(([label, key]) => <KeyValueRow key={label} label={label} value={money(line[key])} />)}
            <KeyValueRow strong label="Amount" value={money(line.grossPaise)} />
          </View>
        ))}
      </Card>

      <Card title="Total">
        {gst ? <KeyValueRow label="Taxable value" value={money(doc.totals.taxableValuePaise)} /> : null}
        {taxColumns.map(([label, key]) => <KeyValueRow key={label} label={label} value={money(doc.totals[key])} />)}
        <KeyValueRow strong label="Total" value={money(doc.totals.grossPaise)} />
        {doc.totals.discountPaise > 0 ? <Text style={type.small}>Bulkimart discount: −{money(doc.totals.discountPaise)} · Customer paid {money(doc.totals.customerPaidPaise)} for these items.</Text> : null}
      </Card>

      {doc.notes?.length ? (
        <Card title="Notes">{doc.notes.map((note) => <Text key={note} style={type.small}>• {note}</Text>)}</Card>
      ) : null}

      <InlineNotice tone="info">PDF download and printing are not available in the app yet: the server provides invoice data, not a PDF file. Use the Bulkimart seller website to print or save a PDF.</InlineNotice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.sm, gap: 2 },
  muted: { color: colors.textSecondary },
});
