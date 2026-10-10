import React, { useState } from 'react';
import { useSHG } from '../context/SHGContext';

const SHGMembersTab = () => {
  const { members, triggerToast, handleAddMember: addMemberApi, handleDeleteMember } = useSHG();
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberForm, setNewMemberForm] = useState({
    name: '',
    role: 'Member',
    phone: '',
    contribution: ''
  });

  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberForm.name || !newMemberForm.phone) {
      triggerToast('Please enter name and phone number', 'error');
      return;
    }
    await addMemberApi(newMemberForm.name, newMemberForm.phone, newMemberForm.role);
    setShowAddMemberModal(false);
    setNewMemberForm({ name: '', role: 'Member', phone: '', contribution: '' });
  };

  return (
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Top Header/Action Row */}
      <div className="shg-action-row">
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--shg-text-secondary)' }}>
          Total Members: {members.length}
        </div>
        <button className="shg-add-btn" onClick={() => setShowAddMemberModal(true)} style={{ marginLeft: 'auto' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Member
        </button>
      </div>

      {/* Members list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 32px' }}>
        <div className="shg-card">
          {members.map(member => (
            <div key={member.id} className="shg-member-row">
              <div className="shg-member-avatar">
                {getInitials(member.name)}
              </div>

              <div className="shg-member-info">
                <div className="shg-member-name">{member.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="shg-member-role">{member.role}</span>
                  <span style={{ fontSize: 10, color: 'var(--shg-text-muted)' }}>•</span>
                  <span className="shg-member-phone">{member.phone}</span>
                </div>
              </div>

              <div style={{ textAlign: 'right', minWidth: 100 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--shg-text-primary)' }}>
                  ₹{member.contribution} / mo
                </div>
                <span style={{ fontSize: 10, color: 'var(--shg-text-muted)' }}>Savings Contrib.</span>
              </div>

              <span className={`shg-status-badge ${member.status === 'Active' ? 'active' : 'inactive'}`} style={{ marginLeft: 8 }}>
                {member.status}
              </span>

              <button
                className="shg-header-btn"
                style={{ marginLeft: 8, padding: 4, color: 'var(--shg-error)' }}
                onClick={() => handleDeleteMember(member.id)}
                aria-label="Remove member"
                title="Remove Member"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add Member Modal Sheet */}
      {showAddMemberModal && (
        <div className="shg-modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="shg-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="shg-modal-header">
              <h3 className="shg-modal-title">Register SHG Group Member</h3>
              <button className="shg-modal-close" onClick={() => setShowAddMemberModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleAddMember} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="shg-form-group">
                <label className="shg-label">Full Name</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="Enter member's full name"
                  value={newMemberForm.name}
                  onChange={(e) => setNewMemberForm({...newMemberForm, name: e.target.value})}
                  required
                />
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Designation / Role</label>
                <select 
                  className="shg-select"
                  value={newMemberForm.role}
                  onChange={(e) => setNewMemberForm({...newMemberForm, role: e.target.value})}
                >
                  <option value="President">President / Leader</option>
                  <option value="Secretary">Secretary</option>
                  <option value="Treasurer">Treasurer</option>
                  <option value="Member">General Member</option>
                </select>
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Mobile Number</label>
                <input 
                  type="tel" 
                  className="shg-input" 
                  placeholder="Enter 10-digit number"
                  maxLength={10}
                  value={newMemberForm.phone}
                  onChange={(e) => setNewMemberForm({...newMemberForm, phone: e.target.value})}
                  required
                />
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Monthly Savings Contribution (₹)</label>
                <input 
                  type="number" 
                  className="shg-input" 
                  placeholder="e.g. 500"
                  value={newMemberForm.contribution}
                  onChange={(e) => setNewMemberForm({...newMemberForm, contribution: e.target.value})}
                />
              </div>

              <button type="submit" className="shg-primary-btn">
                Register Member
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SHGMembersTab;
