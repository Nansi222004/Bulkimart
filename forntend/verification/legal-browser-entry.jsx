// Isolated browser fixture entry, never imported by the production application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import LegalServices, { ProviderWorkspace } from '../src/components/services/LegalServices';
import { LegalAdminWorkspace } from '../src/components/services/LegalAdminWorkspace';
localStorage.setItem('userToken', 'browser-fixture-only');
localStorage.setItem('adminToken', 'browser-fixture-only');
createRoot(document.getElementById('root')).render(window.location.pathname.startsWith('/legal-provider') ? <ProviderWorkspace /> : window.location.pathname.startsWith('/admin') ? <LegalAdminWorkspace /> : <LegalServices />);
