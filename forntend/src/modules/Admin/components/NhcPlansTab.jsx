import React, { useState, useEffect, useCallback } from 'react';
import { adminGet, adminPost, adminPatch } from '../../../utils/adminApi';

export const NhcPlansTab = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [form, setForm] = useState({
    name: '',
    planType: 'UNIT_SELLER',
    amount: '',
    currency: 'INR',
    description: '',
    isActive: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminGet('/nhc/plans');
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch NHC plans');
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleOpenCreate = () => {
    setEditingPlan(null);
    setForm({
      name: '',
      planType: 'UNIT_SELLER',
      amount: '',
      currency: 'INR',
      description: '',
      isActive: true,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name || '',
      planType: plan.planType || 'UNIT_SELLER',
      amount: plan.amount !== undefined ? String(plan.amount) : '',
      currency: plan.currency || 'INR',
      description: plan.description || '',
      isActive: Boolean(plan.isActive),
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) {
      triggerToast('Please provide plan name and amount');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        planType: form.planType,
        amount: Number(form.amount),
        currency: form.currency || 'INR',
        description: form.description.trim(),
        isActive: Boolean(form.isActive),
      };

      if (editingPlan) {
        await adminPatch(`/nhc/plans/${editingPlan._id || editingPlan.id}`, payload);
        triggerToast('NHC Plan updated successfully! Note: Existing application snapshots remain unchanged.');
      } else {
        await adminPost('/nhc/plans', payload);
        triggerToast('New NHC Plan created successfully.');
      }

      setShowModal(false);
      fetchPlans();
    } catch (err) {
      triggerToast(err.message || 'Error saving plan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (plan) => {
    try {
      const targetId = plan._id || plan.id;
      const { data } = await adminPatch(`/nhc/plans/${targetId}/status`, { isActive: !plan.isActive });
      triggerToast(`Plan status updated to ${data?.isActive ? 'Active' : 'Inactive'}`);
      fetchPlans();
    } catch (err) {
      triggerToast(err.message || 'Error toggling plan status');
    }
  };

  return (
    <div className="admin-content-container" style={{ padding: 24, backgroundColor: '#f8fafc', minHeight: '100%' }}>
      {toastMessage && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          backgroundColor: '#0f172a', color: '#ffffff', padding: '12px 20px',
          borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.25)', fontSize: 13, fontWeight: 700
        }}>
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
            NHC Seller Plans Configuration
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
            Manage membership tiers offered to NHC Organization Sellers during onboarding.
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          style={{
            backgroundColor: '#10b981', color: '#fff', border: 'none',
            padding: '10px 18px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)'
          }}
        >
          <span>+ Create New Plan</span>
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading NHC plans...</div>
      ) : error ? (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: 16, borderRadius: 12 }}>
          {error}
        </div>
      ) : plans.length === 0 ? (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', padding: 40, borderRadius: 16, textAlign: 'center', color: '#64748b' }}>
          No NHC seller plans found. Click "+ Create New Plan" to configure one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {plans.map((plan) => (
            <div
              key={plan._id || plan.id}
              style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid #fde68a',
                borderRadius: 16,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                boxShadow: '0 4px 16px rgba(245, 158, 11, 0.06)'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
                    padding: '3px 8px', borderRadius: 6,
                    backgroundColor: plan.planType === 'BLOCK_SELLER' ? '#f3e8ff' : '#f0f9ff',
                    color: plan.planType === 'BLOCK_SELLER' ? '#7e22ce' : '#0369a1',
                    border: plan.planType === 'BLOCK_SELLER' ? '1px solid #e9d5ff' : '1px solid #bae6fd'
                  }}>
                    {plan.planType}
                  </span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 12,
                    backgroundColor: plan.isActive ? '#dcfce7' : '#fee2e2',
                    color: plan.isActive ? '#15803d' : '#b91c1c',
                    border: plan.isActive ? '1px solid #bbf7d0' : '1px solid #fecaca'
                  }}>
                    {plan.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 900, color: '#78350f' }}>
                  {plan.name}
                </h3>

                <div style={{ fontSize: 24, fontWeight: 900, color: '#15803d', marginBottom: 12 }}>
                  ₹{Number(plan.amount).toLocaleString('en-IN')}
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginLeft: 4 }}>
                    {plan.currency || 'INR'}
                  </span>
                </div>

                {plan.description && (
                  <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                    {plan.description}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                <button
                  onClick={() => handleOpenEdit(plan)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff', color: '#334155', fontWeight: 700, fontSize: 11, cursor: 'pointer'
                  }}
                >
                  Edit Plan
                </button>
                <button
                  onClick={() => handleToggleStatus(plan)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
                    backgroundColor: plan.isActive ? '#fee2e2' : '#dcfce7',
                    color: plan.isActive ? '#dc2626' : '#15803d', fontWeight: 800, fontSize: 11, cursor: 'pointer'
                  }}
                >
                  {plan.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
        }}>
          <div style={{
            backgroundColor: '#ffffff', borderRadius: 20, padding: 28, maxWidth: 500, width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', color: '#0f172a'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>
              {editingPlan ? 'Edit NHC Plan' : 'Create New NHC Plan'}
            </h3>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                  Plan Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Unit Seller"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                  Plan Type *
                </label>
                <select
                  value={form.planType}
                  onChange={(e) => setForm({ ...form, planType: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="UNIT_SELLER">UNIT_SELLER</option>
                  <option value="BLOCK_SELLER">BLOCK_SELLER</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="1000000"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                    Currency
                  </label>
                  <input
                    type="text"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Plan benefits description..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', margin: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span>Active Plan (Available for onboarding selection)</span>
              </label>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff', color: '#475569', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none',
                    backgroundColor: '#10b981', color: '#fff', fontWeight: 800, cursor: 'pointer'
                  }}
                >
                  {submitting ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NhcPlansTab;
