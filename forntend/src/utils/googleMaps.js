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
    const ready = () => finish(!window.google?.maps);
    const failed = () => finish(true);
    const timeout = setTimeout(failed, 12000);
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID; script.async = true; script.defer = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&libraries=geometry&v=weekly';
      document.head.appendChild(script);
    }
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
