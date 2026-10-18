import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React from 'react';
import { useUser } from '../context/UserContext';

/**
 * The one place wishlist-toggle logic lives — every product card and the
 * Product Detail page mount this rather than each re-implementing the
 * add/remove call, so heart state can never drift between screens (it's
 * all reading the same `isWishlisted`/`wishlist` Set off UserContext).
 *
 * Every caller sits on top of a clickable card/row, so this always stops
 * the click from bubbling into "open product" or "add to cart" — that's
 * not optional per-caller behavior, it's what makes the button safe to
 * drop into any card unchanged.
 */
const WishlistHeartButton = ({ productId, size = 18, style, className }) => {
  const ui = useFeedback();
  const { isWishlisted, toggleWishlist } = useUser();
  const active = isWishlisted(productId);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = await toggleWishlist(productId);
    // The only failure mode in normal use is a stale session (the whole
    // storefront otherwise requires sign-in to be visible at all) — a
    // plain alert is consistent with how this codebase surfaces other
    // sign-in-required failures (e.g. ProductDetailPage's review form).
    if (r && r.ok === false) ui.notify(r.message || 'Could not update your wishlist.');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={active ? 'Remove from Wishlist' : 'Add to Wishlist'}
      aria-pressed={active}
      className={className}
      style={{
        border: 'none', background: 'rgba(255,255,255,0.9)', borderRadius: '50%',
        width: size + 16, height: size + 16, display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        padding: 0, flex: 'none',
        ...style,
      }}
    >
      <svg
        width={size} height={size} viewBox="0 0 24 24"
        fill={active ? '#ef4444' : 'none'}
        stroke={active ? '#ef4444' : '#475569'}
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
};

export default WishlistHeartButton;
