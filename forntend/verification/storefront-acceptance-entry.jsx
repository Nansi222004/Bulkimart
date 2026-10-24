import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
import StorefrontStudio from '../src/modules/Admin/components/StorefrontStudio';
import { AcceptanceUserContext } from '../src/modules/User/context/UserContext';
import { StorefrontProvider, useStorefront } from '../src/modules/User/context/StorefrontContext';
import HeroBanner from '../src/modules/User/components/HeroBanner';
import '../src/modules/User/Storefront.css';
function Customer() {
  const { loading, device } = useStorefront();
  return <><output id="experience-state">{loading ? 'loading' : device}</output><HeroBanner /></>;
}
function App() {
  const [activeNav, setActiveNav] = useState('home'), [selectedCampaignId, setSelectedCampaignId] = useState(null);
  window.__acceptanceNavigate = patch => { if (patch.activeNav) setActiveNav(patch.activeNav); setSelectedCampaignId(patch.selectedCampaignId || null); };
  return <FeedbackProvider>{location.pathname.endsWith('/admin') ? <StorefrontStudio /> :
    <AcceptanceUserContext.Provider value={{ activeMode: 'quick', activeSubNav: 'grocery--home', activeNav, selectedCampaignId, setActiveNav, setSelectedCampaignId }}><StorefrontProvider><Customer /></StorefrontProvider></AcceptanceUserContext.Provider>}
  </FeedbackProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
