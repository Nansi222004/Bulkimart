// Web /wholesale/cart is a legacy adapter onto the shared cart; the app opens the cart at the Wholesale group.
import { Redirect } from 'expo-router';

export default function WholesaleCart() {
  return <Redirect href="/cart?channel=wholesale" />;
}
