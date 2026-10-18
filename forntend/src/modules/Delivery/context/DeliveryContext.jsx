import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiUrl } from '../../../utils/api';
import { portalRequest } from '../../../utils/portalRequests';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { startRing, stopRing } from '../../../utils/notificationSoundManager';
import { initPushNotifications, deregisterPushToken } from '../../../utils/firebaseMessaging';
import { clearUserSession } from '../../../utils/userSession';
import { completeDeliveryLogin } from '../utils/deliveryAuth';

const DeliveryContext = createContext();

export const useDelivery = () => {
  const context = useContext(DeliveryContext);
  if (!context) throw new Error('useDelivery must be used within a DeliveryProvider');
  return context;
};

export const DeliveryProvider = ({ children }) => {
  const ui = useFeedback();
  /**
   * Starts false on every load, on purpose.
   *
   * This used to be read back from localStorage, which meant a flag left in the
   * browser decided whether someone saw the rider dashboard. A stale one — from
   * testing, or from a rider who was later suspended — showed the dashboard to
   * someone with no approved application behind them. The server says who is
   * approved; the bootstrap below asks it.
   */
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [sessionRetry, setSessionRetry] = useState(0);
  
  /**
   * Two separate facts, deliberately not collapsed into one flag:
   *   phoneVerified — this person has OTP-verified a phone *for the rider flow*
   *   riderAuthed   — we also know their name, so registration is done
   *
   * Neither starts from a stored token. A token only proves somebody signed in
   * to shop, and shopping does not make you a delivery partner — reading it as
   * one skipped the phone and OTP screen entirely for anyone already logged in.
   * Registration always starts at the number. The bootstrap below is what lets
   * a rider who has *already registered* stay signed in.
   */
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [riderAuthed, setRiderAuthed] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(localStorage.getItem('userToken')));
  const [riderStatus, setRiderStatus] = useState('');
  const [riderRejection, setRiderRejection] = useState('');
  const [riderProfile, setRiderProfile] = useState(null);
  const [riderName, setRiderName] = useState('');
  const [riderPhone, setRiderPhone] = useState('');

  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingForm, setOnboardingForm] = useState({
    vehicleType: '',
    vehicleNumber: '',
    dlNumber: '',
    dlDoc: null,
    aadhaarNumber: '',
    aadhaarDoc: null,
    bankName: '',
    bankAccount: '',
    bankIfsc: '',
    zones: '',
    deliveryRadius: 10,
    // Filled by LocationPicker — either a GPS fix or a typed address.
    location: {},
  });

  const [isOnline, setIsOnline] = useState(false);
  const [debitWallet, setDebitWallet] = useState(() => {
    const saved = localStorage.getItem('deliveryDebitWallet');
    return saved ? Number(saved) : 0;
  }); // Mock floating cash collected from COD orders
  const [payoutBalance, setPayoutBalance] = useState(0); // Un-withdrawn earnings
  const [payoutHistory, setPayoutHistory] = useState([]);
  const [payoutRequesting, setPayoutRequesting] = useState(false);
  const [activeOrder, setActiveOrder] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  
  // Real-time broadcast variables
  const [riderPingOrder, setRiderPingOrder] = useState(null);
  // QUICK COMMERCE ONLY — the reverse-pickup counterpart to `riderPingOrder`
  // above, kept as its own value (not merged into `riderPingOrder`) since a
  // return pickup offer is a different shape and a different accept/decline
  // API — see the ring-effect below for how the two share one audio manager
  // without fighting each other.
  const [returnPickupPingOffer, setReturnPickupPingOffer] = useState(null);
  const [locationInterval, setLocationInterval] = useState(null);

  /**
   * Where the rider is, as this device last saw it.
   *
   * The GPS watcher below already existed, but it only ever posted coordinates
   * to the server and threw them away — so the rider's own screen had no idea
   * where the rider was, while the customer watching them move did. That is why
   * the rider's map could never draw a route from their position.
   *
   * Written from the same `watchPosition` callback that does the posting. There
   * is deliberately no second watcher: two subscriptions would mean two GPS
   * wakeups on a phone that spends the day in a pocket.
   */
  const [riderLocation, setRiderLocation] = useState(null);

  /**
   * The urgent ring, driven by `riderPingOrder` (forward) or
   * `returnPickupPingOffer` (Quick Commerce reverse pickup) — the same two
   * values that decide whether OrderPingModal / ReturnPickupPingModal are
   * showing. Combined into ONE effect on purpose: two independent effects
   * each calling the shared singleton `startRing`/`stopRing` would race
   * and could stop a ring the other one just started. Forward takes
   * priority if, improbably, both are offered at once — a single audio
   * element can only ever carry one alert.
   */
  useEffect(() => {
    const key = riderPingOrder
      ? String(riderPingOrder.orderId || riderPingOrder._id)
      : returnPickupPingOffer
        ? `return:${returnPickupPingOffer.returnId}`
        : null;
    if (key) startRing(key);
    else stopRing();
    return () => stopRing();
  }, [riderPingOrder, returnPickupPingOffer]);

  // Push registration is independent of the on-duty toggle — an approved
  // rider should be reachable in the background even while off duty.
  useEffect(() => {
    if (riderProfile && riderProfile.status === 'approved') {
      initPushNotifications().catch(() => {});
    }
  }, [riderProfile]);

  // --- Socket.io for Rider ---
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    if (token && riderProfile && riderProfile.status === 'approved' && isOnline) {
      connectSocket(token, 'delivery', riderProfile._id);
    }

    socket.on('rider_ping', (order) => {
      setRiderPingOrder(order);
    });

    socket.on('ping_cancelled', () => {
      setRiderPingOrder(null);
    });

    /**
     * QUICK COMMERCE ONLY — the reverse-pickup ping, same authenticated
     * `rider:<partnerId>` room the forward `rider_ping` above already uses
     * (services/returnPickup.service.js emits this via the existing
     * emitToRider helper — no second socket connection). Deduplicated by
     * `returnId` (Section 10): a duplicate emit for an offer already on
     * screen is a no-op, never a second modal.
     */
    socket.on('return_pickup_ping', (offer) => {
      setReturnPickupPingOffer((curr) => (
        curr && String(curr.returnId) === String(offer?.returnId) ? curr : offer
      ));
    });

    return () => {
      socket.off('rider_ping');
      socket.off('ping_cancelled');
      socket.off('return_pickup_ping');
      disconnectSocket();
    };
  }, [riderProfile, isOnline]);

  /**
   * QUICK COMMERCE ONLY — the reverse pickup (customer -> rider -> seller)
   * leg of an approved Return. Mirrors `acceptOrder`/`declineOrder`/the OTP
   * functions below, against the parallel /api/delivery/return-pickups/*
   * endpoints — kept as its own state rather than folded into
   * `activeOrder`/`riderPingOrder`, since a return pickup is not a forward
   * order and forcing it through that state risks breaking the existing
   * delivery flow this whole context already carries.
   */
  const [returnPickups, setReturnPickups] = useState({ pending: [], active: [] });

  /**
   * Reconciliation, same job `checkPendingPings` does for forward orders:
   * the socket is what makes a new offer appear instantly, this is what
   * keeps it honest against the server — clears `returnPickupPingOffer` if
   * it's no longer on the server's pending list (taken by another rider,
   * withdrawn, expired elsewhere), and picks one up from `pending` if a
   * poll discovers an offer the socket never delivered (a disconnect, a
   * reconnect, a missed event).
   */
  const fetchReturnPickups = useCallback(async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/delivery/return-pickups'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const data = body.data || { pending: [], active: [] };
      setReturnPickups(data);
      setReturnPickupPingOffer((curr) => {
        if (data.pending.length === 0) return null;
        const stillOffered = curr && data.pending.some((r) => String(r._id) === String(curr.returnId));
        if (stillOffered) return curr;
        const first = data.pending[0];
        return first ? {
          returnId: String(first._id), returnNumber: first.returnNumber,
          productName: first.productName, productImage: first.productImage, quantity: first.quantity,
        } : null;
      });
    } catch { /* leave whatever was already loaded */ }
  }, []);

  const acceptReturnPickup = async (returnId) => {
    try {
      const res = await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/accept`), { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      triggerToast(res.ok ? 'Pickup accepted' : (body.message || 'Return pickup is no longer available.'));
      setReturnPickupPingOffer(null);
      if (res.ok) startReturnPickupLocationBroadcast(returnId);
      await fetchReturnPickups();
      return { ok: res.ok, message: body.message };
    } catch (err) {
      setReturnPickupPingOffer(null);
      return { ok: false, message: err.message };
    }
  };

  /**
   * Live GPS for an accepted return pickup — same `watchPosition` mechanics
   * as `startLocationBroadcast` above, pointed at the parallel
   * `PUT /api/delivery/return-pickups/:id/location` endpoint instead of the
   * forward one. Shares `riderLocation`/`locationInterval` with the forward
   * broadcast rather than duplicating that state: there is only one real
   * GPS on the rider's phone, whichever job it's currently being posted for.
   */
  const startReturnPickupLocationBroadcast = (returnId) => {
    stopLocationBroadcast();

    if (!navigator.geolocation) {
      triggerToast('This device cannot share your location — the customer will not see you on the map.');
      return;
    }
    if (!window.isSecureContext) {
      triggerToast('Location sharing needs a secure (https) connection.');
      return;
    }

    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const here = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setRiderLocation(here);

        const now = Date.now();
        if (now - lastSentAt < 5000) return;
        lastSentAt = now;

        try {
          await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/location`), {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ lat: here.lat, lng: here.lng }),
          });
        } catch (err) {
          console.error('Return pickup location ping failed:', err.message);
        }
      },
      (err) => {
        const messages = {
          1: 'Location is blocked. The customer cannot see you on the map until you allow it.',
          2: 'Your location is unavailable right now.',
          3: 'Getting your location is taking too long.',
        };
        triggerToast(messages[err.code] || 'Could not read your location.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    setLocationInterval(watchId);
  };

  const declineReturnPickup = async (returnId, reason) => {
    try {
      const res = await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/decline`), {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      triggerToast(res.ok ? 'Pickup declined' : (body.message || 'Could not decline'));
      setReturnPickupPingOffer(null);
      await fetchReturnPickups();
      return { ok: res.ok, message: body.message };
    } catch (err) {
      setReturnPickupPingOffer(null);
      return { ok: false, message: err.message };
    }
  };

  /**
   * The offer window ran out — not the rider declining. Same shape as
   * `declineReturnPickup`, hitting `/expire` instead, same convention as
   * forward's `expireOrder` (a client-driven timeout the backend confirms
   * and records as OFFER_EXPIRED, distinct from a real decline).
   */
  const expireReturnPickup = async (returnId) => {
    try {
      await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/expire`), { method: 'POST', headers: authHeaders() });
    } catch { /* best-effort — the offer still comes off screen below */ } finally {
      setReturnPickupPingOffer(null);
      fetchReturnPickups();
    }
  };

  const generateReturnPickupOtp = async (returnId) => {
    try {
      const res = await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/generate-otp`), { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      triggerToast(res.ok ? 'Pickup code sent to the customer' : (body.message || 'Could not send the pickup code'));
      return { ok: res.ok, message: body.message };
    } catch (err) {
      triggerToast(err.message || 'Network error sending the pickup code', {type:'error'});
      return { ok: false, message: err.message };
    }
  };

  const verifyReturnPickupOtp = async (returnId, otp) => {
    try {
      const res = await fetch(apiUrl(`/api/delivery/return-pickups/${returnId}/verify-otp`), {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }),
      });
      const body = await res.json();
      triggerToast(res.ok ? 'Pickup confirmed' : (body.message || 'Incorrect code'));
      if (res.ok) await fetchReturnPickups();
      return { ok: res.ok, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const checkPendingPings = useCallback(async () => {
    const token = localStorage.getItem('userToken');
    if (!token || !riderProfile || riderProfile.status !== 'approved' || !isOnline) return;

    try {
      const res = await fetch(apiUrl('/api/delivery/orders/pending'), { headers: authHeaders() });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      const list = body.data || [];

      /**
       * The server is the authority on what is still available.
       *
       * This only ever set the offer, never cleared it — so once a modal
       * appeared it stayed for the rest of the session, even after the order
       * had been taken by someone else or pulled back by the shop. Every tap on
       * Accept then failed, with no way to dismiss it.
       */
      setRiderPingOrder((curr) => {
        if (list.length === 0) return null;
        // Keep the current offer only if it is still on the server's list.
        const stillOffered = curr && list.some(
          (o) => String(o.orderId) === String(curr.orderId || curr._id)
        );
        return stillOffered ? curr : list[0];
      });
    } catch (err) {
      console.error('Failed to fetch pending pings:', err.message);
    }
  }, [riderProfile, isOnline]);

  /**
   * Keep the offer in step with the server for as long as the rider is on duty.
   *
   * This used to run once, when the duty toggle flipped, and never again. Two
   * things went wrong with that. An offer that was no longer available — taken
   * by another rider, or pulled back by the shop — stayed on screen for ever,
   * and every tap on Accept came back 400 with no way to clear it. And an order
   * dispatched while the rider's socket happened to be reconnecting was simply
   * never seen: the ping was the only way in, and it had already gone.
   *
   * The socket is still what makes a new order appear instantly. This is the
   * correction that runs behind it.
   */
  useEffect(() => {
    // Off duty means no offers. Carrying one no longer stops another arriving —
    // whether a rider may take a second is the server's call now, via
    // RIDER_MAX_CONCURRENT_DELIVERIES, and it is unset while this is being
    // built so several at once is expected.
    if (!isOnline) {
      setRiderPingOrder(null);
      return;
    }

    checkPendingPings();
    const id = setInterval(checkPendingPings, 10000);
    return () => clearInterval(id);
  }, [isOnline, checkPendingPings]);

  /**
   * QUICK COMMERCE ONLY — same reconciliation discipline as the forward
   * poll above, for return pickups. The socket delivers the offer
   * instantly (Section 2); this is the fallback for a disconnected socket,
   * a backgrounded tab, or a missed event (Section 9/17).
   */
  useEffect(() => {
    if (!isOnline) {
      setReturnPickupPingOffer(null);
      return;
    }
    fetchReturnPickups();
    const id = setInterval(fetchReturnPickups, 15000);
    return () => clearInterval(id);
  }, [isOnline, fetchReturnPickups]);

  /**
   * The toggle reflects what the server agreed to, not what was tapped.
   *
   * It used to flip the UI first and then fire the request, swallowing any
   * failure into console.error. So when going on duty was refused — because the
   * rider still had a delivery open — the app showed them as online anyway.
   * They sat there believing they were available while the server had them
   * marked busy, and no order could ever reach them.
   */
  const handleToggleOnline = async (online) => {
    try {
      let coords = null;
      if (online && navigator.geolocation) {
        coords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }),
            () => resolve(null),
            { timeout: 3000 }
          );
        });
      }

      const payload = { isAvailable: online, ...(coords || {}) };
      const res = await fetch(apiUrl('/api/delivery/availability'), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        triggerToast(body.message || 'Could not change your duty status');
        return false;
      }

      setIsOnline(Boolean(body.data?.isAvailable));
      triggerToast(body.message);
      return true;
    } catch (err) {
      triggerToast(err.message || 'Network error — is the server running?', {type:'error'});
      return false;
    }
  };

  /**
   * Pick a delivery back up after a reload.
   *
   * `activeOrder` lived only in React state, so refreshing the page — or the
   * phone simply locking — left a rider assigned to an order with no screen to
   * work it on. The app offered them new jobs instead, the server refused every
   * one because they were already busy, and the customer waited for a delivery
   * nobody could complete.
   */
  const restoreActiveDelivery = useCallback(async () => {
    if (!localStorage.getItem('userToken')) return;
    try {
      const res = await fetch(apiUrl('/api/delivery/orders/active'), { headers: authHeaders() });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));

      if (body.data) {
        setActiveOrder(body.data);
        // The customer's map goes quiet otherwise, with the rider frozen
        // wherever they were when the tab closed.
        startLocationBroadcast(body.data.orderId);
      }
    } catch { /* offline — the next load will try again */ }
  }, []);

  /**
   * Past offer/delivery outcomes — declined, expired, cancelled, delivered.
   *
   * A thin fetch, same authHeaders()/apiUrl() shape as everywhere else. The
   * page that calls this owns its own loading/error/list state, the same
   * way EarningsPage already owns its own state around earningsData rather
   * than the context holding a global copy of something only one screen
   * shows.
   */
  const fetchRiderHistory = async ({ type, page } = {}) => {
    const params = new URLSearchParams();
    if (type && type !== 'ALL') params.set('type', type);
    if (page) params.set('page', page);
    const qs = params.toString();
    const res = await fetch(apiUrl(`/api/delivery/orders/history${qs ? `?${qs}` : ''}`), {
      headers: authHeaders(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'Could not load history');
    return body; // { success, data, meta }
  };

  // Live Location Broadcast every 5 seconds
  /**
   * Stream the rider's real position while a delivery is live.
   *
   * Two things were wrong before. The coordinates were invented — a random walk
   * around a fixed point in Indore, so the customer's map showed a courier
   * drifting in circles regardless of where the actual rider was. And the pings
   * went to `PUT /api/delivery/location`, which sets where a rider is *based*,
   * silently rewriting their home address every five seconds while emitting
   * nothing to the person watching.
   *
   * `watchPosition` rather than a polling interval: the browser wakes us when
   * the device actually moves, so a stationary rider costs nothing.
   */
  const startLocationBroadcast = (orderId) => {
    stopLocationBroadcast();

    if (!navigator.geolocation) {
      triggerToast('This device cannot share your location — the customer will not see you on the map.');
      return;
    }
    if (!window.isSecureContext) {
      triggerToast('Location sharing needs a secure (https) connection.');
      return;
    }

    let lastSentAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const here = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };

        /**
         * The marker moves on every fix; the network does not.
         *
         * Drawing is free and local, so the rider sees themselves move smoothly.
         * The throttle below still applies to the POST, and the map's own
         * threshold still applies to asking Google for a new road — a marker
         * update is not a reason to buy a fresh route.
         */
        setRiderLocation(here);

        // The device can fire far more often than is useful; one ping every few
        // seconds is enough to animate a marker and is kinder to mobile data.
        const now = Date.now();
        if (now - lastSentAt < 5000) return;
        lastSentAt = now;

        try {
          await fetch(apiUrl(`/api/delivery/orders/${orderId}/location`), {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
              lat: Number(pos.coords.latitude.toFixed(6)),
              lng: Number(pos.coords.longitude.toFixed(6)),
              accuracy: Math.round(pos.coords.accuracy),
              source: 'gps',
            }),
          });
        } catch (err) {
          // A dropped ping is not worth interrupting a delivery over; the next
          // movement sends a fresh one.
          console.error('Location ping failed:', err.message);
        }
      },
      (err) => {
        const messages = {
          1: 'Location is blocked. The customer cannot see you on the map until you allow it.',
          2: 'Your location is unavailable right now.',
          3: 'Getting your location is taking too long.',
        };
        triggerToast(messages[err.code] || 'Could not read your location.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    setLocationInterval(watchId);
  };

  /**
   * `locationInterval` now holds a geolocation watch id, not a timer id.
   * `clearInterval` on it is silently a no-op, which would leave the GPS running
   * for the rest of the session — draining the battery of a phone that spends
   * all day in a pocket.
   */
  const stopLocationBroadcast = () => {
    if (locationInterval !== null && locationInterval !== undefined) {
      navigator.geolocation?.clearWatch?.(locationInterval);
      setLocationInterval(null);
    }
  };

  useEffect(() => {
    return () => {
      if (locationInterval !== null && locationInterval !== undefined) {
        navigator.geolocation?.clearWatch?.(locationInterval);
      }
    };
  }, [locationInterval]);

  /**
   * What the rider has earned.
   *
   * `lifetime` is the only slice the server can currently answer for. It is
   * hydrated from `/api/delivery/me`, which carries the partner's persisted
   * `earnings` and `totalDeliveries` — the same figures the completion handler
   * writes to Mongo. Nothing here is the source of truth; this is a viewer.
   *
   * `daily` is built up as deliveries finish during this session, so it is real
   * while the tab stays open and gone after a refresh. `weekly` has no source at
   * all yet. Both carry `available`, and the screens show a dash rather than ₹0
   * when it is false: a rider who earned ₹263 today and then reloaded should not
   * be told they earned nothing. Answering those two properly needs the delivery
   * records aggregated by date, which is a separate piece of work.
   */
  const [earningsData, setEarningsData] = useState(() => {
    const defaultData = {
      daily: {
        date: 'Today',
        trips: 0,
        total: 0,
        // Part of `total`, not on top of it — the tip was credited as part of
        // the delivery's pay. Tracked separately only so the screen can show
        // a rider what customers chose to add.
        tips: 0,
        breakdown: [],
        available: false,
      },
      weekly: {
        cycle: 'Current Cycle',
        trips: 0,
        total: 0,
        days: [
          { day: 'Mon', amount: 0 },
          { day: 'Tue', amount: 0 },
          { day: 'Wed', amount: 0 },
          { day: 'Thu', amount: 0 },
          { day: 'Fri', amount: 0 },
          { day: 'Sat', amount: 0 },
          { day: 'Sun', amount: 0 },
        ],
        available: false,
      },
      lifetime: {
        label: 'All time',
        trips: 0,
        total: 0,
        tips: 0,
        available: false,
      },
    };
    try {
      const savedDaily = localStorage.getItem('deliveryEarningsDaily');
      if (savedDaily) {
        defaultData.daily = JSON.parse(savedDaily);
      }
    } catch (e) {
      console.error('Error loading daily earnings from localStorage', e);
    }
    return defaultData;
  });

  useEffect(() => {
    localStorage.setItem('deliveryDebitWallet', debitWallet.toString());
  }, [debitWallet]);

  useEffect(() => {
    localStorage.setItem('deliveryEarningsDaily', JSON.stringify(earningsData.daily));
  }, [earningsData.daily]);

  /**
   * Read the rider's earnings back off their profile.
   *
   * `earnings.pending` is precisely what "available payout balance" means — the
   * money credited on delivery and not yet paid out — so the balance card can be
   * driven straight from it instead of being counted up in this browser.
   *
   * Called from every place that fetches the profile, so a reload, a re-login
   * and a post-approval refresh all land on the same figures.
   */
  const hydrateEarnings = useCallback((partner) => {
    const e = partner?.earnings || {};
    // Guard the arithmetic: a partner who has never delivered has no `earnings`
    // subdocument worth trusting, and NaN would render as "₹NaN".
    const total   = Number(e.total)   || 0;
    const pending = Number(e.pending) || 0;
    const tips    = Number(e.tips)    || 0;
    const trips   = Number(partner?.totalDeliveries) || 0;

    setPayoutBalance(pending);
    setEarningsData((prev) => ({
      ...prev,
      lifetime: { ...prev.lifetime, total, trips, tips, available: true },
    }));
  }, []);

  // Decide what an existing token entitles the holder to. The question is not
  // "are they logged in" but "have they already registered as a rider" — only
  // the second lets them skip the OTP screen.
  useEffect(() => {
    if (!localStorage.getItem('userToken')) return;

    let cancelled = false;
    const sessionToken = localStorage.getItem('userToken');
    setBootstrapping(true); setSessionError('');
    (async () => {
      try {
        const session = await portalRequest('delivery', sessionToken, '/api/auth/me', { cacheMs: 60000, fresh: sessionRetry > 0 });
        if (cancelled || sessionToken !== localStorage.getItem('userToken')) return;
        if ([401, 403].includes(session.status)) { clearUserSession(); return; }
        if (!session.ok) throw new Error('Session unavailable');
        const identity = await session.json();
        if (cancelled || sessionToken !== localStorage.getItem('userToken') || identity.userType !== 'user' || identity.sessionRole !== 'delivery') return;
        const res = await portalRequest('delivery', sessionToken, '/api/delivery/me');
        if (cancelled || sessionToken !== localStorage.getItem('userToken')) return;

        if (res.status === 401) {
          // Expired or tampered — drop it rather than half-trusting it.
          clearUserSession();
          return;
        }
        if (!res.ok) {
          if (res.status >= 500) throw new Error('Delivery profile unavailable');
          // 404: signed in, but has never registered as a rider. They go
          // through the whole flow, starting with their number — and any flag
          // claiming otherwise goes with it.
          localStorage.removeItem('delivery_onboarded');
          return;
        }

        const body = await res.json().catch(() => ({}));
        const d = body.data || {};
        if (cancelled) return;

        setRiderPhone(d.phone || '');
        setRiderName(d.name || '');
        setRiderStatus(d.status || '');
        setRiderRejection(d.rejectionReason || '');
        setRiderProfile(d);
        setOnboardingForm((previous) => ({
          ...previous,
          vehicleType: d.vehicleType || previous.vehicleType,
          vehicleNumber: d.vehicleNo || previous.vehicleNumber,
          dlNumber: d.drivingLicense?.no || previous.dlNumber,
          dlExpiry: d.drivingLicense?.expiryDate ? String(d.drivingLicense.expiryDate).slice(0, 10) : previous.dlExpiry,
          zones: Array.isArray(d.zones) ? d.zones.join(', ') : previous.zones,
          location: d.baseLocation || previous.location,
          bankHolder: d.bankDetails?.holderName || previous.bankHolder || '',
          bankName: d.bankDetails?.bankName || previous.bankName,
          bankAccount: d.bankDetails?.accountNo || previous.bankAccount,
          bankIfsc: d.bankDetails?.ifsc || previous.bankIfsc,
          upiId: d.bankDetails?.upiId || previous.upiId || '',
          deliveryRadius: d.deliveryRadiusKm !== undefined && d.deliveryRadiusKm !== null ? d.deliveryRadiusKm : (previous.deliveryRadius || 10),
        }));
        setPhoneVerified(true);
        setIsOnline(d.isAvailable || false);
        // The money is already in Mongo — this is what makes it survive F5.
        hydrateEarnings(d);
        // A rider mid-registration with no name yet still owes us one.
        setRiderAuthed(Boolean(d.name));
        setOnboardingStep(Math.min(d.onboardingStep || 1, 4));

        // The server decides who is approved, not a flag in this browser. An
        // old 'delivery_onboarded' left over from testing would otherwise show
        // the dashboard to a rider whose application is still pending.
        if (d.status === 'approved') {
          setIsOnboarded(true);
          localStorage.setItem('delivery_onboarded', 'true');
          // Pick up a trip that was already under way when the page reloaded.
          restoreActiveDelivery();
        } else {
          setIsOnboarded(false);
          localStorage.removeItem('delivery_onboarded');
        }
      } catch {
        if (!cancelled) setSessionError('Unable to verify your delivery session. Check your connection and retry.');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionRetry]);

  /** Attach a name to an already-verified phone. */
  const saveRiderName = async (name) => {
    const trimmed = (name || '').trim();
    if (trimmed.length < 2) return { ok: false, message: 'Please enter your full name.' };
    try {
      const res = await fetch(apiUrl('/api/delivery/start'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save your name' };

      setRiderName(trimmed);
      setRiderAuthed(true);
      return { ok: true, status: body.data?.status, step: body.data?.onboardingStep || 1 };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /**
   * Multipart uploads carry no Content-Type header on purpose.
   *
   * FormData needs a boundary string in that header, and only the browser knows
   * it. Setting 'multipart/form-data' by hand omits the boundary and the server
   * cannot parse a single field.
   */
  const authHeadersFile = () => ({
    Authorization: 'Bearer ' + localStorage.getItem('userToken'),
  });

  /** Shared plumbing for the three document steps. */
  const submitStep = async (step, formData) => {
    if (!localStorage.getItem('userToken')) {
      return { ok: false, message: 'Please sign in again.' };
    }
    try {
      const res = await fetch(apiUrl(`/api/delivery/step/${step}`), {
        method: 'PUT',
        headers: authHeadersFile(),
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save this step' };

      // The server is the authority on how far along the rider is.
      if (body.data?.onboardingStep) setOnboardingStep(Math.min(body.data.onboardingStep, 4));
      return { ok: true, data: body.data, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /** Step 1 — vehicle and driving licence. */
  const submitVehicle = async ({ vehicleType, vehicleNo, licenseNo, licenseExpiry, licenseFile }) => {
    const fd = new FormData();
    fd.append('vehicleType', vehicleType);
    fd.append('vehicleNo', vehicleNo || '');
    fd.append('licenseNo', licenseNo || '');
    if (licenseExpiry) fd.append('licenseExpiry', licenseExpiry);
    if (licenseFile) fd.append('license', licenseFile);
    return submitStep(1, fd);
  };

  /** Step 2 — Aadhaar. Both sides are required by the server. */
  const submitAadhaar = async ({ aadhaarNumber, frontFile, backFile }) => {
    const fd = new FormData();
    fd.append('aadhaarNumber', aadhaarNumber || '');
    if (frontFile) fd.append('aadhaarFront', frontFile);
    if (backFile) fd.append('aadhaarBack', backFile);
    return submitStep(2, fd);
  };

  /**
   * Step 3 — service area, base location and payout account.
   *
   * The location travels with this step rather than through its own endpoint, so
   * a rider cannot end up with pincodes saved and no location, or the reverse.
   */
  const submitServiceArea = async ({ zones, deliveryRadius, location, bank, passbookFile }) => {
    const fd = new FormData();
    fd.append('zones', zones || '');
    if (deliveryRadius !== undefined && deliveryRadius !== null && deliveryRadius !== '') {
      fd.append('deliveryRadiusKm', deliveryRadius);
    }
    fd.append('accountNo', bank?.accountNo || '');
    fd.append('ifsc', bank?.ifsc || '');
    fd.append('holderName', bank?.holderName || '');
    fd.append('bankName', bank?.bankName || '');
    if (bank?.upiId) fd.append('upiId', bank.upiId);
    if (passbookFile) fd.append('passbook', passbookFile);

    // Flatten the location — multipart carries strings, not nested objects.
    const loc = location || {};
    for (const key of ['lat', 'lng', 'accuracy', 'source', 'address', 'landmark', 'city', 'state', 'pincode']) {
      if (loc[key] !== undefined && loc[key] !== '') fd.append(key, loc[key]);
    }
    return submitStep(3, fd);
  };

  /** Hand the application to the admin queue. */
  const submitApplication = async () => {
    try {
      const res = await fetch(apiUrl('/api/delivery/submit'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not submit your application' };

      setRiderStatus(body.data?.status || 'pending');
      return { ok: true, status: body.data?.status };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /**
   * Re-read the application from the server.
   *
   * The review screen has no other way to notice an admin decision, and an
   * approval must never be something this app grants itself.
   */
  const refreshRiderStatus = async () => {
    try {
      const res = await fetch(apiUrl('/api/delivery/me'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not check your status' };

      const d = body.data || {};
      setRiderStatus(d.status);
      setRiderProfile(d);
      setIsOnline(d.isAvailable || false);
      setRiderRejection(d.rejectionReason || '');
      hydrateEarnings(d);

      if (d.status === 'approved') {
        setIsOnboarded(true);
        localStorage.setItem('delivery_onboarded', 'true');
      }
      return { ok: true, status: d.status, profile: d };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  const authHeaders = () => ({
    Authorization: 'Bearer ' + localStorage.getItem('userToken'),
    'Content-Type': 'application/json',
  });

  /**
   * One phone remains one identity; the Delivery entry point verifies whether
   * it is signing in to an existing profile or explicitly registering one.
   */
  const sendRiderOtp = async (phone, intent) => {
    if (!/^\d{10}$/.test(phone || '')) {
      return { ok: false, message: 'Please enter a valid 10-digit mobile number.' };
    }
    try {
      const res = await fetch(apiUrl('/api/auth/delivery/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, intent }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not send OTP' };
      // In mock mode the server returns the code so it can be used while testing.
      return { ok: true, otp: body.otp, message: body.otp ? `OTP sent. Test code: ${body.otp}` : 'OTP sent to your mobile.' };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /**
   * Verify the OTP, store the session, and report where the rider belongs.
   *
   * A rider who already finished onboarding must not be dropped back at step 1,
   * so this reads their existing application status and hands it back.
   */
  const verifyRiderOtp = async (phone, otp, name, intent) => {
    if (!otp) return { ok: false, message: 'Please enter the OTP.' };
    try {
      const { body, profile: d } = await completeDeliveryLogin(phone, otp, name, intent);

      // Session change remounts the provider and restores all rider state from the server.
      return { ok: true, status: d.status, step: d.onboardingStep || 1, user: body.user };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /** Turn a GPS fix into address fields. Server-side so the paid key stays there. */
  const lookupAddress = async (lat, lng, accuracy) => {
    try {
      const res = await fetch(apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}${accuracy ? `&accuracy=${Math.round(accuracy)}` : ''}`), {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not look up that address' };
      return { ok: true, address: body.data };
    } catch (err) {
      return { ok: false, message: err.message || 'Could not reach the address service' };
    }
  };

  /**
   * Persist the rider's base location.
   *
   * This is a real API call, unlike the rest of this onboarding flow, which is
   * still mock. The server needs a partner profile to attach the location to,
   * so /start runs first — it is idempotent and returns the existing profile
   * if one is already there.
   */
  const saveRiderLocation = async (location) => {
    const token = localStorage.getItem('userToken');
    if (!token) {
      return { ok: false, message: 'Please sign in before saving your location.' };
    }

    const headers = authHeaders();

    try {
      // Idempotent: creates the profile on the first call, returns it after.
      await fetch(apiUrl('/api/delivery/start'), { method: 'POST', headers });

      const res = await fetch(apiUrl('/api/delivery/location'), {
        method: 'PUT',
        headers,
        body: JSON.stringify(location),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) return { ok: false, message: body.message || 'Could not save your location' };
      return { ok: true, message: body.message || 'Location saved', data: body.data };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  const triggerToast = (message, options) => ui.notify(message, options);

  const logoutDelivery = () => {
    setIsOnboarded(false);
    localStorage.removeItem('delivery_onboarded');
    stopRing();
    deregisterPushToken().catch(() => {});

    // The session has to go too. Clearing only the onboarding flag left the
    // token in place, so the next person to open the app landed straight back
    // inside the previous rider's account.
    clearUserSession();
    disconnectSocket();
    stopLocationBroadcast();
    setRiderProfile(null);
    setRiderStatus('');
    setRiderRejection('');
    setRiderPingOrder(null);
    setReturnPickupPingOffer(null);
    setReturnPickups({ pending: [], active: [] });
    setPayoutBalance(0);
    setPayoutHistory([]);
    setDebitWallet(0);
    setPhoneVerified(false);
    setRiderAuthed(false);
    setRiderName('');
    setRiderPhone('');
    setOnboardingStep(1);

    setIsOnline(false);
    setActiveOrder(null);
    window.history.pushState(null, '', '/delivery/onboarding');
    triggerToast('Logged out of Delivery Panel.');
  };

  const settleDebitWallet = (amount) => {
    if (debitWallet === 0) {
      triggerToast('No outstanding COD balance to settle.');
      return true;
    }
    const depositAmt = amount ? Number(amount) : debitWallet;
    if (isNaN(depositAmt) || depositAmt <= 0) {
      triggerToast('Please enter a valid deposit amount.');
      return false;
    }
    if (depositAmt > debitWallet) {
      triggerToast(`Deposit amount exceeds cash-in-hand of ₹${debitWallet}.`);
      return false;
    }
    setDebitWallet(prev => prev - depositAmt);
    triggerToast(`Settle payment of ₹${depositAmt} successful via digital gateway.`);
    return true;
  };

  /**
   * Requests a withdrawal of the full available balance from the real
   * ledger (`DeliveryPartner.earnings.pending`) — not a local mock. The
   * amount is reserved server-side atomically the moment the request is
   * created; it leaves `payoutBalance` only after that reservation is
   * confirmed, via the fresh `/api/delivery/me` refetch below, never
   * optimistically.
   */
  const cashoutEarnings = async () => {
    if (payoutBalance <= 0) {
      triggerToast('Insufficient balance for cashout.');
      return;
    }
    if (payoutRequesting) return;
    setPayoutRequesting(true);
    try {
      const res = await fetch(apiUrl('/api/delivery/payouts'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount: payoutBalance }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        triggerToast(body.message || 'Could not submit payout request.');
        return;
      }
      triggerToast(`Payout request of ₹${payoutBalance} submitted — it will be settled to your bank/UPI shortly.`);
      // Reflect the server's post-reservation balance rather than assuming.
      try {
        const meRes = await fetch(apiUrl('/api/delivery/me'), { headers: authHeaders() });
        const meBody = await meRes.json().catch(() => ({}));
        if (meRes.ok) hydrateEarnings(meBody.data || {});
      } catch { /* balance stays as last known; not fatal */ }
      fetchPayoutHistory();
    } catch (err) {
      triggerToast(err.message || 'Network error — is the server running?', {type:'error'});
    } finally {
      setPayoutRequesting(false);
    }
  };

  const fetchPayoutHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/delivery/payouts'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setPayoutHistory(body.data || []);
    } catch { /* leave last known history in place */ }
  }, []);

  const acceptOrder = async (order) => {
    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${order.orderId || order._id}/accept`), {
        method: 'POST',
        headers: authHeaders()
      });
      const body = await res.json();
      if (!res.ok) {
        /**
         * A refusal means this order is not takeable — somebody else got it, or
         * the shop has not dispatched it yet. Either way the offer is stale, so
         * it comes off the screen instead of leaving a button that can only
         * fail. Without this the modal sat there and every tap logged another
         * 400.
         */
        setRiderPingOrder(null);
        throw new Error(body.message || 'Failed to accept order');
      }

      const orderId = order.orderId || order._id;

      /**
       * Read the delivery back rather than assembling it from the offer.
       *
       * The offer payload and the active-delivery payload are not the same
       * shape — the offer has no `stage` and no `otpSent` — so a screen built
       * from one behaved differently from the same screen after a refresh,
       * which is where the "arrived" and "send code" buttons went wrong. One
       * source, one shape, whichever way the rider got here.
       */
      const active = await fetch(apiUrl('/api/delivery/orders/active'), { headers: authHeaders() });
      const activeBody = await active.json().catch(() => ({}));

      setActiveOrder(
        activeBody.data || {
          // Falls back to the offer if that call fails, so a network blip does
          // not leave the rider on the dashboard with an order they now own.
          ...order,
          orderId,
          step: 'pickup',
          deliveryId: body.deliveryId || body.data?.deliveryId,
        }
      );

      startLocationBroadcast(orderId);
      triggerToast('Order accepted! Head to the store.');
      setRiderPingOrder(null);
    } catch (err) {
      triggerToast(err.message || 'Error accepting order', {type:'error'});
    }
  };

  /**
   * Rider explicitly tapped Decline — not the offer timing out.
   *
   * The server is the source of truth: this clears the on-screen offer only
   * after the backend confirms the decline, and reconciles rather than
   * assuming success if the backend says the offer already moved on (taken,
   * expired, or already declined by an earlier tap that got through).
   */
  const declineOrder = async (order) => {
    const orderId = order?.orderId || order?._id;
    if (!orderId) return;

    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${orderId}/decline`), {
        method: 'POST',
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The offer already resolved one way or another (taken, expired,
        // already declined) — either way it is no longer live, so it comes
        // off screen exactly as a successful decline would. The message
        // still tells the rider what actually happened rather than pretending
        // this tap was the one that mattered.
        triggerToast(body.message || 'Could not decline — this offer is no longer available.');
        setRiderPingOrder(null);
        return;
      }

      triggerToast('Order declined.');
      setRiderPingOrder(null);
    } catch (err) {
      triggerToast(err.message || 'Network error declining the order.', {type:'error'});
    }
  };

  /**
   * The offer window (OrderPingModal.PING_WINDOW_SECONDS) ran out — not the rider declining.
   *
   * Same shape as declineOrder above on purpose, hitting `/expire` instead
   * of `/decline`. The backend is still the source of truth: the offer only
   * comes off screen once it confirms OFFER_EXPIRED, or reports the offer
   * already resolved some other way (taken, expired earlier, declined by an
   * earlier tap that got through) — either way there is nothing left on
   * screen to show. A real network failure is the one case that must NOT
   * clear the offer: the backend never actually heard about the expiry, so
   * clearing here would just be a guess. Leaving it be lets the existing
   * 10s poll (`checkPendingPings`) reconcile it against the server next.
   */
  const expireOrder = async (order) => {
    const orderId = order?.orderId || order?._id;
    if (!orderId) return;

    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${orderId}/expire`), {
        method: 'POST',
        headers: authHeaders(),
      });

      if (!res.ok) {
        // Already resolved one way or another — no longer live either way,
        // so it comes off screen exactly as a confirmed expiry would.
        setRiderPingOrder(null);
        return;
      }

      setRiderPingOrder(null);
    } catch (err) {
      // Real network/server failure: the backend never confirmed the expiry,
      // so the offer stays on screen rather than being cleared on a guess.
      // The next poll (or another expiry attempt, if the rider is still
      // looking at it) reconciles the real state.
      console.error('Failed to expire offer:', err.message);
    }
  };

  /**
   * Rider explicitly cancels an already-accepted delivery, before pickup.
   *
   * Same reconciliation shape as declineOrder/expireOrder — the backend is
   * the only thing allowed to clear `activeOrder`. A genuine refusal (already
   * past pickup, already delivered, not this rider's delivery) re-syncs the
   * screen with `restoreActiveDelivery` — the same call already used to pick
   * a delivery back up after a reload — rather than leaving a stale
   * pickup-stage screen showing for a delivery that has actually moved on
   * elsewhere. A real network failure leaves `activeOrder` untouched, since
   * the backend never confirmed anything.
   */
  const cancelOrder = async (order) => {
    const orderId = order?.orderId || order?._id;
    if (!orderId) return;

    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${orderId}/cancel`), {
        method: 'POST',
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        triggerToast(body.message || 'Could not cancel this delivery.', {type:'error'});
        restoreActiveDelivery();
        return;
      }

      // Covers both "cancelled just now" and "was already cancelled" — the
      // backend reports both as success, and either way there is nothing
      // left on screen to show.
      triggerToast(body.message || 'Delivery cancelled.');
      setActiveOrder(null);
    } catch (err) {
      triggerToast(err.message || 'Network error cancelling the delivery.', {type:'error'});
    }
  };

  /** Shared plumbing for the three stage changes a rider reports. */
  const setDeliveryStage = async (stage, toast) => {
    if (!activeOrder) return false;
    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${activeOrder.orderId}/status`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: stage }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not update the delivery');

      setActiveOrder((prev) => ({ ...prev, stage }));
      if (toast) triggerToast(toast);
      return true;
    } catch (err) {
      triggerToast(err.message || 'Could not update the delivery', {type:'error'});
      return false;
    }
  };

  /** "I am at the shop" — the customer sees this on their map. */
  const markArrivedAtStore = () =>
    setDeliveryStage('arrived_at_store', 'Marked as arrived. Collect the order.');

  /** "I am at the customer's door" — unlocks asking for the code. */
  const markArrivedAtCustomer = () =>
    setDeliveryStage('arrived_at_customer', 'Marked as arrived. Ask the customer for their code.');

  /**
   * Ask the server to send the customer a delivery code.
   *
   * The response deliberately does not contain the code — it goes to the
   * customer's phone alone, which is the entire point of it. The rider has to
   * ask them for it.
   */
  const requestDeliveryOtp = async () => {
    if (!activeOrder) return false;
    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${activeOrder.orderId}/generate-otp`), {
        method: 'POST',
        headers: authHeaders(),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not send the code');

      setActiveOrder((prev) => ({ ...prev, otpSent: true }));
      triggerToast(body.message || 'Code sent to the customer. Ask them for it.');
      return true;
    } catch (err) {
      triggerToast(err.message || 'Could not send the code', {type:'error'});
      return false;
    }
  };

  const completePickup = async () => {
    if (!activeOrder) return;
    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${activeOrder.orderId}/status`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'picked_up' })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to complete pickup');

      setActiveOrder(prev => ({ ...prev, step: 'transit' }));
      triggerToast('Items picked up! Navigate to the customer.');
    } catch (err) {
      triggerToast(err.message || 'Error confirming pickup', {type:'error'});
    }
  };

  const verifyOTPAndComplete = async (enteredOtp) => {
    if (!activeOrder) return false;
    try {
      const res = await fetch(apiUrl(`/api/delivery/orders/${activeOrder.orderId}/verify-otp`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ otp: enteredOtp })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'OTP verification failed');

      /**
       * Every response from this API is `{ success, data, message, meta }`, so
       * the figure is at `data.earnings` and nowhere else. The previous read
       * tried `body.earnings` first — always undefined — and then fell back to a
       * literal 120 when that failed. A real ₹0 delivery is falsy too, so the
       * fallback could fire on a correct response and show the rider a payment
       * that never existed. There is no sensible default for someone's wages:
       * if the server did not say, we do not guess.
       */
      const reported = Number(body.data?.earnings);
      const earnings = Number.isFinite(reported) ? reported : null;

      // Same rule as the earnings figure above: reported by the server or not
      // shown at all. Already counted inside `earnings`.
      const reportedTip = Number(body.data?.tip);
      const tip = Number.isFinite(reportedTip) ? reportedTip : 0;

      if (earnings !== null) setPayoutBalance(prev => prev + earnings);
      if (activeOrder.paymentMethod === 'COD') {
        setDebitWallet(prev => prev + activeOrder.codAmount);
      }

      // Add to daily log
      const newTxn = {
        id: `TXN-${Math.floor(200 + Math.random() * 800)}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'Delivery Pay',
        orderId: activeOrder.orderId,
        amount: earnings,
        tip,
        isCod: activeOrder.paymentMethod === 'COD',
        codAmount: activeOrder.paymentMethod === 'COD' ? activeOrder.codAmount : undefined,
      };

      setEarningsData(prev => ({
        ...prev,
        // This trip is first-hand knowledge, so today's figure is now real —
        // until the page reloads and the server has no per-day answer to give.
        daily: {
          ...prev.daily,
          trips: prev.daily.trips + 1,
          total: prev.daily.total + (earnings ?? 0),
          tips: (prev.daily.tips || 0) + tip,
          breakdown: [newTxn, ...prev.daily.breakdown],
          available: true,
        },
        // Mirror the credit the server just wrote, so the lifetime card agrees
        // with the balance without waiting for the next profile fetch.
        lifetime: {
          ...prev.lifetime,
          trips: prev.lifetime.trips + 1,
          total: prev.lifetime.total + (earnings ?? 0),
          tips: (prev.lifetime.tips || 0) + tip,
        },
      }));

      stopLocationBroadcast();
      setActiveOrder(null);
      triggerToast(earnings === null
        ? 'Order delivered. Check your earnings screen for the payment.'
        : `Order Delivered successfully! Earned ₹${earnings}`);
      return true;
    } catch (err) {
      triggerToast(err.message || 'Error verifying OTP', {type:'error'});
      return false;
    }
  };

  return (
    <DeliveryContext.Provider value={{
      isOnboarded,
      setIsOnboarded,
      onboardingStep,
      setOnboardingStep,
      onboardingForm,
      setOnboardingForm,
      isOnline,
      setIsOnline: handleToggleOnline,
      debitWallet,
      setDebitWallet,
      payoutBalance,
      payoutHistory,
      payoutRequesting,
      fetchPayoutHistory,
      activeOrder,
      setActiveOrder,
      riderLocation,
      toastMessage,
      triggerToast,
      saveRiderLocation,
      riderAuthed,
      phoneVerified,
      bootstrapping,
      sessionError, retrySession: () => setSessionRetry(value => value + 1),
      saveRiderName,
      riderStatus,
      riderRejection,
      riderProfile,
      submitVehicle,
      submitAadhaar,
      submitServiceArea,
      submitApplication,
      refreshRiderStatus,
      riderName,
      setRiderName,
      riderPhone,
      setRiderPhone,
      sendRiderOtp,
      verifyRiderOtp,
      lookupAddress,
      logoutDelivery,
      settleDebitWallet,
      cashoutEarnings,
      acceptOrder,
      declineOrder,
      expireOrder,
      cancelOrder,
      fetchRiderHistory,
      completePickup,
      markArrivedAtStore,
      markArrivedAtCustomer,
      requestDeliveryOtp,
      verifyOTPAndComplete,
      earningsData,
      riderPingOrder,
      setRiderPingOrder,
      checkPendingPings,
      returnPickups,
      fetchReturnPickups,
      acceptReturnPickup,
      declineReturnPickup,
      generateReturnPickupOtp,
      verifyReturnPickupOtp,
      returnPickupPingOffer,
      expireReturnPickup
    }}>
      {children}
    </DeliveryContext.Provider>
  );
};
