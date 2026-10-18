import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const UsersTab = ({ defaultStatusFilter }) => {
  const ui = useFeedback();
  const {
    users,
    usersLoading,
    usersError,
    fetchUsers,
    searchQuery,
    setSearchQuery,
    consumerLocations,
    fetchConsumerLocations,
    removeCustomerAccount,
  } = useAdmin();

  const [selectedUser, setSelectedUser] = useState(null);
  const [statusFilter, setStatusFilter] = useState(defaultStatusFilter || 'All');
  // Geographic filter — matched against each user's DEFAULT address only
  // (see admin.controller.js::listUsers). "District" here is really the
  // address's `city` field — there is no separate district field anywhere
  // in this schema, so city doubles as it, same approximation used
  // elsewhere in this directory.
  const [stateFilter, setStateFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState('All');
  const [removing, setRemoving] = useState(false);

  const removeSelected = async () => {
    if (!selectedUser || removing) return;
    return ui.perform('Remove this customer account? If it has no references it will be permanently deleted. If historical orders or financial records exist it will only be deactivated. Active orders, balances, refunds, or unresolved obligations will block the action.', async () => {
    setRemoving(true);
    const result = await removeCustomerAccount(selectedUser.id);
    setRemoving(false);
    if (result?.ok) setSelectedUser(null);

});
};

  React.useEffect(() => {
    if (defaultStatusFilter) {
      setStatusFilter(defaultStatusFilter);
    }
  }, [defaultStatusFilter]);

  // Populated once — only (state, district) pairs with at least one real
  // registered user are ever offered, so a choice never comes back empty.
  React.useEffect(() => { fetchConsumerLocations(); }, [fetchConsumerLocations]);

  // Picking a new state invalidates whatever district was selected under
  // the PREVIOUS state — never silently filter on a (state, district) pair
  // that cannot co-occur.
  React.useEffect(() => { setDistrictFilter('All'); }, [stateFilter]);

  const districtOptions = stateFilter === 'All' ? [] : (consumerLocations.districtsByState[stateFilter] || []);

  // Status ("active"/"inactive"/"blocked") is filtered server-side now — see
  // GET /api/admin/users?status= — since "inactive" means something the
  // client can't derive on its own (a buyer with no order in 30 days), not
  // just the `isActive` flag. State/district are the same — server-side,
  // matched against each user's default address.
  React.useEffect(() => {
    const t = setTimeout(() => {
      fetchUsers(
        searchQuery,
        statusFilter.toLowerCase(),
        stateFilter === 'All' ? '' : stateFilter,
        districtFilter === 'All' ? '' : districtFilter,
      );
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, statusFilter, stateFilter, districtFilter, fetchUsers]);

  const filteredUsers = users;

  return (
    <>
      {/* Action filters bar */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper" style={{ flex: '0 1 400px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search users by name, phone or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="admin-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active Customers</option>
          <option value="Inactive">Inactive Customers</option>
          <option value="Blocked">Blocked Customers</option>
        </select>

        <select
          className="admin-filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="All">All States</option>
          {consumerLocations.states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          className="admin-filter-select"
          value={districtFilter}
          onChange={(e) => setDistrictFilter(e.target.value)}
          disabled={stateFilter === 'All'}
        >
          <option value="All">{stateFilter === 'All' ? 'Select a state first' : 'All Cities'}</option>
          {districtOptions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Users grid list */}
      <div className="admin-list-container">
        {usersLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            Loading users list...
          </div>
        ) : usersError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-error)', width: '100%' }}>
            Error: {usersError}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No users match search criteria.
          </div>
        ) : (
          filteredUsers.map(user => (
            <div key={user.id} className="admin-item-card">
              <div className="admin-item-header">
                <h3 className="admin-item-title">{user.name}</h3>
                <span className="admin-status-pill approved" style={{ background: '#f1f5f9', color: '#475569' }}>
                  Registered
                </span>
              </div>

              <div className="admin-item-body">
                <div className="admin-item-row">
                  <span className="admin-item-label">Mobile Number</span>
                  <span className="admin-item-value">{user.phone}</span>
                </div>

                <div className="admin-item-row">
                  <span className="admin-item-label">Registered Date</span>
                  <span className="admin-item-value">{user.date}</span>
                </div>

                {(() => {
                  const defaultAddr = (user.raw?.addresses || []).find((a) => a.isDefault) || user.raw?.addresses?.[0];
                  if (!defaultAddr?.state && !defaultAddr?.city) return null;
                  return (
                    <div className="admin-item-row">
                      <span className="admin-item-label">Location</span>
                      <span className="admin-item-value">{[defaultAddr.city, defaultAddr.state].filter(Boolean).join(', ')}</span>
                    </div>
                  );
                })()}
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" style={{ flex: 'none' }} onClick={() => setSelectedUser(user)}>View Profile</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">User Registration Dossier</h3>
              <button className="admin-modal-close" onClick={() => setSelectedUser(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              <div className="admin-item-row">
                <span className="admin-item-label">User ID</span>
                <span className="admin-item-value" style={{ fontSize: 13, color: 'var(--admin-primary)', fontWeight: 800 }}>{selectedUser.id}</span>
              </div>
              
              <div className="admin-item-row">
                <span className="admin-item-label">Full Name</span>
                <span className="admin-item-value" style={{ fontWeight: 700 }}>{selectedUser.name}</span>
              </div>

              <hr style={{ borderColor: 'var(--admin-border-color)', margin: '8px 0' }} />

              <div className="admin-item-row">
                <span className="admin-item-label">Contact Phone</span>
                <span className="admin-item-value">{selectedUser.phone}</span>
              </div>

              <div className="admin-item-row">
                <span className="admin-item-label">Email Address</span>
                <span className="admin-item-value">{selectedUser.email}</span>
              </div>

              <hr style={{ borderColor: 'var(--admin-border-color)', margin: '8px 0' }} />

              <span className="admin-item-label" style={{ fontWeight: 800 }}>
                Saved Delivery Addresses{selectedUser.raw?.addresses?.length ? ` (${selectedUser.raw.addresses.length})` : ''}
              </span>

              {(!selectedUser.raw?.addresses || selectedUser.raw.addresses.length === 0) ? (
                <span style={{ fontSize: 12.5, color: 'var(--admin-text-muted)' }}>No address saved by this user yet.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedUser.raw.addresses.map((addr, idx) => (
                    <div
                      key={addr._id || idx}
                      style={{
                        border: '1px solid var(--admin-border-color)', borderRadius: 10, padding: '10px 12px',
                        display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800 }}>{addr.label || 'Home'}</span>
                        {addr.isDefault && (
                          <span className="admin-status-pill approved" style={{ background: '#f1f5f9', color: '#475569', fontSize: 10 }}>
                            Default
                          </span>
                        )}
                      </div>
                      {addr.name && <span>{addr.name}{addr.phone ? ` · ${addr.phone}` : ''}</span>}
                      <span style={{ color: 'var(--admin-text-muted)' }}>
                        {[addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') || '— No address text captured —'}
                      </span>
                      {(addr.lat && addr.lng) && (
                        <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
                          📍 {addr.lat.toFixed(5)}, {addr.lng.toFixed(5)}
                          {addr.locationSource ? ` (${addr.locationSource})` : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--admin-border-color)', paddingTop: 14, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginBottom: 8 }}>
                  Permanent deletion is used only for a standalone account with no history. Otherwise the account is deactivated and historical records stay intact.
                </div>
                <button className="admin-btn-sm reject" onClick={removeSelected} disabled={removing}>
                  {removing ? 'Checking account…' : 'Delete / Deactivate Customer'}
                </button>
              </div>

            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default UsersTab;
