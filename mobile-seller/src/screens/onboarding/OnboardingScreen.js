import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import SwitchRow from '../../components/SwitchRow';
import DocumentField from '../../components/DocumentField';
import UploadProgress from '../../components/UploadProgress';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import {
  getGstAssistanceCapabilities, startOnboarding, submitAadhaarStep, submitApplication, submitBankStep,
  submitBusinessStep, submitLegalStep,
} from '../../services/onboarding.api';
import { sectionIssues, sellerBankErrors } from '../../utils/onboardingValidation';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Native port of frontend/src/modules/Seller/pages/OnboardingPage.jsx + SellerContext.submitSellerApplication.
 * Shown only for gate 'onboarding' (no seller profile, or status 'none' | 'incomplete').
 * Not reproduced: the web's simulated "Verify Aadhaar" button (a timer with no backend call) and the GPS map pin
 * (a typed address with pincode is accepted by the backend instead).
 */
const SECTIONS = [
  { id: 'channels', title: 'Sales channels' },
  { id: 'identity', title: 'Identity' },
  { id: 'business', title: 'Business profile' },
  { id: 'address', title: 'Store address' },
  { id: 'bank', title: 'Bank details' },
  { id: 'documents', title: 'KYC documents' },
  { id: 'review', title: 'Review & submit' },
];
const CHANNEL_CHOICES = [
  { value: ['ecommerce'], title: 'Shop All (E-Commerce)', hint: 'Ship products across India' },
  { value: ['grocery'], title: 'Quick Commerce', hint: 'Fast local delivery from your store' },
  { value: ['ecommerce', 'grocery'], title: 'Both', hint: 'Sell on both storefronts' },
];
// Server calls, in order. Each section's edits only mark its own call for re-sending.
const STAGES = ['start', 'step1', 'step2', 'step3', 'step4', 'submit'];
const STAGE_LABEL = { start: 'Starting application', step1: 'Business details', step2: 'Aadhaar KYC', step3: 'Bank details', step4: 'Legal documents', submit: 'Submitting for review' };
const SECTION_STAGE = { channels: 'start', identity: 'step2', business: 'step1', address: 'step1', bank: 'step3', documents: 'step4' };

const sameChannels = (a, b) => a.length === b.length && a.every((c) => b.includes(c));

export default function OnboardingScreen() {
  const { seller, identity, refreshSeller, signOut } = useAuth();
  const store = seller?.storeDetails || {};
  const [index, setIndex] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [channels, setChannels] = useState(() => (seller?.salesChannels || []).filter((c) => c === 'ecommerce' || c === 'grocery'));
  const [aadhaarNo, setAadhaarNo] = useState('');
  const [biz, setBiz] = useState({ storeName: store.name || seller?.businessName || '', description: store.description || '', pickupEmail: store.email || identity?.email || '' });
  const [address, setAddress] = useState({ street: store.address || '', landmark: store.landmark || '', district: store.city || '', state: store.state || '', pincode: store.pincode || '' });
  const [bank, setBank] = useState({ holderName: seller?.bankDetails?.holderName || '', bankName: seller?.bankDetails?.bankName || '', accountNumber: '', ifscCode: seller?.bankDetails?.ifsc || '' });
  const [docs, setDocs] = useState({ aadhaarFront: null, aadhaarBack: null, passbook: null, pan: null, businessCert: null });
  const [panNumber, setPanNumber] = useState(seller?.pan || '');
  const [gst, setGst] = useState({ choice: '', gstin: '', consent: false, contactName: '', message: '' });
  const [gstInfo, setGstInfo] = useState({ state: 'idle', fee: null });
  const [done, setDone] = useState({});
  const [running, setRunning] = useState(null);
  const [progress, setProgress] = useState(null);
  const [failure, setFailure] = useState(null);
  const lock = useRef(false);

  const registration = { channels, aadhaarNo, biz, address, bank, docs, panNumber, gst };
  const section = SECTIONS[index];
  const issues = section.id === 'review' ? [] : sectionIssues(section.id, registration);
  const allIssues = useMemo(() => SECTIONS.slice(0, -1).flatMap((s) => sectionIssues(s.id, registration).map((m) => `${s.title}: ${m}`)),
    [channels, aadhaarNo, biz, address, bank, docs, panNumber, gst]); // eslint-disable-line react-hooks/exhaustive-deps

  // Editing a section means its server call must be sent again, and the final submit too.
  const touch = (sectionId) => setDone((d) => ({ ...d, [SECTION_STAGE[sectionId]]: false, submit: false }));
  const edit = (sectionId, setter) => (value) => { touch(sectionId); setter(value); };
  const setDoc = (key, sectionId) => (value) => { touch(sectionId); setDocs((d) => ({ ...d, [key]: value })); };

  // GST assistance fee details (shown, never charged here).
  useEffect(() => {
    if (!['no_gstin', 'assistance', 'without_gstin'].includes(gst.choice) || gstInfo.state !== 'idle') return;
    setGstInfo({ state: 'loading', fee: null });
    getGstAssistanceCapabilities()
      .then((data) => setGstInfo({ state: 'ready', fee: data.fee || null }))
      .catch(() => setGstInfo({ state: 'error', fee: null }));
  }, [gst.choice, gstInfo.state]);

  const next = () => {
    setShowIssues(true);
    if (issues.length) return;
    setShowIssues(false);
    setIndex((i) => Math.min(SECTIONS.length - 1, i + 1));
  };
  const back = () => { setShowIssues(false); setIndex((i) => Math.max(0, i - 1)); };

  const runStage = async (stage) => {
    setProgress(null);
    if (stage === 'start') return startOnboarding(channels);
    if (stage === 'step1') {
      return submitBusinessStep({
        businessName: biz.storeName.trim(),
        businessType: 'proprietorship',
        storeDetails: {
          name: biz.storeName.trim(), description: biz.description, address: address.street.trim(), landmark: address.landmark,
          city: address.district, state: address.state, pincode: address.pincode,
          phone: identity?.phone || '', email: biz.pickupEmail.trim(),
        },
      });
    }
    if (stage === 'step2') return submitAadhaarStep({ aadhaarNumber: aadhaarNo, front: docs.aadhaarFront, back: docs.aadhaarBack }, setProgress);
    if (stage === 'step3') return submitBankStep({ accountNo: bank.accountNumber, ifsc: bank.ifscCode, holderName: bank.holderName.trim(), bankName: bank.bankName.trim(), passbook: docs.passbook }, setProgress);
    if (stage === 'step4') return submitLegalStep({ pan: panNumber.trim(), gst, panCard: docs.pan, tradeLicense: docs.businessCert }, setProgress);
    return submitApplication();
  };

  const submit = async () => {
    if (lock.current) return;
    if (allIssues.length) { Alert.alert('Complete your application', allIssues.slice(0, 6).join('\n')); return; }
    lock.current = true; setFailure(null);
    try {
      for (const stage of STAGES) {
        if (done[stage]) continue;
        setRunning(stage);
        try { await runStage(stage); }
        catch (e) {
          setFailure({ stage, message: e.message || 'Request failed', status: e.status });
          return;
        }
        setDone((d) => ({ ...d, [stage]: true }));
      }
      await refreshSeller(); // The gate moves to the status screen (pending review).
    } finally { lock.current = false; setRunning(null); setProgress(null); }
  };

  const bankErrors = showIssues && section.id === 'bank' ? sellerBankErrors(bank) : {};
  const gstNo = ['no_gstin', 'assistance', 'without_gstin'].includes(gst.choice);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={type.title}>Register your store</Text>
        <Text style={type.small}>Step {index + 1} of {SECTIONS.length} · {section.title}</Text>
        <View style={styles.dots}>{SECTIONS.map((s, i) => <View key={s.id} style={[styles.dot, i <= index && styles.dotOn]} />)}</View>
      </View>

      {section.id === 'channels' ? (
        <Card title="Select your sales channels">
          {CHANNEL_CHOICES.map((c) => {
            const active = sameChannels(channels, c.value);
            return (
              <Pressable key={c.title} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => edit('channels', setChannels)(c.value)}
                style={[styles.choice, active && styles.choiceOn]}>
                <Text style={[type.label, active && styles.on]}>{c.title}</Text>
                <Text style={type.small}>{c.hint}</Text>
              </Pressable>
            );
          })}
          {seller && seller.status !== 'incomplete' ? <Text style={type.small}>Sales channels can only be chosen during initial onboarding.</Text> : null}
        </Card>
      ) : null}

      {section.id === 'identity' ? (
        <Card title="Identity verification">
          <KeyValueRow label="Verified mobile" value={identity?.phone || '—'} />
          <AppInput label="12-digit Aadhaar number" required keyboardType="number-pad" maxLength={12} value={aadhaarNo}
            onChangeText={(t) => edit('identity', setAadhaarNo)(t.replace(/\D/g, ''))} />
          <Text style={type.small}>Upload the front and back of your Aadhaar in the KYC documents step. Bulkimart verifies them during review; the server stores only the last 4 digits.</Text>
        </Card>
      ) : null}

      {section.id === 'business' ? (
        <Card title="Business profile">
          <AppInput label="Store name" required maxLength={160} placeholder="e.g. Sharma Kirana Store" value={biz.storeName}
            onChangeText={(t) => edit('business', setBiz)({ ...biz, storeName: t })} />
          <AppInput label="Store description" multiline maxLength={2000} value={biz.description}
            onChangeText={(t) => edit('business', setBiz)({ ...biz, description: t })} />
        </Card>
      ) : null}

      {section.id === 'address' ? (
        <Card title="Where is your store?">
          <AppInput label="Street address" required maxLength={500} value={address.street} onChangeText={(t) => edit('address', setAddress)({ ...address, street: t })} />
          <AppInput label="Landmark" maxLength={200} value={address.landmark} onChangeText={(t) => edit('address', setAddress)({ ...address, landmark: t })} />
          <AppInput label="City / district" maxLength={100} value={address.district} onChangeText={(t) => edit('address', setAddress)({ ...address, district: t })} />
          <AppInput label="State" maxLength={100} value={address.state} onChangeText={(t) => edit('address', setAddress)({ ...address, state: t })} />
          <AppInput label="Pincode" required keyboardType="number-pad" maxLength={6} value={address.pincode} onChangeText={(t) => edit('address', setAddress)({ ...address, pincode: t.replace(/\D/g, '') })} />
          <AppInput label="Pickup contact email" required keyboardType="email-address" autoCapitalize="none" maxLength={254} placeholder="e.g. store@example.com"
            value={biz.pickupEmail} onChangeText={(t) => edit('address', setBiz)({ ...biz, pickupEmail: t })} />
          <InlineNotice tone="info">Map pinning isn't available in the app yet. Your typed address and pincode are used instead; you can pin the exact location later on the seller website.</InlineNotice>
        </Card>
      ) : null}

      {section.id === 'bank' ? (
        <Card title="Bank details">
          <AppInput label="Account holder name" required maxLength={100} placeholder="Name as in bank passbook" value={bank.holderName} error={bankErrors.holderName}
            onChangeText={(t) => edit('bank', setBank)({ ...bank, holderName: t })} />
          <AppInput label="Bank name" required maxLength={100} placeholder="e.g. HDFC Bank / SBI" value={bank.bankName} error={bankErrors.bankName}
            onChangeText={(t) => edit('bank', setBank)({ ...bank, bankName: t })} />
          <AppInput label="Bank account number" required keyboardType="number-pad" maxLength={18} value={bank.accountNumber} error={bankErrors.accountNumber}
            onChangeText={(t) => edit('bank', setBank)({ ...bank, accountNumber: t.replace(/\D/g, '') })} secureTextEntry={false} />
          <AppInput label="IFSC code" required autoCapitalize="characters" maxLength={11} placeholder="e.g. HDFC0001234" value={bank.ifscCode} error={bankErrors.ifscCode}
            onChangeText={(t) => edit('bank', setBank)({ ...bank, ifscCode: t.toUpperCase() })} />
        </Card>
      ) : null}

      {section.id === 'documents' ? (
        <Card title="Upload KYC documents">
          <DocumentField label="Aadhaar — Front" required value={docs.aadhaarFront} onChange={setDoc('aadhaarFront', 'identity')} />
          <DocumentField label="Aadhaar — Back" required value={docs.aadhaarBack} onChange={setDoc('aadhaarBack', 'identity')} />
          <DocumentField label="Bank passbook / cancelled cheque" required value={docs.passbook} onChange={setDoc('passbook', 'bank')} />
          <AppInput label="PAN number" required autoCapitalize="characters" maxLength={10} placeholder="e.g. ABCPV1234K" value={panNumber}
            onChangeText={(t) => edit('documents', setPanNumber)(t.toUpperCase())} />
          <DocumentField label="PAN card scan" hint="Optional" value={docs.pan} onChange={setDoc('pan', 'documents')} />
          <DocumentField label="Business registration certificate" hint="Optional" value={docs.businessCert} onChange={setDoc('businessCert', 'documents')} />

          <View style={styles.gst}>
            <Text style={type.label}>GST registration · Do you have a GSTIN? *</Text>
            <View style={styles.row}>
              {[['has_gstin', 'Yes'], ['no_gstin', 'No']].map(([value, label]) => {
                const active = value === 'has_gstin' ? gst.choice === 'has_gstin' : gstNo;
                return (
                  <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[styles.pill, active && styles.choiceOn]}
                    onPress={() => edit('documents', setGst)(value === 'has_gstin' ? { ...gst, choice: 'has_gstin', consent: false } : { ...gst, choice: 'no_gstin', gstin: '', consent: false })}>
                    <Text style={[type.label, active && styles.on]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {gst.choice === 'has_gstin' ? (
              <AppInput label="GSTIN" required autoCapitalize="characters" maxLength={15} value={gst.gstin}
                onChangeText={(t) => edit('documents', setGst)({ ...gst, gstin: t.toUpperCase() })} />
            ) : null}
            {gstNo ? (
              <>
                <Text style={type.label}>Would you like Bulkimart to help you apply for GST?</Text>
                <View style={styles.row}>
                  {[['assistance', 'Yes, apply through Bulkimart'], ['without_gstin', 'No, continue without GST']].map(([value, label]) => (
                    <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: gst.choice === value }} style={[styles.pill, styles.flex, gst.choice === value && styles.choiceOn]}
                      onPress={() => edit('documents', setGst)({ ...gst, choice: value, ...(value === 'without_gstin' ? { consent: false } : {}) })}>
                      <Text style={[type.small, gst.choice === value && styles.on]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {gstInfo.state === 'loading' ? <Text style={type.small}>Loading GST assistance details…</Text> : null}
                {gstInfo.state === 'error' ? <InlineNotice tone="warning">We couldn't load GST assistance details. You can still request assistance.</InlineNotice> : null}
              </>
            ) : null}
            {gst.choice === 'assistance' ? (
              <View style={styles.box}>
                <Text style={type.small}>
                  {gstInfo.fee?.amountPaise != null
                    ? `Bulkimart service fee: ₹${(gstInfo.fee.amountPaise / 100).toFixed(2)}. Pay after submitting your seller application, from the GST assistance section on the seller website.`
                    : 'The service fee is shown in the GST assistance section after you submit.'}
                  {' '}This is a request for assistance, not a government GST application or approval. No fee is collected during registration.
                </Text>
                <AppInput label="Contact name" required maxLength={100} value={gst.contactName} onChangeText={(t) => edit('documents', setGst)({ ...gst, contactName: t })} />
                <AppInput label="Message (optional)" multiline maxLength={2000} value={gst.message} onChangeText={(t) => edit('documents', setGst)({ ...gst, message: t })} />
                <SwitchRow label="I request GST registration assistance and consent to Bulkimart using my application details for it" value={gst.consent}
                  onValueChange={(v) => edit('documents', setGst)({ ...gst, consent: v })} />
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {section.id === 'review' ? (
        <Card title="Review & submit">
          <KeyValueRow label="Sales channels" value={channels.map((c) => (c === 'grocery' ? 'Quick Commerce' : 'Shop All')).join(' + ') || '—'} />
          <KeyValueRow label="Store name" value={biz.storeName || '—'} />
          <KeyValueRow label="Address" value={[address.street, address.landmark, address.district, address.state, address.pincode].filter(Boolean).join(', ') || '—'} />
          <KeyValueRow label="Pickup email" value={biz.pickupEmail || '—'} />
          <KeyValueRow label="Aadhaar" value={aadhaarNo ? `XXXX-XXXX-${aadhaarNo.slice(-4)}` : '—'} />
          <KeyValueRow label="Bank" value={bank.bankName ? `${bank.bankName} · ••••${bank.accountNumber.slice(-4)} · ${bank.ifscCode}` : '—'} />
          <KeyValueRow label="PAN" value={panNumber || '—'} />
          <KeyValueRow label="GST" value={gst.choice === 'has_gstin' ? gst.gstin : gst.choice === 'assistance' ? 'Assistance requested' : gst.choice === 'without_gstin' ? 'Continue without GST' : '—'} />
          <KeyValueRow label="Documents" value={Object.values(docs).filter(Boolean).length + ' attached'} />
          {allIssues.length ? <InlineNotice tone="warning">{allIssues.join('\n')}</InlineNotice> : null}

          {running ? <UploadProgress progress={progress} label={STAGE_LABEL[running]} /> : null}
          {failure ? (
            <InlineNotice tone="error">
              {STAGE_LABEL[failure.stage]} failed: {failure.message}
              {failure.status === 401 ? ' Your session expired; sign in again.' : ' Fix the problem if needed and tap Submit again. Steps already saved are not sent again.'}
            </InlineNotice>
          ) : null}
          <AppButton title={failure ? 'Retry submission' : 'Submit application'} variant="accent" loading={!!running} disabled={!!running || allIssues.length > 0} onPress={submit} />
          <Text style={type.small}>Your application is reviewed by Bulkimart. The seller panel opens once it is approved.</Text>
        </Card>
      ) : null}

      {showIssues && issues.length ? <InlineNotice tone="error">{issues.join('\n')}</InlineNotice> : null}

      <View style={styles.nav}>
        {index > 0 ? <AppButton title="Back" variant="outline" onPress={back} disabled={!!running} style={styles.flex} /> : null}
        {section.id !== 'review' ? <AppButton title="Continue" onPress={next} style={styles.flex} /> : null}
      </View>
      <AppButton small variant="ghost" title="Sign out" disabled={!!running} onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  dots: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.primaryDark },
  choice: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  choiceOn: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  on: { color: colors.primaryDark },
  gst: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  pill: { minHeight: 44, paddingHorizontal: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  nav: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
