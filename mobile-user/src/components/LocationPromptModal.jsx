// Port of LocationPromptModal.jsx — choose a delivery location (GPS, typed search or a saved address).
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, KeyboardAvoidingView } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Polyline } from 'react-native-svg';
import { local } from '../lib/storage';
import { rememberLocationChoice } from '../lib/locationState';
import { getCurrentPosition } from '../lib/gps';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { Text, outfit } from './ui';
import { useLaunchSplash } from './storefront/PromotionalSplash';

const Chevron = () => <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Polyline points="9 18 15 12 9 6" /></Svg>;

export default function LocationPromptModal() {
  const { showLocationModal, setShowLocationModal, saveDeliveryLocation, lookupTypedLocation, savedAddresses = [], setDefaultAddress, location, setLocation, setActiveNav } = useUser();
  const launchSplash = useLaunchSplash();
  const theme = useAppTheme();
  const [mode, setMode] = useState('options');
  const [manualLocation, setManualLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const operation = useRef(0), locked = useRef(false), gpsDeadline = useRef(null);
  useEffect(() => {
    if (!showLocationModal) return undefined;
    return () => { clearTimeout(gpsDeadline.current); operation.current++; locked.current = false; setLoading(false); };
  }, [showLocationModal]);

  const visible = Boolean(showLocationModal && !launchSplash);
  const close = () => setShowLocationModal(false);

  const handleAllowAccess = async () => {
    if (locked.current) return;
    setLoading(true);
    locked.current = true;
    const current = ++operation.current;
    gpsDeadline.current = setTimeout(() => {
      if (current !== operation.current) return;
      operation.current++; locked.current = false; setLoading(false); setMode('select');
      setError('Location access did not finish. Enter your location manually or try again.');
      rememberLocationChoice('unavailable');
    }, 20000);
    setError(null);
    let position;
    try { position = await getCurrentPosition({ timeout: 15000 }); }
    catch (err) {
      if (current !== operation.current) return;
      clearTimeout(gpsDeadline.current);
      locked.current = false;
      rememberLocationChoice(err.code === 1 ? 'denied' : 'unavailable');
      setLoading(false);
      const messages = { 1: 'You blocked location access. Allow it, or enter your location manually.', 2: 'Your location could not be determined right now.', 3: 'Finding your location took too long. Please try again.' };
      setError(messages[err.code] || 'Could not read your location.');
      setMode('select');
      return;
    }
    if (current !== operation.current) return;
    clearTimeout(gpsDeadline.current);
    try {
      const res = await saveDeliveryLocation({ lat: Number(position.coords.latitude.toFixed(6)), lng: Number(position.coords.longitude.toFixed(6)), accuracy: Math.round(position.coords.accuracy || 0) || undefined }, 'gps');
      if (current !== operation.current) return;
      setLoading(false); locked.current = false;
      if (!res.ok) { setError(res.message || 'Could not save your location.'); return; }
      local.setItem('locationAsked', 'true');
      setShowLocationModal(false);
    } catch { if (current === operation.current) { setLoading(false); locked.current = false; setError('Could not save your location. Try manual entry.'); } }
  };

  const handleSaveManual = async () => {
    if (locked.current) return;
    const typed = manualLocation.trim();
    if (!typed) { setError('Please enter an area or street name.'); return; }
    if (typed.length < 3) { setError('Type at least 3 characters to search.'); return; }
    setLoading(true); locked.current = true;
    const current = ++operation.current;
    setError(null);
    let res;
    try { res = await lookupTypedLocation(typed); } catch { res = { ok: false, message: 'Could not find this location. Check your connection and retry.' }; }
    if (current !== operation.current) return;
    setLoading(false); locked.current = false;
    if (!res.ok) { setError(res.message || 'We could not find that place. Try a nearby landmark or pincode.'); return; }
    local.setItem('locationAsked', 'true');
    setShowLocationModal(false);
  };

  const handleSelectSavedAddress = async addr => {
    try {
      setLoading(true); setError(null);
      if (setDefaultAddress && addr._id) {
        const result = await setDefaultAddress(addr._id);
        if (!result?.ok) throw new Error('Address could not be selected');
      }
      const label = [addr.placeName || addr.line1, addr.city, addr.pincode].filter(Boolean).join(', ');
      setLocation(label);
      local.setItem('userLocation', label);
      local.setItem('locationAsked', 'true');
      setLoading(false);
      setShowLocationModal(false);
    } catch {
      setLoading(false);
      setError('Could not select the address. Please retry.');
    }
  };
  const handleAddNewAddress = () => { setShowLocationModal(false); setActiveNav('account'); };

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
    <KeyboardAvoidingView behavior="height" style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Dismiss location selection" />
      <View style={styles.card} accessibilityViewIsModal accessibilityLabel="Choose your location">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 28, gap: 16, alignItems: mode === 'options' ? 'center' : 'stretch' }}>
          {mode === 'options' ? <>
            <Pressable onPress={close} style={[styles.closeBtn, { position: 'absolute', right: 14, top: 14 }]} accessibilityRole="button" accessibilityLabel="Dismiss location selection"><Text style={{ color: '#475569' }}>✕</Text></Pressable>
            <View style={[styles.iconContainer, { backgroundColor: theme.primaryLight }]}>
              <Svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={theme.primaryHover} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><Circle cx="12" cy="10" r="3" /></Svg>
            </View>
            <Text style={styles.title}>Choose your delivery location</Text>
            <Text style={styles.description}>Choose a location to check nearby availability and delivery. You can keep browsing without granting GPS access.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.btnCol}>
              <Pressable onPress={handleAllowAccess} disabled={loading} accessibilityRole="button" style={[styles.btnAllow, { backgroundColor: theme.primaryColor, shadowColor: theme.primary }, loading && { opacity: 0.7 }]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="10" /><Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></Svg>
                <Text style={styles.btnAllowText}>{loading ? 'Detecting location…' : 'Allow Location Access'}</Text>
              </Pressable>
              <Pressable onPress={() => { clearTimeout(gpsDeadline.current); operation.current++; locked.current = false; setLoading(false); setMode('select'); setError(null); }} accessibilityRole="button" style={styles.btnManual}>
                <Text style={styles.btnManualText}>Enter Location Manually</Text>
              </Pressable>
            </View>
          </> : <>
            <View style={styles.selectHeader}>
              <Text style={styles.selectTitle}>Select delivery location</Text>
              <Pressable onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2.5} strokeLinecap="round"><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></Svg>
              </Pressable>
            </View>
            <View>
              <View style={styles.searchWrap}>
                <Svg style={{ position: 'absolute', left: 14 }} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round"><Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>
                <TextInput placeholder="Search for area, street name.." placeholderTextColor="#94a3b8" value={manualLocation} autoFocus returnKeyType="search" onSubmitEditing={handleSaveManual}
                  onChangeText={value => { setManualLocation(value); if (error) setError(null); }} style={styles.searchInput} />
                {manualLocation.trim().length > 0 && <Pressable disabled={loading} onPress={handleSaveManual} style={[styles.searchSubmit, { backgroundColor: theme.primaryHover }]}><Text style={styles.searchSubmitText}>{loading ? '...' : 'Search'}</Text></Pressable>}
              </View>
              <Text style={styles.hint}>Type at least 4 characters</Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={{ gap: 10 }}>
              <Pressable style={styles.actionCard} onPress={handleAllowAccess} accessibilityRole="button">
                <View style={[styles.iconCircle, { backgroundColor: theme.primaryLight }]}><Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.primaryHover} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><Circle cx="12" cy="10" r="3" /></Svg></View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionTitle, { color: theme.text }]}>{loading ? 'Detecting location…' : 'Use current location'}</Text>
                  {location && location !== 'Set your location' ? <Text style={styles.actionSub}>({location.length > 28 ? location.slice(0, 28) + '...' : location})</Text> : null}
                </View>
                <Chevron />
              </Pressable>
              <Pressable style={styles.actionCard} onPress={handleAddNewAddress} accessibilityRole="button">
                <View style={[styles.iconCircle, { backgroundColor: theme.primaryLight }]}><Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.primaryHover} strokeWidth={2.5} strokeLinecap="round"><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></Svg></View>
                <View style={{ flex: 1 }}><Text style={[styles.actionTitle, { color: theme.text }]}>Add new address</Text></View>
                <Chevron />
              </Pressable>
            </View>
            <View style={{ gap: 10, marginTop: 6 }}>
              <Text style={styles.savedHeading}>YOUR SAVED ADDRESSES</Text>
              {savedAddresses.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>No saved addresses found. Enter a location above or use current location.</Text></View>
                : savedAddresses.map(addr => {
                  const isSelected = location && location.includes(addr.city || addr.line1 || '');
                  return <Pressable key={addr._id || addr.id} onPress={() => handleSelectSavedAddress(addr)} accessibilityRole="button"
                    style={[styles.addrCard, { borderColor: isSelected ? theme.primaryColor : '#f1f5f9', backgroundColor: isSelected ? theme.primaryLight : '#ffffff' }]}>
                    <View style={styles.addrIcon}><Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Polyline points="9 22 9 12 15 12 15 22" /></Svg></View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.addrName}>{addr.name || 'Home'}</Text>
                        {addr.isDefault && <Text style={styles.defaultBadge}>DEFAULT</Text>}
                      </View>
                      <Text numberOfLines={1} style={styles.addrText}>{[addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(', ')}</Text>
                    </View>
                  </Pressable>;
                })}
            </View>
          </>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#f8fafc', borderRadius: 24, width: '100%', maxWidth: 430, maxHeight: '90%', elevation: 12 },
  iconContainer: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 4 },
  title: { ...outfit(800), fontSize: 22, color: '#1e293b', textAlign: 'center', lineHeight: 26 },
  description: { ...outfit(400), fontSize: 13.5, color: '#64748b', lineHeight: 21, textAlign: 'center' },
  error: { ...outfit(600), fontSize: 12.5, color: '#ef4444', textAlign: 'center' },
  btnCol: { gap: 12, width: '100%', marginTop: 8 },
  btnAllow: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 3, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  btnAllowText: { ...outfit(700), color: '#fff', fontSize: 15 },
  btnManual: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 20, alignItems: 'center' },
  btnManualText: { ...outfit(700), color: '#475569', fontSize: 14.5 },
  selectHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  selectTitle: { ...outfit(800), fontSize: 20, color: '#1e293b' },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  searchWrap: { flexDirection: 'row', alignItems: 'center' },
  searchInput: { ...outfit(400), flex: 1, paddingVertical: 12, paddingLeft: 44, paddingRight: 90, borderRadius: 14, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#fff', fontSize: 14, color: '#1e293b' },
  searchSubmit: { position: 'absolute', right: 8, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  searchSubmitText: { ...outfit(700), color: '#fff', fontSize: 12 },
  hint: { ...outfit(400), fontSize: 11.5, color: '#64748b', marginLeft: 4, marginTop: 6 },
  actionCard: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 1 },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { ...outfit(700), fontSize: 14.5 },
  actionSub: { ...outfit(400), fontSize: 11.5, color: '#64748b', marginTop: 2 },
  savedHeading: { ...outfit(800), fontSize: 11.5, color: '#64748b', letterSpacing: 0.6 },
  empty: { padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  emptyText: { ...outfit(400), fontSize: 12.5, color: '#94a3b8', textAlign: 'center' },
  addrCard: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5 },
  addrIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  addrName: { ...outfit(700), fontSize: 13.5, color: '#1e293b' },
  defaultBadge: { ...outfit(800), fontSize: 9, color: '#fff', backgroundColor: '#ff8500', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5, overflow: 'hidden' },
  addrText: { ...outfit(400), fontSize: 11.5, color: '#64748b', marginTop: 2 },
});
