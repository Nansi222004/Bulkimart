import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, type } from '../../theme';

// Read-only view of what the seller submitted at onboarding (GET /api/sellers/me).
// Data minimisation: the bank account and PAN are masked, and identity/bank document images are never opened from the
// app (the backend stores them at public Cloudinary URLs; see docs/BACKEND_CRITICAL_RISKS.md). Only "on file" is shown.
// Editing is not offered: the only write paths are the onboarding steps, which have no status guard for approved sellers.
const STATUS = { approved: 'Approved', pending: 'Pending review', under_review: 'Under review', rejected: 'Rejected', suspended: 'Suspended', incomplete: 'Registration incomplete' };
const DOC_LABEL = { pan_card: 'PAN card', trade_license: 'Business registration certificate', gstin_cert: 'GST certificate', fssai_cert: 'FSSAI certificate' };
const GST_CHOICE = { has_gstin: 'Has GSTIN', without_gstin: 'Continuing without GST', assistance: 'GST assistance requested' };
const last4 = (value) => (value ? `•••• ${String(value).slice(-4)}` : '—');

export default function KycDetailsScreen() {
  const { seller } = useAuth();
  if (!seller) return null;
  const bank = seller.bankDetails || {};
  const onFile = [
    ['Aadhaar — front', Boolean(seller.aadhaar?.frontUrl)],
    ['Aadhaar — back', Boolean(seller.aadhaar?.backUrl)],
    ['Bank passbook / cancelled cheque', Boolean(bank.passbookUrl)],
    ...(seller.documents || []).map((d) => [`${DOC_LABEL[d.type] || d.type}${d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleDateString('en-IN')}` : ''}`, Boolean(d.url)]),
  ];

  return (
    <Screen>
      <Card title="Verification">
        <KeyValueRow label="Seller status" value={STATUS[seller.status] || seller.status || '—'} />
        {seller.rejectionReason ? <InlineNotice tone="error">Reason: {seller.rejectionReason}</InlineNotice> : null}
        <KeyValueRow label="Aadhaar" value={seller.aadhaar?.number || '—'} />
      </Card>

      <Card title="Payout bank account">
        <KeyValueRow label="Account holder" value={bank.holderName || '—'} />
        <KeyValueRow label="Bank" value={bank.bankName || '—'} />
        <KeyValueRow label="Account number" value={last4(bank.accountNo)} />
        <KeyValueRow label="IFSC" value={bank.ifsc || '—'} />
        {bank.upiId ? <KeyValueRow label="UPI" value="On file" /> : null}
        <Text style={type.small}>Payouts go to this account. To change it, contact Bulkimart support; bank changes are verified by the team.</Text>
      </Card>

      <Card title="Tax details">
        <KeyValueRow label="PAN" value={last4(seller.pan)} />
        <KeyValueRow label="GSTIN" value={seller.gstin || '—'} />
        {seller.gstRegistrationChoice ? <KeyValueRow label="GST registration" value={GST_CHOICE[seller.gstRegistrationChoice] || seller.gstRegistrationChoice} /> : null}
        {seller.fssai ? <KeyValueRow label="FSSAI" value={seller.fssai} /> : null}
      </Card>

      <Card title="Submitted documents">
        {onFile.length ? onFile.map(([label, present], i) => (
          <View key={`${label}-${i}`} style={styles.row}>
            <Text style={[type.body, styles.flex]}>{label}</Text>
            <Text style={[styles.state, !present && styles.missing]}>{present ? 'On file' : 'Missing'}</Text>
          </View>
        )) : <Text style={type.small}>No documents on record.</Text>}
        <Text style={type.small}>Document images are not shown in the app to protect your identity documents.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  flex: { flex: 1 },
  state: { fontSize: 12, fontWeight: '700', color: colors.success },
  missing: { color: colors.error },
});
