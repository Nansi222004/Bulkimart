import React, { useCallback, useEffect, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';

const money = (value) => `₹${Number(value).toLocaleString('en-IN')}`;
const statusColor = (status) => status === 'approved' ? '#15803d' : status === 'pending' ? '#b45309' : status === 'suspended' ? '#b91c1c' : '#64748b';

export default function WholesaleManagementTab() {
  const { triggerToast, setActiveTab } = useAdmin();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminGet('/wholesale/summary');
      setSummary(data);
    } catch (err) {
      setError(err.message || 'Unable to load Wholesale management data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (seller, status) => {
    setBusyId(String(seller._id));
    try {
      const reason = status === 'suspended' || status === 'rejected'
        ? window.prompt(`Optional reason for ${status} Wholesale access:`) || '' : '';
      await adminPatch(`/sellers/${seller._id}/wholesale`, {
        status,
        ...(status === 'suspended' ? { suspensionReason: reason } : { rejectionReason: reason }),
      });
      triggerToast(`Wholesale access ${status}.`);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Wholesale status could not be updated.');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Loading Wholesale management…</div>;
  if (error) return <div style={{ padding: 24 }} role="alert"><p>{error}</p><button onClick={load}>Retry</button></div>;

  const counts = summary?.counts || {};
  return (
    <main style={{ padding: 24, color: '#172b4d' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><h1 style={{ margin: 0 }}>Wholesale</h1><p style={{ color: '#64748b' }}>Live seller approvals and eligible offers. Purchasing remains disabled.</p></div>
        <button type="button" onClick={load}>Refresh</button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 12, margin: '18px 0 28px' }}>
        {[
          ['Requests', counts.requestingSellers], ['Approved sellers', counts.approvedSellers],
          ['Suspended sellers', counts.suspendedSellers], ['Eligible products', counts.eligibleProducts],
          ['Eligible variants', counts.eligibleVariants], ['Available variants', counts.availableVariants],
        ].map(([label, value]) => <div key={label} style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}><small style={{ color: '#64748b' }}>{label}</small><strong style={{ display: 'block', fontSize: 24 }}>{value ?? 0}</strong></div>)}
      </div>
      <h2>Seller access</h2>
      {!summary?.sellers?.length ? <p>No sellers have requested Wholesale access.</p> : <div style={{ display: 'grid', gap: 10 }}>
        {summary.sellers.map((seller) => {
          const status = seller.wholesaleChannel?.status || 'not_requested';
          const name = seller.storeDetails?.name || seller.businessName || 'Seller';
          return <section key={seller._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div><strong>{name}</strong><div style={{ color: '#64748b', fontSize: 13 }}>{seller.userId?.name || '—'} · account {seller.status}{seller.userId?.isActive === false ? ' · user inactive' : ''}</div></div>
            <span style={{ color: statusColor(status), fontWeight: 700 }}>{status.replace('_', ' ')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {status === 'pending' && <><button disabled={busyId === String(seller._id)} onClick={() => decide(seller, 'approved')}>Approve</button><button disabled={busyId === String(seller._id)} onClick={() => decide(seller, 'rejected')}>Reject</button></>}
              {status === 'approved' && <button disabled={busyId === String(seller._id)} onClick={() => decide(seller, 'suspended')}>Suspend</button>}
              {status === 'suspended' && <button disabled={busyId === String(seller._id)} onClick={() => decide(seller, 'approved')}>Restore</button>}
            </div>
          </section>;
        })}
      </div>}
      <h2 style={{ marginTop: 30 }}>Eligible Wholesale offers</h2>
      {!summary?.offers?.length ? <p>No currently eligible offers. Only active approved sellers, products, and offers are counted.</p> : <div style={{ display: 'grid', gap: 12 }}>
        {summary.offers.map((offer) => <section key={offer._id} style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{offer.name}</strong><div style={{ color: '#64748b', fontSize: 13 }}>{offer.seller?.name || 'Seller'} · {offer.category?.name || 'Uncategorized'}</div></div><button type="button" onClick={() => setActiveTab('products')}>Open product moderation</button></div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{offer.variants.map((variant) => <div key={String(variant.variantId)} style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <span>{variant.name || variant.sku || 'Variant'}{variant.sku ? ` · ${variant.sku}` : ''}</span><span>{variant.available ? `${variant.availableStock} available` : 'Out of stock'} · MOQ {variant.minimumQuantity} · increment {variant.quantityIncrement}</span><span>{variant.priceTiers.map((tier) => `${tier.minimumQuantity}+ ${money(tier.unitPrice)}`).join(' / ')}</span>
          </div>)}</div>
        </section>)}
      </div>}
    </main>
  );
}
