import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import ChipRow from '../../components/ChipRow';
import Screen from '../../components/Screen';
import UploadProgress from '../../components/UploadProgress';
import { InlineNotice } from '../../components/StateViews';
import useSellerChannel, { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { API_BASE_URL } from '../../config/env';
import { getBulkTemplateLink, uploadBulkProducts } from '../../services/product.api';
import { colors, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/BulkUploadModal.jsx. Same server endpoints and rules:
// backend/controllers/bulkProduct.controller.js.
const MAX_SHEET_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const SHEET = { label: 'product sheet', ext: /\.(xlsx|csv)$/i, types: [types.xlsx, ...types.csv, 'application/octet-stream'], max: MAX_SHEET_BYTES };
const ZIP = { label: 'image ZIP', ext: /\.zip$/i, types: [types.zip, 'application/x-zip-compressed', 'application/octet-stream'], max: MAX_ZIP_BYTES };

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const rowsText = (e) => (e.rows?.length > 1 ? `Rows ${e.rows.join(', ')}` : e.row ? `Row ${e.row}` : '');
const mimeFor = (name) => (/\.csv$/i.test(name) ? 'text/csv' : /\.zip$/i.test(name) ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

async function pickFile(kind) {
  try {
    const [r] = await pick({ type: kind.types, allowMultiSelection: false });
    const name = r.name || '';
    // The server checks the file name, so a file without the right extension would be refused there.
    if (!kind.ext.test(name)) return { error: kind === SHEET ? 'Choose an .xlsx or .csv file (the filled template).' : 'Choose a .zip file with your product photos.' };
    if (r.size && r.size > kind.max) return { error: `The ${kind.label} must be ${sizeText(kind.max)} or smaller.` };
    return { file: { uri: r.uri, name, size: r.size || 0, type: mimeFor(name) } };
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return {};
    return { error: 'Could not open the file picker.' };
  }
}

function Step({ number, title, children }) {
  return (
    <Card>
      <View style={styles.stepHead}>
        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
        <Text style={[type.label, styles.flex]}>{title}</Text>
      </View>
      <View style={styles.stepBody}>{children}</View>
    </Card>
  );
}

export default function BulkUploadScreen({ navigation, route }) {
  const { channels, channel: defaultChannel, isHybrid } = useSellerChannel();
  const [channel, setChannel] = useState(route?.params?.channel || defaultChannel);
  const mode = channel === 'grocery' ? 'quick' : 'ecommerce';

  const [sheet, setSheet] = useState(null);
  const [zip, setZip] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState([]);
  const [result, setResult] = useState(null);

  const downloadTemplate = async () => {
    setError('');
    setLinkBusy(true);
    try {
      const path = await getBulkTemplateLink(mode);
      await Linking.openURL(`${API_BASE_URL}${path}`);
    } catch (e) {
      setError(e.message || 'Could not download the template.');
    } finally { setLinkBusy(false); }
  };

  const choose = async (kind) => {
    setError('');
    const { file, error: pickError } = await pickFile(kind);
    if (pickError) setError(pickError);
    if (file) (kind === SHEET ? setSheet : setZip)(file);
  };

  const upload = async () => {
    if (!sheet) { setError('Choose the filled product sheet first.'); return; }
    setError(''); setRowErrors([]); setResult(null); setProgress(0);
    setBusy(true);
    try {
      const body = await uploadBulkProducts(mode, sheet, zip, setProgress);
      setResult(body);
      setSheet(null); setZip(null);
    } catch (e) {
      setRowErrors(Array.isArray(e.body?.meta?.errors) ? e.body.meta.errors : []);
      setError(e.message || 'Bulk upload failed.');
    } finally { setBusy(false); }
  };

  const startAgain = () => { setResult(null); setError(''); setRowErrors([]); };

  return (
    <Screen>
      {isHybrid ? (
        <ChipRow accessibilityLabel="Storefront" value={channel} onChange={busy ? () => {} : setChannel}
          options={channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
      ) : null}
      <Text style={type.small}>List many {CHANNEL_LABEL[channel] || ''} products at once from an Excel sheet. Easiest on a computer; on the phone, edit the sheet in the Excel or Google Sheets app.</Text>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {rowErrors.length ? (
        <Card title="Fix these rows and upload again">
          <Text style={type.small}>No products were imported.</Text>
          {rowErrors.slice(0, 50).map((e, i) => (
            <Text key={i} style={styles.rowError}>
              <Text style={styles.bold}>{rowsText(e)}{e.name ? ` · ${e.name}` : ''}: </Text>{e.reason}
            </Text>
          ))}
          {rowErrors.length > 50 ? <Text style={type.small}>…and {rowErrors.length - 50} more.</Text> : null}
        </Card>
      ) : null}

      {result ? (
        <Card title={result.failedCount ? 'Import finished with errors' : 'Bulk listing complete'}>
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={[styles.statValue, styles.created]}>{result.successCount}</Text><Text style={type.small}>Created</Text></View>
            {result.failedCount ? <View style={styles.stat}><Text style={[styles.statValue, styles.failed]}>{result.failedCount}</Text><Text style={type.small}>Failed</Text></View> : null}
            <View style={styles.stat}><Text style={styles.statValue}>{result.totalRows}</Text><Text style={type.small}>In sheet</Text></View>
          </View>
          {result.pendingCount ? <InlineNotice tone="info">{result.pendingCount} product{result.pendingCount === 1 ? ' is' : 's are'} in a category that needs admin approval. They go live once approved.</InlineNotice> : null}
          {(result.errors || []).map((e, i) => (
            <Text key={i} style={styles.rowError}><Text style={styles.bold}>{rowsText(e)}{e.name ? ` · ${e.name}` : ''}: </Text>{e.reason}</Text>
          ))}
          <View style={styles.actions}>
            <AppButton title="Upload another" variant="outline" onPress={startAgain} style={styles.flex} />
            <AppButton title="View products" onPress={() => navigation.goBack()} style={styles.flex} />
          </View>
        </Card>
      ) : (
        <>
          <Step number="1" title="Download the template">
            <Text style={type.small}>It has your live categories as drop-downs and one column per category field (e.g. Allergens). It opens in your browser and saves to Downloads.</Text>
            <AppButton title={`Download ${mode === 'quick' ? 'Quick Commerce' : 'Shop All'} template`} variant="outline" loading={linkBusy} onPress={downloadTemplate} />
          </Step>

          <Step number="2" title="Fill one row per product">
            <Text style={type.small}>• Required: Main Category, Product Name, Sell Price, Stock and a Primary Image.</Text>
            <Text style={type.small}>• Variants (500 g / 1 kg, S / M / L): repeat the same Product Name on several rows, one row per variant, each with its own Variant Name, price and stock.</Text>
            <Text style={type.small}>• Teal columns are category fields; fill the ones your category uses. Dark-teal ones are required for some categories.</Text>
            <Text style={type.small}>• Images: type the photo's file name (e.g. amul-milk.jpg) and add the photo to a ZIP, or paste a full https:// image link.</Text>
          </Step>

          <Step number="3" title="Upload the sheet and photos">
            <AppButton title={sheet ? 'Change product sheet' : 'Choose product sheet (.xlsx / .csv)'} variant="outline" disabled={busy} onPress={() => choose(SHEET)} />
            {sheet ? <Text style={styles.picked}>✓ {sheet.name}{sheet.size ? ` (${sizeText(sheet.size)})` : ''}</Text> : null}
            <AppButton title={zip ? 'Change image ZIP' : 'Choose image ZIP (optional)'} variant="outline" disabled={busy} onPress={() => choose(ZIP)} />
            {zip ? (
              <View style={styles.pickedRow}>
                <Text style={[styles.picked, styles.flex]}>✓ {zip.name}{zip.size ? ` (${sizeText(zip.size)})` : ''}</Text>
                <AppButton small variant="outline" title="Remove" disabled={busy} onPress={() => setZip(null)} />
              </View>
            ) : null}
            <Text style={type.small}>Sheet up to 10 MB, ZIP up to 50 MB. If any row has a problem, nothing is imported and the rows to fix are listed.</Text>
            {busy ? <UploadProgress progress={progress} label={progress >= 1 ? 'Creating products' : 'Uploading'} /> : null}
            <AppButton title="Upload & import products" loading={busy} disabled={!sheet} onPress={upload} />
          </Step>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '800' },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: colors.white, fontWeight: '800' },
  stepBody: { gap: spacing.sm, marginTop: spacing.md },
  picked: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowError: { fontSize: 13, color: '#b91c1c', marginTop: spacing.xs },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900', color: colors.text },
  created: { color: colors.primaryDark },
  failed: { color: '#dc2626' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});
