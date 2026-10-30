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
                state: addr.state || '',
                pincode: addr.postcode || '',
                formatted: data.display_name || ''
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
            state: geocoded.state || next.state || '',
            pincode: geocoded.pincode || next.pincode || '',
            formatted: geocoded.formatted || next.formatted || '',
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
          1: 'Location access is required. Please allow location permission for this site and turn on your device location, then try again — or type the address below.',
          2: 'Location is required. Your device location looks turned off — please turn it on (GPS / Location) and try again, or type the address below.',
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
    delete next.formatted;
    onChange(next);
    setNotice('');
  };

  const busy = disabled || resolving;

  const fullLocationText = value.formatted || [
    value.address,
    value.landmark,
    value.city,
    value.state && value.pincode ? `${value.state} - ${value.pincode}` : (value.state || value.pincode)
  ].filter(Boolean).join(', ');

  return (
    <div className="nh-loc" autoComplete="off">
      <button
        type="button"
        className="nh-loc-gps"
        onClick={useCurrentLocation}
        disabled={disabled || locating || resolving}
      >
        {locating ? '📍 Finding you…' : resolving ? '📍 Looking up the address…' : `📍 ${buttonLabel}`}
      </button>

      {hasFix && (
        <div className="nh-loc-fix">
          <div className="nh-loc-fix-head">
            <span className="nh-loc-badge">📍 Pinned Location</span>
            <button type="button" className="nh-loc-clear" onClick={clearFix} disabled={busy}>
              Clear
            </button>
          </div>
          <div className="nh-loc-full-text">
            {fullLocationText ? (
              <span>{fullLocationText}</span>
            ) : (
              <span className="nh-loc-pending-text">Location pinned — confirm or enter address details below</span>
            )}
          </div>
          {!hideCoords && (
            <div className="nh-loc-coords-sub">
              GPS: {Number(value.lat).toFixed(5)}, {Number(value.lng).toFixed(5)}
              {value.accuracy !== undefined && ` (±${value.accuracy}m)`}
            </div>
          )}
        </div>
      )}

      {error && <p className="nh-loc-error">{error}</p>}
      {notice && !error && <p className="nh-loc-notice">{notice}</p>}

      <div className="nh-loc-divider">
        <span>{hasFix ? 'Confirm or edit the address' : 'Or enter it manually'}</span>
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label" htmlFor="nh-loc-address">
          {addressLabel} {!hasFix && <span className="nh-loc-req">*</span>}
        </label>
        <input
          id="nh-loc-address"
          type="text"
          className="nh-loc-input"
          placeholder="House / shop / building name, street, area"
          value={value.address || ''}
          onChange={field('address')}
          disabled={busy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label" htmlFor="nh-loc-landmark">Landmark</label>
        <input
          id="nh-loc-landmark"
          type="text"
          className="nh-loc-input"
          placeholder="Landmark (optional)"
          value={value.landmark || ''}
          onChange={field('landmark')}
          disabled={busy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>

      <div className="nh-loc-row">
        <div className="nh-loc-group">
          <label className="nh-loc-label" htmlFor="nh-loc-city">City</label>
          <input
            id="nh-loc-city"
            type="text"
            className="nh-loc-input"
            placeholder="City / district"
            value={value.city || ''}
            onChange={field('city')}
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>
        <div className="nh-loc-group">
          <label className="nh-loc-label" htmlFor="nh-loc-state">State</label>
          <input
            id="nh-loc-state"
            type="text"
            className="nh-loc-input"
            placeholder="State"
            value={value.state || ''}
            onChange={field('state')}
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>
      </div>

      <div className="nh-loc-group">
        <label className="nh-loc-label" htmlFor="nh-loc-pincode">
          Pincode <span className="nh-loc-req">*</span>
        </label>
        <input
          id="nh-loc-pincode"
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
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>
    </div>
  );
};

export default LocationPicker;
