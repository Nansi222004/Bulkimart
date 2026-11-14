const SCRIPT_ID = 'google-maps-js';
let loadPromise;

// Shared by shopping tracking and parcel booking. A failed load can be retried.
export function loadGoogleMaps(apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error('The map is unavailable. Search or enter the address instead.'));
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing || document.createElement('script');
    const finish = error => {
      clearTimeout(timeout);
      script.removeEventListener('load', ready);
      script.removeEventListener('error', failed);
      if (error) { script.remove(); reject(new Error('The map could not load. Try again or search for the address.')); }
      else resolve(window.google.maps);
    };
    // Google's recommended async loading: the script calls back when ready, then the libraries
    // we use (map, markers, polyline geometry) are imported before anyone draws a map.
    const ready = async () => {
      try {
        const maps = window.google?.maps;
        if (!maps?.importLibrary) { finish(true); return; }
        await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker'), maps.importLibrary('geometry')]);
        finish(!window.google?.maps?.Map);
      } catch { finish(true); }
    };
    const failed = () => finish(true);
    const timeout = setTimeout(failed, 12000);
    window.__bulkimartMapsReady = ready;
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID; script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&libraries=geometry&v=weekly&loading=async&callback=__bulkimartMapsReady';
      document.head.appendChild(script);
    } else if (window.google?.maps?.importLibrary) ready();
  }).catch(error => { loadPromise = null; throw error; });
  return loadPromise;
}

export async function parcelPlaceSuggestions(input, sessionToken) {
  const maps = await loadGoogleMaps();
  const places = await maps.importLibrary('places');
  const token = sessionToken || new places.AutocompleteSessionToken();
  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: token, includedRegionCodes: ['in'] });
  return { token, suggestions: suggestions.filter(s => s.placePrediction).map(s => ({ text: s.placePrediction.text.toString(), prediction: s.placePrediction })) };
}

export async function resolveParcelPlace(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents'] });
  const pin = place.addressComponents?.find(c => c.types.includes('postal_code'))?.longText;
  return { lat: place.location?.lat(), lng: place.location?.lng(), address: place.formattedAddress || '', pincode: /^\d{6}$/.test(pin || '') ? pin : '', approximate: false };
}
