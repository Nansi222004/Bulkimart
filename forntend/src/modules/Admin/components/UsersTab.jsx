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
    usersPagination,
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
  const [stateFilter, setStateFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState('All');
  const [removing, setRemoving] = useState(false);
  // Bug #200: pagination
  const [page, setPage] = useState(1);

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
      setPage(1);
    }
  }, [defaultStatusFilter]);

  React.useEffect(() => { fetchConsumerLocations(); }, [fetchConsumerLocations]);

  // Picking a new state invalidates the district
  React.useEffect(() => { setDistrictFilter('All'); }, [stateFilter]);

  // Any filter change resets page
  React.useEffect(() => { setPage(1); }, [searchQuery, statusFilter, stateFilter, districtFilter]);

  const allDistricts = React.useMemo(() => {
    const set = new Set();
    Object.values(consumerLocations.districtsByState || {}).forEach((arr) => {
      (arr || []).forEach((d) => set.add(d));
    });
    return Array.from(set).sort();
  }, [consumerLocations.districtsByState]);

  const districtOptions = stateFilter === 'All' ? allDistricts : (consumerLocations.districtsByState[stateFilter] || []);

  // Bug #198/199: role=customer sent to backend to exclude delivery/sellers
  // Bug #200: server-side pagination support
  React.useEffect(() => {
    const t = setTimeout(() => {
      fetchUsers(
        searchQuery,
        statusFilter.toLowerCase(),
        stateFilter === 'All' ? '' : stateFilter,
        districtFilter === 'All' ? '' : districtFilter,
        page,
      );
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, statusFilter, stateFilter, districtFilter, page, fetchUsers]);

  const filteredUsers = users;
  const totalPages = usersPagination?.totalPages || 1;
  const totalCount = usersPagination?.total || 0;

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
        >
          <option value="All">All Cities</option>
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
                {/* Bug #197: User ID = Account ID */}
                <div className="admin-item-row">
                  <span className="admin-item-label">User / Account ID</span>
                  <span className="admin-item-value" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--admin-primary)' }}>
                    {user.id}
                  </span>
                </div>

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

      {/* Bug #200: Pagination controls */}
      {!usersLoading && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '16px 0', marginTop: 8 }}>
          <button
            className="admin-btn-sm details"
            style={{ flex: 'none' }}
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--admin-text-muted)', fontWeight: 600 }}>
            Page {page} of {totalPages} &nbsp;·&nbsp; {totalCount} total
          </span>
          <button
            className="admin-btn-sm details"
            style={{ flex: 'none' }}
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next →
          </button>
        </div>
      )}

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">User Registration Dossier</h3>
              <button className="admin-modal-close" onClick={() => setSelectedUser(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              {/* Bug #197: User ID = Account ID (same value shown as both) */}
              <div className="admin-item-row">
                <span className="admin-item-label">User ID</span>
                <span className="admin-item-value" style={{ fontSize: 13, color: 'var(--admin-primary)', fontWeight: 800, fontFamily: 'monospace' }}>{selectedUser.id}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Account ID</span>
                <span className="admin-item-value" style={{ fontSize: 13, color: 'var(--admin-primary)', fontWeight: 800, fontFamily: 'monospace' }}>{selectedUser.accountId || selectedUser.id}</span>
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
