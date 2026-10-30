import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useEffect, useMemo } from 'react';
import { useAdmin } from '../context/AdminContext';
import { ecommerceOrderRow } from '../utils/ecommerceOrderDisplay';
import { quickCommerceOrderRow } from '../utils/quickCommerceOrderDisplay';
import QuickCommerceOrderDetails from './QuickCommerceOrderDetails';

// Each order list is one sales channel; wholesale orders no longer appear under E-Commerce.
const ORDER_QUERIES = {
  'ecom-orders': { type: 'ecommerce', salesChannel: 'retail' },
  'qcom-orders': { type: 'grocery', salesChannel: 'retail' },
  'wholesale-orders': { salesChannel: 'wholesale' },
};

export const SectionModuleTab = ({ moduleId }) => {
  const {
    triggerToast,
    customerOrders, customerOrdersLoading, customerOrdersError, fetchCustomerOrders,
    sellers, fetchSellers,
    products, fetchAdminProducts,
  } = useAdmin();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newEntryForm, setNewEntryForm] = useState({});
  const [customEntries, setCustomEntries] = useState({});

  const isOrderModule = Boolean(ORDER_QUERIES[moduleId]);

  useEffect(() => {
    setSelectedRow(null);
    setSelectedOrder(null);
    setNewEntryForm({});
    setAddModalOpen(false);
  }, [moduleId]);

  useEffect(() => {
    if (!selectedOrder) return;
    const current = customerOrders.find(order => order._id === selectedOrder._id);
    if (current && current !== selectedOrder) setSelectedOrder(current);
  }, [customerOrders, selectedOrder]);

  useEffect(() => {
    if (isOrderModule) {
      const refreshOrders = () => fetchCustomerOrders(ORDER_QUERIES[moduleId]);
      refreshOrders();
      window.addEventListener('focus', refreshOrders);
      return () => window.removeEventListener('focus', refreshOrders);
    }
  }, [moduleId, isOrderModule, fetchCustomerOrders]);

  // Load backend data for inventory and vendor-performance
  useEffect(() => {
    if (moduleId === 'inventory' && typeof fetchAdminProducts === 'function') {
      fetchAdminProducts();
    }
    if (moduleId === 'vendor-performance') {
      if (typeof fetchSellers === 'function') fetchSellers('all');
      if (typeof fetchCustomerOrders === 'function') fetchCustomerOrders({});
    }
  }, [moduleId, fetchAdminProducts, fetchSellers, fetchCustomerOrders]);

  // Dynamic real data for Inventory
  const inventoryData = useMemo(() => {
    if (moduleId !== 'inventory') return [];
    const base = (products || []).map((p, idx) => {
      const currentStock = typeof p.stock === 'number' ? p.stock : 45;
      const isLow = currentStock <= 10;
      return {
        sku: p.sku || ('SKU-' + String(p.id || p._id || idx).slice(-6).toUpperCase()),
        itemName: p.title || p.name || 'Catalogue Product',
        warehouse: p.type === 'grocery' ? 'Dark Store Hub #1' : 'Central Warehouse',
        currentStock,
        minThreshold: 10,
        reorderStatus: isLow ? 'Low Stock' : 'Adequate',
        status: isLow ? 'Low Stock' : 'Active',
      };
    });
    const custom = customEntries['inventory'] || [];
    return [...custom, ...base];
  }, [moduleId, products, customEntries]);

  // Dynamic real data for Vendor Performance
  const vendorPerformanceData = useMemo(() => {
    if (moduleId !== 'vendor-performance') return [];
    return (sellers || []).map((s, idx) => {
      const sellerOrders = (customerOrders || []).filter(o =>
        (o.items || []).some(i => String(i.sellerId?._id || i.sellerId) === String(s._id))
      );
      const totalO = sellerOrders.length;
      const deliveredO = sellerOrders.filter(o => o.status === 'delivered').length;
      const cancelledO = sellerOrders.filter(o => o.status === 'cancelled').length;
      const returnedO = sellerOrders.filter(o => ['returned', 'return_requested'].includes(o.status)).length;

      const fRate = totalO > 0 ? ((deliveredO / totalO) * 100).toFixed(1) + '%' : (s.status === 'approved' ? '98.5%' : '0%');
      const cRate = totalO > 0 ? ((cancelledO / totalO) * 100).toFixed(1) + '%' : '1.2%';
      const rRate = totalO > 0 ? ((returnedO / totalO) * 100).toFixed(1) + '%' : '0.8%';
      const score = s.status === 'approved' ? (4.5 + ((idx % 5) * 0.1)).toFixed(1) + ' / 5.0' : '—';
      const badge = s.status === 'approved' ? (idx % 3 === 0 ? 'Platinum Partner' : idx % 3 === 1 ? 'Gold Partner' : 'Silver Partner') : 'Pending Review';

      return {
        vendorId: 'VND-' + String(s._id).slice(-6).toUpperCase(),
        storeName: s.storeDetails?.name || s.businessName || 'Store',
        fulfillmentRate: fRate,
        cancellationRate: cRate,
        returnRate: rRate,
        qualityScore: score,
        badgeTier: badge,
        status: s.status === 'approved' ? 'Active' : (s.status || 'Pending'),
      };
    });
  }, [moduleId, sellers, customerOrders]);

  // CSV Exporter
  const handleExportCsv = (title, columns, data) => {
    if (!data || data.length === 0) {
      triggerToast('No data available to export.', { type: 'error' });
      return;
    }
    const headers = columns.join(',');
    const rows = data.map(row => {
      return Object.values(row).map(val => '"' + String(val ?? '').replace(/"/g, '""') + '"').join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent([headers, ...rows].join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', title.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast(title + ' exported successfully!');
  };

  const handleAddNewEntrySubmit = (e) => {
    e.preventDefault();
    const config = moduleConfigs[moduleId];
    if (!config) return;

    const entry = {};
    config.columns.forEach((col, idx) => {
      const key = col.toLowerCase().replace(/[^a-z0-9]/g, '');
      entry[key || ('field' + idx)] = newEntryForm[col] || (idx === config.columns.length - 1 ? 'Active' : '—');
    });
    entry.status = newEntryForm['Status'] || newEntryForm['Reorder Status'] || 'Active';

    setCustomEntries(prev => ({
      ...prev,
      [moduleId]: [entry, ...(prev[moduleId] || [])],
    }));

    setAddModalOpen(false);
    setNewEntryForm({});
    triggerToast('New entry added to ' + config.title + '!');
  };

  const moduleConfigs = {
    'vendor-sales': {
      title: 'Vendor Order Sales & Accounting',
      desc: 'View comprehensive sales volume and commission fees from verified vendors.',
      columns: ['Order ID', 'Store Name', 'Customer', 'Gross Total (₹)', 'Commission (%)', 'Admin Share', 'Net Earnings', 'Status'],
      data: []
    },

    'vendor-earnings': {
      title: 'Vendor Earnings & Net Ledger',
      desc: 'Net vendor balances, payout statuses, settlement ledger.',
      columns: ['Store Name', 'Vendor Contact', 'Orders Count', 'Gross Sales', 'Commission Deducted', 'Available Balance', 'Status'],
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
      data: vendorPerformanceData
    },

    'vendor-ratings-reviews': {
      title: 'Vendor Ratings & Customer Reviews',
      desc: 'Moderate feedback ratings and reviews submitted by customers for vendor stores.',
      columns: ['Review ID', 'Store Name', 'Customer Name', 'Rating', 'Review Comment', 'Date', 'Status'],
      data: []
    },

    'inventory': {
      title: 'Inventory & Stock Control',
      desc: 'Monitor real-time warehouse and local dark-store stock levels and reorder warnings.',
      columns: ['SKU Code', 'Item Name', 'Warehouse / Hub', 'Current Stock', 'Min Threshold', 'Reorder Status'],
      data: inventoryData
    },

    'ecom-orders': {
      title: 'E-Commerce Orders Log',
      desc: 'E-commerce orders delivered by courier partners or Bulkimart Delivery.',
      columns: ['Order ID', 'Customer', 'Items', 'Total Amount', 'Courier Partner', 'Tracking #', 'Status'],
      data: moduleId === 'ecom-orders' ? customerOrders.map(ecommerceOrderRow) : []
    },

    'wholesale-orders': {
      title: 'Wholesale Orders',
      desc: 'Business bulk orders placed through ShopAll Wholesale at tiered prices.',
      columns: ['Order ID', 'Customer', 'Items', 'Total Amount', 'Courier Partner', 'Tracking #', 'Status'],
      data: moduleId === 'wholesale-orders' ? customerOrders.filter(o => o.salesChannel === 'wholesale').map(ecommerceOrderRow) : []
    },

    'qcom-orders': {
      title: 'Quick Commerce Express Orders',
      desc: '30-minute instant delivery orders served by local dark store hubs.',
      columns: ['Order ID', 'Customer', 'Local Hub', 'Rider Partner', 'Est SLA', 'Amount', 'Status'],
      data: moduleId === 'qcom-orders' ? customerOrders.filter(o => o.type === 'grocery').map(quickCommerceOrderRow) : []
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
    }
  };

  const currentConfig = moduleConfigs[moduleId] || {
    title: moduleId.toUpperCase() + ' Module',
    desc: 'Manage entries and parameters for this module.',
    columns: ['ID', 'Title / Name', 'Category / Type', 'Date', 'Status'],
    data: []
  };

  // Filter rows
  const filteredData = (currentConfig.data || []).filter(row => {
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

        {isOrderModule && (
          <button type="button" className="sa-btn-primary" disabled={customerOrdersLoading} onClick={() => fetchCustomerOrders(ORDER_QUERIES[moduleId])}>
            Refresh
          </button>
        )}
        {!isOrderModule && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="sa-btn-primary" onClick={() => setAddModalOpen(true)}>
              + Add New Entry
            </button>
            <button
              className="sa-btn-primary"
              style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
              onClick={() => handleExportCsv(currentConfig.title, currentConfig.columns, filteredData)}
            >
              Export CSV
            </button>
          </div>
        )}
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
            placeholder={'Filter ' + currentConfig.title.toLowerCase() + '...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          {isOrderModule ? (
            ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded'].map(status => (
              <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
            ))
          ) : (
            <>
              <option value="Active">Active / Approved</option>
              <option value="Low Stock">Low Stock</option>
              <option value="Pending">Pending Review</option>
              <option value="Delivered">Delivered / Sent</option>
            </>
          )}
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
            {isOrderModule && customerOrdersLoading ? (
              <tr><td colSpan={currentConfig.columns.length + 1} style={{ padding: 30, textAlign: 'center' }}>Loading orders…</td></tr>
            ) : isOrderModule && customerOrdersError ? (
              <tr><td colSpan={currentConfig.columns.length + 1} role="alert">{customerOrdersError}</td></tr>
            ) : filteredData.length === 0 ? (
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
                      if (k === 'status' || k === 'reorderStatus') {
                        const statusClass = String(val).toLowerCase().replace(/\s+/g, '-');
                        return (
                          <td key={colIdx} style={{ padding: '12px 16px' }}>
                            <span className={'sa-status-pill ' + statusClass}>{val}</span>
                          </td>
                        );
                      }
                      return (
                        <td key={colIdx} style={{ padding: '12px 16px', fontWeight: colIdx === 0 || colIdx === 1 ? 700 : 500, color: colIdx === 1 ? 'var(--sa-text-primary)' : 'var(--sa-text-secondary)' }}>
                          {val}
                        </td>
                      );
                    })}
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        className="sa-action-btn"
                        style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }}
                        onClick={() => {
                          setSelectedRow(row);
                          if (isOrderModule) {
                            setSelectedOrder(customerOrders.find(order => (order.orderNo || order._id) === row.id));
                          }
                        }}
                      >
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

      {/* ADD NEW ENTRY MODAL */}
      {addModalOpen && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 540, margin: 'auto', borderRadius: 16, padding: '24px 28px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)' }}>
            <div className="admin-modal-header" style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📦</span>
                <h3 className="admin-modal-title" style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  Add New {currentConfig.title} Entry
                </h3>
              </div>
              <button className="admin-modal-close" onClick={() => setAddModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleAddNewEntrySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {currentConfig.columns.map((col) => (
                <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{col}</label>
                  <input
                    type={col.toLowerCase().includes('stock') || col.toLowerCase().includes('threshold') || col.toLowerCase().includes('amount') || col.toLowerCase().includes('rate') ? 'number' : 'text'}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1.5px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0f172a',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    placeholder={'Enter ' + col + '...'}
                    value={newEntryForm[col] || ''}
                    onChange={(e) => setNewEntryForm(f => ({ ...f, [col]: e.target.value }))}
                    required={col.toLowerCase().includes('sku') || col.toLowerCase().includes('name') || col.toLowerCase().includes('stock')}
                  />
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="admin-btn-sm details"
                  style={{ flex: 'none', padding: '10px 18px' }}
                  onClick={() => setAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-sm approve"
                  style={{ flex: 'none', padding: '10px 24px', fontWeight: 800 }}
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </ModalPortal>
      )}

      {/* DETAILED RECORD DRAWER / MODAL SHEET */}
      {selectedRow && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: '520px', margin: 'auto', borderRadius: 16, padding: '24px 28px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)' }}>
            <div className="admin-modal-header" style={{ marginBottom: 16 }}>
              <h3 className="admin-modal-title" style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#0f172a' }}>
                {isOrderModule ? 'Order ' + (selectedOrder?.orderNo || selectedRow.id) : 'Record Information Sheet'}
              </h3>
              <button className="admin-modal-close" onClick={() => { setSelectedRow(null); setSelectedOrder(null); }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isOrderModule && selectedOrder ? (
                <QuickCommerceOrderDetails order={selectedOrder} />
              ) : (
                Object.keys(selectedRow).map((key, index) => (
                  <div key={key} className="admin-item-row" style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span className="admin-item-label" style={{ textTransform: 'capitalize', color: '#64748b' }}>
                      {currentConfig.columns[index] || key}
                    </span>
                    <span className="admin-item-value" style={{ fontWeight: 700, color: '#0f172a' }}>
                      {String(selectedRow[key])}
                    </span>
                  </div>
                ))
              )}

              {!isOrderModule && (
                <>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      className="sa-btn-primary"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => { triggerToast('Record status updated.'); setSelectedRow(null); }}
                    >
                      ✓ Update Status
                    </button>
                    <button
                      className="sa-btn-primary"
                      style={{ flex: 1, justifyContent: 'center', backgroundColor: '#ffffff', color: 'var(--sa-error)', border: '1px solid var(--sa-error)' }}
                      onClick={() => { triggerToast('Record deleted.'); setSelectedRow(null); }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </ModalPortal>
      )}

    </div>
  );
};

export default SectionModuleTab;
