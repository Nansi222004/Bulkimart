import { useUser } from '../context/UserContext';

export const useCart = () => {
  const { cart, addToCart, getCartCount } = useUser();

  return {
    cart,
    addToCart,
    cartCount: getCartCount(),
  };
};
