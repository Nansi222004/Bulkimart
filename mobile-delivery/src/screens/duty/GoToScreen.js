import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import { openNavigation } from '../../components/NavigateButtons';
import { useToast } from '../../components/Toast';
import { useDuty } from '../../context/DutyContext';
import * as deliveryApi from '../../services/delivery.api';
import { getCurrentPoint } from '../../services/geo';
import { formatTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Go To (destination) mode. The rider picks where they are heading; while it is on they
 * get only orders whose pickup and drop are along that route, in their direction.
 * The admin sets how many times a day it can be used and how strict "along the route" is.
 */
export default function GoToScreen({ navigation }) {
  const toast = useToast();
  const duty = useDuty();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [chosen, setChosen] = useState(null); // { lat, lng, address }
  const [busy, setBusy] = useState(false);
  const near = useRef(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', data: await deliveryApi.getGoTo() }); }
    catch (e) { setState((s) => ({ ...s, loading: false, error: e.message || 'Could not load Go To.' })); }
  }, []);
  useEffect(() => { load(); return navigation.addListener('focus', load); }, [navigation, load]);
  // Suggestions near the rider first.
  useEffect(() => { getCurrentPoint({ ask: false }).then((fix) => { if (fix.ok) near.current = fix.point; }); }, []);

  // Type-ahead, after a short pause.
  useEffect(() => {
    const text = query.trim();
    if (chosen && text === chosen.address) return undefined;
    if (text.length < 3) { setSuggestions([]); setSearchError(''); return undefined; }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        // Places within 50 km of the rider only: Go To is a trip home or across town, not to another city.
        const list = await deliveryApi.suggestPlaces(text, near.current, 50);
        if (seq === searchSeq.current) { setSuggestions(list); setSearchError(list.length ? '' : 'No places found. Try a nearby landmark or area name.'); }
      } catch (e) {
        if (seq === searchSeq.current) setSearchError(e.message || 'Place search is unavailable right now.');
      } finally { if (seq === searchSeq.current) setSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [query, chosen]);

  const pick = async (s) => {
    const address = [s.main, s.secondary].filter(Boolean).join(', ');
    setSuggestions([]); setQuery(address); setBusy(true);
    try { const p = await deliveryApi.placeById(s.placeId); setChosen({ lat: p.lat, lng: p.lng, address }); }
    catch (e) { setChosen(null); toast.show(e.message || 'Could not find that place. Choose another.', 'error'); }
    finally { setBusy(false); }
  };

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const fix = await getCurrentPoint({ ask: true });
      if (!fix.ok) { toast.show(fix.message, 'error'); return; }
      const data = await deliveryApi.startGoTo({ origin: fix.point, destination: { lat: chosen.lat, lng: chosen.lng }, address: chosen.address });
      setState({ loading: false, error: '', data });
      setChosen(null); setQuery('');
      toast.show('Go To is on. You will get orders along your route.', 'success');
    } catch (e) {
      toast.show(e.message || 'Could not start Go To.', 'error');
      load();
    } finally { setBusy(false); }
  };

  const stop = () => Alert.alert('Stop Go To?', 'You will get normal nearby orders again. This does not give back today’s use.', [
    { text: 'Keep it on', style: 'cancel' },
    { text: 'Stop Go To', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { setState({ loading: false, error: '', data: await deliveryApi.stopGoTo() }); toast.show('Go To is off.', 'success'); }
      catch (e) { toast.show(e.message || 'Could not stop Go To.', 'error'); }
      finally { setBusy(false); }
    } },
  ]);

  if (state.loading) return <LoadingView />;
  if (state.error && !state.data) return <ErrorView message={state.error} onRetry={load} />;
  const d = state.data;
  const active = d.active;

  return (
    <Screen>
      <View>
        <Text style={type.title}>Go To</Text>
        <Text style={type.small}>Heading somewhere? Set your destination and get only the orders that are on your way, in your direction.</Text>
      </View>

      {!d.enabled ? <InlineNotice tone="warning">Go To is turned off by Bulkimart right now.</InlineNotice> : null}

      {active ? (
        <Card style={styles.activeCard}>
          <Text style={styles.activeLabel}>GO TO IS ON</Text>
          <Text style={type.heading}>{active.destination.address || 'Your destination'}</Text>
          <Text style={type.small}>{active.routeKm ? `About ${active.routeKm} km by road · ` : ''}Switches off at {formatTime(active.expiresAt)} or when you arrive.</Text>
          {!duty.online ? <InlineNotice tone="warning">You are offline. Go online on the Home screen to receive on-the-way orders.</InlineNotice> : null}
          <AppButton title="Open route in Google Maps" variant="outline" onPress={() => openNavigation({ point: active.destination, address: active.destination.address }, toast)} />
          <AppButton title="Stop Go To" variant="danger" loading={busy} onPress={stop} />
        </Card>
      ) : d.enabled ? (
        <Card title="Where are you going?">
          <Text style={type.small}>Uses left today: {d.remainingToday} of {d.dailyLimit}</Text>
          {d.remainingToday <= 0 ? <InlineNotice tone="warning">You have used Go To {d.dailyLimit} time{d.dailyLimit === 1 ? '' : 's'} today. Try again tomorrow.</InlineNotice> : (
            <>
              <AppInput label="Destination" placeholder="Search an area, landmark or address" value={query}
                onChangeText={(t) => { setQuery(t); if (chosen && t !== chosen.address) setChosen(null); }} autoCorrect={false}
                hint={searching ? 'Searching…' : searchError || (query.trim().length < 3 ? 'Type at least 3 letters.' : suggestions.length ? 'Choose your destination below.' : undefined)} />
              {suggestions.map((s) => (
                <Pressable key={s.placeId} onPress={() => pick(s)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]} accessibilityRole="button">
                  <Text style={styles.suggestionMain}>{s.main}</Text>
                  {s.secondary ? <Text style={type.small}>{s.secondary}</Text> : null}
                </Pressable>
              ))}
              {chosen ? <InlineNotice tone="info">Going to: {chosen.address}</InlineNotice> : null}
              <AppButton title="Start Go To" loading={busy} disabled={!chosen || busy} onPress={start} />
              <Text style={type.small}>Orders must have the pickup and the drop within about {d.corridorKm} km of your road. Go To switches off after {d.maxDurationMinutes} minutes or when you arrive.</Text>
            </>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  activeCard: { borderWidth: 2, borderColor: colors.success, backgroundColor: colors.successLight, gap: spacing.sm },
  activeLabel: { fontSize: 13, fontWeight: '800', color: '#166534', letterSpacing: 0.5 },
  suggestion: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  pressed: { backgroundColor: colors.surface },
  suggestionMain: { fontSize: 15, fontWeight: '700', color: colors.text },
});
