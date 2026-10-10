import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';

const RATING_LABELS = {
  5: 'Loved It!',
  4: 'Good!',
  3: 'Average',
  2: 'Fair',
  1: 'Poor'
};

export const WriteReviewPage = ({ productId, onBack }) => {
  const { setSelectedProduct } = useUser();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);

    fetch(apiUrl(`/api/products/${productId}`))
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setProduct(data.product || data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load product details');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 4 - photos.length);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setPhotos((prev) => [...prev, reader.result].slice(0, 4));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemovePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Please sign in to leave a review.');

      const res = await fetch(apiUrl(`/api/products/${productId}/reviews`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rating,
          comment: comment.trim(),
          images: photos,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || 'Failed to submit review');
      }

      // Successfully posted review directly
      if (onBack) {
        onBack();
      }
    } catch (err) {
      setError(err.message || 'Error submitting review');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="write-review-page" style={{ position: 'absolute', inset: 0, background: '#f8fafc', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
        Loading product details...
      </div>
    );
  }

  if (error && !product) {
    return (
      <div className="write-review-page" style={{ position: 'absolute', inset: 0, background: '#f8fafc', zIndex: 900, padding: 24, textAlign: 'center' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', marginBottom: 20 }}>← Back</button>
        <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="write-review-page" style={{ position: 'absolute', inset: 0, background: '#f8fafc', zIndex: 900, overflowY: 'auto', paddingBottom: 20, fontFamily: "'Outfit', sans-serif", scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      {/* Sticky Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={onBack} aria-label="Go back" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#0f172a', padding: 0, lineHeight: 1 }}>
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>Write a Review</h2>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 500, margin: '0 auto', boxSizing: 'border-box' }}>
        {/* Product Card */}
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid #e2e8f0', display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <img
            src={product?.image || product?.images?.[0]}
            alt={product?.name}
            style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', backgroundColor: '#f8fafc' }}
          />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {product?.brandName || product?.shg || 'PRODUCT'}
            </span>
            <h3 style={{ margin: '2px 0 6px 0', fontSize: 13.5, fontWeight: 700, color: '#1e293b', lineHeight: 1.3 }}>
              {product?.name}
            </h3>

            {/* Interactive Stars */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  onClick={() => setRating(star)}
                  role="button"
                  aria-label={`Rate ${star} star`}
                  style={{ cursor: 'pointer', fontSize: 24, color: star <= rating ? '#f43f5e' : '#e2e8f0', transition: 'color 0.15s' }}
                >
                  ★
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginTop: 4, display: 'block' }}>
              {RATING_LABELS[rating]}
            </span>
          </div>
        </div>

        {/* Add Photos Section */}
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Add Photos</h4>
          <p style={{ margin: '0 0 14px 0', fontSize: 12, color: '#64748b' }}>
            Capture and add your product experiences!
          </p>

          {photos.length < 4 && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', border: '1.5px dashed #818cf8', borderRadius: 12, background: '#f5f3ff', cursor: 'pointer' }}>
              <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} style={{ display: 'none' }} />
              <span style={{ fontSize: 20 }}>📷</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5' }}>
                Add photos ({photos.length}/4)
              </span>
            </label>
          )}

          {/* Photo Previews */}
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {photos.map((src, idx) => (
                <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={src} alt="preview" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                  <button
                    onClick={() => handleRemovePhoto(idx)}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                      background: '#ef4444', color: '#fff', border: 'none', fontSize: 11, fontWeight: 900,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Write a Review Section */}
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Write a Review</h4>
          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#64748b' }}>
            Add description about the product
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Help other buyers by sharing your thoughts on fit, quality, material, colour or comfort..."
            rows={4}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: '1px solid #cbd5e1', fontSize: 13,
              fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', resize: 'vertical',
            }}
          />
          <p style={{ margin: '10px 0 0 0', fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
            💡 Help other buyers by sharing your thoughts on fit, quality, material, colour or comfort. Avoid delivery/packaging details.
          </p>
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12.5, color: '#ef4444', textAlign: 'center', fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>

      {/* Sticky Bottom Action Footer */}
      <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, background: '#fff', padding: '12px 20px 20px 20px', borderTop: '1px solid #e2e8f0', zIndex: 100, textAlign: 'center', boxShadow: '0 -4px 12px rgba(0,0,0,0.05)' }}>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', maxWidth: 460, padding: 14, borderRadius: 30,
            background: submitting ? '#94a3b8' : 'var(--primary, #08B9E8)', color: '#fff',
            border: 'none', fontSize: 15, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
        >
          {submitting ? 'Submitting...' : 'Submit →'}
        </button>
        <p style={{ margin: '8px 0 0 0', fontSize: 10, color: '#94a3b8', lineHeight: 1.3 }}>
          By submitting this review, you give us consent to publish and process personal information in accordance with TERMS OF USE and Privacy Policy.
        </p>
      </div>
    </div>
  );
};

export default WriteReviewPage;
