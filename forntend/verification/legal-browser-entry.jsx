// Isolated browser fixture entry, never imported by the production application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import LegalServices from '../src/components/services/LegalServices';
import AdminServicesWorkspace from '../src/components/services/LegalAdminWorkspace';
import ServicesPanel from '../src/components/services/ServicesPanel';
localStorage.setItem('userToken', 'browser-fixture-only');
localStorage.setItem('adminToken', 'browser-fixture-only');
localStorage.setItem('sellerToken', 'browser-fixture-only');
createRoot(document.getElementById('root')).render(window.location.pathname.startsWith('/seller') ? <ServicesPanel /> : window.location.pathname.startsWith('/admin') ? <AdminServicesWorkspace /> : <LegalServices />);
