import React from 'react';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from './WishlistHeartButton';

const ProductCard = ({ product, onOpen, onAdd }) => (
  <div
    className="grid-product-card"
    onClick={() => onOpen(product)}
    style={{
      backgroundColor: 'var(--sf-surface)',
      border: '1px solid var(--sf-product-border)',
      borderRadius: 12,
      padding: 6,
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}
  >
    <div
      className="grid-product-img-wrapper"
      style={{
        width: '100%',
        height: 85,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 8,
        backgroundColor: 'var(--sf-surface)',
      }}
    >
      <img
        src={product.image}
        alt={product.name}
        className="grid-product-img"
        style={{ width: '85%', height: '85%', objectFit: 'contain' }}
      />
      <WishlistHeartButton productId={product.id} size={11} style={{ position: 'absolute', top: 4, right: 4 }} />
    </div>
    <div className="grid-product-details" style={{ display: 'flex', flexDirection: 'column', marginTop: 6, textAlign: 'left', flex: 1 }}>
      <h4
        className="grid-product-name"
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--sf-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          height: 28,
          lineHeight: '14px',
        }}
      >
        {product.name}
      </h4>
      {product.fulfillmentType === 'digital' && (
        <span style={{ alignSelf: 'flex-start', marginTop: 3, padding: '2px 6px', borderRadius: 999, background: 'var(--sf-highlight)', color: 'var(--sf-highlight-text)', fontSize: 8.5, fontWeight: 900 }}>
          DIGITAL E-BOOK
        </span>
      )}
      <span className="grid-product-seller" style={{ fontSize: 9.5, color: 'var(--sf-muted)', fontWeight: 600, marginTop: 2 }}>
        {product.sellerName || product.brandName || ''}
      </span>

      <div className="grid-product-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 6 }}>
        <span className="grid-product-price" style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--sf-text)' }}>
          {formatCurrency(product.price)}
        </span>
        <button
          className="grid-product-add-btn"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(product);
          }}
          style={{
            backgroundColor: 'var(--primary, var(--sf-action, #D91430))',
            color: 'var(--sf-action-text)',
            border: 'none',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          ADD
        </button>
      </div>
    </div>
  </div>
);

export default ProductCard;
