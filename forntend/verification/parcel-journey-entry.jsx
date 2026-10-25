import React from 'react';
import { createRoot } from 'react-dom/client';
import { ParcelCustomerEntry } from '../src/components/parcels/ParcelDelivery';
import { HomeServiceEntries } from '../src/components/services/CustomerServices';
import { CustomerSessionContext } from '../src/utils/customerSession';
import '../src/index.css';
const fixture = await (await fetch('/__fixture/session')).json();
localStorage.setItem('userToken', fixture.token);
// Google SDK boundary only is simulated; Express auth, geocoding parsing,
// serviceability, pricing, quote persistence, booking and history are real.
window.__mapFixture = { markers: [], maps: [], routes: 0, suggestCalls: 0 };
const fixtureMaps = window.__mapFixture;
class Listener {
  constructor() { this.events = {}; }
  addListener(name, callback) { this.events[name] = callback; return { remove: () => delete this.events[name] }; }
}
class Map extends Listener {
  constructor(element) { super(); fixtureMaps.maps.push(this); this.element = element; element.innerHTML = '<div style="height:100%;display:grid;place-items:center;background:linear-gradient(25deg,#dcebea,#f1f6ed);color:#345267;font:14px sans-serif">Simulated Google Map • isolated test</div>'; }
  fitBounds() {} setZoom() {} setCenter() {}
}
class Marker extends Listener {
  constructor(options) { super(); this.options = options; fixtureMaps.markers.push(this); }
  setMap(value) { this.options.map = value; }
}
class LatLngBounds { extend() {} getCenter() { return { lat: 12.97, lng: 77.59 }; } }
class Polyline { constructor() { fixtureMaps.routes++; } setMap() {} }
window.google = { maps: { Map, Marker, LatLngBounds, Polyline, geometry: { encoding: { decodePath: () => [] } }, async importLibrary() { return {
  AutocompleteSessionToken: class {},
  AutocompleteSuggestion: { async fetchAutocompleteSuggestions() {
    fixtureMaps.suggestCalls++;
    return { suggestions: [{ placePrediction: { text: { toString: () => 'Synthetic drop, Bengaluru 560001' }, toPlace: () => ({ location: { lat: () => 12.98, lng: () => 77.60 }, formattedAddress: 'Synthetic drop, Bengaluru 560001', addressComponents: [{ longText: '560001', types: ['postal_code'] }], async fetchFields() {} }) } }] };
  } },
}; } } };
createRoot(document.getElementById('root')).render(window.location.pathname === '/' ? <HomeServiceEntries/> : <CustomerSessionContext.Provider value={{ verified: !window.location.search.includes('guest=1'), profile: fixture.profile }}><ParcelCustomerEntry/></CustomerSessionContext.Provider>);
