// Port of components/parcels/ParcelDelivery.jsx (ParcelCustomerEntry + ParcelDelivery), route /parcel-delivery.
// Web paths → params: /parcel-delivery[/book] → view=book · /history → view=history · /track/:id → view=track&id=.
// Tracking and history stay live: parcel notifications, a 10 s poll, app foreground and socket reconnect.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Headset, Package, Share2 } from 'lucide-react-native';
import { useSession } from '../context/SessionContext';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { boundedFetch } from '../api/client';
import { openRazorpayCheckout } from '../lib/razorpay';
import { socket } from '../lib/socket';
import { on, EVENTS } from '../lib/events';
import { CustomerPage } from '../components/Shell';
import { Spinner, Text, TextInput } from '../components/ui';
import { ServiceHeading } from '../components/services/LegalServices';
import { newIdempotencyKey } from '../components/services/ServicePayment';
import { parcelBookingEnabled, parcelBookingReady } from '../components/services/ServiceEntries';
import { PBtn, PCard, PSheet, parcelTint, ParcelBookingFlow, ParcelCustomerStatus, ParcelMap, ParcelOrderCard } from '../components/parcels/ParcelUI';
import { bookAgainDraft, parcelCustomerStatus, parcelHeaders, parcelMoney, parcelRequest } from '../components/parcels/parcelLogic';
import { session } from '../lib/storage';

export const PARCEL_CANCEL_REASONS = ['Driver was not allocated', 'Changed my mind', 'My reason is not listed'];

const ID = /^[a-f\d]{24}$/i;
const INTRO = 'Your parcel, collected and delivered by a Bulkimart delivery partner.';

// Opens as its own page like Legal Services: a theme-coloured title bar with Back, no storefront header/search.
function Shell({ children }) {
  const theme = useAppTheme();
  const router = useRouter();
  const { setActiveNav } = useUser();
  const insets = useSafeAreaInsets();
  const { view } = useLocalSearchParams();
  const title = view === 'history' ? 'Delivery History' : view === 'track' ? 'Track Parcel' : 'Send a Parcel';
  const back = () => (router.canGoBack() ? router.back() : setActiveNav('home'));
  return <CustomerPage headerColor={theme.header} nav={false}>
    <View style={[styles.appbar, { backgroundColor: theme.header }]}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={styles.backBtn}><ArrowLeft size={24} color={theme.headerText || '#fff'} /></Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.appbarTitle, { color: theme.headerText || '#fff' }]}>{title}</Text>
    </View>
    {/* scrollsChildToFocus off: tapping the native map moved focus and Android scrolled the page to the top. */}
    <ScrollView keyboardShouldPersistTaps="handled" scrollsChildToFocus={false} style={{ backgroundColor: '#f6f8fb' }} contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 12, paddingBottom: 24 + insets.bottom, flexGrow: 1 }}>
      {children}
    </ScrollView>
  </CustomerPage>;
}

const styles = StyleSheet.create({
  appbar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12 },
  backBtn: { padding: 6 },
  appbarTitle: { flex: 1, fontSize: 18, fontWeight: '800' },
});

export default function ParcelDeliveryScreen() {
  const theme = useAppTheme();
  const sessionState = useSession();
  const { setActiveNav } = useUser();
  if (sessionState.verified) return <ParcelDelivery />;
  return <Shell>
    <ServiceHeading parcel Icon={Package}><Text style={{ color: '#52647b' }}>Book a pickup and delivery for your parcel.</Text></ServiceHeading>
    <PCard style={{ borderTopWidth: 3, borderTopColor: '#ff8500' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Sign in to send a parcel</Text>
      <Text style={{ marginBottom: 12 }}>Sign in to book a parcel or view your private delivery history.</Text>
      {sessionState.loading ? <Spinner /> : <PBtn title="Sign in to Bulkimart" style={{ backgroundColor: theme.action, borderColor: theme.action }} onPress={() => setActiveNav('account')} />}
    </PCard>
  </Shell>;
}

function ParcelDelivery() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const sessionState = useSession();
  const { setActiveNav } = useUser();
  const view = String(params.view || 'book');
  const track = view === 'track' && ID.test(String(params.id || '')) ? String(params.id) : null;
  const history = view === 'history';
  const invalid = !track && !history && view !== 'book';
  const [justBooked, setJustBooked] = useState(false);
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [flags, setFlags] = useState({}), [policy, setPolicy] = useState(null), [addresses, setAddresses] = useState([]), [booking, setBooking] = useState(null);
  const [rows, setRows] = useState([]), [page, setPage] = useState(1), [meta, setMeta] = useState({}), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, refresh] = useState(0);
  const [readError, setReadError] = useState(''), [loadedKey, setLoadedKey] = useState(''), [updatedAt, setUpdatedAt] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false), [cancelChoice, setCancelChoice] = useState(''), [cancelComment, setCancelComment] = useState(''), [cancelResult, setCancelResult] = useState('');
  const lock = useRef(false), paymentKey = useRef(newIdempotencyKey());
  const readKey = `${view}:${track || ''}:${history ? page : 1}`;
  const nav = (nextView, id) => router.push({ pathname: '/parcel-delivery', params: { view: nextView, ...(id ? { id } : {}) } });
  const trackingBusy = useRef(false); trackingBusy.current = busy || checkoutActive;

  useEffect(() => {
    if (!track && !history) return undefined;
    const update = () => { if (!trackingBusy.current && AppState.currentState === 'active') refresh(x => x + 1); };
    const notification = n => { if (n?.event === 'PARCEL_UPDATED' && (history || String(n.metadata?.parcelDeliveryId) === track)) update(); };
    socket.on('notification_new', notification); socket.on('connect', update);
    const appState = AppState.addEventListener('change', s => { if (s === 'active') update(); });
    const offOnline = on(EVENTS.ONLINE, update);
    const timer = setInterval(update, 10000);
    return () => { clearInterval(timer); socket.off('notification_new', notification); socket.off('connect', update); appState.remove(); offOnline(); };
  }, [track, history]);

  useEffect(() => {
    const c = new AbortController();
    setLoading(track || history ? loadedKey !== readKey : true); setReadError(''); setError('');
    if (invalid) { setLoading(false); return () => c.abort(); }
    (async () => {
      if (track || history) {
        const b = await parcelRequest(track ? '/bookings/' + track : '/bookings?page=' + page, { signal: c.signal });
        if (c.signal.aborted) return;
        if (track) {
          if (!b.data) setBooking(null);
          else if (!b.data.details?.pickup || !b.data.details?.dropoff || !b.data.cash || !b.data.refund || !Array.isArray(b.data.history)) throw new Error('Invalid tracking response');
          else setBooking(b.data);
        } else {
          if (!Array.isArray(b.data) || !b.meta) throw new Error('Invalid history response');
          setRows(b.data); setMeta(b.meta);
        }
      } else {
        const f = await parcelRequest('/capabilities', { signal: c.signal });
        if (c.signal.aborted) return;
        if (typeof f.data?.catalogue !== 'boolean') throw new Error('Unable to check parcel availability. Please try again.');
        setFlags(f.data); setPolicy(null);
        const p = parcelBookingEnabled(f.data) ? await parcelRequest('/catalogue', { signal: c.signal }) : null;
        if (c.signal.aborted) return;
        setPolicy(p?.data && Array.isArray(p.data.areas) && Array.isArray(p.data.categories) && Array.isArray(p.data.prohibitedItems) ? p.data : null);
      }
      setLoadedKey(readKey); if (track || history) setUpdatedAt(new Date());
    })().catch(e => { if (!c.signal.aborted && e.name !== 'AbortError') setReadError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [readKey, invalid, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = new AbortController();
    boundedFetch('/api/users/addresses', { headers: parcelHeaders(), signal: c.signal }).then(r => r.json()).then(b => { if (!c.signal.aborted) setAddresses(Array.isArray(b.data) ? b.data : []); }).catch(() => {});
    return () => c.abort();
  }, []);

  const run = async fn => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); lock.current = false; } };
  const payOnline = b => run(async () => {
    setCheckoutActive(true);
    try {
      const c = await parcelRequest(`/bookings/${b._id}/payment`, { method: 'POST', headers: { 'Idempotency-Key': paymentKey.current }, body: JSON.stringify({ policyVersion: b.policyVersion, acceptTerms: true }) });
      const result = await openRazorpayCheckout(c.data, parcelHeaders());
      if (result.ok) { setJustBooked(b._id); setBooking(previous => (previous?._id === b._id ? { ...previous, paymentStatus: 'paid', status: result.bookingStatus || 'searching_for_driver' } : previous)); }
      setNotice(result.ok ? 'Payment successful. We’re arranging your pickup.' : result.cancelled ? 'Payment was not completed. You can continue when you’re ready.' : result.message);
      refresh(x => x + 1);
    } finally { setCheckoutActive(false); }
  });
  const action = (suffix, data) => run(async () => { await parcelRequest(`/bookings/${track}/${suffix}`, { method: 'POST', body: JSON.stringify(data) }); refresh(x => x + 1); });
  // Cancel Trip: before a partner accepts this cancels at once; afterwards our team reviews it.
  const submitCancel = () => run(async () => {
    const comment = cancelComment.trim();
    const reason = cancelChoice === 'My reason is not listed' ? (comment || cancelChoice) : cancelChoice + (comment ? ': ' + comment : '');
    const r = await parcelRequest(`/bookings/${track}/cancellation`, { method: 'POST', body: JSON.stringify({ version: booking.version, reason: reason.slice(0, 500) }) });
    setCancelOpen(false); setCancelChoice(''); setCancelComment('');
    if (r.data) setBooking(previous => (previous?._id === r.data._id ? { ...previous, ...r.data } : previous));
    setCancelResult(r.data?.status === 'cancelled' ? 'cancelled' : 'review'); refresh(x => x + 1);
  });
  const bookAgain = b => { bookAgainDraft(session, sessionState?.profile?._id, b); nav('book'); };
  const shareTrip = b => Share.share({ message: `Parcel ${b.reference}: ${parcelCustomerStatus(b.status)}` }).catch(() => {});
  const sendBoost = body => parcelRequest(`/bookings/${track}/boost`, { method: 'POST', body: JSON.stringify(body) });
  const topUpAndBoost = (rupees, body) => run(async () => {
    const headers = parcelHeaders();
    const res = await boundedFetch('/api/wallet/topup/initiate', { method: 'POST', headers, body: JSON.stringify({ amount: rupees }) });
    const topup = await res.json().catch(() => ({}));
    if (!res.ok || !topup.success) throw new Error(topup.message || 'Could not start wallet payment.');
    const result = await openRazorpayCheckout(topup.data, headers);
    if (!(result.ok && result.verified)) { setNotice(result.cancelled ? 'Wallet top-up was not completed. The fare was not changed.' : result.message || 'Payment has not been confirmed yet. Check your wallet, then try adding to the fare again.'); return; }
    await sendBoost(body);
    setNotice(`₹${rupees} added to your wallet and the fare was raised by ${parcelMoney(body.amountPaise)}.`);
    refresh(x => x + 1);
  });
  const boostFare = amountPaise => {
    const wallet = booking.boost?.funding === 'wallet';
    const body = { amountPaise, version: booking.version, key: newIdempotencyKey() };
    Alert.alert('Add to the fare?', `Add ${parcelMoney(amountPaise)}? Your new fare will be ${parcelMoney(booking.feePaise + amountPaise)}. ${wallet ? `The extra ${parcelMoney(amountPaise)} is paid from your Bulkimart wallet.` : 'The full fare is paid in cash.'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add ' + parcelMoney(amountPaise), onPress: () => run(async () => {
        try { await sendBoost(body); }
        catch (e) {
          if (e.meta?.code !== 'WALLET_BALANCE_SHORT') throw e;
          const rupees = Math.max(1, Math.ceil((e.meta.shortPaise || amountPaise) / 100));
          Alert.alert('Not enough wallet balance', `Your wallet has ${parcelMoney(e.meta.balancePaise)}. Add ₹${rupees} to your wallet to raise the fare?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: `Add ₹${rupees}`, onPress: () => topUpAndBoost(rupees, body) },
          ]);
          return;
        }
        refresh(x => x + 1);
      }) },
    ]);
  };
  const retryRead =<PBtn title="Retry" disabled={loading} onPress={() => refresh(x => x + 1)} style={{ alignSelf: 'flex-start' }} />;
  const navBar = (showBook = true, showRefresh = false) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, marginBottom: 20 }} accessibilityLabel="Parcel navigation">
    {showBook && <PBtn variant={!history ? 'tab-on' : 'tab'} title="New booking" onPress={() => nav('book')} />}
    <PBtn variant={history ? 'tab-on' : 'tab'} title="Delivery history" onPress={() => nav('history')} />
    {showRefresh && <PBtn variant="tab" title="Refresh status" disabled={busy} onPress={() => refresh(x => x + 1)} style={{ marginLeft: 'auto' }} />}
  </View>;
  const heading = <ServiceHeading parcel Icon={Package}><Text style={{ color: '#52647b', lineHeight: 22 }}>{INTRO}</Text></ServiceHeading>;
  const shell = content => <Shell>{heading}{navBar()}{content}</Shell>;
  const historyRow = b => <ParcelOrderCard key={b._id} booking={b} onOpen={() => nav('track', b._id)} onBookAgain={['delivered', 'cancelled'].includes(b.status) ? () => bookAgain(b) : undefined} />;

  if (checkoutActive) return <Shell><PCard style={{ alignItems: 'center', gap: 8 }}>
    <Spinner size="large" />
    <Text style={{ fontSize: 21, fontWeight: '700' }}>Complete your payment</Text>
    <Text style={{ fontWeight: '700', fontSize: 18 }}>{parcelMoney(booking?.feePaise)}</Text>
    <Text>Opening secure Razorpay checkout…</Text>
    <Text style={{ fontSize: 12.5, color: '#52647b', textAlign: 'center' }}>Your booking will be confirmed after payment is verified. Keep this page open.</Text>
  </PCard></Shell>;
  if (invalid) return shell(<PCard><Text style={{ fontSize: 21, fontWeight: '700' }}>Invalid parcel link</Text><Text>The tracking identifier or parcel page is invalid. Open a delivery from your history.</Text></PCard>);
  if (loading || (loadedKey !== readKey && !readError)) return shell(<Text>{track ? 'Loading parcel tracking…' : history ? 'Loading parcel history…' : 'Loading parcel delivery…'}</Text>);
  if (readError) return shell(<PCard>
    <Text style={{ fontSize: 21, fontWeight: '700' }}>{track ? 'Unable to load parcel tracking' : history ? 'Unable to load parcel history' : 'Unable to load parcel delivery'}</Text>
    <Text accessibilityRole="alert" style={{ color: '#9c243a', backgroundColor: '#fff0f1', padding: 14, borderRadius: 8, marginVertical: 8 }}>{readError}</Text>
    {retryRead}
    {history && loadedKey === readKey && rows.length > 0 && <><Text style={{ marginVertical: 8 }}>Previously loaded deliveries. Refresh failed; statuses may be outdated.</Text>{rows.map(historyRow)}</>}
  </PCard>);
  if (track && !booking) return shell(<PCard><Text style={{ fontSize: 21, fontWeight: '700' }}>Parcel tracking unavailable</Text><Text style={{ marginVertical: 8 }}>This booking is unavailable or could not be found for your account.</Text>{retryRead}</PCard>);

  const bookingReady = parcelBookingReady(flags, policy);
  return <Shell>
    {(track || history || !bookingReady) && heading}
    {(track || history || !bookingReady) && navBar(Boolean(track || history), Boolean(track || history))}
    {(track || history) && updatedAt ? <Text style={{ fontSize: 12.5, color: '#146447', marginBottom: 6 }}>● Live · updated {updatedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: '#9c243a', backgroundColor: '#fff0f1', padding: 14, borderRadius: 8 }}>{error}</Text> : null}
    {notice ? <Text style={{ marginVertical: 6 }}>{notice}</Text> : null}
    {!track && !history && !bookingReady ? <PCard style={{ borderTopWidth: 3, borderTopColor: '#ff8500' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Parcel booking is currently unavailable</Text>
      <Text>We’re not accepting new parcel deliveries right now. Please check back later.</Text>
      <Text style={{ marginVertical: 8 }}>You can still view and track your existing deliveries from Delivery history.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <PBtn title="Check availability" onPress={() => refresh(x => x + 1)} />
        <PBtn title="Back to shopping" style={{ backgroundColor: theme.action, borderColor: theme.action }} onPress={() => setActiveNav('home')} />
      </View>
    </PCard>
      : track && booking ? <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', flex: 1 }} numberOfLines={1}>Trip {booking.reference}</Text>
          <PBtn variant="outline" accessibilityLabel="Share trip" onPress={() => shareTrip(booking)} style={{ minHeight: 36, paddingVertical: 6, borderColor: theme.action }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Share2 size={16} color={theme.action} /><Text style={{ color: theme.action, fontWeight: '700' }}>Share</Text></View></PBtn>
        </View>
        <ParcelMap pickup={booking.details.pickup} dropoff={booking.details.dropoff} route={booking.route} />
        <ParcelCustomerStatus booking={booking} justBooked={justBooked === track} onWallet={() => router.push('/account?section=wallet')} />
        {booking.paymentMethod === 'online' && ['payment_pending', 'payment_failed'].includes(booking.status) && <PCard>
          <Text style={{ marginBottom: 8 }}>{busy ? 'Opening secure Razorpay checkout…' : 'Complete your payment securely with Razorpay.'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PBtn disabled={busy} title={busy ? 'Payment in progress…' : 'Pay ' + parcelMoney(booking.feePaise) + ' online'} onPress={() => payOnline(booking)} />
            <PBtn disabled={busy} title="Check payment status" onPress={() => action('payment-status', {})} />
          </View>
        </PCard>}
        {booking.boost?.allowed && <PCard style={{ borderColor: '#f5c56b', backgroundColor: '#fffaf0' }}>
          <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: 4 }}>No partner yet? Add to the fare</Text>
          <Text style={{ marginBottom: 8 }}>A higher fare is sent to nearby delivery partners straight away, so someone accepts sooner.{booking.boost.boostedPaise > 0 ? ` You've added ${parcelMoney(booking.boost.boostedPaise)} so far.` : ''}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {booking.boost.options.map(a => <PBtn key={a} disabled={busy} title={'+' + parcelMoney(a)} onPress={() => boostFare(a)} />)}
          </View>
          {booking.boost.funding === 'wallet' && <Text style={{ fontSize: 12.5, color: '#52647b', marginTop: 8 }}>You've already paid online, so the extra amount comes from your Bulkimart wallet. It's included in any refund you're due on this booking.</Text>}
        </PCard>}
        {['picked_up', 'in_transit', 'arrived_at_dropoff'].includes(booking.status) && !booking.canCancel && <PCard><Text>Your parcel has been picked up, so this booking can no longer be cancelled.</Text></PCard>}
        <PCard style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Headset size={20} color="#41526a" /><Text style={{ flex: 1, fontWeight: '700' }}>Facing issues?</Text>
          <Pressable onPress={() => router.push('/support')} accessibilityRole="link" hitSlop={8}><Text style={{ color: theme.action, fontWeight: '700' }}>Contact Support</Text></Pressable>
        </PCard>
        {booking.canCancel && <Pressable onPress={() => setCancelOpen(true)} disabled={busy} accessibilityRole="button" style={{ alignSelf: 'center', padding: 12, marginBottom: 8 }}><Text style={{ color: '#b0233c', fontWeight: '700' }}>Cancel Trip</Text></Pressable>}
        {cancelOpen && <PSheet label="Cancel trip" onClose={() => { if (!busy) setCancelOpen(false); }} footer={<View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <PBtn variant="outline" title="Go Back" disabled={busy} onPress={() => setCancelOpen(false)} style={{ flex: 1, borderColor: theme.action }} />
          <PBtn title={busy ? 'Please wait…' : 'Submit'} disabled={busy || !cancelChoice || (cancelChoice === 'My reason is not listed' && !cancelComment.trim())} onPress={submitCancel} style={{ flex: 1 }} />
        </View>}>
          <Text style={{ fontSize: 17, fontWeight: '800', marginBottom: 8 }}>Please choose a reason for cancellation</Text>
          {error ? <Text accessibilityRole="alert" style={{ color: '#9c243a', backgroundColor: '#fff0f1', padding: 12, borderRadius: 8, marginBottom: 8 }}>{error}</Text> : null}
          {PARCEL_CANCEL_REASONS.map(r => <Pressable key={r} onPress={() => setCancelChoice(r)} accessibilityRole="radio" accessibilityState={{ selected: cancelChoice === r }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: cancelChoice === r ? 6 : 2, borderColor: cancelChoice === r ? theme.action : '#64748b' }} /><Text>{r}</Text>
          </Pressable>)}
          <TextInput value={cancelComment} onChangeText={setCancelComment} maxLength={400} multiline placeholder="You can add additional comment to help us improve" placeholderTextColor="#94a3b8" accessibilityLabel="Additional comment"
            style={{ minHeight: 80, textAlignVertical: 'top', padding: 11, marginTop: 8, borderWidth: 1, borderColor: '#bdcddd', borderRadius: 8, backgroundColor: '#fff', fontSize: 15, color: '#172b46' }} />
          <Text style={{ fontSize: 12.5, color: '#52647b', marginTop: 8 }}>{booking.partner || !['payment_pending', 'payment_failed', 'searching_for_driver', 'needs_admin_assignment'].includes(booking.status) ? 'A delivery partner has accepted, so our team reviews this request.' : 'No partner has accepted yet, so your booking is cancelled straight away. Any amount you paid goes back to your Bulkimart wallet.'}</Text>
        </PSheet>}
        {cancelResult ? <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setCancelResult('')}>
          <View style={{ flex: 1, backgroundColor: 'rgba(11,20,36,0.65)', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 22, alignItems: 'center' }} accessibilityViewIsModal>
              <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: parcelTint(theme.action), alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#e5334b', fontSize: 22, fontWeight: '800' }}>✕</Text></View>
              <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', marginTop: 12 }}>{cancelResult === 'cancelled' ? 'Booking cancelled' : 'Cancellation requested'}</Text>
              <Text style={{ textAlign: 'center', marginVertical: 10, color: '#41526a' }}>{cancelResult === 'cancelled' ? `Your booking with ${booking.reference} has been cancelled.${booking.refund?.toWallet ? ' The amount you paid is back in your Bulkimart wallet.' : ''}` : 'Our team will review your request. We’ll update you here.'}</Text>
              <PBtn variant="big" title="Okay" onPress={() => { const done = cancelResult === 'cancelled'; setCancelResult(''); if (done) nav('history'); }} />
            </View>
          </View>
        </Modal> : null}
      </>
        : history ? <PCard>
          <Text style={{ fontSize: 21, fontWeight: '700', marginBottom: 12 }}>Your parcel deliveries</Text>
          {!rows.length ? <View style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 20, paddingHorizontal: 16 }}>
            <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#fdf0f2', borderWidth: 1, borderColor: '#f5c2c9', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Package size={36} color={theme.action} /></View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 6 }}>No parcel bookings yet.</Text>
            <Text style={{ fontSize: 13.5, color: '#64748b', maxWidth: 360, marginBottom: 20, lineHeight: 20, textAlign: 'center' }}>When you book a parcel pickup or delivery, its status and tracking will appear here.</Text>
            <PBtn title="Book a parcel →" style={{ backgroundColor: theme.action, borderColor: theme.action }} onPress={() => nav('book')} />
          </View> : <>
            {rows.map(historyRow)}
            {meta.pages > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18 }}>
              <PBtn variant="tab" disabled={page <= 1} title="Previous" onPress={() => setPage(x => x - 1)} />
              <Text> Page {page} </Text>
              <PBtn variant="tab" disabled={page >= meta.pages} title="Next" onPress={() => setPage(x => x + 1)} />
            </View>}
          </>}
        </PCard>
          : <ParcelBookingFlow policy={policy} flags={flags} addresses={addresses} profile={sessionState?.profile} onOpenHistory={() => nav('history')} onOpenTrip={id => nav('track', id)}
            onBooked={b => { setBooking(b); setJustBooked(b.paymentMethod === 'online' ? false : b._id); router.setParams({ view: 'track', id: b._id }); if (b.paymentMethod === 'online') void payOnline(b); }} />}
  </Shell>;
}
