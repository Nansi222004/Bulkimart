import React from 'react';
import OrdersTab from '../components/OrdersTab';

// Uses the same authorized actions as the list. SellerContext loads the route
// reference through the owner-scoped API, including on refresh/new-tab entry.
export default function OrderDetailsPage() {
  return <OrdersTab detailPage />;
}
