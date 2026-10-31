// Port of modules/User/pages/ProfilePage.jsx (route /account?section=wallet, sign-in required).
// The menu opens each section in a full-screen panel (web: a slide-over with its own history entry), so the
// Android back button closes the section first. Native replacements:
//  - avatar photo: the photo picker, resized to 256 px and kept on the device like the web's localStorage copy;
//  - "Use Current Location": expo-location + the backend's /api/geo/reverse (same as the web);
//  - wallet top-up: the native Razorpay SDK, verified by the backend's existing verify endpoint;
//  - "Become a Seller / Your Shop": the seller portal is not part of this app, so it opens bulkimart.in/seller.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Polyline, Rect, SvgXml } from 'react-native-svg';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { authHeaders, boundedFetch, request } from '../api/client';
import { WEBSITE_ORIGIN } from '../config';
import { local } from '../lib/storage';
import { useFeedback } from '../lib/feedback';
import { openRazorpayCheckout } from '../lib/razorpay';
import { getCurrentPosition } from '../lib/gps';
import { useTickets } from '../hooks/useTickets';
import useCustomerWallet from '../hooks/useCustomerWallet';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Text } from '../components/ui';
import SelectField from '../components/SelectField';
import TicketDetailModal from '../components/TicketDetailModal';
import LandmarkImagePicker from '../components/LandmarkImagePicker';
import AttachmentUploader from '../components/AttachmentUploader';

const avatarSvg = (bg, fg) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23${bg}"/><circle cx="50" cy="38" r="20" fill="%23${fg}"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%23${fg}"/></svg>`;
const DEFAULT_NEUTRAL_AVATAR = avatarSvg('1e293b', '94a3b8');
const PRESET_AVATARS = [
  { id: 'neutral', name: 'Default Slate', url: avatarSvg('1e293b', '94a3b8') },
  { id: 'aqua', name: 'Bulkimart Aqua', url: avatarSvg('08B9E8', 'ffffff') },
  { id: 'blue', name: 'Sky Blue', url: avatarSvg('0284c7', 'e0f2fe') },
  { id: 'orange', name: 'Sunset Gold', url: avatarSvg('ea580c', 'ffedd5') },
  { id: 'purple', name: 'Royal Purple', url: avatarSvg('7c3aed', 'f3e8ff') },
];
const SVG_PREFIX = 'data:image/svg+xml;utf8,';

function Avatar({ uri, size, style }) {
  const source = uri || DEFAULT_NEUTRAL_AVATAR;
  if (source.startsWith(SVG_PREFIX)) return <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }, style]}><SvgXml xml={decodeURIComponent(source.slice(SVG_PREFIX.length))} width="100%" height="100%" /></View>;
  return <Image source={{ uri: source }} style={[{ width: size, height: size, borderRadius: size / 2 }, style]} contentFit="cover" />;
}
const Icon = ({ size = 20, color, width = 2.2, children }) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>;
const Chevron = ({ color }) => <Icon size={16} width={2.5} color={color}><Polyline points="9 18 15 12 9 6" /></Icon>;

function Input({ label, hint, style, ...props }) {
  return <View style={[{ gap: 6 }, style]}>
    <Text style={styles.inputLabel}>{label}</Text>
    <TextInput placeholderTextColor="#94a3b8" {...props} style={[styles.input, props.editable === false && { backgroundColor: '#f1f5f9', color: '#334155' }, props.multiline && { height: 100, textAlignVertical: 'top' }]} />
    {hint ? <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{hint}</Text> : null}
  </View>;
}

export default function ProfileScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const ui = useFeedback();
  const bottom = useNavPadding(20);
  const { setActiveNav, currentUser, logoutUser, savedAddresses, addAddress, deleteAddress, setSelectedAddressId, selectedAddressId, uploadLandmarkImage, fetchWalletBalance, setWalletBalance } = useUser();
  const primary = theme.primaryColor;
  const submitBtn = { backgroundColor: theme.action, shadowColor: theme.primary };

  const [activeSection, setActiveSection] = useState(() => (params.section === 'wallet' ? 'real-wallet' : null));
  useEffect(() => { if (params.section === 'wallet') setActiveSection('real-wallet'); }, [params.section]);

  const handleDeleteAccount = () => {
    ui.perform('Are you sure you want to delete your account? This action cannot be undone. Active orders or pending obligations will prevent deletion.', async () => {
      try {
        const { ok, body } = await request('/api/users/profile', { method: 'DELETE' });
        if (!ok) throw new Error(body.message || 'Could not delete account. Please try again.');
        ui.notify(body.message || 'Your account has been deleted successfully.', { type: 'success' });
        logoutUser();
      } catch (err) { ui.notify(err.message, { type: 'error' }); }
    });
  };

  // Wallet top-up
  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false);
  const [addMoneyAmount, setAddMoneyAmount] = useState('');
  const [isInitiatingTopup, setIsInitiatingTopup] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [topupAlert, setTopupAlert] = useState(null);
  const topupInFlight = useRef(false);
  const { data: realWalletData, transactions: realWalletTxns, loading: loadingRealWallet, error: realWalletError, refresh: loadRealWalletDetails } = useCustomerWallet({
    active: activeSection === 'real-wallet', userId: currentUser?._id || currentUser?.id, onBalance: setWalletBalance,
  });
  const handleInitiateTopup = async () => {
    if (topupInFlight.current) return;
    const amt = Number(addMoneyAmount);
    if (!Number.isFinite(amt) || amt < 1 || amt > 100000 || Math.abs(amt * 100 - Math.round(amt * 100)) > 0.000001) {
      setTopupError('Enter an amount from ₹1 to ₹1,00,000 with at most two decimal places.');
      return;
    }
    topupInFlight.current = true; setIsInitiatingTopup(true); setTopupError('');
    try {
      const headers = authHeaders(true);
      const res = await boundedFetch('/api/wallet/topup/initiate', { method: 'POST', headers, body: JSON.stringify({ amount: amt }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || 'Could not start wallet payment.');
      const result = await openRazorpayCheckout(body.data, headers);
      setShowAddMoneyModal(false);
      if (result.ok && result.verified) setTopupAlert({ type: 'success', message: `₹${amt} added to your wallet.` });
      else setTopupAlert({ type: 'error', message: result.message || 'Payment has not been confirmed. Check your wallet before trying again.' });
      fetchWalletBalance?.();
      await loadRealWalletDetails();
    } catch (err) { setTopupError(err.message || 'Could not start wallet payment. Please try again.'); } finally { topupInFlight.current = false; setIsInitiatingTopup(false); }
  };
  const [walletRefreshing, setWalletRefreshing] = useState(false);

  // Profile + avatar (kept on this device, like the web's localStorage copy)
  const [profileName, setProfileName] = useState(currentUser?.name || '');
  const [profileEmail, setProfileEmail] = useState(currentUser?.email || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [userAvatar, setUserAvatar] = useState(() => currentUser?.avatar || local.getItem('userAvatar') || '');
  const pickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.mimeType && !asset.mimeType.startsWith('image/')) { setProfileMsg('Please select a valid image file'); return; }
      const context = ImageManipulator.manipulate(asset.uri);
      context.resize({ width: Math.min(256, asset.width || 256) });
      const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
      setUserAvatar(dataUrl); local.setItem('userAvatar', dataUrl);
      if (currentUser) currentUser.avatar = dataUrl;
      setProfileMsg('Profile picture updated successfully!');
    } catch { setProfileMsg('Please select a valid image file'); }
  };
  const selectPresetAvatar = url => {
    setUserAvatar(url); local.setItem('userAvatar', url);
    if (currentUser) currentUser.avatar = url;
    setProfileMsg('Avatar updated successfully!');
  };
  // Same as the web: the profile form is saved on this device only.
  const handleSaveProfile = () => {
    if (!profileName.trim() || !profileEmail.trim()) return;
    setIsSavingProfile(true); setProfileMsg('');
    setTimeout(() => {
      setIsSavingProfile(false);
      setProfileMsg('Profile updated successfully!');
      if (currentUser) { currentUser.name = profileName; currentUser.email = profileEmail; currentUser.avatar = userAvatar; }
      local.setItem('userAvatar', userAvatar);
    }, 800);
  };

  // Addresses
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('Home');
  const [newAddrName, setNewAddrName] = useState('');
  const [newAddrPhone, setNewAddrPhone] = useState('');
  const [newAddrLine1, setNewAddrLine1] = useState('');
  const [newAddrLine2, setNewAddrLine2] = useState('');
  const [newAddrCity, setNewAddrCity] = useState('');
  const [newAddrState, setNewAddrState] = useState('');
  const [newAddrPincode, setNewAddrPincode] = useState('');
  const [newAddrLandmarkImage, setNewAddrLandmarkImage] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const handleUseCurrentLocation = async () => {
    setLocating(true); setLocationError(null);
    let position;
    try { position = await getCurrentPosition({ timeout: 15000 }); }
    catch (err) {
      setLocating(false);
      const messages = { 1: 'You blocked location access. Allow it, or type your address in.', 2: 'Your location could not be determined right now.', 3: 'Finding your location took too long. Please try again.' };
      setLocationError(messages[err.code] || 'Could not read your location.');
      return;
    }
    const lat = Number(position.coords.latitude.toFixed(6)), lng = Number(position.coords.longitude.toFixed(6)), accuracy = Math.round(position.coords.accuracy || 0);
    try {
      const { ok, body } = await request(`/api/geo/reverse?lat=${lat}&lng=${lng}&accuracy=${accuracy}`);
      if (!ok) { setLocationError(body.message || 'Could not look up your address. Please type it in.'); return; }
      const a = body.data || {};
      if (a.address) setNewAddrLine1(a.address);
      if (a.city) setNewAddrCity(a.city);
      if (a.state) setNewAddrState(a.state);
      if (a.pincode) setNewAddrPincode(a.pincode);
    } catch { setLocationError('Could not reach the address service. Please type your address in.'); } finally { setLocating(false); }
  };
  const handleAddAddressSubmit = async () => {
    if (!newAddrName || !newAddrPhone || !newAddrLine1 || !newAddrPincode || !newAddrCity || !newAddrState) { setLocationError('Please fill out all address details'); return; }
    const result = await addAddress({ label: newAddrLabel, name: newAddrName, phone: newAddrPhone, line1: newAddrLine1, line2: newAddrLine2 || '', city: newAddrCity, state: newAddrState, pincode: newAddrPincode, landmarkImage: newAddrLandmarkImage || null });
    if (!result?.ok) { setLocationError(result?.message || 'Could not save address. Please try again.'); return; }
    if (result.addressId) setSelectedAddressId(String(result.addressId));
    setLocationError(''); setIsAddingAddress(false);
    setNewAddrName(''); setNewAddrPhone(''); setNewAddrLine1(''); setNewAddrLine2(''); setNewAddrCity(''); setNewAddrState(''); setNewAddrPincode(''); setNewAddrLandmarkImage('');
  };

  // Support tickets (backend-persisted)
  const { tickets: supportTickets, categories: supportCategories, loading: supportLoading, fetchCategories: fetchSupportCategories, fetchMyTickets: fetchSupportTickets,
    createTicket: createSupportTicket, fetchTicketDetail: fetchSupportTicketDetail, sendMessage: sendSupportMessage, reopenTicket: reopenSupportTicket } = useTickets('customer');
  const [supportCategory, setSupportCategory] = useState('');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDesc, setSupportDesc] = useState('');
  const [supportFiles, setSupportFiles] = useState([]);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportJustCreated, setSupportJustCreated] = useState(null);
  const [openSupportTicket, setOpenSupportTicket] = useState(null);
  const [openSupportMessages, setOpenSupportMessages] = useState([]);
  useEffect(() => { if (activeSection === 'support') { fetchSupportCategories(); fetchSupportTickets(); } }, [activeSection]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSupportSubmit = async () => {
    if (!supportCategory || !supportSubject.trim() || !supportDesc.trim()) { ui.notify('Please choose a category and fill in the subject and description.', { type: 'error' }); return; }
    setSupportSubmitting(true);
    try {
      const t = await createSupportTicket({ category: supportCategory, subject: supportSubject, description: supportDesc }, supportFiles);
      setSupportJustCreated(t);
      setSupportCategory(''); setSupportSubject(''); setSupportDesc(''); setSupportFiles([]);
    } catch (err) { ui.notify(err.message, { type: 'error' }); } finally { setSupportSubmitting(false); }
  };
  const openSupportDetail = async t => {
    try {
      const body = await fetchSupportTicketDetail(t._id);
      setOpenSupportTicket(body.data.ticket); setOpenSupportMessages(body.data.messages);
    } catch (err) { ui.notify(err.message, { type: 'error' }); }
  };
  const refreshSupportDetail = async () => {
    const body = await fetchSupportTicketDetail(openSupportTicket._id);
    setOpenSupportTicket(body.data.ticket); setOpenSupportMessages(body.data.messages);
    fetchSupportTickets();
  };

  // Privacy policy (CMS)
  const [privacyTab, setPrivacyTab] = useState('user-policy');
  const [privacyPolicyData, setPrivacyPolicyData] = useState(null);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);
  const loadPrivacyPolicy = useCallback(async slug => {
    setLoadingPrivacy(true);
    try {
      const { body } = await request(`/api/privacy-policy/${slug}`, { auth: false });
      setPrivacyPolicyData(body.success && body.data ? body.data : null);
    } catch { setPrivacyPolicyData(null); } finally { setLoadingPrivacy(false); }
  }, []);
  useEffect(() => { if (activeSection === 'privacy') loadPrivacyPolicy(privacyTab); }, [activeSection, privacyTab, currentUser, loadPrivacyPolicy]);

  const isSeller = Boolean(currentUser?.sellerId || currentUser?.isSeller || currentUser?.roles?.includes('seller'));

  const menuItems = [
    { id: 'profile', label: 'My Profile', icon: c => <Icon color={c}><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><Circle cx="12" cy="7" r="4" /></Icon>, action: () => setActiveSection('profile') },
    { id: 'real-wallet', label: 'Bulkimart Wallet', icon: c => <Icon color={c}><Rect x="2" y="5" width="20" height="14" rx="2" /><Line x1="2" y1="10" x2="22" y2="10" /></Icon>,
      badge: <Text style={[styles.badge, { backgroundColor: alpha(theme.primary, 0.15), color: theme.actionHover }]}>💰 ₹{realWalletData?.balance?.toFixed(2) ?? '—'}</Text>, action: () => setActiveSection('real-wallet') },
    { id: 'orders', label: 'My Orders', icon: c => <Icon color={c}><Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><Polyline points="3.27 6.96 12 12.01 20.73 6.96" /><Line x1="12" y1="22.08" x2="12" y2="12" /></Icon>, action: () => setActiveNav('orders') },
    { id: 'ebooks', label: 'My E-books', icon: () => <Text style={{ fontSize: 20 }}>📚</Text>, action: () => setActiveNav('ebooks') },
    { id: 'legal-services', label: 'My Legal Service Requests', icon: c => <Text style={{ fontSize: 18, color: c }}>▤</Text>, action: () => setActiveNav('legal-services?view=requests') },
    { id: 'addresses', label: 'My Addresses', icon: c => <Icon color={c}><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><Circle cx="12" cy="10" r="3" /></Icon>, action: () => setActiveSection('addresses') },
    { id: 'become-seller', label: isSeller ? 'Your Shop' : 'Become a Seller', icon: c => <Icon color={c}><Rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><Path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></Icon>,
      badge: isSeller ? null : <Text style={[styles.newBadge, { backgroundColor: theme.action }]}>New</Text>, action: () => Linking.openURL(`${WEBSITE_ORIGIN}/seller`).catch(() => {}) },
    { id: 'support', label: 'Help & Support', icon: c => <Icon color={c}><Circle cx="12" cy="12" r="10" /><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><Line x1="12" y1="17" x2="12.01" y2="17" /></Icon>, action: () => setActiveSection('support') },
    { id: 'privacy', label: 'Privacy Policy', icon: c => <Icon color={c}><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Icon>, action: () => setActiveSection('privacy') },
  ];
  const closeSection = () => { setActiveSection(null); setProfileMsg(''); setSupportJustCreated(null); };
  const SubmitButton = ({ title, onPress, disabled, style }) => <Pressable onPress={onPress} disabled={disabled} style={[styles.submit, submitBtn, disabled && { opacity: 0.7 }, style]}><Text style={{ color: theme.actionText || '#fff', fontSize: 14, fontWeight: '800' }}>{title}</Text></Pressable>;
  const sectionPad = { padding: 20, paddingTop: 24, paddingBottom: 40 + insets.bottom, gap: 20 };

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'profile': return <ScrollView contentContainerStyle={sectionPad} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <Pressable onPress={pickAvatar} accessibilityLabel="Upload custom profile photo">
            <Avatar uri={userAvatar} size={88} style={{ borderWidth: 3, borderColor: primary }} />
            <View style={[styles.camBadge, { backgroundColor: primary }]}><Text style={{ fontSize: 12 }}>📷</Text></View>
          </Pressable>
          <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'center', gap: 10, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: '#64748b' }}>Presets:</Text>
            {PRESET_AVATARS.map(p => <Pressable key={p.id} onPress={() => selectPresetAvatar(p.url)} accessibilityLabel={p.name}
              style={{ width: 28, height: 28, borderRadius: 14, borderWidth: userAvatar === p.url ? 2 : 1, borderColor: userAvatar === p.url ? theme.action : '#cbd5e1', overflow: 'hidden' }}>
              <Avatar uri={p.url} size={userAvatar === p.url ? 24 : 26} />
            </Pressable>)}
          </View>
          <View style={{ marginTop: 10, gap: 4, alignItems: 'center' }}>
            <Text style={styles.mono}>User ID: {currentUser?._id || currentUser?.id || '—'}</Text>
            <Text style={styles.mono}>Account ID: {currentUser?._id || currentUser?.id || '—'}</Text>
          </View>
        </View>
        {profileMsg ? <Text style={styles.success}>{profileMsg}</Text> : null}
        <View style={{ gap: 16 }}>
          <Input label="Full Name" value={profileName} onChangeText={setProfileName} />
          <Input label="Email Address" value={profileEmail} onChangeText={setProfileEmail} keyboardType="email-address" autoCapitalize="none" />
          <Input label="Mobile Contact" value={currentUser?.phone || ''} editable={false} hint="Contact number is linked to your authentication ID and cannot be modified." />
          <SubmitButton title={isSavingProfile ? 'Saving Details...' : 'Save Profile Changes'} onPress={handleSaveProfile} disabled={isSavingProfile} style={{ marginTop: 18 }} />
        </View>
      </ScrollView>;

      case 'real-wallet': return <ScrollView contentContainerStyle={sectionPad}
        refreshControl={<RefreshControl refreshing={walletRefreshing} onRefresh={async () => { setWalletRefreshing(true); await loadRealWalletDetails(); setWalletRefreshing(false); }} colors={[primary]} />}>
        <Text style={{ fontSize: 13 }}>Bulkimart Wallet holds money in rupees for payments and refunds. Parcel refunds sent to your wallet appear here.</Text>
        {realWalletError ? <Text accessibilityRole="alert">{realWalletError} {realWalletData ? 'The balance below was last loaded successfully and may be outdated.' : ''}</Text> : null}
        {loadingRealWallet && !walletRefreshing ? <Text accessibilityLiveRegion="polite">Refreshing wallet…</Text> : null}
        {topupAlert && <View style={[styles.alert, topupAlert.type === 'success' ? { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' } : { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: topupAlert.type === 'success' ? '#15803d' : '#b91c1c' }}>{topupAlert.message}</Text>
          <Pressable onPress={() => setTopupAlert(null)} hitSlop={10} accessibilityLabel="Dismiss"><Text style={{ fontWeight: '700' }}>✕</Text></Pressable>
        </View>}
        <LinearGradient colors={[theme.actionHover, theme.action]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.walletCard}>
          <Text style={{ fontSize: 12, color: '#d7f4fc', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Bulkimart Wallet Balance</Text>
          <Text style={{ fontSize: 36, fontWeight: '900', marginTop: 8, marginBottom: 14, color: '#fff' }}>₹{realWalletData ? realWalletData.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : loadingRealWallet ? '…' : '—'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
            <View style={styles.statusPill}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Status:</Text><Text style={{ textTransform: 'uppercase', color: '#fef08a', fontSize: 12, fontWeight: '700' }}>{realWalletData?.status || 'ACTIVE'}</Text></View>
            <Pressable disabled={isInitiatingTopup} onPress={() => { setShowAddMoneyModal(true); setTopupError(''); setAddMoneyAmount(''); }} style={styles.addMoney}>
              <Text style={{ color: theme.actionHover, fontSize: 13, fontWeight: '800' }}>💳 + Add Money</Text>
            </Pressable>
          </View>
        </LinearGradient>
        <Text style={{ marginTop: 12, fontSize: 16, color: '#0f172a', fontWeight: '800' }}>Recent Wallet Transactions</Text>
        {loadingRealWallet && !realWalletData ? <Text style={{ fontSize: 13, color: '#64748b' }}>Loading wallet transactions...</Text>
          : !realWalletData ? null : realWalletTxns.length === 0 ? <View style={styles.emptyCard}><Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>No wallet transaction history yet.</Text></View>
            : <View style={{ gap: 10 }}>{realWalletTxns.map(tx => {
              const isCredit = tx.direction === 'credit';
              return <View key={tx._id || tx.transactionId} style={styles.txRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#0f172a' }}>{tx.description || tx.type}</Text>
                  <Text style={{ fontSize: 11, color: '#64748b' }}>{tx.createdAt ? new Date(tx.createdAt).toLocaleString('en-IN') : '—'}{tx.referenceId ? ` • Ref: ${tx.referenceId}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '800', color: isCredit ? '#16a34a' : '#ef4444' }}>{isCredit ? '+' : '-'} ₹{Number(tx.amount || 0).toFixed(2)}</Text>
                  {tx.balanceAfter !== undefined && <Text style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Bal: ₹{Number(tx.balanceAfter).toFixed(2)}</Text>}
                </View>
              </View>;
            })}</View>}
      </ScrollView>;

      case 'addresses': return <ScrollView contentContainerStyle={sectionPad} keyboardShouldPersistTaps="handled">
        {!isAddingAddress ? <>
          <Pressable onPress={() => setIsAddingAddress(true)} style={[styles.dashed, { borderColor: theme.action }]}>
            <Icon size={18} width={2.5} color={primary}><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></Icon>
            <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>Add New Delivery Address</Text>
          </Pressable>
          <View style={{ gap: 12 }}>
            {savedAddresses.map(addr => {
              const addrId = addr._id || addr.id;
              const isSelected = String(selectedAddressId) === String(addrId);
              return <View key={addrId} style={[styles.addrCard, { borderWidth: isSelected ? 2 : 1, borderColor: isSelected ? primary : '#e2e8f0' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.addrLabel, { backgroundColor: theme.highlight, color: theme.actionHover }]}>{addr.label || addr.type || 'Home'}</Text>
                  {addr.isDefault && <Text style={{ fontSize: 11, color: theme.actionHover, fontWeight: '800' }}>Default Address</Text>}
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 4, color: '#0f172a' }}>{addr.name}</Text>
                <Text style={{ fontSize: 13, color: '#334155', lineHeight: 19.5 }}>{[addr.line1 || addr.house, addr.line2 || addr.street].filter(Boolean).join(', ')}{'\n'}{addr.city}, {addr.state} - {addr.pincode}{'\n'}📞 Contact: {addr.phone}</Text>
                <View style={{ flexDirection: 'row', gap: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', marginTop: 12, paddingTop: 10 }}>
                  {!isSelected && <Pressable onPress={() => setSelectedAddressId(addrId)} hitSlop={8}><Text style={{ color: primary, fontSize: 12, fontWeight: '800' }}>Set Active</Text></Pressable>}
                  <Pressable hitSlop={8} onPress={() => ui.perform({ title: 'Delete this address?', message: 'Remove this saved address from your account?', confirmLabel: 'Delete', destructive: true }, async () => {
                    const res = await deleteAddress(addrId);
                    if (res && res.ok === false) ui.notify(res.message || 'Failed to delete address');
                    return res;
                  })}><Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '800' }}>Delete</Text></Pressable>
                </View>
              </View>;
            })}
          </View>
        </> : <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {['Home', 'Work', 'Other'].map(lbl => <Pressable key={lbl} onPress={() => setNewAddrLabel(lbl)} style={[styles.typeBtn, newAddrLabel === lbl ? { borderColor: primary, backgroundColor: primary } : null]}>
              <Text style={{ fontWeight: '700', color: newAddrLabel === lbl ? '#fff' : '#0f172a' }}>{lbl}</Text>
            </Pressable>)}
          </View>
          <Pressable onPress={handleUseCurrentLocation} disabled={locating} style={[styles.dashed, { borderColor: theme.action, padding: 12, borderRadius: 10 }]}>
            <Text>📍</Text><Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{locating ? 'Fetching Live Location...' : 'Use Current Location'}</Text>
          </Pressable>
          {locationError ? <Text style={{ fontSize: 11, color: '#ef4444', fontWeight: '600', textAlign: 'center' }}>{locationError}</Text> : null}
          <Input label="Receiver Full Name" value={newAddrName} onChangeText={setNewAddrName} placeholder="e.g. Rahul Sharma" />
          <Input label="Receiver Phone Number" value={newAddrPhone} onChangeText={setNewAddrPhone} placeholder="10-digit number" maxLength={10} keyboardType="phone-pad" />
          <Input label="Flat / House / Block No." value={newAddrLine1} onChangeText={setNewAddrLine1} placeholder="Flat 202, Block B" />
          <Input label="Street / Locality / Landmark" value={newAddrLine2} onChangeText={setNewAddrLine2} placeholder="Vikas Nagar, Sector 12" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Input style={{ flex: 1 }} label="City" value={newAddrCity} onChangeText={setNewAddrCity} placeholder="Lucknow" />
            <Input style={{ flex: 1 }} label="State" value={newAddrState} onChangeText={setNewAddrState} placeholder="Uttar Pradesh" />
          </View>
          <Input label="Pincode / Postal Code" value={newAddrPincode} onChangeText={setNewAddrPincode} placeholder="226022" maxLength={6} keyboardType="number-pad" />
          <View style={{ backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
            <LandmarkImagePicker value={newAddrLandmarkImage} onChange={setNewAddrLandmarkImage} onUpload={uploadLandmarkImage} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
            <SubmitButton title="Save Address" onPress={handleAddAddressSubmit} style={{ flex: 2, marginTop: 0 }} />
            <Pressable onPress={() => setIsAddingAddress(false)} style={styles.cancel}><Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text></Pressable>
          </View>
        </View>}
      </ScrollView>;

      case 'support': return <ScrollView contentContainerStyle={sectionPad} keyboardShouldPersistTaps="handled">
        {supportJustCreated ? <View style={[styles.emptyCard, { paddingVertical: 24, paddingHorizontal: 10, gap: 12, alignItems: 'center' }]}>
          <Text style={{ fontSize: 48 }}>✉️</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center' }}>Ticket Submitted Successfully!</Text>
          <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 19.5, textAlign: 'center' }}>Your support ticket ID is <Text style={{ fontWeight: '700', fontSize: 13 }}>#{supportJustCreated.ticketNumber}</Text>. Our team is reviewing the issue and will alert you shortly.</Text>
          <SubmitButton title="Back to Help" onPress={() => setSupportJustCreated(null)} style={{ marginTop: 12, alignSelf: 'stretch' }} />
        </View> : <>
          <Text style={{ fontSize: 16, color: '#0f172a', fontWeight: '800' }}>Contact Customer Support</Text>
          <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 19.5 }}>Need help with an order, payment, or delivery timing? Open a support ticket and our team will get back within 24 hours.</Text>
          <View style={{ gap: 16 }}>
            <SelectField label="CATEGORY" labelStyle={styles.inputLabel} value={supportCategory} onChange={setSupportCategory} placeholder="Select a category" options={supportCategories.map(c => ({ value: c, label: c }))} />
            <Input label="Query Subject" placeholder="e.g. Wallet balance query" value={supportSubject} onChangeText={setSupportSubject} />
            <Input label="How can we assist you?" placeholder="Explain your problem or questions in details..." value={supportDesc} onChangeText={setSupportDesc} multiline />
            <View style={{ gap: 6 }}>
              <Text style={styles.inputLabel}>Attachments (optional, up to 5)</Text>
              <AttachmentUploader files={supportFiles} maxFiles={5} onAddFiles={selected => setSupportFiles(prev => [...prev, ...selected].slice(0, 5))} onRemoveFile={i => setSupportFiles(prev => prev.filter((_, idx) => idx !== i))} />
            </View>
            <SubmitButton title={supportSubmitting ? 'Submitting…' : 'Submit Support Ticket'} onPress={handleSupportSubmit} disabled={supportSubmitting} />
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 16 }}>
            <Text style={{ marginBottom: 12, fontSize: 14, color: '#0f172a', fontWeight: '800' }}>MY TICKETS</Text>
            {supportLoading ? <Text style={{ fontSize: 12, color: '#64748b' }}>Loading…</Text>
              : supportTickets.length === 0 ? <View style={[styles.emptyCard, { padding: 16, borderRadius: 12 }]}><Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>No tickets yet</Text></View>
                : supportTickets.map(t => <Pressable key={t._id} onPress={() => openSupportDetail(t)} style={styles.ticket}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b' }}>#{t.ticketNumber}</Text>
                    <Text style={[styles.ticketStatus, { backgroundColor: theme.highlight, color: theme.highlightText }]}>{(t.status || '').replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', marginTop: 6, color: '#0f172a' }}>{t.subject}</Text>
                </Pressable>)}
          </View>
        </>}
        {openSupportTicket && <TicketDetailModal ticket={openSupportTicket} messages={openSupportMessages} currentUserId={currentUser?._id} onClose={() => setOpenSupportTicket(null)}
          onReply={async msg => { await sendSupportMessage(openSupportTicket._id, msg); await refreshSupportDetail(); }}
          onReopen={async () => { try { await reopenSupportTicket(openSupportTicket._id); await refreshSupportDetail(); } catch (err) { ui.notify(err.message, { type: 'error' }); } }} />}
      </ScrollView>;

      case 'privacy': {
        const tabs = [{ slug: 'user-policy', label: 'User', icon: '👤' }, { slug: 'seller-policy', label: 'Seller', icon: '🏪' }];
        const currentTab = tabs.some(t => t.slug === privacyTab) ? privacyTab : 'user-policy';
        return <ScrollView contentContainerStyle={[sectionPad, { paddingTop: 20, gap: 16 }]}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {tabs.map(t => {
              const isActive = currentTab === t.slug;
              return <Pressable key={t.slug} onPress={() => setPrivacyTab(t.slug)} accessibilityState={{ selected: isActive }}
                style={[styles.privacyTab, isActive ? { borderWidth: 2, borderColor: theme.action, backgroundColor: theme.highlight } : null]}>
                <Text style={{ fontSize: 16 }}>{t.icon}</Text>
                <Text style={{ fontSize: 12, fontWeight: isActive ? '800' : '600', color: isActive ? theme.actionHover : '#475569' }}>{t.label}</Text>
              </Pressable>;
            })}
          </View>
          {loadingPrivacy ? <View style={styles.policyEmpty}><Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>Loading privacy policy...</Text></View>
            : !privacyPolicyData ? <View style={styles.policyEmpty}><Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>Privacy policy content unavailable for this role.</Text></View>
              : <>
                <View style={styles.policyHead}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <View style={[styles.policyIcon, { backgroundColor: theme.highlight }]}><Icon color={theme.actionHover}><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Icon></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>{privacyPolicyData.roleTitle}</Text>
                      <Text style={{ fontSize: 11, color: '#64748b' }}>Version {privacyPolicyData.version || '1.0.0'} • Updated {new Date(privacyPolicyData.effectiveDate || privacyPolicyData.updatedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  {privacyPolicyData.summary ? <Text style={{ fontSize: 12, lineHeight: 19, color: '#475569' }}>{privacyPolicyData.summary}</Text> : null}
                </View>
                <View style={{ gap: 12 }}>
                  {(privacyPolicyData.sections || []).map((sec, idx) => <View key={sec.id || idx} style={styles.policySection}>
                    <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: '700', marginBottom: 4 }}>{sec.title}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b', lineHeight: 18 }}>{sec.content}</Text>
                    {sec.points?.length > 0 && <View style={{ marginTop: 8, gap: 2 }}>{sec.points.map((pt, i) => <Text key={i} style={{ fontSize: 11.5, color: '#475569', lineHeight: 18.4 }}>{'•  '}{pt}</Text>)}</View>}
                  </View>)}
                </View>
              </>}
        </ScrollView>;
      }
      default: return null;
    }
  };

  const name = currentUser?.name || (currentUser?.phone ? `+91 ${currentUser.phone}` : 'Member');
  return <CustomerPage protectedPage headerColor={theme.secondary} background="#ffffff">
    <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: bottom }} style={{ backgroundColor: theme.primary }}>
      <View style={[styles.appbar, { backgroundColor: theme.secondary }]}>
        <Pressable onPress={() => setActiveNav('home')} accessibilityLabel="Go to Home" style={{ padding: 4 }}><Icon size={24} width={2.5} color="#fff"><Polyline points="15 18 9 12 15 6" /></Icon></Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>Account</Text>
        <View style={{ width: 24 }} />
      </View>
      <LinearGradient colors={[theme.secondary, theme.primary]} style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <Pressable onPress={pickAvatar} accessibilityLabel="Change profile picture">
            <Avatar uri={userAvatar} size={68} style={{ borderWidth: 2, borderColor: '#fff' }} />
            <View style={[styles.editBadge, { backgroundColor: primary }]}><Text style={{ fontSize: 11 }}>✏️</Text></View>
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.2 }}>{name}</Text>
              <Text style={styles.activeBadge}>Active</Text>
            </View>
            {currentUser?.phone ? <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '500' }}>+91 {currentUser.phone}</Text> : null}
            {(currentUser?._id || currentUser?.id) ? <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace', marginTop: 2 }}>ID: {currentUser?._id || currentUser?.id}</Text> : null}
          </View>
        </View>
      </LinearGradient>
      <View style={[styles.menuCard, { backgroundColor: theme.surface || '#fff' }]}>
        {menuItems.map(item => <Pressable key={item.id} onPress={item.action} accessibilityRole="button" style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: '#f8fafc' }]}>
          <View style={styles.menuLeft}>{item.icon('#475569')}<Text style={[styles.menuLabel, { color: theme.textPrimary }]}>{item.label}</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{item.badge}<Chevron color="#94a3b8" /></View>
        </Pressable>)}
        <Pressable onPress={() => ui.perform('Log out?', logoutUser)} accessibilityRole="button" style={[styles.menuRow, styles.logout]}>
          <View style={styles.menuLeft}>
            <Icon width={2.5} color="#dc2626"><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></Icon>
            <Text style={[styles.menuLabel, { color: '#dc2626', fontWeight: '700' }]}>Logout</Text>
          </View>
          <Chevron color="#ef4444" />
        </Pressable>
        <Pressable onPress={handleDeleteAccount} accessibilityRole="button" style={[styles.menuRow, styles.deleteRow]}>
          <View style={styles.menuLeft}>
            <Icon color="#dc2626"><Polyline points="3 6 5 6 21 6" /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><Line x1="10" y1="11" x2="10" y2="17" /><Line x1="14" y1="11" x2="14" y2="17" /></Icon>
            <Text style={[styles.menuLabel, { color: '#dc2626', fontWeight: '700' }]}>Delete Account</Text>
          </View>
          <Chevron color="#dc2626" />
        </Pressable>
      </View>
    </ScrollView>

    <Modal visible={Boolean(activeSection)} animationType="slide" statusBarTranslucent onRequestClose={closeSection}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: '#f8fafc' }} accessibilityViewIsModal accessibilityLabel="Account details">
        <LinearGradient colors={[theme.actionHover, theme.action]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.sectionHead, { paddingTop: 16 + insets.top }]}>
          <Pressable onPress={closeSection} accessibilityLabel="Back" style={{ padding: 4, marginRight: 12 }}><Icon size={24} width={2.5} color="#fff"><Line x1="19" y1="12" x2="5" y2="12" /><Polyline points="12 19 5 12 12 5" /></Icon></Pressable>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#fff', flex: 1 }}>{menuItems.find(item => item.id === activeSection)?.label || 'Detail'}</Text>
        </LinearGradient>
        {renderSectionContent()}
      </KeyboardAvoidingView>
      <Modal visible={showAddMoneyModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => !isInitiatingTopup && setShowAddMoneyModal(false)}>
        <KeyboardAvoidingView behavior="height" style={styles.topupOverlay}>
          <View style={styles.topupBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>💳 Add Money to Wallet</Text>
              <Pressable disabled={isInitiatingTopup} onPress={() => setShowAddMoneyModal(false)} accessibilityLabel="Close add money" hitSlop={10}><Text style={{ fontSize: 20, color: '#64748b' }}>✕</Text></Pressable>
            </View>
            <Text style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16, lineHeight: 17.5 }}>Pay securely with Razorpay to add money to your wallet.</Text>
            {topupError ? <Text style={styles.topupError}>{topupError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {[100, 500, 1000, 2000].map(amt => {
                const on = Number(addMoneyAmount) === amt;
                return <Pressable key={amt} onPress={() => { setAddMoneyAmount(String(amt)); setTopupError(''); }}
                  style={[styles.chip, { borderWidth: on ? 2 : 1, borderColor: on ? theme.action : '#cbd5e1', backgroundColor: on ? '#f0fdf4' : '#fff' }]}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: on ? theme.actionHover : '#0f172a' }}>+₹{amt}</Text>
                </Pressable>;
              })}
            </View>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#334155', marginBottom: 6 }}>Enter Custom Amount (₹)</Text>
            <TextInput value={addMoneyAmount} onChangeText={value => { setAddMoneyAmount(value); setTopupError(''); }} keyboardType="decimal-pad" placeholder="e.g. 750" placeholderTextColor="#94a3b8"
              accessibilityLabel="Enter Custom Amount (₹)" onSubmitEditing={handleInitiateTopup} style={styles.amount} />
            <Pressable onPress={handleInitiateTopup} disabled={isInitiatingTopup} style={[styles.pay, { backgroundColor: theme.action }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>{isInitiatingTopup ? 'Starting payment...' : `Pay ₹${addMoneyAmount || 0}`}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Modal>
  </CustomerPage>;
}

const styles = StyleSheet.create({
  appbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, zIndex: 30 },
  editBadge: { position: 'absolute', bottom: 2, right: 0, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  camBadge: { position: 'absolute', bottom: 4, right: 4, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  activeBadge: { fontSize: 10, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', paddingVertical: 2, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  menuCard: { marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 24, paddingHorizontal: 16, paddingBottom: 30, minHeight: 400 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#f8fafc', borderRadius: 8 },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  menuLabel: { fontSize: 13.5, fontWeight: '600' },
  badge: { fontSize: 11, fontWeight: '800', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 20, overflow: 'hidden' },
  newBadge: { color: '#fff', fontSize: 10, paddingVertical: 1, paddingHorizontal: 6, borderRadius: 10, overflow: 'hidden' },
  logout: { marginTop: 16, marginBottom: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', borderRadius: 14 },
  deleteRow: { marginBottom: 30, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: 'rgba(239,68,68,0.04)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(239,68,68,0.4)', borderRadius: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 16, paddingHorizontal: 20, elevation: 4 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', letterSpacing: 0.2, textTransform: 'uppercase' },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#cbd5e1', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 13.5, color: '#0f172a' },
  submit: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, elevation: 4, shadowOpacity: 0.36, shadowRadius: 9, shadowOffset: { width: 0, height: 10 } },
  mono: { color: '#64748b', fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },
  success: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, padding: 12, color: '#15803d', fontSize: 13, textAlign: 'center', fontWeight: '600', overflow: 'hidden' },
  alert: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  walletCard: { borderRadius: 16, padding: 24, alignItems: 'center', elevation: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 20 },
  addMoney: { backgroundColor: '#fff', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 16, elevation: 2 },
  emptyCard: { padding: 20, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  dashed: { padding: 14, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, backgroundColor: '#f0fdf4', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addrCard: { padding: 16, backgroundColor: '#fff', borderRadius: 14 },
  addrLabel: { fontSize: 11, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: '#BAEAF8', overflow: 'hidden' },
  typeBtn: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center' },
  cancel: { flex: 1, borderRadius: 10, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  ticket: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10 },
  ticketStatus: { fontSize: 11, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
  privacyTab: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', gap: 4 },
  policyEmpty: { backgroundColor: '#fff', padding: 30, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  policyHead: { backgroundColor: '#fff', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  policyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  policySection: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  topupOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  topupBox: { backgroundColor: '#fff', borderRadius: 20, maxWidth: 440, width: '100%', padding: 24 },
  topupError: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#fef2f2', color: '#b91c1c', borderWidth: 1, borderColor: '#fecaca', fontSize: 12.5, fontWeight: '600', marginBottom: 14, overflow: 'hidden' },
  chip: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, alignItems: 'center' },
  amount: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: '#cbd5e1', fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  pay: { width: '100%', padding: 14, borderRadius: 12, alignItems: 'center' },
});
