// Port of components/parcels/ParcelDelivery.jsx (ParcelCustomerEntry + ParcelDelivery), route /parcel-delivery.
// Web paths → params: /parcel-delivery[/book] → view=book · /history → view=history · /track/:id → view=track&id=.
// Tracking and history stay live: parcel notifications, a 10 s poll, app foreground and socket reconnect.
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package } from 'lucide-react-native';
import { useSession } from '../context/SessionContext';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { boundedFetch } from '../api/client';
import { openRazorpayCheckout } from '../lib/razorpay';
import { socket } from '../lib/socket';
import { on, EVENTS } from '../lib/events';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { HeaderTop, HeaderPinned } from '../components/UnifiedHeader';
import { Spinner, Text } from '../components/ui';
import { ServiceHeading } from '../components/services/LegalServices';
import { newIdempotencyKey } from '../components/services/ServicePayment';
import { parcelBookingEnabled, parcelBookingReady } from '../components/services/ServiceEntries';
import { PBtn, PCard, ParcelBookingFlow, ParcelCustomerStatus, ParcelMap } from '../components/parcels/ParcelUI';
import { parcelCustomerStatus, parcelHeaders, parcelMoney, parcelRequest } from '../components/parcels/parcelLogic';

const ID = /^[a-f\d]{24}$/i;
const INTRO = 'Your parcel, collected and delivered by a Bulkimart delivery partner.';

function Shell({ children }) {
  const theme = useAppTheme();
  const bottom = useNavPadding(16);
  return <CustomerPage headerColor={theme.header}>
    <ScrollView stickyHeaderIndices={[1]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottom, backgroundColor: '#f6f8fb', flexGrow: 1 }}>
      <HeaderTop />
      <HeaderPinned />
      <View style={{ paddingTop: 16, paddingHorizontal: 12 }}>{children}</View>
    </ScrollView>
  </CustomerPage>;
}

export default function ParcelDeliveryScreen() {
  const sessionState = useSession();
  const { setActiveNav } = useUser();
  if (sessionState.verified) return <ParcelDelivery />;
  return <Shell>
    <ServiceHeading parcel Icon={Package}><Text style={{ color: '#52647b' }}>Book a pickup and delivery for your parcel.</Text></ServiceHeading>
    <PCard style={{ borderTopWidth: 3, borderTopColor: '#ff8500' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Sign in to send a parcel</Text>
      <Text style={{ marginBottom: 12 }}>Sign in to book a parcel or view your private delivery history.</Text>
      {sessionState.loading ? <Spinner /> : <PBtn title="Sign in to Bulkimart" style={{ backgroundColor: '#D91430', borderColor: '#D91430' }} onPress={() => setActiveNav('account')} />}
    </PCard>
  </Shell>;
}

function ParcelDelivery() {
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
  const [cancelOpen, setCancelOpen] = useState(false), [reason, setReason] = useState('');
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
  const retryRead = <PBtn title="Retry" disabled={loading} onPress={() => refresh(x => x + 1)} style={{ alignSelf: 'flex-start' }} />;
  const navBar = (showBook = true, showRefresh = false) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, marginBottom: 20 }} accessibilityLabel="Parcel navigation">
    {showBook && <PBtn variant={!history ? 'tab-on' : 'tab'} title="New booking" onPress={() => nav('book')} />}
    <PBtn variant={history ? 'tab-on' : 'tab'} title="Delivery history" onPress={() => nav('history')} />
    {showRefresh && <PBtn variant="tab" title="Refresh status" disabled={busy} onPress={() => refresh(x => x + 1)} style={{ marginLeft: 'auto' }} />}
  </View>;
  const heading = <ServiceHeading parcel Icon={Package}><Text style={{ color: '#52647b', lineHeight: 22 }}>{INTRO}</Text></ServiceHeading>;
  const shell = content => <Shell>{heading}{navBar()}{content}</Shell>;
  const historyRow = b => <Pressable key={b._id} onPress={() => nav('track', b._id)} accessibilityRole="button"
    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12 }}>
    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: '#1e293b' }}>{b.reference} · {parcelCustomerStatus(b.status)} · {parcelMoney(b.feePaise)}</Text>
    <Text style={{ color: '#D91430', fontWeight: '700', fontSize: 16, marginLeft: 8 }}>→</Text>
  </Pressable>;

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
    {navBar(Boolean(track || history), Boolean(track || history))}
    {(track || history) && updatedAt ? <Text style={{ fontSize: 12.5, color: '#146447', marginBottom: 6 }}>● Live · updated {updatedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: '#9c243a', backgroundColor: '#fff0f1', padding: 14, borderRadius: 8 }}>{error}</Text> : null}
    {notice ? <Text style={{ marginVertical: 6 }}>{notice}</Text> : null}
    {!track && !history && !bookingReady ? <PCard style={{ borderTopWidth: 3, borderTopColor: '#ff8500' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Parcel booking is currently unavailable</Text>
      <Text>We’re not accepting new parcel deliveries right now. Please check back later.</Text>
      <Text style={{ marginVertical: 8 }}>You can still view and track your existing deliveries from Delivery history.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <PBtn title="Check availability" onPress={() => refresh(x => x + 1)} />
        <PBtn title="Back to shopping" style={{ backgroundColor: '#D91430', borderColor: '#D91430' }} onPress={() => setActiveNav('home')} />
      </View>
    </PCard>
      : track && booking ? <>
        <ParcelCustomerStatus booking={booking} justBooked={justBooked === track} onWallet={() => router.push('/account?section=wallet')} />
        <ParcelMap pickup={booking.details.pickup} dropoff={booking.details.dropoff} route={booking.route} />
        {booking.paymentMethod === 'online' && ['payment_pending', 'payment_failed'].includes(booking.status) && <PCard>
          <Text style={{ marginBottom: 8 }}>{busy ? 'Opening secure Razorpay checkout…' : 'Complete your payment securely with Razorpay.'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PBtn disabled={busy} title={busy ? 'Payment in progress…' : 'Pay ' + parcelMoney(booking.feePaise) + ' online'} onPress={() => payOnline(booking)} />
            <PBtn disabled={busy} title="Check payment status" onPress={() => action('payment-status', {})} />
          </View>
        </PCard>}
        {['picked_up', 'in_transit', 'arrived_at_dropoff'].includes(booking.status) && !booking.canCancel && <PCard><Text>Your parcel has been picked up, so this booking can no longer be cancelled.</Text></PCard>}
        {booking.canCancel && <PCard>
          <Pressable onPress={() => setCancelOpen(v => !v)} accessibilityState={{ expanded: cancelOpen }}><Text style={{ fontWeight: '600' }}>{cancelOpen ? '▾' : '▸'} Cancel this booking</Text></Pressable>
          {cancelOpen && <View style={{ marginTop: 10 }}>
            <Text style={{ fontWeight: '600' }}>Cancellation reason</Text>
            <TextInput value={reason} onChangeText={setReason} maxLength={500} accessibilityLabel="Cancellation reason" style={{ padding: 11, marginTop: 7, borderWidth: 1, borderColor: '#bdcddd', borderRadius: 8, backgroundColor: '#fff', fontSize: 16, color: '#172b46' }} />
            <Text style={{ marginVertical: 8 }}>Cancellation and any refund are reviewed under the accepted terms.</Text>
            <PBtn disabled={busy || !reason.trim()} title="Request cancellation review" style={{ alignSelf: 'flex-start' }} onPress={() => action('cancellation', { version: booking.version, reason: reason.trim() })} />
          </View>}
        </PCard>}
      </>
        : history ? <PCard>
          <Text style={{ fontSize: 21, fontWeight: '700', marginBottom: 12 }}>Your parcel deliveries</Text>
          {!rows.length ? <View style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 20, paddingHorizontal: 16 }}>
            <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#fdf0f2', borderWidth: 1, borderColor: '#f5c2c9', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Package size={36} color="#D91430" /></View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 6 }}>No parcel bookings yet.</Text>
            <Text style={{ fontSize: 13.5, color: '#64748b', maxWidth: 360, marginBottom: 20, lineHeight: 20, textAlign: 'center' }}>When you book a parcel pickup or delivery, its status and tracking will appear here.</Text>
            <PBtn title="Book a parcel →" style={{ backgroundColor: '#D91430', borderColor: '#D91430' }} onPress={() => nav('book')} />
          </View> : <>
            {rows.map(historyRow)}
            {meta.pages > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18 }}>
              <PBtn variant="tab" disabled={page <= 1} title="Previous" onPress={() => setPage(x => x - 1)} />
              <Text> Page {page} </Text>
              <PBtn variant="tab" disabled={page >= meta.pages} title="Next" onPress={() => setPage(x => x + 1)} />
            </View>}
          </>}
        </PCard>
          : <ParcelBookingFlow policy={policy} flags={flags} addresses={addresses} profile={sessionState?.profile}
            onBooked={b => { setBooking(b); setJustBooked(b.paymentMethod === 'online' ? false : b._id); router.setParams({ view: 'track', id: b._id }); if (b.paymentMethod === 'online') void payOnline(b); }} />}
  </Shell>;
}
