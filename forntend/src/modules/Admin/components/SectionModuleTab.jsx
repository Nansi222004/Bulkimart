import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

export const SectionModuleTab = ({ moduleId }) => {
  const {
    triggerToast,
    customerOrders, customerOrdersLoading, fetchCustomerOrders,
  } = useAdmin();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    if (moduleId === 'ecom-orders') {
      fetchCustomerOrders({ type: 'ecommerce' });
    } else if (moduleId === 'qcom-orders') {
      fetchCustomerOrders({ type: 'grocery' });
    }
  }, [moduleId, fetchCustomerOrders]);

  // SECTION DEFINITIONS — columns describe the generic table shell for each
  // tab; `data` starts empty for every one of them, since none of these ~35
  // sub-modules (vendor sales ledgers, delivery zones, ad requests, etc.) has
  // a backend endpoint yet. The generic table below already renders "No
  // matching records found." when empty.
  const moduleConfigs = {
    // 'user-dashboard' used to be a mock/generic row here. It is now a real,
    // dedicated screen (ConsumerDashboardTab, routes/index.jsx), wired in
    // before this component is ever reached for that tab.

    // 'user-activity' used to be a mock/generic row here. It is now a real,
    // dedicated screen (CustomerActivityLogTab, routes/index.jsx), wired in
    // before this component is ever reached for that tab.

    'users': {
      title: 'Customer User Registry',
      desc: 'Manage all customer profiles and account activities.',
      columns: ['User ID', 'Customer Name', 'Contact Email', 'Phone', 'Orders', 'Status'],
      data: []
    },

    'seller-promotions': {
      title: 'Seller Promotions & Ad Campaigns',
      desc: 'Sponsored product priority rankings and homepage banner ad placements.',
      columns: ['Campaign ID', 'Seller Name', 'Promotion Type', 'Duration', 'Budget', 'Status'],
      data: []
    },

    // GENERAL VENDORS EXTENDED MODULES
    'stores-all': {
      title: 'All Registered Vendor Stores',
      desc: 'Complete directory of storefronts, registered physical shops, and dark stores.',
      columns: ['Store ID', 'Store Name', 'Owner / Vendor', 'Location / Hub', 'Total Products', 'Rating', 'Status'],
      data: []
    },

    'stores-approval': {
      title: 'Store Approval Queue',
      desc: 'Audit GST, shop photos, and FSSAI licenses for newly submitted vendor storefronts.',
      columns: ['App ID', 'Proposed Store Name', 'Vendor Holder', 'FSSAI / GST No', 'Submitted Date', 'Status'],
      data: []
    },

    'stores-status': {
      title: 'Store Operational Status Monitoring',
      desc: 'Real-time online/offline toggle, order acceptance status, and suspension controls.',
      columns: ['Store ID', 'Store Name', 'Operational Mode', 'Auto-Accept Orders', 'Avg Prep Time', 'Status'],
      data: []
    },

    'vendor-products': {
      title: 'Vendor Product Catalog',
      desc: 'Audit, edit, approve, or flag products uploaded by general marketplace sellers.',
      columns: ['Product SKU', 'Item Title', 'Vendor Store', 'Category', 'MRP / Price', 'Stock Level', 'Status'],
      data: []
    },

    'vendor-inventory': {
      title: 'Vendor Stock & Inventory Control',
      desc: 'Warehouse sync, stock replenishment alerts, and vendor stock audit logs.',
      columns: ['Inventory ID', 'Product Title', 'Vendor Store', 'Stock Reserved', 'Stock Available', 'Restock Alert', 'Status'],
      data: []
    },

    'vendor-orders': {
      title: 'Live Vendor Orders Pipeline',
      desc: 'Active orders placed with vendor stores awaiting dispatch or courier pick up.',
      columns: ['Order Ref', 'Store Name', 'Customer', 'Order Items', 'Total Amount', 'Fulfillment Partner', 'Status'],
      data: []
    },

    'vendor-order-history': {
      title: 'Vendor Historical Order Logs',
      desc: 'Archive of past completed, delivered, and cancelled vendor marketplace orders.',
      columns: ['Order Ref', 'Store Name', 'Customer', 'Order Date', 'Order Value', 'Payment Mode', 'Status'],
      data: []
    },

    'vendor-sales': {
      title: 'Vendor Sales Analytics & Ledger',
      desc: 'Track sales volume, SKU-wise performance, and gross merchandise value (GMV).',
      columns: ['Record ID', 'Vendor Store', 'Sales Volume (Month)', 'Gross GMV', 'Units Sold', 'Top Category', 'Trend'],
      data: []
    },

    'vendor-earnings': {
      title: 'Vendor Commission & Net Earnings',
      desc: 'Calculate vendor payouts, platform commission deductions, and tax withholdings.',
      columns: ['Vendor ID', 'Store Name', 'Gross Revenue', 'Platform Fee (5%)', 'GST (18%)', 'Net Payable', 'Status'],
      data: []
    },

    'vendor-payouts': {
      title: 'Vendor Payout Disbursal Queue',
      desc: 'Approve bank transfers and automated UPI batch payouts to verified vendor bank accounts.',
      columns: ['Payout Ref', 'Vendor Store', 'Bank Account / UPI', 'Amount (₹)', 'Cycle Period', 'Disbursal Date', 'Status'],
      data: []
    },

    'vendor-performance': {
      title: 'Vendor Quality Scorecards & SLA',
      desc: 'Monitor order cancellation rates, late shipment penalties, and customer satisfaction index.',
      columns: ['Vendor ID', 'Store Name', 'Fulfillment Rate', 'Cancellation %', 'Return %', 'Quality Score', 'Badge Tier'],
      data: []
    },

    'vendor-ratings-reviews': {
      title: 'Vendor Ratings & Customer Reviews',
      desc: 'Moderate feedback ratings and reviews submitted by customers for vendor stores.',
      columns: ['Review ID', 'Store Name', 'Customer Name', 'Rating', 'Review Comment', 'Date', 'Status'],
      data: []
    },

    'vendor-ad-requests': {
      title: 'Vendor Advertisement Requests',
      desc: 'Review and approve vendor banner ad submissions for mobile app placements.',
      columns: ['Ad Request ID', 'Store Name', 'Ad Slot Placement', 'Duration', 'Budget', 'Banner Asset', 'Status'],
      data: []
    },

    'vendor-featured-seller': {
      title: 'Featured Seller Spotlight Slots',
      desc: 'Manage sellers pinned to the top of homepage spotlight section.',
      columns: ['Spotlight ID', 'Store Name', 'Category Spotlight', 'Placement Rank', 'Start Date', 'End Date', 'Status'],
      data: []
    },

    'vendor-sponsored-products': {
      title: 'Sponsored Product Search Bidding',
      desc: 'Keywords and search term boosting campaigns configured by general vendors.',
      columns: ['Campaign ID', 'Product Name', 'Store Name', 'Target Keyword', 'Bid CPC', 'Impressions', 'Status'],
      data: []
    },

    'inventory': {
      title: 'Inventory & Stock Control',
      desc: 'Monitor real-time warehouse and local dark-store stock levels and reorder warnings.',
      columns: ['SKU Code', 'Item Name', 'Warehouse / Hub', 'Current Stock', 'Min Threshold', 'Reorder Status'],
      data: []
    },

    'ecom-orders': {
      title: 'E-Commerce Orders Log',
      desc: 'National shipments dispatched via third-party logistics courier partners.',
      columns: ['Order ID', 'Customer', 'Items', 'Total Amount', 'Courier Partner', 'Tracking #', 'Status'],
      data: moduleId === 'ecom-orders' ? customerOrders.map((o) => ({
        id: o._id,
        customer: o.userId?.name || o.userId?.phone || 'Customer',
        items: (o.items || []).length,
        amount: `₹${(o.payment?.totalAmount || 0).toLocaleString('en-IN')}`,
        courier: o.shiprocket?.courier || '—',
        tracking: o.shiprocket?.awb || '—',
        status: o.status,
      })) : []
    },

    'qcom-orders': {
      title: 'Quick Commerce Express Orders',
      desc: '30-minute instant delivery orders served by local dark store hubs.',
      columns: ['Order ID', 'Customer', 'Local Hub', 'Rider Partner', 'Est SLA', 'Amount', 'Status'],
      data: moduleId === 'qcom-orders' ? customerOrders.map((o) => ({
        // Rider assignment lives on the separate Delivery record, not here —
        // out of scope for this pass, so shown as not tracked rather than a
        // wrong-looking ID.
        id: o._id,
        customer: o.userId?.name || o.userId?.phone || 'Customer',
        hub: '—',
        rider: 'See Delivery Fleet',
        eta: o.delivery?.promisedBy ? new Date(o.delivery.promisedBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
        amount: `₹${(o.payment?.totalAmount || 0).toLocaleString('en-IN')}`,
        status: o.status,
      })) : []
    },

    'subscriptions': {
      title: 'Subscription Plans & Daily Orders',
      desc: 'Manage recurring daily/weekly grocery & dairy deliveries.',
      columns: ['Sub ID', 'Customer', 'Subscribed Product', 'Frequency', 'Duration Plan', 'Next Delivery', 'Status'],
      data: []
    },

    'delivery-partners': {
      title: 'Delivery Fleet Drivers',
      desc: 'Registered delivery riders, vehicle types, and active zone assignments.',
      columns: ['Rider ID', 'Rider Name', 'Vehicle Type', 'Active Zone', 'Phone', 'Orders Today', 'Status'],
      data: []
    },

    'notifications': {
      title: 'Push Notifications Broadcaster',
      desc: 'Broadcast SMS, Email, and Push alerts to customers and sellers.',
      columns: ['Notif ID', 'Alert Title', 'Target Audience', 'Channel Type', 'Sent Time', 'Open Rate', 'Status'],
      data: []
    },

    'app-settings': {
      title: 'Platform Commission & App Configs',
      desc: 'System parameters, commission percentages, and payment gateway keys.',
      columns: ['Config Key', 'Parameter Name', 'Category', 'Current Value', 'Last Modified', 'Action'],
      data: []
    },

    'reports': {
      title: 'Platform Analytics & Reports',
      desc: 'Download exportable CSV and PDF performance auditing statements.',
      columns: ['Report Code', 'Report Description', 'Data Range', 'Format', 'Generated Date', 'Status'],
      data: []
    }
  };

  const currentConfig = moduleConfigs[moduleId] || {
    title: `${moduleId.toUpperCase()} Module`,
    desc: 'Manage entries and parameters for this module.',
    columns: ['ID', 'Title / Name', 'Category / Type', 'Date', 'Status'],
    data: []
  };

  // Filter rows
  const filteredData = currentConfig.data.filter(row => {
    const rowStr = JSON.stringify(row).toLowerCase();
    const matchesSearch = rowStr.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || (row.status && row.status.toLowerCase().includes(statusFilter.toLowerCase()));
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ padding: '20px 24px' }}>
      
      {/* Top Section Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>{currentConfig.title}</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {currentConfig.data.length} Total Records
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>{currentConfig.desc}</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="sa-btn-primary" onClick={() => triggerToast(`Add item form opened for ${currentConfig.title}...`)}>
            + Add New Entry
          </button>
          <button className="sa-btn-primary" style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }} onClick={() => triggerToast(`Exporting ${currentConfig.title} as CSV...`)}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Action Row: Search & Status Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder={`Filter ${currentConfig.title.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Active">Active / Approved</option>
          <option value="Pending">Pending Review</option>
          <option value="Delivered">Delivered / Sent</option>
        </select>
      </div>

      {/* Data Table Container */}
      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {currentConfig.columns.map((col, idx) => (
                <th key={idx} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {col}
                </th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={currentConfig.columns.length + 1} style={{ padding: '30px', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
                  No matching records found.
                </td>
              </tr>
            ) : (
              filteredData.map((row, rowIdx) => {
                const rowKeys = Object.keys(row);
                return (
                  <tr key={rowIdx} style={{ borderBottom: rowIdx === filteredData.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                    {rowKeys.map((k, colIdx) => {
                      const val = row[k];
                      if (k === 'status') {
                        const statusClass = val.toLowerCase().replace(/\s+/g, '-');
                        return (
                          <td key={colIdx} style={{ padding: '12px 16px' }}>
                            <span className={`sa-status-pill ${statusClass}`}>{val}</span>
                          </td>
                        );
                      }
                      return (
                        <td key={colIdx} style={{ padding: '12px 16px', fontWeight: colIdx === 1 ? 800 : 600, color: colIdx === 1 ? 'var(--sa-text-primary)' : 'var(--sa-text-secondary)' }}>
                          {val}
                        </td>
                      );
                    })}
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => setSelectedRow(row)}>
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* DETAILED RECORD DRAWER / MODAL SHEET */}
      {selectedRow && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: '520px' }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Record Information Sheet</h3>
              <button className="admin-modal-close" onClick={() => setSelectedRow(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.keys(selectedRow).map(key => (
                <div key={key} className="admin-item-row" style={{ padding: '4px 0' }}>
                  <span className="admin-item-label" style={{ textTransform: 'capitalize' }}>{key}</span>
                  <span className="admin-item-value" style={{ fontWeight: 800 }}>{String(selectedRow[key])}</span>
                </div>
              ))}

              <hr style={{ borderColor: 'var(--sa-border)', margin: '8px 0' }} />

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="sa-btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { triggerToast('Record status updated.'); setSelectedRow(null); }}>
                  ✓ Update Status
                </button>
                <button className="sa-btn-primary" style={{ flex: 1, justifyContent: 'center', backgroundColor: '#ffffff', color: 'var(--sa-error)', border: '1px solid var(--sa-error)' }} onClick={() => { triggerToast('Record deleted.'); setSelectedRow(null); }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

    </div>
  );
};

export default SectionModuleTab;
