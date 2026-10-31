// Port of components/finance/OrderInvoices.jsx. Server-built invoices only: amounts are formatted, never computed.
// "Print / Save PDF" sends the same invoice HTML to the Android print dialog (which can save a PDF) — the
// native replacement for the web's window.print().
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Print from 'expo-print';
import { Text } from './ui';

const money = paise => (Number.isSafeInteger(paise) ? `₹${(paise / 100).toFixed(2)}` : '—');
const date = value => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STYLES = `.bm-invoice{font:13px/1.45 system-ui,sans-serif;color:#111;background:#fff;padding:16px;border:1px solid #d6dde3;border-radius:8px;margin-bottom:16px;overflow-wrap:anywhere}
.bm-invoice h2{margin:0 0 4px;font-size:18px}.bm-invoice .bm-meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:#444;font-size:12px}
.bm-invoice .bm-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.bm-invoice .bm-parties strong{display:block;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:.4px}
.bm-invoice table{width:100%;border-collapse:collapse;font-size:12px}
.bm-invoice th,.bm-invoice td{border-bottom:1px solid #e3e8ec;padding:6px 4px;text-align:right;vertical-align:top}
.bm-invoice th:first-child,.bm-invoice td:first-child{text-align:left}.bm-invoice tfoot td{font-weight:700}
.bm-invoice ul{margin:10px 0 0;padding-left:18px;color:#444;font-size:12px}
@media print{.bm-invoice{border:0;page-break-after:always}}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const taxColumnsOf = doc => {
  const gst = Boolean(doc.seller?.gstin), split = doc.gstSplit;
  return !gst ? [] : split === 'cgst_sgst' ? [['CGST', 'cgstPaise'], ['SGST', 'sgstPaise']] : split === 'igst' ? [['IGST', 'igstPaise']] : [['GST', 'gstPaise']];
};

function invoiceHtml(invoice) {
  const doc = invoice.document, gst = Boolean(doc.seller?.gstin), taxColumns = taxColumnsOf(doc);
  const head = `<tr><th>Item</th><th>Qty</th><th>Price</th>${gst ? '<th>Taxable value</th><th>GST %</th>' : ''}${taxColumns.map(([l]) => `<th>${l}</th>`).join('')}<th>Amount</th></tr>`;
  const rows = doc.lines.map(line => `<tr><td>${esc(line.description)}</td><td>${esc(line.qty)}</td><td>${money(line.unitPricePaise)}</td>${gst ? `<td>${money(line.taxableValuePaise)}</td><td>${esc(line.gstRate)}%</td>` : ''}${taxColumns.map(([, k]) => `<td>${money(line[k])}</td>`).join('')}<td>${money(line.grossPaise)}</td></tr>`).join('');
  const foot = `<tr><td colspan="3">Total</td>${gst ? `<td>${money(doc.totals.taxableValuePaise)}</td><td></td>` : ''}${taxColumns.map(([, k]) => `<td>${money(doc.totals[k])}</td>`).join('')}<td>${money(doc.totals.grossPaise)}</td></tr>`;
  return `<article class="bm-invoice"><h2>${esc(doc.title)}</h2><div class="bm-meta"><span>No. ${esc(invoice.invoiceNumber)}</span><span>Date ${date(invoice.issuedAt)}</span><span>Order ${esc(doc.orderNo || doc.orderId)}</span>${doc.deliveredAt ? `<span>Delivered ${date(doc.deliveredAt)}</span>` : ''}</div>
<div class="bm-parties"><div><strong>Sold by</strong>${esc(doc.seller.name)}${doc.seller.storeName && doc.seller.storeName !== doc.seller.name ? ` (${esc(doc.seller.storeName)})` : ''}<br/>${esc(doc.seller.address)}${gst ? `<br/>GSTIN ${esc(doc.seller.gstin)}` : ''}</div><div><strong>Billed to</strong>${esc(doc.customer.name || 'Customer')}<br/>${esc(doc.customer.address)}${doc.placeOfSupply ? `<br/>Place of supply: ${esc(doc.placeOfSupply)}` : ''}</div></div>
<table><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>${doc.totals.discountPaise > 0 ? `<p>Bulkimart discount: −${money(doc.totals.discountPaise)} · You paid ${money(doc.totals.customerPaidPaise)} for these items.</p>` : ''}<ul>${doc.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></article>`;
}

function InvoiceSheet({ invoice }) {
  const doc = invoice.document, gst = Boolean(doc.seller?.gstin), taxColumns = taxColumnsOf(doc);
  const cols = ['Item', 'Qty', 'Price', ...(gst ? ['Taxable value', 'GST %'] : []), ...taxColumns.map(([l]) => l), 'Amount'];
  const line = l => [l.description, String(l.qty), money(l.unitPricePaise), ...(gst ? [money(l.taxableValuePaise), `${l.gstRate}%`] : []), ...taxColumns.map(([, k]) => money(l[k])), money(l.grossPaise)];
  const total = ['Total', '', '', ...(gst ? [money(doc.totals.taxableValuePaise), ''] : []), ...taxColumns.map(([, k]) => money(doc.totals[k])), money(doc.totals.grossPaise)];
  const row = (cells, key, bold) => <View key={key} style={styles.tr}>{cells.map((c, i) => <Text key={i} style={[styles.td, i === 0 ? styles.first : null, bold && { fontWeight: '700' }]}>{c}</Text>)}</View>;
  return <View style={styles.invoice} accessibilityLabel={`${doc.title} ${invoice.invoiceNumber}`}>
    <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }}>{doc.title}</Text>
    <Text style={styles.meta}>No. {invoice.invoiceNumber}   Date {date(invoice.issuedAt)}   Order {doc.orderNo || doc.orderId}{doc.deliveredAt ? `   Delivered ${date(doc.deliveredAt)}` : ''}</Text>
    <View style={{ gap: 12, marginVertical: 12 }}>
      <View><Text style={styles.party}>SOLD BY</Text><Text style={styles.small}>{doc.seller.name}{doc.seller.storeName && doc.seller.storeName !== doc.seller.name ? ` (${doc.seller.storeName})` : ''}{'\n'}{doc.seller.address}{gst ? `\nGSTIN ${doc.seller.gstin}` : ''}</Text></View>
      <View><Text style={styles.party}>BILLED TO</Text><Text style={styles.small}>{doc.customer.name || 'Customer'}{'\n'}{doc.customer.address}{doc.placeOfSupply ? `\nPlace of supply: ${doc.placeOfSupply}` : ''}</Text></View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>{row(cols, 'h', true)}{doc.lines.map((l, i) => row(line(l), i))}{row(total, 't', true)}</View>
    </ScrollView>
    {doc.totals.discountPaise > 0 && <Text style={[styles.small, { marginTop: 8 }]}>Bulkimart discount: −{money(doc.totals.discountPaise)} · You paid {money(doc.totals.customerPaidPaise)} for these items.</Text>}
    {doc.notes.map(note => <Text key={note} style={[styles.small, { color: '#444', marginTop: 4 }]}>{'• '}{note}</Text>)}
  </View>;
}

export default function OrderInvoices({ load, label = 'View invoice', buttonStyle }) {
  const [open, setOpen] = useState(false), [invoices, setInvoices] = useState(null), [error, setError] = useState('');
  const show = async () => {
    setOpen(true); setError('');
    if (invoices) return;
    try { setInvoices(await load()); } catch (e) { setError(e.message || 'Could not load the invoice'); }
  };
  const print = async () => {
    try { await Print.printAsync({ html: `<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>${STYLES}</style></head><body>${invoices.map(invoiceHtml).join('')}</body></html>` }); }
    catch { setError('Could not open the print dialog. Please try again.'); }
  };
  return <>
    <Pressable onPress={show} style={[styles.btn, buttonStyle]} accessibilityRole="button"><Text style={{ fontSize: 12, fontWeight: '700' }}>{label}</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>{invoices?.length > 1 ? `Invoices (${invoices.length} sellers)` : 'Invoice'}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {invoices?.length > 0 && <Pressable onPress={print} style={styles.btn}><Text style={{ fontSize: 12, fontWeight: '700' }}>Print / Save PDF</Text></Pressable>}
              <Pressable onPress={() => setOpen(false)} style={styles.btn}><Text style={{ fontSize: 12, fontWeight: '700' }}>Close</Text></Pressable>
            </View>
          </View>
          <ScrollView>{error ? <Text accessibilityRole="alert">{error}</Text> : !invoices ? <Text>Loading invoice…</Text> : invoices.map(invoice => <InvoiceSheet key={invoice._id || invoice.invoiceNumber} invoice={invoice} />)}</ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  btn: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#fff', alignSelf: 'flex-start' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: '#f8fafc', borderRadius: 12, width: '100%', maxHeight: '90%', padding: 16 },
  invoice: { backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: '#d6dde3', borderRadius: 8, marginBottom: 16 },
  meta: { color: '#444', fontSize: 12 },
  party: { fontSize: 11, color: '#555', letterSpacing: 0.4, fontWeight: '700' },
  small: { fontSize: 13, lineHeight: 19, color: '#111' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e3e8ec' },
  td: { width: 84, paddingVertical: 6, paddingHorizontal: 4, fontSize: 12, textAlign: 'right' },
  first: { width: 150, textAlign: 'left' },
});
