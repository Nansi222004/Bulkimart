import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, type } from '../../theme';

// Native counterpart of frontend/src/modules/Seller/components/SellerStatusGate.jsx.
// The panel stays locked until the server reports status 'approved'.
const COPY = {
  pending: { title: 'Application submitted', body: 'Your seller application is waiting for review. You will be able to use the seller panel once it is approved.' },
  under_review: { title: 'Application under review', body: 'Our team is reviewing your documents. You will be able to use the seller panel once it is approved.' },
  rejected: { title: 'Application not approved', body: 'Your seller application was not approved.' },
  suspended: { title: 'Account suspended', body: 'Your seller account is suspended. Contact Bulkimart support for help.' },
};

export default function StatusGateScreen() {
  const { seller, retry, signOut } = useAuth();
  const status = seller?.status;
  const copy = COPY[status] || { title: 'Seller status unavailable', body: 'Your seller status could not be confirmed.' };
  const storeName = seller?.storeDetails?.name || seller?.businessName;
  return (
    <View style={styles.wrap}>
      <Text style={type.title}>{copy.title}</Text>
      {storeName ? <Text style={type.heading}>{storeName}</Text> : null}
      <Text style={[type.body, styles.center]}>{copy.body}</Text>
      {seller?.rejectionReason && (status === 'rejected' || status === 'suspended') ? (
        <InlineNotice tone="error">Reason: {seller.rejectionReason}</InlineNotice>
      ) : null}
      <AppButton title="Check status again" onPress={retry} style={styles.button} />
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  center: { lineHeight: 21 },
  button: { marginTop: spacing.lg },
});
