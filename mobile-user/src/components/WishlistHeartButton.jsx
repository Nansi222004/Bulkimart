// Port of WishlistHeartButton.jsx — the one place the wishlist toggle lives; never triggers the card under it.
import React from 'react';
import { Pressable } from 'react-native';
import { useUser } from '../context/UserContext';
import { useFeedback } from '../lib/feedback';
import { HeartIcon } from './icons';

export default function WishlistHeartButton({ productId, size = 18, style }) {
  const ui = useFeedback();
  const { isWishlisted, toggleWishlist } = useUser();
  const active = isWishlisted(productId);
  const onPress = async () => {
    const r = await toggleWishlist(productId);
    if (r && r.ok === false) ui.notify(r.message || 'Could not update your wishlist.');
  };
  return <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={active ? 'Remove from Wishlist' : 'Add to Wishlist'} accessibilityState={{ selected: active }}
    style={[{ backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: (size + 16) / 2, width: size + 16, height: size + 16, alignItems: 'center', justifyContent: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, style]}>
    <HeartIcon size={size} color={active ? '#ef4444' : '#475569'} filled={active} width={2.2} />
  </Pressable>;
}
