import React from 'react';
import { createRoot } from 'react-dom/client';
import ReportsTab from '../src/modules/Admin/components/ReportsTab';
import '../src/modules/Admin/SuperAdmin.css';
import '../src/modules/Admin/Admin.css';

// The real Reports screen inside the admin frame's own structure (see
// Admin/routes/index.jsx): a full-height container that does not scroll, and a
// workspace whose inner area does. Layout bugs that stretch the page show up here.
createRoot(document.getElementById('root')).render(
  <div className="sa-layout-container">
    <div className="sa-workspace">
      <div data-report-scroller style={{ flex: 1, overflowY: 'auto' }}><ReportsTab /></div>
    </div>
  </div>,
);
