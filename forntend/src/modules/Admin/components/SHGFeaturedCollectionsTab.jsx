import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const SHGFeaturedCollectionsTab = () => {
  const { triggerToast } = useAdmin();

  const [collections, setCollections] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newTitle) return;
    const newItem = {
      id: `COL-0${collections.length + 1}`,
      name: newTitle,
      desc: newDesc || 'Featured SHG Marketplace collection.',
      productsCount: 10,
      order: collections.length + 1,
      start: '16 May 2026',
      end: '30 Jun 2026',
      status: 'Active'
    };
    setCollections([...collections, newItem]);
    triggerToast('New SHG Featured Collection Published!');
    setShowModal(false);
    setNewTitle('');
    setNewDesc('');
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>SHG Marketplace Featured Collections</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Manage spotlight collection banners displayed on the consumer mobile app home screen.</p>
        </div>

        <button 
          onClick={() => setShowModal(true)}
          style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#10b981', color: '#ffffff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
        >
          + Create Featured Collection
        </button>
      </div>

      {/* Grid of Collections */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {collections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No featured collections published yet.
          </div>
        ) : (
          collections.map(col => (
            <div key={col.id} style={{ padding: 18, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748b', fontWeight: 800 }}>{col.id} • Rank #{col.order}</span>
                  <h3 style={{ margin: '2px 0 0 0', fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{col.name}</h3>
                </div>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 12,
                  fontSize: 10,
                  fontWeight: 800,
                  backgroundColor: col.status === 'Active' ? '#ebfdf2' : '#fffbe6',
                  color: col.status === 'Active' ? '#047857' : '#d48806'
                }}>
                  {col.status}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>{col.desc}</p>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 4 }}>
                <span>{col.productsCount} SHG Products</span>
                <span>{col.start} - {col.end}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* CREATE COLLECTION MODAL */}
      {showModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Create Featured SHG Collection</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', display: 'block', marginBottom: 4 }}>Collection Title</label>
                <input
                  type="text"
                  placeholder="e.g. Lucknow Chikankari Special"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, boxSizing: 'border-box' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea
                  placeholder="Short description for customer mobile app..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#ffffff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#10b981', color: '#ffffff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Save Collection</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default SHGFeaturedCollectionsTab;
