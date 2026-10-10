import React, { useState, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';
import { SHGDetailModal } from './SHGDetailModal';

export const SHGVendorsTab = ({ defaultStatusFilter = 'all' }) => {
  const {
    shgVendors,
    shgVendorsLoading,
    shgVendorsError,
    fetchShgVendors,
    approveShgVendor,
    rejectShgVendor,
    suspendShgVendor,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus
  } = useAdmin();

  const [selectedSHG, setSelectedSHG] = useState(null);
  const [modalTab, setModalTab] = useState('overview');

  useEffect(() => {
    if (defaultStatusFilter) {
      setFilterStatus(defaultStatusFilter);
    }
  }, [defaultStatusFilter, setFilterStatus]);

  // Debounced refetch on status filter or search query changes
  useEffect(() => {
    const t = setTimeout(() => {
      fetchShgVendors(filterStatus.toLowerCase(), searchQuery);
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [filterStatus, searchQuery, fetchShgVendors]);

  // Filter SHGs
  const filteredSHGs = shgVendors;

  return (
    <>
      {/* Action filters bar */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search SHG groups by name, leader or NRLM code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="admin-filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending Review</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="Suspended">Suspended</option>
        </select>
      </div>

      {/* SHGs grid list */}
      <div className="admin-list-container">
        {shgVendorsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            Loading SHG vendor applications...
          </div>
        ) : shgVendorsError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-error)', width: '100%' }}>
            Error: {shgVendorsError}
          </div>
        ) : filteredSHGs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No SHG vendor applications match selected filters.
          </div>
        ) : (
          filteredSHGs.map(shg => (
            <div key={shg.id} className="admin-item-card">
              <div className="admin-item-header">
                <h3 className="admin-item-title">{shg.groupName}</h3>
                <span className={`admin-status-pill ${
                  shg.status === 'Approved' ? 'approved' :
                  shg.status === 'Pending' ? 'pending' :
                  shg.status === 'Rejected' ? 'rejected' :
                  shg.status === 'Suspended' ? 'suspended' : 'under-review'
                }`}>
                  {shg.status}
                </span>
              </div>

              <div className="admin-item-body">
                <div className="admin-item-row">
                  <span className="admin-item-label">Cooperative Leader</span>
                  <span className="admin-item-value">{shg.leaderName}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">NRLM Register Code</span>
                  <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>{shg.nrlmId || '—'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Members Count</span>
                  <span className="admin-item-value">{shg.membersCount || 0} active members</span>
                </div>
              </div>

              {/*
                An action is offered only where it would change something.
                Once a cooperative is approved the negative action is SUSPEND,
                not Reject: rejection is a verdict on an application, while
                suspension withdraws an approval already granted and is what
                actually stops them receiving orders. A suspended group can be
                put back with Approve.
              */}
              <div className="admin-item-actions">
                {shg.status !== 'Approved' && (
                  <button className="admin-btn-sm approve" onClick={() => approveShgVendor(shg.id)}>
                    {shg.status === 'Suspended' ? 'Reinstate' : 'Approve'}
                  </button>
                )}
                {shg.status === 'Approved' ? (
                  <button className="admin-btn-sm reject" onClick={() => suspendShgVendor(shg.id)}>Suspend</button>
                ) : shg.status !== 'Rejected' && shg.status !== 'Suspended' ? (
                  <button className="admin-btn-sm reject" onClick={() => rejectShgVendor(shg.id)}>Reject</button>
                ) : null}
                <button className="admin-btn-sm details" onClick={() => {
                  setSelectedSHG(shg);
                  setModalTab('overview');
                }}>View Dossier</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* DETAILED SHG APPLICATION REVIEW MODAL */}
      {selectedSHG && (
        <SHGDetailModal
          shg={selectedSHG}
          onClose={() => setSelectedSHG(null)}
          onRefresh={() => fetchShgVendors(filterStatus.toLowerCase(), searchQuery)}
        />
      )}
    </>
  );
};

export default SHGVendorsTab;
