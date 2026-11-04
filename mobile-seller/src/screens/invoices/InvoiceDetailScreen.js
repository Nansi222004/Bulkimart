import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import KeyValueRow from '../../components/KeyValueRow';
import AppButton from '../../components/AppButton';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getOrderInvoice, getInvoicePrintLink } from '../../services/fulfillment.api';
import { API_BASE_URL } from '../../config/env';
import { colors, spacing, type } from '../../theme';

// Native port of InvoiceSheet (frontend/src/components/finance/OrderInvoices.jsx).
// It formats the server-built invoice only and never calculates tax. Amounts are in paise.
const money = (paise) => (Number.isSafeInteger(paise) ? `₹${(paise / 100).toFixed(2)}` : '—');
const date = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// Plain-text copy for the share sheet (WhatsApp, email, …). Same figures as the screen.
const invoiceText = (invoice, doc) => {
  const lines = [
    `${doc.title} ${invoice.invoiceNumber}`,
    `Date: ${date(invoice.issuedAt)} · Order: ${doc.orderNo || doc.orderId}`,
    '',
    `Sold by: ${doc.seller?.name || ''}${doc.seller?.gstin ? ` (GSTIN ${doc.seller.gstin})` : ''}`,
    `Billed to: ${doc.customer?.name || 'Customer'}`,
    ...(doc.placeOfSupply ? [`Place of supply: ${doc.placeOfSupply}`] : []),
    '',
    ...doc.lines.map((line) => `${line.description} — ${line.qty} × ${money(line.unitPricePaise)} = ${money(line.grossPaise)}`),
    '',
    `Total: ${money(doc.totals.grossPaise)}`,
    ...(doc.totals.discountPaise > 0 ? [`Bulkimart discount: −${money(doc.totals.discountPaise)} (customer paid ${money(doc.totals.customerPaidPaise)})`] : []),
    ...(doc.notes?.length ? ['', ...doc.notes.map((note) => `• ${note}`)] : []),
  ];
  return lines.join('\n');
};

export default function InvoiceDetailScreen({ route, navigation }) {
  const { orderId, orderNo } = route.params;
  useEffect(() => { navigation.setOptions({ title: orderNo ? `Invoice · ${orderNo}` : 'Invoice' }); }, [navigation, orderNo]);
  const loader = useCallback(() => getOrderInvoice(orderId), [orderId]);
  const { data: invoice, error, loading, reload } = useApiResource(loader, [loader]);
  const [printing, setPrinting] = useState(false);
  const [actionError, setActionError] = useState('');

  // The app has no print engine: it opens a short-lived printable copy in the
  // phone's browser, whose print screen offers "Save as PDF".
  const printInvoice = async () => {
    setActionError(''); setPrinting(true);
    try {
      const path = await getInvoicePrintLink(orderId);
      await Linking.openURL(`${API_BASE_URL}${path}`);
    } catch (e) {
      setActionError(e?.message || 'Could not open the invoice for printing. Please try again.');
    } finally { setPrinting(false); }
  };
  const shareInvoice = async (doc) => {
    setActionError('');
    try { await Share.share({ title: `${doc.title} ${invoice.invoiceNumber}`, message: invoiceText(invoice, doc) }); }
    catch (e) { setActionError(e?.message || 'Could not open the share options.'); }
  };

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

      <View style={styles.actions}>
        <AppButton title="Print / Save PDF" onPress={printInvoice} loading={printing} style={styles.action} />
        <AppButton title="Share" variant="outline" onPress={() => shareInvoice(doc)} disabled={printing} style={styles.action} />
      </View>
      <Text style={[type.small, styles.muted]}>Print / Save PDF opens the invoice in your browser. Choose Print, then “Save as PDF”.</Text>
      {actionError ? <InlineNotice tone="error">{actionError}</InlineNotice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.sm, gap: 2 },
  muted: { color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
