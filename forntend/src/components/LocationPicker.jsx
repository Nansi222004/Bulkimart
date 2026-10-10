import React, { useState } from 'react';
import './LocationPicker.css';

/**
 * Captures a place — by GPS, or typed by hand.
 *
 * Shared, because three different people need the same thing: a rider pinning
 * where they start their day, a seller pinning their shop, and a shopper saving
 * a delivery address. It began inside the Delivery module and was lifted out
 * rather than copied.
 *
 * Both routes matter. The GPS button is the fast path, but somebody can deny the
 * permission prompt, be indoors with no fix, or be filling this in from another
 * city. None of those people should be stuck, so typing is a first-class option
 * rather than a fallback.
 *
 * The parent owns the value; this only reports changes upward. Reverse geocoding
 * is injected as `onLookup` so this component stays ignorant of which module's
 * API client it is running inside.
 *
 * @param {object}   value        { lat, lng, accuracy, source, address, landmark, city, state, pincode }
 * @param {function} onChange     receives the next value
 * @param {function} onLookup     async (lat, lng) => { ok, address } | { ok: false, message }
 * @param {string}   buttonLabel  wording for the GPS button
 * @param {string}   addressLabel wording for the street field
 */
export const LocationPicker = ({
  value = {},
  onChange,
  onLookup,
  disabled = false,
  buttonLabel = 'Use my current location',
  addressLabel = 'Address',
  hideCoords = false,
}) => {
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const set = (patch) => onChange({ ...value, ...patch });
  const field = (key) => (e) => set({ [key]: e.target.value });

  const hasFix =
    value.lat !== undefined && value.lat !== '' &&
    value.lng !== undefined && value.lng !== '';

  const useCurrentLocation = () => {
    setError('');
    setNotice('');

    if (!navigator.geolocation) {
      setError('This browser cannot read your location. Please type the address below.');
      return;
    }
    if (!window.isSecureContext) {
      setError('Location needs a secure (https) connection. Please type the address below.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const lat = Number(latitude.toFixed(6));
        const lng = Number(longitude.toFixed(6));

        const next = { ...value, lat, lng, accuracy: Math.round(accuracy), source: 'gps' };
        onChange(next);
        setLocating(false);

        let geocoded = null;
        if (onLookup) {
          setResolving(true);
          const res = await onLookup(lat, lng, Math.round(pos.coords.accuracy));
          setResolving(false);
          if (res?.ok) {
            geocoded = res.address;
          }
        }

        if (!geocoded) {
          setResolving(true);
          try {
            const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
            setResolving(false);
            if (nomRes.ok) {
              const data = await nomRes.json();
              const addr = data.address || {};
              const streetLine = [addr.house_number, addr.road, addr.suburb, addr.neighbourhood].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0, 2).join(', ') || '';
              geocoded = {
                address: streetLine,
                city: addr.city || addr.town || addr.village || addr.county || addr.state_district || '',
                state: addr.state || 'Uttar Pradesh',
                pincode: addr.postcode || ''
              };
            }
          } catch (e) {
            setResolving(false);
          }
        }

        if (geocoded) {
          onChange({
            ...next,
            address: geocoded.address || next.address || '',
            city: geocoded.city || next.city || '',
            state: geocoded.state || next.state || 'Uttar Pradesh',
            pincode: geocoded.pincode || next.pincode || '',
          });
          setNotice('Address filled in from your location.');
        } else {
          setNotice('Location captured. Please fill in any missing details below.');
        }
      },
      (err) => {
        setLocating(false);
        setNotice('');
        const messages = {
          1: 'You blocked location access. Allow it in your browser settings, or type the address below.',
          2: 'Your location could not be determined right now. Please type the address below.',
          3: 'Finding your location took too long. Try again, or type the address below.',
        };
        setError(messages[err.code] || 'Could not get your location. Please type the address below.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const clearFix = () => {
    const next = { ...value, source: 'manual' };
    delete next.lat;
    delete next.lng;
    delete next.accuracy;
    onChange(next);
    setNotice('');
  };

  const busy = disabled || resolving;

  return (
    <div className="nh-loc">
      <button
        type="button"
        className="nh-loc-gps"
        onClick={useCurrentLocation}
        disabled={disabled || locating || resolving}
      >
        {locating ? '📍 Finding you…' : resolving ? '📍 Looking up the address…' : `📍 ${buttonLabel}`}
      </button>

      {hasFix && !hideCoords && (
        <div className="nh-loc-fix">
          <div className="nh-loc-fix-head">
            <span className="nh-loc-badge">GPS</span>
            <span className="nh-loc-coords">
              {Number(value.lat).toFixed(5)}, {Number(value.lng).toFixed(5)}
            </span>
            <button type="button" className="nh-loc-clear" onClick={clearFix} disabled={busy}>
              Clear
            </button>
          </div>
          {value.accuracy !== undefined && (
            <p className="nh-loc-accuracy">
              Accurate to about {value.accuracy} m
              {value.accuracy > 100 && ' — move outdoors for a better fix'}
            </p>
          )}
        </div>
      )}

      {error && <p className="nh-loc-error">{error}</p>}
      {notice && !error && <p className="nh-loc-notice">{notice}</p>}

      <div className="nh-loc-divider">
        <span>{hasFix ? 'Confirm the address' : 'Or enter it manually'}</span>
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label">
          {addressLabel} {!hasFix && <span className="nh-loc-req">*</span>}
        </label>
        <input
          type="text"
          className="nh-loc-input"
          placeholder="House / shop no, street, area"
          value={value.address || ''}
          onChange={field('address')}
          disabled={busy}
        />
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label">Landmark</label>
        <input
          type="text"
          className="nh-loc-input"
          placeholder="e.g. opposite the bus depot"
          value={value.landmark || ''}
          onChange={field('landmark')}
          disabled={busy}
        />
      </div>

      <div className="nh-loc-row">
        <div className="nh-loc-group">
          <label className="nh-loc-label">City</label>
          <input
            type="text"
            className="nh-loc-input"
            placeholder="e.g. Nagpur"
            value={value.city || ''}
            onChange={field('city')}
            disabled={busy}
          />
        </div>
        <div className="nh-loc-group">
          <label className="nh-loc-label">State</label>
          <input
            type="text"
            className="nh-loc-input"
            placeholder="e.g. Maharashtra"
            value={value.state || ''}
            onChange={field('state')}
            disabled={busy}
          />
        </div>
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label">
          Pincode <span className="nh-loc-req">*</span>
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          className="nh-loc-input"
          placeholder="6 digits"
          value={value.pincode || ''}
          // Strip non-digits as they are typed, so the field can never hold
          // something the server will reject.
          onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          disabled={busy}
        />
      </div>
    </div>
  );
};

export default LocationPicker;
